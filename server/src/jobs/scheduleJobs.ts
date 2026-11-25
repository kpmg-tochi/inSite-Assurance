import { zonedCalendarDate } from '@insite/shared';
import { prisma } from '../config/prisma';
import { syncProjectAlerts } from '../modules/alerts/projectAlerts.service';
import { refreshScheduleBadge } from '../modules/schedule/schedule.service';
import { LIVE_PROJECT_WHERE } from './cadenceJobs';
import { JobContext, registerJob, runUnit } from './runner';

/**
 * schedule-variance: once a day per live project (keyed on the project's calendar day), recompute
 * and store the schedule badge from sprints (redesign R2d, D-R2.15). When a project first falls
 * BEHIND (a unit whose end sprint has ended still has a line below 100%), users with
 * sprints:view_status get a web notification (the DELAYED early-warning alert, UBEC IRL); the alert
 * clears when the project recovers, so a later fall alerts again. Projects without sprints get UNSCHEDULED.
 */
export async function runScheduleVariance({ now }: JobContext): Promise<void> {
  const projects = await prisma.project.findMany({
    where: { ...LIVE_PROJECT_WHERE },
    select: { id: true, name: true, codePrefix: true, timezone: true },
  });
  for (const p of projects) {
    const today = zonedCalendarDate(now, p.timezone);
    await runUnit('schedule-variance', `${p.id}:${today}`, async () => {
      const { status, behindUnitCount } = await refreshScheduleBadge(p.id, now);
      // UBEC IRL: the behind notification is the DELAYED early-warning alert (sent once per
      // occurrence, cleared when the project recovers; the type's `monitoring.alerts.delayed` switch).
      const alerts = await syncProjectAlerts(p.id, now, { keys: ['DELAYED'], behindUnitCount });
      const behind = status === 'BEHIND';
      const detail = behind ? `${status} (${behindUnitCount} late unit(s))` : status;
      return alerts.raised.includes('DELAYED') ? `${detail}; alerted` : detail;
    });
  }
}

export function registerScheduleJobs(): void {
  registerJob({ name: 'schedule-variance', intervalMs: 60 * 60 * 1000, run: runScheduleVariance });
}
