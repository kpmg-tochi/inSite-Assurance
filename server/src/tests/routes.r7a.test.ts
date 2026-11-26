/**
 * Redesign R7a route tests: code owns the permission rows (D-R7.3) and the migration renames keys
 * without losing grants (D-R7.11, D-R7.19).
 *
 * - After the seed, the database permission keys equal the catalogue, with its names, categories
 *   and surfaces; the start-up sync then has nothing to do.
 * - The migration's data section, replayed on legacy rows: a renamed key keeps its row id and the
 *   custom role holding it keeps it; a merged key's grant moves to the new key; a removed key goes;
 *   stored keys (approval steps, document types, project type config) are rewritten.
 * - A seeded user's permissions use the new keys (UBEC M&E officer).
 *
 * The migration replay changes permission rows, so it runs last in this file.
 */
import { resetTestDatabase, TEST_DATABASE_URL } from './helpers/testDb';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import type { Express } from 'express';
import request from 'supertest';
import { PermissionCategoryEnum, SYSTEM_PERMISSIONS_CATALOG } from '@insite/shared';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let syncPermissionCatalog: typeof import('../modules/rbac/permissionCatalog')['syncPermissionCatalog'];

const MIGRATION_SQL = path.resolve(
  __dirname,
  '../../prisma/migrations/20261225090000_r7a_permission_catalogue/migration.sql',
);

/** The categories the R7a migration's enum swap creates. Later migrations added the others. */
const R7A_CATEGORIES = ['TENANT_ADMIN', 'FORMS_FACILITIES', 'PORTFOLIO_PROJECTS', 'SCOPE_SPRINTS', 'CONTRACT_KICKOFF', 'VISITS_FINDINGS', 'PAYMENTS', 'COMPLETION_CLOSURE'];
const LATER_CATEGORIES = PermissionCategoryEnum.options.filter((c) => !R7A_CATEGORIES.includes(c));

/**
 * Replays the R7a migration in history order. Its enum swap knows only the R7a categories, so rows
 * of a category added later (needs pipeline: NEEDS_FUNDING) wait in an R7a category while it runs;
 * the later category is then added again, as its own migration did, and the catalogue sync that
 * follows puts those rows back.
 */
async function runMigrationSql() {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    if (LATER_CATEGORIES.length) {
      await client.query(`UPDATE "permissions" SET "category" = 'PORTFOLIO_PROJECTS' WHERE "category"::text = ANY($1)`, [LATER_CATEGORIES]);
    }
    await client.query(fs.readFileSync(MIGRATION_SQL, 'utf8'));
    for (const category of LATER_CATEGORIES) {
      await client.query(`ALTER TYPE "PermissionCategory" ADD VALUE IF NOT EXISTS '${category}'`);
    }
  } finally {
    await client.end();
  }
}

