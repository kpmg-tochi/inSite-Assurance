import { Prisma } from '@prisma/client';
import {
  DecideVisitProposalRequest,
  isIsoCalendarDate,
  PlannerDto,
  RespondToVisitRequest,
  rescheduleWindow,
  sprintForDate,
  submissionDeadlineFor,
  VisitDto,
  VisitKindEnum,
  withinRescheduleTolerance,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { FieldAgentJwtPayload, WebJwtPayload } from '../../middleware/auth.middleware';
import { buildProjectVisibilityWhere } from '../../utils/accessControl';
import { recordAuditEvent } from '../audit/audit.service';
import { createWebNotification } from '../notifications/notifications.service';
import {
  fieldVisitActor,
  flushVisitPushes,
  loadVisitProject,
  lockVisit,
  monitoringConfigOf,
  notifyOfficers,
  Tx,
  VISIT_INCLUDE,
  VisitPushQueue,
  VisitRow,
  visitLabel,
  webVisitActor,
} from './visitCore';
import { freezeVisitForm } from './visitForms';
import { serializeDateChange, serializeVisits, visitDto, withdrawPendingProposal } from './visits.service';
import { officerWarnings, projectPlanWarnings } from './planWarnings';

/**
 * Redesign R4b: officer responses (D-R4.14, D-R4.15) and the manager's planner (D-R4.16, D-R4.18).
 * Every response is idempotent on the phone's `clientActionId`; a replay returns the visit as it is.
 */

/** Moves a published visit to a new date inside the caller's transaction (deadline, sprint, form). */
async function applyNewDate(tx: Tx, v: VisitRow, date: string, opts: { timezone: string; snapshotJson: unknown; byUserId: string | null; countAsReschedule: boolean }) {
  const config = monitoringConfigOf(opts.snapshotJson);
  const sprints = await tx.projectSprint.findMany({ where: { projectId: v.projectId }, select: { id: true, startDate: true, endDate: true } });
  await tx.visit.update({
    where: { id: v.id },
    data: {
      plannedDate: date,
      sprintId: sprintForDate(sprints, date)?.id ?? null,
      submissionDeadline: submissionDeadlineFor(date, config.submissionDeadlineDays),
      confirmation: 'CONFIRMED',
      confirmedAt: new Date(),
      ...(opts.countAsReschedule ? { rescheduleCount: { increment: 1 } } : {}),
    },
  });
  await freezeVisitForm(tx, { ...v, plannedDate: date }, { timezone: opts.timezone, builtByUserId: opts.byUserId });
}

function assertRespondable(v: VisitRow) {
  if (v.status !== 'PLANNED' || v.checkInAt) {
    throw new AppError('This visit has changed since you last saw it (started, closed or not published). Refresh your visits.', 409, 'VISIT_CHANGED', {
      status: v.status,
    });
  }
}

export async function respondToVisit(params: {
  projectId: string;
  visitId: string;
  fieldAgent: FieldAgentJwtPayload;
  input: RespondToVisitRequest;
}): Promise<VisitDto> {
  const { projectId, visitId, fieldAgent: f, input } = params;
  if (!f.permissions.includes('visits:submit')) throw new AppError('Access requires permission(s): visits:submit', 403, 'FORBIDDEN_PERMISSION');

  const replay = await prisma.visitResponse.findUnique({ where: { clientActionId: input.clientActionId } });
  if (replay) {
    if (replay.visitId !== visitId || replay.userId !== f.userId) throw new AppError('This action ID is already in use', 409, 'ACTION_ID_CONFLICT');
    return visitDto(prisma, projectId, visitId);
  }

  const pushes: VisitPushQueue = [];
  try {
    await prisma.$transaction(async (tx) => {
      const v = await lockVisit(tx, projectId, visitId);
      if (!v.assignees.some((a) => a.userId === f.userId)) throw new AppError('This visit is not assigned to you', 403, 'VISIT_NOT_ASSIGNED');
      assertRespondable(v);
      const project = await loadVisitProject(tx, projectId);
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: project.tenantId }, select: { visitRescheduleToleranceWorkdays: true } });
      const label = visitLabel(v.visitKind);
      const comment = input.comment?.trim() || null;
      const date = input.date ?? null;
      if (date && !isIsoCalendarDate(date)) throw new AppError(`${date} is not a valid date`, 422, 'INVALID_DATE');
      let dateChangeId: string | null = null;
      let summary = '';

      const notifyManagers = (category: 'VISIT_RESCHEDULED' | 'VISIT_DATE_PROPOSED' | 'VISIT_DECLINED', title: string, description: string) =>
        createWebNotification(tx, {
          projectId,
          targetPermissionKey: 'visits:plan',
          category,
          title,
          description,
          actionUrl: `/app/projects/${projectId}/visits?visitId=${visitId}`,
          metadata: { visitId },
        });

      switch (input.action) {
        case 'CONFIRM':
          await tx.visit.update({ where: { id: visitId }, data: { confirmation: 'CONFIRMED', confirmedAt: new Date() } });
          summary = `Confirmed the ${label.toLowerCase()} on ${v.plannedDate}.`;
          break;
        case 'DECLINE':
          await tx.visit.update({ where: { id: visitId }, data: { confirmation: 'DECLINED', confirmedAt: null } });
          await notifyManagers('VISIT_DECLINED', `${f.agentFullName} declined a visit`, `${project.codePrefix}: ${label} on ${v.plannedDate}: ${comment}`);
          summary = `Declined the ${label.toLowerCase()} on ${v.plannedDate}: ${comment}`;
          break;
        case 'MOVE': {
          if (date === v.plannedDate) throw new AppError('The visit is already on that date', 422, 'SAME_DATE');
          const sprints = await tx.projectSprint.findMany({ where: { projectId }, select: { number: true, startDate: true, endDate: true } });
          const check = withinRescheduleTolerance(v.originalPlannedDate, date!, tenant.visitRescheduleToleranceWorkdays, project.workWeekDays, sprints);
          if (!check.ok) {
            const window = rescheduleWindow(v.originalPlannedDate, tenant.visitRescheduleToleranceWorkdays, project.workWeekDays, sprints);
            const why =
              check.reason === 'OTHER_SPRINT'
                ? 'That date is in another sprint.'
                : check.reason === 'NOT_A_WORKDAY'
                  ? 'That date is not a working day.'
                  : `That date is more than ${tenant.visitRescheduleToleranceWorkdays} working day(s) from the original date.`;
            throw new AppError(`${why} Propose the date to the manager instead.`, 422, 'MOVE_OUTSIDE_WINDOW', { reason: check.reason, window });
          }
          await withdrawPendingProposal(tx, visitId, 'The officer moved the visit within the allowed days.');
          const change = await tx.visitDateChange.create({
            data: { visitId, kind: 'OFFICER_MOVE', status: 'APPLIED', fromDate: v.plannedDate, toDate: date!, comment, byUserId: f.userId, byName: f.agentFullName, clientActionId: input.clientActionId },
          });
          dateChangeId = change.id;
          await applyNewDate(tx, v, date!, { timezone: project.timezone, snapshotJson: project.projectTypeSnapshotJson, byUserId: f.userId, countAsReschedule: true });
          await notifyManagers('VISIT_RESCHEDULED', `${f.agentFullName} moved a visit`, `${project.codePrefix}: ${label} moved from ${v.plannedDate} to ${date}: ${comment}`);
          const others = v.assignees.map((a) => a.userId).filter((id) => id !== f.userId);
          await notifyOfficers(tx, pushes, {
            projectId,
            visitId,
            userIds: others,
            type: 'VISIT_CHANGED',
            title: `${label} moved to ${date}`,
            message: `${project.codePrefix}: ${f.agentFullName} moved the ${label.toLowerCase()} from ${v.plannedDate} to ${date}.`,
          });
          summary = `Moved the ${label.toLowerCase()} from ${v.plannedDate} to ${date}: ${comment}`;
          break;
        }
        case 'PROPOSE': {
          if (date === v.plannedDate) throw new AppError('The visit is already on that date', 422, 'SAME_DATE');
          await withdrawPendingProposal(tx, visitId, 'The officer proposed another date.');
          const change = await tx.visitDateChange.create({
            data: { visitId, kind: 'OFFICER_PROPOSAL', status: 'PENDING', fromDate: v.plannedDate, toDate: date!, comment, byUserId: f.userId, byName: f.agentFullName, clientActionId: input.clientActionId },
          });
          dateChangeId = change.id;
          await notifyManagers(
            'VISIT_DATE_PROPOSED',
            `${f.agentFullName} proposed a new date`,
            `${project.codePrefix}: ${label} on ${v.plannedDate}, proposed ${date}: ${comment}`
          );
          summary = `Proposed moving the ${label.toLowerCase()} from ${v.plannedDate} to ${date}: ${comment}`;
          break;
        }
      }

      await tx.visitResponse.create({
        data: { visitId, clientActionId: input.clientActionId, action: input.action, userId: f.userId, userName: f.agentFullName, date, comment, dateChangeId },
      });
      const actor = fieldVisitActor(f);
      await recordAuditEvent(tx, {
        projectId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorDisplayName: actor.actorDisplayName,
        action: 'VISIT_RESPONDED',
        summaryText: summary,
        payload: { visitId, action: input.action, date, comment, clientActionId: input.clientActionId, dateChangeId },
      });
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const again = await prisma.visitResponse.findUnique({ where: { clientActionId: input.clientActionId } });
      if (again && again.visitId === visitId && again.userId === f.userId) return visitDto(prisma, projectId, visitId);
    }
    throw error;
  }
  await flushVisitPushes(pushes);
  return visitDto(prisma, projectId, visitId);
}

