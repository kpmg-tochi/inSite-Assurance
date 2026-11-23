import type {
  ContractMilestoneAnchor,
  ContractMilestoneStatus,
  MilestoneOffsetUnit,
} from '../schemas/contract.schema';
import { CONTRACT_MILESTONE_ANCHOR_META } from '../schemas/contract.schema';
import { addDays, daysBetween } from './reportingPeriod';
import { addWorkdays } from './schedule';

/**
 * Phase 13: contract milestone dates. Pure; the server stores the result, the web shows it.
 *
 * A milestone's due date is its anchor date moved by its offset (calendar or working days in the
 * project's work-week; negative = before). Anchors are project dates (contract award, contract
 * signed, kick-off, activation) or another milestone's completion. A milestone anchored on
 * another counts from the day that one was done (or, if waived, from its due date); until then
 * it has no date. A missing anchor date leaves the due date null.
 */

export interface MilestoneAnchorDates {
  CONTRACT_AWARD: string | null;
  CONTRACT_SIGNED: string | null;
  KICKOFF: string | null;
  ACTIVATION: string | null;
  /** Phase 15: issue date of the current Certificate of Completion. */
  COC_ISSUED: string | null;
  /** Phase 15: the day the project was closed. */
  PROJECT_CLOSED: string | null;
}

export interface MilestoneDateRow {
  /** Any unique reference (row id). */
  id: string;
  key: string;
  projectContractorId: string | null;
  anchor: ContractMilestoneAnchor;
  anchorMilestoneKey: string | null;
  offsetValue: number;
  offsetUnit: MilestoneOffsetUnit;
  /** Replacement contractors: counts from this date instead of the anchor. */
  anchorDateOverride?: string | null;
  status?: ContractMilestoneStatus;
  /** The day it was done, in the project zone (DONE rows). */
  completedDate?: string | null;
}

export function applyMilestoneOffset(date: string, offsetValue: number, unit: MilestoneOffsetUnit, workWeekDays: number[]): string {
  return unit === 'WORKING_DAYS' ? addWorkdays(date, offsetValue, workWeekDays) : addDays(date, offsetValue);
}

/** Due date per row id. */
export function computeMilestoneDueDates(
  rows: MilestoneDateRow[],
  anchors: MilestoneAnchorDates,
  workWeekDays: number[]
): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const visiting = new Set<string>();

  /** The referenced row: same contractor first, then the project-level one. */
  const findRef = (row: MilestoneDateRow): MilestoneDateRow | null => {
    if (!row.anchorMilestoneKey) return null;
    return (
      rows.find((r) => r.key === row.anchorMilestoneKey && r.projectContractorId === row.projectContractorId) ??
      rows.find((r) => r.key === row.anchorMilestoneKey && r.projectContractorId === null) ??
      null
    );
  };

  const due = (row: MilestoneDateRow): string | null => {
    if (out.has(row.id)) return out.get(row.id)!;
    if (visiting.has(row.id)) return null; // cycle: no date
    visiting.add(row.id);
    let base: string | null;
    if (row.anchorDateOverride) {
      base = row.anchorDateOverride;
    } else if (row.anchor === 'MILESTONE') {
      const ref = findRef(row);
      if (!ref) base = null;
      else if (ref.status === 'DONE') base = ref.completedDate ?? null;
      else if (ref.status === 'WAIVED') base = due(ref);
      else base = null;
    } else {
      base = anchors[row.anchor];
    }
    const result = base ? applyMilestoneOffset(base, row.offsetValue, row.offsetUnit, workWeekDays) : null;
    visiting.delete(row.id);
    out.set(row.id, result);
    return result;
  };

  for (const row of rows) due(row);
  return out;
}

/** The live status of a milestone today (DONE and WAIVED are kept). */
export function deriveMilestoneStatus(
  stored: ContractMilestoneStatus,
  dueDate: string | null,
  today: string
): ContractMilestoneStatus {
  if (stored === 'DONE' || stored === 'WAIVED') return stored;
  if (!dueDate || today < dueDate) return 'PENDING';
  return today === dueDate ? 'DUE' : 'OVERDUE';
}

/** Days from today to the due date (negative when overdue); null without a date or once closed. */
export function milestoneDaysLeft(status: ContractMilestoneStatus, dueDate: string | null, today: string): number | null {
  if (!dueDate || status === 'DONE' || status === 'WAIVED') return null;
  return daysBetween(today, dueDate);
}

/** "Kick-off + 21 days", "Kick-off − 7 days", "After “Kick-off held” + 3 working days". */
export function describeMilestoneAnchor(
  row: Pick<MilestoneDateRow, 'anchor' | 'anchorMilestoneKey' | 'offsetValue' | 'offsetUnit' | 'anchorDateOverride'>,
  labelForKey: (key: string) => string | null = () => null
): string {
  const n = Math.abs(row.offsetValue);
  const unit = row.offsetUnit === 'WORKING_DAYS' ? (n === 1 ? 'working day' : 'working days') : n === 1 ? 'day' : 'days';
  const base = row.anchorDateOverride
    ? 'Replacement start'
    : row.anchor === 'MILESTONE'
      ? `After “${(row.anchorMilestoneKey && labelForKey(row.anchorMilestoneKey)) ?? row.anchorMilestoneKey ?? 'another milestone'}”`
      : CONTRACT_MILESTONE_ANCHOR_META[row.anchor].label;
  if (row.offsetValue === 0) return base;
  return `${base} ${row.offsetValue > 0 ? '+' : '−'} ${n} ${unit}`;
}
