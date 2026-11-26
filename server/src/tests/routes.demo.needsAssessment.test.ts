/**
 * Client demo updates, wave 2 (D1, C2, C3): needs assessment first, on the seeded UBEC tenant.
 * - POST /api/v1/projects/from-needs-assessment/preview reads the demo needs assessment (fields with
 *   their source, sites, scope, the LOT/BATCH code preview); a file that is not the template is
 *   422 NOT_NEEDS_ASSESSMENT_TEMPLATE.
 * - /confirm creates the draft (type, lot/batch code, State), its sites, work phases, units linked to
 *   their sites and BoQ in one transaction; the setup DTO carries `needsAssessmentImport`. A changed
 *   file (409), missing required input (422) and a second draft in the same lot (next batch).
 * - An older file (no Sites sheet, no State or Lot title rows) still imports into a draft.
 */
import { resetTestDatabase } from './helpers/testDb';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import ExcelJS from 'exceljs';
import request from 'supertest';
import { allowedInterventionYears, zonedCalendarDate } from '@insite/shared';
import { DEMO_LINES, DEMO_PROJECT, DEMO_SITES, DEMO_UNITS, demoWorkbookData } from '../scripts/demoProject';

type PrismaClientType = typeof import('../config/prisma')['prisma'];
type WorkbookModule = typeof import('../modules/scope/workbook/scopeWorkbook');

let app: Express;
let prisma: PrismaClientType;
let workbook: WorkbookModule;

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

const BASE = '/api/v1/projects/from-needs-assessment';
const FILE_NAME = 'Dawakin Tofa needs assessment.xlsx';

async function demoFile(edit?: (wb: ExcelJS.Workbook) => void, data = demoWorkbookData(today)): Promise<string> {
  const buffer = await workbook.buildScopeWorkbook(data);
  if (!edit) return buffer.toString('base64');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  edit(wb);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer).toString('base64');
}

/** A file laid out before wave 2: no Sites sheet, no Site no. column, no State or Lot title rows. */
function asOlderFile(wb: ExcelJS.Workbook) {
  wb.removeWorksheet(wb.getWorksheet('Sites')!.id);
  const units = wb.getWorksheet('Facility units')!;
  units.eachRow((row) => (row.getCell(8).value = null));
  wb.getWorksheet('Project')!.eachRow((row) => {
    if (['State', 'Lot title'].includes(String(row.getCell(1).value))) row.getCell(1).value = null;
  });
}

async function preview(fileBase64: string) {
  return request(app).post(`${BASE}/preview`).set(await web()).send({ fileBase64, fileName: FILE_NAME });
}

type Field = { key: string; value: unknown; display: string | null; source: string | null; needsInput: boolean };
const field = (fields: Field[], key: string) => fields.find((f) => f.key === key)!;

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  workbook = await import('../modules/scope/workbook/scopeWorkbook');
  const { createApp } = await import('../app');
  app = createApp();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
  ids.tenant = tenant.id;
  ids.central = (await prisma.projectType.findFirstOrThrow({ where: { tenantId: tenant.id, code: 'CENTRAL' } })).id;
});

