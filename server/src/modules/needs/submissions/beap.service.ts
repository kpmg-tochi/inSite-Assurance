import { Prisma } from '@prisma/client';
import {
  PROCUREMENT_METHOD_LABELS,
  formatProjectCode,
  type BeapItemReviewRequest,
  type CycleDocumentKind,
  type NeedsApprovalActionRequest,
  type NeedsCycleDocumentDto,
  type NeedsDocumentPresignRequest,
  type NeedsPresignedUploadDto,
  type NeedsSubmissionDto,
  type ProcurementMethod,
  type RecordCounterpartRequest,
  type RegisterCycleDocumentRequest,
  type SaveBeapRequest,
} from '@insite/shared';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../middleware/error.middleware';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import { recordAuditEvent } from '../../audit/audit.service';
import { tenantTolerancePct } from '../../approvedLists/approvedLists.service';
import { defaultApprovedListTitle } from '../../approvedLists/approvedListWorkbook';
import { convertProposalToProject } from '../conversion/convertProposal';
import { loadVisibleCycle, loadWritableCycle, webActor, type CycleRow, type Db } from '../needsAccess';
import { presignNeedsDocument, registerCycleDocument } from '../needsCycles.service';
import { tenantToday } from '../needsSupport';
import { lockCycle } from '../needsVersions';
import {
  AT_FUNDING_WHERE,
  approvedAmountOf,
  assertFundingGate,
  assertNoApprovedList,
  assertOwningOrganisation,
  auditRowLinkInTx,
  cycleDocumentOfKind,
  lockApprovedLists,
  proposalListFacts,
  recordFundingDecisionInTx,
  writeApprovedListInTx,
  type FundingDecisionItem,
} from '../funding/fundingSupport';
import {
  SUBMISSION_INCLUDE,
  actOnSubmissionInTx,
  createSubmissionInTx,
  gateForSubmission,
  lockSubmission,
  replaceItemsInTx,
  serializeSubmission,
  submitInTx,
  type ActContext,
} from './submissions.service';

/**
 * Needs pipeline wave 4, Track B (B4): the State's BEAP (Matching Grants, plan 4.2 step 6 and section 9).
 * The SUBEB (`needs:prepare_beap`, the cycle's owning organisation) builds it from the proposals at
 * Funding: per proposal included or excluded (with a reason), lot title, procurement method and planned
 * dates; the narrative (cycle document BEAP); the declared counterpart and its evidence (A5). It runs on
 * the cycle's BEAP chain (UBEC Physical Planning review, UBEC Executive Management approval; both
 * `ANY` steps, which on a State cycle need an organisation outside the SUBEB, `gateForSubmission`).
 *
 * - One BEAP per cycle in practice: `PUT` edits the latest while DRAFT or RETURNED, else creates one.
 *   Edits keep each remaining item's UBEC review (outcome and comment) so the SUBEB revises against it
 *   and the reviewer sees what was said; the reviewer overwrites them on the next pass (decision B-9).
 * - Submit (DRAFT or RETURNED → IN_REVIEW): every proposal at Funding listed, at least one included,
 *   each included item with a lot title, a procurement method and both dates, the narrative (422
 *   NEEDS_BEAP_INCOMPLETE with `details.problems`); a State BEAP list of that year already in Approved
 *   lists refuses it (409 NEEDS_APPROVED_LIST_EXISTS).
 * - Review per item by the person the current step admits (`gateForSubmission`), while IN_REVIEW.
 * - Approval of the last step: the BEAP's approved list (MG_BEAP, the cycle's year and State) is written
 *   and each included proposal converts in item order with its lot: the first item of a lot title opens
 *   a new lot, the next ones take batches of it (D-N.15); amount = the item's; owner = the SUBEB (the
 *   conversion's rule for State cycles); the item keeps its lot and batch numbers. Excluded items close
 *   NOT_SELECTED. One FUNDING stage decision. Exclusions are not made at approval (422): the reviewer
 *   asks for removal and returns the BEAP.
 * - Counterpart (A5): recorded by the SUBEB in any status (also after approval); the evidence must be a
 *   cycle document of kind COUNTERPART_EVIDENCE. Activation of the converted projects waits for it when
 *   the cycle's config requires it (`assertActivationOrigin`).
 */

