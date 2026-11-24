/**
 * Redesign R5a: the calendar model for Home (pure; tested in Node). Monday-first weeks and months
 * over YYYY-MM-DD strings, the download window (D-R5.5), and what each visit shows: its date and
 * confirmation with the phone's unsent overlays, "Waiting to send", "overdue" and its calendar dot
 * (D-R5.4). Statuses come from the server; the phone never derives which visits exist.
 */
import {
  addDays,
  isoWeekday,
  VISIT_KIND_META,
  zonedCalendarDate,
  type VisitConfirmation,
  type VisitKind,
  type VisitStatus,
} from '@insite/shared';
import type { StoredVisit } from './visitModel';

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** Today in the project zone (the device zone's UTC fallback when the zone is unknown). */
export function projectToday(timeZone: string | null | undefined, now: Date = new Date()): string {
  return zonedCalendarDate(now, timeZone || 'UTC');
}

/** The Monday-first week containing `date` (7 dates, Monday to Sunday). */
export function weekDates(date: string): string[] {
  const monday = addDays(date, 1 - isoWeekday(date));
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
}

/** "YYYY-MM" of a date. */
export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** A month moved by `n` months ("2026-11", 1 → "2026-12"). */
export function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + n;
  const year = Math.floor(index / 12);
  const mon = (index % 12) + 1;
  return `${String(year).padStart(4, '0')}-${String(mon).padStart(2, '0')}`;
}

/** First and last date of a month. */
export function monthRange(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  const to = addDays(`${addMonths(month, 1)}-01`, -1);
  return { from, to };
}

/**
 * The month as Monday-first weeks (4 to 6 rows of 7 dates). Dates of the previous and next month fill
 * the first and last week; `inMonth` tells them apart.
 */
export function monthGrid(month: string): Array<Array<{ date: string; inMonth: boolean }>> {
  const { from, to } = monthRange(month);
  const start = addDays(from, 1 - isoWeekday(from));
  const weeks: Array<Array<{ date: string; inMonth: boolean }>> = [];
  for (let d = start; d <= to || weeks.length === 0; ) {
    const week = Array.from({ length: 7 }, (_, i) => {
      const date = addDays(d, i);
      return { date, inMonth: monthOf(date) === month };
    });
    weeks.push(week);
    d = addDays(d, 7);
    if (d > to) break;
  }
  return weeks;
}

// ---------------------------------------------------------------------------
// Download window (D-R5.5)
// ---------------------------------------------------------------------------

export const SYNC_DAYS_BACK = 30;
export const SYNC_DAYS_AHEAD = 14;

/** The feed window the sync keeps on the phone: today − 30 … today + 14. */
export function syncWindow(today: string): { from: string; to: string } {
  return { from: addDays(today, -SYNC_DAYS_BACK), to: addDays(today, SYNC_DAYS_AHEAD) };
}

/** Whether a whole date range lies inside the cached window (else: "Showing what is on this phone"). */
export function rangeInWindow(range: { from: string; to: string }, window: { from: string; to: string } | null): boolean {
  return Boolean(window && range.from >= window.from && range.to <= window.to);
}

// ---------------------------------------------------------------------------
// What a visit shows (D-R5.4)
// ---------------------------------------------------------------------------

export type VisitDot = 'PLANNED' | 'OVERDUE' | 'DONE';

/** Statuses that still owe a visit or a submission. */
const OPEN: VisitStatus[] = ['PLANNED', 'IN_PROGRESS', 'RETURNED', 'MISSED'];

export interface VisitView {
  id: string;
  projectId: string;
  projectCode: string;
  visitKind: VisitKind;
  kindLabel: string;
  /** The server's status. */
  status: VisitStatus;
  /** The date to show: the planned date, or the date of an unsent Move. */
  date: string;
  /** The date shown is an unsent Move. */
  datePending: boolean;
  originalDate: string;
  /** With an unsent Confirm or Decline applied. */
  confirmation: VisitConfirmation;
  confirmationPending: boolean;
  /** A proposal waiting for the manager: the server's, or one not sent yet. */
  proposedDate: string | null;
  /** Something about this visit is queued on the phone (response, check-in, submission, the visit itself). */
  waitingToSend: boolean;
  checkedIn: boolean;
  /** Owed and its date has passed in the project zone (also while offline), or MISSED. */
  overdue: boolean;
  /** Returned for correction by the reviewer. */
  returned: boolean;
  /** A submission is with the server or queued on this phone. */
  submitted: boolean;
  isUnscheduled: boolean;
  dot: VisitDot | null;
}

