import * as Network from 'expo-network';
import { AppState, type AppStateStatus } from 'react-native';
import { listSessionEnded, sessionEndedFor, subscribeSessionEnded } from '../../config/sessionState';
import { getAccountToken } from '../../config/authRegistry';
import { getStorageInfo } from '../db/database';
import {
  afterFailure,
  classifyFailure,
  failureMessage,
  dependencyState,
  dueRows,
  type ClassifiableError,
  type OutboxKind,
  type OutboxRow,
  type OutboxStatus,
} from './outboxPolicy';
import {
  listOpenRows,
  markDone,
  outboxCounts,
  purgeDoneRows,
  recordFailure,
  retryDeadRow,
} from './outboxStore';

/**
 * The one outbox processor (Phase 4). Every write to the API goes through here.
 *
 * - One run at a time (a lock); a trigger during a run schedules one more run afterwards.
 * - Each row is attempted in its own try/catch: one bad row never blocks the others.
 * - A row waits for the rows it depends on (a report waits for its captures).
 * - Failures back off exponentially and dead-letter after MAX_ATTEMPTS, keeping the error.
 * - An ended session pauses the outbox without counting attempts; nothing is lost.
 * - Phase 5: rows of every project on the device are sent, each with its own project's token. An
 *   ended session holds only the rows of its own scope (one project, or the signed-in account).
 */

export type RowHandler = (row: OutboxRow) => Promise<void>;

/** Stored on a row whose dependency was dead-lettered (redesign R5: also check-ins, unscheduled visits, site log entries). */
export const BLOCKED_DEPENDENCY_MESSAGE =
  'Something this depends on (a photo, voice note, check-in, site log entry or Ad hoc monitoring visit) could not be sent. Retry that item first.';

/** Thrown by handlers for failures that retrying cannot fix (a missing local file, for example). */
export class LocalPermanentError extends Error {
  readonly kind = 'local' as const;
  constructor(message: string) {
    super(message);
    this.name = 'LocalPermanentError';
  }
}

const handlers = new Map<OutboxKind, RowHandler>();

export function registerOutboxHandler(kind: OutboxKind, handler: RowHandler): void {
  handlers.set(kind, handler);
}

export interface SyncStatusSnapshot {
  isOnline: boolean;
  isSyncing: boolean;
  pendingCount: number;
  deadCount: number;
  /** Why sending is paused, if it is (for example the session was revoked). */
  pausedReason: string | null;
  lastError: string | null;
  lastSyncedAt: string | null;
  /** null until storage has opened. */
  storageEncrypted: boolean | null;
}

let snapshot: SyncStatusSnapshot = {
  isOnline: true,
  isSyncing: false,
  pendingCount: 0,
  deadCount: 0,
  pausedReason: null,
  lastError: null,
  lastSyncedAt: null,
  storageEncrypted: null,
};
const listeners = new Set<(s: SyncStatusSnapshot) => void>();

function publish(patch: Partial<SyncStatusSnapshot>) {
  snapshot = { ...snapshot, ...patch, storageEncrypted: getStorageInfo()?.encrypted ?? null };
  for (const l of listeners) l({ ...snapshot });
}

export function subscribeToSyncStatus(listener: (s: SyncStatusSnapshot) => void): () => void {
  listeners.add(listener);
  listener({ ...snapshot });
  return () => {
    listeners.delete(listener);
  };
}

export function getSyncStatusSnapshot(): SyncStatusSnapshot {
  return { ...snapshot };
}

export async function refreshOutboxCounts(): Promise<void> {
  try {
    const counts = await outboxCounts();
    publish({ pendingCount: counts.pending, deadCount: counts.dead });
  } catch {
    // Storage unavailable: the capture screens show that error themselves.
  }
}

function describe(error: unknown, kind?: OutboxKind): string {
  const e = error as ClassifiableError & { message?: string };
  return failureMessage({ code: e?.code, message: e?.message }, kind);
}

function toClassifiable(error: unknown): ClassifiableError {
  const e = error as ClassifiableError;
  return { kind: e?.kind, status: e?.status, code: e?.code };
}

async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return Boolean(state.isConnected && state.isInternetReachable !== false);
  } catch {
    return true; // Let the request decide.
  }
}

let running = false;
let rerunRequested = false;

