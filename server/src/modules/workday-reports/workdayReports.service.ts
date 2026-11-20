import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import {
  calendarDateInTimeZone,
  canonicalReportString,
  isValidTimeZone,
  REPORT_LOW_GPS_ACCURACY_METERS,
  ApprovalProgressDto,
  FieldPersonaType,
  RevalidateWorkdayReportRequest,
  ReviewWorkdayReportRequest,
  StandardsViolationItem,
  SubmissionGeotag,
  SubmissionGeotagInput,
  SubmitWorkdayReportRequest,
  SuggestWorkdaySummaryRequest,
  SuggestWorkdaySummaryResponse,
  WorkdayReportCaptureSummary,
  WorkdayReportDto,
  WorkdayTextNote,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { AppError } from '../../middleware/error.middleware';
import { FieldAgentJwtPayload, WebJwtPayload } from '../../middleware/auth.middleware';
import {
  assertFieldReportingAllowed,
  ensureChain,
  getChainVersionSteps,
  getProcessConfig,
} from '../process/processConfig.service';
import {
  assertMayAct,
  buildApprovalProgress,
  gateForStep,
  orgContextForStep,
  loadActions,
  nextApplicableStep,
  recordApprovalAction,
} from '../process/approvalChain';
import { dispatchReportQueryBundle } from '../wbs-chat/wbsChat.service';
import { azureOpenAiService } from '../../integrations/azure-openai.service';
import { whisperService } from '../../integrations/whisper.service';
import { storageService } from '../../integrations/storage.service';
import { recordAuditEvent } from '../audit/audit.service';
import { createWebNotification, markNotificationsReadForSession } from '../notifications/notifications.service';
import { markNotificationsActioned } from '../notifications/notificationActions';
import { serializeReportQuery } from '../wbs-chat/wbsChat.service';
import { loadBoqItemInProject, loadReportQueryInProject } from '../../utils/ownership';
import { evaluateProjectGeofence, GEOFENCE_CONTEXT_SELECT } from '../../utils/geofenceEvaluation';
import { verifyDeviceSignature } from '../../utils/deviceSignature';
import { serializeCapture } from '../../utils/serializers';
import { scheduleAiOmissionCheck } from './aiOmissionCheck';
import { recordItemActualStart } from '../schedule/schedule.service';
import {
  CADENCE_PROJECT_SELECT,
  cadenceSettingsForDate,
  fulfilObligation,
  lateness,
  periodKeyForDate,
  reporterScopeFor,
} from '../cadence/cadence.service';

/** Report statuses that count as evidence (and so mark an item's actual start). */
const isCountedStatus = (status: string) => status === 'CONFIRMED' || status === 'APPROVED_COMPLETED';

type Tx = Prisma.TransactionClient;

const REPORT_INCLUDE = {
  boqItem: { select: { wbsCode: true, description: true } },
  reporterSession: { select: { agentFullName: true, roleNameSnapshot: true, userId: true } },
  captures: { include: { mediaAttachments: true }, orderBy: { capturedAtDevice: 'asc' } },
} satisfies Prisma.WorkdayReportInclude;

const REPORT_INCLUDE_WITH_QUERIES = {
  ...REPORT_INCLUDE,
  queries: {
    include: { raisedByUser: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
  },
} satisfies Prisma.WorkdayReportInclude;

type ReportRow = Prisma.WorkdayReportGetPayload<{ include: typeof REPORT_INCLUDE }> & {
  queries?: Array<Parameters<typeof serializeReportQuery>[0]>;
};

function asTextNotes(raw: unknown): WorkdayTextNote[] {
  return Array.isArray(raw) ? (raw as WorkdayTextNote[]) : [];
}

function toCaptureSummary(c: ReportRow['captures'][number]): WorkdayReportCaptureSummary {
  const full = serializeCapture(c);
  return {
    id: full.id,
    clientCaptureId: full.clientCaptureId,
    mediaType: full.mediaType,
    objectKey: full.objectKey,
    mimeType: full.mimeType,
    caption: full.caption,
    capturedAt: full.capturedAt,
    locationAvailable: full.locationAvailable,
    latitude: full.latitude,
    longitude: full.longitude,
    gpsAccuracyMeters: full.gpsAccuracyMeters,
    isMockLocation: full.isMockLocation,
    isWithinGeofence: full.isWithinGeofence,
    chainageLabel: full.chainageLabel,
    signatureVerified: full.signatureVerified,
    integrityPassed: full.integrityPassed,
    integrityFlags: full.integrityFlags,
    transcriptionStatus: full.transcriptionStatus,
    transcript: full.transcript,
    durationSeconds: full.durationSeconds,
    resubmittedFromClientCaptureId: full.resubmittedFromClientCaptureId ?? null,
  };
}

function asViolations(raw: unknown): StandardsViolationItem[] {
  return Array.isArray(raw) ? (raw as StandardsViolationItem[]) : [];
}

export function serializeWorkdayReport(
  r: ReportRow,
  extra: { idempotentReplay?: boolean; approval?: ApprovalProgressDto | null } = {}
): WorkdayReportDto {
  return {
    id: r.id,
    clientReportId: r.clientReportId,
    projectId: r.projectId,
    reporterSessionId: r.reporterSessionId,
    reporterName: r.reporterSession.agentFullName,
    reporterTier: r.reporterSession.roleNameSnapshot,
    wbsItemId: r.wbsItemId,
    wbsCode: r.boqItem.wbsCode,
    wbsDescription: r.boqItem.description,
    workdayDate: r.workdayDate,
    reporterTimezone: r.reporterTimezone,
    status: r.status,
    revisionNumber: r.revisionNumber,
    parentReportId: r.parentReportId,
    resolvedQueryId: r.resolvedQueryId,
    summaryText: r.summaryText,
    reportedQuantity: Number(r.reportedQuantity),
    unitOfMeasure: r.unitOfMeasure,
    isHoldPointClaimed: r.isHoldPointClaimed,
    delaysOrBlockers: r.delaysOrBlockers,
    textNotes: asTextNotes(r.textNotes),
    captures: r.captures.map(toCaptureSummary),
    submissionGeotag: (r.submissionGeotag as SubmissionGeotag | null) ?? null,
    integrityFlags: Array.isArray(r.integrityFlags) ? (r.integrityFlags as string[]) : [],
    signatureVerified: r.signatureVerified,
    aiCheckStatus: r.aiCheckStatus,
    aiCheckEngine: r.aiCheckEngine,
    aiReasoning: r.aiReasoning,
    humanConfirmedAt: r.humanConfirmedAt?.toISOString() ?? null,
    releasedAt: r.releasedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    queries: r.queries ? r.queries.map(serializeReportQuery) : [],
    reporterPersonaType: r.reporterPersonaType as FieldPersonaType,
    standardsCompliancePassed: r.standardsCompliancePassed,
    standardsViolations: asViolations(r.standardsViolationsJson),
    approvalChainVersion: r.approvalChainVersion,
    currentApprovalStep: r.currentApprovalStep,
    approvedCompletedAt: r.approvedCompletedAt?.toISOString() ?? null,
    approval: extra.approval ?? null,
    reportingPeriodStart: r.reportingPeriodStart,
    reportingPeriodEnd: r.reportingPeriodEnd,
    dueAt: r.dueAt.toISOString(),
    isLateSubmission: r.isLateSubmission,
    lateByMinutes: r.lateByMinutes,
    ...(extra.idempotentReplay ? { idempotentReplay: true } : {}),
  };
}

/** The report's position on its approval chain, or null when it was never on one. */
async function approvalProgressFor(r: ReportRow, viewer?: WebJwtPayload | null): Promise<ApprovalProgressDto | null> {
  if (r.approvalChainVersion === null) return null;
  return buildApprovalProgress(prisma, {
    projectId: r.projectId,
    chainType: 'REPORT',
    version: r.approvalChainVersion,
    subjectType: 'WORKDAY_REPORT',
    subjectId: r.id,
    currentStepOrder: r.status === 'APPROVED_COMPLETED' ? null : r.currentApprovalStep,
    amount: null,
    viewer,
    excludedUserId: r.reporterSession.userId,
    excludedReason: 'You submitted this report, so someone else must review it.',
  });
}

export async function serializeWithApproval(
  r: ReportRow,
  viewer?: WebJwtPayload | null,
  extra: { idempotentReplay?: boolean } = {}
): Promise<WorkdayReportDto> {
  return serializeWorkdayReport(r, { ...extra, approval: await approvalProgressFor(r, viewer) });
}

/**
 * Where an accepted report goes (Phase 7): straight to CONFIRMED, or onto the report approval chain
 * at its first step when the project requires report approval. A revision of a report already on a
 * chain re-enters that chain version at step 1 (items in flight keep their chain).
 */
async function acceptedReportState(
  tx: Tx,
  projectId: string,
  inheritedChainVersion: number | null
): Promise<{ status: 'CONFIRMED' | 'PENDING_APPROVAL'; approvalChainVersion: number | null; currentApprovalStep: number }> {
  const config = await getProcessConfig(projectId, tx);
  if (!config.requireReportApproval && inheritedChainVersion === null) {
    return { status: 'CONFIRMED', approvalChainVersion: null, currentApprovalStep: 0 };
  }
  const version = inheritedChainVersion ?? (await ensureChain(tx, projectId, 'REPORT')).version;
  const steps = await getChainVersionSteps(tx, projectId, 'REPORT', version);
  const first = nextApplicableStep(steps, 0, null);
  if (!first) return { status: 'CONFIRMED', approvalChainVersion: null, currentApprovalStep: 0 };
  return { status: 'PENDING_APPROVAL', approvalChainVersion: version, currentApprovalStep: first.stepOrder };
}

async function notifyPendingApproval(
  tx: Tx,
  params: { projectId: string; reportId: string; wbsItemId: string; wbsCode: string; version: number; stepOrder: number; reporterName: string }
) {
  const steps = await getChainVersionSteps(tx, params.projectId, 'REPORT', params.version);
  const step = steps.find((s) => s.stepOrder === params.stepOrder);
  if (!step) return;
  await createWebNotification(tx, {
    projectId: params.projectId,
    targetPermissionKey: step.requiredPermissionKey,
    targetRoleId: step.requiredRoleId,
    category: 'REPORT_PENDING_APPROVAL',
    title: `Report awaiting ${step.label} · WBS ${params.wbsCode}`,
    description: `${params.reporterName}'s report on WBS ${params.wbsCode} is waiting for "${step.label}" (step ${step.stepOrder} of ${steps.length}).`,
    actionUrl: `/app/projects/${params.projectId}/audit?tab=presence&wbsItemId=${params.wbsItemId}&reportId=${params.reportId}`,
    metadata: { workdayReportId: params.reportId, wbsItemId: params.wbsItemId, stepOrder: step.stepOrder, chainVersion: params.version },
  });
}

export type SubmitResult = { report: WorkdayReportDto; created: boolean };

/** Returns the earlier report for this clientReportId, or null. Another session's ID is a conflict. */
async function findReportForReplay(clientReportId: string, sessionId: string): Promise<WorkdayReportDto | null> {
  const existing = await prisma.workdayReport.findUnique({
    where: { clientReportId },
    include: REPORT_INCLUDE_WITH_QUERIES,
  });
  if (!existing) return null;
  if (existing.reporterSessionId !== sessionId) {
    throw new AppError('This report ID is already in use', 409, 'REPORT_ID_CONFLICT');
  }
  return serializeWithApproval(existing, null, { idempotentReplay: true });
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

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

/**
 * Loads the captures the report references. Every one must be registered by this reporter in this
 * project, unlinked, and either untagged or tagged to the same WBS item. Missing captures are a
 * retryable 409: the device sends captures before the report that references them.
 */
async function loadLinkableCaptures(params: {
  projectId: string;
  sessionId: string;
  wbsItemId: string;
  clientCaptureIds: string[];
}) {
  const ids = [...new Set(params.clientCaptureIds)];
  if (ids.length === 0) return [];
  const captures = await prisma.fieldEvidenceLog.findMany({
    where: { clientCaptureId: { in: ids } },
    select: { id: true, clientCaptureId: true, projectId: true, fieldSessionId: true, boqItemId: true, workdayReportId: true },
  });
  const found = new Map(captures.map((c) => [c.clientCaptureId, c]));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new AppError('Some captures are not registered yet', 409, 'CAPTURES_NOT_REGISTERED', {
      missingClientCaptureIds: missing,
    });
  }
  for (const c of captures) {
    if (c.projectId !== params.projectId || c.fieldSessionId !== params.sessionId) {
      throw new AppError('A capture does not belong to this reporter', 403, 'CAPTURE_NOT_OWNED');
    }
    if (c.workdayReportId) {
      throw new AppError('A capture is already linked to another report', 409, 'CAPTURE_ALREADY_LINKED', {
        clientCaptureId: c.clientCaptureId,
      });
    }
    if (c.boqItemId && c.boqItemId !== params.wbsItemId) {
      throw new AppError('A capture was taken for a different WBS item', 400, 'CAPTURE_WBS_MISMATCH', {
        clientCaptureId: c.clientCaptureId,
      });
    }
  }
  return captures;
}

async function linkCaptures(tx: Tx, reportId: string, wbsItemId: string, captureIds: string[]) {
  if (captureIds.length === 0) return;
  const linked = await tx.fieldEvidenceLog.updateMany({
    where: { id: { in: captureIds }, workdayReportId: null },
    data: { workdayReportId: reportId, boqItemId: wbsItemId },
  });
  if (linked.count !== captureIds.length) {
    throw new AppError('A capture is already linked to another report', 409, 'CAPTURE_ALREADY_LINKED');
  }
}

async function recordReportPing(
  tx: Tx,
  params: { projectId: string; sessionId: string; wbsItemId: string; geotag: SubmissionGeotag | null }
) {
  if (!params.geotag) return;
  await tx.siteTelemetryPing.create({
    data: {
      clientPingId: crypto.randomUUID(),
      projectId: params.projectId,
      fieldSessionId: params.sessionId,
      wbsItemId: params.wbsItemId,
      latitude: params.geotag.latitude,
      longitude: params.geotag.longitude,
      accuracyMeters: params.geotag.accuracyMeters ?? null,
      altitudeMeters: params.geotag.altitudeMeters ?? null,
      isMocked: params.geotag.isMocked,
      isWithinGeofence: params.geotag.isWithinGeofence,
      geofenceStatus: params.geotag.geofenceStatus ?? null,
      distanceOutsideMeters: params.geotag.distanceOutsideMeters ?? null,
      chainageLabel: params.geotag.chainageLabel,
      distanceMeters: params.geotag.distanceFromSiteMeters,
      pingSource: 'REPORT_SUBMISSION',
      capturedAtDevice: new Date(params.geotag.capturedAt),
    },
  });
}

/** Badges for the report itself: location quality and the device signature result. */
function reportFlags(geotag: SubmissionGeotag, signatureFlag: string | null): string[] {
  const flags: string[] = [];
  if (geotag.isMocked) flags.push('MOCK_GPS_LOCATION_DETECTED');
  if (geotag.isWithinGeofence === false) flags.push('OUTSIDE_PROJECT_GEOFENCE');
  if (geotag.geofenceStatus === 'WITHIN_TOLERANCE') flags.push('WITHIN_GEOFENCE_TOLERANCE');
  if (geotag.isWithinGeofence === null) flags.push('GEOFENCE_UNAVAILABLE');
  if (geotag.accuracyMeters == null) flags.push('GPS_ACCURACY_UNKNOWN');
  else if (geotag.accuracyMeters > REPORT_LOW_GPS_ACCURACY_METERS) flags.push('LOW_GPS_ACCURACY');
  if (signatureFlag) flags.push(signatureFlag);
  return flags;
}

const MAX_FUTURE_CONFIRMATION_MS = 15 * 60 * 1000;

/**
 * Safeguard on the reporting day: it must be the date of `confirmedAt` in the project's time zone,
 * so the one-report-per-day rule means the same day for every reporter on the project.
 */
function assertReportingDay(input: { workdayDate: string; confirmedAt: string }, projectTimezone: string) {
  const confirmed = new Date(input.confirmedAt);
  if (confirmed.getTime() - Date.now() > MAX_FUTURE_CONFIRMATION_MS) {
    throw new AppError('The report is dated in the future. Check the phone clock.', 400, 'CONFIRMED_AT_IN_FUTURE');
  }
  const expected = calendarDateInTimeZone(confirmed, projectTimezone);
  if (input.workdayDate !== expected) {
    throw new AppError(
      `The reporting day must be ${expected} (project time zone ${projectTimezone}).`,
      400,
      'WORKDAY_DATE_MISMATCH',
      { expectedWorkdayDate: expected, projectTimezone }
    );
  }
}

async function loadSessionForReport(sessionId: string) {
  return prisma.fieldAgentSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: {
      projectContractorId: true,
      assuranceStatus: true,
      agentFullName: true,
      devicePublicKey: true,
      devicePublicKeyAlg: true,
    },
  });
}

