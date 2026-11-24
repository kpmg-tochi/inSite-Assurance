/**
 * Working-day and planned-window helpers (Phase 9). Redesign R2d removed the earned-schedule
 * variance, dependencies and revisions: the schedule badge now follows sprints
 * (`sprintScheduleStatus` in utils/scope.ts). Dates are "YYYY-MM-DD" calendar dates in the project
 * zone; weekdays are ISO numbers (1 = Monday ... 7 = Sunday), as in calendar.ts.
 */
import { addDays, DEFAULT_WORK_WEEK_DAYS, isoWeekday } from './calendar';

export type ScheduleStatus = 'NOT_STARTED' | 'ON_TRACK' | 'AHEAD' | 'BEHIND' | 'COMPLETE' | 'UNSCHEDULED';

function workSet(workWeekDays: number[]): Set<number> {
  const days = (workWeekDays ?? []).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  return new Set(days.length > 0 ? days : DEFAULT_WORK_WEEK_DAYS);
}

export function isScheduleWorkday(date: string, workWeekDays: number[]): boolean {
  return workSet(workWeekDays).has(isoWeekday(date));
}

/**
 * Moves `n` working days from `date` (negative moves back). `addWorkdays(fri, 1)` on a Monday to
 * Friday week is the next Monday. With n = 0 the date is returned unchanged.
 */
export function addWorkdays(date: string, n: number, workWeekDays: number[]): string {
  const set = workSet(workWeekDays);
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(Math.trunc(n));
  let cursor = date;
  while (remaining > 0) {
    cursor = addDays(cursor, step);
    if (set.has(isoWeekday(cursor))) remaining -= 1;
  }
  return cursor;
}

/** The first working day on or after `date`. */
export function nextWorkdayOnOrAfter(date: string, workWeekDays: number[]): string {
  return isScheduleWorkday(date, workWeekDays) ? date : addWorkdays(date, 1, workWeekDays);
}

/** Last date of a window of `durationWorkdays` working days starting on (or after) `start`. */
export function windowEnd(start: string, durationWorkdays: number, workWeekDays: number[]): string {
  const first = nextWorkdayOnOrAfter(start, workWeekDays);
  return addWorkdays(first, Math.max(1, durationWorkdays) - 1, workWeekDays);
}

/** Whether a planned window overlaps [periodStart, periodEnd] (all inclusive). */
export function windowOverlaps(
  plannedStartDate: string | null | undefined,
  plannedEndDate: string | null | undefined,
  periodStart: string,
  periodEnd: string
): boolean {
  if (!plannedStartDate || !plannedEndDate) return false;
  return plannedStartDate <= periodEnd && plannedEndDate >= periodStart;
}
