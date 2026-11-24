import { Prisma } from '@prisma/client';
import { getReportedProgressByItem } from '../evidence/evidenceProvider';
import { recordItemActualStart, syncActualCompletionDates } from '../schedule/schedule.service';

type Tx = Prisma.TransactionClient;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Project progress (redesign R1b, R4d). A scope line's progress (`BoqItem.cumulativeCertifiedPct`, the
 * legacy column name) is its facility unit's progress as observed by the latest accepted visit
 * (`FacilityUnit.progressPct`, D-R4.26) when the unit has one; otherwise the progress shown by its
 * counted workday reports (legacy projects and the old app until R5). The project's progress is the
 * budget-weighted average. Lines reaching 100% get their actual completion date.
 */
export async function refreshProjectProgress(tx: Tx, projectId: string): Promise<number> {
  const items = await tx.boqItem.findMany({
    where: { projectId },
    select: { id: true, totalQuantity: true, budgetedCostNgn: true, cumulativeCertifiedPct: true, facilityUnit: { select: { progressPct: true } } },
  });
  const fromReports = items.filter((i) => i.facilityUnit?.progressPct == null);
  const reported = fromReports.length
    ? await getReportedProgressByItem(
        projectId,
        fromReports.map((i) => ({ id: i.id, totalQuantity: Number(i.totalQuantity) })),
        tx
      )
    : new Map<string, number>();
  let weighted = 0;
  let totalBudget = 0;
  for (const item of items) {
    const unitPct = item.facilityUnit?.progressPct;
    const pct = round2(unitPct != null ? Number(unitPct) : (reported.get(item.id) ?? 0));
    if (pct !== Number(item.cumulativeCertifiedPct)) {
      await tx.boqItem.update({ where: { id: item.id }, data: { cumulativeCertifiedPct: pct } });
    }
    weighted += Number(item.budgetedCostNgn) * pct;
    totalBudget += Number(item.budgetedCostNgn);
  }
  const projectPct = totalBudget > 0 ? round2(weighted / totalBudget) : 0;
  await tx.project.update({ where: { id: projectId }, data: { certifiedProgressPct: projectPct } });
  await syncActualCompletionDates(tx, projectId);
  return projectPct;
}

/** Called wherever a report becomes counted: the item has started, and progress moves. */
export async function recordCountedReport(tx: Tx, projectId: string, boqItemId: string, workdayDate: string): Promise<void> {
  await recordItemActualStart(tx, projectId, boqItemId, workdayDate);
  await refreshProjectProgress(tx, projectId);
}
