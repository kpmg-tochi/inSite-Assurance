import { zonedCalendarDate } from '@insite/shared';
import { prisma } from '../config/prisma';
import { describeAlertSync, syncProjectAlerts } from '../modules/alerts/projectAlerts.service';
import { JobContext, registerJob, runUnit } from './runner';
import { VISIT_PROJECT_WHERE } from './visitJobs';

/**
 * project-alerts (UBEC IRL early-warning alerts): once a day per project (one JobRun per
 * project-day, the project's calendar day), evaluate DELAYED, STALLED, SITE_UPDATE_OVERDUE and
 * SPEND_AHEAD_OF_PROGRESS (`syncProjectAlerts`): newly active alerts are notified once, cleared ones
 * lose their key. Covers every ACTIVE project of a non-suspended tenant (each rule names its
 * phases), plus any other project that still holds alert keys (archived, drafts reverted, suspended
 * tenants), which are cleared without notifying.
 */
export async function runProjectAlerts({ now }: JobContext): Promise<void> {
  const projects = await prisma.project.findMany({ where: { ...VISIT_PROJECT_WHERE }, select: { id: true, timezone: true } });
  for (const p of projects) {
    const today = zonedCalendarDate(now, p.timezone);
    await runUnit('project-alerts', `${p.id}:${today}`, async () => describeAlertSync(await syncProjectAlerts(p.id, now)));
  }
  const stale = await prisma.project.findMany({
    where: { NOT: VISIT_PROJECT_WHERE, OR: [{ NOT: { alertStateJson: { equals: {} } } }, { scheduleBehindAlertedAt: { not: null } }] },
    select: { id: true },
  });
  for (const p of stale) {
    await syncProjectAlerts(p.id, now, { clearOnly: true }).catch((error) => console.warn('[jobs] project-alerts clear failed:', error));
  }
}

export function registerAlertJobs(): void {
  registerJob({ name: 'project-alerts', intervalMs: 60 * 60 * 1000, run: runProjectAlerts });
}
