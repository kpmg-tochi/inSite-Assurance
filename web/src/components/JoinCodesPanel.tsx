import { useQuery } from "@tanstack/react-query";
import { listProjectContractors } from "../api/projects/projectSetupApi";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "../lib/auth-context";
import { useTenantRolesQuery } from "../queries/rbac/useRbacQueries";
import {
  useIssueJoinCodeMutation,
  useProjectJoinCodesQuery,
  useRotateJoinCodeMutation,
} from "../queries/projects/useJoinCodeQueries";
import type { JoinCodeRecordDto } from "../api/projects/joinCodesApi";
import { formatDateTimeShort } from "../lib/formatters";
import {
  StandardTable,
  TableActionButton,
  TableBadge,
  TableColumnDef,
} from "./table";

/**
 * Mobile join codes for one project (Phase 2 Step 7). Requires mobilization:manage_roster.
 * Users who cannot edit the baseline only see and manage contractor-executor codes.
 */
export function JoinCodesPanel({ projectId, projectCode }: { projectId: string; projectCode: string }) {
  const { hasPermission, hasAnyPermission } = useAuth();
  const canSeeAllPersonas = hasPermission("projects:edit_baseline");
  const { data: codes = [], isLoading } = useProjectJoinCodesQuery(projectId, true);
  // Role list needs roles:create_edit or users:invite_manage; without it, issuing is limited to
  // re-issuing for roles that already have a code on this project.
  const canListRoles = hasAnyPermission("roles:create_edit", "users:invite_manage");
  const { data: roles = [] } = useTenantRolesQuery(canListRoles);
  const issueMutation = useIssueJoinCodeMutation(projectId);
  const rotateMutation = useRotateJoinCodeMutation(projectId);

  const [roleId, setRoleId] = useState("");
  // Phase 6: contractor field roles get one code per contractor.
  const contractorsQuery = useQuery({
    queryKey: ["project-contractors", projectId],
    queryFn: () => listProjectContractors(projectId),
  });
  const contractors = contractorsQuery.data ?? [];
  const [contractorId, setContractorId] = useState("");
  const [maxUses, setMaxUses] = useState("");
  const [expiresOn, setExpiresOn] = useState("");

  // Pre-provisioned roles sign in with an account and never get codes (Phase 5).
  const provisionedRoleNames = useMemo(
    () =>
      roles
        .filter((r) => r.surface !== "WEB" && r.onboardingMode === "PROVISIONED_ACCOUNT")
        .map((r) => r.name),
    [roles],
  );

  const issuableRoles = useMemo(() => {
    const fromTenant = roles
      .filter((r) => r.surface !== "WEB")
      .map((r) => ({
        id: r.id,
        name: r.name,
        fieldPersonaType: r.fieldPersonaType,
        onboardingMode: r.onboardingMode,
      }));
    const fromCodes = codes.map((c) => ({
      id: c.roleId,
      name: c.roleName,
      fieldPersonaType: c.fieldPersonaType,
      onboardingMode: c.roleOnboardingMode ?? "JOIN_CODE",
    }));
    const byId = new Map([...fromCodes, ...fromTenant].map((r) => [r.id, r]));
    return [...byId.values()].filter(
      (r) =>
        r.onboardingMode !== "PROVISIONED_ACCOUNT" &&
        (canSeeAllPersonas || r.fieldPersonaType === "CONTRACTOR_EXECUTOR"),
    );
  }, [roles, codes, canSeeAllPersonas]);

  // Codes of a role that became pre-provisioned are deactivated; only show live history.
  const visibleCodes = useMemo(
    () => codes.filter((c) => c.isActive || c.roleOnboardingMode !== "PROVISIONED_ACCOUNT"),
    [codes],
  );

  const handleIssue = async () => {
    if (!roleId) {
      toast.error("Choose a mobile role first.");
      return;
    }
    const role = issuableRoles.find((r) => r.id === roleId);
    const needsContractor = role?.fieldPersonaType === "CONTRACTOR_EXECUTOR" && contractors.length > 1;
    if (needsContractor && !contractorId) {
      toast.error("Choose which contractor this code is for.");
      return;
    }
    await issueMutation.mutateAsync({
      roleId,
      projectContractorId: role?.fieldPersonaType === "CONTRACTOR_EXECUTOR" && contractorId ? contractorId : null,
      maxUses: maxUses ? Number(maxUses) : null,
      expiresAt: expiresOn ? new Date(`${expiresOn}T23:59:59`).toISOString() : null,
    });
    setMaxUses("");
    setExpiresOn("");
  };

  const columns: TableColumnDef<JoinCodeRecordDto>[] = [
    {
      id: "code",
      header: "Join Code",
      tooltip: "Share this code with the field person; it binds them to this project and role",
      width: "w-52",
      cell: (c) => (
        <button
          type="button"
          className="font-mono font-semibold text-brand-primary hover:underline"
          onClick={() => {
            navigator.clipboard?.writeText(c.code);
            toast.success(`Copied ${c.code}`);
          }}
        >
          {c.code}
        </button>
      ),
    },
    {
      id: "role",
      header: "Role",
      tooltip: "Mobile role granted to whoever joins with this code",
      width: "w-56",
      cell: (c) => (
        <span className="text-slate-700">
          {c.roleName}
          {c.contractorName && <span className="block text-[11px] text-slate-500">{c.contractorName} ({c.tradeCode})</span>}
        </span>
      ),
    },
    {
      id: "uses",
      header: "Uses",
      tooltip: "Joins so far, out of the maximum allowed",
      width: "w-24",
      cell: (c) => (
        <span className="text-slate-600">
          {c.useCount ?? 0}
          {c.maxUses ? ` / ${c.maxUses}` : ""}
        </span>
      ),
    },
    {
      id: "expires",
      header: "Expires",
      tooltip: "After this time the code can no longer be used",
      width: "w-36",
      cell: (c) => (
        <span className="text-slate-500 whitespace-nowrap">
          {c.expiresAt ? formatDateTimeShort(c.expiresAt) : "Never"}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      tooltip: "Rotated codes are inactive; existing devices keep working",
      width: "w-28",
      cell: (c) => (
        <TableBadge variant={c.isActive ? "success" : "neutral"}>
          {c.isActive ? "Active" : "Rotated"}
        </TableBadge>
      ),
    },
    {
      id: "actions",
      header: "Actions",
      tooltip: "Rotate deactivates this code and issues a replacement for the same role",
      align: "right",
      width: "w-28",
      cell: (c) =>
        c.isActive ? (
          <TableActionButton
            onClick={() => rotateMutation.mutate({ joinCodeId: c.id, payload: {} })}
            variant="danger"
          >
            Rotate
          </TableActionButton>
        ) : null,
    },
  ];

  const inputClass =
    "px-3 py-2 text-xs rounded-xl border border-slate-300 focus:outline-hidden focus:ring-2 focus:ring-brand-primary";

  return (
    <StandardTable<JoinCodeRecordDto>
      title={
        <div className="flex items-center gap-2.5">
          <span>Mobile Join Codes · {projectCode}</span>
          <span className="hidden sm:inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-white/10 text-white/90 border border-white/15">
            {isLoading ? "Loading..." : `${codes.filter((c) => c.isActive).length} active`}
          </span>
        </div>
      }
      subtitle={
        <>
          One active code per role (and per contractor for contractor roles). Rotate a code to replace it.
          {provisionedRoleNames.length > 0 && (
            <span className="block mt-0.5">
              Not listed: {provisionedRoleNames.join(", ")}. These roles are pre-provisioned, so people
              sign in with their account and need no code.
            </span>
          )}
        </>
      }
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={roleId}
            onChange={(e) => setRoleId(e.target.value)}
            className={inputClass}
            aria-label="Mobile role"
          >
            <option value="">Mobile role…</option>
            {issuableRoles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          {issuableRoles.find((r) => r.id === roleId)?.fieldPersonaType === "CONTRACTOR_EXECUTOR" && contractors.length > 1 && (
            <select value={contractorId} onChange={(e) => setContractorId(e.target.value)} className={inputClass} aria-label="Contractor">
              <option value="">Contractor…</option>
              {contractors.filter((c) => c.allowFieldReporting).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.organizationName} ({c.tradeCode})
                </option>
              ))}
            </select>
          )}
          <input
            type="number"
            min={1}
            placeholder="Max uses (optional)"
            value={maxUses}
            onChange={(e) => setMaxUses(e.target.value)}
            className={`${inputClass} w-40`}
          />
          <input
            type="date"
            value={expiresOn}
            onChange={(e) => setExpiresOn(e.target.value)}
            className={inputClass}
            aria-label="Expires on (optional)"
          />
          <button
            type="button"
            onClick={handleIssue}
            disabled={issueMutation.isPending}
            className="px-3 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-bold disabled:opacity-50"
          >
            Issue code
          </button>
        </div>
      }
      columns={columns}
      data={visibleCodes}
      keyExtractor={(c) => c.id}
      emptyState={{
        title: "No join codes yet",
        description: "Issue a code for a mobile role to let field staff join this project.",
      }}
    />
  );
}
