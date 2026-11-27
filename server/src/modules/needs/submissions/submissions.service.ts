import { Prisma } from '@prisma/client';
import {
  NEEDS_CHAIN_FOR_SUBMISSION,
  NEEDS_SEPARATION_ERROR_MESSAGES,
  NEEDS_SUBMISSION_STATUS_LABELS,
  NeedsSubmissionStatusEnum,
  ProcurementMethodEnum,
  BeapReviewOutcomeEnum,
  formatProjectCode,
  separationViolation,
  type NeedsApprovalActionRequest,
  type NeedsChainType,
  type NeedsSubmissionDto,
  type NeedsSubmissionItemDto,
  type NeedsSubmissionKind,
  type NeedsSubmissionStatus,
} from '@insite/shared';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../middleware/error.middleware';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import { recordAuditEvent } from '../../audit/audit.service';
import { organizationAncestorIds } from '../../organizations/hierarchy';
import { gateForStep, holdsStep, type ProjectOrgContext } from '../../process/approvalChain';
import { visibleCycleWhere, webActor, type CycleRow, type Db } from '../needsAccess';
import { dec } from '../needsSupport';

/**
 * Needs pipeline wave 4 (main thread): the shared base for the cycle approval chains (D-N.11, D-N.23).
 * A submission (`NeedsSubmission`) is a list put to a chain: the portfolio (NEEDS_PORTFOLIO), a BEAP
 * (BEAP) or one out-of-cycle request (OUT_OF_CYCLE). Track A (portfolio, out-of-cycle) and Track B
 * (BEAP) build their own routes and effects on these functions; nothing here knows what an approval
 * does: the caller's `onApproved` hook runs in the same transaction as the last approval.
 *
 * Rules (plan section 7, wave 4 decisions):
 * - the steps are the cycle's `NeedsApprovalStep` rows of the submission's chain and `chainVersion`
 *   (copied from the type config when the cycle opened), in step order;
 * - acting needs the step's permission (403 NOT_STEP_APPROVER), then separation of duties: not the
 *   submitter, and not someone who approved another step of this pass (409 SAME_PERSON_APPROVAL; a
 *   return counts as acting), then the step's organisation scope against the cycle's owning
 *   organisation (403 NOT_STEP_ORGANIZATION; no bypass, not even for the platform super admin);
 * - on a State cycle (Matching Grants), an `ANY` step of the BEAP or OUT_OF_CYCLE chain is UBEC's: it
 *   needs an organisation outside the cycle owner's subtree (403 NOT_STEP_ORGANIZATION, plan section 7);
 * - APPROVE moves to the next step, or completes (APPROVED, `currentStepOrder` null, `decidedAt`) and
 *   runs `onApproved`; RETURN sets RETURNED and `currentStepOrder` 0 (the submitter edits and resubmits:
 *   a new pass, earlier approvals no longer count);
 * - ledger: tenant ledger, `cycleId`, `submissionId` and `proposalIds` in the payload (the proposal
 *   history reads `proposalIds`).
 */

type Tx = Prisma.TransactionClient;

export const SUBMISSION_INCLUDE = {
  items: {
    orderBy: { sortOrder: 'asc' },
    include: {
      proposal: {
        select: {
          id: true,
          reference: true,
          title: true,
          stateCode: true,
          lgaCodes: true,
          rank: true,
          aboveLine: true,
          costedAmountNgn: true,
          currentVersion: { select: { number: true, siteCount: true } },
          project: { select: { id: true, codePrefix: true, lotId: true, batchNumber: true, lot: { select: { number: true } } } },
        },
      },
    },
  },
  actions: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { fullName: true } }, step: { select: { label: true } } } },
} satisfies Prisma.NeedsSubmissionInclude;

export type SubmissionRow = Prisma.NeedsSubmissionGetPayload<{ include: typeof SUBMISSION_INCLUDE }>;
export type ChainStepRow = Prisma.NeedsApprovalStepGetPayload<object>;

export const SUBMISSION_NOT_FOUND = () => new AppError('Submission not found', 404, 'NEEDS_SUBMISSION_NOT_FOUND');

/** Locks the submission row for the rest of the transaction. */
export async function lockSubmission(tx: Tx, submissionId: string): Promise<void> {
  await tx.$queryRaw`SELECT id FROM needs_submissions WHERE id = ${submissionId}::uuid FOR UPDATE`;
}

