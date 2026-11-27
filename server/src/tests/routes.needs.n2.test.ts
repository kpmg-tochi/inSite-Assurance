/**
 * Needs pipeline wave 2 (N2): costing standards, design standard documents and the Standards page,
 * against the seeded database (the UBEC tenant has costing standard v1 = DEFAULT_COSTING_STANDARD,
 * unlocked).
 * - any web user reads; only `standards:manage` writes; a mobile token is refused;
 * - Excel round trip: the template of the latest version re-uploads unchanged (no changes), a changed
 *   rate is shown and saved in place while the version is unlocked; once locked a save is the next
 *   version and the locked one cannot be edited; sha256 binding; row issues refuse the file;
 * - design standard documents: presign → upload → register → listed → link; supersede;
 * - the Standards overview: essential facility groups of both programmes, the form library without
 *   archived components; another tenant sees none of UBEC's standards.
 */
import { resetTestDatabase } from './helpers/testDb';
import { makeTestDeviceKey } from './helpers/fieldAuth';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import type { Express } from 'express';
import request from 'supertest';
import {
  COSTING_STANDARD_TEMPLATE_VERSION,
  CostingStandardImportPreviewDtoSchema,
  CostingStandardSaveResultDtoSchema,
  CostingStandardSchema,
  CostingStandardVersionDtoSchema,
  CostingStandardVersionSummaryDtoSchema,
  DEFAULT_COSTING_STANDARD,
  DesignStandardDocumentDtoSchema,
  NeedsFileLinkDtoSchema,
  StandardsOverviewDtoSchema,
  type CostingStandardImportPreviewDto,
  type StandardsOverviewDto,
} from '@insite/shared';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let costing: typeof import('../modules/standards/costingStandards.service');
let ubecTenantId: string;
let v1Id: string;

const PASSWORD = 'Password123!';
const READER = 'me.officer@ubec.test';
const QS = 'qs@ubec.test';
const DPP = 'dpp@ubec.test';
const OTHER_TENANT = 'admin@insite.ng';
const CS = '/api/v1/costing-standards';
const ST = '/api/v1/standards';

const tokens: Record<string, string> = {};
async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, `${email}: ${JSON.stringify(res.body)}`);
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

const binary = (r: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  r.on('data', (d: Buffer) => chunks.push(d));
  r.on('end', () => cb(null, Buffer.concat(chunks)));
};

async function template(email: string): Promise<{ buffer: Buffer; disposition: string }> {
  const res = await request(app)
    .get(`${CS}/template`)
    .set(await web(email))
    .buffer(true)
    .parse(binary as never);
  assert.equal(res.status, 200, String(res.body));
  assert.match(String(res.headers['content-type']), /spreadsheetml/);
  return { buffer: res.body as Buffer, disposition: String(res.headers['content-disposition']) };
}

/** Loads a workbook, lets `edit` change it, writes it back. */
async function edited(buffer: Buffer, edit: (wb: ExcelJS.Workbook) => void): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  edit(wb);
  return Buffer.from((await wb.xlsx.writeBuffer()) as ArrayBuffer);
}

/** The Rates sheet row (spreadsheet row number) holding an item code. */
function rateRow(wb: ExcelJS.Workbook, itemCode: string): number {
  const ws = wb.getWorksheet('Rates')!;
  for (let r = 4; r <= ws.rowCount; r++) if (ws.getCell(r, 1).value === itemCode) return r;
  throw new Error(`${itemCode} not on the Rates sheet`);
}

async function preview(email: string, buffer: Buffer, fileName = 'costing.xlsx'): Promise<CostingStandardImportPreviewDto> {
  const res = await request(app)
    .post(`${CS}/import/preview`)
    .set(await web(email))
    .send({ fileBase64: buffer.toString('base64'), fileName });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return CostingStandardImportPreviewDtoSchema.parse(res.body.data);
}

async function overview(email: string): Promise<StandardsOverviewDto> {
  const res = await request(app).get(ST).set(await web(email));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return StandardsOverviewDtoSchema.parse(res.body.data);
}

const versionCount = () => prisma.costingStandardVersion.count({ where: { tenantId: ubecTenantId } });
const auditCount = (action: 'COSTING_STANDARD_SAVED' | 'DESIGN_STANDARD_DOCUMENT_ADDED') =>
  prisma.auditLog.count({ where: { tenantId: ubecTenantId, action } });

