/**
 * Needs pipeline wave 3, Track B (N5): committee, conflict declarations, recusals, score sheets,
 * ranking with divergence and the funding line, chair overrides, finalisation and the generated
 * Prioritised Project Portfolio, minutes upload (parent plan section 17.9).
 *
 * Track A builds the stage work in parallel, so proposals are moved to Prioritisation directly in
 * the database: stage and status, costed amount, a COSTING version by the quantity surveyor and a
 * validation record, so recusals follow from the duty history.
 *
 * 1. Scenario steps DI-09 and MG-05 (`helpers/needsScenarioSteps.n5.ts`) on the starting state Track
 *    A's steps produce (2027 DI cycle with 2027-DI-001/002, Kano 2027 MG cycle with 2027-MG-KN-001).
 * 2. B1–B4 on a 2028 DI cycle whose proposals are written directly (quorum set to 2 in the cycle's
 *    frozen rubric so each recusal kind leaves a scorable proposal). The suites continue in order.
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
  NeedsCommitteeDtoSchema,
  NeedsCycleDocumentDtoSchema,
  NeedsMyScoringDtoSchema,
  NeedsProposalScoresDtoSchema,
  NeedsRankingDtoSchema,
  NeedsUploadResultDtoSchema,
  type NeedsRankingDto,
} from '@insite/shared';
import { needsFixture, needsFixtureBase64, type NeedsFixtureName } from './fixtures/needs/needsFixtures';
import { stepDI09, stepMG05, type NeedsScenarioContext } from './helpers/needsScenarioSteps.n5';

type PrismaClientType = typeof import('../config/prisma')['prisma'];

let app: Express;
let prisma: PrismaClientType;
let tenantId = '';
const tokens: Record<string, string> = {};
const ids: Record<string, string> = {};
const N = '/api/v1/needs';

const ES = 'es@ubec.test';
const DPP = 'dpp@ubec.test';
const FINANCE = 'finance@ubec.test';
const PROCUREMENT = 'procurement@ubec.test';
const QS = 'qs@ubec.test';
const ME_OFFICER = 'me.officer@ubec.test';
const KANO_ADMIN = 'kano.admin@ubec.test';
const KANO_DPP = 'kano.dpp@ubec.test';
const KANO_PROCUREMENT = 'kano.procurement@ubec.test';
const LAGOS_ADMIN = 'lagos.admin@ubec.test';

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

async function api(email: string, method: 'get' | 'put' | 'post' | 'patch', path: string, body?: unknown) {
  const req = request(app)[method](`${N}${path}`).set(await web(email));
  return body === undefined ? req : req.send(body as object);
}
async function ok(email: string, method: 'get' | 'put' | 'post' | 'patch', path: string, body?: unknown, status = 200) {
  const res = await api(email, method, path, body);
  assert.equal(res.status, status, `${method.toUpperCase()} ${path} as ${email}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}
async function refused(email: string, method: 'get' | 'put' | 'post' | 'patch', path: string, body: unknown, status: number, code: string) {
  const res = await api(email, method, path, body);
  assert.equal(res.status, status, `${method.toUpperCase()} ${path} as ${email}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.error.code, code, JSON.stringify(res.body));
  return res.body.error;
}

const user = (email: string) => prisma.user.findUniqueOrThrow({ where: { email } });
const userId = async (email: string) => (await user(email)).id;
const proposalByRef = (reference: string) => prisma.needsProposal.findFirstOrThrow({ where: { tenantId, reference } });

/** The Track A end state of a proposal at Prioritisation: costed version by `costedBy`, validation record by `validatedBy`. */
async function moveToPrioritisation(reference: string, costedNgn: number, costedBy: string, validatedBy: string) {
  const p = await proposalByRef(reference);
  const current = await prisma.needsAssessmentVersion.findUniqueOrThrow({ where: { id: p.currentVersionId! } });
  const [coster, validator] = [await user(costedBy), await user(validatedBy)];
  await prisma.needsValidationRecord.create({
    data: { proposalId: p.id, versionId: current.id, outcome: 'ADVANCE', deskNotes: 'Desk review done (test).', recordedByUserId: validator.id, recordedByName: validator.fullName },
  });
  const costed = await prisma.needsAssessmentVersion.create({
    data: {
      proposalId: p.id,
      number: current.number + 1,
      source: 'COSTING',
      objectKey: current.objectKey,
      fileName: current.fileName,
      mimeType: current.mimeType,
      byteSize: current.byteSize,
      sha256: current.sha256,
      templateVersion: current.templateVersion,
      costingStandardVersionId: current.costingStandardVersionId,
      parsedJson: current.parsedJson as object,
      siteCount: current.siteCount,
      breakdownRowCount: current.breakdownRowCount,
      boqLineCount: current.boqLineCount,
      costedTotalNgn: costedNgn,
      uploadedByUserId: coster.id,
      uploadedByName: coster.fullName,
    },
  });
  await prisma.needsProposal.update({ where: { id: p.id }, data: { stage: 'PRIORITISATION', status: 'IN_PROGRESS', costedAmountNgn: costedNgn, currentVersionId: costed.id } });
}

async function uploadAs(email: string, cycleId: string, names: NeedsFixtureName[]) {
  const res = await request(app).post(`${N}/cycles/${cycleId}/uploads/confirm`).set(await web(email)).send({ files: names.map(upload) });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const dto = NeedsUploadResultDtoSchema.parse(res.body.data);
  assert.ok(dto.files.every((f) => f.outcome === 'CREATED'), JSON.stringify(dto.files));
}

const ctx = (): NeedsScenarioContext => ({ app, prisma, web, ids, tenantId });

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  await clearSeededNeedsPipeline(prisma);
  const { createApp } = await import('../app');
  app = createApp();
  tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } })).id;
  ids.di = (await prisma.projectType.findFirstOrThrow({ where: { tenantId, code: 'CENTRAL' } })).id;
  ids.mg = (await prisma.projectType.findFirstOrThrow({ where: { tenantId, code: 'CO_FUNDED' } })).id;

  // Starting state of DI-09 (Track A's DI-01 … DI-08 end state).
  ids.diCycle = (await ok(DPP, 'post', '/cycles', { projectTypeId: ids.di, interventionYear: 2027 }, 201)).id;
  await uploadAs(PROCUREMENT, ids.diCycle, ['di-draft-valid', 'essential-gap']);
  await moveToPrioritisation('2027-DI-001', 120_000_000, QS, ME_OFFICER);
  await moveToPrioritisation('2027-DI-002', 90_000_000, QS, ME_OFFICER);

  // Starting state of MG-05 (Track A's MG-01 … MG-04 end state).
  ids.mgCycle = (await ok(KANO_DPP, 'post', '/cycles', { projectTypeId: ids.mg, interventionYear: 2027, stateCode: 'KN' }, 201)).id;
  await uploadAs(KANO_PROCUREMENT, ids.mgCycle, ['mg-complete-valid']);
  await moveToPrioritisation('2027-MG-KN-001', 75_000_000, KANO_DPP, KANO_DPP);
});

