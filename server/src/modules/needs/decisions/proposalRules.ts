import {
  NEEDS_OVERRIDE_SEPARATION_PERMISSION_KEY,
  SeparationOverrideDetailsSchema,
  allowedProposalActions,
  checkSeparation,
  type NeedsPipelineConfig,
  type NeedsProposalAction,
  type NeedsProposalStatus,
  type NeedsSeparationAction,
  type NeedsSeparationErrorCode,
  type NeedsStage,
  type SeparationAuthorisation,
  type SeparationCheck,
  type SeparationOverrideDetails,
} from '@insite/shared';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import type { CycleRow, Db } from '../needsAccess';
import { dutyHistories, loadCommittee, memberRecusals, scoringState, type CommitteeMemberFacts, type ProposalDutyHistory, type ScoringState } from '../needsFacts';

/**
 * Needs pipeline wave 3 (A1, A7): the server's narrowing of `allowedProposalActions`, shared by the
 * stage work routes, the proposal reads ("allowed actions", "waiting for me", tasks) and the task
 * queue, so the buttons, the queue and the 409s agree.
 *
 * - The viewer writes for the cycle: its owning organisation (platform super admins: any) and an
 *   OPEN cycle; otherwise nothing is allowed.
 * - Separation of duties (plan section 7): RECORD_VALIDATION is the VALIDATE action;
 *   UPLOAD_COSTED_VERSION and SIGN_OFF_COSTING are COST. A violation without an authorisation
 *   removes the action and lists it as blocked ("Ask for a separation-of-duties override").
 * - An authorisation (16.2 O-1) is a SEPARATION_OVERRIDE flag resolved AUTHORISED by another holder
 *   of `needs:override_separation`, for this action and asker, while the proposal is still in the
 *   flag's stage.
 * - SCORE: a committee member holding `needs:score`, not recused, before the ranking is finalised.
 *   FINALISE_PRIORITISATION: the committee's chair (or a chair-permission holder while there is no
 *   committee yet).
 */

export interface RuleProposal {
  id: string;
  stage: string;
  status: string;
}

export interface OverrideFlagFact {
  id: string;
  proposalId: string;
  details: SeparationOverrideDetails;
  resolvedAt: Date | null;
  resolution: string | null;
  resolvedByUserId: string | null;
  resolvedByName: string | null;
  /** The resolver's permissions now (from their role). */
  authoriserPermissionKeys: string[];
}

export interface CommitteeView {
  members: CommitteeMemberFacts[];
  state: ScoringState;
  /** The viewer's member row, if any. */
  me: CommitteeMemberFacts | null;
  /** Proposals the viewer is recused from. */
  recusedIds: Set<string>;
  /** Proposals the viewer has a score sheet for. */
  myScoredIds: Set<string>;
}

export interface RuleFacts {
  histories: Map<string, ProposalDutyHistory>;
  overrides: Map<string, OverrideFlagFact[]>;
  /** Per cycle id (loaded for the viewer). */
  committees: Map<string, CommitteeView>;
}

export const SEPARATION_ACTION_PERMISSION: Partial<Record<NeedsSeparationAction, string>> = {
  VALIDATE: 'needs:validate',
  COST: 'needs:cost',
};

/** The guarded action an allowed proposal action is, if any. */
export function separationActionOf(action: NeedsProposalAction): NeedsSeparationAction | null {
  if (action === 'RECORD_VALIDATION') return 'VALIDATE';
  if (action === 'UPLOAD_COSTED_VERSION' || action === 'SIGN_OFF_COSTING') return 'COST';
  return null;
}

/** The viewer writes for the cycle (owning organisation, open). */
export function canWriteCycle(user: WebJwtPayload, cycle: Pick<CycleRow, 'owningOrganizationId' | 'status'>): boolean {
  return cycle.status === 'OPEN' && (user.isPlatformSuperAdmin || cycle.owningOrganizationId === user.organizationId);
}