/** Attempts every due row. Safe to call from anywhere, any number of times. */
export async function runOutbox(_reason = 'manual'): Promise<SyncStatusSnapshot> {
  if (running) {
    rerunRequested = true;
    return getSyncStatusSnapshot();
  }
  running = true;
  try {
    do {
      rerunRequested = false;
      await runOnce();
    } while (rerunRequested);
  } finally {
    running = false;
    await refreshOutboxCounts();
  }
  return getSyncStatusSnapshot();
}

/** The message to show when some rows are held because their session ended. */
function pausedMessage(): string | null {
  return listSessionEnded()[0]?.message ?? null;
}

async function runOnce(): Promise<void> {
  const online = await isOnline();
  publish({ isOnline: online, pausedReason: pausedMessage() });
  if (!online) return;

  publish({ isSyncing: true });
  let anySucceeded = false;
  try {
    for (let pass = 0; pass < 6; pass++) {
      const rows = await listOpenRows();
      const statusById = new Map<string, OutboxStatus>(rows.map((r) => [r.id, r.status]));
      const now = new Date();
      // Rows wait while nobody is signed in or their session ended; nothing is lost.
      const due = dueRows(rows, now).filter((r) => getAccountToken() && !sessionEndedFor(r.projectId));
      if (due.length === 0) break;
      let progressed = false;

      const ready: OutboxRow[] = [];
      for (const row of due) {
        const deps = dependencyState(row.dependsOn, statusById);
        if (deps === 'WAITING') continue;
        if (deps === 'BLOCKED') {
          await recordFailure(
            row.id,
            { status: 'DEAD', attempts: row.attempts, nextAttemptAt: now.toISOString() },
            BLOCKED_DEPENDENCY_MESSAGE
          );
          statusById.set(row.id, 'DEAD');
          continue;
        }
        ready.push(row);
      }

      for (const row of ready) {
        const handler = handlers.get(row.kind);
        if (!handler) continue;
        // A row of a scope that ended earlier in this pass is held, not attempted.
        if (sessionEndedFor(row.projectId)) continue;
        try {
          await handler(row);
          await markDone(row.id);
          statusById.set(row.id, 'DONE');
          progressed = anySucceeded = true;
        } catch (error) {
          const failure = classifyFailure(toClassifiable(error));
          if (failure === 'AUTH_PAUSE') {
            pauseForAuth(error);
            continue;
          }
          const outcome = afterFailure(row, failure, new Date());
          await recordFailure(row.id, outcome, describe(error, row.kind));
          statusById.set(row.id, outcome.status);
          publish({ lastError: describe(error, row.kind) });
        }
      }

      if (!progressed) break;
    }
  } finally {
    publish({
      isSyncing: false,
      ...(anySucceeded ? { lastSyncedAt: new Date().toISOString(), lastError: null } : {}),
    });
  }
}

/** The session for this row's scope ended (marked by the API layer); other scopes carry on. */
function pauseForAuth(error: unknown): void {
  publish({ pausedReason: pausedMessage() ?? describe(error) });
}

/** User tapped Retry on a dead-lettered item. */
export async function retryOutboxItem(id: string): Promise<void> {
  await retryDeadRow(id);
  void runOutbox('retry');
}

/** Ask for a run soon (after something was enqueued). */
export function kickOutbox(): void {
  void runOutbox('enqueue').catch(() => undefined);
}

const PERIODIC_MS = 60_000;

/** Starts the triggers: startup, network restored, app foreground, session restored, every minute. */
export function startOutbox(): () => void {
  void purgeDoneRows().catch(() => undefined);
  kickOutbox();

  const net = Network.addNetworkStateListener((state) => {
    const online = Boolean(state.isConnected && state.isInternetReachable !== false);
    const wasOffline = !snapshot.isOnline;
    publish({ isOnline: online });
    if (online && wasOffline) kickOutbox();
  });
  const app = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'active') kickOutbox();
  });
  let endedCount = listSessionEnded().length;
  const session = subscribeSessionEnded((states) => {
    // A scope came back (re-joined, signed in again): send what it was holding.
    if (states.length < endedCount) kickOutbox();
    endedCount = states.length;
    publish({ pausedReason: pausedMessage() });
  });
  const timer = setInterval(() => {
    if (AppState.currentState === 'active') kickOutbox();
  }, PERIODIC_MS);

  return () => {
    net.remove();
    app.remove();
    session();
    clearInterval(timer);
  };
}
