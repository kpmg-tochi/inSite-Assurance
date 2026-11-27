/**
 * Client demo updates, wave 2 (C2 light, D2): multi-site projects and derived parties, on the seeded
 * UBEC tenant.
 * - Section `sites` (PUT /projects/:id/setup/sites): LGAs in the project's state (422
 *   SITE_LGA_NOT_IN_STATE), numbers follow list order, a located site gets a radial boundary of the
 *   workspace default radius, audit SITES_SAVED; a site a unit names cannot be removed (409 SITE_IN_USE).
 * - Units carry `siteId` (422 SITE_NOT_FOUND for another project's site; omitted keeps, null clears).
 * - GET /projects/:id/sites: progress budget-weighted over the site's lines; status from the lines,
 *   work phases and the project phase.
 * - Activation: an unlocated site blocks (SITE_NOT_LOCATED); a project without sites is unaffected.
 * - Directory and portfolio rows carry `sites[]`; the register export has one sub-row per site.
 * - D2: owner and funder derived from the type and state; parties not asked on a typed draft.
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { addDays, zonedCalendarDate } from '@insite/shared';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;

const PASSWORD = 'Password123!';
const ADMIN = 'admin@ubec.test';
const ids: Record<string, string> = {};
let token = '';
const today = zonedCalendarDate(new Date(), 'Africa/Lagos');

async function web() {
  if (!token) {
    const res = await request(app).post('/api/v1/auth/login').send({ email: ADMIN, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    token = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${token}` };
}

let seq = 0;
async function createDraft(typeId: string, stateCode: string | null = 'KN') {
  seq += 1;
  const res = await request(app)
    .post('/api/v1/projects')
    .set(await web())
    .send({ name: `Sites test project ${seq}`, codePrefix: `STE-${100 + seq}`, ...(stateCode ? { stateCode } : {}), totalBudgetNgn: 50_000_000, projectTypeId: typeId });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  // Needs pipeline wave 4 (D-N.13): a manual draft of a pipeline programme has no origin; these tests
  // cover the setup checks behind the origin gate, so the draft is given one.
  await prisma.project.update({ where: { id: res.body.data.projectId }, data: { origin: 'LEGACY' } });
  return res.body.data.projectId as string;
}

async function setup(projectId: string) {
  const res = await request(app).get(`/api/v1/projects/${projectId}/setup`).set(await web());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data as {
    steps: Array<{ stepId: string; required: boolean; complete: boolean; issues: Array<{ code: string; field?: string }> }>;
    sites: { stateCode: string | null; defaultRadiusMeters: number; sites: Array<Record<string, unknown>> } | null;
  };
}

const section = (dto: Awaited<ReturnType<typeof setup>>, id: string) => dto.steps.find((s) => s.stepId === id)!;

async function saveSites(projectId: string, sites: unknown[]) {
  return request(app).put(`/api/v1/projects/${projectId}/setup/sites`).set(await web()).send({ sites });
}

/**
 * The sites: GET /projects/:id/sites on a live project; on a draft the setup DTO's `sites` (the draft
 * lifecycle rule serves only the wizard's routes).
 */
async function getSites(projectId: string) {
  const status = (await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { status: true } })).status;
  const res =
    status === 'DRAFT'
      ? await request(app).get(`/api/v1/projects/${projectId}/setup`).set(await web())
      : await request(app).get(`/api/v1/projects/${projectId}/sites`).set(await web());
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return (status === 'DRAFT' ? res.body.data.sites : res.body.data) as {
    projectId: string;
    stateCode: string;
    defaultRadiusMeters: number;
    sites: Array<{
      id: string;
      siteNumber: number;
      schoolName: string;
      lgaCode: string;
      lgaName: string | null;
      located: boolean;
      boundary: { mode: string; radiusMeters: number; center: { latitude: number; longitude: number } } | null;
      unitCount: number;
      lineCount: number;
      amountNgn: number;
      progressPct: number | null;
      status: string;
    }>;
  };
}

