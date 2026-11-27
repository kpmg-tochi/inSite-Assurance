import { Prisma } from '@prisma/client';
import {
  divergentCriteria,
  fundingLine,
  proposalScore,
  rankProposals,
  resolveRankingLine,
  type DivergentCriterionDto,
  type NeedsRankingRow,
  type NeedsRubric,
  type ProposalScore,
  type RankingPlacement,
  type RecusalReason,
  type ScoreSheetDto,
} from '@insite/shared';
import { AppError } from '../../../middleware/error.middleware';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import { assertCycleWritable, type CycleRow, type Db, type ProposalRow } from '../needsAccess';
import { dutyHistories, loadCommittee, memberRecusals, proposalsAtPrioritisation, scoringState, type CommitteeMemberFacts, type ScoringState } from '../needsFacts';
import { cycleConfig, dec } from '../needsSupport';

/**
 * Needs pipeline wave 3, Track B (N5): one batched read of everything the committee, the score sheets
 * and the ranking need (committee, duty histories, sheets), so no route queries per proposal.
 *
 * The proposals in scope are the ones waiting at Prioritisation while the ranking is live; once the
 * chair finalised, the ranked proposals of the cycle (stored `rank`). A proposal that reaches
 * Prioritisation after finalisation is not in scope and cannot be scored (known limit, wave 3).
 */

export const SCORE_PERMISSION = 'needs:score';
export const CHAIR_PERMISSION = 'needs:chair_committee';

type SheetRow = Prisma.NeedsScoreSheetGetPayload<{ include: { member: { select: { userId: true; user: { select: { fullName: true } } } } } }>;

export interface MemberPicture extends CommitteeMemberFacts {
  /** Holds `needs:score` (the chair scores only when they hold it). */
  canScore: boolean;
  recusals: Map<string, RecusalReason>;
}

export interface ProposalPicture {
  proposal: ProposalRow;
  /** Members who score it: hold `needs:score` and are not recused. */
  eligibleMemberIds: string[];
  /** Sheets of eligible members (the ones that count). */
  sheets: SheetRow[];
  score: ProposalScore | null;
  divergent: DivergentCriterionDto[];
}

export interface ScoringPicture {
  cycle: CycleRow;
  rubric: NeedsRubric;
  state: ScoringState;
  members: MemberPicture[];
  proposals: ProposalPicture[];
  /** Every sheet of the in-scope proposals (also those of recused members, if any are left). */
  allSheets: SheetRow[];
}

export const sheetScores = (json: Prisma.JsonValue): Record<string, number> => {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {};
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(json)) if (typeof v === 'number') out[k] = v;
  return out;
};

export function serializeSheet(s: SheetRow): ScoreSheetDto {
  return {
    id: s.id,
    proposalId: s.proposalId,
    scores: sheetScores(s.scoresJson),
    comment: s.comment,
    memberUserId: s.member.userId,
    memberName: s.member.user.fullName,
    submittedAt: s.submittedAt.toISOString(),
  };
}

export function divergentWithLabels(sheets: readonly SheetRow[], rubric: NeedsRubric): DivergentCriterionDto[] {
  const label = new Map(rubric.criteria.map((c) => [c.key, c.label]));
  const order = new Map(rubric.criteria.map((c, i) => [c.key, i]));
  return divergentCriteria(
    sheets.map((s) => ({ scores: sheetScores(s.scoresJson) })),
    rubric.divergenceThreshold
  )
    .sort((a, b) => (order.get(a.criterionKey) ?? 99) - (order.get(b.criterionKey) ?? 99))
    .map((d) => ({ ...d, label: label.get(d.criterionKey) ?? d.criterionKey }));
}

async function scopeProposals(db: Db, cycle: CycleRow): Promise<ProposalRow[]> {
  if (cycle.rankingFinalisedAt) {
    return db.needsProposal.findMany({ where: { cycleId: cycle.id, rank: { not: null } }, orderBy: [{ rank: 'asc' }, { sequence: 'asc' }] });
  }
  return proposalsAtPrioritisation(db, cycle.id);
}

