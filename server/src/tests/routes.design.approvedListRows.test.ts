/**
 * Design refinement (2026-11-26): GET /api/v1/approved-lists/rows?interventionYear= gives the Needs
 * assessment page every row of a year in one request (the overview fields plus `rows`).
 * - The latest year by default; rows of every list of the year, in list order then row order; the
 *   overview fields match GET /approved-lists; another year on request; an empty tenant answers no rows.
 * - Linked projects limited to the caller's visibility (match status stays programme-level).
 * - 403 without `approved_lists:view`.
 * The normal seed has no lists, so the test creates them with prisma.
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import request from 'supertest';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;

const PASSWORD = 'Password123!';
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};

async function as(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

const ADMIN = 'admin@ubec.test';
const KANO = 'kano.admin@ubec.test';
const ME = 'me.officer@ubec.test';

type RowDto = { id: string; listId: string; rowRef: string; matchStatus: string; linkedProjects: Array<{ id: string }> };

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { createApp } = await import('../app');
  app = createApp();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });

  // Before any list exists: no years, no rows.
  const empty = await request(app).get('/api/v1/approved-lists/rows').set(await as(ADMIN));
  assert.equal(empty.status, 200, JSON.stringify(empty.body));
  assert.deepEqual(empty.body.data.years, []);
  assert.equal(empty.body.data.interventionYear, null);
  assert.deepEqual(empty.body.data.rows, []);

  const permission = await prisma.permission.findUniqueOrThrow({ where: { key: 'approved_lists:view' } });
  const orgAdmin = await prisma.role.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'ORGANIZATION_ADMIN' } });
  await prisma.rolePermission.create({ data: { roleId: orgAdmin.id, permissionId: permission.id } });

  const kanoList = await request(app).get('/api/v1/projects').set(await as(KANO));
  assert.equal(kanoList.status, 200, JSON.stringify(kanoList.body));
  const kanoVisible = new Set((kanoList.body.data as Array<{ id: string }>).map((p) => p.id));
  const live = await prisma.project.findMany({ where: { tenantId: tenant.id, status: 'ACTIVE' }, orderBy: { codePrefix: 'asc' }, select: { id: true } });
  const visible = live.filter((p) => kanoVisible.has(p.id));
  const hidden = live.filter((p) => !kanoVisible.has(p.id));
  assert.ok(visible.length >= 1 && hidden.length >= 1, 'needs projects on both sides of the Kano subtree');
  ids.pKano = visible[0].id;
  ids.pOther = hidden[0].id;
  for (const [id, budget] of [
    [ids.pKano, 30_000_000],
    [ids.pOther, 84_000_000],
  ] as const) {
    await prisma.project.update({ where: { id }, data: { interventionYear: 2026, totalBudgetNgn: budget, approvedListRowId: null } });
  }

  const di = await prisma.approvedList.create({
    data: { tenantId: tenant.id, interventionYear: 2026, kind: 'DI_SCHEDULE', title: 'DI 2026', approvedBy: 'Executive Secretary, UBEC', approvedOn: '2026-02-10' },
  });
  const beapKano = await prisma.approvedList.create({
    data: { tenantId: tenant.id, interventionYear: 2026, kind: 'MG_BEAP', stateCode: 'KN', title: 'BEAP 2026: Kano', approvedBy: 'UBEC', approvedOn: '2026-03-01' },
  });
  const beapLagos = await prisma.approvedList.create({
    data: { tenantId: tenant.id, interventionYear: 2026, kind: 'MG_BEAP', stateCode: 'LA', title: 'BEAP 2026: Lagos', approvedBy: 'UBEC', approvedOn: '2026-03-02' },
  });
  const old = await prisma.approvedList.create({
    data: { tenantId: tenant.id, interventionYear: 2025, kind: 'DI_SCHEDULE', title: 'DI 2025', approvedBy: 'Executive Secretary, UBEC', approvedOn: '2025-02-10' },
  });
  ids.di = di.id;
  ids.beapKano = beapKano.id;
  ids.beapLagos = beapLagos.id;
  ids.old = old.id;
  const row = (listId: string, rowRef: string, stateCode: string, costEstimateNgn: number, sortOrder: number) =>
    prisma.approvedListRow.create({
      data: { listId, rowRef, projectTitle: `Row ${rowRef}`, schoolNamesJson: ['Example Primary School'], stateCode, lgaCodes: [], costEstimateNgn, sortOrder },
    });
  ids.rDi2 = (await row(di.id, 'DI/2026/002', 'LA', 71_500_000, 2)).id;
  ids.rDi1 = (await row(di.id, 'DI/2026/001', 'KN', 20_000_000, 1)).id;
  ids.rKano = (await row(beapKano.id, 'KN/2026/001', 'KN', 30_000_000, 1)).id;
  ids.rLagos = (await row(beapLagos.id, 'LA/2026/001', 'LA', 40_000_000, 1)).id;
  ids.rOld = (await row(old.id, 'DI/2025/001', 'KN', 40_000_000, 1)).id;

  await prisma.project.update({ where: { id: ids.pKano }, data: { approvedListRowId: ids.rKano } });
  await prisma.project.update({ where: { id: ids.pOther }, data: { approvedListRowId: ids.rDi2 } });
});

after(async () => {
  await prisma?.$disconnect();
});

describe('design refinement: every row of a year (GET /approved-lists/rows)', () => {
  it('returns the latest year with the overview fields and every row in list then row order', async () => {
    const res = await request(app).get('/api/v1/approved-lists/rows').set(await as(ADMIN));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const data = res.body.data;
    assert.deepEqual(data.years, [2026, 2025]);
    assert.equal(data.interventionYear, 2026);

    const overview = await request(app).get('/api/v1/approved-lists').set(await as(ADMIN));
    assert.equal(overview.status, 200);
    assert.deepEqual(data.lists, overview.body.data.lists);
    assert.deepEqual(data.mismatches, overview.body.data.mismatches);
    assert.equal(data.tolerancePct, overview.body.data.tolerancePct);
    assert.equal('rows' in overview.body.data, false);

    const rows = data.rows as RowDto[];
    // Lists sort DI first, then BEAPs by State (KN, LA); rows by their order on the list.
    assert.deepEqual(rows.map((r) => r.rowRef), ['DI/2026/001', 'DI/2026/002', 'KN/2026/001', 'LA/2026/001']);
    assert.deepEqual(rows.map((r) => r.listId), [ids.di, ids.di, ids.beapKano, ids.beapLagos]);
    const byRef = new Map(rows.map((r) => [r.rowRef, r]));
    assert.equal(byRef.get('DI/2026/002')?.matchStatus, 'MISMATCH');
    assert.equal(byRef.get('KN/2026/001')?.matchStatus, 'LINKED');
    assert.equal(byRef.get('LA/2026/001')?.matchStatus, 'NOT_LINKED');
    assert.deepEqual(byRef.get('DI/2026/002')?.linkedProjects.map((p) => p.id), [ids.pOther]);
  });

  it('answers another year on request', async () => {
    const res = await request(app).get('/api/v1/approved-lists/rows?interventionYear=2025').set(await as(ADMIN));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.interventionYear, 2025);
    assert.deepEqual((res.body.data.rows as RowDto[]).map((r) => r.id), [ids.rOld]);
  });

  it('names only the projects the caller can see', async () => {
    const res = await request(app).get('/api/v1/approved-lists/rows').set(await as(KANO));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const rows = res.body.data.rows as RowDto[];
    const mismatch = rows.find((r) => r.id === ids.rDi2);
    assert.equal(mismatch?.matchStatus, 'MISMATCH');
    assert.deepEqual(mismatch?.linkedProjects, []);
    assert.deepEqual(rows.find((r) => r.id === ids.rKano)?.linkedProjects.map((p) => p.id), [ids.pKano]);
  });

  it('refuses users without approved_lists:view', async () => {
    const res = await request(app).get('/api/v1/approved-lists/rows').set(await as(ME));
    assert.equal(res.status, 403);
  });
});
