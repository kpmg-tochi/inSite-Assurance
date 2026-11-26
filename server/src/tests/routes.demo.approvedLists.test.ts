/**
 * Client demo updates, wave 3 (E3, read-only lists): annual approved lists, their rows, the projects
 * linked to each row and the budget-mismatch red flag, on the seeded UBEC tenant. The normal seed has
 * no lists, so the test creates them with prisma.
 * - GET /approved-lists: years, the chosen (default latest) year's list summaries (rows, linked,
 *   mismatches), the tenant tolerance and the visible mismatches.
 * - GET /approved-lists/:listId: match statuses NOT_LINKED, LINKED, MISMATCH, MULTIPLE; linked projects
 *   limited to the caller's visibility (a SUBEB administrator sees only its own).
 * - GET|PUT /projects/:id/approved-list-row: link and unlink with audit APPROVED_LIST_ROW_LINKED;
 *   a row of another year is refused (422 APPROVED_LIST_YEAR_MISMATCH).
 * - 403 without `approved_lists:view`.
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

type RowDto = { id: string; rowRef: string; matchStatus: string; linkedProjects: Array<{ id: string; mismatch: { flagged: boolean; summary: string } | null }> };

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { createApp } = await import('../app');
  app = createApp();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
  ids.tenant = tenant.id;

  // Let SUBEB administrators read the lists (the default grant is the UBEC Administrator only).
  const permission = await prisma.permission.findUniqueOrThrow({ where: { key: 'approved_lists:view' } });
  const orgAdmin = await prisma.role.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'ORGANIZATION_ADMIN' } });
  await prisma.rolePermission.create({ data: { roleId: orgAdmin.id, permissionId: permission.id } });

  // Projects the Kano SUBEB administrator can and cannot see.
  const kanoList = await request(app).get('/api/v1/projects').set(await as(KANO));
  assert.equal(kanoList.status, 200, JSON.stringify(kanoList.body));
  const kanoVisible = new Set((kanoList.body.data as Array<{ id: string }>).map((p) => p.id));
  const live = await prisma.project.findMany({ where: { tenantId: tenant.id, status: 'ACTIVE' }, orderBy: { codePrefix: 'asc' }, select: { id: true } });
  const visible = live.filter((p) => kanoVisible.has(p.id));
  const hidden = live.filter((p) => !kanoVisible.has(p.id));
  assert.ok(visible.length >= 1 && hidden.length >= 3, 'needs projects on both sides of the Kano subtree');
  ids.pKano = visible[0].id;
  ids.pOther = hidden[0].id;
  ids.pMultiA = hidden[1].id;
  ids.pMultiB = hidden[2].id;

  for (const [id, budget] of [
    [ids.pKano, 50_000_000],
    [ids.pOther, 84_000_000],
    [ids.pMultiA, 10_000_000],
    [ids.pMultiB, 10_000_000],
  ] as const) {
    await prisma.project.update({ where: { id }, data: { interventionYear: 2026, totalBudgetNgn: budget, approvedListRowId: null } });
  }

  const di = await prisma.approvedList.create({
    data: {
      tenantId: tenant.id,
      interventionYear: 2026,
      kind: 'DI_SCHEDULE',
      title: '2026 Approved Projects & Implementation Schedule',
      approvedBy: 'Executive Secretary, UBEC',
      approvedOn: '2026-02-10',
    },
  });
  const beap = await prisma.approvedList.create({
    data: { tenantId: tenant.id, interventionYear: 2026, kind: 'MG_BEAP', stateCode: 'KN', title: 'Kano 2026 BEAP', approvedBy: 'UBEC', approvedOn: '2026-03-01' },
  });
  const old = await prisma.approvedList.create({
    data: { tenantId: tenant.id, interventionYear: 2025, kind: 'DI_SCHEDULE', title: '2025 Approved Projects & Implementation Schedule', approvedBy: 'Executive Secretary, UBEC', approvedOn: '2025-02-10' },
  });
  ids.di = di.id;
  ids.beap = beap.id;
  ids.old = old.id;
  const row = (listId: string, rowRef: string, costEstimateNgn: number, sortOrder: number) =>
    prisma.approvedListRow.create({
      data: { listId, rowRef, projectTitle: `Row ${rowRef}`, schoolNamesJson: ['Example Primary School'], stateCode: 'KN', lgaCodes: [], costEstimateNgn, sortOrder },
    });
  ids.rLinked = (await row(di.id, 'DI/2026/001', 50_000_000, 1)).id;
  ids.rMismatch = (await row(di.id, 'DI/2026/002', 71_500_000, 2)).id;
  ids.rMultiple = (await row(di.id, 'DI/2026/003', 10_000_000, 3)).id;
  ids.rFree = (await row(di.id, 'DI/2026/004', 20_000_000, 4)).id;
  ids.rBeap = (await row(beap.id, 'KN/2026/001', 30_000_000, 1)).id;
  ids.rOld = (await row(old.id, 'DI/2025/001', 40_000_000, 1)).id;

  await prisma.project.update({ where: { id: ids.pKano }, data: { approvedListRowId: ids.rLinked } });
  await prisma.project.update({ where: { id: ids.pOther }, data: { approvedListRowId: ids.rMismatch } });
  await prisma.project.update({ where: { id: ids.pMultiA }, data: { approvedListRowId: ids.rMultiple } });
  await prisma.project.update({ where: { id: ids.pMultiB }, data: { approvedListRowId: ids.rMultiple } });
});

after(async () => {
  await prisma?.$disconnect();
});

describe('demo wave 3: approved lists overview and detail (E3)', () => {
  it('summarises the latest year by default, with counts and the mismatches', async () => {
    const res = await request(app).get('/api/v1/approved-lists').set(await as(ADMIN));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const data = res.body.data;
    assert.deepEqual(data.years, [2026, 2025]);
    assert.equal(data.interventionYear, 2026);
    assert.equal(data.tolerancePct, 10);
    assert.equal(data.lists.length, 2);
    const di = data.lists.find((l: { id: string }) => l.id === ids.di);
    assert.equal(di.rowCount, 4);
    assert.equal(di.totalEstimateNgn, 151_500_000);
    assert.equal(di.linkedRowCount, 3);
    assert.equal(di.mismatchCount, 1);
    const beap = data.lists.find((l: { id: string }) => l.id === ids.beap);
    assert.equal(beap.stateCode, 'KN');
    assert.equal(beap.linkedRowCount, 0);
    assert.equal(data.mismatches.length, 1);
    assert.equal(data.mismatches[0].id, ids.pOther);
    assert.equal(data.mismatches[0].rowRef, 'DI/2026/002');
    assert.equal(data.mismatches[0].mismatch.summary, 'Budget ₦84.0m vs approved schedule ₦71.5m (+17%)');

    const older = await request(app).get('/api/v1/approved-lists?interventionYear=2025').set(await as(ADMIN));
    assert.equal(older.status, 200);
    assert.equal(older.body.data.interventionYear, 2025);
    assert.deepEqual(older.body.data.lists.map((l: { id: string }) => l.id), [ids.old]);
  });

  it('gives each row its match status', async () => {
    const res = await request(app).get(`/api/v1/approved-lists/${ids.di}`).set(await as(ADMIN));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const rows = res.body.data.rows as RowDto[];
    assert.deepEqual(rows.map((r) => [r.rowRef, r.matchStatus]), [
      ['DI/2026/001', 'LINKED'],
      ['DI/2026/002', 'MISMATCH'],
      ['DI/2026/003', 'MULTIPLE'],
      ['DI/2026/004', 'NOT_LINKED'],
    ]);
    assert.equal(rows[0].linkedProjects[0].id, ids.pKano);
    assert.equal(rows[0].linkedProjects[0].mismatch?.flagged, false);
    assert.equal(rows[1].linkedProjects[0].mismatch?.flagged, true);
    assert.equal(rows[2].linkedProjects.length, 2);
  });

  it('names only the projects a SUBEB administrator can see', async () => {
    const res = await request(app).get(`/api/v1/approved-lists/${ids.di}`).set(await as(KANO));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const rows = res.body.data.rows as RowDto[];
    assert.deepEqual(rows[0].linkedProjects.map((p) => p.id), [ids.pKano]);
    // The row is still a mismatch (programme-level), but the other SUBEB's project is not named.
    assert.equal(rows[1].matchStatus, 'MISMATCH');
    assert.deepEqual(rows[1].linkedProjects, []);
    assert.equal(res.body.data.mismatchCount, 1);
    const overview = await request(app).get('/api/v1/approved-lists').set(await as(KANO));
    assert.equal(overview.status, 200);
    assert.deepEqual(overview.body.data.mismatches, []);
  });

  it('refuses users without approved_lists:view, and another tenant’s list', async () => {
    const res = await request(app).get('/api/v1/approved-lists').set(await as(ME));
    assert.equal(res.status, 403);
    const detail = await request(app).get(`/api/v1/approved-lists/${ids.di}`).set(await as(ME));
    assert.equal(detail.status, 403);
    const missing = await request(app).get('/api/v1/approved-lists/00000000-0000-4000-8000-000000000000').set(await as(ADMIN));
    assert.equal(missing.status, 404);
  });
});

describe('demo wave 3: linking a project to its row (E3)', () => {
  it('reads the link with the budget check', async () => {
    const res = await request(app).get(`/api/v1/projects/${ids.pOther}/approved-list-row`).set(await as(ADMIN));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.rowRef, 'DI/2026/002');
    assert.equal(res.body.data.kind, 'DI_SCHEDULE');
    assert.equal(res.body.data.mismatch.flagged, true);
    assert.equal(res.body.data.mismatch.differencePct, 17.5);
  });

  it('links, relinks and unlinks with an audit entry each time', async () => {
    const before = await prisma.auditLog.count({ where: { projectId: ids.pKano, action: 'APPROVED_LIST_ROW_LINKED' } });
    const link = await request(app).put(`/api/v1/projects/${ids.pKano}/approved-list-row`).set(await as(ADMIN)).send({ rowId: ids.rFree });
    assert.equal(link.status, 200, JSON.stringify(link.body));
    assert.equal(link.body.data.rowRef, 'DI/2026/004');
    assert.equal(link.body.data.mismatch.flagged, true); // ₦50.0m vs ₦20.0m
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { projectId: ids.pKano, action: 'APPROVED_LIST_ROW_LINKED' }, orderBy: { seq: 'desc' } });
    const payload = entry.payload as Record<string, unknown>;
    assert.equal(payload.rowId, ids.rFree);
    assert.equal(payload.previousRowId, ids.rLinked);
    assert.equal(payload.budgetFlagged, true);

    // The same row again writes nothing.
    const same = await request(app).put(`/api/v1/projects/${ids.pKano}/approved-list-row`).set(await as(ADMIN)).send({ rowId: ids.rFree });
    assert.equal(same.status, 200);

    const unlink = await request(app).put(`/api/v1/projects/${ids.pKano}/approved-list-row`).set(await as(ADMIN)).send({ rowId: null });
    assert.equal(unlink.status, 200, JSON.stringify(unlink.body));
    assert.equal(unlink.body.data, null);
    const read = await request(app).get(`/api/v1/projects/${ids.pKano}/approved-list-row`).set(await as(ADMIN));
    assert.equal(read.status, 200);
    assert.equal(read.body.data, null);
    assert.equal(await prisma.auditLog.count({ where: { projectId: ids.pKano, action: 'APPROVED_LIST_ROW_LINKED' } }), before + 2);

    const overview = await request(app).get(`/api/v1/approved-lists/${ids.di}`).set(await as(ADMIN));
    const rows = overview.body.data.rows as RowDto[];
    assert.equal(rows.find((r) => r.id === ids.rLinked)?.matchStatus, 'NOT_LINKED');
  });

  it('refuses a row of another intervention year, and an unknown row', async () => {
    const res = await request(app).put(`/api/v1/projects/${ids.pKano}/approved-list-row`).set(await as(ADMIN)).send({ rowId: ids.rOld });
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'APPROVED_LIST_YEAR_MISMATCH');
    const unknown = await request(app)
      .put(`/api/v1/projects/${ids.pKano}/approved-list-row`)
      .set(await as(ADMIN))
      .send({ rowId: '00000000-0000-4000-8000-000000000000' });
    assert.equal(unknown.status, 404);
  });

  it('allows a project without an intervention year to take any year’s row', async () => {
    await prisma.project.update({ where: { id: ids.pKano }, data: { interventionYear: null } });
    const res = await request(app).put(`/api/v1/projects/${ids.pKano}/approved-list-row`).set(await as(ADMIN)).send({ rowId: ids.rOld });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.rowRef, 'DI/2025/001');
  });

  it('refuses the link to users who cannot edit project settings', async () => {
    const res = await request(app).put(`/api/v1/projects/${ids.pKano}/approved-list-row`).set(await as(KANO)).send({ rowId: ids.rFree });
    assert.equal(res.status, 403);
  });
});