type Tx = Prisma.TransactionClient;

const BEAP_NOT_FOUND = () => new AppError('This cycle has no BEAP yet', 404, 'NEEDS_BEAP_NOT_FOUND');
const EDITABLE = new Set(['DRAFT', 'RETURNED']);

async function latestBeap(db: Db, cycleId: string) {
  return db.needsSubmission.findFirst({ where: { cycleId, kind: 'BEAP' }, orderBy: { createdAt: 'desc' }, include: { ...SUBMISSION_INCLUDE, cycle: true } });
}

async function dto(user: WebJwtPayload, submissionId: string): Promise<NeedsSubmissionDto> {
  const row = await prisma.needsSubmission.findUniqueOrThrow({ where: { id: submissionId }, include: { ...SUBMISSION_INCLUDE, cycle: true } });
  return serializeSubmission(prisma, user, row);
}

/** `GET /cycles/:cycleId/beap`: the latest BEAP, or null. */
export async function getBeap(user: WebJwtPayload, cycleId: string): Promise<NeedsSubmissionDto | null> {
  const cycle = await loadVisibleCycle(user, cycleId);
  const row = await latestBeap(prisma, cycle.id);
  return row ? serializeSubmission(prisma, user, row) : null;
}

async function assertDocuments(tx: Tx, cycleId: string, input: { narrativeDocumentId?: string | null; counterpartEvidenceDocumentId?: string | null }) {
  if (input.narrativeDocumentId) await cycleDocumentOfKind(tx, cycleId, input.narrativeDocumentId, ['BEAP'], 'BEAP narrative');
  if (input.counterpartEvidenceDocumentId) await cycleDocumentOfKind(tx, cycleId, input.counterpartEvidenceDocumentId, ['COUNTERPART_EVIDENCE'], 'counterpart evidence');
}

