import { Prisma } from '@prisma/client';
import { syncActualCompletionDates } from '../schedule/schedule.service';

type Tx = Prisma.TransactionClient;

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Project progress (redesign R1b, R4d, R5f). A scope line's progress (`BoqItem.cumulativeCertifiedPct`,
 * the legacy column name) is its facility unit's progress as observed by the latest accepted visit
 * (`FacilityUnit.progressPct`, D-R4.26) when the unit has one. A line without unit progress keeps the
 * value stored on it: workday reports were its only other source and were deleted in R5f (owner
 * decision: legacy LKK-402 and ABJ-108 keep their stored progress). The project's progress is the
 * budget-weighted average. Lines reaching 100% get their actual completion date.
 */
export async function refreshProjectProgress(tx: Tx, projectId: string): Promise<number> {
  const items = await tx.boqItem.findMany({
    where: { projectId },
    select: { id: true, budgetedCostNgn: true, cumulativeCertifiedPct: true, facilityUnit: { select: { progressPct: true } } },
  });
  let weighted = 0;
  let totalBudget = 0;
  for (const item of items) {
    const unitPct = item.facilityUnit?.progressPct;
    const stored = Number(item.cumulativeCertifiedPct);
    const pct = unitPct != null ? round2(Number(unitPct)) : stored;
    if (pct !== stored) {
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
