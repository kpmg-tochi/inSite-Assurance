/**
 * Client demo updates, wave 1 (C1, C3, C4, D5): project lots and lot/batch codes, the intervention
 * year rule, national state/LGA codes, the funding source code and the new list filters, on the
 * seeded UBEC tenant.
 * - GET /api/v1/project-lots: allowed years, each year's lots, next lot and batch numbers.
 * - Draft creation with a lot choice: {year}-LOT-{lot}-BATCH-{batch}; concurrent creates get
 *   distinct batches; LOT_NOT_FOUND, INTERVENTION_YEAR_REQUIRED / _NOT_ALLOWED, LOT_CODE_NOT_MANUAL.
 * - Basics save: a new year re-numbers a lot-coded draft; a live project keeps its code.
 * - stateCode/lgaCode write the names (LGA_NOT_IN_STATE); fundingSourceCode writes the text.
 * - Filters zone/stateCode/lgaCode/fundingSourceCode on the directory and the portfolio overview.
 * - The older codePrefix path still works; the register import accepts a lot code.
 */
import { resetTestDatabase } from './helpers/testDb';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import request from 'supertest';
import { allowedInterventionYears, zonedCalendarDate, type RegisterRowRaw } from '@insite/shared';
import { demoRegisterWorkbookData } from '../scripts/demoProject';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let buildRegisterWorkbook: typeof import('../modules/projectRegister/registerWorkbook')['buildRegisterWorkbook'];

const PASSWORD = 'Password123!';
const ADMIN = 'admin@ubec.test';
const today = zonedCalendarDate(new Date(), 'Africa/Lagos');
const [Y0, Y1] = allowedInterventionYears(today, 1);
const ids: Record<string, string> = {};
let token = '';

