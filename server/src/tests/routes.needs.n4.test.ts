/**
 * Needs pipeline wave 3, Track A (N4): stage work through /api/v1/needs on the seeded UBEC tenant
 * (normal seed: DI = CENTRAL, MG = CO_FUNDED; people of `seedUbecRoster`). Suites follow the wave
 * file's rows A1–A8; the steps of the file continue from one another.
 *
 * Walk: dpp@ opens the 2027 DI cycle and kano.dpp@ the Kano 2027 MG cycle; procurement@ uploads
 * 2027-DI-001 (di-draft-valid), -002 (essential-gap), -003 (duplicate of 001), -004 (v1 workbook),
 * -005 (missing-sm-line), -006 (rate-variance); later -007 (batch-3). kano.procurement@ uploads
 * 2027-MG-KN-001. Validation by me.officer@, design by procurement@, costing by qs@, the committee
 * rows are written directly (Track B owns the committee routes).
 */
import { resetTestDatabase } from './helpers/testDb';
import { clearSeededNeedsPipeline } from './helpers/needsSeedReset';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import ExcelJS from 'exceljs';
import type { Express } from 'express';
import request from 'supertest';
import {
  NeedsDecisionResultDtoSchema,
  NeedsProposalDetailDtoSchema,
  NeedsProposalSummaryDtoSchema,
  NeedsTaskDtoSchema,
  ParsedNeedsAssessmentSchema,
  XLSX_CONTENT_TYPE,
  type SeparationOverrideDetails,
} from '@insite/shared';
import { needsFixture, type NeedsFixtureName } from './fixtures/needs/needsFixtures';
import { buildFixtureFile } from './fixtures/needs/generateNeedsFixtures';
import { BATCH_SPECS, FIXTURE_SPECS, FIXTURE_STANDARD, stdRate, type FixtureLine, type NeedsFixtureSpec } from './fixtures/needs/needsFixtureSpecs';
import { compareVersions, reopenAfterChange } from '../modules/needs/decisions/versionChange';
import { authorisationFor, type OverrideFlagFact } from '../modules/needs/decisions/proposalRules';

type PrismaClientType = typeof import('../config/prisma')['prisma'];
type Outbox = typeof import('../integrations/messaging')['consoleOutbox'];

let app: Express;
let prisma: PrismaClientType;
/** The seed's pipeline ledger entries end here (wave 5): tenant-wide counts read after it. */
let ledgerFloor = BigInt(0);
let outbox: Outbox;
let jobs: typeof import('../jobs');
let storage: typeof import('../integrations/storage.service')['storageService'];
let clearAuthCache: () => void;

const PASSWORD = 'Password123!';
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
let tenantId = '';

const DPP = 'dpp@ubec.test';
const PROCUREMENT = 'procurement@ubec.test';
const ME = 'me.officer@ubec.test';
const QS = 'qs@ubec.test';
const ES = 'es@ubec.test';
const KANO_DPP = 'kano.dpp@ubec.test';
const KANO_PROCUREMENT = 'kano.procurement@ubec.test';
const KANO_ADMIN = 'kano.admin@ubec.test';
const N = '/api/v1/needs';

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: PASSWORD });
    assert.equal(res.status, 200, `${email}: ${JSON.stringify(res.body)}`);
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');

async function uploadFiles(email: string, cycleId: string, files: Array<{ fileName: string; buffer: Buffer; proposalId: string | null }>) {
  const body = files.map((f) => ({ fileName: f.fileName, fileBase64: f.buffer.toString('base64'), proposalId: f.proposalId }));
  const preview = await request(app).post(`${N}/cycles/${cycleId}/uploads/preview`).set(await web(email)).send({ files: body });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const confirm = await request(app)
    .post(`${N}/cycles/${cycleId}/uploads/confirm`)
    .set(await web(email))
    .send({ files: body.map((f, i) => ({ ...f, sha256: sha(files[i].buffer) })) });
  return { preview, confirm };
}
const fixtureFile = (name: NeedsFixtureName, proposalId: string | null = null) => ({ fileName: `${name}.xlsx`, buffer: needsFixture(name), proposalId });

const action = async (email: string, cycleId: string, act: 'SUBMIT' | 'RESUBMIT' | 'WITHDRAW', proposalIds: string[], reason: string | null = null) =>
  request(app).post(`${N}/cycles/${cycleId}/proposal-actions`).set(await web(email)).send({ action: act, proposalIds, reason });

const decide = async (email: string, cycleId: string, body: Record<string, unknown>) => request(app).post(`${N}/cycles/${cycleId}/decisions`).set(await web(email)).send(body);

async function proposalDocument(email: string, cycleId: string, proposalId: string, kind: string, title: string): Promise<string> {
  const auth = await web(email);
  const pdf = Buffer.from(`%PDF-1.4\n% ${title} ${crypto.randomUUID()}\n%%EOF\n`);
  const presign = await request(app).post(`${N}/cycles/${cycleId}/documents/presign`).set(auth).send({ fileName: `${title}.pdf`, mimeType: 'application/pdf', byteSize: pdf.length });
  assert.equal(presign.status, 200, JSON.stringify(presign.body));
  const target = new URL(presign.body.data.uploadUrl);
  assert.equal((await request(app).put(target.pathname + target.search).set('Content-Type', 'application/pdf').send(pdf)).status, 200);
  const doc = await request(app).post(`${N}/proposals/${proposalId}/documents`).set(auth).send({ objectKey: presign.body.data.objectKey, kind, title });
  assert.equal(doc.status, 201, JSON.stringify(doc.body));
  return doc.body.data.id as string;
}

async function validationBody(email: string, cycleId: string, proposalId: string, extra: Record<string, unknown> = {}) {
  return {
    outcome: 'ADVANCE',
    deskNotes: 'Needs confirmed against the school census.',
    siteVerification: {
      method: 'WEB_EVIDENCE',
      verifiedOn: '2026-07-20',
      officerName: 'Ngozi Eze',
      notes: null,
      evidenceDocumentIds: [await proposalDocument(email, cycleId, proposalId, 'SITE_VERIFICATION_EVIDENCE', 'Site verification report')],
    },
    ...extra,
  };
}

async function specFile(name: string, change: (spec: NeedsFixtureSpec) => NeedsFixtureSpec): Promise<Buffer> {
  const spec = [...FIXTURE_SPECS, ...BATCH_SPECS].find((s) => s.name === name)!;
  return buildFixtureFile(change(structuredClone(spec)));
}

function linesForEssentialGap(factor = 1): FixtureLine[] {
  const line = (wbsCode: string, unitId: string, itemCode: string, quantity: number): FixtureLine => {
    const std = FIXTURE_STANDARD.rates.find((r) => r.itemCode === itemCode)!;
    return { wbsCode, unitId, itemCode, description: std.description, unit: std.unitOfMeasure, quantity, rate: Math.round(stdRate(itemCode, 'NI') * factor) };
  };
  return [line('1.01', 'U01', 'CLS-REN', 6), line('2.01', 'U02', 'TLT-NEW', 1), line('3.01', 'U03', 'SOL-5KVA', 1)];
}

const proposal = (key: string) => prisma.needsProposal.findUniqueOrThrow({ where: { id: ids[key] } });
const byRef = (reference: string) => prisma.needsProposal.findFirstOrThrow({ where: { tenantId, reference } });
const tasksOf = async (email: string, query = '') => NeedsTaskDtoSchema.array().parse((await request(app).get(`${N}/tasks${query}`).set(await web(email))).body.data);
const userId = async (email: string) => (await prisma.user.findUniqueOrThrow({ where: { email } })).id;
const sentTo = (from: number, email: string) => outbox.slice(from).filter((m) => m.to === email);

