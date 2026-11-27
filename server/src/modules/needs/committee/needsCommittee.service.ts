import { Prisma } from '@prisma/client';
import {
  type CommitteeScoringRequest,
  type ConflictDeclarationRequest,
  type NeedsCommitteeDto,
  type NeedsCycleDocumentDto,
  type NeedsDocumentPresignRequest,
  type NeedsPresignedUploadDto,
  type RegisterCycleDocumentRequest,
  type SetCommitteeRequest,
} from '@insite/shared';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../middleware/error.middleware';
import type { WebJwtPayload } from '../../../middleware/auth.middleware';
import { recordAuditEvent } from '../../audit/audit.service';
import { assertCycleWritable, loadVisibleCycle, webActor, type CycleRow } from '../needsAccess';
import { presignNeedsDocument, registerCycleDocument } from '../needsCycles.service';
import { lockCycle } from '../needsVersions';
import {
  CHAIR_PERMISSION,
  FINALISED,
  NOT_CHAIR,
  NOT_MEMBER,
  SCORE_PERMISSION,
  assertChair,
  loadScoringPicture,
  memberOf,
  viewerManages,
  type ScoringPicture,
} from './committeeFacts';
import { refreshLiveScoresInTx } from './needsScoreSheets.service';

/**
 * Needs pipeline wave 3, Track B (B1): the cycle's committee (D-N.10, plan section 7).
 *
 * - The chair (a holder of `needs:chair_committee` in the owning organisation) sets the membership and
 *   is the CHAIR row; members hold `needs:score` and belong to the owning organisation. Once a
 *   committee exists, only its chair changes it. A member with score sheets cannot be removed.
 * - Each member declares conflicts of interest; a newly declared conflict deletes that member's sheets
 *   on those proposals. Declarations can change until finalisation.
 * - The chair opens scoring once every member has declared and at least `rubric.quorum` members hold
 *   `needs:score`; closing freezes the sheets; opening again reopens them.
 *
 * Ledger: the tenant's (`projectId` null), `cycleId` in every payload.
 */

type Tx = Prisma.TransactionClient;

const cycleLabel = (c: Pick<CycleRow, 'interventionYear' | 'stateCode'>) => `${c.interventionYear}${c.stateCode ? ` (${c.stateCode})` : ''}`;

export function committeeDto(user: WebJwtPayload, picture: ScoringPicture, candidates: NeedsCommitteeDto['candidates']): NeedsCommitteeDto {
  const { cycle } = picture;
  const me = memberOf(picture, user.userId);
  return {
    cycleId: cycle.id,
    members: picture.members.map((m) => ({
      id: m.id,
      cycleId: cycle.id,
      userId: m.userId,
      fullName: m.fullName,
      roleName: m.roleName,
      role: m.role,
      conflictDeclaredAt: m.conflictDeclaredAt ? m.conflictDeclaredAt.toISOString() : null,
      conflictStatement: m.conflictStatement,
      conflictedProposalIds: m.conflictedProposalIds,
      recusals: [...m.recusals.entries()].map(([proposalId, reason]) => ({ proposalId, reason })),
      scoredCount: m.canScore ? picture.proposals.filter((p) => !m.recusals.has(p.proposal.id) && p.sheets.some((s) => s.memberId === m.id)).length : 0,
      toScoreCount: m.canScore ? picture.proposals.filter((p) => !m.recusals.has(p.proposal.id)).length : 0,
    })),
    candidates,
    quorum: picture.rubric.quorum,
    divergenceThreshold: picture.rubric.divergenceThreshold,
    proposalCount: cycle.rankingFinalisedAt ? 0 : picture.proposals.length,
    scoringOpenedAt: cycle.scoringOpenedAt ? cycle.scoringOpenedAt.toISOString() : null,
    scoringOpenedByName: cycle.scoringOpenedByName,
    scoringClosedAt: cycle.scoringClosedAt ? cycle.scoringClosedAt.toISOString() : null,
    rankingFinalisedAt: cycle.rankingFinalisedAt ? cycle.rankingFinalisedAt.toISOString() : null,
    rankingFinalisedByName: cycle.rankingFinalisedByName,
    me: me ? { memberId: me.id, role: me.role, declared: me.conflictDeclaredAt !== null } : null,
    canManage: viewerManages(user, picture),
  };
}

