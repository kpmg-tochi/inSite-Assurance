import { Prisma } from '@prisma/client';
import { MAX_ORGANIZATION_DEPTH } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { WebJwtPayload } from '../../middleware/auth.middleware';

/**
 * Needs pipeline wave 2 (B3): who sees and who writes a cycle (wave 2 decision 1). Every needs route
 * goes through these loaders.
 *
 * - Read: the user holds `needs:view` (the route checks it) and the cycle's owning organisation is
 *   the user's organisation or below it (the platform's organisation-tree rule: UBEC HQ sees the
 *   SUBEB cycles; a SUBEB sees only its own). Wave 4 adds the BEAP reviewers through
 *   `beapReviewerCycleBranch`.
 * - Write (open, update, close, upload, register documents): the route's permission and the user's
 *   organisation is the owning organisation itself (403 NEEDS_CYCLE_FORBIDDEN); the cycle must be
 *   OPEN (409 NEEDS_CYCLE_NOT_OPEN). An unseen cycle is 404 NEEDS_CYCLE_NOT_FOUND.
 * - A proposal is read through its cycle; an id from the URL or the body must belong to the URL cycle.
 */

export type Db = Prisma.TransactionClient | typeof prisma;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The cycle is owned by `organizationId` or an organisation below it (nested parent relations, depth-bounded). */
function ownedByOrganizationTreeCycleWhere(organizationId: string): Prisma.NeedsCycleWhereInput {
  const levels: Prisma.OrganizationWhereInput[] = [{ id: organizationId }];
  let nested: Prisma.OrganizationWhereInput = { parentOrganizationId: organizationId };
  for (let depth = 1; depth < MAX_ORGANIZATION_DEPTH; depth++) {
    levels.push(nested);
    nested = { parentOrganization: nested };
  }
  return { owningOrganization: { is: { OR: levels } } };
}

/**
 * WAVE 4 SEAM (BEAP review, plan section 8): UBEC holders of `needs:review_beap` see a Matching
 * Grants cycle once a BEAP is submitted. Returns the extra branch, or null while nothing adds one.
 */
export function beapReviewerCycleBranch(user: WebJwtPayload): Prisma.NeedsCycleWhereInput | null {
  void user;
  return null;
}

/** Prisma filter: the cycles `user` may read (composes into any NeedsCycle `where`). */
export function visibleCycleWhere(user: WebJwtPayload): Prisma.NeedsCycleWhereInput {
  const tenant: Prisma.NeedsCycleWhereInput = { tenantId: user.tenantId };
  if (user.isPlatformSuperAdmin) return tenant;
  const branches: Prisma.NeedsCycleWhereInput[] = [ownedByOrganizationTreeCycleWhere(user.organizationId)];
  const beap = beapReviewerCycleBranch(user);
  if (beap) branches.push(beap);
  return { ...tenant, OR: branches };
}

export const CYCLE_NOT_FOUND = () => new AppError('Needs assessment cycle not found', 404, 'NEEDS_CYCLE_NOT_FOUND');
export const PROPOSAL_NOT_FOUND = () => new AppError('Proposed project not found', 404, 'NEEDS_PROPOSAL_NOT_FOUND');

export type CycleRow = Prisma.NeedsCycleGetPayload<object>;

/** A cycle the user can see, else 404 NEEDS_CYCLE_NOT_FOUND. */
export async function loadVisibleCycle(user: WebJwtPayload, cycleId: string, db: Db = prisma): Promise<CycleRow> {
  if (!UUID_RE.test(cycleId)) throw CYCLE_NOT_FOUND();
  const cycle = await db.needsCycle.findFirst({ where: { AND: [{ id: cycleId }, visibleCycleWhere(user)] } });
  if (!cycle) throw CYCLE_NOT_FOUND();
  return cycle;
}

/** The user writes for the cycle's owning organisation (403) and the cycle is open (409). */
export function assertCycleWritable(user: WebJwtPayload, cycle: Pick<CycleRow, 'owningOrganizationId' | 'status'>): void {
  if (!user.isPlatformSuperAdmin && cycle.owningOrganizationId !== user.organizationId) {
    throw new AppError('Only the organisation that owns this cycle can change it', 403, 'NEEDS_CYCLE_FORBIDDEN');
  }
  if (cycle.status !== 'OPEN') {
    throw new AppError('This cycle is not open', 409, 'NEEDS_CYCLE_NOT_OPEN');
  }
}

/** Visible and writable, in one call. */
export async function loadWritableCycle(user: WebJwtPayload, cycleId: string, db: Db = prisma): Promise<CycleRow> {
  const cycle = await loadVisibleCycle(user, cycleId, db);
  assertCycleWritable(user, cycle);
  return cycle;
}

export type ProposalRow = Prisma.NeedsProposalGetPayload<object>;

/** A proposal whose cycle the user can see, else 404 NEEDS_PROPOSAL_NOT_FOUND. */
export async function loadVisibleProposal(user: WebJwtPayload, proposalId: string, db: Db = prisma): Promise<ProposalRow & { cycle: CycleRow }> {
  if (!UUID_RE.test(proposalId)) throw PROPOSAL_NOT_FOUND();
  const proposal = await db.needsProposal.findFirst({
    where: { id: proposalId, tenantId: user.tenantId, cycle: visibleCycleWhere(user) },
    include: { cycle: true },
  });
  if (!proposal) throw PROPOSAL_NOT_FOUND();
  return proposal;
}

/** A proposal of the URL cycle (ids from the body or the URL), else 404 NEEDS_PROPOSAL_NOT_FOUND. */
export async function loadCycleProposal(cycleId: string, proposalId: string, db: Db = prisma): Promise<ProposalRow> {
  if (!UUID_RE.test(proposalId)) throw PROPOSAL_NOT_FOUND();
  const proposal = await db.needsProposal.findFirst({ where: { id: proposalId, cycleId } });
  if (!proposal) throw PROPOSAL_NOT_FOUND();
  return proposal;
}

export const isUuid = (v: string) => UUID_RE.test(v);

/** "Hauwa Bello (UBEC Administrator)", the ledger's actor name. */
export const actorName = (u: WebJwtPayload) => `${u.fullName} (${u.roleName})`;

export const webActor = (u: WebJwtPayload) => ({ actorType: 'WEB_USER' as const, actorId: u.userId, actorDisplayName: actorName(u) });

/** The ledger actor of automatic needs pipeline changes (flags resolved by a new version). */
export const NEEDS_SYSTEM_ACTOR = { actorType: 'SYSTEM' as const, actorId: 'needs', actorDisplayName: 'System (needs)' };
