/**
 * Client demo updates, wave 4 (E3, approved list upload; decisions W4.2/W4.3), on the seeded UBEC
 * tenant (the normal seed has no approved lists):
 * - GET /approved-lists/template: the .xlsx with the version stamp, List and Rows sheets.
 * - POST /import/preview writes nothing; it shows the row actions, links, match status and mismatch.
 * - POST /import/confirm creates the list and links projects from the Project ID column (code or
 *   client project ID); a second upload of the same year and kind updates it in place (row ids kept,
 *   a removed row's project unlinked, audit entries on the project and tenant ledgers).
 * - 409 APPROVED_LIST_FILE_CHANGED on a different sha256; 422 APPROVED_LIST_IMPORT_INVALID for a file
 *   with any error (nothing written); BEAP rows must be in the BEAP's State; a project of another
 *   intervention year is refused; 403 without `approved_lists:manage`.
 */
import { resetTestDatabase } from './helpers/testDb';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Express } from 'express';
import request from 'supertest';
import ExcelJS from 'exceljs';
import { APPROVED_LIST_TEMPLATE_VERSION } from '@insite/shared';
import { buildApprovedListWorkbook, type ApprovedListHeaderInput, type ApprovedListRowInput } from '../modules/approvedLists/approvedListWorkbook';

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
const ME = 'me.officer@ubec.test';
const BASE = '/api/v1/approved-lists';

const DI_2026: ApprovedListHeaderInput = { interventionYear: 2026, kind: 'DI_SCHEDULE', approvedBy: 'Executive Secretary, UBEC', approvedOn: '2025-10-14' };

async function file(header: ApprovedListHeaderInput, rows: ApprovedListRowInput[]) {
  const buffer = await buildApprovedListWorkbook({ generatedAt: new Date('2026-11-26T09:00:00Z'), brandName: 'UBEC', header, rows });
  return { fileBase64: buffer.toString('base64'), fileName: 'Approved schedule 2026.xlsx' };
}

async function preview(body: { fileBase64: string; fileName: string }) {
  const res = await request(app).post(`${BASE}/import/preview`).set(await as(ADMIN)).send(body);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return res.body.data;
}

const counts = async () => ({
  lists: await prisma.approvedList.count({ where: { tenantId: ids.tenant } }),
  rows: await prisma.approvedListRow.count({ where: { list: { tenantId: ids.tenant } } }),
  audit: await prisma.auditLog.count({ where: { tenantId: ids.tenant, action: { in: ['APPROVED_LIST_IMPORTED', 'APPROVED_LIST_ROW_LINKED'] } } }),
});

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { createApp } = await import('../app');
  app = createApp();
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } });
  ids.tenant = tenant.id;
  const byCode = (codePrefix: string) => prisma.project.findUniqueOrThrow({ where: { tenantId_codePrefix: { tenantId: tenant.id, codePrefix } } });
  const a = await byCode('PRG-105');
  const b = await byCode('PRG-103');
  const c = await byCode('PRG-102');
  ids.pA = a.id;
  ids.pB = b.id;
  ids.pC = c.id;
  await prisma.project.update({ where: { id: a.id }, data: { interventionYear: 2026, totalBudgetNgn: 50_000_000 } });
  await prisma.project.update({ where: { id: b.id }, data: { interventionYear: 2026, totalBudgetNgn: 20_000_000, externalReference: 'UBEC/DI/2026/LA/103' } });
  await prisma.project.update({ where: { id: c.id }, data: { interventionYear: 2025 } });
});

after(async () => {
  await prisma?.$disconnect();
});

