import type { MonthDay, NeedsDeadline, NeedsDeadlineState, NeedsPipelineConfig } from '../schemas/needsPipeline.schema';
import { NeedsChainTypeEnum, type NeedsChainType, type NeedsStage } from '../schemas/needsPipeline.schema';
import { daysBetween } from './calendar';

/**
 * Needs pipeline N1: the cycle calendar (plan 4.3, A2), pure. The cycle for intervention year Y runs
 * in Y − 1: it opens on the type's `cycleOpens` date in Y − 1 and every deadline is a month and day
 * placed after that. A deadline whose month and day fall before the opening date belongs to the next
 * calendar year (Y), so a calendar may run past December. Dates are copied onto the cycle when it
 * opens and can be edited there.
 */

/** Days before a deadline that it counts as due soon (the `needs-deadlines` job reminds then; wave 3). */
export const NEEDS_DEADLINE_REMINDER_DAYS = 7;

const pad = (n: number) => String(n).padStart(2, '0');

/** A month and day in a year, as YYYY-MM-DD; a day past the end of the month is its last day (30 Feb → 28/29 Feb). */
export function monthDayInYear(year: number, md: MonthDay): string {
  const lastDay = new Date(Date.UTC(year, md.month, 0)).getUTCDate();
  return `${year}-${pad(md.month)}-${pad(Math.min(md.day, lastDay))}`;
}

const before = (a: MonthDay, b: MonthDay) => a.month < b.month || (a.month === b.month && a.day < b.day);

/** The date of a calendar entry of the cycle for `interventionYear`. */
export function cycleDate(config: Pick<NeedsPipelineConfig, 'cycleOpens'>, interventionYear: number, md: MonthDay): string {
  const year = before(md, config.cycleOpens) ? interventionYear : interventionYear - 1;
  return monthDayInYear(year, md);
}

/** The stage a chain's steps belong to in the calendar: the portfolio at APPROVAL, the BEAP at FUNDING. */
const CHAIN_STAGE: Record<NeedsChainType, NeedsStage> = {
  NEEDS_PORTFOLIO: 'APPROVAL',
  BEAP: 'FUNDING',
  OUT_OF_CYCLE: 'APPROVAL',
};

/**
 * Every dated entry of the cycle for `interventionYear`, in date order: the opening, each stage with
 * a deadline, each approval-chain step with a deadline and the extra deadlines. Keys are stable
 * (`cycle-opens`, `stage:VALIDATION`, `chain:BEAP:1`, `extra:<key>`), so a cycle can store edits by key.
 */
export function cycleDeadlines(
  config: Pick<NeedsPipelineConfig, 'cycleOpens' | 'stages' | 'extraDeadlines' | 'approvalChains'>,
  interventionYear: number
): NeedsDeadline[] {
  const out: NeedsDeadline[] = [
    { key: 'cycle-opens', label: 'Cycle opens', stage: null, kind: 'CYCLE_OPENS', date: monthDayInYear(interventionYear - 1, config.cycleOpens) },
  ];
  for (const s of config.stages) {
    if (s.deadline) out.push({ key: `stage:${s.stage}`, label: s.label, stage: s.stage, kind: 'STAGE', date: cycleDate(config, interventionYear, s.deadline) });
  }
  for (const chainType of NeedsChainTypeEnum.options) {
    // An out-of-cycle request has no place in the annual calendar.
    if (chainType === 'OUT_OF_CYCLE') continue;
    config.approvalChains[chainType].forEach((step, i) => {
      if (!step.deadline) return;
      out.push({
        key: `chain:${chainType}:${i + 1}`,
        label: step.label,
        stage: CHAIN_STAGE[chainType],
        kind: 'CHAIN_STEP',
        date: cycleDate(config, interventionYear, step.deadline),
      });
    });
  }
  for (const e of config.extraDeadlines) {
    out.push({ key: `extra:${e.key}`, label: e.label, stage: e.stage, kind: 'EXTRA', date: cycleDate(config, interventionYear, e.deadline) });
  }
  // Stable: entries on the same day keep the order above (opening, stages, chain steps, extras).
  return out.map((d, i) => ({ d, i })).sort((a, b) => a.d.date.localeCompare(b.d.date) || a.i - b.i).map((x) => x.d);
}

/** Where a deadline stands today (both YYYY-MM-DD in the tenant's zone). */
export function deadlineState(date: string | null | undefined, today: string): NeedsDeadlineState {
  if (!date) return 'NOT_SET';
  const daysLeft = daysBetween(today, date);
  if (daysLeft < 0) return 'OVERDUE';
  if (daysLeft === 0) return 'DUE_TODAY';
  return daysLeft <= NEEDS_DEADLINE_REMINDER_DAYS ? 'DUE_SOON' : 'UPCOMING';
}