/** `PUT /cycles/:cycleId/beap` */
export async function saveBeap(user: WebJwtPayload, cycleId: string, input: SaveBeapRequest): Promise<NeedsSubmissionDto> {
  const cycle = await loadWritableCycle(user, cycleId);
  assertFundingGate(cycle, 'BEAP_APPROVAL');
  const ids = input.items.map((i) => i.proposalId);
  if (new Set(ids).size !== ids.length) throw new AppError('A proposed project is listed twice', 422, 'NEEDS_BEAP_INVALID');

  const id = await prisma.$transaction(
    async (tx) => {
      await lockCycle(tx, cycle.id);
      const current = await latestBeap(tx, cycle.id);
      if (current) await lockSubmission(tx, current.id);
      const fresh = current ? await tx.needsSubmission.findUniqueOrThrow({ where: { id: current.id }, include: { items: true } }) : null;
      if (fresh && !EDITABLE.has(fresh.status)) {
        throw new AppError(`The BEAP is ${fresh.status === 'APPROVED' ? 'approved' : 'in review'} and cannot be changed`, 409, 'NEEDS_SUBMISSION_NOT_EDITABLE');
      }
      const proposals = await tx.needsProposal.findMany({ where: { id: { in: ids }, cycleId: cycle.id }, select: { id: true, reference: true, stage: true, status: true, route: true, approvedAmountNgn: true, costedAmountNgn: true } });
      const byId = new Map(proposals.map((p) => [p.id, p]));
      for (const pid of ids) {
        const p = byId.get(pid);
        if (!p) throw new AppError('Proposed project not found in this cycle', 404, 'NEEDS_PROPOSAL_NOT_FOUND', { proposalId: pid });
        if (p.stage !== 'FUNDING' || p.status !== 'IN_PROGRESS' || p.route !== 'ANNUAL') {
          throw new AppError(`${p.reference} is not an approved proposed project waiting at Funding`, 409, 'NEEDS_PROPOSAL_NOT_AT_FUNDING', { proposalId: pid });
        }
      }
      await assertDocuments(tx, cycle.id, input);

      const previous = new Map((fresh?.items ?? []).map((i) => [i.proposalId, i]));
      const items = input.items.map((i) => ({
        proposalId: i.proposalId,
        included: i.included,
        exclusionReason: i.exclusionReason,
        // A BEAP revision may have changed the amount: an item keeps its own; a new item takes the approved amount.
        amountNgn: previous.get(i.proposalId)?.amountNgn !== null && previous.get(i.proposalId)?.amountNgn !== undefined ? Number(previous.get(i.proposalId)!.amountNgn) : approvedAmountOf(byId.get(i.proposalId)!),
        lotTitle: i.lotTitle,
        procurementMethod: i.procurementMethod,
        plannedStartDate: i.plannedStartDate,
        plannedEndDate: i.plannedEndDate,
      }));
      const counterpartRecorded = input.counterpartEvidenceDocumentId
        ? { counterpartRecordedAt: new Date(), counterpartRecordedByUserId: user.userId, counterpartRecordedByName: user.fullName }
        : { counterpartRecordedAt: null, counterpartRecordedByUserId: null, counterpartRecordedByName: null };
      const included = items.filter((i) => i.included).length;

      if (!fresh) {
        const created = await createSubmissionInTx(tx, {
          user,
          cycle,
          kind: 'BEAP',
          items,
          submit: false,
          extra: {
            narrativeDocumentId: input.narrativeDocumentId,
            counterpartDeclaredNgn: input.counterpartDeclaredNgn,
            counterpartEvidenceDocumentId: input.counterpartEvidenceDocumentId,
          },
          summary: `Started the ${cycle.interventionYear} BEAP (draft): ${included} of ${items.length} proposed project(s) included.`,
        });
        if (input.counterpartEvidenceDocumentId) await tx.needsSubmission.update({ where: { id: created.submissionId }, data: counterpartRecorded });
        return created.submissionId;
      }

      const sameEvidence = fresh.counterpartEvidenceDocumentId === input.counterpartEvidenceDocumentId;
      await tx.needsSubmission.update({
        where: { id: fresh.id },
        data: {
          narrativeDocumentId: input.narrativeDocumentId,
          counterpartDeclaredNgn: input.counterpartDeclaredNgn,
          counterpartEvidenceDocumentId: input.counterpartEvidenceDocumentId,
          ...(sameEvidence ? {} : counterpartRecorded),
        },
      });
      await replaceItemsInTx(tx, fresh.id, items);
      for (const prev of fresh.items) {
        if (prev.reviewOutcome === null && prev.reviewComment === null) continue;
        await tx.needsSubmissionItem.updateMany({ where: { submissionId: fresh.id, proposalId: prev.proposalId }, data: { reviewOutcome: prev.reviewOutcome, reviewComment: prev.reviewComment } });
      }
      await recordAuditEvent(tx, {
        tenantId: user.tenantId,
        projectId: null,
        ...webActor(user),
        action: 'NEEDS_SUBMISSION_UPDATED',
        summaryText: `Edited the ${cycle.interventionYear} BEAP (${fresh.status === 'RETURNED' ? 'returned' : 'draft'}): ${included} of ${items.length} proposed project(s) included.`,
        payload: { cycleId: cycle.id, submissionId: fresh.id, kind: 'BEAP', proposalIds: ids, included: items.filter((i) => i.included).map((i) => i.proposalId) },
      });
      return fresh.id;
    },
    { timeout: 30_000 }
  );
  return dto(user, id);
}

interface BeapProblem {
  proposalId: string | null;
  reference: string | null;
  field: string;
  message: string;
}