function assertTimezone(tz: string) {
  if (!isValidTimeZone(tz)) {
    throw new AppError('reporterTimezone must be an IANA time zone, e.g. Africa/Lagos', 400, 'INVALID_TIMEZONE');
  }
}

/**
 * POST /projects/:projectId/workday-reports
 *
 * Idempotent on clientReportId. The assurance gate is enforced here: a reporter whose identity is
 * not approved gets STAGED_UNVERIFIED and no AI call; the server releases the report on approval.
 * The omission check runs after the response.
 */
export async function submitWorkdayReport(params: {
  projectId: string;
  fieldAgent: FieldAgentJwtPayload;
  input: SubmitWorkdayReportRequest;
}): Promise<SubmitResult> {
  const { projectId, fieldAgent, input } = params;

  const replay = await findReportForReplay(input.clientReportId, fieldAgent.sessionId);
  if (replay) return { report: replay, created: false };
  await assertFieldReportingAllowed(projectId, fieldAgent.fieldPersonaType);

  assertTimezone(input.reporterTimezone);
  const [project, boqItem, session] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { ...CADENCE_PROJECT_SELECT, ...GEOFENCE_CONTEXT_SELECT } }),
    loadBoqItemInProject(prisma, projectId, input.wbsItemId),
    loadSessionForReport(fieldAgent.sessionId),
  ]);
  if (input.isHoldPointClaimed && !boqItem.isHoldPoint) {
    throw new AppError('This WBS item is not a hold point', 400, 'HOLD_POINT_NOT_APPLICABLE');
  }
  assertReportingDay(input, project.timezone);
  // Phase 8: the report belongs to the reporting period containing its work day.
  const period = periodKeyForDate(cadenceSettingsForDate(project, input.workdayDate), input.workdayDate);
  const late = lateness(period, new Date(input.confirmedAt));
  await assertNoReportForPeriod({
    projectId,
    sessionId: fieldAgent.sessionId,
    wbsItemId: input.wbsItemId,
    periodStart: period.periodStart,
  });

  const captures = await loadLinkableCaptures({
    projectId,
    sessionId: fieldAgent.sessionId,
    wbsItemId: input.wbsItemId,
    clientCaptureIds: input.clientCaptureIds,
  });
  const geotag = evaluateGeotag(input.submissionGeotag, project);
  const signature = verifyDeviceSignature({
    publicKey: session.devicePublicKey,
    alg: session.devicePublicKeyAlg,
    signature: input.signature,
    message: canonicalReportString({
      clientReportId: input.clientReportId,
      projectId,
      wbsItemId: input.wbsItemId,
      workdayDate: input.workdayDate,
      summaryText: input.summaryText,
      reportedQuantity: input.reportedQuantity,
      unitOfMeasure: input.unitOfMeasure,
      isHoldPointClaimed: input.isHoldPointClaimed,
      clientCaptureIds: input.clientCaptureIds,
      confirmedAt: input.confirmedAt,
    }),
  });

  // Phase 7: with identity assurance off for the project, the gate does not apply.
  const config = await getProcessConfig(projectId);
  const approved = session.assuranceStatus === 'APPROVED' || !config.enableContractorIdentityAssurance;
  const runChecks = config.enableAiOmissionCheck || config.enableAiStandardsCheck;
  const flags = reportFlags(geotag!, signature.flag);

  let created: ReportRow;
  try {
    created = await prisma.$transaction(async (tx) => {
      const accepted = approved ? await acceptedReportState(tx, projectId, null) : null;
      const report = await tx.workdayReport.create({
        data: {
          clientReportId: input.clientReportId,
          projectId,
          reporterSessionId: fieldAgent.sessionId,
          wbsItemId: input.wbsItemId,
          workdayDate: input.workdayDate,
          reportingPeriodStart: period.periodStart,
          reportingPeriodEnd: period.periodEnd,
          dueAt: period.dueAt,
          isLateSubmission: late.isLate,
          lateByMinutes: late.lateByMinutes,
          reporterTimezone: input.reporterTimezone,
          status: accepted?.status ?? 'STAGED_UNVERIFIED',
          approvalChainVersion: accepted?.approvalChainVersion ?? null,
          currentApprovalStep: accepted?.currentApprovalStep ?? 0,
          reporterPersonaType: fieldAgent.fieldPersonaType,
          revisionNumber: 1,
          summaryText: input.summaryText,
          reportedQuantity: input.reportedQuantity,
          unitOfMeasure: input.unitOfMeasure,
          isHoldPointClaimed: input.isHoldPointClaimed,
          delaysOrBlockers: input.delaysOrBlockers ?? null,
          textNotes: input.textNotes as unknown as Prisma.InputJsonValue,
          submissionGeotag: geotag as unknown as Prisma.InputJsonValue,
          geofenceStatus: geotag?.geofenceStatus ?? null,
          deviceSignature: input.signature ?? null,
          signatureVerified: signature.verified,
          integrityFlags: flags as unknown as Prisma.InputJsonValue,
          aiCheckStatus: approved && runChecks ? 'PENDING' : 'SKIPPED',
          humanConfirmedAt: new Date(input.confirmedAt),
        },
      });
      await linkCaptures(tx, report.id, input.wbsItemId, captures.map((c) => c.id));
      // Phase 9: the first counted report on an item marks its actual start.
      if (isCountedStatus(report.status)) await recordItemActualStart(tx, projectId, input.wbsItemId, input.workdayDate);
      await recordReportPing(tx, { projectId, sessionId: fieldAgent.sessionId, wbsItemId: input.wbsItemId, geotag });
      const obligationId = await fulfilObligation(tx, {
        projectId,
        boqItemId: input.wbsItemId,
        scope: reporterScopeFor(fieldAgent.fieldPersonaType, session.projectContractorId),
        periodStart: period.periodStart,
        reportId: report.id,
        isLate: late.isLate,
      });
      if (late.isLate) {
        await recordAuditEvent(tx, {
          projectId,
          actorType: 'FIELD_AGENT',
          actorId: fieldAgent.sessionId,
          actorDisplayName: `${fieldAgent.agentFullName} (${fieldAgent.roleName})`,
          action: 'REPORT_SUBMITTED_LATE',
          summaryText: `WBS ${boqItem.wbsCode} report for ${period.periodStart} to ${period.periodEnd} arrived ${late.lateByMinutes} min after its due time. Accepted and flagged late.`,
          payload: { workdayReportId: report.id, obligationId, dueAt: period.dueAt.toISOString(), lateByMinutes: late.lateByMinutes },
        });
      }
      if (report.status === 'PENDING_APPROVAL' && report.approvalChainVersion !== null) {
        await notifyPendingApproval(tx, {
          projectId,
          reportId: report.id,
          wbsItemId: input.wbsItemId,
          wbsCode: boqItem.wbsCode,
          version: report.approvalChainVersion,
          stepOrder: report.currentApprovalStep,
          reporterName: fieldAgent.agentFullName,
        });
      }

      await recordAuditEvent(tx, {
        projectId,
        actorType: 'FIELD_AGENT',
        actorId: fieldAgent.sessionId,
        actorDisplayName: `${fieldAgent.agentFullName} (${fieldAgent.roleName})`,
        action: 'WORKDAY_REPORT_SUBMITTED',
        summaryText: approved
          ? `Submitted WBS ${boqItem.wbsCode} report for ${input.workdayDate} (${input.reportedQuantity} ${input.unitOfMeasure}, ${captures.length} capture(s))${
              report.status === 'PENDING_APPROVAL' ? '; awaiting approval' : ''
            }.`
          : `Staged WBS ${boqItem.wbsCode} report for ${input.workdayDate}; reporter identity not yet approved.`,
        payload: {
          workdayReportId: report.id,
          clientReportId: input.clientReportId,
          wbsCode: boqItem.wbsCode,
          status: report.status,
          captureCount: captures.length,
          flags,
          signatureVerified: signature.verified,
        },
      });

      return tx.workdayReport.findUniqueOrThrow({ where: { id: report.id }, include: REPORT_INCLUDE });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const again = await findReportForReplay(input.clientReportId, fieldAgent.sessionId);
      if (again) return { report: again, created: false };
      // A concurrent submission for the same period won the race (partial unique index).
      await assertNoReportForPeriod({
        projectId,
        sessionId: fieldAgent.sessionId,
        wbsItemId: input.wbsItemId,
        periodStart: period.periodStart,
      });
    }
    throw error;
  }

  if (created.aiCheckStatus === 'PENDING') scheduleAiOmissionCheck(created.id);
  return { report: await serializeWithApproval(created), created: true };
}

