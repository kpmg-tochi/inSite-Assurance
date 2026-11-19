import { Prisma, ScheduleRevisionStatus } from '@prisma/client';
import {
  CreateScheduleRevisionRequest,
  DecideScheduleRevisionRequest,
  PreviewScheduleRevisionRequest,
  propagateShift,
  ScheduleAdjustment,
  ScheduleAdjustmentDto,
  ScheduleChange,
  ScheduleCycleError,
  ScheduleRevisionDto,
  ScheduleRevisionPreviewDto,
  workdaysBetween,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, type WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { createWebNotification } from '../notifications/notifications.service';
import {
  loadScheduleContext,
  planEndDate,
  refreshScheduleBadge,
  ScheduleContext,
  toScheduleDependencies,
} from './schedule.service';

type Tx = Prisma.TransactionClient;

/**
 * "Catch Project Up" revisions (Phase 9). A revision moves the chosen items (new start or a shift
 * in working days, durations kept) and every dependent item after them. Nothing about rates or
 * quantities changes, and the original baseline is never touched.
 * - A revision that leaves the projected end date where it is applies at once.
 * - One that moves the end waits for a user with schedule:approve_refactor who did not propose it.
 * - At most one revision waits for approval per project (also a partial unique index).
 * - Applying writes exactly the stored adjustments, after checking each item still has the dates
 *   the proposal was computed from; so the applied result always equals the preview.
 */

interface StoredRevisionJson {
  changes: ScheduleChange[];
  adjustments: ScheduleAdjustment[];
}

interface RevisionPlan extends ScheduleRevisionPreviewDto {
  rawAdjustments: ScheduleAdjustment[];
}

function actorName(webUser: WebJwtPayload) {
  return `${webUser.fullName} (${webUser.roleName})`;
}

function describeAdjustments(ctx: ScheduleContext, adjustments: ScheduleAdjustment[]): ScheduleAdjustmentDto[] {
  const byId = new Map(ctx.items.map((i) => [i.id, i]));
  return adjustments.map((a) => ({
    ...a,
    wbsCode: byId.get(a.boqItemId)?.wbsCode,
    description: byId.get(a.boqItemId)?.description,
  }));
}

/** Computes a revision against the project's current plan. Pure apart from the read. */
function buildPlan(ctx: ScheduleContext, changes: ScheduleChange[]): RevisionPlan {
  const { project, items } = ctx;
  if (project.status !== 'ACTIVE') {
    throw new AppError('Schedule revisions apply to live projects only', 409, 'PROJECT_NOT_ACTIVE');
  }
  if (!project.plannedStartDate) {
    throw new AppError('Set the schedule baseline first', 409, 'SCHEDULE_BASELINE_MISSING');
  }
  const byId = new Map(items.map((i) => [i.id, i]));
  for (const c of changes) {
    const item = byId.get(c.boqItemId);
    if (!item) throw new AppError('A changed item is not in this project', 422, 'BOQ_ITEM_NOT_IN_PROJECT', { boqItemId: c.boqItemId });
    if (!item.plannedStartDate || !item.plannedEndDate) {
      throw new AppError(`WBS ${item.wbsCode} has no planned dates to move`, 422, 'ITEM_NOT_SCHEDULED', { boqItemId: c.boqItemId });
    }
  }
  let adjustments: ScheduleAdjustment[];
  try {
    adjustments = propagateShift(items, toScheduleDependencies(ctx), changes, project.workWeekDays);
  } catch (error) {
    if (error instanceof ScheduleCycleError) {
      throw new AppError('The dependencies form a cycle; fix the baseline first', 422, 'DEPENDENCY_CYCLE', { boqItemIds: error.itemIds });
    }
    throw error;
  }
  if (adjustments.length === 0) {
    throw new AppError('These changes do not move any dates', 422, 'REVISION_NO_CHANGE');
  }
  const after = new Map(adjustments.map((a) => [a.boqItemId, a]));
  const previousEnd = project.currentProjectedEndDate ?? planEndDate(items, project);
  const planEnd = planEndDate(
    items.map((i) => ({ plannedEndDate: after.get(i.id)?.newEndDate ?? i.plannedEndDate })),
    project
  );
  // A plan that ends earlier than the recorded end keeps the recorded end (it is not moved back).
  const newEnd = previousEnd && planEnd && planEnd < previousEnd ? previousEnd : planEnd;
  const endShift = previousEnd && newEnd ? workdaysBetween(previousEnd, newEnd, project.workWeekDays) : 0;
  return {
    adjustments: describeAdjustments(ctx, adjustments),
    rawAdjustments: adjustments,
    previousProjectedEndDate: previousEnd,
    newProjectedEndDate: newEnd,
    endShiftWorkdays: endShift,
    totalShiftedWorkdays: adjustments.reduce((s, a) => s + Math.abs(a.shiftWorkdays), 0),
    requiresApproval: newEnd !== previousEnd,
  };
}

function toChanges(input: PreviewScheduleRevisionRequest['changes']): ScheduleChange[] {
  return input.map((c) => ({ boqItemId: c.boqItemId, newStartDate: c.newStartDate ?? null, shiftWorkdays: c.shiftWorkdays ?? null }));
}

function stripRaw(plan: RevisionPlan): ScheduleRevisionPreviewDto {
  const { rawAdjustments: _raw, ...dto } = plan;
  return dto;
}

/** POST .../schedule/revisions/preview: the propagated plan and the new end. Nothing is saved. */
export async function previewScheduleRevision(projectId: string, input: PreviewScheduleRevisionRequest): Promise<ScheduleRevisionPreviewDto> {
  const ctx = await loadScheduleContext(prisma, projectId);
  return stripRaw(buildPlan(ctx, toChanges(input.changes)));
}

/** Writes the adjustments and the new projected end. Originals are never touched. */
async function applyAdjustments(tx: Tx, projectId: string, adjustments: ScheduleAdjustment[], newEnd: string | null) {
  for (const a of adjustments) {
    await tx.boqItem.update({
      where: { id: a.boqItemId },
      data: { plannedStartDate: a.newStartDate, plannedEndDate: a.newEndDate },
    });
  }
  await tx.project.update({ where: { id: projectId }, data: { currentProjectedEndDate: newEnd } });
}

function parseStored(raw: unknown): StoredRevisionJson {
  const obj = raw && typeof raw === 'object' ? (raw as Partial<StoredRevisionJson>) : {};
  return { changes: Array.isArray(obj.changes) ? obj.changes : [], adjustments: Array.isArray(obj.adjustments) ? obj.adjustments : [] };
}

const REVISION_INCLUDE = {
  initiatedBy: { select: { fullName: true } },
  approvedBy: { select: { fullName: true } },
} satisfies Prisma.ScheduleRevisionInclude;

type RevisionRow = Prisma.ScheduleRevisionGetPayload<{ include: typeof REVISION_INCLUDE }>;

function serializeRevision(row: RevisionRow, webUser: WebJwtPayload, items?: Map<string, { wbsCode: string; description: string }>): ScheduleRevisionDto {
  const stored = parseStored(row.itemAdjustmentsJson);
  return {
    id: row.id,
    projectId: row.projectId,
    revisionNumber: row.revisionNumber,
    status: row.status,
    reason: row.reason,
    initiatedByUserId: row.initiatedByUserId,
    initiatedByName: row.initiatedBy.fullName,
    decidedByUserId: row.approvedByUserId,
    decidedByName: row.approvedBy?.fullName ?? null,
    decisionNotes: row.decisionNotes,
    previousProjectedEndDate: row.previousProjectedEndDate,
    newProjectedEndDate: row.newProjectedEndDate,
    totalShiftedWorkdays: row.totalShiftedWorkdays,
    changes: stored.changes,
    adjustments: stored.adjustments.map((a) => ({
      ...a,
      wbsCode: items?.get(a.boqItemId)?.wbsCode,
      description: items?.get(a.boqItemId)?.description,
    })),
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    canDecide:
      row.status === 'PENDING_APPROVAL' &&
      row.initiatedByUserId !== webUser.userId &&
      hasWebPermission(webUser, 'schedule:approve_refactor'),
    canWithdraw: row.status === 'PENDING_APPROVAL' && row.initiatedByUserId === webUser.userId,
  };
}

export async function listScheduleRevisions(
  projectId: string,
  webUser: WebJwtPayload,
  filter: { status?: ScheduleRevisionStatus } = {}
): Promise<ScheduleRevisionDto[]> {
  const [rows, items] = await Promise.all([
    prisma.scheduleRevision.findMany({
      where: { projectId, ...(filter.status ? { status: filter.status } : {}) },
      include: REVISION_INCLUDE,
      orderBy: { revisionNumber: 'desc' },
      take: 200,
    }),
    prisma.boqItem.findMany({ where: { projectId }, select: { id: true, wbsCode: true, description: true } }),
  ]);
  const byId = new Map(items.map((i) => [i.id, i]));
  return rows.map((r) => serializeRevision(r, webUser, byId));
}

async function getRevisionDto(projectId: string, revisionId: string, webUser: WebJwtPayload) {
  const [row, items] = await Promise.all([
    prisma.scheduleRevision.findFirstOrThrow({ where: { id: revisionId, projectId }, include: REVISION_INCLUDE }),
    prisma.boqItem.findMany({ where: { projectId }, select: { id: true, wbsCode: true, description: true } }),
  ]);
  return serializeRevision(row, webUser, new Map(items.map((i) => [i.id, i])));
}

/**
 * POST .../schedule/revisions: saves the revision. It applies at once when the projected end does
 * not move; otherwise it waits for approval (and approvers are notified).
 */
export async function createScheduleRevision(
  projectId: string,
  webUser: WebJwtPayload,
  input: CreateScheduleRevisionRequest
): Promise<ScheduleRevisionDto> {
  const changes = toChanges(input.changes);
  let revisionId = '';
  let applied = false;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
      const pending = await tx.scheduleRevision.findFirst({ where: { projectId, status: 'PENDING_APPROVAL' }, select: { revisionNumber: true } });
      if (pending) {
        throw new AppError(
          `Revision ${pending.revisionNumber} is waiting for approval. It must be approved or rejected first.`,
          409,
          'SCHEDULE_REVISION_PENDING'
        );
      }
      const ctx = await loadScheduleContext(tx, projectId);
      const plan = buildPlan(ctx, changes);
      const last = await tx.scheduleRevision.aggregate({ where: { projectId }, _max: { revisionNumber: true } });
      const revisionNumber = (last._max.revisionNumber ?? 0) + 1;
      const now = new Date();
      applied = !plan.requiresApproval;
      const stored: StoredRevisionJson = { changes, adjustments: plan.rawAdjustments };
      const revision = await tx.scheduleRevision.create({
        data: {
          projectId,
          revisionNumber,
          initiatedByUserId: webUser.userId,
          status: applied ? 'APPLIED' : 'PENDING_APPROVAL',
          reason: input.reason,
          previousProjectedEndDate: plan.previousProjectedEndDate,
          newProjectedEndDate: plan.newProjectedEndDate,
          totalShiftedWorkdays: plan.totalShiftedWorkdays,
          itemAdjustmentsJson: stored as unknown as Prisma.InputJsonValue,
          decidedAt: applied ? now : null,
        },
      });
      revisionId = revision.id;
      const moved = plan.adjustments.map((a) => `WBS ${a.wbsCode}`).join(', ');
      await recordAuditEvent(tx, {
        projectId,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: actorName(webUser),
        action: 'SCHEDULE_REVISION_PROPOSED',
        summaryText: `Proposed schedule revision ${revisionNumber}: moves ${plan.adjustments.length} item(s) (${moved}); projected end ${plan.previousProjectedEndDate ?? 'none'} to ${plan.newProjectedEndDate ?? 'none'}. Reason: ${input.reason}`,
        payload: {
          scheduleRevisionId: revision.id,
          revisionNumber,
          reason: input.reason,
          requiresApproval: plan.requiresApproval,
          previousProjectedEndDate: plan.previousProjectedEndDate,
          newProjectedEndDate: plan.newProjectedEndDate,
          changes,
          adjustments: plan.rawAdjustments,
        } as unknown as Record<string, unknown>,
      });
      if (applied) {
        await applyAdjustments(tx, projectId, plan.rawAdjustments, plan.newProjectedEndDate);
        await recordAuditEvent(tx, {
          projectId,
          actorType: 'WEB_USER',
          actorId: webUser.userId,
          actorDisplayName: actorName(webUser),
          action: 'SCHEDULE_REVISION_APPLIED',
          summaryText: `Applied schedule revision ${revisionNumber} without approval: the projected end (${plan.newProjectedEndDate ?? 'none'}) did not move.`,
          payload: { scheduleRevisionId: revision.id, revisionNumber, approvedByUserId: null, adjustments: plan.rawAdjustments } as unknown as Record<string, unknown>,
        });
      } else {
        await createWebNotification(tx, {
          projectId,
          targetPermissionKey: 'schedule:approve_refactor',
          category: 'SCHEDULE_REVISION_PENDING',
          title: `Schedule revision ${revisionNumber} needs approval`,
          description: `${webUser.fullName} proposes moving the projected end from ${plan.previousProjectedEndDate} to ${plan.newProjectedEndDate} (${plan.adjustments.length} item(s)).`,
          actionUrl: `/app/projects/${projectId}/schedule?revision=${revision.id}`,
          metadata: { scheduleRevisionId: revision.id, revisionNumber },
        });
      }
    });
  } catch (error) {
    // Two proposals racing past the check: the partial unique index stops the second.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError('Another revision is waiting for approval', 409, 'SCHEDULE_REVISION_PENDING');
    }
    throw error;
  }
  if (applied) await refreshScheduleBadge(projectId);
  return getRevisionDto(projectId, revisionId, webUser);
}

