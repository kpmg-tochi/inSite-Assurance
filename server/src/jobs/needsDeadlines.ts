import { NEEDS_DEADLINE_REMINDER_DAYS, NEEDS_OPEN_PROPOSAL_STATUSES, NEEDS_STAGE_ORDER, daysBetween, formatCalendarDate, zonedCalendarDate, type NeedsStage } from '@insite/shared';
import { prisma } from '../config/prisma';
import { safeZone } from '../modules/kpis/kpis.service';
import { emailStageActors } from '../modules/needs/decisions/needsEmails';
import { deadlinesOf } from '../modules/needs/needsSerializers';
import { cycleConfig } from '../modules/needs/needsSupport';
import { JobContext, registerJob, runUnit } from './runner';

/**
 * needs-deadlines (needs pipeline wave 3, A8): once a day per OPEN cycle of a non-suspended tenant
 * (one JobRun per cycle-day, scope `<cycleId>:<YYYY-MM-DD>` in the tenant's zone), email the actors
 * of a stage (active users of the owning organisation whose role holds the stage's actor permission):
 * - DUE_SOON when a stage deadline is exactly NEEDS_DEADLINE_REMINDER_DAYS (7) days ahead, listing
 *   the open proposals at that stage or earlier (possibly none);
 * - OVERDUE on the day after a stage deadline passed, while open proposals are still at that stage
 *   or earlier.
 * Stages without an actor (approval chains) are wave 4's. No web notifications (D-N.24).
 */

const idx = (s: string) => NEEDS_STAGE_ORDER.indexOf(s as NeedsStage);

export async function runNeedsDeadlines({ now }: JobContext): Promise<void> {
  const cycles = await prisma.needsCycle.findMany({ where: { status: 'OPEN', tenant: { status: { not: 'SUSPENDED' } } }, include: { tenant: { select: { timezone: true } } } });
  for (const cycle of cycles) {
    const today = zonedCalendarDate(now, safeZone(cycle.tenant.timezone));
    await runUnit('needs-deadlines', `${cycle.id}:${today}`, async () => {
      const config = cycleConfig(cycle);
      const proposals = await prisma.needsProposal.findMany({
        where: { cycleId: cycle.id, status: { in: [...NEEDS_OPEN_PROPOSAL_STATUSES] } },
        select: { reference: true, title: true, stage: true },
        orderBy: { sequence: 'asc' },
      });
      let sent = 0;
      for (const d of deadlinesOf(cycle.deadlinesJson)) {
        if (d.kind !== 'STAGE' || !d.stage) continue;
        const left = daysBetween(today, d.date);
        const kind = left === NEEDS_DEADLINE_REMINDER_DAYS ? 'DUE_SOON' : left === -1 ? 'OVERDUE' : null;
        if (!kind) continue;
        const open = proposals.filter((p) => idx(p.stage) <= idx(d.stage!)).map((p) => ({ reference: p.reference, title: p.title }));
        if (kind === 'OVERDUE' && !open.length) continue;
        sent += await emailStageActors({ cycle, config, stage: d.stage, kind, proposals: open, dueDate: formatCalendarDate(d.date) });
      }
      return `${sent} deadline emails`;
    });
  }
}

export function registerNeedsDeadlinesJobs(): void {
  registerJob({ name: 'needs-deadlines', intervalMs: 60 * 60 * 1000, run: runNeedsDeadlines });
}