describe('needs pipeline N5: scenario steps', () => {
  it('DI-09 committee (es@ chair, dpp@, finance@, procurement@): declarations, procurement@ recused from its uploads, scores, one divergence flagged, ranking, line, override with reason, finalised; Prioritised Project Portfolio generated', async () => {
    await stepDI09(ctx());
  });

  it('MG-05 SUBEB committee (kano.admin@ chair, three members with the umbrella role SUBEB_COMMITTEE_MEMBER; kano.dpp@ and kano.procurement@ recused) scores and finalises', async () => {
    await stepMG05(ctx());
  });
});

// ---------------------------------------------------------------------------
// B1–B4 on a 2028 DI cycle (proposals written directly).
// ---------------------------------------------------------------------------

const P: Record<string, string> = {};
let criteria: Array<{ key: string; dimension: 'IMPACT' | 'EASE'; label: string }> = [];
const sheet = (impact: number, ease: number, except: Record<string, number> = {}) =>
  Object.fromEntries(criteria.map((c) => [c.key, except[c.key] ?? (c.dimension === 'IMPACT' ? impact : ease)]));

/**
 * One proposal of the 2028 cycle: an UPLOAD version by procurement@, then a COSTING version by
 * `costedBy`, a validation record by `validatedBy`.
 */
async function makeProposal(seq: number, opts: { costNgn: number; costedBy: string; validatedBy: string; stage?: string }) {
  const template = await prisma.needsAssessmentVersion.findFirstOrThrow({ where: { proposal: { reference: '2027-DI-001' }, number: 1 } });
  const source = await proposalByRef('2027-DI-001');
  const [uploader, coster, validator] = [await user(PROCUREMENT), await user(opts.costedBy), await user(opts.validatedBy)];
  const reference = `2028-DI-${String(seq).padStart(3, '0')}`;
  const proposal = await prisma.needsProposal.create({
    data: {
      tenantId,
      cycleId: ids.diCycle2028,
      reference,
      sequence: seq,
      title: `Proposed project ${seq} (2028)`,
      stage: opts.stage ?? 'PRIORITISATION',
      status: 'IN_PROGRESS',
      stateCode: source.stateCode,
      lgaCodes: source.lgaCodes,
      costedAmountNgn: opts.costNgn,
      createdByUserId: uploader.id,
      createdByName: uploader.fullName,
    },
  });
  const base = {
    proposalId: proposal.id,
    objectKey: `${template.objectKey}#${reference}`,
    fileName: `${reference}.xlsx`,
    mimeType: template.mimeType,
    byteSize: template.byteSize,
    sha256: sha(Buffer.from(reference)),
    templateVersion: template.templateVersion,
    costingStandardVersionId: template.costingStandardVersionId,
    parsedJson: template.parsedJson as object,
    siteCount: template.siteCount,
    breakdownRowCount: template.breakdownRowCount,
    boqLineCount: template.boqLineCount,
  };
  const v1 = await prisma.needsAssessmentVersion.create({ data: { ...base, number: 1, source: 'UPLOAD', uploadedByUserId: uploader.id, uploadedByName: uploader.fullName } });
  await prisma.needsValidationRecord.create({
    data: { proposalId: proposal.id, versionId: v1.id, outcome: 'ADVANCE', deskNotes: 'Desk review done (test).', recordedByUserId: validator.id, recordedByName: validator.fullName },
  });
  const v2 = await prisma.needsAssessmentVersion.create({
    data: { ...base, number: 2, source: 'COSTING', costedTotalNgn: opts.costNgn, uploadedByUserId: coster.id, uploadedByName: coster.fullName },
  });
  await prisma.needsProposal.update({ where: { id: proposal.id }, data: { currentVersionId: v2.id } });
  return proposal.id;
}

const C = () => `/cycles/${ids.diCycle2028}`;
const ranking = async (email = ES): Promise<NeedsRankingDto> => NeedsRankingDtoSchema.parse(await ok(email, 'get', `${C()}/ranking`));
const score = (email: string, proposalId: string, scores: Record<string, number>) => ok(email, 'put', `${C()}/score-sheets`, { proposalId, scores, comment: null });

