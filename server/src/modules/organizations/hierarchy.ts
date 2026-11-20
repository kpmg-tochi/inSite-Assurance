import { Prisma } from '@prisma/client';
import { MAX_ORGANIZATION_DEPTH } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { getRequestMemo, setRequestMemo } from '../../utils/requestContext';

/**
 * Organisation hierarchy queries (Phase 11). Both walk the tree with one recursive CTE, bounded by
 * MAX_ORGANIZATION_DEPTH so corrupt data cannot loop, and memoise per request outside transactions.
 */

type Db = Prisma.TransactionClient | typeof prisma;

/** `organizationId` and every organisation below it, in the tenant. */
export async function organizationSubtreeIds(tenantId: string, organizationId: string, db: Db = prisma): Promise<string[]> {
  const key = `orgSubtree:${tenantId}:${organizationId}`;
  if (db === prisma) {
    const cached = getRequestMemo<string[]>(key);
    if (cached) return cached;
  }
  const rows = await db.$queryRaw<Array<{ id: string }>>`
    WITH RECURSIVE tree(id, depth) AS (
      SELECT id, 1 FROM "Organization" WHERE id = ${organizationId}::uuid AND "tenantId" = ${tenantId}::uuid
      UNION
      SELECT o.id, t.depth + 1 FROM "Organization" o JOIN tree t ON o."parentOrganizationId" = t.id
      WHERE t.depth < ${MAX_ORGANIZATION_DEPTH + 1}
    )
    SELECT DISTINCT id::text AS id FROM tree`;
  const ids = rows.map((r) => r.id);
  if (db === prisma) setRequestMemo(key, ids);
  return ids;
}

/** The organisations above `organizationId`, nearest first (excluding itself). */
export async function organizationAncestorIds(organizationId: string, db: Db = prisma): Promise<string[]> {
  const key = `orgAncestors:${organizationId}`;
  if (db === prisma) {
    const cached = getRequestMemo<string[]>(key);
    if (cached) return cached;
  }
  const rows = await db.$queryRaw<Array<{ id: string; depth: number }>>`
    WITH RECURSIVE up(id, parent, depth) AS (
      SELECT id, "parentOrganizationId", 0 FROM "Organization" WHERE id = ${organizationId}::uuid
      UNION
      SELECT o.id, o."parentOrganizationId", u.depth + 1 FROM "Organization" o JOIN up u ON o.id = u.parent
      WHERE u.depth < ${MAX_ORGANIZATION_DEPTH + 1}
    )
    SELECT id::text AS id, depth FROM up WHERE depth > 0 ORDER BY depth`;
  const ids = rows.map((r) => r.id);
  if (db === prisma) setRequestMemo(key, ids);
  return ids;
}

/**
 * Prisma filter: the project is owned by `organizationId` or by an organisation below it. Built from
 * nested parent relations (depth-bounded) so it composes into any project `where` without a query.
 */
export function ownedByOrganizationTreeWhere(organizationId: string): Prisma.ProjectWhereInput {
  // Level 0: the organisation itself; level n: the owner's n-th ancestor is the organisation.
  const levels: Prisma.OrganizationWhereInput[] = [{ id: organizationId }];
  let nested: Prisma.OrganizationWhereInput = { parentOrganizationId: organizationId };
  for (let depth = 1; depth < MAX_ORGANIZATION_DEPTH; depth++) {
    levels.push(nested);
    nested = { parentOrganization: nested };
  }
  return { owningOrganization: { is: { OR: levels } } };
}
