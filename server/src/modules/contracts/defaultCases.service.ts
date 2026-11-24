import { Prisma } from '@prisma/client';
import {
  ActOnDefaultCaseRequest,
  ContractorDefaultCaseDto,
  DefaultCaseStatus,
  OPEN_DEFAULT_CASE_STATUSES,
  RaiseDefaultCaseRequest,
  resolveProjectTypeConfig,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { ensureChain, getChainVersionSteps } from '../process/processConfig.service';
import {
  assertMayAct,
  buildApprovalProgress,
  gateForStep,
  loadActions,
  nextApplicableStep,
  orgContextForStep,
  recordApprovalAction,
} from '../process/approvalChain';
import { createWebNotification } from '../notifications/notifications.service';
import { MilestoneActor, OPEN_MILESTONE_STATUSES, recomputeMilestoneDates, SYSTEM_ACTOR, webActor } from './milestones.service';

/**
 * Phase 13: contractor default cases. A case runs through the project's CONTRACT_DEFAULT approval
 * chain (review steps, then the decision step, `contracts:decide_default`, organisation-scoped
 * through the Phase 11 rules). The decision is a cure period, an extension (moves the milestone),
 * termination or closure. Termination is a contract state on the contractor, never the project's
 * ARCHIVED, and keeps the contractor's history (R1d: no replacement; one contractor per project).
 */

type Tx = Prisma.TransactionClient;

const CASE_INCLUDE = {
  projectContractor: { select: { tradeCode: true, organization: { select: { name: true } } } },
  milestone: { select: { label: true } },
} satisfies Prisma.ContractorDefaultCaseInclude;

type CaseRow = Prisma.ContractorDefaultCaseGetPayload<{ include: typeof CASE_INCLUDE }>;

type Db = Tx | typeof prisma;

async function serializeCase(c: CaseRow, viewer: WebJwtPayload | null): Promise<ContractorDefaultCaseDto> {
  const steps = await getChainVersionSteps(prisma, c.projectId, 'CONTRACT_DEFAULT', c.chainVersion);
  const isOpen = OPEN_DEFAULT_CASE_STATUSES.includes(c.status as DefaultCaseStatus);
  // A case in its cure period waits on nobody (the contractor has until the new date).
  const waitingOn = c.status === 'CURE_PERIOD' ? null : c.currentStepOrder;
  const approval = await buildApprovalProgress(prisma, {
    projectId: c.projectId,
    chainType: 'CONTRACT_DEFAULT',
    version: c.chainVersion,
    subjectType: 'CONTRACT_DEFAULT_CASE',
    subjectId: c.id,
    currentStepOrder: isOpen ? waitingOn ?? 0 : null,
    amount: null,
    viewer,
    preloaded: { steps, actions: await loadActions(prisma, 'CONTRACT_DEFAULT_CASE', c.id) },
  });
  if (c.status === 'CURE_PERIOD') {
    approval.canAct = false;
    approval.cannotActReason = `The contractor has until ${c.newDueDate} to cure the default.`;
  }
  const opener = c.openedByUserId ? await prisma.user.findUnique({ where: { id: c.openedByUserId }, select: { fullName: true } }) : null;
  const lastOrder = steps.length ? steps[steps.length - 1].stepOrder : null;
  return {
    id: c.id,
    projectId: c.projectId,
    projectContractorId: c.projectContractorId,
    contractorName: c.projectContractor.organization.name,
    tradeCode: c.projectContractor.tradeCode,
    trigger: c.trigger,
    milestoneId: c.milestoneId,
    milestoneLabel: c.milestone?.label ?? null,
    status: c.status,
    summary: c.summary,
    outcomeNotes: c.outcomeNotes,
    newDueDate: c.newDueDate,
    openedByName: opener?.fullName ?? (c.trigger === 'MILESTONE_OVERDUE' ? 'InSite (overdue milestone)' : null),
    openedAt: c.openedAt.toISOString(),
    decidedAt: c.decidedAt?.toISOString() ?? null,
    isOpen,
    atDecisionStep: isOpen && c.status !== 'CURE_PERIOD' && c.currentStepOrder !== null && c.currentStepOrder === lastOrder,
    approval,
  };
}

export async function listDefaultCases(projectId: string, viewer: WebJwtPayload, filters: { contractorId?: string; openOnly?: boolean } = {}) {
  const rows = await prisma.contractorDefaultCase.findMany({
    where: {
      projectId,
      ...(filters.contractorId ? { projectContractorId: filters.contractorId } : {}),
      ...(filters.openOnly ? { status: { in: OPEN_DEFAULT_CASE_STATUSES } } : {}),
    },
    include: CASE_INCLUDE,
    orderBy: { openedAt: 'desc' },
  });
  return Promise.all(rows.map((r) => serializeCase(r, viewer)));
}

export async function getDefaultCase(projectId: string, caseId: string, viewer: WebJwtPayload | null) {
  const row = await prisma.contractorDefaultCase.findFirst({ where: { id: caseId, projectId }, include: CASE_INCLUDE });
  if (!row) throw new AppError('Default case not found', 404, 'DEFAULT_CASE_NOT_FOUND');
  return serializeCase(row, viewer);
}

/** Tells the reviewers: holders of contracts:raise_default, and the type's Legal role. */
async function notifyCaseOpened(tx: Tx, projectId: string, c: { id: string; summary: string }, contractorName: string, legalRoleId: string | null) {
  const base = {
    projectId,
    category: 'CONTRACT_DEFAULT_CASE' as const,
    title: `Default case opened: ${contractorName}`,
    description: c.summary,
    actionUrl: `/app/projects/${projectId}/kickoff?tab=milestones&case=${c.id}`,
    metadata: { caseId: c.id },
    hideFromProjectContractors: true,
  };
  await createWebNotification(tx, { ...base, targetPermissionKey: 'contracts:raise_default' });
  if (legalRoleId) await createWebNotification(tx, { ...base, targetRoleId: legalRoleId });
}

async function legalRoleIdFor(tx: Tx, projectId: string) {
  const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { tenantId: true, projectTypeSnapshotJson: true } });
  const code = resolveProjectTypeConfig(project.projectTypeSnapshotJson)?.defaultCases.legalRoleCode ?? null;
  if (!code) return null;
  return (await tx.role.findFirst({ where: { tenantId: project.tenantId, code }, select: { id: true } }))?.id ?? null;
}

