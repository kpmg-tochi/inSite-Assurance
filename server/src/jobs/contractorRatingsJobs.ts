import { zonedCalendarDate } from '@insite/shared';
import { prisma } from '../config/prisma';
import { safeZone } from '../modules/kpis/kpis.service';
import { refreshContractorRatingSnapshots } from '../modules/contractors/contractors.service';
import { JobContext, registerJob, runUnit } from './runner';

/**
 * contractor-ratings (client demo updates F.3): once a day per tenant (one JobRun per tenant-day in
 * the tenant's zone), recompute every contractor's rating snapshot. Suspended tenants are skipped.
 */
export async function runContractorRatings({ now }: JobContext): Promise<void> {
  const tenants = await prisma.tenant.findMany({ where: { status: { not: 'SUSPENDED' } }, select: { id: true, timezone: true } });
  for (const t of tenants) {
    const today = zonedCalendarDate(now, safeZone(t.timezone));
    await runUnit('contractor-ratings', `${t.id}:${today}`, async () => `${await refreshContractorRatingSnapshots(t.id, now)} contractor ratings`);
  }
}

export function registerContractorRatingsJobs(): void {
  registerJob({ name: 'contractor-ratings', intervalMs: 60 * 60 * 1000, run: runContractorRatings });
}
