import { useMemo } from "react";
import type { ApprovalChainDto } from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import { useTenantRolesQuery } from "../../queries/rbac/useRbacQueries";
import type { RoleOption } from "./ApprovalChainEditor";

/**
 * Web roles a chain step may name. The role list needs roles or user management rights; without
 * them only roles already on the project's chains are shown (by name).
 */
export function useRoleOptions(chains: ApprovalChainDto[] = []): RoleOption[] {
  const { hasAnyPermission } = useAuth();
  const canList = hasAnyPermission("roles:create_edit", "users:invite_manage");
  const rolesQuery = useTenantRolesQuery(canList);
  return useMemo(() => {
    const out = new Map<string, string>();
    for (const r of rolesQuery.data ?? []) {
      if (r.surface !== "MOBILE") out.set(r.id, r.name);
    }
    for (const chain of chains) {
      for (const s of chain.steps) {
        if (s.requiredRoleId && !out.has(s.requiredRoleId)) out.set(s.requiredRoleId, s.requiredRoleName ?? "Role");
      }
    }
    return [...out.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [rolesQuery.data, chains]);
}
