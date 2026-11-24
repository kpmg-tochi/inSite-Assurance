/**
 * Redesign R2 route tests: the facility catalogue (R2a), scope and sprints (R2b) and the
 * needs-assessment workbook (R2c).
 *
 * Main tenant: admin@ (platform + tenant super admin), monitor@ (facilities:manage), lender@
 * (no facilities:manage). Programme tenant: programme.admin@ (another tenant, for isolation) and
 * PRG-105 (live, seeded with sprints and units). Workbooks are built in memory.
 */
import { resetTestDatabase } from './helpers/testDb';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import type { Express } from 'express';
import request from 'supertest';
import { DEFAULT_FACILITIES } from '@insite/shared';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;

const PASSWORD = 'Password123!';
const ADMIN = 'admin@insite.ng';
const MONITOR = 'monitor@insite.ng';
const LENDER = 'lender@insite.ng';
const PROGRAMME_ADMIN = 'programme.admin@insite.ng';
const ids: Record<string, string> = {};

const tokens: Record<string, string> = {};
async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { createApp } = await import('../app');
  app = createApp();
  const monitor = await prisma.user.findUniqueOrThrow({ where: { email: MONITOR } });
  ids.tenant = monitor.tenantId;
});

describe('Redesign R2a: facility catalogue', () => {
  it('every seeded tenant has the 50 default facilities', async () => {
    for (const t of await prisma.tenant.findMany({ select: { id: true } })) {
      assert.equal(await prisma.facility.count({ where: { tenantId: t.id } }), DEFAULT_FACILITIES.length);
    }
    const res = await request(app).get('/api/v1/facilities').set(await web(LENDER));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.length, 50);
    assert.equal(res.body.data[0].code, 'CLASSROOM');
  });

  it('a newly provisioned tenant starts with the 50 facilities', async () => {
    const res = await request(app)
      .post('/api/v1/rbac/tenants')
      .set(await web(ADMIN))
      .send({ name: 'R2 Facilities Tenant', slug: 'r2-facilities' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(await prisma.facility.count({ where: { tenantId: res.body.data.id } }), 50);
  });

  it('refuses writes without facilities:manage', async () => {
    const res = await request(app)
      .post('/api/v1/facilities')
      .set(await web(LENDER))
      .send({ code: 'ASSEMBLY_HALL', name: 'Assembly hall', archetype: 'BUILDING_WORKS' });
    assert.equal(res.status, 403);
  });

  it('creates, renames, re-archetypes, retires and restores with audit events', async () => {
    const created = await request(app)
      .post('/api/v1/facilities')
      .set(await web(MONITOR))
      .send({ code: 'assembly_hall', name: 'Assembly hall', archetype: 'BUILDING_WORKS', category: 'Buildings' });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.code, 'ASSEMBLY_HALL');
    ids.hall = created.body.data.id;

    const dup = await request(app)
      .post('/api/v1/facilities')
      .set(await web(MONITOR))
      .send({ code: 'ASSEMBLY_HALL', name: 'Again', archetype: 'BUILDING_WORKS' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error?.code ?? dup.body.code, 'FACILITY_CODE_EXISTS');

    const renamed = await request(app)
      .patch(`/api/v1/facilities/${ids.hall}`)
      .set(await web(MONITOR))
      .send({ name: 'Multi-purpose hall', archetype: 'EXTERNAL_WORKS', code: 'MP_HALL' });
    assert.equal(renamed.status, 200, JSON.stringify(renamed.body));
    assert.equal(renamed.body.data.code, 'MP_HALL'); // unused: the code may still change
    assert.equal(renamed.body.data.archetype, 'EXTERNAL_WORKS');

    const retired = await request(app).patch(`/api/v1/facilities/${ids.hall}`).set(await web(MONITOR)).send({ isRetired: true });
    assert.equal(retired.status, 200);
    assert.equal(retired.body.data.isRetired, true);
    const active = await request(app).get('/api/v1/facilities').set(await web(MONITOR));
    assert.equal(active.body.data.some((f: { id: string }) => f.id === ids.hall), false);
    const all = await request(app).get('/api/v1/facilities?includeRetired=true').set(await web(MONITOR));
    assert.equal(all.body.data.some((f: { id: string }) => f.id === ids.hall), true);

    const restored = await request(app).patch(`/api/v1/facilities/${ids.hall}`).set(await web(MONITOR)).send({ isRetired: false });
    assert.equal(restored.body.data.isRetired, false);

    const events = await prisma.auditLog.findMany({ where: { tenantId: ids.tenant, action: 'FACILITY_SAVED' }, orderBy: { seq: 'asc' } });
    assert.equal(events.length, 4);
    assert.match(events[2].summaryText, /^Retired/);
    assert.match(events[3].summaryText, /^Restored/);
  });

  it('keeps tenants apart', async () => {
    const res = await request(app).patch(`/api/v1/facilities/${ids.hall}`).set(await web(PROGRAMME_ADMIN)).send({ name: 'Hijack' });
    assert.equal(res.status, 404);
    const list = await request(app).get('/api/v1/facilities?includeRetired=true').set(await web(PROGRAMME_ADMIN));
    assert.equal(list.status, 200);
    assert.equal(list.body.data.some((f: { id: string }) => f.id === ids.hall), false);
  });
});

// ---------------------------------------------------------------------------
// R2b: units, sprints and scope lines
// ---------------------------------------------------------------------------

const scopeUrl = (projectId: string, path = '') => `/api/v1/projects/${projectId}/scope${path}`;

async function facilityId(code: string, tenantId = ids.tenant) {
  return (await prisma.facility.findUniqueOrThrow({ where: { tenantId_code: { tenantId, code } } })).id;
}

async function setupIssues(projectId: string) {
  const res = await request(app).get(`/api/v1/projects/${projectId}/setup`).set(await web(MONITOR));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const step = res.body.data.steps.find((s: { stepId: string }) => s.stepId === 'scope');
  return { step, codes: step.issues.map((i: { code: string }) => i.code) as string[], body: res.body.data };
}

const issueCode = (body: { error: { details?: { issues?: Array<{ code: string }> }; issues?: Array<{ code: string }> } }) =>
  (body.error.issues ?? body.error.details?.issues ?? [])[0]?.code;

describe('Redesign R2b: scope and sprints on a draft', () => {
  it('a new draft has a "Scope & sprints" step that needs sprints and lines', async () => {
    const res = await request(app).post('/api/v1/projects').set(await web(MONITOR)).send({
      name: 'R2 scope draft',
      codePrefix: 'RTS-201',
      stateLocation: 'Lagos State',
      totalBudgetNgn: 10_000_000,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    ids.draft = res.body.data.projectId;
    assert.ok(!res.body.data.steps.some((s: { stepId: string }) => s.stepId === 'boq'));
    const { codes } = await setupIssues(ids.draft);
    assert.ok(codes.includes('SPRINT_REQUIRED'), codes.join());
    assert.ok(codes.includes('SCOPE_REQUIRED'), codes.join());
    const scope = await request(app).get(scopeUrl(ids.draft)).set(await web(MONITOR));
    assert.equal(scope.status, 200);
    assert.equal(scope.body.data.importAllowed, true);
    assert.equal(scope.body.data.totals.lineCount, 0);
  });

  it('refuses overlapping sprints and numbers the rest by date', async () => {
    const overlap = await request(app)
      .put(scopeUrl(ids.draft, '/sprints'))
      .set(await web(MONITOR))
      .send({
        sprints: [
          { name: 'A', startDate: '2027-01-01', endDate: '2027-01-31' },
          { name: 'B', startDate: '2027-01-31', endDate: '2027-02-28' },
        ],
      });
    assert.equal(overlap.status, 422);
    assert.equal(overlap.body.error.code, 'SPRINTS_INVALID');
    assert.equal(issueCode(overlap.body), 'SPRINT_OVERLAP');

    const ok = await request(app)
      .put(scopeUrl(ids.draft, '/sprints'))
      .set(await web(MONITOR))
      .send({
        sprints: [
          { name: 'Superstructure', startDate: '2027-03-01', endDate: '2027-04-30', deliverables: 'Frame and roof' },
          { name: 'Substructure', startDate: '2027-01-04', endDate: '2027-02-26' },
        ],
      });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const sprints = ok.body.data.sprints;
    assert.deepEqual(
      sprints.map((s: { number: number; name: string }) => `${s.number}:${s.name}`),
      ['1:Substructure', '2:Superstructure']
    );
    assert.equal(sprints[0].status, 'UPCOMING');
    ids.sprint1 = sprints[0].id;
    ids.sprint2 = sprints[1].id;
    assert.ok(await prisma.auditLog.findFirst({ where: { projectId: ids.draft, action: 'SPRINTS_SAVED' } }));
  });

  it('validates units: retired facility, supply quantity, sprint order, other tenants', async () => {
    await request(app).patch(`/api/v1/facilities/${ids.hall}`).set(await web(MONITOR)).send({ isRetired: true });
    const refused = await request(app).post(scopeUrl(ids.draft, '/units')).set(await web(MONITOR)).send({ facilityId: ids.hall, label: 'Hall' });
    assert.equal(refused.status, 409);
    assert.equal(refused.body.error.code, 'FACILITY_RETIRED');

    const noQty = await request(app)
      .post(scopeUrl(ids.draft, '/units'))
      .set(await web(MONITOR))
      .send({ facilityId: await facilityId('PUPILS_FURNITURE'), label: 'Desks' });
    assert.equal(noQty.status, 422);
    assert.equal(noQty.body.error.code, 'UNIT_QUANTITY_REQUIRED');

    const backwards = await request(app)
      .post(scopeUrl(ids.draft, '/units'))
      .set(await web(MONITOR))
      .send({ facilityId: await facilityId('TOILET'), label: 'Male toilet', startSprintId: ids.sprint2, endSprintId: ids.sprint1 });
    assert.equal(backwards.status, 422);
    assert.equal(backwards.body.error.code, 'UNIT_SPRINT_ORDER');

    const programmeTenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
    const foreign = await request(app)
      .post(scopeUrl(ids.draft, '/units'))
      .set(await web(MONITOR))
      .send({ facilityId: await facilityId('TOILET', programmeTenant.id), label: 'Foreign toilet' });
    assert.equal(foreign.status, 404);
  });

  it('adds units and lines; the server computes amounts and line dates', async () => {
    const toilet = await request(app)
      .post(scopeUrl(ids.draft, '/units'))
      .set(await web(MONITOR))
      .send({ facilityId: await facilityId('TOILET'), label: 'Ground floor male toilet', startSprintId: ids.sprint1, endSprintId: ids.sprint2 });
    assert.equal(toilet.status, 201, JSON.stringify(toilet.body));
    const unit = toilet.body.data.units[0];
    assert.equal(unit.code, 'U01');
    ids.unit = unit.id;
    const desks = await request(app)
      .post(scopeUrl(ids.draft, '/units'))
      .set(await web(MONITOR))
      .send({ facilityId: await facilityId('PUPILS_FURNITURE'), label: "Pupils' desks", plannedQuantity: 120 });
    assert.equal(desks.status, 201, JSON.stringify(desks.body));
    const desk = desks.body.data.units.find((u: { code: string }) => u.code === 'U02');
    assert.equal(desk.plannedQuantity, 120);
    assert.equal(desk.quantityUnit, 'nr');
    ids.deskUnit = desk.id;

    const badUom = await request(app)
      .post(scopeUrl(ids.draft, '/lines'))
      .set(await web(MONITOR))
      .send({ facilityUnitId: ids.unit, wbsCode: '1.1', description: 'Blockwork', unit: 'bags', totalQuantity: 10, rateNgn: 5 });
    assert.equal(badUom.status, 400);

    const line = await request(app)
      .post(scopeUrl(ids.draft, '/lines'))
      .set(await web(MONITOR))
      .send({ facilityUnitId: ids.unit, wbsCode: '1.1', description: 'Blockwork 225 mm', unit: 'm2', totalQuantity: 120.5, rateNgn: 8_000 });
    assert.equal(line.status, 201, JSON.stringify(line.body));
    const l = line.body.data.lines[0];
    assert.equal(l.budgetedCostNgn, 964_000);
    assert.equal(l.section, 'Toilet');
    assert.equal(l.plannedStartDate, '2027-01-04');
    assert.equal(l.plannedEndDate, '2027-04-30');
    ids.line = l.id;

    const dup = await request(app)
      .post(scopeUrl(ids.draft, '/lines'))
      .set(await web(MONITOR))
      .send({ facilityUnitId: ids.unit, wbsCode: '1.1', description: 'Again', unit: 'm2', totalQuantity: 1, rateNgn: 1 });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'DUPLICATE_WBS_CODE');

    const patched = await request(app).patch(scopeUrl(ids.draft, `/lines/${ids.line}`)).set(await web(MONITOR)).send({ rateNgn: 10_000 });
    assert.equal(patched.status, 200);
    assert.equal(patched.body.data.lines[0].budgetedCostNgn, 1_205_000);
    const updates = await prisma.auditLog.count({ where: { projectId: ids.draft, action: 'SCOPE_UPDATED' } });
    assert.equal(updates, 4, 'two units, one line, one line change');
  });

  it('a used facility keeps its code', async () => {
    const res = await request(app).patch(`/api/v1/facilities/${await facilityId('TOILET')}`).set(await web(MONITOR)).send({ code: 'WC' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'FACILITY_CODE_LOCKED');
  });

  it('moving a sprint re-derives line dates', async () => {
    const res = await request(app)
      .put(scopeUrl(ids.draft, '/sprints'))
      .set(await web(MONITOR))
      .send({
        sprints: [
          { id: ids.sprint1, name: 'Substructure', startDate: '2027-01-11', endDate: '2027-02-26' },
          { id: ids.sprint2, name: 'Superstructure', startDate: '2027-03-01', endDate: '2027-05-14' },
        ],
      });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const line = await prisma.boqItem.findUniqueOrThrow({ where: { id: ids.line } });
    assert.equal(line.plannedStartDate, '2027-01-11');
    assert.equal(line.plannedEndDate, '2027-05-14');
  });

  it('reports activation issues until every unit has sprints, then the step is complete', async () => {
    const before = await setupIssues(ids.draft);
    assert.ok(before.codes.includes('UNIT_SPRINTS_REQUIRED'), before.codes.join());
    assert.ok(!before.codes.includes('SPRINT_REQUIRED'));
    assert.ok(!before.codes.includes('SCOPE_REQUIRED'));
    const fixed = await request(app)
      .patch(scopeUrl(ids.draft, `/units/${ids.deskUnit}`))
      .set(await web(MONITOR))
      .send({ startSprintId: ids.sprint2, endSprintId: ids.sprint2 });
    assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
    const after = await setupIssues(ids.draft);
    assert.deepEqual(after.codes, []);
    assert.equal(after.step.saved, true, 'scope writes mark the step saved');
    assert.equal(after.body.scope.lineCount, 1);
    assert.equal(after.body.scope.unitCount, 2);
  });

  it('removing a draft sprint clears it from units', async () => {
    const res = await request(app)
      .put(scopeUrl(ids.draft, '/sprints'))
      .set(await web(MONITOR))
      .send({ sprints: [{ id: ids.sprint1, name: 'Substructure', startDate: '2027-01-11', endDate: '2027-02-26' }] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const desk = res.body.data.units.find((u: { id: string }) => u.id === ids.deskUnit);
    assert.equal(desk.startSprintId, null);
    const { codes } = await setupIssues(ids.draft);
    assert.ok(codes.includes('UNIT_SPRINTS_REQUIRED'));
  });
});

describe('Redesign R2b: scope on a live project (PRG-105)', () => {
  let liveSprints: Array<{ id: string; name: string; startDate: string; endDate: string }> = [];
  before(async () => {
    ids.live = (await prisma.project.findFirstOrThrow({ where: { codePrefix: 'PRG-105' } })).id;
  });

  it('the seeded scope has sprints, units and lines on units', async () => {
    const res = await request(app).get(scopeUrl(ids.live)).set(await web(PROGRAMME_ADMIN));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const d = res.body.data;
    assert.equal(d.sprints.length, 3);
    assert.deepEqual(d.sprints.map((s: { status: string }) => s.status), ['ENDED', 'ENDED', 'ACTIVE']);
    assert.equal(d.units.length, 2);
    assert.equal(d.totals.unassignedLineCount, 0);
    assert.equal(d.importAllowed, false);
    ids.liveUnit = d.units[0].id;
    ids.liveLine = d.lines.find((l: { wbsCode: string }) => l.wbsCode === '01.01').id;
    liveSprints = d.sprints.map((s: { id: string; name: string; startDate: string; endDate: string }) => ({
      id: s.id,
      name: s.name,
      startDate: s.startDate,
      endDate: s.endDate,
    }));
  });

  it('refuses to remove a unit or line with evidence, or a sprint a unit uses', async () => {
    const line = await request(app).delete(scopeUrl(ids.live, `/lines/${ids.liveLine}`)).set(await web(PROGRAMME_ADMIN));
    assert.equal(line.status, 409);
    assert.equal(line.body.error.code, 'LINE_HAS_EVIDENCE');
    const unit = await request(app).delete(scopeUrl(ids.live, `/units/${ids.liveUnit}`)).set(await web(PROGRAMME_ADMIN));
    assert.equal(unit.status, 409);
    assert.equal(unit.body.error.code, 'UNIT_HAS_EVIDENCE');
    const dropped = await request(app).put(scopeUrl(ids.live, '/sprints')).set(await web(PROGRAMME_ADMIN)).send({ sprints: liveSprints.slice(1) });
    assert.equal(dropped.status, 409);
    assert.equal(dropped.body.error.code, 'SPRINT_IN_USE');
    const below = await request(app).patch(scopeUrl(ids.live, `/lines/${ids.liveLine}`)).set(await web(PROGRAMME_ADMIN)).send({ totalQuantity: 1 });
    assert.equal(below.status, 409);
    assert.equal(below.body.error.code, 'BOQ_BELOW_CERTIFIED');
  });

  it('moves a sprint on a live project, audited, and the lines follow', async () => {
    const moved = { ...liveSprints[2], endDate: '2099-12-31' };
    const res = await request(app)
      .put(scopeUrl(ids.live, '/sprints'))
      .set(await web(PROGRAMME_ADMIN))
      .send({ sprints: [liveSprints[0], liveSprints[1], moved] });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const line = await prisma.boqItem.findFirstOrThrow({ where: { projectId: ids.live, wbsCode: '03.02' } });
    assert.equal(line.plannedEndDate, '2099-12-31');
    const audit = await prisma.auditLog.findFirst({ where: { projectId: ids.live, action: 'SPRINTS_SAVED' }, orderBy: { seq: 'desc' } });
    assert.ok(audit);
    assert.match(audit.summaryText, /1 changed/);
    const changed = (audit.payload as { changed: Array<{ after: { endDate?: string } }> }).changed;
    assert.equal(changed[0].after.endDate, '2099-12-31');
  });

  it('refuses writes without boq:upload_edit', async () => {
    const res = await request(app)
      .post(scopeUrl(ids.live, '/lines'))
      .set(await web('programme.funder@insite.ng'))
      .send({ facilityUnitId: ids.liveUnit, wbsCode: '9.9', description: 'Not allowed', unit: 'nr', totalQuantity: 1, rateNgn: 1 });
    assert.ok([403, 404].includes(res.status), String(res.status));
  });
});

// ---------------------------------------------------------------------------
// R2c: the needs-assessment workbook
// ---------------------------------------------------------------------------

async function downloadWorkbook(projectId: string, email = MONITOR): Promise<ExcelJS.Workbook> {
  const res = await request(app)
    .get(scopeUrl(projectId, '/workbook'))
    .set(await web(email))
    .buffer(true)
    .parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    });
  assert.equal(res.status, 200, String(res.body));
  assert.match(String(res.headers['content-type']), /spreadsheetml/);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(res.body as ArrayBuffer);
  return wb;
}

async function toBase64(wb: ExcelJS.Workbook) {
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer).toString('base64');
}

const sha = (b64: string) => crypto.createHash('sha256').update(Buffer.from(b64, 'base64')).digest('hex');

/** Fills a downloaded (blank) workbook: two sprints, three units, four lines and the Project sheet. */
function fill(wb: ExcelJS.Workbook, opts: { lines?: Array<unknown[]>; projectName?: string } = {}) {
  const project = wb.getWorksheet('Project')!;
  const setProject = (label: string, value: string | number) => {
    project.eachRow((row) => {
      if (row.getCell(1).value === label) row.getCell(2).value = value;
    });
  };
  setProject('Project name', opts.projectName ?? 'A different name');
  setProject('School', 'Government Girls Secondary School');
  setProject('LGA', 'Ikeja');
  setProject('Site address', '12 School Road, Ikeja');
  setProject('Latitude', 6.6018);
  setProject('Longitude', 3.3515);
  setProject('Budget (NGN)', 999);
  setProject('Strategic justification', 'Overcrowded classrooms; no toilets.');
  setProject('Assumptions', 'Site is free of encumbrances.');
  const sprints = wb.getWorksheet('Sprints')!;
  sprints.getRow(2).values = [1, 'Substructure', new Date(Date.UTC(2027, 0, 4)), new Date(Date.UTC(2027, 1, 26)), 'Foundations'];
  sprints.getRow(3).values = [2, 'Superstructure', '2027-03-01', '30/04/2027', 'Frame and roof'];
  const units = wb.getWorksheet('Facility units')!;
  units.getRow(2).values = ['U01', 'Classroom', 'Block A classroom 1', null, null, 1, 2];
  units.getRow(3).values = ['U02', 'Toilet', 'Ground floor male toilet', null, null, 2, 2];
  units.getRow(4).values = ['U03', "Pupils' furniture", 'Desks and chairs', 120, 'nr', 2, 2];
  const boq = wb.getWorksheet('BoQ')!;
  const lines = opts.lines ?? [
    ['1.1', 'U01', 'Foundations in reinforced concrete', 'm3', 40, 150_000, 1], // the Amount cell is ignored
    ['1.2', 'U01', 'Blockwork 225 mm', 'm2', 300, 9_000],
    ['2.1', 'U02', 'Sanitary fittings', 'nr', 6, 85_000],
    ['3.1', 'U03', 'Supply of desks and chairs', 'set', 120, 45_000],
  ];
  lines.forEach((l, i) => (boq.getRow(i + 2).values = l as ExcelJS.CellValue[]));
}

describe('Redesign R2c: needs-assessment workbook', () => {
  before(async () => {
    const res = await request(app).post('/api/v1/projects').set(await web(MONITOR)).send({
      name: 'R2 workbook draft',
      codePrefix: 'RTS-202',
      stateLocation: 'Lagos State',
      totalBudgetNgn: 20_000_000,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    ids.wbDraft = res.body.data.projectId;
  });

  it('downloads a blank workbook with the tenant facilities in the list', async () => {
    const wb = await downloadWorkbook(ids.wbDraft);
    assert.equal(wb.getWorksheet('Instructions')!.getCell('B3').value, 'INSITE-SCOPE-v1');
    const lists = wb.getWorksheet('Lists')!;
    const names: string[] = [];
    lists.getColumn(1).eachCell((c, row) => {
      if (row > 1) names.push(String(c.value));
    });
    assert.ok(names.includes('Classroom'));
    assert.ok(!names.includes('Multi-purpose hall'), 'the retired hall is not offered');
  });

  it('previews without writing: grouped lines, recomputed amounts, project-sheet fill plan', async () => {
    const wb = await downloadWorkbook(ids.wbDraft);
    fill(wb);
    ids.wbFile = await toBase64(wb);
    const res = await request(app)
      .post(scopeUrl(ids.wbDraft, '/import/preview'))
      .set(await web(MONITOR))
      .send({ fileBase64: ids.wbFile, fileName: 'filled.xlsx' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const p = res.body.data;
    assert.deepEqual(p.issues, []);
    assert.equal(p.canConfirm, true);
    assert.equal(p.sha256, sha(ids.wbFile));
    assert.deepEqual([p.totals.sprintCount, p.totals.unitCount, p.totals.lineCount], [2, 3, 4]);
    assert.equal(p.lines[0].amountNgn, 6_000_000, 'quantity × rate, not the sheet value');
    assert.equal(p.totals.amountNgn, 6_000_000 + 2_700_000 + 510_000 + 5_400_000);
    assert.deepEqual(
      p.groups.map((g: { facilityCode: string; sprintLabel: string }) => `${g.facilityCode}:${g.sprintLabel}`),
      ['CLASSROOM:Sprints 1–2', 'TOILET:Sprint 2', 'PUPILS_FURNITURE:Sprint 2']
    );
    const action = Object.fromEntries(p.projectChanges.map((c: { field: string; action: string }) => [c.field, c.action]));
    assert.equal(action.name, 'KEEP');
    assert.equal(action.totalBudgetNgn, 'KEEP');
    assert.equal(action.lgaLocation, 'FILL');
    assert.equal(action.siteAddress, 'FILL');
    assert.equal(action.school, 'FILL');
    assert.equal(action.geofence, 'FILL');
    assert.ok(p.warnings.some((w: { code: string }) => w.code === 'PROJECT_FIELD_DIFFERS'));
    assert.ok(p.warnings.some((w: { code: string }) => w.code === 'AMOUNT_RECOMPUTED'));
    assert.equal(await prisma.boqItem.count({ where: { projectId: ids.wbDraft } }), 0, 'preview writes nothing');
    assert.equal(await prisma.projectSprint.count({ where: { projectId: ids.wbDraft } }), 0);
  });

  it('warns when the BoQ total is above the budget', async () => {
    const wb = await downloadWorkbook(ids.wbDraft);
    fill(wb, { lines: [['1.1', 'U01', 'Very expensive foundations', 'm3', 1000, 150_000]] });
    const res = await request(app)
      .post(scopeUrl(ids.wbDraft, '/import/preview'))
      .set(await web(MONITOR))
      .send({ fileBase64: await toBase64(wb) });
    assert.equal(res.status, 200);
    assert.ok(res.body.data.warnings.some((w: { code: string }) => w.code === 'BUDGET_EXCEEDED'));
    assert.equal(res.body.data.canConfirm, true, 'a warning does not block');
  });

  it('refuses a confirm with a different file (409) or with errors (422)', async () => {
    const other = await downloadWorkbook(ids.wbDraft);
    fill(other, { projectName: 'Changed after preview' });
    const changed = await request(app)
      .post(scopeUrl(ids.wbDraft, '/import/confirm'))
      .set(await web(MONITOR))
      .send({ fileBase64: await toBase64(other), sha256: sha(ids.wbFile) });
    assert.equal(changed.status, 409);
    assert.equal(changed.body.error.code, 'SCOPE_IMPORT_FILE_CHANGED');

    const bad = await downloadWorkbook(ids.wbDraft);
    fill(bad, { lines: [['1.1', 'U77', 'Foundations', 'm3', 40, 150_000]] });
    const b64 = await toBase64(bad);
    const invalid = await request(app)
      .post(scopeUrl(ids.wbDraft, '/import/confirm'))
      .set(await web(MONITOR))
      .send({ fileBase64: b64, sha256: sha(b64) });
    assert.equal(invalid.status, 422);
    assert.equal(invalid.body.error.code, 'SCOPE_IMPORT_INVALID');
    assert.equal(issueCode(invalid.body), 'UNKNOWN_UNIT_ID');
    assert.equal(await prisma.boqItem.count({ where: { projectId: ids.wbDraft } }), 0);
  });

  it('confirms: writes sprints, units and lines, fills only empty project fields, audits', async () => {
    // The GPS boundary takes the workspace default radius.
    const radius = await request(app).put('/api/v1/rbac/tenant/settings').set(await web(ADMIN)).send({ defaultGeofenceRadiusMeters: 200 });
    assert.equal(radius.status, 200, JSON.stringify(radius.body));
    const res = await request(app)
      .post(scopeUrl(ids.wbDraft, '/import/confirm'))
      .set(await web(MONITOR))
      .send({ fileBase64: ids.wbFile, fileName: 'filled.xlsx', sha256: sha(ids.wbFile) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const scope = res.body.data.scope;
    assert.deepEqual([scope.totals.sprintCount, scope.totals.unitCount, scope.totals.lineCount], [2, 3, 4]);
    const line = scope.lines.find((l: { wbsCode: string }) => l.wbsCode === '1.1');
    assert.equal(line.budgetedCostNgn, 6_000_000);
    assert.equal(line.plannedStartDate, '2027-01-04');
    assert.equal(line.plannedEndDate, '2027-04-30');
    assert.equal(line.section, 'Classroom');
    const desks = scope.units.find((u: { code: string }) => u.code === 'U03');
    assert.equal(desks.plannedQuantity, 120);

    const project = await prisma.project.findUniqueOrThrow({ where: { id: ids.wbDraft }, include: { beneficiaries: true } });
    assert.equal(project.name, 'R2 workbook draft', 'a set name is kept');
    assert.equal(Number(project.totalBudgetNgn), 20_000_000, 'a set budget is kept');
    assert.equal(project.lgaLocation, 'Ikeja');
    assert.equal(project.siteAddress, '12 School Road, Ikeja');
    assert.equal(project.strategicJustification, 'Overcrowded classrooms; no toilets.');
    assert.equal(project.geofenceMode, 'RADIAL');
    assert.equal((project.geofenceGeoJson as { radiusMeters: number }).radiusMeters, 200);
    assert.deepEqual(
      project.beneficiaries.map((b) => [b.name, b.isPrimary, b.beneficiaryType]),
      [['Government Girls Secondary School', true, 'SCHOOL']]
    );
    assert.ok(res.body.data.filledProjectFields.includes('geofence'));

    const audit = await prisma.auditLog.findFirstOrThrow({ where: { projectId: ids.wbDraft, action: 'SCOPE_IMPORTED' } });
    assert.match(audit.summaryText, /2 sprint\(s\), 3 facility unit\(s\), 4 BoQ line\(s\)/);
    assert.equal((audit.payload as { sha256: string }).sha256, sha(ids.wbFile));
    const { codes } = await setupIssues(ids.wbDraft);
    assert.deepEqual(codes, [], 'the scope step is complete after the import');
  });

  it('round-trips the draft and a re-import replaces its scope', async () => {
    const wb = await downloadWorkbook(ids.wbDraft);
    const units: string[] = [];
    wb.getWorksheet('Facility units')!.getColumn(1).eachCell((c, row) => {
      if (row > 1) units.push(String(c.value));
    });
    assert.deepEqual(units, ['U01', 'U02', 'U03']);
    const boq = wb.getWorksheet('BoQ')!;
    for (const r of [3, 4, 5]) {
      for (const c of ['A', 'B', 'C', 'D', 'E', 'F']) boq.getCell(`${c}${r}`).value = null;
    }
    const b64 = await toBase64(wb);
    const preview = await request(app).post(scopeUrl(ids.wbDraft, '/import/preview')).set(await web(MONITOR)).send({ fileBase64: b64 });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.deepEqual(preview.body.data.issues, []);
    assert.deepEqual(preview.body.data.replaces, { sprintCount: 2, unitCount: 3, lineCount: 4 });
    const res = await request(app)
      .post(scopeUrl(ids.wbDraft, '/import/confirm'))
      .set(await web(MONITOR))
      .send({ fileBase64: b64, sha256: sha(b64) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.scope.totals.lineCount, 1);
    assert.equal(res.body.data.scope.totals.unitCount, 3);
    assert.deepEqual(res.body.data.filledProjectFields, [], 'everything was filled the first time');
  });

  it('a blank workspace workbook (Settings) downloads for any web user and imports into a draft', async () => {
    const res = await request(app)
      .get('/api/v1/scope-workbook')
      .set(await web(LENDER))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    assert.equal(res.status, 200);
    assert.match(String(res.headers['content-disposition']), /needs-assessment-workbook\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as ArrayBuffer);
    assert.equal(wb.getWorksheet('Instructions')!.getCell('B5').value, '(blank workbook)');
    assert.equal(wb.getWorksheet('BoQ')!.getCell('A2').value, null, 'nothing pre-filled');
    fill(wb);
    const preview = await request(app)
      .post(scopeUrl(ids.wbDraft, '/import/preview'))
      .set(await web(MONITOR))
      .send({ fileBase64: await toBase64(wb) });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.deepEqual(preview.body.data.issues, []);
    assert.equal((await request(app).get('/api/v1/scope-workbook')).status, 401);
  });

  it('refuses import on a live project; its workbook downloads pre-filled', async () => {
    const wb = await downloadWorkbook(ids.live, PROGRAMME_ADMIN);
    const units: string[] = [];
    wb.getWorksheet('Facility units')!.getColumn(1).eachCell((c, row) => {
      if (row > 1) units.push(String(c.value));
    });
    assert.deepEqual(units, ['U01', 'U02']);
    const b64 = await toBase64(wb);
    const preview = await request(app).post(scopeUrl(ids.live, '/import/preview')).set(await web(PROGRAMME_ADMIN)).send({ fileBase64: b64 });
    assert.equal(preview.status, 409);
    assert.equal(preview.body.error.code, 'SCOPE_IMPORT_LIVE_PROJECT');
    const confirm = await request(app)
      .post(scopeUrl(ids.live, '/import/confirm'))
      .set(await web(PROGRAMME_ADMIN))
      .send({ fileBase64: b64, sha256: sha(b64) });
    assert.equal(confirm.status, 409);
    assert.equal(confirm.body.error.code, 'SCOPE_IMPORT_LIVE_PROJECT');
  });
});
