import { z } from 'zod';

/**
 * Fiscal years, periods and the intervention year rule (client demo updates D5, G.1).
 * `Tenant.fiscalYearStartMonth` (1–12, default January). A fiscal year is named by the calendar year
 * it starts in (start month April: FY 2026 = April 2026 – March 2027). Dates are `YYYY-MM-DD`
 * calendar dates already in the right zone (the caller turns "now" into today with
 * `zonedCalendarDate`), so every function here is pure.
 */

export const DEFAULT_FISCAL_YEAR_START_MONTH = 1;

export const FiscalYearStartMonthSchema = z.number().int().min(1).max(12);

export const PeriodPresetEnum = z.enum([
  'THIS_MONTH',
  'LAST_MONTH',
  'THIS_QUARTER',
  'LAST_QUARTER',
  /** A quarter of a chosen fiscal year (`fiscalYear` + `quarter`). */
  'QUARTER',
  'THIS_FISCAL_YEAR',
  /** A chosen fiscal year (`fiscalYear`). */
  'FISCAL_YEAR',
  /** `from` and `to` as given (either may be open). */
  'CUSTOM',
  'ALL',
]);
export type PeriodPreset = z.infer<typeof PeriodPresetEnum>;

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  THIS_MONTH: 'This month',
  LAST_MONTH: 'Last month',
  THIS_QUARTER: 'This quarter',
  LAST_QUARTER: 'Last quarter',
  QUARTER: 'Quarter',
  THIS_FISCAL_YEAR: 'This fiscal year',
  FISCAL_YEAR: 'Fiscal year',
  CUSTOM: 'Custom range',
  ALL: 'All time',
};

export interface PeriodSelection {
  preset: PeriodPreset;
  fiscalYear?: number | null;
  /** 1–4 */
  quarter?: number | null;
  from?: string | null;
  to?: string | null;
}

/** Inclusive; null = open on that side. */
export interface DateRange {
  from: string | null;
  to: string | null;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.split('-').map(Number);
  return { y, m, d };
}

function lastDayOfMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** First day of the month `offset` months after (y, m). */
function addMonths(y: number, m: number, offset: number): { y: number; m: number } {
  const idx = y * 12 + (m - 1) + offset;
  return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
}

function monthRange(y: number, m: number, months: number): DateRange {
  const end = addMonths(y, m, months - 1);
  return { from: `${y}-${pad(m)}-01`, to: `${end.y}-${pad(end.m)}-${pad(lastDayOfMonth(end.y, end.m))}` };
}

function normaliseStart(startMonth: number | null | undefined): number {
  return startMonth && startMonth >= 1 && startMonth <= 12 ? Math.trunc(startMonth) : DEFAULT_FISCAL_YEAR_START_MONTH;
}

/** The fiscal year a date falls in. */
export function fiscalYearOf(date: string, startMonth: number = DEFAULT_FISCAL_YEAR_START_MONTH): number {
  const s = normaliseStart(startMonth);
  const { y, m } = parts(date);
  return m >= s ? y : y - 1;
}

export function fiscalYearRange(fiscalYear: number, startMonth: number = DEFAULT_FISCAL_YEAR_START_MONTH): DateRange {
  return monthRange(fiscalYear, normaliseStart(startMonth), 12);
}

/** Quarter 1–4 of a fiscal year. */
export function fiscalQuarterRange(fiscalYear: number, quarter: number, startMonth: number = DEFAULT_FISCAL_YEAR_START_MONTH): DateRange {
  const q = Math.min(4, Math.max(1, Math.trunc(quarter)));
  const start = addMonths(fiscalYear, normaliseStart(startMonth), (q - 1) * 3);
  return monthRange(start.y, start.m, 3);
}

/** The fiscal quarter (1–4) a date falls in. */
export function fiscalQuarterOf(date: string, startMonth: number = DEFAULT_FISCAL_YEAR_START_MONTH): number {
  const s = normaliseStart(startMonth);
  const { m } = parts(date);
  return Math.floor(((m - s + 12) % 12) / 3) + 1;
}

/** The `{ from, to }` (inclusive) a period selection covers on `today`. */
export function periodRange(selection: PeriodSelection, today: string, startMonth: number = DEFAULT_FISCAL_YEAR_START_MONTH): DateRange {
  const s = normaliseStart(startMonth);
  const { y, m } = parts(today);
  const fy = fiscalYearOf(today, s);
  const q = fiscalQuarterOf(today, s);
  switch (selection.preset) {
    case 'THIS_MONTH':
      return monthRange(y, m, 1);
    case 'LAST_MONTH': {
      const prev = addMonths(y, m, -1);
      return monthRange(prev.y, prev.m, 1);
    }
    case 'THIS_QUARTER':
      return fiscalQuarterRange(fy, q, s);
    case 'LAST_QUARTER':
      return q === 1 ? fiscalQuarterRange(fy - 1, 4, s) : fiscalQuarterRange(fy, q - 1, s);
    case 'QUARTER':
      return fiscalQuarterRange(selection.fiscalYear ?? fy, selection.quarter ?? q, s);
    case 'THIS_FISCAL_YEAR':
      return fiscalYearRange(fy, s);
    case 'FISCAL_YEAR':
      return fiscalYearRange(selection.fiscalYear ?? fy, s);
    case 'CUSTOM':
      return { from: selection.from || null, to: selection.to || null };
    case 'ALL':
    default:
      return { from: null, to: null };
  }
}

/** Short label of a period ("Q2 FY2026", "FY2026", "Mar 2026", "1 Jan 2026 – 31 Mar 2026", "All time"). */
export function describePeriod(selection: PeriodSelection, today: string, startMonth: number = DEFAULT_FISCAL_YEAR_START_MONTH): string {
  const s = normaliseStart(startMonth);
  const fy = fiscalYearOf(today, s);
  switch (selection.preset) {
    case 'THIS_QUARTER':
      return `Q${fiscalQuarterOf(today, s)} FY${fy}`;
    case 'QUARTER':
      return `Q${selection.quarter ?? fiscalQuarterOf(today, s)} FY${selection.fiscalYear ?? fy}`;
    case 'THIS_FISCAL_YEAR':
      return `FY${fy}`;
    case 'FISCAL_YEAR':
      return `FY${selection.fiscalYear ?? fy}`;
    case 'ALL':
      return 'All time';
    default: {
      const r = periodRange(selection, today, s);
      if (!r.from && !r.to) return 'All time';
      return `${r.from ?? '…'} – ${r.to ?? '…'}`;
    }
  }
}

/**
 * Intervention years a new project may take (D5): the current fiscal year and the next one
 * (projects are planned a year ahead). Earlier years only through the register import.
 */
export function allowedInterventionYears(today: string, startMonth: number = DEFAULT_FISCAL_YEAR_START_MONTH): number[] {
  const fy = fiscalYearOf(today, startMonth);
  return [fy, fy + 1];
}
