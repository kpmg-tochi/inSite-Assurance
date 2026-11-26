import { addDays, isoWeekday } from './calendar';

/**
 * Client demo updates D4 (wave 4): calendar grids for the read-only visit calendar (project visit
 * plan and the planner). Pure, on YYYY-MM-DD strings; weeks start on Monday (ISO).
 */

export type CalendarSpan = 'month' | 'week';

export interface CalendarDay {
  date: string;
  /** False for the leading and trailing days of the neighbouring months (month view). */
  inMonth: boolean;
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Monday of the week `date` is in. */
export function startOfIsoWeek(date: string): string {
  return addDays(date, 1 - isoWeekday(date));
}

/** First day of the month of `date`. */
export function startOfMonth(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/** The weeks (Monday–Sunday) covering the month of `anchor`: 4 to 6 rows of 7 days. */
export function monthGrid(anchor: string): CalendarDay[][] {
  const first = startOfMonth(anchor);
  const month = first.slice(0, 7);
  let day = startOfIsoWeek(first);
  const weeks: CalendarDay[][] = [];
  do {
    const week: CalendarDay[] = [];
    for (let i = 0; i < 7; i++) {
      week.push({ date: day, inMonth: day.slice(0, 7) === month });
      day = addDays(day, 1);
    }
    weeks.push(week);
  } while (day.slice(0, 7) === month);
  return weeks;
}

/** The seven days (Monday–Sunday) of the week of `anchor`. */
export function weekGrid(anchor: string): CalendarDay[] {
  const start = startOfIsoWeek(anchor);
  return Array.from({ length: 7 }, (_, i) => ({ date: addDays(start, i), inMonth: true }));
}

/** The first and last day a view shows (for the query). */
export function calendarRange(anchor: string, span: CalendarSpan): { from: string; to: string } {
  if (span === 'week') {
    const start = startOfIsoWeek(anchor);
    return { from: start, to: addDays(start, 6) };
  }
  const weeks = monthGrid(anchor);
  return { from: weeks[0][0].date, to: weeks[weeks.length - 1][6].date };
}

/** The anchor one view earlier (-1) or later (+1). */
export function shiftCalendar(anchor: string, span: CalendarSpan, step: number): string {
  if (span === 'week') return addDays(startOfIsoWeek(anchor), 7 * step);
  const [y, m] = anchor.split('-').map(Number);
  const idx = y * 12 + (m - 1) + step;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}-01`;
}

/** "November 2026" (month) or "23 – 29 Nov 2026" (week). */
export function calendarTitle(anchor: string, span: CalendarSpan): string {
  if (span === 'month') {
    const [y, m] = anchor.split('-').map(Number);
    return `${MONTHS[m - 1]} ${y}`;
  }
  const start = startOfIsoWeek(anchor);
  const end = addDays(start, 6);
  const fmt = (d: string, withMonth: boolean, withYear: boolean) => {
    const [y, m, day] = d.split('-').map(Number);
    return `${day}${withMonth ? ` ${MONTHS[m - 1].slice(0, 3)}` : ''}${withYear ? ` ${y}` : ''}`;
  };
  const sameMonth = start.slice(0, 7) === end.slice(0, 7);
  const sameYear = start.slice(0, 4) === end.slice(0, 4);
  return `${fmt(start, !sameMonth, !sameYear)} – ${fmt(end, true, true)}`;
}
