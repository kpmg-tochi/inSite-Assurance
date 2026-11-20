import { Prisma } from '@prisma/client';
import {
  ApprovalActionDto,
  ApprovalChainType,
  ApprovalOrganizationScope,
  ApprovalProgressDto,
  ApprovalSubjectType,
  SEGREGATED_DISBURSEMENT_PERMISSIONS,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, WebJwtPayload } from '../../middleware/auth.middleware';
import { ApprovalStepRow, getChainVersionSteps } from './processConfig.service';
import { organizationAncestorIds } from '../organizations/hierarchy';

/**
 * Approval chain engine (Phase 7). A chain is an ordered list of steps; each step names a
 * permission and optionally a role. Rules:
 * - a step with an amount threshold is skipped when the amount is below it (disbursement only);
 * - one user may not act on two consecutive steps of the same item;
 * - segregated permissions (certify, approve, verify direct) must be held through a role, never by
 *   the platform super admin bypass (D-3.1);
 * - Phase 11: a step's organisation scope limits it to the project owner's organisation, the owner
 *   or an organisation above it, or the funder. There is no bypass, not even for the platform super
 *   admin.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export function stepApplies(step: Pick<ApprovalStepRow, 'minAmountThresholdNgn'>, amount: number | null): boolean {
  if (step.minAmountThresholdNgn === null || amount === null) return true;
  return amount >= Number(step.minAmountThresholdNgn);
}

/** The first applicable step after `afterOrder`, or null when the chain is complete. */
export function nextApplicableStep(steps: ApprovalStepRow[], afterOrder: number, amount: number | null): ApprovalStepRow | null {
  return steps.find((s) => s.stepOrder > afterOrder && stepApplies(s, amount)) ?? null;
}

/** The project's parties an organisation scope is resolved against (Phase 11). */
export interface ProjectOrgContext {
  owningOrganizationId: string | null;
  /** The owner's ancestors, nearest first. */
  ownerAncestorIds: string[];
  funderOrganizationId: string | null;
}

export async function loadProjectOrgContext(db: Db, projectId: string): Promise<ProjectOrgContext> {
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { owningOrganizationId: true, lenderOrganizationId: true },
  });
  return {
    owningOrganizationId: project.owningOrganizationId,
    ownerAncestorIds: project.owningOrganizationId ? await organizationAncestorIds(project.owningOrganizationId, db) : [],
    funderOrganizationId: project.lenderOrganizationId,
  };
}

/** Loads the context only when the step is organisation-scoped; pass the result to the gate. */
export async function orgContextForStep(
  db: Db,
  projectId: string,
  step: Pick<ApprovalStepRow, 'organizationScope'> | null
): Promise<ProjectOrgContext | null> {
  if (!step || step.organizationScope === 'ANY') return null;
  return loadProjectOrgContext(db, projectId);
}

/** Whether an organisation satisfies a scope. Fails closed when the context is missing. */
export function organizationScopeAllows(
  scope: ApprovalOrganizationScope,
  organizationId: string,
  ctx: ProjectOrgContext | null
): boolean {
  if (scope === 'ANY') return true;
  if (!ctx) return false;
  switch (scope) {
    case 'PROJECT_OWNER':
      return ctx.owningOrganizationId !== null && organizationId === ctx.owningOrganizationId;
    case 'PROJECT_OWNER_OR_ANCESTOR':
      return (
        ctx.owningOrganizationId !== null &&
        (organizationId === ctx.owningOrganizationId || ctx.ownerAncestorIds.includes(organizationId))
      );
    case 'FUNDER':
      return ctx.funderOrganizationId !== null && organizationId === ctx.funderOrganizationId;
    default:
      return false;
  }
}

function organizationScopeReason(step: Pick<ApprovalStepRow, 'label' | 'organizationScope'>, ctx: ProjectOrgContext | null): string {
  switch (step.organizationScope) {
    case 'PROJECT_OWNER':
      return ctx?.owningOrganizationId
        ? `"${step.label}" is limited to people in the project's owning organisation.`
        : `"${step.label}" is limited to the owning organisation, and this project has none yet.`;
    case 'PROJECT_OWNER_OR_ANCESTOR':
      return ctx?.owningOrganizationId
        ? `"${step.label}" is limited to people in the project's owning organisation or an organisation above it.`
        : `"${step.label}" is limited to the owning organisation, and this project has none yet.`;
    case 'FUNDER':
      return ctx?.funderOrganizationId
        ? `"${step.label}" is limited to people in the project's funding organisation.`
        : `"${step.label}" is limited to the funding organisation, and this project has none yet.`;
    default:
      return `You cannot act on "${step.label}".`;
  }
}

