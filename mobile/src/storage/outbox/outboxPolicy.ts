/**
 * Pure outbox rules (no React Native imports; tested in Node).
 *
 * The processor asks these functions what to do; it never decides retry, backoff, ordering or
 * dead-lettering on its own.
 */

export type OutboxKind =
  /** A photo or voice note (entity = clientCaptureId): upload, then register. */
  | 'CAPTURE'
  /** A special incident report (entity = clientIncidentId); the handler uploads its photos first. */
  | 'INCIDENT'
  // Phase 10: verify a defect (close with photos or reopen; the payload carries the action).
  | 'DEFECT_ACTION'
  // Redesign R5 (D-R5.9): the visit app. Every request carries a client UUID (idempotent on the server).
  /** An officer's Confirm / Move / Propose / Decline (entity = clientActionId). */
  | 'VISIT_RESPONSE'
  /** A check-in (entity = clientCheckInId); waits for its unscheduled visit. */
  | 'VISIT_CHECK_IN'
  /** A visit submission (entity = clientSubmissionId = draft id); waits for captures, check-in, unscheduled visit, site log entries. */
  | 'VISIT_SUBMISSION'
  /** An Ad hoc visit built on the phone (entity = clientVisitId). */
  | 'UNSCHEDULED_VISIT'
  /** A site log photo, voice note or note (entity = clientEntryId); waits for its capture. */
  | 'SITE_LOG_ENTRY';

/**
 * Redesign R5e (D-R5.10): kinds of the old app (workday reports, chat, Phase 14 inspections). Their
 * rows are deleted by SQLite v10 and no handler exists for them; listed for that migration's test.
 */
export const REMOVED_OUTBOX_KINDS: readonly string[] = ['REPORT', 'REVALIDATION', 'CHAT_MESSAGE', 'SITE_INSPECTION', 'FINDING_RESOLUTION'];

/**
 * HELD (Phase 5 Step 8): queued under a session that has since ended. Never sent until the person
 * removes it or updates it for the current session.
 */
export type OutboxStatus = 'PENDING' | 'DONE' | 'DEAD' | 'HELD';

export interface OutboxRow {
  id: string;
  projectId: string;
  kind: OutboxKind;
  entityId: string;
  payload: Record<string, unknown>;
  dependsOn: string[];
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: string;
  lastError: string | null;
  createdAt: string;
}

/** After this many failed attempts a row moves to the dead-letter list (user can retry it). */
export const MAX_ATTEMPTS = 8;
const BASE_BACKOFF_MS = 15_000;
const MAX_BACKOFF_MS = 30 * 60_000;

/** Exponential backoff with ±20% jitter: 15s, 30s, 1m, 2m … capped at 30 minutes. */
export function backoffMs(attempts: number, random: () => number = Math.random): number {
  const exp = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1));
  const jitter = 1 + (random() * 0.4 - 0.2);
  return Math.round(exp * jitter);
}

/** What a failed attempt means for the row. */
export type FailureClass =
  /** Session ended (revoked, suspended, unauthorised): pause everything, do not count an attempt. */
  | 'AUTH_PAUSE'
  /** Offline, timeout, server error, or a dependency the server has not seen yet: retry later. */
  | 'RETRY'
  /** The server refused the request for good: dead-letter now, keep the error for the user. */
  | 'PERMANENT';

export interface ClassifiableError {
  kind?: 'network' | 'auth' | 'http' | 'local';
  status?: number;
  code?: string;
}

/** Server error codes that mean "try again later", not "this request is wrong". */
const RETRYABLE_CODES = new Set([
  'CAPTURES_NOT_REGISTERED', // a photo the visit report needs is still uploading
  'OBJECT_NOT_UPLOADED', // the upload did not land; the handler re-uploads
  'SITE_LOG_NOT_REGISTERED', // a site log entry a submission attaches has not reached the server yet
]);

