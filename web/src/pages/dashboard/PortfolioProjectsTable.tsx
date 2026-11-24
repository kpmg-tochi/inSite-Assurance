import React, { useMemo, useState } from "react";
import { ArrowRight, Plus, Trash2 } from "lucide-react";
import { isOngoingProject, projectStageChipLabel, type PortfolioOverviewProject } from "@insite/shared";
import { useAuth } from "../../lib/auth-context";
import { useGuardedNavigate } from "../../lib/navigationGuard";
import { formatCompactNaira } from "../../lib/formatters";
import { useDraftProjectsQuery } from "../../queries/projects/useProjectSetupQueries";
import { useDeleteDraftMutation } from "../../mutations/projects/useProjectSetupMutations";
import { StandardTable, TableActionButton, type TableColumnDef } from "../../components/table";
import { mapStatusOf } from "./PortfolioMap";
import { TAB_LIST_CLASS, tabCountClass, tabItemClass } from "../../components/common/Tabs";

export type ProjectTableFilter = "all" | "ongoing" | "behind" | "completed" | "archived" | "drafts";

type DraftRow = NonNullable<ReturnType<typeof useDraftProjectsQuery>["data"]>[number];

const isCompleted = (p: PortfolioOverviewProject) =>
  p.status === "ACTIVE" && (p.constructionPhase === "RETENTION_PERIOD" || p.constructionPhase === "COMPLETED_CLOSED");

const FILTER_TEST: Record<Exclude<ProjectTableFilter, "drafts">, (p: PortfolioOverviewProject) => boolean> = {
  all: () => true,
  ongoing: isOngoingProject,
  behind: (p) => p.scheduleVariance?.status === "BEHIND",
  completed: isCompleted,
  archived: (p) => p.status === "ARCHIVED",
};

const FILTER_LABEL: Record<ProjectTableFilter, string> = {
  all: "All",
  ongoing: "Ongoing",
  behind: "Behind schedule",
  completed: "Completed",
  archived: "Archived",
  drafts: "Drafts",
};

/**
 * The projects in view under the map (UBEC rebrand: replaces the separate Projects page). The only
 * way into a project: select a row. Status filters are plain buttons; the stat strip above can set
 * one. Drafts are listed for the people who set projects up.
 */
