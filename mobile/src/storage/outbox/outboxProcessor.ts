import * as Network from 'expo-network';
import { AppState, type AppStateStatus } from 'react-native';
import { getSessionEnded, subscribeSessionEnded } from '../../config/sessionState';
import { getStorageInfo } from '../db/database';
import {
  afterFailure,
  BATCHED_KINDS,
  classifyFailure,
  dependencyState,
  dueRows,
  TELEMETRY_BATCH_SIZE,
  type ClassifiableError,
  type OutboxKind,
  type OutboxRow,
  type OutboxStatus,
} from './outboxPolicy';
import {
  listOpenRows,
  markDone,
  markManyDone,
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
 */

export type RowHandler = (row: OutboxRow) => Promise<void>;
export type BatchHandler = (rows: OutboxRow[]) => Promise<void>;

/** Thrown by handlers for failures that retrying cannot fix (a missing local file, for example). */
export class LocalPermanentError extends Error {
  readonly kind = 'local' as const;
  constructor(message: string) {
    super(message);
    this.name = 'LocalPermanentError';
  }
}

const handlers = new Map<OutboxKind, RowHandler>();
const batchHandlers = new Map<OutboxKind, BatchHandler>();

export function registerOutboxHandler(kind: OutboxKind, handler: RowHandler): void {
  handlers.set(kind, handler);
}

export function registerOutboxBatchHandler(kind: OutboxKind, handler: BatchHandler): void {
  batchHandlers.set(kind, handler);
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

function describe(error: unknown): string {
  return (error as Error)?.message || 'Unknown error';
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

async function runOnce(): Promise<void> {
  const ended = getSessionEnded();
  if (ended) {
    publish({ isSyncing: false, pausedReason: ended.message });
    return;
  }
  const online = await isOnline();
  publish({ isOnline: online, pausedReason: null });
  if (!online) return;

  publish({ isSyncing: true });
  let anySucceeded = false;
  try {
    for (let pass = 0; pass < 6; pass++) {
      const rows = await listOpenRows();
      const statusById = new Map<string, OutboxStatus>(rows.map((r) => [r.id, r.status]));
      const now = new Date();
      const due = dueRows(rows, now);
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
            'A photo or voice note this depends on could not be sent. Retry that item first.'
          );
          statusById.set(row.id, 'DEAD');
          continue;
        }
        ready.push(row);
      }

      // Batched kinds: one request for many rows.
      for (const kind of BATCHED_KINDS) {
        const batch = ready.filter((r) => r.kind === kind);
        const handler = batchHandlers.get(kind);
        if (!handler || batch.length === 0) continue;
        for (let i = 0; i < batch.length; i += TELEMETRY_BATCH_SIZE) {
          const chunk = batch.slice(i, i + TELEMETRY_BATCH_SIZE);
          try {
            await handler(chunk);
            await markManyDone(chunk.map((r) => r.id));
            chunk.forEach((r) => statusById.set(r.id, 'DONE'));
            progressed = anySucceeded = true;
          } catch (error) {
            const failure = classifyFailure(toClassifiable(error));
            if (failure === 'AUTH_PAUSE') return pauseForAuth(error);
            for (const r of chunk) {
              const outcome = afterFailure(r, failure, new Date());
              await recordFailure(r.id, outcome, describe(error));
              statusById.set(r.id, outcome.status);
            }
            publish({ lastError: describe(error) });
          }
        }
      }

      for (const row of ready) {
        if (BATCHED_KINDS.has(row.kind)) continue;
        const handler = handlers.get(row.kind);
        if (!handler) continue;
        try {
          await handler(row);
          await markDone(row.id);
          statusById.set(row.id, 'DONE');
          progressed = anySucceeded = true;
        } catch (error) {
          const failure = classifyFailure(toClassifiable(error));
          if (failure === 'AUTH_PAUSE') return pauseForAuth(error);
          const outcome = afterFailure(row, failure, new Date());
          await recordFailure(row.id, outcome, describe(error));
          statusById.set(row.id, outcome.status);
          publish({ lastError: describe(error) });
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

function pauseForAuth(error: unknown): void {
  publish({ isSyncing: false, pausedReason: getSessionEnded()?.message ?? describe(error) });
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
  const session = subscribeSessionEnded((state) => {
    if (!state) kickOutbox();
    else publish({ pausedReason: state.message });
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
