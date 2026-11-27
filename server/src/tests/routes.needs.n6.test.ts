/**
 * Needs pipeline wave 4, Track A (N6): the portfolio and its approval chain (A1), the Matching Grants
 * State approval (A2), out-of-cycle requests (A3), the pipeline list and the project's needs origin,
 * and the task queue additions (parent plan section 17.10).
 *
 * 1. Scenario steps DI-09 → DI-10, MG-05 → MG-06 and OOC-01 on the starting state the wave 3 steps
 *    produce (proposals moved to Prioritisation directly in the database, as `routes.needs.n5`).
 * 2. A1 on a 2028 DI cycle whose proposals are written directly at Approval (ranking finalised).
 * 3. A3 on the 2027 DI cycle, a 2030 DI container cycle and a 2028 Kano container cycle.
 * 4. Pipeline and project integration; the task queue checks run inside the suites, where the state
 *    they need exists.
 */
import { resetTestDatabase } from './helpers/testDb';
import { clearSeededNeedsPipeline } from './helpers/needsSeedReset';
import { before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import type { Express } from 'express';
import request from 'supertest';
import {
  NeedsOutOfCycleDtoSchema,
  NeedsPipelineRowSchema,
  NeedsSubmissionDtoSchema,
  NeedsTaskDtoSchema,
  NeedsUploadFilePreviewSchema,
  ProjectNeedsOriginDtoSchema,
  type NeedsTaskDto,
} from '@insite/shared';
import { needsFixture, needsFixtureBase64, type NeedsFixtureName } from './fixtures/needs/needsFixtures';
import { stepDI09, stepMG05, type NeedsScenarioContext } from './helpers/needsScenarioSteps.n5';
import { fileOutOfCycleDocument, filePortfolioMemo, stepDI10, stepMG06, stepOOC01 } from './helpers/needsScenarioSteps.n6';
import type { WebJwtPayload } from '../middleware/auth.middleware';

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
const ADMIN = 'admin@ubec.test';
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
const proposalByRef = (reference: string) => prisma.needsProposal.findFirstOrThrow({ where: { tenantId, reference } });
const ctx = (): NeedsScenarioContext => ({ app, prisma, web, ids, tenantId });

async function tasksOf(email: string, cycleId?: string): Promise<NeedsTaskDto[]> {
  const data = await ok(email, 'get', `/tasks${cycleId ? `?cycleId=${cycleId}` : ''}`);
  return NeedsTaskDtoSchema.array().parse(data);
}
const taskById = (tasks: NeedsTaskDto[], id: string) => tasks.find((t) => t.id === id) ?? null;

/** Grants a permission to a role for the body of `fn` (auth context cache cleared both ways). */
async function withGrant(roleCode: string, key: string, fn: () => Promise<void>) {
  const role = await prisma.role.findFirstOrThrow({ where: { tenantId, code: roleCode } });
  const permission = await prisma.permission.findUniqueOrThrow({ where: { key } });
  const { clearAuthCache } = await import('../middleware/auth.middleware');
  await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
  clearAuthCache();
  try {
    await fn();
  } finally {
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id, permissionId: permission.id } });
    clearAuthCache();
  }
}

async function webUser(email: string): Promise<WebJwtPayload> {
  const u = await prisma.user.findUniqueOrThrow({ where: { email }, include: { role: { include: { rolePermissions: { include: { permission: true } } } } } });
  return {
    tokenType: 'WEB_USER',
    userId: u.id,
    email: u.email,
    fullName: u.fullName,
    tenantId: u.tenantId!,
    isPlatformSuperAdmin: false,
    roleId: u.roleId,
    roleCode: u.role.code,
    roleName: u.role.name,
    permissions: u.role.rolePermissions.map((rp) => rp.permission.key),
    organizationId: u.organizationId!,
    mustChangePassword: false,
  };
}

/** The wave 3 end state of a proposal at Prioritisation: costed version by `costedBy`, validation record by `validatedBy` (as routes.needs.n5). */
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
}

/** A proposal written directly at Approval IN_PROGRESS (ranking already final). */
async function proposalAtApproval(cycleId: string, seq: number, year: number, opts: { costNgn: number; rank: number; aboveLine: boolean; route?: 'ANNUAL' | 'OUT_OF_CYCLE' }) {
  const uploader = await user(PROCUREMENT);
  return prisma.needsProposal.create({
    data: {
      tenantId,
      cycleId,
      reference: `${year}-DI-${String(seq).padStart(3, '0')}`,
      sequence: seq,
      title: `Proposed project ${seq} (${year})`,
      route: opts.route ?? 'ANNUAL',
      ...(opts.route === 'OUT_OF_CYCLE' ? { outOfCycleReason: 'EMERGENCY', outOfCycleDetails: 'Written directly for the test.' } : {}),
      stage: 'APPROVAL',
      status: 'IN_PROGRESS',
      stateCode: 'NI',
      lgaCodes: [],
      costedAmountNgn: opts.costNgn,
      preliminaryAmountNgn: opts.costNgn,
      rank: opts.route === 'OUT_OF_CYCLE' ? null : opts.rank,
      aboveLine: opts.route === 'OUT_OF_CYCLE' ? null : opts.aboveLine,
      createdByUserId: uploader.id,
      createdByName: uploader.fullName,
    },
  });
}

before(async () => {
  await resetTestDatabase();
  ({ prisma } = await import('../config/prisma'));
  await clearSeededNeedsPipeline(prisma);
  const { createApp } = await import('../app');
  app = createApp();
  tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: 'programme-authority' } })).id;
  ids.di = (await prisma.projectType.findFirstOrThrow({ where: { tenantId, code: 'CENTRAL' } })).id;
  ids.mg = (await prisma.projectType.findFirstOrThrow({ where: { tenantId, code: 'CO_FUNDED' } })).id;
  ids.ubecHq = (await prisma.organization.findFirstOrThrow({ where: { tenantId, name: { startsWith: 'Universal Basic Education Commission' } } })).id;
  ids.kanoSubeb = (await prisma.organization.findFirstOrThrow({ where: { tenantId, name: { startsWith: 'Kano State Universal Basic Education Board' } } })).id;

  // Starting state of DI-09 (the wave 3 DI-01 … DI-08 end state).
  ids.diCycle = (await ok(DPP, 'post', '/cycles', { projectTypeId: ids.di, interventionYear: 2027 }, 201)).id;
  await uploadAs(PROCUREMENT, ids.diCycle, ['di-draft-valid', 'essential-gap']);
  await moveToPrioritisation('2027-DI-001', 120_000_000, QS, ME_OFFICER);
  await moveToPrioritisation('2027-DI-002', 90_000_000, QS, ME_OFFICER);

  // Starting state of MG-05 (the wave 3 MG-01 … MG-04 end state).
  ids.mgCycle = (await ok(KANO_DPP, 'post', '/cycles', { projectTypeId: ids.mg, interventionYear: 2027, stateCode: 'KN' }, 201)).id;
  await uploadAs(KANO_PROCUREMENT, ids.mgCycle, ['mg-complete-valid']);
  await moveToPrioritisation('2027-MG-KN-001', 75_000_000, KANO_DPP, KANO_DPP);
});

// ---------------------------------------------------------------------------
// 1. Scenario steps
// ---------------------------------------------------------------------------

