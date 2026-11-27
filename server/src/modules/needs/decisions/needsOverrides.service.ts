import { Prisma } from '@prisma/client';
import {
  NEEDS_OPEN_PROPOSAL_STATUSES,
  NEEDS_OVERRIDE_SEPARATION_PERMISSION_KEY,
  NEEDS_SEPARATION_ERROR_MESSAGES,
  type NeedsProposalStatus,
  type NeedsSeparationAction,
  type ProposalFlagDto,
  type SeparationOverrideDecisionRequest,
  type SeparationOverrideDetails,
  type SeparationOverrideRequest,
} from '@insite/shared';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../middleware/error.middleware';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import { recordAuditEvent } from '../../audit/audit.service';
import { isUuid, loadCycleProposal, loadWritableCycle, webActor, type CycleRow } from '../needsAccess';
import { redactFlagsForViewer } from '../needsFlags.service';
import { serializeFlag } from '../needsSerializers';
import { lockCycle } from '../needsVersions';
import { holds, loadRuleFacts, pendingOverride, SEPARATION_ACTION_PERMISSION, separationFor, type OverrideFlagFact } from './proposalRules';

/**
 * Needs pipeline wave 3 (A1, D-N.9, plan 16.2 O-1): separation-of-duties overrides are a second
 * person's authorisation.
 *
 * - Ask (`POST /cycles/:cycleId/separation-overrides`): the asker holds the action's permission
 *   (VALIDATE: needs:validate, COST: needs:cost; the approval and funding actions are wave 4: 422
 *   NEEDS_OVERRIDE_ACTION_NOT_SUPPORTED) and is blocked now (409 NEEDS_OVERRIDE_NOT_NEEDED); one open
 *   request per proposal, action and asker (409 NEEDS_OVERRIDE_PENDING). An open SEPARATION_OVERRIDE
 *   flag records it (details `SeparationOverrideDetailsSchema`); audit
 *   NEEDS_SEPARATION_OVERRIDE_REQUESTED.
 * - Decide (`…/:flagId/decision`): a holder of needs:override_separation in the owning
 *   organisation, never the asker (409 NEEDS_OVERRIDE_SELF), on an open request (409
 *   NEEDS_OVERRIDE_DECIDED); the flag is resolved AUTHORISED or REFUSED; audit NEEDS_FLAG_RESOLVED.
 * - Use: an AUTHORISED flag lets the asker do the action while the proposal stays in the flag's stage
 *   (every step of that action in that stage). Each guarded step that goes ahead on it writes
 *   NEEDS_SEPARATION_OVERRIDDEN and the first sets `usedAt`; the flag stays on the proposal.
 */

type Tx = Prisma.TransactionClient;

/**
 * Review fix (wave 3): an override is asked for, and decided, only while the proposal is where the
 * guarded action happens (an authorisation counts in the stage it was asked in): VALIDATE at
 * Validation; COST at Costing, or a proposal returned at Prioritisation for a corrected costed version.
 */
export function overrideApplies(action: string, proposal: { stage: string; status: string }): boolean {
  if (action === 'VALIDATE') return proposal.stage === 'VALIDATION' && proposal.status === 'IN_PROGRESS';
  if (action === 'COST') return (proposal.stage === 'COSTING' && proposal.status === 'IN_PROGRESS') || (proposal.stage === 'PRIORITISATION' && proposal.status === 'RETURNED');
  return false;
}

export async function requestSeparationOverride(user: WebJwtPayload, cycleId: string, input: SeparationOverrideRequest): Promise<ProposalFlagDto> {
  const permission = SEPARATION_ACTION_PERMISSION[input.action];
  if (!permission) {
    throw new AppError('Overrides of approval and funding steps come with the approval chains', 422, 'NEEDS_OVERRIDE_ACTION_NOT_SUPPORTED');
  }
  if (!holds(user, permission)) throw new AppError(`Access requires permission(s): ${permission}`, 403, 'FORBIDDEN_PERMISSION');
  const flag = await prisma.$transaction(async (tx) => {
    const cycle = await loadWritableCycle(user, cycleId, tx);
    await lockCycle(tx, cycle.id);
    const proposal = await loadCycleProposal(cycle.id, input.proposalId, tx);
    if (!NEEDS_OPEN_PROPOSAL_STATUSES.includes(proposal.status as NeedsProposalStatus)) {
      throw new AppError(`${proposal.reference} is closed`, 409, 'NEEDS_STAGE_ACTION_NOT_ALLOWED');
    }
    if (!overrideApplies(input.action, proposal)) {
      throw new AppError(`${proposal.reference} is not at the step this override is for: ask when it is waiting for you`, 409, 'NEEDS_OVERRIDE_NOT_NEEDED');
    }
    const facts = await loadRuleFacts(tx, user, [], [proposal.id]);
    const { check } = separationFor(facts, proposal, input.action, user.userId);
    if (!check.violation || check.allowed) {
      throw new AppError('Nothing stops you from doing this: no override is needed', 409, 'NEEDS_OVERRIDE_NOT_NEEDED');
    }
    if (pendingOverride(facts.overrides.get(proposal.id) ?? [], input.action, user.userId)) {
      throw new AppError('You have already asked for this override; it waits for a decision', 409, 'NEEDS_OVERRIDE_PENDING');
    }
    const details: SeparationOverrideDetails = {
      action: input.action,
      violation: check.violation,
      requestedByUserId: user.userId,
      requestedByName: user.fullName,
      reason: input.reason,
      stage: proposal.stage as SeparationOverrideDetails['stage'],
      usedAt: null,
    };
    const created = await tx.needsProposalFlag.create({
      data: {
        proposalId: proposal.id,
        kind: 'SEPARATION_OVERRIDE',
        detailsJson: details as unknown as Prisma.InputJsonValue,
        raisedOnVersionId: proposal.currentVersionId,
        raisedOnVersionNumber: proposal.currentVersionId
          ? ((await tx.needsAssessmentVersion.findUnique({ where: { id: proposal.currentVersionId }, select: { number: true } }))?.number ?? null)
          : null,
      },
    });
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_SEPARATION_OVERRIDE_REQUESTED',
      summaryText: `Asked for a separation-of-duties override to ${actionWords(input.action)} ${proposal.reference}: ${input.reason}`,
      payload: { cycleId: cycle.id, proposalId: proposal.id, reference: proposal.reference, flagId: created.id, action: input.action, violation: check.violation, reason: input.reason },
    });
    return created;
  });
  return (await redactFlagsForViewer(user, [serializeFlag(flag)]))[0];
}

