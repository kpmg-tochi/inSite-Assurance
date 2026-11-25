import { Prisma } from '@prisma/client';
import {
  CancelVisitRequest,
  CreateVisitRequest,
  GenerateVisitsRequest,
  GenerateVisitsResult,
  isIsoCalendarDate,
  ProjectVisitsDto,
  PublishVisitsRequest,
  RebuildVisitFormResult,
  rescheduleWindow,
  sprintForDate,
  submissionDeadlineFor,
  UpdateVisitRequest,
  VISIT_KIND_META,
  VISIT_NOT_STARTED_STATUSES,
  VisitDateChangeDto,
  VisitDetailDto,
  VisitDto,
  VisitFormSnapshotSchema,
  VisitOfficersDto,
  VisitStatus,
  VisitStatusEnum,
  VisitKindEnum,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import {
  Db,
  flushVisitPushes,
  loadVisitInProject,
  loadVisitProject,
  lockVisit,
  monitoringConfigOf,
  notifyOfficers,
  OfficerInput,
  projectToday,
  resolveOfficers,
  serializeVisit,
  setVisitAssignees,
  Tx,
  VISIT_INCLUDE,
  VisitPrincipal,
  VisitProject,
  VisitPushQueue,
  VisitRow,
  visitLabel,
  webVisitActor,
} from './visitCore';
import { freezeVisitForm } from './visitForms';
import { officerWarnings, projectPlanWarnings } from './planWarnings';
import { proposeVisitsFromType } from './visitPlan.service';

/**
 * Redesign R4a: visits on a project (D-R4.1–D-R4.6, D-R4.16). Managers (`visits:plan`) create,
 * generate, publish, move, reassign, cancel and rebuild; officers see their own visits.
 */

// ---------------------------------------------------------------------------
// Serialising with the related facts (pending proposal, live submission)
// ---------------------------------------------------------------------------

export async function serializeVisits(db: Db, rows: VisitRow[]): Promise<VisitDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const [pending, live] = await Promise.all([
    db.visitDateChange.findMany({ where: { visitId: { in: ids }, status: 'PENDING' } }),
    db.visitSubmission.findMany({
      where: { visitId: { in: ids } },
      select: { id: true, visitId: true, status: true, isLate: true },
      orderBy: { revisionNumber: 'desc' },
    }),
  ]);
  const pendingBy = new Map(pending.map((p) => [p.visitId, p]));
  return rows.map((r) => {
    const p = pendingBy.get(r.id);
    const subs = live.filter((s) => s.visitId === r.id);
    const liveSub = subs.find((s) => s.status !== 'RETURNED') ?? null;
    return serializeVisit(r, {
      pendingProposal: p ? { id: p.id, toDate: p.toDate, comment: p.comment ?? '', byName: p.byName } : null,
      liveSubmissionId: liveSub?.id ?? null,
      isLate: (liveSub ?? subs[0])?.isLate ?? false,
    });
  });
}

export async function visitDto(db: Db, projectId: string, visitId: string): Promise<VisitDto> {
  return (await serializeVisits(db, [await loadVisitInProject(db, projectId, visitId)]))[0];
}

