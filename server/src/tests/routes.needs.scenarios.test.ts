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
 *
 * Wave 3 walk (Track A, DI-04 … DI-08 and MG-04; DI-09 and MG-05 continue from this end state):
 * - DI-04: procurement@ submits 2027-DI-001 and -002, then -003 (the possible duplicate), to Validation.
 * - DI-05: procurement@ has no needs:validate (403); with it granted for the step, 409
 *   SAME_PERSON_VALIDATION (record and decision); the grant is removed again.
 * - DI-06: me.officer@ records -001 (site verification evidence), merges -003 into -001 (closed
 *   MERGED), decides -001 ADVANCE and -002 RETURN; procurement@ resubmits -002; me.officer@ justifies
 *   its essential-facility gap and advances it. Each decision writes the Validated Project List.
 * - DI-07: procurement@ uploads the Design versions (v2: di-design-valid; -002 with a BoQ), adds
 *   drawings and submits both to Costing.
 * - DI-08: qs@ uploads costed versions (v3, source COSTING; -001 with a desk rate 30 % above the
 *   standard), acknowledges the variance and signs both off: Cost Estimate Report generated.
 *   End state: -001 and -002 IN_PROGRESS at Prioritisation with costed amounts; -003 MERGED.
 * - MG-04: kano.procurement@ adds a drawing and submits 2027-MG-KN-001; kano.dpp@ field-verifies and
 *   advances it; kano.dpp@'s costed upload is refused (validator), kano.dpp@ asks for an override,
 *   kano.admin@ authorises it, kano.dpp@ uploads the costed version and signs off (two
 *   NEEDS_SEPARATION_OVERRIDDEN entries; the flag stays AUTHORISED with `usedAt`).
 */
import { resetTestDatabase } from './helpers/testDb';
import { clearSeededNeedsPipeline } from './helpers/needsSeedReset';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import {
  NeedsCycleDtoSchema,
  NeedsDecisionResultDtoSchema,
  NeedsUploadResultDtoSchema,
  ParsedNeedsAssessmentSchema,
  XLSX_CONTENT_TYPE,
  cycleDeadlines,
  hasSupervisionLine,
  type NeedsPipelineConfig,
} from '@insite/shared';
import { needsFixture, needsFixtureBase64, type NeedsFixtureName } from './fixtures/needs/needsFixtures';
import { stepDI09, stepMG05 } from './helpers/needsScenarioSteps.n5';
import { stepDI10, stepMG06, stepOOC01 } from './helpers/needsScenarioSteps.n6';
import { stepDI11, stepDI12, stepMG07, stepMG08, stepMG09, stepMG10 } from './helpers/needsScenarioSteps.n7';
import { stepFIELD01 } from './helpers/needsScenarioSteps.n8';
import { buildFixtureFile } from './fixtures/needs/generateNeedsFixtures';
import { FIXTURE_SPECS, FIXTURE_STANDARD, stdRate, type FixtureLine, type NeedsFixtureSpec } from './fixtures/needs/needsFixtureSpecs';

type PrismaClientType = typeof import('../config/prisma')['prisma'];


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

/** Preview, then confirm built files (new versions of named proposals). Returns the confirm response. */
async function uploadFiles(email: string, cycleId: string, files: Array<{ fileName: string; buffer: Buffer; proposalId: string | null }>) {
  const body = files.map((f) => ({ fileName: f.fileName, fileBase64: f.buffer.toString('base64'), proposalId: f.proposalId }));
  const preview = await request(app).post(`${N}/cycles/${cycleId}/uploads/preview`).set(await web(email)).send({ files: body });
  assert.equal(preview.status, 200, JSON.stringify(preview.body));
  return request(app)
    .post(`${N}/cycles/${cycleId}/uploads/confirm`)
    .set(await web(email))
    .send({ files: body.map((f, i) => ({ ...f, sha256: sha(files[i].buffer) })) });
}

/** A batch action (SUBMIT, RESUBMIT, WITHDRAW). */
const action = async (email: string, cycleId: string, act: 'SUBMIT' | 'RESUBMIT' | 'WITHDRAW', proposalIds: string[], reason: string | null = null) =>
  request(app).post(`${N}/cycles/${cycleId}/proposal-actions`).set(await web(email)).send({ action: act, proposalIds, reason });

/** Presign, PUT and register a small PDF as a proposal document; returns its id. */
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

/** A fixture spec changed and typed into a fresh template (new bytes, so never refused as already uploaded). */
async function specFile(name: string, change: (spec: NeedsFixtureSpec) => NeedsFixtureSpec): Promise<Buffer> {
  const spec = FIXTURE_SPECS.find((s) => s.name === name)!;
  return buildFixtureFile(change(structuredClone(spec)));
}