export function PortfolioProjectsTable({
  projects,
  filter,
  onFilterChange,
  onOpenProject,
  loading,
  hideCreate = false,
  pageSize,
  selectedId = null,
}: {
  projects: PortfolioOverviewProject[];
  filter: ProjectTableFilter;
  onFilterChange: (f: ProjectTableFilter) => void;
  onOpenProject: (projectId: string) => void;
  loading?: boolean;
  /** In the Change project dialog: no New project button and no drafts. */
  hideCreate?: boolean;
  pageSize?: number;
  /** Highlights a row (the open project). */
  selectedId?: string | null;
}) {
  const { hasPermission } = useAuth();
  const navigate = useGuardedNavigate();
  const [search, setSearch] = useState("");
  const canCreate = !hideCreate && hasPermission("projects:create");
  const canSeeDrafts = !hideCreate && (hasPermission("projects:create") || hasPermission("projects:edit_baseline"));
  const draftsQuery = useDraftProjectsQuery(canSeeDrafts);
  const drafts = useMemo(() => draftsQuery.data ?? [], [draftsQuery.data]);
  const deleteDraft = useDeleteDraftMutation();

  const counts = useMemo(() => {
    const c: Record<ProjectTableFilter, number> = { all: projects.length, ongoing: 0, behind: 0, completed: 0, archived: 0, drafts: drafts.length };
    for (const p of projects) {
      if (FILTER_TEST.ongoing(p)) c.ongoing += 1;
      if (FILTER_TEST.behind(p)) c.behind += 1;
      if (FILTER_TEST.completed(p)) c.completed += 1;
      if (FILTER_TEST.archived(p)) c.archived += 1;
    }
    return c;
  }, [projects, drafts.length]);

  const q = search.trim().toLowerCase();
  const rows = useMemo(() => {
    if (filter === "drafts") return [];
    return projects.filter((p) => {
      if (!FILTER_TEST[filter](p)) return false;
      if (!q) return true;
      return [p.name, p.codePrefix, p.stateLocation, p.lgaLocation ?? "", p.region?.name ?? "", p.contractorName ?? "", p.projectType?.name ?? ""]
        .some((v) => v.toLowerCase().includes(q));
    });
  }, [projects, filter, q]);
  const draftRows = useMemo(
    () => (filter === "drafts" ? drafts.filter((d) => !q || d.name.toLowerCase().includes(q) || d.codePrefix.toLowerCase().includes(q)) : []),
    [drafts, filter, q]
  );

  const visibleFilters: ProjectTableFilter[] = [
    "all",
    "ongoing",
    "behind",
    "completed",
    ...(counts.archived > 0 ? (["archived"] as const) : []),
    ...(canSeeDrafts && counts.drafts > 0 ? (["drafts"] as const) : []),
  ];
  const filterButtons = (
    <div role="group" aria-label="Show projects" className={TAB_LIST_CLASS}>
      {visibleFilters.map((f) => (
        <button
          key={f}
          type="button"
          aria-pressed={filter === f}
          onClick={() => onFilterChange(f)}
          className={tabItemClass(filter === f)}
        >
          {FILTER_LABEL[f]}<span className={tabCountClass(filter === f)}>{counts[f]}</span>
        </button>
      ))}
    </div>
  );

  const newProject = canCreate ? (
    <button
      type="button"
      onClick={() => navigate("/app/projects/new")}
      className="inline-flex items-center gap-1.5 rounded-xl bg-white px-3 py-1.5 text-xs font-semibold text-brand-navy hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      <Plus className="w-3.5 h-3.5" aria-hidden="true" /> New project
    </button>
  ) : undefined;
  const searchBox = { value: search, onChange: setSearch, placeholder: "Search by name, code, state or contractor" };

  if (filter === "drafts") {
    const draftColumns: TableColumnDef<DraftRow>[] = [
      {
        id: "project",
        header: "Project",
        cell: (d) => (
          <div className="min-w-0 max-w-[360px]">
            <div className="text-[11px] font-semibold text-slate-500 tabular-nums">{d.codePrefix}</div>
            <div className="font-semibold text-slate-900 truncate" title={d.name}>
              {d.name}
            </div>
          </div>
        ),
      },
      { id: "steps", header: "Setup", cell: (d) => <span className="text-slate-600 whitespace-nowrap">{d.completedRequiredSteps} of {d.totalRequiredSteps} steps done</span> },
      { id: "by", header: "Started by", cell: (d) => <span className="text-slate-600">{d.createdByName ?? "Someone"}</span> },
      { id: "saved", header: "Last saved", cell: (d) => <span className="text-slate-600 whitespace-nowrap">{new Date(d.updatedAt).toLocaleDateString("en-GB")}</span> },
      {
        id: "actions",
        header: <span className="sr-only">Actions</span>,
        align: "right",
        cell: (d) => (
          <div className="flex items-center justify-end gap-2">
            {d.canDelete && (
              <TableActionButton
                variant="danger"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => {
                  if (window.confirm(`Delete the draft "${d.name}"? This cannot be undone.`)) deleteDraft.mutate(d.id);
                }}
              >
                Delete
              </TableActionButton>
            )}
            <TableActionButton variant="primary" onClick={() => navigate(`/app/projects/${d.id}/setup/review`)}>
              <span className="inline-flex items-center gap-1">
                Continue setup <ArrowRight className="w-3.5 h-3.5" />
              </span>
            </TableActionButton>
          </div>
        ),
      },
    ];
    return (
      <StandardTable<DraftRow>
        title="Projects"
        subtitle="Drafts stay private to the people setting them up until they are made active."
        headerActions={newProject}
        search={searchBox}
        filters={filterButtons}
        columns={draftColumns}
        data={draftRows}
        keyExtractor={(d) => d.id}
        loading={draftsQuery.isLoading}
        minWidth="min-w-[760px]"
        onRowClick={(d) => navigate(`/app/projects/${d.id}/setup/review`)}
        emptyState={{ title: "No drafts", description: "A project you start stays here until you make it active." }}
      />
    );
  }

  const columns: TableColumnDef<PortfolioOverviewProject>[] = [
    {
      id: "project",
      header: "Project",
      cell: (p) => (
        <div className="min-w-0 max-w-[300px]">
          <div className="text-[11px] font-semibold text-slate-500 tabular-nums">{p.codePrefix}</div>
          <div className="font-semibold text-slate-900 truncate" title={p.name}>
            {p.name}
          </div>
          {p.contractorName && <div className="text-xs text-slate-500 truncate">{p.contractorName}</div>}
        </div>
      ),
    },
    { id: "type", header: "Type", cell: (p) => <span className="block max-w-[140px] text-slate-700">{p.projectType?.name ?? "–"}</span> },
    {
      id: "location",
      header: "Location",
      cell: (p) => (
        <span className="text-slate-700 whitespace-nowrap">
          {p.stateLocation || p.region?.name || "–"}
          {p.lgaLocation ? <span className="text-slate-500"> · {p.lgaLocation}</span> : null}
        </span>
      ),
    },
    {
      id: "stage",
      header: "Stage",
      cell: (p) =>
        p.stage ? (
          <span className="block max-w-[170px] text-slate-700">
            {projectStageChipLabel(p.stage)}
            {p.stage.contractTerminated && <span className="text-rose-700"> · terminated</span>}
          </span>
        ) : (
          <span className="text-slate-400">–</span>
        ),
    },
    {
      id: "budget",
      header: "Contract sum",
      align: "right",
      cell: (p) => <span className="text-slate-900 whitespace-nowrap tabular-nums">{formatCompactNaira(p.totalBudgetNgn)}</span>,
    },
    {
      id: "progress",
      header: "Progress",
      cell: (p) => (
        <div className="w-28">
          <div className="text-xs font-semibold text-slate-800 tabular-nums">{Math.round(p.certifiedProgressPct)}%</div>
          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
            <div className="h-full rounded-full bg-brand-primary" style={{ width: `${Math.min(100, Math.max(0, p.certifiedProgressPct))}%` }} />
          </div>
        </div>
      ),
    },
    {
      id: "schedule",
      header: "Schedule",
      cell: (p) => {
        const s = mapStatusOf(p);
        return (
          <span className="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-700">
            <span className="h-2 w-2 rounded-full shrink-0" style={{ background: s.color }} aria-hidden="true" />
            {p.scheduleVariance?.label ?? s.label}
          </span>
        );
      },
    },
    {
      id: "findings",
      header: "Open findings",
      align: "right",
      cell: (p) =>
        p.openFindingsCount > 0 ? (
          <span className="font-semibold text-slate-900 tabular-nums">{p.openFindingsCount}</span>
        ) : (
          <span className="text-slate-400">–</span>
        ),
    },
  ];

  return (
    <StandardTable<PortfolioOverviewProject>
      title="Projects"
      subtitle={`${rows.length} of ${projects.length} shown. Select a project to open it.`}
      headerActions={newProject}
      search={searchBox}
      filters={filterButtons}
      columns={columns}
      data={rows}
      keyExtractor={(p) => p.id}
      onRowClick={(p) => onOpenProject(p.id)}
      selectedId={selectedId}
      pageSize={pageSize}
      loading={loading}
      minWidth="min-w-[980px]"
      emptyState={{
        title: projects.length === 0 ? "No projects yet" : "No projects match",
        description:
          projects.length === 0
            ? canCreate
              ? "Start the first project with New project."
              : "You have not been given access to a project yet."
            : "Change the search or choose another filter.",
      }}
    />
  );
}
