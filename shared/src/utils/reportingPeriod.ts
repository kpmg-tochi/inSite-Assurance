/**
 * Reporting period maths (Phase 8). Pure functions shared by server, web and mobile so all three
 * agree on what is due when.
 *
 * Dates are calendar dates "YYYY-MM-DD" in the project's IANA time zone. Weekdays are ISO numbers
 * (1 = Monday ... 7 = Sunday). Instants are returned as ISO strings (UTC).
 *
 * Rules:
 * - DAILY: one calendar day. Due at the due time that day.
 * - WEEKLY: starts on `periodStartDayOfWeek`, runs seven days; due on the last workday in it.
 * - BI_WEEKLY: 14 days counted from `cadenceAnchorDate`.
 * - CUSTOM_INTERVAL: `customIntervalDays` days counted from `cadenceAnchorDate`.
 * - MONTHLY: the calendar month; due on its last workday.
 * - QUARTERLY (Phase 14): calendar quarters starting in `cadenceQuarterAnchorMonth` (default January,
 *   so Jan-Mar, Apr-Jun, ...); due on the last workday of the quarter.
 * - INSPECTION_ONLY: no periods (every function returns null or an empty list).
 *
 * Every date belongs to exactly one period: a non-workday after the due day (for example the Sunday
 * of a Monday-to-Saturday week) still belongs to that week, so a report made then is late.
 */
import type { ReportingCadence } from '../enums';
import { timeZoneOffsetMinutes } from './format';

export interface CadenceSettings {
  reportingCadence: ReportingCadence;
  /** ISO weekdays that are working days. */
  workWeekDays: number[];
  /** ISO weekday a weekly period starts on (also aligns the default bi-weekly anchor). */
  periodStartDayOfWeek: number;
  customIntervalDays?: number | null;
  /** HH:MM; a period opens at this time on its first workday. */
  workdayStartTime: string;
  /** HH:MM */
  workdayEndTime: string;
  /** HH:MM; null means workdayEndTime. */
  reportDueTime?: string | null;
  reportGraceMinutes: number;
  /** YYYY-MM-DD; first day of a bi-weekly or custom period. */
  cadenceAnchorDate?: string | null;
  /** Phase 14: month (1-12) a QUARTERLY year starts in; null or absent means January. */
  cadenceQuarterAnchorMonth?: number | null;
  /** IANA zone, e.g. "Africa/Lagos". */
  timezone: string;
}

export interface ReportingPeriod {
  /** First calendar day of the period. */
  periodStart: string;
  /** The due day: the last workday of the period (the last calendar day if it has none). */
  periodEnd: string;
  /** Last calendar day that belongs to the period (on or after periodEnd). */
  calendarEnd: string;
  /** First workday of the period; null if the period has no workday. */
  firstWorkday: string | null;
  /** When the period opens (first workday at workdayStartTime); its obligations are created then. */
  opensAt: string | null;
  /** Report due instant (periodEnd at the due time). */
  dueAt: string;
  /** dueAt plus grace: a report after this is late, an unfulfilled obligation is missed. */
  lateAfter: string;
  /** Whether the date asked about is a workday. */
  isWorkday: boolean;
}

export const DEFAULT_WORK_WEEK_DAYS = [1, 2, 3, 4, 5, 6];
export const ISO_WEEKDAY_LABELS: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday',
};
export const ISO_WEEKDAY_SHORT: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

/** Cadences with reporting periods (and therefore obligations and due times). */
export function cadenceHasPeriods(cadence: ReportingCadence): boolean {
  return cadence !== 'INSPECTION_ONLY';
}

// ---------------------------------------------------------------------------
// Calendar helpers (day numbers are days since 1970-01-01, independent of any zone)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function parseDate(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  if (!y || !m || !d) throw new Error(`Invalid calendar date: ${date}`);
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

function formatDay(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Adds `days` (may be negative) to a calendar date. */
export function addDays(date: string, days: number): string {
  return formatDay(parseDate(date) + days);
}

/** ISO weekday (1 = Monday ... 7 = Sunday) of a calendar date. */
export function isoWeekday(date: string): number {
  const dow = new Date(parseDate(date) * DAY_MS).getUTCDay(); // 0 = Sunday
  return dow === 0 ? 7 : dow;
}

/** Whole days from `a` to `b` (b - a). */
export function daysBetween(a: string, b: string): number {
  return parseDate(b) - parseDate(a);
}

function parseHhMm(hhmm: string | null | undefined, fallback: string): [number, number] {
  const value = hhmm && /^\d{2}:\d{2}$/.test(hhmm) ? hhmm : fallback;
  const [h, m] = value.split(':').map(Number);
  return [h, m];
}

/**
 * The instant at which a wall-clock time on a calendar date occurs in an IANA zone. Correct across
 * DST changes (the offset is re-evaluated at the candidate instant).
 */
export function zonedDateTimeToInstant(date: string, hhmm: string, timeZone: string): Date {
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi] = parseHhMm(hhmm, '00:00');
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  let guess = wall - timeZoneOffsetMinutes(timeZone, new Date(wall)) * 60_000;
  const offsetAtGuess = timeZoneOffsetMinutes(timeZone, new Date(guess));
  guess = wall - offsetAtGuess * 60_000;
  return new Date(guess);
}

