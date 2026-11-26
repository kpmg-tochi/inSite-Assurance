import React, { useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  ContractorStatusEnum,
  type ContractorStatus,
  type ContractorSummaryDto,
} from "@insite/shared";
import { StandardTable, type TableColumnDef } from "../../components/table";
import { CustomSelect } from "../../components/common/CustomSelect";
import { stateOptions } from "../../components/common/AdminAreaSelect";
import { ContractorStars, ContractorStatusChip } from "../../components/contractors/ContractorStars";
import { stateNames } from "../../components/contractors/contractorUi";
import { NewContractorDialog } from "../../components/contractors/NewContractorDialog";
import { OpenFlagCountChip } from "../../components/contractorFlags/flagUi";
import { useContractorsQuery } from "../../queries/contractors";
import { useRefreshContractorRatingsMutation } from "../../mutations/contractors";
import { useAuth } from "../../lib/auth-context";
import { useGuardedNavigate } from "../../lib/navigationGuard";

const STATUS_FILTER_LABELS: Record<ContractorStatus, string> = { ACTIVE: "Active", INACTIVE: "Inactive", SUSPENDED: "Suspended" };

/**
 * Client demo updates F.1 (wave 2): the contractor register (`/app/contractors`,
 * `contractors:view_register`). Every contractor of the workspace with its status, stars from
 * accepted monitoring reports, current and completed projects and the states worked in. Filters:
 * status, state (its own or worked in) and search; "Refresh ratings" recalculates now (otherwise
 * nightly). A row opens the contractor. Wave 3 (F.4): an open-flag chip on each flagged contractor and
 * a "Flagged" filter (`flagged=true`).
 */
export function ContractorsPage() {
  const navigate = useGuardedNavigate();
  const { hasPermission } = useAuth();
  const [status, setStatus] = useState<ContractorStatus | "">("");
  const [stateCode, setStateCode] = useState("");
  const [search, setSearch] = useState("");
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const query = useContractorsQuery({
    ...(status ? { status } : {}),
    ...(stateCode ? { stateCode } : {}),
    ...(flaggedOnly ? { flagged: "true" as const } : {}),
  });
  const refresh = useRefreshContractorRatingsMutation();
  const states = useMemo(() => stateOptions(null, "All states"), []);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = query.data ?? [];
    return q ? list.filter((c) => c.name.toLowerCase().includes(q) || (c.registrationNumber ?? "").toLowerCase().includes(q)) : list;
  }, [query.data, search]);

  const computedAt = useMemo(() => {
    const times = (query.data ?? []).map((c) => c.rating.computedAt).filter((t): t is string => Boolean(t));
    return times.length ? times.sort().at(-1)! : null;
  }, [query.data]);

  const columns: TableColumnDef<ContractorSummaryDto>[] = [
    {
      id: "name",
      header: "Contractor",
      cell: (c) => (
        <div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-semibold text-slate-900">{c.name}</span>
            <OpenFlagCountChip count={c.openFlagCount} />
          </div>
          <div className="text-[11px] text-slate-500">{c.registrationNumber ?? "No RC number"}</div>
        </div>
      ),
    },
    { id: "status", header: "Status", cell: (c) => <ContractorStatusChip status={c.status} /> },
    {
      id: "rating",
      header: "Reliability",
      tooltip: "From accepted monitoring reports (workmanship), work phases met, findings and closure ratings. Shown from 5 reports.",
      cell: (c) => <ContractorStars rating={c.rating} />,
    },
    { id: "active", header: "Active projects", align: "right", cell: (c) => c.activeProjectCount },
    { id: "completed", header: "Completed", align: "right", cell: (c) => c.completedProjectCount },
    {
      id: "states",
      header: "States worked in",
      cell: (c) => <span className="text-slate-600">{c.statesWorkedIn.length ? stateNames(c.statesWorkedIn) : "–"}</span>,
    },
  ];

  const anyFilter = Boolean(status || stateCode || search || flaggedOnly);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-slate-900">Contractors</h2>
          <p className="text-xs text-slate-500">
            Every contractor of the programme, current and previous. A new contractor stays inactive until its signed contract is on file.
            {computedAt && ` Ratings calculated ${new Date(computedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            aria-busy={refresh.isPending}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refresh.isPending ? "animate-spin" : ""}`} aria-hidden="true" />
            {refresh.isPending ? "Recalculating…" : "Refresh ratings"}
          </button>
          {hasPermission("contractors:manage") && (
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="rounded-xl bg-brand-primary px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-hover"
            >
              New contractor
            </button>
          )}
        </div>
      </div>

      <StandardTable<ContractorSummaryDto>
        title="Contractor register"
        subtitle={query.data ? `${rows.length} contractor${rows.length === 1 ? "" : "s"}` : undefined}
        search={{ value: search, onChange: setSearch, placeholder: "Search name or RC number" }}
        filters={
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-40">
              <CustomSelect
                ariaLabel="Status"
                value={status}
                onChange={(v) => setStatus(v as ContractorStatus | "")}
                options={[{ value: "", label: "All statuses" }, ...ContractorStatusEnum.options.map((s) => ({ value: s, label: STATUS_FILTER_LABELS[s] }))]}
                size="sm"
              />
            </div>
            <div className="w-52">
              <CustomSelect ariaLabel="State" value={stateCode} onChange={setStateCode} options={states} size="sm" searchable />
            </div>
            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700">
              <input type="checkbox" checked={flaggedOnly} onChange={(e) => setFlaggedOnly(e.target.checked)} /> Flagged
            </label>
            {anyFilter && (
              <button
                type="button"
                onClick={() => {
                  setStatus("");
                  setStateCode("");
                  setSearch("");
                  setFlaggedOnly(false);
                }}
                className="text-xs font-semibold text-brand-primary hover:underline"
              >
                Clear filters
              </button>
            )}
          </div>
        }
        columns={columns}
        data={rows}
        keyExtractor={(c) => c.id}
        onRowClick={(c) => navigate(`/app/contractors/${c.id}`)}
        loading={query.isLoading}
        emptyState={{
          title: query.isError ? "The contractor register could not be loaded" : "No contractors",
          description: anyFilter ? "No contractor matches these filters." : "Contractors appear here when they are added or named on a project.",
        }}
      />

      {creating && (
        <NewContractorDialog
          onClose={() => setCreating(false)}
          onSelect={(c) => {
            setCreating(false);
            navigate(`/app/contractors/${c.id}`);
          }}
        />
      )}
    </div>
  );
}