/** Collects a binary response (xlsx) as a Buffer. */
function binary(res: NodeJS.ReadableStream & { setEncoding: (e: string) => void }, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

const SITE_A = { schoolName: 'Dala Model Primary School', schoolLevel: 'PRIMARY', lgaCode: 'KN-DALA', address: 'Dala, Kano', latitude: 12.0012, longitude: 8.5052 };
const SITE_B = { schoolName: 'LGEA Primary School, Bompai', schoolLevel: 'PRIMARY', lgaCode: 'KN-NASARAWA', latitude: 12.0203, longitude: 8.5452 };
const SITE_C = { schoolName: 'Bichi Junior Secondary School', schoolLevel: 'JSS', lgaCode: 'KN-BICHI' };

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { createApp } = await import('../app');
  app = createApp();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
  ids.tenant = tenant.id;
  ids.central = (await prisma.projectType.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'CENTRAL' } })).id;
  ids.coFunded = (await prisma.projectType.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'CO_FUNDED' } })).id;
  ids.radius = String(tenant.defaultGeofenceRadiusMeters);
  ids.facility = (
    await prisma.facility.findFirstOrThrow({ where: { tenantId: tenant.id, archetype: 'BUILDING_WORKS', isRetired: false }, orderBy: { sortOrder: 'asc' } })
  ).id;
  ids.flagship = (await prisma.organization.findFirstOrThrow({ where: { tenantId: tenant.id, name: { contains: 'Universal Basic Education Commission' } } })).id;
});

after(async () => {
  await prisma?.$disconnect();
});

