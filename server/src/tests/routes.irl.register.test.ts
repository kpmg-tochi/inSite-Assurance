/**
 * UBEC IRL: the project register (route tests on the seeded UBEC tenant).
 * - Register fields (intervention year, funding source, UBEC project ID) round trip through the
 *   basics section on drafts and live projects; a taken project ID is refused (409).
 * - Register filters on GET /projects and the portfolio overview; the filter options; the last
 *   approved update.
 * - Export (.xlsx and .pdf): the caller's visibility, "Paid to date" only with payments:view.
 * - Bulk import: template, preview (codes, issues), sha mismatch (409), confirm (drafts and live
 *   imported projects), refusals (duplicates, unknown names), and the needs assessment imported on
 *   an imported live project without scope.
 */
import { resetTestDatabase } from './helpers/testDb';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { allowedInterventionYears, splitProjectCode, zonedCalendarDate, type RegisterRowRaw } from '@insite/shared';

// Client demo updates D5: new and changed drafts take the current or next fiscal year (January start).
const [THIS_YEAR, NEXT_YEAR] = allowedInterventionYears(zonedCalendarDate(new Date(), 'Africa/Lagos'));
import { DEMO_REGISTER_FILE, demoRegisterRows, demoRegisterWorkbookData, demoWorkbookData } from '../scripts/demoProject';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let buildRegisterWorkbook: typeof import('../modules/projectRegister/registerWorkbook')['buildRegisterWorkbook'];

const PASSWORD = 'Password123!';
const ADMIN = 'admin@ubec.test';
const ME = 'me.officer@ubec.test';
const today = zonedCalendarDate(new Date(), 'Africa/Lagos');
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

/** Collects a binary response (xlsx, pdf) as a Buffer. */
function binary(res: NodeJS.ReadableStream & { setEncoding: (e: string) => void }, cb: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(Buffer.from(c)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
}

async function download(path: string, email: string) {
  return request(app).get(path).set(await web(email)).buffer(true).parse(binary as never);
}

async function readSheet(buffer: Buffer, name: string) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.getWorksheet(name);
  assert.ok(ws, `sheet ${name}`);
  const headers = (ws.getRow(3).values as unknown[]).slice(1).map((v) => String(v ?? ''));
  const rows: string[][] = [];
  for (let r = 4; r <= ws.rowCount; r++) {
    const values = (ws.getRow(r).values as unknown[]).slice(1).map((v) => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : typeof v === 'object' ? JSON.stringify(v) : String(v)));
    if (values.some((v) => v !== '')) rows.push(values);
  }
  return { headers, rows };
}

async function userHas(email: string, key: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: { include: { rolePermissions: { include: { permission: true } } } } } });
  return user.role.rolePermissions.some((rp) => rp.permission.key === key);
}

async function projectId(code: string) {
  return (await prisma.project.findFirstOrThrow({ where: { tenantId: ids.tenant, codePrefix: code } })).id;
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  ({ buildRegisterWorkbook } = await import('../modules/projectRegister/registerWorkbook'));
  const { createApp } = await import('../app');
  app = createApp();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
  ids.tenant = tenant.id;
  ids.sahel = (await prisma.organization.findFirstOrThrow({ where: { tenantId: tenant.id, name: 'Sahel Build & Civil Works Ltd' } })).id;
});

