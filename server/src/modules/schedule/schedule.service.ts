import { Prisma, PrismaClient } from '@prisma/client';
import { ScheduleStatusValue, ScheduleVarianceBadge, SCHEDULE_STATUS_META, sprintScheduleStatus, zonedCalendarDate } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';

type Tx = Prisma.TransactionClient;
type Db = Tx | PrismaClient;

/**
 * The project schedule badge and actual dates. Redesign R2d removed the Phase 9 baseline,
 * earned-schedule variance, dependencies and revisions: the badge follows sprints (D-R2.15,
 * `sprintScheduleStatus` in @insite/shared) and is stored by the schedule-variance job.
 */

export function projectToday(project: { timezone: string }, now: Date = new Date()): string {
  return zonedCalendarDate(now, project.timezone);
}

/** The stored badge as a DTO (null when the project has never been computed). */
export function serializeScheduleBadge(project: { scheduleStatus: string | null; scheduleVarianceComputedAt: Date | null }): ScheduleVarianceBadge | null {
  if (!project.scheduleStatus) return null;
  const status = project.scheduleStatus as ScheduleStatusValue;
  return {
    status,
    label: SCHEDULE_STATUS_META[status]?.label ?? status,
    computedAt: project.scheduleVarianceComputedAt?.toISOString() ?? null,
  };
}

/**
 * Recomputes and stores a project's badge from its sprints, units and line progress. Returns the
 * status and how many units are late (units whose end sprint has ended with a line below 100%).
 */
export async function refreshScheduleBadge(
  projectId: string,
  now: Date = new Date(),
  db: Db = prisma
): Promise<{ status: ScheduleStatusValue; behindUnitCount: number; scheduleBehindAlertedAt: Date | null }> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true, timezone: true } });
  if (!project) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  const [sprints, units, lines] = await Promise.all([
    db.projectSprint.findMany({ where: { projectId }, select: { number: true, startDate: true, endDate: true } }),
    db.facilityUnit.findMany({ where: { projectId }, select: { id: true, endSprint: { select: { number: true } } } }),
    db.boqItem.findMany({ where: { projectId }, select: { facilityUnitId: true, cumulativeCertifiedPct: true } }),
  ]);
  const incompleteUnits = new Set(lines.filter((l) => l.facilityUnitId && Number(l.cumulativeCertifiedPct) < 100).map((l) => l.facilityUnitId!));
  const { status, behindUnitCount } = sprintScheduleStatus({
    today: projectToday(project, now),
    sprints,
    units: units.map((u) => ({ endSprintNumber: u.endSprint?.number ?? null, complete: !incompleteUnits.has(u.id) })),
    lineCount: lines.length,
    allLinesComplete: lines.every((l) => Number(l.cumulativeCertifiedPct) >= 100),
  });
  const saved = await db.project.update({
    where: { id: projectId },
    data: { scheduleStatus: status, scheduleVarianceComputedAt: now },
    select: { scheduleBehindAlertedAt: true },
  });
  return { status, behindUnitCount, scheduleBehindAlertedAt: saved.scheduleBehindAlertedAt };
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
