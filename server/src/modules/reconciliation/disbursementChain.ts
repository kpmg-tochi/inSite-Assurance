import { Prisma } from '@prisma/client';
import { ApprovalProgressDto, RELEASE_PERMISSION_KEY } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { createWebNotification } from '../notifications/notifications.service';
import { ApprovalStepRow, ensureChain, getChainVersionSteps } from '../process/processConfig.service';
import {
  assertMayAct,
  buildApprovalProgress,
  gateForStep,
  loadActions,
  nextApplicableStep,
  orgContextForStep,
  organizationScopeAllows,
  recordApprovalAction,
} from '../process/approvalChain';

/**
 * The disbursement chain (Phase 7 Step 6). Certification (or direct milestone verification) and
 * release are its first and last steps; tenants may add review steps between them. With the
 * default two-step chain, behaviour is identical to Phase 3.
 *
 * A valuation records the chain version it started on and the step it is waiting for.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

type ValuationChainFields = {
  id: string;
  projectId: string;
  approvalChainVersion: number | null;
  currentApprovalStep: number;
  recommendedReleaseAmountNgn: Prisma.Decimal | number;
  certifiedByUserId: string;
  supersededAt: Date | null;
};

const amountOf = (v: ValuationChainFields) => Number(v.recommendedReleaseAmountNgn);

export function isReleaseStep(step: ApprovalStepRow, steps: ApprovalStepRow[]): boolean {
  return step.stepOrder === steps[steps.length - 1]?.stepOrder && step.requiredPermissionKey === RELEASE_PERMISSION_KEY;
}

async function notifyStep(
  tx: Tx,
  params: { projectId: string; step: ApprovalStepRow; stepCount: number; label: string; actionUrl: string; valuationId: string }
) {
  // Phase 11: an owner- or funder-scoped step is announced to that organisation only. (An
  // "owner or above" step cannot be expressed as one target, so it goes to every holder.)
  const ctx = await orgContextForStep(tx, params.projectId, params.step);
  const targetOrganizationId =
    params.step.organizationScope === 'PROJECT_OWNER'
      ? ctx?.owningOrganizationId
      : params.step.organizationScope === 'FUNDER'
        ? ctx?.funderOrganizationId
        : null;
  await createWebNotification(tx, {
    projectId: params.projectId,
    targetPermissionKey: params.step.requiredPermissionKey,
    targetRoleId: params.step.requiredRoleId,
    ...(targetOrganizationId ? { targetOrganizationId } : {}),
    category: 'DISBURSEMENT_PENDING_APPROVAL',
    title: `${params.label} awaiting ${params.step.label}`,
    description: `${params.label} is waiting for "${params.step.label}" (step ${params.step.stepOrder} of ${params.stepCount}).`,
    actionUrl: params.actionUrl,
    metadata: { valuationReportId: params.valuationId, stepOrder: params.step.stepOrder },
  });
}

/**
 * Puts a new valuation on the project's current disbursement chain: records the certifier's
 * approval of the certification step and moves to the next applicable step.
 */
export async function startValuationOnChain(
  tx: Tx,
  params: {
    projectId: string;
    valuationId: string;
    certifier: WebJwtPayload;
    recommendedReleaseNgn: number;
    label: string;
    actionUrl: string;
  }
): Promise<{ version: number; currentStep: ApprovalStepRow }> {
  const chain = await ensureChain(tx, params.projectId, 'DISBURSEMENT');
  const certStep = chain.steps[0];
  // The certification permission itself is checked by the caller; a role named on the step applies.
  if (certStep.requiredRoleId && certStep.requiredRoleId !== params.certifier.roleId) {
    throw new AppError(`"${certStep.label}" is limited to a specific role on this project`, 403, 'NOT_STEP_APPROVER');
  }
  // Phase 11: the certification step may be limited to an organisation too.
  const certOrg = await orgContextForStep(tx, params.projectId, certStep);
  if (!organizationScopeAllows(certStep.organizationScope, params.certifier.organizationId, certOrg)) {
    assertMayAct(gateForStep({ webUser: params.certifier, step: certStep, actions: [], orgContext: certOrg }), certStep);
  }
  await recordApprovalAction(tx, {
    projectId: params.projectId,
    chainType: 'DISBURSEMENT',
    subjectType: 'VALUATION_REPORT',
    subjectId: params.valuationId,
    step: certStep,
    decision: 'APPROVE',
    actorUserId: params.certifier.userId,
  });
  const next = nextApplicableStep(chain.steps, certStep.stepOrder, params.recommendedReleaseNgn);
  if (!next) throw new AppError('The disbursement chain has no release step', 500, 'INVALID_APPROVAL_CHAIN');
  await tx.valuationReport.update({
    where: { id: params.valuationId },
    data: { approvalChainVersion: chain.version, currentApprovalStep: next.stepOrder },
  });
  await notifyStep(tx, {
    projectId: params.projectId,
    step: next,
    stepCount: chain.steps.length,
    label: params.label,
    actionUrl: params.actionUrl,
    valuationId: params.valuationId,
  });
  return { version: chain.version, currentStep: next };
}