/** Active people of the owning organisation who may score or chair. */
async function loadCandidates(cycle: CycleRow): Promise<NeedsCommitteeDto['candidates']> {
  const users = await prisma.user.findMany({
    where: {
      tenantId: cycle.tenantId,
      organizationId: cycle.owningOrganizationId,
      isActive: true,
      role: { rolePermissions: { some: { permission: { key: { in: [SCORE_PERMISSION, CHAIR_PERMISSION] } } } } },
    },
    select: { id: true, fullName: true, role: { select: { name: true, rolePermissions: { select: { permission: { select: { key: true } } } } } } },
    orderBy: { fullName: 'asc' },
  });
  return users.map((u) => {
    const keys = u.role.rolePermissions.map((rp) => rp.permission.key);
    return { userId: u.id, fullName: u.fullName, roleName: u.role.name, canScore: keys.includes(SCORE_PERMISSION), canChair: keys.includes(CHAIR_PERMISSION) };
  });
}

export async function getCommittee(user: WebJwtPayload, cycleId: string): Promise<NeedsCommitteeDto> {
  const cycle = await loadVisibleCycle(user, cycleId);
  const [picture, candidates] = await Promise.all([loadScoringPicture(prisma, cycle), loadCandidates(cycle)]);
  return committeeDto(user, picture, candidates);
}

/** Re-reads the cycle under its lock (writes serialise per cycle, as uploads and cycle changes do). */
async function lockedCycle(tx: Tx, user: WebJwtPayload, cycleId: string): Promise<CycleRow> {
  await lockCycle(tx, cycleId);
  const cycle = await tx.needsCycle.findUniqueOrThrow({ where: { id: cycleId } });
  assertCycleWritable(user, cycle);
  return cycle;
}

export async function setCommittee(user: WebJwtPayload, cycleId: string, input: SetCommitteeRequest): Promise<NeedsCommitteeDto> {
  const visible = await loadVisibleCycle(user, cycleId);
  assertCycleWritable(user, visible);
  const chairRow = input.members.find((m) => m.role === 'CHAIR')!;
  if (chairRow.userId !== user.userId) {
    throw new AppError('You set the committee as its chair: the chair row must be you', 422, 'NEEDS_COMMITTEE_MEMBER_INVALID', { userIds: [chairRow.userId] });
  }
  await prisma.$transaction(async (tx) => {
    const cycle = await lockedCycle(tx, user, cycleId);
    if (cycle.rankingFinalisedAt) throw FINALISED();
    const existing = await tx.needsCommitteeMember.findMany({ where: { cycleId }, include: { _count: { select: { scoreSheets: true } } } });
    const currentChair = existing.find((m) => m.role === 'CHAIR');
    if (currentChair && currentChair.userId !== user.userId) throw NOT_CHAIR();

    const userIds = input.members.map((m) => m.userId);
    const people = await tx.user.findMany({
      where: { id: { in: userIds }, tenantId: user.tenantId },
      select: { id: true, fullName: true, isActive: true, organizationId: true, role: { select: { rolePermissions: { select: { permission: { select: { key: true } } } } } } },
    });
    const byId = new Map(people.map((p) => [p.id, p]));
    const invalid = input.members.filter((m) => {
      const p = byId.get(m.userId);
      if (!p || !p.isActive || p.organizationId !== cycle.owningOrganizationId) return true;
      const keys = p.role.rolePermissions.map((rp) => rp.permission.key);
      return m.role === 'MEMBER' ? !keys.includes(SCORE_PERMISSION) : false;
    });
    if (invalid.length) {
      throw new AppError(
        'Committee members are active people of the owning organisation who hold the scoring permission',
        422,
        'NEEDS_COMMITTEE_MEMBER_INVALID',
        { userIds: invalid.map((m) => m.userId) }
      );
    }

    const keep = new Set(userIds);
    const removed = existing.filter((m) => !keep.has(m.userId));
    const withScores = removed.filter((m) => m._count.scoreSheets > 0);
    if (withScores.length) {
      throw new AppError('A member who has scored cannot be removed from the committee', 409, 'NEEDS_COMMITTEE_MEMBER_HAS_SCORES', { userIds: withScores.map((m) => m.userId) });
    }
    if (removed.length) await tx.needsCommitteeMember.deleteMany({ where: { id: { in: removed.map((m) => m.id) } } });
    const existingByUser = new Map(existing.map((m) => [m.userId, m]));
    const added: string[] = [];
    for (const m of input.members) {
      const row = existingByUser.get(m.userId);
      if (!row) {
        await tx.needsCommitteeMember.create({ data: { cycleId, userId: m.userId, role: m.role, addedByUserId: user.userId } });
        added.push(m.userId);
      } else if (row.role !== m.role) {
        await tx.needsCommitteeMember.update({ where: { id: row.id }, data: { role: m.role } });
      }
    }
    const name = (id: string) => byId.get(id)?.fullName ?? id;
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_COMMITTEE_UPDATED',
      summaryText: `Committee of the ${cycleLabel(cycle)} cycle: chair ${user.fullName}; members ${input.members
        .filter((m) => m.role === 'MEMBER')
        .map((m) => name(m.userId))
        .join(', ') || 'none'}${removed.length ? `; removed ${removed.length}` : ''}.`,
      payload: {
        cycleId,
        change: 'MEMBERSHIP',
        members: input.members,
        addedUserIds: added,
        removedUserIds: removed.map((m) => m.userId),
      },
    });
  });
  return getCommittee(user, cycleId);
}

