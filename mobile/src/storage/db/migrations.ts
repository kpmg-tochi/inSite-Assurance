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
];

export const LATEST_SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;

/** Tables cleared by "clear local data" in Settings (schema version is kept). */
export const DATA_TABLES = [
  'outbox',
  'captures',
  'workday_reports',
  'wbs_items',
  'chat_messages',
  'telemetry_pings',
  'incidents',
  'assurance_submissions',
  'project_baseline',
];

/** Migrations still to run for a database at `currentVersion`. */
export function pendingMigrations(currentVersion: number): Migration[] {
  return MIGRATIONS.filter((m) => m.version > currentVersion);
}
