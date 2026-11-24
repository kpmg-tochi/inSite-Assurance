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
  isFailedAnswer,
  RaiseInspectionFindingRequest,
  RaiseVisitFindingRequest,
  ResolveInspectionFindingRequest,
  VisitFormAnswer,
  VisitFormSnapshotSchema,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { FieldAgentJwtPayload, WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { toCaptureSummary } from '../workday-reports/workdayReports.service';
import { parseSections } from '../inspections/checklistTemplates.service';

/**
 * Findings (Phase 14, generalised in redesign R4d). A finding is raised against the project's
 * contractor from a failed Phase 14 checklist item (legacy, until R5) or from a visit answer that a
 * form rule flags (R3 `findingsToRaise`). Staff-only (R1d): staff with `inspections:manage_findings`
 * resolve or dismiss them; open findings are re-checked on the next visits (re-check items in the
 * frozen form) and resolve when an accepted visit answers "resolved" with a photo. The model keeps its
 * Phase 14 table and name until R7.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;
const MANAGE = 'inspections:manage_findings';

export const FINDING_INCLUDE = {
  inspection: { select: { visitType: true, visitDate: true, template: { select: { sectionsJson: true } } } },
  projectContractor: { select: { organization: { select: { id: true, name: true } } } },
  project: { select: { timezone: true } },
} satisfies Prisma.InspectionFindingInclude;
type FindingRow = Prisma.InspectionFindingGetPayload<{ include: typeof FINDING_INCLUDE }>;

export interface FindingViewer {
  label: string;
  userId: string | null;
  canManage: boolean;
  channel: 'web' | 'field';
  sessionId?: string;
}

export async function findingViewerFor(
  _projectId: string,
  principal: { webUser?: WebJwtPayload; fieldAgent?: FieldAgentJwtPayload }
): Promise<FindingViewer> {
  if (principal.webUser) {
    const u = principal.webUser;
    return {
      label: `${u.fullName} (${u.roleName})`,
      userId: u.userId,
      canManage: u.permissions.includes(MANAGE) || u.isPlatformSuperAdmin,
      channel: 'web',
    };
  }
  const f = principal.fieldAgent!;
  return {
    label: `${f.agentFullName} (${f.roleName}, field)`,
    userId: f.userId,
    canManage: f.permissions.includes(MANAGE),
    channel: 'field',
    sessionId: f.sessionId,
  };
}

/** Names for visit findings, loaded once per list. */
interface FindingNames {
  visits: Map<string, { visitKind: string; plannedDate: string }>;
  facilities: Map<string, string>;
  units: Map<string, string>;
}

async function loadNames(rows: FindingRow[]): Promise<FindingNames> {
  const visitIds = [...new Set(rows.map((r) => r.visitId).filter((id): id is string => Boolean(id)))];
  const facilityIds = [...new Set(rows.map((r) => r.facilityId).filter((id): id is string => Boolean(id)))];
  const unitIds = [...new Set(rows.map((r) => r.facilityUnitId).filter((id): id is string => Boolean(id)))];
  const [visits, facilities, units] = await Promise.all([
    visitIds.length ? prisma.visit.findMany({ where: { id: { in: visitIds } }, select: { id: true, visitKind: true, plannedDate: true } }) : [],
    facilityIds.length ? prisma.facility.findMany({ where: { id: { in: facilityIds } }, select: { id: true, name: true } }) : [],
    unitIds.length ? prisma.facilityUnit.findMany({ where: { id: { in: unitIds } }, select: { id: true, label: true } }) : [],
  ]);
  return {
    visits: new Map(visits.map((v) => [v.id, v])),
    facilities: new Map(facilities.map((f) => [f.id, f.name])),
    units: new Map(units.map((u) => [u.id, u.label])),
  };
}

export async function serializeFinding(f: FindingRow, viewer: FindingViewer | null, sections?: ChecklistSections, names?: FindingNames): Promise<InspectionFindingDto> {
  const n = names ?? (await loadNames([f]));
  let title = f.title ?? f.checklistItemKey;
  if (f.inspection && !f.title) {
    const items = allChecklistItems(sections ?? parseSections(f.inspection.template.sectionsJson));
    title = items.find((i) => i.key === f.checklistItemKey)?.label ?? f.checklistItemKey;
  }
  const visit = f.visitId ? n.visits.get(f.visitId) : undefined;
  const captures = f.resolutionCaptureIds.length
    ? await prisma.fieldEvidenceLog.findMany({ where: { id: { in: f.resolutionCaptureIds } }, include: { mediaAttachments: true } })
    : [];
  const open = f.status === 'OPEN';
  return {
    id: f.id,
    projectId: f.projectId,
    source: f.inspectionId ? 'INSPECTION' : 'VISIT',
    inspectionId: f.inspectionId,
    inspectionVisitType: f.inspection?.visitType ?? null,
    inspectionVisitDate: f.inspection?.visitDate ?? visit?.plannedDate ?? zonedCalendarDate(f.createdAt, f.project.timezone),
    visitId: f.visitId,
    visitSubmissionId: f.visitSubmissionId,
    visitKind: visit?.visitKind ?? null,
    facilityId: f.facilityId,
    facilityName: f.facilityId ? (n.facilities.get(f.facilityId) ?? null) : null,
    facilityUnitId: f.facilityUnitId,
    unitLabel: f.facilityUnitId ? (n.units.get(f.facilityUnitId) ?? null) : null,
    questionKey: f.questionKey,
    title,
    recheckCount: f.recheckCount,
    lastRecheckedAt: f.lastRecheckedAt?.toISOString() ?? null,
    escalatedAt: f.escalatedAt?.toISOString() ?? null,
    checklistItemKey: f.checklistItemKey,
    checklistItemLabel: title,
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
    canResolve: Boolean(viewer && open && viewer.canManage),
    canDismiss: Boolean(viewer && open && viewer.canManage),
  };
}

/** The project's contractor (one per project, decision T); the earliest under contract if several remain. */
export async function defaultContractorId(db: Db, projectId: string): Promise<string | null> {
  const contractor = await db.projectContractor.findFirst({
    where: { projectId },
    orderBy: [{ contractStatus: 'asc' }, { createdAt: 'asc' }],
    select: { id: true },
  });
  return contractor?.id ?? null;
}

/**
 * Phase 14 (legacy until R5): one OPEN finding per failed item of a new inspection, against the
 * project's contractor. Severity follows the overall finding. Returns the ids.
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
  }
  return ids;
}

async function loadFinding(db: Db, projectId: string, findingId: string): Promise<FindingRow> {
  const f = await db.inspectionFinding.findFirst({ where: { id: findingId, projectId }, include: FINDING_INCLUDE });
  if (!f) throw new AppError('Finding not found', 404, 'FINDING_NOT_FOUND');
  return f;
}

export async function getFindingDto(projectId: string, findingId: string, viewer: FindingViewer | null): Promise<InspectionFindingDto> {
  return serializeFinding(await loadFinding(prisma, projectId, findingId), viewer);
}

export async function listInspectionFindings(params: {
  projectId: string;
  principal: { webUser?: WebJwtPayload; fieldAgent?: FieldAgentJwtPayload };
  status?: string;
  inspectionId?: string;
  visitId?: string;
}): Promise<InspectionFindingDto[]> {
  const viewer = await findingViewerFor(params.projectId, params.principal);
  const where: Prisma.InspectionFindingWhereInput = { projectId: params.projectId };
  if (params.status) where.status = params.status as Prisma.InspectionFindingWhereInput['status'];
  if (params.inspectionId) where.inspectionId = params.inspectionId;
  if (params.visitId) where.visitId = params.visitId;
  const rows = await prisma.inspectionFinding.findMany({ where, include: FINDING_INCLUDE, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 300 });
  const names = await loadNames(rows);
  return Promise.all(rows.map((r) => serializeFinding(r, viewer, undefined, names)));
}

/** Raises a finding by hand from an inspection item. The item must have failed. */
export async function raiseInspectionFinding(params: {
  projectId: string;
  inspectionId: string;
  webUser: WebJwtPayload;
  input: RaiseInspectionFindingRequest;
}): Promise<InspectionFindingDto> {
  const { projectId, inspectionId, webUser, input } = params;
  const viewer = await findingViewerFor(projectId, { webUser });
  if (!viewer.canManage) {
    throw new AppError(`Access requires permission(s): ${MANAGE}`, 403, 'FORBIDDEN_PERMISSION');
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
  return serializeFinding(await loadFinding(prisma, projectId, id), viewer, sections);
}

/**
 * R4d: raises a finding by hand from an answer of a visit submission (any answer; staff judgement).
 * The finding is re-checked on the following visits like a rule-raised one.
 */
export async function raiseVisitFinding(params: {
  projectId: string;
  visitId: string;
  webUser: WebJwtPayload;
  input: RaiseVisitFindingRequest;
  afterRaise?: (tx: Tx) => Promise<void>;
}): Promise<InspectionFindingDto> {
  const { projectId, visitId, webUser, input } = params;
  const viewer = await findingViewerFor(projectId, { webUser });
  if (!viewer.canManage) throw new AppError(`Access requires permission(s): ${MANAGE}`, 403, 'FORBIDDEN_PERMISSION');
  const submission = await prisma.visitSubmission.findFirst({
    where: { id: input.submissionId, visitId, projectId },
    include: { visit: { select: { formSnapshot: { select: { snapshotJson: true } } } } },
  });
  if (!submission) throw new AppError('Submission not found on this visit', 404, 'VISIT_SUBMISSION_NOT_FOUND');
  const snapshotRow = await prisma.visitFormSnapshot.findUnique({ where: { id: submission.formSnapshotId }, select: { snapshotJson: true } });
  const snapshot = VisitFormSnapshotSchema.safeParse(snapshotRow?.snapshotJson);
  if (!snapshot.success) throw new AppError('The visit form cannot be read', 500, 'INVALID_VISIT_FORM_SNAPSHOT');
  const block = snapshot.data.blocks.find((b) => b.fields.some((fl) => fl.path === input.path));
  const field = block?.fields.find((fl) => fl.path === input.path);
  if (!block || !field || field.recheck) throw new AppError('Not a question of this visit form', 422, 'VISIT_QUESTION_NOT_FOUND');
  const answered = ((Array.isArray(submission.answersJson) ? submission.answersJson : []) as VisitFormAnswer[]).some((a) => a.path === input.path);
  if (!answered) throw new AppError('Findings are raised from answered questions', 422, 'VISIT_QUESTION_NOT_ANSWERED');
  const id = await prisma.$transaction(async (tx) => {
    const f = await tx.inspectionFinding.create({
      data: {
        projectId,
        visitId,
        visitSubmissionId: submission.id,
        checklistItemKey: field.key,
        questionKey: field.path,
        title: block.facility ? `${block.facility.name}: ${field.label}` : field.label,
        facilityId: block.facility?.id ?? null,
        facilityUnitId: field.unitId,
        projectContractorId: input.projectContractorId ?? (await defaultContractorId(tx, projectId)),
        description: input.description,
        severity: input.severity,
        raisedByUserId: webUser.userId,
        raisedByName: webUser.fullName,
      },
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: viewer.label,
      action: 'INSPECTION_FINDING_RAISED',
      summaryText: `Raised a ${input.severity.toLowerCase()} finding on "${field.label}": ${input.description}`,
      payload: { inspectionFindingId: f.id, visitId, visitSubmissionId: submission.id, path: field.path },
    });
    if (params.afterRaise) await params.afterRaise(tx);
    return f.id;
  });
  return serializeFinding(await loadFinding(prisma, projectId, id), viewer);
}

/** Resolves a finding with notes and/or photos (registered captures of the caller's session in this project). */
export async function resolveInspectionFinding(params: {
  projectId: string;
  findingId: string;
  principal: { webUser?: WebJwtPayload; fieldAgent?: FieldAgentJwtPayload };
  input: ResolveInspectionFindingRequest;
  afterChange?: (tx: Tx) => Promise<void>;
}): Promise<InspectionFindingDto> {
  const { projectId, findingId, principal, input } = params;
  const viewer = await findingViewerFor(projectId, principal);
  const before = await loadFinding(prisma, projectId, findingId);
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
    if (params.afterChange) await params.afterChange(tx);
  });
  return serializeFinding(await loadFinding(prisma, projectId, findingId), viewer);
}

export async function dismissInspectionFinding(params: {
  projectId: string;
  findingId: string;
  webUser: WebJwtPayload;
  input: DismissInspectionFindingRequest;
  afterChange?: (tx: Tx) => Promise<void>;
}): Promise<InspectionFindingDto> {
  const { projectId, findingId, webUser, input } = params;
  const viewer = await findingViewerFor(projectId, { webUser });
  if (!viewer.canManage) {
    throw new AppError(`Access requires permission(s): ${MANAGE}`, 403, 'FORBIDDEN_PERMISSION');
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
    if (params.afterChange) await params.afterChange(tx);
  });
  return serializeFinding(await loadFinding(prisma, projectId, findingId), viewer);
}