/** What the BEAP still lacks before it can be submitted. */
async function beapProblems(tx: Tx, cycle: CycleRow, submission: { narrativeDocumentId: string | null; items: Array<Prisma.NeedsSubmissionItemGetPayload<{ include: { proposal: { select: { reference: true; stage: true; status: true } } } }>> }): Promise<BeapProblem[]> {
  const problems: BeapProblem[] = [];
  const listed = new Set(submission.items.map((i) => i.proposalId));
  const waiting = await tx.needsProposal.findMany({ where: { cycleId: cycle.id, ...AT_FUNDING_WHERE }, select: { id: true, reference: true } });
  for (const p of waiting) {
    if (!listed.has(p.id)) problems.push({ proposalId: p.id, reference: p.reference, field: 'items', message: `${p.reference} is approved and waiting at Funding: include it or exclude it with a reason.` });
  }
  for (const i of submission.items) {
    const ref = i.proposal.reference;
    if (i.proposal.stage !== 'FUNDING' || i.proposal.status !== 'IN_PROGRESS') {
      problems.push({ proposalId: i.proposalId, reference: ref, field: 'items', message: `${ref} is no longer waiting at Funding: remove it.` });
      continue;
    }
    if (!i.included) continue;
    if (!i.lotTitle) problems.push({ proposalId: i.proposalId, reference: ref, field: 'lotTitle', message: `${ref}: give the lot it is procured in.` });
    if (!i.procurementMethod) problems.push({ proposalId: i.proposalId, reference: ref, field: 'procurementMethod', message: `${ref}: choose the procurement method.` });
    if (!i.plannedStartDate || !i.plannedEndDate) problems.push({ proposalId: i.proposalId, reference: ref, field: 'plannedDates', message: `${ref}: give the planned start and end dates.` });
    if (!(Number(i.amountNgn ?? 0) > 0)) problems.push({ proposalId: i.proposalId, reference: ref, field: 'amountNgn', message: `${ref} has no amount.` });
  }
  if (!submission.items.some((i) => i.included)) problems.push({ proposalId: null, reference: null, field: 'items', message: 'Include at least one proposed project.' });
  if (!submission.narrativeDocumentId) problems.push({ proposalId: null, reference: null, field: 'narrativeDocumentId', message: 'Attach the BEAP narrative.' });
  return problems;
}

/** `POST /cycles/:cycleId/beap/submit` */
export async function submitBeap(user: WebJwtPayload, cycleId: string): Promise<NeedsSubmissionDto> {
  const cycle = await loadWritableCycle(user, cycleId);
  assertFundingGate(cycle, 'BEAP_APPROVAL');
  const id = await prisma.$transaction(
    async (tx) => {
      await lockApprovedLists(tx, user.tenantId);
      await lockCycle(tx, cycle.id);
      const current = await latestBeap(tx, cycle.id);
      if (!current) throw BEAP_NOT_FOUND();
      await lockSubmission(tx, current.id);
      const s = await tx.needsSubmission.findUniqueOrThrow({
        where: { id: current.id },
        include: { items: { orderBy: { sortOrder: 'asc' }, include: { proposal: { select: { reference: true, stage: true, status: true } } } } },
      });
      if (!EDITABLE.has(s.status)) throw new AppError(`The BEAP is ${s.status === 'APPROVED' ? 'approved' : 'in review'} already`, 409, 'NEEDS_SUBMISSION_NOT_EDITABLE');
      const problems = await beapProblems(tx, cycle, s);
      if (problems.length) throw new AppError(`The BEAP is not complete: ${problems[0].message}`, 422, 'NEEDS_BEAP_INCOMPLETE', { problems });
      await assertNoApprovedList(tx, user.tenantId, 'MG_BEAP', cycle.interventionYear, cycle.stateCode);
      const included = s.items.filter((i) => i.included).length;
      const { completedWithoutSteps } = await submitInTx(
        tx,
        user,
        s.id,
        `${s.status === 'RETURNED' ? 'Resubmitted' : 'Submitted'} the ${cycle.interventionYear} BEAP to UBEC: ${included} proposed project(s), NGN ${s.items
          .filter((i) => i.included)
          .reduce((sum, i) => sum + Number(i.amountNgn ?? 0), 0)
          .toLocaleString('en-NG')}.`
      );
      // A chain without steps approves at once (the type has no BEAP steps): run the gate's effect.
      if (completedWithoutSteps) await applyBeapApprovalInTx(tx, user, cycle, s.id);
      return s.id;
    },
    { timeout: 120_000, maxWait: 15_000 }
  );
  return dto(user, id);
}

