/**
 * Versioned SQLite schema (Phase 4). The version lives in `PRAGMA user_version`; each migration
 * runs once, in order, inside a transaction. Never edit a shipped migration: add the next one.
 *
 * Version 1 is a destructive rebuild of the pre-Phase-4 tables (allowed in development: the old
 * tables held base64 media, non-UUID IDs and fabricated GPS values that must not be synced).
 */

export interface Migration {
  version: number;
  sql: string;
}

const LEGACY_TABLES = [
  'wbs_items',
  'wbs_chat_messages',
  'staged_workday_reports',
  'site_telemetry_pings',
  'incident_reports',
  'in_app_notifications',
  'assurance_submissions',
];

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
${LEGACY_TABLES.map((t) => `DROP TABLE IF EXISTS ${t};`).join('\n')}

-- One processor sends everything in this table; nothing else talks to the API for writes.
CREATE TABLE outbox (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  depends_on_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT NOT NULL,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX outbox_ready ON outbox (status, next_attempt_at);
CREATE INDEX outbox_entity ON outbox (kind, entity_id);

-- One photo, voice note or document. id = clientCaptureId.
CREATE TABLE captures (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  wbs_item_id TEXT,
  media_type TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  local_path TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  duration_seconds REAL,
  caption TEXT,
  latitude REAL,
  longitude REAL,
  accuracy_meters REAL,
  altitude_meters REAL,
  is_mocked INTEGER NOT NULL DEFAULT 0,
  location_available INTEGER NOT NULL,
  captured_at TEXT NOT NULL,
  signature TEXT,
  report_id TEXT,
  object_key TEXT,
  upload_status TEXT NOT NULL DEFAULT 'LOCAL',
  server_json TEXT,
  registered_at TEXT,
  local_deleted_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX captures_wbs ON captures (project_id, wbs_item_id, report_id);

-- The confirmed end-of-day statement. id = clientReportId.
CREATE TABLE workday_reports (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  wbs_item_id TEXT NOT NULL,
  workday_date TEXT NOT NULL,
  reporter_timezone TEXT NOT NULL,
  summary_text TEXT NOT NULL,
  reported_quantity REAL NOT NULL,
  unit TEXT NOT NULL,
  is_hold_point_claimed INTEGER NOT NULL DEFAULT 0,
  delays_or_blockers TEXT,
  capture_ids_json TEXT NOT NULL DEFAULT '[]',
  text_notes_json TEXT NOT NULL DEFAULT '[]',
  geotag_json TEXT,
  confirmed_at TEXT NOT NULL,
  signature TEXT,
  revises_server_report_id TEXT,
  report_query_id TEXT,
  server_report_id TEXT,
  server_status TEXT,
  sync_status TEXT NOT NULL DEFAULT 'QUEUED',
  last_error TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX workday_reports_period ON workday_reports (project_id, wbs_item_id, workday_date);

CREATE TABLE wbs_items (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  wbs_code TEXT NOT NULL,
  description TEXT NOT NULL,
  unit TEXT NOT NULL,
  rate_ngn REAL NOT NULL DEFAULT 0,
  total_quantity REAL NOT NULL DEFAULT 0,
  cumulative_certified_pct REAL NOT NULL DEFAULT 0,
  is_hold_point INTEGER NOT NULL DEFAULT 0,
  hold_point_instruction TEXT,
  is_scheduled_today INTEGER NOT NULL DEFAULT 0,
  planning_tier TEXT NOT NULL DEFAULT 'UNBLOCKED_POOL',
  last_message_text TEXT,
  last_message_at TEXT
);
CREATE INDEX wbs_items_project ON wbs_items (project_id);

-- Chat messages. Local messages are keyed by client_message_id; server rows by server_id.
CREATE TABLE chat_messages (
  id TEXT PRIMARY KEY NOT NULL,
  client_message_id TEXT UNIQUE,
  server_id TEXT UNIQUE,
  project_id TEXT NOT NULL,
  wbs_item_id TEXT NOT NULL,
  sender_session_id TEXT,
  sender_name TEXT NOT NULL,
  sender_role TEXT NOT NULL,
  message_type TEXT NOT NULL,
  text_content TEXT,
  capture_id TEXT,
  capture_json TEXT,
  report_id TEXT,
  workday_report_id TEXT,
  report_query_id TEXT,
  query_json TEXT,
  brief_date TEXT,
  created_at TEXT NOT NULL,
  sync_status TEXT NOT NULL DEFAULT 'SERVER'
);
CREATE INDEX chat_messages_thread ON chat_messages (wbs_item_id, created_at);

CREATE TABLE telemetry_pings (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  wbs_item_id TEXT,
  latitude REAL NOT NULL,
  longitude REAL NOT NULL,
  accuracy_meters REAL,
  altitude_meters REAL,
  is_mocked INTEGER NOT NULL DEFAULT 0,
  ping_source TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  signature TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX telemetry_pings_project ON telemetry_pings (project_id, ping_source, captured_at);

CREATE TABLE incidents (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  server_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE assurance_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  uploaded_keys_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  synced_at TEXT
);

-- Geofence and BOQ pack, so geofence checks survive an app restart.
CREATE TABLE project_baseline (
  project_id TEXT PRIMARY KEY NOT NULL,
  json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
`,
  },
  {
    // Phase 5 Step 8: which session queued each item, so items from a session that has ended can be
    // held after the person rejoins; and the link from a re-submitted capture to its original.
    version: 2,
    sql: `
ALTER TABLE outbox ADD COLUMN session_key TEXT;
ALTER TABLE captures ADD COLUMN resubmitted_from TEXT;
ALTER TABLE captures ADD COLUMN superseded_by TEXT;
`,
  },
  {
    // Phase 7 Step 8: who a morning brief is written for and the standards it applies, so the brief
    // card titles and lists them from what the server sent rather than from the current session.
    version: 3,
    sql: `
ALTER TABLE chat_messages ADD COLUMN brief_json TEXT;
`,
  },
  {
    // Phase 7 Step 8: the server's status for every report of this person on the project, including
    // reports submitted from another device of the same account. Status only: the report content
    // stays on the device that wrote it, and nothing here is ever sent.
    version: 4,
    sql: `
CREATE TABLE IF NOT EXISTS server_reports (
  server_report_id TEXT PRIMARY KEY NOT NULL,
  client_report_id TEXT,
  project_id TEXT NOT NULL,
  wbs_item_id TEXT NOT NULL,
  workday_date TEXT NOT NULL,
  status TEXT NOT NULL,
  revision_number INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS server_reports_period ON server_reports (project_id, wbs_item_id, workday_date);
`,
  },
  {
    // Phase 9: each WBS item's planned window (YYYY-MM-DD, project zone) from the server's schedule.
    // is_scheduled_today is no longer written or read (the server dropped the flag); it stays only
    // because SQLite cannot drop a column in older versions.
    version: 5,
    sql: `
ALTER TABLE wbs_items ADD COLUMN planned_start_date TEXT;
ALTER TABLE wbs_items ADD COLUMN planned_end_date TEXT;
`,
  },
  {
    // Phase 14: site inspection drafts (survive app restarts) and the confirmed request waiting in
    // the outbox. status: DRAFT | QUEUED | SENT. The request never holds file paths: photos are
    // referenced by clientCaptureId and sent first by the outbox.
    version: 6,
    sql: `
CREATE TABLE IF NOT EXISTS inspection_drafts (
  id TEXT PRIMARY KEY NOT NULL,
  project_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'DRAFT',
  draft_json TEXT NOT NULL,
  request_json TEXT,
  server_id TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS inspection_drafts_project ON inspection_drafts (project_id, status);
`,
  },
  {
    // Redesign R1d: the identity-assurance step is gone (provisioned accounts only), so queued
    // identity submissions can never be sent. They are removed; the empty assurance_submissions
    // table stays (nothing reads or writes it any more).
    version: 7,
    sql: `
DELETE FROM outbox WHERE kind = 'ASSURANCE';
DELETE FROM assurance_submissions;
`,
  },
  {
    // Redesign R1e: morning briefs and presence telemetry are gone. Cached brief messages are
    // removed (the brief_date / brief_json columns stay; nothing reads or writes them any more),
    // queued presence pings can never be sent, so they and the local ping table go, and each
    // thread's last-message preview is recomputed without the briefs.
    version: 8,
    sql: `
DELETE FROM chat_messages WHERE message_type = 'MORNING_BRIEF';
DELETE FROM outbox WHERE kind = 'TELEMETRY';
DROP TABLE IF EXISTS telemetry_pings;
UPDATE wbs_items SET
  last_message_text = (SELECT COALESCE(m.text_content, m.message_type) FROM chat_messages m
                       WHERE m.wbs_item_id = wbs_items.id ORDER BY m.created_at DESC LIMIT 1),
  last_message_at = (SELECT m.created_at FROM chat_messages m
                     WHERE m.wbs_item_id = wbs_items.id ORDER BY m.created_at DESC LIMIT 1);
`,
  },
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Tables cleared by "clear local data" in Settings (schema version is kept). */
export const DATA_TABLES = [
  'outbox',
  'captures',
  'workday_reports',
  'wbs_items',
  'chat_messages',
  'server_reports',
  'incidents',
  'assurance_submissions',
  'project_baseline',
  'inspection_drafts',
];

/** Migrations still to run for a database at `currentVersion`. */
export function pendingMigrations(currentVersion: number): Migration[] {
  return MIGRATIONS.filter((m) => m.version > currentVersion);
}
