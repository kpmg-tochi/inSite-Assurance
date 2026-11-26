import { zonedCalendarDate } from '@insite/shared';
import { prisma } from '../config/prisma';
import { safeZone } from '../modules/kpis/kpis.service';
import { evaluateContractorFlags } from '../modules/contractorFlags/contractorFlags.service';
import { JobContext, registerJob, runUnit } from './runner';

/**
 * contractor-flags (client demo updates F.4): once a day per tenant (one JobRun per tenant-day in the
 * tenant's zone), run the contractor flag rule over every engagement of the tenant's active projects.
 * Reports accepted during the day are evaluated at once (`evaluateFlagsAfterAcceptance`); this run
 * catches settings changes and keeps open flags' evidence in step. Suspended tenants are skipped.
 */
export async function runContractorFlags({ now }: JobContext): Promise<void> {
  const tenants = await prisma.tenant.findMany({ where: { status: { not: 'SUSPENDED' } }, select: { id: true, timezone: true } });
  for (const t of tenants) {
    const today = zonedCalendarDate(now, safeZone(t.timezone));
    await runUnit('contractor-flags', `${t.id}:${today}`, async () => `${await evaluateContractorFlags(t.id, now)} contractor flag(s) raised`);
  }
}

export function registerContractorFlagsJobs(): void {
  registerJob({ name: 'contractor-flags', intervalMs: 60 * 60 * 1000, run: runContractorFlags });
}