/**
 * One report per reporter, WBS item and period (owner rule, 2026-11-19). Evidence is added to the
 * WBS thread during the period; the report is submitted once at the end. A change after that is a
 * revision answering a query, never a second report.
 */
async function assertNoReportForPeriod(params: {
  projectId: string;
  sessionId: string;
  wbsItemId: string;
  periodStart: string;
}) {
  const existing = await prisma.workdayReport.findFirst({
    where: {
      projectId: params.projectId,
      reporterSessionId: params.sessionId,
      wbsItemId: params.wbsItemId,
      reportingPeriodStart: params.periodStart,
      parentReportId: null,
    },
    select: { id: true },
  });
  if (existing) {
    throw new AppError(
      'You have already submitted your report for this WBS item and period. It can be revised only to answer a query.',
      409,
      'REPORT_ALREADY_SUBMITTED',
      { workdayReportId: existing.id }
    );
  }
}

/** IDs of a report and all its ancestors (the revision chain up to the original). */
async function revisionChainIds(reportId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = reportId;
  while (cursor && !ids.includes(cursor)) {
    ids.push(cursor);
    const row: { parentReportId: string | null } | null = await prisma.workdayReport.findUnique({
      where: { id: cursor },
      select: { parentReportId: true },
    });
    cursor = row?.parentReportId ?? null;
  }
  return ids;
}

