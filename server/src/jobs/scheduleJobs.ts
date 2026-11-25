import { zonedCalendarDate } from '@insite/shared';
import { prisma } from '../config/prisma';
import { createWebNotification } from '../modules/notifications/notifications.service';
import { refreshScheduleBadge } from '../modules/schedule/schedule.service';
import { LIVE_PROJECT_WHERE } from './cadenceJobs';
import { JobContext, registerJob, runUnit } from './runner';

/**
 * schedule-variance: once a day per live project (keyed on the project's calendar day), recompute
 * and store the schedule badge from sprints (redesign R2d, D-R2.15). When a project first falls
 * BEHIND (a unit whose end sprint has ended still has a line below 100%), users with
 * sprints:view_status get a web notification; the flag clears when the project recovers, so a
 * later fall alerts again. Projects without sprints get UNSCHEDULED.
 */
export async function runScheduleVariance({ now }: JobContext): Promise<void> {
  const projects = await prisma.project.findMany({
    where: { ...LIVE_PROJECT_WHERE },
    select: { id: true, name: true, codePrefix: true, timezone: true },
  });
  for (const p of projects) {
    const today = zonedCalendarDate(now, p.timezone);
    await runUnit('schedule-variance', `${p.id}:${today}`, async () => {
      const { status, behindUnitCount, scheduleBehindAlertedAt } = await refreshScheduleBadge(p.id, now);
      const behind = status === 'BEHIND';
      if (behind && !scheduleBehindAlertedAt) {
        await prisma.$transaction(async (tx) => {
          const claimed = await tx.project.updateMany({
            where: { id: p.id, scheduleBehindAlertedAt: null },
            data: { scheduleBehindAlertedAt: now },
          });
          if (claimed.count === 0) return;
          await createWebNotification(tx, {
            projectId: p.id,
            targetPermissionKey: 'sprints:view_status',
            category: 'SCHEDULE_BEHIND',
            title: `${p.codePrefix} is behind schedule`,
            description: `${p.name}: ${behindUnitCount} facility unit(s) due by a sprint that has ended are not complete.`,
            actionUrl: `/app/projects/${p.id}/scope`,
            metadata: { status, behindUnitCount },
          });
        });
        return `${status} (${behindUnitCount} late unit(s)); alerted`;
      }
      if (!behind && scheduleBehindAlertedAt) {
        await prisma.project.update({ where: { id: p.id }, data: { scheduleBehindAlertedAt: null } });
      }
      return behind ? `${status} (${behindUnitCount} late unit(s))` : status;
    });
  }
}

export function registerScheduleJobs(): void {
  registerJob({ name: 'schedule-variance', intervalMs: 60 * 60 * 1000, run: runScheduleVariance });
}