async function lockPendingRevision(tx: Tx, projectId: string, revisionId: string, webUser: WebJwtPayload) {
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
  const revision = await tx.scheduleRevision.findFirst({ where: { id: revisionId, projectId } });
  if (!revision) throw new AppError('Schedule revision not found', 404, 'SCHEDULE_REVISION_NOT_FOUND');
  if (revision.status !== 'PENDING_APPROVAL') {
    throw new AppError('This revision is not waiting for approval', 409, 'SCHEDULE_REVISION_NOT_PENDING', { status: revision.status });
  }
  if (revision.initiatedByUserId === webUser.userId) {
    throw new AppError('A revision must be decided by someone other than the person who proposed it', 403, 'SCHEDULE_REVISION_SAME_PERSON');
  }
  return revision;
}

/** POST .../schedule/revisions/:revisionId/approve (schedule:approve_refactor, not the initiator). */
export async function approveScheduleRevision(
  projectId: string,
  revisionId: string,
  webUser: WebJwtPayload,
  input: DecideScheduleRevisionRequest
): Promise<ScheduleRevisionDto> {
  await prisma.$transaction(async (tx) => {
    const revision = await lockPendingRevision(tx, projectId, revisionId, webUser);
    const stored = parseStored(revision.itemAdjustmentsJson);
    const ids = stored.adjustments.map((a) => a.boqItemId);
    const current = new Map(
      (await tx.boqItem.findMany({ where: { projectId, id: { in: ids } }, select: { id: true, plannedStartDate: true, plannedEndDate: true } })).map(
        (i) => [i.id, i]
      )
    );
    const stale = stored.adjustments.filter((a) => {
      const c = current.get(a.boqItemId);
      return !c || c.plannedStartDate !== a.previousStartDate || c.plannedEndDate !== a.previousEndDate;
    });
    if (stale.length > 0) {
      throw new AppError(
        'The schedule changed after this revision was proposed. Reject it and propose a new one.',
        409,
        'SCHEDULE_REVISION_STALE',
        { boqItemIds: stale.map((s) => s.boqItemId) }
      );
    }
    await applyAdjustments(tx, projectId, stored.adjustments, revision.newProjectedEndDate);
    const now = new Date();
    await tx.scheduleRevision.update({
      where: { id: revision.id },
      data: { status: 'APPLIED', approvedByUserId: webUser.userId, decidedAt: now, decisionNotes: input.notes ?? null },
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'SCHEDULE_REVISION_APPLIED',
      summaryText: `Approved and applied schedule revision ${revision.revisionNumber}: ${stored.adjustments.length} item(s) moved; projected end ${revision.previousProjectedEndDate} to ${revision.newProjectedEndDate}.`,
      payload: {
        scheduleRevisionId: revision.id,
        revisionNumber: revision.revisionNumber,
        approvedByUserId: webUser.userId,
        initiatedByUserId: revision.initiatedByUserId,
        notes: input.notes ?? null,
        adjustments: stored.adjustments,
      } as unknown as Record<string, unknown>,
    });
    await createWebNotification(tx, {
      projectId,
      targetPermissionKey: 'schedule:catch_up_refactor',
      category: 'SCHEDULE_REVISION_DECIDED',
      title: `Schedule revision ${revision.revisionNumber} approved`,
      description: `${webUser.fullName} approved it. The projected end is now ${revision.newProjectedEndDate}.`,
      actionUrl: `/app/projects/${projectId}/schedule?revision=${revision.id}`,
      metadata: { scheduleRevisionId: revision.id, decision: 'APPLIED' },
    });
  });
  await refreshScheduleBadge(projectId);
  return getRevisionDto(projectId, revisionId, webUser);
}

