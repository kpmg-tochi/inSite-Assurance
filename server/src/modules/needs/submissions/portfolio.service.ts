import { Prisma } from '@prisma/client';
import {
  stageConfigOf,
  type NeedsApprovalActionRequest,
  type NeedsCycleDocumentDto,
  type NeedsDocumentPresignRequest,
  type NeedsPresignedUploadDto,
  type NeedsSubmissionDto,
  type RegisterCycleDocumentRequest,
  type SubmitPortfolioRequest,
} from '@insite/shared';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../middleware/error.middleware';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import { recordAuditEvent } from '../../audit/audit.service';
import { loadVisibleCycle, loadWritableCycle, webActor, type CycleRow } from '../needsAccess';
import { presignNeedsDocument, registerCycleDocument } from '../needsCycles.service';
import { cycleConfig, dec } from '../needsSupport';
import { lockCycle } from '../needsVersions';
import {
  SUBMISSION_INCLUDE,
  actOnSubmissionInTx,
  createSubmissionInTx,
  gateForSubmission,
  loadVisibleSubmission,
  replaceItemsInTx,
  serializeSubmission,
  submitInTx,
  type ActContext,
  type SubmissionRow,
} from './submissions.service';

/**
 * Needs pipeline wave 4, Track A (A1, A2): the portfolio (D-N.11, chain NEEDS_PORTFOLIO).
 *
 * - Submit (`needs:submit_portfolio`, the cycle's owning organisation, OPEN cycle): needs the
 *   finalised ranking (409 NEEDS_RANKING_NOT_FINALISED); the items are exactly the annual proposals at
 *   Approval IN_PROGRESS (422 NEEDS_PORTFOLIO_ITEMS_MISMATCH, `details.missing` / `details.extra`);
 *   below the funding line cannot be included (422 NEEDS_BELOW_LINE_INCLUDED); at least one included
 *   (422 NEEDS_PORTFOLIO_EMPTY); amount = the costed amount. A live portfolio (IN_REVIEW or APPROVED)
 *   is 409 NEEDS_PORTFOLIO_EXISTS; a RETURNED one is resubmitted by the same call (items replaced).
 * - Act (the step's holder, `gateForSubmission`): the cycle must still be OPEN (409
 *   NEEDS_CYCLE_NOT_OPEN); an APPROVE may exclude included items with reasons (422
 *   NEEDS_EXCLUSION_INVALID; at least one must stay included, 422 NEEDS_PORTFOLIO_EMPTY); the last
 *   step's APPROVE needs the signed memo, a cycle document of kind APPROVAL_MEMO (422
 *   NEEDS_APPROVAL_MEMO_REQUIRED / NEEDS_DOCUMENT_KIND_MISMATCH), stored on the submission.
 * - Approved (same transaction): included proposals → Funding IN_PROGRESS with the approved amount;
 *   excluded ones (also those excluded at submission) → NOT_SELECTED ("Not funded, carried forward")
 *   with the exclusion reason; one NeedsStageDecision (stage APPROVAL, evidence = the memo) and a
 *   NEEDS_STAGE_DECIDED entry per item.
 * - The memo is uploaded by whoever may act on the current step (presign + register, kind
 *   APPROVAL_MEMO, covering the portfolio's proposals).
 */

type Tx = Prisma.TransactionClient;

