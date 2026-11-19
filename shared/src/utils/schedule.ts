/**
 * Schedule maths (Phase 9). Pure functions shared by server, web and mobile.
 *
 * Model (kept deliberately simple and explainable):
 * - Every BOQ item may have a planned window [plannedStartDate, plannedEndDate] (calendar dates
 *   "YYYY-MM-DD" in the project zone, both inclusive). Only the project's working days count.
 * - Planned progress is linear over the window's working days: by the end of the k-th working day
 *   of a D-day window, k/D of the item is expected.
 * - Variance is "earned schedule" in working days: the working days of work done (progress x D)
 *   minus the working days elapsed before today. Positive = ahead, negative = behind. Today does
 *   not count as elapsed: today's work is not due until the day ends.
 * - Dependencies are finish-to-start with a lag in working days: a successor may start on the first
 *   working day after its predecessor's end plus the lag.
 * - A catch-up revision moves dates, never durations or rates.
 *
 * Weekdays are ISO numbers (1 = Monday ... 7 = Sunday), as in reportingPeriod.ts.
 */
import { addDays, daysBetween, DEFAULT_WORK_WEEK_DAYS, isoWeekday } from './reportingPeriod';

export type ScheduleStatus = 'NOT_STARTED' | 'ON_TRACK' | 'AHEAD' | 'BEHIND' | 'COMPLETE' | 'UNSCHEDULED';

/** Where an item's planned window sits relative to a reporting period (mobile inbox). */
export type ItemPeriodStatus = 'DUE_THIS_PERIOD' | 'UPCOMING' | 'OVERDUE' | 'COMPLETE' | 'UNSCHEDULED';

/** A project is flagged once it is this many working weeks behind (schedule-variance job). */
export const SCHEDULE_BEHIND_ALERT_WEEKS = 2;

export interface ScheduledItem {
  id: string;
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  /** Weight for project roll-ups (budgeted cost). */
  weight?: number;
  /** Set when the item reached 100% certified; used for the variance of completed items. */
  actualCompletionDate?: string | null;
}

export interface ScheduleDependency {
  predecessorId: string;
  successorId: string;
  lagWorkdays: number;
}

// ---------------------------------------------------------------------------
// Working-day arithmetic
// ---------------------------------------------------------------------------

function workSet(workWeekDays: number[]): Set<number> {
  const days = (workWeekDays ?? []).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
  return new Set(days.length > 0 ? days : DEFAULT_WORK_WEEK_DAYS);
}