/** `POST /cycles/:cycleId/beap/review-items` */
export async function reviewBeapItems(user: WebJwtPayload, cycleId: string, input: BeapItemReviewRequest): Promise<NeedsSubmissionDto> {
  const cycle = await loadVisibleCycle(user, cycleId);
  assertFundingGate(cycle, 'BEAP_APPROVAL');
  const ids = input.items.map((i) => i.proposalId);
  if (new Set(ids).size !== ids.length) throw new AppError('A proposed project is listed twice', 422, 'NEEDS_BEAP_INVALID');
  const id = await prisma.$transaction(async (tx) => {
    const current = await latestBeap(tx, cycle.id);
    if (!current) throw BEAP_NOT_FOUND();
    await lockSubmission(tx, current.id);
    const s = await tx.needsSubmission.findUniqueOrThrow({ where: { id: current.id }, include: { ...SUBMISSION_INCLUDE, cycle: true } });
    const gate = await gateForSubmission(tx, user, s, s.cycle);
    if (!gate.allowed) throw new AppError(gate.reason ?? 'You cannot review this BEAP now', gate.status, gate.code ?? 'NOT_STEP_APPROVER');
    const onBeap = new Map(s.items.map((i) => [i.proposalId, i]));
    for (const item of input.items) {
      if (!onBeap.has(item.proposalId)) throw new AppError('Proposed project not on this BEAP', 404, 'NEEDS_PROPOSAL_NOT_FOUND', { proposalId: item.proposalId });
      await tx.needsSubmissionItem.updateMany({
        where: { submissionId: s.id, proposalId: item.proposalId },
        data: { reviewOutcome: item.outcome, reviewComment: item.outcome === 'ACCEPTED' ? (item.comment ?? null) : item.comment },
      });
    }
    const words = input.items.map((i) => `${onBeap.get(i.proposalId)!.proposal.reference} ${i.outcome === 'ACCEPTED' ? 'accepted' : i.outcome === 'COMMENTED' ? 'commented' : 'removal requested'}`);
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_SUBMISSION_UPDATED',
      summaryText: `Reviewed the ${cycle.interventionYear} BEAP: ${words.join('; ')}.`,
      payload: { cycleId: cycle.id, submissionId: s.id, kind: 'BEAP', review: input.items, stepOrder: s.currentStepOrder, proposalIds: ids },
    });
    return s.id;
  });
  return dto(user, id);
}

/** `POST /cycles/:cycleId/beap/actions` */
export async function actOnBeap(user: WebJwtPayload, cycleId: string, request: NeedsApprovalActionRequest): Promise<NeedsSubmissionDto> {
  const cycle = await loadVisibleCycle(user, cycleId);
  assertFundingGate(cycle, 'BEAP_APPROVAL');
  if (request.exclusions.length) {
    throw new AppError('A BEAP is not changed at approval: ask for the removal on the item and return the BEAP.', 422, 'NEEDS_BEAP_EXCLUSIONS_NOT_ALLOWED');
  }
  const current = await latestBeap(prisma, cycle.id);
  if (!current) throw BEAP_NOT_FOUND();
  await prisma.$transaction(
    async (tx) => {
      await lockApprovedLists(tx, user.tenantId);
      await lockCycle(tx, cycle.id);
      await actOnSubmissionInTx(tx, user, current.id, request, {
        beforeAct: async (t, ctx) => {
          if (ctx.request.decision !== 'APPROVE' || !ctx.isLastStep) return;
          await assertNoApprovedList(t, user.tenantId, 'MG_BEAP', ctx.cycle.interventionYear, ctx.cycle.stateCode);
          const stale = ctx.submission.items.filter((i) => i.included).map((i) => i.proposalId);
          const moved = await t.needsProposal.findMany({ where: { id: { in: stale }, NOT: AT_FUNDING_WHERE }, select: { reference: true } });
          if (moved.length) {
            throw new AppError(`${moved.map((m) => m.reference).join(', ')} no longer wait at Funding: return the BEAP.`, 409, 'NEEDS_PROPOSAL_NOT_AT_FUNDING');
          }
        },
        onApproved: async (t, ctx: ActContext) => applyBeapApprovalInTx(t, user, ctx.cycle, ctx.submission.id),
        summary: (ctx, outcome) =>
          `${ctx.step.label}: ${outcome === 'RETURNED' ? 'returned the BEAP to the SUBEB' : outcome === 'APPROVED' ? 'approved the BEAP: its proposed projects are now draft projects' : 'approved the BEAP'}${ctx.request.notes ? `: ${ctx.request.notes}` : ''}.`,
      });
    },
    { timeout: 120_000, maxWait: 15_000 }
  );
  return dto(user, current.id);
}

