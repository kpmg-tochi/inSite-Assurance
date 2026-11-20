/**
 * Organisation hierarchy (Phase 11). Pure helpers shared by the server (save validation) and the
 * web (tree view, parent picker). A tenant can have several roots; a chain from a root down to any
 * organisation has at most MAX_ORGANIZATION_DEPTH levels (a root is level 1).
 */

export const MAX_ORGANIZATION_DEPTH = 5;

export interface OrganizationNode {
  id: string;
  parentOrganizationId: string | null;
}

/**
 * The ancestors of `organizationId`, nearest first. Stops (and reports `cycle`) if a loop is met,
 * so it is safe on corrupt data.
 */
export function organizationAncestry(
  nodes: ReadonlyArray<OrganizationNode>,
  organizationId: string
): { ancestors: string[]; cycle: boolean } {
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentOrganizationId]));
  const ancestors: string[] = [];
  const seen = new Set<string>([organizationId]);
  let current = parentOf.get(organizationId) ?? null;
  while (current) {
    if (seen.has(current)) return { ancestors, cycle: true };
    seen.add(current);
    ancestors.push(current);
    current = parentOf.get(current) ?? null;
  }
  return { ancestors, cycle: false };
}

/** `organizationId` and every organisation below it. */
export function organizationDescendants(nodes: ReadonlyArray<OrganizationNode>, organizationId: string): string[] {
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentOrganizationId) continue;
    const list = children.get(n.parentOrganizationId) ?? [];
    list.push(n.id);
    children.set(n.parentOrganizationId, list);
  }
  const out: string[] = [];
  const queue = [organizationId];
  const seen = new Set<string>();
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    queue.push(...(children.get(id) ?? []));
  }
  return out;
}

/** Levels below `organizationId`, counting itself as 1 (a leaf has height 1). */
function subtreeHeight(nodes: ReadonlyArray<OrganizationNode>, organizationId: string): number {
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.parentOrganizationId) continue;
    children.set(n.parentOrganizationId, [...(children.get(n.parentOrganizationId) ?? []), n.id]);
  }
  const height = (id: string, guard: Set<string>): number => {
    if (guard.has(id)) return 1;
    guard.add(id);
    const kids = children.get(id) ?? [];
    return 1 + (kids.length ? Math.max(...kids.map((k) => height(k, new Set(guard)))) : 0);
  };
  return height(organizationId, new Set());
}

export interface OrganizationParentIssue {
  code: 'ORGANIZATION_PARENT_SELF' | 'ORGANIZATION_HIERARCHY_CYCLE' | 'ORGANIZATION_HIERARCHY_TOO_DEEP' | 'ORGANIZATION_PARENT_NOT_FOUND';
  message: string;
}

/**
 * Checks moving `organizationId` (null for a new organisation) under `parentOrganizationId`.
 * Refuses self-parenting, cycles (the parent is the organisation itself or below it) and chains
 * deeper than MAX_ORGANIZATION_DEPTH, counting the organisation's own subtree.
 */
export function validateOrganizationParent(
  nodes: ReadonlyArray<OrganizationNode>,
  organizationId: string | null,
  parentOrganizationId: string | null
): OrganizationParentIssue | null {
  if (!parentOrganizationId) return null;
  if (organizationId && parentOrganizationId === organizationId) {
    return { code: 'ORGANIZATION_PARENT_SELF', message: 'An organisation cannot be its own parent.' };
  }
  if (!nodes.some((n) => n.id === parentOrganizationId)) {
    return { code: 'ORGANIZATION_PARENT_NOT_FOUND', message: 'The parent organisation was not found in this workspace.' };
  }
  if (organizationId && organizationDescendants(nodes, organizationId).includes(parentOrganizationId)) {
    return {
      code: 'ORGANIZATION_HIERARCHY_CYCLE',
      message: 'The parent cannot be this organisation or one of the organisations below it.',
    };
  }
  const parentAncestry = organizationAncestry(nodes, parentOrganizationId);
  if (parentAncestry.cycle) {
    return { code: 'ORGANIZATION_HIERARCHY_CYCLE', message: 'The parent organisation is part of a loop. Fix it first.' };
  }
  const parentLevel = parentAncestry.ancestors.length + 1;
  const ownHeight = organizationId ? subtreeHeight(nodes, organizationId) : 1;
  if (parentLevel + ownHeight > MAX_ORGANIZATION_DEPTH) {
    return {
      code: 'ORGANIZATION_HIERARCHY_TOO_DEEP',
      message: `The hierarchy can be at most ${MAX_ORGANIZATION_DEPTH} levels deep.`,
    };
  }
  return null;
}

/** Depth-first order for a tree view: each organisation followed by its children, with its level (0 = root). */
export function organizationTreeOrder<T extends OrganizationNode & { name: string }>(
  nodes: ReadonlyArray<T>
): Array<{ node: T; level: number }> {
  const ids = new Set(nodes.map((n) => n.id));
  const children = new Map<string | null, T[]>();
  for (const n of nodes) {
    // A parent outside the list (e.g. archived and filtered out) shows the child as a root.
    const key = n.parentOrganizationId && ids.has(n.parentOrganizationId) ? n.parentOrganizationId : null;
    children.set(key, [...(children.get(key) ?? []), n]);
  }
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name));
  const out: Array<{ node: T; level: number }> = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, level: number) => {
    for (const n of children.get(parent) ?? []) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push({ node: n, level });
      walk(n.id, level + 1);
    }
  };
  walk(null, 0);
  // Anything left belongs to a loop; list it flat so it is still visible.
  for (const n of nodes) if (!seen.has(n.id)) out.push({ node: n, level: 0 });
  return out;
}
