import { Prisma } from '@prisma/client';
import {
  allChecklistItems,
  ChecklistSections,
  DismissInspectionFindingRequest,
  InspectionAnswer,
  InspectionFindingDto,
  InspectionFindingSeverity,
  InspectionOverallFinding,
  InspectionVisitType,
  INSPECTION_VISIT_TYPE_LABELS,
  isFailedAnswer,
  RaiseInspectionFindingRequest,
  ResolveInspectionFindingRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { FieldAgentJwtPayload, WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { createMobileNotification, createWebNotification } from '../notifications/notifications.service';
import { defectViewerFor } from '../closeout/defects.service';
import { sendPushToFieldSession } from '../../integrations/push.service';
import { toCaptureSummary } from '../workday-reports/workdayReports.service';
import { parseSections } from './checklistTemplates.service';

/**
 * Inspection findings (Phase 14). A failed or low-rated checklist item raises a finding aimed at a
 * contractor (the Phase 10 aimed-notification pattern: web notification for that organisation,
 * mobile notification to sessions bound to that contractor). The contractor resolves it with
 * photos; the monitoring side can also resolve, or dismiss with a reason. Not merged with defects
 * (defects are post-completion).
 *
 * Sides are by organisation, as for defects: a web user whose organisation is a contractor on the
 * project, or a contractor field session, is the contractor side and sees only its own findings.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;
const MANAGE = 'inspections:manage_findings';

export const FINDING_INCLUDE = {
  inspection: { select: { visitType: true, visitDate: true, template: { select: { sectionsJson: true } } } },
  projectContractor: { select: { organization: { select: { id: true, name: true } } } },
} satisfies Prisma.InspectionFindingInclude;
type FindingRow = Prisma.InspectionFindingGetPayload<{ include: typeof FINDING_INCLUDE }>;

export interface FindingViewer {
  kind: 'monitor' | 'contractor';
  contractorId?: string;
  label: string;
  userId: string | null;
  canManage: boolean;
  channel: 'web' | 'field';
  sessionId?: string;
}

export async function findingViewerFor(
  projectId: string,
  principal: { webUser?: WebJwtPayload; fieldAgent?: FieldAgentJwtPayload }
): Promise<FindingViewer> {
  const base = await defectViewerFor(projectId, principal).catch((error) => {
    // A contractor session on a project without contractors sees nothing aimed at it.
    if (error instanceof AppError && error.code === 'NO_CONTRACTOR') return null;
    throw error;
  });
  const permissions = principal.webUser?.permissions ?? principal.fieldAgent?.permissions ?? [];
  const canManage = permissions.includes(MANAGE) || Boolean(principal.webUser?.isPlatformSuperAdmin);
  if (!base) {
    return { kind: 'contractor', contractorId: '00000000-0000-0000-0000-000000000000', label: 'Contractor', userId: null, canManage, channel: 'field', sessionId: principal.fieldAgent?.sessionId };
  }
  return {
    kind: base.kind,
    contractorId: base.kind === 'contractor' ? base.contractorId : undefined,
    label: base.label,
    userId: base.userId,
    canManage,
    channel: base.channel,
    sessionId: principal.fieldAgent?.sessionId,
  };
}

export async function serializeFinding(f: FindingRow, viewer: FindingViewer | null, sections?: ChecklistSections): Promise<InspectionFindingDto> {
  const items = allChecklistItems(sections ?? parseSections(f.inspection.template.sectionsJson));
  const label = items.find((i) => i.key === f.checklistItemKey)?.label ?? f.checklistItemKey;
  const captures = f.resolutionCaptureIds.length
    ? await prisma.fieldEvidenceLog.findMany({ where: { id: { in: f.resolutionCaptureIds } }, include: { mediaAttachments: true } })
    : [];
  const open = f.status === 'OPEN';
  const ownSide = viewer?.kind === 'contractor' ? viewer.contractorId === f.projectContractorId : true;
  return {
    id: f.id,
    projectId: f.projectId,
    inspectionId: f.inspectionId,
    inspectionVisitType: f.inspection.visitType,
    inspectionVisitDate: f.inspection.visitDate,
    checklistItemKey: f.checklistItemKey,
    checklistItemLabel: label,
    projectContractorId: f.projectContractorId,
    contractorName: f.projectContractor?.organization.name ?? null,
    description: f.description,
    severity: f.severity,
    status: f.status,
    resolvedNotes: f.resolvedNotes,
    resolutionCaptures: captures.map((c) => toCaptureSummary(c as Parameters<typeof toCaptureSummary>[0])),
    raisedByName: f.raisedByName,
    resolvedByName: f.resolvedByName,
    createdAt: f.createdAt.toISOString(),
    resolvedAt: f.resolvedAt?.toISOString() ?? null,
    canResolve: Boolean(viewer && open && viewer.canManage && ownSide),
    canDismiss: Boolean(viewer && open && viewer.canManage && viewer.kind === 'monitor'),
  };
}

async function defaultContractorId(db: Db, projectId: string): Promise<string | null> {
  const contractors = await db.projectContractor.findMany({
    where: { projectId },
    orderBy: [{ isMainContractor: 'desc' }, { createdAt: 'asc' }],
    select: { id: true, isMainContractor: true },
  });
  if (contractors.length === 1) return contractors[0].id;
  return contractors.find((c) => c.isMainContractor)?.id ?? null;
}

/** Sessions bound to a contractor (the main contractor also gets project-wide contractor sessions). */
async function contractorSessions(db: Db, projectId: string, contractorId: string): Promise<Array<{ id: string }>> {
  const contractor = await db.projectContractor.findUnique({ where: { id: contractorId }, select: { isMainContractor: true } });
  return db.fieldAgentSession.findMany({
    where: {
      projectId,
      isActive: true,
      fieldPersonaType: 'CONTRACTOR_EXECUTOR',
      OR: [{ projectContractorId: contractorId }, ...(contractor?.isMainContractor ? [{ projectContractorId: null }] : [])],
    },
    select: { id: true },
  });
}

/** Notifies the contractor a finding is aimed at: its web users (by organisation) and its sessions. */
async function notifyContractor(tx: Tx, finding: { id: string; projectId: string; projectContractorId: string | null; description: string; itemLabel: string; visitLabel: string }) {
  if (!finding.projectContractorId) return [] as string[];
  const contractor = await tx.projectContractor.findUnique({ where: { id: finding.projectContractorId }, select: { organizationId: true } });
  if (!contractor) return [];
  await createWebNotification(tx, {
    projectId: finding.projectId,
    targetPermissionKey: 'inspections:view',
    targetOrganizationId: contractor.organizationId,
    category: 'INSPECTION_FINDING',
    title: `Inspection finding · ${finding.itemLabel}`,
    description: `${finding.visitLabel}: ${finding.description}`,
    actionUrl: `/app/projects/${finding.projectId}/inspections?tab=findings&findingId=${finding.id}`,
    metadata: { inspectionFindingId: finding.id },
  });
  const sessions = await contractorSessions(tx, finding.projectId, finding.projectContractorId);
  for (const s of sessions) {
    await createMobileNotification(tx, {
      projectId: finding.projectId,
      fieldSessionId: s.id,
      type: 'INSPECTION_FINDING',
      actionType: 'OPEN_INSPECTION_FINDINGS',
      requiresAction: true,
      title: 'Inspection finding to fix',
      message: `${finding.itemLabel}: ${finding.description}`,
      metadata: { inspectionFindingId: finding.id },
    });
  }
  return sessions.map((s) => s.id);
}

function pushAfterCommit(sessionIds: string[], body: string) {
  for (const id of sessionIds) {
    sendPushToFieldSession(id, {
      title: 'Inspection finding to fix',
      body,
      data: { actionType: 'OPEN_INSPECTION_FINDINGS', type: 'INSPECTION_FINDING' },
    }).catch(() => undefined);
  }
}

/**
 * Raises one OPEN finding per failed item of a new inspection, aimed at the project's contractor
 * (the only one, else the main contractor; monitoring side when neither). Severity follows the
 * overall finding. Returns the finding ids. Notifications go out in the same transaction.
 */
export async function autoRaiseFindingsForInspection(
  tx: Tx,
  params: {
    projectId: string;
    inspectionId: string;
    sections: ChecklistSections;
    answers: InspectionAnswer[];
    failedItemKeys: string[];
    overallFinding: InspectionOverallFinding;
    raisedBy: { userId: string | null; name: string };
    visitType: InspectionVisitType;
  }
): Promise<string[]> {
  if (params.failedItemKeys.length === 0) return [];
  const contractorId = await defaultContractorId(tx, params.projectId);
  const items = new Map(allChecklistItems(params.sections).map((i) => [i.key, i]));
  const severity: InspectionFindingSeverity = params.overallFinding === 'MAJOR_ISSUES' ? 'MAJOR' : 'MINOR';
  const ids: string[] = [];
  const pushed: string[] = [];
  for (const key of params.failedItemKeys) {
    const answer = params.answers.find((a) => a.itemKey === key);
    const item = items.get(key);
    const description = (answer?.comment ?? '').trim() || `${item?.label ?? key} failed`;
    const f = await tx.inspectionFinding.create({
      data: {
        projectId: params.projectId,
        inspectionId: params.inspectionId,
        checklistItemKey: key,
        projectContractorId: contractorId,
        description,
        severity,
        raisedByUserId: params.raisedBy.userId,
        raisedByName: params.raisedBy.name,
      },
    });
    ids.push(f.id);
    pushed.push(
      ...(await notifyContractor(tx, {
        id: f.id,
        projectId: params.projectId,
        projectContractorId: contractorId,
        description,
        itemLabel: item?.label ?? key,
        visitLabel: INSPECTION_VISIT_TYPE_LABELS[params.visitType],
      }))
    );
  }
  setImmediate(() => pushAfterCommit([...new Set(pushed)], 'An inspection found work to fix. Open the app to see it.'));
  return ids;
}

async function loadFinding(db: Db, projectId: string, findingId: string): Promise<FindingRow> {
  const f = await db.inspectionFinding.findFirst({ where: { id: findingId, projectId }, include: FINDING_INCLUDE });
  if (!f) throw new AppError('Finding not found', 404, 'FINDING_NOT_FOUND');
  return f;
}

function assertCanSee(viewer: FindingViewer, f: { projectContractorId: string | null }) {
  if (viewer.kind === 'contractor' && viewer.contractorId !== f.projectContractorId) {
    throw new AppError('Finding not found', 404, 'FINDING_NOT_FOUND');
  }
}

export async function listInspectionFindings(params: {
  projectId: string;
  principal: { webUser?: WebJwtPayload; fieldAgent?: FieldAgentJwtPayload };
  status?: string;
  inspectionId?: string;
}): Promise<InspectionFindingDto[]> {
  const viewer = await findingViewerFor(params.projectId, params.principal);
  const where: Prisma.InspectionFindingWhereInput = { projectId: params.projectId };
  if (params.status) where.status = params.status as Prisma.InspectionFindingWhereInput['status'];
  if (params.inspectionId) where.inspectionId = params.inspectionId;
  if (viewer.kind === 'contractor') where.projectContractorId = viewer.contractorId;
  const rows = await prisma.inspectionFinding.findMany({ where, include: FINDING_INCLUDE, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 300 });
  return Promise.all(rows.map((r) => serializeFinding(r, viewer)));
}

/** Raises a finding by hand from an inspection item (monitoring side). The item must have failed. */
export async function raiseInspectionFinding(params: {
  projectId: string;
  inspectionId: string;
  webUser: WebJwtPayload;
  input: RaiseInspectionFindingRequest;
}): Promise<InspectionFindingDto> {
  const { projectId, inspectionId, webUser, input } = params;
  const viewer = await findingViewerFor(projectId, { webUser });
  if (viewer.kind !== 'monitor' || !viewer.canManage) {
    throw new AppError('Only the monitoring side raises inspection findings', 403, 'FORBIDDEN_PERMISSION');
  }
  const inspection = await prisma.siteInspectionReport.findFirst({
    where: { id: inspectionId, projectId },
    select: { id: true, visitType: true, answersJson: true, template: { select: { sectionsJson: true } } },
  });
  if (!inspection) throw new AppError('Inspection not found', 404, 'INSPECTION_NOT_FOUND');
  const sections = parseSections(inspection.template.sectionsJson);
  const item = allChecklistItems(sections).find((i) => i.key === input.checklistItemKey);
  if (!item) throw new AppError('Not an item of this inspection', 422, 'CHECKLIST_ITEM_NOT_FOUND');
  const answer = (inspection.answersJson as InspectionAnswer[]).find((a) => a.itemKey === item.key);
  if (!answer || !isFailedAnswer(item, answer.value)) {
    throw new AppError('Findings are raised from failed or low-rated items', 422, 'FINDING_ITEM_NOT_FAILED');
  }
  if (input.projectContractorId) {
    const c = await prisma.projectContractor.findFirst({ where: { id: input.projectContractorId, projectId }, select: { id: true } });
    if (!c) throw new AppError('Contractor not found on this project', 404, 'CONTRACTOR_NOT_FOUND');
  }
  let pushed: string[] = [];
  const id = await prisma.$transaction(async (tx) => {
    const f = await tx.inspectionFinding.create({
      data: {
        projectId,
        inspectionId,
        checklistItemKey: item.key,
        projectContractorId: input.projectContractorId,
        description: input.description,
        severity: input.severity,
        raisedByUserId: webUser.userId,
        raisedByName: webUser.fullName,
      },
    });
    pushed = await notifyContractor(tx, {
      id: f.id,
      projectId,
      projectContractorId: input.projectContractorId,
      description: input.description,
      itemLabel: item.label,
      visitLabel: INSPECTION_VISIT_TYPE_LABELS[inspection.visitType],
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: viewer.label,
      action: 'INSPECTION_FINDING_RAISED',
      summaryText: `Raised a ${input.severity.toLowerCase()} finding on "${item.label}": ${input.description}`,
      payload: { inspectionFindingId: f.id, inspectionId, checklistItemKey: item.key, projectContractorId: input.projectContractorId },
    });
    return f.id;
  });
  pushAfterCommit(pushed, `${item.label}: ${input.description}`);
  return serializeFinding(await loadFinding(prisma, projectId, id), viewer, sections);
}

/**
 * Resolves a finding with notes and/or photos. Contractor side: its own findings only. Photos are
 * registered captures of the caller's session in this project.
 */
export async function resolveInspectionFinding(params: {
  projectId: string;
  findingId: string;
  principal: { webUser?: WebJwtPayload; fieldAgent?: FieldAgentJwtPayload };
  input: ResolveInspectionFindingRequest;
}): Promise<InspectionFindingDto> {
  const { projectId, findingId, principal, input } = params;
  const viewer = await findingViewerFor(projectId, principal);
  const before = await loadFinding(prisma, projectId, findingId);
  assertCanSee(viewer, before);
  if (!viewer.canManage) throw new AppError(`Access requires permission(s): ${MANAGE}`, 403, 'FORBIDDEN_PERMISSION');
  let captureIds: string[] = [];
  if (input.clientCaptureIds.length) {
    if (!principal.fieldAgent) {
      throw new AppError('Photos are taken with the mobile app', 400, 'CAPTURES_NEED_FIELD_APP');
    }
    const captures = await prisma.fieldEvidenceLog.findMany({
      where: { clientCaptureId: { in: input.clientCaptureIds } },
      select: { id: true, clientCaptureId: true, projectId: true, fieldSessionId: true },
    });
    const missing = input.clientCaptureIds.filter((id) => !captures.some((c) => c.clientCaptureId === id));
    if (missing.length) throw new AppError('Some captures are not registered yet', 409, 'CAPTURES_NOT_REGISTERED', { missingClientCaptureIds: missing });
    for (const c of captures) {
      if (c.projectId !== projectId) throw new AppError('A photo belongs to another project', 403, 'CAPTURE_OTHER_PROJECT');
      if (c.fieldSessionId !== principal.fieldAgent.sessionId) throw new AppError('A capture does not belong to you', 403, 'CAPTURE_NOT_OWNED');
    }
    captureIds = captures.map((c) => c.id);
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.inspectionFinding.updateMany({
      where: { id: findingId, status: 'OPEN' },
      data: {
        status: 'RESOLVED',
        resolvedNotes: input.notes || null,
        resolutionCaptureIds: captureIds,
        resolvedByUserId: viewer.userId,
        resolvedByName: viewer.label,
        resolvedAt: new Date(),
      },
    });
    if (updated.count === 0) throw new AppError('This finding is not open', 409, 'FINDING_NOT_OPEN');
    await recordAuditEvent(tx, {
      projectId,
      actorType: principal.webUser ? 'WEB_USER' : 'FIELD_AGENT',
      actorId: principal.webUser?.userId ?? principal.fieldAgent!.sessionId,
      actorDisplayName: viewer.label,
      action: 'INSPECTION_FINDING_RESOLVED',
      summaryText: `Resolved the finding "${before.description}" (${captureIds.length} photo(s))${input.notes ? `: ${input.notes}` : ''}.`,
      payload: { inspectionFindingId: findingId, outcome: 'RESOLVED', captureIds, notes: input.notes || null },
    });
    if (viewer.kind === 'contractor') {
      await createWebNotification(tx, {
        projectId,
        targetPermissionKey: MANAGE,
        category: 'INSPECTION_FINDING',
        title: 'Inspection finding resolved by the contractor',
        description: `${before.projectContractor?.organization.name ?? 'The contractor'} resolved: ${before.description}`,
        actionUrl: `/app/projects/${projectId}/inspections?tab=findings&findingId=${findingId}`,
        metadata: { inspectionFindingId: findingId },
        hideFromProjectContractors: true,
      });
    }
  });
  return serializeFinding(await loadFinding(prisma, projectId, findingId), viewer);
}

export async function dismissInspectionFinding(params: {
  projectId: string;
  findingId: string;
  webUser: WebJwtPayload;
  input: DismissInspectionFindingRequest;
}): Promise<InspectionFindingDto> {
  const { projectId, findingId, webUser, input } = params;
  const viewer = await findingViewerFor(projectId, { webUser });
  if (viewer.kind !== 'monitor' || !viewer.canManage) {
    throw new AppError('Only the monitoring side dismisses inspection findings', 403, 'FORBIDDEN_PERMISSION');
  }
  const before = await loadFinding(prisma, projectId, findingId);
  await prisma.$transaction(async (tx) => {
    const updated = await tx.inspectionFinding.updateMany({
      where: { id: findingId, status: 'OPEN' },
      data: { status: 'DISMISSED', resolvedNotes: input.reason, resolvedByUserId: webUser.userId, resolvedByName: viewer.label, resolvedAt: new Date() },
    });
    if (updated.count === 0) throw new AppError('This finding is not open', 409, 'FINDING_NOT_OPEN');
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: viewer.label,
      action: 'INSPECTION_FINDING_RESOLVED',
      summaryText: `Dismissed the finding "${before.description}": ${input.reason}`,
      payload: { inspectionFindingId: findingId, outcome: 'DISMISSED', reason: input.reason },
    });
  });
  return serializeFinding(await loadFinding(prisma, projectId, findingId), viewer);
}
