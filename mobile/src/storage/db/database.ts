import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import { DATA_TABLES, LATEST_SCHEMA_VERSION, pendingMigrations } from './migrations';

/**
 * The one local database (Phase 4).
 *
 * - Encrypted with SQLCipher when the binary includes it (`expo-sqlite` plugin `useSQLCipher`).
 *   The key is 32 random bytes held in the OS keystore, never in the database or JS bundle.
 * - SQLCipher is not available in Expo Go, and `PRAGMA key` silently does nothing without it
 *   (Expo docs), so the build is checked with `PRAGMA cipher_version`. A release build without
 *   SQLCipher refuses to open the database; a development build opens it unencrypted and
 *   `getStorageInfo().encrypted` says so, so the UI never claims encryption it does not have.
 * - There is no in-memory fallback: if the database cannot open, capture is blocked with a clear
 *   message instead of keeping data in memory that a restart would lose.
 */

const DB_NAME = 'insite_field_v4.db';
const KEY_STORE_KEY = 'insite.sqlcipherKey.v1';

export class StorageUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export interface StorageInfo {
  encrypted: boolean;
  schemaVersion: number;
}

let opening: Promise<SQLite.SQLiteDatabase> | null = null;
let info: StorageInfo | null = null;

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += b.toString(16).padStart(2, '0');
  return out;
}

async function loadOrCreateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_STORE_KEY);
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return existing;
  const key = toHex(Crypto.getRandomBytes(32));
  await SecureStore.setItemAsync(KEY_STORE_KEY, key, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return key;
}

async function applyEncryption(db: SQLite.SQLiteDatabase): Promise<boolean> {
  const cipher = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
  if (cipher == null) {
    if (!__DEV__) {
      throw new StorageUnavailableError(
        'This build cannot encrypt local data. Install the official app build to capture evidence.'
      );
    }
    console.warn('[storage] SQLCipher is not in this build (Expo Go?). Local data is NOT encrypted.');
    return false;
  }
  // A raw 64-hex key skips SQLCipher's passphrase derivation. Hex only, so no quoting issues.
  const key = await loadOrCreateKey();
  await db.execAsync(`PRAGMA key = "x'${key}'"`);
  // A wrong key does not fail on open; the first read does.
  await db.getFirstAsync('SELECT count(*) AS n FROM sqlite_master');
  return true;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<number> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = row?.user_version ?? 0;
  for (const m of pendingMigrations(version)) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(m.sql);
      await db.execAsync(`PRAGMA user_version = ${m.version}`);
    });
    version = m.version;
  }
  return version;
}

async function open(): Promise<SQLite.SQLiteDatabase> {
  try {
    const db = await SQLite.openDatabaseAsync(DB_NAME);
    const encrypted = await applyEncryption(db);
    await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const schemaVersion = await migrate(db);
    info = { encrypted, schemaVersion };
    return db;
  } catch (error) {
    opening = null;
    if (error instanceof StorageUnavailableError) throw error;
    throw new StorageUnavailableError(
      `Local storage could not be opened, so nothing can be captured safely. Restart the app; if this repeats, contact support. (${
        (error as Error)?.message ?? 'unknown error'
      })`
    );
  }
}

/** The database, opened, keyed and migrated. Throws StorageUnavailableError; never returns null. */
export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!opening) opening = open();
  return opening;
}

export function getStorageInfo(): StorageInfo | null {
  return info;
}

export const EXPECTED_SCHEMA_VERSION = LATEST_SCHEMA_VERSION;

/** Deletes all local records (Settings → clear local data). Keeps the schema and keys. */
export async function clearLocalData(): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    for (const table of DATA_TABLES) {
      await db.runAsync(`DELETE FROM ${table}`);
    }
  });
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return Crypto.randomUUID();
}