async function readXlsxColumn(objectKey: string, column: number): Promise<string[]> {
  const buffer = await storage.getObjectBuffer(objectKey);
  assert.ok(buffer, 'stored file');
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  const out: string[] = [];
  for (let r = 4; r <= ws.rowCount; r++) out.push(String(ws.getCell(r, column).value ?? ''));
  return out;
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  ({ ledgerFloor } = await clearSeededNeedsPipeline(prisma));
  ({ consoleOutbox: outbox } = await import('../integrations/messaging'));
  ({ storageService: storage } = await import('../integrations/storage.service'));
  ({ clearAuthCache } = await import('../middleware/auth.middleware'));
  jobs = await import('../jobs');
  jobs.registerAllJobs();
  const { createApp } = await import('../app');
  app = createApp();
  tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } })).id;
  const di = (await prisma.projectType.findFirstOrThrow({ where: { tenantId, code: 'CENTRAL' } })).id;
  const mg = (await prisma.projectType.findFirstOrThrow({ where: { tenantId, code: 'CO_FUNDED' } })).id;
  let res = await request(app).post(`${N}/cycles`).set(await web(DPP)).send({ projectTypeId: di, interventionYear: 2027 });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  ids.di = res.body.data.id;
  res = await request(app).post(`${N}/cycles`).set(await web(KANO_DPP)).send({ projectTypeId: mg, interventionYear: 2027, stateCode: 'KN' });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  ids.mg = res.body.data.id;

  const { confirm } = await uploadFiles(PROCUREMENT, ids.di, [
    fixtureFile('di-draft-valid'),
    fixtureFile('essential-gap'),
    fixtureFile('duplicate-of-di-draft'),
    fixtureFile('v1-scope-workbook'),
    fixtureFile('missing-sm-line'),
    fixtureFile('rate-variance'),
  ]);
  assert.equal(confirm.status, 201, JSON.stringify(confirm.body));
  for (let n = 1; n <= 6; n++) ids[`p${n}`] = (await byRef(`2027-DI-00${n}`)).id;
  const mgUpload = await uploadFiles(KANO_PROCUREMENT, ids.mg, [fixtureFile('mg-complete-valid')]);
  assert.equal(mgUpload.confirm.status, 201, JSON.stringify(mgUpload.confirm.body));
  ids.mg1 = (await byRef('2027-MG-KN-001')).id;
});

// ---------------------------------------------------------------------------
// A5 (pure): the change rule
// ---------------------------------------------------------------------------

describe('needs N4 A5: the change rule (pure)', () => {
  const base = ParsedNeedsAssessmentSchema.parse({
    templateVersion: 'INSITE-NEEDS-v2',
    project: { title: 'A' },
    sites: [{ siteNumber: 1, schoolName: 'Government Day Primary School, Bosso', schoolLevel: 'PRIMARY', lgaCode: 'NI-BOSSO', latitude: 9.652, longitude: 6.515 }],
    breakdownRows: [
      {
        unitId: 'U01',
        siteNumber: 1,
        facilityCode: 'CLASSROOM',
        interventionAction: 'RENOVATION',
        existingQuantity: 6,
        existingCondition: 'DILAPIDATED',
        requiredQuantity: 6,
        proposedQuantity: 4,
        unitOfMeasure: 'nr',
        preliminaryCostNgn: 12_800_000,
        technicalJustification: 'Roofs leak.',
        criticality: 'HIGH',
      },
    ],
    boqLines: [{ wbsCode: '1.01', unitId: 'U01', itemCode: 'CLS-REN', description: 'Classroom renovation', unit: 'nr', totalQuantity: 4, rateNgn: 3_200_000, amountNgn: 12_800_000 }],
    costingSummary: { subtotalNgn: 12_800_000, supervisionMonitoringPct: 5, supervisionMonitoringNgn: 640_000, contingencyPct: 5, contingencyNgn: 640_000, totalNgn: 14_080_000 },
  });
  const clone = () => structuredClone(base);

  it('text, typed preliminary costs and the spelling of a school name change nothing', () => {
    const next = clone();
    next.project.title = 'B';
    next.project.justification = 'New words';
    next.breakdownRows[0].preliminaryCostNgn = 99;
    next.breakdownRows[0].technicalJustification = 'Other words';
    next.sites[0].schoolName = 'GOVERNMENT  DAY primary school,  Bosso';
    next.boqLines[0].description = 'Renovation of a classroom';
    assert.deepEqual(compareVersions(base, next), { scope: false, cost: false });
  });

  it('a site (GPS, LGA), a row (facility, action, site) or a proposed quantity is scope; a rate, a quantity on a line or the total is cost', () => {
    const gps = clone();
    gps.sites[0].latitude = 9.7;
    assert.equal(compareVersions(base, gps).scope, true);
    const qty = clone();
    qty.breakdownRows[0].proposedQuantity = 5;
    assert.deepEqual(compareVersions(base, qty), { scope: true, cost: false });
    const action = clone();
    action.breakdownRows[0].interventionAction = 'NEW_CONSTRUCTION';
    assert.equal(compareVersions(base, action).scope, true);
    const rate = clone();
    rate.boqLines[0].rateNgn = 3_400_000;
    assert.deepEqual(compareVersions(base, rate), { scope: false, cost: true });
    const total = clone();
    total.costingSummary!.totalNgn = 14_100_000;
    assert.deepEqual(compareVersions(base, total), { scope: false, cost: true });
  });

  it('scope reopens Validation from Design on, cost reopens Costing after Costing, nothing earlier; scope wins', () => {
    const both = { scope: true, cost: true };
    assert.equal(reopenAfterChange('IDENTIFICATION', both), null);
    assert.equal(reopenAfterChange('VALIDATION', both), null);
    assert.deepEqual(reopenAfterChange('DESIGN', both), { stage: 'VALIDATION', change: 'SCOPE' });
    assert.deepEqual(reopenAfterChange('PRIORITISATION', both), { stage: 'VALIDATION', change: 'SCOPE' });
    assert.equal(reopenAfterChange('COSTING', { scope: false, cost: true }), null);
    assert.deepEqual(reopenAfterChange('PRIORITISATION', { scope: false, cost: true }), { stage: 'COSTING', change: 'COST' });
    assert.equal(reopenAfterChange('APPROVAL', { scope: false, cost: false }), null);
  });

  it('review fix: after an old v1 file (no facilities breakdown) the v2 file that adds the breakdown is no scope change; its sites still compare', () => {
    const v1 = { ...clone(), breakdownRows: [] };
    assert.equal(compareVersions(v1, clone()).scope, false);
    const moved = clone();
    moved.sites[0].lgaCode = 'NI-CHANCHAGA';
    assert.equal(compareVersions(v1, moved).scope, true);
  });
});

// ---------------------------------------------------------------------------
// A7 (first look) and A1
// ---------------------------------------------------------------------------

describe('needs N4 A7: the task queue on drafts', () => {
  it('Procurement sees "Submit for validation" on each draft, with the stage deadline; the validator nothing; another organisation only its own cycle; the count matches', async () => {
    const mine = await tasksOf(PROCUREMENT);
    assert.deepEqual(
      mine.map((t) => [t.reference, t.kind, t.actionLabel]),
      ['001', '002', '003', '004', '005', '006'].map((n) => [`2027-DI-${n}`, 'PROPOSAL_ACTION', 'Submit for validation'])
    );
    assert.ok(mine.every((t) => t.dueDate === '2026-05-30' && t.deadlineState === 'OVERDUE' && t.url === `/app/needs-assessment/proposals/${t.proposalId}`));
    assert.equal((await request(app).get(`${N}/tasks/count`).set(await web(PROCUREMENT))).body.data.count, 6);
    assert.deepEqual(await tasksOf(ME), []);
    assert.deepEqual((await tasksOf(KANO_PROCUREMENT)).map((t) => [t.reference, t.actionLabel]), [['2027-MG-KN-001', 'Submit for field verification']]);
    assert.deepEqual(await tasksOf(PROCUREMENT, `?cycleId=${ids.mg}`), [], 'a cycle the viewer cannot write');
    const list = NeedsProposalSummaryDtoSchema.array().parse((await request(app).get(`${N}/cycles/${ids.di}/proposals`).set(await web(PROCUREMENT))).body.data);
    assert.ok(list.every((p) => p.waitingForMe));
    const dpp = NeedsProposalSummaryDtoSchema.array().parse((await request(app).get(`${N}/cycles/${ids.di}/proposals`).set(await web(DPP))).body.data);
    assert.ok(dpp.every((p) => !p.waitingForMe));
  });
});