/** Redesign R5: fixed messages for the visit app's permanent refusals (D-R5.11, D-R5.19, D-R5.20). */
export const VISIT_CHANGED_RESPONSE_MESSAGE = 'This monitoring visit changed since you responded. Refresh and respond again.';
export const FORM_SNAPSHOT_STALE_MESSAGE =
  'The monitoring form was rebuilt after it was downloaded, so this monitoring report was not sent. Your answers are kept on this phone: open the monitoring visit to move them onto the new form and submit again.';
export const VISIT_ALREADY_SUBMITTED_MESSAGE =
  'Another officer already submitted this monitoring visit, so your monitoring report was not sent. It stays on this phone until you delete it.';
export const UNSCHEDULED_FORM_STALE_MESSAGE =
  'The Ad hoc form on this phone no longer matches the project forms, so the Ad hoc monitoring visit was not created. Refresh, then start the Ad hoc monitoring visit again.';

/** Server codes with a fixed message for the person, shown instead of the raw server text. */
const PERMANENT_CODE_MESSAGES: Record<string, string> = {
  FORM_SNAPSHOT_STALE: FORM_SNAPSHOT_STALE_MESSAGE,
  VISIT_ALREADY_SUBMITTED: VISIT_ALREADY_SUBMITTED_MESSAGE,
};

/**
 * Per-kind overrides: the same server code means something else for another request (409
 * VISIT_CHANGED on a response is "respond again", on a submission the server text says why).
 */
const KIND_CODE_MESSAGES: Partial<Record<OutboxKind, Record<string, string>>> = {
  VISIT_RESPONSE: { VISIT_CHANGED: VISIT_CHANGED_RESPONSE_MESSAGE },
  UNSCHEDULED_VISIT: { FORM_SNAPSHOT_STALE: UNSCHEDULED_FORM_STALE_MESSAGE },
};

/** The message stored on a failed row: a fixed one for known permanent codes, else the error text. */
export function failureMessage(error: ClassifiableError & { message?: string }, kind?: OutboxKind): string {
  const byKind = kind && error.code ? KIND_CODE_MESSAGES[kind]?.[error.code] : undefined;
  if (byKind) return byKind;
  if (error.code && PERMANENT_CODE_MESSAGES[error.code]) return PERMANENT_CODE_MESSAGES[error.code];
  return error.message || 'Unknown error';
}

/**
 * Redesign R5: codes that mean a visit submission (or the unscheduled visit under it) can never be
 * sent as it is. The draft is marked REFUSED and kept on the phone (D-R5.19, D-R5.20).
 */
export const SUBMISSION_REFUSED_CODES: readonly string[] = ['FORM_SNAPSHOT_STALE', 'VISIT_ALREADY_SUBMITTED'];

export function classifyFailure(error: ClassifiableError): FailureClass {
  if (error.kind === 'auth') return 'AUTH_PAUSE';
  if (error.kind === 'network') return 'RETRY';
  if (error.kind === 'local') return 'PERMANENT';
  const status = error.status ?? 0;
  if (error.code && RETRYABLE_CODES.has(error.code)) return 'RETRY';
  if (status === 0 || status === 408 || status === 425 || status === 429 || status >= 500) return 'RETRY';
  if (status >= 400) return 'PERMANENT';
  return 'RETRY';
}

export interface FailureOutcome {
  status: OutboxStatus;
  attempts: number;
  nextAttemptAt: string;
}

/** New state of a row after a failed attempt (AUTH_PAUSE leaves the row untouched). */
export function afterFailure(
  row: Pick<OutboxRow, 'attempts' | 'status' | 'nextAttemptAt'>,
  failure: FailureClass,
  now: Date,
  random?: () => number
): FailureOutcome {
  if (failure === 'AUTH_PAUSE') {
    return { status: row.status, attempts: row.attempts, nextAttemptAt: row.nextAttemptAt };
  }
  const attempts = row.attempts + 1;
  if (failure === 'PERMANENT' || attempts >= MAX_ATTEMPTS) {
    return { status: 'DEAD', attempts, nextAttemptAt: now.toISOString() };
  }
  return {
    status: 'PENDING',
    attempts,
    nextAttemptAt: new Date(now.getTime() + backoffMs(attempts, random)).toISOString(),
  };
}