describe('demo wave 2: derived owner and funder (D2)', () => {
  it('derives a Matching Grants owner from the state SUBEB and follows a state change on a draft', async () => {
    const kano = await prisma.organization.findFirstOrThrow({ where: { tenantId: ids.tenant, name: { contains: 'Kano State Universal' } } });
    const lagos = await prisma.organization.findFirstOrThrow({ where: { tenantId: ids.tenant, name: { contains: 'Lagos State Universal' } } });
    await prisma.organization.update({ where: { id: kano.id }, data: { stateCode: 'KN' } });
    await prisma.organization.update({ where: { id: lagos.id }, data: { stateCode: 'LA' } });
    // A SUBEB the type does not allow is never derived.
    await prisma.organization.create({
      data: { tenantId: ids.tenant, name: 'Sokoto State Universal Basic Education Board (SUBEB)', categories: ['CLIENT_OWNER'], stateCode: 'SO' },
    });

    const projectId = await createDraft(ids.coFunded, 'KN');
    let row = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    assert.equal(row.owningOrganizationId, kano.id, 'the Kano SUBEB owns a Kano Matching Grants project');
    assert.equal(row.lenderOrganizationId, kano.id, 'OWNER funder default');

    // The state changes on the draft: the derived owner and funder follow.
    const basics = { name: row.name, codePrefix: row.codePrefix, totalBudgetNgn: 50_000_000 };
    let res = await request(app).put(`/api/v1/projects/${projectId}/setup/basics`).set(await web()).send({ ...basics, stateCode: 'LA' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    row = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    assert.equal(row.owningOrganizationId, lagos.id);
    assert.equal(row.lenderOrganizationId, lagos.id);

    // No SUBEB the type allows in Sokoto: unchanged.
    res = await request(app).put(`/api/v1/projects/${projectId}/setup/basics`).set(await web()).send({ ...basics, stateCode: 'SO' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    row = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    assert.equal(row.owningOrganizationId, lagos.id);

    // A value a user saved is never overwritten.
    res = await request(app).put(`/api/v1/projects/${projectId}/setup/parties`).set(await web()).send({ owningOrganizationId: lagos.id });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    res = await request(app).put(`/api/v1/projects/${projectId}/setup/basics`).set(await web()).send({ ...basics, stateCode: 'KN' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    row = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    assert.equal(row.owningOrganizationId, lagos.id, 'saved by a user: kept');
  });

  it('derives a Direct Intervention owner and funder from the type, and does not ask for parties', async () => {
    const projectId = await createDraft(ids.central, 'KN');
    ids.diDraft = projectId;
    const row = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    assert.equal(row.owningOrganizationId, ids.flagship, 'no state office in Kano: the type default (UBEC HQ)');
    assert.equal(row.lenderOrganizationId, ids.flagship);
    const dto = await setup(projectId);
    const parties = section(dto, 'parties');
    assert.deepEqual(parties.issues, [], JSON.stringify(parties.issues));
    assert.equal(parties.required, false);
    const activation = await request(app).post(`/api/v1/projects/${projectId}/activate`).set(await web());
    assert.equal(activation.status, 422);
    const codes = (activation.body.error.details.issues as Array<{ stepId: string; code: string }>).map((i) => `${i.stepId}:${i.code}`);
    assert.ok(!codes.some((c) => c.startsWith('parties:')), codes.join(', '));
    // A project without sites: the sites section is optional and raises nothing.
    assert.ok(!codes.some((c) => c.startsWith('sites:')), codes.join(', '));
    assert.equal(section(dto, 'sites').required, false);
    assert.deepEqual(section(dto, 'sites').issues, []);
  });
});

describe('demo wave 2: project sites (C2)', () => {
  it('saves sites: LGAs in the state, numbers in list order, boundaries for located sites', async () => {
    const projectId = await createDraft(ids.central, 'KN');
    ids.project = projectId;
    const outside = await saveSites(projectId, [SITE_A, { ...SITE_B, lgaCode: 'LA-MUSHIN' }]);
    assert.equal(outside.status, 422, JSON.stringify(outside.body));
    assert.equal(outside.body.error.code, 'SITE_LGA_NOT_IN_STATE');

    const saved = await saveSites(projectId, [SITE_A, SITE_B, SITE_C]);
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.data.sites.sites.length, 3);
    const data = await getSites(projectId);
    assert.equal(data.stateCode, 'KN');
    assert.deepEqual(data.sites.map((s) => [s.siteNumber, s.schoolName]), [
      [1, SITE_A.schoolName],
      [2, SITE_B.schoolName],
      [3, SITE_C.schoolName],
    ]);
    const [a, b, c] = data.sites;
    assert.equal(a.lgaName, 'Dala');
    assert.equal(a.located, true);
    assert.equal(a.boundary?.mode, 'RADIAL');
    assert.equal(a.boundary?.radiusMeters, Number(ids.radius));
    assert.deepEqual(a.boundary?.center, { latitude: SITE_A.latitude, longitude: SITE_A.longitude });
    assert.equal(c.located, false);
    assert.equal(c.boundary, null);
    assert.equal(a.status, 'NOT_STARTED');
    assert.ok(await prisma.auditLog.findFirst({ where: { projectId, action: 'SITES_SAVED' } }));

    // Reorder and remove: numbers follow the new order.
    const reordered = await saveSites(projectId, [
      { id: c.id, ...SITE_C },
      { id: a.id, ...SITE_A },
    ]);
    assert.equal(reordered.status, 200, JSON.stringify(reordered.body));
    const after2 = await getSites(projectId);
    assert.deepEqual(after2.sites.map((s) => [s.siteNumber, s.id]), [
      [1, c.id],
      [2, a.id],
    ]);
    assert.equal(await prisma.projectSite.count({ where: { id: b.id } }), 0);
    // Back to three sites for the rest of the file.
    const again = await saveSites(projectId, [{ id: a.id, ...SITE_A }, SITE_B, { id: c.id, ...SITE_C }]);
    assert.equal(again.status, 200, JSON.stringify(again.body));
  });

  it('refuses sites before the project has a state', async () => {
    const projectId = await createDraft(ids.central, 'KN');
    await prisma.project.update({ where: { id: projectId }, data: { stateCode: null } });
    const res = await saveSites(projectId, [SITE_A]);
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'STATE_REQUIRED_FOR_SITES');
  });

  it('links units to sites (SITE_NOT_FOUND, SITE_IN_USE) and returns siteId on the scope', async () => {
    const projectId = ids.project;
    const sites = (await getSites(projectId)).sites;
    ids.siteA = sites[0].id;
    ids.siteB = sites[1].id;
    ids.siteC = sites[2].id;
    const h = await web();
    const sprints = await request(app)
      .put(`/api/v1/projects/${projectId}/scope/sprints`)
      .set(h)
      .send({
        sprints: [
          { name: 'Work phase 1', startDate: addDays(today, -60), endDate: addDays(today, -30) },
          { name: 'Work phase 2', startDate: addDays(today, -29), endDate: addDays(today, 30) },
        ],
      });
    assert.equal(sprints.status, 200, JSON.stringify(sprints.body));
    const [s1, s2] = sprints.body.data.sprints as Array<{ id: string }>;

    // Another project's site is refused.
    const other = await createDraft(ids.central, 'KN');
    assert.equal((await saveSites(other, [SITE_A])).status, 200);
    const foreignSite = (await getSites(other)).sites[0].id;
    const unit = (body: Record<string, unknown>) => request(app).post(`/api/v1/projects/${projectId}/scope/units`).set(h).send(body);
    const refused = await unit({ facilityId: ids.facility, label: 'Block A', startSprintId: s1.id, endSprintId: s1.id, siteId: foreignSite });
    assert.equal(refused.status, 422, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'SITE_NOT_FOUND');

    // Site A: unit ended in work phase 1. Site B: unit ends in work phase 2.
    const ua = await unit({ facilityId: ids.facility, label: 'Block A', startSprintId: s1.id, endSprintId: s1.id, siteId: ids.siteA });
    assert.equal(ua.status, 201, JSON.stringify(ua.body));
    const ub = await unit({ facilityId: ids.facility, label: 'Block B', startSprintId: s1.id, endSprintId: s2.id, siteId: ids.siteB });
    assert.equal(ub.status, 201, JSON.stringify(ub.body));
    const units = ub.body.data.units as Array<{ id: string; label: string; siteId: string | null }>;
    ids.unitA = units.find((u) => u.label === 'Block A')!.id;
    ids.unitB = units.find((u) => u.label === 'Block B')!.id;
    assert.equal(units.find((u) => u.id === ids.unitA)!.siteId, ids.siteA);

    // Omitted keeps, null clears, a site of the project sets.
    const patch = (body: Record<string, unknown>) => request(app).patch(`/api/v1/projects/${projectId}/scope/units/${ids.unitB}`).set(h).send(body);
    let res = await patch({ label: 'Block B (renamed)' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((res.body.data.units as Array<{ id: string; siteId: string | null }>).find((u) => u.id === ids.unitB)!.siteId, ids.siteB);
    res = await patch({ siteId: null });
    assert.equal((res.body.data.units as Array<{ id: string; siteId: string | null }>).find((u) => u.id === ids.unitB)!.siteId, null);
    res = await patch({ siteId: ids.siteB });
    assert.equal((res.body.data.units as Array<{ id: string; siteId: string | null }>).find((u) => u.id === ids.unitB)!.siteId, ids.siteB);

    const line = (facilityUnitId: string, wbsCode: string, rateNgn: number) =>
      request(app).post(`/api/v1/projects/${projectId}/scope/lines`).set(h).send({ facilityUnitId, wbsCode, description: `Works ${wbsCode}`, unit: 'item', totalQuantity: 1, rateNgn });
    for (const [unitId, code, rate] of [
      [ids.unitA, 'A.1', 1_000_000],
      [ids.unitA, 'A.2', 3_000_000],
      [ids.unitB, 'B.1', 2_000_000],
    ] as const) {
      const l = await line(unitId, code, rate);
      assert.equal(l.status, 201, JSON.stringify(l.body));
    }

    // A site a unit names cannot be removed.
    const inUse = await saveSites(projectId, [{ id: ids.siteB, ...SITE_B }, { id: ids.siteC, ...SITE_C }]);
    assert.equal(inUse.status, 409, JSON.stringify(inUse.body));
    assert.equal(inUse.body.error.code, 'SITE_IN_USE');

    const data = await getSites(projectId);
    const a = data.sites.find((s) => s.id === ids.siteA)!;
    assert.equal(a.unitCount, 1);
    assert.equal(a.lineCount, 2);
    assert.equal(a.amountNgn, 4_000_000);
    assert.equal(a.progressPct, 0);
    assert.equal(data.sites.find((s) => s.id === ids.siteC)!.progressPct, null);
  });

  it('blocks activation while a site is not located', async () => {
    const dto = await setup(ids.project);
    const sitesSection = section(dto, 'sites');
    assert.equal(sitesSection.required, true);
    assert.deepEqual(sitesSection.issues.map((i) => i.code), ['SITE_NOT_LOCATED']);
    const res = await request(app).post(`/api/v1/projects/${ids.project}/activate`).set(await web());
    assert.equal(res.status, 422);
    const codes = (res.body.error.details.issues as Array<{ stepId: string; code: string }>).map((i) => `${i.stepId}:${i.code}`);
    assert.ok(codes.includes('sites:SITE_NOT_LOCATED'), codes.join(', '));

    // Locating the site clears the issue.
    const located = await saveSites(ids.project, [
      { id: ids.siteA, ...SITE_A },
      { id: ids.siteB, ...SITE_B },
      { id: ids.siteC, ...SITE_C, latitude: 12.2312, longitude: 8.2411 },
    ]);
    assert.equal(located.status, 200, JSON.stringify(located.body));
    const after = await setup(ids.project);
    assert.deepEqual(section(after, 'sites').issues, []);
    const again = await request(app).post(`/api/v1/projects/${ids.project}/activate`).set(await web());
    const codes2 = (again.body.error?.details?.issues as Array<{ stepId: string; code: string }> | undefined ?? []).map((i) => `${i.stepId}:${i.code}`);
    assert.ok(!codes2.some((c) => c.startsWith('sites:')), codes2.join(', '));
  });

  it('computes site progress and status from the lines, work phases and project phase', async () => {
    const projectId = ids.project;
    // Live (written directly: activation needs the whole setup), lines A.1 done, A.2 not started, B.1 half.
    await prisma.project.update({ where: { id: projectId }, data: { status: 'ACTIVE', activatedAt: new Date() } });
    await prisma.boqItem.updateMany({ where: { projectId, wbsCode: 'A.1' }, data: { cumulativeCertifiedPct: 100 } });
    await prisma.boqItem.updateMany({ where: { projectId, wbsCode: 'B.1' }, data: { cumulativeCertifiedPct: 50 } });
    let data = await getSites(projectId);
    const byId = (id: string) => data.sites.find((s) => s.id === id)!;
    assert.equal(byId(ids.siteA).progressPct, 25, 'budget-weighted: 1m done of 4m');
    assert.equal(byId(ids.siteA).status, 'BEHIND', 'its unit ended in work phase 1 with a line below 100%');
    assert.equal(byId(ids.siteB).progressPct, 50);
    assert.equal(byId(ids.siteB).status, 'ONGOING');
    assert.equal(byId(ids.siteC).status, 'ONGOING', 'the first work phase has started');

    await prisma.boqItem.updateMany({ where: { projectId, wbsCode: 'A.2' }, data: { cumulativeCertifiedPct: 100 } });
    data = await getSites(projectId);
    assert.equal(byId(ids.siteA).progressPct, 100);
    assert.equal(byId(ids.siteA).status, 'COMPLETED');

    // Rows carry the sites.
    const h = await web();
    const directory = await request(app).get('/api/v1/projects').set(h);
    assert.equal(directory.status, 200, JSON.stringify(directory.body));
    const rows = directory.body.data as Array<{ id: string; codePrefix: string; sites: Array<{ id: string; status: string }> }>;
    assert.deepEqual(rows.find((r) => r.id === projectId)!.sites.map((s) => s.id), [ids.siteA, ids.siteB, ids.siteC]);
    assert.ok(rows.filter((r) => r.id !== projectId).every((r) => Array.isArray(r.sites) && r.sites.length === 0));
    const portfolio = await request(app).get('/api/v1/projects/portfolio/overview').set(h);
    assert.equal(portfolio.status, 200, JSON.stringify(portfolio.body));
    const pRow = (portfolio.body.data.projects as Array<{ id: string; sites: Array<{ status: string; progressPct: number | null }> }>).find((r) => r.id === projectId)!;
    assert.deepEqual(pRow.sites.map((s) => s.status), ['COMPLETED', 'ONGOING', 'ONGOING']);

    // The register export: one sub-row per site under the project, and the number of sites.
    const xlsx = await request(app).get('/api/v1/projects/export.xlsx').set(h).buffer(true).parse(binary as never);
    assert.equal(xlsx.status, 200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xlsx.body as unknown as ArrayBuffer);
    const ws = wb.getWorksheet('Project register')!;
    const headers = (ws.getRow(3).values as unknown[]).slice(1).map((v) => String(v ?? ''));
    const col = (name: string) => headers.indexOf(name);
    assert.ok(col('Number of sites') >= 0, headers.join('|'));
    const sheetRows: string[][] = [];
    for (let r = 4; r <= ws.rowCount; r++) {
      sheetRows.push((ws.getRow(r).values as unknown[]).slice(1).map((v) => (v === null || v === undefined ? '' : String(v))));
    }
    const projectIndex = sheetRows.findIndex((r) => r[col('Project')] === 'Sites test project 3');
    assert.ok(projectIndex >= 0);
    assert.equal(sheetRows[projectIndex][col('Number of sites')], '3');
    const subRows = sheetRows.slice(projectIndex + 1, projectIndex + 4);
    assert.deepEqual(subRows.map((r) => r[col('Code')].trim()), ['Site 1', 'Site 2', 'Site 3']);
    assert.equal(subRows[0][col('School')], `${SITE_A.schoolName} (Primary)`);
    assert.equal(subRows[0][col('LGA')], 'Dala');
    assert.equal(subRows[0][col('Stage')], 'Completed');
    assert.equal(subRows[0][col('% complete')], '100');
    assert.equal(subRows[1][col('% complete')], '50');
    // Totals count projects, not site rows.
    assert.match(sheetRows[sheetRows.length - 1][0], /project/);

    // Handed over once the project is in its defects liability period.
    await prisma.project.update({ where: { id: projectId }, data: { constructionPhase: 'RETENTION_PERIOD' } });
    data = await getSites(projectId);
    assert.ok(data.sites.every((s) => s.status === 'HANDED_OVER'));
  });
});