/** The cycle's owning organisation as the org context of its chains (plan 17.2). */
export async function cycleOrgContext(db: Db, cycle: Pick<CycleRow, 'owningOrganizationId'>): Promise<ProjectOrgContext> {
  return {
    owningOrganizationId: cycle.owningOrganizationId,
    ownerAncestorIds: await organizationAncestorIds(cycle.owningOrganizationId, db),
    funderOrganizationId: null,
  };
}

/** The latest chain version copied onto the cycle (1 until a later wave edits chains). */
export async function latestChainVersion(db: Db, cycleId: string, chainType: NeedsChainType): Promise<number> {
  const row = await db.needsApprovalStep.findFirst({ where: { cycleId, chainType }, orderBy: { version: 'desc' }, select: { version: true } });
  return row?.version ?? 1;
}

/** The active steps of a chain version, in order. */
export async function chainSteps(db: Db, cycleId: string, chainType: NeedsChainType, version: number): Promise<ChainStepRow[]> {
  return db.needsApprovalStep.findMany({ where: { cycleId, chainType, version, isActive: true }, orderBy: { stepOrder: 'asc' } });
}

/** A submission of a cycle the user can see, else 404 NEEDS_SUBMISSION_NOT_FOUND. */
export async function loadVisibleSubmission(user: WebJwtPayload, submissionId: string, db: Db = prisma): Promise<SubmissionRow & { cycle: CycleRow }> {
  const row = await db.needsSubmission.findFirst({
    where: { id: submissionId, cycle: visibleCycleWhere(user) },
    include: { ...SUBMISSION_INCLUDE, cycle: true },
  });
  if (!row) throw SUBMISSION_NOT_FOUND();
  return row;
}

export interface NewSubmissionItem {
  proposalId: string;
  included: boolean;
  exclusionReason?: string | null;
  amountNgn?: number | null;
  lotTitle?: string | null;
  procurementMethod?: string | null;
  plannedStartDate?: string | null;
  plannedEndDate?: string | null;
}

/** Replaces the items (draft or returned submissions; the review fields are cleared). */
export async function replaceItemsInTx(tx: Tx, submissionId: string, items: NewSubmissionItem[]): Promise<void> {
  await tx.needsSubmissionItem.deleteMany({ where: { submissionId } });
  if (!items.length) return;
  await tx.needsSubmissionItem.createMany({
    data: items.map((i, index) => ({
      submissionId,
      proposalId: i.proposalId,
      included: i.included,
      exclusionReason: i.included ? null : (i.exclusionReason ?? null),
      amountNgn: i.amountNgn ?? null,
      lotTitle: i.lotTitle ?? null,
      procurementMethod: i.procurementMethod ?? null,
      plannedStartDate: i.plannedStartDate ?? null,
      plannedEndDate: i.plannedEndDate ?? null,
      sortOrder: index,
    })),
  });
}

/**
 * Creates a submission with its items (DRAFT, or IN_REVIEW at once when `submit` is true), on the
 * cycle's latest chain version; ledger `NEEDS_SUBMISSION_CREATED`. Returns its id and, when submitted,
 * whether the chain had no step (then it is APPROVED already and the caller runs its effect).
 */
export async function createSubmissionInTx(
  tx: Tx,
  params: {
    user: WebJwtPayload;
    cycle: CycleRow;
    kind: NeedsSubmissionKind;
    items: NewSubmissionItem[];
    submit: boolean;
    extra?: Partial<Pick<Prisma.NeedsSubmissionUncheckedCreateInput, 'memoDocumentId' | 'narrativeDocumentId' | 'counterpartDeclaredNgn' | 'counterpartEvidenceDocumentId'>>;
    summary: string;
  }
): Promise<{ submissionId: string; completedWithoutSteps: boolean }> {
  const { user, cycle, kind } = params;
  const chainType = NEEDS_CHAIN_FOR_SUBMISSION[kind];
  const chainVersion = await latestChainVersion(tx, cycle.id, chainType);
  const created = await tx.needsSubmission.create({
    data: {
      cycleId: cycle.id,
      kind,
      status: 'DRAFT',
      chainVersion,
      currentStepOrder: 0,
      createdByUserId: user.userId,
      createdByName: user.fullName,
      ...(params.extra ?? {}),
    },
  });
  await replaceItemsInTx(tx, created.id, params.items);
  await recordAuditEvent(tx, {
    tenantId: user.tenantId,
    projectId: null,
    ...webActor(user),
    action: 'NEEDS_SUBMISSION_CREATED',
    summaryText: params.summary,
    payload: { cycleId: cycle.id, submissionId: created.id, kind, chainType, chainVersion, proposalIds: params.items.map((i) => i.proposalId), included: params.items.filter((i) => i.included).map((i) => i.proposalId) },
  });
  let completedWithoutSteps = false;
  if (params.submit) completedWithoutSteps = (await submitInTx(tx, user, created.id, null)).completedWithoutSteps;
  return { submissionId: created.id, completedWithoutSteps };
}

