import { Prisma } from '@prisma/client';
import {
  nextStage,
  type FinaliseRankingRequest,
  type NeedsCycleDocumentDto,
  type NeedsRankingDto,
  type RankingPlacementRequest,
  type SetFundingLineRequest,
} from '@insite/shared';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../middleware/error.middleware';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import { recordAuditEvent } from '../../audit/audit.service';
import { assertCycleWritable, loadVisibleCycle, webActor, type CycleRow } from '../needsAccess';
import { registerGeneratedReportInTx, storeGeneratedReportFiles } from '../needsGeneratedDocuments';
import { cycleConfig, dec } from '../needsSupport';
import { lockCycle } from '../needsVersions';
import {
  FINALISED,
  assertChair,
  finaliseProblem,
  liveRanking,
  loadScoringPicture,
  memberOf,
  shortOfQuorum,
  storedRanking,
  viewerManages,
  type ScoringPicture,
} from './committeeFacts';
import { buildPrioritisedPortfolioFiles } from './prioritisedPortfolioReport';

/**
 * Needs pipeline wave 3, Track B (B3, B4): the ranking (D-N.10). Live until the chair finalises:
 * scores over the sheets of non-recused members, `rankProposals` (total, Impact, lower cost,
 * reference), the line the indicative ceiling draws (`resolveRankingLine`), the chair's line
 * position and placements, each with a reason. Finalisation stores ranks and sides, moves every
 * proposal at Prioritisation to Approval, writes the stage decision and generates the Prioritised
 * Project Portfolio.
 */

type Tx = Prisma.TransactionClient;

const cycleLabel = (c: Pick<CycleRow, 'interventionYear' | 'stateCode'>) => `${c.interventionYear}${c.stateCode ? ` (${c.stateCode})` : ''}`;

function rankingDto(user: WebJwtPayload, picture: ScoringPicture): NeedsRankingDto {
  const { cycle } = picture;
  const finalised = picture.state === 'FINALISED';
  const ranking = finalised ? storedRanking(picture) : liveRanking(picture);
  const canManage = viewerManages(user, picture);
  const problem = canManage ? finaliseProblem(picture) : (finaliseProblem(picture) ?? 'Only the chair of the committee finalises the ranking');
  return {
    cycleId: cycle.id,
    finalised,
    finalisedAt: cycle.rankingFinalisedAt ? cycle.rankingFinalisedAt.toISOString() : null,
    finalisedByName: cycle.rankingFinalisedByName,
    ceilingNgn: dec(cycle.indicativeCeilingNgn),
    computedLinePosition: ranking.computedLinePosition,
    linePosition: ranking.linePosition,
    lineReason: cycle.fundingLineReason,
    totalAboveNgn: ranking.totalAboveNgn,
    quorum: picture.rubric.quorum,
    rows: ranking.rows,
    canManage: canManage && !finalised,
    canFinalise: canManage && problem === null,
    cannotFinaliseReason: problem,
  };
}

export async function getRanking(user: WebJwtPayload, cycleId: string): Promise<NeedsRankingDto> {
  const cycle = await loadVisibleCycle(user, cycleId);
  const picture = await loadScoringPicture(prisma, cycle);
  // Independent scoring (D-N.10): a member who is not the chair sees no combined scores before finalisation.
  const me = memberOf(picture, user.userId);
  if (me && me.role !== 'CHAIR' && picture.state !== 'FINALISED') {
    throw new AppError('Combined scores are shown to committee members once the ranking is finalised', 403, 'NEEDS_SCORES_HIDDEN');
  }
  return rankingDto(user, picture);
}

/** Runs a chair's write under the cycle lock with a fresh picture. */
async function chairWrite<T>(user: WebJwtPayload, cycleId: string, fn: (tx: Tx, picture: ScoringPicture) => Promise<T>): Promise<T> {
  const visible = await loadVisibleCycle(user, cycleId);
  assertCycleWritable(user, visible);
  return prisma.$transaction(
    async (tx) => {
      await lockCycle(tx, cycleId);
      const cycle = await tx.needsCycle.findUniqueOrThrow({ where: { id: cycleId } });
      const picture = await loadScoringPicture(tx, cycle);
      assertChair(user, picture);
      return fn(tx, picture);
    },
    { timeout: 30_000 }
  );
}

