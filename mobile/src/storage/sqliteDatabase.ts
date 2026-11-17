import * as SQLite from 'expo-sqlite';
import { Platform } from 'react-native';

const DB_NAME = 'insite_mobile_offline_v2.db';

let dbInstance: SQLite.SQLiteDatabase | null = null;

export async function getDatabase(): Promise<SQLite.SQLiteDatabase | null> {
  if (Platform.OS === 'web') {
    // In web environment, expo-sqlite uses web fallback or in-memory
    return null;
  }
  if (!dbInstance) {
    try {
      dbInstance = await SQLite.openDatabaseAsync(DB_NAME);
      await initDatabaseSchema(dbInstance);
    } catch (error) {
      console.warn('Failed to open SQLite database, falling back to memory store:', error);
      return null;
    }
  }
  return dbInstance;
}

async function initDatabaseSchema(db: SQLite.SQLiteDatabase): Promise<void> {
  await db.execAsync(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS wbs_items (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      wbs_code TEXT NOT NULL,
      description TEXT NOT NULL,
      unit TEXT NOT NULL,
      rate_ngn REAL NOT NULL,
      total_quantity REAL NOT NULL,
      cumulative_certified_pct REAL DEFAULT 0,
      is_hold_point INTEGER DEFAULT 0,
      is_scheduled_today INTEGER DEFAULT 0,
      planning_tier TEXT DEFAULT 'UNBLOCKED_POOL',
      is_reported_today INTEGER DEFAULT 0,
      unread_count INTEGER DEFAULT 0,
      last_message_text TEXT,
      last_message_timestamp TEXT
    );

    CREATE TABLE IF NOT EXISTS wbs_chat_messages (
      id TEXT PRIMARY KEY,
      wbs_item_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      sender_role TEXT NOT NULL,
      message_type TEXT NOT NULL,
      text_content TEXT,
      media_uri TEXT,
      media_uris_json TEXT,
      caption TEXT,
      duration_ms INTEGER,
      waveform_json TEXT,
      latitude REAL,
      longitude REAL,
      chainage_label TEXT,
      timestamp TEXT NOT NULL,
      is_delivered INTEGER DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS staged_workday_reports (
      id TEXT PRIMARY KEY,
      wbs_item_id TEXT NOT NULL,
      workday_date TEXT NOT NULL,
      summary_text TEXT NOT NULL,
      reported_quantity REAL NOT NULL,
      unit TEXT NOT NULL,
      status TEXT NOT NULL,
      evidence_json TEXT,
      voice_note_uri TEXT,
      submission_geotag_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS site_telemetry_pings (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      wbs_item_id TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      accuracy_meters REAL,
      altitude_meters REAL,
      is_mocked INTEGER DEFAULT 0,
      is_within_geofence INTEGER,
      chainage_label TEXT,
      distance_meters REAL,
      ping_source TEXT NOT NULL,
      device_signature_hash TEXT NOT NULL,
      captured_at TEXT NOT NULL,
      synced_at TEXT
    );

    CREATE TABLE IF NOT EXISTS incident_reports (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT NOT NULL,
      is_confidential_whistleblower INTEGER DEFAULT 0,
      photos_json TEXT,
      status TEXT DEFAULT 'OPEN',
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS in_app_notifications (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      action_type TEXT,
      action_payload_json TEXT,
      is_read INTEGER DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS assurance_submissions (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      id_type TEXT NOT NULL,
      id_photo_uri TEXT NOT NULL,
      selfie_front_uri TEXT NOT NULL,
      selfie_left_uri TEXT NOT NULL,
      selfie_right_uri TEXT NOT NULL,
      liveness_json TEXT NOT NULL,
      regulatory_body TEXT NOT NULL,
      license_number TEXT NOT NULL,
      experience_summary TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'QUEUED_OFFLINE',
      created_at TEXT NOT NULL,
      synced_at TEXT
    );
  `);

  // Safe migrations for existing on-device SQLite databases
  await ensureColumnExists(db, 'wbs_items', 'planning_tier', "TEXT DEFAULT 'UNBLOCKED_POOL'");
  await ensureColumnExists(db, 'wbs_items', 'is_reported_today', 'INTEGER DEFAULT 0');
  await ensureColumnExists(db, 'wbs_chat_messages', 'media_uris_json', 'TEXT');
  await ensureColumnExists(db, 'wbs_chat_messages', 'duration_ms', 'INTEGER');
  await ensureColumnExists(db, 'wbs_chat_messages', 'waveform_json', 'TEXT');
  await ensureColumnExists(db, 'staged_workday_reports', 'voice_note_uri', 'TEXT');
  await ensureColumnExists(db, 'staged_workday_reports', 'submission_geotag_json', 'TEXT');
}

async function ensureColumnExists(
  db: SQLite.SQLiteDatabase,
  tableName: string,
  columnName: string,
  columnDef: string
): Promise<void> {
  try {
    const columns = await db.getAllAsync<{ name: string }>(
      `PRAGMA table_info(${tableName})`
    );
    const exists = columns.some((c) => c.name === columnName);
    if (!exists) {
      await db.execAsync(
        `ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef};`
      );
    }
  } catch (err) {
    console.warn(`SQLite column migration skipped for ${tableName}.${columnName}:`, err);
  }
}

/**
 * Removes all user-entered, cached, and unsynced records from the local SQLite database.
 */
export async function clearLocalDatabaseTables(): Promise<void> {
  const db = await getDatabase();
  if (!db) return;

  const tables = [
    'wbs_items',
    'wbs_chat_messages',
    'staged_workday_reports',
    'site_telemetry_pings',
    'incident_reports',
    'in_app_notifications',
    'assurance_submissions',
  ];

  for (const table of tables) {
    try {
      await db.runAsync(`DELETE FROM ${table};`);
    } catch (err) {
      console.warn(`Failed clearing local SQLite table ${table}:`, err);
    }
  }
}