describe('needs pipeline N5 B1: committee, declarations, recusals', () => {
  before(async () => {
    ids.diCycle2028 = (await ok(DPP, 'post', '/cycles', { projectTypeId: ids.di, interventionYear: 2028, indicativeCeilingNgn: 180_000_000 }, 201)).id;
    const cycle = await prisma.needsCycle.findUniqueOrThrow({ where: { id: ids.diCycle2028 } });
    const config = cycle.configSnapshotJson as { rubric: { quorum: number; criteria: typeof criteria } };
    criteria = config.rubric.criteria;
    // Quorum 2 so each recusal kind below still leaves a scorable proposal.
    await prisma.needsCycle.update({ where: { id: cycle.id }, data: { configSnapshotJson: { ...config, rubric: { ...config.rubric, quorum: 2 } }, proposalSequence: 5 } });
    P.p1 = await makeProposal(1, { costNgn: 100_000_000, costedBy: QS, validatedBy: ME_OFFICER });
    P.p2 = await makeProposal(2, { costNgn: 80_000_000, costedBy: QS, validatedBy: DPP }); // dpp@ recused: VALIDATED
    P.p3 = await makeProposal(3, { costNgn: 60_000_000, costedBy: FINANCE, validatedBy: ME_OFFICER }); // finance@ recused: COSTED
    P.p4 = await makeProposal(4, { costNgn: 50_000_000, costedBy: QS, validatedBy: ME_OFFICER }); // finance@ declares a conflict
    P.p5 = await makeProposal(5, { costNgn: 40_000_000, costedBy: QS, validatedBy: ME_OFFICER, stage: 'COSTING' });
  });

  it('only a holder of needs:chair_committee sets the committee, as its chair row; members must hold needs:score and belong to the owning organisation (422 NEEDS_COMMITTEE_MEMBER_INVALID)', async () => {
    const [es, dpp, qs, kano] = [await userId(ES), await userId(DPP), await userId(QS), await userId('kano.committee1@ubec.test')];
    await refused(DPP, 'put', `${C()}/committee`, { members: [{ userId: dpp, role: 'CHAIR' }] }, 403, 'FORBIDDEN_PERMISSION');
    let err = await refused(ES, 'put', `${C()}/committee`, { members: [{ userId: es, role: 'CHAIR' }, { userId: qs, role: 'MEMBER' }] }, 422, 'NEEDS_COMMITTEE_MEMBER_INVALID');
    assert.deepEqual(err.details.userIds, [qs]);
    err = await refused(ES, 'put', `${C()}/committee`, { members: [{ userId: es, role: 'CHAIR' }, { userId: kano, role: 'MEMBER' }] }, 422, 'NEEDS_COMMITTEE_MEMBER_INVALID');
    assert.deepEqual(err.details.userIds, [kano]);
    await refused(ES, 'put', `${C()}/committee`, { members: [{ userId: dpp, role: 'CHAIR' }, { userId: es, role: 'MEMBER' }] }, 422, 'NEEDS_COMMITTEE_MEMBER_INVALID');
    const bad = await api(ES, 'put', `${C()}/committee`, { members: [{ userId: es, role: 'MEMBER' }] });
    assert.equal(bad.status, 400, 'exactly one chair (schema)');

    const dto = NeedsCommitteeDtoSchema.parse(await ok(ES, 'put', `${C()}/committee`, { members: [{ userId: es, role: 'CHAIR' }] }));
    assert.deepEqual(dto.members.map((m) => [m.fullName, m.role]), [[(await user(ES)).fullName, 'CHAIR']]);
    assert.equal(dto.canManage, true);
    assert.deepEqual(dto.me, { memberId: dto.members[0].id, role: 'CHAIR', declared: false });
    const candidates = new Map(dto.candidates.map((c) => [c.userId, c]));
    for (const email of [ES, DPP, FINANCE, PROCUREMENT]) assert.equal(candidates.get(await userId(email))?.canScore, true, email);
    assert.equal(candidates.get(es)?.canChair, true);
    assert.equal(candidates.has(qs), false, 'qs@ neither scores nor chairs');
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'NEEDS_COMMITTEE_UPDATED' }, orderBy: { seq: 'desc' } });
    assert.equal(audit.projectId, null);
    assert.equal((audit.payload as { cycleId: string }).cycleId, ids.diCycle2028);
  });

  it('scoring opens only with every member declared (409 NEEDS_CONFLICT_NOT_DECLARED) and a quorum of scorers (409 NEEDS_QUORUM_NOT_MET)', async () => {
    await refused(ES, 'post', `${C()}/committee/scoring`, { action: 'OPEN' }, 409, 'NEEDS_CONFLICT_NOT_DECLARED');
    await ok(ES, 'post', `${C()}/committee/declaration`, { hasConflict: false });
    const err = await refused(ES, 'post', `${C()}/committee/scoring`, { action: 'OPEN' }, 409, 'NEEDS_QUORUM_NOT_MET');
    assert.deepEqual(err.details, { quorum: 2, scorers: 1 });
  });

  it('a non-member cannot declare (403 NEEDS_NOT_COMMITTEE_MEMBER); a conflict names proposals of this cycle only (404); the chair changes the membership', async () => {
    const [es, dpp, fin, proc] = [await userId(ES), await userId(DPP), await userId(FINANCE), await userId(PROCUREMENT)];
    await ok(ES, 'put', `${C()}/committee`, { members: [{ userId: es, role: 'CHAIR' }, { userId: dpp, role: 'MEMBER' }, { userId: proc, role: 'MEMBER' }] });
    await refused(FINANCE, 'post', `${C()}/committee/declaration`, { hasConflict: false }, 403, 'NEEDS_NOT_COMMITTEE_MEMBER');
    await refused(DPP, 'put', `${C()}/committee`, { members: [{ userId: dpp, role: 'CHAIR' }] }, 403, 'FORBIDDEN_PERMISSION');
    const dto = NeedsCommitteeDtoSchema.parse(
      await ok(ES, 'put', `${C()}/committee`, {
        members: [{ userId: es, role: 'CHAIR' }, { userId: dpp, role: 'MEMBER' }, { userId: proc, role: 'MEMBER' }, { userId: fin, role: 'MEMBER' }],
      })
    );
    assert.equal(dto.members.length, 4);
    assert.equal(dto.members.find((m) => m.userId === es)!.conflictDeclaredAt !== null, true, 'a kept member keeps their declaration');
    const other = (await proposalByRef('2027-DI-001')).id;
    await refused(FINANCE, 'post', `${C()}/committee/declaration`, { hasConflict: true, conflictedProposalIds: [other] }, 404, 'NEEDS_PROPOSAL_NOT_FOUND');
    await ok(FINANCE, 'post', `${C()}/committee/declaration`, { hasConflict: true, conflictedProposalIds: [P.p4], statement: 'My brother-in-law is the head teacher.' });
    await ok(DPP, 'post', `${C()}/committee/declaration`, { hasConflict: false });
    await ok(PROCUREMENT, 'post', `${C()}/committee/declaration`, { hasConflict: false });
    const declared = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'NEEDS_CONFLICT_DECLARED', actorId: fin }, orderBy: { seq: 'desc' } });
    assert.deepEqual((declared.payload as { conflictedProposalIds: string[] }).conflictedProposalIds, [P.p4]);
  });

  it('recusals follow the duty history (uploaded, validated, costed) and the declaration, per member', async () => {
    const dto = NeedsCommitteeDtoSchema.parse(await ok(ES, 'get', `${C()}/committee`));
    const ref = new Map(Object.entries(P).map(([k, v]) => [v, k]));
    const recusals = async (email: string) => {
      const id = await userId(email);
      return dto.members.find((x) => x.userId === id)!.recusals.map((r) => `${ref.get(r.proposalId)} ${r.reason}`).sort();
    };
    assert.deepEqual(await recusals(ES), []);
    assert.deepEqual(await recusals(PROCUREMENT), ['p1 UPLOADED', 'p2 UPLOADED', 'p3 UPLOADED', 'p4 UPLOADED']);
    assert.deepEqual(await recusals(DPP), ['p2 VALIDATED']);
    assert.deepEqual(await recusals(FINANCE), ['p3 COSTED', 'p4 DECLARED_CONFLICT']);
    assert.equal(dto.proposalCount, 4, 'the proposal at Costing is not in scope');
  });

  it('the chair opens scoring once everyone has declared; opening twice is refused (409 NEEDS_SCORING_ALREADY_OPEN)', async () => {
    const dto = NeedsCommitteeDtoSchema.parse(await ok(ES, 'post', `${C()}/committee/scoring`, { action: 'OPEN' }));
    assert.ok(dto.scoringOpenedAt);
    assert.equal(dto.scoringOpenedByName, (await user(ES)).fullName);
    await refused(ES, 'post', `${C()}/committee/scoring`, { action: 'OPEN' }, 409, 'NEEDS_SCORING_ALREADY_OPEN');
    await refused(DPP, 'post', `${C()}/committee/scoring`, { action: 'CLOSE' }, 403, 'FORBIDDEN_PERMISSION');
  });

  it('isolation: Lagos users get 404 on the Kano cycle; UBEC HQ reads it but cannot write it (403 NEEDS_CYCLE_FORBIDDEN)', async () => {
    const mg1 = (await proposalByRef('2027-MG-KN-001')).id;
    for (const path of [`/cycles/${ids.mgCycle}/committee`, `/cycles/${ids.mgCycle}/ranking`, `/cycles/${ids.mgCycle}/score-sheets/mine`, `/proposals/${mg1}/scores`]) {
      const res = await api(LAGOS_ADMIN, 'get', path);
      assert.equal(res.status, 404, `${path}: ${JSON.stringify(res.body)}`);
    }
    assert.equal((await api(ES, 'get', `/cycles/${ids.mgCycle}/committee`)).status, 200);
    await refused(ES, 'put', `/cycles/${ids.mgCycle}/committee`, { members: [{ userId: await userId(ES), role: 'CHAIR' }] }, 403, 'NEEDS_CYCLE_FORBIDDEN');
    await refused(DPP, 'put', `/cycles/${ids.mgCycle}/score-sheets`, { proposalId: mg1, scores: sheet(3, 3) }, 403, 'NEEDS_CYCLE_FORBIDDEN');
    await refused(LAGOS_ADMIN, 'put', `${C()}/committee`, { members: [{ userId: await userId(LAGOS_ADMIN), role: 'CHAIR' }] }, 404, 'NEEDS_CYCLE_NOT_FOUND');
  });
});