export async function decideVisitProposal(params: {
  projectId: string;
  visitId: string;
  changeId: string;
  webUser: WebJwtPayload;
  input: DecideVisitProposalRequest;
}): Promise<VisitDto> {
  const { projectId, visitId, changeId, webUser, input } = params;
  const pushes: VisitPushQueue = [];
  await prisma.$transaction(async (tx) => {
    const v = await lockVisit(tx, projectId, visitId);
    const change = await tx.visitDateChange.findFirst({ where: { id: changeId, visitId } });
    if (!change) throw new AppError('Date proposal not found', 404, 'DATE_CHANGE_NOT_FOUND');
    if (change.status !== 'PENDING') throw new AppError('This proposal has already been decided', 409, 'DATE_CHANGE_NOT_PENDING', { status: change.status });
    if (v.status !== 'PLANNED' || v.checkInAt) throw new AppError('The visit has started or is closed', 409, 'VISIT_STARTED', { status: v.status });
    const project = await loadVisitProject(tx, projectId);
    const label = visitLabel(v.visitKind);
    const accept = input.decision === 'ACCEPT';
    await tx.visitDateChange.update({
      where: { id: changeId },
      data: { status: accept ? 'ACCEPTED' : 'REJECTED', decidedByUserId: webUser.userId, decidedByName: webUser.fullName, decidedAt: new Date(), decisionNote: input.note ?? null },
    });
    if (accept) {
      await applyNewDate(tx, v, change.toDate, { timezone: project.timezone, snapshotJson: project.projectTypeSnapshotJson, byUserId: webUser.userId, countAsReschedule: true });
    }
    await notifyOfficers(tx, pushes, {
      projectId,
      visitId,
      userIds: v.assignees.map((a) => a.userId),
      type: 'VISIT_CHANGED',
      title: accept ? `${label} moved to ${change.toDate}` : `New date for the ${label.toLowerCase()} not accepted`,
      message: accept
        ? `${project.codePrefix}: the manager accepted ${change.toDate} for the ${label.toLowerCase()} (was ${change.fromDate}).`
        : `${project.codePrefix}: the ${label.toLowerCase()} stays on ${v.plannedDate}: ${input.note}`,
    });
    const actor = webVisitActor(webUser);
    await recordAuditEvent(tx, {
      projectId,
      actorType: actor.actorType,
      actorId: actor.actorId,
      actorDisplayName: actor.actorDisplayName,
      action: 'VISIT_DATE_DECIDED',
      summaryText: accept
        ? `Accepted ${change.byName}'s proposal to move the ${label.toLowerCase()} from ${change.fromDate} to ${change.toDate}.`
        : `Rejected ${change.byName}'s proposal to move the ${label.toLowerCase()} of ${change.fromDate} to ${change.toDate}: ${input.note}`,
      payload: { visitId, changeId, decision: input.decision, note: input.note ?? null },
    });
  });
  await flushVisitPushes(pushes);
  return visitDto(prisma, projectId, visitId);
}

