import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { getProcessConfig } from '../process/processConfig.service';

/**
 * Counted field reports (the Phase 4 seam). A report counts once it is CONFIRMED, or approved when
 * report approval is on; only the latest counted revision of a chain counts. Redesign R1b: with
 * IPC reconciliation gone, counted reports drive project progress (modules/progress).
 */

type Db = Prisma.TransactionClient | PrismaClient;

/**
 * Report statuses that count as evidence (Phase 7).
 * - Report approval off: CONFIRMED.
 * - Report approval on: APPROVED_COMPLETED. CONFIRMED reports on such a project were accepted before
 *   approval was switched on and finished under those rules (config changes apply to new items
 *   only), so they keep counting; no new CONFIRMED report is created while approval is on.
 * Either way PENDING_APPROVAL, RETURNED_FOR_REVISION and STAGED_UNVERIFIED never count.
 */
export function countedReportStatuses(requireReportApproval: boolean): Array<'CONFIRMED' | 'APPROVED_COMPLETED'> {
  return requireReportApproval ? ['APPROVED_COMPLETED', 'CONFIRMED'] : ['CONFIRMED', 'APPROVED_COMPLETED'];
}

/**
 * Reported (verified but not yet certified) progress per BOQ item, percent of the item's total
 * quantity (Phase 9). Uses the counted statuses and supersession: a counted
 * report whose newer revision also counts is replaced by it. Report quantities are per period, so
 * they are summed; contractor and verifier reports describe the same work, so each persona is
 * summed separately and the larger total is used. Capped at 100.
 */
export async function getReportedProgressByItem(
  projectId: string,
  items: Array<{ id: string; totalQuantity: number }>,
  db: Db = prisma
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (items.length === 0) return out;
  const config = await getProcessConfig(projectId, db === prisma ? prisma : (db as Prisma.TransactionClient));
  const reports = await db.workdayReport.findMany({
    where: { projectId, wbsItemId: { in: items.map((i) => i.id) }, status: { in: countedReportStatuses(config.requireReportApproval) } },
    select: { id: true, parentReportId: true, wbsItemId: true, reporterPersonaType: true, reportedQuantity: true },
  });
  const superseded = new Set(reports.map((r) => r.parentReportId).filter((id): id is string => Boolean(id)));
  const sums = new Map<string, Map<string, number>>();
  for (const r of reports) {
    if (superseded.has(r.id)) continue;
    const byPersona = sums.get(r.wbsItemId) ?? new Map<string, number>();
    byPersona.set(r.reporterPersonaType, (byPersona.get(r.reporterPersonaType) ?? 0) + Number(r.reportedQuantity));
    sums.set(r.wbsItemId, byPersona);
  }
  for (const item of items) {
    const byPersona = sums.get(item.id);
    const qty = byPersona ? Math.max(...byPersona.values()) : 0;
    out.set(item.id, item.totalQuantity > 0 ? Math.min(100, Math.max(0, (qty / item.totalQuantity) * 100)) : 0);
  }
  return out;
}