export function serializeDateChange(c: Prisma.VisitDateChangeGetPayload<object>): VisitDateChangeDto {
  return {
    id: c.id,
    visitId: c.visitId,
    kind: c.kind,
    status: c.status,
    fromDate: c.fromDate,
    toDate: c.toDate,
    comment: c.comment,
    byName: c.byName,
    createdAt: c.createdAt.toISOString(),
    decidedByName: c.decidedByName,
    decidedAt: c.decidedAt?.toISOString() ?? null,
    decisionNote: c.decisionNote,
  };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface VisitListQuery {
  from?: string;
  to?: string;
  status?: string;
  visitKind?: string;
}

/** The Visits tab's filter (also used by its Excel export). */
export function visitWhere(projectId: string, q: VisitListQuery): Prisma.VisitWhereInput {
  const where: Prisma.VisitWhereInput = { projectId };
  const date: Prisma.StringFilter = {};
  if (q.from && isIsoCalendarDate(q.from)) date.gte = q.from;
  if (q.to && isIsoCalendarDate(q.to)) date.lte = q.to;
  if (Object.keys(date).length) where.plannedDate = date;
  const statuses = (q.status ?? '').split(',').filter((s) => VisitStatusEnum.safeParse(s).success) as VisitStatus[];
  if (statuses.length) where.status = { in: statuses };
  if (q.visitKind && VisitKindEnum.safeParse(q.visitKind).success) where.visitKind = q.visitKind as Prisma.VisitWhereInput['visitKind'];
  return where;
}

export async function listProjectVisits(projectId: string, principal: VisitPrincipal, q: VisitListQuery = {}): Promise<ProjectVisitsDto> {
  const where = visitWhere(projectId, q);
  // A field principal sees the visits it is assigned to.
  if (principal.fieldAgent) where.assignees = { some: { userId: principal.fieldAgent.userId } };
  if (principal.webUser && !principal.webUser.permissions.includes('visits:view') && !principal.webUser.isPlatformSuperAdmin) {
    throw new AppError('Access requires permission(s): visits:view', 403, 'FORBIDDEN_PERMISSION');
  }
  if (principal.fieldAgent && !principal.fieldAgent.permissions.includes('visits:submit') && !principal.fieldAgent.permissions.includes('visits:view')) {
    throw new AppError('Access requires permission(s): visits:view', 403, 'FORBIDDEN_PERMISSION');
  }
  const [rows, project] = await Promise.all([
    prisma.visit.findMany({ where, include: VISIT_INCLUDE, orderBy: [{ plannedDate: 'asc' }, { createdAt: 'asc' }], take: 500 }),
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { tenant: { select: { visitRescheduleToleranceWorkdays: true } } } }),
  ]);
  const warnings = principal.webUser
    ? [
        ...(await projectPlanWarnings(prisma, projectId)),
        ...(await officerWarnings(prisma, rows.flatMap((r) => r.assignees.map((a) => a.userId)))),
      ]
    : [];
  return { visits: await serializeVisits(prisma, rows), warnings, toleranceWorkdays: project.tenant.visitRescheduleToleranceWorkdays };
}

/** Whether a principal may read this visit: web staff with visits:view, or an assigned officer. */
export function assertMayReadVisit(visit: VisitRow, principal: VisitPrincipal): void {
  if (principal.webUser) {
    if (principal.webUser.isPlatformSuperAdmin || principal.webUser.permissions.includes('visits:view')) return;
    throw new AppError('Access requires permission(s): visits:view', 403, 'FORBIDDEN_PERMISSION');
  }
  if (!visit.assignees.some((a) => a.userId === principal.fieldAgent.userId)) {
    throw new AppError('This visit is not assigned to you', 403, 'VISIT_NOT_ASSIGNED');
  }
}

/** The dates an officer may move a visit to without asking (null once responses are closed). */
export async function moveWindowFor(
  db: Db,
  visit: { projectId: string; status: string; originalPlannedDate: string; checkInAt: Date | null },
  project: { workWeekDays: number[]; tenantId: string }
): Promise<{ from: string; to: string } | null> {
  if (visit.status !== 'PLANNED' || visit.checkInAt) return null;
  const [tenant, sprints] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: project.tenantId }, select: { visitRescheduleToleranceWorkdays: true } }),
    db.projectSprint.findMany({ where: { projectId: visit.projectId }, select: { number: true, startDate: true, endDate: true } }),
  ]);
  return rescheduleWindow(visit.originalPlannedDate, tenant.visitRescheduleToleranceWorkdays, project.workWeekDays, sprints);
}

/** Visit detail (R4b adds the date history; R4c the submissions and comments). */
export async function getVisitDetail(
  projectId: string,
  visitId: string,
  principal: VisitPrincipal,
  loaders: { submissions?: (visitId: string) => Promise<VisitDetailDto['submissions']> } = {}
): Promise<VisitDetailDto> {
  const row = await loadVisitInProject(prisma, projectId, visitId);
  assertMayReadVisit(row, principal);
  const project = await loadVisitProject(prisma, projectId);
  const [changes, comments, visit] = await Promise.all([
    prisma.visitDateChange.findMany({ where: { visitId }, orderBy: { createdAt: 'asc' } }),
    prisma.visitComment.findMany({ where: { visitId }, orderBy: { createdAt: 'asc' } }),
    serializeVisits(prisma, [row]).then((l) => l[0]),
  ]);
  const snapshot = row.formSnapshot ? VisitFormSnapshotSchema.safeParse(row.formSnapshot.snapshotJson) : null;
  return {
    visit,
    dateChanges: changes.map(serializeDateChange),
    submissions: loaders.submissions ? await loaders.submissions(visitId) : [],
    comments: comments.map((c) => ({ id: c.id, submissionId: c.submissionId, authorName: c.authorName, text: c.text, createdAt: c.createdAt.toISOString() })),
    snapshot: snapshot?.success ? snapshot.data : null,
    moveWindow: await moveWindowFor(prisma, row, project),
  };
}

