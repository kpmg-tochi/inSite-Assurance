import React, { useMemo, useState } from "react";
import { ArrowRight, ChevronDown, ChevronRight, FileUp, Plus, Trash2 } from "lucide-react";
import {
  formatProjectCode,
  isOngoingProject,
  lgaByCode,
  parseLotBatchCode,
  projectStageChipLabel,
  stateByCode,
  zoneName,
  type PortfolioOverviewProject,
  type ProjectListFilters,
  type ProjectRegisterFilters,
  type ProjectSiteSummaryDto,
  SCHOOL_LEVEL_LABELS,
} from "@insite/shared";
import { SiteStatusChip, sitePercentText } from "../../components/sites/siteStatus";
import { useAuth, useTerm } from "../../lib/auth-context";
import { useGuardedNavigate } from "../../lib/navigationGuard";
import { formatCompactNaira, formatDateShort } from "../../lib/formatters";
import { ProjectRegisterExportMenu } from "../../components/projects/ProjectRegisterExportMenu";
import { ProjectRegisterImportDialog } from "../../components/projects/ProjectRegisterImportDialog";
import { ProjectAlertIndicator } from "../../components/projects/ProjectAlertIndicator";
import { useDraftProjectsQuery } from "../../queries/projects/useProjectSetupQueries";
import { useDeleteDraftMutation } from "../../mutations/projects/useProjectSetupMutations";
import { StandardTable, TableActionButton, type TableColumnDef } from "../../components/table";
import { mapStatusOf } from "./PortfolioMap";
import { TAB_LIST_CLASS, tabCountClass, tabItemClass } from "../../components/common/Tabs";

export type ProjectTableFilter = "all" | "ongoing" | "behind" | "completed" | "archived" | "drafts";

type DraftRow = NonNullable<ReturnType<typeof useDraftProjectsQuery>["data"]>[number];

/** Client demo updates C2 (wave 2): a project row, or one of its sites under it (as the client's register shows them). */
type RegisterRow = { kind: "project"; p: PortfolioOverviewProject } | { kind: "site"; p: PortfolioOverviewProject; site: ProjectSiteSummaryDto };

const sitesOf = (p: PortfolioOverviewProject) => p.sites ?? [];

const isCompleted = (p: PortfolioOverviewProject) =>
  p.status === "ACTIVE" && (p.constructionPhase === "RETENTION_PERIOD" || p.constructionPhase === "COMPLETED_CLOSED");

const FILTER_TEST: Record<Exclude<ProjectTableFilter, "drafts">, (p: PortfolioOverviewProject) => boolean> = {
  all: () => true,
  ongoing: isOngoingProject,
  behind: (p) => p.scheduleVariance?.status === "BEHIND",
  completed: isCompleted,
  archived: (p) => p.status === "ARCHIVED",
};