describe('UBEC IRL register fields', () => {
  it('seeds every PRG project with a year, a funding source and a UBEC project ID', async () => {
    const rows = await prisma.project.findMany({ where: { tenantId: ids.tenant, codePrefix: { startsWith: 'PRG-' } }, include: { projectType: true } });
    assert.ok(rows.length >= 10);
    for (const p of rows) {
      assert.ok(p.interventionYear && p.interventionYear >= 2023, p.codePrefix);
      assert.match(p.externalReference ?? '', /^UBEC\/(DI|MG)\/20\d\d\/[A-Z]{2}\/\d{3}$/);
      assert.equal(p.fundingSource, p.projectType?.code === 'CO_FUNDED' ? 'Matching grant (SUBEB counterpart)' : 'UBEC Intervention Fund');
    }
  });

  it('round-trips through the basics section (draft and live), refuses a taken ID and a bad year', async () => {
    const h = await web(ADMIN);
    for (const code of ['PRG-101', 'PRG-102']) {
      const id = await projectId(code);
      const setup = (await request(app).get(`/api/v1/projects/${id}/setup`).set(h)).body.data;
      const basics = {
        name: setup.basics.name,
        codePrefix: setup.basics.codePrefix,
        stateLocation: setup.basics.stateLocation,
        lgaLocation: setup.basics.lgaLocation,
        totalBudgetNgn: setup.basics.totalBudgetNgn,
      };
      const ref = `TEST/${code}`;
      const saved = await request(app)
        .put(`/api/v1/projects/${id}/setup/basics`)
        .set(h)
        .send({ ...basics, interventionYear: NEXT_YEAR, fundingSource: 'Development partner', externalReference: ref });
      assert.equal(saved.status, 200, JSON.stringify(saved.body));
      assert.equal(saved.body.data.basics.interventionYear, NEXT_YEAR);
      assert.equal(saved.body.data.basics.fundingSource, 'Development partner');
      assert.equal(saved.body.data.basics.externalReference, ref);

      // Omitted keeps; another project's ID (any case) is refused.
      const kept = await request(app).put(`/api/v1/projects/${id}/setup/basics`).set(h).send(basics);
      assert.equal(kept.body.data.basics.externalReference, ref);
      const taken = await request(app)
        .put(`/api/v1/projects/${id}/setup/basics`)
        .set(h)
        .send({ ...basics, externalReference: 'ubec/di/2024/kn/103' });
      assert.equal(taken.status, 409, JSON.stringify(taken.body));
      assert.equal(taken.body.error.code, 'EXTERNAL_REFERENCE_TAKEN');
      const badYear = await request(app).put(`/api/v1/projects/${id}/setup/basics`).set(h).send({ ...basics, interventionYear: 1999 });
      assert.equal(badYear.status, 400);
    }
    // The live project shows the fields on the directory row.
    const list = (await request(app).get('/api/v1/projects').set(h)).body.data as Array<Record<string, unknown>>;
    const row = list.find((p) => p.codePrefix === 'PRG-102')!;
    assert.equal(row.externalReference, 'TEST/PRG-102');
    assert.equal(row.interventionYear, NEXT_YEAR);
    assert.equal(row.progressIsImported, false);
    // Created with the fields.
    const created = await request(app).post('/api/v1/projects').set(h).send({
      name: 'Register field draft',
      codePrefix: 'PRG-199',
      stateLocation: 'Kano',
      totalBudgetNgn: 1_000_000,
      projectTypeId: (await prisma.projectType.findFirstOrThrow({ where: { tenantId: ids.tenant, code: 'CENTRAL' } })).id,
      interventionYear: THIS_YEAR,
      fundingSource: 'Special intervention',
      externalReference: 'TEST/NEW',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.data.basics.externalReference, 'TEST/NEW');
    const dup = await request(app).post('/api/v1/projects').set(h).send({
      name: 'Register field draft 2',
      codePrefix: 'PRG-198',
      stateLocation: 'Kano',
      totalBudgetNgn: 1_000_000,
      projectTypeId: (await prisma.projectType.findFirstOrThrow({ where: { tenantId: ids.tenant, code: 'CENTRAL' } })).id,
      externalReference: 'test/new',
    });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.error.code, 'EXTERNAL_REFERENCE_TAKEN');
  });
});

