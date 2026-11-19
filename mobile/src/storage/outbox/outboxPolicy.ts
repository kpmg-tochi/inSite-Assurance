/**
 * Pure outbox rules (no React Native imports; tested in Node).
 *
 * The processor asks these functions what to do; it never decides retry, backoff, ordering or
 * dead-lettering on its own.
 */

export type OutboxKind =
  | 'CAPTURE'
  | 'REPORT'
  | 'REVALIDATION'
  | 'CHAT_MESSAGE'
  | 'TELEMETRY'
  | 'INCIDENT'
  | 'ASSURANCE'
  // Phase 10: mark a defect fixed, or verify/reopen it (payload carries the action).
  | 'DEFECT_ACTION';

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
  'CAPTURES_NOT_REGISTERED', // a capture the report needs is still uploading
  'OBJECT_NOT_UPLOADED', // the upload did not land; the handler re-uploads
]);

/**
 * Phase 7: the project switched contractor field reporting off. The contractor's session stays
 * valid, so this must not pause the outbox like an ended session, and retrying cannot succeed
 * until the project changes the setting: dead-letter at once with a message the person understands.
 */
export const CONTRACTOR_REPORTING_OFF_CODE = 'CONTRACTOR_FIELD_REPORTING_DISABLED';
export const CONTRACTOR_REPORTING_OFF_MESSAGE =
  'Contractor reporting is off for this project. This item stays on this device and was not sent. Ask the project monitor; tap Retry only if they turn contractor reporting back on.';

/** Server codes with a fixed message for the person, shown instead of the raw server text. */
const PERMANENT_CODE_MESSAGES: Record<string, string> = {
  [CONTRACTOR_REPORTING_OFF_CODE]: CONTRACTOR_REPORTING_OFF_MESSAGE,
};

/** The message stored on a failed row: a fixed one for known permanent codes, else the error text. */
export function failureMessage(error: ClassifiableError & { message?: string }): string {
  if (error.code && PERMANENT_CODE_MESSAGES[error.code]) return PERMANENT_CODE_MESSAGES[error.code];
  return error.message || 'Unknown error';
}

export function classifyFailure(error: ClassifiableError): FailureClass {
  // Checked first: whatever status the server uses (403 on submissions, 409 on join), never retry.
  if (error.code === CONTRACTOR_REPORTING_OFF_CODE) return 'PERMANENT';
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
 * A row may run only when every row it depends on is DONE (a report waits for its captures).
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
  'CHAT_MESSAGE',
  'REPORT',
  'REVALIDATION',
  'DEFECT_ACTION',
]);

/**
 * When a new session starts on a project (rejoin), an unsent evidence row queued under any other
 * session, or before sessions were recorded, is held for the person to remove or update.
 */
export function shouldHoldOnNewSession(
  row: Pick<OutboxRow, 'kind' | 'status'> & { sessionKey: string | null },
  currentSessionKey: string
): boolean {
  if (row.status === 'DONE' || row.status === 'HELD') return false;
  if (!SESSION_BOUND_KINDS.has(row.kind)) return false;
  return row.sessionKey !== currentSessionKey;
}

/** Kinds sent as one request for many rows. */
export const BATCHED_KINDS: ReadonlySet<OutboxKind> = new Set<OutboxKind>(['TELEMETRY']);
export const TELEMETRY_BATCH_SIZE = 500;
