import { recusalsFor, type RecusalReason } from '@insite/shared';
import type { CycleRow, Db } from './needsAccess';

/**
 * Needs pipeline wave 3 (main thread seam): facts the stage work (Track A: separation of duties,
 * task queue) and the committee (Track B: recusals, scoring) both read. Owned by the main thread;
 * ask before changing a signature.
 *
 * Who did what on a proposal (plan section 7):
 * - uploaders: everyone who uploaded a version with content of their own (UPLOAD, CORRECTION,
 *   BEAP_REVISION). A CARRY_FORWARD version is written by whoever opened the next cycle and a
 *   COSTING version by the quantity surveyor: neither counts as an upload here;
 * - validators: everyone who recorded a validation record, or decided ADVANCE at Validation;
 * - costers: everyone who uploaded a COSTING version, or decided ADVANCE at Costing (sign-off).
 */

export interface ProposalDutyHistory {
  uploaderUserIds: string[];
  validatorUserIds: string[];
  costerUserIds: string[];
}

const UPLOAD_SOURCES = ['UPLOAD', 'CORRECTION', 'BEAP_REVISION'];

/** The duty history of each proposal (one entry per id asked, empty lists when nothing was done). */
export async function dutyHistories(db: Db, proposalIds: readonly string[]): Promise<Map<string, ProposalDutyHistory>> {
  const out = new Map<string, ProposalDutyHistory>(proposalIds.map((id) => [id, { uploaderUserIds: [], validatorUserIds: [], costerUserIds: [] }]));
  if (proposalIds.length === 0) return out;
  const ids = [...proposalIds];
  const [versions, records, items] = await Promise.all([
    db.needsAssessmentVersion.findMany({ where: { proposalId: { in: ids } }, select: { proposalId: true, source: true, uploadedByUserId: true } }),
    db.needsValidationRecord.findMany({ where: { proposalId: { in: ids } }, select: { proposalId: true, recordedByUserId: true } }),
    db.needsStageDecisionItem.findMany({
      where: { proposalId: { in: ids }, outcome: 'ADVANCE', decision: { stage: { in: ['VALIDATION', 'COSTING'] } } },
      select: { proposalId: true, decision: { select: { stage: true, decidedByUserId: true } } },
    }),
  ]);
  const add = (list: string[], userId: string) => {
    if (!list.includes(userId)) list.push(userId);
  };
  for (const v of versions) {
    const h = out.get(v.proposalId)!;
    if (UPLOAD_SOURCES.includes(v.source)) add(h.uploaderUserIds, v.uploadedByUserId);
    if (v.source === 'COSTING') add(h.costerUserIds, v.uploadedByUserId);
  }
  for (const r of records) add(out.get(r.proposalId)!.validatorUserIds, r.recordedByUserId);
  for (const i of items) {
    const h = out.get(i.proposalId)!;
    add(i.decision.stage === 'VALIDATION' ? h.validatorUserIds : h.costerUserIds, i.decision.decidedByUserId);
  }
  return out;
}

export interface CommitteeMemberFacts {
  id: string;
  userId: string;
  fullName: string;
  roleName: string;
  /** The member's current permissions (from their role). */
  permissionKeys: string[];
  role: 'CHAIR' | 'MEMBER';
  conflictDeclaredAt: Date | null;
  conflictStatement: string | null;
  conflictedProposalIds: string[];
}

/** The cycle's committee, chair first, then by name. */
export async function loadCommittee(db: Db, cycleId: string): Promise<CommitteeMemberFacts[]> {
  const rows = await db.needsCommitteeMember.findMany({
    where: { cycleId },
    include: { user: { select: { fullName: true, role: { select: { name: true, rolePermissions: { select: { permission: { select: { key: true } } } } } } } } },
  });
  return rows
    .map((m) => ({
      id: m.id,
      userId: m.userId,
      fullName: m.user.fullName,
      roleName: m.user.role.name,
      permissionKeys: m.user.role.rolePermissions.map((rp) => rp.permission.key),
      role: (m.role === 'CHAIR' ? 'CHAIR' : 'MEMBER') as 'CHAIR' | 'MEMBER',
      conflictDeclaredAt: m.conflictDeclaredAt,
      conflictStatement: m.conflictStatement,
      conflictedProposalIds: m.conflictedProposalIds,
    }))
    .sort((a, b) => (a.role === b.role ? a.fullName.localeCompare(b.fullName) : a.role === 'CHAIR' ? -1 : 1));
}

/** The proposals a member does not score (`recusalsFor` over the duty histories and their own declaration). */
export function memberRecusals(
  member: Pick<CommitteeMemberFacts, 'userId' | 'conflictedProposalIds'>,
  histories: ReadonlyMap<string, ProposalDutyHistory>
): Array<{ proposalId: string; reason: RecusalReason }> {
  const proposals = [...histories.entries()].map(([id, h]) => ({ id, ...h }));
  return recusalsFor(member.userId, proposals, [{ memberUserId: member.userId, conflictedProposalIds: member.conflictedProposalIds }]);
}

export type ScoringState = 'NOT_OPEN' | 'OPEN' | 'CLOSED' | 'FINALISED';

/** Where the cycle's scoring is: not opened, open, closed by the chair, or finalised. */
export function scoringState(cycle: Pick<CycleRow, 'scoringOpenedAt' | 'scoringClosedAt' | 'rankingFinalisedAt'>): ScoringState {
  if (cycle.rankingFinalisedAt) return 'FINALISED';
  if (cycle.scoringClosedAt) return 'CLOSED';
  if (cycle.scoringOpenedAt) return 'OPEN';
  return 'NOT_OPEN';
}

/** The proposals of a cycle waiting at Prioritisation (in progress), in reference order. */
export async function proposalsAtPrioritisation(db: Db, cycleId: string) {
  return db.needsProposal.findMany({ where: { cycleId, stage: 'PRIORITISATION', status: 'IN_PROGRESS' }, orderBy: { sequence: 'asc' } });
}