// ---------------------------------------------------------------------------
// Manager actions (D-R4.16)
// ---------------------------------------------------------------------------

function assertDate(date: string) {
  if (!isIsoCalendarDate(date)) throw new AppError(`${date} is not a valid date`, 422, 'INVALID_DATE');
}

async function assertFacilitiesInScope(db: Db, projectId: string, facilityIds: string[]) {
  if (facilityIds.length === 0) return;
  const units = await db.facilityUnit.findMany({ where: { projectId, facilityId: { in: facilityIds } }, select: { facilityId: true } });
  const inScope = new Set(units.map((u) => u.facilityId));
  const outside = facilityIds.filter((id) => !inScope.has(id));
  if (outside.length) throw new AppError('Pick facilities that have units on this project', 422, 'FACILITY_NOT_IN_SCOPE', { facilityIds: outside });
}

async function sprintIdFor(tx: Tx, projectId: string, date: string): Promise<string | null> {
  const sprints = await tx.projectSprint.findMany({ where: { projectId }, select: { id: true, startDate: true, endDate: true } });
  return sprintForDate(sprints, date)?.id ?? null;
}

function assertNotStarted(v: VisitRow) {
  if (!VISIT_NOT_STARTED_STATUSES.includes(v.status) || v.checkInAt) {
    throw new AppError('This visit has started or is closed; it cannot be changed', 409, 'VISIT_STARTED', { status: v.status });
  }
}

/** PROPOSED → PLANNED inside the caller's transaction: freezes the form, sets the deadline, notifies officers. */
async function publishOne(tx: Tx, project: VisitProject, v: VisitRow, webUser: WebJwtPayload, pushes: VisitPushQueue, now: Date) {
  const config = monitoringConfigOf(project.projectTypeSnapshotJson);
  await freezeVisitForm(tx, v, { timezone: project.timezone, builtByUserId: webUser.userId, now });
  await tx.visit.update({
    where: { id: v.id },
    data: {
      status: 'PLANNED',
      originalPlannedDate: v.plannedDate,
      confirmation: 'UNCONFIRMED',
      confirmedAt: null,
      publishedAt: now,
      publishedByUserId: webUser.userId,
      submissionDeadline: submissionDeadlineFor(v.plannedDate, config.submissionDeadlineDays),
    },
  });
  await notifyOfficers(tx, pushes, {
    projectId: project.id,
    visitId: v.id,
    userIds: v.assignees.map((a) => a.userId),
    type: 'VISIT_ASSIGNED',
    title: `${visitLabel(v.visitKind)} on ${v.plannedDate}`,
    message: `${project.codePrefix}: you are on the ${visitLabel(v.visitKind).toLowerCase()} on ${v.plannedDate}. Confirm, or move it within the allowed days.`,
  });
}