/**
 * DRAFT or RETURNED → IN_REVIEW at the first step (a new pass); the submitter is recorded. A chain
 * without steps completes at once (APPROVED): the caller runs its effect. `summary` null: no extra
 * ledger entry (creation wrote one); else `NEEDS_SUBMISSION_UPDATED` with `resubmitted: true`.
 */
export async function submitInTx(tx: Tx, user: WebJwtPayload, submissionId: string, summary: string | null): Promise<{ completedWithoutSteps: boolean }> {
  await lockSubmission(tx, submissionId);
  const s = await tx.needsSubmission.findUniqueOrThrow({ where: { id: submissionId }, include: { items: { select: { proposalId: true } } } });
  if (s.status !== 'DRAFT' && s.status !== 'RETURNED') {
    throw new AppError(`This ${s.kind === 'BEAP' ? 'BEAP' : 'submission'} is ${NEEDS_SUBMISSION_STATUS_LABELS[s.status as NeedsSubmissionStatus]?.toLowerCase() ?? s.status}`, 409, 'NEEDS_SUBMISSION_NOT_EDITABLE');
  }
  const steps = await chainSteps(tx, s.cycleId, NEEDS_CHAIN_FOR_SUBMISSION[s.kind as NeedsSubmissionKind], s.chainVersion);
  const now = new Date();
  const first = steps[0] ?? null;
  await tx.needsSubmission.update({
    where: { id: submissionId },
    data: {
      status: first ? 'IN_REVIEW' : 'APPROVED',
      currentStepOrder: first ? first.stepOrder : null,
      submittedByUserId: user.userId,
      submittedByName: user.fullName,
      submittedAt: now,
      decidedAt: first ? null : now,
    },
  });
  if (summary) {
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_SUBMISSION_UPDATED',
      summaryText: summary,
      payload: { cycleId: s.cycleId, submissionId, kind: s.kind, resubmitted: s.status === 'RETURNED', proposalIds: s.items.map((i) => i.proposalId) },
    });
  }
  return { completedWithoutSteps: !first };
}

/** Who approved a step in the current pass (since the last return). */
function passApprovers(actions: Array<{ decision: string; actorUserId: string }>): string[] {
  let start = 0;
  actions.forEach((a, i) => {
    if (a.decision === 'RETURN') start = i + 1;
  });
  return actions.slice(start).filter((a) => a.decision === 'APPROVE').map((a) => a.actorUserId);
}

/** Whether `user`'s organisation is strictly above the cycle owner (an ancestor of it). */
async function aboveOwner(db: Db, user: WebJwtPayload, cycle: Pick<CycleRow, 'owningOrganizationId'>): Promise<boolean> {
  return (await organizationAncestorIds(cycle.owningOrganizationId, db)).includes(user.organizationId);
}

export interface SubmissionGate {
  allowed: boolean;
  /** Null when allowed. */
  reason: string | null;
  status: number;
  code: string | null;
}

const ALLOWED: SubmissionGate = { allowed: true, reason: null, status: 200, code: null };

/**
 * Whether `user` may act on the current step now, with the error the action would answer. Order:
 * permission (403), separation (409 SAME_PERSON_APPROVAL), organisation scope (403), the UBEC rule on
 * State cycles (403).
 */