/** Client demo updates C1: the state and LGA names from their codes, else what an older project recorded. */
function locationOf(p: PortfolioOverviewProject) {
  return {
    state: stateByCode(p.stateCode)?.name ?? (p.stateLocation || p.region?.name || null),
    lga: lgaByCode(p.lgaCode)?.name ?? p.lgaLocation ?? null,
    zone: zoneName(p.zone),
  };
}

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
  search: controlledSearch,
  onSearchChange,
  registerFilters,
  title = "Projects",
  subtitle,
  headerAction,
}: {
  projects: PortfolioOverviewProject[];
  /** The header title; the Change project dialog passes its own (with the id that names the dialog). */
  title?: React.ReactNode;
  /** The header line under the title, from the rows shown and the total; defaults to the count and "Select a project to open it." */
  subtitle?: (shown: number, total: number) => React.ReactNode;
  /** One more control at the end of the header (the Change project dialog's close button). */
  headerAction?: React.ReactNode;
  /** UBEC IRL: a controlled search box (the home page keeps it in the URL); left out, the table keeps its own. */
  search?: string;
  onSearchChange?: (value: string) => void;
  /** UBEC IRL: the filters applied to `projects`, passed to the register export (with the status button and search). */
  registerFilters?: ProjectListFilters;
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
  const [ownSearch, setOwnSearch] = useState("");
  const search = controlledSearch ?? ownSearch;
  const setSearch = onSearchChange ?? setOwnSearch;
  const [importOpen, setImportOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const toggleExpanded = (projectId: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  const term = useTerm();
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
      const loc = locationOf(p);
      return [
        p.name,
        p.codePrefix,
        formatProjectCode(p.codePrefix),
        p.externalReference ?? "",
        p.primaryBeneficiary?.name ?? "",
        p.stateLocation,
        p.lgaLocation ?? "",
        loc.state ?? "",
        loc.lga ?? "",
        loc.zone ?? "",
        p.region?.name ?? "",
        p.contractorName ?? "",
        p.projectType?.name ?? "",
        ...sitesOf(p).flatMap((s) => [s.schoolName, s.lgaName ?? ""]),
      ].some((v) => v.toLowerCase().includes(q));
    });
  }, [projects, filter, q]);
  const draftRows = useMemo(
    () =>
      filter === "drafts"
        ? drafts.filter(
            (d) => !q || [d.name, d.codePrefix, formatProjectCode(d.codePrefix)].some((v) => v.toLowerCase().includes(q))
          )
        : [],
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
  // UBEC IRL: the register export (what the table shows: filters, status button, search) and the bulk import.
  const exportFilters: ProjectRegisterFilters = {
    ...(registerFilters ?? {}),
    ...(filter !== "all" && filter !== "drafts" ? { status: filter } : {}),
    ...(search.trim() ? { q: search.trim() } : {}),
  };
  const headerActions = hideCreate ? headerAction : (
    <div className="flex flex-wrap items-center gap-2">
      <ProjectRegisterExportMenu filters={exportFilters} />
      {canCreate && (
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-xl border border-white/30 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <FileUp className="w-3.5 h-3.5" aria-hidden="true" /> Import projects
        </button>
      )}
      {newProject}
      {importOpen && <ProjectRegisterImportDialog onClose={() => setImportOpen(false)} />}
      {headerAction}
    </div>
  );
  const searchBox = { value: search, onChange: setSearch, placeholder: "Search by name, code, project ID, school, zone, state, LGA or contractor" };

  if (filter === "drafts") {
    const draftColumns: TableColumnDef<DraftRow>[] = [
      {
        id: "project",
        header: "Project",
        cell: (d) => (
          <div className="min-w-0 max-w-[360px]">
            <div className="text-[11px] font-semibold text-slate-500 tabular-nums">
              {formatProjectCode(d.codePrefix)}
              {parseLotBatchCode(d.codePrefix) && <span className="font-medium"> · {parseLotBatchCode(d.codePrefix)!.year}</span>}
            </div>
            <div className="font-semibold text-slate-900 truncate" title={d.name}>
              {d.name}
            </div>
          </div>
        ),
      },
      { id: "steps", header: "Setup", cell: (d) => <span className="text-slate-600 whitespace-nowrap">{d.completedRequiredSteps} of {d.totalRequiredSteps} steps done</span> },
      { id: "by", header: "Started by", cell: (d) => <span className="text-slate-600">{d.createdByName ?? "Someone"}</span> },
      { id: "saved", header: "Last saved", cell: (d) => <span className="text-slate-600 whitespace-nowrap">{formatDateShort(d.updatedAt)}</span> },
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
        title={title}
        subtitle="Drafts stay private to the people setting them up until they are made active."
        headerActions={headerActions}
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
    // Client demo updates C3: the code as people read it ("LOT 5 BATCH 7"), the intervention year beside it.
    {
      id: "code",
      header: "Code",
      cell: (p) => <span className="text-xs font-semibold text-slate-700 tabular-nums whitespace-nowrap">{formatProjectCode(p.codePrefix)}</span>,
    },
    {
      id: "year",
      header: "Year",
      tooltip: "Intervention year",
      cell: (p) => (p.interventionYear !== null ? <span className="text-slate-700 tabular-nums">{p.interventionYear}</span> : <span className="text-slate-400">–</span>),
    },
    {
      id: "project",
      header: "Project",
      cell: (p) => (
        <div className="min-w-0 max-w-[260px]">
          {p.externalReference && (
            <div className="text-[11px] text-slate-500 truncate" title={`${term("externalReference")}: ${p.externalReference}`}>
              <span className="sr-only">{term("externalReference")}: </span>
              {p.externalReference}
            </div>
          )}
          <div className="font-semibold text-slate-900 truncate" title={p.name}>
            {p.name}
          </div>
          {sitesOf(p).length > 0 && (
            <button
              type="button"
              aria-expanded={expanded.has(p.id)}
              onClick={(e) => {
                e.stopPropagation();
                toggleExpanded(p.id);
              }}
              className="mt-1 inline-flex items-center gap-0.5 rounded text-xs font-semibold text-brand-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
            >
              {expanded.has(p.id) ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
              {sitesOf(p).length} site{sitesOf(p).length === 1 ? "" : "s"}
            </button>
          )}
        </div>
      ),
    },
    {
      id: "contractor",
      header: "Contractor",
      cell: (p) =>
        p.contractorName ? (
          <span className="block max-w-[180px] truncate text-slate-700" title={p.contractorName}>
            {p.contractorName}
          </span>
        ) : (
          <span className="text-slate-400" title="No contractor named yet">–</span>
        ),
    },
    { id: "type", header: "Type", cell: (p) => <span className="block max-w-[140px] text-slate-700">{p.projectType?.name ?? "–"}</span> },
    {
      id: "location",
      header: "Location",
      cell: (p) => {
        const loc = locationOf(p);
        return (
          <span className="block text-slate-700 whitespace-nowrap">
            {loc.state ?? "–"}
            {loc.lga ? <span className="text-slate-500"> · {loc.lga}</span> : null}
            {loc.zone && <span className="block text-[11px] text-slate-500">{loc.zone}</span>}
          </span>
        );
      },
    },
    {
      id: "stage",
      header: "Stage",
      cell: (p) =>
        p.stage ? (
          // UBEC IRL alerts: one compact indicator; the tooltip lists them (rows stay one line tall).
          <span className="flex max-w-[190px] items-center gap-2 text-slate-700">
            <span className="min-w-0">
              {projectStageChipLabel(p.stage)}
              {p.stage.contractTerminated && <span className="text-rose-700"> · terminated</span>}
            </span>
            <ProjectAlertIndicator alerts={p.activeAlerts} />
          </span>
        ) : (
          <span className="text-slate-400">–</span>
        ),
    },
    {
      id: "budget",
      header: "Contract sum",
      align: "right",
      // Owner decision 3 (2026-11-26): the contract sum, as the register export; "–" until contracted.
      cell: (p) =>
        p.contractSumNgn !== null ? (
          <span className="text-slate-900 whitespace-nowrap tabular-nums">{formatCompactNaira(p.contractSumNgn)}</span>
        ) : (
          <span className="text-slate-500" title="Not yet contracted">–</span>
        ),
    },
    {
      id: "progress",
      header: "Progress",
      cell: (p) => (
        <div className="w-28">
          <div className="text-xs font-semibold text-slate-800 tabular-nums">
            {Math.round(p.certifiedProgressPct)}%
            {p.progressIsImported && (
              <span className="ml-1 text-[10px] font-medium text-slate-500" title="Reported at import; replaced by verified progress once the scope is added">
                reported
              </span>
            )}
          </div>
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
      id: "lastUpdate",
      header: <span title="Last approved monitoring report">Last update</span>,
      cell: (p) =>
        p.lastApprovedUpdateAt ? (
          <span className="text-slate-700 whitespace-nowrap" title="Last approved monitoring report">
            {formatDateShort(p.lastApprovedUpdateAt)}
          </span>
        ) : (
          <span className="text-slate-400" title="No approved monitoring report yet">–</span>
        ),
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

  // Client demo updates C2 (wave 2): site sub-rows under an expanded project (site no., school, LGA, % complete, status).
  const siteCells: Record<string, (s: ProjectSiteSummaryDto) => React.ReactNode> = {
    code: (s) => <span className="block pl-3 text-xs font-semibold text-slate-500 tabular-nums whitespace-nowrap">Site {s.siteNumber}</span>,
    project: (s) => (
      <div className="min-w-0 max-w-[260px] pl-3 border-l-2 border-slate-200">
        <div className="text-[13px] font-medium text-slate-800 truncate" title={s.schoolName}>
          {s.schoolName}
        </div>
        <div className="text-[11px] text-slate-500">{SCHOOL_LEVEL_LABELS[s.schoolLevel]}</div>
      </div>
    ),
    location: (s) => <span className="block text-slate-600 whitespace-nowrap">{s.lgaName ?? "–"}</span>,
    progress: (s) => (
      <div className="w-28">
        <div className="text-xs font-semibold text-slate-700 tabular-nums">{sitePercentText(s.progressPct)}</div>
        <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-slate-200" aria-hidden="true">
          <div className="h-full rounded-full bg-brand-primary/70" style={{ width: `${Math.min(100, Math.max(0, s.progressPct ?? 0))}%` }} />
        </div>
      </div>
    ),
    schedule: (s) => <SiteStatusChip status={s.status} />,
  };
  // The Change project dialog (hideCreate) shows only what helps pick a project, so it fits without side-scrolling.
  const PICKER_COLUMN_IDS = new Set(["code", "year", "project", "contractor", "location", "stage"]);
  const shownColumns = hideCreate ? columns.filter((col) => PICKER_COLUMN_IDS.has(col.id)) : columns;
  const registerColumns: TableColumnDef<RegisterRow>[] = shownColumns.map((col) => ({
    ...col,
    cell: (row: RegisterRow, index: number) => (row.kind === "project" ? col.cell(row.p, index) : siteCells[col.id]?.(row.site) ?? null),
  }));
  const registerRows: RegisterRow[] = rows.flatMap((p) => [
    { kind: "project" as const, p },
    ...(expanded.has(p.id) ? sitesOf(p).map((site) => ({ kind: "site" as const, p, site })) : []),
  ]);

  return (
    <StandardTable<RegisterRow>
      title={title}
      subtitle={subtitle ? subtitle(rows.length, projects.length) : `${rows.length} of ${projects.length} shown. Select a project to open it.`}
      headerActions={headerActions}
      search={searchBox}
      filters={filterButtons}
      columns={registerColumns}
      data={registerRows}
      keyExtractor={(row) => (row.kind === "project" ? row.p.id : `site:${row.site.id}`)}
      rowClassName={(row) => (row.kind === "site" ? "bg-slate-50/60" : "")}
      onRowClick={(row) => onOpenProject(row.p.id)}
      selectedId={selectedId}
      pageSize={pageSize}
      loading={loading}
      minWidth="min-w-[1280px]"
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
