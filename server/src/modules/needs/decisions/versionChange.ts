import { NEEDS_STAGE_ORDER, normaliseSchoolName, reopenStageFor, type NeedsStage, type ParsedNeedsAssessment } from '@insite/shared';

/**
 * Needs pipeline wave 3 (A5): the change rule, pure. A needs assessment version that changes the
 * scope or the cost of a proposal after the gate that checked it sends the proposal back (plan
 * section 7, `reopenStageFor`):
 * - scope = the sites (site no., school name as normalised, LGA, GPS) and the breakdown rows (unit
 *   ID, facility, intervention action, site, proposed quantity). Changed in Design or later: back to
 *   Validation;
 * - cost = the costing summary's total and the BoQ lines (unit ID, item code, quantity, rate).
 *   Changed after Costing (Prioritisation or later): back to Costing.
 * Text (titles, justifications, assumptions, descriptions) and preliminary costs typed on the
 * breakdown are neither: they never reopen a stage.
 */

export interface VersionChange {
  scope: boolean;
  cost: boolean;
}

type Comparable = Pick<ParsedNeedsAssessment, 'sites' | 'breakdownRows' | 'boqLines' | 'costingSummary'>;

const num = (n: number | null | undefined, dp = 3) => (n === null || n === undefined ? '' : String(Math.round(n * 10 ** dp) / 10 ** dp));

function scopeKey(p: Comparable, withRows: boolean): string {
  const sites = [...p.sites]
    .sort((a, b) => a.siteNumber - b.siteNumber)
    .map((s) => [s.siteNumber, normaliseSchoolName(s.schoolName), s.lgaCode.toUpperCase(), num(s.latitude, 6), num(s.longitude, 6)].join('|'));
  const rows = (withRows ? p.breakdownRows : [])
    .map((r) => [r.unitId.toUpperCase(), r.facilityCode.toUpperCase(), r.interventionAction, r.siteNumber, num(r.proposedQuantity)].join('|'))
    .sort();
  return JSON.stringify({ sites, rows });
}

function costKey(p: Comparable): string {
  const lines = p.boqLines.map((l) => [l.unitId.toUpperCase(), (l.itemCode ?? '').toUpperCase(), num(l.totalQuantity), num(l.rateNgn, 2)].join('|')).sort();
  return JSON.stringify({ total: num(p.costingSummary?.totalNgn ?? null, 2), lines });
}

/**
 * What changed between the previous current version and the new one. Review fix (wave 3): when the
 * previous version had no facilities breakdown (an old v1 file, read at Identification only), the
 * v2 file that adds it is the required completion, not a change of scope: only the sites compare.
 */
export function compareVersions(previous: Comparable, next: Comparable): VersionChange {
  const withRows = previous.breakdownRows.length > 0;
  return { scope: scopeKey(previous, withRows) !== scopeKey(next, withRows), cost: costKey(previous) !== costKey(next) };
}

export interface Reopen {
  stage: NeedsStage;
  change: 'SCOPE' | 'COST';
}

const idx = (stage: NeedsStage) => NEEDS_STAGE_ORDER.indexOf(stage);

/**
 * Where a proposal in `stage` goes after a version with `change`; null when it stays. Scope wins over
 * cost (Validation is earlier than Costing).
 */
export function reopenAfterChange(stage: NeedsStage, change: VersionChange): Reopen | null {
  const scopeStage = reopenStageFor('SCOPE');
  const costStage = reopenStageFor('COST');
  if (change.scope && idx(stage) > idx(scopeStage)) return { stage: scopeStage, change: 'SCOPE' };
  if (change.cost && idx(stage) > idx(costStage)) return { stage: costStage, change: 'COST' };
  return null;
}

/** "Scope changed: back to Validation." (the version's ledger entry). */
export function reopenSentence(reopen: Reopen, stageLabel: string): string {
  return `${reopen.change === 'SCOPE' ? 'Scope' : 'Cost'} changed: back to ${stageLabel}.`;
}