const ngn = (n: number) => `₦${n.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
const LIVE = ['IN_REVIEW', 'APPROVED'];

/** The cycle's portfolio still in play (newest), if any. */
async function latestPortfolio(db: Tx | typeof prisma, cycleId: string) {
  return db.needsSubmission.findFirst({ where: { cycleId, kind: 'PORTFOLIO' }, orderBy: { createdAt: 'desc' } });
}

async function portfolioDto(user: WebJwtPayload, submissionId: string): Promise<NeedsSubmissionDto> {
  const row = await loadVisibleSubmission(user, submissionId);
  return serializeSubmission(prisma, user, row);
}

// ---------------------------------------------------------------------------
// Submit
// ---------------------------------------------------------------------------

export async function submitPortfolio(user: WebJwtPayload, cycleId: string, input: SubmitPortfolioRequest): Promise<NeedsSubmissionDto> {
  await loadWritableCycle(user, cycleId);
  const submissionId = await prisma.$transaction(
    async (tx) => {
      await lockCycle(tx, cycleId);
      const cycle = await tx.needsCycle.findUniqueOrThrow({ where: { id: cycleId } });
      if (cycle.status !== 'OPEN') throw new AppError('This cycle is not open', 409, 'NEEDS_CYCLE_NOT_OPEN');
      if (!cycle.rankingFinalisedAt) throw new AppError('The committee has not finalised the ranking yet', 409, 'NEEDS_RANKING_NOT_FINALISED');
      const existing = await latestPortfolio(tx, cycle.id);
      if (existing && LIVE.includes(existing.status)) {
        throw new AppError(existing.status === 'APPROVED' ? 'The portfolio of this cycle is already approved' : 'The portfolio is already with the approvers', 409, 'NEEDS_PORTFOLIO_EXISTS', {
          submissionId: existing.id,
        });
      }

      const atApproval = await tx.needsProposal.findMany({
        where: { cycleId: cycle.id, route: 'ANNUAL', stage: 'APPROVAL', status: 'IN_PROGRESS' },
        select: { id: true, reference: true, aboveLine: true, costedAmountNgn: true },
        orderBy: [{ rank: 'asc' }, { sequence: 'asc' }],
      });
      const byId = new Map(atApproval.map((p) => [p.id, p]));
      const listed = input.items.map((i) => i.proposalId);
      const seen = new Set<string>();
      const extra: string[] = [];
      for (const id of listed) {
        if (!byId.has(id) || seen.has(id)) extra.push(id);
        seen.add(id);
      }
      const missing = atApproval.filter((p) => !seen.has(p.id)).map((p) => p.reference);
      if (missing.length || extra.length) {
        const extraRefs = await tx.needsProposal.findMany({ where: { id: { in: extra.filter((id) => /^[0-9a-f-]{36}$/i.test(id)) } }, select: { id: true, reference: true } });
        const refOf = new Map(extraRefs.map((p) => [p.id, p.reference]));
        throw new AppError(
          'The portfolio must list every proposed project waiting for approval, once each, and nothing else',
          422,
          'NEEDS_PORTFOLIO_ITEMS_MISMATCH',
          { missing, extra: extra.map((id) => refOf.get(id) ?? id) }
        );
      }
      const below = input.items.filter((i) => i.included && byId.get(i.proposalId)!.aboveLine === false).map((i) => byId.get(i.proposalId)!.reference);
      if (below.length) {
        throw new AppError(`Below the committee's funding line: ${below.join(', ')}. Exclude it with a reason.`, 422, 'NEEDS_BELOW_LINE_INCLUDED', { references: below });
      }
      const included = input.items.filter((i) => i.included);
      if (!included.length) throw new AppError('Include at least one proposed project', 422, 'NEEDS_PORTFOLIO_EMPTY');

      const items = input.items.map((i) => ({
        proposalId: i.proposalId,
        included: i.included,
        exclusionReason: i.included ? null : i.exclusionReason,
        amountNgn: dec(byId.get(i.proposalId)!.costedAmountNgn),
      }));
      const total = items.filter((i) => i.included).reduce((s, i) => s + (i.amountNgn ?? 0), 0);
      const excludedRefs = items.filter((i) => !i.included).map((i) => byId.get(i.proposalId)!.reference);
      const summary =
        `${existing ? 'Resubmitted' : 'Submitted'} the ${cycle.interventionYear} portfolio for approval: ${included.length} proposed project(s), ${ngn(total)}` +
        `${excludedRefs.length ? `; excluded ${excludedRefs.join(', ')}` : ''}${input.note ? `. Note: ${input.note}` : '.'}`;

      let id: string;
      let completedWithoutSteps: boolean;
      if (existing) {
        // RETURNED (or a DRAFT left over): same submission, new items, a new pass.
        id = existing.id;
        await replaceItemsInTx(tx, id, items);
        ({ completedWithoutSteps } = await submitInTx(tx, user, id, summary));
      } else {
        ({ submissionId: id, completedWithoutSteps } = await createSubmissionInTx(tx, { user, cycle, kind: 'PORTFOLIO', items, submit: true, summary }));
      }
      // A chain without steps is approved at once (no memo then: nobody signs).
      if (completedWithoutSteps) await applyPortfolioApproval(tx, user, cycle, id, { notes: input.note, memoDocumentId: null });
      return id;
    },
    { timeout: 30_000 }
  );
  return portfolioDto(user, submissionId);
}

// ---------------------------------------------------------------------------
// Act on the current step
// ---------------------------------------------------------------------------

