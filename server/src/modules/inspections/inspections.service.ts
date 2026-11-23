import { Prisma } from '@prisma/client';
import {
  ApprovalProgressDto,
  calendarDateInTimeZone,
  ChecklistSections,
  InspectionAiFlag,
  InspectionAnswer,
  InspectionOverviewDto,
  InspectionVisitType,
  InspectionVisitTypeEnum,
  INSPECTION_VISIT_TYPE_LABELS,
  inspectionSubmissionDeadline,
  isFailedAnswer,
  allChecklistItems,
  resolveProjectTypeConfig,
  ReviewSiteInspectionRequest,
  SiteInspectionDto,
  SiteInspectionStatus,
  SiteInspectionSummaryDto,
  SubmissionGeotag,
  SubmissionGeotagInput,
  SubmitSiteInspectionRequest,
  validateInspectionAnswers,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { FieldAgentJwtPayload, WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { ensureChain, getChainVersionSteps, getProcessConfig } from '../process/processConfig.service';
import {
  assertMayAct,
  buildApprovalProgress,
  gateForStep,
  loadActions,
  nextApplicableStep,
  orgContextForStep,
  recordApprovalAction,
} from '../process/approvalChain';
import { createMobileNotification, createWebNotification } from '../notifications/notifications.service';
import { evaluateProjectGeofence, GEOFENCE_CONTEXT_SELECT } from '../../utils/geofenceEvaluation';
import { CADENCE_PROJECT_SELECT, cadenceSettingsForDate, periodKeyForDate } from '../cadence/cadence.service';
import { fulfilInspectionObligation, inspectionStreamFor, streamCadenceRow } from '../cadence/streams.service';
import { toCaptureSummary } from '../workday-reports/workdayReports.service';
import { parseSections } from './checklistTemplates.service';
import { autoRaiseFindingsForInspection, serializeFinding, FINDING_INCLUDE, findingViewerFor } from './findings.service';
import { scheduleInspectionOmissionCheck } from '../workday-reports/aiOmissionCheck';
import { autoCompleteMilestones, SYSTEM_ACTOR, webActor } from '../contracts/milestones.service';

/**
 * Phase 15: an accepted final evaluation completes the open AUTO_FINAL_EVALUATION_APPROVED
 * milestones that have a due date (e.g. the post-closure evaluation once the project is closed).
 */
async function completeEvaluationMilestones(tx: Prisma.TransactionClient, projectId: string, visitDate: string, webUser: WebJwtPayload | null) {
  await autoCompleteMilestones(tx, {
    projectId,
    mode: 'AUTO_FINAL_EVALUATION_APPROVED',
    onlyDated: true,
    at: new Date(),
    notes: `Final evaluation inspection of ${visitDate} accepted.`,
    actor: webUser ? webActor(webUser) : SYSTEM_ACTOR,
  });
}

/**
 * Site inspection reports (Phase 14). A project-level visit report built from a checklist template
 * version. Submitted by field sessions (join code or provisioned account) or web users holding
 * `inspections:submit`. Idempotent on clientReportId. Answers are validated against the stored
 * template version; photos are registered captures linked per checklist item. The visit counts
 * towards the INSPECTION stream of its visit type; with report approval on, it goes through the
 * project's report approval chain (subject type SITE_INSPECTION).
 */

type Tx = Prisma.TransactionClient;

export type InspectionPrincipal = { webUser: WebJwtPayload; fieldAgent?: undefined } | { fieldAgent: FieldAgentJwtPayload; webUser?: undefined };

const INSPECTION_INCLUDE = {
  template: { select: { code: true, name: true, sectionsJson: true } },
  stream: { select: { label: true } },
  captures: { include: { mediaAttachments: true }, orderBy: { capturedAtDevice: 'asc' } },
  findings: { include: FINDING_INCLUDE, orderBy: { createdAt: 'asc' } },
} satisfies Prisma.SiteInspectionReportInclude;
type InspectionRow = Prisma.SiteInspectionReportGetPayload<{ include: typeof INSPECTION_INCLUDE }>;

function answersOf(raw: unknown): InspectionAnswer[] {
  return Array.isArray(raw) ? (raw as InspectionAnswer[]) : [];
}

function flagsOf(raw: unknown): InspectionAiFlag[] {
  return Array.isArray(raw) ? (raw as InspectionAiFlag[]) : [];
}

function failedCount(sections: ChecklistSections, answers: InspectionAnswer[]): number {
  const items = new Map(allChecklistItems(sections).map((i) => [i.key, i]));
  return answers.filter((a) => {
    const item = items.get(a.itemKey);
    return item ? isFailedAnswer(item, a.value) : false;
  }).length;
}

function summaryOf(r: InspectionRow): SiteInspectionSummaryDto {
  const sections = parseSections(r.template.sectionsJson);
  const answers = answersOf(r.answersJson);
  return {
    id: r.id,
    clientReportId: r.clientReportId,
    projectId: r.projectId,
    streamId: r.streamId,
    streamLabel: r.stream?.label ?? null,
    visitType: r.visitType,
    templateId: r.templateId,
    templateCode: r.template.code,
    templateName: r.template.name,
    templateVersion: r.templateVersion,
    visitDate: r.visitDate,
    reporterName: r.reporterName,
    reporterRoleName: r.reporterRoleName,
    reporterPersonaType: r.reporterPersonaType,
    overallFinding: r.overallFinding,
    status: r.status,
    isLate: r.isLate,
    submissionDeadline: r.submissionDeadline,
    geofenceStatus: r.geofenceStatus,
    failedItemCount: failedCount(sections, answers),
    openFindingCount: r.findings.filter((f) => f.status === 'OPEN').length,
    photoCount: r.captures.length,
    createdAt: r.createdAt.toISOString(),
  };
}

async function approvalFor(r: InspectionRow, viewer: WebJwtPayload | null): Promise<ApprovalProgressDto | null> {
  if (r.approvalChainVersion === null) return null;
  return buildApprovalProgress(prisma, {
    projectId: r.projectId,
    chainType: 'REPORT',
    version: r.approvalChainVersion,
    subjectType: 'SITE_INSPECTION',
    subjectId: r.id,
    currentStepOrder: r.status === 'PENDING_APPROVAL' ? r.currentApprovalStep : r.status === 'APPROVED' ? null : 0,
    amount: null,
    viewer,
    excludedUserId: r.reporterUserId,
    excludedReason: 'You carried out this inspection, so someone else must review it.',
  });
}

export async function serializeInspection(r: InspectionRow, principal: InspectionPrincipal | null): Promise<SiteInspectionDto> {
  const sections = parseSections(r.template.sectionsJson);
  const items = new Map(allChecklistItems(sections).map((i) => [i.key, i]));
  const capturesByItem = new Map<string, InspectionRow['captures']>();
  for (const c of r.captures) {
    const key = c.checklistItemKey ?? '';
    capturesByItem.set(key, [...(capturesByItem.get(key) ?? []), c]);
  }
  const viewer = principal ? await findingViewerFor(r.projectId, principal) : null;
  const findings = r.findings.filter((f) => !viewer || viewer.kind !== 'contractor' || f.projectContractorId === viewer.contractorId);
  return {
    ...summaryOf(r),
    summaryText: r.summaryText,
    sections,
    answers: answersOf(r.answersJson).map((a) => {
      const item = items.get(a.itemKey);
      return {
        itemKey: a.itemKey,
        value: a.value,
        comment: a.comment ?? null,
        failed: item ? isFailedAnswer(item, a.value) : false,
        captures: (capturesByItem.get(a.itemKey) ?? []).map(toCaptureSummary),
      };
    }),
    submissionGeotag: (r.submissionGeotag as SubmissionGeotag | null) ?? null,
    aiCheckStatus: r.aiCheckStatus,
    aiCheckEngine: r.aiCheckEngine,
    aiFlags: flagsOf(r.aiFlagsJson),
    approval: await approvalFor(r, principal?.webUser ?? null),
    findings: await Promise.all(findings.map((f) => serializeFinding(f, viewer, sections))),
    returnedNotes: r.returnedNotes,
  };
}

async function loadInspection(db: Tx | typeof prisma, projectId: string, inspectionId: string): Promise<InspectionRow> {
  const row = await db.siteInspectionReport.findFirst({ where: { id: inspectionId, projectId }, include: INSPECTION_INCLUDE });
  if (!row) throw new AppError('Inspection not found', 404, 'INSPECTION_NOT_FOUND');
  return row;
}

export async function getSiteInspection(projectId: string, inspectionId: string, principal: InspectionPrincipal): Promise<SiteInspectionDto> {
  return serializeInspection(await loadInspection(prisma, projectId, inspectionId), principal);
}

// ---------------------------------------------------------------------------
// Submission
// ---------------------------------------------------------------------------

function evaluateGeotag(
  input: SubmissionGeotagInput | null | undefined,
  project: Parameters<typeof evaluateProjectGeofence>[0]
): SubmissionGeotag | null {
  if (!input) return null;
  const evaluation = evaluateProjectGeofence(project, input);
  return {
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyMeters: input.accuracyMeters ?? null,
    altitudeMeters: input.altitudeMeters ?? null,
    isMocked: input.isMocked,
    capturedAt: input.capturedAt,
    isWithinGeofence: evaluation.isWithinGeofence,
    geofenceStatus: evaluation.geofenceStatus,
    distanceOutsideMeters: evaluation.distanceOutsideMeters,
    chainageLabel: evaluation.chainageLabel,
    distanceFromSiteMeters: evaluation.distanceFromSiteMeters,
  };
}

interface Reporter {
  fieldSessionId: string | null;
  userId: string | null;
  name: string;
  roleId: string | null;
  roleName: string;
  persona: 'CONTRACTOR_EXECUTOR' | 'INDEPENDENT_VERIFIER' | 'NONE';
  projectContractorId: string | null;
  actorType: 'FIELD_AGENT' | 'WEB_USER';
  actorId: string;
}

async function reporterFor(projectId: string, principal: InspectionPrincipal): Promise<Reporter> {
  if (principal.webUser) {
    const u = principal.webUser;
    return {
      fieldSessionId: null,
      userId: u.userId,
      name: u.fullName,
      roleId: u.roleId,
      roleName: u.roleName,
      persona: 'NONE',
      projectContractorId: null,
      actorType: 'WEB_USER',
      actorId: u.userId,
    };
  }
  const f = principal.fieldAgent;
  if (!f.permissions.includes('inspections:submit')) {
    throw new AppError('Access requires permission(s): inspections:submit', 403, 'FORBIDDEN_PERMISSION');
  }
  const session = await prisma.fieldAgentSession.findUniqueOrThrow({
    where: { id: f.sessionId },
    select: { projectContractorId: true, assuranceStatus: true },
  });
  const config = await getProcessConfig(projectId);
  if (config.enableContractorIdentityAssurance && session.assuranceStatus !== 'APPROVED') {
    throw new AppError('Your identity has not been approved yet, so you cannot submit inspections', 403, 'IDENTITY_NOT_APPROVED');
  }
  return {
    fieldSessionId: f.sessionId,
    userId: f.userId,
    name: f.agentFullName,
    roleId: f.roleId,
    roleName: f.roleName,
    persona: f.fieldPersonaType,
    projectContractorId: session.projectContractorId,
    actorType: 'FIELD_AGENT',
    actorId: f.sessionId,
  };
}

function sameReporter(row: { reporterFieldSessionId: string | null; reporterUserId: string | null }, r: Reporter): boolean {
  if (r.fieldSessionId) return row.reporterFieldSessionId === r.fieldSessionId;
  return row.reporterFieldSessionId === null && row.reporterUserId === r.userId;
}

/**
 * Captures named by the answers. Each must be registered, in this project (captures from another
 * project are refused), taken by this reporter's session, and not linked to a report or inspection.
 * Missing captures are a retryable 409: the device sends captures before the inspection.
 */
async function loadInspectionCaptures(projectId: string, reporter: Reporter, answers: InspectionAnswer[]) {
  const wanted = answers.flatMap((a) => a.clientCaptureIds.map((id) => ({ id, itemKey: a.itemKey })));
  const ids = [...new Set(wanted.map((w) => w.id))];
  if (ids.length !== wanted.length) throw new AppError('A photo is attached to two checklist items', 400, 'CAPTURE_DUPLICATED');
  if (ids.length === 0) return [];
  if (!reporter.fieldSessionId) {
    throw new AppError('Photos are taken with the mobile app; submit this inspection from the field app to attach them', 400, 'CAPTURES_NEED_FIELD_APP');
  }
  const captures = await prisma.fieldEvidenceLog.findMany({
    where: { clientCaptureId: { in: ids } },
    select: { id: true, clientCaptureId: true, projectId: true, fieldSessionId: true, workdayReportId: true, siteInspectionReportId: true },
  });
  const found = new Map(captures.map((c) => [c.clientCaptureId, c]));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length) {
    throw new AppError('Some captures are not registered yet', 409, 'CAPTURES_NOT_REGISTERED', { missingClientCaptureIds: missing });
  }
  for (const c of captures) {
    if (c.projectId !== projectId) throw new AppError('A photo belongs to another project', 403, 'CAPTURE_OTHER_PROJECT');
    if (c.fieldSessionId !== reporter.fieldSessionId) throw new AppError('A capture does not belong to this reporter', 403, 'CAPTURE_NOT_OWNED');
    if (c.workdayReportId || c.siteInspectionReportId) {
      throw new AppError('A capture is already linked to another report', 409, 'CAPTURE_ALREADY_LINKED', { clientCaptureId: c.clientCaptureId });
    }
  }
  return wanted.map((w) => ({ ...found.get(w.id)!, itemKey: w.itemKey }));
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

async function replay(clientReportId: string, reporter: Reporter, principal: InspectionPrincipal): Promise<SiteInspectionDto | null> {
  const existing = await prisma.siteInspectionReport.findUnique({ where: { clientReportId }, include: INSPECTION_INCLUDE });
  if (!existing) return null;
  if (!sameReporter(existing, reporter)) throw new AppError('This report ID is already in use', 409, 'REPORT_ID_CONFLICT');
  return serializeInspection(existing, principal);
}

async function notifyInspectionPendingApproval(
  tx: Tx,
  params: { projectId: string; inspectionId: string; visitType: InspectionVisitType; version: number; stepOrder: number; reporterName: string }
) {
  const steps = await getChainVersionSteps(tx, params.projectId, 'REPORT', params.version);
  const step = steps.find((s) => s.stepOrder === params.stepOrder);
  if (!step) return;
  const label = INSPECTION_VISIT_TYPE_LABELS[params.visitType];
  await createWebNotification(tx, {
    projectId: params.projectId,
    targetPermissionKey: step.requiredPermissionKey,
    targetRoleId: step.requiredRoleId,
    category: 'INSPECTION_PENDING_APPROVAL',
    title: `Inspection awaiting ${step.label} · ${label}`,
    description: `${params.reporterName}'s ${label.toLowerCase()} is waiting for "${step.label}" (step ${step.stepOrder} of ${steps.length}).`,
    actionUrl: `/app/projects/${params.projectId}/inspections?inspectionId=${params.inspectionId}`,
    metadata: { siteInspectionReportId: params.inspectionId, stepOrder: step.stepOrder, chainVersion: params.version },
    hideFromProjectContractors: true,
  });
}

export async function submitSiteInspection(params: {
  projectId: string;
  principal: InspectionPrincipal;
  input: SubmitSiteInspectionRequest;
}): Promise<{ inspection: SiteInspectionDto; created: boolean }> {
  const { projectId, principal, input } = params;
  const reporter = await reporterFor(projectId, principal);
  const earlier = await replay(input.clientReportId, reporter, principal);
  if (earlier) return { inspection: earlier, created: false };

  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { ...CADENCE_PROJECT_SELECT, ...GEOFENCE_CONTEXT_SELECT, tenantId: true, name: true },
  });
  const template = await prisma.inspectionChecklistTemplate.findFirst({ where: { id: input.templateId, tenantId: project.tenantId } });
  if (!template) throw new AppError('Checklist template not found', 404, 'CHECKLIST_TEMPLATE_NOT_FOUND');
  if (template.version !== input.templateVersion) {
    throw new AppError('The checklist version does not match the template', 422, 'TEMPLATE_VERSION_MISMATCH', {
      templateVersion: template.version,
    });
  }
  if (!template.visitTypes.includes(input.visitType)) {
    throw new AppError(`This checklist is not for a ${INSPECTION_VISIT_TYPE_LABELS[input.visitType].toLowerCase()}`, 422, 'TEMPLATE_VISIT_TYPE_MISMATCH');
  }
  const sections = parseSections(template.sectionsJson);
  const check = validateInspectionAnswers(sections, input.answers);
  if (!check.valid) {
    throw new AppError('Some checklist answers are missing or invalid', 422, 'INVALID_INSPECTION_ANSWERS', { errors: check.errors });
  }
  const confirmedAt = new Date(input.confirmedAt);
  if (confirmedAt.getTime() - Date.now() > 15 * 60 * 1000) {
    throw new AppError('The inspection is dated in the future. Check the phone clock.', 400, 'CONFIRMED_AT_IN_FUTURE');
  }
  const confirmedDay = calendarDateInTimeZone(confirmedAt, project.timezone);
  if (input.visitDate > confirmedDay) throw new AppError('The visit date cannot be after the day it was submitted', 400, 'VISIT_DATE_IN_FUTURE');

  const captures = await loadInspectionCaptures(projectId, reporter, input.answers);
  const geotag = evaluateGeotag(input.submissionGeotag, project);

  // The stream the visit answers, its period (of the visit date) and the upload deadline.
  const stream = await inspectionStreamFor(prisma, projectId, {
    visitType: input.visitType,
    roleId: reporter.roleId,
    projectContractorId: reporter.projectContractorId,
  });
  const period = stream ? periodKeyForDate(cadenceSettingsForDate(streamCadenceRow(project, stream), input.visitDate), input.visitDate) : null;
  const deadline = inspectionSubmissionDeadline(input.visitDate, stream?.submissionDeadlineDays);
  const isLate = deadline !== null && confirmedDay > deadline;

  const config = await getProcessConfig(projectId);
  let createdId: string;
  try {
    createdId = await prisma.$transaction(async (tx) => {
      let status: SiteInspectionStatus = 'SUBMITTED';
      let approvalChainVersion: number | null = null;
      let currentApprovalStep = 0;
      if (config.requireReportApproval) {
        const chain = await ensureChain(tx, projectId, 'REPORT');
        const first = nextApplicableStep(chain.steps, 0, null);
        if (first) {
          status = 'PENDING_APPROVAL';
          approvalChainVersion = chain.version;
          currentApprovalStep = first.stepOrder;
        }
      }
      const report = await tx.siteInspectionReport.create({
        data: {
          clientReportId: input.clientReportId,
          projectId,
          streamId: stream?.id ?? null,
          visitType: input.visitType,
          templateId: template.id,
          templateVersion: template.version,
          visitDate: input.visitDate,
          reporterFieldSessionId: reporter.fieldSessionId,
          reporterUserId: reporter.userId,
          reporterName: reporter.name,
          reporterRoleId: reporter.roleId,
          reporterRoleName: reporter.roleName,
          reporterPersonaType: reporter.persona,
          reporterProjectContractorId: reporter.projectContractorId,
          answersJson: input.answers as unknown as Prisma.InputJsonValue,
          overallFinding: input.overallFinding,
          summaryText: input.summaryText,
          submissionGeotag: (geotag ?? undefined) as unknown as Prisma.InputJsonValue | undefined,
          geofenceStatus: geotag?.geofenceStatus ?? null,
          status,
          reportingPeriodStart: period?.hasObligations ? period.periodStart : null,
          isLate,
          submissionDeadline: deadline,
          confirmedAt,
          approvalChainVersion,
          currentApprovalStep,
          aiCheckStatus: config.enableAiOmissionCheck ? 'PENDING' : 'SKIPPED',
        },
      });
      for (const c of captures) {
        const linked = await tx.fieldEvidenceLog.updateMany({
          where: { id: c.id, workdayReportId: null, siteInspectionReportId: null },
          data: { siteInspectionReportId: report.id, checklistItemKey: c.itemKey },
        });
        if (linked.count !== 1) throw new AppError('A capture is already linked to another report', 409, 'CAPTURE_ALREADY_LINKED');
      }
      const obligationId =
        stream && period?.hasObligations
          ? await fulfilInspectionObligation(tx, { streamId: stream.id, periodStart: period.periodStart, inspectionId: report.id, isLate })
          : null;
      const findings = await autoRaiseFindingsForInspection(tx, {
        projectId,
        inspectionId: report.id,
        sections,
        answers: input.answers,
        failedItemKeys: check.failedItemKeys,
        overallFinding: input.overallFinding,
        raisedBy: { userId: reporter.userId, name: reporter.name },
        visitType: input.visitType,
      });
      if (status === 'SUBMITTED' && input.visitType === 'FINAL_EVALUATION') {
        await completeEvaluationMilestones(tx, projectId, input.visitDate, principal.webUser ?? null);
      }
      if (status === 'PENDING_APPROVAL' && approvalChainVersion !== null) {
        await notifyInspectionPendingApproval(tx, {
          projectId,
          inspectionId: report.id,
          visitType: input.visitType,
          version: approvalChainVersion,
          stepOrder: currentApprovalStep,
          reporterName: reporter.name,
        });
      }
      const label = INSPECTION_VISIT_TYPE_LABELS[input.visitType];
      await recordAuditEvent(tx, {
        projectId,
        actorType: reporter.actorType,
        actorId: reporter.actorId,
        actorDisplayName: `${reporter.name} (${reporter.roleName})`,
        action: 'INSPECTION_SUBMITTED',
        summaryText: `Submitted ${label.toLowerCase()} of ${input.visitDate} (${template.name} v${template.version}): ${input.overallFinding.replace('_', ' ').toLowerCase()}, ${check.failedItemKeys.length} failed item(s), ${captures.length} photo(s)${
          isLate ? `; late (deadline ${deadline})` : ''
        }${status === 'PENDING_APPROVAL' ? '; awaiting approval' : ''}.`,
        payload: {
          siteInspectionReportId: report.id,
          clientReportId: input.clientReportId,
          visitType: input.visitType,
          templateId: template.id,
          templateVersion: template.version,
          streamId: stream?.id ?? null,
          obligationId,
          isLate,
          findingIds: findings,
          missingPhotoItemKeys: check.missingPhotoItemKeys,
        },
      });
      return report.id;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const again = await replay(input.clientReportId, reporter, principal);
      if (again) return { inspection: again, created: false };
    }
    throw error;
  }
  if (config.enableAiOmissionCheck) scheduleInspectionOmissionCheck(createdId);
  return { inspection: await getSiteInspection(projectId, createdId, principal), created: true };
}

// ---------------------------------------------------------------------------
// Review (report approval chain, subject SITE_INSPECTION)
// ---------------------------------------------------------------------------

export async function reviewSiteInspection(params: {
  projectId: string;
  inspectionId: string;
  webUser: WebJwtPayload;
  input: ReviewSiteInspectionRequest;
}): Promise<SiteInspectionDto> {
  const { projectId, inspectionId, webUser, input } = params;
  await prisma.$transaction(async (tx) => {
    await loadInspection(tx, projectId, inspectionId);
    await tx.$queryRaw`SELECT id FROM "site_inspection_reports" WHERE id = ${inspectionId}::uuid FOR UPDATE`;
    const r = await tx.siteInspectionReport.findUniqueOrThrow({ where: { id: inspectionId } });
    if (r.status !== 'PENDING_APPROVAL' || r.approvalChainVersion === null) {
      throw new AppError('This inspection is not waiting for approval', 409, 'INSPECTION_NOT_PENDING_APPROVAL', { status: r.status });
    }
    const steps = await getChainVersionSteps(tx, projectId, 'REPORT', r.approvalChainVersion);
    const step = steps.find((s) => s.stepOrder === r.currentApprovalStep) ?? null;
    const actions = await loadActions(tx, 'SITE_INSPECTION', r.id);
    assertMayAct(
      gateForStep({
        webUser,
        step,
        actions,
        orgContext: await orgContextForStep(tx, projectId, step),
        excludedUserId: r.reporterUserId,
        excludedReason: 'You carried out this inspection, so someone else must review it.',
      }),
      step
    );
    await recordApprovalAction(tx, {
      projectId,
      chainType: 'REPORT',
      subjectType: 'SITE_INSPECTION',
      subjectId: r.id,
      step: step!,
      decision: input.decision,
      actorUserId: webUser.userId,
      notes: input.notes ?? null,
    });
    const label = INSPECTION_VISIT_TYPE_LABELS[r.visitType];
    const audit = (summaryText: string, extra: Record<string, unknown> = {}) =>
      recordAuditEvent(tx, {
        projectId,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
        action: 'INSPECTION_REVIEWED',
        summaryText,
        payload: { siteInspectionReportId: r.id, decision: input.decision, stepOrder: step!.stepOrder, chainVersion: r.approvalChainVersion, notes: input.notes ?? null, ...extra },
      });

    if (input.decision === 'RETURN') {
      await tx.siteInspectionReport.update({
        where: { id: r.id },
        data: { status: 'RETURNED', currentApprovalStep: 0, returnedNotes: input.notes ?? null },
      });
      if (r.reporterFieldSessionId) {
        await createMobileNotification(tx, {
          projectId,
          fieldSessionId: r.reporterFieldSessionId,
          type: 'REPORT_QUERY',
          actionType: 'NONE',
          title: `${label} returned`,
          message: `Your ${label.toLowerCase()} of ${r.visitDate} was returned at "${step!.label}": ${input.notes}. Submit a corrected inspection.`,
          metadata: { siteInspectionReportId: r.id },
        });
      }
      await audit(`Returned the ${label.toLowerCase()} of ${r.visitDate} at step ${step!.stepOrder} "${step!.label}": ${input.notes}`);
      return;
    }
    const next = nextApplicableStep(steps, step!.stepOrder, null);
    if (next) {
      await tx.siteInspectionReport.update({ where: { id: r.id }, data: { currentApprovalStep: next.stepOrder } });
      await notifyInspectionPendingApproval(tx, {
        projectId,
        inspectionId: r.id,
        visitType: r.visitType,
        version: r.approvalChainVersion,
        stepOrder: next.stepOrder,
        reporterName: r.reporterName,
      });
      await audit(`Approved step ${step!.stepOrder} "${step!.label}" of the ${label.toLowerCase()} of ${r.visitDate}; now at "${next.label}".`, {
        nextStepOrder: next.stepOrder,
      });
      return;
    }
    await tx.siteInspectionReport.update({
      where: { id: r.id },
      data: { status: 'APPROVED', currentApprovalStep: 0, approvedAt: new Date() },
    });
    await audit(`Approved the ${label.toLowerCase()} of ${r.visitDate} at the final step "${step!.label}".`);
    if (r.visitType === 'FINAL_EVALUATION') await completeEvaluationMilestones(tx, projectId, r.visitDate, webUser);
  });
  return getSiteInspection(projectId, inspectionId, { webUser });
}

// ---------------------------------------------------------------------------
// Lists and overview
// ---------------------------------------------------------------------------

export async function listSiteInspections(params: {
  projectId: string;
  principal: InspectionPrincipal;
  visitType?: string;
  streamId?: string;
  overallFinding?: string;
  status?: string;
  lateOnly?: boolean;
  withOpenFindings?: boolean;
}): Promise<SiteInspectionSummaryDto[]> {
  const where: Prisma.SiteInspectionReportWhereInput = { projectId: params.projectId };
  if (params.visitType && InspectionVisitTypeEnum.safeParse(params.visitType).success) where.visitType = params.visitType as InspectionVisitType;
  if (params.streamId) where.streamId = params.streamId;
  if (params.overallFinding) where.overallFinding = params.overallFinding as Prisma.SiteInspectionReportWhereInput['overallFinding'];
  if (params.status) where.status = params.status as Prisma.SiteInspectionReportWhereInput['status'];
  if (params.lateOnly) where.isLate = true;
  if (params.withOpenFindings) where.findings = { some: { status: 'OPEN' } };
  // A field session sees its own inspections; a provisioned account those of all its devices.
  const f = params.principal.fieldAgent;
  if (f) where.OR = f.userId ? [{ reporterUserId: f.userId }, { reporterFieldSessionId: f.sessionId }] : [{ reporterFieldSessionId: f.sessionId }];
  const rows = await prisma.siteInspectionReport.findMany({
    where,
    include: INSPECTION_INCLUDE,
    orderBy: [{ visitDate: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  });
  return rows.map(summaryOf);
}

/** Accepted inspections: approved, or submitted on a project without report approval. */
const ACCEPTED: SiteInspectionStatus[] = ['APPROVED', 'SUBMITTED'];

export async function getInspectionOverview(projectId: string, now = new Date()): Promise<InspectionOverviewDto> {
  const [latest, openFindings, missedInspections, baseline, nextDue] = await Promise.all([
    Promise.all(
      InspectionVisitTypeEnum.options.map(async (visitType) => {
        const r = await prisma.siteInspectionReport.findFirst({
          where: { projectId, visitType, status: { not: 'RETURNED' } },
          orderBy: [{ visitDate: 'desc' }, { createdAt: 'desc' }],
          select: { id: true, visitDate: true, status: true, overallFinding: true },
        });
        return [visitType, r] as const;
      })
    ),
    prisma.inspectionFinding.count({ where: { projectId, status: 'OPEN' } }),
    prisma.reportingObligation.count({ where: { projectId, boqItemId: null, status: 'MISSED' } }),
    prisma.siteInspectionReport.count({ where: { projectId, visitType: 'BASELINE', status: { in: ACCEPTED } } }),
    prisma.reportingObligation.findFirst({
      where: { projectId, boqItemId: null, status: { in: ['PENDING', 'MISSED'] }, streamId: { not: null } },
      orderBy: { dueAt: 'asc' },
      include: { stream: { select: { label: true, visitType: true } } },
    }),
  ]);
  void now;
  return {
    lastByVisitType: Object.fromEntries(latest) as InspectionOverviewDto['lastByVisitType'],
    nextDue: nextDue?.streamId
      ? {
          streamId: nextDue.streamId,
          streamLabel: nextDue.stream?.label ?? 'Site inspection',
          visitType: nextDue.stream?.visitType ?? null,
          periodStart: nextDue.periodStart,
          periodEnd: nextDue.periodEnd,
          dueAt: nextDue.lateAfter.toISOString(),
          status: nextDue.status,
        }
      : null,
    openFindings,
    missedInspections,
    baselineComplete: baseline > 0,
  };
}

/** Whether a project's type names a visit type template; used by the mobile pack. */
export function projectTypeConfigOf(snapshot: unknown) {
  return resolveProjectTypeConfig(snapshot);
}