describe('needs pipeline N6: scenario steps', () => {
  it('a portfolio cannot be submitted before the ranking is finalised (409 NEEDS_RANKING_NOT_FINALISED)', async () => {
    const p1 = await proposalByRef('2027-DI-001');
    await refused(PROCUREMENT, 'post', `/cycles/${ids.diCycle}/portfolio`, { items: [{ proposalId: p1.id, included: true }] }, 409, 'NEEDS_RANKING_NOT_FINALISED');
  });

  it('DI-09 (wave 3 step, the starting state of DI-10)', async () => {
    await stepDI09(ctx());
  });

  it('DI-10 procurement@ submits the portfolio; dpp@ management review; es@ approves with one exclusion and the memo', async () => {
    await stepDI10(ctx());
  });

  it('MG-05 (wave 3 step, the starting state of MG-06)', async () => {
    await stepMG05(ctx());
  });

  it('MG-06 SUBEB management review and kano.admin@ endorsement', async () => {
    await stepMG06(ctx());
  });

  it('OOC-01 out-of-cycle request (emergency, authorising document) approved by es@; converts with origin OUT_OF_CYCLE', async () => {
    await stepOOC01(ctx());
  });
});

// ---------------------------------------------------------------------------
// 2. A1: portfolio on a 2028 DI cycle (proposals written directly)
// ---------------------------------------------------------------------------