/**
 * The BEAP gate's effect (last approval, same transaction; the caller holds the approved-list and cycle
 * locks): the MG_BEAP approved list, one conversion per included item with its lot, NOT_SELECTED for the
 * excluded ones, one FUNDING stage decision and the ledger.
 */
async function applyBeapApprovalInTx(tx: Tx, user: WebJwtPayload, cycle: CycleRow, submissionId: string): Promise<void> {
  const s = await tx.needsSubmission.findUniqueOrThrow({
    where: { id: submissionId },
    include: { items: { orderBy: { sortOrder: 'asc' }, include: { proposal: { select: { id: true, reference: true, title: true, stateCode: true, lgaCodes: true, currentVersionId: true } } } } },
  });
  const included = s.items.filter((i) => i.included);
  const facts = await proposalListFacts(tx, user.tenantId, included.map((i) => i.proposalId));
  const stateCode = cycle.stateCode;
  const list = await writeApprovedListInTx(tx, {
    user,
    kind: 'MG_BEAP',
    interventionYear: cycle.interventionYear,
    stateCode,
    title: defaultApprovedListTitle('MG_BEAP', cycle.interventionYear, stateCode),
    approvedBy: user.fullName,
    approvedOn: await tenantToday(user.tenantId),
    documentId: s.narrativeDocumentId,
    sourceFileName: null,
    sourceSha256: null,
    rows: included.map((i) => ({
      rowRef: i.proposal.reference,
      projectTitle: i.proposal.title,
      schoolNames: facts.get(i.proposalId)?.schoolNames ?? [],
      stateCode: i.proposal.stateCode ?? stateCode ?? '',
      lgaCodes: i.proposal.lgaCodes,
      facilityScope: facts.get(i.proposalId)?.facilityScope ?? null,
      costEstimateNgn: Number(i.amountNgn ?? 0),
      lotTitle: i.lotTitle,
    })),
  });
  const tolerance = await tenantTolerancePct(user.tenantId);
  const lotByTitle = new Map<string, string>();
  const decisionItems: FundingDecisionItem[] = [];
  const converted: Array<{ reference: string; code: string }> = [];
  for (const [index, item] of included.entries()) {
    const key = (item.lotTitle ?? '').trim().toLowerCase();
    const lotId = lotByTitle.get(key);
    const made = await convertProposalToProject(tx, item.proposal, {
      fundedAmountNgn: Number(item.amountNgn ?? 0),
      lot: lotId ? { lotId } : { newLotTitle: item.lotTitle!.trim() },
      by: user,
      approvedListRowId: list.rowIds[index],
    });
    const project = await tx.project.findUniqueOrThrow({ where: { id: made.projectId }, select: { lotId: true, batchNumber: true, lot: { select: { number: true } } } });
    if (!lotId && project.lotId) lotByTitle.set(key, project.lotId);
    await tx.needsSubmissionItem.update({ where: { id: item.id }, data: { lotNumber: project.lot?.number ?? null, batchNumber: project.batchNumber } });
    await auditRowLinkInTx(tx, {
      user,
      projectId: made.projectId,
      listId: list.listId,
      listTitle: list.title,
      kind: 'MG_BEAP',
      rowId: list.rowIds[index],
      rowRef: item.proposal.reference,
      estimateNgn: Number(item.amountNgn ?? 0),
      previousRow: null,
      tolerancePct: tolerance,
    });
    const method = item.procurementMethod ? PROCUREMENT_METHOD_LABELS[item.procurementMethod as ProcurementMethod] : null;
    decisionItems.push({ proposal: item.proposal, outcome: 'ADVANCE', reason: method ? `Approved in the BEAP (${method})` : 'Approved in the BEAP', toStatus: 'CONVERTED' });
    converted.push({ reference: item.proposal.reference, code: formatProjectCode(made.codePrefix) });
  }
  for (const item of s.items.filter((i) => !i.included)) {
    decisionItems.push({ proposal: item.proposal, outcome: 'NOT_SELECTED', reason: `Excluded from the BEAP: ${item.exclusionReason ?? 'no reason given'}`, toStatus: 'NOT_SELECTED' });
  }
  await recordFundingDecisionInTx(tx, {
    user,
    cycle,
    reason: `BEAP approved (${included.length} proposed project(s)).`,
    evidenceDocumentIds: s.narrativeDocumentId ? [s.narrativeDocumentId] : [],
    items: decisionItems,
  });
  await recordAuditEvent(tx, {
    tenantId: user.tenantId,
    projectId: null,
    ...webActor(user),
    action: 'APPROVED_LIST_IMPORTED',
    summaryText: `Wrote ${list.title} from the approved BEAP: ${included.length} row(s), each linked to its project (${converted.map((c) => `${c.reference} → ${c.code}`).join(', ')}).`,
    payload: {
      listId: list.listId,
      created: true,
      interventionYear: cycle.interventionYear,
      kind: 'MG_BEAP',
      stateCode,
      title: list.title,
      fileName: null,
      sha256: null,
      source: 'NEEDS_FUNDING',
      cycleId: cycle.id,
      submissionId,
      proposalIds: s.items.map((i) => i.proposalId),
    },
  });
}