export async function gateForSubmission(
  db: Db,
  user: WebJwtPayload,
  submission: Pick<SubmissionRow, 'status' | 'kind' | 'cycleId' | 'chainVersion' | 'currentStepOrder' | 'submittedByUserId'> & { actions: Array<{ decision: string; actorUserId: string; stepOrder: number }> },
  cycle: Pick<CycleRow, 'owningOrganizationId' | 'scopeKey'>,
  steps?: ChainStepRow[]
): Promise<SubmissionGate> {
  if (submission.status !== 'IN_REVIEW' || !submission.currentStepOrder) {
    return { allowed: false, reason: 'Nothing is waiting for approval.', status: 409, code: 'NEEDS_SUBMISSION_NOT_IN_REVIEW' };
  }
  const chainType = NEEDS_CHAIN_FOR_SUBMISSION[submission.kind as NeedsSubmissionKind];
  const all = steps ?? (await chainSteps(db, submission.cycleId, chainType, submission.chainVersion));
  const step = all.find((s) => s.stepOrder === submission.currentStepOrder) ?? null;
  if (!step) return { allowed: false, reason: 'Nothing is waiting for approval.', status: 409, code: 'NEEDS_SUBMISSION_NOT_IN_REVIEW' };
  if (!holdsStep(user, { ...step, organizationScope: 'ANY' }, null)) {
    const gate = gateForStep({ webUser: user, step, actions: [], orgContext: null });
    return { allowed: false, reason: gate.reason, status: 403, code: 'NOT_STEP_APPROVER' };
  }
  const violation = separationViolation('APPROVE_STEP', user.userId, {
    submitterUserId: submission.submittedByUserId,
    chainApproverUserIds: passApprovers(submission.actions),
  });
  if (violation) return { allowed: false, reason: NEEDS_SEPARATION_ERROR_MESSAGES[violation], status: 409, code: violation };
  const orgContext = step.organizationScope === 'ANY' ? null : await cycleOrgContext(db, cycle);
  const gate = gateForStep({ webUser: user, step, actions: [], orgContext });
  if (!gate.allowed) return { allowed: false, reason: gate.reason, status: 403, code: 'NOT_STEP_ORGANIZATION' };
  if (cycle.scopeKey !== 'NATIONAL' && step.organizationScope === 'ANY' && (chainType === 'BEAP' || chainType === 'OUT_OF_CYCLE')) {
    // Review fix: UBEC's step needs an organisation above the State's SUBEB (UBEC HQ), not merely
    // outside it (another State's SUBEB must never approve this State's BEAP or request).
    if (!(await aboveOwner(db, user, cycle))) {
      return { allowed: false, reason: `"${step.label}" is UBEC's: it needs an organisation above the State's SUBEB.`, status: 403, code: 'NOT_STEP_ORGANIZATION' };
    }
  }
  return ALLOWED;
}

export interface ActContext {
  user: WebJwtPayload;
  cycle: CycleRow;
  submission: SubmissionRow;
  step: ChainStepRow;
  steps: ChainStepRow[];
  request: NeedsApprovalActionRequest;
  /** True when an APPROVE on this step completes the chain. */
  isLastStep: boolean;
}

export interface ChainHooks {
  /** Validate and write the step's own inputs (exclusions, memo …) before the action is recorded. */
  beforeAct?: (tx: Tx, ctx: ActContext) => Promise<void>;
  /** The chain is complete: the gate's effect (move proposals, convert …), same transaction. */
  onApproved?: (tx: Tx, ctx: ActContext) => Promise<void>;
  /** The submission was returned. */
  onReturned?: (tx: Tx, ctx: ActContext) => Promise<void>;
  /** Ledger sentence; default "<step>: approved/returned <kind>". */
  summary?: (ctx: ActContext, outcome: 'ADVANCED' | 'APPROVED' | 'RETURNED') => string;
}

const KIND_NOUN: Record<NeedsSubmissionKind, string> = { PORTFOLIO: 'the portfolio', BEAP: 'the BEAP', OUT_OF_CYCLE: 'the out-of-cycle request' };

/**
 * Records a decision on the current step (call inside the caller's transaction, after loading the
 * cycle). Throws the gate's error; runs the hooks; returns what happened.
 */