export async function createVisit(projectId: string, webUser: WebJwtPayload, input: CreateVisitRequest): Promise<VisitDto> {
  assertDate(input.plannedDate);
  const meta = VISIT_KIND_META[input.visitKind];
  if (meta.facilityRule === 'PICKED' && input.pickedFacilityIds.length === 0) {
    throw new AppError('Pick the facilities this ad hoc visit checks', 422, 'VISIT_NEEDS_FACILITIES');
  }
  if (meta.facilityRule !== 'PICKED' && input.pickedFacilityIds.length > 0) {
    throw new AppError(`${meta.label} visits do not take picked facilities`, 422, 'FACILITIES_NOT_ALLOWED');
  }
  await assertFacilitiesInScope(prisma, projectId, input.pickedFacilityIds);
  if (!input.proposed && input.assignees.length === 0) throw new AppError('Assign an officer before publishing the visit', 422, 'VISIT_NEEDS_OFFICER');
  const pushes: VisitPushQueue = [];
  const now = new Date();
  const id = await prisma.$transaction(async (tx) => {
    const project = await loadVisitProject(tx, projectId);
    const config = monitoringConfigOf(project.projectTypeSnapshotJson);
    const { assignedToProject } = await resolveOfficers(tx, project, input.assignees);
    const visit = await tx.visit.create({
      data: {
        projectId,
        visitKind: input.visitKind,
        status: 'PROPOSED',
        origin: 'MANUAL',
        originalPlannedDate: input.plannedDate,
        plannedDate: input.plannedDate,
        sprintId: await sprintIdFor(tx, projectId, input.plannedDate),
        pickedFacilityIds: input.pickedFacilityIds,
        submissionDeadline: submissionDeadlineFor(input.plannedDate, config.submissionDeadlineDays),
        createdByUserId: webUser.userId,
      },
    });
    await setVisitAssignees(tx, visit.id, input.assignees);
    if (!input.proposed) await publishOne(tx, project, await loadVisitInProject(tx, projectId, visit.id), webUser, pushes, now);
    await recordAuditEvent(tx, {
      projectId,
      ...auditActor(webUser),
      action: 'VISIT_CREATED',
      summaryText: `${input.proposed ? 'Proposed' : 'Planned'} a ${visitLabel(input.visitKind).toLowerCase()} on ${input.plannedDate}${
        input.assignees.length ? ` with ${input.assignees.length} officer(s)` : ''
      }.`,
      payload: { visitId: visit.id, visitKind: input.visitKind, plannedDate: input.plannedDate, assignees: input.assignees, assignedToProject },
    });
    return visit.id;
  });
  await flushVisitPushes(pushes);
  return visitDto(prisma, projectId, id);
}

function auditActor(u: WebJwtPayload) {
  const a = webVisitActor(u);
  return { actorType: a.actorType, actorId: a.actorId, actorDisplayName: a.actorDisplayName };
}

/** Withdraws a pending officer proposal (a manager move or a cancel overtakes it). */
export async function withdrawPendingProposal(tx: Tx, visitId: string, note: string): Promise<void> {
  await tx.visitDateChange.updateMany({
    where: { visitId, status: 'PENDING' },
    data: { status: 'WITHDRAWN', decidedAt: new Date(), decisionNote: note },
  });
}

