import React, { useEffect, useMemo, useState } from "react";
import { Download, FileUp } from "lucide-react";
import { NeedsProposalStatusEnum, type NeedsCycleDto, type NeedsProposalStatus, type NeedsProposalSummaryDto, type NeedsStage } from "@insite/shared";
import { StandardTable, type TableColumnDef } from "../../components/table";
import { CustomSelect } from "../../components/common/CustomSelect";
import { primaryButton, secondaryButton } from "../../components/contracts/contractUi";
import { FlagChips, ProposalStatusTag, locationText, money, stageLabel } from "../../components/needs/needsUi";
import { ProposalBatchBar } from "../../components/needs/decisions/ProposalBatchBar";
import { useNeedsProposalsQuery } from "../../queries/needs/useNeedsQueries";
import { useNeedsTasksQuery } from "../../queries/needs/useDecisionQueries";
import { useDownloadCycleTemplateMutation } from "../../mutations/needs/useNeedsMutations";
import { useGuardedNavigate } from "../../lib/navigationGuard";

// Kept for earlier imports: the stage name now lives with the other needs helpers.
export { stageLabel };

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

/**
 * Needs pipeline wave 2 (C2) and wave 3 (C1, C4): the cycle's proposed projects. Filters (stage,
 * status, search, "Waiting for me") go to the server; the table pages in the browser. "Waiting for me"
 * is on by default when the user has tasks on proposed projects of this cycle. Rows can be selected
 * (tick boxes) for the batch action bar; a row opens the proposal page.
 */
export function ProposedProjectsTab({ cycle, canUpload, onUpload }: { cycle: NeedsCycleDto; canUpload: boolean; onUpload: () => void }) {
  const navigate = useGuardedNavigate();
  const template = useDownloadCycleTemplateMutation();
  const [stage, setStage] = useState<NeedsStage | "">("");
  const [status, setStatus] = useState<NeedsProposalStatus | "">("");
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  // null = not chosen yet: on when the user has tasks on proposed projects of this cycle.
  const [waitingChoice, setWaitingChoice] = useState<boolean | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const tasksQuery = useNeedsTasksQuery(cycle.id);
  const hasTasks = (tasksQuery.data ?? []).some((t) => t.proposalId !== null);
  const tasksSettled = !tasksQuery.isLoading;
  const waitingForMe = waitingChoice ?? hasTasks;

  // The search goes to the server once typing pauses.
  useEffect(() => {
    const t = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  // Another cycle starts with a fresh selection and default.
  useEffect(() => {
    setSelectedIds(new Set());
    setWaitingChoice(null);
  }, [cycle.id]);

  const query = useNeedsProposalsQuery(tasksSettled ? cycle.id : null, {
    stage: stage || undefined,
    status: status || undefined,
    q: q || undefined,
    waitingForMe: waitingForMe ? "true" : undefined,
  });
  const rows = useMemo(() => query.data ?? [], [query.data]);
  const anyFilter = Boolean(stage || status || q || waitingForMe);
  // The selection follows the rows on screen (a filter that hides a row drops it from the batch).
  const selected = useMemo(() => rows.filter((r) => selectedIds.has(r.id)), [rows, selectedIds]);
  const allSelected = rows.length > 0 && selected.length === rows.length;

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
    setWaitingChoice(false);
  };

  const toggle = (id: string, on: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  const toggleAll = (on: boolean) => setSelectedIds(on ? new Set(rows.map((r) => r.id)) : new Set());

  const columns: TableColumnDef<NeedsProposalSummaryDto>[] = [
    {
      id: "select",
      header: (
        <input
          type="checkbox"
          aria-label={allSelected ? "Clear the selection" : `Select all ${rows.length} proposed projects`}
          checked={allSelected}
          ref={(el) => {
            if (el) el.indeterminate = selected.length > 0 && !allSelected;
          }}
          disabled={rows.length === 0}
          onChange={(e) => toggleAll(e.target.checked)}
        />
      ),
      width: "w-10",
      cell: (p) => (
        <input
          type="checkbox"
          aria-label={`Select ${p.reference}`}
          checked={selectedIds.has(p.id)}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => toggle(p.id, e.target.checked)}
        />
      ),
    },
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
    <div className="space-y-2">
      <ProposalBatchBar cycle={cycle} selected={selected} onClear={() => setSelectedIds(new Set())} />
      <StandardTable<NeedsProposalSummaryDto>
        title="Proposed projects"
        subtitle={
          query.isLoading || !tasksSettled
            ? "Loading…"
            : `${rows.length} proposed project${rows.length === 1 ? "" : "s"}${anyFilter ? " match the filters" : ""}${waitingForMe && waitingChoice === null ? " (showing what waits for you)" : ""}`
        }
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
              onClick={() => setWaitingChoice(!waitingForMe)}
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
        loading={query.isLoading || !tasksSettled}
        keyExtractor={(p) => p.id}
        onRowClick={(p) => navigate(`/app/needs-assessment/proposals/${p.id}`)}
        rowClassName={(p) => (selectedIds.has(p.id) ? "bg-brand-primary/[0.05]" : "")}
        minWidth="min-w-[1220px]"
        emptyState={
          anyFilter
            ? {
                title: waitingForMe && !stage && !status && !q ? "Nothing is waiting for you" : "No proposed project matches these filters",
                action: (
                  <button type="button" onClick={clear} className="text-xs font-semibold text-brand-primary hover:underline">
                    {waitingForMe && !stage && !status && !q ? "Show every proposed project" : "Clear filters"}
                  </button>
                ),
              }
            : {
                title: "No proposed projects yet",
                description: canUpload
                  ? "Download the template, fill one file per proposed project and upload the files."
                  : "Proposed projects appear here once their needs assessments are uploaded.",
              }
        }
      />
    </div>
  );
}