/** Presigned upload through the app (local-disk storage in tests); returns the object key. */
async function upload(email: string, fileName: string, mimeType: string, bytes: Buffer): Promise<string> {
  const presign = await request(app)
    .post(`${ST}/design-documents/presign`)
    .set(await web(email))
    .send({ fileName, mimeType, byteSize: bytes.length });
  assert.equal(presign.status, 200, JSON.stringify(presign.body));
  assert.match(presign.body.data.objectKey, new RegExp(`^tenants/${ubecTenantId}/standards/design_document/`));
  const url = new URL(presign.body.data.uploadUrl);
  const put = await request(app).put(url.pathname + url.search).set('Content-Type', mimeType).send(bytes);
  assert.equal(put.status, 200, JSON.stringify(put.body));
  return presign.body.data.objectKey as string;
}

const pdf = (text: string) => Buffer.from(`%PDF-1.4\n% ${text}\n%%EOF\n`);

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  costing = await import('../modules/standards/costingStandards.service');
  const { createApp } = await import('../app');
  app = createApp();
  ubecTenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } })).id;
  v1Id = (await prisma.costingStandardVersion.findFirstOrThrow({ where: { tenantId: ubecTenantId, version: 1 } })).id;
});

after(async () => {
  await prisma?.$disconnect();
});

describe('N2 reads: any web user', () => {
  it('a reader sees the seeded costing standard v1 on the Standards page and the costing routes', async () => {
    const o = await overview(READER);
    assert.equal(o.costing.current?.version, 1);
    assert.equal(o.costing.current?.isLocked, false);
    assert.equal(o.costing.current?.isLatest, true);
    assert.deepEqual(o.costing.current?.standard, CostingStandardSchema.parse(DEFAULT_COSTING_STANDARD));
    assert.equal(o.costing.versions.length, 1);
    assert.equal(o.costing.versions[0].rateCount, DEFAULT_COSTING_STANDARD.rates!.length);
    assert.equal(o.costing.versions[0].cycleCount, 0);

    const h = await web(READER);
    const list = await request(app).get(CS).set(h);
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.data.map((v: unknown) => CostingStandardVersionSummaryDtoSchema.parse(v).version), [1]);
    const current = await request(app).get(`${CS}/current`).set(h);
    assert.equal(CostingStandardVersionDtoSchema.parse(current.body.data).id, v1Id);
    const one = await request(app).get(`${CS}/${v1Id}`).set(h);
    assert.equal(one.status, 200);
    assert.equal((await request(app).get(`${CS}/${crypto.randomUUID()}`).set(h)).status, 404);
    assert.equal((await request(app).get(`${CS}/not-a-uuid`).set(h)).status, 404);
    // Any web user may download the template too.
    const t = await template(READER);
    assert.ok(t.buffer.length > 1000);
  });

  it('the essential facility groups of both programmes, from the live type config', async () => {
    const o = await overview(READER);
    const names = o.design.essentialGroups.map((g) => g.projectTypeName).sort();
    assert.deepEqual(names, ['Direct Intervention', 'Matching Grants']);
    for (const p of o.design.essentialGroups) {
      assert.deepEqual(p.groups.map((g) => g.label), ['Toilets', 'Water', 'Solar'], p.projectTypeName);
      const water = p.groups.find((g) => g.label === 'Water')!;
      assert.deepEqual(water.facilityCodes, ['BOREHOLE', 'OVERHEAD_TANK']);
      assert.equal(water.facilityNames.length, 2);
      assert.ok(water.facilityNames.every((n) => n && n !== 'BOREHOLE' && n !== 'OVERHEAD_TANK'), 'facility names from the catalogue');
    }
  });

  it('monitoring standards: the form library without archived components', async () => {
    const template = await prisma.visitFormTemplate.findFirstOrThrow({ where: { tenantId: ubecTenantId, isArchived: false }, orderBy: { version: 'desc' } });
    await prisma.visitFormTemplate.update({ where: { id: template.id }, data: { isArchived: true } });
    try {
      const o = await overview(READER);
      assert.ok(o.monitoring.templates.length > 0);
      assert.ok(o.monitoring.sections.length > 0);
      assert.ok(o.monitoring.archetypeSubForms.length > 0);
      assert.ok(!o.monitoring.templates.some((t) => t.code === template.code), 'archived template left out');
      for (const list of [o.monitoring.templates, o.monitoring.sections, o.monitoring.archetypeSubForms, o.monitoring.facilitySubForms]) {
        assert.ok(list.every((c) => !c.isArchived));
      }
      assert.ok(o.monitoring.facilities.every((f) => !f.isRetired));
    } finally {
      await prisma.visitFormTemplate.update({ where: { id: template.id }, data: { isArchived: false } });
    }
    const o = await overview(READER);
    assert.ok(o.monitoring.templates.some((t) => t.code === template.code));
  });

  it('a reader cannot write; a mobile token is refused', async () => {
    const h = await web(READER);
    const body = { standard: DEFAULT_COSTING_STANDARD };
    assert.equal((await request(app).post(CS).set(h).send(body)).status, 403);
    assert.equal((await request(app).put(`${CS}/${v1Id}`).set(h).send(body)).status, 403);
    assert.equal((await request(app).post(`${CS}/import/preview`).set(h).send({ fileBase64: 'AAAA' })).status, 403);
    assert.equal((await request(app).post(`${CS}/import/confirm`).set(h).send({ fileBase64: 'AAAA', sha256: 'a'.repeat(64) })).status, 403);
    assert.equal(
      (await request(app).post(`${ST}/design-documents/presign`).set(h).send({ fileName: 'a.pdf', mimeType: 'application/pdf', byteSize: 10 })).status,
      403
    );
    assert.equal((await request(app).post(`${ST}/design-documents`).set(h).send({ objectKey: 'x', kind: 'OTHER', title: 'Drawing' })).status, 403);
    assert.equal((await request(app).get(ST)).status, 401);

    const key = makeTestDeviceKey();
    const login = await request(app).post('/api/v1/auth/mobile/login').send({
      email: 'resident.supervisor@ubec.test',
      password: PASSWORD,
      deviceId: 'n2-phone',
      deviceModel: 'Pixel 8',
      deviceOs: 'Android 15',
      devicePublicKey: key.publicKey,
      devicePublicKeyAlg: 'ED25519',
    });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    const mobile = { Authorization: `Bearer ${login.body.data.accessToken as string}` };
    assert.equal((await request(app).get(ST).set(mobile)).status, 403);
    assert.equal((await request(app).get(CS).set(mobile)).status, 403);
    assert.equal((await request(app).get(`${CS}/template`).set(mobile)).status, 403);
  });
});

