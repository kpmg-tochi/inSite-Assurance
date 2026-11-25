import { Prisma } from '@prisma/client';
import {
  DismissInspectionFindingRequest,
  InspectionFindingDto,
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
import { toCaptureSummary } from '../../utils/serializers';

/**
 * Findings (Phase 14, generalised in redesign R4d). A finding is raised against the project's
 * contractor from a visit answer that a form rule flags (R3 `findingsToRaise`) or by hand from a visit
 * answer (R5f deleted the Phase 14 inspections and their findings). Staff-only (R1d): staff with
 * `findings:manage` resolve or dismiss them on the web; open findings are re-checked on the next visits (re-check items in the
 * frozen form) and resolve when an accepted visit answers "resolved" with a photo. The model keeps its
 * Phase 14 table and name until R7.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;
const MANAGE = 'findings:manage';

export const FINDING_INCLUDE = {
  projectContractor: { select: { organization: { select: { id: true, name: true } } } },
  project: { select: { timezone: true } },
} satisfies Prisma.FindingInclude;
export type FindingRow = Prisma.FindingGetPayload<{ include: typeof FINDING_INCLUDE }>;

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

/** Names for visit findings, loaded once per list (also used by the findings export). */
export interface FindingNames {
  visits: Map<string, { visitKind: string; plannedDate: string }>;
  facilities: Map<string, string>;
  units: Map<string, string>;
}

export async function loadNames(rows: FindingRow[]): Promise<FindingNames> {
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

export async function serializeFinding(f: FindingRow, viewer: FindingViewer | null, names?: FindingNames): Promise<InspectionFindingDto> {
  const n = names ?? (await loadNames([f]));
  const title = f.title ?? f.checklistItemKey;
  const visit = f.visitId ? n.visits.get(f.visitId) : undefined;
  const captures = f.resolutionCaptureIds.length
    ? await prisma.fieldEvidenceLog.findMany({ where: { id: { in: f.resolutionCaptureIds } }, include: { mediaAttachments: true } })
    : [];
  const open = f.status === 'OPEN';
  return {
    id: f.id,
    projectId: f.projectId,
    inspectionVisitDate: visit?.plannedDate ?? zonedCalendarDate(f.createdAt, f.project.timezone),
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
    resolutionCaptures: captures.map((c) => toCaptureSummary(c)),
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

async function loadFinding(db: Db, projectId: string, findingId: string): Promise<FindingRow> {
  const f = await db.finding.findFirst({ where: { id: findingId, projectId }, include: FINDING_INCLUDE });
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
  visitId?: string;
}): Promise<InspectionFindingDto[]> {
  const viewer = await findingViewerFor(params.projectId, params.principal);
  const where: Prisma.FindingWhereInput = { projectId: params.projectId };
  if (params.status) where.status = params.status as Prisma.FindingWhereInput['status'];
  if (params.visitId) where.visitId = params.visitId;
  const rows = await prisma.finding.findMany({ where, include: FINDING_INCLUDE, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 300 });
  const names = await loadNames(rows);
  return Promise.all(rows.map((r) => serializeFinding(r, viewer, names)));
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
    const f = await tx.finding.create({
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

/**
 * Resolves a finding by hand on the web, with notes. Resolution photos come from an accepted visit's
 * re-check answer (R4); the old app's field resolve was removed in R5f.
 */
export async function resolveInspectionFinding(params: {
  projectId: string;
  findingId: string;
  principal: { webUser: WebJwtPayload };
  input: ResolveInspectionFindingRequest;
  afterChange?: (tx: Tx) => Promise<void>;
}): Promise<InspectionFindingDto> {
  const { projectId, findingId, principal, input } = params;
  const viewer = await findingViewerFor(projectId, principal);
  const before = await loadFinding(prisma, projectId, findingId);
  if (!viewer.canManage) throw new AppError(`Access requires permission(s): ${MANAGE}`, 403, 'FORBIDDEN_PERMISSION');
  if (input.clientCaptureIds.length) {
    throw new AppError('Photos of a fix are taken on a visit (follow-up check)', 400, 'CAPTURES_NEED_FIELD_APP');
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.finding.updateMany({
      where: { id: findingId, status: 'OPEN' },
      data: {
        status: 'RESOLVED',
        resolvedNotes: input.notes || null,
        resolutionCaptureIds: [],
        resolvedByUserId: viewer.userId,
        resolvedByName: viewer.label,
        resolvedAt: new Date(),
      },
    });
    if (updated.count === 0) throw new AppError('This finding is not open', 409, 'FINDING_NOT_OPEN');
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: principal.webUser.userId,
      actorDisplayName: viewer.label,
      action: 'INSPECTION_FINDING_RESOLVED',
      summaryText: `Resolved the finding "${before.description}"${input.notes ? `: ${input.notes}` : ''}.`,
      payload: { inspectionFindingId: findingId, outcome: 'RESOLVED', notes: input.notes || null },
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
    const updated = await tx.finding.updateMany({
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