describe('needs N4 A1: submit, return, resubmit, withdraw (all or nothing)', () => {
  it('a batch with one item short of the minimum fields is refused whole: 422 NEEDS_MINIMUM_FIELDS_MISSING, every problem listed, nothing written', async () => {
    const res = await action(PROCUREMENT, ids.di, 'SUBMIT', [ids.p1, ids.p4]);
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'NEEDS_MINIMUM_FIELDS_MISSING');
    const items = res.body.error.details.items as Array<{ reference: string; code: string; message: string }>;
    assert.deepEqual(items.map((i) => [i.reference, i.code]), [['2027-DI-004', 'NEEDS_MINIMUM_FIELDS_MISSING']]);
    assert.match(items[0].message, /Facilities breakdown|breakdown/i);
    assert.equal((await proposal('p1')).status, 'DRAFT');
    assert.equal(await prisma.auditLog.count({ where: { tenantId, seq: { gt: ledgerFloor }, action: 'NEEDS_PROPOSAL_SUBMITTED' } }), 0);
  });

  it('only the stage actor of the owning organisation acts: another organisation 404, a role without the step 403 or 409 NEEDS_STAGE_ACTION_NOT_ALLOWED', async () => {
    assert.equal((await action(KANO_PROCUREMENT, ids.di, 'SUBMIT', [ids.p1])).status, 404);
    assert.equal((await action(DPP, ids.di, 'SUBMIT', [ids.p1])).status, 403);
    const qs = await action(QS, ids.di, 'SUBMIT', [ids.p1]);
    assert.equal(qs.status, 409, JSON.stringify(qs.body));
    assert.equal(qs.body.error.code, 'NEEDS_STAGE_ACTION_NOT_ALLOWED');
    const other = await action(PROCUREMENT, ids.di, 'SUBMIT', [ids.mg1]);
    assert.equal(other.status, 404, 'a proposal of another cycle');
  });

  it('withdraw needs a reason and closes the proposal WITHDRAWN on the ledger', async () => {
    assert.equal((await action(PROCUREMENT, ids.di, 'WITHDRAW', [ids.p4])).status, 400);
    const res = await action(PROCUREMENT, ids.di, 'WITHDRAW', [ids.p4], 'Replaced by a full needs assessment next year.');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const p4 = await proposal('p4');
    assert.deepEqual([p4.status, p4.statusReason], ['WITHDRAWN', 'Replaced by a full needs assessment next year.']);
    assert.equal(await prisma.auditLog.count({ where: { tenantId, action: 'NEEDS_PROPOSAL_WITHDRAWN', payload: { path: ['proposalId'], equals: ids.p4 } } }), 1);
  });

  it('submit moves the drafts to Validation and emails each validator once, listing the references', async () => {
    await prisma.outboundMessage.deleteMany();
    const mark = outbox.length;
    const res = await action(PROCUREMENT, ids.di, 'SUBMIT', [ids.p1, ids.p2, ids.p3, ids.p5, ids.p6]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const dto = NeedsDecisionResultDtoSchema.parse(res.body.data);
    assert.equal(dto.decisionId, null);
    assert.ok(dto.items.every((i) => i.stage === 'VALIDATION' && i.status === 'IN_PROGRESS' && i.statusLabel === 'Pending validation'));
    const mails = sentTo(mark, ME);
    assert.equal(mails.length, 1);
    assert.match(mails[0].rendered.subject, /5 proposed projects waiting for validation/);
    for (const n of ['001', '002', '003', '005', '006']) assert.match(mails[0].rendered.text, new RegExp(`2027-DI-${n}`));
    assert.equal(sentTo(mark, PROCUREMENT).length, 0, 'not to the person who submitted');
  });

  it('a stage decision refuses a stage without decisions or an outcome it does not take (422), another stage actor (403) and a proposal not waiting there (409)', async () => {
    let res = await decide(ME, ids.di, { stage: 'IDENTIFICATION', items: [{ proposalId: ids.p1, outcome: 'ADVANCE' }] });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'NEEDS_OUTCOME_NOT_ALLOWED');
    res = await decide(ME, ids.di, { stage: 'VALIDATION', items: [{ proposalId: ids.p1, outcome: 'NOT_SELECTED', reason: 'Not a validation outcome' }] });
    assert.equal(res.body.error.code, 'NEEDS_OUTCOME_NOT_ALLOWED');
    res = await decide(QS, ids.di, { stage: 'VALIDATION', items: [{ proposalId: ids.p1, outcome: 'ADVANCE' }] });
    assert.equal(res.status, 403);
    res = await decide(ME, ids.di, { stage: 'VALIDATION', items: [{ proposalId: ids.p4, outcome: 'RETURN', reason: 'Closed already' }] });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'NEEDS_STAGE_ACTION_NOT_ALLOWED');
    assert.equal(await prisma.needsStageDecision.count(), 0);
  });

  it('return keeps the stage and emails the uploader the reason; only the corrector resubmits; resubmitted it is in progress again', async () => {
    await prisma.outboundMessage.deleteMany();
    const mark = outbox.length;
    const reason = 'The supervision and monitoring line is missing from the costing summary.';
    const res = await decide(ME, ids.di, { stage: 'VALIDATION', items: [{ proposalId: ids.p5, outcome: 'RETURN', reason }] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const p5 = await proposal('p5');
    assert.deepEqual([p5.stage, p5.status, p5.statusReason], ['VALIDATION', 'RETURNED', reason]);
    const item = await prisma.needsStageDecisionItem.findFirstOrThrow({ where: { proposalId: ids.p5 } });
    assert.deepEqual([item.outcome, item.toStage, item.toStatus], ['RETURN', 'VALIDATION', 'RETURNED']);
    assert.equal(await prisma.auditLog.count({ where: { tenantId, action: 'NEEDS_PROPOSAL_RETURNED', payload: { path: ['proposalId'], equals: ids.p5 } } }), 1);
    const mails = sentTo(mark, PROCUREMENT);
    assert.equal(mails.length, 1);
    assert.match(mails[0].rendered.subject, /returned to you for correction/);
    assert.match(mails[0].rendered.text, /supervision and monitoring line is missing/);
    assert.deepEqual((await tasksOf(PROCUREMENT)).map((t) => [t.reference, t.actionLabel]), [['2027-DI-005', 'Correct and resubmit']]);

    assert.equal((await action(ME, ids.di, 'RESUBMIT', [ids.p5])).status, 409);
    const again = await action(PROCUREMENT, ids.di, 'RESUBMIT', [ids.p5], 'S&M is added at costing by the QS.');
    assert.equal(again.status, 200, JSON.stringify(again.body));
    assert.deepEqual([(await proposal('p5')).status, (await proposal('p5')).statusReason], ['IN_PROGRESS', null]);
  });
});

// ---------------------------------------------------------------------------
// A2: validation records and flag resolutions
// ---------------------------------------------------------------------------