describe('needs pipeline N5 B2: score sheets', () => {
  it('scores name exactly the criteria of the cycle rubric (422 NEEDS_SCORE_INCOMPLETE)', async () => {
    const full = sheet(5, 2);
    const missing = { ...full };
    delete missing[criteria[0].key];
    let err = await refused(ES, 'put', `${C()}/score-sheets`, { proposalId: P.p1, scores: missing }, 422, 'NEEDS_SCORE_INCOMPLETE');
    assert.deepEqual(err.details.missing, [criteria[0].key]);
    err = await refused(ES, 'put', `${C()}/score-sheets`, { proposalId: P.p1, scores: { ...full, made_up_key: 3 } }, 422, 'NEEDS_SCORE_INCOMPLETE');
    assert.deepEqual(err.details.unknown, ['made_up_key']);
    const bad = await api(ES, 'put', `${C()}/score-sheets`, { proposalId: P.p1, scores: { ...full, [criteria[0].key]: 6 } });
    assert.equal(bad.status, 400, 'scores are 1–5 (schema)');
  });

  it('a recused member is refused (409 NEEDS_MEMBER_RECUSED), as is a proposal not at Prioritisation (409) or of another cycle (404)', async () => {
    await refused(PROCUREMENT, 'put', `${C()}/score-sheets`, { proposalId: P.p1, scores: sheet(3, 3) }, 409, 'NEEDS_MEMBER_RECUSED');
    await refused(DPP, 'put', `${C()}/score-sheets`, { proposalId: P.p2, scores: sheet(3, 3) }, 409, 'NEEDS_MEMBER_RECUSED');
    await refused(FINANCE, 'put', `${C()}/score-sheets`, { proposalId: P.p3, scores: sheet(3, 3) }, 409, 'NEEDS_MEMBER_RECUSED');
    await refused(FINANCE, 'put', `${C()}/score-sheets`, { proposalId: P.p4, scores: sheet(3, 3) }, 409, 'NEEDS_MEMBER_RECUSED');
    await refused(ES, 'put', `${C()}/score-sheets`, { proposalId: P.p5, scores: sheet(3, 3) }, 409, 'NEEDS_STAGE_ACTION_NOT_ALLOWED');
    await refused(ES, 'put', `${C()}/score-sheets`, { proposalId: (await proposalByRef('2027-DI-001')).id, scores: sheet(3, 3) }, 404, 'NEEDS_PROPOSAL_NOT_FOUND');
    await refused(QS, 'put', `${C()}/score-sheets`, { proposalId: P.p1, scores: sheet(3, 3) }, 403, 'FORBIDDEN_PERMISSION');
  });

  it('the chair cannot place a proposal that has no score yet (409 NEEDS_PROPOSAL_NOT_SCORED)', async () => {
    await refused(ES, 'post', `${C()}/ranking/placements`, { proposalId: P.p1, placement: 'ABOVE', reason: 'Urgent repairs before the rains' }, 409, 'NEEDS_PROPOSAL_NOT_SCORED');
  });

  it('one sheet per member and proposal: saving again edits it; the live score is stored on the proposal; audit NEEDS_SCORE_SUBMITTED', async () => {
    const first = await score(ES, P.p1, sheet(4, 2));
    const again = await score(ES, P.p1, sheet(5, 2));
    assert.equal(again.id, first.id);
    assert.equal(await prisma.needsScoreSheet.count({ where: { proposalId: P.p1 } }), 1);
    let p1 = await prisma.needsProposal.findUniqueOrThrow({ where: { id: P.p1 } });
    assert.deepEqual([Number(p1.scoreImpact), Number(p1.scoreEase), Number(p1.scoreTotal)], [100, 40, 76]);
    await score(DPP, P.p1, sheet(5, 2));
    await score(FINANCE, P.p1, sheet(5, 2));
    p1 = await prisma.needsProposal.findUniqueOrThrow({ where: { id: P.p1 } });
    assert.equal(Number(p1.scoreTotal), 76);
    const entries = await prisma.auditLog.findMany({ where: { tenantId, action: 'NEEDS_SCORE_SUBMITTED' } });
    const mine = entries.filter((e) => (e.payload as { proposalId: string }).proposalId === P.p1);
    assert.equal(mine.length, 4);
    assert.equal(mine.filter((e) => (e.payload as { edited: boolean }).edited).length, 1);
  });

  it('a member with score sheets cannot be removed (409 NEEDS_COMMITTEE_MEMBER_HAS_SCORES)', async () => {
    const [es, proc, fin] = [await userId(ES), await userId(PROCUREMENT), await userId(FINANCE)];
    const err = await refused(ES, 'put', `${C()}/committee`, { members: [{ userId: es, role: 'CHAIR' }, { userId: proc, role: 'MEMBER' }, { userId: fin, role: 'MEMBER' }] }, 409, 'NEEDS_COMMITTEE_MEMBER_HAS_SCORES');
    assert.deepEqual(err.details.userIds, [await userId(DPP)]);
  });

  it('a newly declared conflict deletes the member’s sheet on that proposal (said in the ledger); declaring none again lets them score it', async () => {
    const dpp = await userId(DPP);
    await ok(DPP, 'post', `${C()}/committee/declaration`, { hasConflict: true, conflictedProposalIds: [P.p1] });
    assert.equal(await prisma.needsScoreSheet.count({ where: { proposalId: P.p1, member: { userId: dpp } } }), 0);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'NEEDS_CONFLICT_DECLARED', actorId: dpp }, orderBy: { seq: 'desc' } });
    assert.match(entry.summaryText, /1 score sheet on them deleted/);
    assert.equal((entry.payload as { deletedScoreSheetIds: string[] }).deletedScoreSheetIds.length, 1);
    await ok(DPP, 'post', `${C()}/committee/declaration`, { hasConflict: false });
    await score(DPP, P.p1, sheet(5, 2));
  });

  it('independent scores: before finalisation a member sees only their own sheet, the chair sees all, a reader outside the committee none', async () => {
    // P2: impact 4, ease 3 and 4 (mean 3.5) → 76, ties P1. P3: one criterion 5 vs 1 (mean unchanged).
    await score(ES, P.p2, sheet(4, 3));
    await score(FINANCE, P.p2, sheet(4, 4));
    await score(ES, P.p3, sheet(3, 3, { [criteria[0].key]: 5 }));
    const asMember = NeedsProposalScoresDtoSchema.parse(await ok(FINANCE, 'get', `/proposals/${P.p2}/scores`));
    assert.equal(asMember.sheetsHidden, true);
    assert.equal(asMember.score, null, 'no combined score for a member before finalisation');
    assert.deepEqual(asMember.sheets.map((s) => s.memberUserId), [await userId(FINANCE)]);
    assert.equal(asMember.sheetCount, 2);
    assert.equal(asMember.eligibleCount, 2);
    const asChair = NeedsProposalScoresDtoSchema.parse(await ok(ES, 'get', `/proposals/${P.p2}/scores`));
    assert.equal(asChair.sheetsHidden, false);
    assert.equal(asChair.sheets.length, 2);
    assert.deepEqual(asChair.recusals.map((r) => r.reason).sort(), ['UPLOADED', 'VALIDATED']);
    const asReader = NeedsProposalScoresDtoSchema.parse(await ok(ME_OFFICER, 'get', `/proposals/${P.p2}/scores`));
    assert.equal(asReader.sheetsHidden, true);
    assert.equal(asReader.sheets.length, 0);
    assert.deepEqual(asReader.score, { impact: 80, ease: 70, total: 76 });
    const mine = NeedsMyScoringDtoSchema.parse(await ok(FINANCE, 'get', `${C()}/score-sheets/mine`));
    assert.equal(mine.canScore, true);
    assert.deepEqual(mine.items.map((i) => [i.reference, i.recusal, i.sheet !== null]), [
      ['2028-DI-001', null, true],
      ['2028-DI-002', null, true],
      ['2028-DI-003', 'COSTED', false],
      ['2028-DI-004', 'DECLARED_CONFLICT', false],
    ]);
    const outsider = NeedsMyScoringDtoSchema.parse(await ok(ME_OFFICER, 'get', `${C()}/score-sheets/mine`));
    assert.equal(outsider.canScore, false);
    assert.equal(outsider.cannotScoreReason, 'You are not on this cycle’s committee');
  });

  it('closing scoring freezes the sheets (409 NEEDS_SCORING_NOT_OPEN); the chair reopens it', async () => {
    const closed = NeedsCommitteeDtoSchema.parse(await ok(ES, 'post', `${C()}/committee/scoring`, { action: 'CLOSE' }));
    assert.ok(closed.scoringClosedAt);
    await refused(DPP, 'put', `${C()}/score-sheets`, { proposalId: P.p3, scores: sheet(3, 3) }, 409, 'NEEDS_SCORING_NOT_OPEN');
    const mine = NeedsMyScoringDtoSchema.parse(await ok(DPP, 'get', `${C()}/score-sheets/mine`));
    assert.equal(mine.cannotScoreReason, 'The chair has closed scoring');
    await refused(ES, 'post', `${C()}/committee/scoring`, { action: 'CLOSE' }, 409, 'NEEDS_SCORING_NOT_OPEN');
    const reopened = NeedsCommitteeDtoSchema.parse(await ok(ES, 'post', `${C()}/committee/scoring`, { action: 'OPEN' }));
    assert.equal(reopened.scoringClosedAt, null);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'NEEDS_COMMITTEE_UPDATED' }, orderBy: { seq: 'desc' } });
    assert.match(entry.summaryText, /^Reopened scoring/);
  });

  it('divergence of 2 points or more on a criterion is flagged with its label; 1 point is not', async () => {
    await score(DPP, P.p3, sheet(3, 3, { [criteria[0].key]: 1 }));
    const p3 = NeedsProposalScoresDtoSchema.parse(await ok(ES, 'get', `/proposals/${P.p3}/scores`));
    assert.deepEqual(p3.divergent, [{ criterionKey: criteria[0].key, label: criteria[0].label, min: 1, max: 5, spread: 4 }]);
    assert.deepEqual(p3.score, { impact: 60, ease: 60, total: 60 }, 'flagged, not averaged away: the mean stays');
    const p2 = NeedsProposalScoresDtoSchema.parse(await ok(ES, 'get', `/proposals/${P.p2}/scores`));
    assert.deepEqual(p2.divergent, []);
  });
});