/** Opens a case inside the caller's transaction. Refused while the contractor has one running. */
export async function openDefaultCase(
  tx: Tx,
  params: {
    projectId: string;
    projectContractorId: string;
    trigger: 'MILESTONE_OVERDUE' | 'MANUAL';
    milestoneId: string | null;
    summary: string;
    actor: MilestoneActor;
  }
) {
  await tx.$queryRaw`SELECT id FROM "project_contractors" WHERE id = ${params.projectContractorId}::uuid FOR UPDATE`;
  const contractor = await tx.projectContractor.findFirst({
    where: { id: params.projectContractorId, projectId: params.projectId },
    select: { id: true, contractStatus: true, organization: { select: { name: true } } },
  });
  if (!contractor) throw new AppError('Contractor not found on this project', 404, 'CONTRACTOR_NOT_FOUND');
  if (contractor.contractStatus === 'TERMINATED') throw new AppError('This contract is already terminated', 409, 'CONTRACTOR_TERMINATED');
  const running = await tx.contractorDefaultCase.findFirst({
    where: { projectContractorId: contractor.id, status: { in: OPEN_DEFAULT_CASE_STATUSES } },
    select: { id: true },
  });
  if (running) throw new AppError('A default case is already open for this contractor', 409, 'DEFAULT_CASE_ALREADY_OPEN', { caseId: running.id });
  const chain = await ensureChain(tx, params.projectId, 'CONTRACT_DEFAULT');
  const created = await tx.contractorDefaultCase.create({
    data: {
      projectId: params.projectId,
      projectContractorId: contractor.id,
      trigger: params.trigger,
      milestoneId: params.milestoneId,
      summary: params.summary,
      chainVersion: chain.version,
      currentStepOrder: chain.steps[0].stepOrder,
      openedByUserId: params.actor.userId,
    },
  });
  await recordAuditEvent(tx, {
    projectId: params.projectId,
    actorType: params.actor.actorType,
    actorId: params.actor.actorId,
    actorDisplayName: params.actor.actorDisplayName,
    action: 'DEFAULT_CASE_OPENED',
    summaryText: `Opened a default case against ${contractor.organization.name}${params.trigger === 'MILESTONE_OVERDUE' ? ' (milestone overdue)' : ''}: ${params.summary}`,
    payload: { caseId: created.id, projectContractorId: contractor.id, trigger: params.trigger, milestoneId: params.milestoneId, chainVersion: chain.version },
  });
  await notifyCaseOpened(tx, params.projectId, created, contractor.organization.name, await legalRoleIdFor(tx, params.projectId));
  return created;
}

