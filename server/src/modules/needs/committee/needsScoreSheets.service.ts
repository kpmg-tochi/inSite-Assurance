import { Prisma } from '@prisma/client';
import { type NeedsMyScoringDto, type NeedsProposalScoresDto, type ScoreSheet, type ScoreSheetDto } from '@insite/shared';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../middleware/error.middleware';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import { recordAuditEvent } from '../../audit/audit.service';
import { assertCycleWritable, loadVisibleCycle, loadVisibleProposal, webActor, type CycleRow } from '../needsAccess';
import { dec } from '../needsSupport';
import { lockCycle } from '../needsVersions';
import { FINALISED, NOT_MEMBER, SCORE_PERMISSION, loadScoringPicture, memberOf, serializeSheet, type ScoringPicture } from './committeeFacts';

/**
 * Needs pipeline wave 3, Track B (B2): score sheets (D-N.10). One sheet per member and proposal, every
 * criterion of the cycle's frozen rubric scored 1–5. Saving is submitting (the web's "save and
 * submit" is one action); a member edits their sheet while scoring is open, until finalisation.
 * After each change the proposal's live score (`scoreImpact/Ease/Total`) is stored so the proposed
 * projects table shows it.
 */

type Tx = Prisma.TransactionClient;

/** Stores the live score of every in-scope proposal whose score changed (call inside the write's transaction). */
export async function refreshLiveScoresInTx(tx: Tx, cycle: CycleRow, picture?: ScoringPicture): Promise<void> {
  if (cycle.rankingFinalisedAt) return;
  const pic = picture ?? (await loadScoringPicture(tx, cycle));
  for (const p of pic.proposals) {
    const next = p.score;
    const same =
      next === null
        ? p.proposal.scoreTotal === null
        : dec(p.proposal.scoreImpact) === next.impact && dec(p.proposal.scoreEase) === next.ease && dec(p.proposal.scoreTotal) === next.total;
    if (same) continue;
    await tx.needsProposal.update({
      where: { id: p.proposal.id },
      data: { scoreImpact: next?.impact ?? null, scoreEase: next?.ease ?? null, scoreTotal: next?.total ?? null },
    });
  }
}

/** Why the member cannot score now (null = they can). */
function cannotScoreReason(user: WebJwtPayload, picture: ScoringPicture): string | null {
  const me = memberOf(picture, user.userId);
  if (!me) return 'You are not on this cycle’s committee';
  if (!me.canScore || !(user.permissions.includes(SCORE_PERMISSION) || user.isPlatformSuperAdmin)) return 'Your role does not score proposed projects';
  if (!me.conflictDeclaredAt) return 'Declare your conflicts of interest first';
  if (picture.state === 'FINALISED') return 'The ranking is finalised';
  if (picture.state === 'CLOSED') return 'The chair has closed scoring';
  if (picture.state === 'NOT_OPEN') return 'Scoring is not open';
  return null;
}

export async function getMyScoring(user: WebJwtPayload, cycleId: string): Promise<NeedsMyScoringDto> {
  const cycle = await loadVisibleCycle(user, cycleId);
  const picture = await loadScoringPicture(prisma, cycle);
  const me = memberOf(picture, user.userId);
  const reason = cannotScoreReason(user, picture);
  return {
    cycleId: cycle.id,
    canScore: reason === null,
    cannotScoreReason: reason,
    items: me
      ? picture.proposals.map((p) => {
          const recusal = me.recusals.get(p.proposal.id) ?? null;
          const own = recusal ? null : (picture.allSheets.find((s) => s.proposalId === p.proposal.id && s.memberId === me.id) ?? null);
          return {
            proposalId: p.proposal.id,
            reference: p.proposal.reference,
            title: p.proposal.title,
            costedAmountNgn: dec(p.proposal.costedAmountNgn),
            recusal,
            sheet: own ? serializeSheet(own) : null,
          };
        })
      : [],
  };
}