describe('needs pipeline N6 A1: the portfolio and its approval chain (2028 DI cycle)', () => {
  const P: Record<string, string> = {};
  let submissionId = '';

  it('setup: the 2028 cycle with three ranked proposals at Approval (the third below the line) and an out-of-cycle request; procurement@ is asked to submit the portfolio', async () => {
    ids.di2028 = (await ok(DPP, 'post', '/cycles', { projectTypeId: ids.di, interventionYear: 2028 }, 201)).id;
    P.a = (await proposalAtApproval(ids.di2028, 1, 2028, { costNgn: 100_000_000, rank: 1, aboveLine: true })).id;
    P.b = (await proposalAtApproval(ids.di2028, 2, 2028, { costNgn: 50_000_000, rank: 2, aboveLine: true })).id;
    P.c = (await proposalAtApproval(ids.di2028, 3, 2028, { costNgn: 30_000_000, rank: 3, aboveLine: false })).id;
    await prisma.needsCycle.update({ where: { id: ids.di2028 }, data: { proposalSequence: 3 } });
    // An out-of-cycle request in the same cycle, submitted (IN_PROGRESS at Approval): not part of the portfolio.
    const ooc = await ok(
      PROCUREMENT,
      'post',
      '/out-of-cycle',
      { projectTypeId: ids.di, interventionYear: 2028, stateCode: 'NI', title: 'Emergency repairs (2028)', reason: 'EMERGENCY', reasonDetails: 'Storm damage to two classroom blocks.', requestedAmountNgn: 20_000_000 },
      201
    );
    assert.equal(ooc.reference, '2028-DI-004');
    P.ooc = ooc.proposalId;
    await prisma.needsProposal.update({ where: { id: P.ooc }, data: { status: 'IN_PROGRESS' } });

    // Not before the ranking is final: no task, no INCLUDE_IN_PORTFOLIO.
    assert.equal(taskById(await tasksOf(PROCUREMENT, ids.di2028), `CYCLE:${ids.di2028}:PORTFOLIO`), null);
    let detail = await ok(PROCUREMENT, 'get', `/proposals/${P.a}`);
    assert.ok(!detail.allowedActions.includes('INCLUDE_IN_PORTFOLIO'));

    await prisma.needsCycle.update({ where: { id: ids.di2028 }, data: { rankingFinalisedAt: new Date(), rankingFinalisedByName: 'Test' } });
    const task = taskById(await tasksOf(PROCUREMENT, ids.di2028), `CYCLE:${ids.di2028}:PORTFOLIO`);
    assert.ok(task, 'procurement@ is asked to submit the portfolio');
    assert.deepEqual([task.kind, task.actionLabel, task.stage, task.url], ['CYCLE', 'Submit the portfolio for approval', 'APPROVAL', `/app/needs-assessment?cycle=${ids.di2028}&tab=approvals`]);
    detail = await ok(PROCUREMENT, 'get', `/proposals/${P.a}`);
    assert.deepEqual(detail.allowedActions, ['INCLUDE_IN_PORTFOLIO']);
    assert.deepEqual((await ok(DPP, 'get', `/proposals/${P.a}`)).allowedActions, [], 'dpp@ holds no needs:submit_portfolio');
  });

  it('only a needs:submit_portfolio holder of the owning organisation submits (403 FORBIDDEN_PERMISSION; another State 404)', async () => {
    const items = [P.a, P.b].map((id) => ({ proposalId: id, included: true }));
    const forbidden = await api(ES, 'post', `/cycles/${ids.di2028}/portfolio`, { items });
    assert.equal(forbidden.status, 403, JSON.stringify(forbidden.body));
    await refused(KANO_PROCUREMENT, 'post', `/cycles/${ids.di2028}/portfolio`, { items }, 404, 'NEEDS_CYCLE_NOT_FOUND');
  });

  it('the items must be exactly the annual proposals at Approval (422 NEEDS_PORTFOLIO_ITEMS_MISMATCH with the missing and extra references)', async () => {
    let err = await refused(PROCUREMENT, 'post', `/cycles/${ids.di2028}/portfolio`, { items: [P.a, P.b].map((id) => ({ proposalId: id, included: true })) }, 422, 'NEEDS_PORTFOLIO_ITEMS_MISMATCH');
    assert.deepEqual(err.details, { missing: ['2028-DI-003'], extra: [] });
    err = await refused(
      PROCUREMENT,
      'post',
      `/cycles/${ids.di2028}/portfolio`,
      { items: [P.a, P.b, P.ooc, P.a].map((id) => ({ proposalId: id, included: true })) },
      422,
      'NEEDS_PORTFOLIO_ITEMS_MISMATCH'
    );
    assert.deepEqual(err.details, { missing: ['2028-DI-003'], extra: ['2028-DI-004', '2028-DI-001'] }, 'the out-of-cycle request is not part of the portfolio; a repeated item is extra');
  });

  it('ANNUAL only: a submitted out-of-cycle request at Approval (IN_PROGRESS) is neither required in the portfolio nor accepted in it, included or excluded', async () => {
    const ooc = await prisma.needsProposal.findUniqueOrThrow({ where: { id: P.ooc } });
    assert.deepEqual([ooc.route, ooc.stage, ooc.status], ['OUT_OF_CYCLE', 'APPROVAL', 'IN_PROGRESS']);
    const annual = [
      { proposalId: P.a, included: true },
      { proposalId: P.b, included: true },
      { proposalId: P.c, included: false, exclusionReason: 'Below the funding line' },
    ];
    for (const extra of [
      { proposalId: P.ooc, included: true },
      { proposalId: P.ooc, included: false, exclusionReason: 'Runs on its own chain' },
    ]) {
      const err = await refused(PROCUREMENT, 'post', `/cycles/${ids.di2028}/portfolio`, { items: [...annual, extra] }, 422, 'NEEDS_PORTFOLIO_ITEMS_MISMATCH');
      assert.deepEqual(err.details, { missing: [], extra: ['2028-DI-004'] });
    }
    assert.equal(await prisma.needsSubmission.count({ where: { cycleId: ids.di2028, kind: 'PORTFOLIO' } }), 0, 'nothing written');
    // The request's own queue entry is not a portfolio task (and it carries no INCLUDE_IN_PORTFOLIO).
    assert.deepEqual((await ok(PROCUREMENT, 'get', `/proposals/${P.ooc}`)).allowedActions, []);
  });

  it('below the line cannot be included (422 NEEDS_BELOW_LINE_INCLUDED); at least one must be (422 NEEDS_PORTFOLIO_EMPTY); exclusions need a reason (400)', async () => {
    const err = await refused(PROCUREMENT, 'post', `/cycles/${ids.di2028}/portfolio`, { items: [P.a, P.b, P.c].map((id) => ({ proposalId: id, included: true })) }, 422, 'NEEDS_BELOW_LINE_INCLUDED');
    assert.deepEqual(err.details, { references: ['2028-DI-003'] });
    await refused(
      PROCUREMENT,
      'post',
      `/cycles/${ids.di2028}/portfolio`,
      { items: [P.a, P.b, P.c].map((id) => ({ proposalId: id, included: false, exclusionReason: 'Not this year, test' })) },
      422,
      'NEEDS_PORTFOLIO_EMPTY'
    );
    const noReason = await api(PROCUREMENT, 'post', `/cycles/${ids.di2028}/portfolio`, { items: [{ proposalId: P.a, included: false }] });
    assert.equal(noReason.status, 400, JSON.stringify(noReason.body));
  });

  it('submit: IN_REVIEW at the management review with the costed amounts; a second submission is 409 NEEDS_PORTFOLIO_EXISTS; the queue moves to dpp@', async () => {
    const dto = NeedsSubmissionDtoSchema.parse(
      await ok(
        PROCUREMENT,
        'post',
        `/cycles/${ids.di2028}/portfolio`,
        { items: [{ proposalId: P.a, included: true }, { proposalId: P.b, included: true }, { proposalId: P.c, included: false, exclusionReason: 'Below the funding line' }], note: null },
        201
      )
    );
    submissionId = dto.id;
    assert.deepEqual([dto.kind, dto.chainType, dto.status, dto.currentStepOrder, dto.includedCount, dto.totalNgn], ['PORTFOLIO', 'NEEDS_PORTFOLIO', 'IN_REVIEW', 1, 2, 150_000_000]);
    assert.deepEqual(dto.items.map((i) => [i.reference, i.included, i.amountNgn, i.exclusionReason]), [
      ['2028-DI-001', true, 100_000_000, null],
      ['2028-DI-002', true, 50_000_000, null],
      ['2028-DI-003', false, 30_000_000, 'Below the funding line'],
    ]);
    const created = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'NEEDS_SUBMISSION_CREATED', payload: { path: ['submissionId'], equals: submissionId } } });
    assert.deepEqual([...(created.payload as { proposalIds: string[] }).proposalIds].sort(), [P.a, P.b, P.c].sort());
    await refused(PROCUREMENT, 'post', `/cycles/${ids.di2028}/portfolio`, { items: [P.a, P.b].map((id) => ({ proposalId: id, included: true })) }, 409, 'NEEDS_PORTFOLIO_EXISTS');

    assert.equal(taskById(await tasksOf(PROCUREMENT, ids.di2028), `CYCLE:${ids.di2028}:PORTFOLIO`), null, 'no submit task while the portfolio is in review');
    assert.ok(!(await ok(PROCUREMENT, 'get', `/proposals/${P.a}`)).allowedActions.includes('INCLUDE_IN_PORTFOLIO'));
    const review = taskById(await tasksOf(DPP), `APPROVAL_STEP:${submissionId}`);
    assert.ok(review);
    assert.deepEqual([review.kind, review.actionLabel, review.submissionId, review.stage], ['APPROVAL_STEP', 'Review the portfolio', submissionId, 'APPROVAL']);
    assert.equal(taskById(await tasksOf(ES), `APPROVAL_STEP:${submissionId}`), null, 'es@ acts on the second step only');
    const count = await ok(DPP, 'get', '/tasks/count');
    assert.equal(count.count, (await tasksOf(DPP)).length);
  });

  it('separation of duties: the submitter cannot act on a step, even holding its permission (409 SAME_PERSON_APPROVAL); the wrong permission is 403 NOT_STEP_APPROVER; the memo needs a step holder', async () => {
    await refused(ES, 'post', `/cycles/${ids.di2028}/portfolio/actions`, { decision: 'APPROVE' }, 403, 'NOT_STEP_APPROVER');
    await refused(PROCUREMENT, 'post', `/cycles/${ids.di2028}/portfolio/memo/presign`, { fileName: 'memo.pdf', mimeType: 'application/pdf', byteSize: 100 }, 403, 'NOT_STEP_APPROVER');
    await withGrant('PROCUREMENT_OFFICER', 'needs:review_portfolio', async () => {
      await refused(PROCUREMENT, 'post', `/cycles/${ids.di2028}/portfolio/actions`, { decision: 'APPROVE', notes: 'My own list' }, 409, 'SAME_PERSON_APPROVAL');
      const dto = NeedsSubmissionDtoSchema.parse(await ok(PROCUREMENT, 'get', `/submissions/${submissionId}`));
      assert.equal(dto.canAct, false);
      assert.match(dto.cannotActReason ?? '', /submitted/i);
    });
    assert.equal(await prisma.needsApprovalAction.count({ where: { subjectId: submissionId } }), 0);
  });

  it('a return needs notes (400); returned, procurement@ revises and resubmits (a new pass: the earlier approval no longer counts)', async () => {
    const bad = await api(DPP, 'post', `/cycles/${ids.di2028}/portfolio/actions`, { decision: 'RETURN' });
    assert.equal(bad.status, 400, JSON.stringify(bad.body));
    let dto = NeedsSubmissionDtoSchema.parse(await ok(DPP, 'post', `/cycles/${ids.di2028}/portfolio/actions`, { decision: 'RETURN', notes: 'Attach the committee minutes reference to the note.' }));
    assert.deepEqual([dto.status, dto.currentStepOrder], ['RETURNED', 0]);
    for (const id of [P.a, P.b, P.c]) {
      const p = await prisma.needsProposal.findUniqueOrThrow({ where: { id } });
      assert.deepEqual([p.stage, p.status], ['APPROVAL', 'IN_PROGRESS'], 'a return leaves the proposals waiting');
    }
    const revise = taskById(await tasksOf(PROCUREMENT, ids.di2028), `CYCLE:${ids.di2028}:PORTFOLIO`);
    assert.deepEqual([revise?.actionLabel, revise?.submissionId], ['Revise and resubmit the portfolio', submissionId]);

    dto = NeedsSubmissionDtoSchema.parse(
      await ok(
        PROCUREMENT,
        'post',
        `/cycles/${ids.di2028}/portfolio`,
        { items: [{ proposalId: P.a, included: true }, { proposalId: P.b, included: true }, { proposalId: P.c, included: false, exclusionReason: 'Below the funding line (minutes 2028/4)' }], note: 'Minutes reference added' },
        201
      )
    );
    assert.equal(dto.id, submissionId, 'the same submission is resubmitted');
    assert.deepEqual([dto.status, dto.currentStepOrder], ['IN_REVIEW', 1]);
    const resubmitted = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'NEEDS_SUBMISSION_UPDATED', payload: { path: ['submissionId'], equals: submissionId } } });
    assert.equal((resubmitted.payload as { resubmitted: boolean }).resubmitted, true);
    dto = NeedsSubmissionDtoSchema.parse(await ok(DPP, 'post', `/cycles/${ids.di2028}/portfolio/actions`, { decision: 'APPROVE', notes: 'Reviewed.' }));
    assert.equal(dto.currentStepOrder, 2);
    assert.deepEqual(dto.steps.map((s) => s.state), ['DONE', 'CURRENT']);
    assert.ok(taskById(await tasksOf(ES), `APPROVAL_STEP:${submissionId}`)?.actionLabel === 'Approve the portfolio');
    assert.equal(taskById(await tasksOf(DPP), `APPROVAL_STEP:${submissionId}`), null);
  });

  it('the last step: exclusions only of included items (422 NEEDS_EXCLUSION_INVALID), one must stay (422 NEEDS_PORTFOLIO_EMPTY), the memo is required and must be an approval memo of this cycle', async () => {
    const memoBase = { decision: 'APPROVE' };
    await refused(ES, 'post', `/cycles/${ids.di2028}/portfolio/actions`, { ...memoBase, exclusions: [{ proposalId: P.c, reason: 'Already out' }] }, 422, 'NEEDS_EXCLUSION_INVALID');
    await refused(
      ES,
      'post',
      `/cycles/${ids.di2028}/portfolio/actions`,
      { ...memoBase, exclusions: [P.a, P.b].map((proposalId) => ({ proposalId, reason: 'Not this year' })) },
      422,
      'NEEDS_PORTFOLIO_EMPTY'
    );
    await refused(ES, 'post', `/cycles/${ids.di2028}/portfolio/actions`, memoBase, 422, 'NEEDS_APPROVAL_MEMO_REQUIRED');
    await refused(ES, 'post', `/cycles/${ids.di2028}/portfolio/actions`, { ...memoBase, memoDocumentId: crypto.randomUUID() }, 422, 'NEEDS_APPROVAL_MEMO_REQUIRED');
    // A cycle document of another kind (dpp@ files a circular through the wave 2 route).
    const pdf = Buffer.from(`%PDF-1.4\n% circular ${crypto.randomUUID()}\n%%EOF\n`);
    const presign = await ok(DPP, 'post', `/cycles/${ids.di2028}/documents/presign`, { fileName: 'circular.pdf', mimeType: 'application/pdf', byteSize: pdf.length });
    const target = new URL(presign.uploadUrl);
    assert.equal((await request(app).put(target.pathname + target.search).set('Content-Type', 'application/pdf').send(pdf)).status, 200);
    const other = await ok(DPP, 'post', `/cycles/${ids.di2028}/documents`, { objectKey: presign.objectKey, kind: 'OTHER', title: 'Not a memo' }, 201);
    await refused(ES, 'post', `/cycles/${ids.di2028}/portfolio/actions`, { ...memoBase, memoDocumentId: other.id }, 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');
    // The memo route files approval memos only.
    await refused(ES, 'post', `/cycles/${ids.di2028}/portfolio/memo`, { objectKey: presign.objectKey, kind: 'OTHER', title: 'x memo' }, 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');
    assert.equal(await prisma.needsApprovalAction.count({ where: { subjectId: submissionId, stepOrder: 2 } }), 0, 'nothing recorded by the refusals');
  });

  it('approved: included → Funding with the approved amount; excluded at submission and at approval → "Not funded, carried forward"; the out-of-cycle request untouched; one stage decision; finance@ is asked to record the funding', async () => {
    const memoId = await filePortfolioMemo(ctx(), ES, ids.di2028, 'ES approval memo 2028');
    const memo = await prisma.needsCycleDocument.findUniqueOrThrow({ where: { id: memoId } });
    assert.deepEqual([...memo.coveredProposalIds].sort(), [P.a, P.b, P.c].sort(), 'the memo covers the portfolio');
    const reason = 'Funds limited: deferred to the next cycle';
    const dto = NeedsSubmissionDtoSchema.parse(
      await ok(ES, 'post', `/cycles/${ids.di2028}/portfolio/actions`, { decision: 'APPROVE', notes: 'Approved.', exclusions: [{ proposalId: P.b, reason }], memoDocumentId: memoId })
    );
    assert.deepEqual([dto.status, dto.memoDocumentId, dto.includedCount, dto.totalNgn], ['APPROVED', memoId, 1, 100_000_000]);
    const rows = await prisma.needsProposal.findMany({ where: { cycleId: ids.di2028 }, orderBy: { sequence: 'asc' } });
    assert.deepEqual(
      rows.map((p) => [p.reference, p.stage, p.status, p.approvedAmountNgn === null ? null : Number(p.approvedAmountNgn), p.statusReason]),
      [
        ['2028-DI-001', 'FUNDING', 'IN_PROGRESS', 100_000_000, null],
        ['2028-DI-002', 'APPROVAL', 'NOT_SELECTED', null, reason],
        ['2028-DI-003', 'APPROVAL', 'NOT_SELECTED', null, 'Below the funding line (minutes 2028/4)'],
        ['2028-DI-004', 'APPROVAL', 'IN_PROGRESS', null, null],
      ]
    );
    const decision = await prisma.needsStageDecision.findFirstOrThrow({ where: { cycleId: ids.di2028, stage: 'APPROVAL' }, include: { items: true } });
    assert.deepEqual(decision.evidenceDocumentIds, [memoId]);
    assert.equal(decision.decidedByName, (await user(ES)).fullName);
    assert.deepEqual(decision.items.map((i) => [i.proposalId, i.outcome]).sort(), [[P.a, 'ADVANCE'], [P.b, 'NOT_SELECTED'], [P.c, 'NOT_SELECTED']].sort());
    assert.equal(await prisma.auditLog.count({ where: { tenantId, action: 'NEEDS_STAGE_DECIDED', payload: { path: ['decisionId'], equals: decision.id } } }), 3);
    // The proposal history reads the submission-level entries (`proposalIds`).
    const history = (await ok(DPP, 'get', `/proposals/${P.b}`)).history as Array<{ action: string; summary: string }>;
    assert.ok(history.some((h) => h.action === 'NEEDS_APPROVAL_ACTION' && /excluded 2028-DI-002/.test(h.summary)), JSON.stringify(history.slice(0, 5)));
    assert.equal((await ok(DPP, 'get', `/proposals/${P.b}`)).statusLabel, 'Not funded, carried forward');

    await refused(ES, 'post', `/cycles/${ids.di2028}/portfolio/actions`, { decision: 'APPROVE' }, 409, 'NEEDS_SUBMISSION_NOT_IN_REVIEW');
    await refused(PROCUREMENT, 'post', `/cycles/${ids.di2028}/portfolio`, { items: [{ proposalId: P.ooc, included: true }] }, 409, 'NEEDS_PORTFOLIO_EXISTS');
    const funding = taskById(await tasksOf(FINANCE, ids.di2028), `CYCLE:${ids.di2028}:FUNDING`);
    assert.deepEqual([funding?.actionLabel, funding?.url], ['Record the funding', `/app/needs-assessment?cycle=${ids.di2028}&tab=funding`]);
    assert.deepEqual((await ok(FINANCE, 'get', `/proposals/${P.a}`)).allowedActions, ['RECORD_FUNDING']);
    assert.equal(taskById(await tasksOf(ES), `APPROVAL_STEP:${submissionId}`), null);
  });

  it('actions need the cycle still open (409 NEEDS_CYCLE_NOT_OPEN)', async () => {
    ids.di2029 = (await ok(DPP, 'post', '/cycles', { projectTypeId: ids.di, interventionYear: 2029 }, 201)).id;
    const a = await prisma.needsProposal.create({
      data: { tenantId, cycleId: ids.di2029, reference: '2029-DI-001', sequence: 1, title: 'P 2029', stage: 'APPROVAL', status: 'IN_PROGRESS', costedAmountNgn: 10_000_000, aboveLine: true, rank: 1, createdByUserId: (await user(PROCUREMENT)).id, createdByName: 'x' },
    });
    await prisma.needsCycle.update({ where: { id: ids.di2029 }, data: { rankingFinalisedAt: new Date(), proposalSequence: 1 } });
    await ok(PROCUREMENT, 'post', `/cycles/${ids.di2029}/portfolio`, { items: [{ proposalId: a.id, included: true }] }, 201);
    await prisma.needsCycle.update({ where: { id: ids.di2029 }, data: { status: 'CLOSED' } });
    await refused(DPP, 'post', `/cycles/${ids.di2029}/portfolio/actions`, { decision: 'APPROVE' }, 409, 'NEEDS_CYCLE_NOT_OPEN');
    await refused(PROCUREMENT, 'post', `/cycles/${ids.di2029}/portfolio`, { items: [{ proposalId: a.id, included: true }] }, 409, 'NEEDS_CYCLE_NOT_OPEN');
  });
});

