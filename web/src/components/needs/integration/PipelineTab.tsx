import React, { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import type { NeedsPipelineQuery, NeedsPipelineRow } from "@insite/shared";
import { StandardTable, type TableColumnDef } from "../../table";
import { CustomSelect } from "../../common/CustomSelect";
import { stateOptions } from "../../common/AdminAreaSelect";
import { useGuardedNavigate } from "../../../lib/navigationGuard";
import { useNeedsOptionsQuery } from "../../../queries/needs/useNeedsQueries";
import { useNeedsPipelineQuery } from "../../../queries/needs/useIntegrationQueries";
import { ProposalStatusTag, locationText, money, plural } from "../needsUi";
import { OutsideCycleChip } from "./OriginChip";

/**
 * Needs pipeline wave 4 (C5): Portfolio → "Pipeline". What is coming: proposed projects at Approval
 * or Funding, and draft projects converted from them that are not live yet (`GET /needs/pipeline`,
 * `needs:view`). A row opens the proposed project; a converted one links to its draft project.
 */
export function PipelineTab() {
  const navigate = useGuardedNavigate();
  const options = useNeedsOptionsQuery();
  const [query, setQuery] = useState<NeedsPipelineQuery>({});
  const [search, setSearch] = useState("");
  const pipeline = useNeedsPipelineQuery(query);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (pipeline.data ?? []).filter((r) => !q || [r.reference, r.title, r.projectCode ?? ""].some((v) => v.toLowerCase().includes(q)));
  }, [pipeline.data, search]);
  const total = rows.reduce((s, r) => s + (r.amountNgn ?? 0), 0);

  const set = (patch: Partial<NeedsPipelineQuery>) =>
    setQuery((prev) => {
      const next = { ...prev, ...patch };
      (Object.keys(next) as Array<keyof NeedsPipelineQuery>).forEach((k) => (next[k] === undefined || next[k] === "") && delete next[k]);
      return next;
    });

  const columns: TableColumnDef<NeedsPipelineRow>[] = [
    {
      id: "proposal",
      header: "Proposed project",
      cell: (r) => (
        <div className="min-w-0 max-w-[320px]">
          <div className="text-[11px] font-semibold text-slate-500 tabular-nums">{r.reference}</div>
          <div className="truncate font-semibold text-slate-900" title={r.title}>
            {r.title}
          </div>
          {r.route === "OUT_OF_CYCLE" && <OutsideCycleChip className="mt-0.5" />}
        </div>
      ),
    },
    { id: "programme", header: "Programme", cell: (r) => <span className="text-xs text-slate-700">{r.projectTypeName}</span> },
    { id: "year", header: "Year", tooltip: "Intervention year", cell: (r) => <span className="text-xs tabular-nums text-slate-700">{r.interventionYear}</span> },
    { id: "location", header: "State / LGA", cell: (r) => <span className="text-xs text-slate-700">{locationText(r.stateCode, r.lgaCodes)}</span> },
    { id: "status", header: "Stage", cell: (r) => <ProposalStatusTag status={r.status} label={r.statusLabel} /> },
    {
      id: "amount",
      header: "Amount",
      align: "right",
      tooltip: "Funded, else approved, else costed, else preliminary",
      cell: (r) => <span className="text-xs tabular-nums text-slate-900">{money(r.amountNgn)}</span>,
    },
    {
      id: "project",
      header: "Project",
      cell: (r) =>
        r.projectId ? (
          <Link
            to={`/app/projects/${r.projectId}/setup`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-semibold text-brand-primary hover:underline"
          >
            {r.projectCode ?? "Draft project"}
          </Link>
        ) : (
          <span className="text-xs text-slate-400">–</span>
        ),
    },
  ];

  const programmes = options.data?.programmes ?? [];
  const years = options.data?.years ?? [];

  return (
    <StandardTable<NeedsPipelineRow>
      title="Pipeline"
      subtitle={`Proposed projects at approval or funding, and draft projects not yet live. ${plural(rows.length, "item")} · ${money(total)}`}
      search={{ value: search, onChange: setSearch, placeholder: "Search by reference, title or project code" }}
      filters={
        <div className="flex flex-wrap items-center gap-2">
          {programmes.length > 1 && (
            <div className="w-52">
              <CustomSelect
                ariaLabel="Programme"
                value={query.projectTypeId ?? ""}
                onChange={(v) => set({ projectTypeId: v || undefined })}
                options={[{ value: "", label: "All programmes" }, ...programmes.map((p) => ({ value: p.projectTypeId, label: p.projectTypeName }))]}
                size="sm"
              />
            </div>
          )}
          <div className="w-44">
            <CustomSelect
              ariaLabel="Intervention year"
              value={query.interventionYear ? String(query.interventionYear) : ""}
              onChange={(v) => set({ interventionYear: v ? Number(v) : undefined })}
              options={[{ value: "", label: "All years" }, ...years.map((y) => ({ value: String(y), label: String(y) }))]}
              size="sm"
            />
          </div>
          <div className="w-44">
            <CustomSelect
              ariaLabel="State"
              value={query.stateCode ?? ""}
              onChange={(v) => set({ stateCode: v || undefined })}
              options={stateOptions(null, "All States")}
              size="sm"
              searchable
            />
          </div>
        </div>
      }
      columns={columns}
      data={rows}
      keyExtractor={(r) => r.proposalId}
      onRowClick={(r) => navigate(`/app/needs-assessment/proposals/${r.proposalId}`)}
      loading={pipeline.isLoading}
      minWidth="min-w-[1040px]"
      emptyState={{
        title: pipeline.isError ? "The pipeline could not be loaded" : "Nothing in the pipeline",
        description: pipeline.isError ? "Try again in a moment." : "Proposed projects appear here once they reach approval.",
      }}
    />
  );
}
