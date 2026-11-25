import { FACILITY_ARCHETYPE_META, type FacilityArchetype } from '../schemas/facility.schema';
import type { SprintStatus } from '../schemas/scope.schema';
import { addDays } from './calendar';

/**
 * Redesign R2b: pure scope rules shared by the server, the web page and the workbook importer.
 * Dates are YYYY-MM-DD strings in the project zone; a sprint includes both its start and end day.
 */

export interface ScopeIssue {
  code: string;
  message: string;
  /** Index of the offending entry in the list that was validated. */
  index?: number;
  field?: string;
}

/** A real calendar date in YYYY-MM-DD form (rejects 2026-02-30). */
export function isIsoCalendarDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export interface SprintLike {
  name: string;
  startDate: string;
  endDate: string;
}

/**
 * Sprints may differ in length and leave gaps, but may not overlap (D-R2.4). Returns every issue,
 * each with the index of the sprint in the given list.
 */
export function validateSprints(sprints: SprintLike[]): ScopeIssue[] {
  const issues: ScopeIssue[] = [];
  sprints.forEach((s, index) => {
    const label = s.name?.trim() || `Work phase ${index + 1}`;
    if (!s.name?.trim()) issues.push({ code: 'SPRINT_NAME_REQUIRED', message: 'Name the work phase.', index, field: 'name' });
    if (!isIsoCalendarDate(s.startDate)) {
      issues.push({ code: 'SPRINT_DATE_INVALID', message: `${label}: the start date is not a valid date.`, index, field: 'startDate' });
    }
    if (!isIsoCalendarDate(s.endDate)) {
      issues.push({ code: 'SPRINT_DATE_INVALID', message: `${label}: the end date is not a valid date.`, index, field: 'endDate' });
    }
    if (isIsoCalendarDate(s.startDate) && isIsoCalendarDate(s.endDate) && s.endDate < s.startDate) {
      issues.push({ code: 'SPRINT_END_BEFORE_START', message: `${label} ends before it starts.`, index, field: 'endDate' });
    }
  });
  const dated = sprints
    .map((s, index) => ({ s, index }))
    .filter(({ s }) => isIsoCalendarDate(s.startDate) && isIsoCalendarDate(s.endDate) && s.endDate >= s.startDate)
    .sort((a, b) => a.s.startDate.localeCompare(b.s.startDate) || a.s.endDate.localeCompare(b.s.endDate));
  for (let i = 1; i < dated.length; i++) {
    const prev = dated[i - 1];
    const cur = dated[i];
    if (cur.s.startDate <= prev.s.endDate) {
      issues.push({
        code: 'SPRINT_OVERLAP',
        message: `${cur.s.name || `Work phase ${cur.index + 1}`} (${cur.s.startDate} to ${cur.s.endDate}) overlaps ${
          prev.s.name || `Work phase ${prev.index + 1}`
        } (${prev.s.startDate} to ${prev.s.endDate}).`,
        index: cur.index,
        field: 'startDate',
      });
    }
  }
  return issues;
}

/** Sprint numbers follow date order: the indexes of `sprints` sorted by start date, then end date. */
export function sprintDateOrder<T extends SprintLike>(sprints: T[]): T[] {
  return [...sprints].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
}

export interface UnitLike {
  code: string;
  label: string;
  archetype: FacilityArchetype;
  plannedQuantity: number | null | undefined;
  /** Sprint numbers, or null when not set. */
  startSprintNumber: number | null | undefined;
  endSprintNumber: number | null | undefined;
}

/** Supply units carry a planned quantity; other archetypes do not. */
export function unitNeedsQuantity(archetype: FacilityArchetype): boolean {
  return FACILITY_ARCHETYPE_META[archetype].quantityBased;
}

/**
 * Units: unique codes, start sprint not after end sprint, a planned quantity on supply units.
 * `requireSprints` adds the activation rule (both sprints set).
 */
export function validateUnits(units: UnitLike[], opts: { requireSprints?: boolean } = {}): ScopeIssue[] {
  const issues: ScopeIssue[] = [];
  const seen = new Map<string, number>();
  units.forEach((u, index) => {
    const name = `${u.code} (${u.label})`;
    const key = u.code.trim().toUpperCase();
    if (seen.has(key)) {
      issues.push({ code: 'UNIT_CODE_DUPLICATE', message: `Unit ID ${u.code} is used more than once.`, index, field: 'code' });
    } else {
      seen.set(key, index);
    }
    const s = u.startSprintNumber ?? null;
    const e = u.endSprintNumber ?? null;
    if (s !== null && e !== null && s > e) {
      issues.push({ code: 'UNIT_SPRINT_ORDER', message: `${name} ends in work phase ${e}, before it starts in work phase ${s}.`, index, field: 'endSprint' });
    }
    if (opts.requireSprints && (s === null || e === null)) {
      issues.push({ code: 'UNIT_SPRINTS_REQUIRED', message: `${name} needs a start and an end work phase.`, index, field: s === null ? 'startSprint' : 'endSprint' });
    }
    if (unitNeedsQuantity(u.archetype) && !(typeof u.plannedQuantity === 'number' && u.plannedQuantity > 0)) {
      issues.push({ code: 'UNIT_QUANTITY_REQUIRED', message: `${name} is a supply item: enter the planned quantity.`, index, field: 'plannedQuantity' });
    }
  });
  return issues;
}