/**
 * Whether the user holds what a step requires: the permission, the role if one is named, and
 * (Phase 11) membership of the organisation the step's scope names.
 */
export function holdsStep(
  webUser: WebJwtPayload,
  step: Pick<ApprovalStepRow, 'requiredPermissionKey' | 'requiredRoleId' | 'organizationScope'>,
  orgContext: ProjectOrgContext | null
): boolean {
  const key = step.requiredPermissionKey;
  const hasPermission = SEGREGATED_DISBURSEMENT_PERMISSIONS.includes(key)
    ? webUser.permissions.includes(key)
    : hasWebPermission(webUser, key);
  if (!hasPermission) return false;
  if (step.requiredRoleId && step.requiredRoleId !== webUser.roleId) return false;
  return organizationScopeAllows(step.organizationScope, webUser.organizationId, orgContext);
}

type ActionRow = Prisma.ApprovalActionGetPayload<{ include: { actor: { select: { fullName: true } }; step: { select: { label: true } } } }>;

export async function loadActions(db: Db, subjectType: ApprovalSubjectType, subjectId: string): Promise<ActionRow[]> {
  return db.approvalAction.findMany({
    where: { subjectType, subjectId },
    orderBy: { createdAt: 'asc' },
    include: { actor: { select: { fullName: true } }, step: { select: { label: true } } },
  });
}

/** The user who approved the step before `step` in the current pass, if any. */
function previousApprover(actions: ActionRow[], stepOrder: number): string | null {
  // Only actions since the last RETURN belong to the current pass.
  let passStart = 0;
  actions.forEach((a, i) => {
    if (a.decision === 'RETURN') passStart = i + 1;
  });
  const pass = actions.slice(passStart).filter((a) => a.decision === 'APPROVE' && a.stepOrder < stepOrder);
  return pass.length ? pass[pass.length - 1].actorUserId : null;
}

export interface ActGate {
  allowed: boolean;
  reason: string | null;
}

/** Whether `webUser` may act on `step` of this item now. Advisory for the UI; enforced by `assertMayAct`. */
export function gateForStep(params: {
  webUser: WebJwtPayload;
  step: ApprovalStepRow | null;
  actions: ActionRow[];
  /** e.g. the reporter's user id, who may never review their own report. */
  excludedUserId?: string | null;
  excludedReason?: string;
  /** Phase 11: required for an organisation-scoped step (load it with orgContextForStep). */
  orgContext: ProjectOrgContext | null;
}): ActGate {
  const { webUser, step, actions } = params;
  if (!step) return { allowed: false, reason: 'Nothing is waiting for approval.' };
  if (!holdsStep(webUser, { ...step, organizationScope: 'ANY' }, null)) {
    return {
      allowed: false,
      reason: step.requiredRoleId
        ? `"${step.label}" needs a specific role and the ${step.requiredPermissionKey} permission.`
        : `"${step.label}" needs the ${step.requiredPermissionKey} permission.`,
    };
  }
  if (!organizationScopeAllows(step.organizationScope, webUser.organizationId, params.orgContext)) {
    return { allowed: false, reason: organizationScopeReason(step, params.orgContext) };
  }
  if (params.excludedUserId && params.excludedUserId === webUser.userId) {
    return { allowed: false, reason: params.excludedReason ?? 'You cannot act on your own item.' };
  }
  if (previousApprover(actions, step.stepOrder) === webUser.userId) {
    return { allowed: false, reason: 'You approved the previous step; another person must act on this one.' };
  }
  return { allowed: true, reason: null };
}

export function assertMayAct(gate: ActGate, step: ApprovalStepRow | null): void {
  if (gate.allowed) return;
  if (!step) throw new AppError('Nothing is waiting for approval', 409, 'NOT_AWAITING_APPROVAL');
  const code = gate.reason?.includes('is limited to')
    ? 'NOT_STEP_ORGANIZATION'
    : gate.reason?.includes('previous step')
    ? 'SAME_USER_CONSECUTIVE_STEPS'
    : gate.reason?.includes('own')
      ? 'SEGREGATION_OF_DUTIES'
      : 'NOT_STEP_APPROVER';
  throw new AppError(gate.reason ?? 'You cannot act on this step', 403, code);
}