/**
 * POST /projects/:projectId/workday-reports/:reportId/revalidate
 *
 * A new revision answering a query, with the same idempotency, ownership and assurance rules as a
 * submission. Omitted fields keep the previous revision's values; the reporter confirms them, the
 * model does not rewrite them. Marks the targeted query RESUBMITTED.
 */
export async function revalidateWorkdayReport(params: {
  projectId: string;
  reportId: string;
  fieldAgent: FieldAgentJwtPayload;
  input: RevalidateWorkdayReportRequest;
}): Promise<SubmitResult> {
  const { projectId, fieldAgent, input } = params;

  const replay = await findReportForReplay(input.clientReportId, fieldAgent.sessionId);
  if (replay) return { report: replay, created: false };
  await assertFieldReportingAllowed(projectId, fieldAgent.fieldPersonaType);

  assertTimezone(input.reporterTimezone);
  const prev = await prisma.workdayReport.findFirst({
    where: { id: params.reportId, projectId },
    include: {
      boqItem: { select: { wbsCode: true, isHoldPoint: true } },
      project: { select: GEOFENCE_CONTEXT_SELECT },
    },
  });
  if (!prev || prev.reporterSessionId !== fieldAgent.sessionId) {
    throw new AppError('Original workday report not found for this project', 404, 'WORKDAY_REPORT_NOT_FOUND');
  }
  const newer = await prisma.workdayReport.findFirst({
    where: { parentReportId: prev.id },
    select: { id: true },
  });
  if (newer) {
    throw new AppError('Revise the latest revision of this report', 409, 'REPORT_SUPERSEDED', {
      workdayReportId: newer.id,
    });
  }

  // A revision is accepted only to answer an OPEN query on this report (any revision of it).
  const chain = await revisionChainIds(prev.id);
  let targetQueryId: string;
  if (input.reportQueryId) {
    const query = await loadReportQueryInProject(prisma, projectId, input.reportQueryId);
    if (
      query.boqItemId !== prev.wbsItemId ||
      (query.workdayReportId !== null && !chain.includes(query.workdayReportId))
    ) {
      throw new AppError('Report query not found', 404, 'REPORT_QUERY_NOT_FOUND');
    }
    if (query.status !== 'OPEN') {
      throw new AppError('This query has already been answered', 409, 'NO_OPEN_QUERY');
    }
    targetQueryId = query.id;
  } else {
    const open = await prisma.reportQuery.findFirst({
      where: { projectId, workdayReportId: { in: chain }, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!open) {
      throw new AppError(
        'This report has no open query. A submitted report can be revised only to answer a query.',
        409,
        'NO_OPEN_QUERY'
      );
    }
    targetQueryId = open.id;
  }

  const isHoldPointClaimed = input.isHoldPointClaimed ?? prev.isHoldPointClaimed;
  if (isHoldPointClaimed && !prev.boqItem.isHoldPoint) {
    throw new AppError('This WBS item is not a hold point', 400, 'HOLD_POINT_NOT_APPLICABLE');
  }
  const summaryText = input.summaryText ?? prev.summaryText;
  const reportedQuantity = input.reportedQuantity ?? Number(prev.reportedQuantity);
  const unitOfMeasure = input.unitOfMeasure ?? prev.unitOfMeasure;

  const [session, captures] = await Promise.all([
    loadSessionForReport(fieldAgent.sessionId),
    loadLinkableCaptures({
      projectId,
      sessionId: fieldAgent.sessionId,
      wbsItemId: prev.wbsItemId,
      clientCaptureIds: input.clientCaptureIds,
    }),
  ]);
  const geotag = evaluateGeotag(input.submissionGeotag, prev.project);
  const signature = verifyDeviceSignature({
    publicKey: session.devicePublicKey,
    alg: session.devicePublicKeyAlg,
    signature: input.signature,
    message: canonicalReportString({
      clientReportId: input.clientReportId,
      projectId,
      wbsItemId: prev.wbsItemId,
      workdayDate: prev.workdayDate,
      summaryText,
      reportedQuantity,
      unitOfMeasure,
      isHoldPointClaimed,
      clientCaptureIds: input.clientCaptureIds,
      confirmedAt: input.confirmedAt,
    }),
  });
  const config = await getProcessConfig(projectId);
  const approved = session.assuranceStatus === 'APPROVED' || !config.enableContractorIdentityAssurance;
  const runChecks = config.enableAiOmissionCheck || config.enableAiStandardsCheck;
  const flags = reportFlags(geotag!, signature.flag);
  if (new Date(input.confirmedAt).getTime() - Date.now() > MAX_FUTURE_CONFIRMATION_MS) {
    throw new AppError('The report is dated in the future. Check the phone clock.', 400, 'CONFIRMED_AT_IN_FUTURE');
  }

  let created: ReportRow;
  try {
    created = await prisma.$transaction(async (tx) => {
      const maxRev = await tx.workdayReport.aggregate({
        where: { projectId, wbsItemId: prev.wbsItemId, workdayDate: prev.workdayDate, reporterSessionId: fieldAgent.sessionId },
        _max: { revisionNumber: true },
      });
      const revisionNumber = (maxRev._max.revisionNumber ?? prev.revisionNumber) + 1;
      // A revision of a report on an approval chain re-enters the same chain version at step 1.
      const accepted = approved ? await acceptedReportState(tx, projectId, prev.approvalChainVersion) : null;

      const report = await tx.workdayReport.create({
        data: {
          clientReportId: input.clientReportId,
          projectId,
          reporterSessionId: fieldAgent.sessionId,
          wbsItemId: prev.wbsItemId,
          workdayDate: prev.workdayDate,
          // A revision answers a query on the same period; lateness stays the original's.
          reportingPeriodStart: prev.reportingPeriodStart,
          reportingPeriodEnd: prev.reportingPeriodEnd,
          dueAt: prev.dueAt,
          isLateSubmission: prev.isLateSubmission,
          lateByMinutes: prev.lateByMinutes,
          reporterTimezone: input.reporterTimezone,
          status: accepted?.status ?? 'STAGED_UNVERIFIED',
          approvalChainVersion: accepted?.approvalChainVersion ?? prev.approvalChainVersion,
          currentApprovalStep: accepted?.currentApprovalStep ?? 0,
          reporterPersonaType: fieldAgent.fieldPersonaType,
          revisionNumber,
          parentReportId: prev.id,
          resolvedQueryId: targetQueryId,
          summaryText,
          reportedQuantity,
          unitOfMeasure,
          isHoldPointClaimed,
          delaysOrBlockers: input.delaysOrBlockers ?? prev.delaysOrBlockers,
          textNotes: input.textNotes as unknown as Prisma.InputJsonValue,
          submissionGeotag: geotag as unknown as Prisma.InputJsonValue,
          geofenceStatus: geotag?.geofenceStatus ?? null,
          deviceSignature: input.signature ?? null,
          signatureVerified: signature.verified,
          integrityFlags: flags as unknown as Prisma.InputJsonValue,
          aiCheckStatus: approved && runChecks ? 'PENDING' : 'SKIPPED',
          humanConfirmedAt: new Date(input.confirmedAt),
        },
      });
      await linkCaptures(tx, report.id, prev.wbsItemId, captures.map((c) => c.id));
      if (isCountedStatus(report.status)) await recordItemActualStart(tx, projectId, prev.wbsItemId, report.workdayDate);
      await recordReportPing(tx, { projectId, sessionId: fieldAgent.sessionId, wbsItemId: prev.wbsItemId, geotag });
      if (report.status === 'PENDING_APPROVAL' && report.approvalChainVersion !== null) {
        await notifyPendingApproval(tx, {
          projectId,
          reportId: report.id,
          wbsItemId: prev.wbsItemId,
          wbsCode: prev.boqItem.wbsCode,
          version: report.approvalChainVersion,
          stepOrder: report.currentApprovalStep,
          reporterName: fieldAgent.agentFullName,
        });
      }

      await tx.wbsChatMessage.create({
        data: {
          projectId,
          boqItemId: prev.wbsItemId,
          workdayReportId: report.id,
          reportQueryId: targetQueryId,
          fieldSessionId: fieldAgent.sessionId,
          senderSessionId: fieldAgent.sessionId,
          senderName: fieldAgent.agentFullName,
          senderRole: 'ENGINEER',
          messageType: 'QUERY_RESPONSE',
          textContent: `Re-submitted report (Rev #${revisionNumber}): ${summaryText}`,
        },
      });

      await tx.reportQuery.update({
        where: { id: targetQueryId },
        data: { status: 'RESUBMITTED', respondedAt: new Date() },
      });
      const answered = await tx.mobileNotification.findMany({
        where: {
          projectId,
          fieldSessionId: fieldAgent.sessionId,
          type: 'REPORT_QUERY',
          metadata: { path: ['reportQueryId'], equals: targetQueryId },
        },
        select: { id: true },
      });
      await markNotificationsReadForSession(tx, fieldAgent.sessionId, answered.map((n) => n.id));
      await markNotificationsActioned(tx, projectId, { kind: 'REPORT_QUERY_ANSWERED', reportQueryId: targetQueryId }, {
        sessionId: fieldAgent.sessionId,
        name: fieldAgent.agentFullName,
      });

      await createWebNotification(tx, {
        projectId,
        targetPermissionKey: 'reports:view_all',
        category: 'REPORT_RESUBMITTED',
        title: `Report Resubmitted · WBS ${prev.boqItem.wbsCode} (Rev #${revisionNumber})`,
        description: `${fieldAgent.agentFullName} resubmitted WBS ${prev.boqItem.wbsCode} (${reportedQuantity} ${unitOfMeasure}) with ${captures.length} new capture(s).`,
        actionUrl: `/app/projects/${projectId}/audit?tab=presence&wbsItemId=${prev.wbsItemId}&reportId=${report.id}`,
        metadata: {
          wbsItemId: prev.wbsItemId,
          wbsCode: prev.boqItem.wbsCode,
          workdayReportId: report.id,
          parentReportId: prev.id,
          revisionNumber,
          reportQueryId: targetQueryId,
        },
      });

      await recordAuditEvent(tx, {
        projectId,
        actorType: 'FIELD_AGENT',
        actorId: fieldAgent.sessionId,
        actorDisplayName: `${fieldAgent.agentFullName} (${fieldAgent.roleName})`,
        action: 'CONTRACTOR_QUERY_RESPONDED',
        summaryText: `Re-submitted WBS ${prev.boqItem.wbsCode} report (Rev #${revisionNumber}) with ${captures.length} new capture(s).`,
        payload: {
          workdayReportId: report.id,
          parentReportId: prev.id,
          revisionNumber,
          resolvedQueryId: targetQueryId,
          signatureVerified: signature.verified,
          flags,
        },
      });

      return tx.workdayReport.findUniqueOrThrow({ where: { id: report.id }, include: REPORT_INCLUDE });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const again = await findReportForReplay(input.clientReportId, fieldAgent.sessionId);
      if (again) return { report: again, created: false };
    }
    throw error;
  }

  if (created.aiCheckStatus === 'PENDING') scheduleAiOmissionCheck(created.id);
  return { report: await serializeWithApproval(created), created: true };
}

/**
 * Releases a session's staged reports when its identity assurance is approved. Called inside the
 * approval transaction; returns the released IDs so the caller can schedule their checks. With
 * report approval on, released reports enter the approval chain.
 */
export async function releaseStagedReportsForSession(
  tx: Tx,
  params: { projectId: string; sessionId: string }
): Promise<string[]> {
  const staged = await tx.workdayReport.findMany({
    where: { projectId: params.projectId, reporterSessionId: params.sessionId, status: 'STAGED_UNVERIFIED' },
    select: { id: true, approvalChainVersion: true, wbsItemId: true, workdayDate: true },
  });
  if (staged.length === 0) return [];
  const config = await getProcessConfig(params.projectId, tx);
  const checks = config.enableAiOmissionCheck || config.enableAiStandardsCheck;
  const now = new Date();
  for (const r of staged) {
    const accepted = await acceptedReportState(tx, params.projectId, r.approvalChainVersion);
    await tx.workdayReport.update({
      where: { id: r.id },
      data: {
        status: accepted.status,
        approvalChainVersion: accepted.approvalChainVersion,
        currentApprovalStep: accepted.currentApprovalStep,
        releasedAt: now,
        aiCheckStatus: checks ? 'PENDING' : 'SKIPPED',
      },
    });
    if (isCountedStatus(accepted.status)) await recordItemActualStart(tx, params.projectId, r.wbsItemId, r.workdayDate);
  }
  return checks ? staged.map((r) => r.id) : [];
}

/**
 * POST /projects/:projectId/workday-reports/:reportId/review (Phase 7)
 *
 * Acts on the current step of the report's approval chain. APPROVE advances to the next step or
 * completes (APPROVED_COMPLETED, which then counts as evidence). RETURN sends the report back with
 * a query to the reporter; the revision re-enters the chain at step 1.
 */
export async function reviewWorkdayReport(params: {
  projectId: string;
  reportId: string;
  webUser: WebJwtPayload;
  input: ReviewWorkdayReportRequest;
}): Promise<WorkdayReportDto> {
  const { projectId, reportId, webUser, input } = params;
  await prisma.$transaction(async (tx) => {
    const exists = await tx.workdayReport.findFirst({ where: { id: reportId, projectId }, select: { id: true } });
    if (!exists) throw new AppError('Workday report not found', 404, 'WORKDAY_REPORT_NOT_FOUND');
    await tx.$queryRaw`SELECT id FROM "workday_reports" WHERE id = ${reportId}::uuid FOR UPDATE`;
    const report = await tx.workdayReport.findUniqueOrThrow({
      where: { id: reportId },
      include: {
        boqItem: { select: { wbsCode: true } },
        reporterSession: { select: { userId: true, agentFullName: true } },
      },
    });
    if (report.status !== 'PENDING_APPROVAL' || report.approvalChainVersion === null) {
      throw new AppError('This report is not waiting for approval', 409, 'REPORT_NOT_PENDING_APPROVAL', { status: report.status });
    }
    const newer = await tx.workdayReport.findFirst({ where: { parentReportId: report.id }, select: { id: true } });
    if (newer) {
      throw new AppError('A newer revision of this report exists; review that one', 409, 'REPORT_SUPERSEDED', {
        workdayReportId: newer.id,
      });
    }

    const steps = await getChainVersionSteps(tx, projectId, 'REPORT', report.approvalChainVersion);
    const step = steps.find((s) => s.stepOrder === report.currentApprovalStep) ?? null;
    const actions = await loadActions(tx, 'WORKDAY_REPORT', report.id);
    assertMayAct(
      gateForStep({
        webUser,
        step,
        actions,
        orgContext: await orgContextForStep(tx, projectId, step),
        excludedUserId: report.reporterSession.userId,
        excludedReason: 'You submitted this report, so someone else must review it.',
      }),
      step
    );

    await recordApprovalAction(tx, {
      projectId,
      chainType: 'REPORT',
      subjectType: 'WORKDAY_REPORT',
      subjectId: report.id,
      step: step!,
      decision: input.decision,
      actorUserId: webUser.userId,
      notes: input.notes ?? null,
    });
    const actorDisplayName = `${webUser.fullName} (${webUser.roleName})`;

    if (input.decision === 'RETURN') {
      await tx.workdayReport.update({
        where: { id: report.id },
        data: { status: 'RETURNED_FOR_REVISION', currentApprovalStep: 0 },
      });
      await dispatchReportQueryBundle(tx, {
        projectId,
        boqItemId: report.wbsItemId,
        wbsCode: report.boqItem.wbsCode,
        workdayReportId: report.id,
        fieldSessionId: report.reporterSessionId,
        source: 'MONITOR',
        monitorComment: `Returned at "${step!.label}": ${input.notes}`,
        raisedByUserId: webUser.userId,
        raisedByName: webUser.fullName,
      });
      await recordAuditEvent(tx, {
        projectId,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName,
        action: 'WORKDAY_REPORT_RETURNED',
        summaryText: `Returned WBS ${report.boqItem.wbsCode} report (${report.workdayDate}, rev ${report.revisionNumber}) at step ${step!.stepOrder} "${step!.label}": ${input.notes}`,
        payload: { workdayReportId: report.id, stepOrder: step!.stepOrder, chainVersion: report.approvalChainVersion, notes: input.notes },
      });
      return;
    }

    const next = nextApplicableStep(steps, step!.stepOrder, null);
    if (next) {
      await tx.workdayReport.update({ where: { id: report.id }, data: { currentApprovalStep: next.stepOrder } });
      await notifyPendingApproval(tx, {
        projectId,
        reportId: report.id,
        wbsItemId: report.wbsItemId,
        wbsCode: report.boqItem.wbsCode,
        version: report.approvalChainVersion,
        stepOrder: next.stepOrder,
        reporterName: report.reporterSession.agentFullName,
      });
      await recordAuditEvent(tx, {
        projectId,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName,
        action: 'APPROVAL_STEP_ACTIONED',
        summaryText: `Approved step ${step!.stepOrder} "${step!.label}" of the WBS ${report.boqItem.wbsCode} report (${report.workdayDate}); now at "${next.label}".`,
        payload: { workdayReportId: report.id, stepOrder: step!.stepOrder, nextStepOrder: next.stepOrder, notes: input.notes ?? null },
      });
      return;
    }

    await tx.workdayReport.update({
      where: { id: report.id },
      data: { status: 'APPROVED_COMPLETED', currentApprovalStep: 0, approvedCompletedAt: new Date() },
    });
    await recordItemActualStart(tx, projectId, report.wbsItemId, report.workdayDate);
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName,
      action: 'WORKDAY_REPORT_APPROVED',
      summaryText: `Approved WBS ${report.boqItem.wbsCode} report (${report.workdayDate}, rev ${report.revisionNumber}) at the final step "${step!.label}". It now counts as evidence.`,
      payload: { workdayReportId: report.id, stepOrder: step!.stepOrder, chainVersion: report.approvalChainVersion, notes: input.notes ?? null },
    });
  });

  const row = await prisma.workdayReport.findUniqueOrThrow({ where: { id: reportId }, include: REPORT_INCLUDE_WITH_QUERIES });
  return serializeWithApproval(row, webUser);
}

export async function listProjectWorkdayReports(params: {
  projectId: string;
  workdayDate?: string;
  reporterSessionId?: string;
  /** Provisioned account: its reports from every session (device) on this project. */
  reporterUserId?: string | null;
  /** Web viewer: approval positions say whether they may act. */
  viewer?: WebJwtPayload | null;
  /** Phase 7 review queue filter. */
  status?: string;
  /** Phase 8: reports of one reporting period. */
  periodStart?: string;
  lateOnly?: boolean;
}): Promise<WorkdayReportDto[]> {
  const where: Prisma.WorkdayReportWhereInput = { projectId: params.projectId };
  if (params.reporterUserId) where.reporterSession = { userId: params.reporterUserId };
  else if (params.reporterSessionId) where.reporterSessionId = params.reporterSessionId;
  if (params.workdayDate) where.workdayDate = params.workdayDate;
  if (params.status) where.status = params.status as Prisma.WorkdayReportWhereInput['status'];
  if (params.periodStart) where.reportingPeriodStart = params.periodStart;
  if (params.lateOnly) where.isLateSubmission = true;

  const rows = await prisma.workdayReport.findMany({
    where,
    include: REPORT_INCLUDE_WITH_QUERIES,
    orderBy: [{ createdAt: 'desc' }, { revisionNumber: 'desc' }],
    take: 150,
  });
  return Promise.all(rows.map((r) => serializeWithApproval(r, params.viewer ?? null)));
}

/**
 * POST /projects/:projectId/workday-reports/suggest
 *
 * Optional assist for the summary sheet. Transcribes the reporter's own voice captures if a speech
 * provider is configured, then suggests a summary and quantity. Never stored as evidence. With no
 * provider, transcripts stay PENDING and no text is invented.
 */
export async function suggestWorkdaySummary(params: {
  projectId: string;
  fieldAgent: FieldAgentJwtPayload;
  input: SuggestWorkdaySummaryRequest;
}): Promise<SuggestWorkdaySummaryResponse> {
  const { projectId, fieldAgent, input } = params;
  const boqItem = await loadBoqItemInProject(prisma, projectId, input.wbsItemId);

  const captures = input.clientCaptureIds.length
    ? await prisma.fieldEvidenceLog.findMany({
        where: {
          clientCaptureId: { in: input.clientCaptureIds },
          projectId,
          fieldSessionId: fieldAgent.sessionId,
        },
        include: { mediaAttachments: true },
      })
    : [];

  const transcripts: SuggestWorkdaySummaryResponse['transcripts'] = [];
  for (const c of captures) {
    const media = c.mediaAttachments[0];
    if (!media || media.mediaType !== 'VOICE_NOTE') continue;
    if (c.transcriptionStatus === 'DONE') {
      transcripts.push({
        clientCaptureId: c.clientCaptureId,
        transcriptionStatus: 'DONE',
        transcript: c.transcript,
        engine: c.transcriptionEngine,
      });
      continue;
    }
    const bytes = whisperService.isConfigured() ? await storageService.getObjectBuffer(media.objectKey) : null;
    const result = await whisperService.transcribeAudio({ audioBuffer: bytes, mimeType: media.mimeType });
    const status = result.status === 'UNAVAILABLE' ? 'PENDING' : result.status;
    // A simulated demo transcript is shown to the reporter but never stored on the capture.
    if (result.engine !== 'SIMULATED_DEMO') {
      await prisma.fieldEvidenceLog.update({
        where: { id: c.id },
        data: { transcriptionStatus: status, transcript: result.transcript, transcriptionEngine: result.engine },
      });
    }
    transcripts.push({
      clientCaptureId: c.clientCaptureId,
      transcriptionStatus: status,
      transcript: result.transcript,
      engine: result.engine,
    });
  }

  const text = [
    ...transcripts.map((t) => t.transcript).filter((t): t is string => Boolean(t)),
    ...input.textNotes.filter((t) => t.trim().length > 0),
  ].join('\n');
  if (!text.trim()) {
    const waitingOnSpeech = transcripts.some((t) => t.transcriptionStatus === 'PENDING');
    return {
      transcripts,
      suggestion: null,
      unavailableReason: waitingOnSpeech
        ? 'Voice notes cannot be transcribed right now. Type the summary yourself.'
        : 'Nothing to summarise yet. Add a note or type the summary yourself.',
    };
  }

  const { extraction, engine } = await azureOpenAiService.extractFieldNoteFromTranscript({
    rawTranscriptOrNote: text,
    projectBoqItems: [{ wbsCode: boqItem.wbsCode, description: boqItem.description, unit: boqItem.unit }],
  });
  const usedSimulated = transcripts.some((t) => t.engine === 'SIMULATED_DEMO');
  return {
    transcripts,
    suggestion: {
      summary: extraction.normalizedSummary,
      quantities: extraction.extractedQuantities,
      blockers: extraction.siteBlockers,
      engine: usedSimulated && env.DEMO_MODE ? 'SIMULATED_DEMO' : engine,
    },
    unavailableReason: null,
  };
}