export async function saveScoreSheet(user: WebJwtPayload, cycleId: string, input: ScoreSheet): Promise<ScoreSheetDto> {
  const visible = await loadVisibleCycle(user, cycleId);
  assertCycleWritable(user, visible);
  const sheetId = await prisma.$transaction(async (tx) => {
    await lockCycle(tx, cycleId);
    const cycle = await tx.needsCycle.findUniqueOrThrow({ where: { id: cycleId } });
    assertCycleWritable(user, cycle);
    const picture = await loadScoringPicture(tx, cycle);
    const me = memberOf(picture, user.userId);
    if (!me) throw NOT_MEMBER();
    if (!me.canScore || !(user.permissions.includes(SCORE_PERMISSION) || user.isPlatformSuperAdmin)) {
      throw new AppError('Your role does not score proposed projects', 403, 'FORBIDDEN_PERMISSION');
    }
    if (picture.state === 'FINALISED') throw FINALISED();
    if (!me.conflictDeclaredAt) throw new AppError('Declare your conflicts of interest before scoring', 409, 'NEEDS_CONFLICT_NOT_DECLARED');
    if (picture.state !== 'OPEN') throw new AppError('Scoring is not open', 409, 'NEEDS_SCORING_NOT_OPEN');

    const target = picture.proposals.find((p) => p.proposal.id === input.proposalId);
    if (!target) {
      const exists = await tx.needsProposal.findFirst({ where: { id: input.proposalId, cycleId }, select: { id: true } });
      if (!exists) throw new AppError('Proposed project not found', 404, 'NEEDS_PROPOSAL_NOT_FOUND');
      throw new AppError('Only proposed projects waiting at Prioritisation are scored', 409, 'NEEDS_STAGE_ACTION_NOT_ALLOWED');
    }
    const recusal = me.recusals.get(input.proposalId);
    if (recusal) {
      throw new AppError(`You are recused from ${target.proposal.reference} (${recusal.toLowerCase().replace(/_/g, ' ')})`, 409, 'NEEDS_MEMBER_RECUSED', { reason: recusal });
    }
    const expected = picture.rubric.criteria.map((c) => c.key);
    const given = Object.keys(input.scores);
    const missing = expected.filter((k) => !given.includes(k));
    const unknown = given.filter((k) => !expected.includes(k));
    if (missing.length || unknown.length) {
      throw new AppError('Score every criterion of the cycle’s rubric, and only those', 422, 'NEEDS_SCORE_INCOMPLETE', { missing, unknown });
    }
    const scores = Object.fromEntries(expected.map((k) => [k, input.scores[k]]));
    const previous = picture.allSheets.find((s) => s.proposalId === input.proposalId && s.memberId === me.id);
    const saved = previous
      ? await tx.needsScoreSheet.update({ where: { id: previous.id }, data: { scoresJson: scores, comment: input.comment, submittedAt: new Date() } })
      : await tx.needsScoreSheet.create({ data: { cycleId, proposalId: input.proposalId, memberId: me.id, scoresJson: scores, comment: input.comment } });
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_SCORE_SUBMITTED',
      summaryText: `${user.fullName} ${previous ? 'changed their scores for' : 'scored'} ${target.proposal.reference}.`,
      payload: { cycleId, proposalId: input.proposalId, scoreSheetId: saved.id, memberId: me.id, scores, comment: input.comment, edited: Boolean(previous) },
    });
    await refreshLiveScoresInTx(tx, cycle);
    return saved.id;
  });
  const row = await prisma.needsScoreSheet.findUniqueOrThrow({
    where: { id: sheetId },
    include: { member: { select: { userId: true, user: { select: { fullName: true } } } } },
  });
  return serializeSheet(row);
}

/**
 * Scores of one proposal. Independent scoring (D-N.10): until the ranking is finalised a member sees
 * only their own sheet and the chair sees all; everyone else sees none (`sheetsHidden`). The score,
 * counts and divergence (min, max, spread: never who) are shown to every reader.
 */
export async function getProposalScores(user: WebJwtPayload, proposalId: string): Promise<NeedsProposalScoresDto> {
  const proposal = await loadVisibleProposal(user, proposalId);
  const picture = await loadScoringPicture(prisma, proposal.cycle);
  const p = picture.proposals.find((x) => x.proposal.id === proposal.id);
  const me = memberOf(picture, user.userId);
  const finalised = picture.state === 'FINALISED';
  const seesAll = finalised || me?.role === 'CHAIR';
  // A member who is not the chair sees no combined scores before finalisation (D-N.10, main thread).
  const hideCombined = !finalised && me !== null && me.role !== 'CHAIR';
  const own = (s: { memberId: string }) => me !== null && s.memberId === me.id;
  const sheets = seesAll ? (p?.sheets ?? []) : picture.allSheets.filter((s) => s.proposalId === proposal.id && own(s));
  const stored = proposal.scoreTotal === null ? null : { impact: dec(proposal.scoreImpact) ?? 0, ease: dec(proposal.scoreEase) ?? 0, total: dec(proposal.scoreTotal) ?? 0 };
  return {
    proposalId: proposal.id,
    score: hideCombined ? null : finalised ? stored : (p?.score ?? stored),
    rank: hideCombined ? null : proposal.rank,
    aboveLine: finalised ? proposal.aboveLine : null,
    lineOverrideReason: hideCombined ? null : proposal.lineOverrideReason,
    sheets: sheets.map(serializeSheet),
    sheetsHidden: !seesAll,
    sheetCount: p?.sheets.length ?? 0,
    eligibleCount: p?.eligibleMemberIds.length ?? 0,
    divergent: hideCombined ? [] : (p?.divergent ?? []),
    recusals: picture.members.filter((m) => m.recusals.has(proposal.id)).map((m) => ({ memberName: m.fullName, reason: m.recusals.get(proposal.id)! })),
  };
}
