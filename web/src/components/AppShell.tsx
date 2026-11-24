import { InSiteLogo } from "./InSiteLogo";
import { useGuardedAction } from "../lib/navigationGuard";
import React, { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ChevronRight, Menu, MoreHorizontal, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import type { ProjectSummaryDto } from "../api/types";
import { useAuth } from "../lib/auth-context";
import { useDemoAccounts } from "../config/useDemoAccounts";
import { IS_DEMO_MODE } from "../config/demoMode";
import { getInitials } from "../lib/formatters";
import Notifications from "./Notifications";
import { APPLICATION_NAME } from "../config/appName";
import { ProjectStageChip } from "./overview/ProjectStageChip";
import {
  canSeeNavItem,
  navItemMatches,
  pageNameFor,
  parseAppLocation,
  PROJECT_MORE_NAV,
  PROJECT_NAV,
  WORKSPACE_NAV,
  type AppLocation,
  type NavItem,
} from "../navigation/navItems";

interface AppShellProps {
  projects: ProjectSummaryDto[];
  selectedProject: ProjectSummaryDto | null;
  onSelectProject: (projectId: string) => void;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The portal frame (redesign R6b, D-R6.11): the sidebar renders the navigation config in a Workspace
 * group and a Project group (selected project's code, switcher, "More ▸"); the header shows the page
 * name from the same config and the project's stage chip. Below `lg` the sidebar is an off-canvas
 * drawer opened from the header.
 */
export function AppShell({ projects, selectedProject, onSelectProject, headerActions, children }: AppShellProps) {
  const location = useLocation();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const loc = parseAppLocation(location.pathname, location.search);
  // Header: the project code only on pages about one project (and only when it is the selected one,
  // e.g. not a draft in setup), then the page name.
  const headerProject = loc.projectId && selectedProject?.id === loc.projectId ? selectedProject : null;
  const pageName = pageNameFor(loc);

  // Close the drawer when a link in it navigates.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname, location.search]);

  const closeDrawer = () => {
    setDrawerOpen(false);
    menuButtonRef.current?.focus();
  };

  return (
    <div className="flex h-screen px-3 gap-3 overflow-hidden bg-slate-50 text-slate-900">
      {/* Sidebar (lg and up) */}
      <aside
        className={`${
          sidebarCollapsed ? "w-[68px]" : "w-64"
        } hidden lg:flex motion-safe:transition-all motion-safe:duration-200 kpmg-sidebar-gradient text-slate-200 rounded-2xl p-3 my-3 flex-col shadow-xl shrink-0 relative select-none min-h-0`}
      >
        <SidebarContent
          collapsed={sidebarCollapsed}
          loc={loc}
          projects={projects}
          selectedProject={selectedProject}
          onSelectProject={onSelectProject}
          headerButton={
            <button
              type="button"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="p-1.5 rounded-lg text-white/75 hover:text-white hover:bg-white/10 transition shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
            </button>
          }
        />
      </aside>

      {/* Drawer (below lg) */}
      {drawerOpen && (
        <NavDrawer onClose={closeDrawer}>
          {(closeButton) => (
            <SidebarContent
              collapsed={false}
              loc={loc}
              projects={projects}
              selectedProject={selectedProject}
              onSelectProject={onSelectProject}
              headerButton={closeButton}
            />
          )}
        </NavDrawer>
      )}

      {/* Main Content Area */}
      <div className="flex-1 min-w-0 flex flex-col gap-3 mt-3 overflow-hidden">
        <header className="bg-brand-navy rounded-2xl border border-white/10 px-3 sm:px-5 py-2.5 min-h-[52px] flex items-center justify-between gap-3 shadow-md shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <button
              ref={menuButtonRef}
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open navigation"
              aria-expanded={drawerOpen}
              aria-controls="app-nav-drawer"
              className="lg:hidden p-1.5 -ml-1 rounded-lg text-white/85 hover:text-white hover:bg-white/10 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              <Menu className="w-5 h-5" />
            </button>
            {headerProject && (
              <>
                <span className="text-xs font-bold text-brand-sky shrink-0" title={headerProject.name}>
                  {headerProject.codePrefix}
                </span>
                <span className="text-white/30" aria-hidden="true">
                  /
                </span>
              </>
            )}
            <h1 className="text-base font-bold text-white tracking-tight truncate">{pageName}</h1>
            {headerProject && <ProjectStageChip stage={headerProject.stage} className="hidden sm:inline-flex shrink-0" />}
            {headerProject?.status === "ARCHIVED" && (
              <span className="hidden sm:inline-flex shrink-0 px-2 py-0.5 rounded-full text-[11px] font-semibold border bg-white/10 text-white/75 border-white/20">
                Archived · read-only
              </span>
            )}
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            <Notifications projectId={selectedProject?.id} />
            {headerActions}
          </div>
        </header>

        {/* Scrollable Workspace Canvas */}
        <main className="flex-1 overflow-y-auto pr-1 pb-3 rounded-2xl">{children}</main>
      </div>
    </div>
  );
}

/** Off-canvas navigation: focus moves in, Tab stays inside, Escape and the backdrop close it. */
function NavDrawer({ onClose, children }: { onClose: () => void; children: (closeButton: React.ReactNode) => React.ReactNode }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
  }, []);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;
    const items = Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const closeButton = (
    <button
      ref={closeRef}
      type="button"
      onClick={onClose}
      aria-label="Close navigation"
      className="p-1.5 rounded-lg text-white/80 hover:text-white hover:bg-white/10 shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      <X className="w-4 h-4" />
    </button>
  );

  return (
    <div className="fixed inset-0 z-[900] lg:hidden" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-slate-900/50" aria-hidden="true" onClick={onClose} />
      <div
        ref={panelRef}
        id="app-nav-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Navigation"
        className="absolute inset-y-0 left-0 w-72 max-w-[85vw] kpmg-sidebar-gradient text-slate-200 p-3 flex flex-col shadow-2xl min-h-0"
      >
        {children(closeButton)}
      </div>
    </div>
  );
}

const linkClass = (active: boolean) =>
  `w-full flex items-center gap-3 px-2.5 py-2 rounded-xl text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
    active ? "bg-white/15 text-white shadow-sm" : "text-white/85 hover:text-white hover:bg-white/10"
  }`;

function NavEntry({ item, projectId, loc, collapsed }: { item: NavItem; projectId: string; loc: AppLocation; collapsed: boolean }) {
  const active = navItemMatches(item, loc) && (item.group === "workspace" || loc.projectId === projectId);
  const Icon = item.icon;
  return (
    <li>
      <Link to={item.to(projectId)} title={collapsed ? item.label : undefined} aria-current={active ? "page" : undefined} className={linkClass(active)}>
        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
      </Link>
    </li>
  );
}

function GroupHeading({ id, collapsed, children }: { id: string; collapsed: boolean; children: React.ReactNode }) {
  return (
    <h2 id={id} className={collapsed ? "sr-only" : "px-2.5 pt-1 pb-1 text-[11px] font-semibold uppercase tracking-wider text-white/70"}>
      {children}
    </h2>
  );
}

function SidebarContent({
  collapsed,
  loc,
  projects,
  selectedProject,
  onSelectProject,
  headerButton,
}: {
  collapsed: boolean;
  loc: AppLocation;
  projects: ProjectSummaryDto[];
  selectedProject: ProjectSummaryDto | null;
  onSelectProject: (projectId: string) => void;
  headerButton: React.ReactNode;
}) {
  const { user, hasAnyPermission } = useAuth();
  const uid = useId();
  const visible = (items: readonly NavItem[]) => items.filter((item) => canSeeNavItem(item, hasAnyPermission));
  const workspaceItems = visible(WORKSPACE_NAV);
  const projectItems = visible(PROJECT_NAV);
  const moreItems = visible(PROJECT_MORE_NAV);
  const projectId = selectedProject?.id ?? "";
  const moreActive = Boolean(selectedProject) && moreItems.some((item) => navItemMatches(item, loc) && loc.projectId === projectId);
  const [moreOpen, setMoreOpen] = useState(moreActive);
  const moreButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (moreActive) setMoreOpen(true);
  }, [moreActive]);

  return (
    <>
      {/* Brand header (pinned to the top) */}
      <div className="flex items-center justify-between px-1.5 py-2 mb-3 border-b border-white/10 shrink-0">
        <Link to="/" title="Home" className="flex items-center gap-2.5 overflow-hidden hover:opacity-90 transition rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white">
          <div className="w-8 h-8 rounded-lg bg-white flex items-center justify-center p-1 shrink-0 shadow-sm">
            {user?.tenant?.brandingConfig?.logoUrl ? (
              <img src={user.tenant.brandingConfig.logoUrl} alt={user?.tenant?.name || APPLICATION_NAME} className="w-full h-full object-contain" />
            ) : (
              <InSiteLogo showText={false} className="h-full" />
            )}
          </div>
          {!collapsed && (
            <div className="truncate">
              <div className="text-white font-semibold text-sm leading-tight truncate">{user?.tenant?.name || APPLICATION_NAME}</div>
              <div className="text-[11px] text-white/75 truncate">{user?.tenant?.brandingConfig?.tagline || APPLICATION_NAME}</div>
            </div>
          )}
        </Link>
        {headerButton}
      </div>

      {/* Scrollable middle: navigation */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden -mr-1.5 pr-1.5 pb-2 space-y-4">
        <nav aria-labelledby={`${uid}-ws`}>
          <GroupHeading id={`${uid}-ws`} collapsed={collapsed}>
            Workspace
          </GroupHeading>
          <ul className="space-y-0.5">
            {workspaceItems.map((item) => (
              <NavEntry key={item.key} item={item} projectId={projectId} loc={loc} collapsed={collapsed} />
            ))}
          </ul>
        </nav>

        {selectedProject && (
          <nav aria-labelledby={`${uid}-pr`} className={collapsed ? "pt-3 border-t border-white/10" : ""}>
            <GroupHeading id={`${uid}-pr`} collapsed={collapsed}>
              Project <span className="normal-case tracking-normal text-brand-sky">{selectedProject.codePrefix}</span>
            </GroupHeading>
            {!collapsed && projects.length > 1 && (
              <div className="px-1 pb-2">
                <label htmlFor={`${uid}-switch`} className="sr-only">
                  Switch project
                </label>
                <select
                  id={`${uid}-switch`}
                  value={selectedProject.id}
                  onChange={(e) => onSelectProject(e.target.value)}
                  className="w-full rounded-lg border border-white/20 bg-white/10 px-2 py-1.5 text-xs text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
                >
                  {projects.map((p) => (
                    <option key={p.id} value={p.id} className="text-slate-900">
                      {p.codePrefix} · {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <ul className="space-y-0.5">
              {projectItems.map((item) => (
                <NavEntry key={item.key} item={item} projectId={projectId} loc={loc} collapsed={collapsed} />
              ))}
              {moreItems.length > 0 && (
                <li
                  onKeyDown={(e) => {
                    if (e.key === "Escape" && moreOpen) {
                      e.stopPropagation();
                      setMoreOpen(false);
                      moreButtonRef.current?.focus();
                    }
                  }}
                >
                  <button
                    ref={moreButtonRef}
                    type="button"
                    aria-expanded={moreOpen}
                    aria-controls={`${uid}-more`}
                    onClick={() => setMoreOpen((o) => !o)}
                    title={collapsed ? "More" : undefined}
                    className={linkClass(false)}
                  >
                    {collapsed ? <MoreHorizontal className="w-4 h-4 shrink-0" aria-hidden="true" /> : (
                      <ChevronRight className={`w-4 h-4 shrink-0 motion-safe:transition-transform ${moreOpen ? "rotate-90" : ""}`} aria-hidden="true" />
                    )}
                    <span className={collapsed ? "sr-only" : "truncate"}>More</span>
                  </button>
                  <ul id={`${uid}-more`} hidden={!moreOpen} className={`space-y-0.5 mt-0.5 ${collapsed ? "" : "pl-4"}`}>
                    {moreItems.map((item) => (
                      <NavEntry key={item.key} item={item} projectId={projectId} loc={loc} collapsed={collapsed} />
                    ))}
                  </ul>
                </li>
              )}
            </ul>
          </nav>
        )}
      </div>

      <UserMenu collapsed={collapsed} />
    </>
  );
}

/** The signed-in user, the demo account switcher (demo flag only) and sign-out, pinned to the bottom. */
function UserMenu({ collapsed }: { collapsed: boolean }) {
  const { user, quickSwitchDemoAccount, logout } = useAuth();
  const demoAccounts = useDemoAccounts()?.accounts ?? [];
  const navigate = useNavigate();
  const requestLeave = useGuardedAction();
  const [open, setOpen] = useState(false);
  const [switchingAccount, setSwitchingAccount] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const handleRoleSwitch = async (email: string) => {
    try {
      setSwitchingAccount(true);
      await quickSwitchDemoAccount(email);
      setOpen(false);
    } finally {
      setSwitchingAccount(false);
    }
  };

  return (
    <div
      className="relative pt-3 border-t border-white/10 shrink-0"
      ref={popoverRef}
      onKeyDown={(e) => {
        if (e.key === "Escape" && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="true"
        className="w-full flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-white/10 transition text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <div className="w-8 h-8 rounded-full bg-white text-brand-primary font-bold text-xs flex items-center justify-center shrink-0 shadow-sm">
          {getInitials(user?.fullName || "User")}
        </div>
        <div className={collapsed ? "sr-only" : "overflow-hidden"}>
          <div className="text-xs font-semibold text-white truncate">{user?.fullName}</div>
          <div className="text-[11px] text-white/75 truncate">{user?.roleName || user?.roleCode || "Team Member"}</div>
        </div>
      </button>

      {open && (
        <div className="absolute bottom-14 left-2 w-64 bg-white text-slate-900 rounded-xl shadow-2xl border border-slate-200 p-2 z-50">
          {IS_DEMO_MODE && (
            <>
              <div className="px-2.5 py-1.5 border-b border-slate-100">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">Demo Account Switcher</div>
                <div className="text-[11px] text-slate-500">Switch active role for live demonstration</div>
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
                        isCurrent ? "font-semibold text-brand-primary bg-brand-primary/5" : "text-slate-700"
                      }`}
                    >
                      <div>
                        <div>{acct.roleTitle.split(" (")[0]}</div>
                        <div className="text-[10px] text-slate-500 font-normal">
                          {acct.name} · {acct.organization}
                        </div>
                      </div>
                      {isCurrent && <span className="text-[10px] bg-brand-primary/5 text-brand-primary px-1.5 py-0.5 rounded font-semibold">Active</span>}
                    </button>
                  );
                })}
              </div>
            </>
          )}

          <div className={`${IS_DEMO_MODE ? "pt-1 mt-1 border-t border-slate-100" : ""} space-y-0.5`}>
            <Link
              to="/app/settings"
              onClick={() => setOpen(false)}
              className="block w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-brand-primary hover:bg-brand-primary/5 transition"
            >
              Settings
            </Link>
            <Link to="/" onClick={() => setOpen(false)} className="block w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-slate-100 transition">
              Home page
            </Link>
            <Link
              to="/mobile-app"
              onClick={() => setOpen(false)}
              className="block w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-slate-700 hover:bg-slate-100 transition"
            >
              Mobile app
            </Link>
          </div>

          <div className="pt-1 mt-1 border-t border-slate-100">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
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
  );
}