async function assertMemo(tx: Tx, cycleId: string, memoDocumentId: string | null): Promise<void> {
  if (!memoDocumentId) throw new AppError('Attach the signed approval memo', 422, 'NEEDS_APPROVAL_MEMO_REQUIRED');
  const doc = await tx.needsCycleDocument.findFirst({ where: { id: memoDocumentId, cycleId } });
  if (!doc) throw new AppError('The approval memo must be a document of this cycle', 422, 'NEEDS_APPROVAL_MEMO_REQUIRED');
  if (doc.kind !== 'APPROVAL_MEMO') throw new AppError('The memo must be filed as an approval memo', 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');
}

/** Exclusions and the memo, checked and written before the action is recorded. */
async function beforePortfolioAct(tx: Tx, ctx: ActContext): Promise<void> {
  const { request, submission } = ctx;
  if (request.decision !== 'APPROVE') return;
  const included = new Map(submission.items.filter((i) => i.included).map((i) => [i.proposalId, i]));
  const excluded = new Set<string>();
  for (const e of request.exclusions) {
    if (!included.has(e.proposalId) || excluded.has(e.proposalId)) {
      throw new AppError('Only a proposed project included in this portfolio can be excluded, once', 422, 'NEEDS_EXCLUSION_INVALID', { proposalId: e.proposalId });
    }
    excluded.add(e.proposalId);
  }
  if (included.size - excluded.size < 1) throw new AppError('At least one proposed project must stay in the portfolio', 422, 'NEEDS_PORTFOLIO_EMPTY');
  if (ctx.isLastStep) await assertMemo(tx, ctx.cycle.id, request.memoDocumentId);
  else if (request.memoDocumentId) await assertMemo(tx, ctx.cycle.id, request.memoDocumentId);
  if (request.memoDocumentId) await tx.needsSubmission.update({ where: { id: submission.id }, data: { memoDocumentId: request.memoDocumentId } });
  for (const e of request.exclusions) {
    await tx.needsSubmissionItem.update({ where: { submissionId_proposalId: { submissionId: submission.id, proposalId: e.proposalId } }, data: { included: false, exclusionReason: e.reason } });
  }
}

function portfolioSummary(ctx: ActContext, outcome: 'ADVANCED' | 'APPROVED' | 'RETURNED'): string {
  const { step, request, submission } = ctx;
  if (outcome === 'RETURNED') return `${step.label}: returned the ${ctx.cycle.interventionYear} portfolio: ${request.notes ?? ''}`;
  const refOf = new Map(submission.items.map((i) => [i.proposalId, i.proposal.reference]));
  const exclusions = request.exclusions.map((e) => `${refOf.get(e.proposalId) ?? e.proposalId} (${e.reason})`);
  return (
    `${step.label}: ${outcome === 'APPROVED' ? 'approved the portfolio (chain complete)' : 'approved the portfolio'}` +
    `${exclusions.length ? `; excluded ${exclusions.join(', ')}` : ''}${request.notes ? `. ${request.notes}` : '.'}`
  );
}

/**
 * The approval's effect (A1): included proposals to Funding with the approved amount, excluded ones
 * NOT_SELECTED; one stage decision with an item per proposal and its ledger entries.
 */
async function applyPortfolioApproval(tx: Tx, user: WebJwtPayload, cycle: CycleRow, submissionId: string, opts: { notes: string | null; memoDocumentId: string | null }): Promise<void> {
  const config = cycleConfig(cycle);
  const items = await tx.needsSubmissionItem.findMany({
    where: { submissionId },
    include: { proposal: { select: { id: true, reference: true, stage: true, status: true, currentVersionId: true } } },
    orderBy: { sortOrder: 'asc' },
  });
  const stale = items.filter((i) => i.proposal.stage !== 'APPROVAL' || i.proposal.status !== 'IN_PROGRESS').map((i) => i.proposal.reference);
  if (stale.length) throw new AppError(`No longer waiting for approval: ${stale.join(', ')}`, 409, 'NEEDS_STAGE_ACTION_NOT_ALLOWED', { references: stale });
  const fundingLabel = stageConfigOf(config, 'FUNDING')?.label ?? 'Funding';
  const approvalLabel = stageConfigOf(config, 'APPROVAL')?.label ?? 'Approval';
  const decision = await tx.needsStageDecision.create({
    data: {
      cycleId: cycle.id,
      stage: 'APPROVAL',
      reason: opts.notes,
      evidenceDocumentIds: opts.memoDocumentId ? [opts.memoDocumentId] : [],
      decidedByUserId: user.userId,
      decidedByName: user.fullName,
    },
  });
  const actor = webActor(user);
  for (const item of items) {
    const p = item.proposal;
    const advance = item.included;
    const amount = dec(item.amountNgn);
    if (advance) {
      await tx.needsProposal.update({ where: { id: p.id }, data: { stage: 'FUNDING', status: 'IN_PROGRESS', approvedAmountNgn: amount, statusReason: null } });
    } else {
      await tx.needsProposal.update({ where: { id: p.id }, data: { status: 'NOT_SELECTED', statusReason: item.exclusionReason } });
    }
    const outcome = advance ? 'ADVANCE' : 'NOT_SELECTED';
    const toStage = advance ? 'FUNDING' : 'APPROVAL';
    const toStatus = advance ? 'IN_PROGRESS' : 'NOT_SELECTED';
    await tx.needsStageDecisionItem.create({ data: { decisionId: decision.id, proposalId: p.id, outcome, reason: advance ? null : item.exclusionReason, toStage, toStatus } });
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...actor,
      action: 'NEEDS_STAGE_DECIDED',
      summaryText: advance
        ? `${approvalLabel}: ${p.reference} approved${amount !== null ? ` at ${ngn(amount)}` : ''}, to ${fundingLabel.toLowerCase()}.`
        : `${approvalLabel}: ${p.reference} not funded, carried forward: ${item.exclusionReason ?? ''}`,
      payload: {
        cycleId: cycle.id,
        decisionId: decision.id,
        submissionId,
        proposalId: p.id,
        reference: p.reference,
        stage: 'APPROVAL',
        outcome,
        toStage,
        toStatus,
        reason: advance ? null : item.exclusionReason,
        approvedAmountNgn: advance ? amount : null,
        memoDocumentId: opts.memoDocumentId,
        versionId: p.currentVersionId,
      },
    });
  }
}