// ---------------------------------------------------------------------------
// A2: Matching Grants State approval (after MG-06)
// ---------------------------------------------------------------------------

describe('needs pipeline N6 A2: Matching Grants State approval', () => {
  it('the Kano portfolio ran on the SUBEB steps (PROJECT_OWNER = the SUBEB); Lagos cannot see it; kano.dpp@ is asked to prepare the BEAP', async () => {
    const list = NeedsSubmissionDtoSchema.array().parse(await ok(KANO_ADMIN, 'get', `/cycles/${ids.mgCycle}/submissions?kind=PORTFOLIO`));
    assert.equal(list.length, 1);
    const s = list[0];
    assert.equal(s.status, 'APPROVED');
    assert.deepEqual(s.actions.map((a) => [a.stepLabel, a.decision]), [
      ['SUBEB management review', 'APPROVE'],
      ['Executive Chairman endorsement', 'APPROVE'],
    ]);
    assert.deepEqual(s.steps.map((x) => [x.requiredPermissionKey, x.state]), [
      ['needs:review_portfolio', 'DONE'],
      ['needs:approve_portfolio', 'DONE'],
    ]);
    await refused(LAGOS_ADMIN, 'post', `/cycles/${ids.mgCycle}/portfolio/actions`, { decision: 'APPROVE' }, 404, 'NEEDS_CYCLE_NOT_FOUND');
    await refused(LAGOS_ADMIN, 'get', `/submissions/${s.id}`, undefined, 404, 'NEEDS_SUBMISSION_NOT_FOUND');
    const beap = taskById(await tasksOf(KANO_DPP, ids.mgCycle), `CYCLE:${ids.mgCycle}:BEAP`);
    assert.deepEqual([beap?.actionLabel, beap?.stage, beap?.url], ['Prepare the BEAP', 'FUNDING', `/app/needs-assessment?cycle=${ids.mgCycle}&tab=funding`]);
    const mg1 = await proposalByRef('2027-MG-KN-001');
    assert.deepEqual((await ok(KANO_DPP, 'get', `/proposals/${mg1.id}`)).allowedActions, ['INCLUDE_IN_BEAP']);
    assert.equal(taskById(await tasksOf(FINANCE), `CYCLE:${ids.mgCycle}:FUNDING`), null, 'no appropriation for Matching Grants');
  });
});