describe('N2 costing standard: Excel round trip and the save rule', () => {
  it('the template is the latest version with the version stamp, dropdown lists and UBEC file name', async () => {
    const { buffer, disposition } = await template(QS);
    assert.match(disposition, /UBEC costing standard v1\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    assert.deepEqual(
      wb.worksheets.map((w) => w.name),
      ['Instructions', 'Rates', 'Zone factors', 'Settings', 'Ceilings', 'Lists']
    );
    assert.equal(wb.getWorksheet('Instructions')!.getCell('B4').value, COSTING_STANDARD_TEMPLATE_VERSION);
    assert.equal(wb.getWorksheet('Instructions')!.getCell('B5').value, 'Version 1');
    assert.equal(wb.getWorksheet('Lists')!.state, 'hidden');
    const rates = wb.getWorksheet('Rates')!;
    assert.deepEqual(
      [1, 2, 3, 4, 5].map((c) => rates.getCell(3, c).value),
      ['Item code', 'Description', 'Facility code', 'Unit', 'Rate (₦)']
    );
    assert.equal(rates.getCell(rateRow(wb, 'CLS-NEW'), 5).value, 9_500_000);
    assert.equal(rates.getCell(4, 3).dataValidation?.type, 'list');
    assert.equal(wb.getWorksheet('Zone factors')!.getCell(4, 1).value, 'NC');
  });

  it('re-uploading the template unchanged previews no changes and writes nothing', async () => {
    const { buffer } = await template(QS);
    const versions = await versionCount();
    const audits = await auditCount('COSTING_STANDARD_SAVED');
    const p = await preview(QS, buffer);
    assert.deepEqual(p.issues, []);
    assert.equal(p.sha256, crypto.createHash('sha256').update(buffer).digest('hex'));
    assert.deepEqual(p.standard, CostingStandardSchema.parse(DEFAULT_COSTING_STANDARD));
    assert.deepEqual(p.changes, { added: [], changed: [], removed: [], settingsChanged: false });
    assert.equal(p.targetVersion, 1);
    assert.equal(p.editsLatestInPlace, true);
    assert.equal(await versionCount(), versions);
    assert.equal(await auditCount('COSTING_STANDARD_SAVED'), audits);
  });

  it('a changed rate is shown and, while v1 is unlocked, saved into v1 in place (audited on the tenant ledger)', async () => {
    const { buffer } = await template(DPP);
    const changed = await edited(buffer, (wb) => {
      wb.getWorksheet('Rates')!.getCell(rateRow(wb, 'CLS-NEW'), 5).value = 9_800_000;
      wb.getWorksheet('Settings')!.getCell(5, 2).value = 7.5;
    });
    const p = await preview(DPP, changed, 'UBEC rates 2027.xlsx');
    assert.deepEqual(p.issues, []);
    assert.deepEqual(p.changes?.changed, [{ itemCode: 'CLS-NEW', fromRateNgn: 9_500_000, toRateNgn: 9_800_000 }]);
    assert.equal(p.changes?.settingsChanged, true);

    // Another file than the one previewed.
    const other = await request(app)
      .post(`${CS}/import/confirm`)
      .set(await web(DPP))
      .send({ fileBase64: changed.toString('base64'), fileName: 'UBEC rates 2027.xlsx', sha256: 'f'.repeat(64) });
    assert.equal(other.status, 409);
    assert.equal(other.body.error?.code ?? other.body.code, 'COSTING_STANDARD_FILE_CHANGED', JSON.stringify(other.body));

    const res = await request(app)
      .post(`${CS}/import/confirm`)
      .set(await web(DPP))
      .send({ fileBase64: changed.toString('base64'), fileName: 'UBEC rates 2027.xlsx', sha256: p.sha256, note: 'New classroom rate' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const saved = CostingStandardSaveResultDtoSchema.parse(res.body.data);
    assert.equal(saved.createdNewVersion, false);
    assert.equal(saved.version.id, v1Id);
    assert.equal(saved.version.version, 1);
    assert.equal(saved.version.note, 'New classroom rate');
    assert.equal(saved.version.standard.rates.find((r) => r.itemCode === 'CLS-NEW')?.rateNgn, 9_800_000);
    assert.equal(saved.version.standard.contingencyPct, 7.5);
    assert.equal(await versionCount(), 1);

    const entry = await prisma.auditLog.findFirstOrThrow({ where: { tenantId: ubecTenantId, action: 'COSTING_STANDARD_SAVED' }, orderBy: { seq: 'desc' } });
    assert.equal(entry.projectId, null);
    const payload = entry.payload as Record<string, unknown>;
    assert.equal(payload.version, 1);
    assert.equal(payload.created, false);
    assert.equal(payload.source, 'FILE');
    assert.equal(payload.sha256, p.sha256);
    assert.equal(payload.fileName, 'UBEC rates 2027.xlsx');
    assert.match(entry.summaryText, /Edited costing standard version 1 from "UBEC rates 2027.xlsx"/);
  });

  it('a file with an unknown facility code and a bad rate lists its issues and is refused on confirm', async () => {
    const { buffer } = await template(QS);
    const bad = await edited(buffer, (wb) => {
      const ws = wb.getWorksheet('Rates')!;
      ws.getCell(rateRow(wb, 'TLT-NEW'), 3).value = 'SPACESHIP';
      ws.getCell(rateRow(wb, 'FNC-BLK'), 5).value = 'n/a';
      // Main thread (wave 2 merge): text that only contains a number is not a rate ("about 85k" is not ₦85).
      ws.getCell(rateRow(wb, 'DRN-CONC'), 5).value = 'about 85k';
      // A text amount with a currency sign and separators still reads.
      ws.getCell(rateRow(wb, 'BRD-MAG'), 5).value = '₦ 120,000';
      wb.getWorksheet('Ceilings')!.getCell(4, 2).value = 'Demolition';
    });
    const versions = await versionCount();
    const bad0 = await loaded(bad);
    const p = await preview(QS, bad);
    assert.equal(p.standard, null);
    assert.equal(p.changes, null);
    const facility = p.issues.find((i) => i.column === 'Facility code');
    assert.equal(facility?.sheet, 'Rates');
    assert.equal(facility?.row, rateRow(await loaded(bad), 'TLT-NEW'));
    assert.match(facility!.reason, /SPACESHIP/);
    const rate = p.issues.find((i) => i.column === 'Rate (₦)');
    assert.match(rate!.reason, /"n\/a"/);
    const rateIssues = p.issues.filter((i) => i.column === 'Rate (₦)');
    assert.ok(rateIssues.some((i) => i.row === rateRow(bad0, 'DRN-CONC') && /about 85k/.test(i.reason)), 'a word with a number in it is refused');
    assert.ok(!rateIssues.some((i) => i.row === rateRow(bad0, 'BRD-MAG')), '"₦ 120,000" is read as an amount');
    assert.ok(p.issues.some((i) => i.sheet === 'Ceilings' && i.row === 4 && /Demolition/.test(i.reason)));

    const res = await request(app)
      .post(`${CS}/import/confirm`)
      .set(await web(QS))
      .send({ fileBase64: bad.toString('base64'), sha256: p.sha256 });
    assert.equal(res.status, 422);
    assert.equal(res.body.error?.code ?? res.body.code, 'COSTING_STANDARD_IMPORT_INVALID', JSON.stringify(res.body));
    assert.equal(await versionCount(), versions);

    // Not a workbook at all; another template.
    const junk = await preview(QS, Buffer.from('not a spreadsheet'));
    assert.equal(junk.standard, null);
    assert.match(junk.issues[0].reason, /not an \.xlsx file/);
    const otherTemplate = await edited(buffer, (wb) => (wb.getWorksheet('Instructions')!.getCell('B4').value = 'INSITE-APPROVED-LIST-v1'));
    assert.match((await preview(QS, otherTemplate)).issues[0].reason, /another template/);
  });

  it('once v1 is locked, a save makes v2 and v1 cannot be edited; v2 is edited in place until it is locked', async () => {
    await prisma.costingStandardVersion.update({ where: { id: v1Id }, data: { isLocked: true } });
    const h = await web(DPP);
    const standard = CostingStandardSchema.parse(DEFAULT_COSTING_STANDARD);
    standard.rates.push({ itemCode: 'LAB-NEW', description: 'New science laboratory', facilityCode: 'CLASSROOM', unitOfMeasure: 'nr', rateNgn: 18_000_000 });

    const { buffer } = await template(DPP);
    const p = await preview(DPP, buffer);
    assert.equal(p.targetVersion, 2);
    assert.equal(p.editsLatestInPlace, false);

    const save = await request(app).post(CS).set(h).send({ standard, note: 'Laboratories added' });
    assert.equal(save.status, 201, JSON.stringify(save.body));
    const v2 = CostingStandardSaveResultDtoSchema.parse(save.body.data);
    assert.equal(v2.createdNewVersion, true);
    assert.equal(v2.version.version, 2);
    assert.equal(v2.version.isLocked, false);
    assert.equal(v2.version.isLatest, true);

    const locked = await request(app).put(`${CS}/${v1Id}`).set(h).send({ standard });
    assert.equal(locked.status, 409);
    assert.equal(locked.body.error?.code ?? locked.body.code, 'COSTING_STANDARD_LOCKED');
    // v1 is unchanged and no longer the latest.
    const v1 = CostingStandardVersionDtoSchema.parse((await request(app).get(`${CS}/${v1Id}`).set(h)).body.data);
    assert.equal(v1.isLatest, false);
    assert.equal(v1.isLocked, true);
    assert.ok(!v1.standard.rates.some((r) => r.itemCode === 'LAB-NEW'));

    standard.rates[standard.rates.length - 1].rateNgn = 18_500_000;
    const edit = await request(app).put(`${CS}/${v2.version.id}`).set(h).send({ standard });
    assert.equal(edit.status, 200, JSON.stringify(edit.body));
    const editedV2 = CostingStandardSaveResultDtoSchema.parse(edit.body.data);
    assert.equal(editedV2.createdNewVersion, false);
    assert.equal(editedV2.version.id, v2.version.id);
    assert.equal(editedV2.version.standard.rates.find((r) => r.itemCode === 'LAB-NEW')?.rateNgn, 18_500_000);

    // The helper the needs module calls when a cycle opens with a version.
    await prisma.$transaction((tx) => costing.lockCostingStandardVersionInTx(tx, v2.version.id));
    const latest = await costing.getLatestCostingStandard(ubecTenantId);
    assert.equal(latest?.version, 2);
    assert.equal((await request(app).put(`${CS}/${v2.version.id}`).set(h).send({ standard })).status, 409);
    const p3 = await preview(DPP, (await template(DPP)).buffer);
    assert.equal(p3.targetVersion, 3);
    assert.match((await template(DPP)).disposition, /UBEC costing standard v2\.xlsx/);

    const list = (await request(app).get(CS).set(h)).body.data as Array<{ version: number; isLocked: boolean; isLatest: boolean }>;
    assert.deepEqual(list.map((v) => [v.version, v.isLocked, v.isLatest]), [
      [2, true, true],
      [1, true, false],
    ]);

    // A JSON save naming a facility outside the catalogue.
    const unknown = CostingStandardSchema.parse({ ...standard, rates: [{ ...standard.rates[0], facilityCode: 'SPACESHIP' }] });
    const refused = await request(app).post(CS).set(h).send({ standard: unknown });
    assert.equal(refused.status, 422);
    assert.equal(refused.body.error?.code ?? refused.body.code, 'UNKNOWN_FACILITY_CODE');

    const entries = await prisma.auditLog.findMany({ where: { tenantId: ubecTenantId, action: 'COSTING_STANDARD_SAVED' }, orderBy: { seq: 'asc' } });
    assert.deepEqual(
      entries.map((e) => [(e.payload as { version: number }).version, (e.payload as { created: boolean }).created, e.projectId]),
      [
        [1, false, null],
        [2, true, null],
        [2, false, null],
      ]
    );
  });
});

async function loaded(buffer: Buffer): Promise<ExcelJS.Workbook> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb;
}

describe('N2 design standard documents', () => {
  let firstId: string;

  it('presign → upload → register → listed on the Standards page → link', async () => {
    const bytes = pdf('Standard toilet block drawing');
    const objectKey = await upload(DPP, 'Toilet block drawing.pdf', 'application/pdf', bytes);
    const audits = await auditCount('DESIGN_STANDARD_DOCUMENT_ADDED');
    const res = await request(app)
      .post(`${ST}/design-documents`)
      .set(await web(DPP))
      .send({ objectKey, kind: 'STANDARD_DRAWING', title: '4-compartment toilet block', facilityCodes: ['toilet'] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const doc = DesignStandardDocumentDtoSchema.parse(res.body.data);
    firstId = doc.id;
    assert.deepEqual(doc.facilityCodes, ['TOILET']);
    assert.equal(doc.byteSize, bytes.length);
    assert.equal(doc.sha256, crypto.createHash('sha256').update(bytes).digest('hex'));
    assert.equal(doc.fileName, 'Toilet_block_drawing.pdf');
    assert.equal(doc.isCurrent, true);
    assert.equal(await auditCount('DESIGN_STANDARD_DOCUMENT_ADDED'), audits + 1);

    // The same file twice.
    const again = await request(app)
      .post(`${ST}/design-documents`)
      .set(await web(DPP))
      .send({ objectKey, kind: 'STANDARD_DRAWING', title: 'Again' });
    assert.equal(again.status, 409);

    const o = await overview(READER);
    assert.deepEqual(o.design.documents.map((d) => d.id), [doc.id]);

    const link = await request(app).get(`${ST}/design-documents/${doc.id}/file?format=json`).set(await web(READER));
    assert.equal(link.status, 200, JSON.stringify(link.body));
    const l = NeedsFileLinkDtoSchema.parse(link.body.data);
    assert.equal(l.fileName, 'Toilet_block_drawing.pdf');
    assert.equal(l.expiresInSeconds, 300);
    const u = new URL(l.url);
    const got = await request(app).get(u.pathname + u.search).buffer(true).parse(binary as never);
    assert.equal(got.status, 200);
    assert.deepEqual(got.body, bytes);

    const redirect = await request(app).get(`${ST}/design-documents/${doc.id}/file`).set(await web(READER));
    assert.equal(redirect.status, 302);
    assert.ok(String(redirect.headers.location).includes('/api/v1/storage/local-dev/'));
  });

  it('refuses unknown facility codes, foreign keys and types outside the policy', async () => {
    const h = await web(QS);
    const objectKey = await upload(QS, 'spec.pdf', 'application/pdf', pdf('spec'));
    const unknown = await request(app).post(`${ST}/design-documents`).set(h).send({ objectKey, kind: 'SPECIFICATION', title: 'Specification', facilityCodes: ['SPACESHIP'] });
    assert.equal(unknown.status, 422);
    assert.equal(unknown.body.error?.code ?? unknown.body.code, 'UNKNOWN_FACILITY_CODE');
    const foreign = await request(app)
      .post(`${ST}/design-documents`)
      .set(h)
      .send({ objectKey: `tenants/${crypto.randomUUID()}/standards/design_document/x.pdf`, kind: 'OTHER', title: 'Foreign' });
    assert.equal(foreign.status, 400);
    const exe = await request(app).post(`${ST}/design-documents/presign`).set(h).send({ fileName: 'x.exe', mimeType: 'application/x-msdownload', byteSize: 10 });
    assert.equal(exe.status, 415);
    const missing = await request(app)
      .post(`${ST}/design-documents`)
      .set(h)
      .send({ objectKey: `tenants/${ubecTenantId}/standards/design_document/1-${crypto.randomUUID()}-nothing.pdf`, kind: 'OTHER', title: 'Nothing' });
    assert.equal(missing.status, 422);
  });

  it('a new version supersedes the current document; a superseded one cannot be superseded again', async () => {
    const h = await web(DPP);
    const objectKey = await upload(DPP, 'Toilet block drawing rev B.pdf', 'application/pdf', pdf('rev B'));
    const res = await request(app)
      .post(`${ST}/design-documents`)
      .set(h)
      .send({ objectKey, kind: 'STANDARD_DRAWING', title: '4-compartment toilet block (rev B)', facilityCodes: ['TOILET'], supersedesId: firstId });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const revB = DesignStandardDocumentDtoSchema.parse(res.body.data);
    assert.equal(revB.supersedesId, firstId);

    const docs = (await overview(READER)).design.documents;
    assert.deepEqual(
      docs.filter((d) => d.id === revB.id || d.id === firstId).map((d) => [d.id, d.isCurrent]),
      [
        [revB.id, true],
        [firstId, false],
      ]
    );

    const key2 = await upload(DPP, 'rev C.pdf', 'application/pdf', pdf('rev C'));
    const twice = await request(app).post(`${ST}/design-documents`).set(h).send({ objectKey: key2, kind: 'STANDARD_DRAWING', title: 'Rev C', supersedesId: firstId });
    assert.equal(twice.status, 409);
    assert.equal(twice.body.error?.code ?? twice.body.code, 'DESIGN_STANDARD_DOCUMENT_SUPERSEDED');
    const nowhere = await request(app).post(`${ST}/design-documents`).set(h).send({ objectKey: key2, kind: 'STANDARD_DRAWING', title: 'Rev C', supersedesId: crypto.randomUUID() });
    assert.equal(nowhere.status, 404);
  });
});

describe('N2 tenant isolation', () => {
  it("another tenant's user sees none of UBEC's standards", async () => {
    const h = await web(OTHER_TENANT);
    assert.deepEqual((await request(app).get(CS).set(h)).body.data, []);
    assert.equal((await request(app).get(`${CS}/current`).set(h)).body.data, null);
    assert.equal((await request(app).get(`${CS}/${v1Id}`).set(h)).status, 404);
    const ubecDoc = await prisma.designStandardDocument.findFirstOrThrow({ where: { tenantId: ubecTenantId } });
    assert.equal((await request(app).get(`${ST}/design-documents/${ubecDoc.id}/file?format=json`).set(h)).status, 404);
    const o = await overview(OTHER_TENANT);
    assert.equal(o.costing.current, null);
    assert.deepEqual(o.costing.versions, []);
    assert.deepEqual(o.design.documents, []);
    assert.deepEqual(o.design.essentialGroups, []);
    // Its blank template (no version yet).
    const { disposition, buffer } = await template(OTHER_TENANT);
    assert.match(disposition, /"Costing standard\.xlsx"/);
    const wb = await loaded(buffer);
    assert.equal(wb.getWorksheet('Instructions')!.getCell('B5').value, 'No version yet (blank)');
    assert.equal(wb.getWorksheet('Rates')!.getCell(4, 1).value, null);
  });
});