export async function setPlacement(user: WebJwtPayload, cycleId: string, input: RankingPlacementRequest): Promise<NeedsRankingDto> {
  await chairWrite(user, cycleId, async (tx, picture) => {
    if (picture.state === 'FINALISED') throw FINALISED();
    const target = picture.proposals.find((p) => p.proposal.id === input.proposalId);
    if (!target) {
      const exists = await tx.needsProposal.findFirst({ where: { id: input.proposalId, cycleId }, select: { id: true } });
      if (!exists) throw new AppError('Proposed project not found', 404, 'NEEDS_PROPOSAL_NOT_FOUND');
      throw new AppError('Only proposed projects waiting at Prioritisation are ranked', 409, 'NEEDS_STAGE_ACTION_NOT_ALLOWED');
    }
    if (input.placement && !target.score) throw new AppError(`${target.proposal.reference} has no score yet`, 409, 'NEEDS_PROPOSAL_NOT_SCORED');
    await tx.needsProposal.update({
      where: { id: target.proposal.id },
      data: input.placement ? { aboveLine: input.placement === 'ABOVE', lineOverrideReason: input.reason } : { aboveLine: null, lineOverrideReason: null },
    });
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_RANKING_OVERRIDDEN',
      summaryText: input.placement
        ? `Placed ${target.proposal.reference} ${input.placement === 'ABOVE' ? 'above' : 'below'} the funding line: ${input.reason}`
        : `Cleared the placement of ${target.proposal.reference}; the line decides its side.`,
      payload: { cycleId, proposalId: target.proposal.id, change: 'PLACEMENT', placement: input.placement, reason: input.reason },
    });
  });
  return getRanking(user, cycleId);
}

export async function setFundingLine(user: WebJwtPayload, cycleId: string, input: SetFundingLineRequest): Promise<NeedsRankingDto> {
  await chairWrite(user, cycleId, async (tx, picture) => {
    if (picture.state === 'FINALISED') throw FINALISED();
    await tx.needsCycle.update({
      where: { id: cycleId },
      data: { fundingLinePosition: input.linePosition, fundingLineReason: input.linePosition === null ? null : input.reason },
    });
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_RANKING_OVERRIDDEN',
      summaryText:
        input.linePosition === null
          ? `Put the funding line of the ${cycleLabel(picture.cycle)} cycle back at the indicative ceiling.`
          : `Drew the funding line of the ${cycleLabel(picture.cycle)} cycle after rank ${input.linePosition}: ${input.reason}`,
      payload: { cycleId, change: 'LINE', linePosition: input.linePosition, previousLinePosition: picture.cycle.fundingLinePosition, reason: input.reason },
    });
  });
  return getRanking(user, cycleId);
}

