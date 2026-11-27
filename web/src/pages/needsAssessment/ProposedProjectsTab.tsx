import React, { useEffect, useMemo, useState } from "react";
import { Download, FileUp } from "lucide-react";
import {
  NeedsProposalStatusEnum,
  stageConfigOf,
  NEEDS_STAGE_LABELS,
  type NeedsCycleDto,
  type NeedsProposalStatus,
  type NeedsProposalSummaryDto,
  type NeedsStage,
} from "@insite/shared";
import { StandardTable, type TableColumnDef } from "../../components/table";
import { CustomSelect } from "../../components/common/CustomSelect";
import { primaryButton, secondaryButton } from "../../components/contracts/contractUi";
import { FlagChips, ProposalStatusTag, locationText, money } from "../../components/needs/needsUi";
import { useNeedsProposalsQuery } from "../../queries/needs/useNeedsQueries";
import { useDownloadCycleTemplateMutation } from "../../mutations/needs/useNeedsMutations";
import { useGuardedNavigate } from "../../lib/navigationGuard";

const STATUS_FILTER_LABELS: Record<NeedsProposalStatus, string> = {
  DRAFT: "Draft",
  IN_PROGRESS: "In progress",
  RETURNED: "Returned",
  CONVERTED: "Became a project",
  NOT_VALIDATED: "Not validated",
  NOT_SELECTED: "Not selected",
  WITHDRAWN: "Withdrawn",
  MERGED: "Merged",
};

const ALL = "";

/** The stage's name in this cycle (a programme may rename stages). */
export function stageLabel(cycle: Pick<NeedsCycleDto, "config">, stage: NeedsStage): string {
  return stageConfigOf(cycle.config, stage)?.label ?? NEEDS_STAGE_LABELS[stage];
}

/**
 * Needs pipeline wave 2 (C2): the cycle's proposed projects. Filters (stage, status, search,
 * "Waiting for me") go to the server; the table pages in the browser. A row opens the proposal page.
 */
