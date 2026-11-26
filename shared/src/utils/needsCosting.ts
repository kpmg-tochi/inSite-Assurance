import type { NigeriaZoneCode } from '../data/nigeriaAdminAreas';
import { standardRateFor, type CostingStandard } from '../schemas/costingStandard.schema';
import type { CostingSummary, FacilityBreakdownRow, InterventionAction, NeedsBoqLine } from '../schemas/needsPipeline.schema';

/**
 * Needs pipeline N1: costing checks against the costing standard (D-N.8, D-N.18), pure. Every check
 * is a deterministic rule (D-N.21). Variances and ceiling breaches are flags the costing officer
 * acknowledges with a reason; a costed version without the supervision and monitoring line is
 * refused.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

type LineForCosting = Pick<NeedsBoqLine, 'wbsCode' | 'unitId' | 'itemCode' | 'totalQuantity' | 'rateNgn' | 'amountNgn'>;

export interface CostingSummaryResult extends CostingSummary {
  /**
   * The same quantities at the standard's rates for the zone (lines whose item the standard lists);
   * null when no line names a standard item.
   */
  atStandardRatesNgn: number | null;
}

/**
 * The Costing summary of a set of BoQ lines: works subtotal, supervision and monitoring and
 * contingency at the standard's percentages, total.
 */
export function costingSummary(
  lines: readonly LineForCosting[],
  standard: Pick<CostingStandard, 'rates' | 'zoneFactors' | 'supervisionMonitoringPct' | 'contingencyPct'>,
  zone: NigeriaZoneCode | null
): CostingSummaryResult {
  const subtotalNgn = round2(lines.reduce((s, l) => s + l.amountNgn, 0));
  const supervisionMonitoringNgn = round2((subtotalNgn * standard.supervisionMonitoringPct) / 100);
  const contingencyNgn = round2((subtotalNgn * standard.contingencyPct) / 100);
  let matched = 0;
  let atStandard = 0;
  for (const l of lines) {
    const rate = standardRateFor(standard, l.itemCode, zone);
    if (rate === null) continue;
    matched += 1;
    atStandard += l.totalQuantity * rate;
  }
  return {
    subtotalNgn,
    supervisionMonitoringPct: standard.supervisionMonitoringPct,
    supervisionMonitoringNgn,
    contingencyPct: standard.contingencyPct,
    contingencyNgn,
    totalNgn: round2(subtotalNgn + supervisionMonitoringNgn + contingencyNgn),
    atStandardRatesNgn: matched ? round2(atStandard) : null,
  };
}

export interface RateVariance {
  wbsCode: string;
  itemCode: string;
  rateNgn: number;
  /** The standard's rate for the zone. */
  standardRateNgn: number;
  /** (rate − standard) ÷ standard × 100, 2 dp; negative when below the standard. */
  variancePct: number;
  direction: 'ABOVE' | 'BELOW';
}

/**
 * Lines whose rate differs from the standard's rate for the zone by more than `tolerancePct`
 * (either way). Lines without a standard item, or whose standard rate is 0, are not compared.
 */
export function rateVariances(
  lines: readonly LineForCosting[],
  standard: Pick<CostingStandard, 'rates' | 'zoneFactors'>,
  zone: NigeriaZoneCode | null,
  tolerancePct: number
): RateVariance[] {
  const out: RateVariance[] = [];
  for (const l of lines) {
    const standardRateNgn = standardRateFor(standard, l.itemCode, zone);
    if (standardRateNgn === null || standardRateNgn <= 0 || !l.itemCode) continue;
    const variancePct = round2(((l.rateNgn - standardRateNgn) / standardRateNgn) * 100);
    if (Math.abs(variancePct) > tolerancePct) {
      out.push({ wbsCode: l.wbsCode, itemCode: l.itemCode, rateNgn: l.rateNgn, standardRateNgn, variancePct, direction: variancePct > 0 ? 'ABOVE' : 'BELOW' });
    }
  }
  return out;
}

export interface CeilingBreach {
  unitId: string;
  facilityCode: string;
  interventionAction: InterventionAction;
  /** The unit's cost ÷ its proposed quantity. */
  costPerUnitNgn: number;
  ceilingNgn: number;
  /** How far above the ceiling, in % of the ceiling (2 dp). */
  excessPct: number;
}

type RowForCeiling = Pick<FacilityBreakdownRow, 'unitId' | 'facilityCode' | 'interventionAction' | 'proposedQuantity' | 'preliminaryCostNgn'>;

/** The cost of a breakdown row: its BoQ lines when it has any, else its preliminary cost; null when neither. */
export function breakdownRowCost(row: Pick<FacilityBreakdownRow, 'unitId' | 'preliminaryCostNgn'>, lines: readonly Pick<NeedsBoqLine, 'unitId' | 'amountNgn'>[]): number | null {
  const own = lines.filter((l) => l.unitId.toUpperCase() === row.unitId.toUpperCase());
  if (own.length) return round2(own.reduce((s, l) => s + l.amountNgn, 0));
  return row.preliminaryCostNgn ?? null;
}

/**
 * Breakdown rows whose cost per unit is above the standard's ceiling for the facility. A ceiling
 * for the row's intervention action wins over the facility's general one. Rows without a cost,
 * without a ceiling or with proposed quantity 0 are skipped.
 */
export function ceilingBreaches(
  rows: readonly RowForCeiling[],
  lines: readonly Pick<NeedsBoqLine, 'unitId' | 'amountNgn'>[],
  standard: Pick<CostingStandard, 'ceilings'>
): CeilingBreach[] {
  const out: CeilingBreach[] = [];
  for (const row of rows) {
    if (row.proposedQuantity <= 0) continue;
    const code = row.facilityCode.toUpperCase();
    const ceiling =
      standard.ceilings.find((c) => c.facilityCode === code && c.interventionAction === row.interventionAction) ??
      standard.ceilings.find((c) => c.facilityCode === code && c.interventionAction === null);
    if (!ceiling) continue;
    const cost = breakdownRowCost(row, lines);
    if (cost === null) continue;
    const costPerUnitNgn = round2(cost / row.proposedQuantity);
    if (costPerUnitNgn > ceiling.maxNgnPerUnit) {
      out.push({
        unitId: row.unitId,
        facilityCode: code,
        interventionAction: row.interventionAction,
        costPerUnitNgn,
        ceilingNgn: ceiling.maxNgnPerUnit,
        excessPct: round2(((costPerUnitNgn - ceiling.maxNgnPerUnit) / ceiling.maxNgnPerUnit) * 100),
      });
    }
  }
  return out;
}

/** D-N.18: a costed version carries a supervision and monitoring line with an amount. */
export function hasSupervisionLine(summary: Pick<CostingSummary, 'supervisionMonitoringPct' | 'supervisionMonitoringNgn'> | null | undefined): boolean {
  return Boolean(summary && summary.supervisionMonitoringPct > 0 && summary.supervisionMonitoringNgn > 0);
}