// ---------------------------------------------------------------------------
// Planner (tenant-wide, web)
// ---------------------------------------------------------------------------

export interface PlannerQuery {
  from?: string;
  to?: string;
  regionId?: string;
  projectId?: string;
  officerId?: string;
  visitKind?: string;
}

export async function getPlanner(webUser: WebJwtPayload, q: PlannerQuery, now: Date = new Date()): Promise<PlannerDto> {
  const today = now.toISOString().slice(0, 10);
  const from = q.from && isIsoCalendarDate(q.from) ? q.from : today;
  const to = q.to && isIsoCalendarDate(q.to) && q.to >= from ? q.to : from;
  const projectWhere: Prisma.ProjectWhereInput = buildProjectVisibilityWhere(webUser);
  const and: Prisma.ProjectWhereInput[] = [projectWhere];
  if (q.regionId) and.push({ OR: [{ regionId: q.regionId }, { region: { parentRegionId: q.regionId } }] });
  if (q.projectId) and.push({ id: q.projectId });
  const where: Prisma.VisitWhereInput = { project: { AND: and }, plannedDate: { gte: from, lte: to }, status: { not: 'CANCELLED' } };
  if (q.officerId) where.assignees = { some: { userId: q.officerId } };
  if (q.visitKind && VisitKindEnum.safeParse(q.visitKind).success) where.visitKind = q.visitKind as Prisma.VisitWhereInput['visitKind'];

  const [rows, pendingRows, declinedRows] = await Promise.all([
    prisma.visit.findMany({ where, include: VISIT_INCLUDE, orderBy: [{ plannedDate: 'asc' }, { createdAt: 'asc' }], take: 1000 }),
    prisma.visitDateChange.findMany({
      where: { status: 'PENDING', visit: { project: { AND: and } } },
      include: { visit: { include: VISIT_INCLUDE } },
      orderBy: { createdAt: 'asc' },
      take: 200,
    }),
    prisma.visit.findMany({
      where: { project: { AND: and }, status: 'PLANNED', confirmation: 'DECLINED' },
      include: { ...VISIT_INCLUDE, responses: { where: { action: 'DECLINE' }, orderBy: { createdAt: 'desc' }, take: 1 } },
      take: 200,
    }),
  ]);
  const visits = await serializeVisits(prisma, rows);
  const officerIds = [...new Set(rows.flatMap((r) => r.assignees.map((a) => a.userId)))];
  const moves = officerIds.length
    ? await prisma.visitDateChange.groupBy({
        by: ['byUserId'],
        where: { byUserId: { in: officerIds }, kind: { in: ['OFFICER_MOVE', 'OFFICER_PROPOSAL'] }, status: { in: ['APPLIED', 'ACCEPTED'] }, visitId: { in: rows.map((r) => r.id) } },
        _count: { _all: true },
      })
    : [];
  const moveCount = new Map(moves.map((m) => [m.byUserId, m._count._all]));
  const officers = officerIds
    .map((userId) => {
      const mine = rows.filter((r) => r.assignees.some((a) => a.userId === userId));
      const name = mine[0].assignees.find((a) => a.userId === userId)!.user.fullName;
      return { userId, fullName: name, visitCount: mine.length, rescheduleCount: moveCount.get(userId) ?? 0 };
    })
    .sort((a, b) => a.fullName.localeCompare(b.fullName));

  const projectIds = [...new Set(rows.map((r) => r.projectId))];
  const warnings = [
    ...(await Promise.all(projectIds.map((id) => projectPlanWarnings(prisma, id, now)))).flat(),
    ...(await officerWarnings(prisma, officerIds, now)),
  ];
  const pendingVisits = await serializeVisits(prisma, pendingRows.map((p) => p.visit));
  const declinedVisits = await serializeVisits(prisma, declinedRows);
  return {
    from,
    to,
    officers,
    visits,
    warnings,
    pendingProposals: pendingRows.map((p, i) => ({ visit: pendingVisits[i], change: serializeDateChange(p) })),
    declines: declinedRows.map((r, i) => ({ visit: declinedVisits[i], comment: r.responses[0]?.comment ?? null, byName: r.responses[0]?.userName ?? null })),
  };
}