describe('needs pipeline N5 B3: ranking, line and overrides', () => {
  it('finalising is refused while a proposal is short of the quorum (409 NEEDS_QUORUM_NOT_MET lists it)', async () => {
    await score(ES, P.p4, sheet(3, 3));
    const view = await ranking();
    assert.equal(view.canFinalise, false);
    assert.match(view.cannotFinaliseReason ?? '', /2028-DI-004 has 1/);
    const err = await refused(ES, 'post', `${C()}/ranking/finalise`, {}, 409, 'NEEDS_QUORUM_NOT_MET');
    assert.deepEqual(err.details.items.map((p: { reference: string; sheetCount: number; eligibleCount: number }) => [p.reference, p.sheetCount, p.eligibleCount]), [['2028-DI-004', 1, 2]]);
  });

  it('ranking: ties go to higher Impact, then lower cost; cumulative cost; the indicative ceiling draws the line', async () => {
    await score(DPP, P.p4, sheet(3, 3));
    const view = await ranking();
    assert.deepEqual(view.rows.map((r) => [r.reference, r.rank, r.score?.total, r.costNgn, r.cumulativeNgn, r.computedAboveLine, r.aboveLine]), [
      ['2028-DI-001', 1, 76, 100_000_000, 100_000_000, true, true], // 76, Impact 100
      ['2028-DI-002', 2, 76, 80_000_000, 180_000_000, true, true], // 76, Impact 80: cheaper but lower Impact
      ['2028-DI-004', 3, 60, 50_000_000, 230_000_000, false, false], // 60 tie, Impact tie: lower cost first
      ['2028-DI-003', 4, 60, 60_000_000, 290_000_000, false, false],
    ]);
    assert.equal(view.ceilingNgn, 180_000_000);
    assert.equal(view.computedLinePosition, 2);
    assert.equal(view.linePosition, 2);
    assert.equal(view.totalAboveNgn, 180_000_000);
    assert.equal(view.rows.find((r) => r.reference === '2028-DI-003')!.divergent.length, 1);
    assert.equal(view.canFinalise, true);
    const outsider = await ranking(ME_OFFICER);
    assert.equal(outsider.canFinalise, false, 'only the chair finalises');
    assert.equal(outsider.rows.length, 4, 'a reader outside the committee sees the live ranking');
  });

  it('independent scoring: before finalisation a member who is not the chair gets no combined scores (ranking 403 NEEDS_SCORES_HIDDEN; proposal scores without score, rank or divergence)', async () => {
    await refused(DPP, 'get', `${C()}/ranking`, undefined, 403, 'NEEDS_SCORES_HIDDEN');
    const asMember = NeedsProposalScoresDtoSchema.parse(await ok(DPP, 'get', `/proposals/${P.p3}/scores`));
    assert.deepEqual([asMember.score, asMember.rank, asMember.aboveLine, asMember.lineOverrideReason], [null, null, null, null]);
    assert.deepEqual(asMember.divergent, []);
    assert.equal(asMember.sheetsHidden, true);
    assert.deepEqual(asMember.sheets.map((s) => s.memberUserId), [await userId(DPP)]);
    const asChair = NeedsProposalScoresDtoSchema.parse(await ok(ES, 'get', `/proposals/${P.p3}/scores`));
    assert.equal(asChair.score?.total, 60);
    assert.equal(asChair.divergent.length, 1);
    // Main thread (integration): the proposal list and detail hide the live score from the member too.
    const memberList = (await ok(DPP, 'get', `${C()}/proposals`)) as Array<{ id: string; scoreTotal: number | null; aboveLine: boolean | null }>;
    assert.equal(memberList.find((r) => r.id === P.p3)?.scoreTotal, null);
    assert.equal(((await ok(DPP, 'get', `/proposals/${P.p3}`)) as { scoreTotal: number | null }).scoreTotal, null);
    const chairList = (await ok(ES, 'get', `${C()}/proposals`)) as Array<{ id: string; scoreTotal: number | null; aboveLine: boolean | null }>;
    assert.equal(chairList.find((r) => r.id === P.p3)?.scoreTotal, 60);
    assert.ok(chairList.every((r) => r.aboveLine === null), 'no line position before finalisation');
  });

  it('the chair moves the line with a reason (null puts it back at the ceiling); audit NEEDS_RANKING_OVERRIDDEN', async () => {
    const noReason = await api(ES, 'put', `${C()}/ranking/line`, { linePosition: 3 });
    assert.equal(noReason.status, 400);
    let view = NeedsRankingDtoSchema.parse(await ok(ES, 'put', `${C()}/ranking/line`, { linePosition: 3, reason: 'Supplementary allocation expected' }));
    assert.equal(view.linePosition, 3);
    assert.equal(view.computedLinePosition, 2);
    assert.equal(view.lineReason, 'Supplementary allocation expected');
    assert.deepEqual(view.rows.map((r) => r.aboveLine), [true, true, true, false]);
    assert.equal(view.totalAboveNgn, 230_000_000);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'NEEDS_RANKING_OVERRIDDEN' }, orderBy: { seq: 'desc' } });
    assert.match(entry.summaryText, /after rank 3: Supplementary allocation expected/);
    view = NeedsRankingDtoSchema.parse(await ok(ES, 'put', `${C()}/ranking/line`, { linePosition: null }));
    assert.equal(view.linePosition, 2);
    assert.equal(view.lineReason, null);
    await refused(DPP, 'put', `${C()}/ranking/line`, { linePosition: 1, reason: 'Not the chair' }, 403, 'FORBIDDEN_PERMISSION');
  });

  it('the chair places single proposals across the line, each with a reason; null clears; a chair-permission holder of another organisation cannot see the cycle (404)', async () => {
    const noReason = await api(ES, 'post', `${C()}/ranking/placements`, { proposalId: P.p3, placement: 'ABOVE' });
    assert.equal(noReason.status, 400);
    let view = NeedsRankingDtoSchema.parse(await ok(ES, 'post', `${C()}/ranking/placements`, { proposalId: P.p3, placement: 'ABOVE', reason: 'Only school in the LGA with no classrooms' }));
    const p3 = view.rows.find((r) => r.reference === '2028-DI-003')!;
    assert.deepEqual([p3.computedAboveLine, p3.aboveLine, p3.placement, p3.placementReason], [false, true, 'ABOVE', 'Only school in the LGA with no classrooms']);
    view = NeedsRankingDtoSchema.parse(await ok(ES, 'post', `${C()}/ranking/placements`, { proposalId: P.p2, placement: 'BELOW', reason: 'Site access unresolved' }));
    assert.deepEqual(view.rows.map((r) => [r.reference, r.aboveLine]), [
      ['2028-DI-001', true],
      ['2028-DI-002', false],
      ['2028-DI-004', false],
      ['2028-DI-003', true],
    ]);
    assert.equal(view.totalAboveNgn, 160_000_000);
    view = NeedsRankingDtoSchema.parse(await ok(ES, 'post', `${C()}/ranking/placements`, { proposalId: P.p2, placement: null }));
    assert.equal(view.rows.find((r) => r.reference === '2028-DI-002')!.placement, null);
    // A redundant placement (already above): kept now, dropped at finalisation (not an override).
    await ok(ES, 'post', `${C()}/ranking/placements`, { proposalId: P.p1, placement: 'ABOVE', reason: 'Highest need in the State' });
    // kano.admin@ holds needs:chair_committee but the UBEC HQ cycle is not visible to a SUBEB: 404; es@'s colleague dpp@ (no chair permission) 403.
    await refused(KANO_ADMIN, 'post', `${C()}/ranking/placements`, { proposalId: P.p1, placement: null }, 404, 'NEEDS_CYCLE_NOT_FOUND');
    await refused(DPP, 'post', `${C()}/ranking/placements`, { proposalId: P.p1, placement: null }, 403, 'FORBIDDEN_PERMISSION');
  });

  it('review fix: only the committee chair returns a proposal at Prioritisation (403 NEEDS_NOT_COMMITTEE_CHAIR); the return takes it out of the ranking with its sheets, score and placement', async () => {
    P.p6 = await makeProposal(6, { costNgn: 10_000_000, costedBy: QS, validatedBy: ME_OFFICER });
    await score(ES, P.p6, sheet(4, 4));
    await ok(ES, 'post', `${C()}/ranking/placements`, { proposalId: P.p6, placement: 'ABOVE', reason: 'Placed before a return (test)' });
    const returnP6 = { stage: 'PRIORITISATION', items: [{ proposalId: P.p6, outcome: 'RETURN', reason: 'Recheck the costed quantities' }] };
    // admin@ holds needs:chair_committee in the owning organisation but is not the committee's chair.
    await refused('admin@ubec.test', 'post', `${C()}/decisions`, returnP6, 403, 'NEEDS_NOT_COMMITTEE_CHAIR');
    assert.equal(await prisma.needsScoreSheet.count({ where: { proposalId: P.p6 } }), 1);
    await ok(ES, 'post', `${C()}/decisions`, returnP6, 201);
    const p6 = await prisma.needsProposal.findUniqueOrThrow({ where: { id: P.p6 } });
    assert.deepEqual([p6.stage, p6.status, p6.scoreTotal, p6.rank, p6.aboveLine, p6.lineOverrideReason], ['PRIORITISATION', 'RETURNED', null, null, null, null]);
    assert.equal(await prisma.needsScoreSheet.count({ where: { proposalId: P.p6 } }), 0);
    assert.equal((await ranking()).rows.some((r) => r.proposalId === P.p6), false);
  });
});