/** `PUT /cycles/:cycleId/beap/counterpart` (any status, also after approval; the cycle may be closed). */
export async function recordCounterpart(user: WebJwtPayload, cycleId: string, input: RecordCounterpartRequest): Promise<NeedsSubmissionDto> {
  const cycle = await loadVisibleCycle(user, cycleId);
  assertOwningOrganisation(user, cycle);
  assertFundingGate(cycle, 'BEAP_APPROVAL');
  const id = await prisma.$transaction(async (tx) => {
    const current = await latestBeap(tx, cycle.id);
    if (!current) throw BEAP_NOT_FOUND();
    await lockSubmission(tx, current.id);
    await cycleDocumentOfKind(tx, cycle.id, input.counterpartEvidenceDocumentId, ['COUNTERPART_EVIDENCE'], 'counterpart evidence');
    await tx.needsSubmission.update({
      where: { id: current.id },
      data: {
        counterpartDeclaredNgn: input.counterpartDeclaredNgn,
        counterpartEvidenceDocumentId: input.counterpartEvidenceDocumentId,
        counterpartRecordedAt: new Date(),
        counterpartRecordedByUserId: user.userId,
        counterpartRecordedByName: user.fullName,
      },
    });
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_COUNTERPART_RECORDED',
      summaryText: `Recorded the State's counterpart funding on the ${cycle.interventionYear} BEAP: NGN ${input.counterpartDeclaredNgn.toLocaleString('en-NG')}, evidence filed.`,
      payload: {
        cycleId: cycle.id,
        submissionId: current.id,
        status: current.status,
        counterpartDeclaredNgn: input.counterpartDeclaredNgn,
        counterpartEvidenceDocumentId: input.counterpartEvidenceDocumentId,
        proposalIds: current.items.map((i) => i.proposalId),
      },
    });
    return current.id;
  });
  return dto(user, id);
}