/** Number of working days in a week (for converting days to weeks). */
export function workWeekLength(workWeekDays: number[]): number {
  return workSet(workWeekDays).size;
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

/**
 * Working days from `a` to `b`: those in (a, b] when b is after a, minus those in (b, a] when b is
 * before a. So `workdaysBetween(a, addWorkdays(a, n)) === n` for any n.
 */
export function workdaysBetween(a: string, b: string, workWeekDays: number[]): number {
  const span = daysBetween(a, b);
  if (span === 0) return 0;
  const set = workSet(workWeekDays);
  const [from, to, sign] = span > 0 ? [a, b, 1] : [b, a, -1];
  const total = Math.abs(span);
  // Whole weeks first, then the remainder day by day.
  const weeks = Math.floor(total / 7);
  let count = weeks * set.size;
  let cursor = addDays(from, weeks * 7);
  while (cursor < to) {
    cursor = addDays(cursor, 1);
    if (set.has(isoWeekday(cursor))) count += 1;
  }
  return sign * count;
}

/** Working days in [start, end], both inclusive (0 when end is before start). */
export function countWorkdaysInclusive(start: string, end: string, workWeekDays: number[]): number {
  if (end < start) return 0;
  return workdaysBetween(addDays(start, -1), end, workWeekDays);
}

/** The first working day on or after `date`. */
export function nextWorkdayOnOrAfter(date: string, workWeekDays: number[]): string {
  return isScheduleWorkday(date, workWeekDays) ? date : addWorkdays(date, 1, workWeekDays);
}

/** Planned duration of an item in working days (at least 1 for a valid window). */
export function plannedDurationWorkdays(item: Pick<ScheduledItem, 'plannedStartDate' | 'plannedEndDate'>, workWeekDays: number[]): number {
  if (!item.plannedStartDate || !item.plannedEndDate) return 0;
  return Math.max(1, countWorkdaysInclusive(item.plannedStartDate, item.plannedEndDate, workWeekDays));
}

/** Last date of a window of `durationWorkdays` working days starting on (or after) `start`. */
export function windowEnd(start: string, durationWorkdays: number, workWeekDays: number[]): string {
  const first = nextWorkdayOnOrAfter(start, workWeekDays);
  return addWorkdays(first, Math.max(1, durationWorkdays) - 1, workWeekDays);
}

// ---------------------------------------------------------------------------
// Progress and variance
// ---------------------------------------------------------------------------

/** Percent of the item planned to be done by the end of `date` (linear over working days). */
export function expectedPctAt(item: Pick<ScheduledItem, 'plannedStartDate' | 'plannedEndDate'>, date: string, workWeekDays: number[]): number {
  if (!item.plannedStartDate || !item.plannedEndDate) return 0;
  if (date < item.plannedStartDate) return 0;
  if (date >= item.plannedEndDate) return 100;
  const duration = plannedDurationWorkdays(item, workWeekDays);
  const elapsed = countWorkdaysInclusive(item.plannedStartDate, date, workWeekDays);
  return Math.min(100, Math.max(0, (elapsed / duration) * 100));
}

export interface ItemVarianceResult {
  status: ScheduleStatus;
  /** Positive = ahead, negative = behind; null when unscheduled. Not rounded. */
  varianceWorkdays: number | null;
  /** Percent planned by the end of yesterday. */
  expectedPct: number;
}

/** Rounds working days to the nearest half week, returned in working days. */
export function roundToHalfWeekWorkdays(workdays: number, workWeekDays: number[]): number {
  const half = workWeekLength(workWeekDays) / 2;
  const rounded = Math.round(Math.abs(workdays) / half) * half;
  return rounded === 0 ? 0 : Math.sign(workdays) * rounded;
}

function statusFromVariance(varianceWorkdays: number, workWeekDays: number[]): ScheduleStatus {
  const rounded = roundToHalfWeekWorkdays(varianceWorkdays, workWeekDays);
  if (rounded === 0) return 'ON_TRACK';
  return rounded > 0 ? 'AHEAD' : 'BEHIND';
}

/**
 * Variance of one item at `today` given its progress (0-100).
 * - UNSCHEDULED: no planned window.
 * - COMPLETE: progress 100; variance = working days between the actual completion and the planned
 *   end (positive when finished early), 0 when the completion date is not known.
 * - NOT_STARTED: no progress and the window has not opened yet.
 * - otherwise AHEAD / ON_TRACK / BEHIND by earned schedule, within half a week counts as on track.
 */
export function itemVariance(item: ScheduledItem, progressPct: number, today: string, workWeekDays: number[]): ItemVarianceResult {
  if (!item.plannedStartDate || !item.plannedEndDate) {
    return { status: 'UNSCHEDULED', varianceWorkdays: null, expectedPct: 0 };
  }
  const yesterday = addDays(today, -1);
  const expectedPct = expectedPctAt(item, yesterday, workWeekDays);
  const progress = Math.min(100, Math.max(0, progressPct || 0));
  if (progress >= 100) {
    const variance = item.actualCompletionDate
      ? workdaysBetween(item.actualCompletionDate, item.plannedEndDate, workWeekDays)
      : 0;
    return { status: 'COMPLETE', varianceWorkdays: variance, expectedPct };
  }
  const duration = plannedDurationWorkdays(item, workWeekDays);
  const elapsed = today <= item.plannedStartDate ? 0 : countWorkdaysInclusive(item.plannedStartDate, yesterday, workWeekDays);
  const earned = (progress / 100) * duration;
  const variance = earned - elapsed;
  if (progress === 0 && elapsed === 0) return { status: 'NOT_STARTED', varianceWorkdays: 0, expectedPct };
  return { status: statusFromVariance(variance, workWeekDays), varianceWorkdays: variance, expectedPct };
}

export interface ProjectVarianceItem extends ScheduledItem {
  progressPct: number;
}

export interface ProjectVarianceResult {
  status: ScheduleStatus;
  /** Budget-weighted item variance; positive = ahead. Null when no item is scheduled. */
  varianceWorkdays: number | null;
  /** Forecast end: remaining work at planned rates from today, pushed through dependencies. */
  forecastEndDate: string | null;
  /** Latest planned item end (the current plan's end). */
  plannedEndDate: string | null;
  /** Working days the forecast is past the planned end (positive = late). */
  forecastSlipWorkdays: number | null;
  scheduledItemCount: number;
}

/**
 * Project roll-up. Variance is the budget-weighted mean of item variances (equal weights when no
 * item has a budget). The forecast end runs each unfinished item's remaining working days at its
 * planned rate, starting no earlier than today or its planned start, and no earlier than the day
 * after each predecessor's forecast end plus lag.
 */
export function projectVariance(
  items: ProjectVarianceItem[],
  today: string,
  workWeekDays: number[],
  dependencies: ScheduleDependency[] = []
): ProjectVarianceResult {
  const scheduled = items.filter((i) => i.plannedStartDate && i.plannedEndDate);
  if (scheduled.length === 0) {
    return {
      status: 'UNSCHEDULED',
      varianceWorkdays: null,
      forecastEndDate: null,
      plannedEndDate: null,
      forecastSlipWorkdays: null,
      scheduledItemCount: 0,
    };
  }
  const anyWeight = scheduled.some((i) => (i.weight ?? 0) > 0);
  let weightSum = 0;
  let weighted = 0;
  let allComplete = true;
  let anyStarted = false;
  for (const item of scheduled) {
    const v = itemVariance(item, item.progressPct, today, workWeekDays);
    const w = anyWeight ? Math.max(0, item.weight ?? 0) : 1;
    weightSum += w;
    weighted += w * (v.varianceWorkdays ?? 0);
    if (v.status !== 'COMPLETE') allComplete = false;
    if (v.status !== 'NOT_STARTED') anyStarted = true;
  }
  const variance = weightSum > 0 ? weighted / weightSum : 0;

  // Forecast: forward pass in dependency order.
  const byId = new Map(scheduled.map((i) => [i.id, i]));
  const order = topologicalOrder(
    scheduled.map((i) => i.id),
    dependencies.filter((d) => byId.has(d.predecessorId) && byId.has(d.successorId))
  );
  const ids = order.order ?? scheduled.map((i) => i.id);
  const preds = new Map<string, ScheduleDependency[]>();
  for (const d of dependencies) {
    if (!byId.has(d.predecessorId) || !byId.has(d.successorId)) continue;
    preds.set(d.successorId, [...(preds.get(d.successorId) ?? []), d]);
  }
  const forecastEnd = new Map<string, string>();
  const yesterday = addDays(today, -1);
  for (const id of ids) {
    const item = byId.get(id)!;
    const progress = Math.min(100, Math.max(0, item.progressPct || 0));
    if (progress >= 100) {
      forecastEnd.set(id, item.actualCompletionDate ?? (item.plannedEndDate! < today ? item.plannedEndDate! : yesterday));
      continue;
    }
    const duration = plannedDurationWorkdays(item, workWeekDays);
    const remaining = Math.max(1, Math.ceil(((100 - progress) / 100) * duration - 1e-9));
    // Earliest day work can continue: today, the planned start, after each predecessor.
    let start = today > item.plannedStartDate! ? today : item.plannedStartDate!;
    for (const d of preds.get(id) ?? []) {
      const predEnd = forecastEnd.get(d.predecessorId);
      if (!predEnd) continue;
      const earliest = addWorkdays(predEnd, 1 + Math.max(0, d.lagWorkdays), workWeekDays);
      if (earliest > start) start = earliest;
    }
    forecastEnd.set(id, windowEnd(start, remaining, workWeekDays));
  }
  const plannedEnds = scheduled.map((i) => i.plannedEndDate!).sort();
  const plannedEnd = plannedEnds[plannedEnds.length - 1];
  const forecasts = [...forecastEnd.values()].sort();
  const forecast = forecasts[forecasts.length - 1];
  let status: ScheduleStatus;
  if (allComplete) status = 'COMPLETE';
  else if (!anyStarted) status = 'NOT_STARTED';
  else status = statusFromVariance(variance, workWeekDays);
  return {
    status,
    varianceWorkdays: variance,
    forecastEndDate: forecast,
    plannedEndDate: plannedEnd,
    forecastSlipWorkdays: workdaysBetween(plannedEnd, forecast, workWeekDays),
    scheduledItemCount: scheduled.length,
  };
}

/**
 * "On schedule", "1 week ahead", "4 weeks behind", "1.5 weeks behind". Rounded to the nearest half
 * week of the project's work-week; positive = ahead.
 */
export function formatVariance(workdays: number | null, workWeekDays: number[] = DEFAULT_WORK_WEEK_DAYS): string {
  if (workdays === null || !Number.isFinite(workdays)) return 'Not scheduled';
  const rounded = roundToHalfWeekWorkdays(workdays, workWeekDays);
  if (rounded === 0) return 'On schedule';
  const weeks = Math.abs(rounded) / workWeekLength(workWeekDays);
  const text = Number.isInteger(weeks) ? String(weeks) : weeks.toFixed(1);
  return `${text} week${weeks === 1 ? '' : 's'} ${rounded > 0 ? 'ahead' : 'behind'}`;
}

/** Variance in working weeks rounded to the nearest half week (positive = ahead). */
export function varianceWeeks(workdays: number | null, workWeekDays: number[]): number | null {
  if (workdays === null) return null;
  return roundToHalfWeekWorkdays(workdays, workWeekDays) / workWeekLength(workWeekDays);
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

/** Due this period, upcoming or overdue, for the mobile inbox. */
export function itemPeriodStatus(
  item: { plannedStartDate?: string | null; plannedEndDate?: string | null; progressPct?: number },
  periodStart: string,
  periodEnd: string
): ItemPeriodStatus {
  if ((item.progressPct ?? 0) >= 100) return 'COMPLETE';
  if (!item.plannedStartDate || !item.plannedEndDate) return 'UNSCHEDULED';
  if (item.plannedEndDate < periodStart) return 'OVERDUE';
  if (item.plannedStartDate > periodEnd) return 'UPCOMING';
  return 'DUE_THIS_PERIOD';
}

// ---------------------------------------------------------------------------
// Dependencies and propagation
// ---------------------------------------------------------------------------

/** Kahn's algorithm. Returns the order, or the ids left on a cycle. */
export function topologicalOrder(
  ids: string[],
  dependencies: Array<Pick<ScheduleDependency, 'predecessorId' | 'successorId'>>
): { order: string[] | null; cycle: string[] } {
  const indegree = new Map(ids.map((id) => [id, 0]));
  const next = new Map<string, string[]>();
  for (const d of dependencies) {
    if (!indegree.has(d.predecessorId) || !indegree.has(d.successorId)) continue;
    indegree.set(d.successorId, (indegree.get(d.successorId) ?? 0) + 1);
    next.set(d.predecessorId, [...(next.get(d.predecessorId) ?? []), d.successorId]);
  }
  const queue = ids.filter((id) => indegree.get(id) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    for (const s of next.get(id) ?? []) {
      indegree.set(s, indegree.get(s)! - 1);
      if (indegree.get(s) === 0) queue.push(s);
    }
  }
  if (order.length === ids.length) return { order, cycle: [] };
  return { order: null, cycle: ids.filter((id) => (indegree.get(id) ?? 0) > 0) };
}

export interface ScheduleChange {
  boqItemId: string;
  /** New planned start; the duration in working days is kept. */
  newStartDate?: string | null;
  /** Or: move the window by this many working days (positive = later). */
  shiftWorkdays?: number | null;
}

export interface ScheduleAdjustment {
  boqItemId: string;
  previousStartDate: string;
  previousEndDate: string;
  newStartDate: string;
  newEndDate: string;
  /** Working days the end moved (positive = later). */
  shiftWorkdays: number;
  cause: 'REQUESTED' | 'DEPENDENCY';
}

export class ScheduleCycleError extends Error {
  constructor(public readonly itemIds: string[]) {
    super('The dependencies form a cycle');
  }
}

/**
 * Applies the requested changes, then pushes every successor that would now start before its
 * predecessor's end plus lag to the first allowed working day, keeping its duration. Successors are
 * only ever moved later (a catch-up absorbs delays; it never pulls work forward). Items without a
 * planned window are left alone. Returns only the items whose dates changed. Throws
 * ScheduleCycleError when the dependencies form a cycle.
 */
export function propagateShift(
  items: Array<Pick<ScheduledItem, 'id' | 'plannedStartDate' | 'plannedEndDate'>>,
  dependencies: ScheduleDependency[],
  changes: ScheduleChange[],
  workWeekDays: number[]
): ScheduleAdjustment[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const { order, cycle } = topologicalOrder(
    items.map((i) => i.id),
    dependencies
  );
  if (!order) throw new ScheduleCycleError(cycle);

  const dates = new Map<string, { start: string; end: string }>();
  for (const i of items) {
    if (i.plannedStartDate && i.plannedEndDate) dates.set(i.id, { start: i.plannedStartDate, end: i.plannedEndDate });
  }
  const requested = new Set<string>();
  for (const c of changes) {
    const current = dates.get(c.boqItemId);
    const item = byId.get(c.boqItemId);
    if (!current || !item) continue;
    const duration = plannedDurationWorkdays({ plannedStartDate: current.start, plannedEndDate: current.end }, workWeekDays);
    let start: string;
    let end: string;
    if (c.newStartDate) {
      start = nextWorkdayOnOrAfter(c.newStartDate, workWeekDays);
      end = windowEnd(start, duration, workWeekDays);
    } else {
      const n = Math.trunc(c.shiftWorkdays ?? 0);
      start = addWorkdays(nextWorkdayOnOrAfter(current.start, workWeekDays), n, workWeekDays);
      end = windowEnd(start, duration, workWeekDays);
    }
    dates.set(c.boqItemId, { start, end });
    requested.add(c.boqItemId);
  }

  const preds = new Map<string, ScheduleDependency[]>();
  for (const d of dependencies) preds.set(d.successorId, [...(preds.get(d.successorId) ?? []), d]);
  for (const id of order) {
    const current = dates.get(id);
    if (!current) continue;
    let earliest: string | null = null;
    for (const d of preds.get(id) ?? []) {
      const p = dates.get(d.predecessorId);
      if (!p) continue;
      const e = addWorkdays(p.end, 1 + Math.max(0, d.lagWorkdays), workWeekDays);
      if (!earliest || e > earliest) earliest = e;
    }
    if (earliest && current.start < earliest) {
      const duration = plannedDurationWorkdays({ plannedStartDate: current.start, plannedEndDate: current.end }, workWeekDays);
      dates.set(id, { start: earliest, end: windowEnd(earliest, duration, workWeekDays) });
    }
  }

  const out: ScheduleAdjustment[] = [];
  for (const id of order) {
    const item = byId.get(id)!;
    const next = dates.get(id);
    if (!next || !item.plannedStartDate || !item.plannedEndDate) continue;
    if (next.start === item.plannedStartDate && next.end === item.plannedEndDate) continue;
    out.push({
      boqItemId: id,
      previousStartDate: item.plannedStartDate,
      previousEndDate: item.plannedEndDate,
      newStartDate: next.start,
      newEndDate: next.end,
      shiftWorkdays: workdaysBetween(item.plannedEndDate, next.end, workWeekDays),
      cause: requested.has(id) ? 'REQUESTED' : 'DEPENDENCY',
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Baseline validation and the "propose dates" helper
// ---------------------------------------------------------------------------

export interface ScheduleIssue {
  code:
    | 'ITEM_DATES_INCOMPLETE'
    | 'ITEM_END_BEFORE_START'
    | 'ITEM_OUTSIDE_PROJECT'
    | 'PROJECT_END_BEFORE_START'
    | 'DEPENDENCY_SELF'
    | 'DEPENDENCY_UNKNOWN_ITEM'
    | 'DEPENDENCY_DUPLICATE'
    | 'DEPENDENCY_UNDATED'
    | 'SUCCESSOR_STARTS_TOO_EARLY'
    | 'DEPENDENCY_CYCLE';
  message: string;
  boqItemId?: string;
  itemIds?: string[];
}

/**
 * Checks a baseline: each item's window is complete, ordered and inside the project dates; each
 * dependency links two different dated items once; each successor starts after its predecessor's
 * end plus lag; and there are no cycles. Returns every problem found (empty when valid).
 */
export function validateScheduleBaseline(params: {
  plannedStartDate: string | null;
  plannedEndDate: string | null;
  items: Array<Pick<ScheduledItem, 'id' | 'plannedStartDate' | 'plannedEndDate'> & { label?: string }>;
  dependencies: ScheduleDependency[];
  workWeekDays: number[];
  /** When false, items may sit outside the project dates (after an approved revision). */
  enforceProjectWindow?: boolean;
}): ScheduleIssue[] {
  const issues: ScheduleIssue[] = [];
  const { plannedStartDate: ps, plannedEndDate: pe, workWeekDays } = params;
  if (ps && pe && pe < ps) {
    issues.push({ code: 'PROJECT_END_BEFORE_START', message: 'The project end date is before its start date.' });
  }
  const byId = new Map(params.items.map((i) => [i.id, i]));
  const name = (id: string) => byId.get(id)?.label ?? id;
  for (const item of params.items) {
    const s = item.plannedStartDate;
    const e = item.plannedEndDate;
    if (!s && !e) continue;
    if (!s || !e) {
      issues.push({ code: 'ITEM_DATES_INCOMPLETE', message: `${name(item.id)}: enter both a start and an end date.`, boqItemId: item.id });
      continue;
    }
    if (e < s) {
      issues.push({ code: 'ITEM_END_BEFORE_START', message: `${name(item.id)}: the end date is before the start date.`, boqItemId: item.id });
      continue;
    }
    if (params.enforceProjectWindow !== false && ((ps && s < ps) || (pe && e > pe))) {
      issues.push({ code: 'ITEM_OUTSIDE_PROJECT', message: `${name(item.id)}: dates must fall within the project dates.`, boqItemId: item.id });
    }
  }
  const seen = new Set<string>();
  for (const d of params.dependencies) {
    if (d.predecessorId === d.successorId) {
      issues.push({ code: 'DEPENDENCY_SELF', message: `${name(d.successorId)} cannot depend on itself.`, boqItemId: d.successorId });
      continue;
    }
    if (!byId.has(d.predecessorId) || !byId.has(d.successorId)) {
      issues.push({ code: 'DEPENDENCY_UNKNOWN_ITEM', message: 'A dependency refers to an item that is not in this project.' });
      continue;
    }
    const key = `${d.predecessorId}>${d.successorId}`;
    if (seen.has(key)) {
      issues.push({ code: 'DEPENDENCY_DUPLICATE', message: `${name(d.successorId)} lists ${name(d.predecessorId)} twice.`, boqItemId: d.successorId });
      continue;
    }
    seen.add(key);
    const p = byId.get(d.predecessorId)!;
    const s = byId.get(d.successorId)!;
    if (!p.plannedEndDate || !s.plannedStartDate) {
      issues.push({
        code: 'DEPENDENCY_UNDATED',
        message: `${name(d.successorId)} and its predecessor ${name(d.predecessorId)} both need dates.`,
        boqItemId: d.successorId,
      });
      continue;
    }
    const earliest = addWorkdays(p.plannedEndDate, 1 + Math.max(0, d.lagWorkdays), workWeekDays);
    if (s.plannedStartDate < earliest) {
      issues.push({
        code: 'SUCCESSOR_STARTS_TOO_EARLY',
        message: `${name(d.successorId)} starts before ${name(d.predecessorId)} finishes${d.lagWorkdays > 0 ? ` plus ${d.lagWorkdays} working day(s)` : ''}; earliest start is ${earliest}.`,
        boqItemId: d.successorId,
      });
    }
  }
  const { cycle } = topologicalOrder(
    params.items.map((i) => i.id),
    params.dependencies.filter((d) => d.predecessorId !== d.successorId)
  );
  if (cycle.length > 0) {
    issues.push({
      code: 'DEPENDENCY_CYCLE',
      message: `The dependencies form a cycle (${cycle.map(name).join(', ')}).`,
      itemIds: cycle,
    });
  }
  return issues;
}

export interface ProposeDatesItem {
  id: string;
  section: string;
  totalQuantity: number;
  dailyTargetQuantity: number | null;
  budgetedCostNgn: number;
}

/**
 * Suggests item dates between the project start and end (a starting point for people to adjust):
 * - sections run one after another in BOQ order, each given a share of the project's working days
 *   in proportion to its budget (at least one day each);
 * - items within a section start together at the section start;
 * - an item with a daily target lasts ceil(quantity / daily target) working days, capped at its
 *   section's window; an item without one fills the section window.
 * Items keep the order given (pass them in BOQ order).
 */
export function proposeItemDates(
  items: ProposeDatesItem[],
  projectStart: string,
  projectEnd: string,
  workWeekDays: number[]
): Array<{ boqItemId: string; plannedStartDate: string; plannedEndDate: string }> {
  if (items.length === 0 || projectEnd < projectStart) return [];
  const first = nextWorkdayOnOrAfter(projectStart, workWeekDays);
  const totalDays = Math.max(1, countWorkdaysInclusive(first, projectEnd, workWeekDays));
  const sections: Array<{ name: string; items: ProposeDatesItem[]; budget: number }> = [];
  for (const item of items) {
    let s = sections.find((x) => x.name === item.section);
    if (!s) {
      s = { name: item.section, items: [], budget: 0 };
      sections.push(s);
    }
    s.items.push(item);
    s.budget += Math.max(0, item.budgetedCostNgn);
  }
  const totalBudget = sections.reduce((sum, s) => sum + s.budget, 0);
  // Largest-remainder allocation of the working days, each section at least one day.
  const raw = sections.map((s) => (totalBudget > 0 ? (s.budget / totalBudget) * totalDays : totalDays / sections.length));
  const alloc = raw.map((r) => Math.max(1, Math.floor(r)));
  let left = totalDays - alloc.reduce((a, b) => a + b, 0);
  const byRemainder = raw.map((r, i) => ({ i, rem: r - Math.floor(r) })).sort((a, b) => b.rem - a.rem);
  for (let k = 0; left > 0 && k < byRemainder.length; k++, left--) alloc[byRemainder[k].i] += 1;

  const out: Array<{ boqItemId: string; plannedStartDate: string; plannedEndDate: string }> = [];
  let cursor = first;
  sections.forEach((section, index) => {
    const days = Math.max(1, alloc[index]);
    const sectionEnd = windowEnd(cursor, days, workWeekDays);
    const cappedEnd = sectionEnd > projectEnd ? projectEnd : sectionEnd;
    for (const item of section.items) {
      const need =
        item.dailyTargetQuantity && item.dailyTargetQuantity > 0
          ? Math.ceil(item.totalQuantity / item.dailyTargetQuantity)
          : days;
      const end = windowEnd(cursor, Math.min(days, Math.max(1, need)), workWeekDays);
      out.push({ boqItemId: item.id, plannedStartDate: cursor, plannedEndDate: end > cappedEnd ? cappedEnd : end });
    }
    const nextStart = addWorkdays(sectionEnd, 1, workWeekDays);
    cursor = nextStart > projectEnd ? cappedEnd : nextStart;
  });
  return out;
}