/**
 * The release step gate. Returns the release step to record an action on, or null for a valuation
 * made before chains existed (Phase 3 rules only). Throws when the valuation is still waiting on an
 * earlier step, or the user does not satisfy the release step.
 */
export async function assertAtReleaseStep(
  tx: Tx,
  valuation: ValuationChainFields,
  webUser: WebJwtPayload
): Promise<ApprovalStepRow | null> {
  if (valuation.approvalChainVersion === null) return null;
  const steps = await getChainVersionSteps(tx, valuation.projectId, 'DISBURSEMENT', valuation.approvalChainVersion);
  const step = steps.find((s) => s.stepOrder === valuation.currentApprovalStep) ?? null;
  if (!step || !isReleaseStep(step, steps)) {
    throw new AppError(
      step ? `This valuation is waiting for "${step.label}" before release` : 'This valuation is not on its approval chain any more',
      409,
      'VALUATION_AWAITING_APPROVAL_STEP',
      { currentStepOrder: valuation.currentApprovalStep, currentStepLabel: step?.label ?? null }
    );
  }
  const actions = await loadActions(tx, 'VALUATION_REPORT', valuation.id);
  const orgContext = await orgContextForStep(tx, valuation.projectId, step);
  assertMayAct(gateForStep({ webUser, step, actions, orgContext }), step);
  return step;
}

export async function recordReleaseAction(
  tx: Tx,
  params: { projectId: string; valuationId: string; step: ApprovalStepRow | null; webUser: WebJwtPayload; hold: boolean; notes?: string | null }
) {
  if (!params.step) return;
  await recordApprovalAction(tx, {
    projectId: params.projectId,
    chainType: 'DISBURSEMENT',
    subjectType: 'VALUATION_REPORT',
    subjectId: params.valuationId,
    step: params.step,
    // HOLD is a decision not to release now: stored as REJECT at the release step.
    decision: params.hold ? 'REJECT' : 'APPROVE',
    actorUserId: params.webUser.userId,
    notes: params.notes ?? null,
  });
}

/**
 * An added review step (neither certification nor release). APPROVE advances; RETURN is handled by
 * the caller (it supersedes the valuation). Returns the step acted on and the next step, if any.
 */
