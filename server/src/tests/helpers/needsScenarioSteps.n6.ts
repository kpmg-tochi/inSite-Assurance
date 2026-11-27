import assert from 'node:assert/strict';
import crypto from 'crypto';
import request from 'supertest';
import { NeedsCycleDocumentDtoSchema, NeedsOutOfCycleDtoSchema, NeedsSubmissionDtoSchema, type NeedsSubmissionDto } from '@insite/shared';
import type { NeedsScenarioContext } from './needsScenarioSteps.n5';

/**
 * Needs pipeline wave 4, Track A: the scenario steps DI-10, MG-06 and OOC-01, proven in
 * `routes.needs.n6.test.ts` and wired by the main thread into `routes.needs.scenarios.test.ts`.
 * API only, plus Prisma reads for the assertions.
 *
 * Starting state:
 * - DI-10: the end of DI-09: `ids.diCycle` (2027, UBEC HQ, OPEN) with 2027-DI-001 and -002 IN_PROGRESS
 *   at APPROVAL, both above the line (DI-002 by the chair's placement), ranking finalised, costed
 *   amounts stored; no portfolio yet.
 * - MG-06: the end of MG-05: `ids.mgCycle` (Kano 2027, Kano SUBEB, OPEN) with 2027-MG-KN-001 at
 *   APPROVAL, ranking finalised.
 * - OOC-01: the DI programme (`ids.di`, code CENTRAL) has a 2027 cycle (`ids.diCycle`, OPEN or
 *   CLOSED); the request is filed in it. Sets `ids.oocProposal` and `ids.oocProject`.
 */

const N = '/api/v1/needs';

async function call(ctx: NeedsScenarioContext, email: string, method: 'get' | 'put' | 'post' | 'patch', path: string, body?: unknown) {
  const req = request(ctx.app)[method](`${N}${path}`).set(await ctx.web(email));
  return body === undefined ? req : req.send(body as object);
}

