/**
 * Disposable test database for route-level tests.
 *
 * Uses TEST_DATABASE_URL, or DATABASE_URL with `_test` appended to the database name. The
 * database is dropped and rebuilt from migrations on every run, so it refuses to touch any
 * database whose name does not end in `_test`.
 *
 * Import this module before anything that reads `env` or creates the Prisma client.
 */
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

export async function resetTestDatabase(): Promise<void> {
  const url = new URL(TEST_DATABASE_URL);
  const dbName = url.pathname.replace(/^\//, '');
  if (!dbName.endsWith('_test')) {
    throw new Error(`Refusing to reset database "${dbName}": name must end in _test`);
  }

  const adminUrl = new URL(TEST_DATABASE_URL);
  adminUrl.pathname = '/postgres';
  adminUrl.search = '';
  const admin = new Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${dbName}"`);
  } finally {
    await admin.end();
  }

  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '../../..'),
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: 'pipe',
  });
}