export async function updateVisit(projectId: string, visitId: string, webUser: WebJwtPayload, input: UpdateVisitRequest): Promise<VisitDto> {
  if (input.plannedDate) assertDate(input.plannedDate);
  const pushes: VisitPushQueue = [];
  const now = new Date();
  await prisma.$transaction(async (tx) => {
    const v = await lockVisit(tx, projectId, visitId);
    assertNotStarted(v);
    const project = await loadVisitProject(tx, projectId);
    const config = monitoringConfigOf(project.projectTypeSnapshotJson);
    const published = v.status === 'PLANNED';
    const changes: string[] = [];
    const data: Prisma.VisitUpdateInput = {};
    let rebuild = false;

    if (input.pickedFacilityIds !== undefined) {
      if (VISIT_KIND_META[v.visitKind].facilityRule !== 'PICKED') throw new AppError('Only ad hoc visits take picked facilities', 422, 'FACILITIES_NOT_ALLOWED');
      if (input.pickedFacilityIds.length === 0) throw new AppError('Pick the facilities this ad hoc visit checks', 422, 'VISIT_NEEDS_FACILITIES');
      await assertFacilitiesInScope(tx, projectId, input.pickedFacilityIds);
      data.pickedFacilityIds = input.pickedFacilityIds;
      changes.push('facilities changed');
      rebuild = true;
    }

    let moved = false;
    if (input.plannedDate && input.plannedDate !== v.plannedDate) {
      if (published && (input.note ?? '').trim().length < 3) throw new AppError('Say why the visit moves (at least 3 characters)', 422, 'NOTE_REQUIRED');
      moved = true;
      const sprintId = await sprintIdFor(tx, projectId, input.plannedDate);
      data.plannedDate = input.plannedDate;
      // The original date stays fixed once published (D-R4.15, D-R4.16).
      if (!published) data.originalPlannedDate = input.plannedDate;
      data.sprint = sprintId ? { connect: { id: sprintId } } : { disconnect: true };
      data.submissionDeadline = submissionDeadlineFor(input.plannedDate, config.submissionDeadlineDays);
      data.confirmation = 'UNCONFIRMED';
      data.confirmedAt = null;
      await withdrawPendingProposal(tx, visitId, 'The manager moved the visit.');
      await tx.visitDateChange.create({
        data: {
          visitId,
          kind: 'MANAGER_MOVE',
          status: 'APPLIED',
          fromDate: v.plannedDate,
          toDate: input.plannedDate,
          comment: input.note ?? null,
          byUserId: webUser.userId,
          byName: webUser.fullName,
        },
      });
      changes.push(`moved from ${v.plannedDate} to ${input.plannedDate}`);
      rebuild = true;
    }

    let added: string[] = [];
    let removedOfficers: string[] = [];
    let assignedToProject: string[] = [];
    if (input.assignees !== undefined) {
      if (published && input.assignees.length === 0) throw new AppError('A published visit needs an officer', 422, 'VISIT_NEEDS_OFFICER');
      ({ assignedToProject } = await resolveOfficers(tx, project, input.assignees));
      const before = new Set(v.assignees.map((a) => a.userId));
      const after = new Set(input.assignees.map((a) => a.userId));
      added = [...after].filter((id) => !before.has(id));
      removedOfficers = [...before].filter((id) => !after.has(id));
      const leadChanged = v.assignees.find((a) => a.isLead)?.userId !== input.assignees.find((a) => a.isLead)?.userId;
      if (added.length || removedOfficers.length || leadChanged) {
        await setVisitAssignees(tx, visitId, input.assignees);
        data.confirmation = 'UNCONFIRMED';
        data.confirmedAt = null;
        changes.push(`officers: ${input.assignees.length}`);
      }
    }
    if (changes.length === 0) return;
    await tx.visit.update({ where: { id: visitId }, data });
    if (published && rebuild) {
      const fresh = await loadVisitInProject(tx, projectId, visitId);
      await freezeVisitForm(tx, fresh, { timezone: project.timezone, builtByUserId: webUser.userId, now });
    }
    if (published) {
      const label = visitLabel(v.visitKind);
      const date = input.plannedDate ?? v.plannedDate;
      const stay = input.assignees ? input.assignees.map((a) => a.userId).filter((id) => !added.includes(id)) : v.assignees.map((a) => a.userId);
      if (moved && stay.length) {
        await notifyOfficers(tx, pushes, {
          projectId,
          visitId,
          userIds: stay,
          type: 'VISIT_CHANGED',
          title: `${label} moved to ${date}`,
          message: `${project.codePrefix}: the ${label.toLowerCase()} on ${v.plannedDate} moved to ${date}${input.note ? `: ${input.note}` : ''}. Please confirm.`,
        });
      }
      if (added.length) {
        await notifyOfficers(tx, pushes, {
          projectId,
          visitId,
          userIds: added,
          type: 'VISIT_ASSIGNED',
          title: `${label} on ${date}`,
          message: `${project.codePrefix}: you are on the ${label.toLowerCase()} on ${date}. Confirm, or move it within the allowed days.`,
        });
      }
      if (removedOfficers.length) {
        await notifyOfficers(tx, pushes, {
          projectId,
          visitId,
          userIds: removedOfficers,
          type: 'VISIT_CHANGED',
          title: `${label} on ${v.plannedDate} reassigned`,
          message: `${project.codePrefix}: you are no longer on the ${label.toLowerCase()} on ${v.plannedDate}.`,
        });
      }
    }
    await recordAuditEvent(tx, {
      projectId,
      ...auditActor(webUser),
      action: 'VISIT_UPDATED',
      summaryText: `Changed the ${visitLabel(v.visitKind).toLowerCase()} of ${v.plannedDate}: ${changes.join('; ')}${input.note ? ` (${input.note})` : ''}.`,
      payload: { visitId, input, added, removed: removedOfficers, assignedToProject },
    });
  });
  await flushVisitPushes(pushes);
  return visitDto(prisma, projectId, visitId);
}