// ---------------------------------------------------------------------------
// 3. A3: out-of-cycle requests
// ---------------------------------------------------------------------------

describe('needs pipeline N6 A3: out-of-cycle requests', () => {
  const request2027 = {
    projectTypeId: '',
    interventionYear: 2027,
    stateCode: 'NI',
    title: 'Replacement of a collapsed classroom block, Chanchaga',
    reason: 'PRESIDENTIAL_DIRECTIVE',
    reasonDetails: 'Presidential directive after the collapse of a classroom block in May.',
    requestedAmountNgn: 61_000_000,
  };

  it('a year without a cycle gets a CLOSED container cycle (owner UBEC HQ, chain steps copied); a second request reuses it; who may file', async () => {
    const body = { ...request2027, projectTypeId: ids.di, interventionYear: 2030, title: 'Emergency toilets, Suleja' };
    const forbidden = await api(ES, 'post', '/out-of-cycle', body);
    assert.equal(forbidden.status, 403, 'es@ holds no needs:submit');
    await refused(KANO_PROCUREMENT, 'post', '/out-of-cycle', body, 403, 'NEEDS_CYCLE_FORBIDDEN');
    const first = NeedsOutOfCycleDtoSchema.parse(await ok(PROCUREMENT, 'post', '/out-of-cycle', body, 201));
    const cycle = await prisma.needsCycle.findUniqueOrThrow({ where: { id: first.cycleId } });
    assert.deepEqual([cycle.status, cycle.interventionYear, cycle.scopeKey, cycle.owningOrganizationId], ['CLOSED', 2030, 'NATIONAL', ids.ubecHq]);
    assert.equal(first.cycleStatus, 'CLOSED');
    assert.equal(first.reference, '2030-DI-001');
    assert.deepEqual([first.stateCode, first.reasonLabel], ['NI', 'Presidential directive']);
    assert.ok(await prisma.needsApprovalStep.count({ where: { cycleId: cycle.id, chainType: 'OUT_OF_CYCLE' } }));
    const opened = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'NEEDS_CYCLE_OPENED', payload: { path: ['cycleId'], equals: cycle.id } } });
    assert.equal((opened.payload as { container: boolean }).container, true);
    const second = NeedsOutOfCycleDtoSchema.parse(await ok(PROCUREMENT, 'post', '/out-of-cycle', { ...body, title: 'Emergency borehole, Suleja' }, 201));
    assert.equal(second.cycleId, first.cycleId);
    assert.equal(second.reference, '2030-DI-002');
    ids.ooc2030a = first.proposalId;
    ids.ooc2030b = second.proposalId;
    // The requester's queue (container cycles too).
    const task = taskById(await tasksOf(PROCUREMENT), `PROPOSAL_ACTION:${first.proposalId}`);
    assert.deepEqual([task?.actionLabel, task?.url], ['Submit the out-of-cycle request', `/app/needs-assessment?cycle=${first.cycleId}&tab=approvals`]);
  });

  it('edit while DRAFT (the submission amount follows); withdraw needs a reason; a withdrawn request is closed', async () => {
    let dto = NeedsOutOfCycleDtoSchema.parse(await ok(PROCUREMENT, 'patch', `/out-of-cycle/${ids.ooc2030a}`, { requestedAmountNgn: 12_500_000, title: 'Emergency toilets, Suleja (two blocks)' }));
    assert.deepEqual([dto.requestedAmountNgn, dto.title, dto.submission.items[0].amountNgn, dto.canEdit], [12_500_000, 'Emergency toilets, Suleja (two blocks)', 12_500_000, true]);
    await refused(KANO_PROCUREMENT, 'patch', `/out-of-cycle/${ids.ooc2030a}`, { title: 'Hijack' }, 404, 'NEEDS_PROPOSAL_NOT_FOUND');
    const short = await api(PROCUREMENT, 'post', `/out-of-cycle/${ids.ooc2030b}/withdraw`, { reason: 'no' });
    assert.equal(short.status, 400);
    dto = NeedsOutOfCycleDtoSchema.parse(await ok(PROCUREMENT, 'post', `/out-of-cycle/${ids.ooc2030b}/withdraw`, { reason: 'Covered by the State budget' }));
    assert.deepEqual([dto.status, dto.statusLabel, dto.canEdit], ['WITHDRAWN', 'Withdrawn', false]);
    await refused(PROCUREMENT, 'patch', `/out-of-cycle/${ids.ooc2030b}`, { title: 'Again' }, 409, 'NEEDS_OUT_OF_CYCLE_NOT_EDITABLE');
    await refused(PROCUREMENT, 'post', `/out-of-cycle/${ids.ooc2030b}/submit`, {}, 409, 'NEEDS_OUT_OF_CYCLE_NOT_EDITABLE');
    assert.equal(taskById(await tasksOf(PROCUREMENT), `PROPOSAL_ACTION:${ids.ooc2030b}`), null);
  });

  it('in an open cycle the request is moved by its own routes only (the batch SUBMIT is 409; no allowed actions); before submission nobody can act on it', async () => {
    const dto = NeedsOutOfCycleDtoSchema.parse(await ok(PROCUREMENT, 'post', '/out-of-cycle', { ...request2027, projectTypeId: ids.di }, 201));
    ids.oocFile = dto.proposalId;
    assert.equal(dto.cycleId, ids.diCycle);
    await refused(PROCUREMENT, 'post', `/cycles/${ids.diCycle}/proposal-actions`, { action: 'SUBMIT', proposalIds: [dto.proposalId] }, 409, 'NEEDS_STAGE_ACTION_NOT_ALLOWED');
    assert.deepEqual((await ok(PROCUREMENT, 'get', `/proposals/${dto.proposalId}`)).allowedActions, []);
    await refused(ES, 'post', `/out-of-cycle/${dto.proposalId}/actions`, { decision: 'APPROVE' }, 409, 'NEEDS_SUBMISSION_NOT_IN_REVIEW');
    // Only one task for the request (no generic proposal task beside the out-of-cycle one).
    const mine = (await tasksOf(PROCUREMENT, ids.diCycle)).filter((t) => t.proposalId === dto.proposalId);
    assert.deepEqual(mine.map((t) => t.actionLabel), ['Submit the out-of-cycle request']);
  });

  it('returned, the request is corrected with a needs assessment (template v2 only; same sha256 as the preview), resubmitted and approved: the project has the sites, units and BoQ lines, budget = requested', async () => {
    const id = ids.oocFile;
    await fileOutOfCycleDocument(ctx(), PROCUREMENT, id, 'AUTHORISING_DOCUMENT', 'Presidential directive letter');
    await ok(PROCUREMENT, 'post', `/out-of-cycle/${id}/submit`, {});
    await refused(PROCUREMENT, 'patch', `/out-of-cycle/${id}`, { title: 'Too late' }, 409, 'NEEDS_OUT_OF_CYCLE_NOT_EDITABLE');
    const approve = taskById(await tasksOf(ES), `APPROVAL_STEP:${(await ok(ES, 'get', `/out-of-cycle/${id}`)).submission.id}`);
    assert.deepEqual([approve?.actionLabel, approve?.proposalId, approve?.reference], ['Approve the out-of-cycle request', id, (await prisma.needsProposal.findUniqueOrThrow({ where: { id } })).reference]);
    let dto = NeedsOutOfCycleDtoSchema.parse(await ok(ES, 'post', `/out-of-cycle/${id}/actions`, { decision: 'RETURN', notes: 'Attach the needs assessment for the block.' }));
    assert.deepEqual([dto.status, dto.submission.status], ['RETURNED', 'RETURNED']);
    assert.equal(taskById(await tasksOf(PROCUREMENT), `PROPOSAL_ACTION:${id}`)?.actionLabel, 'Correct and resubmit the out-of-cycle request');

    const legacy = NeedsUploadFilePreviewSchema.parse(await ok(PROCUREMENT, 'post', `/out-of-cycle/${id}/needs-assessment/preview`, { fileName: 'old.xlsx', fileBase64: needsFixtureBase64('v1-scope-workbook') }));
    assert.equal(legacy.status, 'INVALID');
    const file = { fileName: 'Chanchaga block.xlsx', fileBase64: needsFixtureBase64('di-design-valid') };
    const preview = NeedsUploadFilePreviewSchema.parse(await ok(PROCUREMENT, 'post', `/out-of-cycle/${id}/needs-assessment/preview`, file));
    assert.equal(preview.status, 'VALID', JSON.stringify(preview.issues));
    await refused(PROCUREMENT, 'post', `/out-of-cycle/${id}/needs-assessment/confirm`, { ...file, sha256: '0'.repeat(64) }, 409, 'NEEDS_FILE_CHANGED');
    dto = NeedsOutOfCycleDtoSchema.parse(await ok(PROCUREMENT, 'post', `/out-of-cycle/${id}/needs-assessment/confirm`, { ...file, sha256: preview.sha256 }, 201));
    assert.deepEqual([dto.currentVersion?.number, dto.currentVersion?.source, dto.status], [1, 'CORRECTION', 'RETURNED']);
    assert.deepEqual([dto.title, dto.requestedAmountNgn], [request2027.title, request2027.requestedAmountNgn], 'the request keeps its title and amount');

    dto = NeedsOutOfCycleDtoSchema.parse(await ok(PROCUREMENT, 'post', `/out-of-cycle/${id}/submit`, {}));
    assert.deepEqual([dto.status, dto.submission.status], ['IN_PROGRESS', 'IN_REVIEW']);
    dto = NeedsOutOfCycleDtoSchema.parse(await ok(ES, 'post', `/out-of-cycle/${id}/actions`, { decision: 'APPROVE' }));
    assert.equal(dto.status, 'CONVERTED');
    ids.oocFileProject = dto.projectId!;
    const project = await prisma.project.findUniqueOrThrow({ where: { id: dto.projectId! }, include: { sites: true, facilityUnits: true, boqItems: true } });
    const parsed = (await prisma.needsAssessmentVersion.findFirstOrThrow({ where: { proposalId: id } })).parsedJson as { sites: unknown[]; breakdownRows: Array<{ proposedQuantity: number }>; boqLines: unknown[] };
    assert.equal(project.origin, 'OUT_OF_CYCLE');
    assert.equal(Number(project.totalBudgetNgn), request2027.requestedAmountNgn);
    assert.equal(project.sites.length, parsed.sites.length);
    assert.equal(project.facilityUnits.length, parsed.breakdownRows.filter((r) => r.proposedQuantity > 0).length);
    assert.equal(project.boqItems.length, parsed.boqLines.length);
    assert.ok(project.sites.length > 0 && project.boqItems.length > 0);
    const converted = await prisma.auditLog.findFirstOrThrow({ where: { tenantId, action: 'NEEDS_PROPOSAL_CONVERTED', payload: { path: ['proposalId'], equals: id } } });
    assert.equal((converted.payload as { origin: string }).origin, 'OUT_OF_CYCLE');
  });

  it('Matching Grants: the Executive Chairman, then UBEC: a Kano SUBEB user is refused the UBEC step (403 NOT_STEP_ORGANIZATION), the Chairman twice is 409 SAME_PERSON_APPROVAL; es@ (outside the SUBEB) is asked and approves; the draft is owned by Kano SUBEB', async () => {
    const dto0 = NeedsOutOfCycleDtoSchema.parse(
      await ok(
        KANO_PROCUREMENT,
        'post',
        '/out-of-cycle',
        { projectTypeId: ids.mg, interventionYear: 2028, stateCode: 'KN', title: 'Flood-damaged classrooms, Bebeji', reason: 'SUPPLEMENTARY_BUDGET', reasonDetails: 'State supplementary budget after the September floods.', requestedAmountNgn: 38_000_000 },
        201
      )
    );
    assert.equal(dto0.reference, '2028-MG-KN-001');
    assert.equal(dto0.cycleStatus, 'CLOSED');
    const id = dto0.proposalId;
    await fileOutOfCycleDocument(ctx(), KANO_PROCUREMENT, id, 'AUTHORISING_DOCUMENT', 'State supplementary appropriation');
    let dto = NeedsOutOfCycleDtoSchema.parse(await ok(KANO_PROCUREMENT, 'post', `/out-of-cycle/${id}/submit`, {}));
    assert.deepEqual(dto.submission.steps.map((s) => [s.label, s.organizationScope]), [
      ['Executive Chairman approval', 'PROJECT_OWNER'],
      ['UBEC approval', 'ANY'],
    ]);
    await refused(ES, 'post', `/out-of-cycle/${id}/actions`, { decision: 'APPROVE' }, 403, 'NOT_STEP_ORGANIZATION');
    dto = NeedsOutOfCycleDtoSchema.parse(await ok(KANO_ADMIN, 'post', `/out-of-cycle/${id}/actions`, { decision: 'APPROVE', notes: 'Endorsed.' }));
    assert.equal(dto.submission.currentStepOrder, 2);
    await refused(KANO_ADMIN, 'post', `/out-of-cycle/${id}/actions`, { decision: 'APPROVE' }, 409, 'SAME_PERSON_APPROVAL');
    await withGrant('SUBEB_DIRECTOR_PHYSICAL_PLANNING', 'needs:approve_out_of_cycle', async () => {
      await refused(KANO_DPP, 'post', `/out-of-cycle/${id}/actions`, { decision: 'APPROVE' }, 403, 'NOT_STEP_ORGANIZATION');
    });
    const task = taskById(await tasksOf(ES), `APPROVAL_STEP:${dto.submission.id}`);
    assert.deepEqual([task?.actionLabel, task?.cycleId], ['Approve the out-of-cycle request', dto.cycleId], 'the UBEC step reaches es@ outside the owning organisation');
    assert.equal(taskById(await tasksOf(KANO_ADMIN), `APPROVAL_STEP:${dto.submission.id}`), null);

    dto = NeedsOutOfCycleDtoSchema.parse(await ok(ES, 'post', `/out-of-cycle/${id}/actions`, { decision: 'APPROVE', notes: 'UBEC approves.' }));
    assert.equal(dto.status, 'CONVERTED');
    ids.mgOocProject = dto.projectId!;
    const project = await prisma.project.findUniqueOrThrow({ where: { id: dto.projectId! }, include: { sites: true } });
    assert.deepEqual([project.origin, project.owningOrganizationId, project.stateCode, Number(project.totalBudgetNgn), project.sites.length], ['OUT_OF_CYCLE', ids.kanoSubeb, 'KN', 38_000_000, 0]);
    const actions = await prisma.needsApprovalAction.findMany({ where: { subjectId: dto.submission.id }, include: { actor: true }, orderBy: { createdAt: 'asc' } });
    assert.deepEqual(actions.map((a) => [a.stepOrder, a.actor.email]), [
      [1, KANO_ADMIN],
      [2, ES],
    ]);
  });

  it('the list shows the visible requests (Lagos sees none of Kano or UBEC); a document upload needs the requester organisation', async () => {
    const all = NeedsOutOfCycleDtoSchema.array().parse(await ok(DPP, 'get', '/out-of-cycle'));
    const refs = all.map((r) => r.reference);
    for (const ref of ['2030-DI-001', '2030-DI-002', '2028-MG-KN-001']) assert.ok(refs.includes(ref), ref);
    const filtered = NeedsOutOfCycleDtoSchema.array().parse(await ok(DPP, 'get', `/out-of-cycle?cycleId=${ids.diCycle}`));
    assert.ok(filtered.every((r) => r.cycleId === ids.diCycle) && filtered.length >= 2);
    assert.deepEqual(NeedsOutOfCycleDtoSchema.array().parse(await ok(LAGOS_ADMIN, 'get', '/out-of-cycle')), []);
    assert.deepEqual(
      NeedsOutOfCycleDtoSchema.array()
        .parse(await ok(KANO_ADMIN, 'get', '/out-of-cycle'))
        .map((r) => r.reference),
      ['2028-MG-KN-001']
    );
    await refused(DPP, 'post', `/out-of-cycle/${ids.ooc2030a}/documents/presign`, { fileName: 'x.pdf', mimeType: 'application/pdf', byteSize: 10 }, 403, 'FORBIDDEN_PERMISSION');
  });

  it('requests in a CLOSED cycle stay readable through the wave 2 proposal file routes (documents and versions)', async () => {
    // The Kano 2028 container cycle is CLOSED.
    const mg = NeedsOutOfCycleDtoSchema.array()
      .parse(await ok(KANO_PROCUREMENT, 'get', '/out-of-cycle'))
      .find((r) => r.reference === '2028-MG-KN-001')!;
    assert.equal(mg.cycleStatus, 'CLOSED');
    const doc = await ok(KANO_PROCUREMENT, 'get', `/proposals/${mg.proposalId}/documents/${mg.authorisingDocument!.id}/file?format=json`);
    assert.ok(doc.url);
    assert.equal((await ok(ES, 'get', `/proposals/${mg.proposalId}`)).reference, '2028-MG-KN-001');
    // The 2027 DI request with a needs assessment, its cycle closed for the check.
    const di = NeedsOutOfCycleDtoSchema.parse(await ok(PROCUREMENT, 'get', `/out-of-cycle/${ids.oocFile}`));
    await prisma.needsCycle.update({ where: { id: ids.diCycle }, data: { status: 'CLOSED' } });
    try {
      assert.ok((await ok(PROCUREMENT, 'get', `/proposals/${ids.oocFile}/versions/1/file?format=json`)).url);
      assert.ok((await ok(PROCUREMENT, 'get', `/proposals/${ids.oocFile}/documents/${di.authorisingDocument!.id}/file?format=json`)).url);
    } finally {
      await prisma.needsCycle.update({ where: { id: ids.diCycle }, data: { status: 'OPEN' } });
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Pipeline and project integration
// ---------------------------------------------------------------------------

describe('needs pipeline N6: pipeline and project integration', () => {
  it('GET /pipeline: proposals at Approval or Funding and converted drafts, by visibility and filters', async () => {
    const rows = NeedsPipelineRowSchema.array().parse(await ok(DPP, 'get', '/pipeline?interventionYear=2027'));
    const byRef = new Map(rows.map((r) => [r.reference, r]));
    assert.deepEqual([byRef.get('2027-DI-001')?.stage, byRef.get('2027-DI-001')?.status, byRef.get('2027-DI-001')?.amountNgn], ['FUNDING', 'IN_PROGRESS', 120_000_000]);
    assert.equal(byRef.get('2027-DI-002'), undefined, 'not selected');
    assert.equal(byRef.get('2027-MG-KN-001')?.statusLabel, 'Pending BEAP');
    const ooc = rows.find((r) => r.projectId === ids.oocProject)!;
    assert.deepEqual([ooc.route, ooc.status, ooc.projectStatus, ooc.amountNgn], ['OUT_OF_CYCLE', 'CONVERTED', 'DRAFT', 45_000_000]);
    assert.ok(rows.every((r) => r.interventionYear === 2027));
    const kano = NeedsPipelineRowSchema.array().parse(await ok(DPP, 'get', '/pipeline?stateCode=KN'));
    assert.ok(kano.length >= 2 && kano.every((r) => r.stateCode === 'KN'));
    const lagos = NeedsPipelineRowSchema.array().parse(await ok(LAGOS_ADMIN, 'get', '/pipeline'));
    assert.deepEqual(lagos, []);
    const forbidden = await request(app).get(`${N}/pipeline`).set(await web('lagos.me@ubec.test'));
    assert.equal(forbidden.status, 403);
  });

  it('GET /projects/:id/needs-origin: a converted proposal shows its origin, amounts, documents (proposal, versions, the cycle documents that cover it) and breakdown; files only of its own proposal and cycle', async () => {
    const di1 = await proposalByRef('2027-DI-001');
    const result = await prisma.$transaction(async (tx) => {
      const { convertProposalToProject } = await import('../modules/needs/conversion/convertProposal');
      return convertProposalToProject(tx, { id: di1.id }, { fundedAmountNgn: 118_000_000, by: await webUser(FINANCE) });
    });
    const res = await request(app).get(`/api/v1/projects/${result.projectId}/needs-origin`).set(await web(ADMIN));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const dto = ProjectNeedsOriginDtoSchema.parse(res.body.data);
    assert.deepEqual([dto.origin, dto.originLabel], ['NEEDS_PIPELINE', 'Annual needs assessment']);
    assert.ok(dto.proposal);
    assert.deepEqual(
      [dto.proposal.reference, dto.proposal.status, dto.proposal.approvedAmountNgn, dto.proposal.fundedAmountNgn, dto.proposal.costedAmountNgn, dto.proposal.rank, dto.proposal.versionCount, dto.proposal.canOpenProposal],
      ['2027-DI-001', 'CONVERTED', 120_000_000, 118_000_000, 120_000_000, 1, 2, true]
    );
    const scopes = dto.documents.map((d) => `${d.scope}:${d.kind}`);
    assert.equal(scopes.filter((s) => s.startsWith('VERSION:')).length, 2);
    assert.ok(scopes.includes('CYCLE:APPROVAL_MEMO'), JSON.stringify(scopes));
    assert.ok(scopes.includes('CYCLE:PRIORITISED_PROJECT_PORTFOLIO'), JSON.stringify(scopes));
    assert.ok(dto.breakdown.length > 0);
    const parsed = (await prisma.needsAssessmentVersion.findUniqueOrThrow({ where: { id: di1.currentVersionId! } })).parsedJson as { breakdownRows: Array<{ unitId: string }> };
    assert.deepEqual(dto.breakdown.map((r) => r.unitId), parsed.breakdownRows.map((r) => r.unitId));

    const memo = dto.documents.find((d) => d.kind === 'APPROVAL_MEMO')!;
    const link = await request(app).get(`/api/v1/projects/${result.projectId}/needs-origin/files/CYCLE/${memo.id}?format=json`).set(await web(ADMIN));
    assert.equal(link.status, 200, JSON.stringify(link.body));
    assert.ok(link.body.data.url);
    const version = dto.documents.find((d) => d.scope === 'VERSION')!;
    assert.equal((await request(app).get(`/api/v1/projects/${result.projectId}/needs-origin/files/VERSION/${version.id}?format=json`).set(await web(ADMIN))).status, 200);
    // Another cycle's document, a wrong scope, an unknown id: 404.
    const otherMemo = await prisma.needsCycleDocument.findFirstOrThrow({ where: { cycleId: ids.di2028, kind: 'APPROVAL_MEMO' } });
    for (const path of [`CYCLE/${otherMemo.id}`, `PROPOSAL/${memo.id}`, `VERSION/${crypto.randomUUID()}`, `OTHER/${memo.id}`]) {
      const r = await request(app).get(`/api/v1/projects/${result.projectId}/needs-origin/files/${path}?format=json`).set(await web(ADMIN));
      assert.equal(r.status, 404, `${path}: ${JSON.stringify(r.body)}`);
    }
    // The pipeline now lists it as a converted draft; procurement@ is asked to assign lots.
    const row = NeedsPipelineRowSchema.array()
      .parse(await ok(DPP, 'get', '/pipeline?interventionYear=2027'))
      .find((r) => r.reference === '2027-DI-001')!;
    assert.deepEqual([row.status, row.projectId, row.amountNgn], ['CONVERTED', result.projectId, 118_000_000]);
    const lots = taskById(await tasksOf(PROCUREMENT, ids.diCycle), `CYCLE:${ids.diCycle}:LOTS`);
    assert.deepEqual([lots?.actionLabel, lots?.url], ['Assign lots to the funded projects (3)', `/app/needs-assessment?cycle=${ids.diCycle}&tab=procurement`]);
    assert.equal(taskById(await tasksOf(KANO_PROCUREMENT), `CYCLE:${ids.mgCycle}:LOTS`), null, 'Matching Grants lots come from the BEAP');
  });

  it('an out-of-cycle project shows the authorising document; the Matching Grants one names its request; Lagos cannot read it; a legacy project has no proposal', async () => {
    const res = await request(app).get(`/api/v1/projects/${ids.oocProject}/needs-origin`).set(await web(ADMIN));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const dto = ProjectNeedsOriginDtoSchema.parse(res.body.data);
    assert.deepEqual([dto.originLabel, dto.proposal?.route, dto.proposal?.outOfCycleReasonLabel, dto.proposal?.versionCount], ['Outside annual cycle', 'OUT_OF_CYCLE', 'Emergency', 0]);
    assert.deepEqual(dto.documents.map((d) => [d.scope, d.kind]), [['PROPOSAL', 'AUTHORISING_DOCUMENT']]);
    assert.deepEqual(dto.breakdown, []);

    // Read as the System Administrator: a converted draft is visible to its creator (here es@, the
    // approver) and to projects:create / edit_baseline holders only, which the tailored SUBEB
    // Administrator is not (existing draft rule; finding for the main thread).
    const kano = await request(app).get(`/api/v1/projects/${ids.mgOocProject}/needs-origin`).set(await web(ADMIN));
    assert.equal(kano.status, 200, JSON.stringify(kano.body));
    assert.equal(ProjectNeedsOriginDtoSchema.parse(kano.body.data).proposal?.reference, '2028-MG-KN-001');
    const lagos = await request(app).get(`/api/v1/projects/${ids.mgOocProject}/needs-origin`).set(await web(LAGOS_ADMIN));
    assert.ok([403, 404].includes(lagos.status), JSON.stringify(lagos.body));

    const legacy = await prisma.project.findFirstOrThrow({ where: { tenantId, needsProposalId: null, status: 'ACTIVE' } });
    const l = await request(app).get(`/api/v1/projects/${legacy.id}/needs-origin`).set(await web(ADMIN));
    assert.equal(l.status, 200, JSON.stringify(l.body));
    const ldto = ProjectNeedsOriginDtoSchema.parse(l.body.data);
    assert.deepEqual([ldto.proposal, ldto.documents, ldto.originLabel], [null, [], legacy.origin ? 'Before the needs pipeline' : 'No origin']);
  });
});
