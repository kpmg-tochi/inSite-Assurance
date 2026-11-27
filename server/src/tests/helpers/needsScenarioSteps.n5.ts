import assert from 'node:assert/strict';
import type { Express } from 'express';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import {
  NeedsCommitteeDtoSchema,
  NeedsCycleDocumentDtoSchema,
  NeedsMyScoringDtoSchema,
  NeedsProposalScoresDtoSchema,
  NeedsRankingDtoSchema,
  ScoreSheetDtoSchema,
  type NeedsCommitteeDto,
  type NeedsRankingDto,
} from '@insite/shared';

/**
 * Needs pipeline wave 3, Track B: the scenario steps DI-09 and MG-05 (prioritisation), proven in
 * `routes.needs.n5.test.ts` and wired by the main thread into `routes.needs.scenarios.test.ts`.
 * They use the API only, plus Prisma reads for the assertions.
 *
 * Starting state (Track A's steps produce it):
 * - DI: `ids.diCycle` (2027, UBEC HQ, no indicative ceiling) with 2027-DI-001 and 2027-DI-002 IN_PROGRESS
 *   at PRIORITISATION, costed (`costedAmountNgn` > 0, current version COSTING by qs@), validated by
 *   me.officer@, earlier versions uploaded by procurement@; no other DI proposal at PRIORITISATION.
 * - MG: `ids.mgCycle` (Kano 2027, Kano SUBEB) with 2027-MG-KN-001 IN_PROGRESS at PRIORITISATION,
 *   uploaded by kano.procurement@, validated and costed by kano.dpp@.
 * - No committee in either cycle.
 */

export interface NeedsScenarioContext {
  app: Express;
  prisma: PrismaClient;
  web: (email: string) => Promise<{ Authorization: string }>;
  ids: Record<string, string>;
  tenantId: string;
}

const N = '/api/v1/needs';
const MINUTES_PDF = Buffer.from('%PDF-1.4\n% Steering Committee minutes (test)\n1 0 obj << >> endobj\ntrailer << >>\n%%EOF\n');

async function rubricOf(ctx: NeedsScenarioContext, cycleId: string) {
  const cycle = await ctx.prisma.needsCycle.findUniqueOrThrow({ where: { id: cycleId } });
  const rubric = (cycle.configSnapshotJson as { rubric: { criteria: Array<{ key: string; dimension: 'IMPACT' | 'EASE' }>; quorum: number } }).rubric;
  return rubric;
}

/** Every criterion `value`, except the ones named in `except`. */
const sheetOf = (keys: string[], value: number, except: Record<string, number> = {}) => Object.fromEntries(keys.map((k) => [k, except[k] ?? value]));

async function proposalId(ctx: NeedsScenarioContext, reference: string) {
  return (await ctx.prisma.needsProposal.findFirstOrThrow({ where: { tenantId: ctx.tenantId, reference } })).id;
}

async function call(ctx: NeedsScenarioContext, email: string, method: 'get' | 'put' | 'post', path: string, body?: unknown) {
  const req = request(ctx.app)[method](`${N}${path}`).set(await ctx.web(email));
  return body === undefined ? req : req.send(body as object);
}

async function ok(ctx: NeedsScenarioContext, email: string, method: 'get' | 'put' | 'post', path: string, body?: unknown, status = 200) {
  const res = await call(ctx, email, method, path, body);
  assert.equal(res.status, status, `${method.toUpperCase()} ${path} as ${email}: ${JSON.stringify(res.body)}`);
  return res.body.data;
}

async function declareNone(ctx: NeedsScenarioContext, cycleId: string, emails: string[]) {
  for (const email of emails) await ok(ctx, email, 'post', `/cycles/${cycleId}/committee/declaration`, { hasConflict: false });
}

async function userId(ctx: NeedsScenarioContext, email: string) {
  return (await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).id;
}

/** Presign, upload and file the committee minutes as the chair; returns the document id. */
async function fileMinutes(ctx: NeedsScenarioContext, chair: string, cycleId: string, title: string): Promise<string> {
  const presign = await ok(ctx, chair, 'post', `/cycles/${cycleId}/committee/minutes/presign`, { fileName: `${title}.pdf`, mimeType: 'application/pdf', byteSize: MINUTES_PDF.length });
  const target = new URL(presign.uploadUrl);
  const put = await request(ctx.app).put(target.pathname + target.search).set('Content-Type', 'application/pdf').send(MINUTES_PDF);
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const doc = NeedsCycleDocumentDtoSchema.parse(await ok(ctx, chair, 'post', `/cycles/${cycleId}/committee/minutes`, { objectKey: presign.objectKey, kind: 'COMMITTEE_MINUTES', title }, 201));
  return doc.id;
}

