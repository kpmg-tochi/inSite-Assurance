import { zonedCalendarDate } from '@insite/shared';
import { prisma } from '../config/prisma';
import { safeZone, snapshotTenantKpis } from '../modules/kpis/kpis.service';
import { JobContext, registerJob, runUnit } from './runner';

/**
 * kpi-snapshot (Phase 16): once a day per tenant (one JobRun per tenant-day), store every project's
 * KPI figures for the current month, and backfill earlier months once (period-based KPIs only).
 * The day and the month are the tenant's (`Tenant.timezone`). Suspended tenants are skipped.
 */
export async function runKpiSnapshot({ now }: JobContext): Promise<void> {
  const tenants = await prisma.tenant.findMany({ where: { status: { not: 'SUSPENDED' } }, select: { id: true, timezone: true } });
  for (const t of tenants) {
    const today = zonedCalendarDate(now, safeZone(t.timezone));
    await runUnit('kpi-snapshot', `${t.id}:${today}`, () => snapshotTenantKpis(t.id, now));
  }
}

export function registerKpiJobs(): void {
  registerJob({ name: 'kpi-snapshot', intervalMs: 60 * 60 * 1000, run: runKpiSnapshot });
}