const BEAP_DOCUMENT_KINDS: readonly CycleDocumentKind[] = ['BEAP', 'COUNTERPART_EVIDENCE'];

/**
 * Wave 4 (review fix): the counterpart evidence may be filed after the cycle closed (the converted
 * projects cannot be activated without it, A5); the presign cannot tell the kind, so on a closed
 * cycle it is allowed for the owner and `registerBeapDocument` accepts only COUNTERPART_EVIDENCE there.
 */
export async function presignBeapDocument(user: WebJwtPayload, cycleId: string, input: NeedsDocumentPresignRequest): Promise<NeedsPresignedUploadDto> {
  const cycle = await loadVisibleCycle(user, cycleId);
  assertFundingGate(cycle, 'BEAP_APPROVAL');
  return presignNeedsDocument(user, cycleId, input, { allowClosed: cycle.status === 'CLOSED' });
}

export async function registerBeapDocument(user: WebJwtPayload, cycleId: string, input: RegisterCycleDocumentRequest): Promise<NeedsCycleDocumentDto> {
  if (!BEAP_DOCUMENT_KINDS.includes(input.kind)) throw new AppError('Only the BEAP narrative and counterpart evidence are filed here', 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');
  const cycle = await loadVisibleCycle(user, cycleId);
  assertFundingGate(cycle, 'BEAP_APPROVAL');
  return registerCycleDocument(user, cycleId, input, { allowClosed: input.kind === 'COUNTERPART_EVIDENCE' });
}

// ---------------------------------------------------------------------------
// B4 revision (needsUpload.service.ts): a new needs assessment version while the BEAP is open
// ---------------------------------------------------------------------------

/**
 * Whether a new version of a proposal at Funding is a BEAP revision `user` may upload now: the cycle
 * funds through the BEAP, the proposal waits at Funding, the user holds `needs:prepare_beap`, and the
 * cycle's latest BEAP is DRAFT or RETURNED (or not started). Returns null when the rule does not apply.
 */
export async function beapRevisionPermit(
  db: Db,
  user: WebJwtPayload,
  cycle: Pick<CycleRow, 'id' | 'configSnapshotJson'>,
  proposal: { stage: string; status: string; route: string; reference: string }
): Promise<{ ok: true } | { ok: false; reason: string } | null> {
  if (proposal.stage !== 'FUNDING' || proposal.status !== 'IN_PROGRESS' || proposal.route !== 'ANNUAL') return null;
  try {
    assertFundingGate(cycle, 'BEAP_APPROVAL');
  } catch {
    return null;
  }
  if (!(user.isPlatformSuperAdmin || user.permissions.includes('needs:prepare_beap'))) {
    return { ok: false, reason: `${proposal.reference} is in the BEAP: only the SUBEB's BEAP preparer uploads a revision.` };
  }
  const beap = await db.needsSubmission.findFirst({ where: { cycleId: cycle.id, kind: 'BEAP' }, orderBy: { createdAt: 'desc' }, select: { status: true } });
  if (beap && !EDITABLE.has(beap.status)) {
    return { ok: false, reason: `${proposal.reference}: the BEAP is ${beap.status === 'APPROVED' ? 'approved' : 'with UBEC for review'}; a revision is uploaded while it is a draft or returned.` };
  }
  return { ok: true };
}

/** After a BEAP revision is written: the proposal's costed amount and the BEAP item's amount follow the new costed total. */
export async function applyBeapRevisionInTx(tx: Tx, cycleId: string, proposalId: string, costedTotalNgn: number | null): Promise<void> {
  if (costedTotalNgn === null) return;
  await tx.needsProposal.update({ where: { id: proposalId }, data: { costedAmountNgn: costedTotalNgn } });
  const beap = await tx.needsSubmission.findFirst({ where: { cycleId, kind: 'BEAP', status: { in: [...EDITABLE] } }, orderBy: { createdAt: 'desc' }, select: { id: true } });
  if (beap) await tx.needsSubmissionItem.updateMany({ where: { submissionId: beap.id, proposalId }, data: { amountNgn: costedTotalNgn } });
}