export async function actOnSubmissionInTx(
  tx: Tx,
  user: WebJwtPayload,
  submissionId: string,
  request: NeedsApprovalActionRequest,
  hooks: ChainHooks = {}
): Promise<{ outcome: 'ADVANCED' | 'APPROVED' | 'RETURNED'; nextStepOrder: number | null }> {
  await lockSubmission(tx, submissionId);
  const submission = await tx.needsSubmission.findFirst({ where: { id: submissionId, cycle: { tenantId: user.tenantId } }, include: { ...SUBMISSION_INCLUDE, cycle: true } });
  if (!submission) throw SUBMISSION_NOT_FOUND();
  const { cycle } = submission;
  const chainType = NEEDS_CHAIN_FOR_SUBMISSION[submission.kind as NeedsSubmissionKind];
  const steps = await chainSteps(tx, cycle.id, chainType, submission.chainVersion);
  const gate = await gateForSubmission(tx, user, submission, cycle, steps);
  if (!gate.allowed) throw new AppError(gate.reason ?? 'You cannot act on this step', gate.status, gate.code ?? 'NOT_STEP_APPROVER');
  const step = steps.find((s) => s.stepOrder === submission.currentStepOrder)!;
  const next = steps.find((s) => s.stepOrder > step.stepOrder) ?? null;
  const ctx: ActContext = { user, cycle, submission, step, steps, request, isLastStep: !next };

  if (hooks.beforeAct) await hooks.beforeAct(tx, ctx);
  await tx.needsApprovalAction.create({
    data: {
      cycleId: cycle.id,
      chainType,
      subjectId: submission.id,
      stepId: step.id,
      stepOrder: step.stepOrder,
      decision: request.decision,
      actorUserId: user.userId,
      notes: request.notes ?? null,
    },
  });

  let outcome: 'ADVANCED' | 'APPROVED' | 'RETURNED';
  if (request.decision === 'RETURN') {
    outcome = 'RETURNED';
    await tx.needsSubmission.update({ where: { id: submission.id }, data: { status: 'RETURNED', currentStepOrder: 0 } });
  } else if (next) {
    outcome = 'ADVANCED';
    await tx.needsSubmission.update({ where: { id: submission.id }, data: { currentStepOrder: next.stepOrder } });
  } else {
    outcome = 'APPROVED';
    await tx.needsSubmission.update({ where: { id: submission.id }, data: { status: 'APPROVED', currentStepOrder: null, decidedAt: new Date() } });
  }

  const noun = KIND_NOUN[submission.kind as NeedsSubmissionKind];
  await recordAuditEvent(tx, {
    tenantId: user.tenantId,
    projectId: null,
    ...webActor(user),
    action: 'NEEDS_APPROVAL_ACTION',
    summaryText:
      hooks.summary?.(ctx, outcome) ??
      `${step.label}: ${outcome === 'RETURNED' ? `returned ${noun}` : outcome === 'APPROVED' ? `approved ${noun} (chain complete)` : `approved ${noun}`}${request.notes ? `: ${request.notes}` : ''}.`,
    payload: {
      cycleId: cycle.id,
      submissionId: submission.id,
      kind: submission.kind,
      chainType,
      stepOrder: step.stepOrder,
      stepLabel: step.label,
      decision: request.decision,
      outcome,
      notes: request.notes ?? null,
      exclusions: request.exclusions,
      memoDocumentId: request.memoDocumentId ?? null,
      proposalIds: submission.items.map((i) => i.proposalId),
    },
  });

  if (outcome === 'RETURNED' && hooks.onReturned) await hooks.onReturned(tx, ctx);
  if (outcome === 'APPROVED' && hooks.onApproved) await hooks.onApproved(tx, ctx);
  return { outcome, nextStepOrder: next && outcome === 'ADVANCED' ? next.stepOrder : null };
}

function itemDto(i: SubmissionRow['items'][number]): NeedsSubmissionItemDto {
  const p = i.proposal;
  const method = ProcurementMethodEnum.safeParse(i.procurementMethod);
  const review = BeapReviewOutcomeEnum.safeParse(i.reviewOutcome);
  return {
    proposalId: p.id,
    reference: p.reference,
    title: p.title,
    stateCode: p.stateCode,
    lgaCodes: p.lgaCodes,
    siteCount: p.currentVersion?.siteCount ?? 0,
    amountNgn: dec(i.amountNgn) ?? dec(p.costedAmountNgn),
    rank: p.rank,
    aboveLine: p.aboveLine,
    included: i.included,
    exclusionReason: i.exclusionReason,
    lotTitle: i.lotTitle,
    lotNumber: i.lotNumber ?? p.project?.lot?.number ?? null,
    batchNumber: i.batchNumber ?? p.project?.batchNumber ?? null,
    procurementMethod: method.success ? method.data : null,
    plannedStartDate: i.plannedStartDate,
    plannedEndDate: i.plannedEndDate,
    reviewOutcome: review.success ? review.data : null,
    reviewComment: i.reviewComment,
    currentVersionNumber: p.currentVersion?.number ?? null,
    projectId: p.project?.id ?? null,
    projectCode: p.project ? formatProjectCode(p.project.codePrefix) : null,
  };
}