describe('needs pipeline N5 B4: finalisation, Prioritised Project Portfolio, minutes', () => {
  it('report regeneration is refused before finalisation (409 NEEDS_RANKING_NOT_FINALISED)', async () => {
    await refused(ES, 'post', `${C()}/ranking/report`, undefined, 409, 'NEEDS_RANKING_NOT_FINALISED');
  });

  it('minutes: only the chair files them, as COMMITTEE_MINUTES (422 otherwise); finalise takes only a minutes document (422)', async () => {
    const pdf = Buffer.from('%PDF-1.4\n% Steering Committee minutes 2028 (test)\n%%EOF\n');
    await refused(DPP, 'post', `${C()}/committee/minutes/presign`, { fileName: 'm.pdf', mimeType: 'application/pdf', byteSize: pdf.length }, 403, 'FORBIDDEN_PERMISSION');
    const presign = await ok(ES, 'post', `${C()}/committee/minutes/presign`, { fileName: 'Minutes 2028.pdf', mimeType: 'application/pdf', byteSize: pdf.length });
    const target = new URL(presign.uploadUrl);
    assert.equal((await request(app).put(target.pathname + target.search).set('Content-Type', 'application/pdf').send(pdf)).status, 200);
    await refused(ES, 'post', `${C()}/committee/minutes`, { objectKey: presign.objectKey, kind: 'CIRCULAR', title: 'Not minutes' }, 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');
    const doc = NeedsCycleDocumentDtoSchema.parse(await ok(ES, 'post', `${C()}/committee/minutes`, { objectKey: presign.objectKey, kind: 'COMMITTEE_MINUTES', title: 'Steering Committee minutes 2028' }, 201));
    ids.minutes2028 = doc.id;
    assert.equal(doc.kind, 'COMMITTEE_MINUTES');
    // A cycle document of another kind (written directly) is refused as minutes.
    const other = await prisma.needsCycleDocument.create({
      data: { cycleId: ids.diCycle2028, kind: 'CIRCULAR', title: 'Circular', generated: false, objectKey: `${presign.objectKey}-x`, fileName: 'c.pdf', mimeType: 'application/pdf', byteSize: 1, sha256: sha(Buffer.from('c')), uploadedByUserId: await userId(ES), uploadedByName: 'ES' },
    });
    await refused(ES, 'post', `${C()}/ranking/finalise`, { minutesDocumentId: other.id }, 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');
  });

  it('finalise: ranks and sides stored, proposals move to Approval with their line position, decision row with the minutes, ledger entry, scoring closed', async () => {
    const view = NeedsRankingDtoSchema.parse(await ok(ES, 'post', `${C()}/ranking/finalise`, { minutesDocumentId: ids.minutes2028, note: 'Steering Committee, 3 Sept' }));
    assert.equal(view.finalised, true);
    assert.equal(view.linePosition, 2, 'the line in force: after rank 2 (P3 is above it by placement, not by the line)');
    assert.deepEqual(view.rows.map((r) => [r.reference, r.rank, r.aboveLine, r.placement]), [
      ['2028-DI-001', 1, true, null], // the redundant placement is dropped
      ['2028-DI-002', 2, true, null],
      ['2028-DI-004', 3, false, null],
      ['2028-DI-003', 4, true, 'ABOVE'],
    ]);
    const rows = await prisma.needsProposal.findMany({ where: { cycleId: ids.diCycle2028 }, orderBy: { sequence: 'asc' } });
    assert.deepEqual(rows.map((p) => [p.reference, p.stage, p.status, p.rank, p.aboveLine, p.lineOverrideReason]), [
      ['2028-DI-001', 'APPROVAL', 'IN_PROGRESS', 1, true, null],
      ['2028-DI-002', 'APPROVAL', 'IN_PROGRESS', 2, true, null],
      ['2028-DI-003', 'APPROVAL', 'IN_PROGRESS', 4, true, 'Only school in the LGA with no classrooms'],
      ['2028-DI-004', 'APPROVAL', 'IN_PROGRESS', 3, false, null],
      ['2028-DI-005', 'COSTING', 'IN_PROGRESS', null, null, null],
      ['2028-DI-006', 'PRIORITISATION', 'RETURNED', null, null, null], // returned before finalisation: not moved
    ]);
    assert.deepEqual(rows.slice(0, 4).map((p) => Number(p.scoreTotal)), [76, 76, 60, 60]);
    const cycle = await prisma.needsCycle.findUniqueOrThrow({ where: { id: ids.diCycle2028 } });
    assert.equal(cycle.fundingLinePosition, 2);
    assert.ok(cycle.rankingFinalisedAt && cycle.scoringClosedAt);
    assert.equal(cycle.rankingFinalisedByName, (await user(ES)).fullName);
    const decision = await prisma.needsStageDecision.findFirstOrThrow({ where: { cycleId: ids.diCycle2028, stage: 'PRIORITISATION', items: { some: { outcome: 'ADVANCE' } } }, include: { items: true } });
    assert.deepEqual(decision.evidenceDocumentIds, [ids.minutes2028]);
    assert.equal(decision.reason, 'Steering Committee, 3 Sept');
    assert.equal(decision.items.length, 4);
    assert.ok(decision.items.every((i) => i.outcome === 'ADVANCE' && i.toStage === 'APPROVAL' && i.toStatus === 'IN_PROGRESS'));
    assert.match(decision.items.find((i) => i.proposalId === P.p3)!.reason ?? '', /override: Only school in the LGA/);
    const entry = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'NEEDS_RANKING_FINALISED' }, orderBy: { seq: 'desc' } });
    assert.equal(entry.projectId, null);
    const payload = entry.payload as { cycleId: string; decisionId: string; linePosition: number; aboveCount: number; totalAboveNgn: number };
    assert.deepEqual([payload.cycleId, payload.decisionId, payload.linePosition, payload.aboveCount, payload.totalAboveNgn], [ids.diCycle2028, decision.id, 2, 3, 240_000_000]);
  });

  it('the Prioritised Project Portfolio is generated as xlsx and PDF, registered on the cycle and covering the ranked proposals', async () => {
    const docs = await prisma.needsCycleDocument.findMany({ where: { cycleId: ids.diCycle2028, kind: 'PRIORITISED_PROJECT_PORTFOLIO' } });
    assert.deepEqual(docs.map((d) => d.fileName).sort(), ['2028 DI Prioritised Project Portfolio.pdf', '2028 DI Prioritised Project Portfolio.xlsx']);
    for (const d of docs) {
      assert.equal(d.generated, true);
      assert.deepEqual([...d.coveredProposalIds].sort(), [P.p1, P.p2, P.p3, P.p4].sort());
    }
    const { storageService } = await import('../integrations/storage.service');
    const xlsx = docs.find((d) => d.fileName.endsWith('.xlsx'))!;
    const pdf = docs.find((d) => d.fileName.endsWith('.pdf'))!;
    const pdfBytes = (await storageService.getObjectBuffer(pdf.objectKey))!;
    assert.equal(pdfBytes.subarray(0, 5).toString(), '%PDF-');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await storageService.getObjectBuffer(xlsx.objectKey))! as unknown as ArrayBuffer);
    const ws = wb.worksheets[0];
    const headers = (ws.getRow(3).values as unknown[]).slice(1).map(String);
    for (const h of ['Rank', 'Reference', 'Business case', 'Location (State: LGAs)', 'Impact (0–100)', 'Beneficiaries', 'Costed amount', 'Cumulative amount', 'Funding line', 'Estimated duration (months)', 'Assumptions (strategy)']) {
      assert.ok(headers.includes(h), `${h} in ${headers.join(' | ')}`);
    }
    const col = (h: string) => headers.indexOf(h) + 1;
    const refs = [4, 5, 6, 7].map((r) => ws.getCell(r, col('Reference')).value);
    assert.deepEqual(refs, ['2028-DI-001', '2028-DI-002', '2028-DI-004', '2028-DI-003']);
    assert.match(String(ws.getCell(7, col('Funding line')).value), /^Above the line \(override: Only school/);
    assert.equal(ws.getCell(8, col('Costed amount')).value, 240_000_000, 'totals row: above the line');
    assert.ok(String(ws.getCell(4, col('Business case')).value ?? '').length > 0, 'business case from the current version');
    const ledger = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'NEEDS_DOCUMENT_ADDED' }, orderBy: { seq: 'desc' } });
    assert.equal((ledger.payload as { kind: string; generated: boolean }).kind, 'PRIORITISED_PROJECT_PORTFOLIO');
  });

  it('after finalisation every reader sees all sheets; sheets, declarations, committee, line and placements are refused (409 NEEDS_RANKING_FINALISED); the ranking is the stored one', async () => {
    const asReader = NeedsProposalScoresDtoSchema.parse(await ok(ME_OFFICER, 'get', `/proposals/${P.p2}/scores`));
    assert.equal(asReader.sheetsHidden, false);
    assert.equal(asReader.sheets.length, 2);
    assert.equal(asReader.rank, 2);
    assert.equal(asReader.aboveLine, true);
    await refused(ES, 'put', `${C()}/score-sheets`, { proposalId: P.p1, scores: sheet(1, 1) }, 409, 'NEEDS_RANKING_FINALISED');
    await refused(DPP, 'post', `${C()}/committee/declaration`, { hasConflict: false }, 409, 'NEEDS_RANKING_FINALISED');
    await refused(ES, 'put', `${C()}/committee`, { members: [{ userId: await userId(ES), role: 'CHAIR' }] }, 409, 'NEEDS_RANKING_FINALISED');
    await refused(ES, 'put', `${C()}/ranking/line`, { linePosition: null }, 409, 'NEEDS_RANKING_FINALISED');
    await refused(ES, 'post', `${C()}/ranking/placements`, { proposalId: P.p1, placement: null }, 409, 'NEEDS_RANKING_FINALISED');
    await refused(ES, 'post', `${C()}/ranking/finalise`, {}, 409, 'NEEDS_RANKING_FINALISED');
    await refused(ES, 'post', `${C()}/committee/scoring`, { action: 'OPEN' }, 409, 'NEEDS_RANKING_FINALISED');
    const view = await ranking(ME_OFFICER);
    assert.equal(view.finalised, true);
    assert.equal(view.canFinalise, false);
    assert.equal(view.rows.length, 4);
    const committee = NeedsCommitteeDtoSchema.parse(await ok(ES, 'get', `${C()}/committee`));
    assert.ok(committee.rankingFinalisedAt);
    assert.equal(committee.canManage, true);
  });

  it('review fix: a costing sign-off cannot send a proposal into a finalised ranking (409 NEEDS_RANKING_FINALISED); nor can the chair return one after finalisation', async () => {
    await refused(QS, 'post', `${C()}/decisions`, { stage: 'COSTING', items: [{ proposalId: P.p5, outcome: 'ADVANCE' }] }, 409, 'NEEDS_RANKING_FINALISED');
    assert.equal((await prisma.needsProposal.findUniqueOrThrow({ where: { id: P.p5 } })).stage, 'COSTING');
    await refused(ES, 'post', `${C()}/decisions`, { stage: 'PRIORITISATION', items: [{ proposalId: P.p6, outcome: 'RETURN', reason: 'Too late' }] }, 409, 'NEEDS_RANKING_FINALISED');
  });

  it('a proposal that reaches Prioritisation after finalisation cannot be scored (409 NEEDS_RANKING_FINALISED: known limit)', async () => {
    await prisma.needsProposal.update({ where: { id: P.p5 }, data: { stage: 'PRIORITISATION' } });
    await refused(ES, 'put', `${C()}/score-sheets`, { proposalId: P.p5, scores: sheet(3, 3) }, 409, 'NEEDS_RANKING_FINALISED');
    assert.equal((await ranking()).rows.some((r) => r.proposalId === P.p5), false);
  });

  it('the chair regenerates the report: the new xlsx and PDF supersede the previous ones', async () => {
    const before = await prisma.needsCycleDocument.findMany({ where: { cycleId: ids.diCycle2028, kind: 'PRIORITISED_PROJECT_PORTFOLIO' } });
    await refused(DPP, 'post', `${C()}/ranking/report`, undefined, 403, 'FORBIDDEN_PERMISSION');
    const docs = (await ok(ES, 'post', `${C()}/ranking/report`, undefined, 201)).map((d: unknown) => NeedsCycleDocumentDtoSchema.parse(d));
    assert.equal(docs.length, 2);
    assert.deepEqual(docs.map((d: { supersedesId: string | null }) => d.supersedesId).sort(), before.map((d) => d.id).sort());
    const listed = await ok(ME_OFFICER, 'get', `${C()}/documents`);
    assert.equal(listed.filter((d: { kind: string }) => d.kind === 'PRIORITISED_PROJECT_PORTFOLIO').length, 4);
  });
});