describe('needs N4 A2: validation records and flag resolutions', () => {
  it('an ADVANCE record needs the site verification (422 NEEDS_SITE_VERIFICATION_REQUIRED) and evidence of the right kinds on this proposal (422 NEEDS_EVIDENCE_INVALID)', async () => {
    let res = await request(app).post(`${N}/proposals/${ids.p1}/validation`).set(await web(ME)).send({ outcome: 'ADVANCE', deskNotes: 'Desk review only, no visit.' });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'NEEDS_SITE_VERIFICATION_REQUIRED');
    const drawing = await proposalDocument(PROCUREMENT, ids.di, ids.p1, 'DRAWING', 'Site plan');
    const body = await validationBody(ME, ids.di, ids.p1);
    res = await request(app)
      .post(`${N}/proposals/${ids.p1}/validation`)
      .set(await web(ME))
      .send({ ...body, siteVerification: { ...body.siteVerification, evidenceDocumentIds: [drawing] } });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'NEEDS_EVIDENCE_INVALID');
    const other = await validationBody(ME, ids.di, ids.p2);
    res = await request(app)
      .post(`${N}/proposals/${ids.p1}/validation`)
      .set(await web(ME))
      .send({ ...body, siteVerification: other.siteVerification });
    assert.equal(res.body.error.code, 'NEEDS_EVIDENCE_INVALID', 'evidence of another proposal');
    assert.equal(await prisma.needsValidationRecord.count(), 0);
  });

  it('an ADVANCE decision needs an ADVANCE record on the current version (409 NEEDS_VALIDATION_RECORD_REQUIRED) and resolved validation flags (409 NEEDS_FLAGS_UNRESOLVED); every problem is listed', async () => {
    const recorded = await request(app).post(`${N}/proposals/${ids.p2}/validation`).set(await web(ME)).send(await validationBody(ME, ids.di, ids.p2));
    assert.equal(recorded.status, 201, JSON.stringify(recorded.body));
    const res = await decide(ME, ids.di, {
      stage: 'VALIDATION',
      items: [
        { proposalId: ids.p1, outcome: 'ADVANCE' },
        { proposalId: ids.p2, outcome: 'ADVANCE' },
      ],
    });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'NEEDS_VALIDATION_RECORD_REQUIRED');
    assert.deepEqual(
      (res.body.error.details.items as Array<{ reference: string; code: string }>).map((i) => [i.reference, i.code]),
      [
        ['2027-DI-001', 'NEEDS_VALIDATION_RECORD_REQUIRED'],
        ['2027-DI-002', 'NEEDS_FLAGS_UNRESOLVED'],
      ]
    );
    assert.equal((await proposal('p2')).stage, 'VALIDATION');
  });

  it('resolutions follow the kind: a gap is justified, a duplicate is not "justified" (422), "not validated" needs that outcome (422), a merge needs an open proposal of the cycle (422); the QS cannot resolve a duplicate (403) and nobody resolves the S&M flag by hand (422)', async () => {
    const gap = await prisma.needsProposalFlag.findFirstOrThrow({ where: { proposalId: ids.p2, kind: 'ESSENTIAL_FACILITY_GAP' } });
    const justified = await request(app)
      .post(`${N}/proposals/${ids.p2}/validation`)
      .set(await web(ME))
      .send(await validationBody(ME, ids.di, ids.p2, { flagResolutions: [{ flagId: gap.id, resolution: 'JUSTIFIED', reason: 'Community borehole 200 m away, functional.' }] }));
    assert.equal(justified.status, 201, JSON.stringify(justified.body));
    assert.deepEqual(justified.body.data.duplicateResolutions.map((r: { resolution: string }) => r.resolution), ['JUSTIFIED']);
    const resolved = await prisma.needsProposalFlag.findUniqueOrThrow({ where: { id: gap.id } });
    assert.deepEqual([resolved.resolution, resolved.resolvedByName], ['JUSTIFIED', 'Ngozi Eze']);

    const dup = await prisma.needsProposalFlag.findFirstOrThrow({ where: { proposalId: ids.p3, kind: 'DUPLICATE' } });
    const resolve = async (email: string, proposalId: string, resolutions: unknown[]) =>
      request(app).post(`${N}/proposals/${proposalId}/flags/resolve`).set(await web(email)).send({ resolutions });
    let res = await resolve(ME, ids.p3, [{ flagId: dup.id, resolution: 'JUSTIFIED', reason: 'Not the same school' }]);
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'NEEDS_FLAG_RESOLUTION_INVALID');
    res = await request(app)
      .post(`${N}/proposals/${ids.p3}/validation`)
      .set(await web(ME))
      .send(await validationBody(ME, ids.di, ids.p3, { flagResolutions: [{ flagId: dup.id, resolution: 'NOT_VALIDATED', reason: 'Same school' }] }));
    assert.equal(res.body.error.code, 'NEEDS_FLAG_RESOLUTION_INVALID');
    res = await resolve(ME, ids.p3, [{ flagId: dup.id, resolution: 'MERGED', reason: 'Same school', mergeIntoProposalId: ids.p4 }]);
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'NEEDS_MERGE_TARGET_INVALID');
    assert.equal((await resolve(QS, ids.p3, [{ flagId: dup.id, resolution: 'NOT_A_DUPLICATE', reason: 'Different school' }])).status, 403);
    const sm = await prisma.needsProposalFlag.findFirstOrThrow({ where: { proposalId: ids.p5, kind: 'MISSING_SUPERVISION_LINE' } });
    res = await resolve(ME, ids.p5, [{ flagId: sm.id, resolution: 'ACKNOWLEDGED', reason: 'Will be added' }]);
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'NEEDS_FLAG_RESOLUTION_INVALID');

    res = await resolve(ME, ids.p3, [{ flagId: dup.id, resolution: 'NOT_A_DUPLICATE', reason: 'The library request is a separate need of the same school.' }]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data[0].resolution, 'NOT_A_DUPLICATE');
    assert.equal((await proposal('p3')).status, 'IN_PROGRESS');
  });

  it('NOT_VALIDATED closes a proposal; ADVANCE moves the others on and writes the Validated Project List (xlsx and PDF) of the validated ones only', async () => {
    for (const key of ['p1', 'p5', 'p6']) {
      const res = await request(app).post(`${N}/proposals/${ids[key]}/validation`).set(await web(ME)).send(await validationBody(ME, ids.di, ids[key]));
      assert.equal(res.status, 201, JSON.stringify(res.body));
    }
    const res = await decide(ME, ids.di, {
      stage: 'VALIDATION',
      reason: 'M&E validation meeting of 28 July',
      items: [
        { proposalId: ids.p1, outcome: 'ADVANCE' },
        { proposalId: ids.p2, outcome: 'ADVANCE' },
        { proposalId: ids.p3, outcome: 'NOT_VALIDATED', reason: 'The library is already funded by the State.' },
        { proposalId: ids.p5, outcome: 'ADVANCE' },
        { proposalId: ids.p6, outcome: 'ADVANCE' },
      ],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const dto = NeedsDecisionResultDtoSchema.parse(res.body.data);
    assert.deepEqual(dto.items.map((i) => [i.reference, i.stage, i.status]), [
      ['2027-DI-001', 'DESIGN', 'IN_PROGRESS'],
      ['2027-DI-002', 'DESIGN', 'IN_PROGRESS'],
      ['2027-DI-003', 'VALIDATION', 'NOT_VALIDATED'],
      ['2027-DI-005', 'DESIGN', 'IN_PROGRESS'],
      ['2027-DI-006', 'DESIGN', 'IN_PROGRESS'],
    ]);
    assert.equal(await prisma.auditLog.count({ where: { tenantId, action: 'NEEDS_STAGE_DECIDED', payload: { path: ['decisionId'], equals: dto.decisionId! } } }), 5);
    const xlsx = dto.generatedDocuments.find((d) => d.kind === 'VALIDATED_PROJECT_LIST' && d.mimeType === XLSX_CONTENT_TYPE)!;
    const pdf = dto.generatedDocuments.find((d) => d.kind === 'VALIDATED_PROJECT_LIST' && d.mimeType === 'application/pdf')!;
    assert.ok(xlsx && pdf && xlsx.generated);
    assert.deepEqual([...xlsx.proposalIds].sort(), [ids.p1, ids.p2, ids.p5, ids.p6].sort());
    const row = await prisma.needsCycleDocument.findUniqueOrThrow({ where: { id: xlsx.id } });
    assert.deepEqual(await readXlsxColumn(row.objectKey, 1), ['2027-DI-001', '2027-DI-002', '2027-DI-005', '2027-DI-006']);
    const resolvedFlags = await readXlsxColumn(row.objectKey, 11);
    assert.match(resolvedFlags[1], /Essential facility missing: Justified \(Community borehole/);
    const pdfBytes = await storage.getObjectBuffer((await prisma.needsCycleDocument.findUniqueOrThrow({ where: { id: pdf.id } })).objectKey);
    assert.equal(pdfBytes!.subarray(0, 4).toString(), '%PDF');
  });
});

// ---------------------------------------------------------------------------
// A3: design
// ---------------------------------------------------------------------------

describe('needs N4 A3: design (Direct Intervention)', () => {
  it('leaving Design needs the full needs assessment: identification versions without BoQ are refused (422, both listed), v2 design versions with drawings move to Costing', async () => {
    for (const key of ['p1', 'p2', 'p5', 'p6']) await proposalDocument(PROCUREMENT, ids.di, ids[key], 'DRAWING', 'Standard drawings');
    let res = await action(PROCUREMENT, ids.di, 'SUBMIT', [ids.p1, ids.p2]);
    assert.equal(res.status, 422, JSON.stringify(res.body));
    const items = res.body.error.details.items as Array<{ reference: string; message: string }>;
    assert.deepEqual(items.map((i) => i.reference), ['2027-DI-001', '2027-DI-002']);
    assert.ok(items.every((i) => /BoQ/.test(i.message)), JSON.stringify(items));

    const { confirm } = await uploadFiles(PROCUREMENT, ids.di, [
      fixtureFile('di-design-valid', ids.p1),
      { fileName: 'Tunga design.xlsx', buffer: await specFile('essential-gap', (s) => ({ ...s, lines: linesForEssentialGap() })), proposalId: ids.p2 },
    ]);
    assert.equal(confirm.status, 201, JSON.stringify(confirm.body));
    // The justified gap is not raised again by a version that finds the same gap.
    assert.equal(await prisma.needsProposalFlag.count({ where: { proposalId: ids.p2, kind: 'ESSENTIAL_FACILITY_GAP', resolvedAt: null } }), 0);
    res = await action(PROCUREMENT, ids.di, 'SUBMIT', [ids.p1, ids.p2, ids.p5, ids.p6]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok((res.body.data.items as Array<{ stage: string; statusLabel: string }>).every((i) => i.stage === 'COSTING' && i.statusLabel === 'Pending costing'));
    const p1 = await prisma.needsProposal.findUniqueOrThrow({ where: { id: ids.p1 }, include: { versions: { orderBy: { number: 'asc' } } } });
    assert.deepEqual(p1.versions.map((v) => [v.number, v.source]), [
      [1, 'UPLOAD'],
      [2, 'UPLOAD'],
    ]);
  });
});

// ---------------------------------------------------------------------------
// A7: the queue at Costing
// ---------------------------------------------------------------------------

describe('needs N4 A7: the queue at Costing', () => {
  it('the quantity surveyor sees "Upload the costed version" on each proposal at Costing; the proposal page agrees', async () => {
    const qs = await tasksOf(QS);
    assert.deepEqual(
      qs.map((t) => [t.reference, t.actionLabel, t.dueDate]),
      ['001', '002', '005', '006'].map((n) => [`2027-DI-${n}`, 'Upload the costed version', '2026-10-14'])
    );
    assert.deepEqual(await tasksOf(PROCUREMENT), []);
    const page = NeedsProposalDetailDtoSchema.parse((await request(app).get(`${N}/proposals/${ids.p1}`).set(await web(QS))).body.data);
    assert.ok(page.waitingForMe);
    assert.ok(page.allowedActions.includes('UPLOAD_COSTED_VERSION') && page.allowedActions.includes('SIGN_OFF_COSTING'));
    const t = (key: string) => page.tasks.find((x) => x.key === key)!;
    assert.deepEqual([t('record-validation').status, t('submit-design').status], ['DONE', 'DONE']);
    assert.deepEqual([t('upload-costed-version').status, t('upload-costed-version').mine], ['TODO', true]);
    assert.equal(t('sign-off-costing').status, 'BLOCKED');
  });
});

// ---------------------------------------------------------------------------
// A4: costing
// ---------------------------------------------------------------------------

describe('needs N4 A4: costing', () => {
  it('only the quantity surveyor adds a version at Costing (Procurement refused); a sign-off without a costed version is 409 NEEDS_COSTED_VERSION_REQUIRED', async () => {
    const file = await specFile('di-design-valid', (s) => ({ ...s, project: { ...s.project, assumptions: 'Procurement tries a version at Costing.' } }));
    const { preview } = await uploadFiles(PROCUREMENT, ids.di, [{ fileName: 'Bosso.xlsx', buffer: file, proposalId: ids.p1 }]);
    assert.equal(preview.body.data.files[0].status, 'INVALID');
    assert.match(preview.body.data.files[0].issues[0].reason, /cannot upload a new version/);
    const res = await decide(QS, ids.di, { stage: 'COSTING', items: [{ proposalId: ids.p1, outcome: 'ADVANCE' }] });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'NEEDS_COSTED_VERSION_REQUIRED');
  });

  it('a costed version without the supervision and monitoring line keeps its flag and cannot be signed off (422 NEEDS_SUPERVISION_LINE_MISSING); a corrected costed version clears it and is signed off', async () => {
    const noSm = await specFile('missing-sm-line', (s) => ({ ...s, contingencyPct: 6 }));
    let up = await uploadFiles(QS, ids.di, [{ fileName: 'Bida costed.xlsx', buffer: noSm, proposalId: ids.p5 }]);
    assert.equal(up.confirm.status, 201, JSON.stringify(up.confirm.body));
    assert.equal(await prisma.needsProposalFlag.count({ where: { proposalId: ids.p5, kind: 'MISSING_SUPERVISION_LINE', resolvedAt: null } }), 1);
    let res = await decide(QS, ids.di, { stage: 'COSTING', items: [{ proposalId: ids.p5, outcome: 'ADVANCE' }] });
    assert.equal(res.status, 422, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'NEEDS_SUPERVISION_LINE_MISSING');
    assert.ok((res.body.error.details.items as Array<{ code: string }>).some((i) => i.code === 'NEEDS_FLAGS_UNRESOLVED'));

    up = await uploadFiles(QS, ids.di, [{ fileName: 'Bida costed v2.xlsx', buffer: await specFile('missing-sm-line', (s) => ({ ...s, supervisionMonitoringPct: 5 })), proposalId: ids.p5 }]);
    assert.equal(up.confirm.status, 201, JSON.stringify(up.confirm.body));
    const flag = await prisma.needsProposalFlag.findFirstOrThrow({ where: { proposalId: ids.p5, kind: 'MISSING_SUPERVISION_LINE' } });
    assert.equal(flag.resolution, 'CORRECTED');
    res = await decide(QS, ids.di, { stage: 'COSTING', items: [{ proposalId: ids.p5, outcome: 'ADVANCE' }] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.ok(res.body.data.generatedDocuments.some((d: { kind: string }) => d.kind === 'COST_ESTIMATE_REPORT'));
  });

  it('rate variances are acknowledged by the quantity surveyor (not the validator: 403); the queue then says "Sign off the costing"; the sign-off stores the costed amount', async () => {
    const variance = await prisma.needsProposalFlag.findFirstOrThrow({ where: { proposalId: ids.p6, kind: 'RATE_VARIANCE', resolvedAt: null } });
    const ack = (email: string) =>
      web(email).then((auth) =>
        request(app)
          .post(`${N}/proposals/${ids.p6}/flags/resolve`)
          .set(auth)
          .send({ resolutions: [{ flagId: variance.id, resolution: 'ACKNOWLEDGED', reason: 'Desks priced at the 2026 Minna market rate (three quotes on file).' }] })
      );
    assert.equal((await ack(ME)).status, 403);
    const { confirm } = await uploadFiles(QS, ids.di, [
      { fileName: 'Bosso costed.xlsx', buffer: await specFile('di-design-valid', (s) => ({ ...s, contingencyPct: 4 })), proposalId: ids.p1 },
      { fileName: 'Tunga costed.xlsx', buffer: await specFile('essential-gap', (s) => ({ ...s, lines: linesForEssentialGap(1.05) })), proposalId: ids.p2 },
      { fileName: 'Lapai costed.xlsx', buffer: await specFile('rate-variance', (s) => ({ ...s, contingencyPct: 4 })), proposalId: ids.p6 },
    ]);
    assert.equal(confirm.status, 201, JSON.stringify(confirm.body));
    assert.deepEqual((await tasksOf(QS)).map((t) => [t.reference, t.actionLabel]), [
      ['2027-DI-001', 'Sign off the costing'],
      ['2027-DI-002', 'Sign off the costing'],
      ['2027-DI-006', 'Sign off the costing'],
    ]);
    const acked = await ack(QS);
    assert.equal(acked.status, 200, JSON.stringify(acked.body));
    assert.equal(await prisma.needsProposalFlag.count({ where: { proposalId: ids.p6, kind: 'RATE_VARIANCE', resolvedAt: null } }), 0);
    const res = await decide(QS, ids.di, { stage: 'COSTING', reason: 'Costing signed off', items: ['p1', 'p2', 'p6'].map((k) => ({ proposalId: ids[k], outcome: 'ADVANCE' })) });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    for (const key of ['p1', 'p2', 'p6']) {
      const p = await prisma.needsProposal.findUniqueOrThrow({ where: { id: ids[key] }, include: { currentVersion: true } });
      assert.deepEqual([p.stage, p.status, p.currentVersion!.source], ['PRIORITISATION', 'IN_PROGRESS', 'COSTING']);
      assert.equal(Number(p.costedAmountNgn), Number(p.currentVersion!.costedTotalNgn));
      assert.ok(Number(p.costedAmountNgn) > 0);
    }
    assert.deepEqual(await tasksOf(QS), []);
  });
});

// ---------------------------------------------------------------------------
// A6: reports
// ---------------------------------------------------------------------------

describe('needs N4 A6: generated cycle reports', () => {
  it('the Cost Estimate Report lists every proposal past Costing with the costed amounts, the acknowledged variance and its reason, and a totals row', async () => {
    const docs = await prisma.needsCycleDocument.findMany({ where: { cycleId: ids.di, kind: 'COST_ESTIMATE_REPORT', mimeType: XLSX_CONTENT_TYPE }, orderBy: { createdAt: 'desc' } });
    assert.equal(docs.length, 2);
    assert.equal(docs[0].supersedesId, docs[1].id);
    const refs = await readXlsxColumn(docs[0].objectKey, 1);
    assert.deepEqual(refs, ['2027-DI-001', '2027-DI-002', '2027-DI-005', '2027-DI-006', 'Total']);
    const totals = await readXlsxColumn(docs[0].objectKey, 7);
    const costed = await prisma.needsProposal.findMany({ where: { cycleId: ids.di, stage: 'PRIORITISATION' } });
    assert.equal(Number(totals[4]), Math.round(costed.reduce((s, p) => s + Number(p.costedAmountNgn), 0) * 100) / 100);
    const flags = await readXlsxColumn(docs[0].objectKey, 10);
    assert.match(flags[3], /Rate differs from the costing standard: Acknowledged \(Desks priced/);
  });

  it('POST /cycles/:cycleId/reports/:kind regenerates and supersedes; 404 for another kind; 403 for a person who neither acts at that stage nor manages the cycle', async () => {
    const res = await request(app).post(`${N}/cycles/${ids.di}/reports/VALIDATED_PROJECT_LIST`).set(await web(ME));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.length, 2);
    assert.ok(res.body.data.every((d: { supersedesId: string | null }) => d.supersedesId));
    assert.equal((await request(app).post(`${N}/cycles/${ids.di}/reports/PRIORITISED_PROJECT_PORTFOLIO`).set(await web(ME))).status, 404);
    assert.equal((await request(app).post(`${N}/cycles/${ids.di}/reports/VALIDATED_PROJECT_LIST`).set(await web(QS))).status, 403);
    assert.equal((await request(app).post(`${N}/cycles/${ids.di}/reports/COST_ESTIMATE_REPORT`).set(await web(DPP))).status, 201, 'needs:manage_cycle');
    assert.equal((await request(app).post(`${N}/cycles/${ids.di}/reports/COST_ESTIMATE_REPORT`).set(await web(KANO_DPP))).status, 404, 'another organisation');
  });
});

// ---------------------------------------------------------------------------
// A5 (routes): the change rule
// ---------------------------------------------------------------------------

describe('needs N4 A5: the change rule on uploads', () => {
  it('a proposal returned at Prioritisation that gets a costed version with a new rate goes back to Costing, in progress, costed amount cleared, and the ledger says so', async () => {
    // Review fix (wave 3): only the committee's chair returns at Prioritisation, so es@ chairs it first.
    const es = await prisma.user.findUniqueOrThrow({ where: { email: ES } });
    await prisma.needsCommitteeMember.upsert({ where: { cycleId_userId: { cycleId: ids.di, userId: es.id } }, create: { cycleId: ids.di, userId: es.id, role: 'CHAIR' }, update: { role: 'CHAIR' } });
    const ret = await decide(ES, ids.di, { stage: 'PRIORITISATION', items: [{ proposalId: ids.p6, outcome: 'RETURN', reason: 'Re-cost the furniture at the standard rate.' }] });
    assert.equal(ret.status, 201, JSON.stringify(ret.body));
    assert.deepEqual([(await proposal('p6')).stage, (await proposal('p6')).status], ['PRIORITISATION', 'RETURNED']);
    assert.deepEqual((await tasksOf(QS)).map((t) => [t.reference, t.actionLabel]), [['2027-DI-006', 'Correct and resubmit']]);
    const recosted = await specFile('rate-variance', (s) => ({ ...s, lines: s.lines.map((l) => (l.itemCode === 'FUR-PUP-2' ? { ...l, rate: stdRate('FUR-PUP-2', 'NI') } : l)) }));
    const { confirm } = await uploadFiles(QS, ids.di, [{ fileName: 'Lapai re-costed.xlsx', buffer: recosted, proposalId: ids.p6 }]);
    assert.equal(confirm.status, 201, JSON.stringify(confirm.body));
    const p6 = await prisma.needsProposal.findUniqueOrThrow({ where: { id: ids.p6 }, include: { currentVersion: true } });
    assert.deepEqual([p6.stage, p6.status, p6.costedAmountNgn, p6.currentVersion!.source], ['COSTING', 'IN_PROGRESS', null, 'COSTING']);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'NEEDS_VERSION_ADDED', payload: { path: ['proposalId'], equals: ids.p6 } }, orderBy: { seq: 'desc' } });
    assert.match(entry.summaryText, /Cost changed: back to Costing\./);
    assert.equal((entry.payload as { reopenedStage: string }).reopenedStage, 'COSTING');
  });

  it('a Design version that changes the scope goes back to Validation; a design version with the same scope does not', async () => {
    const batch3 = BATCH_SPECS.find((s) => s.name === 'batch-3')!;
    let up = await uploadFiles(PROCUREMENT, ids.di, [{ fileName: 'batch-3.xlsx', buffer: await buildFixtureFile(batch3), proposalId: null }]);
    assert.equal(up.confirm.status, 201, JSON.stringify(up.confirm.body));
    ids.p7 = (await byRef('2027-DI-007')).id;
    assert.equal((await action(PROCUREMENT, ids.di, 'SUBMIT', [ids.p7])).status, 200);
    assert.equal((await request(app).post(`${N}/proposals/${ids.p7}/validation`).set(await web(ME)).send(await validationBody(ME, ids.di, ids.p7))).status, 201);
    assert.equal((await decide(ME, ids.di, { stage: 'VALIDATION', items: [{ proposalId: ids.p7, outcome: 'ADVANCE' }] })).status, 201);

    up = await uploadFiles(PROCUREMENT, ids.di, [{ fileName: 'Suleja design.xlsx', buffer: await specFile('batch-3', (s) => ({ ...s, project: { ...s.project, assumptions: 'Standard drawings.' } })), proposalId: ids.p7 }]);
    assert.equal(up.confirm.status, 201, JSON.stringify(up.confirm.body));
    assert.equal((await proposal('p7')).stage, 'DESIGN');

    const bigger = await specFile('batch-3', (s) => ({ ...s, rows: s.rows.map((r) => (r.facility === 'TOILET' ? { ...r, requiredQuantity: 2, proposedQuantity: 2 } : r)) }));
    up = await uploadFiles(PROCUREMENT, ids.di, [{ fileName: 'Suleja design v3.xlsx', buffer: bigger, proposalId: ids.p7 }]);
    assert.equal(up.confirm.status, 201, JSON.stringify(up.confirm.body));
    const p7 = await proposal('p7');
    assert.deepEqual([p7.stage, p7.status], ['VALIDATION', 'IN_PROGRESS']);
    assert.match(p7.statusReason ?? '', /Scope changed: back to Validation/);
    // The validation record was on an earlier version: a new one is needed.
    const res = await decide(ME, ids.di, { stage: 'VALIDATION', items: [{ proposalId: ids.p7, outcome: 'ADVANCE' }] });
    assert.equal(res.body.error.code, 'NEEDS_VALIDATION_RECORD_REQUIRED');
  });
});

