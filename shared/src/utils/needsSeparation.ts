import type { NeedsSeparationErrorCode, RecusalReason } from '../schemas/needsPipeline.schema';

/**
 * Needs pipeline N1: separation of duties (plan section 7, D-N.9). Pure; the services of waves 3–4
 * call it before a decision is written and answer 409 with the code. Where a SUBEB lacks people, a
 * holder of `needs:override_separation` may proceed with a reason; the service then raises the flag
 * `SEPARATION_OVERRIDE` on the proposal and writes `NEEDS_SEPARATION_OVERRIDDEN` to the ledger.
 */

export const NEEDS_OVERRIDE_SEPARATION_PERMISSION_KEY = 'needs:override_separation';

/** The guarded actions. */
export type NeedsSeparationAction = 'VALIDATE' | 'COST' | 'APPROVE_STEP' | 'CONFIRM_FUNDING';

/** Who has done what so far, as user ids. Lists the action does not need may be left out. */
export interface NeedsSeparationHistory {
  /** Uploaders of any version of the proposal. */
  uploaderUserIds?: readonly string[];
  /** Everyone who recorded a validation of the proposal. */
  validatorUserIds?: readonly string[];
  /** Everyone who uploaded or signed off a costed version. */
  costerUserIds?: readonly string[];
  /** Who submitted the list (portfolio, BEAP, out-of-cycle request) now in its chain. */
  submitterUserId?: string | null;
  /** Who approved a step of this chain in the current pass (since the last return). */
  chainApproverUserIds?: readonly string[];
  /** Who approved a step of the portfolio the funding is recorded for. */
  portfolioApproverUserIds?: readonly string[];
}

/**
 * The rule the actor would break, or null when they may act:
 * - VALIDATE: not by an uploader of any version (SAME_PERSON_VALIDATION);
 * - COST: not by a validator (SAME_PERSON_COSTING);
 * - APPROVE_STEP: not by the submitter of the list, nor twice by one person in one chain
 *   (SAME_PERSON_APPROVAL);
 * - CONFIRM_FUNDING: not by someone who approved the portfolio (SAME_PERSON_FUNDING).
 */
export function separationViolation(
  action: NeedsSeparationAction,
  actorUserId: string,
  history: NeedsSeparationHistory
): NeedsSeparationErrorCode | null {
  const includes = (ids: readonly string[] | undefined) => Boolean(ids?.includes(actorUserId));
  switch (action) {
    case 'VALIDATE':
      return includes(history.uploaderUserIds) ? 'SAME_PERSON_VALIDATION' : null;
    case 'COST':
      return includes(history.validatorUserIds) ? 'SAME_PERSON_COSTING' : null;
    case 'APPROVE_STEP':
      return history.submitterUserId === actorUserId || includes(history.chainApproverUserIds) ? 'SAME_PERSON_APPROVAL' : null;
    case 'CONFIRM_FUNDING':
      return includes(history.portfolioApproverUserIds) ? 'SAME_PERSON_FUNDING' : null;
    default:
      return null;
  }
}

export interface SeparationCheck {
  /** The rule broken; null when none. */
  violation: NeedsSeparationErrorCode | null;
  /** The action may go ahead (no violation, or a valid override). */
  allowed: boolean;
  /** The action goes ahead on an override: raise the flag and the ledger entry. */
  overridden: boolean;
}

/** The rule plus the D-N.9 override: a violation is passed only with the permission and a reason. */
export function checkSeparation(
  action: NeedsSeparationAction,
  actorUserId: string,
  history: NeedsSeparationHistory,
  override: { permissionKeys: readonly string[]; reason: string | null | undefined }
): SeparationCheck {
  const violation = separationViolation(action, actorUserId, history);
  if (!violation) return { violation: null, allowed: true, overridden: false };
  const overridden =
    override.permissionKeys.includes(NEEDS_OVERRIDE_SEPARATION_PERMISSION_KEY) && Boolean(override.reason && override.reason.trim().length > 0);
  return { violation, allowed: overridden, overridden };
}

export interface RecusalProposal {
  id: string;
  uploaderUserIds?: readonly string[];
  validatorUserIds?: readonly string[];
  costerUserIds?: readonly string[];
}

export interface RecusalDeclaration {
  memberUserId: string;
  conflictedProposalIds: readonly string[];
}

/**
 * The proposals a committee member does not score, each with the first reason that applies: they
 * uploaded, validated or costed it, or named it in their conflict declaration. A recused member is
 * left out of that proposal's scoring and quorum; the recusal is recorded.
 */
export function recusalsFor(
  memberUserId: string,
  proposals: readonly RecusalProposal[],
  declarations: readonly RecusalDeclaration[]
): Array<{ proposalId: string; reason: RecusalReason }> {
  const declared = new Set(declarations.filter((d) => d.memberUserId === memberUserId).flatMap((d) => d.conflictedProposalIds));
  const out: Array<{ proposalId: string; reason: RecusalReason }> = [];
  for (const p of proposals) {
    let reason: RecusalReason | null = null;
    if (p.uploaderUserIds?.includes(memberUserId)) reason = 'UPLOADED';
    else if (p.validatorUserIds?.includes(memberUserId)) reason = 'VALIDATED';
    else if (p.costerUserIds?.includes(memberUserId)) reason = 'COSTED';
    else if (declared.has(p.id)) reason = 'DECLARED_CONFLICT';
    if (reason) out.push({ proposalId: p.id, reason });
  }
  return out;
}
