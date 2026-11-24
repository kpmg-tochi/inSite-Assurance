import React, { useMemo, useState } from "react";
import { DeliveryModelFilters, ProjectTypeChip, useDeliveryModelFilters } from "../../components/projects/DeliveryModelFilters";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Archive, ArrowRight, ClipboardList, FileSpreadsheet, LayoutDashboard, Settings2, Trash2 } from "lucide-react";
import type { ProjectSummaryDto } from "../../api/types";
import { formatCompactNaira } from "../../lib/formatters";
import { useAuth, useTerm } from "../../lib/auth-context";
import { useDraftProjectsQuery } from "../../queries/projects/useProjectSetupQueries";
import { useDeleteDraftMutation } from "../../mutations/projects/useProjectSetupMutations";
import { ArchiveProjectDialog } from "../../components/projects/ArchiveProjectDialog";
import { ScheduleBadge } from "../../components/schedule/ScheduleVarianceBadge";
import {
  StandardTable,
  TableActionButton,
  TableActionMenu,
  TableBadge,
  type TableActionItem,
  type TableBadgeVariant,
  type TableColumnDef,
} from "../../components/table";

type ProjectStatusTab = "ALL" | "ACTIVE" | "DRAFT" | "COMPLETED" | "ARCHIVED";

type DraftRow = NonNullable<ReturnType<typeof useDraftProjectsQuery>["data"]>[number];