async function web() {
  if (!token) {
    const res = await request(app).post('/api/v1/auth/login').send({ email: ADMIN, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    token = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${token}` };
}

let seq = 0;
function draft(extra: Record<string, unknown>) {
  seq += 1;
  return {
    name: `Lot test project ${seq}`,
    stateCode: 'KN',
    totalBudgetNgn: 2_000_000,
    projectTypeId: ids.type,
    ...extra,
  };
}

async function create(extra: Record<string, unknown>) {
  return request(app).post('/api/v1/projects').set(await web()).send(draft(extra));
}

async function lots(query: Record<string, unknown> = {}) {
  const res = await request(app).get('/api/v1/project-lots').query(query).set(await web());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data as {
    today: string;
    fiscalYearStartMonth: number;
    allowedInterventionYears: number[];
    years: Array<{ interventionYear: number; nextLotNumber: number; lots: Array<{ id: string; number: number; title: string; projectCount: number; nextBatchNumber: number }> }>;
  };
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  ({ buildRegisterWorkbook } = await import('../modules/projectRegister/registerWorkbook'));
  const { createApp } = await import('../app');
  app = createApp();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
  ids.tenant = tenant.id;
  ids.type = (await prisma.projectType.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'CENTRAL' } })).id;
});

describe('demo wave 1: project lots and codes (C3, D5)', () => {
  it('lists no lots for a fresh workspace, with the allowed years', async () => {
    const data = await lots();
    assert.equal(data.today, today);
    assert.equal(data.fiscalYearStartMonth, 1);
    assert.deepEqual(data.allowedInterventionYears, [Y0, Y1]);
    assert.deepEqual(data.years, [
      { interventionYear: Y0, nextLotNumber: 1, lots: [] },
      { interventionYear: Y1, nextLotNumber: 1, lots: [] },
    ]);
    // A requested earlier year is added to the list.
    assert.deepEqual((await lots({ interventionYear: Y0 - 2 })).years.map((y) => y.interventionYear), [Y0 - 2, Y0, Y1]);
  });

  it('numbers lots and batches within the year', async () => {
    const first = await create({ interventionYear: Y0, lotChoice: { newLotTitle: 'Renovation, Equipment and Furnishings of Public Schools' } });
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.data.basics.codePrefix, `${Y0}-LOT-1-BATCH-1`);
    assert.equal(first.body.data.basics.lot.number, 1);
    assert.equal(first.body.data.basics.lot.title, 'Renovation, Equipment and Furnishings of Public Schools');
    assert.equal(first.body.data.basics.batchNumber, 1);
    assert.deepEqual(first.body.data.basics.interventionYearOptions, [Y0, Y1]);
    ids.lot1 = first.body.data.basics.lot.id;
    ids.firstDraft = first.body.data.projectId;
    const audit = await prisma.auditLog.findFirst({ where: { action: 'PROJECT_LOT_CREATED', tenantId: ids.tenant } });
    assert.ok(audit, 'lot creation audited');
    assert.equal(audit.projectId, null);

    const second = await create({ interventionYear: Y0, lotChoice: { lotId: ids.lot1 } });
    assert.equal(second.status, 201, JSON.stringify(second.body));
    assert.equal(second.body.data.basics.codePrefix, `${Y0}-LOT-1-BATCH-2`);

    const lot2 = await create({ interventionYear: Y0, lotChoice: { newLotTitle: 'Construction of Classroom Blocks' } });
    assert.equal(lot2.status, 201, JSON.stringify(lot2.body));
    assert.equal(lot2.body.data.basics.codePrefix, `${Y0}-LOT-2-BATCH-1`);

    // A typed code with a lot choice: the lot wins.
    const both = await create({ interventionYear: Y0, codePrefix: 'PRG-388', lotChoice: { lotId: ids.lot1 } });
    assert.equal(both.status, 201, JSON.stringify(both.body));
    assert.equal(both.body.data.basics.codePrefix, `${Y0}-LOT-1-BATCH-3`);

    const year = (await lots()).years.find((y) => y.interventionYear === Y0)!;
    assert.equal(year.nextLotNumber, 3);
    assert.deepEqual(
      year.lots.map((l) => [l.number, l.projectCount, l.nextBatchNumber]),
      [
        [1, 3, 4],
        [2, 1, 2],
      ]
    );
  });

  it('gives concurrent creates distinct batches', async () => {
    const results = await Promise.all([0, 1, 2, 3].map(() => create({ interventionYear: Y0, lotChoice: { lotId: ids.lot1 } })));
    for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.body));
    const batches = results.map((r) => r.body.data.basics.batchNumber as number).sort((a, b) => a - b);
    assert.deepEqual(batches, [4, 5, 6, 7]);
    assert.equal(new Set(results.map((r) => r.body.data.basics.codePrefix)).size, 4);
  });

  it('refuses a lot of another year, a missing or disallowed year and a typed lot code', async () => {
    const otherYear = await create({ interventionYear: Y1, lotChoice: { lotId: ids.lot1 } });
    assert.equal(otherYear.status, 422, JSON.stringify(otherYear.body));
    assert.equal(otherYear.body.error.code, 'LOT_NOT_FOUND');

    const noYear = await create({ lotChoice: { newLotTitle: 'Supply of Furniture' } });
    assert.equal(noYear.status, 422);
    assert.equal(noYear.body.error.code, 'INTERVENTION_YEAR_REQUIRED');

    const past = await create({ interventionYear: Y0 - 1, lotChoice: { newLotTitle: 'Supply of Furniture' } });
    assert.equal(past.status, 422);
    assert.equal(past.body.error.code, 'INTERVENTION_YEAR_NOT_ALLOWED');
    const tooLate = await create({ interventionYear: Y1 + 1, codePrefix: 'PRG-389' });
    assert.equal(tooLate.status, 422);
    assert.equal(tooLate.body.error.code, 'INTERVENTION_YEAR_NOT_ALLOWED');

    const typed = await create({ interventionYear: Y0, codePrefix: `${Y0}-LOT-9-BATCH-1` });
    assert.equal(typed.status, 422);
    assert.equal(typed.body.error.code, 'LOT_CODE_NOT_MANUAL');

    const none = await create({ interventionYear: Y0 });
    assert.equal(none.status, 400);
    assert.equal(none.body.error.code, 'PROJECT_CODE_REQUIRED');
    // Nothing was written by the refusals.
    assert.equal((await lots()).years.find((y) => y.interventionYear === Y1)!.lots.length, 0);
  });

  it('re-numbers a lot-coded draft when its year changes; a live project keeps its code', async () => {
    const h = await web();
    const setup = (await request(app).get(`/api/v1/projects/${ids.firstDraft}/setup`).set(h)).body.data;
    const basics = { name: setup.basics.name, totalBudgetNgn: setup.basics.totalBudgetNgn };
    const disallowed = await request(app).put(`/api/v1/projects/${ids.firstDraft}/setup/basics`).set(h).send({ ...basics, interventionYear: Y0 - 3 });
    assert.equal(disallowed.status, 422, JSON.stringify(disallowed.body));
    assert.equal(disallowed.body.error.code, 'INTERVENTION_YEAR_NOT_ALLOWED');

    const moved = await request(app).put(`/api/v1/projects/${ids.firstDraft}/setup/basics`).set(h).send({ ...basics, interventionYear: Y1 });
    assert.equal(moved.status, 200, JSON.stringify(moved.body));
    assert.equal(moved.body.data.basics.codePrefix, `${Y1}-LOT-1-BATCH-1`);
    assert.equal(moved.body.data.basics.lot.title, 'Renovation, Equipment and Furnishings of Public Schools');
    assert.equal(moved.body.data.basics.lot.interventionYear, Y1);
    // Omitted code and year keep them.
    const kept = await request(app).put(`/api/v1/projects/${ids.firstDraft}/setup/basics`).set(h).send(basics);
    assert.equal(kept.body.data.basics.codePrefix, `${Y1}-LOT-1-BATCH-1`);

    const live = await prisma.project.findFirstOrThrow({ where: { tenantId: ids.tenant, codePrefix: 'PRG-102' } });
    const liveSetup = (await request(app).get(`/api/v1/projects/${live.id}/setup`).set(h)).body.data;
    const locked = await request(app)
      .put(`/api/v1/projects/${live.id}/setup/basics`)
      .set(h)
      .send({ name: liveSetup.basics.name, totalBudgetNgn: liveSetup.basics.totalBudgetNgn, lotChoice: { lotId: ids.lot1 } });
    assert.equal(locked.status, 409, JSON.stringify(locked.body));
    assert.equal(locked.body.error.code, 'CODE_PREFIX_LOCKED');
  });

  it('keeps the older code path: a typed code, a state name matched to its code', async () => {
    const res = await request(app)
      .post('/api/v1/projects')
      .set(await web())
      .send({ name: 'Typed code draft', codePrefix: 'PRG-301', stateLocation: 'Kano', totalBudgetNgn: 1_000_000, projectTypeId: ids.type, interventionYear: Y0 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.basics.codePrefix, 'PRG-301');
    assert.equal(res.body.data.basics.lot, null);
    assert.equal(res.body.data.basics.stateLocation, 'Kano');
    assert.equal(res.body.data.basics.stateCode, 'KN');
  });
});

describe('demo wave 1: state, LGA and funding source (C1, C4)', () => {
  it('writes the names from the codes and refuses an LGA of another state', async () => {
    const res = await create({ codePrefix: 'PRG-302', stateCode: 'KN', lgaCode: 'KN-DALA', fundingSourceCode: 'DEVELOPMENT_PARTNER', fundingSource: 'BESDA-AF' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const b = res.body.data.basics;
    assert.equal(b.stateCode, 'KN');
    assert.equal(b.stateLocation, 'Kano');
    assert.equal(b.zone, 'NW');
    assert.equal(b.lgaCode, 'KN-DALA');
    assert.equal(b.lgaLocation, 'Dala');
    assert.equal(b.fundingSourceCode, 'DEVELOPMENT_PARTNER');
    assert.equal(b.fundingSource, 'Development partner: BESDA-AF');

    const wrong = await create({ codePrefix: 'PRG-303', stateCode: 'LA', lgaCode: 'KN-DALA' });
    assert.equal(wrong.status, 422);
    assert.equal(wrong.body.error.code, 'LGA_NOT_IN_STATE');

    // Null clears the codes (and the names unless text is sent).
    const h = await web();
    const id = res.body.data.projectId as string;
    const cleared = await request(app)
      .put(`/api/v1/projects/${id}/setup/basics`)
      .set(h)
      .send({ name: b.name, totalBudgetNgn: b.totalBudgetNgn, stateCode: null, stateLocation: 'Somewhere', lgaCode: null, fundingSourceCode: null });
    assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
    assert.equal(cleared.body.data.basics.stateCode, null);
    assert.equal(cleared.body.data.basics.stateLocation, 'Somewhere');
    assert.equal(cleared.body.data.basics.lgaCode, null);
    assert.equal(cleared.body.data.basics.lgaLocation, null);
    assert.equal(cleared.body.data.basics.fundingSourceCode, null);
    assert.equal(cleared.body.data.basics.fundingSource, null);
  });

  it('filters the directory and the portfolio by zone, state, LGA and funding source code', async () => {
    const h = await web();
    const setCodes = async (code: string, extra: Record<string, unknown>) => {
      const id = (await prisma.project.findFirstOrThrow({ where: { tenantId: ids.tenant, codePrefix: code } })).id;
      const s = (await request(app).get(`/api/v1/projects/${id}/setup`).set(h)).body.data;
      const res = await request(app).put(`/api/v1/projects/${id}/setup/basics`).set(h).send({ name: s.basics.name, totalBudgetNgn: s.basics.totalBudgetNgn, ...extra });
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return id;
    };
    // Live projects (the directory lists live and archived ones).
    ids.kano = await setCodes('PRG-102', { stateCode: 'KN', lgaCode: 'KN-GWALE', fundingSourceCode: 'MATCHING_GRANT' });
    ids.lagos = await setCodes('PRG-104', { stateCode: 'LA', lgaCode: 'LA-IKEJA', fundingSourceCode: 'DIRECT_INTERVENTION' });

    const list = async (path: string, query: Record<string, string>) => {
      const res = await request(app).get(path).query(query).set(h);
      assert.equal(res.status, 200, JSON.stringify(res.body));
      return (path.endsWith('overview') ? res.body.data.projects : res.body.data) as Array<{
        id: string;
        stateCode: string | null;
        lgaCode: string | null;
        zone: string | null;
        fundingSourceCode: string | null;
      }>;
    };
    // Other seeded projects may carry codes too (older state names are matched on save), so each
    // check is: the expected project is in, the other one is out, and every row matches.
    type Row = Awaited<ReturnType<typeof list>>[number];
    const check = async (path: string, query: Record<string, string>, inId: string, outId: string, match: (p: Row) => boolean) => {
      const rows = await list(path, query);
      const label = `${path} ${JSON.stringify(query)}`;
      assert.ok(rows.some((p) => p.id === inId), `${label} includes`);
      assert.ok(!rows.some((p) => p.id === outId), `${label} excludes`);
      assert.ok(rows.every(match), `${label} every row`);
    };
    for (const path of ['/api/v1/projects', '/api/v1/projects/portfolio/overview']) {
      await check(path, { zone: 'NW' }, ids.kano, ids.lagos, (p) => p.zone === 'NW');
      await check(path, { zone: 'SW' }, ids.lagos, ids.kano, (p) => p.zone === 'SW');
      await check(path, { stateCode: 'LA' }, ids.lagos, ids.kano, (p) => p.stateCode === 'LA');
      await check(path, { lgaCode: 'KN-GWALE' }, ids.kano, ids.lagos, (p) => p.lgaCode === 'KN-GWALE');
      await check(path, { fundingSourceCode: 'MATCHING_GRANT' }, ids.kano, ids.lagos, (p) => p.fundingSourceCode === 'MATCHING_GRANT');
      assert.deepEqual(await list(path, { zone: 'SE' }), [], path);
    }
    const bad = await request(app).get('/api/v1/projects').query({ zone: 'XX' }).set(h);
    assert.equal(bad.status, 400);
  });
});

describe('demo wave 1: register import with a lot code (C3)', () => {
  it('keeps a free lot code, creates its lot, and numbers a taken one in its lot', async () => {
    const h = await web();
    const row = (code: string, name: string, ref: string): RegisterRowRaw => ({
      code,
      externalReference: ref,
      name,
      state: 'Kano',
      lga: 'Dala',
      projectType: 'Direct Intervention',
      budget: 3_000_000,
      fundingSource: 'Zonal Intervention Projects (ZIP)',
    });
    const rows = [
      row(`${Y0}-LOT-7-BATCH-1`, 'Renovation of Schools in Kano', 'LOT/TEST/1'),
      // Taken by the drafts above: the next batch of lot 1.
      row(`${Y0}-LOT-1-BATCH-2`, 'Another renovation', 'LOT/TEST/2'),
    ];
    const file = (await buildRegisterWorkbook({ ...demoRegisterWorkbookData(today), rows })).toString('base64');
    const preview = await request(app).post('/api/v1/project-register/import/preview').set(h).send({ fileBase64: file });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.deepEqual(preview.body.data.issues, []);
    assert.deepEqual(
      preview.body.data.rows.map((r: { code: string; codeAssigned: boolean; interventionYear: number }) => [r.code, r.codeAssigned, r.interventionYear]),
      [
        [`${Y0}-LOT-7-BATCH-1`, false, Y0],
        [`${Y0}-LOT-1-BATCH-8`, true, Y0],
      ]
    );
    const confirm = await request(app).post('/api/v1/project-register/import/confirm').set(h).send({ fileBase64: file, sha256: preview.body.data.sha256 });
    assert.equal(confirm.status, 201, JSON.stringify(confirm.body));
    const created = await prisma.project.findMany({ where: { tenantId: ids.tenant, externalReference: { startsWith: 'LOT/TEST/' } }, include: { lot: true }, orderBy: { externalReference: 'asc' } });
    assert.equal(created.length, 2);
    assert.equal(created[0].lot?.number, 7);
    assert.equal(created[0].lot?.title, 'Renovation of Schools in Kano');
    assert.equal(created[0].batchNumber, 1);
    assert.equal(created[0].stateCode, 'KN');
    assert.equal(created[0].lgaCode, 'KN-DALA');
    assert.equal(created[0].fundingSourceCode, 'ZONAL_INTERVENTION');
    assert.equal(created[1].lotId, ids.lot1);
    assert.equal(created[1].batchNumber, 8);
  });
});
