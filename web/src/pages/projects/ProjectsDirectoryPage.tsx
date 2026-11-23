import React, { useEffect, useMemo, useRef, useState } from "react";
import { DeliveryModelFilters, ProjectTypeChip, useDeliveryModelFilters } from "../../components/projects/DeliveryModelFilters";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Building2,
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  FolderKanban,
  MapPin,
  Plus,
  Search,
  AlertTriangle,
  ArrowRight,
  Archive,
  MoreHorizontal,
  Settings2,
  Trash2,
} from "lucide-react";
import type { ProjectSummaryDto } from "../../api/types";
import { formatCompactNaira } from "../../lib/formatters";
import { useAuth, useTerm } from "../../lib/auth-context";
import { useDraftProjectsQuery } from "../../queries/projects/useProjectSetupQueries";
import { useDeleteDraftMutation } from "../../mutations/projects/useProjectSetupMutations";
import { ArchiveProjectDialog } from "../../components/projects/ArchiveProjectDialog";
import { ScheduleBadge } from "../../components/schedule/ScheduleVarianceBadge";

/** "⋯" menu on a project card: settings and archive (needs projects:edit_baseline). */
function ProjectCardMenu({
  project,
  onSettings,
  onArchive,
}: {
  project: ProjectSummaryDto;
  onSettings: () => void;
  onArchive: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  const item = "w-full flex items-center gap-2 px-3 py-2 text-left text-xs hover:bg-slate-50 focus:bg-slate-50 focus:outline-none";
  return (
    <div className="relative shrink-0" ref={ref}>
      <button
        type="button"
        aria-label={`Actions for ${project.codePrefix}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
      >
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-20 mt-1 w-48 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          <button type="button" role="menuitem" className={`${item} text-slate-700`} onClick={() => { setOpen(false); onSettings(); }}>
            <Settings2 className="w-3.5 h-3.5" /> Project settings
          </button>
          {project.status === "ACTIVE" && (
            <button type="button" role="menuitem" className={`${item} text-rose-600`} onClick={() => { setOpen(false); onArchive(); }}>
              <Archive className="w-3.5 h-3.5" /> Archive project
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type ProjectStatusTab = "ALL" | "ACTIVE" | "DRAFT" | "COMPLETED" | "ARCHIVED";

interface ProjectsDirectoryPageProps {
  projects: ProjectSummaryDto[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onNewProject?: () => void;
}

/** Drafts come from /projects/drafts; this list holds active and archived projects. */
function getDerivedProjectStatus(project: ProjectSummaryDto): Exclude<ProjectStatusTab, "ALL" | "DRAFT"> {
  if (project.status === "ARCHIVED") return "ARCHIVED";
  if (project.certifiedProgressPct >= 100) return "COMPLETED";
  return "ACTIVE";
}

function contractorLabel(project: ProjectSummaryDto): string {
  const extra = (project.contractorCount ?? 0) - 1;
  const name = project.contractorOrganizationName || "No contractor";
  return extra > 0 ? `${name} +${extra}` : name;
}

function getHealthBadge(health: ProjectSummaryDto["portfolioHealth"]) {
  switch (health) {
    case "EVIDENCE_SUPPORTED":
      return {
        label: "Supported",
        classes: "bg-emerald-50 text-emerald-700 border-emerald-200",
        icon: CheckCircle2,
      };
    case "EVIDENCE_CONFLICT":
      return {
        label: "Conflict Flagged",
        classes: "bg-red-50 text-red-700 border-red-200",
        icon: AlertTriangle,
      };
    default:
      return {
        label: "Partial / Review",
        classes: "bg-amber-50 text-amber-700 border-amber-200",
        icon: Clock,
      };
  }
}

export function ProjectsDirectoryPage({
  projects,
  selectedProjectId,
  onSelectProject,
  onNewProject,
}: ProjectsDirectoryPageProps) {
  const { hasPermission } = useAuth();
  const term = useTerm();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = (searchParams.get("tab") || "").toUpperCase();
  const activeTab: ProjectStatusTab = (["ALL", "ACTIVE", "DRAFT", "COMPLETED", "ARCHIVED"] as const).includes(
    tabParam as ProjectStatusTab
  )
    ? (tabParam as ProjectStatusTab)
    : "ALL";
  const setActiveTab = (tab: ProjectStatusTab) =>
    setSearchParams(tab === "ALL" ? {} : { tab: tab.toLowerCase() }, { replace: true });
  const canSeeDrafts = hasPermission("projects:create") || hasPermission("projects:edit_baseline");
  const draftsQuery = useDraftProjectsQuery(true);
  const drafts = draftsQuery.data ?? [];
  const deleteDraft = useDeleteDraftMutation();
  const canEditProjects = hasPermission("projects:edit_baseline");
  const [archiving, setArchiving] = useState<ProjectSummaryDto | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // Phase 11: type, region and owner filters.
  const deliveryFilters = useDeliveryModelFilters();
  const owners = useMemo(
    () => projects.map((p) => p.owningOrganization).filter((o): o is { id: string; name: string } => Boolean(o)),
    [projects]
  );

  const counts = useMemo(() => {
    const summary = {
      ALL: projects.length,
      ACTIVE: 0,
      DRAFT: drafts.length,
      COMPLETED: 0,
      ARCHIVED: 0,
    };
    for (const p of projects) {
      summary[getDerivedProjectStatus(p)] += 1;
    }
    return summary;
  }, [projects, drafts.length]);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return projects.filter((project) => {
      const status = getDerivedProjectStatus(project);
      if (activeTab !== "ALL" && status !== activeTab) {
        return false;
      }
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

  const tabs: Array<{ id: ProjectStatusTab; label: string; count: number }> = [
    { id: "ALL", label: "All Projects", count: counts.ALL },
    { id: "ACTIVE", label: "Active", count: counts.ACTIVE },
    ...(canSeeDrafts || drafts.length > 0 ? [{ id: "DRAFT" as const, label: "Drafts", count: counts.DRAFT }] : []),
    { id: "COMPLETED", label: "Completed", count: counts.COMPLETED },
    ...(counts.ARCHIVED > 0 ? [{ id: "ARCHIVED" as const, label: "Archived", count: counts.ARCHIVED }] : []),
  ];

  const handleOpenProject = (
    projectId: string,
    subRoute: "dashboard" | "boq" | "reconciliation" = "dashboard",
  ) => {
    onSelectProject(projectId);
    navigate(`/app/projects/${projectId}/${subRoute}`);
  };

  return (
    <div className="space-y-4">
      {/* Header Banner */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-5 shadow-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-base font-bold text-slate-900">
            Capital Projects Directory
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Live, completed and archived projects. Drafts are private to the
            people setting them up until they are set active.
          </p>
        </div>

        {hasPermission("projects:create") && onNewProject && (
          <button
            type="button"
            onClick={onNewProject}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm transition shrink-0"
          >
            <Plus className="w-4 h-4" />
            New Project
          </button>
        )}
      </div>

      <DeliveryModelFilters filters={deliveryFilters.filters} onChange={deliveryFilters.setFilters} owners={owners} />

      {/* Filter Tabs & Search */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
        <div className="relative w-full lg:w-72">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, code, state, contractor..."
            className="w-full pl-8 pr-3 py-2 rounded-xl border border-slate-200 text-xs focus:outline-none focus:border-brand-primary"
          />
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {tabs.map((tab) => {
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition inline-flex items-center gap-1.5 ${
                  isSelected
                    ? "bg-brand-navy text-white shadow-sm"
                    : "bg-slate-100/80 text-slate-600 hover:bg-slate-200/70"
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                    isSelected
                      ? "bg-white/20 text-white"
                      : "bg-white text-slate-600"
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {activeTab === "DRAFT" ? (
        drafts.length === 0 ? (
          <div className="bg-white rounded-2xl border border-slate-200/80 p-10 text-center">
            <FolderKanban className="w-8 h-8 text-slate-300 mx-auto mb-2" />
            <div className="text-sm font-semibold text-slate-800">No drafts</div>
            <p className="text-xs text-slate-500 mt-1">A project you start is saved here until you set it active.</p>
          </div>
        ) : (
          <div className="bg-white rounded-2xl border border-slate-200/80 shadow-sm divide-y divide-slate-100">
            {drafts.map((d) => (
              <div key={d.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 text-[11px] font-bold">{d.codePrefix}</span>
                    <span className="px-2 py-0.5 rounded-md bg-amber-50 text-amber-800 text-[11px] font-semibold">Draft</span>
                  </div>
                  <p className="mt-1 text-sm font-bold text-slate-900 truncate">{d.name}</p>
                  <p className="text-[11px] text-slate-500">
                    {d.completedRequiredSteps} of {d.totalRequiredSteps} required steps done · started by {d.createdByName ?? "someone"} ·
                    last saved {new Date(d.updatedAt).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {d.canDelete && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm(`Delete the draft "${d.name}"? This cannot be undone.`)) deleteDraft.mutate(d.id);
                      }}
                      className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => navigate(`/app/projects/${d.id}/setup/review`)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold"
                  >
                    Resume <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : filteredProjects.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-10 text-center">
          <FolderKanban className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <div className="text-sm font-semibold text-slate-800">
            No matching projects
          </div>
          <p className="text-xs text-slate-500 mt-1">
            Try adjusting your search query or status filter.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredProjects.map((project) => {
            const isCurrent = project.id === selectedProjectId;
            const health = getHealthBadge(project.portfolioHealth);
            const HealthIcon = health.icon;
            const status = getDerivedProjectStatus(project);

            return (
              <div
                key={project.id}
                className={`bg-white rounded-2xl border p-5 shadow-sm transition hover:shadow-md flex flex-col justify-between gap-4 ${
                  isCurrent
                    ? "border-brand-primary ring-1 ring-brand-primary/20"
                    : "border-slate-200/80"
                }`}
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="px-2 py-0.5 rounded-md bg-brand-navy text-white text-[11px] font-bold tracking-wide">
                          {project.codePrefix}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border text-[11px] font-semibold ${health.classes}`}
                        >
                          <HealthIcon className="w-3 h-3" />
                          {health.label}
                        </span>
                        <ProjectTypeChip type={project.projectType} />
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-medium">
                          {status === "COMPLETED" ? "Completed" : status === "ARCHIVED" ? (
                            <span className="inline-flex items-center gap-1"><Archive className="w-3 h-3" /> Archived</span>
                          ) : "Active"}
                        </span>
                      </div>
                      <h2 className="text-sm font-bold text-slate-900 mt-2 truncate">
                        {project.name}
                      </h2>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">
                          {project.stateLocation}
                          {project.lgaLocation
                            ? ` · ${project.lgaLocation}`
                            : ""}
                        </span>
                      </div>
                    </div>
                    {canEditProjects && (
                      <ProjectCardMenu
                        project={project}
                        onSettings={() => navigate(`/app/projects/${project.id}/settings/basics`)}
                        onArchive={() => setArchiving(project)}
                      />
                    )}
                  </div>

                  {/* Project Budget & Certified Progress */}
                  <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div>
                      <div className="text-[11px] text-slate-500">
                        Project Budget
                      </div>
                      <div className="text-sm font-bold text-slate-900 mt-0.5">
                        {formatCompactNaira(project.totalBudgetNgn)}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center justify-between text-[11px] text-slate-500">
                        <span>Certified Progress</span>
                        <span className="font-bold text-slate-800">
                          {project.certifiedProgressPct.toFixed(1)}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-slate-200 rounded-full mt-2 overflow-hidden">
                        <div
                          className="h-full bg-brand-primary rounded-full transition-all"
                          style={{
                            width: `${Math.min(100, Math.max(0, project.certifiedProgressPct))}%`,
                          }}
                        />
                      </div>
                      {project.scheduleVariance && (
                        <div className="mt-1.5">
                          <ScheduleBadge badge={project.scheduleVariance} size="xs" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Counterparties & Counters */}
                  <div className="flex flex-col gap-2 text-[11px] text-slate-500">
                    <div className="flex items-center gap-1.5 truncate">
                      <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">
                        {contractorLabel(project)} · {project.lenderOrganizationName || `No ${term("funderParty", { lower: true })}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span>{project.totalBoqItems} BOQ items</span>
                      {(project.overdueMilestoneCount ?? 0) > 0 && (
                        <span className="rounded-full bg-rose-50 px-2 py-0.5 text-rose-700 font-semibold" title="Contract milestones past their due date">
                          {project.overdueMilestoneCount} overdue
                        </span>
                      )}
                      {project.openConflictCount > 0 && (
                        <span className="text-red-600 font-semibold">
                          {project.openConflictCount} conflicts
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleOpenProject(project.id, "boq")}
                      className="px-2.5 py-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 transition"
                    >
                      BOQ ({project.totalBoqItems})
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleOpenProject(project.id, "reconciliation")
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 transition"
                    >
                      <FileSpreadsheet className="w-3 h-3" />
                      IPC
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleOpenProject(project.id, "dashboard")}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-brand-primary hover:bg-brand-hover text-white text-xs font-semibold shadow-sm transition"
                  >
                    Open Workspace
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
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
