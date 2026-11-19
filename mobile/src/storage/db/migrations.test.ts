/**
 * Runs in Node. Applies the real migration SQL to an in-memory SQLite database (node:sqlite) the
 * same way database.ts does: each pending migration, then `PRAGMA user_version`, in a transaction.
 * This checks the SQL and the versioning; expo-sqlite/SQLCipher on a device is not exercised.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { DATA_TABLES, LATEST_SCHEMA_VERSION, MIGRATIONS, pendingMigrations } from './migrations';
import { briefCardCopy, briefMetaJson, parseBriefMeta } from '../briefMeta';

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

  it('a brief cached before v3 survives the upgrade with brief_json NULL', () => {
    const db = new DatabaseSync(':memory:');
    assert.equal(migrate(db, 2), 2);
    insertBrief(db, 'brief-old');
    migrate(db);
    const row = db.prepare('SELECT text_content, brief_json FROM chat_messages WHERE id = ?').get('brief-old') as {
      text_content: string;
      brief_json: string | null;
    };
    assert.equal(row.text_content, 'Headline');
    assert.equal(row.brief_json, null);
  });

  it('brief_json round-trips through the column', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const json = briefMetaJson({
      targetPersona: 'INDEPENDENT_VERIFIER',
      appliedStandards: [{ code: 'FMW-3.2', title: 'Concrete', summaryRule: 'Slump 75 to 100 mm.' }],
    });
    insertBrief(db, 'brief-new', json);
    const row = db.prepare('SELECT brief_json FROM chat_messages WHERE id = ?').get('brief-new') as { brief_json: string };
    const meta = parseBriefMeta(row.brief_json);
    assert.equal(meta?.targetPersona, 'INDEPENDENT_VERIFIER');
    assert.deepEqual(meta?.appliedStandards.map((s) => s.code), ['FMW-3.2']);
  });
});

describe('brief card wording', () => {
  it('a pre-v3 brief (brief_json NULL) falls back on the session persona', () => {
    assert.equal(parseBriefMeta(null), null);
    assert.equal(briefCardCopy(parseBriefMeta(null), 'CONTRACTOR_EXECUTOR').briefCardTitle, "Today's deliverable");
    assert.equal(briefCardCopy(parseBriefMeta(null), 'INDEPENDENT_VERIFIER').briefCardTitle, "Today's inspection brief");
    assert.equal(briefCardCopy(parseBriefMeta(null), null).briefCardTitle, "Today's inspection brief");
  });

  it("a stored brief uses the server's persona, not the session's", () => {
    const meta = parseBriefMeta(briefMetaJson({ targetPersona: 'INDEPENDENT_VERIFIER', appliedStandards: [] }));
    assert.equal(briefCardCopy(meta, 'CONTRACTOR_EXECUTOR').briefCardTitle, "Today's inspection brief");
  });

  it('unreadable or unknown brief_json is treated as missing', () => {
    assert.equal(parseBriefMeta('{not json'), null);
    assert.equal(parseBriefMeta(JSON.stringify({ targetPersona: 'SOMEONE', appliedStandards: [] })), null);
    assert.deepEqual(
      parseBriefMeta(JSON.stringify({ targetPersona: 'CONTRACTOR_EXECUTOR' }))?.appliedStandards,
      []
    );
  });
});