export async function decideSeparationOverride(user: WebJwtPayload, cycleId: string, flagId: string, input: SeparationOverrideDecisionRequest): Promise<ProposalFlagDto> {
  if (!holds(user, NEEDS_OVERRIDE_SEPARATION_PERMISSION_KEY)) {
    throw new AppError(`Access requires permission(s): ${NEEDS_OVERRIDE_SEPARATION_PERMISSION_KEY}`, 403, 'FORBIDDEN_PERMISSION');
  }
  const flag = await prisma.$transaction(async (tx) => {
    const cycle = await loadWritableCycle(user, cycleId, tx);
    await lockCycle(tx, cycle.id);
    const row = isUuid(flagId)
      ? await tx.needsProposalFlag.findFirst({ where: { id: flagId, kind: 'SEPARATION_OVERRIDE', proposal: { cycleId: cycle.id } }, include: { proposal: true } })
      : null;
    if (!row) throw new AppError('Override request not found', 404, 'NEEDS_FLAG_NOT_FOUND');
    if (row.resolvedAt) throw new AppError('This override request has already been decided', 409, 'NEEDS_OVERRIDE_DECIDED');
    const details = row.detailsJson as unknown as SeparationOverrideDetails;
    if (details.requestedByUserId === user.userId) {
      throw new AppError('Another person must decide your own override request', 409, 'NEEDS_OVERRIDE_SELF');
    }
    if (input.decision === 'AUTHORISED' && (details.stage !== row.proposal.stage || !overrideApplies(details.action, row.proposal))) {
      throw new AppError(`${row.proposal.reference} has moved on since the override was asked for: it could not be used. Refuse it, and the asker asks again if still needed`, 409, 'NEEDS_OVERRIDE_STALE');
    }
    const note = input.note ?? (input.decision === 'AUTHORISED' ? 'Override authorised.' : 'Override refused.');
    const updated = await tx.needsProposalFlag.update({
      where: { id: row.id },
      data: { resolvedAt: new Date(), resolvedByUserId: user.userId, resolvedByName: user.fullName, resolution: input.decision, resolutionReason: note },
    });
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_FLAG_RESOLVED',
      summaryText: `${input.decision === 'AUTHORISED' ? 'Authorised' : 'Refused'} ${details.requestedByName}'s separation-of-duties override to ${actionWords(details.action)} ${row.proposal.reference}: ${note}`,
      payload: {
        cycleId: cycle.id,
        proposalId: row.proposalId,
        reference: row.proposal.reference,
        flagId: row.id,
        kind: 'SEPARATION_OVERRIDE',
        resolution: input.decision,
        action: details.action,
        requestedByUserId: details.requestedByUserId,
        note,
      },
    });
    return updated;
  });
  return (await redactFlagsForViewer(user, [serializeFlag(flag)]))[0];
}

/**
 * A guarded step goes ahead on an authorisation: ledger entry NEEDS_SEPARATION_OVERRIDDEN and, the
 * first time, `usedAt` on the flag. Call in the step's transaction.
 */
export async function recordOverrideUseInTx(
  tx: Tx,
  user: WebJwtPayload,
  cycle: Pick<CycleRow, 'id'>,
  proposal: { id: string; reference: string },
  flag: OverrideFlagFact,
  step: string
): Promise<void> {
  if (!flag.details.usedAt) {
    const details: SeparationOverrideDetails = { ...flag.details, usedAt: new Date().toISOString() };
    await tx.needsProposalFlag.update({ where: { id: flag.id }, data: { detailsJson: details as unknown as Prisma.InputJsonValue } });
    flag.details = details;
  }
  await recordAuditEvent(tx, {
    tenantId: user.tenantId,
    projectId: null,
    ...webActor(user),
    action: 'NEEDS_SEPARATION_OVERRIDDEN',
    summaryText: `${step} on ${proposal.reference} despite the separation of duties (${NEEDS_SEPARATION_ERROR_MESSAGES[flag.details.violation]}), on the override ${flag.resolvedByName ?? 'another person'} authorised.`,
    payload: {
      cycleId: cycle.id,
      proposalId: proposal.id,
      reference: proposal.reference,
      flagId: flag.id,
      action: flag.details.action,
      violation: flag.details.violation,
      authorisedByUserId: flag.resolvedByUserId,
      step,
    },
  });
}

function actionWords(action: NeedsSeparationAction): string {
  switch (action) {
    case 'VALIDATE':
      return 'validate';
    case 'COST':
      return 'cost';
    case 'APPROVE_STEP':
      return 'approve a step of';
    case 'CONFIRM_FUNDING':
      return 'confirm the funding of';
    default:
      return 'act on';
  }
}