export async function publishVisits(projectId: string, webUser: WebJwtPayload, input: PublishVisitsRequest): Promise<VisitDto[]> {
  const pushes: VisitPushQueue = [];
  const now = new Date();
  const ids = [...new Set(input.visitIds)];
  await prisma.$transaction(async (tx) => {
    const project = await loadVisitProject(tx, projectId);
    if (project.status !== 'ACTIVE') throw new AppError('Visits are published once the project is live', 409, 'PROJECT_NOT_ACTIVE');
    const rows = await tx.visit.findMany({ where: { id: { in: ids }, projectId }, include: VISIT_INCLUDE });
    if (rows.length !== ids.length) throw new AppError('Visit not found', 404, 'VISIT_NOT_FOUND');
    const toPublish = rows.filter((r) => r.status === 'PROPOSED');
    const noOfficer = toPublish.filter((r) => !r.assignees.some((a) => a.isLead));
    if (noOfficer.length) {
      throw new AppError('Assign a lead officer to every visit before publishing', 422, 'VISIT_NEEDS_OFFICER', { visitIds: noOfficer.map((r) => r.id) });
    }
    for (const r of toPublish) {
      await tx.$queryRaw`SELECT id FROM "visits" WHERE id = ${r.id}::uuid FOR UPDATE`;
      await publishOne(tx, project, r, webUser, pushes, now);
    }
    if (toPublish.length) {
      await recordAuditEvent(tx, {
        projectId,
        ...auditActor(webUser),
        action: 'VISIT_PUBLISHED',
        summaryText: `Published ${toPublish.length} visit(s) to their officers: ${toPublish.map((r) => `${visitLabel(r.visitKind).toLowerCase()} on ${r.plannedDate}`).join(', ')}.`,
        payload: { visitIds: toPublish.map((r) => r.id) },
      });
    }
  });
  await flushVisitPushes(pushes);
  const rows = await prisma.visit.findMany({ where: { id: { in: ids } }, include: VISIT_INCLUDE, orderBy: { plannedDate: 'asc' } });
  return serializeVisits(prisma, rows);
}

const CANCELLABLE: VisitStatus[] = ['PROPOSED', 'PLANNED', 'IN_PROGRESS', 'RETURNED', 'MISSED'];

export async function cancelVisit(projectId: string, visitId: string, webUser: WebJwtPayload, input: CancelVisitRequest): Promise<VisitDto> {
  const pushes: VisitPushQueue = [];
  await prisma.$transaction(async (tx) => {
    const v = await lockVisit(tx, projectId, visitId);
    if (!CANCELLABLE.includes(v.status)) throw new AppError('This visit cannot be cancelled', 409, 'VISIT_NOT_CANCELLABLE', { status: v.status });
    const project = await loadVisitProject(tx, projectId);
    await cancelVisitRow(tx, v, { reason: input.reason, userId: webUser.userId });
    if (v.status !== 'PROPOSED') {
      await notifyOfficers(tx, pushes, {
        projectId,
        visitId,
        userIds: v.assignees.map((a) => a.userId),
        type: 'VISIT_CHANGED',
        title: `${visitLabel(v.visitKind)} on ${v.plannedDate} cancelled`,
        message: `${project.codePrefix}: the ${visitLabel(v.visitKind).toLowerCase()} on ${v.plannedDate} is cancelled: ${input.reason}`,
      });
    }
    await recordAuditEvent(tx, {
      projectId,
      ...auditActor(webUser),
      action: 'VISIT_CANCELLED',
      summaryText: `Cancelled the ${visitLabel(v.visitKind).toLowerCase()} of ${v.plannedDate}: ${input.reason}`,
      payload: { visitId, reason: input.reason, previousStatus: v.status },
    });
  });
  await flushVisitPushes(pushes);
  return visitDto(prisma, projectId, visitId);
}

/** Marks a visit cancelled (also used by the system when mobilisation completes). */
export async function cancelVisitRow(tx: Tx, v: { id: string }, opts: { reason: string; userId: string | null }): Promise<void> {
  await withdrawPendingProposal(tx, v.id, 'The visit was cancelled.');
  await tx.visit.update({ where: { id: v.id }, data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledReason: opts.reason, cancelledByUserId: opts.userId } });
}