export async function actOnReviewStep(
  tx: Tx,
  valuation: ValuationChainFields,
  webUser: WebJwtPayload,
  decision: 'APPROVE' | 'RETURN',
  notes: string | null,
  notify: { label: string; actionUrl: string }
): Promise<{ step: ApprovalStepRow; next: ApprovalStepRow | null }> {
  if (valuation.supersededAt) throw new AppError('This valuation revision has been superseded', 409, 'VALUATION_SUPERSEDED');
  if (valuation.approvalChainVersion === null) {
    throw new AppError('This valuation has no review steps', 409, 'NOT_AWAITING_APPROVAL');
  }
  const steps = await getChainVersionSteps(tx, valuation.projectId, 'DISBURSEMENT', valuation.approvalChainVersion);
  const step = steps.find((s) => s.stepOrder === valuation.currentApprovalStep) ?? null;
  if (!step || step.isSystemStep) {
    throw new AppError(
      step && isReleaseStep(step, steps)
        ? 'This valuation is at the release step; record the disbursement decision instead'
        : 'Nothing is waiting for review on this valuation',
      409,
      'NOT_AWAITING_REVIEW'
    );
  }
  const actions = await loadActions(tx, 'VALUATION_REPORT', valuation.id);
  const orgContext = await orgContextForStep(tx, valuation.projectId, step);
  assertMayAct(gateForStep({ webUser, step, actions, orgContext }), step);
  await recordApprovalAction(tx, {
    projectId: valuation.projectId,
    chainType: 'DISBURSEMENT',
    subjectType: 'VALUATION_REPORT',
    subjectId: valuation.id,
    step,
    decision,
    actorUserId: webUser.userId,
    notes,
  });
  if (decision === 'RETURN') {
    await tx.valuationReport.update({ where: { id: valuation.id }, data: { currentApprovalStep: 0 } });
    return { step, next: null };
  }
  const next = nextApplicableStep(steps, step.stepOrder, amountOf(valuation));
  if (!next) throw new AppError('The disbursement chain has no release step', 500, 'INVALID_APPROVAL_CHAIN');
  await tx.valuationReport.update({ where: { id: valuation.id }, data: { currentApprovalStep: next.stepOrder } });
  await notifyStep(tx, {
    projectId: valuation.projectId,
    step: next,
    stepCount: steps.length,
    label: notify.label,
    actionUrl: notify.actionUrl,
    valuationId: valuation.id,
  });
  return { step, next };
}

/** Approval progress of a valuation for the UI; `decided` marks the chain complete. */
export async function valuationProgress(
  db: Db,
  valuation: ValuationChainFields,
  viewer: WebJwtPayload | null,
  decided: boolean
): Promise<ApprovalProgressDto | null> {
  if (valuation.approvalChainVersion === null) return null;
  return buildApprovalProgress(db, {
    projectId: valuation.projectId,
    chainType: 'DISBURSEMENT',
    version: valuation.approvalChainVersion,
    subjectType: 'VALUATION_REPORT',
    subjectId: valuation.id,
    currentStepOrder: decided ? null : valuation.supersededAt ? 0 : valuation.currentApprovalStep,
    amount: amountOf(valuation),
    viewer,
  });
}

/** The gate for the "review" action (an added step) on a live valuation, for IPC action lists. */
export async function reviewGate(
  db: Db,
  valuation: ValuationChainFields | null,
  viewer: WebJwtPayload,
  decided: boolean
): Promise<{ allowed: boolean; reason: string | null }> {
  if (!valuation || decided || valuation.supersededAt || valuation.approvalChainVersion === null) {
    return { allowed: false, reason: 'Nothing is waiting for review.' };
  }
  const steps = await getChainVersionSteps(db, valuation.projectId, 'DISBURSEMENT', valuation.approvalChainVersion);
  const step = steps.find((s) => s.stepOrder === valuation.currentApprovalStep) ?? null;
  if (!step || step.isSystemStep) return { allowed: false, reason: 'Nothing is waiting for review.' };
  const actions = await loadActions(db, 'VALUATION_REPORT', valuation.id);
  return gateForStep({ webUser: viewer, step, actions, orgContext: await orgContextForStep(db, valuation.projectId, step) });
}

/** The gate for the release decision on a live valuation (chain position and consecutive rule). */
export async function releaseGate(
  db: Db,
  valuation: ValuationChainFields | null,
  viewer: WebJwtPayload
): Promise<{ allowed: boolean; reason: string | null }> {
  if (!valuation || valuation.approvalChainVersion === null) return { allowed: true, reason: null };
  const steps = await getChainVersionSteps(db, valuation.projectId, 'DISBURSEMENT', valuation.approvalChainVersion);
  const step = steps.find((s) => s.stepOrder === valuation.currentApprovalStep) ?? null;
  if (!step || !isReleaseStep(step, steps)) {
    return { allowed: false, reason: step ? `Waiting for "${step.label}" first.` : 'Not on its approval chain.' };
  }
  const actions = await loadActions(db, 'VALUATION_REPORT', valuation.id);
  return gateForStep({ webUser: viewer, step, actions, orgContext: await orgContextForStep(db, valuation.projectId, step) });
}