async function assertPortfolioGenerated(ctx: NeedsScenarioContext, cycleId: string, proposalIds: string[]) {
  const docs = await ctx.prisma.needsCycleDocument.findMany({ where: { cycleId, kind: 'PRIORITISED_PROJECT_PORTFOLIO', generated: true } });
  assert.deepEqual(docs.map((d) => d.fileName.split('.').pop()).sort(), ['pdf', 'xlsx'], 'one xlsx and one PDF');
  for (const d of docs) {
    assert.deepEqual([...d.coveredProposalIds].sort(), [...proposalIds].sort());
    assert.ok(d.byteSize > 0 && d.sha256.length === 64);
  }
}

/**
 * DI-09: committee (es@ chair, dpp@, finance@, procurement@): declarations, procurement@ recused from
 * its uploads, scores, one divergence flagged, ranking, line, override with reason, finalised;
 * Prioritised Project Portfolio generated.
 */
export async function stepDI09(ctx: NeedsScenarioContext): Promise<void> {
  const cycleId = ctx.ids.diCycle;
  const ES = 'es@ubec.test';
  const members = ['dpp@ubec.test', 'finance@ubec.test', 'procurement@ubec.test'];
  const di1 = await proposalId(ctx, '2027-DI-001');
  const di2 = await proposalId(ctx, '2027-DI-002');
  const rubric = await rubricOf(ctx, cycleId);
  const keys = rubric.criteria.map((c) => c.key);

  // The chair forms the committee.
  const set: NeedsCommitteeDto = NeedsCommitteeDtoSchema.parse(
    await ok(ctx, ES, 'put', `/cycles/${cycleId}/committee`, {
      members: [{ userId: await userId(ctx, ES), role: 'CHAIR' }, ...(await Promise.all(members.map(async (e) => ({ userId: await userId(ctx, e), role: 'MEMBER' }))))],
    })
  );
  assert.equal(set.members.length, 4);
  assert.equal(set.canManage, true);

  // Scoring cannot open before every member has declared.
  const early = await call(ctx, ES, 'post', `/cycles/${cycleId}/committee/scoring`, { action: 'OPEN' });
  assert.equal(early.status, 409, JSON.stringify(early.body));
  assert.equal(early.body.error.code, 'NEEDS_CONFLICT_NOT_DECLARED');
  await declareNone(ctx, cycleId, [ES, ...members]);

  // procurement@ is recused from the proposals it uploaded.
  const committee = NeedsCommitteeDtoSchema.parse(await ok(ctx, ES, 'post', `/cycles/${cycleId}/committee/scoring`, { action: 'OPEN' }));
  assert.ok(committee.scoringOpenedAt);
  const procurementId = await userId(ctx, 'procurement@ubec.test');
  const procMember = committee.members.find((m) => m.userId === procurementId)!;
  assert.deepEqual(
    procMember.recusals.map((r) => `${r.proposalId === di1 ? 'DI-001' : r.proposalId === di2 ? 'DI-002' : r.proposalId} ${r.reason}`).sort(),
    ['DI-001 UPLOADED', 'DI-002 UPLOADED']
  );
  assert.equal(procMember.toScoreCount, 0);
  const refused = await call(ctx, 'procurement@ubec.test', 'put', `/cycles/${cycleId}/score-sheets`, { proposalId: di1, scores: sheetOf(keys, 5) });
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.error.code, 'NEEDS_MEMBER_RECUSED');

  // Independent scores; dpp@ and es@ disagree by 2 points on one criterion of DI-002.
  const divergentKey = keys[0];
  const scores: Array<[string, string, Record<string, number>]> = [
    [ES, di1, sheetOf(keys, 5)],
    ['dpp@ubec.test', di1, sheetOf(keys, 4)],
    ['finance@ubec.test', di1, sheetOf(keys, 5)],
    [ES, di2, sheetOf(keys, 3)],
    ['dpp@ubec.test', di2, sheetOf(keys, 3, { [divergentKey]: 1 })],
    ['finance@ubec.test', di2, sheetOf(keys, 3)],
  ];
  for (const [email, proposal, values] of scores) {
    ScoreSheetDtoSchema.parse(await ok(ctx, email, 'put', `/cycles/${cycleId}/score-sheets`, { proposalId: proposal, scores: values, comment: null }));
  }
  const mine = NeedsMyScoringDtoSchema.parse(await ok(ctx, 'finance@ubec.test', 'get', `/cycles/${cycleId}/score-sheets/mine`));
  assert.equal(mine.items.filter((i) => i.sheet).length, 2);
  const asMember = NeedsProposalScoresDtoSchema.parse(await ok(ctx, 'finance@ubec.test', 'get', `/proposals/${di2}/scores`));
  assert.equal(asMember.sheetsHidden, true);
  assert.equal(asMember.score, null, 'no combined score for a member before finalisation');
  assert.equal(asMember.sheets.length, 1, 'a member sees only their own sheet before finalisation');
  const asChair = NeedsProposalScoresDtoSchema.parse(await ok(ctx, ES, 'get', `/proposals/${di2}/scores`));
  assert.equal(asChair.sheets.length, 3);
  assert.deepEqual(asChair.divergent.map((d) => [d.criterionKey, d.min, d.max]), [[divergentKey, 1, 3]]);

  // Ranking and the line the ceiling draws (ceiling = DI-001's cost: DI-002 falls below it).
  const cost1 = Number((await ctx.prisma.needsProposal.findUniqueOrThrow({ where: { id: di1 } })).costedAmountNgn);
  const cost2 = Number((await ctx.prisma.needsProposal.findUniqueOrThrow({ where: { id: di2 } })).costedAmountNgn);
  assert.ok(cost1 > 0 && cost2 > 0);
  const patch = await request(ctx.app).patch(`${N}/cycles/${cycleId}`).set(await ctx.web('dpp@ubec.test')).send({ indicativeCeilingNgn: cost1 });
  assert.equal(patch.status, 200, JSON.stringify(patch.body));
  let ranking: NeedsRankingDto = NeedsRankingDtoSchema.parse(await ok(ctx, ES, 'get', `/cycles/${cycleId}/ranking`));
  assert.deepEqual(ranking.rows.map((r) => [r.reference, r.rank, r.aboveLine]), [
    ['2027-DI-001', 1, true],
    ['2027-DI-002', 2, false],
  ]);
  assert.equal(ranking.computedLinePosition, 1);
  assert.equal(ranking.rows[1].divergent.length, 1);
  assert.equal(ranking.canFinalise, true, ranking.cannotFinaliseReason ?? '');

  // The chair overrides with a reason: DI-002 goes above the line.
  const reason = 'Committee: the second school has no functional toilets; fund it this year';
  ranking = NeedsRankingDtoSchema.parse(await ok(ctx, ES, 'post', `/cycles/${cycleId}/ranking/placements`, { proposalId: di2, placement: 'ABOVE', reason }));
  assert.deepEqual(ranking.rows.map((r) => [r.reference, r.computedAboveLine, r.aboveLine, r.placement]), [
    ['2027-DI-001', true, true, null],
    ['2027-DI-002', false, true, 'ABOVE'],
  ]);
  assert.equal(ranking.totalAboveNgn, Math.round((cost1 + cost2) * 100) / 100);

  // Finalised with the minutes.
  const minutesId = await fileMinutes(ctx, ES, cycleId, 'Steering Committee minutes 2027');
  ranking = NeedsRankingDtoSchema.parse(await ok(ctx, ES, 'post', `/cycles/${cycleId}/ranking/finalise`, { minutesDocumentId: minutesId, note: 'Steering Committee meeting' }));
  assert.equal(ranking.finalised, true);
  // The line in force stays at the ceiling (after rank 1); 2027-DI-002 is above it by the chair's placement.
  assert.equal(ranking.linePosition, 1);
  assert.equal(ranking.rows.filter((r) => r.aboveLine).length, 2);
  const stored = await ctx.prisma.needsProposal.findMany({ where: { id: { in: [di1, di2] } }, orderBy: { rank: 'asc' } });
  assert.deepEqual(stored.map((p) => [p.reference, p.rank, p.aboveLine, p.stage, p.status]), [
    ['2027-DI-001', 1, true, 'APPROVAL', 'IN_PROGRESS'],
    ['2027-DI-002', 2, true, 'APPROVAL', 'IN_PROGRESS'],
  ]);
  assert.equal(stored[1].lineOverrideReason, reason);
  assert.ok(Number(stored[0].scoreTotal) > Number(stored[1].scoreTotal));
  const decision = await ctx.prisma.needsStageDecision.findFirstOrThrow({ where: { cycleId, stage: 'PRIORITISATION' }, include: { items: true } });
  assert.deepEqual(decision.evidenceDocumentIds, [minutesId]);
  assert.deepEqual(decision.items.map((i) => [i.outcome, i.toStage]).sort(), [
    ['ADVANCE', 'APPROVAL'],
    ['ADVANCE', 'APPROVAL'],
  ]);
  assert.equal(await ctx.prisma.auditLog.count({ where: { tenantId: ctx.tenantId, action: 'NEEDS_RANKING_FINALISED' } }) >= 1, true);
  await assertPortfolioGenerated(ctx, cycleId, [di1, di2]);
}