/** POST .../schedule/revisions/:revisionId/reject (schedule:approve_refactor, not the initiator). */
export async function rejectScheduleRevision(
  projectId: string,
  revisionId: string,
  webUser: WebJwtPayload,
  input: DecideScheduleRevisionRequest
): Promise<ScheduleRevisionDto> {
  await prisma.$transaction(async (tx) => {
    const revision = await lockPendingRevision(tx, projectId, revisionId, webUser);
    await tx.scheduleRevision.update({
      where: { id: revision.id },
      data: { status: 'REJECTED', approvedByUserId: webUser.userId, decidedAt: new Date(), decisionNotes: input.notes ?? null },
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'SCHEDULE_REVISION_REJECTED',
      summaryText: `Rejected schedule revision ${revision.revisionNumber}${input.notes ? `: ${input.notes}` : ''}. No dates changed.`,
      payload: { scheduleRevisionId: revision.id, revisionNumber: revision.revisionNumber, notes: input.notes ?? null },
    });
    await createWebNotification(tx, {
      projectId,
      targetPermissionKey: 'schedule:catch_up_refactor',
      category: 'SCHEDULE_REVISION_DECIDED',
      title: `Schedule revision ${revision.revisionNumber} rejected`,
      description: `${webUser.fullName} rejected it${input.notes ? `: ${input.notes}` : ''}.`,
      actionUrl: `/app/projects/${projectId}/schedule?revision=${revision.id}`,
      metadata: { scheduleRevisionId: revision.id, decision: 'REJECTED' },
    });
  });
  return getRevisionDto(projectId, revisionId, webUser);
}