describe('UBEC IRL register filters', () => {
  it('filters the directory and the portfolio by LGA, contractor, year, funding source, search and status', async () => {
    const h = await web(ADMIN);
    const options = (await request(app).get('/api/v1/projects/register/options').set(h)).body.data;
    assert.ok(options.interventionYears.includes(2025));
    assert.ok(options.fundingSources.includes('UBEC Intervention Fund'));
    assert.ok(options.contractors.some((c: { id: string }) => c.id === ids.sahel));

    const all = (await request(app).get('/api/v1/projects/portfolio/overview').set(h)).body.data.projects as Array<Record<string, any>>;
    const check = async (query: Record<string, string | number>, test: (p: Record<string, any>) => boolean) => {
      for (const path of ['/api/v1/projects', '/api/v1/projects/portfolio/overview']) {
        const res = await request(app).get(path).query(query).set(h);
        assert.equal(res.status, 200, JSON.stringify(res.body));
        const rows = (path.endsWith('overview') ? res.body.data.projects : res.body.data) as Array<Record<string, any>>;
        assert.ok(rows.length > 0, `${path} ${JSON.stringify(query)}`);
        for (const p of rows) assert.ok(test(p), `${path} ${JSON.stringify(query)} ${p.codePrefix}`);
        if (path.endsWith('overview')) assert.equal(rows.length, all.filter(test).length, JSON.stringify(query));
      }
    };
    await check({ interventionYear: 2025 }, (p) => p.interventionYear === 2025);
    await check({ fundingSource: 'matching grant (subeb counterpart)' }, (p) => p.fundingSource === 'Matching grant (SUBEB counterpart)');
    await check({ contractorOrganizationId: ids.sahel }, (p) => (p.contractors ? p.contractors.some((c: { organizationId: string }) => c.organizationId === ids.sahel) : p.contractorOrganizationId === ids.sahel));
    const lga = options.lgas[0] as string;
    await check({ lga: lga.toUpperCase() }, (p) => (p.lgaLocation ?? '').toLowerCase() === lga.toLowerCase());
    const ref = all.find((p) => p.externalReference)!.externalReference as string;
    await check({ q: ref.slice(-8) }, (p) => (p.externalReference ?? '').includes(ref.slice(-8)) || p.name.includes(ref.slice(-8)));
    await check({ status: 'ongoing' }, (p) => p.status === 'ACTIVE' && ['ACTIVE_CONSTRUCTION', 'HANDOVER_IN_PROGRESS'].includes(p.constructionPhase));
    const bad = await request(app).get('/api/v1/projects').query({ interventionYear: 'soon' }).set(h);
    assert.equal(bad.status, 400);
  });

  it('carries the last approved visit report date (not any capture)', async () => {
    const h = await web(ADMIN);
    const rows = (await request(app).get('/api/v1/projects/portfolio/overview').set(h)).body.data.projects as Array<Record<string, any>>;
    const approved = await prisma.visitSubmission.groupBy({ by: ['projectId'], where: { status: 'APPROVED' }, _max: { confirmedAt: true } });
    const byProject = new Map(approved.map((a) => [a.projectId, a._max.confirmedAt?.toISOString() ?? null]));
    let seen = 0;
    for (const p of rows) {
      assert.equal(p.lastApprovedUpdateAt, byProject.get(p.id) ?? null, p.codePrefix);
      if (p.lastApprovedUpdateAt) seen++;
    }
    assert.ok(seen > 0, 'some seeded project has an approved visit');
  });
});

describe('UBEC IRL register export', () => {
  it('exports the register as .xlsx with the caller visibility; paid only with payments:view', async () => {
    for (const email of [ADMIN, ME]) {
      const res = await download('/api/v1/projects/export.xlsx', email);
      assert.equal(res.status, 200);
      assert.match(String(res.headers['content-type']), /spreadsheetml/);
      assert.match(String(res.headers['content-disposition']), new RegExp(`UBEC project register ${today}\\.xlsx`));
      const { headers, rows } = await readSheet(res.body as Buffer, 'Project register');
      assert.ok(headers.includes('UBEC project ID'), headers.join('|'));
      assert.equal(headers.includes('Paid to date'), await userHas(email, 'payments:view'), `${email} paid column`);
      const visible = (await request(app).get('/api/v1/projects/portfolio/overview').set(await web(email))).body.data.projects as Array<{ codePrefix: string }>;
      const codes = rows.slice(0, -1).map((r) => r[0]); // last row: totals
      assert.deepEqual([...codes].sort(), visible.map((p) => p.codePrefix).sort(), email);
    }
    // Owner decision 3 (2026-11-26): "Contract sum" is the contract sum only, blank until contracted (as
    // the register table); "Programme zone" (the State again) is gone.
    const all = await readSheet((await download('/api/v1/projects/export.xlsx', ADMIN)).body as Buffer, 'Project register');
    assert.ok(!all.headers.includes('Programme zone'), all.headers.join('|'));
    const sumCol = all.headers.indexOf('Contract sum');
    const rowOf = (code: string) => all.rows.find((r) => r[0] === code);
    assert.equal(Number(rowOf('PRG-102')?.[sumCol]), 232_000_000);
    assert.ok(rowOf('PRG-105'), 'PRG-105 listed');
    // An empty cell is a hole in the sparse row array.
    assert.equal(rowOf('PRG-105')![sumCol] ?? '', '');
    // Filters apply.
    const filtered = await download('/api/v1/projects/export.xlsx?interventionYear=2024&status=ongoing', ADMIN);
    const { rows } = await readSheet(filtered.body as Buffer, 'Project register');
    const expected = ((await request(app).get('/api/v1/projects/portfolio/overview').query({ interventionYear: 2024, status: 'ongoing' }).set(await web(ADMIN))).body.data.projects as unknown[]).length;
    // Data rows plus the totals row; with no match, the one "No projects match" row.
    assert.equal(rows.length, expected ? expected + 1 : 1);
  });

  it('exports the register as a PDF', async () => {
    const res = await download('/api/v1/projects/export.pdf?fundingSource=UBEC%20Intervention%20Fund', ADMIN);
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'application/pdf');
    assert.equal((res.body as Buffer).subarray(0, 4).toString(), '%PDF');
    assert.match(String(res.headers['content-disposition']), /UBEC project register .*\.pdf/);
  });
});

