import { Prisma } from '@prisma/client';
import {
  MobileNotificationType,
  ProjectTypeMonitoringConfig,
  ProjectTypeMonitoringConfigSchema,
  resolveProjectTypeConfig,
  VisitDto,
  VisitFormSnapshotSchema,
  VisitKind,
  formatCalendarDate,
  formatProjectCodeWithYear,
  visitKindNoun,
  visitKindNounInSentence,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { FieldAgentJwtPayload, WebJwtPayload } from '../../middleware/auth.middleware';
import { createMobileNotification } from '../notifications/notifications.service';
import { sendPushToMobileUser } from '../../integrations/push.service';
import { effectiveMobileRole, isProjectVisibleOnMobile, MOBILE_USER_INCLUDE } from '../auth/mobileAccess';

/**
 * Redesign R4: shared pieces of the visits module: the row shape and its serializer, the project's
 * `monitoring` rules, officer validation (D-R4.17) and officer notifications (D-R4.42).
 */

export type Tx = Prisma.TransactionClient;
export type Db = Tx | typeof prisma;

export const VISIT_INCLUDE = {
  project: { select: { codePrefix: true, name: true } },
  sprint: { select: { id: true, number: true, name: true } },
  assignees: { include: { user: { select: { fullName: true } } }, orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }] },
  formSnapshot: { select: { snapshotJson: true } },
} satisfies Prisma.VisitInclude;
export type VisitRow = Prisma.VisitGetPayload<{ include: typeof VISIT_INCLUDE }>;

export type VisitPrincipal = { webUser: WebJwtPayload; fieldAgent?: undefined } | { fieldAgent: FieldAgentJwtPayload; webUser?: undefined };

/** Facility blocks and re-check items of the frozen form. */
function formCounts(raw: unknown): { facilityCount: number; recheckCount: number } {
  const parsed = VisitFormSnapshotSchema.safeParse(raw);
  if (!parsed.success) return { facilityCount: 0, recheckCount: 0 };
  return {
    facilityCount: parsed.data.blocks.filter((b) => b.kind === 'FACILITY').length,
    recheckCount: parsed.data.blocks.filter((b) => b.kind === 'RECHECK').reduce((n, b) => n + b.fields.length, 0),
  };
}

export interface VisitExtras {
  pendingProposal?: VisitDto['pendingProposal'];
  liveSubmissionId?: string | null;
  isLate?: boolean;
}

