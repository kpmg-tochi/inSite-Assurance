import { formatVariance, SCHEDULE_BEHIND_ALERT_WEEKS, workWeekLength, zonedCalendarDate } from '@insite/shared';
import { prisma } from '../config/prisma';
import { createWebNotification } from '../modules/notifications/notifications.service';
import { refreshScheduleBadge } from '../modules/schedule/schedule.service';
import { LIVE_PROJECT_WHERE } from './cadenceJobs';
import { JobContext, registerJob, runUnit } from './runner';

/**
 * schedule-variance (Phase 9): once a day per live project (keyed on the project's calendar day),
 * recompute and store the variance badge. When a project first falls SCHEDULE_BEHIND_ALERT_WEEKS
 * working weeks behind, users with schedule:view_variance get a web notification; the flag clears
 * when the project recovers, so a later fall alerts again.
 */
export async function runScheduleVariance({ now }: JobContext): Promise<void> {
  const projects = await prisma.project.findMany({
    where: { ...LIVE_PROJECT_WHERE, plannedStartDate: { not: null } },
    select: { id: true, name: true, codePrefix: true, timezone: true },
  });
  for (const p of projects) {
    const today = zonedCalendarDate(now, p.timezone);
    await runUnit('schedule-variance', `${p.id}:${today}`, async () => {
      const { status, varianceWorkdays, project } = await refreshScheduleBadge(p.id, now);
      const threshold = SCHEDULE_BEHIND_ALERT_WEEKS * workWeekLength(project.workWeekDays);
      const behind = varianceWorkdays !== null && status === 'BEHIND' && -varianceWorkdays >= threshold;
      if (behind && !project.scheduleBehindAlertedAt) {
        const label = formatVariance(varianceWorkdays, project.workWeekDays);
        await prisma.$transaction(async (tx) => {
          const claimed = await tx.project.updateMany({
            where: { id: p.id, scheduleBehindAlertedAt: null },
            data: { scheduleBehindAlertedAt: now },
          });
          if (claimed.count === 0) return;
          await createWebNotification(tx, {
            projectId: p.id,
            targetPermissionKey: 'schedule:view_variance',
            category: 'SCHEDULE_BEHIND',
            title: `${p.codePrefix} is ${label}`,
            description: `${p.name} has fallen ${label} on certified progress. Review the schedule or propose a catch-up revision.`,
            actionUrl: `/app/projects/${p.id}/schedule`,
            metadata: { varianceWorkdays, status },
          });
        });
        return `${status} ${varianceWorkdays?.toFixed(1)}; alerted`;
      }
      if (!behind && project.scheduleBehindAlertedAt) {
        await prisma.project.update({ where: { id: p.id }, data: { scheduleBehindAlertedAt: null } });
      }
      return `${status} ${varianceWorkdays === null ? 'n/a' : varianceWorkdays.toFixed(1)}`;
    });
  }
}

export function registerScheduleJobs(): void {
  registerJob({ name: 'schedule-variance', intervalMs: 60 * 60 * 1000, run: runScheduleVariance });
}