export async function loadScoringPicture(db: Db, cycle: CycleRow): Promise<ScoringPicture> {
  const rubric = cycleConfig(cycle).rubric;
  const [committee, proposals] = await Promise.all([loadCommittee(db, cycle.id), scopeProposals(db, cycle)]);
  const ids = proposals.map((p) => p.id);
  const [histories, allSheets] = await Promise.all([
    dutyHistories(db, ids),
    ids.length
      ? db.needsScoreSheet.findMany({
          where: { cycleId: cycle.id, proposalId: { in: ids } },
          include: { member: { select: { userId: true, user: { select: { fullName: true } } } } },
          orderBy: { submittedAt: 'asc' },
        })
      : Promise.resolve([] as SheetRow[]),
  ]);
  const members: MemberPicture[] = committee.map((m) => ({
    ...m,
    canScore: m.permissionKeys.includes(SCORE_PERMISSION),
    recusals: new Map(memberRecusals(m, histories).map((r) => [r.proposalId, r.reason])),
  }));
  const pictures = proposals.map((proposal) => {
    const eligible = members.filter((m) => m.canScore && !m.recusals.has(proposal.id)).map((m) => m.id);
    const sheets = allSheets.filter((s) => s.proposalId === proposal.id && eligible.includes(s.memberId));
    return {
      proposal,
      eligibleMemberIds: eligible,
      sheets,
      score: proposalScore(
        sheets.map((s) => ({ scores: sheetScores(s.scoresJson) })),
        rubric
      ),
      divergent: divergentWithLabels(sheets, rubric),
    };
  });
  return { cycle, rubric, state: scoringState(cycle), members, proposals: pictures, allSheets };
}

// ---------------------------------------------------------------------------
// Who acts
// ---------------------------------------------------------------------------

export const memberOf = (picture: Pick<ScoringPicture, 'members'>, userId: string) => picture.members.find((m) => m.userId === userId) ?? null;

export const NOT_CHAIR = () => new AppError('Only the chair of this cycle’s committee can do this', 403, 'NEEDS_NOT_COMMITTEE_CHAIR');
export const NOT_MEMBER = () => new AppError('You are not on this cycle’s committee', 403, 'NEEDS_NOT_COMMITTEE_MEMBER');
export const FINALISED = () => new AppError('The ranking of this cycle is finalised', 409, 'NEEDS_RANKING_FINALISED');

/** The caller writes the cycle and is its committee's chair (holding `needs:chair_committee`). */
export function assertChair(user: WebJwtPayload, picture: Pick<ScoringPicture, 'cycle' | 'members'>): MemberPicture {
  assertCycleWritable(user, picture.cycle);
  const me = memberOf(picture, user.userId);
  if (!me || me.role !== 'CHAIR' || !(user.permissions.includes(CHAIR_PERMISSION) || user.isPlatformSuperAdmin)) throw NOT_CHAIR();
  return me;
}

