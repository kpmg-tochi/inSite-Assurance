import React, { useMemo } from "react";
import { CustomSelect } from "../common/CustomSelect";
import { useAuth } from "../../lib/auth-context";
import { formatNaira } from "../../lib/formatters";
import { useApprovedListYearRowsQuery, useProjectApprovedListLinkQuery } from "../../queries/approvedLists";
import { useLinkApprovedListRowMutation } from "../../mutations/approvedLists";
import { BudgetCheckLine, stateName } from "./approvedListUi";

const NONE = "";

/**
 * Client demo updates E3 (wave 3): "Approved list row" in Project details (section `basics`). Rows of
 * the project's intervention year (the latest year with lists when the project has none), searchable,
 * saved at once through PUT /projects/:id/approved-list-row (separate from the section save). Choosing
 * needs `approved_lists:view` to read the lists; others see the current link read-only.
 */
export function ApprovedListRowPicker({
  projectId,
  interventionYear,
  readOnly,
}: {
  projectId: string;
  interventionYear: number | null;
  readOnly?: boolean;
}) {
  const { hasPermission } = useAuth();
  const canBrowse = hasPermission("approved_lists:view");
  const linkQuery = useProjectApprovedListLinkQuery(projectId);
  // Every row of the year in one request (design refinement 2026-11-26; was one request per list).
  const overview = useApprovedListYearRowsQuery(interventionYear, canBrowse && !readOnly);
  const link = useLinkApprovedListRowMutation(projectId);
  const current = linkQuery.data ?? null;

  const options = useMemo(() => {
    const kindByList = new Map((overview.data?.lists ?? []).map((l) => [l.id, l.kind]));
    const rows = (overview.data?.rows ?? []).map((r) => ({
      value: r.id,
      label: `${r.rowRef} · ${r.projectTitle}`,
      description: [
        formatNaira(r.costEstimateNgn),
        stateName(r.stateCode),
        kindByList.get(r.listId) === "MG_BEAP" ? "BEAP" : "DI schedule",
        r.matchStatus !== "NOT_LINKED" && r.id !== current?.rowId ? "already linked" : null,
      ]
        .filter(Boolean)
        .join(" · "),
    }));
    // Keep the saved row selectable even when it is on another year's list.
    if (current && !rows.some((r) => r.value === current.rowId)) {
      rows.unshift({ value: current.rowId, label: `${current.rowRef} · ${current.projectTitle}`, description: formatNaira(current.costEstimateNgn) });
    }
    return [{ value: NONE, label: "Not linked", description: "" }, ...rows];
  }, [overview.data, current]);

  const loading = linkQuery.isLoading || (canBrowse && !readOnly && overview.isLoading);
  const year = overview.data?.interventionYear ?? interventionYear;
  const noLists = canBrowse && !readOnly && overview.data && overview.data.lists.length === 0;

  return (
    <div className="space-y-1.5">
      {canBrowse && !readOnly ? (
        <CustomSelect
          label="Approved list row"
          hint={year ? `Rows of the ${year} approved lists. Saved as soon as you choose.` : "Saved as soon as you choose."}
          value={current?.rowId ?? NONE}
          onChange={(v) => {
            const next = v || null;
            if (next !== (current?.rowId ?? null)) link.mutate(next);
          }}
          options={options}
          searchable
          disabled={loading || link.isPending}
          placeholder={loading ? "Loading…" : "Not linked"}
        />
      ) : (
        <div>
          <p className="text-xs font-semibold text-slate-700">Approved list row</p>
          <p className="text-xs text-slate-800">
            {current ? `${current.rowRef} · ${current.projectTitle} (${current.listTitle})` : "Not linked"}
          </p>
        </div>
      )}
      {noLists && <p className="text-[11px] text-slate-500">No approved lists{year ? ` for ${year}` : ""} yet.</p>}
      {current && <BudgetCheckLine mismatch={current.mismatch} />}
    </div>
  );
}
