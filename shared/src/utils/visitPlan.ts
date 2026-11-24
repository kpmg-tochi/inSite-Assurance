/**
 * Redesign R4: the visit plan maths. Pure and shared (server generators, the planner preview, the
 * phone's tolerance check). Dates are "YYYY-MM-DD" calendar dates in the project zone; weekdays are
 * ISO numbers (1 = Monday ... 7 = Sunday), as everywhere else.
 */
import type { VisitPlanRule } from '../schemas/visit.schema';
import { addDays, isoWeekday } from './reportingPeriod';
import { addWorkdays, isScheduleWorkday, nextWorkdayOnOrAfter } from './schedule';

export interface PlanSprint {
  number: number;
  startDate: string;
  endDate: string;
}

/** What a plan rule needs to know about a project (D-R4.11). */
export interface VisitPlanContext {
  /** The day the project went live (project zone). */
  activationDate: string;
  /** The day the kick-off was held, if it was. */
  kickoffHeldDate: string | null;
  sprints: PlanSprint[];
  /** Due date of the type's AUTO_CONTRACTOR_ON_SITE milestone, if any. */
  mobilisationDueDate: string | null;
  /** Fallback construction end when the project has no sprints. */
  plannedEndDate: string | null;
  workWeekDays: number[];
  /** The day the project entered handover (the contractor's completion notice). */
  completionNoticeDate: string | null;
  /** The day the project was closed. */
  closedDate: string | null;
  /** Due date of the type's PROJECT_CLOSED-anchored evaluation milestone, if any. */
  postClosureMilestoneDueDate: string | null;
}

const byDate = (a: { startDate: string }, b: { startDate: string }) => a.startDate.localeCompare(b.startDate);

/** Construction start and end: first sprint start / last sprint end, else activation / planned end. */
export function constructionWindow(ctx: VisitPlanContext): { start: string; end: string | null } {
  const ordered = [...ctx.sprints].sort(byDate);
  const start = ordered.length ? (ordered[0].startDate > ctx.activationDate ? ordered[0].startDate : ctx.activationDate) : ctx.activationDate;
  const end = ordered.length ? ordered.reduce((m, s) => (s.endDate > m ? s.endDate : m), ordered[0].endDate) : ctx.plannedEndDate;
  return { start, end };
}

/** The last working day on or before `date`. */
export function previousWorkdayOnOrBefore(date: string, workWeekDays: number[]): string {
  return isScheduleWorkday(date, workWeekDays) ? date : addWorkdays(date, -1, workWeekDays);
}

/** Every `weeks` weeks after `start` (exclusive), up to `end` (inclusive). */
function everyNWeeks(start: string, end: string, weeks: number): string[] {
  const out: string[] = [];
  const step = Math.max(1, Math.trunc(weeks)) * 7;
  for (let d = addDays(start, step); d <= end; d = addDays(d, step)) out.push(d);
  return out;
}