/** Every SEPARATION_OVERRIDE flag of the proposals, with the resolvers' current permissions. */
export async function loadOverrideFlags(db: Db, proposalIds: readonly string[]): Promise<Map<string, OverrideFlagFact[]>> {
  const out = new Map<string, OverrideFlagFact[]>(proposalIds.map((id) => [id, []]));
  if (!proposalIds.length) return out;
  const rows = await db.needsProposalFlag.findMany({ where: { proposalId: { in: [...proposalIds] }, kind: 'SEPARATION_OVERRIDE' }, orderBy: { raisedAt: 'asc' } });
  const resolverIds = [...new Set(rows.map((r) => r.resolvedByUserId).filter((id): id is string => Boolean(id)))];
  const resolvers = resolverIds.length
    ? await db.user.findMany({
        where: { id: { in: resolverIds } },
        select: { id: true, isPlatformSuperAdmin: true, role: { select: { rolePermissions: { select: { permission: { select: { key: true } } } } } } },
      })
    : [];
  const keysOf = new Map(
    resolvers.map((u) => [u.id, [...u.role.rolePermissions.map((rp) => rp.permission.key), ...(u.isPlatformSuperAdmin ? [NEEDS_OVERRIDE_SEPARATION_PERMISSION_KEY] : [])]])
  );
  for (const r of rows) {
    const details = SeparationOverrideDetailsSchema.safeParse(r.detailsJson);
    if (!details.success) continue;
    out.get(r.proposalId)?.push({
      id: r.id,
      proposalId: r.proposalId,
      details: details.data,
      resolvedAt: r.resolvedAt,
      resolution: r.resolution,
      resolvedByUserId: r.resolvedByUserId,
      resolvedByName: r.resolvedByName,
      // Review fix (wave 3): the authoriser's permissions when they decided (contract of
      // SeparationAuthorisation): the decision route required needs:override_separation, so an
      // AUTHORISED flag carries it even if the authoriser's role changed since.
      authoriserPermissionKeys: r.resolution === 'AUTHORISED' ? [NEEDS_OVERRIDE_SEPARATION_PERMISSION_KEY] : r.resolvedByUserId ? (keysOf.get(r.resolvedByUserId) ?? []) : [],
    });
  }
  return out;
}

/** The committee as one viewer sees it (membership, recusals over `histories`, own sheets). */
export async function loadCommitteeView(db: Db, cycle: CycleRow, user: WebJwtPayload, histories: ReadonlyMap<string, ProposalDutyHistory>): Promise<CommitteeView> {
  const members = await loadCommittee(db, cycle.id);
  const me = members.find((m) => m.userId === user.userId) ?? null;
  const recusedIds = new Set(me ? memberRecusals(me, histories).map((r) => r.proposalId) : []);
  const sheets = me ? await db.needsScoreSheet.findMany({ where: { memberId: me.id }, select: { proposalId: true } }) : [];
  return { members, state: scoringState(cycle), me, recusedIds, myScoredIds: new Set(sheets.map((s) => s.proposalId)) };
}

/** Facts for the narrowing of many proposals (batched: a handful of queries whatever the count). */
export async function loadRuleFacts(db: Db, user: WebJwtPayload, cycles: readonly CycleRow[], proposalIds: readonly string[]): Promise<RuleFacts> {
  const [histories, overrides] = await Promise.all([dutyHistories(db, proposalIds), loadOverrideFlags(db, proposalIds)]);
  const committees = new Map<string, CommitteeView>();
  for (const cycle of cycles) committees.set(cycle.id, await loadCommitteeView(db, cycle, user, histories));
  return { histories, overrides, committees };
}

export const EMPTY_HISTORY: ProposalDutyHistory = { uploaderUserIds: [], validatorUserIds: [], costerUserIds: [] };

/** The authorisation that lets `actorUserId` do `action` on the proposal now, with its flag. */
export function authorisationFor(
  overrides: readonly OverrideFlagFact[],
  proposal: Pick<RuleProposal, 'stage'>,
  action: NeedsSeparationAction,
  actorUserId: string
): { flag: OverrideFlagFact; authorisation: SeparationAuthorisation } | null {
  const flag = [...overrides]
    .reverse()
    .find((f) => f.resolution === 'AUTHORISED' && f.details.action === action && f.details.requestedByUserId === actorUserId && f.details.stage === proposal.stage && f.resolvedByUserId);
  if (!flag) return null;
  return {
    flag,
    authorisation: {
      action,
      requestedByUserId: flag.details.requestedByUserId,
      reason: flag.details.reason,
      authorisedByUserId: flag.resolvedByUserId as string,
      authoriserPermissionKeys: flag.authoriserPermissionKeys,
    },
  };
}