export function serializeVisit(v: VisitRow, extras: VisitExtras = {}): VisitDto {
  const counts = v.formSnapshot ? formCounts(v.formSnapshot.snapshotJson) : { facilityCount: v.pickedFacilityIds.length, recheckCount: 0 };
  const row = v as VisitRow & { checkInAt?: Date | null; checkInGeofenceStatus?: string | null };
  return {
    id: v.id,
    projectId: v.projectId,
    projectCode: v.project.codePrefix,
    projectName: v.project.name,
    visitKind: v.visitKind as VisitKind,
    status: v.status,
    confirmation: v.confirmation,
    origin: v.origin,
    generatorKey: v.generatorKey,
    originalPlannedDate: v.originalPlannedDate,
    plannedDate: v.plannedDate,
    submissionDeadline: v.submissionDeadline,
    sprint: v.sprint ? { id: v.sprint.id, number: v.sprint.number, name: v.sprint.name } : null,
    assignees: v.assignees.map((a) => ({ userId: a.userId, fullName: a.user.fullName, isLead: a.isLead })),
    pickedFacilityIds: v.pickedFacilityIds,
    formSnapshotId: v.formSnapshotId,
    formHash: v.formHash,
    formAssembledAt: v.formAssembledAt?.toISOString() ?? null,
    facilityCount: counts.facilityCount,
    recheckCount: counts.recheckCount,
    rescheduleCount: v.rescheduleCount,
    pendingProposal: extras.pendingProposal ?? null,
    checkInAt: row.checkInAt?.toISOString() ?? null,
    checkInGeofenceStatus: row.checkInGeofenceStatus ?? null,
    isLate: extras.isLate ?? false,
    missedAt: v.missedAt?.toISOString() ?? null,
    cancelledAt: v.cancelledAt?.toISOString() ?? null,
    cancelledReason: v.cancelledReason,
    publishedAt: v.publishedAt?.toISOString() ?? null,
    liveSubmissionId: extras.liveSubmissionId ?? null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

export async function loadVisitInProject(db: Db, projectId: string, visitId: string): Promise<VisitRow> {
  const v = await db.visit.findFirst({ where: { id: visitId, projectId }, include: VISIT_INCLUDE });
  if (!v) throw new AppError('Monitoring visit not found', 404, 'VISIT_NOT_FOUND');
  return v;
}

/** Locks a visit row for the rest of the transaction and returns it fresh. */
export async function lockVisit(tx: Tx, projectId: string, visitId: string): Promise<VisitRow> {
  await loadVisitInProject(tx, projectId, visitId);
  await tx.$queryRaw`SELECT id FROM "visits" WHERE id = ${visitId}::uuid FOR UPDATE`;
  return loadVisitInProject(tx, projectId, visitId);
}

// ---------------------------------------------------------------------------
// Project rules
// ---------------------------------------------------------------------------

const DEFAULT_MONITORING = ProjectTypeMonitoringConfigSchema.parse({});

/** The project's `monitoring` rules from its type snapshot (defaults without a type). */
export function monitoringConfigOf(snapshot: unknown): ProjectTypeMonitoringConfig {
  return resolveProjectTypeConfig(snapshot)?.monitoring ?? DEFAULT_MONITORING;
}

export const VISIT_PROJECT_SELECT = {
  id: true,
  tenantId: true,
  codePrefix: true,
  name: true,
  status: true,
  timezone: true,
  workWeekDays: true,
  regionId: true,
  projectTypeSnapshotJson: true,
  defaultVisitOfficerIds: true,
  constructionPhase: true,
} satisfies Prisma.ProjectSelect;
export type VisitProject = Prisma.ProjectGetPayload<{ select: typeof VISIT_PROJECT_SELECT }>;

export async function loadVisitProject(db: Db, projectId: string): Promise<VisitProject> {
  const p = await db.project.findUnique({ where: { id: projectId }, select: VISIT_PROJECT_SELECT });
  if (!p) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  return p;
}

export function projectToday(project: { timezone: string }, now: Date = new Date()): string {
  return zonedCalendarDate(now, project.timezone);
}

/** A visit kind for titles: "Routine monitoring visit", "Mobilisation check" (client demo glossary). */
export const visitLabel = (kind: string) => visitKindNoun(kind);
/** The same inside a sentence: "the routine monitoring visit". */
export const visitLabelInSentence = (kind: string) => visitKindNounInSentence(kind);
/** A label inside a sentence: only the first letter is lowered ("Quarterly M&E …" → "quarterly M&E …"). */
export const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);
/** A calendar date in texts people read: "26 Nov 2026". */
export const dayText = (date: string | null | undefined) => formatCalendarDate(date);
/** A project code in notifications read across projects and years: "LOT 4 BATCH 1 (2026)". */
export const codeText = (codePrefix: string) => formatProjectCodeWithYear(codePrefix);

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

export interface VisitActor {
  actorType: 'WEB_USER' | 'FIELD_AGENT' | 'SYSTEM';
  actorId: string;
  actorDisplayName: string;
  userId: string | null;
}

export function webVisitActor(u: WebJwtPayload): VisitActor {
  return { actorType: 'WEB_USER', actorId: u.userId, actorDisplayName: `${u.fullName} (${u.roleName})`, userId: u.userId };
}

export function fieldVisitActor(f: FieldAgentJwtPayload): VisitActor {
  return { actorType: 'FIELD_AGENT', actorId: f.sessionId, actorDisplayName: `${f.agentFullName} (${f.roleName}, field)`, userId: f.userId };
}

export const SYSTEM_VISIT_ACTOR: VisitActor = { actorType: 'SYSTEM', actorId: 'visits', actorDisplayName: 'System (visits)', userId: null };

// ---------------------------------------------------------------------------
// Officers (D-R4.17)
// ---------------------------------------------------------------------------

export interface OfficerInput {
  userId: string;
  isLead: boolean;
}

/**
 * Checks the officers for a visit: same tenant, active, a mobile role holding `visits:submit`.
 * An officer who cannot see the project on mobile is assigned to it (returned in `assignedToProject`,
 * the caller audits it) so the field session works.
 */
export async function resolveOfficers(
  tx: Tx,
  project: { id: string; tenantId: string },
  officers: OfficerInput[]
): Promise<{ officers: OfficerInput[]; assignedToProject: string[] }> {
  if (officers.length === 0) return { officers: [], assignedToProject: [] };
  const users = await tx.user.findMany({ where: { id: { in: officers.map((o) => o.userId) } }, include: MOBILE_USER_INCLUDE });
  const byId = new Map(users.map((u) => [u.id, u]));
  const assignedToProject: string[] = [];
  for (const o of officers) {
    const u = byId.get(o.userId);
    if (!u || u.tenantId !== project.tenantId) throw new AppError('Officer not found', 404, 'OFFICER_NOT_FOUND', { userId: o.userId });
    if (!u.isActive) throw new AppError(`${u.fullName}'s account is disabled`, 422, 'OFFICER_INACTIVE', { userId: u.id });
    const role = effectiveMobileRole(u);
    if (!role || !role.rolePermissions.some((rp) => rp.permission.key === 'visits:submit')) {
      throw new AppError(`${u.fullName} has no field role that can carry out monitoring visits`, 422, 'OFFICER_CANNOT_VISIT', { userId: u.id });
    }
    if (!(await isProjectVisibleOnMobile(u, project.id))) {
      await tx.userProjectAssignment.createMany({ data: [{ userId: u.id, projectId: project.id }], skipDuplicates: true });
      assignedToProject.push(u.id);
    }
  }
  return { officers, assignedToProject };
}

/** Replaces a visit's officers. */
export async function setVisitAssignees(tx: Tx, visitId: string, officers: OfficerInput[]): Promise<void> {
  await tx.visitAssignee.deleteMany({ where: { visitId } });
  if (officers.length) {
    await tx.visitAssignee.createMany({ data: officers.map((o) => ({ visitId, userId: o.userId, isLead: o.isLead })) });
  }
}

/** The project's default officers as assignees (first = lead), skipping any that no longer qualify. */
export async function defaultOfficersFor(tx: Tx, project: VisitProject): Promise<OfficerInput[]> {
  const out: OfficerInput[] = [];
  for (const userId of project.defaultVisitOfficerIds) {
    try {
      await resolveOfficers(tx, project, [{ userId, isLead: false }]);
      out.push({ userId, isLead: out.length === 0 });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Officer notifications (D-R4.42): one mobile notification per active session of the officer on the
// project; pushes go after the transaction commits.
// ---------------------------------------------------------------------------

export type VisitPushQueue = Array<{ userId: string; title: string; body: string; projectId: string; visitId: string }>;

export async function notifyOfficers(
  tx: Tx,
  pushes: VisitPushQueue,
  params: { projectId: string; visitId: string; userIds: string[]; type: MobileNotificationType; title: string; message: string; submissionId?: string }
): Promise<void> {
  const userIds = [...new Set(params.userIds)];
  if (userIds.length === 0) return;
  const sessions = await tx.fieldAgentSession.findMany({
    where: { projectId: params.projectId, userId: { in: userIds }, isActive: true, revokedAt: null },
    select: { id: true },
  });
  for (const s of sessions) {
    await createMobileNotification(tx, {
      projectId: params.projectId,
      fieldSessionId: s.id,
      type: params.type,
      actionType: 'OPEN_VISIT',
      title: params.title,
      message: params.message,
      metadata: { visitId: params.visitId, ...(params.submissionId ? { visitSubmissionId: params.submissionId } : {}) },
    });
  }
  for (const userId of userIds) pushes.push({ userId, title: params.title, body: params.message, projectId: params.projectId, visitId: params.visitId });
}

export async function flushVisitPushes(pushes: VisitPushQueue): Promise<void> {
  for (const p of pushes) {
    await sendPushToMobileUser(p.userId, { title: p.title, body: p.body, data: { actionType: 'OPEN_VISIT', projectId: p.projectId, visitId: p.visitId } }).catch((error) =>
      console.warn('[visits] push failed:', error)
    );
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}