export async function declareConflicts(user: WebJwtPayload, cycleId: string, input: ConflictDeclarationRequest): Promise<NeedsCommitteeDto> {
  const visible = await loadVisibleCycle(user, cycleId);
  assertCycleWritable(user, visible);
  await prisma.$transaction(async (tx) => {
    const cycle = await lockedCycle(tx, user, cycleId);
    if (cycle.rankingFinalisedAt) throw FINALISED();
    const member = await tx.needsCommitteeMember.findUnique({ where: { cycleId_userId: { cycleId, userId: user.userId } } });
    if (!member) throw NOT_MEMBER();
    const conflicted = [...new Set(input.conflictedProposalIds)];
    if (conflicted.length) {
      const found = await tx.needsProposal.findMany({ where: { id: { in: conflicted }, cycleId }, select: { id: true, reference: true } });
      if (found.length !== conflicted.length) throw new AppError('Proposed project not found in this cycle', 404, 'NEEDS_PROPOSAL_NOT_FOUND');
    }
    const newly = conflicted.filter((id) => !member.conflictedProposalIds.includes(id));
    const deleted = newly.length
      ? await tx.needsScoreSheet.findMany({ where: { memberId: member.id, proposalId: { in: newly } }, select: { id: true, proposalId: true } })
      : [];
    if (deleted.length) await tx.needsScoreSheet.deleteMany({ where: { id: { in: deleted.map((d) => d.id) } } });
    await tx.needsCommitteeMember.update({
      where: { id: member.id },
      data: { conflictDeclaredAt: new Date(), conflictStatement: input.statement, conflictedProposalIds: conflicted },
    });
    const refs = conflicted.length
      ? (await tx.needsProposal.findMany({ where: { id: { in: conflicted } }, select: { reference: true }, orderBy: { sequence: 'asc' } })).map((p) => p.reference)
      : [];
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_CONFLICT_DECLARED',
      summaryText: input.hasConflict
        ? `${user.fullName} declared a conflict of interest in ${refs.join(', ')} (${cycleLabel(cycle)} cycle)${deleted.length ? `; ${deleted.length} score sheet${deleted.length === 1 ? '' : 's'} on them deleted` : ''}.`
        : `${user.fullName} declared no conflict of interest (${cycleLabel(cycle)} cycle).`,
      payload: {
        cycleId,
        memberId: member.id,
        hasConflict: input.hasConflict,
        conflictedProposalIds: conflicted,
        statement: input.statement,
        deletedScoreSheetIds: deleted.map((d) => d.id),
        deletedScoreSheetProposalIds: deleted.map((d) => d.proposalId),
      },
    });
    if (deleted.length) await refreshLiveScoresInTx(tx, cycle);
  });
  return getCommittee(user, cycleId);
}