export interface SeparationResult {
  check: SeparationCheck;
  /** The authorisation flag used when `check.overridden`. */
  flag: OverrideFlagFact | null;
}

/** The separation rule for one actor, action and proposal, with any authorisation. */
export function separationFor(facts: Pick<RuleFacts, 'histories' | 'overrides'>, proposal: RuleProposal, action: NeedsSeparationAction, actorUserId: string): SeparationResult {
  const history = facts.histories.get(proposal.id) ?? EMPTY_HISTORY;
  const auth = authorisationFor(facts.overrides.get(proposal.id) ?? [], proposal, action, actorUserId);
  const check = checkSeparation(action, actorUserId, history, auth?.authorisation ?? null);
  return { check, flag: check.overridden ? (auth?.flag ?? null) : null };
}

/** The open override request of `actorUserId` for `action` on the proposal, if any. */
export function pendingOverride(overrides: readonly OverrideFlagFact[], action: NeedsSeparationAction, actorUserId: string): OverrideFlagFact | null {
  return overrides.find((f) => !f.resolvedAt && f.details.action === action && f.details.requestedByUserId === actorUserId) ?? null;
}

export interface NarrowedActions {
  allowed: NeedsProposalAction[];
  /** Actions the viewer would have but for separation of duties (no valid authorisation). */
  blocked: Array<{ action: NeedsProposalAction; separationAction: NeedsSeparationAction; violation: NeedsSeparationErrorCode }>;
}

export function narrowActions(user: WebJwtPayload, cycle: CycleRow, config: NeedsPipelineConfig, proposal: RuleProposal, facts: RuleFacts): NarrowedActions {
  if (!canWriteCycle(user, cycle)) return { allowed: [], blocked: [] };
  const stage = proposal.stage as NeedsStage;
  const status = proposal.status as NeedsProposalStatus;
  const base = allowedProposalActions({ stage, status }, config, user.isPlatformSuperAdmin ? allPermissionsOf(user, config) : user.permissions);
  const committee = facts.committees.get(cycle.id) ?? null;
  const allowed: NeedsProposalAction[] = [];
  const blocked: NarrowedActions['blocked'] = [];
  for (const action of base) {
    const sep = separationActionOf(action);
    if (sep) {
      const { check } = separationFor(facts, proposal, sep, user.userId);
      if (!check.allowed) {
        blocked.push({ action, separationAction: sep, violation: check.violation! });
        continue;
      }
    }
    if (action === 'SCORE') {
      const me = committee?.me;
      if (!me || !me.permissionKeys.includes('needs:score') || committee.recusedIds.has(proposal.id) || committee.state === 'FINALISED') continue;
    }
    // Review fix (wave 3): the committee's chair alone finalises and returns at Prioritisation (a
    // committee must exist; finalise and return refuse anyone else), and nothing moves after finalisation.
    if ((action === 'FINALISE_PRIORITISATION' || (action === 'RETURN' && stage === 'PRIORITISATION')) && (committee?.me?.role !== 'CHAIR' || committee.state === 'FINALISED')) continue;
    if ((action === 'RESUBMIT' || action === 'UPLOAD_COSTED_VERSION') && stage === 'PRIORITISATION' && cycle.rankingFinalisedAt) continue;
    allowed.push(action);
  }
  return { allowed, blocked };
}

/** A platform super admin acts as a holder of every permission the pipeline names. */
function allPermissionsOf(user: WebJwtPayload, config: NeedsPipelineConfig): string[] {
  const keys = new Set(user.permissions);
  for (const s of config.stages) if (s.actorPermissionKey) keys.add(s.actorPermissionKey);
  ['needs:submit', 'needs:validate', 'needs:cost', 'needs:score', 'needs:chair_committee', 'needs:manage_cycle', 'needs:submit_portfolio', 'needs:record_funding', 'needs:prepare_beap', NEEDS_OVERRIDE_SEPARATION_PERMISSION_KEY].forEach((k) =>
    keys.add(k)
  );
  return [...keys];
}

/** The viewer holds a permission (platform super admins hold every one). */
export const holds = (user: WebJwtPayload, key: string) => user.isPlatformSuperAdmin || user.permissions.includes(key);
