import { geofenceModeLabel } from "@insite/shared";
import { InSiteLogo } from "./InSiteLogo";
import { useGuardedAction } from "../lib/navigationGuard";
import React, { useState, useRef, useEffect } from "react";
import { Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import {
  Map,
  FileSpreadsheet,
  ClipboardList,
  ShieldCheck,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  BarChart3,
  FolderKanban,
  ArrowRight,
} from "lucide-react";
import type { ProjectSummaryDto } from "../api/types";
import { useAuth } from "../lib/auth-context";
import { useDemoAccounts } from "../config/useDemoAccounts";
import { IS_DEMO_MODE } from "../config/demoMode";
import { formatLicenseCredential, getInitials } from "../lib/formatters";
import Notifications from "./Notifications";

interface AppShellProps {
  projects: ProjectSummaryDto[];
  selectedProject: ProjectSummaryDto | null;
  onSelectProject: (projectId: string) => void;
  openConflictBadgeCount: number;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}

export function AppShell({
  projects,
  selectedProject,
  onSelectProject,
  openConflictBadgeCount,
  headerActions,
  children,
}: AppShellProps) {
  const { user, quickSwitchDemoAccount, logout, hasPermission } = useAuth();
  const demoAccounts = useDemoAccounts()?.accounts ?? [];
  const navigate = useNavigate();
  const requestLeave = useGuardedAction();
  const location = useLocation();
  const isExecutive = location.pathname.includes("/executive");
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
  const credentialText = formatLicenseCredential(
    user?.professionalLicenseType,
    user?.professionalLicenseNumber,
  );

  const roleDisplayLabel = user?.roleName || user?.roleCode || "Team Member";

  const workspaceTitleByRole = user?.isPlatformSuperAdmin
    ? "Platform Super Admin Console"
    : `${user?.roleName || "Assurance"} Workspace`;

  const isContractorOnly =
    hasPermission("ipc:submit_claim") && !hasPermission("ipc:certify_valuation");
  const isLenderApprover =
    hasPermission("tranche:approve_disbursement") &&
    !hasPermission("ipc:certify_valuation");

  const navLabels = {
    dashboard: isLenderApprover
      ? "Portfolio & Risk Map"
      : isContractorOnly
        ? "Site Map & Overview"
        : "Geospatial & Portfolio",
    reconciliation: isLenderApprover
      ? "Tranche & IPC Review"
      : isContractorOnly
        ? "IPC Claims & Queries"
        : "IPC Reconciliation",
    boq: hasPermission("boq:upload_edit")
      ? "BOQ & Hold-Points"
      : "BOQ & Hold-Point Rules",
  };

  const projectBasePath = selectedProject
    ? `/app/projects/${selectedProject.id}`
    : "/app/projects";

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
        } transition-all duration-200 kpmg-sidebar-gradient text-slate-200 rounded-2xl p-3 my-3 flex flex-col justify-between shadow-xl shrink-0 relative select-none`}
      >
        <div>
          {/* Brand Header + Minimize Toggle */}
          <div className="flex items-center justify-between px-1.5 py-2 mb-4 border-b border-white/10">
            <Link
              to="/"
              title="View Public Platform Overview"
              className="flex items-center gap-2.5 overflow-hidden hover:opacity-90 transition"
            >
              <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center p-1 shrink-0 shadow-sm">
                {user?.tenant?.brandingConfig?.logoUrl ? (
                  <img
                    src={user.tenant.brandingConfig.logoUrl}
                    alt={user?.tenant?.name || "InSite Assurance"}
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <InSiteLogo showText={false} className="h-full" />
                )}
              </div>
              {!sidebarCollapsed && (
                <div className="truncate">
                  <div className="text-white font-semibold text-sm leading-tight truncate">
                    {user?.tenant?.name || "InSite Assurance"}
                  </div>
                  <div className="text-[11px] text-white/70 truncate">
                    {user?.tenant?.brandingConfig?.tagline || "InSite Assurance"}
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

          {/* Primary Navigation (Role-Segregated) */}
          <div className="space-y-1">
            {!sidebarCollapsed && (
              <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/55">
                {workspaceTitleByRole}
              </div>
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

            {/* Executive Risk Matrix (Multi-Project Cross-Project View) */}
            {hasPermission("projects:view_executive_matrix") && (
              <NavLink
                to="/app/executive"
                title="Executive Risk Matrix"
                className={({ isActive }) =>
                  `w-full flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition ${
                    isActive
                      ? "bg-white/15 text-white shadow-sm"
                      : "text-white/80 hover:text-white hover:bg-white/10"
                  }`
                }
              >
                <BarChart3 className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && (
                  <span className="truncate">Executive Risk Matrix</span>
                )}
              </NavLink>
            )}

            {hasPermission("ipc:view") && (
            <NavLink
              to={selectedProject ? `${projectBasePath}/reconciliation` : "/app/projects"}
              title={navLabels.reconciliation}
              className={({ isActive }) =>
                `w-full flex items-center justify-between px-2.5 py-2.5 rounded-xl text-sm font-medium transition ${
                  isActive
                    ? "bg-white/15 text-white shadow-sm"
                    : "text-white/80 hover:text-white hover:bg-white/10"
                }`
              }
            >
              <span className="flex items-center gap-3 truncate">
                <FileSpreadsheet className="w-4 h-4 shrink-0" />
                {!sidebarCollapsed && (
                  <span className="truncate">{navLabels.reconciliation}</span>
                )}
              </span>
              {!sidebarCollapsed && openConflictBadgeCount > 0 && (
                <span className="text-xs bg-white text-brand-primary font-bold px-1.5 py-0.5 rounded">
                  {openConflictBadgeCount}
                </span>
              )}
            </NavLink>
            )}

            {hasPermission("boq:view") && (
            <NavLink
              to={selectedProject ? `${projectBasePath}/boq` : "/app/projects"}
              title={navLabels.boq}
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
                <span className="truncate">{navLabels.boq}</span>
              )}
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

          {/* Recent Active Projects Tree (Hidden when collapsed) */}
          {!sidebarCollapsed && recentActiveProjects.length > 0 && (
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

        {/* Bottom User Profile Trigger & Popover Dialog */}
        <div
          className="relative pt-3 border-t border-white/10"
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
                  {roleDisplayLabel} · {credentialText}
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
        {/* Top Header Bar */}
        <header className="bg-brand-navy rounded-2xl border border-white/10 px-5 py-3 flex items-center justify-between shadow-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-brand-sky">
                  {isExecutive
                    ? "PORTFOLIO"
                    : selectedProject?.codePrefix || "PORTFOLIO"}
                </span>
                <span className="text-white/30">/</span>
                <h1 className="text-base font-bold text-white tracking-tight">
                  {isExecutive
                    ? "Multi-Project Capital Risk & Governance Matrix"
                    : selectedProject?.name || "Capital Project Assurance"}
                </h1>
                <span
                  className={`hidden sm:inline-block ml-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-semibold border ${
                    user?.isPlatformSuperAdmin
                      ? "bg-brand-primary/20 text-white/75 border-brand-primary/30"
                      : hasPermission("tranche:approve_disbursement")
                        ? "bg-emerald-500/20 text-emerald-200 border-emerald-400/30"
                        : hasPermission("ipc:certify_valuation")
                          ? "bg-brand-primary/20 text-white/75 border-brand-primary/30"
                          : "bg-amber-500/20 text-amber-200 border-amber-400/30"
                  }`}
                >
                  {isExecutive
                    ? "Executive Surveillance"
                    : workspaceTitleByRole}
                </span>
              </div>
              <p className="text-xs text-slate-300">
                {isExecutive ? (
                  <span>
                    Consolidated cross-project risk, disbursement holdbacks,
                    and governance telemetry
                  </span>
                ) : selectedProject ? (
                  <>
                    <span className="text-slate-300 font-medium">
                      {selectedProject.geofenceMode
                        ? `${geofenceModeLabel(selectedProject.geofenceMode)} geofence`
                        : "No geofence"}
                      {selectedProject.status === "ARCHIVED" && " · Archived (read-only)"}
                    </span>{" "}
                    <span className="text-white/30">·</span>{" "}
                    <span className="text-slate-400">Lender:</span>{" "}
                    <span className="text-slate-200 font-medium">
                      {selectedProject.lenderOrganizationName}
                    </span>{" "}
                    <span className="text-white/30">·</span>{" "}
                    <span className="text-slate-400">Contractor:</span>{" "}
                    <span className="text-slate-200 font-medium">
                      {selectedProject.contractorOrganizationName}
                      {selectedProject.contractorCount > 1 && ` +${selectedProject.contractorCount - 1}`}
                    </span>
                  </>
                ) : (
                  <span className="text-slate-300">
                    Independent Physical-to-Financial Assurance
                  </span>
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
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
