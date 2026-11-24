import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb, newId, nowIso } from '../db/database';
import type { OutboxKind, OutboxRow, OutboxStatus } from './outboxPolicy';
import { currentSessionKey } from '../../config/authRegistry';

type Row = {
  id: string;
  project_id: string;
  kind: string;
  entity_id: string;
  payload_json: string;
  depends_on_json: string;
  status: string;
  attempts: number;
  next_attempt_at: string;
  last_error: string | null;
  created_at: string;
};

function map(r: Row): OutboxRow {
  return {
    id: r.id,
    projectId: r.project_id,
    kind: r.kind as OutboxKind,
    entityId: r.entity_id,
    payload: JSON.parse(r.payload_json || '{}'),
    dependsOn: JSON.parse(r.depends_on_json || '[]'),
    status: r.status as OutboxStatus,
    attempts: r.attempts,
    nextAttemptAt: r.next_attempt_at,
    lastError: r.last_error,
    createdAt: r.created_at,
  };
}

/**
 * Adds a row. Pass the same `db` you used to persist the entity, inside the same transaction, so a
 * crash can never leave a saved record without its outbox row.
 */
export async function enqueue(
  db: SQLiteDatabase,
  params: {
    projectId: string;
    kind: OutboxKind;
    entityId: string;
    payload?: Record<string, unknown>;
    dependsOn?: string[];
  }
): Promise<string> {
  const id = newId();
  const now = nowIso();
  await db.runAsync(
    `INSERT INTO outbox (id, project_id, kind, entity_id, payload_json, depends_on_json, status,
       attempts, next_attempt_at, created_at, updated_at, session_key)
     VALUES (?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?, ?, ?)`,
    [
      id,
      params.projectId,
      params.kind,
      params.entityId,
      JSON.stringify(params.payload ?? {}),
      JSON.stringify(params.dependsOn ?? []),
      now,
      now,
      now,
      currentSessionKey(),
    ]
  );
  return id;
}

/** Open (PENDING) outbox row for an entity, e.g. the CAPTURE row a report must wait for. */
export async function findOpenRowId(db: SQLiteDatabase, kind: OutboxKind, entityId: string): Promise<string | null> {
  const row = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM outbox WHERE kind = ? AND entity_id = ? AND status != 'DONE' ORDER BY created_at DESC LIMIT 1`,
    [kind, entityId]
  );
  return row?.id ?? null;
}

/**
 * Redesign R5: a synchronous lookup over the open rows of the given entities, for the pure
 * dependency rules in outboxPolicy (`visitSubmissionDependsOn`, `checkInDependsOn`, ...).
 */
export async function openRowLookup(
  db: SQLiteDatabase,
  wanted: Array<[OutboxKind, string | null | undefined]>
): Promise<(kind: OutboxKind, entityId: string) => string | null> {
  const found = new Map<string, string | null>();
  for (const [kind, id] of wanted) {
    if (!id) continue;
    const key = `${kind}:${id}`;
    if (!found.has(key)) found.set(key, await findOpenRowId(db, kind, id));
  }
  return (kind, entityId) => found.get(`${kind}:${entityId}`) ?? null;
}

/** The latest row of an entity (any status), for "waiting / failed / sent" labels. */
export async function latestRowFor(
  kind: OutboxKind,
  entityId: string
): Promise<{ id: string; status: OutboxStatus; lastError: string | null; attempts: number } | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ id: string; status: string; last_error: string | null; attempts: number }>(
    `SELECT id, status, last_error, attempts FROM outbox WHERE kind = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 1`,
    [kind, entityId]
  );
  return row ? { id: row.id, status: row.status as OutboxStatus, lastError: row.last_error, attempts: row.attempts } : null;
}

/** Deletes an entity's rows that are not being retried (DEAD or HELD), e.g. when a refused draft is deleted. */
export async function deleteStoppedRows(db: SQLiteDatabase, kind: OutboxKind, entityId: string): Promise<void> {
  await db.runAsync(`DELETE FROM outbox WHERE kind = ? AND entity_id = ? AND status IN ('DEAD', 'HELD')`, [kind, entityId]);
}

/** Deletes an entity's PENDING rows (an unsent site log entry whose photo moved into a form). */
export async function deletePendingRows(db: SQLiteDatabase, kind: OutboxKind, entityId: string): Promise<number> {
  const r = await db.runAsync(`DELETE FROM outbox WHERE kind = ? AND entity_id = ? AND status = 'PENDING'`, [kind, entityId]);
  return r.changes;
}

export async function listOpenRows(): Promise<OutboxRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM outbox WHERE status != 'DONE' ORDER BY created_at ASC`
  );
  return rows.map(map);
}

export async function markDone(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox SET status = 'DONE', last_error = NULL, updated_at = ? WHERE id = ?`,
    [nowIso(), id]
  );
}

export async function recordFailure(
  id: string,
  outcome: { status: OutboxStatus; attempts: number; nextAttemptAt: string },
  error: string
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE outbox SET status = ?, attempts = ?, next_attempt_at = ?, last_error = ?, updated_at = ? WHERE id = ?`,
    [outcome.status, outcome.attempts, outcome.nextAttemptAt, error.slice(0, 500), nowIso(), id]
  );
}

/** Moves a dead-lettered row back to the queue (user tapped Retry). */
export async function retryDeadRow(id: string): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  await db.runAsync(
    `UPDATE outbox SET status = 'PENDING', attempts = 0, next_attempt_at = ?, updated_at = ? WHERE id = ? AND status = 'DEAD'`,
    [now, now, id]
  );
}

/** Completed rows older than `days` are deleted to keep the table small. */
export async function purgeDoneRows(days = 7): Promise<void> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  await db.runAsync(`DELETE FROM outbox WHERE status = 'DONE' AND updated_at < ?`, [cutoff]);
}

export async function outboxCounts(): Promise<{ pending: number; dead: number }> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ status: string; n: number }>(
    `SELECT status, COUNT(*) AS n FROM outbox WHERE status != 'DONE' GROUP BY status`
  );
  return {
    pending: rows.find((r) => r.status === 'PENDING')?.n ?? 0,
    dead: rows.find((r) => r.status === 'DEAD')?.n ?? 0,
  };
}

export interface DeadLetter {
  id: string;
  kind: OutboxKind;
  entityId: string;
  attempts: number;
  lastError: string | null;
  createdAt: string;
}

/** Items that stopped retrying, newest first, for the sync status screen. */
export async function listDeadRows(): Promise<DeadLetter[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(`SELECT * FROM outbox WHERE status = 'DEAD' ORDER BY updated_at DESC`);
  return rows.map((r) => {
    const m = map(r);
    return { id: m.id, kind: m.kind, entityId: m.entityId, attempts: m.attempts, lastError: m.lastError, createdAt: m.createdAt };
  });
}

/** Unsent items per project (pending and dead-lettered), for the projects screen (Phase 5). */
export async function outboxCountsByProject(): Promise<Map<string, { pending: number; dead: number }>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ project_id: string; status: string; n: number }>(
    `SELECT project_id, status, COUNT(*) AS n FROM outbox WHERE status != 'DONE' GROUP BY project_id, status`
  );
  const out = new Map<string, { pending: number; dead: number }>();
  for (const r of rows) {
    const entry = out.get(r.project_id) ?? { pending: 0, dead: 0 };
    if (r.status === 'DEAD') entry.dead += r.n;
    else entry.pending += r.n;
    out.set(r.project_id, entry);
  }
  return out;
}
