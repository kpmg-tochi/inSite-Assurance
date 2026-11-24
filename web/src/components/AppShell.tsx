import { InSiteLogo } from "./InSiteLogo";
import { useGuardedAction } from "../lib/navigationGuard";
import React, { useState, useRef, useEffect } from "react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import {
  Map,
  Wallet,
  ClipboardList,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  FolderKanban,
  ArrowRight,
  ClipboardCheck,
  Handshake,
  Wrench,
  Globe2,
  Flag,
  FolderOpen,
  ListChecks,
  Lightbulb,
  Gauge,
} from "lucide-react";
import { CLOSURE_VIEW_PERMISSIONS } from "../pages/closure/ProjectClosurePage";
import { MILESTONE_VIEW_PERMISSIONS } from "./contracts/contractUi";
import { ProjectPhaseBanner } from "./closeout/ProjectPhaseBanner";
import { useProjectProcess } from "../queries/process/useProcessQueries";
import type { ProjectSummaryDto } from "../api/types";
import { useAuth } from "../lib/auth-context";
import { useDemoAccounts } from "../config/useDemoAccounts";
import { IS_DEMO_MODE } from "../config/demoMode";
import { getInitials } from "../lib/formatters";
import Notifications from "./Notifications";
import { APPLICATION_NAME } from "../config/appName";

interface AppShellProps {
  projects: ProjectSummaryDto[];
  selectedProject: ProjectSummaryDto | null;
  onSelectProject: (projectId: string) => void;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}

/** Phase 10: who sees the Retention and defects tab (same as the server route). */
/** The "Recent Active Projects" list under the navigation is switched off for now. */
const SHOW_RECENT_PROJECTS = false;

/** Header page names for the project pages, by the path segment after /app/projects/:id/. */
const PROJECT_PAGE_NAMES: Record<string, string> = {
  inspections: "Inspections",
  milestones: "Milestones",
  kickoff: "Kick-off",
  documents: "Documents",
  handover: "Handover",
  retention: "Retention and defects",
  payments: "Payments",
  closure: "Closure",
  audit: "Audit Ledger",
  setup: "Project setup",
  settings: "Project settings",
  kpis: "Project KPIs",
};

/** Header page names for the pages that are not about one project, by the segment after /app/. */
const WORKSPACE_PAGE_NAMES: Record<string, string> = {
  portfolio: "Portfolio",
  projects: "All Projects",
  kpis: "Programme KPIs",
  lessons: "Lessons learned",
  settings: "Settings",
  organizations: "Contractor ratings",
};

const RETENTION_VIEW_PERMISSIONS = ["retention:manage_defects", "payments:view", "payments:record", "audit:view_ledger"];

