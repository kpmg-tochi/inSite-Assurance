/**
 * Runs in Node. Applies the real migration SQL to an in-memory SQLite database (node:sqlite) the
 * same way database.ts does: each pending migration, then `PRAGMA user_version`, in a transaction.
 * This checks the SQL and the versioning; expo-sqlite/SQLCipher on a device is not exercised.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { DATA_TABLES, LATEST_SCHEMA_VERSION, MIGRATIONS, pendingMigrations } from './migrations';

function userVersion(db: DatabaseSync): number {
  return (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
}

/** Mirror of database.ts `migrate`, optionally stopping at `upTo`. */
function migrate(db: DatabaseSync, upTo = Number.POSITIVE_INFINITY): number {
  for (const m of pendingMigrations(userVersion(db))) {
    if (m.version > upTo) break;
    db.exec('BEGIN');
    try {
      db.exec(m.sql);
      db.exec(`PRAGMA user_version = ${m.version}`);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  }
  return userVersion(db);
}

function columns(db: DatabaseSync, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map((c) => c.name);
}

function insertBrief(db: DatabaseSync, id: string, briefJson?: string | null) {
  const cols = ['id', 'project_id', 'wbs_item_id', 'sender_name', 'sender_role', 'message_type', 'text_content', 'created_at'];
  const values: Array<string | null> = [id, 'p1', 'w1', 'InSite Morning Brief', 'SYSTEM_BRIEF', 'MORNING_BRIEF', 'Headline', '2026-11-19T06:00:00.000Z'];
  if (briefJson !== undefined) {
    cols.push('brief_json');
    values.push(briefJson);
  }
  db.prepare(`INSERT INTO chat_messages (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`).run(...values);
}

describe('SQLite migrations', () => {
  it('versions are consecutive and the latest is applied', () => {
    MIGRATIONS.forEach((m, i) => assert.equal(m.version, i + 1));
    const db = new DatabaseSync(':memory:');
    assert.equal(migrate(db), LATEST_SCHEMA_VERSION);
    assert.ok(columns(db, 'chat_messages').includes('brief_json'));
    assert.ok(columns(db, 'server_reports').includes('status'));
    assert.ok(columns(db, 'wbs_items').includes('planned_start_date'));
    assert.ok(columns(db, 'wbs_items').includes('planned_end_date'));
    for (const table of DATA_TABLES) assert.ok(columns(db, table).length > 0, `missing table ${table}`);
  });

  it('running migrate again is a no-op (v3 and v4 run once)', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    assert.deepEqual(pendingMigrations(LATEST_SCHEMA_VERSION), []);
    assert.equal(migrate(db), LATEST_SCHEMA_VERSION);
    assert.equal(columns(db, 'chat_messages').filter((c) => c === 'brief_json').length, 1);
  });

  it('a brief cached before v3 survives the v3 upgrade with brief_json NULL', () => {
    const db = new DatabaseSync(':memory:');
    assert.equal(migrate(db, 2), 2);
    insertBrief(db, 'brief-old');
    assert.equal(migrate(db, 7), 7);
    const row = db.prepare('SELECT text_content, brief_json FROM chat_messages WHERE id = ?').get('brief-old') as {
      text_content: string;
      brief_json: string | null;
    };
    assert.equal(row.text_content, 'Headline');
    assert.equal(row.brief_json, null);
  });

  it('v7 removes queued identity submissions and keeps other outbox rows', () => {
    const db = new DatabaseSync(':memory:');
    assert.equal(migrate(db, 6), 6);
    const insertRow = db.prepare(
      `INSERT INTO outbox (id, project_id, kind, entity_id, next_attempt_at, created_at, updated_at)
       VALUES (?, 'p1', ?, ?, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`
    );
    insertRow.run('o1', 'ASSURANCE', 'a1');
    insertRow.run('o2', 'CAPTURE', 'c1');
    db.prepare(
      `INSERT INTO assurance_submissions (id, project_id, payload_json, created_at) VALUES ('a1', 'p1', '{}', '2026-11-01T00:00:00.000Z')`
    ).run();
    migrate(db);
    const kinds = (db.prepare('SELECT kind FROM outbox').all() as Array<{ kind: string }>).map((r) => r.kind);
    assert.deepEqual(kinds, ['CAPTURE']);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM assurance_submissions').get() as { n: number }).n, 0);
  });

  it('v8 removes cached briefs, queued presence pings and the ping table; other rows stay', () => {
    const db = new DatabaseSync(':memory:');
    assert.equal(migrate(db, 7), 7);
    insertBrief(db, 'brief-1', '{}');
    db.prepare(
      `INSERT INTO chat_messages (id, project_id, wbs_item_id, sender_name, sender_role, message_type, text_content, created_at)
       VALUES ('m1', 'p1', 'w1', 'Officer', 'Field reporter', 'TEXT_COMMENT', 'Formwork checked', '2026-11-18T09:00:00.000Z')`
    ).run();
    db.prepare(
      `INSERT INTO wbs_items (id, project_id, wbs_code, description, unit, last_message_text, last_message_at)
       VALUES ('w1', 'p1', '1.1', 'Slab', 'm3', 'Headline', '2026-11-19T06:00:00.000Z')`
    ).run();
    const insertRow = db.prepare(
      `INSERT INTO outbox (id, project_id, kind, entity_id, next_attempt_at, created_at, updated_at)
       VALUES (?, 'p1', ?, ?, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`
    );
    insertRow.run('o1', 'TELEMETRY', 't1');
    insertRow.run('o2', 'REPORT', 'r1');
    assert.ok(columns(db, 'telemetry_pings').length > 0);
    assert.equal(migrate(db), LATEST_SCHEMA_VERSION);
    const ids = (db.prepare('SELECT id FROM chat_messages').all() as Array<{ id: string }>).map((r) => r.id);
    assert.deepEqual(ids, ['m1']);
    const kinds = (db.prepare('SELECT kind FROM outbox').all() as Array<{ kind: string }>).map((r) => r.kind);
    assert.deepEqual(kinds, ['REPORT']);
    assert.deepEqual(columns(db, 'telemetry_pings'), []);
    assert.ok(columns(db, 'chat_messages').includes('brief_json'));
    const item = db.prepare("SELECT last_message_text, last_message_at FROM wbs_items WHERE id = 'w1'").get() as {
      last_message_text: string;
      last_message_at: string;
    };
    assert.deepEqual({ ...item }, { last_message_text: 'Formwork checked', last_message_at: '2026-11-18T09:00:00.000Z' });
  });
});