/**
 * UPCOMING before its start, ACTIVE from start to end (inclusive), then ENDED. Redesign R4e: VERIFIED
 * once it has a verification outcome; LATE when it ended more than `verificationDays` ago unverified.
 */
export function deriveSprintStatus(
  sprint: { startDate: string; endDate: string; verificationOutcome?: string | null },
  today: string,
  verificationDays?: number
): SprintStatus {
  if (today < sprint.startDate) return 'UPCOMING';
  if (sprint.verificationOutcome) return 'VERIFIED';
  if (today <= sprint.endDate) return 'ACTIVE';
  if (verificationDays !== undefined && today > addDays(sprint.endDate, verificationDays)) return 'LATE';
  return 'ENDED';
}

/** Units whose start–end sprint range covers the sprint with this number. */
export function unitsActiveInSprint<T extends { startSprintNumber: number | null; endSprintNumber: number | null }>(
  units: T[],
  sprintNumber: number
): T[] {
  return units.filter(
    (u) => u.startSprintNumber !== null && u.endSprintNumber !== null && u.startSprintNumber <= sprintNumber && sprintNumber <= u.endSprintNumber
  );
}

/**
 * Redesign R3 (D-R3.14): the sprint a visit date belongs to. The sprint whose start–end covers the
 * date; in a gap or after the last sprint, the latest sprint that started before it; before sprint 1
 * (or with no sprints), null.
 */
export function sprintForDate<T extends { startDate: string; endDate: string }>(sprints: T[], date: string): T | null {
  const ordered = [...sprints].sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate));
  const covering = ordered.find((s) => s.startDate <= date && date <= s.endDate);
  if (covering) return covering;
  const started = ordered.filter((s) => s.startDate <= date);
  return started.length > 0 ? started[started.length - 1] : null;
}

/** A line's amount: rate × quantity, rounded to kobo. */
export function lineAmount(quantity: number, rate: number): number {
  return Math.round(quantity * rate * 100) / 100;
}

/** The next free unit code: U01, U02, … (U100 after U99). */
export function nextUnitCode(existing: string[]): string {
  const used = new Set(existing.map((c) => c.toUpperCase()));
  for (let n = 1; ; n++) {
    const code = `U${String(n).padStart(2, '0')}`;
    if (!used.has(code)) return code;
  }
}

export interface SprintBadgeInput {
  today: string;
  /** Redesign R4e: each sprint's current verification outcome (null/absent = not verified). */
  sprints: Array<{ number: number; startDate: string; endDate: string; verificationOutcome?: 'MET' | 'PARTLY_MET' | 'NOT_MET' | null }>;
  /** Days after a sprint ends before an unverified sprint counts by its units (default 0). */
  verificationDays?: number;
  /** Each unit's end sprint number and whether all its lines are at 100%. */
  units: Array<{ endSprintNumber: number | null; complete: boolean }>;
  lineCount: number;
  /** Every line of the project at 100% progress. */
  allLinesComplete: boolean;
}

/**
 * The project schedule badge from sprints (D-R2.15, redesign R4e D-R4.32):
 * - UNSCHEDULED with no sprints;
 * - COMPLETE when every sprint is verified MET (a project with no verification yet: every line at 100%);
 * - NOT_STARTED before sprint 1;
 * - BEHIND when an ended sprint's current outcome is PARTLY_MET or NOT_MET, or an unverified sprint
 *   that ended more than `verificationDays` ago still has a unit below 100% (the R2 rule as fallback);
 * - ON_TRACK otherwise. Re-verifying a sprint MET after catching up clears BEHIND.
 */
export function sprintScheduleStatus(input: SprintBadgeInput): { status: 'UNSCHEDULED' | 'COMPLETE' | 'NOT_STARTED' | 'BEHIND' | 'ON_TRACK'; behindUnitCount: number } {
  if (input.sprints.length === 0) return { status: 'UNSCHEDULED', behindUnitCount: 0 };
  const anyVerified = input.sprints.some((s) => s.verificationOutcome);
  if (anyVerified && input.sprints.every((s) => s.verificationOutcome === 'MET')) return { status: 'COMPLETE', behindUnitCount: 0 };
  if (!anyVerified && input.lineCount > 0 && input.allLinesComplete) return { status: 'COMPLETE', behindUnitCount: 0 };
  const ordered = [...input.sprints].sort((a, b) => a.number - b.number);
  if (input.today < ordered[0].startDate) return { status: 'NOT_STARTED', behindUnitCount: 0 };
  const days = input.verificationDays ?? 0;
  const ended = ordered.filter((s) => s.endDate < input.today);
  const failed = ended.filter((s) => s.verificationOutcome === 'PARTLY_MET' || s.verificationOutcome === 'NOT_MET').map((s) => s.number);
  const overdue = new Set(ended.filter((s) => !s.verificationOutcome && addDays(s.endDate, days) < input.today).map((s) => s.number));
  const behindUnitCount = input.units.filter((u) => u.endSprintNumber !== null && overdue.has(u.endSprintNumber) && !u.complete).length;
  return { status: failed.length > 0 || behindUnitCount > 0 ? 'BEHIND' : 'ON_TRACK', behindUnitCount };
}
