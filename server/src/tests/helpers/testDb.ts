/**
 * Disposable test database for route-level tests.
 *
 * Uses TEST_DATABASE_URL, or DATABASE_URL with `_test` appended to the database name. Each test
 * file gets a fresh, already migrated and seeded copy, cloned from `<name>_tmpl`, which is built
 * once per test run. It refuses to touch any database whose name does not end in `_test`.
 *
 * Import this module before anything that reads `env` or creates the Prisma client.
 */
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import dotenv from 'dotenv';
import { Client } from 'pg';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function resolveTestDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('Set TEST_DATABASE_URL or DATABASE_URL to run route tests');
  const url = new URL(base);
  const dbName = url.pathname.replace(/^\//, '');
  url.pathname = `/${dbName.endsWith('_test') ? dbName : `${dbName}_test`}`;
  return url.toString();
}

export const TEST_DATABASE_URL = resolveTestDatabaseUrl();

// Must be set before env.ts / prisma.ts are imported.
process.env.DATABASE_URL = TEST_DATABASE_URL;
process.env.NODE_ENV = 'test';
process.env.DEMO_MODE = 'false';
process.env.ENABLE_DEMO_ENDPOINTS = 'false';
process.env.S3_ENDPOINT = '';
// Route tests must never call the AI provider; reconciliation tests stub the rater explicitly.
process.env.AZURE_OPENAI_ENDPOINT = '';
process.env.AZURE_OPENAI_API_KEY = '';
// Nor the speech provider or push service; uploads go to a throwaway folder.
process.env.WHISPER_API_KEY = '';
process.env.PUSH_PROVIDER = 'none';
process.env.AI_CHECK_SWEEP_INTERVAL_SECONDS = '0';
process.env.LOCAL_STORAGE_DIR = path.join(os.tmpdir(), `insite-test-storage-${process.pid}`);

const SERVER_DIR = path.resolve(__dirname, '../../..');

function withDatabase(base: string, name: string): string {
  const url = new URL(base);
  url.pathname = `/${name}`;
  return url.toString();
}

/**
 * The migrated and seeded template is built once per test run and cloned for every test file
 * (`CREATE DATABASE ... TEMPLATE`, a file copy), instead of migrating and seeding per file.
 *
 * "Once per run": every test file of one `tsx --test` run is a child of the same test-runner
 * process, so the runner's PID (process.ppid) identifies the run. The template stores it as its
 * database comment; a different run rebuilds it. Seed data uses times relative to "now", so a
 * template is never reused across runs.
 */
async function ensureSeededTemplate(admin: Client, templateName: string): Promise<void> {
  const runKey = `insite-test-run:${process.ppid}`;
  const existing = await admin.query<{ comment: string | null }>(
    `SELECT shobj_description(oid, 'pg_database') AS comment FROM pg_database WHERE datname = $1`,
    [templateName]
  );
  if (existing.rows[0]?.comment === runKey) return;

  if (existing.rows.length > 0) {
    await admin.query(`ALTER DATABASE "${templateName}" IS_TEMPLATE false`);
    await admin.query(`DROP DATABASE "${templateName}" WITH (FORCE)`);
  }
  await admin.query(`CREATE DATABASE "${templateName}"`);

  const env = { ...process.env, DATABASE_URL: withDatabase(TEST_DATABASE_URL, templateName) };
  execSync('npx prisma migrate deploy', { cwd: SERVER_DIR, env, stdio: 'pipe' });
  // The seed runs in its own process so this process's Prisma client never connects to the
  // template (a template must have no connections when it is cloned).
  execSync('npx tsx prisma/seed.ts', { cwd: SERVER_DIR, env, stdio: 'pipe' });

  await admin.query(`ALTER DATABASE "${templateName}" IS_TEMPLATE true`);
  await admin.query(`COMMENT ON DATABASE "${templateName}" IS '${runKey}'`);
}

/** Replaces the test database with a fresh copy of the migrated and seeded template. */
export async function resetTestDatabase(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to reset database "${dbName}": name must end in _test`);
  }
  const templateName = `${dbName}_tmpl`;

  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await ensureSeededTemplate(admin, templateName);
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}" TEMPLATE "${templateName}"`);
  } finally {
    await admin.end();
  }
}