export type DependencyState = 'READY' | 'WAITING' | 'BLOCKED';

/**
 * A row may run only when every row it depends on is DONE (a visit report waits for its photos).
 * A dependency that is DEAD blocks it; a missing dependency is treated as done (it was purged
 * after completing).
 */
export function dependencyState(
  dependsOn: string[],
  statusById: Map<string, OutboxStatus>
): DependencyState {
  let waiting = false;
  for (const id of dependsOn) {
    const status = statusById.get(id);
    if (status === 'DEAD') return 'BLOCKED';
    if (status === 'PENDING' || status === 'HELD') waiting = true;
  }
  return waiting ? 'WAITING' : 'READY';
}

/** Rows due now, oldest first. Ordering only matters through `dependsOn`. */
export function dueRows(rows: OutboxRow[], now: Date): OutboxRow[] {
  return rows
    .filter((r) => r.status === 'PENDING' && new Date(r.nextAttemptAt).getTime() <= now.getTime())
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Kinds that become evidence; these are held after a rejoin instead of sent under the new session. */
export const SESSION_BOUND_KINDS: ReadonlySet<OutboxKind> = new Set<OutboxKind>([
  'CAPTURE',
  'DEFECT_ACTION',
  'VISIT_RESPONSE',
  'VISIT_CHECK_IN',
  'VISIT_SUBMISSION',
  'UNSCHEDULED_VISIT',
  'SITE_LOG_ENTRY',
]);

/**
 * When a project's earlier session has ended (a pre-R1d join-code session), an unsent evidence row
 * queued under any other session, or before sessions were recorded, is held for the person to
 * remove or update.
 */
export function shouldHoldOnNewSession(
  row: Pick<OutboxRow, 'kind' | 'status'> & { sessionKey: string | null },
  currentSessionKey: string
): boolean {
  if (row.status === 'DONE' || row.status === 'HELD') return false;
  if (!SESSION_BOUND_KINDS.has(row.kind)) return false;
  return row.sessionKey !== currentSessionKey;
}

// ---------------------------------------------------------------------------
// Redesign R5 (D-R5.9): what each visit-app row waits for
// ---------------------------------------------------------------------------

/** Finds the open (not DONE) outbox row of a kind for an entity, or null when it was sent or never queued. */
export type OpenRowLookup = (kind: OutboxKind, entityId: string) => string | null;

function openRows(lookup: OpenRowLookup, kind: OutboxKind, entityIds: Array<string | null | undefined>): string[] {
  const out: string[] = [];
  for (const id of entityIds) {
    if (!id) continue;
    const row = lookup(kind, id);
    if (row && !out.includes(row)) out.push(row);
  }
  return out;
}

/** A check-in waits for its unscheduled visit (when the visit was created on this phone and is unsent). */
export function checkInDependsOn(params: { unscheduledVisitId: string | null }, lookup: OpenRowLookup): string[] {
  return openRows(lookup, 'UNSCHEDULED_VISIT', [params.unscheduledVisitId]);
}

/** A site log entry waits for its photo or voice note. */
export function siteLogEntryDependsOn(params: { captureId: string | null }, lookup: OpenRowLookup): string[] {
  return openRows(lookup, 'CAPTURE', [params.captureId]);
}

/**
 * A submission waits for every capture its answers name, its visit's check-in, the unscheduled visit
 * (Ad hoc on this phone) and every site log entry it attaches. Rows already sent are not waited for.
 */
export function visitSubmissionDependsOn(
  params: { captureIds: string[]; checkInId: string | null; unscheduledVisitId: string | null; siteLogEntryIds: string[] },
  lookup: OpenRowLookup
): string[] {
  return [
    ...openRows(lookup, 'UNSCHEDULED_VISIT', [params.unscheduledVisitId]),
    ...openRows(lookup, 'VISIT_CHECK_IN', [params.checkInId]),
    ...openRows(lookup, 'CAPTURE', params.captureIds),
    ...openRows(lookup, 'SITE_LOG_ENTRY', params.siteLogEntryIds),
  ];
}