// ---------------------------------------------------------------------------
// A1: separation-of-duties overrides (Matching Grants, Kano)
// ---------------------------------------------------------------------------

describe('needs N4 A1: separation-of-duties overrides (Kano)', () => {
  const ask = async (email: string, body: Record<string, unknown>) => request(app).post(`${N}/cycles/${ids.mg}/separation-overrides`).set(await web(email)).send(body);
  const decideOverride = async (email: string, flagId: string, decision: 'AUTHORISED' | 'REFUSED', note: string | null = null) =>
    request(app).post(`${N}/cycles/${ids.mg}/separation-overrides/${flagId}/decision`).set(await web(email)).send({ decision, note });

  it('setup: kano.dpp@ validates 2027-MG-KN-001 and it reaches Costing; as its validator kano.dpp@ is blocked from costing it (409 SAME_PERSON_COSTING) and the queue says "Ask for a separation-of-duties override"', async () => {
    await proposalDocument(KANO_PROCUREMENT, ids.mg, ids.mg1, 'DRAWING', 'Classroom block drawings');
    assert.equal((await action(KANO_PROCUREMENT, ids.mg, 'SUBMIT', [ids.mg1])).status, 200);
    assert.equal((await request(app).post(`${N}/proposals/${ids.mg1}/validation`).set(await web(KANO_DPP)).send(await validationBody(KANO_DPP, ids.mg, ids.mg1))).status, 201);
    assert.equal((await request(app).post(`${N}/cycles/${ids.mg}/decisions`).set(await web(KANO_DPP)).send({ stage: 'VALIDATION', items: [{ proposalId: ids.mg1, outcome: 'ADVANCE' }] })).status, 201);
    const res = await request(app).post(`${N}/cycles/${ids.mg}/decisions`).set(await web(KANO_DPP)).send({ stage: 'COSTING', items: [{ proposalId: ids.mg1, outcome: 'ADVANCE' }] });
    assert.equal(res.status, 409, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'SAME_PERSON_COSTING');
    assert.deepEqual((await tasksOf(KANO_DPP)).map((t) => [t.reference, t.actionLabel]), [['2027-MG-KN-001', 'Ask for a separation-of-duties override']]);
    const page = NeedsProposalDetailDtoSchema.parse((await request(app).get(`${N}/proposals/${ids.mg1}`).set(await web(KANO_DPP))).body.data);
    assert.ok(!page.allowedActions.includes('SIGN_OFF_COSTING') && !page.allowedActions.includes('UPLOAD_COSTED_VERSION'));
    assert.deepEqual(page.tasks.find((t) => t.key === 'override-COST'), { key: 'override-COST', label: 'Ask for a separation-of-duties override', status: 'TODO', mine: true });
  });

  it('asking: 409 NEEDS_OVERRIDE_NOT_NEEDED when nothing blocks, 422 for approval steps; the blocked validator asks to cost (201, open flag, ledger); a second ask is 409 NEEDS_OVERRIDE_PENDING; the authoriser sees it in the queue', async () => {
    let res = await ask(KANO_DPP, { proposalId: ids.mg1, action: 'VALIDATE', reason: 'Nothing blocks this one at all.' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'NEEDS_OVERRIDE_NOT_NEEDED');
    res = await ask(KANO_DPP, { proposalId: ids.mg1, action: 'APPROVE_STEP', reason: 'An approval step override.' });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, 'NEEDS_OVERRIDE_ACTION_NOT_SUPPORTED');
    assert.equal((await ask(KANO_PROCUREMENT, { proposalId: ids.mg1, action: 'COST', reason: 'Procurement wants to cost it.' })).status, 403);
    res = await ask(KANO_DPP, { proposalId: ids.mg1, action: 'COST', reason: 'Kano SUBEB has one quantity surveyor post, vacant since June.' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    ids.flag1 = res.body.data.id;
    assert.equal(res.body.data.kind, 'SEPARATION_OVERRIDE');
    assert.equal(res.body.data.resolved, false);
    const details = res.body.data.details as SeparationOverrideDetails;
    assert.deepEqual([details.action, details.violation, details.stage, details.usedAt], ['COST', 'SAME_PERSON_COSTING', 'COSTING', null]);
    assert.equal(await prisma.auditLog.count({ where: { tenantId, seq: { gt: ledgerFloor }, action: 'NEEDS_SEPARATION_OVERRIDE_REQUESTED' } }), 1);
    res = await ask(KANO_DPP, { proposalId: ids.mg1, action: 'COST', reason: 'Asking a second time, same reason.' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'NEEDS_OVERRIDE_PENDING');
    assert.deepEqual(await tasksOf(KANO_DPP), [], 'the asker waits');
    const chairman = await tasksOf(KANO_ADMIN);
    assert.deepEqual(chairman.map((t) => [t.id, t.actionLabel]), [[`PROPOSAL_ACTION:${ids.flag1}`, 'Authorise a separation-of-duties override']]);
  });

  it('the asker never decides their own request (409 NEEDS_OVERRIDE_SELF), another organisation cannot (403), and a refusal keeps the step blocked', async () => {
    const role = await prisma.role.findFirstOrThrow({ where: { tenantId, code: 'SUBEB_DIRECTOR_PHYSICAL_PLANNING' } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key: 'needs:override_separation' } });
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    clearAuthCache();
    try {
      const self = await decideOverride(KANO_DPP, ids.flag1, 'AUTHORISED');
      assert.equal(self.status, 409, JSON.stringify(self.body));
      assert.equal(self.body.error.code, 'NEEDS_OVERRIDE_SELF');
    } finally {
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: permission.id } });
      clearAuthCache();
    }
    const other = await decideOverride('admin@ubec.test', ids.flag1, 'AUTHORISED');
    assert.equal(other.status, 403);
    assert.equal(other.body.error.code, 'NEEDS_CYCLE_FORBIDDEN');
    const refused = await decideOverride(KANO_ADMIN, ids.flag1, 'REFUSED', 'Ask the Lagos SUBEB QS to cost it.');
    assert.equal(refused.status, 200, JSON.stringify(refused.body));
    assert.equal(refused.body.data.resolution, 'REFUSED');
    assert.equal((await decideOverride(KANO_ADMIN, ids.flag1, 'AUTHORISED')).body.error.code, 'NEEDS_OVERRIDE_DECIDED');
    const res = await request(app).post(`${N}/cycles/${ids.mg}/decisions`).set(await web(KANO_DPP)).send({ stage: 'COSTING', items: [{ proposalId: ids.mg1, outcome: 'ADVANCE' }] });
    assert.equal(res.body.error.code, 'SAME_PERSON_COSTING');
  });

  it("another holder's authorisation lets the asker cost: the costed upload and the sign-off each write NEEDS_SEPARATION_OVERRIDDEN; the flag stays with usedAt", async () => {
    let res = await ask(KANO_DPP, { proposalId: ids.mg1, action: 'COST', reason: 'Kano SUBEB has one quantity surveyor post, vacant since June.' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const flagId = res.body.data.id as string;
    assert.equal((await decideOverride(KANO_ADMIN, flagId, 'AUTHORISED', 'Authorised for this cycle.')).status, 200);
    const costed = await specFile('mg-complete-valid', (s) => ({ ...s, lines: s.lines.map((l) => (l.itemCode === 'BRD-MAG' ? { ...l, rate: Math.round(l.rate * 1.05) } : l)) }));
    const { confirm } = await uploadFiles(KANO_DPP, ids.mg, [{ fileName: 'Bebeji Garko costed.xlsx', buffer: costed, proposalId: ids.mg1 }]);
    assert.equal(confirm.status, 201, JSON.stringify(confirm.body));
    res = await request(app).post(`${N}/cycles/${ids.mg}/decisions`).set(await web(KANO_DPP)).send({ stage: 'COSTING', items: [{ proposalId: ids.mg1, outcome: 'ADVANCE' }] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const p = await prisma.needsProposal.findUniqueOrThrow({ where: { id: ids.mg1 }, include: { currentVersion: true } });
    assert.deepEqual([p.stage, p.status, p.currentVersion!.source, p.currentVersion!.uploadedByUserId], ['PRIORITISATION', 'IN_PROGRESS', 'COSTING', await userId(KANO_DPP)]);
    const flag = await prisma.needsProposalFlag.findUniqueOrThrow({ where: { id: flagId } });
    assert.equal(flag.resolution, 'AUTHORISED');
    assert.ok((flag.detailsJson as unknown as SeparationOverrideDetails).usedAt);
    const entries = await prisma.auditLog.findMany({ where: { tenantId, seq: { gt: ledgerFloor }, action: 'NEEDS_SEPARATION_OVERRIDDEN' }, orderBy: { seq: 'asc' } });
    assert.deepEqual(entries.map((e) => (e.payload as { step: string }).step), ['Uploaded the costed version', 'Signed off the costing']);
  });

  it('review fix: no override is asked once the proposal is past the step (409 NEEDS_OVERRIDE_NOT_NEEDED), and a request whose proposal has moved on cannot be authorised (409 NEEDS_OVERRIDE_STALE), only refused', async () => {
    // 2027-MG-KN-001 is now at Prioritisation: costing is over.
    const late = await ask(KANO_DPP, { proposalId: ids.mg1, action: 'COST', reason: 'Asking after the costing was signed off.' });
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, 'NEEDS_OVERRIDE_NOT_NEEDED');
    const kanoDpp = await prisma.user.findUniqueOrThrow({ where: { email: KANO_DPP } });
    const stale = await prisma.needsProposalFlag.create({
      data: {
        proposalId: ids.mg1,
        kind: 'SEPARATION_OVERRIDE',
        detailsJson: { action: 'COST', violation: 'SAME_PERSON_COSTING', requestedByUserId: kanoDpp.id, requestedByName: kanoDpp.fullName, reason: 'Asked while it was at Costing (test).', stage: 'COSTING', usedAt: null },
      },
    });
    const authorise = await decideOverride(KANO_ADMIN, stale.id, 'AUTHORISED');
    assert.equal(authorise.status, 409, JSON.stringify(authorise.body));
    assert.equal(authorise.body.error.code, 'NEEDS_OVERRIDE_STALE');
    assert.equal((await decideOverride(KANO_ADMIN, stale.id, 'REFUSED', 'It has moved on.')).status, 200);
  });

  it('an authorisation counts only for its action, its asker and the stage it was given in (pure)', () => {
    const flag: OverrideFlagFact = {
      id: 'f1',
      proposalId: 'p',
      details: { action: 'COST', violation: 'SAME_PERSON_COSTING', requestedByUserId: 'asker', requestedByName: 'A', reason: 'Vacant post', stage: 'COSTING', usedAt: null },
      resolvedAt: new Date(),
      resolution: 'AUTHORISED',
      resolvedByUserId: 'chair',
      resolvedByName: 'C',
      authoriserPermissionKeys: ['needs:override_separation'],
    };
    assert.ok(authorisationFor([flag], { stage: 'COSTING' }, 'COST', 'asker'));
    assert.equal(authorisationFor([flag], { stage: 'PRIORITISATION' }, 'COST', 'asker'), null, 'the proposal left the stage');
    assert.equal(authorisationFor([flag], { stage: 'COSTING' }, 'VALIDATE', 'asker'), null, 'another action');
    assert.equal(authorisationFor([flag], { stage: 'COSTING' }, 'COST', 'someone-else'), null, 'another person');
    assert.equal(authorisationFor([{ ...flag, resolution: 'REFUSED' }], { stage: 'COSTING' }, 'COST', 'asker'), null, 'refused');
  });
});

// ---------------------------------------------------------------------------
// A7: committee tasks (committee rows written directly; Track B owns the routes)
// ---------------------------------------------------------------------------

describe('needs N4 A7: committee tasks', () => {
  it('undeclared members are asked to declare; the chair opens scoring once all have declared; members score what they are not recused from; the chair finalises', async () => {
    const members: Array<[string, 'CHAIR' | 'MEMBER']> = [
      [ES, 'CHAIR'],
      [DPP, 'MEMBER'],
      ['finance@ubec.test', 'MEMBER'],
      [PROCUREMENT, 'MEMBER'],
    ];
    // es@ already chairs (added for the return at Prioritisation in A5): upsert.
    for (const [email, role] of members) {
      const uid = await userId(email);
      await prisma.needsCommitteeMember.upsert({ where: { cycleId_userId: { cycleId: ids.di, userId: uid } }, create: { cycleId: ids.di, userId: uid, role }, update: { role } });
    }
    assert.deepEqual((await tasksOf(ES)).map((t) => [t.kind, t.actionLabel, t.url]), [['CONFLICT_DECLARATION', 'Declare conflicts of interest', `/app/needs-assessment?cycle=${ids.di}&tab=prioritisation`]]);

    await prisma.needsCommitteeMember.updateMany({ where: { cycleId: ids.di }, data: { conflictDeclaredAt: new Date() } });
    assert.deepEqual((await tasksOf(ES)).map((t) => [t.kind, t.actionLabel]), [['CYCLE', 'Open scoring']]);
    assert.deepEqual(await tasksOf(DPP), [], 'nothing to score before scoring opens');

    await prisma.needsCycle.update({ where: { id: ids.di }, data: { scoringOpenedAt: new Date(), scoringOpenedByUserId: await userId(ES), scoringOpenedByName: 'Aminu Yusuf' } });
    const atPrioritisation = ['2027-DI-001', '2027-DI-002', '2027-DI-005'];
    assert.deepEqual((await tasksOf(DPP)).map((t) => [t.kind, t.reference]), atPrioritisation.map((r) => ['SCORE', r]));
    assert.deepEqual(await tasksOf(PROCUREMENT), [], 'recused from the proposals it uploaded');
    const es = await tasksOf(ES);
    assert.deepEqual(es.filter((t) => t.kind === 'CYCLE').map((t) => t.actionLabel), ['Finalise the ranking']);
    assert.equal(es.filter((t) => t.kind === 'SCORE').length, 3);

    const dppMember = await prisma.needsCommitteeMember.findFirstOrThrow({ where: { cycleId: ids.di, userId: await userId(DPP) } });
    await prisma.needsScoreSheet.create({ data: { cycleId: ids.di, proposalId: ids.p1, memberId: dppMember.id, scoresJson: {} } });
    assert.deepEqual((await tasksOf(DPP)).map((t) => t.reference), ['2027-DI-002', '2027-DI-005']);
    const list = NeedsProposalSummaryDtoSchema.array().parse((await request(app).get(`${N}/cycles/${ids.di}/proposals?waitingForMe=true`).set(await web(DPP))).body.data);
    assert.deepEqual(list.map((p) => p.reference), ['2027-DI-002', '2027-DI-005']);

    await prisma.needsCycle.update({ where: { id: ids.di }, data: { rankingFinalisedAt: new Date() } });
    assert.deepEqual((await tasksOf(ES)).filter((t) => t.kind !== 'PROPOSAL_ACTION'), []);
    await prisma.needsCycle.update({ where: { id: ids.di }, data: { rankingFinalisedAt: null, scoringOpenedAt: null } });
    await prisma.needsScoreSheet.deleteMany({ where: { cycleId: ids.di } });
    await prisma.needsCommitteeMember.deleteMany({ where: { cycleId: ids.di } });
  });
});

// ---------------------------------------------------------------------------
// A8: the needs-deadlines job
// ---------------------------------------------------------------------------

describe('needs N4 A8: the needs-deadlines job', () => {
  it('emails DUE_SOON seven days before a stage deadline and OVERDUE the day after while proposals are still open there; one JobRun per cycle-day', async () => {
    assert.ok(jobs.registeredJobs().some((j) => j.name === 'needs-deadlines'));
    await prisma.outboundMessage.deleteMany();
    let mark = outbox.length;
    // DI Validation closes on 31 July 2026 (cycle 2027); 2027-DI-007 is back at Validation.
    assert.equal(await jobs.runJobOnce('needs-deadlines', new Date('2026-07-24T08:00:00Z')), true);
    let mails = sentTo(mark, ME);
    assert.equal(mails.length, 1);
    assert.match(mails[0].rendered.subject, /Validation closes on 31 Jul 2026/);
    assert.match(mails[0].rendered.text, /2027-DI-007/);
    assert.equal(sentTo(mark, QS).length, 0, 'only the stage actors');
    assert.equal(await prisma.jobRun.count({ where: { jobName: 'needs-deadlines', scopeKey: `${ids.di}:2026-07-24` } }), 1);

    mark = outbox.length;
    assert.equal(await jobs.runJobOnce('needs-deadlines', new Date('2026-07-24T15:00:00Z')), true);
    assert.equal(outbox.length, mark, 'the same day sends nothing again');

    mark = outbox.length;
    await jobs.runJobOnce('needs-deadlines', new Date('2026-08-01T08:00:00Z'));
    mails = sentTo(mark, ME);
    assert.equal(mails.length, 1);
    assert.match(mails[0].rendered.subject, /the validation deadline \(31 Jul 2026\) has passed/);

    // Costing closed on 14 October: nothing is left at Costing or earlier except 2027-DI-006 and -007.
    mark = outbox.length;
    await jobs.runJobOnce('needs-deadlines', new Date('2026-10-15T08:00:00Z'));
    const qs = sentTo(mark, QS);
    assert.equal(qs.length, 1);
    assert.match(qs[0].rendered.text, /2027-DI-006/);
  });
});
