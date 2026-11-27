/**
 * Needs pipeline: the scenario tests. They walk a Direct Intervention and a Matching Grants cycle
 * from upload to a live project, plus the out-of-cycle route and the field verification. This file
 * is the pipeline's progress bar (plan `saas_updates/needs_pipeline_implementation_plan.md`
 * section 12): every step starts as `todo` with the wave that builds it, and each wave removes the
 * `todo` of its own steps as they pass. Steps: `needs_pipeline/wave1_contracts.md` section 3.7.
 *
 * People (seedUbecRoster, D-N.25; password Password123!):
 * - UBEC HQ: dpp@ (Director Physical Planning), procurement@, qs@ (Quantity Surveyor), finance@,
 *   es@ (Executive Secretary), me.officer@ (UBEC M&E), admin@;
 * - Kano SUBEB: kano.dpp@, kano.procurement@, kano.admin@ (acts for the Executive Chairman);
 * - Lagos SUBEB: lagos.admin@, lagos.me@ (must not see the Kano cycle).
 *
 * The steps of a suite run in order and each continues from the one before. Files: the wave 2
 * fixtures (`fixtures/needs`: Direct Intervention in Niger State, Matching Grants in Kano, 2027).
 */
import { resetTestDatabase } from './helpers/testDb';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import { NeedsCycleDtoSchema, NeedsUploadResultDtoSchema, cycleDeadlines, type NeedsPipelineConfig } from '@insite/shared';
import { needsFixture, needsFixtureBase64, type NeedsFixtureName } from './fixtures/needs/needsFixtures';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

const todo = (wave: number) => ({ todo: `wave ${wave}` });

let app: Express;
let prisma: PrismaClientType;
let tenantId = '';
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const N = '/api/v1/needs';

async function web(email: string) {
  if (!tokens[email]) {
    const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Password123!' });
    assert.equal(res.status, 200, `${email}: ${JSON.stringify(res.body)}`);
    tokens[email] = res.body.data.accessToken as string;
  }
  return { Authorization: `Bearer ${tokens[email]}` };
}

const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const upload = (name: NeedsFixtureName) => ({ fileName: `${name}.xlsx`, fileBase64: needsFixtureBase64(name), proposalId: null, sha256: sha(needsFixture(name)) });

/** Preview, then confirm the same files with the preview's sha256 (as the upload dialog does). */
async function previewAndConfirm(email: string, cycleId: string, names: NeedsFixtureName[]) {
  const files = names.map(upload);
  const preview = await request(app)
    .post(`${N}/cycles/${cycleId}/uploads/preview`)
    .set(await web(email))
    .send({ files: files.map(({ sha256, ...f }) => (void sha256, f)) });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  const previewed = preview.body.data.files as Array<{ sha256: string }>;
  return request(app)
    .post(`${N}/cycles/${cycleId}/uploads/confirm`)
    .set(await web(email))
    .send({ files: files.map((f, i) => ({ ...f, sha256: previewed[i].sha256 })) });
}

const proposalByRef = (reference: string) => prisma.needsProposal.findFirstOrThrow({ where: { tenantId, reference } });

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  const { createApp } = await import('../app');
  app = createApp();
  tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } })).id;
  ids.di = (await prisma.projectType.findFirstOrThrow({ where: { tenantId, code: 'CENTRAL' } })).id;
  ids.mg = (await prisma.projectType.findFirstOrThrow({ where: { tenantId, code: 'CO_FUNDED' } })).id;
});