export async function raiseDefaultCase(projectId: string, webUser: WebJwtPayload, input: RaiseDefaultCaseRequest) {
  const id = await prisma.$transaction(async (tx) => {
    if (input.milestoneId) {
      const m = await tx.projectContractMilestone.findFirst({ where: { id: input.milestoneId, projectId }, select: { projectContractorId: true } });
      if (!m) throw new AppError('Milestone not found on this project', 404, 'MILESTONE_NOT_FOUND');
      if (m.projectContractorId && m.projectContractorId !== input.projectContractorId) {
        throw new AppError('That milestone belongs to another contractor', 422, 'MILESTONE_OTHER_CONTRACTOR');
      }
    }
    const c = await openDefaultCase(tx, {
      projectId,
      projectContractorId: input.projectContractorId,
      trigger: 'MANUAL',
      milestoneId: input.milestoneId ?? null,
      summary: input.summary,
      actor: webActor(webUser),
    });
    return c.id;
  });
  return getDefaultCase(projectId, id, webUser);
}

// ---------------------------------------------------------------------------
// Acting on a case
// ---------------------------------------------------------------------------

export async function actOnDefaultCase(projectId: string, caseId: string, webUser: WebJwtPayload, input: ActOnDefaultCaseRequest) {
  const actor = webActor(webUser);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "contractor_default_cases" WHERE id = ${caseId}::uuid FOR UPDATE`;
    const c = await tx.contractorDefaultCase.findFirst({ where: { id: caseId, projectId }, include: CASE_INCLUDE });
    if (!c) throw new AppError('Default case not found', 404, 'DEFAULT_CASE_NOT_FOUND');
    if (!['OPEN', 'IN_REVIEW'].includes(c.status) || c.currentStepOrder === null) {
      throw new AppError('Nothing is waiting for a decision on this case', 409, 'NOT_AWAITING_APPROVAL');
    }
    const steps = await getChainVersionSteps(tx, projectId, 'CONTRACT_DEFAULT', c.chainVersion);
    const step = steps.find((s) => s.stepOrder === c.currentStepOrder) ?? null;
    const actions = await loadActions(tx, 'CONTRACT_DEFAULT_CASE', c.id);
    assertMayAct(gateForStep({ webUser, step, actions, orgContext: await orgContextForStep(tx, projectId, step) }), step);
    const isDecision = step!.stepOrder === steps[steps.length - 1].stepOrder;

    if (input.decision === 'RETURN') {
      if (step!.stepOrder === steps[0].stepOrder) {
        throw new AppError('The case is at its first step; there is nothing to return it to.', 409, 'NOTHING_TO_RETURN');
      }
      await recordApprovalAction(tx, { projectId, chainType: 'CONTRACT_DEFAULT', subjectType: 'CONTRACT_DEFAULT_CASE', subjectId: c.id, step: step!, decision: 'RETURN', actorUserId: webUser.userId, notes: input.notes ?? null });
      await tx.contractorDefaultCase.update({ where: { id: c.id }, data: { status: 'OPEN', currentStepOrder: steps[0].stepOrder } });
      await audit(tx, projectId, actor, 'DEFAULT_CASE_REVIEWED', `Returned the default case against ${c.projectContractor.organization.name} to "${steps[0].label}": ${input.notes}`, {
        caseId: c.id,
        stepOrder: step!.stepOrder,
        decision: 'RETURN',
      });
      return;
    }

    if (!isDecision) {
      if (input.outcome) throw new AppError('The outcome is chosen at the decision step', 422, 'OUTCOME_AT_DECISION_STEP');
      const next = nextApplicableStep(steps, step!.stepOrder, null)!;
      await recordApprovalAction(tx, { projectId, chainType: 'CONTRACT_DEFAULT', subjectType: 'CONTRACT_DEFAULT_CASE', subjectId: c.id, step: step!, decision: 'APPROVE', actorUserId: webUser.userId, notes: input.notes ?? null });
      await tx.contractorDefaultCase.update({ where: { id: c.id }, data: { status: 'IN_REVIEW', currentStepOrder: next.stepOrder } });
      await audit(tx, projectId, actor, 'DEFAULT_CASE_REVIEWED', `"${step!.label}" done on the default case against ${c.projectContractor.organization.name}; now with "${next.label}".`, {
        caseId: c.id,
        stepOrder: step!.stepOrder,
        nextStepOrder: next.stepOrder,
        notes: input.notes ?? null,
      });
      await createWebNotification(tx, {
        projectId,
        targetPermissionKey: next.requiredPermissionKey,
        targetRoleId: next.requiredRoleId,
        category: 'CONTRACT_DEFAULT_CASE',
        title: `Default case waiting for "${next.label}"`,
        description: `${c.projectContractor.organization.name}: ${c.summary}`,
        actionUrl: `/app/projects/${projectId}/kickoff?tab=milestones&case=${c.id}`,
        metadata: { caseId: c.id },
        hideFromProjectContractors: true,
      });
      return;
    }

    // Decision step.
    if (!input.outcome) throw new AppError('Choose the outcome of the case', 422, 'OUTCOME_REQUIRED');
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { timezone: true } });
    const today = zonedCalendarDate(new Date(), project.timezone);
    if ((input.outcome === 'CURE_PERIOD' || input.outcome === 'EXTENSION_GRANTED') && input.newDueDate! <= today) {
      throw new AppError('The new date must be after today', 422, 'NEW_DATE_NOT_IN_FUTURE');
    }
    if (input.outcome === 'EXTENSION_GRANTED' && !c.milestoneId) {
      throw new AppError('An extension moves a milestone; this case has none. Choose a cure period instead.', 422, 'EXTENSION_NEEDS_MILESTONE');
    }
    await recordApprovalAction(tx, { projectId, chainType: 'CONTRACT_DEFAULT', subjectType: 'CONTRACT_DEFAULT_CASE', subjectId: c.id, step: step!, decision: 'APPROVE', actorUserId: webUser.userId, notes: input.notes ?? null });
    const status: DefaultCaseStatus = input.outcome;
    await tx.contractorDefaultCase.update({
      where: { id: c.id },
      data: {
        status,
        currentStepOrder: status === 'CURE_PERIOD' ? step!.stepOrder : null,
        outcomeNotes: input.notes ?? null,
        newDueDate: input.newDueDate ?? null,
        decidedAt: new Date(),
        decidedByUserId: webUser.userId,
      },
    });
    if (input.outcome === 'EXTENSION_GRANTED') {
      const m = await tx.projectContractMilestone.findUniqueOrThrow({ where: { id: c.milestoneId! } });
      if (OPEN_MILESTONE_STATUSES.includes(m.status)) {
        // The new date replaces the computed one for this milestone (it counts from it from now on).
        await tx.projectContractMilestone.update({
          where: { id: m.id },
          data: { anchorDateOverride: input.newDueDate!, offsetValue: 0, offsetUnit: 'CALENDAR_DAYS' },
        });
        await recomputeMilestoneDates(tx, projectId);
        await audit(tx, projectId, actor, 'MILESTONE_DATES_RECOMPUTED', `Extension granted: "${m.label}" is now due ${input.newDueDate} (was ${m.dueDate ?? 'no date'}).`, {
          milestoneId: m.id,
          from: m.dueDate,
          to: input.newDueDate,
          caseId: c.id,
        });
      }
    }
    await audit(tx, projectId, actor, 'DEFAULT_CASE_DECIDED', `Decided the default case against ${c.projectContractor.organization.name}: ${input.outcome.replace('_', ' ').toLowerCase()}${input.newDueDate ? ` (until ${input.newDueDate})` : ''}${input.notes ? `. ${input.notes}` : '.'}`, {
      caseId: c.id,
      outcome: input.outcome,
      newDueDate: input.newDueDate ?? null,
      notes: input.notes ?? null,
    });
    if (input.outcome === 'TERMINATED') {
      await terminateContractor(tx, { projectId, projectContractorId: c.projectContractorId, caseId: c.id, actor, reason: input.notes ?? c.summary });
    }
  });
  return getDefaultCase(projectId, caseId, webUser);
}

async function audit(tx: Tx, projectId: string, actor: MilestoneActor, action: 'DEFAULT_CASE_REVIEWED' | 'DEFAULT_CASE_DECIDED' | 'MILESTONE_DATES_RECOMPUTED' | 'CONTRACTOR_TERMINATED', summaryText: string, payload: Record<string, unknown>) {
  await recordAuditEvent(tx, {
    projectId,
    actorType: actor.actorType,
    actorId: actor.actorId,
    actorDisplayName: actor.actorDisplayName,
    action,
    summaryText,
    payload,
  });
}

/**
 * A cure period that ended without the milestone done comes back to the decision step (once).
 * Called by the milestone-deadlines job.
 */
export async function lapseCurePeriods(projectId: string, today: string, now: Date): Promise<number> {
  const lapsed = await prisma.contractorDefaultCase.findMany({
    where: { projectId, status: 'CURE_PERIOD', newDueDate: { lt: today } },
    include: CASE_INCLUDE,
  });
  for (const c of lapsed) {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.contractorDefaultCase.updateMany({
        where: { id: c.id, status: 'CURE_PERIOD' },
        data: { status: 'IN_REVIEW', cureLapsedAt: now },
      });
      if (claimed.count === 0) return;
      await audit(tx, projectId, SYSTEM_ACTOR, 'DEFAULT_CASE_REVIEWED', `The cure period for ${c.projectContractor.organization.name} ended on ${c.newDueDate} without a cure; the case is back for a decision.`, {
        caseId: c.id,
        newDueDate: c.newDueDate,
      });
      const steps = await getChainVersionSteps(tx, projectId, 'CONTRACT_DEFAULT', c.chainVersion);
      const decision = steps[steps.length - 1];
      await createWebNotification(tx, {
        projectId,
        targetPermissionKey: decision.requiredPermissionKey,
        targetRoleId: decision.requiredRoleId,
        category: 'CONTRACT_DEFAULT_CASE',
        title: `Cure period ended: ${c.projectContractor.organization.name}`,
        description: `The cure period ended on ${c.newDueDate} without a cure. The case needs a new decision.`,
        actionUrl: `/app/projects/${projectId}/kickoff?tab=milestones&case=${c.id}`,
        metadata: { caseId: c.id },
        hideFromProjectContractors: true,
      });
    });
  }
  return lapsed.length;
}

// ---------------------------------------------------------------------------
// Termination and replacement
// ---------------------------------------------------------------------------

/**
 * Ends a contractor's contract (inside the decision's transaction): the contractor is TERMINATED,
 * its join codes deactivated and field sessions revoked, its open milestones waived. Refused while
 * any of its claims is active (not yet paid). Certified progress, retention, IPC history and defect
 * tickets stay.
 */
export async function terminateContractor(
  tx: Tx,
  params: { projectId: string; projectContractorId: string; caseId: string; actor: MilestoneActor; reason: string }
) {
  const now = new Date();
  const pc = await tx.projectContractor.findUniqueOrThrow({
    where: { id: params.projectContractorId },
    include: { organization: { select: { name: true } } },
  });
  await tx.projectContractor.update({
    where: { id: pc.id },
    data: { contractStatus: 'TERMINATED', terminatedAt: now, terminationCaseId: params.caseId },
  });
  const waived = await tx.projectContractMilestone.updateMany({
    where: { projectContractorId: pc.id, status: { in: OPEN_MILESTONE_STATUSES } },
    data: { status: 'WAIVED', waivedReason: 'Contract terminated', completedAt: now, completedByUserId: params.actor.userId },
  });
  await audit(tx, params.projectId, params.actor, 'CONTRACTOR_TERMINATED', `Terminated the contract of ${pc.organization.name} (${pc.tradeCode}): ${params.reason}. Waived ${waived.count} open milestone(s). Progress, retention and defect tickets stay.`, {
    projectContractorId: pc.id,
    caseId: params.caseId,
    waivedMilestones: waived.count,
  });
}