describe('demo wave 4: approved list upload (E3)', () => {
  it('downloads the template with the version stamp', async () => {
    const res = await request(app)
      .get(`${BASE}/template`)
      .set(await as(ADMIN))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (d: Buffer) => chunks.push(d));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    assert.equal(res.status, 200);
    assert.match(String(res.headers['content-type']), /spreadsheetml/);
    assert.match(String(res.headers['content-disposition']), /UBEC approved list template\.xlsx/);
    assert.equal(res.headers['cache-control'], 'no-store');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.body as unknown as ArrayBuffer);
    assert.deepEqual(
      wb.worksheets.map((w) => w.name),
      ['Instructions', 'List', 'Rows', 'Lists']
    );
    assert.equal(wb.getWorksheet('Instructions')!.getCell('B4').value, APPROVED_LIST_TEMPLATE_VERSION);
    assert.equal(wb.getWorksheet('Rows')!.getCell('A3').value, 'Row ref');
    assert.equal(wb.getWorksheet('Lists')!.state, 'hidden');
  });

  it('refuses users without approved_lists:manage', async () => {
    const body = await file(DI_2026, [{ rowRef: 'X/1', projectTitle: 'X', state: 'Kano', costEstimate: 1 }]);
    assert.equal((await request(app).get(`${BASE}/template`).set(await as(ME))).status, 403);
    assert.equal((await request(app).post(`${BASE}/import/preview`).set(await as(ME)).send(body)).status, 403);
    assert.equal((await request(app).post(`${BASE}/import/confirm`).set(await as(ME)).send({ ...body, sha256: 'a'.repeat(64) })).status, 403);
  });

  it('previews a new list without writing, then saves it and links projects from the Project ID column', async () => {
    const body = await file(DI_2026, [
      { rowRef: 'DI/2026/FC/001', projectTitle: 'Two classrooms, LEA Primary School Garki', schools: 'LEA Primary School, Garki', state: 'FCT', lgas: 'Abuja Municipal', costEstimate: 50_000_000, lotTitle: 'Lot 1', projectRef: 'prg-105' },
      { rowRef: 'DI/2026/LA/002', projectTitle: 'Renovation, GTC Yaba', schools: 'Government Technical College, Yaba; Annex', state: 'Lagos', lgas: 'Lagos Mainland', costEstimate: 30_000_000, projectRef: 'ubec/di/2026/la/103' },
      { rowRef: 'DI/2026/KN/003', projectTitle: 'Boreholes, Kano', state: 'KN', lgas: 'Dala, Fagge', costEstimate: '12,500,000' },
    ]);
    const before = await counts();
    const p = await preview(body);
    assert.deepEqual(await counts(), before, 'preview writes nothing');
    assert.equal(p.version, APPROVED_LIST_TEMPLATE_VERSION);
    assert.equal(p.canConfirm, true, JSON.stringify(p.issues));
    assert.equal(p.replaces, null);
    assert.deepEqual(p.list, { interventionYear: 2026, kind: 'DI_SCHEDULE', stateCode: null, title: 'Approved Projects & Implementation Schedule 2026', approvedBy: 'Executive Secretary, UBEC', approvedOn: '2025-10-14' });
    type PRow = { rowRef: string; action: string; linkSource: string; matchStatus: string; lgaCodes: string[]; schoolNames: string[]; costEstimateNgn: number; linkedProjects: Array<{ id: string; mismatch: { summary: string } }> };
    const rows = p.rows as PRow[];
    assert.deepEqual(rows.map((r) => [r.rowRef, r.action, r.linkSource, r.matchStatus]), [
      ['DI/2026/FC/001', 'NEW', 'FROM_FILE', 'LINKED'],
      ['DI/2026/LA/002', 'NEW', 'FROM_FILE', 'MISMATCH'],
      ['DI/2026/KN/003', 'NEW', 'NONE', 'NOT_LINKED'],
    ]);
    assert.equal(rows[0].linkedProjects[0].id, ids.pA);
    assert.equal(rows[1].linkedProjects[0].id, ids.pB);
    assert.equal(rows[1].linkedProjects[0].mismatch.summary, 'Budget ₦20.0m vs approved schedule ₦30.0m (-33%)');
    assert.deepEqual(rows[1].schoolNames, ['Government Technical College, Yaba', 'Annex']);
    assert.deepEqual(rows[2].lgaCodes, ['KN-DALA', 'KN-FAGGE']);
    assert.equal(rows[2].costEstimateNgn, 12_500_000);
    assert.equal(p.totals.linkedCount, 2);
    assert.equal(p.totals.mismatchCount, 1);
    assert.equal(p.totals.totalEstimateNgn, 92_500_000);

    const res = await request(app).post(`${BASE}/import/confirm`).set(await as(ADMIN)).send({ ...body, sha256: p.sha256 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const r = res.body.data;
    assert.equal(r.created, true);
    assert.equal(r.newCount, 3);
    assert.equal(r.relinkedProjectCount, 2);
    assert.equal(r.list.rowCount, 3);
    assert.equal(r.list.sourceFileName, 'Approved schedule 2026.xlsx');
    assert.ok(r.list.importedAt);
    assert.ok(r.list.importedByName);
    ids.list = r.list.id;
    ids.row1 = r.list.rows[0].id;
    ids.row2 = r.list.rows[1].id;
    ids.row3 = r.list.rows[2].id;
    assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: ids.pA } })).approvedListRowId, ids.row1);
    assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: ids.pB } })).approvedListRowId, ids.row2);
    const tenantEntry = await prisma.auditLog.findFirstOrThrow({ where: { tenantId: ids.tenant, projectId: null, action: 'APPROVED_LIST_IMPORTED' } });
    assert.match(tenantEntry.summaryText, /3 row\(s\) \(3 new/);
    assert.equal(await prisma.auditLog.count({ where: { projectId: ids.pA, action: 'APPROVED_LIST_ROW_LINKED' } }), 1);

    // The overview carries the upload.
    const overview = await request(app).get(`${BASE}?interventionYear=2026`).set(await as(ADMIN));
    assert.equal(overview.status, 200);
    assert.equal(overview.body.data.lists[0].sourceFileName, 'Approved schedule 2026.xlsx');
  });

  it('updates the same list in place on a second upload: row ids kept, removed rows unlinked', async () => {
    const body = await file(DI_2026, [
      { rowRef: 'di/2026/fc/001', projectTitle: 'Two classrooms, LEA Primary School Garki', schools: 'LEA Primary School, Garki', state: 'FCT', lgas: 'Abuja Municipal', costEstimate: 52_000_000, lotTitle: 'Lot 1' },
      { rowRef: 'DI/2026/KN/003', projectTitle: 'Boreholes, Kano', state: 'KN', lgas: 'Dala, Fagge', costEstimate: 12_500_000 },
      { rowRef: 'DI/2026/KN/004', projectTitle: 'Fencing, Kano', state: 'Kano', costEstimate: 8_000_000 },
    ]);
    const p = await preview(body);
    assert.equal(p.canConfirm, true, JSON.stringify(p.issues));
    assert.equal(p.replaces.listId, ids.list);
    assert.equal(p.replaces.rowCount, 3);
    assert.deepEqual(
      (p.rows as Array<{ action: string; linkSource: string }>).map((r) => [r.action, r.linkSource]),
      [
        ['UPDATED', 'KEPT'],
        ['UNCHANGED', 'NONE'],
        ['NEW', 'NONE'],
      ]
    );
    assert.equal(p.removedRows.length, 1);
    assert.equal(p.removedRows[0].rowRef, 'DI/2026/LA/002');
    assert.equal(p.removedRows[0].linkedProjects[0].id, ids.pB);

    const res = await request(app).post(`${BASE}/import/confirm`).set(await as(ADMIN)).send({ ...body, sha256: p.sha256 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const r = res.body.data;
    assert.equal(r.created, false);
    assert.deepEqual([r.newCount, r.updatedCount, r.removedCount, r.relinkedProjectCount], [1, 1, 1, 1]);
    assert.equal(r.list.id, ids.list);
    const rowIds = (r.list.rows as Array<{ id: string; rowRef: string; costEstimateNgn: number }>).map((x) => x.id);
    assert.equal(rowIds[0], ids.row1);
    assert.equal(rowIds[1], ids.row3);
    assert.equal(r.list.rows[0].rowRef, 'di/2026/fc/001');
    assert.equal(r.list.rows[0].costEstimateNgn, 52_000_000);
    assert.equal(await prisma.approvedListRow.count({ where: { id: ids.row2 } }), 0);
    assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: ids.pA } })).approvedListRowId, ids.row1, 'blank Project ID keeps the link');
    assert.equal((await prisma.project.findUniqueOrThrow({ where: { id: ids.pB } })).approvedListRowId, null);
    const unlink = await prisma.auditLog.findFirstOrThrow({ where: { projectId: ids.pB, action: 'APPROVED_LIST_ROW_LINKED' }, orderBy: { seq: 'desc' } });
    assert.match(unlink.summaryText, /^Unlinked from row DI\/2026\/LA\/002/);
    assert.equal(await prisma.auditLog.count({ where: { tenantId: ids.tenant, projectId: null, action: 'APPROVED_LIST_IMPORTED' } }), 2);
    assert.equal(await prisma.approvedList.count({ where: { tenantId: ids.tenant } }), 1);
  });

  it('refuses a file that is not the one checked (409)', async () => {
    const body = await file(DI_2026, [{ rowRef: 'DI/2026/KN/003', projectTitle: 'Boreholes, Kano', state: 'Kano', costEstimate: 1 }]);
    const res = await request(app).post(`${BASE}/import/confirm`).set(await as(ADMIN)).send({ ...body, sha256: 'b'.repeat(64) });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'APPROVED_LIST_FILE_CHANGED');
  });

  it('refuses the whole file when one row has an error (422, nothing written)', async () => {
    const body = await file({ ...DI_2026, interventionYear: 2025 }, [
      { rowRef: 'DI/2025/KN/001', projectTitle: 'Good row', state: 'Kano', costEstimate: 10_000_000 },
      { rowRef: 'DI/2025/KN/002', projectTitle: 'No estimate', state: 'Kano' },
      { rowRef: 'DI/2025/KN/001', projectTitle: 'Duplicate ref', state: 'Kano', costEstimate: 5 },
      { rowRef: 'DI/2025/KN/004', projectTitle: 'Wrong LGA', state: 'Kano', lgas: 'Ikeja', costEstimate: 5 },
      { rowRef: 'DI/2025/KN/005', projectTitle: 'Year mismatch', state: 'Kano', costEstimate: 5, projectRef: 'PRG-105' },
      { rowRef: 'DI/2025/KN/006', projectTitle: 'Unknown project', state: 'Kano', costEstimate: 5, projectRef: 'PRG-999' },
    ]);
    const before = await counts();
    const p = await preview(body);
    assert.equal(p.canConfirm, false);
    assert.deepEqual(
      (p.issues as Array<{ code: string }>).map((i) => i.code).sort(),
      ['APPROVED_LIST_YEAR_MISMATCH', 'COST_ESTIMATE_REQUIRED', 'DUPLICATE_ROW_REF', 'LGA_NOT_IN_STATE', 'PROJECT_NOT_FOUND']
    );
    assert.equal(p.totals.rowsWithErrors, 5);
    const res = await request(app).post(`${BASE}/import/confirm`).set(await as(ADMIN)).send({ ...body, sha256: p.sha256 });
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'APPROVED_LIST_IMPORT_INVALID');
    assert.deepEqual(await counts(), before);
  });

  it('requires BEAP rows in the BEAP State and refuses a wrong file', async () => {
    const body = await file({ interventionYear: 2026, kind: 'MG_BEAP', state: 'Kano', approvedBy: 'UBEC Board', approvedOn: '21/10/2025' }, [
      { rowRef: 'BEAP/2026/KN/001', projectTitle: 'Classrooms, Dala', state: 'Kano', lgas: 'Dala', costEstimate: 20_000_000 },
      { rowRef: 'BEAP/2026/KN/002', projectTitle: 'Toilets, Ikeja', state: 'Lagos', lgas: 'Ikeja', costEstimate: 9_000_000 },
    ]);
    const p = await preview(body);
    assert.equal(p.list.stateCode, 'KN');
    assert.equal(p.list.approvedOn, '2025-10-21');
    assert.equal(p.list.title, 'Approved BEAP 2026: Kano State');
    assert.equal(p.canConfirm, false);
    assert.deepEqual((p.issues as Array<{ code: string; row: number }>).map((i) => [i.code, i.row]), [['STATE_NOT_ON_BEAP', 5]]);

    const notXlsx = await request(app)
      .post(`${BASE}/import/preview`)
      .set(await as(ADMIN))
      .send({ fileBase64: Buffer.from('hello').toString('base64'), fileName: 'x.xlsx' });
    assert.equal(notXlsx.status, 200);
    assert.equal(notXlsx.body.data.issues[0].code, 'WORKBOOK_UNREADABLE');
    assert.equal(notXlsx.body.data.canConfirm, false);
  });
});