describe('Needs pipeline scenario: Direct Intervention (2027 cycle)', () => {
  it('DI-01 dpp@ opens the 2027 DI cycle; config snapshot and deadlines stored', async () => {
    const res = await request(app).post(`${N}/cycles`).set(await web('dpp@ubec.test')).send({ projectTypeId: ids.di, interventionYear: 2027 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const cycle = NeedsCycleDtoSchema.parse(res.body.data);
    ids.diCycle = cycle.id;
    const row = await prisma.needsCycle.findUniqueOrThrow({ where: { id: cycle.id } });
    assert.equal(row.status, 'OPEN');
    assert.equal(row.scopeKey, 'NATIONAL');
    assert.equal((row.configSnapshotJson as { referencePrefix: string }).referencePrefix, 'DI');
    assert.deepEqual(row.deadlinesJson, cycleDeadlines(cycle.config as NeedsPipelineConfig, 2027));
    assert.ok(cycle.deadlines.some((d) => d.key === 'stage:VALIDATION' && d.date === '2026-07-31'));
  });

  it('DI-02 procurement@ uploads three files at once; the file with row errors is refused with row, column and reason; two proposals created with references', async () => {
    const res = await previewAndConfirm('procurement@ubec.test', ids.diCycle, ['di-draft-valid', 'essential-gap', 'row-errors']);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const dto = NeedsUploadResultDtoSchema.parse(res.body.data);
    assert.deepEqual(dto.files.map((f) => [f.fileName, f.outcome, f.reference]), [
      ['di-draft-valid.xlsx', 'CREATED', '2027-DI-001'],
      ['essential-gap.xlsx', 'CREATED', '2027-DI-002'],
      ['row-errors.xlsx', 'REFUSED', null],
    ]);
    const refused = dto.files[2];
    assert.ok(refused.issues.length > 0);
    for (const issue of refused.issues.filter((i) => i.row !== null)) {
      assert.ok(issue.column && issue.reason, JSON.stringify(issue));
    }
    assert.ok(refused.issues.some((i) => i.row !== null && i.column !== null), JSON.stringify(refused.issues));
    assert.equal(await prisma.needsProposal.count({ where: { cycleId: ids.diCycle } }), 2);
  });

  it('DI-03 duplicate and essential-facility flags raised on the right proposal', async () => {
    const res = await previewAndConfirm('procurement@ubec.test', ids.diCycle, ['duplicate-of-di-draft']);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.files[0].reference, '2027-DI-003');
    const openKinds = async (reference: string) =>
      (await prisma.needsProposalFlag.findMany({ where: { proposalId: (await proposalByRef(reference)).id, resolvedAt: null } })).map((f) => f.kind).sort();
    assert.deepEqual(await openKinds('2027-DI-001'), []);
    assert.deepEqual(await openKinds('2027-DI-002'), ['ESSENTIAL_FACILITY_GAP']);
    assert.deepEqual(await openKinds('2027-DI-003'), ['DUPLICATE']);
    const dup = await prisma.needsProposalFlag.findFirstOrThrow({ where: { proposalId: (await proposalByRef('2027-DI-003')).id, kind: 'DUPLICATE' } });
    const matches = (dup.detailsJson as { matches: Array<{ reference: string; kind: string }> }).matches;
    assert.deepEqual([...new Set(matches.map((m) => `${m.kind} ${m.reference}`))], ['PROPOSAL 2027-DI-001']);
  });

  it('DI-04 procurement@ submits both to Validation', todo(3));
  it('DI-05 procurement@ cannot validate (409 SAME_PERSON_VALIDATION)', todo(3));
  it('DI-06 me.officer@ validates one (duplicate resolved, essential gap justified), returns the other; it is resubmitted and validated; Validated Project List generated', todo(3));
  it('DI-07 design versions uploaded (v2 each; v1 kept)', todo(3));
  it('DI-08 qs@ uploads costed versions; a rate variance is acknowledged with a reason; S&M line present; Cost Estimate Report generated', todo(3));
  it('DI-09 committee (es@ chair, dpp@, finance@, procurement@): declarations, procurement@ recused from its uploads, scores, one divergence flagged, ranking, line, override with reason, finalised; Prioritised Project Portfolio generated', todo(3));
  it('DI-10 procurement@ submits the portfolio; dpp@ management review; es@ approves with one exclusion and the memo', todo(4));
  it('DI-11 finance@ records the budget submission and imports the appropriated schedule; the funded proposal converts; the excluded one is "Not funded, carried forward"', todo(4));
  it("DI-12 the draft project has the proposal's sites, units from breakdown rows, BoQ lines and funded budget, origin NEEDS_PIPELINE, an approved-list row; procurement@ assigns a lot; a draft with origin none cannot be activated", todo(4));
  it('DI-13 opening the 2028 cycle offers the carried-forward proposal; carried, it starts at Validation with its versions linked', todo(4));
});

describe('Needs pipeline scenario: Matching Grants (Kano, 2027 cycle)', () => {
  it('MG-01 kano.dpp@ opens the Kano 2027 MG cycle with the circular', async () => {
    const auth = await web('kano.dpp@ubec.test');
    const res = await request(app).post(`${N}/cycles`).set(auth).send({ projectTypeId: ids.mg, interventionYear: 2027, stateCode: 'KN' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    ids.mgCycle = res.body.data.id;
    assert.equal(res.body.data.owningOrganizationName, 'Kano State Universal Basic Education Board (SUBEB)');

    const pdf = Buffer.from('%PDF-1.4\n% Matching Grants circular 2027\n%%EOF\n');
    const presign = await request(app).post(`${N}/cycles/${ids.mgCycle}/documents/presign`).set(auth).send({ fileName: 'MG circular 2027.pdf', mimeType: 'application/pdf', byteSize: pdf.length });
    assert.equal(presign.status, 200, JSON.stringify(presign.body));
    const target = new URL(presign.body.data.uploadUrl);
    assert.equal((await request(app).put(target.pathname + target.search).set('Content-Type', 'application/pdf').send(pdf)).status, 200);
    const doc = await request(app)
      .post(`${N}/cycles/${ids.mgCycle}/documents`)
      .set(auth)
      .send({ objectKey: presign.body.data.objectKey, kind: 'CIRCULAR', title: 'Matching Grants circular 2027' });
    assert.equal(doc.status, 201, JSON.stringify(doc.body));
    const cycle = NeedsCycleDtoSchema.parse((await request(app).get(`${N}/cycles/${ids.mgCycle}`).set(auth)).body.data);
    assert.deepEqual(cycle.documents.map((d) => d.kind), ['CIRCULAR']);
  });

  it('MG-02 kano.procurement@ uploads; a file without BoQ is refused (MG minimum fields)', async () => {
    const res = await previewAndConfirm('kano.procurement@ubec.test', ids.mgCycle, ['mg-no-boq', 'mg-complete-valid']);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const dto = NeedsUploadResultDtoSchema.parse(res.body.data);
    assert.deepEqual(dto.files.map((f) => [f.outcome, f.reference]), [
      ['REFUSED', null],
      ['CREATED', '2027-MG-KN-001'],
    ]);
    assert.ok(dto.files[0].issues.some((i) => /BoQ/i.test(i.reason)), JSON.stringify(dto.files[0].issues));
  });

  it('MG-03 Lagos SUBEB users cannot see the Kano cycle', async () => {
    const lagosAdmin = await web('lagos.admin@ubec.test');
    const list = await request(app).get(`${N}/cycles`).set(lagosAdmin);
    assert.equal(list.status, 200);
    assert.ok(!(list.body.data as Array<{ id: string }>).some((c) => c.id === ids.mgCycle));
    assert.equal((await request(app).get(`${N}/cycles/${ids.mgCycle}`).set(lagosAdmin)).status, 404);
    assert.equal((await request(app).get(`${N}/cycles/${ids.mgCycle}/proposals`).set(lagosAdmin)).status, 404);
    const proposal = await proposalByRef('2027-MG-KN-001');
    assert.equal((await request(app).get(`${N}/proposals/${proposal.id}`).set(lagosAdmin)).status, 404);
    // The Lagos SUBEB M&E officer holds no needs:view at all.
    assert.equal((await request(app).get(`${N}/cycles`).set(await web('lagos.me@ubec.test'))).status, 403);
  });

  it('MG-04 kano.dpp@ field-verifies; asks for a separation override to cost (the same person validated); kano.admin@ (Executive Chairman) authorises it; kano.dpp@ costs; the override stays flagged and is in the ledger', todo(3));
  it('MG-05 SUBEB committee (kano.admin@ chair, three members with the umbrella role SUBEB_COMMITTEE_MEMBER; kano.dpp@ and kano.procurement@ recused) scores and finalises', todo(3));
  it('MG-06 SUBEB management review and kano.admin@ endorsement', todo(4));
  it('MG-07 BEAP built (lot, batch, procurement method per proposal; counterpart declared) and submitted', todo(4));
  it('MG-08 dpp@ reviews, comments on one proposal and returns; SUBEB revises (new version) and resubmits', todo(4));
  it('MG-09 es@ approves (Executive Management); proposals convert, owner Kano SUBEB, lot and batch from the BEAP', todo(4));
  it('MG-10 activation refused until counterpart evidence is recorded; then allowed', todo(4));
  it('OOC-01 out-of-cycle request (emergency, authorising document) approved by es@; converts with origin OUT_OF_CYCLE', todo(4));
  it('FIELD-01 a verification visit submitted from the field app fills the validation record and corrects a site\'s coordinates', todo(5));
});