describe('Client demo updates (wave 2): needs assessment first', () => {
  it('previews the demo needs assessment: fields from the template, sites, scope and the code', async () => {
    const res = await preview(await demoFile());
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const p = res.body.data;
    assert.deepEqual(p.issues, []);
    assert.equal(p.canConfirm, true);
    assert.deepEqual(p.needsInput, []);
    const fields = p.fields as Field[];
    assert.equal(field(fields, 'name').value, DEMO_PROJECT.name);
    assert.equal(field(fields, 'name').source, 'TEMPLATE');
    assert.equal(field(fields, 'projectTypeId').value, ids.central);
    assert.equal(field(fields, 'projectTypeId').display, 'Direct Intervention');
    assert.equal(field(fields, 'interventionYear').value, Y0);
    assert.equal(field(fields, 'stateCode').value, 'KN');
    assert.equal(field(fields, 'lgaCode').value, 'KN-DAWAKIN-TOFA');
    assert.equal(field(fields, 'fundingSourceCode').value, 'DIRECT_INTERVENTION');
    assert.equal(field(fields, 'totalBudgetNgn').value, DEMO_PROJECT.budgetNgn);
    assert.equal(field(fields, 'lot').value, DEMO_PROJECT.lotTitle);
    assert.match(String(field(fields, 'lot').display), /^LOT 1: .*\(new lot\)$/);
    assert.equal(p.codePreview, 'LOT 1 BATCH 1');
    assert.deepEqual(
      (p.sites as Array<{ siteNumber: number; lgaName: string; unitCount: number }>).map((s) => [s.siteNumber, s.lgaName, s.unitCount]),
      [
        [1, 'Dawakin Tofa', 1],
        [2, 'Dawakin Tofa', 1],
        [3, 'Tofa', 1],
      ]
    );
    assert.equal(p.scope.totals.unitCount, DEMO_UNITS.length);
    assert.equal(p.scope.totals.lineCount, DEMO_LINES.length);
    assert.equal(p.scope.totals.amountNgn, 44_275_000);
    assert.equal(await prisma.project.count({ where: { tenantId: ids.tenant, name: DEMO_PROJECT.name } }), 0, 'preview writes nothing');
  });

  it('refuses a file that is not the needs assessment template', async () => {
    const csv = await preview(Buffer.from('Project,Budget\nSchool,100\n').toString('base64'));
    assert.equal(csv.status, 422);
    assert.equal(csv.body.error.code, 'NOT_NEEDS_ASSESSMENT_TEMPLATE');
    assert.equal(csv.body.error.message, 'This file is not the UBEC needs assessment template: download the template, or start without one');
    const other = new ExcelJS.Workbook();
    other.addWorksheet('Sheet1').getCell('A1').value = 'Needs assessment';
    const xlsx = await preview(Buffer.from((await other.xlsx.writeBuffer()) as ArrayBuffer).toString('base64'));
    assert.equal(xlsx.status, 422);
    assert.equal(xlsx.body.error.code, 'NOT_NEEDS_ASSESSMENT_TEMPLATE');
  });

  it('refuses a file changed since the preview and missing required input', async () => {
    const file = await demoFile();
    const p = (await preview(file)).body.data;
    const changed = await request(app).post(`${BASE}/confirm`).set(await web()).send({ fileBase64: await demoFile((wb) => (wb.getWorksheet('Project')!.getCell('B4').value = 'Another name')), fileName: FILE_NAME, sha256: p.sha256 });
    assert.equal(changed.status, 409);
    assert.equal(changed.body.error.code, 'NEEDS_ASSESSMENT_FILE_CHANGED');

    const data = demoWorkbookData(today);
    const bare = await demoFile(undefined, { ...data, project: { ...data.project, interventionYear: null, lotTitle: null, deliveryModel: null } });
    const bp = (await preview(bare)).body.data;
    assert.deepEqual([...bp.needsInput].sort(), ['interventionYear', 'lot', 'projectTypeId']);
    assert.equal(bp.codePreview, null);
    const refused = await request(app).post(`${BASE}/confirm`).set(await web()).send({ fileBase64: bare, fileName: FILE_NAME, sha256: bp.sha256 });
    assert.equal(refused.status, 422, JSON.stringify(refused.body));
    assert.equal(refused.body.error.code, 'NEEDS_ASSESSMENT_INPUT_REQUIRED');
    assert.deepEqual([...refused.body.error.details.missing].sort(), ['interventionYear', 'lot', 'projectTypeId']);

    // The person gives them: the next year and a new lot.
    const given = await request(app)
      .post(`${BASE}/confirm`)
      .set(await web())
      .send({ fileBase64: bare, fileName: FILE_NAME, sha256: bp.sha256, overrides: { projectTypeId: ids.central, interventionYear: Y1, lotChoice: { newLotTitle: 'Construction of Classroom Blocks' } } });
    assert.equal(given.status, 201, JSON.stringify(given.body));
    assert.equal(given.body.data.codePrefix, `${Y1}-LOT-1-BATCH-1`);
    const setup = (await request(app).get(`/api/v1/projects/${given.body.data.projectId}/setup`).set(await web())).body.data;
    const filled = (setup.needsAssessmentImport.filled as Array<{ key: string }>).map((f) => f.key);
    assert.ok(!filled.includes('projectTypeId') && !filled.includes('interventionYear') && !filled.includes('lot'), 'given values are not tagged as from the file');
    assert.ok(filled.includes('name') && filled.includes('stateCode'));
  });

  it('confirm creates the draft with its code, sites, units linked to sites and BoQ', async () => {
    const file = await demoFile();
    const p = (await preview(file)).body.data;
    const res = await request(app).post(`${BASE}/confirm`).set(await web()).send({ fileBase64: file, fileName: FILE_NAME, sha256: p.sha256 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const { projectId, codePrefix, needsInput } = res.body.data;
    assert.equal(codePrefix, `${Y0}-LOT-1-BATCH-1`);
    assert.deepEqual(needsInput, []);
    ids.project = projectId;

    const project = await prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { status: true, name: true, stateCode: true, lgaCode: true, projectTypeId: true, interventionYear: true, fundingSourceCode: true, totalBudgetNgn: true, strategicJustification: true, lot: { select: { title: true, number: true } } },
    });
    assert.equal(project.status, 'DRAFT');
    assert.equal(project.name, DEMO_PROJECT.name);
    assert.equal(project.stateCode, 'KN');
    assert.equal(project.lgaCode, 'KN-DAWAKIN-TOFA');
    assert.equal(project.projectTypeId, ids.central);
    assert.equal(project.interventionYear, Y0);
    assert.equal(project.fundingSourceCode, 'DIRECT_INTERVENTION');
    assert.equal(Number(project.totalBudgetNgn), DEMO_PROJECT.budgetNgn);
    assert.equal(project.strategicJustification, DEMO_PROJECT.strategicJustification);
    assert.equal(project.lot?.title, DEMO_PROJECT.lotTitle);

    const sites = await prisma.projectSite.findMany({ where: { projectId }, orderBy: { siteNumber: 'asc' } });
    assert.deepEqual(
      sites.map((s) => [s.siteNumber, s.schoolName, s.schoolLevel, s.lgaCode]),
      DEMO_SITES.map((s) => [s.siteNumber, s.schoolName, s.schoolLevel, s.lga === 'Tofa' ? 'KN-TOFA' : 'KN-DAWAKIN-TOFA'])
    );
    const units = await prisma.facilityUnit.findMany({ where: { projectId }, select: { code: true, site: { select: { siteNumber: true } } }, orderBy: { code: 'asc' } });
    assert.deepEqual(
      units.map((u) => [u.code, u.site?.siteNumber ?? null]),
      DEMO_UNITS.map((u) => [u.code, u.siteNumber]).sort((a, b) => String(a[0]).localeCompare(String(b[0])))
    );
    assert.equal(await prisma.boqItem.count({ where: { projectId } }), DEMO_LINES.length);
    assert.equal(await prisma.projectSprint.count({ where: { projectId } }), 2);

    const actions = (await prisma.auditLog.findMany({ where: { projectId }, select: { action: true } })).map((a) => a.action);
    for (const a of ['PROJECT_DRAFT_CREATED', 'SCOPE_IMPORTED', 'SITES_SAVED']) assert.ok(actions.includes(a as never), `${a} in ${actions.join(',')}`);

    const setup = await request(app).get(`/api/v1/projects/${projectId}/setup`).set(await web());
    assert.equal(setup.status, 200, JSON.stringify(setup.body));
    const dto = setup.body.data;
    assert.equal(dto.needsAssessmentImport.fileName, FILE_NAME);
    assert.deepEqual(dto.needsAssessmentImport.needsInput, []);
    const filled = (dto.needsAssessmentImport.filled as Array<{ key: string; source: string }>).map((f) => f.key);
    for (const k of ['name', 'projectTypeId', 'interventionYear', 'lot', 'stateCode', 'totalBudgetNgn', 'sites', 'scope']) assert.ok(filled.includes(k), `${k} filled`);
    const saved = (id: string) => (dto.steps as Array<{ stepId: string; saved: boolean }>).find((s) => s.stepId === id)?.saved;
    assert.equal(saved('scope'), true);
    assert.equal(saved('sites'), true);
  });

  it('keeps the import state after another section save, and recomputes what is still missing', async () => {
    const h = await web();
    const setup = (await request(app).get(`/api/v1/projects/${ids.project}/setup`).set(h)).body.data;
    const res = await request(app)
      .put(`/api/v1/projects/${ids.project}/setup/basics`)
      .set(h)
      .send({ name: setup.basics.name, totalBudgetNgn: Number(setup.basics.totalBudgetNgn), fundingSourceCode: null });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.data.needsAssessmentImport, 'still there after a section save');
    assert.deepEqual(res.body.data.needsAssessmentImport.needsInput, ['fundingSourceCode']);
  });

  it('a second draft from a file naming the same lot takes the next batch', async () => {
    const file = await demoFile();
    const p = (await preview(file)).body.data;
    assert.equal(p.codePreview, 'LOT 1 BATCH 2');
    assert.match(String(field(p.fields, 'lot').display), /^LOT 1: (?!.*new lot)/);
    const res = await request(app).post(`${BASE}/confirm`).set(await web()).send({ fileBase64: file, fileName: FILE_NAME, sha256: p.sha256, overrides: { name: 'WASH upgrade, second batch' } });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.codePrefix, `${Y0}-LOT-1-BATCH-2`);
    const created = await prisma.project.findUniqueOrThrow({ where: { id: res.body.data.projectId }, select: { name: true } });
    assert.equal(created.name, 'WASH upgrade, second batch', 'the person\'s value wins');
  });

  it('an older file (no Sites sheet, no State or Lot title rows) still imports into a draft', async () => {
    const h = await web();
    const created = await request(app).post('/api/v1/projects').set(h).send({
      name: 'Older needs assessment file',
      stateCode: 'KN',
      totalBudgetNgn: DEMO_PROJECT.budgetNgn,
      projectTypeId: ids.central,
      interventionYear: Y0,
      lotChoice: { newLotTitle: 'Older file lot' },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const projectId = created.body.data.projectId;
    const file = await demoFile(asOlderFile);
    const pv = await request(app).post(`/api/v1/projects/${projectId}/scope/import/preview`).set(h).send({ fileBase64: file });
    assert.equal(pv.status, 200, JSON.stringify(pv.body));
    assert.deepEqual(pv.body.data.issues, []);
    const confirm = await request(app).post(`/api/v1/projects/${projectId}/scope/import/confirm`).set(h).send({ fileBase64: file, sha256: pv.body.data.sha256 });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
    assert.equal(await prisma.projectSite.count({ where: { projectId } }), 0);
    assert.equal(await prisma.facilityUnit.count({ where: { projectId, siteId: { not: null } } }), 0);
    assert.equal(await prisma.boqItem.count({ where: { projectId } }), DEMO_LINES.length);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { lgaCode: true } });
    assert.equal(project.lgaCode, 'KN-DAWAKIN-TOFA', 'the LGA row fills the LGA code in the project State');
  });

  it('the in-project import takes the Sites sheet and links units to their sites', async () => {
    const h = await web();
    const created = await request(app).post('/api/v1/projects').set(h).send({
      name: 'In-project import with sites',
      totalBudgetNgn: DEMO_PROJECT.budgetNgn,
      projectTypeId: ids.central,
      interventionYear: Y0,
      lotChoice: { newLotTitle: 'In-project lot' },
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const projectId = created.body.data.projectId;
    const file = await demoFile();
    const pv = await request(app).post(`/api/v1/projects/${projectId}/scope/import/preview`).set(h).send({ fileBase64: file });
    assert.equal(pv.status, 200, JSON.stringify(pv.body));
    assert.ok((pv.body.data.projectChanges as Array<{ field: string; action: string }>).some((c) => c.field === 'stateCode' && c.action === 'FILL'));
    const confirm = await request(app).post(`/api/v1/projects/${projectId}/scope/import/confirm`).set(h).send({ fileBase64: file, sha256: pv.body.data.sha256 });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
    assert.equal(await prisma.projectSite.count({ where: { projectId } }), DEMO_SITES.length);
    assert.equal(await prisma.facilityUnit.count({ where: { projectId, siteId: { not: null } } }), DEMO_UNITS.length);
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { stateCode: true } });
    assert.equal(project.stateCode, 'KN');
  });
});
