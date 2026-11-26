/**
 * Redesign R5b: display text for the visit screens (pure; tested in Node). Dates are YYYY-MM-DD
 * calendar dates formatted without `Intl` (stable under Hermes). States are always words, never a
 * colour alone: the tone only picks the pill style.
 */
import { isoWeekday, type SprintStatus } from '@insite/shared';
import type { VisitDot, VisitView } from './visitCalendar';

const WEEKDAYS_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function parts(date: string): { y: number; m: number; d: number } {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return { y, m, d };
}

/** "Tue 24 Nov" (with the year when `withYear`). */
export function formatDay(date: string, withYear = false): string {
  const { y, m, d } = parts(date);
  return `${WEEKDAYS_SHORT[isoWeekday(date) - 1]} ${d} ${MONTHS_SHORT[m - 1]}${withYear ? ` ${y}` : ''}`;
}

/** "Tuesday 24 November 2026" (screen readers). */
export function formatLongDay(date: string): string {
  const { y, m, d } = parts(date);
  return `${WEEKDAYS_LONG[isoWeekday(date) - 1]} ${d} ${MONTHS_LONG[m - 1]} ${y}`;
}

/** "November 2026" from "2026-11". */
export function monthTitle(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${MONTHS_LONG[m - 1]} ${y}`;
}

/** "24 Nov, 14:05" from an ISO time, in the device's clock (for "sent at" lines). */
export function formatTime(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const hh = String(t.getHours()).padStart(2, '0');
  const mm = String(t.getMinutes()).padStart(2, '0');
  return `${t.getDate()} ${MONTHS_SHORT[t.getMonth()]}, ${hh}:${mm}`;
}

/** Greeting for the device's hour. */
export function greeting(hour: number): string {
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export const DOT_TEXT: Record<VisitDot, string> = { PLANNED: 'planned', OVERDUE: 'overdue', DONE: 'done' };

/** Screen-reader label of a calendar day: "Tuesday 24 November 2026, today, monitoring visits: overdue, planned". */
export function dayAccessibilityLabel(date: string, ctx: { today: string; dots: VisitDot[]; selected: boolean }): string {
  const bits = [formatLongDay(date)];
  if (date === ctx.today) bits.push('today');
  if (ctx.selected) bits.push('selected');
  if (ctx.dots.length > 0) bits.push(`monitoring visits: ${ctx.dots.map((d) => DOT_TEXT[d]).join(', ')}`);
  else bits.push('no monitoring visits');
  return bits.join(', ');
}

export const SPRINT_STATUS_TEXT: Record<SprintStatus, string> = {
  UPCOMING: 'Upcoming',
  ACTIVE: 'In progress',
  ENDED: 'Ended, not verified yet',
  LATE: 'Verification late',
  VERIFIED: 'Verified',
};

export const SPRINT_OUTCOME_TEXT: Record<'MET' | 'PARTLY_MET' | 'NOT_MET', string> = {
  MET: 'Met',
  PARTLY_MET: 'Partly met',
  NOT_MET: 'Not met',
};

export const SEVERITY_TEXT: Record<'MINOR' | 'MAJOR' | 'CRITICAL', string> = {
  MINOR: 'Minor',
  MAJOR: 'Major',
  CRITICAL: 'Critical',
};

export type StatusTone = 'positive' | 'warning' | 'negative' | 'info' | 'gray';
export interface StatusBadge {
  text: string;
  tone: StatusTone;
}

/**
 * The badges a visit shows, most important first: its state (accepted, awaiting approval, returned,
 * missed / overdue, checked in, confirmation), then the phone's unsent overlays and a pending date.
 */
export function visitBadges(v: VisitView): StatusBadge[] {
  const out: StatusBadge[] = [];
  if (v.status === 'CANCELLED') return [{ text: 'Cancelled', tone: 'gray' }];
  if (v.status === 'APPROVED') out.push({ text: 'Accepted', tone: 'positive' });
  else if (v.status === 'SUBMITTED') out.push({ text: 'Awaiting approval', tone: 'info' });
  else if (v.submitted) out.push({ text: 'Monitoring report saved', tone: 'info' });
  else if (v.returned) out.push({ text: 'Returned for correction', tone: 'negative' });
  else if (v.status === 'MISSED') out.push({ text: 'Missed', tone: 'negative' });
  else if (v.overdue) out.push({ text: 'Overdue', tone: 'negative' });
  else if (v.checkedIn || v.status === 'IN_PROGRESS') out.push({ text: 'Checked in', tone: 'info' });
  else if (v.confirmation === 'CONFIRMED') out.push({ text: 'Confirmed', tone: 'positive' });
  else if (v.confirmation === 'DECLINED') out.push({ text: 'Declined', tone: 'warning' });
  else out.push({ text: 'Not confirmed', tone: 'warning' });
  if (v.isUnscheduled) out.push({ text: 'Unscheduled', tone: 'gray' });
  if (v.datePending) out.push({ text: `Moving to ${formatDay(v.date)}`, tone: 'info' });
  if (v.proposedDate) out.push({ text: `Proposed ${formatDay(v.proposedDate)}, waiting for the manager`, tone: 'info' });
  if (v.waitingToSend) out.push({ text: 'Waiting to send', tone: 'warning' });
  return out;
}

/**
 * The upload state of a site log entry as words (D-R5.22): from the entry and the latest outbox row
 * for it. A photo moved into a form field is sent with that report instead.
 */
export function siteLogStateBadge(
  entry: { status: 'QUEUED' | 'SENT' | 'MOVED_TO_FORM'; attachedSubmissionId: string | null },
  row: { status: 'PENDING' | 'DONE' | 'DEAD' | 'HELD'; lastError: string | null } | null
): StatusBadge {
  if (entry.status === 'MOVED_TO_FORM') return { text: 'Used in a monitoring report', tone: 'gray' };
  if (entry.status === 'SENT') return { text: entry.attachedSubmissionId ? 'Sent, attached to a monitoring report' : 'Sent', tone: 'positive' };
  if (row?.status === 'DEAD') return { text: `Not sent: ${row.lastError ?? 'refused by the server'}`, tone: 'negative' };
  if (row?.status === 'HELD') return { text: 'Held: open the outbox', tone: 'negative' };
  if (row?.lastError) return { text: `Waiting to send (last try failed: ${row.lastError})`, tone: 'warning' };
  return { text: 'Waiting to send', tone: 'warning' };
}
