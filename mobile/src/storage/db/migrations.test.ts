/**
 * Runs in Node. Applies the real migration SQL to an in-memory SQLite database (node:sqlite) the
 * same way database.ts does: each pending migration, then `PRAGMA user_version`, in a transaction.
 * This checks the SQL and the versioning; expo-sqlite/SQLCipher on a device is not exercised.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { DATA_TABLES, LATEST_SCHEMA_VERSION, MIGRATIONS, pendingMigrations } from './migrations';
import { REMOVED_OUTBOX_KINDS } from '../outbox/outboxPolicy';

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
    for (const table of DATA_TABLES) assert.ok(columns(db, table).length > 0, `missing table ${table}`);
  });

  it('the pre-v10 tables exist up to v9 (v3, v4 and v5 columns)', () => {
    const db = new DatabaseSync(':memory:');
    assert.equal(migrate(db, 9), 9);
    assert.ok(columns(db, 'chat_messages').includes('brief_json'));
    assert.ok(columns(db, 'server_reports').includes('status'));
    assert.ok(columns(db, 'wbs_items').includes('planned_start_date'));
    assert.ok(columns(db, 'wbs_items').includes('planned_end_date'));
  });

  it('running migrate again is a no-op', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    assert.deepEqual(pendingMigrations(LATEST_SCHEMA_VERSION), []);
    assert.equal(migrate(db), LATEST_SCHEMA_VERSION);
    assert.equal(columns(db, 'visits').filter((c) => c === 'local_state_json').length, 1);
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
    migrate(db, 7);
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
    assert.equal(migrate(db, 9), 9);
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
  it('v9 adds the visit tables to a populated v8 database; earlier rows stay', () => {
    const db = new DatabaseSync(':memory:');
    assert.equal(migrate(db, 8), 8);
    const insertRow = db.prepare(
      `INSERT INTO outbox (id, project_id, kind, entity_id, next_attempt_at, created_at, updated_at)
       VALUES (?, 'p1', ?, ?, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`
    );
    insertRow.run('o1', 'CAPTURE', 'c1');
    insertRow.run('o2', 'REPORT', 'r1');
    db.prepare(
      `INSERT INTO captures (id, project_id, media_type, mime_type, local_path, byte_size, sha256, location_available, captured_at, created_at)
       VALUES ('c1', 'p1', 'SITE_PHOTO', 'image/jpeg', 'file:///c1.jpg', 10, 'ab', 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`
    ).run();
    db.prepare(`INSERT INTO project_baseline (project_id, json, updated_at) VALUES ('p1', '{}', '2026-11-01T00:00:00.000Z')`).run();
    db.prepare(`INSERT INTO inspection_drafts (id, project_id, draft_json, updated_at) VALUES ('i1', 'p1', '{}', '2026-11-01T00:00:00.000Z')`).run();

    assert.equal(migrate(db, 9), 9);
    const kinds = (db.prepare('SELECT kind FROM outbox ORDER BY id').all() as Array<{ kind: string }>).map((r) => r.kind);
    assert.deepEqual(kinds, ['CAPTURE', 'REPORT']);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM captures').get() as { n: number }).n, 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM project_baseline').get() as { n: number }).n, 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM inspection_drafts').get() as { n: number }).n, 1);
    for (const t of ['visits', 'visit_forms', 'visit_field_packs', 'visit_drafts', 'site_log_entries', 'visit_sync_meta']) {
      assert.ok(columns(db, t).length > 0, `missing table ${t}`);
      assert.ok(DATA_TABLES.includes(t), `${t} is not cleared by "clear local data"`);
    }
    assert.ok(columns(db, 'visits').includes('local_state_json'));
    assert.ok(columns(db, 'visit_drafts').includes('request_json'));
  });

  it('v9: one open draft per visit; refused and sent drafts may stay beside it', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const insertDraft = db.prepare(
      `INSERT INTO visit_drafts (id, visit_id, project_id, status, form_hash, draft_json, created_at, updated_at)
       VALUES (?, 'v1', 'p1', ?, 'h', '{}', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`
    );
    insertDraft.run('d1', 'REFUSED');
    insertDraft.run('d2', 'SENT');
    insertDraft.run('d3', 'DRAFT');
    assert.throws(() => insertDraft.run('d4', 'QUEUED'), /UNIQUE/);
    db.prepare(`UPDATE visit_drafts SET status = 'SENT' WHERE id = 'd3'`).run();
    insertDraft.run('d5', 'DRAFT');
    assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM visit_drafts WHERE visit_id = 'v1'`).get() as { n: number }).n, 4);
  });

  it('v9: a visit server id is unique (an unscheduled visit and its feed row cannot both hold it)', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const insertVisit = db.prepare(
      `INSERT INTO visits (id, server_id, project_id, planned_date, status, summary_json, created_at)
       VALUES (?, ?, 'p1', '2026-11-20', 'PLANNED', '{}', '2026-11-01T00:00:00.000Z')`
    );
    insertVisit.run('local-1', 'server-1');
    assert.throws(() => insertVisit.run('server-1', 'server-1'), /UNIQUE/);
    insertVisit.run('local-2', null);
    insertVisit.run('local-3', null);
  });

  it('v10 deletes queued rows of the old app and its tables; visit work, captures and incidents stay', () => {
    const db = new DatabaseSync(':memory:');
    assert.equal(migrate(db, 9), 9);
    const insertRow = db.prepare(
      `INSERT INTO outbox (id, project_id, kind, entity_id, status, depends_on_json, next_attempt_at, created_at, updated_at)
       VALUES (?, 'p1', ?, ?, ?, ?, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`
    );
    REMOVED_OUTBOX_KINDS.forEach((kind, i) => insertRow.run(`old-${i}`, kind, `e${i}`, i % 2 ? 'DEAD' : 'PENDING', '["cap-row"]'));
    insertRow.run('held-report', 'REPORT', 'r9', 'HELD', '[]');
    insertRow.run('cap-row', 'CAPTURE', 'c1', 'PENDING', '[]');
    insertRow.run('visit-row', 'VISIT_SUBMISSION', 'd1', 'PENDING', '["cap-row"]');
    insertRow.run('site-log-row', 'SITE_LOG_ENTRY', 's1', 'DEAD', '[]');
    insertRow.run('incident-row', 'INCIDENT', 'i1', 'PENDING', '[]');
    insertRow.run('defect-row', 'DEFECT_ACTION', 'x1', 'HELD', '[]');
    db.prepare(
      `INSERT INTO captures (id, project_id, wbs_item_id, media_type, mime_type, local_path, byte_size, sha256, location_available, captured_at, report_id, created_at)
       VALUES ('c1', 'p1', 'w1', 'SITE_PHOTO', 'image/jpeg', 'file:///c1.jpg', 10, 'ab', 1, '2026-11-01T00:00:00.000Z', 'r1', '2026-11-01T00:00:00.000Z')`
    ).run();
    db.prepare(`INSERT INTO incidents (id, project_id, payload_json, created_at) VALUES ('i1', 'p1', '{}', '2026-11-01T00:00:00.000Z')`).run();
    db.prepare(
      `INSERT INTO workday_reports (id, project_id, wbs_item_id, workday_date, reporter_timezone, summary_text, reported_quantity, unit, confirmed_at, created_at)
       VALUES ('r1', 'p1', 'w1', '2026-11-01', 'Africa/Lagos', 'Slab', 1, 'm3', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`
    ).run();
    db.prepare(`INSERT INTO wbs_items (id, project_id, wbs_code, description, unit) VALUES ('w1', 'p1', '1.1', 'Slab', 'm3')`).run();
    db.prepare(
      `INSERT INTO chat_messages (id, project_id, wbs_item_id, sender_name, sender_role, message_type, created_at)
       VALUES ('m1', 'p1', 'w1', 'Officer', 'Field reporter', 'TEXT_COMMENT', '2026-11-01T00:00:00.000Z')`
    ).run();
    db.prepare(`INSERT INTO inspection_drafts (id, project_id, draft_json, updated_at) VALUES ('i1', 'p1', '{}', '2026-11-01T00:00:00.000Z')`).run();
    db.prepare(
      `INSERT INTO visit_drafts (id, visit_id, project_id, status, form_hash, draft_json, created_at, updated_at)
       VALUES ('d1', 'v1', 'p1', 'QUEUED', 'h', '{}', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`
    ).run();

    assert.equal(migrate(db, 10), 10);
    const ids = (db.prepare('SELECT id FROM outbox ORDER BY id').all() as Array<{ id: string }>).map((r) => r.id);
    assert.deepEqual(ids, ['cap-row', 'defect-row', 'incident-row', 'site-log-row', 'visit-row']);
    for (const t of ['workday_reports', 'server_reports', 'chat_messages', 'wbs_items', 'inspection_drafts', 'assurance_submissions']) {
      assert.deepEqual(columns(db, t), [], `${t} should be dropped`);
      assert.ok(!DATA_TABLES.includes(t), `${t} is still cleared by "clear local data"`);
    }
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM captures').get() as { n: number }).n, 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM incidents').get() as { n: number }).n, 1);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM visit_drafts').get() as { n: number }).n, 1);
    // "Clear local data" still finds every table it empties (on the latest schema).
    migrate(db);
    for (const t of DATA_TABLES) db.exec(`DELETE FROM ${t}`);
  });

  it('v11 adds the compass heading columns to captures; a capture saved before keeps NULL', () => {
    const db = new DatabaseSync(':memory:');
    assert.equal(migrate(db, 10), 10);
    db.prepare(
      `INSERT INTO captures (id, project_id, media_type, mime_type, local_path, byte_size, sha256, location_available, captured_at, created_at)
       VALUES ('c-old', 'p1', 'SITE_PHOTO', 'image/jpeg', 'file:///c.jpg', 10, 'ab', 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`
    ).run();
    assert.equal(migrate(db, 11), 11);
    const cols = columns(db, 'captures');
    for (const c of ['heading_degrees', 'heading_reference', 'heading_accuracy_level']) assert.ok(cols.includes(c), c);
    const old = db.prepare('SELECT heading_degrees, heading_reference FROM captures WHERE id = ?').get('c-old') as Record<string, unknown>;
    assert.equal(old.heading_degrees, null);
    assert.equal(old.heading_reference, null);
  });

  it('v12 adds the needs verification tables and captures.verification_id; earlier rows stay', () => {
    const db = new DatabaseSync(':memory:');
    assert.equal(migrate(db, 11), 11);
    db.prepare(
      `INSERT INTO captures (id, project_id, media_type, mime_type, local_path, byte_size, sha256, location_available, captured_at, created_at)
       VALUES ('c-old', 'p1', 'SITE_PHOTO', 'image/jpeg', 'file:///c.jpg', 10, 'ab', 1, '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`
    ).run();
    db.prepare(
      `INSERT INTO outbox (id, project_id, kind, entity_id, next_attempt_at, created_at, updated_at)
       VALUES ('o1', 'p1', 'CAPTURE', 'c-old', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z', '2026-11-01T00:00:00.000Z')`
    ).run();
    assert.equal(migrate(db), LATEST_SCHEMA_VERSION);
    assert.equal(LATEST_SCHEMA_VERSION, 12);
    for (const t of ['needs_verifications', 'needs_verification_forms', 'needs_verification_drafts']) {
      assert.ok(columns(db, t).length > 0, `missing table ${t}`);
      assert.ok(DATA_TABLES.includes(t), `${t} is not cleared by "clear local data"`);
    }
    assert.ok(columns(db, 'captures').includes('verification_id'));
    const old = db.prepare('SELECT verification_id FROM captures WHERE id = ?').get('c-old') as Record<string, unknown>;
    assert.equal(old.verification_id, null);
    assert.equal((db.prepare('SELECT COUNT(*) AS n FROM outbox').get() as { n: number }).n, 1);
  });

  it('v12: one open draft per verification; refused and sent drafts may stay beside it', () => {
    const db = new DatabaseSync(':memory:');
    migrate(db);
    const insertDraft = db.prepare(
      `INSERT INTO needs_verification_drafts (id, verification_id, status, form_hash, draft_json, created_at, updated_at)
       VALUES (?, 'nv1', ?, 'h', '{}', '2026-11-27T00:00:00.000Z', '2026-11-27T00:00:00.000Z')`
    );
    insertDraft.run('d1', 'REFUSED');
    insertDraft.run('d2', 'SENT');
    insertDraft.run('d3', 'DRAFT');
    assert.throws(() => insertDraft.run('d4', 'QUEUED'), /UNIQUE/);
    db.prepare(`UPDATE needs_verification_drafts SET status = 'SENT' WHERE id = 'd3'`).run();
    insertDraft.run('d5', 'QUEUED');
    db.prepare(
      `INSERT INTO needs_verification_forms (verification_id, form_hash, json, downloaded_at) VALUES ('nv1', 'h', '{}', '2026-11-27T00:00:00.000Z')`
    ).run();
    assert.throws(
      () => db.prepare(`INSERT INTO needs_verification_forms (verification_id, form_hash, json, downloaded_at) VALUES ('nv1', 'h', '{}', '2026-11-27T00:00:00.000Z')`).run(),
      /UNIQUE|PRIMARY/
    );
  });
});