export async function rebuildVisitForm(projectId: string, visitId: string, webUser: WebJwtPayload): Promise<RebuildVisitFormResult> {
  const result = await prisma.$transaction(async (tx) => {
    const v = await lockVisit(tx, projectId, visitId);
    if (v.status !== 'PLANNED' || v.checkInAt) {
      throw new AppError('Only a published visit that has not started can have its form rebuilt', 409, 'VISIT_FORM_LOCKED', { status: v.status });
    }
    const project = await loadVisitProject(tx, projectId);
    const sprintId = await sprintIdFor(tx, projectId, v.plannedDate);
    if (sprintId !== v.sprintId) await tx.visit.update({ where: { id: visitId }, data: { sprintId } });
    const frozen = await freezeVisitForm(tx, v, { timezone: project.timezone, builtByUserId: webUser.userId });
    if (frozen.changed) {
      await recordAuditEvent(tx, {
        projectId,
        ...auditActor(webUser),
        action: 'VISIT_FORM_REBUILT',
        summaryText: `Rebuilt the form of the ${visitLabel(v.visitKind).toLowerCase()} of ${v.plannedDate}.`,
        payload: { visitId, formSnapshotId: frozen.formSnapshotId, formHash: frozen.formHash, previousSnapshotId: v.formSnapshotId },
      });
    }
    return frozen;
  });
  return { visit: await visitDto(prisma, projectId, visitId), warnings: result.warnings, changed: result.changed };
}

export async function generateVisits(projectId: string, webUser: WebJwtPayload, input: GenerateVisitsRequest): Promise<GenerateVisitsResult> {
  const result = await prisma.$transaction(async (tx) => {
    const project = await loadVisitProject(tx, projectId);
    if (project.status !== 'ACTIVE') throw new AppError('The visit plan runs once the project is live', 409, 'PROJECT_NOT_ACTIVE');
    let officers: OfficerInput[] | undefined;
    if (input.assignees.length) officers = (await resolveOfficers(tx, project, input.assignees)).officers;
    return proposeVisitsFromType(tx, projectId, { trigger: 'MANUAL', ruleKey: input.ruleKey, actor: webVisitActor(webUser), assignees: officers });
  });
  const rows = await prisma.visit.findMany({ where: { id: { in: result.createdIds } }, include: VISIT_INCLUDE, orderBy: { plannedDate: 'asc' } });
  return { created: result.createdIds.length, removed: result.removed, visits: await serializeVisits(prisma, rows) };
}

/** People who can carry out visits on this project (a mobile role with visits:submit), and the defaults. */
export async function listVisitOfficers(projectId: string): Promise<VisitOfficersDto> {
  const project = await loadVisitProject(prisma, projectId);
  const holds = { rolePermissions: { some: { permission: { key: 'visits:submit' } } }, surface: { not: 'WEB' as const } };
  const users = await prisma.user.findMany({
    where: { tenantId: project.tenantId, isActive: true, OR: [{ mobileRole: holds }, { role: holds }] },
    select: { id: true, fullName: true, role: { select: { name: true, surface: true } }, mobileRole: { select: { name: true } }, projectAssignments: { where: { projectId }, select: { id: true } } },
    orderBy: { fullName: 'asc' },
  });
  return {
    defaultOfficerIds: project.defaultVisitOfficerIds,
    candidates: users.map((u) => ({ userId: u.id, fullName: u.fullName, roleName: u.mobileRole?.name ?? u.role.name, onProject: u.projectAssignments.length > 0 })),
  };
}

/** The project's default visit officers (setup `visits` step, D-R4.39). */
export async function saveDefaultVisitOfficers(projectId: string, webUser: WebJwtPayload, userIds: string[]): Promise<string[]> {
  const unique = [...new Set(userIds)];
  await prisma.$transaction(async (tx) => {
    const project = await loadVisitProject(tx, projectId);
    const { assignedToProject } = await resolveOfficers(tx, project, unique.map((userId, i) => ({ userId, isLead: i === 0 })));
    await tx.project.update({ where: { id: projectId }, data: { defaultVisitOfficerIds: unique } });
    await recordAuditEvent(tx, {
      projectId,
      ...auditActor(webUser),
      action: 'VISIT_OFFICERS_SAVED',
      summaryText: `Set ${unique.length} default visit officer(s).`,
      payload: { userIds: unique, assignedToProject },
    });
  });
  return unique;
}

export { projectToday };
