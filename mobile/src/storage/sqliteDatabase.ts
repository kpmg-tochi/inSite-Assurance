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
      caption TEXT,
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
      created_at TEXT NOT NULL
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
  `);
}