/** The viewer may manage the committee (DTO `canManage`). */
export function viewerManages(user: WebJwtPayload, picture: Pick<ScoringPicture, 'cycle' | 'members'>): boolean {
  try {
    assertChair(user, picture);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

export interface ComputedRanking {
  rows: NeedsRankingRow[];
  computedLinePosition: number;
  linePosition: number;
  totalAboveNgn: number;
}

/** Live ranking (D-N.10): scores, rank, cumulative cost, the line and the chair's placements. */
export function liveRanking(picture: ScoringPicture): ComputedRanking {
  const byId = new Map(picture.proposals.map((p) => [p.proposal.id, p]));
  const ranked = rankProposals(
    picture.proposals.map((p) => ({ id: p.proposal.id, reference: p.proposal.reference, score: p.score, costNgn: dec(p.proposal.costedAmountNgn) }))
  );
  const placements = new Map<string, RankingPlacement>();
  for (const p of picture.proposals) {
    if (p.proposal.aboveLine !== null && p.proposal.lineOverrideReason) placements.set(p.proposal.id, p.proposal.aboveLine ? 'ABOVE' : 'BELOW');
  }
  const line = resolveRankingLine({
    ranked,
    ceilingNgn: dec(picture.cycle.indicativeCeilingNgn),
    linePosition: picture.cycle.fundingLinePosition,
    placements,
  });
  const rows = ranked.map((r, i) => {
    const p = byId.get(r.id)!;
    const item = line.items[i];
    return {
      proposalId: r.id,
      reference: p.proposal.reference,
      title: p.proposal.title,
      stateCode: p.proposal.stateCode,
      lgaCodes: p.proposal.lgaCodes,
      costNgn: r.costNgn,
      score: p.score,
      sheetCount: p.sheets.length,
      eligibleCount: p.eligibleMemberIds.length,
      divergent: p.divergent,
      rank: r.rank,
      cumulativeNgn: item.cumulativeNgn,
      computedAboveLine: item.computedAboveLine,
      aboveLine: item.aboveLine,
      placement: item.placement,
      placementReason: item.placement ? p.proposal.lineOverrideReason : null,
    };
  });
  return { rows, computedLinePosition: line.computedLinePosition, linePosition: line.linePosition, totalAboveNgn: line.totalAboveNgn };
}

/**
 * The finalised ranking as stored: ranks, scores, the side of the line and the overrides that moved
 * a proposal across it (finalisation keeps a reason only on those). The ceiling's own line is
 * recomputed for reference.
 */
export function storedRanking(picture: ScoringPicture): ComputedRanking {
  const sorted = [...picture.proposals].sort((a, b) => (a.proposal.rank ?? 1e9) - (b.proposal.rank ?? 1e9));
  const storedScore = (p: ProposalRow): ProposalScore | null =>
    p.scoreTotal === null ? null : { impact: dec(p.scoreImpact) ?? 0, ease: dec(p.scoreEase) ?? 0, total: dec(p.scoreTotal) ?? 0 };
  const computed = fundingLine(
    sorted.map((p) => ({ id: p.proposal.id, reference: p.proposal.reference, score: storedScore(p.proposal), costNgn: dec(p.proposal.costedAmountNgn), rank: p.proposal.rank })),
    dec(picture.cycle.indicativeCeilingNgn)
  );
  let running = 0;
  let totalAboveNgn = 0;
  const rows = sorted.map((p) => {
    const cost = dec(p.proposal.costedAmountNgn);
    const cumulativeNgn = cost === null ? null : Math.round((running + cost) * 100) / 100;
    if (cost !== null) running += cost;
    const aboveLine = p.proposal.aboveLine === true;
    if (aboveLine) totalAboveNgn += cost ?? 0;
    const placement: RankingPlacement | null = p.proposal.lineOverrideReason ? (aboveLine ? 'ABOVE' : 'BELOW') : null;
    return {
      proposalId: p.proposal.id,
      reference: p.proposal.reference,
      title: p.proposal.title,
      stateCode: p.proposal.stateCode,
      lgaCodes: p.proposal.lgaCodes,
      costNgn: cost,
      score: storedScore(p.proposal),
      sheetCount: p.sheets.length,
      eligibleCount: p.eligibleMemberIds.length,
      divergent: p.divergent,
      rank: p.proposal.rank,
      cumulativeNgn,
      computedAboveLine: placement ? !aboveLine : aboveLine,
      aboveLine,
      placement,
      placementReason: placement ? p.proposal.lineOverrideReason : null,
    };
  });
  return {
    rows,
    computedLinePosition: computed.linePosition,
    linePosition: picture.cycle.fundingLinePosition ?? rows.filter((r) => r.aboveLine).length,
    totalAboveNgn: Math.round(totalAboveNgn * 100) / 100,
  };
}

/** Proposals short of the quorum (finalisation refuses while any is). */
export function shortOfQuorum(picture: ScoringPicture) {
  return picture.proposals
    .filter((p) => p.sheets.length < picture.rubric.quorum)
    .map((p) => ({ proposalId: p.proposal.id, reference: p.proposal.reference, sheetCount: p.sheets.length, eligibleCount: p.eligibleMemberIds.length }));
}

/** Why the chair cannot finalise now (null = they can, as far as the ranking goes). */
export function finaliseProblem(picture: ScoringPicture): string | null {
  if (picture.state === 'FINALISED') return 'The ranking is finalised';
  if (picture.state === 'NOT_OPEN') return 'Scoring has not been opened';
  if (picture.proposals.length === 0) return 'No proposed project is waiting at Prioritisation';
  const short = shortOfQuorum(picture);
  if (short.length) return `Quorum not met (${picture.rubric.quorum} score sheets each): ${short.map((s) => `${s.reference} has ${s.sheetCount}`).join(', ')}`;
  return null;
}