/** Calendar date of an instant in an IANA zone (UTC when the zone is unknown). */
export function zonedCalendarDate(instant: Date | string, timeZone: string): string {
  const at = instant instanceof Date ? instant : new Date(instant);
  const local = new Date(at.getTime() + timeZoneOffsetMinutes(timeZone, at) * 60_000);
  return local.toISOString().slice(0, 10);
}

/** Minutes since local midnight of an instant in an IANA zone. */
export function zonedMinutesOfDay(instant: Date | string, timeZone: string): number {
  const at = instant instanceof Date ? instant : new Date(instant);
  const local = new Date(at.getTime() + timeZoneOffsetMinutes(timeZone, at) * 60_000);
  return local.getUTCHours() * 60 + local.getUTCMinutes();
}

export function hhMmToMinutes(hhmm: string | null | undefined, fallback = '00:00'): number {
  const [h, m] = parseHhMm(hhmm, fallback);
  return h * 60 + m;
}

function workdaySet(settings: CadenceSettings): Set<number> {
  const days = settings.workWeekDays.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  return new Set(days.length > 0 ? days : DEFAULT_WORK_WEEK_DAYS);
}

export function isWorkday(settings: CadenceSettings, date: string): boolean {
  return workdaySet(settings).has(isoWeekday(date));
}

/** Default anchor for bi-weekly / custom periods: the first `periodStartDayOfWeek` on or after 1970-01-01. */
function defaultAnchor(settings: CadenceSettings): string {
  const start = '1970-01-01';
  const delta = (((settings.periodStartDayOfWeek || 1) - isoWeekday(start)) % 7 + 7) % 7;
  return addDays(start, delta);
}

/** Month (1-12) a quarterly year starts in (Phase 14). */
export function quarterAnchorMonthOf(settings: Pick<CadenceSettings, 'cadenceQuarterAnchorMonth'>): number {
  const m = settings.cadenceQuarterAnchorMonth;
  return Number.isInteger(m) && (m as number) >= 1 && (m as number) <= 12 ? (m as number) : 1;
}

/** Calendar range [start, calendarEnd] of the period containing `date`, or null without periods. */
function calendarRange(settings: CadenceSettings, date: string): { start: string; end: string } | null {
  switch (settings.reportingCadence) {
    case 'INSPECTION_ONLY':
      return null;
    case 'DAILY':
      return { start: date, end: date };
    case 'WEEKLY': {
      const startDow = settings.periodStartDayOfWeek || 1;
      const back = ((isoWeekday(date) - startDow) % 7 + 7) % 7;
      const start = addDays(date, -back);
      return { start, end: addDays(start, 6) };
    }
    case 'BI_WEEKLY':
    case 'CUSTOM_INTERVAL': {
      const length =
        settings.reportingCadence === 'BI_WEEKLY' ? 14 : Math.max(1, Math.floor(settings.customIntervalDays ?? 7));
      const anchor = settings.cadenceAnchorDate || defaultAnchor(settings);
      const offset = daysBetween(anchor, date);
      const index = Math.floor(offset / length);
      const start = addDays(anchor, index * length);
      return { start, end: addDays(start, length - 1) };
    }
    case 'QUARTERLY': {
      const [y, m] = date.split('-').map(Number);
      const anchor = quarterAnchorMonthOf(settings) - 1;
      const absMonth = y * 12 + (m - 1);
      const startAbs = anchor + 3 * Math.floor((absMonth - anchor) / 3);
      const startDay = Math.floor(Date.UTC(Math.floor(startAbs / 12), startAbs % 12, 1) / DAY_MS);
      const nextStartDay = Math.floor(Date.UTC(Math.floor((startAbs + 3) / 12), (startAbs + 3) % 12, 1) / DAY_MS);
      return { start: formatDay(startDay), end: formatDay(nextStartDay - 1) };
    }
    case 'MONTHLY': {
      const start = `${date.slice(0, 7)}-01`;
      const [y, m] = date.split('-').map(Number);
      const nextMonth = formatDay(Math.floor(Date.UTC(y, m, 1) / DAY_MS));
      return { start, end: addDays(nextMonth, -1) };
    }
    default:
      return null;
  }
}

function datesInRange(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = parseDate(start); d <= parseDate(end); d++) out.push(formatDay(d));
  return out;
}