export function AppShell({
  projects,
  selectedProject,
  onSelectProject,
  headerActions,
  children,
}: AppShellProps) {
  const { user, quickSwitchDemoAccount, logout, hasPermission, hasAnyPermission } = useAuth();
  const demoAccounts = useDemoAccounts()?.accounts ?? [];
  const navigate = useNavigate();
  const requestLeave = useGuardedAction();
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [userPopoverOpen, setUserPopoverOpen] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setUserPopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const userInitials = getInitials(user?.fullName || "User");
  const roleDisplayLabel = user?.roleName || user?.roleCode || "Team Member";

  const workspaceTitleByRole = user?.isPlatformSuperAdmin
    ? "Platform Super Admin Console"
    : `${user?.roleName || "Assurance"} Workspace`;

  const navLabels = {
    dashboard: "Project overview",
    // Redesign R2b
    scope: "Scope & sprints",
  };

  // Header: the project code only on pages about one project (and only when it is the selected
  // one, e.g. not a draft in setup), then the page name.
  const projectRoute = location.pathname.match(/^\/app\/projects\/([^/]+)(?:\/([^/]+))?/);
  const routeProjectId = projectRoute && projectRoute[1] !== "new" ? projectRoute[1] : null;
  const headerProject = routeProjectId && selectedProject?.id === routeProjectId ? selectedProject : null;
  const pageName = (() => {
    if (routeProjectId) {
      const section = projectRoute?.[2] ?? "dashboard";
      if (section === "dashboard") return navLabels.dashboard;
      if (section === "scope") return navLabels.scope;
      return PROJECT_PAGE_NAMES[section] ?? "Project";
    }
    if (location.pathname.startsWith("/app/projects/new")) return "New Project";
    const section = location.pathname.split("/")[2] ?? "";
    return WORKSPACE_PAGE_NAMES[section] ?? "";
  })();

  const projectBasePath = selectedProject
    ? `/app/projects/${selectedProject.id}`
    : "/app/projects";

  // Phase 10: the Handover and Retention tabs exist only when the module is on for the project.
  const closeout = useProjectProcess(selectedProject?.id, selectedProject?.status !== "DRAFT").data?.config;

  const recentActiveProjects = React.useMemo(() => {
    const active = projects.filter((p) => p.certifiedProgressPct < 100);
    const sliced = active.slice(0, 4);
    if (
      selectedProject &&
      selectedProject.certifiedProgressPct < 100 &&
      !sliced.some((p) => p.id === selectedProject.id)
    ) {
      return [selectedProject, ...sliced.slice(0, 3)];
    }
    return sliced;
  }, [projects, selectedProject]);

  const handleRoleSwitch = async (email: string) => {
    try {
      setSwitchingAccount(true);
      await quickSwitchDemoAccount(email);
      setUserPopoverOpen(false);
    } finally {
      setSwitchingAccount(false);
    }
  };

  return (
    <div className="flex h-screen px-3 gap-3 overflow-hidden bg-slate-50 text-slate-900">
      {/* Floating Collapsible KPMG Sidebar */}
      <aside
        className={`${
          sidebarCollapsed ? "w-[68px]" : "w-64"
        } transition-all duration-200 kpmg-sidebar-gradient text-slate-200 rounded-2xl p-3 my-3 flex flex-col shadow-xl shrink-0 relative select-none min-h-0`}
      >
          {/* Brand Header + Minimize Toggle (pinned to the top) */}
          <div className="flex items-center justify-between px-1.5 py-2 mb-3 border-b border-white/10 shrink-0">
            <Link
              to="/"
              title="View Public Platform Overview"
              className="flex items-center gap-2.5 overflow-hidden hover:opacity-90 transition"
            >
              <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center p-1 shrink-0 shadow-sm">
                {user?.tenant?.brandingConfig?.logoUrl ? (
                  <img
                    src={user.tenant.brandingConfig.logoUrl}
                    alt={user?.tenant?.name || APPLICATION_NAME}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <InSiteLogo showText={false} className="h-full" />
                )}
              </div>
              {!sidebarCollapsed && (
                <div className="truncate">
                  <div className="text-white font-semibold text-sm leading-tight truncate">
                    {user?.tenant?.name || APPLICATION_NAME}
                  </div>
                  <div className="text-[11px] text-white/70 truncate">
                    {user?.tenant?.brandingConfig?.tagline || APPLICATION_NAME}
                  </div>
                </div>
              )}
            </Link>
            <button
              type="button"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              title={sidebarCollapsed ? "Expand sidebar" : "Minimize sidebar"}
              className="p-1.5 rounded-lg text-white/75 hover:text-white hover:bg-white/10 transition shrink-0"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
            </button>
          </div>

          {/* Scrollable middle: primary navigation (role-segregated) */}
          <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden -mr-1.5 pr-1.5 pb-2">
          <div className="space-y-1">
            {!sidebarCollapsed && (
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/55">
                {workspaceTitleByRole}
              </div>
            )}

            {hasPermission("projects:view_portfolio") && (
              <NavLink
                to="/app/portfolio"
                title="Portfolio dashboard"
                className={({ isActive }) =>
                  `w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition ${
                    isActive
                      ? "bg-white/15 text-white shadow-sm"
                      : "text-white/80 hover:text-white hover:bg-white/10"
                  }`
                }
              >
                <Globe2 className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">Portfolio</span>}
              </NavLink>
            )}

            {/* Phase 16: programme KPIs */}
            {hasPermission("kpis:view") && (
              <NavLink
                to="/app/kpis"
                title="Programme KPIs"
                className={({ isActive }) =>
                  `w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition ${
                    isActive ? "bg-white/15 text-white shadow-sm" : "text-white/80 hover:text-white hover:bg-white/10"
                  }`
                }
              >
                <Gauge className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">Programme KPIs</span>}
              </NavLink>
            )}

            {/* Phase 15: the tenant library of published lessons */}
            {hasPermission("lessons:view") && (
              <NavLink
                to="/app/lessons"
                title="Lessons learned"
                className={({ isActive }) =>
                  `w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition ${
                    isActive ? "bg-white/15 text-white shadow-sm" : "text-white/80 hover:text-white hover:bg-white/10"
                  }`
                }
              >
                <Lightbulb className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">Lessons learned</span>}
              </NavLink>
            )}

            <NavLink
              to="/app/projects"
              end
              title="All Projects"
              className={({ isActive }) =>
                `w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition ${
                  isActive
                    ? "bg-white/15 text-white shadow-sm"
                    : "text-white/80 hover:text-white hover:bg-white/10"
                }`
              }
            >
              <FolderKanban className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && (
                <span className="truncate">All Projects</span>
              )}
            </NavLink>

            <NavLink
              to={selectedProject ? `${projectBasePath}/dashboard` : "/app/projects"}
              title={navLabels.dashboard}
              className={({ isActive }) =>
                `w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition ${
                  isActive
                    ? "bg-white/15 text-white shadow-sm"
                    : "text-white/80 hover:text-white hover:bg-white/10"
                }`
              }
            >
              <Map className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && (
                <span className="truncate">{navLabels.dashboard}</span>
              )}
            </NavLink>

            {(hasPermission("payments:view") || hasPermission("payments:record")) && (
            <NavLink
              to={selectedProject ? `${projectBasePath}/payments` : "/app/projects"}
              title="Payments"
              className={({ isActive }) =>
                `w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition ${
                  isActive
                    ? "bg-white/15 text-white shadow-sm"
                    : "text-white/80 hover:text-white hover:bg-white/10"
                }`
              }
            >
              <Wallet className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && <span className="truncate">Payments</span>}
            </NavLink>
            )}

            {hasPermission("boq:view") && (
            <NavLink
              to={selectedProject ? `${projectBasePath}/scope` : "/app/projects"}
              title={navLabels.scope}
              className={({ isActive }) =>
                `w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition ${
                  isActive
                    ? "bg-white/15 text-white shadow-sm"
                    : "text-white/80 hover:text-white hover:bg-white/10"
                }`
              }
            >
              <ClipboardList className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && (
                <span className="truncate">{navLabels.scope}</span>
              )}
            </NavLink>
            )}


            {/* Phase 14: site inspections and findings */}
            {selectedProject && (hasPermission("inspections:view") || hasPermission("inspections:manage_findings")) && (
              <NavLink
                to={`${projectBasePath}/inspections`}
                title="Inspections"
                className={({ isActive }) =>
                  `w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition ${
                    isActive
                      ? "bg-white/15 text-white shadow-sm"
                      : "text-white/80 hover:text-white hover:bg-white/10"
                  }`
                }
              >
                <ClipboardCheck className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">Inspections</span>}
              </NavLink>
            )}

            {/* Phase 13: contract milestones (kick-off inside) and the document register */}
            {selectedProject && hasAnyPermission(...MILESTONE_VIEW_PERMISSIONS) && (
              <NavLink
                to={`${projectBasePath}/milestones`}
                title="Milestones"
                className={({ isActive }) =>
                  `w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition ${
                    isActive || location.pathname.startsWith(`${projectBasePath}/kickoff`)
                      ? "bg-white/15 text-white shadow-sm"
                      : "text-white/80 hover:text-white hover:bg-white/10"
                  }`
                }
              >
                <Flag className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">Milestones</span>}
              </NavLink>
            )}
            {selectedProject && (hasPermission("documents:view") || hasPermission("documents:upload")) && (
              <NavLink
                to={`${projectBasePath}/documents`}
                title="Documents"
                className={({ isActive }) =>
                  `w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition ${
                    isActive
                      ? "bg-white/15 text-white shadow-sm"
                      : "text-white/80 hover:text-white hover:bg-white/10"
                  }`
                }
              >
                <FolderOpen className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">Documents</span>}
              </NavLink>
            )}

            {/* Phase 10: handover and retention, shown only when the module is on for the project */}
            {selectedProject && closeout?.enableHandoverModule && (hasPermission("handover:record_response") || hasPermission("handover:review_feedback")) && (
              <NavLink
                to={`${projectBasePath}/handover`}
                title="Handover"
                className={({ isActive }) =>
                  `w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition ${
                    isActive ? "bg-white/15 text-white shadow-sm" : "text-white/80 hover:text-white hover:bg-white/10"
                  }`
                }
              >
                <Handshake className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">Handover</span>}
              </NavLink>
            )}
            {selectedProject && closeout?.enableRetentionModule && RETENTION_VIEW_PERMISSIONS.some((k) => hasPermission(k)) && (
              <NavLink
                to={`${projectBasePath}/retention`}
                title="Retention and defects"
                className={({ isActive }) =>
                  `w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition ${
                    isActive ? "bg-white/15 text-white shadow-sm" : "text-white/80 hover:text-white hover:bg-white/10"
                  }`
                }
              >
                <Wrench className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">Retention and defects</span>}
              </NavLink>
            )}

            {/* Phase 15: closure checklist, ratings, lessons and the closure pack */}
            {selectedProject && CLOSURE_VIEW_PERMISSIONS.some((k) => hasPermission(k)) && (
              <NavLink
                to={`${projectBasePath}/closure`}
                title="Closure"
                className={({ isActive }) =>
                  `w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition ${
                    isActive ? "bg-white/15 text-white shadow-sm" : "text-white/80 hover:text-white hover:bg-white/10"
                  }`
                }
              >
                <ListChecks className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && <span className="truncate">Closure</span>}
              </NavLink>
            )}

            {/* Audit Ledger gated by audit:view_ledger permission */}
            {hasPermission("audit:view_ledger") && (
              <NavLink
                to={selectedProject ? `${projectBasePath}/audit` : "/app/projects"}
                title="Audit Ledger"
                className={({ isActive }) =>
                  `w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition ${
                    isActive
                      ? "bg-white/15 text-white shadow-sm"
                      : "text-white/80 hover:text-white hover:bg-white/10"
                  }`
                }
              >
                <ShieldCheck className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && (
                  <span className="truncate">Audit Ledger</span>
                )}
              </NavLink>
            )}

            {/* General Settings: Access Management, Notifications, & Profile */}
            <NavLink
              to="/app/settings"
              title="Governance & App Settings"
              className={({ isActive }) =>
                `w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition ${
                  isActive
                    ? "bg-white/15 text-white shadow-sm"
                    : "text-white/80 hover:text-white hover:bg-white/10"
                }`
              }
            >
              <Settings className="w-4 h-4 shrink-0" />
              {!sidebarCollapsed && <span className="truncate">Settings</span>}
            </NavLink>
          </div>

          {/* Recent Active Projects Tree (hidden for now; also hidden when collapsed) */}
          {SHOW_RECENT_PROJECTS && !sidebarCollapsed && recentActiveProjects.length > 0 && (
            <div className="mt-6 space-y-1">
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/55">
                Recent Active Projects
              </div>
              <div className="pl-3 ml-2 border-l border-white/15 space-y-1">
                {recentActiveProjects.map((project) => {
                  const isSelected = selectedProject?.id === project.id;
                  return (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => onSelectProject(project.id)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs transition truncate ${
                        isSelected
                          ? "bg-white/15 text-white font-medium"
                          : "text-white/70 hover:text-white hover:bg-white/10"
                      }`}
                    >
                      <span className="font-semibold mr-1.5">
                        {project.codePrefix}
                      </span>
                      <span>{project.name}</span>
                    </button>
                  );
                })}
                <Link
                  to="/app/projects"
                  className="flex items-center justify-between px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-white/70 hover:text-white hover:bg-white/10 transition"
                >
                  <span>View All Projects</span>
                  <ArrowRight className="w-3 h-3" />
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Bottom User Profile Trigger & Popover Dialog (pinned to the bottom) */}
        <div
          className="relative pt-3 border-t border-white/10 shrink-0"
          ref={popoverRef}
        >
          <button
            type="button"
            onClick={() => setUserPopoverOpen((prev) => !prev)}
            className="w-full flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-white/10 transition text-left"
          >
            <div className="w-8 h-8 rounded-full bg-white text-brand-primary font-bold text-xs flex items-center justify-center shrink-0 shadow-sm">
              {userInitials}
            </div>
            {!sidebarCollapsed && (
              <div className="overflow-hidden">
                <div className="text-xs font-semibold text-white truncate">
                  {user?.fullName}
                </div>
                <div className="text-[11px] text-white/70 truncate">
                  {roleDisplayLabel}
                </div>
              </div>
            )}
          </button>

          {/* Popover Menu for Demo Role Switching, Public Docs & Logout */}
          {userPopoverOpen && (
            <div className="absolute bottom-14 left-2 w-64 bg-white text-slate-900 rounded-xl shadow-2xl border border-slate-200 p-2 z-50">
              {IS_DEMO_MODE && (
                <>
                  <div className="px-2.5 py-1.5 border-b border-slate-100">
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                      Demo Account Switcher
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Switch active role for live demonstration
                    </div>
                  </div>
                  <div className="py-1 space-y-0.5">
                    {demoAccounts.map((acct) => {
                      const isCurrent = user?.email === acct.email;
                      return (
                        <button
                          key={acct.email}
                          type="button"
                          disabled={switchingAccount}
                          onClick={() => handleRoleSwitch(acct.email)}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-slate-100 flex items-center justify-between transition ${
                            isCurrent
                              ? "font-semibold text-brand-primary bg-brand-primary/5"
                              : "text-slate-700"
                          }`}
                        >
                          <div>
                            <div>{acct.roleTitle.split(" (")[0]}</div>
                            <div className="text-[10px] text-slate-400 font-normal">
                              {acct.name} · {acct.organization}
                            </div>
                          </div>
                          {isCurrent && (
                            <span className="text-[10px] bg-brand-primary/5 text-brand-primary px-1.5 py-0.5 rounded font-semibold">
                              Active
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}

              <div className={`${IS_DEMO_MODE ? "pt-1 mt-1 border-t border-slate-100" : ""} space-y-0.5`}>
                <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                  Settings &amp; Info
                </div>
                <Link
                  to="/app/settings"
                  onClick={() => setUserPopoverOpen(false)}
                  className="block w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-brand-primary hover:bg-brand-primary/5 transition"
                >
                  Governance &amp; App Settings
                </Link>
                <Link
                  to="/"
                  onClick={() => setUserPopoverOpen(false)}
                  className="block w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-slate-100 transition"
                >
                  Platform Overview (Home)
                </Link>
                <Link
                  to="/about"
                  onClick={() => setUserPopoverOpen(false)}
                  className="block w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-slate-100 transition"
                >
                  Specification &amp; Context
                </Link>
                <Link
                  to="/mobile-app"
                  onClick={() => setUserPopoverOpen(false)}
                  className="block w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-slate-100 transition"
                >
                  Field Evidence Mobile App
                </Link>
              </div>

              <div className="pt-1 mt-1 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => {
                    setUserPopoverOpen(false);
                    requestLeave(() => {
                      logout();
                      navigate("/login");
                    });
                  }}
                  className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-red-600 hover:bg-red-50 font-medium transition"
                >
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col gap-3 mt-3 overflow-hidden">
        {/* Top Header Bar: project code (project pages only), page name, actions */}
        <header className="bg-brand-navy rounded-2xl border border-white/10 px-5 py-2.5 min-h-[52px] flex items-center justify-between gap-4 shadow-md shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            {headerProject && (
              <>
                <span className="text-xs font-bold text-brand-sky shrink-0" title={headerProject.name}>
                  {headerProject.codePrefix}
                </span>
                <span className="text-white/30">/</span>
              </>
            )}
            <h1 className="text-base font-bold text-white tracking-tight truncate">{pageName}</h1>
            {headerProject?.status === "ARCHIVED" && (
              <span className="shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-white/10 text-white/75 border-white/20">
                Archived · read-only
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {/* Phase 10: construction phase and phase-change actions */}
            {headerProject && <ProjectPhaseBanner projectId={headerProject.id} projectStatus={headerProject.status} />}
            <Notifications projectId={selectedProject?.id} />
            {headerActions}
          </div>
        </header>

        {/* Scrollable Workspace Canvas */}
        <div className="flex-1 overflow-y-auto pr-1 pb-3 rounded-2xl">
          {children}
        </div>
      </div>
    </div>
  );
}