/**
 * POST .../schedule/revisions/:revisionId/withdraw: the proposer takes back a pending revision
 * before anyone decides it. No dates change; approvers are told it no longer needs a decision.
 */
export async function withdrawScheduleRevision(
  projectId: string,
  revisionId: string,
  webUser: WebJwtPayload,
  input: DecideScheduleRevisionRequest
): Promise<ScheduleRevisionDto> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
    const revision = await tx.scheduleRevision.findFirst({ where: { id: revisionId, projectId } });
    if (!revision) throw new AppError('Schedule revision not found', 404, 'SCHEDULE_REVISION_NOT_FOUND');
    if (revision.status !== 'PENDING_APPROVAL') {
      throw new AppError('Only a revision waiting for approval can be withdrawn', 409, 'SCHEDULE_REVISION_NOT_PENDING', { status: revision.status });
    }
    if (revision.initiatedByUserId !== webUser.userId) {
      throw new AppError('Only the person who proposed this revision can withdraw it', 403, 'SCHEDULE_REVISION_NOT_INITIATOR');
    }
    await tx.scheduleRevision.update({
      where: { id: revision.id },
      data: { status: 'WITHDRAWN', decidedAt: new Date(), decisionNotes: input.notes ?? null },
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'SCHEDULE_REVISION_WITHDRAWN',
      summaryText: `Withdrew schedule revision ${revision.revisionNumber}${input.notes ? `: ${input.notes}` : ''}. No dates changed.`,
      payload: { scheduleRevisionId: revision.id, revisionNumber: revision.revisionNumber, notes: input.notes ?? null },
    });
    await createWebNotification(tx, {
      projectId,
      targetPermissionKey: 'schedule:approve_refactor',
      category: 'SCHEDULE_REVISION_DECIDED',
      title: `Schedule revision ${revision.revisionNumber} withdrawn`,
      description: `${webUser.fullName} withdrew it; it no longer needs a decision.`,
      actionUrl: `/app/projects/${projectId}/schedule?revision=${revision.id}`,
      metadata: { scheduleRevisionId: revision.id, decision: 'WITHDRAWN' },
    });
  });
  return getRevisionDto(projectId, revisionId, webUser);
}