describe('UBEC IRL bulk project import', () => {
  const fileOf = async (rows: RegisterRowRaw[]) => (await buildRegisterWorkbook({ ...demoRegisterWorkbookData(today), rows })).toString('base64');
  let maxBefore = 0;

  it('serves the template with the workspace lists', async () => {
    const res = await download('/api/v1/project-register/template', ADMIN);
    assert.equal(res.status, 200);
    assert.match(String(res.headers['content-disposition']), /UBEC project register template\.xlsx/);
    const { headers } = await readSheet(res.body as Buffer, 'Projects');
    assert.ok(headers.includes('UBEC project ID'));
    assert.ok(headers.includes('Status') && headers.includes('% complete'));
    const forbidden = await request(app).get('/api/v1/project-register/template').set(await web(ME));
    assert.equal(forbidden.status, 403);
  });

  it('previews the demo pack file: codes after the highest PRG code, drafts and live rows, nothing written', async () => {
    const codes = (await prisma.project.findMany({ where: { tenantId: ids.tenant }, select: { codePrefix: true } })).map((p) => splitProjectCode(p.codePrefix));
    maxBefore = Math.max(...codes.filter((c) => c?.prefix === 'PRG').map((c) => c!.number));
    const count = await prisma.project.count();
    const file = await fileOf(demoRegisterRows(today));
    const res = await request(app).post('/api/v1/project-register/import/preview').set(await web(ADMIN)).send({ fileBase64: file, fileName: DEMO_REGISTER_FILE });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const p = res.body.data;
    assert.deepEqual(p.issues, []);
    assert.equal(p.canConfirm, true);
    assert.deepEqual(p.totals, { rowCount: 6, draftCount: 2, liveCount: 4, newContractorCount: 2, rowsWithErrors: 0 });
    assert.deepEqual(
      p.rows.map((r: { code: string }) => r.code),
      [1, 2, 3, 4, 5, 6].map((n) => `PRG-${String(maxBefore + n).padStart(3, '0')}`)
    );
    assert.ok(p.rows.every((r: { codeAssigned: boolean }) => r.codeAssigned));
    assert.equal(await prisma.project.count(), count);
  });

  it('refuses a changed file (409), then creates every project in one go', async () => {
    const h = await web(ADMIN);
    const file = await fileOf(demoRegisterRows(today));
    const preview = (await request(app).post('/api/v1/project-register/import/preview').set(h).send({ fileBase64: file })).body.data;
    const changed = await request(app).post('/api/v1/project-register/import/confirm').set(h).send({ fileBase64: file, sha256: '0'.repeat(64) });
    assert.equal(changed.status, 409);
    assert.equal(changed.body.error.code, 'PROJECT_REGISTER_FILE_CHANGED');

    const res = await request(app).post('/api/v1/project-register/import/confirm').set(h).send({ fileBase64: file, sha256: preview.sha256, fileName: DEMO_REGISTER_FILE });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.draftCount, 2);
    assert.equal(res.body.data.liveCount, 4);

    const created = await prisma.project.findMany({
      where: { tenantId: ids.tenant, importedAt: { not: null } },
      include: { contractors: { include: { organization: true } }, beneficiaries: true, contractMilestones: true, visits: true },
      orderBy: { codePrefix: 'asc' },
    });
    assert.equal(created.length, 6);
    const byRef = new Map(created.map((c) => [c.externalReference, c]));
    const draft = byRef.get('UBEC/DI/2026/KN/031')!;
    assert.equal(draft.status, 'DRAFT');
    assert.equal(draft.importedProgressPct, null);
    assert.equal(draft.interventionYear, 2026);
    assert.equal(draft.beneficiaries[0]?.name, 'LGEA Primary School, Gwarzo');
    assert.ok(draft.projectTypeId, 'type applied');

    const ongoing = byRef.get('UBEC/DI/2025/KN/014')!;
    assert.equal(ongoing.status, 'ACTIVE');
    assert.equal(ongoing.importedStatus, 'ONGOING');
    assert.equal(Number(ongoing.importedProgressPct), 55);
    assert.equal(Number(ongoing.certifiedProgressPct), 55);
    assert.ok(ongoing.activatedAt);
    assert.equal(ongoing.geofenceMode, 'RADIAL');
    assert.equal(ongoing.contractors[0]?.organization.id, ids.sahel);
    // No flood: nothing open is already due, and the mobilisation steps are waived.
    const open = ongoing.contractMilestones.filter((m) => ['PENDING', 'DUE', 'OVERDUE'].includes(m.status));
    assert.ok(open.every((m) => !m.dueDate || m.dueDate >= today), JSON.stringify(open.map((m) => [m.key, m.dueDate])));
    assert.ok(ongoing.contractMilestones.filter((m) => m.completionMode === 'AUTO_CONTRACTOR_ON_SITE').every((m) => m.status === 'WAIVED'));
    assert.ok(ongoing.visits.every((v) => v.status === 'PROPOSED' && v.plannedDate >= today));
    assert.ok(ongoing.visits.every((v) => v.visitKind !== 'MOBILISATION_CHECK'));

    const completed = byRef.get('UBEC/DI/2024/KN/022')!;
    assert.equal(completed.status, 'ACTIVE');
    assert.equal(completed.importedStatus, 'COMPLETED');
    assert.equal(Number(completed.certifiedProgressPct), 100);
    assert.equal(completed.visits.length, 0);
    assert.equal(completed.contractors[0]?.organization.name, 'Gwale Borehole Services Ltd');
    assert.ok((completed.contractors[0]!.organization.categories as string[]).includes('CONTRACTOR'));

    // The register shows the imported progress until scope is added.
    const list = (await request(app).get('/api/v1/projects/portfolio/overview').set(h)).body.data.projects as Array<Record<string, any>>;
    const row = list.find((p) => p.id === ongoing.id)!;
    assert.equal(row.progressIsImported, true);
    assert.equal(row.certifiedProgressPct, 55);
    assert.equal(row.importedStatus, 'ONGOING');
    // Imported under way: in execution, and no kick-off step is left open with no date.
    assert.equal(row.stage?.current, 'CONSTRUCTION');
    assert.ok(ongoing.contractMilestones.filter((m) => m.anchor === 'KICKOFF').every((m) => m.status === 'WAIVED'));

    const audit = await prisma.auditLog.count({ where: { action: 'PROJECT_REGISTER_IMPORTED' } });
    assert.equal(audit, 7, 'one per project and one for the file');

    // The same file again: every row's UBEC project ID is taken; confirm refuses everything.
    const again = (await request(app).post('/api/v1/project-register/import/preview').set(h).send({ fileBase64: file })).body.data;
    assert.equal(again.canConfirm, false);
    assert.equal(again.issues.filter((i: { code: string }) => i.code === 'EXTERNAL_REFERENCE_TAKEN').length, 6);
    const refused = await request(app).post('/api/v1/project-register/import/confirm').set(h).send({ fileBase64: file, sha256: again.sha256 });
    assert.equal(refused.status, 422);
    assert.equal(refused.body.error.code, 'PROJECT_REGISTER_IMPORT_INVALID');
    assert.equal(await prisma.project.count({ where: { tenantId: ids.tenant, importedAt: { not: null } } }), 6);
  });

  it('reports row issues: duplicates, unknown names, bad values, a taken code is renumbered', async () => {
    const base = { state: 'Kano', projectType: 'Direct Intervention', budget: 5_000_000 };
    const rows: RegisterRowRaw[] = [
      { ...base, code: 'PRG-102', name: 'Taken code project', externalReference: 'DUP/1' },
      { ...base, name: 'Duplicate reference', externalReference: 'dup/1' },
      { ...base, name: 'Unknown state', state: 'Atlantis' },
      { ...base, name: 'Unknown type', projectType: 'Space programme' },
      { ...base, name: 'Bad date', contractAwardDate: '31/02/2025' },
      { ...base, name: 'Ongoing without GPS', status: 'Ongoing', percentComplete: 10, contractor: 'Sahel Build & Civil Works Ltd' },
      { ...base, name: 'Weird status', status: 'Paused' },
      { state: 'Kano', projectType: 'Direct Intervention', name: 'No money' },
    ];
    const res = await request(app).post('/api/v1/project-register/import/preview').set(await web(ADMIN)).send({ fileBase64: await fileOf(rows) });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const p = res.body.data;
    assert.equal(p.canConfirm, false);
    const codesOf = (i: number) => (p.rows[i].issues as Array<{ code: string }>).map((x) => x.code);
    assert.deepEqual(codesOf(0), []);
    assert.ok(p.rows[0].warnings.some((w: { code: string }) => w.code === 'CODE_REASSIGNED'));
    assert.notEqual(p.rows[0].code, 'PRG-102');
    assert.deepEqual(codesOf(1), ['DUPLICATE_EXTERNAL_REFERENCE']);
    assert.deepEqual(codesOf(2), ['UNKNOWN_STATE']);
    assert.deepEqual(codesOf(3), ['UNKNOWN_PROJECT_TYPE']);
    assert.deepEqual(codesOf(4), ['BAD_DATE']);
    assert.deepEqual(codesOf(5), ['GPS_REQUIRED']);
    assert.deepEqual(codesOf(6), ['UNKNOWN_STATUS']);
    assert.deepEqual(codesOf(7), ['BUDGET_REQUIRED']);
    assert.equal(p.totals.rowsWithErrors, 7);

    const notXlsx = await request(app).post('/api/v1/project-register/import/preview').set(await web(ADMIN)).send({ fileBase64: Buffer.from('hello').toString('base64') });
    assert.equal(notXlsx.body.data.issues[0].code, 'WORKBOOK_UNREADABLE');
  });

  it('takes the needs assessment on an imported live project without scope, then the computed progress replaces the imported %', async () => {
    const h = await web(ADMIN);
    const imported = await prisma.project.findFirstOrThrow({ where: { tenantId: ids.tenant, externalReference: 'UBEC/DI/2025/KN/014' } });
    const { buildScopeWorkbook } = await import('../modules/scope/workbook/scopeWorkbook');
    const file = (await buildScopeWorkbook(demoWorkbookData(today))).toString('base64');
    const scopeBefore = (await request(app).get(`/api/v1/projects/${imported.id}/scope`).set(h)).body.data;
    assert.equal(scopeBefore.importAllowed, true);
    const preview = await request(app).post(`/api/v1/projects/${imported.id}/scope/import/preview`).set(h).send({ fileBase64: file });
    assert.equal(preview.status, 200, JSON.stringify(preview.body));
    assert.deepEqual(preview.body.data.issues, []);
    const confirm = await request(app).post(`/api/v1/projects/${imported.id}/scope/import/confirm`).set(h).send({ fileBase64: file, sha256: preview.body.data.sha256 });
    assert.equal(confirm.status, 200, JSON.stringify(confirm.body));
    const after = await prisma.project.findUniqueOrThrow({ where: { id: imported.id }, select: { certifiedProgressPct: true, status: true, name: true } });
    assert.equal(after.status, 'ACTIVE');
    assert.equal(after.name, imported.name, 'project fields are not overwritten');
    assert.equal(Number(after.certifiedProgressPct), 0, 'computed from the new lines (no accepted visit yet)');
    const row = ((await request(app).get('/api/v1/projects').set(h)).body.data as Array<Record<string, any>>).find((p) => p.id === imported.id)!;
    assert.equal(row.progressIsImported, false);

    // Now it has scope: a second import is refused, as on any live project.
    const again = await request(app).post(`/api/v1/projects/${imported.id}/scope/import/preview`).set(h).send({ fileBase64: file });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'SCOPE_IMPORT_LIVE_PROJECT');
    const notImported = await request(app).post(`/api/v1/projects/${await projectId('PRG-105')}/scope/import/preview`).set(h).send({ fileBase64: file });
    assert.equal(notImported.status, 409);
  });
});