/**
 * MG-05: SUBEB committee (kano.admin@ chair, three members with the umbrella role
 * SUBEB_COMMITTEE_MEMBER; kano.dpp@ and kano.procurement@ recused) scores and finalises.
 */
export async function stepMG05(ctx: NeedsScenarioContext): Promise<void> {
  const cycleId = ctx.ids.mgCycle;
  const CHAIR = 'kano.admin@ubec.test';
  const umbrella = ['kano.committee1@ubec.test', 'kano.committee2@ubec.test', 'kano.committee3@ubec.test'];
  const recusedPeople = ['kano.dpp@ubec.test', 'kano.procurement@ubec.test'];
  const mg1 = await proposalId(ctx, '2027-MG-KN-001');
  const keys = (await rubricOf(ctx, cycleId)).criteria.map((c) => c.key);

  for (const email of umbrella) {
    const u = await ctx.prisma.user.findUniqueOrThrow({ where: { email }, include: { role: true } });
    assert.equal(u.role.code, 'SUBEB_COMMITTEE_MEMBER');
  }
  await ok(ctx, CHAIR, 'put', `/cycles/${cycleId}/committee`, {
    members: [
      { userId: await userId(ctx, CHAIR), role: 'CHAIR' },
      ...(await Promise.all([...umbrella, ...recusedPeople].map(async (e) => ({ userId: await userId(ctx, e), role: 'MEMBER' })))),
    ],
  });
  await declareNone(ctx, cycleId, [CHAIR, ...umbrella, ...recusedPeople]);
  const committee = NeedsCommitteeDtoSchema.parse(await ok(ctx, CHAIR, 'post', `/cycles/${cycleId}/committee/scoring`, { action: 'OPEN' }));
  const dppId = await userId(ctx, 'kano.dpp@ubec.test');
  const procId = await userId(ctx, 'kano.procurement@ubec.test');
  assert.deepEqual(committee.members.find((m) => m.userId === dppId)!.recusals.filter((r) => r.proposalId === mg1).map((r) => r.reason), ['VALIDATED']);
  assert.deepEqual(committee.members.find((m) => m.userId === procId)!.recusals.filter((r) => r.proposalId === mg1).map((r) => r.reason), ['UPLOADED']);

  // The chair and the three umbrella members score every proposal they are not recused from.
  for (const [i, email] of [CHAIR, ...umbrella].entries()) {
    const mine = NeedsMyScoringDtoSchema.parse(await ok(ctx, email, 'get', `/cycles/${cycleId}/score-sheets/mine`));
    assert.equal(mine.canScore, true, mine.cannotScoreReason ?? '');
    for (const item of mine.items.filter((x) => !x.recusal)) {
      await ok(ctx, email, 'put', `/cycles/${cycleId}/score-sheets`, { proposalId: item.proposalId, scores: sheetOf(keys, 3 + (i % 2)) });
    }
  }
  for (const email of recusedPeople) {
    const res = await call(ctx, email, 'put', `/cycles/${cycleId}/score-sheets`, { proposalId: mg1, scores: sheetOf(keys, 4) });
    assert.equal(res.body.error?.code, 'NEEDS_MEMBER_RECUSED', JSON.stringify(res.body));
  }

  const before = NeedsRankingDtoSchema.parse(await ok(ctx, CHAIR, 'get', `/cycles/${cycleId}/ranking`));
  const row = before.rows.find((r) => r.proposalId === mg1)!;
  assert.equal(row.sheetCount, 4);
  assert.equal(row.eligibleCount, 4);
  assert.equal(before.canFinalise, true, before.cannotFinaliseReason ?? '');
  const finalised = NeedsRankingDtoSchema.parse(await ok(ctx, CHAIR, 'post', `/cycles/${cycleId}/ranking/finalise`, {}));
  assert.equal(finalised.finalised, true);
  const p = await ctx.prisma.needsProposal.findUniqueOrThrow({ where: { id: mg1 } });
  assert.equal(p.stage, 'APPROVAL');
  assert.equal(p.status, 'IN_PROGRESS');
  assert.equal(p.rank, 1);
  assert.equal(p.aboveLine, true, 'no indicative ceiling: every ranked proposal is above the line');
  await assertPortfolioGenerated(ctx, cycleId, before.rows.map((r) => r.proposalId));
}