/** The submission as the web shows it, with whether `viewer` may act now. */
export async function serializeSubmission(db: Db, viewer: WebJwtPayload | null, submission: SubmissionRow & { cycle: Pick<CycleRow, 'owningOrganizationId' | 'scopeKey'> }): Promise<NeedsSubmissionDto> {
  const kind = submission.kind as NeedsSubmissionKind;
  const chainType = NEEDS_CHAIN_FOR_SUBMISSION[kind];
  const steps = await chainSteps(db, submission.cycleId, chainType, submission.chainVersion);
  const approved = new Set(
    (() => {
      let start = 0;
      submission.actions.forEach((a, i) => {
        if (a.decision === 'RETURN') start = i + 1;
      });
      return submission.actions.slice(start).filter((a) => a.decision === 'APPROVE').map((a) => a.stepOrder);
    })()
  );
  const status = NeedsSubmissionStatusEnum.parse(submission.status);
  const items = submission.items.map(itemDto);
  const included = items.filter((i) => i.included);
  const gate = viewer && status === 'IN_REVIEW' ? await gateForSubmission(db, viewer, submission, submission.cycle, steps) : null;
  return {
    id: submission.id,
    cycleId: submission.cycleId,
    kind,
    chainType,
    status,
    statusLabel: NEEDS_SUBMISSION_STATUS_LABELS[status],
    submittedByUserId: submission.submittedByUserId,
    submittedByName: submission.submittedByName,
    submittedAt: submission.submittedAt?.toISOString() ?? null,
    decidedAt: submission.decidedAt?.toISOString() ?? null,
    memoDocumentId: submission.memoDocumentId,
    narrativeDocumentId: submission.narrativeDocumentId,
    counterpartDeclaredNgn: dec(submission.counterpartDeclaredNgn),
    counterpartEvidenceDocumentId: submission.counterpartEvidenceDocumentId,
    counterpartRecordedAt: submission.counterpartRecordedAt?.toISOString() ?? null,
    counterpartRecordedByName: submission.counterpartRecordedByName,
    items,
    totalNgn: Math.round(included.reduce((s, i) => s + (i.amountNgn ?? 0), 0) * 100) / 100,
    includedCount: included.length,
    steps: steps.map((s) => ({
      id: s.id,
      chainType,
      stepOrder: s.stepOrder,
      label: s.label,
      requiredPermissionKey: s.requiredPermissionKey,
      organizationScope: s.organizationScope,
      state: status === 'APPROVED' || approved.has(s.stepOrder) ? 'DONE' : status === 'IN_REVIEW' && s.stepOrder === submission.currentStepOrder ? 'CURRENT' : 'PENDING',
    })),
    currentStepOrder: submission.currentStepOrder,
    actions: submission.actions.map((a) => ({
      stepOrder: a.stepOrder,
      stepLabel: a.step.label,
      decision: a.decision,
      actorUserId: a.actorUserId,
      actorName: a.actor.fullName,
      notes: a.notes,
      createdAt: a.createdAt.toISOString(),
    })),
    canAct: Boolean(gate?.allowed),
    cannotActReason: gate && !gate.allowed ? gate.reason : null,
  };
}

/** `GET /api/v1/needs/submissions/:submissionId` */
export async function getSubmission(user: WebJwtPayload, submissionId: string): Promise<NeedsSubmissionDto> {
  const row = await loadVisibleSubmission(user, submissionId);
  return serializeSubmission(prisma, user, row);
}

/** `GET /api/v1/needs/cycles/:cycleId/submissions` (newest first; `kind` optional). */
export async function listCycleSubmissions(user: WebJwtPayload, cycleId: string, kind: NeedsSubmissionKind | null): Promise<NeedsSubmissionDto[]> {
  const rows = await prisma.needsSubmission.findMany({
    where: { cycleId, cycle: visibleCycleWhere(user), ...(kind ? { kind } : {}) },
    include: { ...SUBMISSION_INCLUDE, cycle: true },
    orderBy: { createdAt: 'desc' },
  });
  const out: NeedsSubmissionDto[] = [];
  for (const r of rows) out.push(await serializeSubmission(prisma, user, r));
  return out;
}