export function ProposedProjectsTab({ cycle, canUpload, onUpload }: { cycle: NeedsCycleDto; canUpload: boolean; onUpload: () => void }) {
  const navigate = useGuardedNavigate();
  const template = useDownloadCycleTemplateMutation();
  const [stage, setStage] = useState<NeedsStage | "">("");
  const [status, setStatus] = useState<NeedsProposalStatus | "">("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [waitingForMe, setWaitingForMe] = useState(false);

  // The search goes to the server once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const query = useNeedsProposalsQuery(cycle.id, {
    stage: stage || undefined,
    status: status || undefined,
    q: q || undefined,
    waitingForMe: waitingForMe ? "true" : undefined,
  });
  const rows = query.data ?? [];
  const anyFilter = Boolean(stage || status || q || waitingForMe);

  const stageOptions = useMemo(
    () => [{ value: ALL, label: "Every stage" }, ...cycle.config.stages.map((s) => ({ value: s.stage, label: s.label }))],
    [cycle.config.stages]
  );
  const statusOptions = [{ value: ALL, label: "Any status" }, ...NeedsProposalStatusEnum.options.map((s) => ({ value: s, label: STATUS_FILTER_LABELS[s] }))];

  const clear = () => {
    setStage("");
    setStatus("");
    setSearch("");
    setQ("");
    setWaitingForMe(false);
  };

  const columns: TableColumnDef<NeedsProposalSummaryDto>[] = [
    { id: "ref", header: "Reference", cell: (p) => <span className="whitespace-nowrap font-semibold text-slate-900">{p.reference}</span> },
    {
      id: "title",
      header: "Proposed project",
      cell: (p) => (
        <span className="block max-w-[18rem] truncate font-medium text-slate-900" title={p.title}>
          {p.title}
        </span>
      ),
    },
    {
      id: "where",
      header: "State / LGA",
      cell: (p) => (
        <span className="block max-w-[12rem] truncate text-slate-700" title={locationText(p.stateCode, p.lgaCodes)}>
          {locationText(p.stateCode, p.lgaCodes)}
        </span>
      ),
    },
    { id: "sites", header: "Sites", align: "right", cell: (p) => <span className="tabular-nums text-slate-800">{p.siteCount}</span> },
    {
      id: "facilities",
      header: "Facilities",
      cell: (p) => (
        <span className="block max-w-[14rem] truncate text-slate-700" title={p.facilitiesSummary}>
          {p.facilitiesSummary || "–"}
        </span>
      ),
    },
    {
      id: "cost",
      header: "Cost",
      align: "right",
      tooltip: "The costed amount once costing is signed off, else the preliminary cost from the needs assessment.",
      cell: (p) => (
        <span className="whitespace-nowrap tabular-nums text-slate-900">
          {money(p.costedAmountNgn ?? p.preliminaryCostNgn)}
          <span className="block text-[10px] text-slate-500">{p.costedAmountNgn !== null ? "Costed" : p.preliminaryCostNgn !== null ? "Preliminary" : ""}</span>
        </span>
      ),
    },
    { id: "stage", header: "Stage", cell: (p) => <span className="whitespace-nowrap text-slate-800">{stageLabel(cycle, p.stage)}</span> },
    { id: "status", header: "Status", cell: (p) => <ProposalStatusTag status={p.status} label={p.statusLabel} /> },
    { id: "flags", header: "Flags", cell: (p) => <FlagChips kinds={p.openFlagKinds} /> },
    {
      id: "next",
      header: "Next",
      cell: (p) => (
        <span className="whitespace-nowrap text-slate-700">
          {p.nextActor ?? "–"}
          {p.waitingForMe && <span className="block text-[10px] font-semibold text-brand-primary">Waiting for you</span>}
        </span>
      ),
    },
  ];

  return (
    <StandardTable<NeedsProposalSummaryDto>
      title="Proposed projects"
      subtitle={query.isLoading ? "Loading…" : `${rows.length} proposed project${rows.length === 1 ? "" : "s"}${anyFilter ? " match the filters" : ""}`}
      headerActions={
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={secondaryButton} disabled={template.isPending} onClick={() => template.mutate(cycle.id)}>
            <Download className="h-3.5 w-3.5" aria-hidden="true" /> {template.isPending ? "Preparing…" : "Download template"}
          </button>
          {canUpload && (
            <button type="button" className={primaryButton} onClick={onUpload}>
              <FileUp className="h-3.5 w-3.5" aria-hidden="true" /> Upload needs assessments
            </button>
          )}
        </div>
      }
      search={{ value: search, onChange: setSearch, placeholder: "Search reference, title or school" }}
      filters={
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-48">
            <CustomSelect ariaLabel="Stage" value={stage} onChange={(v) => setStage(v as NeedsStage | "")} options={stageOptions} size="sm" />
          </div>
          <div className="w-44">
            <CustomSelect ariaLabel="Status" value={status} onChange={(v) => setStatus(v as NeedsProposalStatus | "")} options={statusOptions} size="sm" />
          </div>
          <button
            type="button"
            aria-pressed={waitingForMe}
            onClick={() => setWaitingForMe((v) => !v)}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary ${
              waitingForMe ? "border-brand-primary bg-brand-primary text-white" : "border-slate-300 text-slate-700 hover:bg-slate-50"
            }`}
          >
            Waiting for me
          </button>
          {anyFilter && (
            <button type="button" onClick={clear} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-brand-primary hover:underline">
              Clear filters
            </button>
          )}
        </div>
      }
      columns={columns}
      data={rows}
      loading={query.isLoading}
      keyExtractor={(p) => p.id}
      onRowClick={(p) => navigate(`/app/needs-assessment/proposals/${p.id}`)}
      minWidth="min-w-[1180px]"
      emptyState={
        anyFilter
          ? { title: "No proposed project matches these filters", action: <button type="button" onClick={clear} className="text-xs font-semibold text-brand-primary hover:underline">Clear filters</button> }
          : {
              title: "No proposed projects yet",
              description: canUpload
                ? "Download the template, fill one file per proposed project and upload the files."
                : "Proposed projects appear here once their needs assessments are uploaded.",
            }
      }
    />
  );
}
