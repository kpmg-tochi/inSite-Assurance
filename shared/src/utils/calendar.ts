/**
 * Calendar-date helpers shared by server, web and mobile (moved out of the Phase 8 reporting-period
 * maths when redesign R5f deleted cadence). Dates are calendar dates "YYYY-MM-DD"; weekdays are ISO
 * numbers (1 = Monday ... 7 = Sunday). Day numbers are days since 1970-01-01, independent of any zone.
 */
import { timeZoneOffsetMinutes } from './format';

/** Default working week of a project (Monday to Saturday). */
export const DEFAULT_WORK_WEEK_DAYS = [1, 2, 3, 4, 5, 6];

export const ISO_WEEKDAY_SHORT: Record<number, string> = {
  1: 'Mon',
  2: 'Tue',
  3: 'Wed',
  4: 'Thu',
  5: 'Fri',
  6: 'Sat',
  7: 'Sun',
};

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

/** Calendar date of an instant in an IANA zone (UTC when the zone is unknown). */
export function zonedCalendarDate(instant: Date | string, timeZone: string): string {
  const at = instant instanceof Date ? instant : new Date(instant);
  const local = new Date(at.getTime() + timeZoneOffsetMinutes(timeZone, at) * 60_000);
  return local.toISOString().slice(0, 10);
}
