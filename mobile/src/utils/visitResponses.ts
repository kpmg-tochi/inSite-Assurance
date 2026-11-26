/**
 * Redesign R5a (D-R5.11): an officer's response to a visit (pure; tested in Node). Confirm, Move
 * (inside the server-given window), Propose (another date, for the manager) or Decline. The app offers
 * Move only for dates inside `moveWindow` from the feed; it computes no tolerance or sprint bounds
 * itself. The server's rule (R4b): responses are open while the visit is PLANNED and not checked in.
 */
import { addDays, isoWeekday, type RespondToVisitRequestInput, type VisitResponseAction } from '@insite/shared';
import type { MoveWindow, StoredVisit } from './visitModel';

export const RESPONSE_ACTIONS: VisitResponseAction[] = ['CONFIRM', 'MOVE', 'PROPOSE', 'DECLINE'];

export const RESPONSE_ACTION_LABELS: Record<VisitResponseAction, string> = {
  CONFIRM: 'Confirm',
  MOVE: 'Move',
  PROPOSE: 'Propose a date',
  DECLINE: 'Decline',
};

/** The server's minimum comment length for Move, Propose and Decline. */
export const RESPONSE_COMMENT_MIN = 3;
export const RESPONSE_COMMENT_MAX = 1000;

/** Whether a comment is required for the action (Confirm's is optional). */
export function commentRequired(action: VisitResponseAction): boolean {
  return action !== 'CONFIRM';
}

/** Whether the visit takes responses now (server rule + the phone's own unsent check-in). */
export function responsesOpen(v: Pick<StoredVisit, 'visit' | 'local'>): boolean {
  return v.visit.status === 'PLANNED' && !v.visit.checkInAt && !v.local.checkIn && v.visit.origin !== 'UNSCHEDULED';
}

/**
 * The actions to offer. Nothing without `visits:submit`, while a response is still waiting to send,
 * or once responses are closed. Confirm is hidden once confirmed, Decline once declined, Move when
 * the window offers no other date.
 */
export function allowedResponses(
  v: Pick<StoredVisit, 'visit' | 'local' | 'moveWindow'>,
  opts: { canSubmit: boolean; workWeekDays?: number[] | null }
): VisitResponseAction[] {
  if (!opts.canSubmit || v.local.pendingResponse || !responsesOpen(v)) return [];
  const out: VisitResponseAction[] = [];
  if (v.visit.confirmation !== 'CONFIRMED') out.push('CONFIRM');
  if (moveDates(v.visit.plannedDate, v.moveWindow, opts.workWeekDays).length > 0) out.push('MOVE');
  out.push('PROPOSE');
  if (v.visit.confirmation !== 'DECLINED') out.push('DECLINE');
  return out;
}

/**
 * The dates a Move may pick: every date of the window except the current planned date, skipping the
 * project's non-working days when known (the server refuses them).
 */
export function moveDates(plannedDate: string, window: MoveWindow | null, workWeekDays?: number[] | null): string[] {
  if (!window || window.from > window.to) return [];
  const out: string[] = [];
  for (let d = window.from; d <= window.to; d = addDays(d, 1)) {
    if (d === plannedDate) continue;
    if (workWeekDays && workWeekDays.length > 0 && !workWeekDays.includes(isoWeekday(d))) continue;
    out.push(d);
  }
  return out;
}

export function isValidMoveDate(plannedDate: string, window: MoveWindow | null, date: string, workWeekDays?: number[] | null): boolean {
  return moveDates(plannedDate, window, workWeekDays).includes(date);
}

/**
 * A proposed date: today or later, not the current date, and outside the move window (inside it the
 * officer moves the visit instead of asking).
 */
export function proposeDateProblem(plannedDate: string, window: MoveWindow | null, date: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return 'Pick a date.';
  if (date < today) return 'Pick today or a later date.';
  if (date === plannedDate) return 'The monitoring visit is already on that date.';
  if (window && date >= window.from && date <= window.to) return 'This date is inside the window you can move to: use Move instead.';
  return null;
}

export interface ResponseInput {
  action: VisitResponseAction;
  date?: string | null;
  comment?: string | null;
}

/** The first problem with a response the person is about to send, or null when it can be queued. */
export function responseProblem(
  v: Pick<StoredVisit, 'visit' | 'local' | 'moveWindow'>,
  input: ResponseInput,
  ctx: { today: string; canSubmit: boolean; workWeekDays?: number[] | null }
): string | null {
  if (!allowedResponses(v, { canSubmit: ctx.canSubmit, workWeekDays: ctx.workWeekDays }).includes(input.action)) {
    return 'This response is not available for this monitoring visit now.';
  }
  const comment = (input.comment ?? '').trim();
  if (commentRequired(input.action) && comment.length < RESPONSE_COMMENT_MIN) return 'Say why (at least 3 characters).';
  if (comment.length > RESPONSE_COMMENT_MAX) return `Keep the comment under ${RESPONSE_COMMENT_MAX} characters.`;
  if (input.action === 'MOVE') {
    if (!input.date) return 'Pick the new date.';
    if (!isValidMoveDate(v.visit.plannedDate, v.moveWindow, input.date, ctx.workWeekDays)) return 'Pick a date inside the window shown.';
  }
  if (input.action === 'PROPOSE') {
    if (!input.date) return 'Pick the date to propose.';
    return proposeDateProblem(v.visit.plannedDate, v.moveWindow, input.date, ctx.today);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Check-in and starting the form (D-R5.18)
// ---------------------------------------------------------------------------

/** The server takes a check-in on a PLANNED or MISSED visit; nothing to do once checked in. */
export function checkInAllowed(v: Pick<StoredVisit, 'visit' | 'local'>, canSubmit: boolean): boolean {
  if (!canSubmit || v.local.checkIn || v.visit.checkInAt || v.local.queuedSubmissionId) return false;
  return v.visit.status === 'PLANNED' || v.visit.status === 'MISSED';
}

/**
 * The form can be filled once the visit is checked in (on this phone, or on the server for a visit
 * returned for correction) and while a submission is still owed.
 */
export function formStartable(v: Pick<StoredVisit, 'visit' | 'local'>, canSubmit: boolean): boolean {
  if (!canSubmit || v.local.queuedSubmissionId) return false;
  if (!['PLANNED', 'IN_PROGRESS', 'RETURNED', 'MISSED'].includes(v.visit.status)) return false;
  return Boolean(v.local.checkIn || v.visit.checkInAt);
}

/** The request body (`POST .../respond`): a date only for Move and Propose; an empty comment is null. */
export function buildRespondRequest(clientActionId: string, input: ResponseInput): RespondToVisitRequestInput {
  const comment = (input.comment ?? '').trim();
  const withDate = input.action === 'MOVE' || input.action === 'PROPOSE';
  return {
    clientActionId,
    action: input.action,
    date: withDate ? input.date ?? null : null,
    comment: comment.length > 0 ? comment : null,
  };
}