/** BoQ lines for the `essential-gap` breakdown (Design version), at the standard rates × `factor`. */
function designLinesForEssentialGap(factor = 1): FixtureLine[] {
  const line = (wbsCode: string, unitId: string, itemCode: string, quantity: number): FixtureLine => {
    const std = FIXTURE_STANDARD.rates.find((r) => r.itemCode === itemCode)!;
    return { wbsCode, unitId, itemCode, description: std.description, unit: std.unitOfMeasure, quantity, rate: Math.round(stdRate(itemCode, 'NI') * factor) };
  };
  return [line('1.01', 'U01', 'CLS-REN', 6), line('2.01', 'U02', 'TLT-NEW', 1), line('3.01', 'U03', 'SOL-5KVA', 1)];
}

const parsedCosting = (json: unknown) => ParsedNeedsAssessmentSchema.parse(json).costingSummary;

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  await clearSeededNeedsPipeline(prisma);
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

  it('DI-04 procurement@ submits both to Validation', async () => {
    const [p1, p2, p3] = await Promise.all(['2027-DI-001', '2027-DI-002', '2027-DI-003'].map(proposalByRef));
    ids.di1 = p1.id;
    ids.di2 = p2.id;
    ids.di3 = p3.id;
    const res = await action('procurement@ubec.test', ids.diCycle, 'SUBMIT', [p1.id, p2.id]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const dto = NeedsDecisionResultDtoSchema.parse(res.body.data);
    assert.deepEqual(dto.items.map((i) => [i.reference, i.stage, i.status, i.statusLabel]), [
      ['2027-DI-001', 'VALIDATION', 'IN_PROGRESS', 'Pending validation'],
      ['2027-DI-002', 'VALIDATION', 'IN_PROGRESS', 'Pending validation'],
    ]);
    // The possible duplicate goes too, so the validator can resolve it.
    assert.equal((await action('procurement@ubec.test', ids.diCycle, 'SUBMIT', [p3.id])).status, 200);
    assert.equal(await prisma.auditLog.count({ where: { tenantId, action: 'NEEDS_PROPOSAL_SUBMITTED', payload: { path: ['cycleId'], equals: ids.diCycle } } }), 3);
    const tasks = (await request(app).get(`${N}/tasks`).set(await web('me.officer@ubec.test'))).body.data as Array<{ reference: string; actionLabel: string }>;
    assert.deepEqual(tasks.map((t) => [t.reference, t.actionLabel]).sort(), [
      ['2027-DI-001', 'Validate'],
      ['2027-DI-002', 'Validate'],
      ['2027-DI-003', 'Validate'],
    ]);
  });

  it('DI-05 procurement@ cannot validate (409 SAME_PERSON_VALIDATION)', async () => {
    const body = { outcome: 'ADVANCE', deskNotes: 'Desk review of the needs assessment.', siteVerification: null };
    const forbidden = await request(app).post(`${N}/proposals/${ids.di1}/validation`).set(await web('procurement@ubec.test')).send(body);
    assert.equal(forbidden.status, 403, 'Procurement does not hold needs:validate (plan section 8)');

    // A small office where one person holds both duties: the separation rule still stops the uploader.
    const role = await prisma.role.findFirstOrThrow({ where: { tenantId, code: 'PROCUREMENT_OFFICER' } });
    const permission = await prisma.permission.findUniqueOrThrow({ where: { key: 'needs:validate' } });
    // Permissions are read from the role (auth context cached up to 30 s, cleared on role changes).
    const { clearAuthCache } = await import('../middleware/auth.middleware');
    await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
    clearAuthCache();
    try {
      const res = await request(app).post(`${N}/proposals/${ids.di1}/validation`).set(await web('procurement@ubec.test')).send(body);
      assert.equal(res.status, 409, JSON.stringify(res.body));
      assert.equal(res.body.error.code, 'SAME_PERSON_VALIDATION');
      const decision = await request(app)
        .post(`${N}/cycles/${ids.diCycle}/decisions`)
        .set(await web('procurement@ubec.test'))
        .send({ stage: 'VALIDATION', items: [{ proposalId: ids.di1, outcome: 'ADVANCE' }] });
      assert.equal(decision.status, 409, JSON.stringify(decision.body));
      assert.equal(decision.body.error.code, 'SAME_PERSON_VALIDATION');
    } finally {
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: permission.id } });
      clearAuthCache();
    }
    assert.equal(await prisma.needsValidationRecord.count({ where: { proposalId: ids.di1 } }), 0);
  });

  it('DI-06 me.officer@ validates one (duplicate resolved, essential gap justified), returns the other; it is resubmitted and validated; Validated Project List generated', async () => {
    const me = 'me.officer@ubec.test';
    const verification = async (proposalId: string) => ({
      method: 'WEB_EVIDENCE',
      verifiedOn: '2026-07-20',
      officerName: 'Ngozi Eze',
      notes: 'Sites visited with the LGEA desk officer.',
      evidenceDocumentIds: [await proposalDocument(me, ids.diCycle, proposalId, 'SITE_VERIFICATION_EVIDENCE', 'Site verification report')],
    });
    let res = await request(app)
      .post(`${N}/proposals/${ids.di1}/validation`)
      .set(await web(me))
      .send({ outcome: 'ADVANCE', deskNotes: 'Needs confirmed against the school census.', siteVerification: await verification(ids.di1) });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    // The possible duplicate is the same school as 2027-DI-001: merged into it.
    const dup = await prisma.needsProposalFlag.findFirstOrThrow({ where: { proposalId: ids.di3, kind: 'DUPLICATE', resolvedAt: null } });
    res = await request(app)
      .post(`${N}/proposals/${ids.di3}/validation`)
      .set(await web(me))
      .send({
        outcome: 'NOT_VALIDATED',
        deskNotes: 'Same school as 2027-DI-001; the library request joins that proposal.',
        flagResolutions: [{ flagId: dup.id, resolution: 'MERGED', reason: 'Same school as 2027-DI-001', mergeIntoProposalId: ids.di1 }],
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const merged = await prisma.needsProposal.findUniqueOrThrow({ where: { id: ids.di3 } });
    assert.equal(merged.status, 'MERGED');
    assert.equal(merged.mergedIntoId, ids.di1);

    res = await request(app)
      .post(`${N}/cycles/${ids.diCycle}/decisions`)
      .set(await web(me))
      .send({
        stage: 'VALIDATION',
        reason: 'M&E validation meeting',
        items: [
          { proposalId: ids.di1, outcome: 'ADVANCE' },
          { proposalId: ids.di2, outcome: 'RETURN', reason: 'No water source on the site: add a borehole or justify why none is needed.' },
        ],
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    let dto = NeedsDecisionResultDtoSchema.parse(res.body.data);
    assert.deepEqual(dto.items.map((i) => [i.reference, i.stage, i.status]), [
      ['2027-DI-001', 'DESIGN', 'IN_PROGRESS'],
      ['2027-DI-002', 'VALIDATION', 'RETURNED'],
    ]);
    assert.deepEqual(dto.generatedDocuments.map((d) => [d.kind, d.mimeType]).sort(), [
      ['VALIDATED_PROJECT_LIST', 'application/pdf'],
      ['VALIDATED_PROJECT_LIST', XLSX_CONTENT_TYPE],
    ]);
    assert.deepEqual(dto.generatedDocuments[0].proposalIds, [ids.di1]);

    res = await action('procurement@ubec.test', ids.diCycle, 'RESUBMIT', [ids.di2], 'The community borehole 200 m away serves the school; see the justification.');
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const gap = await prisma.needsProposalFlag.findFirstOrThrow({ where: { proposalId: ids.di2, kind: 'ESSENTIAL_FACILITY_GAP', resolvedAt: null } });
    res = await request(app)
      .post(`${N}/proposals/${ids.di2}/validation`)
      .set(await web(me))
      .send({
        outcome: 'ADVANCE',
        deskNotes: 'Water need covered by the community borehole next to the school.',
        siteVerification: await verification(ids.di2),
        flagResolutions: [{ flagId: gap.id, resolution: 'JUSTIFIED', reason: 'Community borehole 200 m from the school, functional (site visit).' }],
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    res = await request(app)
      .post(`${N}/cycles/${ids.diCycle}/decisions`)
      .set(await web(me))
      .send({ stage: 'VALIDATION', items: [{ proposalId: ids.di2, outcome: 'ADVANCE' }] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    dto = NeedsDecisionResultDtoSchema.parse(res.body.data);
    assert.equal(dto.items[0].stage, 'DESIGN');
    assert.deepEqual([...dto.generatedDocuments[0].proposalIds].sort(), [ids.di1, ids.di2].sort());
    const lists = await prisma.needsCycleDocument.findMany({ where: { cycleId: ids.diCycle, kind: 'VALIDATED_PROJECT_LIST' } });
    assert.equal(lists.length, 4, 'generated twice, xlsx and PDF');
    assert.equal(lists.filter((d) => d.supersedesId).length, 2, 'the second list supersedes the first');
  });

  it('DI-07 design versions uploaded (v2 each; v1 kept)', async () => {
    const design2 = await specFile('essential-gap', (s) => ({ ...s, lines: designLinesForEssentialGap() }));
    const res = await uploadFiles('procurement@ubec.test', ids.diCycle, [
      { fileName: 'di-design-valid.xlsx', buffer: needsFixture('di-design-valid'), proposalId: ids.di1 },
      { fileName: 'Tunga design.xlsx', buffer: design2, proposalId: ids.di2 },
    ]);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.deepEqual(
      (res.body.data.files as Array<{ outcome: string; versionNumber: number }>).map((f) => [f.outcome, f.versionNumber]),
      [
        ['VERSION_ADDED', 2],
        ['VERSION_ADDED', 2],
      ]
    );
    // Drawings are the Design minimum field the file cannot carry.
    let submit = await action('procurement@ubec.test', ids.diCycle, 'SUBMIT', [ids.di1, ids.di2]);
    assert.equal(submit.status, 422, JSON.stringify(submit.body));
    assert.equal(submit.body.error.code, 'NEEDS_MINIMUM_FIELDS_MISSING');
    for (const id of [ids.di1, ids.di2]) await proposalDocument('procurement@ubec.test', ids.diCycle, id, 'DRAWING', 'Standard classroom drawings');
    submit = await action('procurement@ubec.test', ids.diCycle, 'SUBMIT', [ids.di1, ids.di2]);
    assert.equal(submit.status, 200, JSON.stringify(submit.body));
    for (const id of [ids.di1, ids.di2]) {
      const p = await prisma.needsProposal.findUniqueOrThrow({ where: { id }, include: { versions: { orderBy: { number: 'asc' } } } });
      assert.deepEqual([p.stage, p.status], ['COSTING', 'IN_PROGRESS']);
      assert.deepEqual(p.versions.map((v) => [v.number, v.source]), [
        [1, 'UPLOAD'],
        [2, 'UPLOAD'],
      ]);
      assert.equal(p.currentVersionId, p.versions[1].id);
    }
  });

  it('DI-08 qs@ uploads costed versions; a rate variance is acknowledged with a reason; S&M line present; Cost Estimate Report generated', async () => {
    const qs = 'qs@ubec.test';
    const costed1 = await specFile('di-design-valid', (s) => ({ ...s, lines: s.lines.map((l) => (l.itemCode === 'FUR-PUP-2' ? { ...l, rate: Math.round(l.rate * 1.3) } : l)) }));
    const costed2 = await specFile('essential-gap', (s) => ({ ...s, lines: designLinesForEssentialGap(1.05) }));
    const res = await uploadFiles(qs, ids.diCycle, [
      { fileName: 'Bosso costed.xlsx', buffer: costed1, proposalId: ids.di1 },
      { fileName: 'Tunga costed.xlsx', buffer: costed2, proposalId: ids.di2 },
    ]);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    for (const id of [ids.di1, ids.di2]) {
      const v = await prisma.needsAssessmentVersion.findFirstOrThrow({ where: { proposalId: id }, orderBy: { number: 'desc' } });
      assert.deepEqual([v.number, v.source, v.uploadedByUserId], [3, 'COSTING', (await prisma.user.findUniqueOrThrow({ where: { email: qs } })).id]);
      assert.ok(hasSupervisionLine(parsedCosting(v.parsedJson)), 'S&M line present');
    }
    const variance = await prisma.needsProposalFlag.findFirstOrThrow({ where: { proposalId: ids.di1, kind: 'RATE_VARIANCE', resolvedAt: null } });

    // All or nothing: the open variance on 2027-DI-001 stops the whole batch.
    let decided = await request(app)
      .post(`${N}/cycles/${ids.diCycle}/decisions`)
      .set(await web(qs))
      .send({ stage: 'COSTING', reason: 'Costing signed off', items: [ids.di1, ids.di2].map((proposalId) => ({ proposalId, outcome: 'ADVANCE' })) });
    assert.equal(decided.status, 409, JSON.stringify(decided.body));
    assert.equal(decided.body.error.code, 'NEEDS_FLAGS_UNRESOLVED');
    assert.equal((await prisma.needsProposal.findUniqueOrThrow({ where: { id: ids.di2 } })).stage, 'COSTING');

    const ack = await request(app)
      .post(`${N}/proposals/${ids.di1}/flags/resolve`)
      .set(await web(qs))
      .send({ resolutions: [{ flagId: variance.id, resolution: 'ACKNOWLEDGED', reason: 'Desks priced at the 2026 Minna market rate (three quotes on file).' }] });
    assert.equal(ack.status, 200, JSON.stringify(ack.body));
    decided = await request(app)
      .post(`${N}/cycles/${ids.diCycle}/decisions`)
      .set(await web(qs))
      .send({ stage: 'COSTING', reason: 'Costing signed off', items: [ids.di1, ids.di2].map((proposalId) => ({ proposalId, outcome: 'ADVANCE' })) });
    assert.equal(decided.status, 201, JSON.stringify(decided.body));
    const dto = NeedsDecisionResultDtoSchema.parse(decided.body.data);
    assert.ok(dto.generatedDocuments.some((d) => d.kind === 'COST_ESTIMATE_REPORT' && d.mimeType === XLSX_CONTENT_TYPE));
    assert.deepEqual([...dto.generatedDocuments[0].proposalIds].sort(), [ids.di1, ids.di2].sort());
    for (const id of [ids.di1, ids.di2]) {
      const p = await prisma.needsProposal.findUniqueOrThrow({ where: { id }, include: { currentVersion: true } });
      assert.deepEqual([p.stage, p.status], ['PRIORITISATION', 'IN_PROGRESS']);
      assert.ok(Number(p.costedAmountNgn) > 0);
      assert.equal(Number(p.costedAmountNgn), Number(p.currentVersion!.costedTotalNgn));
    }
    // Required end state for DI-09: only 001 and 002 at Prioritisation.
    assert.deepEqual(
      (await prisma.needsProposal.findMany({ where: { cycleId: ids.diCycle, stage: 'PRIORITISATION' }, orderBy: { sequence: 'asc' } })).map((p) => p.reference),
      ['2027-DI-001', '2027-DI-002']
    );
  });
  it('DI-09 committee (es@ chair, dpp@, finance@, procurement@): declarations, procurement@ recused from its uploads, scores, one divergence flagged, ranking, line, override with reason, finalised; Prioritised Project Portfolio generated', async () => {
    await stepDI09({ app, prisma, web, ids, tenantId });
  });
  it('DI-10 procurement@ submits the portfolio; dpp@ management review; es@ approves with one exclusion and the memo', async () => {
    await stepDI10({ app, prisma, web, ids, tenantId });
  });
  it('DI-11 finance@ records the budget submission and imports the appropriated schedule; the funded proposal converts; the excluded one is "Not funded, carried forward"', async () => {
    await stepDI11({ app, prisma, web, ids, tenantId });
  });
  it("DI-12 the draft project has the proposal's sites, units from breakdown rows, BoQ lines and funded budget, origin NEEDS_PIPELINE, an approved-list row; procurement@ assigns a lot; a draft with origin none cannot be activated", async () => {
    await stepDI12({ app, prisma, web, ids, tenantId });
  });
  it('DI-13 opening the 2028 cycle offers the carried-forward proposal; carried, it starts at Validation with its versions linked', async () => {
    const dpp = await web('dpp@ubec.test');
    // 2027-DI-002 was excluded at approval (DI-10): not funded, carried forward.
    const excluded = await prisma.needsProposal.findUniqueOrThrow({ where: { id: ids.di2 }, include: { currentVersion: true } });
    assert.equal(excluded.status, 'NOT_SELECTED');
    const offered = await request(app).get(`${N}/cycles/carry-forward`).query({ projectTypeId: ids.di, interventionYear: 2028 }).set(dpp);
    assert.equal(offered.status, 200, JSON.stringify(offered.body));
    assert.deepEqual((offered.body.data as Array<{ reference: string; statusLabel: string }>).map((c) => [c.reference, c.statusLabel]), [['2027-DI-002', 'Not funded, carried forward']]);

    const res = await request(app).post(`${N}/cycles`).set(dpp).send({ projectTypeId: ids.di, interventionYear: 2028, carryForwardProposalIds: [ids.di2] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const carried = await prisma.needsProposal.findFirstOrThrow({ where: { cycleId: res.body.data.id }, include: { versions: true } });
    assert.deepEqual([carried.reference, carried.stage, carried.status, carried.carriedFromId], ['2028-DI-001', 'VALIDATION', 'IN_PROGRESS', ids.di2]);
    assert.deepEqual(carried.versions.map((v) => [v.number, v.source, v.sha256]), [[1, 'CARRY_FORWARD', excluded.currentVersion!.sha256]]);
    assert.equal((await prisma.needsProposal.findUniqueOrThrow({ where: { id: ids.di2 } })).statusReason, 'Carried forward to 2028-DI-001');
  });
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

  it('MG-04 kano.dpp@ field-verifies; asks for a separation override to cost (the same person validated); kano.admin@ (Executive Chairman) authorises it; kano.dpp@ costs; the override stays flagged and is in the ledger', async () => {
    const dpp = 'kano.dpp@ubec.test';
    const mg1 = (await proposalByRef('2027-MG-KN-001')).id;
    ids.mg1 = mg1;
    // Matching Grants needs the drawings at Identification (no Design stage).
    await proposalDocument('kano.procurement@ubec.test', ids.mgCycle, mg1, 'DRAWING', 'Classroom block drawings');
    let res = await action('kano.procurement@ubec.test', ids.mgCycle, 'SUBMIT', [mg1]);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.data.items[0].statusLabel, 'Pending field verification');

    res = await request(app)
      .post(`${N}/proposals/${mg1}/validation`)
      .set(await web(dpp))
      .send({
        outcome: 'ADVANCE',
        deskNotes: 'Both schools visited; classrooms condemned as reported.',
        siteVerification: {
          method: 'WEB_EVIDENCE',
          verifiedOn: '2026-09-15',
          officerName: 'Kano SUBEB Physical Planning',
          notes: null,
          evidenceDocumentIds: [await proposalDocument(dpp, ids.mgCycle, mg1, 'PHOTO', 'Site photos')],
        },
      });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    res = await request(app).post(`${N}/cycles/${ids.mgCycle}/decisions`).set(await web(dpp)).send({ stage: 'VALIDATION', items: [{ proposalId: mg1, outcome: 'ADVANCE' }] });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.data.items[0].stage, 'COSTING');

    // The validator may not cost it.
    const costed = await specFile('mg-complete-valid', (s) => ({ ...s, lines: s.lines.map((l) => (l.itemCode === 'BRD-MAG' ? { ...l, rate: Math.round(l.rate * 1.05) } : l)) }));
    const refused = await uploadFiles(dpp, ids.mgCycle, [{ fileName: 'Bebeji Garko costed.xlsx', buffer: costed, proposalId: mg1 }]);
    assert.equal(refused.status, 422, JSON.stringify(refused.body));
    assert.match(JSON.stringify(refused.body.error.details.files[0].issues), /another person must cost it/);
    const ask = await request(app)
      .post(`${N}/cycles/${ids.mgCycle}/separation-overrides`)
      .set(await web(dpp))
      .send({ proposalId: mg1, action: 'COST', reason: 'Kano SUBEB has one quantity surveyor post, vacant since June.' });
    assert.equal(ask.status, 201, JSON.stringify(ask.body));
    const flagId = ask.body.data.id as string;
    const chairman = await web('kano.admin@ubec.test');
    const queue = (await request(app).get(`${N}/tasks`).set(chairman)).body.data as Array<{ id: string; actionLabel: string }>;
    assert.ok(queue.some((t) => t.id === `PROPOSAL_ACTION:${flagId}` && t.actionLabel === 'Authorise a separation-of-duties override'), JSON.stringify(queue));
    const decided = await request(app)
      .post(`${N}/cycles/${ids.mgCycle}/separation-overrides/${flagId}/decision`)
      .set(chairman)
      .send({ decision: 'AUTHORISED', note: 'Authorised for the 2027 cycle; the Director of Finance reviews the BoQ.' });
    assert.equal(decided.status, 200, JSON.stringify(decided.body));
    assert.equal(decided.body.data.resolution, 'AUTHORISED');

    res = await uploadFiles(dpp, ids.mgCycle, [{ fileName: 'Bebeji Garko costed.xlsx', buffer: costed, proposalId: mg1 }]);
    assert.equal(res.status, 201, JSON.stringify(res.body));
    res = await request(app).post(`${N}/cycles/${ids.mgCycle}/decisions`).set(await web(dpp)).send({ stage: 'COSTING', items: [{ proposalId: mg1, outcome: 'ADVANCE' }] });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const p = await prisma.needsProposal.findUniqueOrThrow({ where: { id: mg1 }, include: { currentVersion: true } });
    assert.deepEqual([p.stage, p.status, p.currentVersion!.source], ['PRIORITISATION', 'IN_PROGRESS', 'COSTING']);
    assert.ok(Number(p.costedAmountNgn) > 0);
    const flag = await prisma.needsProposalFlag.findUniqueOrThrow({ where: { id: flagId } });
    assert.equal(flag.resolution, 'AUTHORISED');
    assert.ok((flag.detailsJson as { usedAt: string | null }).usedAt, 'the flag records the use');
    const overridden = await prisma.auditLog.findMany({ where: { tenantId, action: 'NEEDS_SEPARATION_OVERRIDDEN', payload: { path: ['proposalId'], equals: mg1 } } });
    assert.equal(overridden.length, 2, 'the costed upload and the sign-off');
  });
  it('MG-05 SUBEB committee (kano.admin@ chair, three members with the umbrella role SUBEB_COMMITTEE_MEMBER; kano.dpp@ and kano.procurement@ recused) scores and finalises', async () => {
    await stepMG05({ app, prisma, web, ids, tenantId });
  });
  it('MG-06 SUBEB management review and kano.admin@ endorsement', async () => {
    await stepMG06({ app, prisma, web, ids, tenantId });
  });
  it('MG-07 BEAP built (lot, batch, procurement method per proposal; counterpart declared) and submitted', async () => {
    await stepMG07({ app, prisma, web, ids, tenantId });
  });
  it('MG-08 dpp@ reviews, comments on one proposal and returns; SUBEB revises (new version) and resubmits', async () => {
    await stepMG08({ app, prisma, web, ids, tenantId });
  });
  it('MG-09 es@ approves (Executive Management); proposals convert, owner Kano SUBEB, lot and batch from the BEAP', async () => {
    await stepMG09({ app, prisma, web, ids, tenantId });
    // Wave 4 decision 17: a converted draft follows the project visibility rule, so the SUBEB that owns
    // it sees it (the SUBEB Administrator holds no projects:create); Lagos does not.
    const kano = await request(app).get(`/api/v1/projects/${ids.mgProject}/needs-origin`).set(await web('kano.admin@ubec.test'));
    assert.equal(kano.status, 200, JSON.stringify(kano.body));
    assert.equal(kano.body.data.origin, 'NEEDS_PIPELINE');
    const listed = await request(app).get('/api/v1/projects/drafts').set(await web('kano.admin@ubec.test'));
    assert.ok((listed.body.data as Array<{ id: string }>).some((d) => d.id === ids.mgProject), JSON.stringify(listed.body));
    // Owner decision after wave 4: the SUBEB Administrator completes and activates its converted drafts.
    const options = await request(app).get(`/api/v1/projects/${ids.mgProject}/setup/team-options`).set(await web('kano.admin@ubec.test'));
    assert.equal(options.status, 200, JSON.stringify(options.body));
    const kanoAdmin = await prisma.user.findUniqueOrThrow({ where: { email: 'kano.admin@ubec.test' }, include: { role: { include: { rolePermissions: { include: { permission: true } } } } } });
    const held = kanoAdmin.role.rolePermissions.map((rp) => rp.permission.key);
    for (const key of ['projects:edit_baseline', 'projects:activate', 'scope:edit', 'contractors:view_register']) assert.ok(held.includes(key), key);
    assert.ok(!held.includes('projects:view_all_tenant'), 'still limited to its own SUBEB');
    assert.equal((await request(app).get(`/api/v1/projects/${ids.mgProject}/needs-origin`).set(await web('lagos.admin@ubec.test'))).status, 403, 'outside the Kano tree, as for live projects');
  });
  it('MG-10 activation refused until counterpart evidence is recorded; then allowed', async () => {
    await stepMG10({ app, prisma, web, ids, tenantId });
  });
  it('OOC-01 out-of-cycle request (emergency, authorising document) approved by es@; converts with origin OUT_OF_CYCLE', async () => {
    await stepOOC01({ app, prisma, web, ids, tenantId });
  });
  it('FIELD-01 a verification visit submitted from the field app fills the validation record and corrects a site\'s coordinates', async () => {
    await stepFIELD01({ app, prisma, web, ids, tenantId });
  });
});

/**
 * Wave 4 review fixes (`needs_pipeline/wave4_approval_funding_conversion.md` section 5.6), on the end
 * state of both suites (DI 2027 appropriated, Kano BEAP approved, an out-of-cycle request converted).
 */
describe('Needs pipeline wave 4: review fixes', () => {
  it('R1 an out-of-cycle request for a year without a cycle makes a CLOSED container; opening that year adopts it with the request', async () => {
    const res = await request(app)
      .post(`${N}/out-of-cycle`)
      .set(await web('procurement@ubec.test'))
      .send({ projectTypeId: ids.di, interventionYear: 2029, title: 'Storm damage repairs, LGEA Primary School Bida', reason: 'EMERGENCY', reasonDetails: 'Roof blown off in the June storm; pupils taught outside.', requestedAmountNgn: 12_000_000 });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const container = await prisma.needsCycle.findUniqueOrThrow({ where: { id: res.body.data.cycleId } });
    assert.deepEqual([container.status, container.openedAt], ['CLOSED', null]);
    const opened = await request(app).post(`${N}/cycles`).set(await web('dpp@ubec.test')).send({ projectTypeId: ids.di, interventionYear: 2029 });
    assert.equal(opened.status, 201, JSON.stringify(opened.body));
    assert.equal(opened.body.data.id, container.id, 'the container is adopted, not duplicated');
    const after = await prisma.needsCycle.findUniqueOrThrow({ where: { id: container.id } });
    assert.equal(after.status, 'OPEN');
    assert.ok(after.openedAt);
    assert.equal(await prisma.needsApprovalStep.count({ where: { cycleId: container.id, chainType: 'OUT_OF_CYCLE', version: 1 } }), 1, 'steps not copied twice');
    assert.equal((await prisma.needsProposal.findUniqueOrThrow({ where: { id: res.body.data.proposalId } })).cycleId, container.id);
    // A cycle that was really opened is still refused.
    const again = await request(app).post(`${N}/cycles`).set(await web('dpp@ubec.test')).send({ projectTypeId: ids.di, interventionYear: 2029 });
    assert.equal(again.status, 409, JSON.stringify(again.body));
    assert.equal(again.body.error.code, 'NEEDS_CYCLE_EXISTS');
  });

  it('R2 after the Kano cycle closes, the SUBEB can still file counterpart evidence (A5), but no other BEAP document', async () => {
    const dpp = await web('kano.dpp@ubec.test');
    const closed = await request(app).post(`${N}/cycles/${ids.mgCycle}/close`).set(dpp).send({ reason: 'BEAP approved; cycle closed.' });
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    const pdf = Buffer.from(`%PDF-1.4\n% Counterpart release ${crypto.randomUUID()}\n%%EOF\n`);
    const presign = await request(app).post(`${N}/cycles/${ids.mgCycle}/beap/documents/presign`).set(dpp).send({ fileName: 'Counterpart release.pdf', mimeType: 'application/pdf', byteSize: pdf.length });
    assert.equal(presign.status, 200, JSON.stringify(presign.body));
    const target = new URL(presign.body.data.uploadUrl);
    assert.equal((await request(app).put(target.pathname + target.search).set('Content-Type', 'application/pdf').send(pdf)).status, 200);
    const narrative = await request(app).post(`${N}/cycles/${ids.mgCycle}/beap/documents`).set(dpp).send({ objectKey: presign.body.data.objectKey, kind: 'BEAP', title: 'Late narrative' });
    assert.equal(narrative.status, 409, JSON.stringify(narrative.body));
    assert.equal(narrative.body.error.code, 'NEEDS_CYCLE_NOT_OPEN');
    const evidence = await request(app).post(`${N}/cycles/${ids.mgCycle}/beap/documents`).set(dpp).send({ objectKey: presign.body.data.objectKey, kind: 'COUNTERPART_EVIDENCE', title: 'Counterpart release (second tranche)' });
    assert.equal(evidence.status, 201, JSON.stringify(evidence.body));
    const recorded = await request(app).put(`${N}/cycles/${ids.mgCycle}/beap/counterpart`).set(dpp).send({ counterpartDeclaredNgn: 25_000_000, counterpartEvidenceDocumentId: evidence.body.data.id });
    assert.equal(recorded.status, 200, JSON.stringify(recorded.body));
    // Another SUBEB still cannot file on Kano's cycle.
    const lagos = await request(app).post(`${N}/cycles/${ids.mgCycle}/beap/documents/presign`).set(await web('lagos.admin@ubec.test')).send({ fileName: 'x.pdf', mimeType: 'application/pdf', byteSize: 10 });
    assert.ok([403, 404].includes(lagos.status), JSON.stringify(lagos.body));
  });

  it("R3 another State's SUBEB never takes UBEC's step on a State cycle, even holding the permission", async () => {
    const { gateForSubmission } = await import('../modules/needs/submissions/submissions.service');
    const kano = await prisma.needsCycle.findUniqueOrThrow({ where: { id: ids.mgCycle } });
    const lagosAdmin = await prisma.user.findUniqueOrThrow({ where: { email: 'lagos.admin@ubec.test' }, include: { role: true } });
    const dpp = await prisma.user.findUniqueOrThrow({ where: { email: 'dpp@ubec.test' }, include: { role: true } });
    const asUser = (u: typeof lagosAdmin) => ({
      tokenType: 'WEB_USER' as const,
      userId: u.id,
      email: u.email,
      fullName: u.fullName,
      tenantId: u.tenantId!,
      isPlatformSuperAdmin: false,
      roleId: u.roleId,
      roleCode: u.role.code,
      roleName: u.role.name,
      permissions: ['needs:view', 'needs:review_beap'],
      organizationId: u.organizationId!,
      mustChangePassword: false,
    });
    const steps = await prisma.needsApprovalStep.findMany({ where: { cycleId: kano.id, chainType: 'BEAP', version: 1 }, orderBy: { stepOrder: 'asc' } });
    const inReview = { status: 'IN_REVIEW', kind: 'BEAP', cycleId: kano.id, chainVersion: 1, currentStepOrder: steps[0].stepOrder, submittedByUserId: null, actions: [] };
    const lagosGate = await gateForSubmission(prisma, asUser(lagosAdmin), inReview, kano, steps);
    assert.deepEqual([lagosGate.allowed, lagosGate.status, lagosGate.code], [false, 403, 'NOT_STEP_ORGANIZATION']);
    const ubecGate = await gateForSubmission(prisma, asUser(dpp), inReview, kano, steps);
    assert.equal(ubecGate.allowed, true, ubecGate.reason ?? '');
  });

  it('R4 the approved list the appropriation wrote cannot be replaced by an upload', async () => {
    const { buildApprovedListWorkbook } = await import('../modules/approvedLists/approvedListWorkbook');
    const file = await buildApprovedListWorkbook({
      generatedAt: new Date(),
      brandName: 'UBEC',
      header: { interventionYear: 2027, kind: 'DI_SCHEDULE', approvedBy: 'Executive Secretary, UBEC', approvedOn: '2026-12-20' },
      rows: [{ rowRef: 'DI/2027/X/001', projectTitle: 'Hand-typed row', state: 'Niger', costEstimate: 10_000_000 }],
    });
    const res = await request(app).post('/api/v1/approved-lists/import/preview').set(await web('admin@ubec.test')).send({ fileBase64: file.toString('base64'), fileName: 'manual.xlsx' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok((res.body.data.issues as Array<{ code: string }>).some((i) => i.code === 'APPROVED_LIST_FROM_FUNDING_GATE'), JSON.stringify(res.body.data.issues));
    assert.equal(res.body.data.canConfirm, false);
  });
});