export async function recordApprovalAction(
  tx: Prisma.TransactionClient,
  params: {
    projectId: string;
    chainType: ApprovalChainType;
    subjectType: ApprovalSubjectType;
    subjectId: string;
    step: ApprovalStepRow;
    decision: 'APPROVE' | 'RETURN' | 'REJECT';
    actorUserId: string;
    notes?: string | null;
  }
) {
  return tx.approvalAction.create({
    data: {
      projectId: params.projectId,
      chainType: params.chainType,
      subjectType: params.subjectType,
      subjectId: params.subjectId,
      stepId: params.step.id,
      stepOrder: params.step.stepOrder,
      decision: params.decision,
      actorUserId: params.actorUserId,
      notes: params.notes ?? null,
    },
  });
}

function serializeAction(a: ActionRow): ApprovalActionDto {
  return {
    id: a.id,
    stepOrder: a.stepOrder,
    stepLabel: a.step.label,
    decision: a.decision,
    actorUserId: a.actorUserId,
    actorName: a.actor.fullName,
    notes: a.notes,
    createdAt: a.createdAt.toISOString(),
  };
}

/**
 * The approval position of an item for the UI. `currentStepOrder` is the step being waited on;
 * null means the chain is complete; 0 means not started or returned.
 */
export async function buildApprovalProgress(
  db: Db,
  params: {
    projectId: string;
    chainType: ApprovalChainType;
    version: number;
    subjectType: ApprovalSubjectType;
    subjectId: string;
    currentStepOrder: number | null;
    amount: number | null;
    viewer?: WebJwtPayload | null;
    excludedUserId?: string | null;
    excludedReason?: string;
    /** Steps handled by a dedicated action (e.g. certification, release) rather than /review. */
    preloaded?: { steps: ApprovalStepRow[]; actions: ActionRow[] };
  }
): Promise<ApprovalProgressDto> {
  const steps = params.preloaded?.steps ?? (await getChainVersionSteps(db, params.projectId, params.chainType, params.version));
  const actions = params.preloaded?.actions ?? (await loadActions(db, params.subjectType, params.subjectId));
  const current = params.currentStepOrder ? steps.find((s) => s.stepOrder === params.currentStepOrder) ?? null : null;
  const completed = params.currentStepOrder === null;

  // Steps approved in the current pass.
  let passStart = 0;
  actions.forEach((a, i) => {
    if (a.decision === 'RETURN') passStart = i + 1;
  });
  const approvedInPass = new Set(actions.slice(passStart).filter((a) => a.decision === 'APPROVE').map((a) => a.stepOrder));

  const progressSteps = steps.map((s) => {
    let state: 'DONE' | 'CURRENT' | 'SKIPPED' | 'PENDING';
    if (approvedInPass.has(s.stepOrder)) state = 'DONE';
    else if (!stepApplies(s, params.amount)) state = 'SKIPPED';
    else if (current && s.stepOrder === current.stepOrder) state = 'CURRENT';
    else state = completed ? 'DONE' : 'PENDING';
    return {
      id: s.id,
      chainType: params.chainType,
      stepOrder: s.stepOrder,
      label: s.label,
      requiredPermissionKey: s.requiredPermissionKey,
      requiredRoleId: s.requiredRoleId,
      requiredRoleName: null,
      minAmountThresholdNgn: s.minAmountThresholdNgn === null ? null : Number(s.minAmountThresholdNgn),
      isSystemStep: s.isSystemStep,
      organizationScope: s.organizationScope,
      version: s.version,
      state,
    };
  });

  const gate = params.viewer
    ? gateForStep({
        webUser: params.viewer,
        step: current,
        actions,
        orgContext: await orgContextForStep(db, params.projectId, current),
        excludedUserId: params.excludedUserId,
        excludedReason: params.excludedReason,
      })
    : { allowed: false, reason: null };

  return {
    chainType: params.chainType,
    chainVersion: params.version,
    currentStepOrder: params.currentStepOrder,
    completed,
    steps: progressSteps,
    actions: actions.map(serializeAction),
    canAct: gate.allowed,
    cannotActReason: gate.allowed ? null : gate.reason,
  };
}