/**
 * The visit as Home and the visit screen show it. `today` is the project zone's date.
 * `opts.unsentUnscheduled`: the visit was made on this phone and the server does not have it yet.
 */
export function visitView(v: StoredVisit, today: string, opts: { unsentUnscheduled?: boolean } = {}): VisitView {
  const s = v.visit;
  const pending = v.local.pendingResponse;
  const moving = pending?.action === 'MOVE' && pending.date ? pending.date : null;
  const date = moving ?? s.plannedDate;
  let confirmation = s.confirmation;
  if (pending?.action === 'CONFIRM') confirmation = 'CONFIRMED';
  if (pending?.action === 'DECLINE') confirmation = 'DECLINED';
  if (pending?.action === 'MOVE') confirmation = 'CONFIRMED';
  const proposedDate = pending?.action === 'PROPOSE' ? pending.date : s.pendingProposal?.toDate ?? null;
  const submitted = s.status === 'SUBMITTED' || s.status === 'APPROVED' || Boolean(v.local.queuedSubmissionId);
  const checkedIn = Boolean(s.checkInAt) || Boolean(v.local.checkIn);
  const open = OPEN.includes(s.status) && !submitted;
  const overdue = open && (s.status === 'MISSED' || date < today);
  const waitingToSend =
    Boolean(pending) ||
    Boolean(v.local.checkIn && !v.local.checkIn.sent) ||
    Boolean(v.local.queuedSubmissionId) ||
    Boolean(opts.unsentUnscheduled ?? (v.isLocal && !v.serverId));

  let dot: VisitDot | null = null;
  if (submitted) dot = 'DONE';
  else if (overdue || s.status === 'RETURNED') dot = 'OVERDUE';
  else if (open) dot = 'PLANNED';

  return {
    id: v.id,
    projectId: v.projectId,
    projectCode: s.projectCode,
    visitKind: s.visitKind,
    kindLabel: VISIT_KIND_META[s.visitKind]?.label ?? s.visitKind,
    status: s.status,
    date,
    datePending: Boolean(moving),
    originalDate: s.originalPlannedDate,
    confirmation,
    confirmationPending: pending?.action === 'CONFIRM' || pending?.action === 'DECLINE' || pending?.action === 'MOVE',
    proposedDate,
    waitingToSend,
    checkedIn,
    overdue,
    returned: s.status === 'RETURNED' && !v.local.queuedSubmissionId,
    submitted,
    isUnscheduled: s.origin === 'UNSCHEDULED',
    dot,
  };
}

/** Visits by the date they show, each day's visits by date then kind; cancelled ones left out. */
export function groupVisitsByDay(views: VisitView[]): Map<string, VisitView[]> {
  const out = new Map<string, VisitView[]>();
  const sorted = [...views].filter((v) => v.status !== 'CANCELLED').sort((a, b) => a.date.localeCompare(b.date) || a.kindLabel.localeCompare(b.kindLabel) || a.id.localeCompare(b.id));
  for (const v of sorted) out.set(v.date, [...(out.get(v.date) ?? []), v]);
  return out;
}

const DOT_ORDER: VisitDot[] = ['OVERDUE', 'PLANNED', 'DONE'];

/** The distinct dots per day (overdue first), for the week and month views. */
export function dotsByDay(views: VisitView[]): Map<string, VisitDot[]> {
  const out = new Map<string, VisitDot[]>();
  for (const v of views) {
    if (!v.dot) continue;
    const list = out.get(v.date) ?? [];
    if (!list.includes(v.dot)) list.push(v.dot);
    out.set(v.date, list);
  }
  for (const [d, list] of out) out.set(d, DOT_ORDER.filter((k) => list.includes(k)));
  return out;
}

/** Visits that need the officer now: overdue or returned, oldest first (for a banner above the calendar). */
export function visitsNeedingAttention(views: VisitView[]): VisitView[] {
  return views.filter((v) => v.overdue || v.returned).sort((a, b) => a.date.localeCompare(b.date));
}