export async function finaliseRanking(user: WebJwtPayload, cycleId: string, input: FinaliseRankingRequest): Promise<NeedsRankingDto> {
  await chairWrite(user, cycleId, async (tx, picture) => {
    const { cycle } = picture;
    if (picture.state === 'FINALISED') throw FINALISED();
    if (picture.state === 'NOT_OPEN') throw new AppError('Scoring has not been opened', 409, 'NEEDS_SCORING_NOT_OPEN');
    if (picture.proposals.length === 0) throw new AppError('No proposed project is waiting at Prioritisation', 409, 'NEEDS_NOTHING_TO_SCORE');
    const short = shortOfQuorum(picture);
    if (short.length) {
      throw new AppError(
        `Each proposed project needs ${picture.rubric.quorum} score sheets from members who are not recused: ${short.map((s) => `${s.reference} has ${s.sheetCount}`).join(', ')}`,
        409,
        'NEEDS_QUORUM_NOT_MET',
        { quorum: picture.rubric.quorum, items: short }
      );
    }
    if (input.minutesDocumentId) {
      const minutes = await tx.needsCycleDocument.findFirst({ where: { id: input.minutesDocumentId, cycleId }, select: { kind: true } });
      if (!minutes) throw new AppError('Document not found', 404, 'NEEDS_DOCUMENT_NOT_FOUND');
      if (minutes.kind !== 'COMMITTEE_MINUTES') throw new AppError('Attach the committee minutes', 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');
    }
    const config = cycleConfig(cycle);
    const toStage = nextStage(config, 'PRIORITISATION');
    if (!toStage) throw new AppError('The cycle has no stage after Prioritisation', 409, 'NEEDS_STAGE_ACTION_NOT_ALLOWED');

    const ranking = liveRanking(picture);
    const aboveCount = ranking.rows.filter((r) => r.aboveLine).length;
    const now = new Date();
    for (const row of ranking.rows) {
      // An override is kept only when it moved the proposal across the line.
      const keptReason = row.placement && row.aboveLine !== row.computedAboveLine ? row.placementReason : null;
      await tx.needsProposal.update({
        where: { id: row.proposalId },
        data: {
          scoreImpact: row.score?.impact ?? null,
          scoreEase: row.score?.ease ?? null,
          scoreTotal: row.score?.total ?? null,
          rank: row.rank,
          aboveLine: row.aboveLine,
          lineOverrideReason: keptReason,
          stage: toStage,
          status: 'IN_PROGRESS',
          statusReason: null,
        },
      });
    }
    await tx.needsCycle.update({
      where: { id: cycleId },
      data: {
        // Review fix (wave 3): the line in force (ranked proposals above it before placements), not the
        // count above it, so the stored ranking draws the line where it was and placements stay overrides.
        fundingLinePosition: ranking.linePosition,
        rankingFinalisedAt: now,
        rankingFinalisedByUserId: user.userId,
        rankingFinalisedByName: user.fullName,
        ...(cycle.scoringClosedAt ? {} : { scoringClosedAt: now, scoringClosedByUserId: user.userId, scoringClosedByName: user.fullName }),
      },
    });
    const side = (r: (typeof ranking.rows)[number]) =>
      `Rank ${r.rank ?? '–'}, ${r.aboveLine ? 'above' : 'below'} the funding line${r.placement && r.aboveLine !== r.computedAboveLine ? ` (override: ${r.placementReason})` : ''}`;
    const decision = await tx.needsStageDecision.create({
      data: {
        cycleId,
        stage: 'PRIORITISATION',
        reason: input.note,
        evidenceDocumentIds: input.minutesDocumentId ? [input.minutesDocumentId] : [],
        decidedByUserId: user.userId,
        decidedByName: user.fullName,
        decidedAt: now,
        items: { create: ranking.rows.map((r) => ({ proposalId: r.proposalId, outcome: 'ADVANCE', reason: side(r), toStage, toStatus: 'IN_PROGRESS' })) },
      },
    });
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_RANKING_FINALISED',
      summaryText: `Finalised the ranking of the ${cycleLabel(cycle)} cycle: ${ranking.rows.length} proposed project${ranking.rows.length === 1 ? '' : 's'}, ${aboveCount} above the funding line (NGN ${ranking.totalAboveNgn.toLocaleString('en-NG')}); moved to ${config.stages.find((s) => s.stage === toStage)?.label ?? toStage}.`,
      payload: {
        cycleId,
        decisionId: decision.id,
        minutesDocumentId: input.minutesDocumentId,
        note: input.note,
        linePosition: ranking.linePosition,
        aboveCount,
        chairLinePosition: cycle.fundingLinePosition,
        lineReason: cycle.fundingLineReason,
        ceilingNgn: dec(cycle.indicativeCeilingNgn),
        totalAboveNgn: ranking.totalAboveNgn,
        proposalIds: ranking.rows.map((r) => r.proposalId),
        ranking: ranking.rows.map((r) => ({
          proposalId: r.proposalId,
          reference: r.reference,
          rank: r.rank,
          score: r.score,
          costNgn: r.costNgn,
          aboveLine: r.aboveLine,
          computedAboveLine: r.computedAboveLine,
          overrideReason: r.placement && r.aboveLine !== r.computedAboveLine ? r.placementReason : null,
        })),
      },
    });
  });
  try {
    await generatePrioritisedPortfolio(user, cycleId);
  } catch (error) {
    // The ranking is final; the chair regenerates the report with POST …/ranking/report.
    console.warn('[needs] Prioritised Project Portfolio generation failed:', error);
  }
  return getRanking(user, cycleId);
}

/** Builds, stores and registers the Prioritised Project Portfolio (xlsx + PDF) of a finalised cycle. */
async function generatePrioritisedPortfolio(user: WebJwtPayload, cycleId: string): Promise<NeedsCycleDocumentDto[]> {
  const cycle = await prisma.needsCycle.findUniqueOrThrow({ where: { id: cycleId } });
  const picture = await loadScoringPicture(prisma, cycle);
  const ranking = storedRanking(picture);
  const { files, title } = await buildPrioritisedPortfolioFiles({ cycle, ranking, preparedBy: user.fullName });
  const stored = await storeGeneratedReportFiles(user.tenantId, cycleId, files);
  return prisma.$transaction(async (tx) => {
    await lockCycle(tx, cycleId);
    return registerGeneratedReportInTx(tx, {
      tenantId: user.tenantId,
      cycleId,
      kind: 'PRIORITISED_PROJECT_PORTFOLIO',
      title,
      proposalIds: ranking.rows.map((r) => r.proposalId),
      files: stored,
      by: { userId: user.userId, name: user.fullName },
      actor: webActor(user),
    });
  });
}

/** `POST …/ranking/report`: the chair regenerates the report after finalisation. */
export async function regeneratePrioritisedPortfolio(user: WebJwtPayload, cycleId: string): Promise<NeedsCycleDocumentDto[]> {
  const cycle = await loadVisibleCycle(user, cycleId);
  assertCycleWritable(user, cycle);
  const picture = await loadScoringPicture(prisma, cycle);
  assertChair(user, picture);
  if (picture.state !== 'FINALISED') throw new AppError('The ranking is not finalised yet', 409, 'NEEDS_RANKING_NOT_FINALISED');
  return generatePrioritisedPortfolio(user, cycleId);
}
