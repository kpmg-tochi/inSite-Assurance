import { Prisma, PrismaClient } from '@prisma/client';
import {
  formatVariance,
  itemVariance,
  plannedDurationWorkdays,
  ProjectScheduleDto,
  ProposeScheduleDatesRequest,
  proposeItemDates,
  projectVariance,
  roundToHalfWeekWorkdays,
  SaveScheduleBaselineRequest,
  ScheduleDependency,
  ScheduleStatusValue,
  ScheduleVarianceBadge,
  validateScheduleBaseline,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { getReportedProgressByItem } from '../evidence/evidenceProvider';
import { markStepSaved } from '../projects/projectSetup.service';
import { autoCompleteMilestones, webActor } from '../contracts/milestones.service';
import { listScheduleRevisions } from './scheduleRevision.service';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;

/**
 * Schedule baseline, variance and actual dates (Phase 9). The maths is in @insite/shared
 * (utils/schedule.ts); this file loads projects onto it, validates and saves baselines, and keeps
 * the stored variance badge current.
 */

export const SCHEDULE_PROJECT_SELECT = {
  id: true,
  status: true,
  timezone: true,
  workWeekDays: true,
  certifiedProgressPct: true,
  plannedStartDate: true,
  plannedEndDate: true,
  originalPlannedEndDate: true,
  currentProjectedEndDate: true,
  actualStartDate: true,
  scheduleStatus: true,
  scheduleVarianceWorkdays: true,
  scheduleVarianceComputedAt: true,
  scheduleBehindAlertedAt: true,
} satisfies Prisma.ProjectSelect;

const SCHEDULE_ITEM_SELECT = {
  id: true,
  wbsCode: true,
  section: true,
  description: true,
  totalQuantity: true,
  budgetedCostNgn: true,
  dailyTargetQuantity: true,
  isHoldPoint: true,
  planningTier: true,
  projectContractorId: true,
  cumulativeCertifiedPct: true,
  plannedStartDate: true,
  plannedEndDate: true,
  originalPlannedStartDate: true,
  originalPlannedEndDate: true,
  actualStartDate: true,
  actualCompletionDate: true,
} satisfies Prisma.BoqItemSelect;

export type ScheduleProjectRow = Prisma.ProjectGetPayload<{ select: typeof SCHEDULE_PROJECT_SELECT }>;
export type ScheduleItemRow = Prisma.BoqItemGetPayload<{ select: typeof SCHEDULE_ITEM_SELECT }>;

export interface ScheduleContext {
  project: ScheduleProjectRow;
  items: ScheduleItemRow[];
  dependencies: Array<{ id: string; predecessorBoqItemId: string; successorBoqItemId: string; lagWorkdays: number }>;
}

function actorName(webUser: WebJwtPayload) {
  return `${webUser.fullName} (${webUser.roleName})`;
}

export function projectToday(project: { timezone: string }, now: Date = new Date()): string {
  return zonedCalendarDate(now, project.timezone);
}

export async function loadScheduleContext(db: Db, projectId: string): Promise<ScheduleContext> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: SCHEDULE_PROJECT_SELECT });
  if (!project) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  const [items, dependencies] = await Promise.all([
    db.boqItem.findMany({ where: { projectId }, select: SCHEDULE_ITEM_SELECT, orderBy: { wbsCode: 'asc' } }),
    db.boqItemDependency.findMany({
      where: { projectId },
      select: { id: true, predecessorBoqItemId: true, successorBoqItemId: true, lagWorkdays: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  return { project, items, dependencies };
}

export function toScheduleDependencies(ctx: Pick<ScheduleContext, 'dependencies'>): ScheduleDependency[] {
  return ctx.dependencies.map((d) => ({
    predecessorId: d.predecessorBoqItemId,
    successorId: d.successorBoqItemId,
    lagWorkdays: d.lagWorkdays,
  }));
}

/** End of the current plan: the latest dated item's end, else the project's planned end. */
export function planEndDate(
  items: Array<{ plannedEndDate: string | null }>,
  project: { plannedEndDate: string | null }
): string | null {
  const ends = items.map((i) => i.plannedEndDate).filter((d): d is string => Boolean(d)).sort();
  return ends.length > 0 ? ends[ends.length - 1] : project.plannedEndDate;
}

/** A live project whose baseline is set: dated items then only move through a revision. */
export function isBaselineLocked(project: { status: string; plannedStartDate: string | null }): boolean {
  return project.status !== 'DRAFT' && Boolean(project.plannedStartDate);
}

// ---------------------------------------------------------------------------
// Variance
// ---------------------------------------------------------------------------

interface ComputedVariance {
  today: string;
  reported: Map<string, number>;
  certified: ReturnType<typeof projectVariance>;
  reportedRollup: ReturnType<typeof projectVariance>;
  reportedProgressPct: number;
}

async function computeVariance(db: Db, ctx: ScheduleContext, now: Date): Promise<ComputedVariance> {
  const { project, items } = ctx;
  const today = projectToday(project, now);
  const reported = await getReportedProgressByItem(
    project.id,
    items.map((i) => ({ id: i.id, totalQuantity: Number(i.totalQuantity) })),
    db
  );
  const deps = toScheduleDependencies(ctx);
  const base = items.map((i) => ({
    id: i.id,
    plannedStartDate: i.plannedStartDate,
    plannedEndDate: i.plannedEndDate,
    weight: Number(i.budgetedCostNgn),
    actualCompletionDate: i.actualCompletionDate,
  }));
  const certified = projectVariance(
    base.map((b, idx) => ({ ...b, progressPct: Number(items[idx].cumulativeCertifiedPct) })),
    today,
    project.workWeekDays,
    deps
  );
  const reportedRollup = projectVariance(
    base.map((b, idx) => ({
      ...b,
      // Reported progress never trails certified progress.
      progressPct: Math.max(reported.get(items[idx].id) ?? 0, Number(items[idx].cumulativeCertifiedPct)),
      actualCompletionDate: null,
    })),
    today,
    project.workWeekDays,
    deps
  );
  const totalBudget = items.reduce((s, i) => s + Number(i.budgetedCostNgn), 0);
  const reportedProgressPct =
    totalBudget > 0
      ? items.reduce(
          (s, i) => s + Number(i.budgetedCostNgn) * Math.max(reported.get(i.id) ?? 0, Number(i.cumulativeCertifiedPct)),
          0
        ) / totalBudget
      : 0;
  return { today, reported, certified, reportedRollup, reportedProgressPct: Math.round(reportedProgressPct * 100) / 100 };
}

function rounded(workdays: number | null, workWeekDays: number[]): number | null {
  return workdays === null ? null : roundToHalfWeekWorkdays(workdays, workWeekDays);
}

/** The stored badge as a DTO (null when the project has never been computed). */
export function serializeScheduleBadge(project: {
  scheduleStatus: string | null;
  scheduleVarianceWorkdays: number | null;
  scheduleVarianceComputedAt: Date | null;
  workWeekDays: number[];
}): ScheduleVarianceBadge | null {
  if (!project.scheduleStatus) return null;
  return {
    status: project.scheduleStatus as ScheduleStatusValue,
    varianceWorkdays: project.scheduleVarianceWorkdays,
    label:
      project.scheduleStatus === 'UNSCHEDULED'
        ? 'No schedule'
        : project.scheduleStatus === 'NOT_STARTED'
          ? 'Not started'
          : formatVariance(project.scheduleVarianceWorkdays, project.workWeekDays),
    computedAt: project.scheduleVarianceComputedAt?.toISOString() ?? null,
  };
}

/**
 * Recomputes and stores a project's variance badge (certified progress). Returns the new badge and
 * the unrounded variance so the job can decide on alerts.
 */
export async function refreshScheduleBadge(
  projectId: string,
  now: Date = new Date(),
  db: Db = prisma
): Promise<{ status: ScheduleStatusValue; varianceWorkdays: number | null; project: ScheduleProjectRow }> {
  const ctx = await loadScheduleContext(db, projectId);
  const v = await computeVariance(db, ctx, now);
  const status = (ctx.project.plannedStartDate || v.certified.scheduledItemCount > 0 ? v.certified.status : 'UNSCHEDULED') as ScheduleStatusValue;
  const variance = rounded(v.certified.varianceWorkdays, ctx.project.workWeekDays);
  const project = await db.project.update({
    where: { id: projectId },
    data: { scheduleStatus: status, scheduleVarianceWorkdays: variance, scheduleVarianceComputedAt: now },
    select: SCHEDULE_PROJECT_SELECT,
  });
  return { status, varianceWorkdays: v.certified.varianceWorkdays, project };
}

// ---------------------------------------------------------------------------
// Schedule view
// ---------------------------------------------------------------------------

export async function getProjectSchedule(
  projectId: string,
  webUser: WebJwtPayload,
  now: Date = new Date()
): Promise<ProjectScheduleDto> {
  const ctx = await loadScheduleContext(prisma, projectId);
  const { project, items } = ctx;
  const v = await computeVariance(prisma, ctx, now);
  const week = project.workWeekDays;
  const preds = new Map<string, string[]>();
  for (const d of ctx.dependencies) preds.set(d.successorBoqItemId, [...(preds.get(d.successorBoqItemId) ?? []), d.predecessorBoqItemId]);

  const itemDtos = items.map((i) => {
    const certifiedPct = Number(i.cumulativeCertifiedPct);
    const reportedPct = Math.max(v.reported.get(i.id) ?? 0, certifiedPct);
    const scheduled = { id: i.id, plannedStartDate: i.plannedStartDate, plannedEndDate: i.plannedEndDate, actualCompletionDate: i.actualCompletionDate };
    const cert = itemVariance(scheduled, certifiedPct, v.today, week);
    const rep = itemVariance({ ...scheduled, actualCompletionDate: null }, reportedPct, v.today, week);
    return {
      id: i.id,
      wbsCode: i.wbsCode,
      section: i.section,
      description: i.description,
      budgetedCostNgn: Number(i.budgetedCostNgn),
      isHoldPoint: i.isHoldPoint,
      plannedStartDate: i.plannedStartDate,
      plannedEndDate: i.plannedEndDate,
      originalPlannedStartDate: i.originalPlannedStartDate,
      originalPlannedEndDate: i.originalPlannedEndDate,
      actualStartDate: i.actualStartDate,
      actualCompletionDate: i.actualCompletionDate,
      durationWorkdays: plannedDurationWorkdays(i, week),
      certifiedProgressPct: certifiedPct,
      reportedProgressPct: Math.round(reportedPct * 100) / 100,
      expectedPct: Math.round(cert.expectedPct * 100) / 100,
      status: cert.status,
      varianceWorkdays: rounded(cert.varianceWorkdays, week),
      varianceLabel: cert.status === 'UNSCHEDULED' ? 'Not scheduled' : formatVariance(cert.varianceWorkdays, week),
      reportedStatus: rep.status,
      reportedVarianceWorkdays: rounded(rep.varianceWorkdays, week),
      reportedVarianceLabel: rep.status === 'UNSCHEDULED' ? 'Not scheduled' : formatVariance(rep.varianceWorkdays, week),
      predecessorIds: preds.get(i.id) ?? [],
    };
  });

  const pending = (await listScheduleRevisions(projectId, webUser, { status: 'PENDING_APPROVAL' }))[0] ?? null;
  const certifiedStatus = v.certified.status;
  return {
    projectId,
    projectStatus: project.status,
    today: v.today,
    timezone: project.timezone,
    workWeekDays: week,
    summary: {
      hasBaseline: Boolean(project.plannedStartDate),
      plannedStartDate: project.plannedStartDate,
      plannedEndDate: project.plannedEndDate,
      originalPlannedEndDate: project.originalPlannedEndDate,
      currentProjectedEndDate: project.currentProjectedEndDate ?? planEndDate(items, project),
      forecastEndDate: v.certified.forecastEndDate,
      forecastSlipWorkdays: v.certified.forecastSlipWorkdays,
      actualStartDate: project.actualStartDate,
      certifiedProgressPct: Number(project.certifiedProgressPct),
      reportedProgressPct: v.reportedProgressPct,
      status: certifiedStatus,
      varianceWorkdays: rounded(v.certified.varianceWorkdays, week),
      varianceLabel:
        certifiedStatus === 'UNSCHEDULED' ? 'No schedule' : certifiedStatus === 'NOT_STARTED' ? 'Not started' : formatVariance(v.certified.varianceWorkdays, week),
      reportedStatus: v.reportedRollup.status,
      reportedVarianceWorkdays: rounded(v.reportedRollup.varianceWorkdays, week),
      reportedVarianceLabel:
        v.reportedRollup.status === 'UNSCHEDULED'
          ? 'No schedule'
          : v.reportedRollup.status === 'NOT_STARTED'
            ? 'Not started'
            : formatVariance(v.reportedRollup.varianceWorkdays, week),
      scheduledItemCount: v.certified.scheduledItemCount,
      unscheduledItemCount: items.length - v.certified.scheduledItemCount,
    },
    items: itemDtos,
    dependencies: ctx.dependencies.map((d) => ({
      id: d.id,
      predecessorBoqItemId: d.predecessorBoqItemId,
      successorBoqItemId: d.successorBoqItemId,
      lagWorkdays: d.lagWorkdays,
    })),
    pendingRevision: pending,
    baselineLocked: isBaselineLocked(project),
  };
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------

/**
 * Saves project dates, item dates and the dependency list (projects:edit_baseline).
 * - Draft: anything may change; the original baseline follows the planned dates until activation.
 * - Live with a baseline: project dates and existing item dates are locked (they move only through
 *   a "Catch Project Up" revision). Items without dates may be dated (e.g. after a BOQ revision) and
 *   dependencies may change, as long as the result is valid.
 * Validation: items inside the project dates, successors after predecessors plus lag, no cycles.
 * Every save writes SCHEDULE_BASELINE_SET; the payload says whether it was the first.
 */
export async function saveScheduleBaseline(projectId: string, webUser: WebJwtPayload, input: SaveScheduleBaselineRequest) {
  await prisma.$transaction(async (tx) => applyScheduleBaseline(tx, projectId, webUser, input));
  await refreshScheduleBadge(projectId);
  return getProjectSchedule(projectId, webUser);
}

/**
 * Saves the baseline inside the caller's transaction (Phase 13: also used when a programme of works
 * is accepted). Completes the project-level AUTO_SCHEDULE_BASELINE_SET contract milestones.
 */
export async function applyScheduleBaseline(tx: Tx, projectId: string, webUser: WebJwtPayload, input: SaveScheduleBaselineRequest) {
  {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
    const ctx = await loadScheduleContext(tx, projectId);
    const { project, items } = ctx;
    const byId = new Map(items.map((i) => [i.id, i]));
    const locked = isBaselineLocked(project);
    const firstBaseline = !project.plannedStartDate;

    const unknown = [
      ...input.items.map((i) => i.boqItemId),
      ...input.dependencies.flatMap((d) => [d.predecessorBoqItemId, d.successorBoqItemId]),
    ].filter((id) => !byId.has(id));
    if (unknown.length > 0) {
      throw new AppError('Some BOQ items are not in this project', 422, 'BOQ_ITEM_NOT_IN_PROJECT', { boqItemIds: [...new Set(unknown)] });
    }
    if (new Set(input.items.map((i) => i.boqItemId)).size !== input.items.length) {
      throw new AppError('Each item can be listed once', 422, 'DUPLICATE_ITEM');
    }

    if (locked) {
      if (input.plannedStartDate !== project.plannedStartDate || input.plannedEndDate !== project.plannedEndDate) {
        throw new AppError(
          'The project dates are part of the live baseline. Use "Catch Project Up" to move the schedule.',
          409,
          'SCHEDULE_BASELINE_LOCKED'
        );
      }
      const moved = input.items.filter((i) => {
        const current = byId.get(i.boqItemId)!;
        if (!current.plannedStartDate && !current.plannedEndDate) return false;
        return current.plannedStartDate !== i.plannedStartDate || current.plannedEndDate !== i.plannedEndDate;
      });
      if (moved.length > 0) {
        throw new AppError(
          'Dated items on a live project move only through "Catch Project Up".',
          409,
          'SCHEDULE_BASELINE_LOCKED',
          { boqItemIds: moved.map((m) => m.boqItemId) }
        );
      }
    }

    const nextDates = new Map(items.map((i) => [i.id, { plannedStartDate: i.plannedStartDate, plannedEndDate: i.plannedEndDate }]));
    for (const i of input.items) nextDates.set(i.boqItemId, { plannedStartDate: i.plannedStartDate, plannedEndDate: i.plannedEndDate });
    const merged = items.map((i) => ({ id: i.id, label: `WBS ${i.wbsCode}`, ...nextDates.get(i.id)! }));
    const deps = input.dependencies.map((d) => ({
      predecessorId: d.predecessorBoqItemId,
      successorId: d.successorBoqItemId,
      lagWorkdays: d.lagWorkdays ?? 0,
    }));
    // After a revision, a live plan may run past the original project end.
    const windowEnd =
      locked && project.currentProjectedEndDate && project.currentProjectedEndDate > input.plannedEndDate
        ? project.currentProjectedEndDate
        : input.plannedEndDate;
    const issues = validateScheduleBaseline({
      plannedStartDate: input.plannedStartDate,
      plannedEndDate: windowEnd,
      items: merged,
      dependencies: deps,
      workWeekDays: project.workWeekDays,
    });
    if (issues.length > 0) {
      throw new AppError(issues[0].message, 422, 'SCHEDULE_BASELINE_INVALID', { issues });
    }

    let changedItemCount = 0;
    for (const i of input.items) {
      const current = byId.get(i.boqItemId)!;
      const changed = current.plannedStartDate !== i.plannedStartDate || current.plannedEndDate !== i.plannedEndDate;
      // Draft: the original follows the plan. Live: set once, never overwritten.
      const original =
        project.status === 'DRAFT'
          ? { originalPlannedStartDate: i.plannedStartDate, originalPlannedEndDate: i.plannedEndDate }
          : current.originalPlannedStartDate
            ? {}
            : { originalPlannedStartDate: i.plannedStartDate, originalPlannedEndDate: i.plannedEndDate };
      if (!changed && Object.keys(original).length === 0) continue;
      await tx.boqItem.update({
        where: { id: i.boqItemId },
        data: { plannedStartDate: i.plannedStartDate, plannedEndDate: i.plannedEndDate, ...original },
      });
      changedItemCount += 1;
    }

    await tx.boqItemDependency.deleteMany({ where: { projectId } });
    if (input.dependencies.length > 0) {
      await tx.boqItemDependency.createMany({
        data: input.dependencies.map((d) => ({
          projectId,
          predecessorBoqItemId: d.predecessorBoqItemId,
          successorBoqItemId: d.successorBoqItemId,
          lagWorkdays: d.lagWorkdays ?? 0,
        })),
      });
    }

    const currentEnd = planEndDate(merged, { plannedEndDate: input.plannedEndDate });
    await tx.project.update({
      where: { id: projectId },
      data: {
        plannedStartDate: input.plannedStartDate,
        plannedEndDate: input.plannedEndDate,
        originalPlannedEndDate: project.status === 'DRAFT' ? input.plannedEndDate : project.originalPlannedEndDate ?? input.plannedEndDate,
        currentProjectedEndDate: locked && project.currentProjectedEndDate && project.currentProjectedEndDate > (currentEnd ?? '') ? project.currentProjectedEndDate : currentEnd,
      },
    });

    const scheduledCount = merged.filter((m) => m.plannedStartDate && m.plannedEndDate).length;
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'SCHEDULE_BASELINE_SET',
      summaryText: `${firstBaseline ? 'Set the schedule baseline' : 'Updated the schedule baseline'}: ${input.plannedStartDate} to ${input.plannedEndDate}, ${scheduledCount} of ${items.length} item(s) dated, ${input.dependencies.length} dependency link(s).`,
      payload: {
        firstBaseline,
        projectStatus: project.status,
        plannedStartDate: input.plannedStartDate,
        plannedEndDate: input.plannedEndDate,
        changedItemCount,
        scheduledItemCount: scheduledCount,
        dependencyCount: input.dependencies.length,
        currentProjectedEndDate: currentEnd,
      },
    });
    await markStepSaved(tx, projectId, 'schedule', webUser.userId);
    await autoCompleteMilestones(tx, {
      projectId,
      mode: 'AUTO_SCHEDULE_BASELINE_SET',
      onlyProjectLevel: true,
      at: new Date(),
      notes: `Schedule baseline set: ${input.plannedStartDate} to ${input.plannedEndDate}.`,
      actor: webActor(webUser),
    });
  }
}

/** Suggested item dates between the given project dates (nothing is saved). */
export async function proposeScheduleDates(projectId: string, input: ProposeScheduleDatesRequest) {
  if (input.plannedEndDate < input.plannedStartDate) {
    throw new AppError('The end date is before the start date', 422, 'SCHEDULE_BASELINE_INVALID');
  }
  const ctx = await loadScheduleContext(prisma, projectId);
  const wanted = input.boqItemIds ? new Set(input.boqItemIds) : null;
  const items = ctx.items
    .filter((i) => !wanted || wanted.has(i.id))
    .map((i) => ({
      id: i.id,
      section: i.section,
      totalQuantity: Number(i.totalQuantity),
      dailyTargetQuantity: i.dailyTargetQuantity ? Number(i.dailyTargetQuantity) : null,
      budgetedCostNgn: Number(i.budgetedCostNgn),
    }));
  return { items: proposeItemDates(items, input.plannedStartDate, input.plannedEndDate, ctx.project.workWeekDays) };
}

// ---------------------------------------------------------------------------
// Actual dates
// ---------------------------------------------------------------------------

/**
 * Records that work on an item started: called when a report on it becomes counted evidence
 * (confirmed, approved, or released). Keeps the earliest workday; also sets the project's start.
 */
export async function recordItemActualStart(tx: Tx, projectId: string, boqItemId: string, workdayDate: string) {
  await tx.boqItem.updateMany({
    where: { id: boqItemId, projectId, OR: [{ actualStartDate: null }, { actualStartDate: { gt: workdayDate } }] },
    data: { actualStartDate: workdayDate },
  });
  await tx.project.updateMany({
    where: { id: projectId, OR: [{ actualStartDate: null }, { actualStartDate: { gt: workdayDate } }] },
    data: { actualStartDate: workdayDate },
  });
}

/**
 * Keeps actualCompletionDate in step with progress: set (today, project zone) when an item reaches
 * 100%, cleared if it falls back below 100. Called from refreshProjectProgress (modules/progress).
 */
export async function syncActualCompletionDates(tx: Tx, projectId: string, now: Date = new Date()) {
  const project = await tx.project.findUnique({ where: { id: projectId }, select: { timezone: true } });
  if (!project) return;
  const today = projectToday(project, now);
  await tx.boqItem.updateMany({
    where: { projectId, cumulativeCertifiedPct: { gte: 100 }, actualCompletionDate: null },
    data: { actualCompletionDate: today },
  });
  await tx.boqItem.updateMany({
    where: { projectId, cumulativeCertifiedPct: { lt: 100 }, actualCompletionDate: { not: null } },
    data: { actualCompletionDate: null },
  });
}