interface ProjectsDirectoryPageProps {
  projects: ProjectSummaryDto[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
}

/** Drafts come from /projects/drafts; this list holds active and archived projects. */
function getDerivedProjectStatus(project: ProjectSummaryDto): Exclude<ProjectStatusTab, "ALL" | "DRAFT"> {
  if (project.status === "ARCHIVED") return "ARCHIVED";
  if (project.certifiedProgressPct >= 100) return "COMPLETED";
  return "ACTIVE";
}

const STATUS_BADGE: Record<Exclude<ProjectStatusTab, "ALL" | "DRAFT">, { label: string; variant: TableBadgeVariant }> = {
  ACTIVE: { label: "Active", variant: "info" },
  COMPLETED: { label: "Completed", variant: "success" },
  ARCHIVED: { label: "Archived", variant: "neutral" },
};

function contractorLabel(project: ProjectSummaryDto): string {
  const extra = (project.contractorCount ?? 0) - 1;
  const name = project.contractorOrganizationName || "No contractor";
  return extra > 0 ? `${name} +${extra}` : name;
}

export function ProjectsDirectoryPage({ projects, selectedProjectId, onSelectProject }: ProjectsDirectoryPageProps) {
  const { hasPermission } = useAuth();
  const term = useTerm();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = (searchParams.get("tab") || "").toUpperCase();
  const activeTab: ProjectStatusTab = (["ALL", "ACTIVE", "DRAFT", "COMPLETED", "ARCHIVED"] as const).includes(
    tabParam as ProjectStatusTab,
  )
    ? (tabParam as ProjectStatusTab)
    : "ALL";
  const setActiveTab = (tab: ProjectStatusTab) =>
    setSearchParams(tab === "ALL" ? {} : { tab: tab.toLowerCase() }, { replace: true });
  const canSeeDrafts = hasPermission("projects:create") || hasPermission("projects:edit_baseline");
  const draftsQuery = useDraftProjectsQuery(true);
  const drafts = useMemo(() => draftsQuery.data ?? [], [draftsQuery.data]);
  const deleteDraft = useDeleteDraftMutation();
  const canEditProjects = hasPermission("projects:edit_baseline");
  const [archiving, setArchiving] = useState<ProjectSummaryDto | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // Phase 11: type, region and owner filters.
  const deliveryFilters = useDeliveryModelFilters();
  const owners = useMemo(
    () => projects.map((p) => p.owningOrganization).filter((o): o is { id: string; name: string } => Boolean(o)),
    [projects],
  );

  const counts = useMemo(() => {
    const summary = { ALL: projects.length, ACTIVE: 0, DRAFT: drafts.length, COMPLETED: 0, ARCHIVED: 0 };
    for (const p of projects) summary[getDerivedProjectStatus(p)] += 1;
    return summary;
  }, [projects, drafts.length]);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return projects.filter((project) => {
      if (activeTab !== "ALL" && getDerivedProjectStatus(project) !== activeTab) return false;
      if (!deliveryFilters.matches(project)) return false;
      if (!q) return true;
      return (
        project.name.toLowerCase().includes(q) ||
        project.codePrefix.toLowerCase().includes(q) ||
        project.stateLocation.toLowerCase().includes(q) ||
        (project.lgaLocation || "").toLowerCase().includes(q) ||
        project.contractors.some((c) => c.organizationName.toLowerCase().includes(q)) ||
        project.lenderOrganizationName.toLowerCase().includes(q)
      );
    });
  }, [projects, activeTab, searchQuery, deliveryFilters]);

  const filteredDrafts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return drafts;
    return drafts.filter((d) => d.name.toLowerCase().includes(q) || d.codePrefix.toLowerCase().includes(q));
  }, [drafts, searchQuery]);

  const tabs: Array<{ id: ProjectStatusTab; label: string; count: number }> = [
    { id: "ALL", label: "All", count: counts.ALL },
    { id: "ACTIVE", label: "Active", count: counts.ACTIVE },
    ...(canSeeDrafts || drafts.length > 0 ? [{ id: "DRAFT" as const, label: "Drafts", count: counts.DRAFT }] : []),
    { id: "COMPLETED", label: "Completed", count: counts.COMPLETED },
    ...(counts.ARCHIVED > 0 ? [{ id: "ARCHIVED" as const, label: "Archived", count: counts.ARCHIVED }] : []),
  ];

  const openProject = (projectId: string, subRoute: "dashboard" | "scope" | "payments" = "dashboard") => {
    onSelectProject(projectId);
    navigate(`/app/projects/${projectId}/${subRoute}`);
  };

  const tabFilters = (
    <>
      {tabs.map((tab) => {
        const isSelected = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5 ${
              isSelected ? "bg-brand-navy text-white shadow-sm" : "bg-slate-100/80 text-slate-600 hover:bg-slate-200/70"
            }`}
          >
            <span>{tab.label}</span>
            <span
              className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                isSelected ? "bg-white/20 text-white" : "bg-white text-slate-600"
              }`}
            >
              {tab.count}
            </span>
          </button>
        );
      })}
    </>
  );

  const projectColumns: TableColumnDef<ProjectSummaryDto>[] = [
    {
      id: "project",
      header: "Project",
      cell: (p) => (
        <div className="min-w-0 max-w-[320px]">
          <div className="flex items-center gap-2">
            <span className="px-1.5 py-0.5 rounded-md bg-brand-navy text-white text-[10px] font-bold tracking-wide shrink-0">
              {p.codePrefix}
            </span>
            <span className="font-semibold text-slate-900 truncate" title={p.name}>
              {p.name}
            </span>
          </div>
          {p.projectType && (
            <div className="mt-1">
              <ProjectTypeChip type={p.projectType} />
            </div>
          )}
        </div>
      ),
    },
    {
      id: "location",
      header: "Location",
      cell: (p) => (
        <span className="text-slate-600 whitespace-nowrap">
          {p.stateLocation}
          {p.lgaLocation ? ` · ${p.lgaLocation}` : ""}
        </span>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (p) => {
        const s = STATUS_BADGE[getDerivedProjectStatus(p)];
        return <TableBadge variant={s.variant}>{s.label}</TableBadge>;
      },
    },
    {
      id: "parties",
      header: "Contractor · " + term("funderParty"),
      cell: (p) => (
        <div className="text-slate-600 max-w-[240px]">
          <div className="truncate" title={contractorLabel(p)}>{contractorLabel(p)}</div>
          <div className="truncate text-[11px] text-slate-400">
            {p.lenderOrganizationName || `No ${term("funderParty", { lower: true })}`}
          </div>
        </div>
      ),
    },
    {
      id: "budget",
      header: "Budget",
      align: "right",
      cell: (p) => <span className="font-semibold text-slate-900 whitespace-nowrap">{formatCompactNaira(p.totalBudgetNgn)}</span>,
    },
    {
      id: "progress",
      header: "Progress",
      cell: (p) => (
        <div className="w-28">
          <div className="text-[11px] font-bold text-slate-800">{p.certifiedProgressPct.toFixed(1)}%</div>
          <div className="w-full h-1.5 bg-slate-200 rounded-full mt-1 overflow-hidden">
            <div
              className="h-full bg-brand-primary rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, p.certifiedProgressPct))}%` }}
            />
          </div>
        </div>
      ),
    },
    {
      id: "schedule",
      header: "Schedule",
      cell: (p) => (p.scheduleVariance ? <ScheduleBadge badge={p.scheduleVariance} size="xs" /> : <span className="text-slate-400">–</span>),
    },
    {
      id: "flags",
      header: "Flags",
      cell: (p) => {
        const overdue = p.overdueMilestoneCount ?? 0;
        if (overdue === 0) return <span className="text-slate-400">–</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {overdue > 0 && (
              <TableBadge variant="danger" title="Contract milestones past their due date">
                {overdue} overdue
              </TableBadge>
            )}
          </div>
        );
      },
    },
    {
      id: "actions",
      header: <span className="sr-only">Actions</span>,
      align: "right",
      cell: (p) => {
        const actions: TableActionItem[] = [
          { label: "Open dashboard", icon: <LayoutDashboard className="w-4 h-4" />, onClick: () => openProject(p.id) },
          { label: `BOQ (${p.totalBoqItems})`, icon: <ClipboardList className="w-4 h-4" />, onClick: () => openProject(p.id, "scope") },
          ...(hasPermission("payments:view") || hasPermission("payments:record")
            ? [{ label: "Payments", icon: <FileSpreadsheet className="w-4 h-4" />, onClick: () => openProject(p.id, "payments") }]
            : []),
        ];
        if (canEditProjects) {
          actions.push({
            label: "Project settings",
            icon: <Settings2 className="w-4 h-4" />,
            onClick: () => navigate(`/app/projects/${p.id}/settings/basics`),
          });
          if (p.status === "ACTIVE") {
            actions.push({
              label: "Archive project",
              icon: <Archive className="w-4 h-4" />,
              variant: "danger",
              onClick: () => setArchiving(p),
            });
          }
        }
        return <TableActionMenu actions={actions} label={`Actions for ${p.codePrefix}`} />;
      },
    },
  ];

  const draftColumns: TableColumnDef<DraftRow>[] = [
    {
      id: "project",
      header: "Project",
      cell: (d) => (
        <div className="flex items-center gap-2 min-w-0 max-w-[360px]">
          <span className="px-1.5 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[10px] font-bold shrink-0">{d.codePrefix}</span>
          <span className="font-semibold text-slate-900 truncate" title={d.name}>{d.name}</span>
        </div>
      ),
    },
    {
      id: "steps",
      header: "Required steps",
      cell: (d) => (
        <span className="text-slate-600 whitespace-nowrap">
          {d.completedRequiredSteps} of {d.totalRequiredSteps} done
        </span>
      ),
    },
    { id: "startedBy", header: "Started by", cell: (d) => <span className="text-slate-600">{d.createdByName ?? "Someone"}</span> },
    {
      id: "saved",
      header: "Last saved",
      cell: (d) => <span className="text-slate-600 whitespace-nowrap">{new Date(d.updatedAt).toLocaleDateString()}</span>,
    },
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
              Resume <ArrowRight className="w-3.5 h-3.5" />
            </span>
          </TableActionButton>
        </div>
      ),
    },
  ];

  const search = { value: searchQuery, onChange: setSearchQuery, placeholder: "Search by name, code, state, contractor..." };

  return (
    <div className="space-y-4">
      <DeliveryModelFilters filters={deliveryFilters.filters} onChange={deliveryFilters.setFilters} owners={owners} />

      {activeTab === "DRAFT" ? (
        <StandardTable
          title="Drafts"
          subtitle="Drafts are private to the people setting them up until they are set active."
          search={search}
          filters={tabFilters}
          columns={draftColumns}
          data={filteredDrafts}
          keyExtractor={(d) => d.id}
          loading={draftsQuery.isLoading}
          minWidth="min-w-[760px]"
          onRowClick={(d) => navigate(`/app/projects/${d.id}/setup/review`)}
          emptyState={{ title: "No drafts", description: "A project you start is saved here until you set it active." }}
        />
      ) : (
        <StandardTable
          title="Projects"
          subtitle={`${filteredProjects.length} of ${projects.length} shown`}
          search={search}
          filters={tabFilters}
          columns={projectColumns}
          data={filteredProjects}
          keyExtractor={(p) => p.id}
          selectedId={selectedProjectId}
          onRowClick={(p) => openProject(p.id)}
          minWidth="min-w-[1180px]"
          emptyState={{ title: "No matching projects", description: "Try adjusting your search query or status filter." }}
        />
      )}

      {archiving && (
        <ArchiveProjectDialog
          projectId={archiving.id}
          projectName={archiving.name}
          codePrefix={archiving.codePrefix}
          onClose={() => setArchiving(null)}
        />
      )}
    </div>
  );
}