/** The reporting period that contains a calendar date, or null for INSPECTION_ONLY. */
export function getReportingPeriodForDate(settings: CadenceSettings, date: string): ReportingPeriod | null {
  const range = calendarRange(settings, date);
  if (!range) return null;
  const workdays = datesInRange(range.start, range.end).filter((d) => isWorkday(settings, d));
  const firstWorkday = workdays[0] ?? null;
  const periodEnd = workdays[workdays.length - 1] ?? range.end;
  const dueTime = settings.reportDueTime || settings.workdayEndTime || '17:00';
  const dueAt = zonedDateTimeToInstant(periodEnd, dueTime, settings.timezone);
  const lateAfter = new Date(dueAt.getTime() + Math.max(0, settings.reportGraceMinutes || 0) * 60_000);
  return {
    periodStart: range.start,
    periodEnd,
    calendarEnd: range.end,
    firstWorkday,
    opensAt: firstWorkday
      ? zonedDateTimeToInstant(firstWorkday, settings.workdayStartTime || '08:00', settings.timezone).toISOString()
      : null,
    dueAt: dueAt.toISOString(),
    lateAfter: lateAfter.toISOString(),
    isWorkday: isWorkday(settings, date),
  };
}

/** The reporting period that contains an instant (in the settings' time zone). */
export function getReportingPeriod(settings: CadenceSettings, instant: Date | string = new Date()): ReportingPeriod | null {
  return getReportingPeriodForDate(settings, zonedCalendarDate(instant, settings.timezone));
}

/** Workdays (YYYY-MM-DD) inside the period that contains `date`. */
export function listWorkdaysInPeriod(settings: CadenceSettings, date: string): string[] {
  const range = calendarRange(settings, date);
  if (!range) return [];
  return datesInRange(range.start, range.end).filter((d) => isWorkday(settings, d));
}

/** First calendar day of the period after the one containing `instant`, or null without periods. */
export function nextPeriodStart(settings: CadenceSettings, instant: Date | string = new Date()): string | null {
  const range = calendarRange(settings, zonedCalendarDate(instant, settings.timezone));
  return range ? addDays(range.end, 1) : null;
}

/** Short noun for a period: "today", "this week", "this fortnight", "this month", "this period". */
export function periodNoun(cadence: ReportingCadence): { adjective: string; current: string; report: string } {
  switch (cadence) {
    case 'DAILY':
      return { adjective: 'Daily', current: "Today's", report: 'Daily report' };
    case 'WEEKLY':
      return { adjective: 'Weekly', current: "This week's", report: 'Weekly report' };
    case 'BI_WEEKLY':
      return { adjective: 'Fortnightly', current: "This fortnight's", report: 'Fortnightly report' };
    case 'MONTHLY':
      return { adjective: 'Monthly', current: "This month's", report: 'Monthly report' };
    case 'QUARTERLY':
      return { adjective: 'Quarterly', current: "This quarter's", report: 'Quarterly report' };
    case 'CUSTOM_INTERVAL':
      return { adjective: 'Period', current: "This period's", report: 'Period report' };
    case 'INSPECTION_ONLY':
    default:
      return { adjective: 'Inspection', current: 'Current', report: 'Inspection report' };
  }
}

/** "Sat 17:00" style label of an instant in the project zone. */
export function formatDueLabel(instant: string | Date, timeZone: string): string {
  const date = zonedCalendarDate(instant, timeZone);
  const minutes = zonedMinutesOfDay(instant, timeZone);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${ISO_WEEKDAY_SHORT[isoWeekday(date)]} ${hh}:${mm}`;
}

/**
 * Plain-language preview for the setup wizard, e.g.
 * "Periods open Monday 08:00. Reports are due Saturday 17:00."
 */
export function describeCadence(settings: CadenceSettings, today: string): string {
  if (!cadenceHasPeriods(settings.reportingCadence)) {
    return 'No reporting periods: reports are made when an inspection happens, with no due time.';
  }
  const period = getReportingPeriodForDate(settings, today);
  if (!period || !period.firstWorkday) return 'This period has no workdays, so nothing is due.';
  const dueTime = settings.reportDueTime || settings.workdayEndTime;
  const grace = settings.reportGraceMinutes > 0 ? ` (${settings.reportGraceMinutes} min grace)` : '';
  if (settings.reportingCadence === 'DAILY') {
    return `Reports are due each workday at ${dueTime}${grace}.`;
  }
  const first = ISO_WEEKDAY_LABELS[isoWeekday(period.firstWorkday)];
  const last = ISO_WEEKDAY_LABELS[isoWeekday(period.periodEnd)];
  const span =
    settings.reportingCadence === 'WEEKLY'
      ? ''
      : ` The current period runs ${period.periodStart} to ${period.calendarEnd}.`;
  return `Periods open ${first} ${settings.workdayStartTime}. Reports are due ${last} ${dueTime}${grace}.${span}`;
}
