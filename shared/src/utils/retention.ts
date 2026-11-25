/**
 * Phase 10: retention arithmetic and the construction-phase transition table. Pure functions, used
 * by the server (which is the only place amounts are decided) and by the web for previews.
 *
 * Amounts are NGN rounded to two decimals. Retention is withheld from each approved release; the
 * contractor receives the approved amount minus the withheld part.
 */
import type { ConstructionPhase } from '../enums';

export const roundNgn2 = (n: number) => Math.round(n * 100) / 100;

/** Half a kobo: amounts are compared after rounding to two decimals. */
export const RETENTION_NGN_EPSILON = 0.005;

/** Retention withheld from one approved release. 0 when retention is off or the amount is not positive. */
export function retentionWithheldFor(approvedNgn: number, retentionPercentage: number | null | undefined): number {
  if (!retentionPercentage || retentionPercentage <= 0 || approvedNgn <= 0) return 0;
  return roundNgn2((approvedNgn * retentionPercentage) / 100);
}

export interface RetentionShare {
  projectContractorId: string;
  amountNgn: number;
}

/**
 * Splits `totalNgn` across contractors in proportion to `weights` (for example verified amounts per
 * contractor on a direct milestone valuation). Rounding differences go to the largest share so the
 * parts always add up to the total exactly. Weights of zero or less are ignored; with no positive
 * weight the whole amount goes to `fallbackContractorId`.
 */
export function allocateRetention(
  totalNgn: number,
  weights: Array<{ projectContractorId: string; weight: number }>,
  fallbackContractorId: string
): RetentionShare[] {
  const total = roundNgn2(totalNgn);
  if (total <= 0) return [];
  const merged = new Map<string, number>();
  for (const w of weights) {
    if (w.weight > 0) merged.set(w.projectContractorId, (merged.get(w.projectContractorId) ?? 0) + w.weight);
  }
  const sum = [...merged.values()].reduce((s, v) => s + v, 0);
  if (sum <= 0) return [{ projectContractorId: fallbackContractorId, amountNgn: total }];
  const shares = [...merged.entries()]
    .map(([projectContractorId, weight]) => ({ projectContractorId, amountNgn: roundNgn2((total * weight) / sum) }))
    .sort((a, b) => b.amountNgn - a.amountNgn || a.projectContractorId.localeCompare(b.projectContractorId));
  const drift = roundNgn2(total - shares.reduce((s, x) => s + x.amountNgn, 0));
  if (drift !== 0) shares[0].amountNgn = roundNgn2(shares[0].amountNgn + drift);
  return shares.filter((s) => s.amountNgn !== 0);
}

export type RetentionReleaseStage = 'COMPLETION' | 'FINAL';

/**
 * The most that may be released for one contractor at a stage.
 * - COMPLETION: `releaseAtCompletionPct` of everything withheld so far, less what was already
 *   released (or is pending release).
 * - FINAL: everything still held, less what is pending release.
 */
export function retentionReleaseCap(params: {
  stage: RetentionReleaseStage;
  heldNgn: number;
  releasedNgn: number;
  pendingNgn: number;
  releaseAtCompletionPct: number;
}): number {
  const held = Math.max(0, params.heldNgn - params.pendingNgn);
  if (params.stage === 'FINAL') return roundNgn2(held);
  const withheldTotal = params.heldNgn + params.releasedNgn;
  const allowance = roundNgn2((withheldTotal * params.releaseAtCompletionPct) / 100);
  return roundNgn2(Math.max(0, Math.min(held, allowance - params.releasedNgn - params.pendingNgn)));
}

/** Adds whole calendar months to a YYYY-MM-DD date, clamping to the last day of the target month. */
export function addCalendarMonths(date: string, months: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const targetMonthIndex = m - 1 + months;
  const ty = y + Math.floor(targetMonthIndex / 12);
  const tm = ((targetMonthIndex % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  const day = Math.min(d, lastDay);
  return `${String(ty).padStart(4, '0')}-${String(tm + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Whole days from `from` to `to` (YYYY-MM-DD); negative when `to` is earlier. */
export function calendarDaysUntil(from: string, to: string): number {
  const a = Date.UTC(+from.slice(0, 4), +from.slice(5, 7) - 1, +from.slice(8, 10));
  const b = Date.UTC(+to.slice(0, 4), +to.slice(5, 7) - 1, +to.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/**
 * Allowed construction-phase moves. Only one backwards move exists (handover back to construction,
 * with a reason). Preconditions beyond the table are checked by the server.
 */
export const CONSTRUCTION_PHASE_TRANSITIONS: Record<ConstructionPhase, ConstructionPhase[]> = {
  ACTIVE_CONSTRUCTION: ['HANDOVER_IN_PROGRESS'],
  HANDOVER_IN_PROGRESS: ['RETENTION_PERIOD', 'ACTIVE_CONSTRUCTION'],
  RETENTION_PERIOD: ['COMPLETED_CLOSED'],
  COMPLETED_CLOSED: [],
};

export function isPhaseTransitionAllowed(from: ConstructionPhase, to: ConstructionPhase): boolean {
  return CONSTRUCTION_PHASE_TRANSITIONS[from].includes(to);
}

/** Phases in which construction work (reporting obligations) has stopped. */
export function isPostConstructionPhase(phase: ConstructionPhase | string | null | undefined): boolean {
  return phase === 'RETENTION_PERIOD' || phase === 'COMPLETED_CLOSED';
}

export const CONSTRUCTION_PHASE_LABELS: Record<ConstructionPhase, string> = {
  ACTIVE_CONSTRUCTION: 'Execution',
  HANDOVER_IN_PROGRESS: 'Handover',
  RETENTION_PERIOD: 'Defects liability period',
  COMPLETED_CLOSED: 'Closed',
};