export async function changeScoring(user: WebJwtPayload, cycleId: string, input: CommitteeScoringRequest): Promise<NeedsCommitteeDto> {
  const visible = await loadVisibleCycle(user, cycleId);
  assertCycleWritable(user, visible);
  await prisma.$transaction(async (tx) => {
    const cycle = await lockedCycle(tx, user, cycleId);
    const picture = await loadScoringPicture(tx, cycle);
    assertChair(user, picture);
    if (picture.state === 'FINALISED') throw FINALISED();
    const now = new Date();
    if (input.action === 'OPEN') {
      if (picture.state === 'OPEN') throw new AppError('Scoring is already open', 409, 'NEEDS_SCORING_ALREADY_OPEN');
      const undeclared = picture.members.filter((m) => m.conflictDeclaredAt === null);
      if (undeclared.length) {
        throw new AppError(
          `Every member declares their conflicts of interest before scoring opens: waiting for ${undeclared.map((m) => m.fullName).join(', ')}`,
          409,
          'NEEDS_CONFLICT_NOT_DECLARED',
          { userIds: undeclared.map((m) => m.userId) }
        );
      }
      const scorers = picture.members.filter((m) => m.canScore).length;
      if (scorers < picture.rubric.quorum) {
        throw new AppError(`The committee needs at least ${picture.rubric.quorum} members who score (it has ${scorers})`, 409, 'NEEDS_QUORUM_NOT_MET', {
          quorum: picture.rubric.quorum,
          scorers,
        });
      }
      if (picture.proposals.length === 0) throw new AppError('No proposed project is waiting at Prioritisation', 409, 'NEEDS_NOTHING_TO_SCORE');
      await tx.needsCycle.update({
        where: { id: cycleId },
        data: {
          scoringOpenedAt: now,
          scoringOpenedByUserId: user.userId,
          scoringOpenedByName: user.fullName,
          scoringClosedAt: null,
          scoringClosedByUserId: null,
          scoringClosedByName: null,
        },
      });
    } else {
      if (picture.state !== 'OPEN') throw new AppError('Scoring is not open', 409, 'NEEDS_SCORING_NOT_OPEN');
      await tx.needsCycle.update({ where: { id: cycleId }, data: { scoringClosedAt: now, scoringClosedByUserId: user.userId, scoringClosedByName: user.fullName } });
    }
    await recordAuditEvent(tx, {
      tenantId: user.tenantId,
      projectId: null,
      ...webActor(user),
      action: 'NEEDS_COMMITTEE_UPDATED',
      summaryText: `${input.action === 'OPEN' ? (picture.state === 'CLOSED' ? 'Reopened' : 'Opened') : 'Closed'} scoring for the ${cycleLabel(cycle)} cycle (${picture.proposals.length} proposed project${picture.proposals.length === 1 ? '' : 's'}).`,
      payload: { cycleId, change: input.action === 'OPEN' ? 'SCORING_OPENED' : 'SCORING_CLOSED', reopened: input.action === 'OPEN' && picture.state === 'CLOSED', proposalIds: picture.proposals.map((p) => p.proposal.id) },
    });
  });
  return getCommittee(user, cycleId);
}

// ---------------------------------------------------------------------------
// Minutes (the chair; the cycle document routes need needs:manage_cycle, which the chair lacks)
// ---------------------------------------------------------------------------

async function assertChairOf(user: WebJwtPayload, cycleId: string): Promise<void> {
  const cycle = await loadVisibleCycle(user, cycleId);
  assertCycleWritable(user, cycle);
  const member = await prisma.needsCommitteeMember.findUnique({ where: { cycleId_userId: { cycleId, userId: user.userId } } });
  if (!member || member.role !== 'CHAIR') throw NOT_CHAIR();
}

export async function presignMinutes(user: WebJwtPayload, cycleId: string, input: NeedsDocumentPresignRequest): Promise<NeedsPresignedUploadDto> {
  await assertChairOf(user, cycleId);
  return presignNeedsDocument(user, cycleId, input);
}

export async function registerMinutes(user: WebJwtPayload, cycleId: string, input: RegisterCycleDocumentRequest): Promise<NeedsCycleDocumentDto> {
  if (input.kind !== 'COMMITTEE_MINUTES') throw new AppError('Only committee minutes are filed here', 422, 'NEEDS_DOCUMENT_KIND_MISMATCH');
  await assertChairOf(user, cycleId);
  return registerCycleDocument(user, cycleId, input);
}