async function ok(ctx: NeedsScenarioContext, email: string, method: 'get' | 'put' | 'post' | 'patch', path: string, body?: unknown, status = 200) {
  const res = await call(ctx, email, method, path, body);
  assert.equal(res.status, status, `${method.toUpperCase()} ${path} as ${email}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

async function refused(ctx: NeedsScenarioContext, email: string, method: 'get' | 'put' | 'post' | 'patch', path: string, body: unknown, status: number, code: string) {
  const res = await call(ctx, email, method, path, body);
  assert.equal(res.status, status, `${method.toUpperCase()} ${path} as ${email}: ${JSON.stringify(res.body)}`);
  assert.equal(res.body.error.code, code, JSON.stringify(res.body));
}

const proposalId = async (ctx: NeedsScenarioContext, reference: string) => (await ctx.prisma.needsProposal.findFirstOrThrow({ where: { tenantId: ctx.tenantId, reference } })).id;

/** PUT the bytes to the presigned local URL. */
async function put(ctx: NeedsScenarioContext, uploadUrl: string, pdf: Buffer) {
  const target = new URL(uploadUrl);
  const res = await request(ctx.app).put(target.pathname + target.search).set('Content-Type', 'application/pdf').send(pdf);
  assert.equal(res.status, 200, JSON.stringify(res.body));
}

const pdfOf = (title: string) => Buffer.from(`%PDF-1.4\n% ${title} ${crypto.randomUUID()}\n%%EOF\n`);

/** Presign, upload and file the signed approval memo as `email` (a holder of the current step). */
export async function filePortfolioMemo(ctx: NeedsScenarioContext, email: string, cycleId: string, title: string): Promise<string> {
  const pdf = pdfOf(title);
  const presign = await ok(ctx, email, 'post', `/cycles/${cycleId}/portfolio/memo/presign`, { fileName: `${title}.pdf`, mimeType: 'application/pdf', byteSize: pdf.length });
  await put(ctx, presign.uploadUrl, pdf);
  const doc = NeedsCycleDocumentDtoSchema.parse(await ok(ctx, email, 'post', `/cycles/${cycleId}/portfolio/memo`, { objectKey: presign.objectKey, kind: 'APPROVAL_MEMO', title }, 201));
  return doc.id;
}

/** Presign, upload and register a PDF on an out-of-cycle request; returns the document id. */
export async function fileOutOfCycleDocument(ctx: NeedsScenarioContext, email: string, oocProposalId: string, kind: string, title: string): Promise<string> {
  const pdf = pdfOf(title);
  const presign = await ok(ctx, email, 'post', `/out-of-cycle/${oocProposalId}/documents/presign`, { fileName: `${title}.pdf`, mimeType: 'application/pdf', byteSize: pdf.length });
  await put(ctx, presign.uploadUrl, pdf);
  const doc = await ok(ctx, email, 'post', `/out-of-cycle/${oocProposalId}/documents`, { objectKey: presign.objectKey, kind, title }, 201);
  return doc.id as string;
}

async function stageDecisionOf(ctx: NeedsScenarioContext, cycleId: string) {
  return ctx.prisma.needsStageDecision.findFirstOrThrow({ where: { cycleId, stage: 'APPROVAL' }, include: { items: true }, orderBy: { decidedAt: 'desc' } });
}

/**
 * DI-10: procurement@ submits the portfolio; dpp@ management review; es@ approves with one
 * exclusion (2027-DI-002, with a reason) and the signed memo. 2027-DI-001 → Funding with its approved
 * amount; 2027-DI-002 → "Not funded, carried forward".
 */
export async function stepDI10(ctx: NeedsScenarioContext): Promise<void> {
  const cycleId = ctx.ids.diCycle;
  const [PROCUREMENT, DPP, ES] = ['procurement@ubec.test', 'dpp@ubec.test', 'es@ubec.test'];
  const di1 = await proposalId(ctx, '2027-DI-001');
  const di2 = await proposalId(ctx, '2027-DI-002');
  const before = await ctx.prisma.needsProposal.findMany({ where: { id: { in: [di1, di2] } } });
  for (const p of before) assert.deepEqual([p.stage, p.status, p.aboveLine], ['APPROVAL', 'IN_PROGRESS', true], p.reference);
  const cost1 = Number(before.find((p) => p.id === di1)!.costedAmountNgn);
  const cost2 = Number(before.find((p) => p.id === di2)!.costedAmountNgn);

  let dto: NeedsSubmissionDto = NeedsSubmissionDtoSchema.parse(
    await ok(ctx, PROCUREMENT, 'post', `/cycles/${cycleId}/portfolio`, { items: [di1, di2].map((id) => ({ proposalId: id, included: true })), note: 'Prioritised Project Portfolio 2027' }, 201)
  );
  assert.equal(dto.status, 'IN_REVIEW');
  assert.equal(dto.currentStepOrder, 1);
  assert.deepEqual(dto.steps.map((s) => [s.label, s.state]), [
    ['Management review', 'CURRENT'],
    ['Executive Secretary approval', 'PENDING'],
  ]);
  assert.equal(dto.totalNgn, Math.round((cost1 + cost2) * 100) / 100);

  // Management review, then the Executive Secretary (memo required on the last step).
  dto = NeedsSubmissionDtoSchema.parse(await ok(ctx, DPP, 'post', `/cycles/${cycleId}/portfolio/actions`, { decision: 'APPROVE', notes: 'Management review: in order.' }));
  assert.equal(dto.currentStepOrder, 2);
  await refused(ctx, ES, 'post', `/cycles/${cycleId}/portfolio/actions`, { decision: 'APPROVE' }, 422, 'NEEDS_APPROVAL_MEMO_REQUIRED');
  const memoId = await filePortfolioMemo(ctx, ES, cycleId, 'Executive Secretary approval memo 2027');
  const reason = 'Deferred to 2028: the State is building a school on the adjacent plot';
  dto = NeedsSubmissionDtoSchema.parse(
    await ok(ctx, ES, 'post', `/cycles/${cycleId}/portfolio/actions`, { decision: 'APPROVE', notes: 'Approved by the Executive Secretary.', exclusions: [{ proposalId: di2, reason }], memoDocumentId: memoId })
  );
  assert.equal(dto.status, 'APPROVED');
  assert.equal(dto.currentStepOrder, null);
  assert.equal(dto.memoDocumentId, memoId);
  assert.equal(dto.includedCount, 1);
  assert.deepEqual(dto.items.map((i) => [i.reference, i.included, i.exclusionReason]), [
    ['2027-DI-001', true, null],
    ['2027-DI-002', false, reason],
  ]);

  const after = await ctx.prisma.needsProposal.findMany({ where: { id: { in: [di1, di2] } }, orderBy: { reference: 'asc' } });
  assert.deepEqual(after.map((p) => [p.reference, p.stage, p.status]), [
    ['2027-DI-001', 'FUNDING', 'IN_PROGRESS'],
    ['2027-DI-002', 'APPROVAL', 'NOT_SELECTED'],
  ]);
  assert.equal(Number(after[0].approvedAmountNgn), cost1);
  assert.equal(after[1].statusReason, reason);
  assert.equal(after[1].approvedAmountNgn, null);

  const decision = await stageDecisionOf(ctx, cycleId);
  assert.deepEqual(decision.evidenceDocumentIds, [memoId]);
  assert.deepEqual(decision.items.map((i) => [i.proposalId === di1 ? 'DI-001' : 'DI-002', i.outcome, i.toStage, i.toStatus]).sort(), [
    ['DI-001', 'ADVANCE', 'FUNDING', 'IN_PROGRESS'],
    ['DI-002', 'NOT_SELECTED', 'APPROVAL', 'NOT_SELECTED'],
  ]);
  const ledger = await ctx.prisma.auditLog.findMany({ where: { tenantId: ctx.tenantId, action: 'NEEDS_STAGE_DECIDED', payload: { path: ['decisionId'], equals: decision.id } } });
  assert.equal(ledger.length, 2);
  const approvals = await ctx.prisma.auditLog.findMany({ where: { tenantId: ctx.tenantId, action: 'NEEDS_APPROVAL_ACTION', payload: { path: ['submissionId'], equals: dto.id } }, orderBy: { seq: 'asc' } });
  assert.deepEqual(approvals.map((a) => (a.payload as { outcome: string }).outcome), ['ADVANCED', 'APPROVED']);
}

/**
 * MG-06: kano.procurement@ submits the Kano portfolio; UBEC's dpp@ cannot act on the SUBEB's step
 * (403 NOT_STEP_ORGANIZATION); kano.dpp@ reviews (SUBEB management review); kano.admin@ endorses
 * with the memo (Executive Chairman): 2027-MG-KN-001 → BEAP (Funding).
 */
export async function stepMG06(ctx: NeedsScenarioContext): Promise<void> {
  const cycleId = ctx.ids.mgCycle;
  const mg1 = await proposalId(ctx, '2027-MG-KN-001');
  const atApproval = await ctx.prisma.needsProposal.findMany({ where: { cycleId, stage: 'APPROVAL', status: 'IN_PROGRESS', route: 'ANNUAL' } });
  assert.ok(atApproval.some((p) => p.id === mg1));
  let dto = NeedsSubmissionDtoSchema.parse(
    await ok(ctx, 'kano.procurement@ubec.test', 'post', `/cycles/${cycleId}/portfolio`, { items: atApproval.map((p) => ({ proposalId: p.id, included: true })) }, 201)
  );
  assert.deepEqual(dto.steps.map((s) => [s.label, s.organizationScope]), [
    ['SUBEB management review', 'PROJECT_OWNER'],
    ['Executive Chairman endorsement', 'PROJECT_OWNER'],
  ]);
  await refused(ctx, 'dpp@ubec.test', 'post', `/cycles/${cycleId}/portfolio/actions`, { decision: 'APPROVE' }, 403, 'NOT_STEP_ORGANIZATION');
  dto = NeedsSubmissionDtoSchema.parse(await ok(ctx, 'kano.dpp@ubec.test', 'post', `/cycles/${cycleId}/portfolio/actions`, { decision: 'APPROVE', notes: 'SUBEB management review done.' }));
  assert.equal(dto.currentStepOrder, 2);
  const memoId = await filePortfolioMemo(ctx, 'kano.admin@ubec.test', cycleId, 'Executive Chairman endorsement 2027');
  dto = NeedsSubmissionDtoSchema.parse(await ok(ctx, 'kano.admin@ubec.test', 'post', `/cycles/${cycleId}/portfolio/actions`, { decision: 'APPROVE', memoDocumentId: memoId }));
  assert.equal(dto.status, 'APPROVED');
  const p = await ctx.prisma.needsProposal.findUniqueOrThrow({ where: { id: mg1 } });
  assert.deepEqual([p.stage, p.status], ['FUNDING', 'IN_PROGRESS']);
  assert.equal(Number(p.approvedAmountNgn), Number(p.costedAmountNgn));
  const decision = await stageDecisionOf(ctx, cycleId);
  assert.deepEqual(decision.evidenceDocumentIds, [memoId]);
}

/**
 * OOC-01: procurement@ files an emergency out-of-cycle request for the DI programme, 2027 (in the
 * programme's 2027 cycle); it cannot be submitted without the authorising document; with it, es@
 * approves and the request becomes a bare draft project (no needs assessment) with origin
 * OUT_OF_CYCLE and the requested amount as budget.
 */
export async function stepOOC01(ctx: NeedsScenarioContext): Promise<void> {
  const PROCUREMENT = 'procurement@ubec.test';
  const requested = 45_000_000;
  const created = NeedsOutOfCycleDtoSchema.parse(
    await ok(
      ctx,
      PROCUREMENT,
      'post',
      '/out-of-cycle',
      {
        projectTypeId: ctx.ids.di,
        interventionYear: 2027,
        stateCode: 'NI',
        title: 'Emergency classroom reconstruction, Bosso (storm damage)',
        reason: 'EMERGENCY',
        reasonDetails: 'A storm removed the roofs of two classroom blocks in June; pupils are taught outdoors.',
        requestedAmountNgn: requested,
      },
      201
    )
  );
  ctx.ids.oocProposal = created.proposalId;
  assert.equal(created.cycleId, ctx.ids.diCycle, 'filed in the programme 2027 cycle');
  assert.match(created.reference, /^2027-DI-\d{3}$/);
  assert.deepEqual([created.status, created.submission.status, created.requestedAmountNgn], ['DRAFT', 'DRAFT', requested]);

  await refused(ctx, PROCUREMENT, 'post', `/out-of-cycle/${created.proposalId}/submit`, {}, 422, 'NEEDS_AUTHORISING_DOCUMENT_REQUIRED');
  const docId = await fileOutOfCycleDocument(ctx, PROCUREMENT, created.proposalId, 'AUTHORISING_DOCUMENT', 'Executive Secretary emergency directive');
  let dto = NeedsOutOfCycleDtoSchema.parse(await ok(ctx, PROCUREMENT, 'post', `/out-of-cycle/${created.proposalId}/submit`, {}));
  assert.equal(dto.authorisingDocument?.id, docId);
  assert.deepEqual([dto.status, dto.submission.status, dto.submission.steps.map((s) => s.label)], ['IN_PROGRESS', 'IN_REVIEW', ['Executive Secretary approval']]);

  dto = NeedsOutOfCycleDtoSchema.parse(await ok(ctx, 'es@ubec.test', 'post', `/out-of-cycle/${created.proposalId}/actions`, { decision: 'APPROVE', notes: 'Approved as an emergency.' }));
  assert.equal(dto.status, 'CONVERTED');
  assert.ok(dto.projectId);
  ctx.ids.oocProject = dto.projectId!;
  const project = await ctx.prisma.project.findUniqueOrThrow({ where: { id: dto.projectId! }, include: { sites: true, facilityUnits: true } });
  assert.equal(project.status, 'DRAFT');
  assert.equal(project.origin, 'OUT_OF_CYCLE');
  assert.equal(project.needsProposalId, created.proposalId);
  assert.equal(project.codePrefix, created.reference);
  assert.equal(Number(project.totalBudgetNgn), requested);
  assert.equal(project.interventionYear, 2027);
  assert.deepEqual([project.sites.length, project.facilityUnits.length], [0, 0], 'a bare draft: no needs assessment');
  const proposal = await ctx.prisma.needsProposal.findUniqueOrThrow({ where: { id: created.proposalId } });
  assert.deepEqual([proposal.status, Number(proposal.approvedAmountNgn), Number(proposal.fundedAmountNgn)], ['CONVERTED', requested, requested]);
}