/** The first day of the month `monthIndex` (1–12) of `year`. */
function monthStart(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}-01`;
}

/** The quarters (anchored at `anchorMonth`) whose last month starts within [from, to]: first day of that month. */
function quarterLastMonthStarts(from: string, to: string, anchorMonth: number): string[] {
  const out: string[] = [];
  const anchor = Math.min(12, Math.max(1, Math.trunc(anchorMonth)));
  let year = Number(from.slice(0, 4)) - 1;
  const lastYear = Number(to.slice(0, 4)) + 1;
  for (; year <= lastYear; year++) {
    for (let q = 0; q < 4; q++) {
      const lastMonthZero = anchor - 1 + q * 3 + 2; // zero-based month index from Jan of `year`
      const y = year + Math.floor(lastMonthZero / 12);
      const m = (lastMonthZero % 12) + 1;
      const d = monthStart(y, m);
      if (d >= from.slice(0, 8) + '01' && d <= to) out.push(d);
    }
  }
  return [...new Set(out)].sort();
}

/**
 * The visit dates a plan rule proposes for a project (D-R4.11). Every date is moved to the next
 * working day (sprint rules: the last working day inside the sprint when that would leave it).
 * Sorted, without duplicates. Rules whose trigger has not happened return [].
 */
export function generateVisitDates(rule: VisitPlanRule, ctx: VisitPlanContext): string[] {
  const ww = ctx.workWeekDays;
  const roll = (d: string) => nextWorkdayOnOrAfter(d, ww);
  const { start, end } = constructionWindow(ctx);
  let dates: string[] = [];
  switch (rule.kind) {
    case 'EVERY_N_WEEKS_DURING_CONSTRUCTION':
      dates = end ? everyNWeeks(start, end, rule.intervalWeeks).map(roll) : [];
      break;
    case 'EVERY_N_WEEKS_IN_SPRINTS': {
      const wanted = new Set(rule.sprintNumbers);
      for (const s of [...ctx.sprints].sort(byDate)) {
        if (wanted.size > 0 && !wanted.has(s.number)) continue;
        if (s.endDate < ctx.activationDate) continue;
        const from = s.startDate > ctx.activationDate ? s.startDate : ctx.activationDate;
        let inSprint = everyNWeeks(from, s.endDate, rule.intervalWeeks);
        // A sprint shorter than the interval still gets one visit, on its last working day.
        if (inSprint.length === 0) inSprint = [s.endDate];
        for (const d of inSprint) {
          const rolled = roll(d);
          dates.push(rolled > s.endDate ? previousWorkdayOnOrBefore(s.endDate, ww) : rolled);
        }
      }
      break;
    }
    case 'EVERY_N_WEEKS_UNTIL_MOBILISED': {
      const from = ctx.kickoffHeldDate && ctx.kickoffHeldDate > ctx.activationDate ? ctx.kickoffHeldDate : ctx.activationDate;
      const until = ctx.mobilisationDueDate && ctx.mobilisationDueDate > from ? ctx.mobilisationDueDate : addDays(from, 7 * Math.max(1, rule.intervalWeeks));
      dates = everyNWeeks(from, until, rule.intervalWeeks).map(roll);
      break;
    }
    case 'QUARTERLY': {
      const to = end ?? addDays(start, 365);
      dates = quarterLastMonthStarts(start, to, rule.quarterAnchorMonth)
        .map((d) => addWorkdays(roll(d), rule.offsetWorkdays, ww))
        .filter((d) => d >= ctx.activationDate && d <= to);
      break;
    }
    case 'ONCE_AFTER_START': {
      const base = ctx.kickoffHeldDate && ctx.kickoffHeldDate > ctx.activationDate ? ctx.kickoffHeldDate : ctx.activationDate;
      dates = [addWorkdays(roll(base), rule.offsetWorkdays, ww)];
      break;
    }
    case 'ON_COMPLETION_NOTICE':
      dates = ctx.completionNoticeDate ? [addWorkdays(roll(ctx.completionNoticeDate), rule.offsetWorkdays, ww)] : [];
      break;
    case 'AFTER_PROJECT_CLOSED':
      dates = ctx.postClosureMilestoneDueDate
        ? [roll(ctx.postClosureMilestoneDueDate)]
        : ctx.closedDate
          ? [roll(addDays(ctx.closedDate, rule.offsetDays))]
          : [];
      break;
  }
  return [...new Set(dates)].sort();
}

/** The generator key stored on a proposed visit, so regeneration never duplicates it. */
export function visitGeneratorKey(ruleKey: string, date: string): string {
  return `${ruleKey}:${date}`;
}

/** Whether a rule is driven by sprints (regenerated when the sprints change, D-R4.12). */
export function isSprintDrivenRule(rule: Pick<VisitPlanRule, 'kind'>): boolean {
  return rule.kind === 'EVERY_N_WEEKS_DURING_CONSTRUCTION' || rule.kind === 'EVERY_N_WEEKS_IN_SPRINTS' || rule.kind === 'QUARTERLY';
}

/** Rules run on activation: everything that does not wait for a later event. */
export function isActivationRule(rule: Pick<VisitPlanRule, 'kind'>): boolean {
  return rule.kind !== 'ON_COMPLETION_NOTICE' && rule.kind !== 'AFTER_PROJECT_CLOSED';
}

/** The sprint whose start–end covers `date` (strict: gaps and dates outside every sprint give null). */
export function sprintCoveringDate<T extends PlanSprint>(sprints: T[], date: string): T | null {
  return sprints.find((s) => s.startDate <= date && date <= s.endDate) ?? null;
}

export type RescheduleCheck = { ok: true } | { ok: false; reason: 'OUTSIDE_TOLERANCE' | 'OTHER_SPRINT' | 'NOT_A_WORKDAY' };

/**
 * Whether an officer may move a visit to `proposed` without the manager (D-R4.14, D-R4.15): within
 * ± `toleranceWorkdays` working days of the original planned date, on a working day, and in the same
 * sprint as the original date (projects without sprints: tolerance only).
 */
export function withinRescheduleTolerance(
  original: string,
  proposed: string,
  toleranceWorkdays: number,
  workWeekDays: number[],
  sprints: PlanSprint[]
): RescheduleCheck {
  if (!isScheduleWorkday(proposed, workWeekDays)) return { ok: false, reason: 'NOT_A_WORKDAY' };
  const tol = Math.max(0, Math.trunc(toleranceWorkdays));
  const lo = tol === 0 ? original : addWorkdays(original, -tol, workWeekDays);
  const hi = tol === 0 ? original : addWorkdays(original, tol, workWeekDays);
  if (proposed < lo || proposed > hi) return { ok: false, reason: 'OUTSIDE_TOLERANCE' };
  if (sprints.length > 0) {
    const a = sprintCoveringDate(sprints, original);
    const b = sprintCoveringDate(sprints, proposed);
    if ((a?.number ?? null) !== (b?.number ?? null)) return { ok: false, reason: 'OTHER_SPRINT' };
  }
  return { ok: true };
}

/** The window an officer may move a visit within (for the phone's date picker). */
export function rescheduleWindow(original: string, toleranceWorkdays: number, workWeekDays: number[], sprints: PlanSprint[]): { from: string; to: string } {
  const tol = Math.max(0, Math.trunc(toleranceWorkdays));
  let from = tol === 0 ? original : addWorkdays(original, -tol, workWeekDays);
  let to = tol === 0 ? original : addWorkdays(original, tol, workWeekDays);
  const sprint = sprints.length ? sprintCoveringDate(sprints, original) : null;
  if (sprint) {
    if (from < sprint.startDate) from = nextWorkdayOnOrAfter(sprint.startDate, workWeekDays);
    if (to > sprint.endDate) to = previousWorkdayOnOrBefore(sprint.endDate, workWeekDays);
  }
  return { from, to };
}

/** The submission deadline: planned date + `days` calendar days (D-R4.21). */
export function submissionDeadlineFor(plannedDate: string, days: number): string {
  return addDays(plannedDate, Math.max(0, Math.trunc(days)));
}

/** ISO weekday helper re-exported for the planner grid. */
export const visitWeekday = isoWeekday;
