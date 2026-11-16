import React, { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
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
} from "lucide-react";
import type { ProjectSummaryDto } from "../../api/types";
import { formatCompactNaira } from "../../lib/formatters";
import { useAuth } from "../../lib/auth-context";

type ProjectStatusTab =
  | "ALL"
  | "ACTIVE"
  | "PENDING_APPROVAL"
  | "DRAFT"
  | "COMPLETED";

interface ProjectsDirectoryPageProps {
  projects: ProjectSummaryDto[];
  selectedProjectId: string | null;
  onSelectProject: (projectId: string) => void;
  onNewProject?: () => void;
}

function getDerivedProjectStatus(
  project: ProjectSummaryDto,
): Exclude<ProjectStatusTab, "ALL"> {
  if (project.certifiedProgressPct >= 100) {
    return "COMPLETED";
  }
  return "ACTIVE";
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
  const { user } = useAuth();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<ProjectStatusTab>("ALL");
  const [searchQuery, setSearchQuery] = useState("");

  const counts = useMemo(() => {
    const summary = {
      ALL: projects.length,
      ACTIVE: 0,
      PENDING_APPROVAL: 0,
      DRAFT: 0,
      COMPLETED: 0,
    };
    for (const p of projects) {
      summary[getDerivedProjectStatus(p)] += 1;
    }
    return summary;
  }, [projects]);

  const filteredProjects = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return projects.filter((project) => {
      const status = getDerivedProjectStatus(project);
      if (activeTab !== "ALL" && status !== activeTab) {
        return false;
      }
      if (!q) return true;
      return (
        project.name.toLowerCase().includes(q) ||
        project.codePrefix.toLowerCase().includes(q) ||
        project.stateLocation.toLowerCase().includes(q) ||
        (project.lgaLocation || "").toLowerCase().includes(q) ||
        project.contractorOrganizationName.toLowerCase().includes(q) ||
        project.lenderOrganizationName.toLowerCase().includes(q)
      );
    });
  }, [projects, activeTab, searchQuery]);

  const tabs: Array<{ id: ProjectStatusTab; label: string; count: number }> = [
    { id: "ALL", label: "All Projects", count: counts.ALL },
    { id: "ACTIVE", label: "Active", count: counts.ACTIVE },
    {
      id: "PENDING_APPROVAL",
      label: "Pending Approval",
      count: counts.PENDING_APPROVAL,
    },
    { id: "DRAFT", label: "Drafts", count: counts.DRAFT },
    { id: "COMPLETED", label: "Completed", count: counts.COMPLETED },
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
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-brand-primary/10 text-brand-primary flex items-center justify-center shrink-0">
            <FolderKanban className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-base font-bold text-slate-900">
              Capital Projects Directory
            </h1>
            <p className="text-xs text-slate-500 mt-0.5">
              Browse all active, pending approval, draft, and completed
              infrastructure projects across your workspace.
            </p>
          </div>
        </div>

        {user?.role === "MONITOR" && onNewProject && (
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

      {/* Filter Tabs & Search */}
      <div className="bg-white rounded-2xl border border-slate-200/80 p-4 shadow-sm flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
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
      </div>

      {/* Projects Grid */}
      {filteredProjects.length === 0 ? (
        <div className="bg-white rounded-2xl border border-slate-200/80 p-10 text-center">
          <FolderKanban className="w-8 h-8 text-slate-300 mx-auto mb-2" />
          <div className="text-sm font-semibold text-slate-800">
            No matching projects
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {activeTab === "PENDING_APPROVAL" || activeTab === "DRAFT"
              ? "Drafts and pending project creation approvals will appear here once initiated."
              : "Try adjusting your search query or status filter."}
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
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-600 text-[11px] font-medium">
                          {status === "COMPLETED" ? "Completed" : "Active"}
                        </span>
                      </div>
                      <h2 className="text-sm font-bold text-slate-900 mt-2 truncate">
                        {project.name}
                      </h2>
                      <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                        <span className="truncate">
                          {project.stateLocation}
                          {project.lgaLocation ? ` · ${project.lgaLocation}` : ""}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Facility Budget & Certified Progress */}
                  <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-slate-50 border border-slate-100">
                    <div>
                      <div className="text-[11px] text-slate-500">
                        Facility Budget
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
                    </div>
                  </div>

                  {/* Counterparties & Counters */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                    <div className="flex items-center gap-1.5 truncate">
                      <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                      <span className="truncate">
                        {project.contractorOrganizationName} ·{" "}
                        {project.lenderOrganizationName}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span>{project.totalBoqItems} BOQ items</span>
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
    </div>
  );
}