describe('Redesign R7a: permission catalogue in the database', () => {
  before(async () => {
    await resetTestDatabase();
    app = (await import('../app')).createApp();
    prisma = (await import('../config/prisma')).prisma;
    ({ syncPermissionCatalog } = await import('../modules/rbac/permissionCatalog'));
  });

  it('seeds exactly the catalogue, so the start-up sync has nothing to do', async () => {
    const rows = await prisma.permission.findMany({ select: { key: true, name: true, category: true, surface: true } });
    assert.deepEqual(rows.map((r) => r.key).sort(), SYSTEM_PERMISSIONS_CATALOG.map((p) => p.key).sort());
    const byKey = new Map(rows.map((r) => [r.key, r]));
    for (const p of SYSTEM_PERMISSIONS_CATALOG) {
      const row = byKey.get(p.key)!;
      assert.deepEqual({ name: row.name, category: row.category, surface: row.surface }, { name: p.name, category: p.category, surface: p.surface });
    }
    assert.deepEqual(await syncPermissionCatalog(prisma), { created: 0, updated: 0 });
  });

  it('gives a seeded M&E officer the renamed keys on sign-in', async () => {
    const login = await request(app).post('/api/v1/auth/login').send({ email: 'me.officer@ubec.test', password: 'Password123!' });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    const me = await request(app).get('/api/v1/auth/me').set({ Authorization: `Bearer ${login.body.data.accessToken}` });
    assert.equal(me.status, 200, JSON.stringify(me.body));
    const perms: string[] = me.body.data.permissions ?? me.body.data.user?.permissions;
    assert.ok(Array.isArray(perms), JSON.stringify(me.body.data).slice(0, 300));
    for (const key of ['scope:view', 'visits:view', 'visits:review', 'findings:manage', 'defects:manage', 'incidents:view']) {
      assert.ok(perms.includes(key), `missing ${key}`);
    }
    assert.equal(perms.some((k) => /^(boq|reports|inspections|field|retention|schedule):/.test(k)), false);
  });

  it('replays the migration on legacy rows: renames keep ids and grants, merges move grants, stored keys are rewritten', async () => {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
    // Legacy state: `findings:manage` absent (rename path), `visits:view` present (merge path).
    await prisma.permission.delete({ where: { key: 'findings:manage' } });
    const legacyFindings = await prisma.permission.create({
      data: { key: 'inspections:manage_findings', name: 'Old', description: 'Old', category: 'VISITS_FINDINGS', surface: 'BOTH' },
    });
    const legacyView = await prisma.permission.create({
      data: { key: 'reports:view_all', name: 'Old', description: 'Old', category: 'VISITS_FINDINGS', surface: 'WEB' },
    });
    const legacyIncident = await prisma.permission.create({
      data: { key: 'field:raise_incident', name: 'Old', description: 'Old', category: 'VISITS_FINDINGS', surface: 'MOBILE' },
    });
    const role = await prisma.role.create({
      data: {
        tenantId: tenant.id,
        code: 'R7A_CUSTOM',
        name: 'Custom role from before R7',
        description: 'Holds legacy keys only',
        surface: 'WEB',
        fieldPersonaType: 'NONE',
        isSystemDefault: false,
        rolePermissions: {
          create: [legacyFindings, legacyView, legacyIncident].map((p) => ({ permissionId: p.id })),
        },
      },
    });

    const step = await prisma.approvalStep.findFirstOrThrow({ where: { requiredPermissionKey: 'visits:review' } });
    await prisma.approvalStep.update({ where: { id: step.id }, data: { requiredPermissionKey: 'reports:approve_completion' } });
    const docType = await prisma.documentType.findFirstOrThrow({ where: { tenantId: tenant.id } });
    await prisma.documentType.update({ where: { id: docType.id }, data: { signOffPermissionKey: 'retention:manage_defects' } });
    const type = await prisma.projectType.findFirstOrThrow({ where: { tenantId: tenant.id } });
    const config = type.configJson as Record<string, unknown>;
    await prisma.projectType.update({
      where: { id: type.id },
      data: { configJson: { ...config, r7aProbe: { permissionKey: 'inspections:manage_findings' } } },
    });

    await runMigrationSql();
    await syncPermissionCatalog(prisma);

    const renamed = await prisma.permission.findUniqueOrThrow({ where: { key: 'findings:manage' } });
    assert.equal(renamed.id, legacyFindings.id, 'a rename keeps the row id');
    assert.equal(renamed.name, SYSTEM_PERMISSIONS_CATALOG.find((p) => p.key === 'findings:manage')!.name, 'the sync rewrites the name');
    for (const key of ['inspections:manage_findings', 'reports:view_all', 'field:raise_incident']) {
      assert.equal(await prisma.permission.findUnique({ where: { key } }), null, `${key} is gone`);
    }
    const held = (
      await prisma.rolePermission.findMany({ where: { roleId: role.id }, include: { permission: { select: { key: true } } } })
    )
      .map((rp) => rp.permission.key)
      .sort();
    assert.deepEqual(held, ['findings:manage', 'visits:view']);

    assert.equal((await prisma.approvalStep.findUniqueOrThrow({ where: { id: step.id } })).requiredPermissionKey, 'visits:review');
    assert.equal((await prisma.documentType.findUniqueOrThrow({ where: { id: docType.id } })).signOffPermissionKey, 'defects:manage');
    const probe = ((await prisma.projectType.findUniqueOrThrow({ where: { id: type.id } })).configJson as Record<string, { permissionKey: string }>)
      .r7aProbe;
    assert.equal(probe.permissionKey, 'findings:manage');

    const keys = (await prisma.permission.findMany({ select: { key: true } })).map((p) => p.key).sort();
    assert.deepEqual(keys, SYSTEM_PERMISSIONS_CATALOG.map((p) => p.key).sort(), 'the replay is idempotent on the catalogue');
  });
});