/** The portfolio waiting on a step (404 for an unseen cycle; 409 when none is in review). */
async function inReviewPortfolio(db: Tx | typeof prisma, cycleId: string): Promise<SubmissionRow & { cycle: CycleRow }> {
  const row = await db.needsSubmission.findFirst({
    where: { cycleId, kind: 'PORTFOLIO', status: 'IN_REVIEW' },
    include: { ...SUBMISSION_INCLUDE, cycle: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!row) throw new AppError('No portfolio is waiting for approval in this cycle', 409, 'NEEDS_SUBMISSION_NOT_IN_REVIEW');
  return row;
}

export async function actOnPortfolio(user: WebJwtPayload, cycleId: string, request: NeedsApprovalActionRequest): Promise<NeedsSubmissionDto> {
  await loadVisibleCycle(user, cycleId);
  const submissionId = await prisma.$transaction(
    async (tx) => {
      await lockCycle(tx, cycleId);
      const cycle = await tx.needsCycle.findUniqueOrThrow({ where: { id: cycleId } });
      if (cycle.status !== 'OPEN') throw new AppError('This cycle is not open', 409, 'NEEDS_CYCLE_NOT_OPEN');
      const submission = await inReviewPortfolio(tx, cycle.id);
      await actOnSubmissionInTx(tx, user, submission.id, request, {
        beforeAct: beforePortfolioAct,
        summary: portfolioSummary,
        onApproved: (t, ctx) => applyPortfolioApproval(t, user, ctx.cycle, ctx.submission.id, { notes: ctx.request.notes, memoDocumentId: ctx.request.memoDocumentId }),
      });
      return submission.id;
    },
    { timeout: 30_000 }
  );
  return portfolioDto(user, submissionId);
}

// ---------------------------------------------------------------------------
// The signed memo (whoever may act on the current step)
// ---------------------------------------------------------------------------

async function assertMayActOnPortfolio(user: WebJwtPayload, cycleId: string): Promise<SubmissionRow & { cycle: CycleRow }> {
  await loadVisibleCycle(user, cycleId);
  const submission = await inReviewPortfolio(prisma, cycleId);
  const gate = await gateForSubmission(prisma, user, submission, submission.cycle);
  if (!gate.allowed) throw new AppError(gate.reason ?? 'You cannot act on this portfolio', gate.status, gate.code ?? 'NOT_STEP_APPROVER');
  return submission;
}

export async function presignPortfolioMemo(user: WebJwtPayload, cycleId: string, input: NeedsDocumentPresignRequest): Promise<NeedsPresignedUploadDto> {
  await assertMayActOnPortfolio(user, cycleId);
  // The wave 2 presign checks the owning organisation and an open cycle (the portfolio's steps are
  // the owner's); the gate above stands in for the route's needs:manage_cycle.
  return presignNeedsDocument(user, cycleId, input);
}

export async function registerPortfolioMemo(user: WebJwtPayload, cycleId: string, input: RegisterCycleDocumentRequest): Promise<NeedsCycleDocumentDto> {
  if (input.kind !== 'APPROVAL_MEMO') throw new AppError('Only the approval memo is filed here', 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');
  const submission = await assertMayActOnPortfolio(user, cycleId);
  // The memo covers the portfolio's proposals (D-N.5: the project's documents read it through them).
  return registerCycleDocument(user, cycleId, { ...input, proposalIds: submission.items.map((i) => i.proposalId) });
}
