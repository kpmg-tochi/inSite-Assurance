import { BrandLogo, shortOrganisationName } from "./BrandLogo";
import { ChangeProjectDialog } from "./projects/ChangeProjectDialog";
import { useGuardedAction, useGuardedNavigate } from "../lib/navigationGuard";
import React, { useEffect, useId, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeftRight,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  X,
} from "lucide-react";
import type { ProjectSummaryDto } from "../api/types";
import { formatProjectCode } from "@insite/shared";
import { useAuth } from "../lib/auth-context";
import { useDemoAccounts } from "../config/useDemoAccounts";
import { IS_DEMO_MODE } from "../config/demoMode";
import { getInitials } from "../lib/formatters";
import Notifications from "./Notifications";
import { APPLICATION_NAME } from "../config/appName";
import {
  canSeeNavItem,
  NAV_BADGES,
  NAV_GROUP_LABEL,
  navItemMatches,
  pageNameFor,
  parseAppLocation,
  PROJECT_NAV,
  WORKSPACE_NAV,
  type AppLocation,
  type NavBadgeKey,
  type NavItem,
} from "../navigation/navItems";
import { useNeedsTaskCountQuery } from "../queries/needs/useDecisionQueries";

interface AppShellProps {
  selectedProject: ProjectSummaryDto | null;
  headerActions?: React.ReactNode;
  children: React.ReactNode;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), select:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * The portal frame (redesign R6b, D-R6.11; UBEC rebrand; design round 2): the sidebar renders the
 * navigation config under two small headers: "Platform" on top (home, Needs assessment, Contractors,
 * Settings), then "Project" (the selected project's code and year with "Change project", then its
 * pages), with the user menu at the bottom. Collapsed, the headers become thin dividers. The header
 * shows the project code and the page name, and "New project" for project creators. Below `lg` the
 * sidebar is an off-canvas drawer opened from the header.
 */
export function AppShell({
  selectedProject,
  headerActions,
  children,
}: AppShellProps) {
  const location = useLocation();
  const { hasAnyPermission, hasPermission } = useAuth();
  const navigate = useGuardedNavigate();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  const loc = parseAppLocation(location.pathname, location.search);
  // Header: the project code only on pages about one project (and only when it is the selected one,
  // e.g. not a draft in setup), then the page name.
  const headerProject =
    loc.projectId && selectedProject?.id === loc.projectId
      ? selectedProject
      : null;
  const pageName = pageNameFor(loc, hasAnyPermission);
  // Same gate and target as the home page's "New project" (PortfolioProjectsTable); not on that page itself.
  const canCreateProject = hasPermission("projects:create") && !loc.isNewProject;

  // Close the drawer when a link in it navigates.
  useEffect(() => {
    setDrawerOpen(false);
  }, [location.pathname, location.search]);

  const closeDrawer = () => {
    setDrawerOpen(false);
    menuButtonRef.current?.focus();
  };

  return (
    <div className="relative flex h-screen px-3 gap-3 overflow-hidden bg-surface-canvas text-slate-900">
      {/* Sidebar (lg and up) */}
      <aside
        className={`${
          sidebarCollapsed ? "w-[68px]" : "w-64"
        } hidden lg:flex motion-safe:transition-all motion-safe:duration-200 kpmg-sidebar-gradient text-slate-200 rounded-2xl p-3 my-3 flex-col shadow-xl shrink-0 relative select-none min-h-0`}
      >
        <SidebarContent
          collapsed={sidebarCollapsed}
          loc={loc}
          project={selectedProject}
          headerButton={
            <button
              type="button"
              onClick={() => setSidebarCollapsed((prev) => !prev)}
              aria-label={
                sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"
              }
              title={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
              className="p-1.5 rounded-lg text-white/75 hover:text-white hover:bg-white/10 transition shrink-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
            >
              {sidebarCollapsed ? (
                <PanelLeftOpen className="w-4 h-4" />
              ) : (
                <PanelLeftClose className="w-4 h-4" />
              )}
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
              project={selectedProject}
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
                <span
                  className="text-sm font-semibold text-white/70 shrink-0 tabular-nums"
                  title={headerProject.name}
                >
                  {formatProjectCode(headerProject.codePrefix)}
                </span>
                <span className="text-white/30" aria-hidden="true">
                  /
                </span>
              </>
            )}
            <h1 className="text-base font-bold text-white tracking-tight truncate">
              {pageName}
            </h1>
          </div>

          <div className="flex items-center gap-2.5 shrink-0">
            {canCreateProject && (
              <button
                type="button"
                onClick={() => navigate("/app/projects/new")}
                aria-label="New project"
                title="New project"
                className="inline-flex h-[34px] items-center gap-1.5 rounded-xl bg-white px-2 sm:px-3 text-xs font-semibold text-brand-navy shadow-sm transition hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-brand-navy"
              >
                <Plus className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="hidden sm:inline">New project</span>
              </button>
            )}
            <Notifications projectId={selectedProject?.id} />
            {headerActions}
          </div>
        </header>

        {/* Scrollable Workspace Canvas */}
        <main className="relative flex-1 overflow-y-auto pr-1 pb-3 pt-2 px-1 rounded-2xl">
          {children}
        </main>
      </div>
    </div>
  );
}

/** Off-canvas navigation: focus moves in, Tab stays inside, Escape and the backdrop close it. */
function NavDrawer({
  onClose,
  children,
}: {
  onClose: () => void;
  children: (closeButton: React.ReactNode) => React.ReactNode;
}) {
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
    const items = Array.from(
      panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((el) => el.offsetParent !== null);
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
      <div
        className="absolute inset-0 bg-slate-900/50"
        aria-hidden="true"
        onClick={onClose}
      />
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
    active
      ? "bg-white/15 text-white shadow-sm"
      : "text-white/85 hover:text-white hover:bg-white/10"
  }`;

/** The counts behind `NavItem.badge`, each fetched only for holders of its permission. */
function useNavBadgeCounts(): Partial<Record<NavBadgeKey, number>> {
  const { hasPermission } = useAuth();
  const needsTasks = useNeedsTaskCountQuery(hasPermission(NAV_BADGES.needsTasks.permission));
  return { needsTasks: needsTasks.data?.count };
}

function NavEntry({
  item,
  project,
  loc,
  collapsed,
  badgeCount,
}: {
  item: NavItem;
  project: ProjectSummaryDto | null;
  loc: AppLocation;
  collapsed: boolean;
  /** The entry's badge count; nothing is shown for 0 or unknown. */
  badgeCount?: number;
}) {
  const projectId = project?.id ?? "";
  const active =
    navItemMatches(item, loc) &&
    (item.group === "workspace" || loc.projectId === projectId);
  const Icon = item.icon;
  const badge = badgeCount ?? 0;
  const to =
    project && item.toForProject
      ? item.toForProject({ id: project.id, stage: project.stage ?? null })
      : item.to(projectId);
  return (
    <li>
      <Link
        to={to}
        title={collapsed ? (badge ? `${item.label} (${badge})` : item.label) : undefined}
        aria-current={active ? "page" : undefined}
        className={`${linkClass(active)} relative`}
      >
        <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
        <span className={collapsed ? "sr-only" : "truncate"}>{item.label}</span>
        {badge > 0 && item.badge && (
          <>
            <span className="sr-only">, {NAV_BADGES[item.badge].srLabel(badge)}</span>
            {collapsed ? (
              <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-white ring-2 ring-brand-navy" aria-hidden="true" />
            ) : (
              <span className="ml-auto min-w-[1.25rem] rounded-full bg-white px-1.5 py-px text-center text-[10px] font-bold tabular-nums text-brand-navy" aria-hidden="true">
                {badge > 99 ? "99+" : badge}
              </span>
            )}
          </>
        )}
      </Link>
    </li>
  );
}

/**
 * A small section header ("Platform", "Project"). Collapsed, only screen readers get it: the section's
 * own top border is the divider.
 */
function GroupHeading({
  id,
  collapsed,
  children,
}: {
  id: string;
  collapsed: boolean;
  children: React.ReactNode;
}) {
  return (
    <h2
      id={id}
      className={
        collapsed
          ? "sr-only"
          : "px-2.5 pb-1.5 text-[11px] font-semibold tracking-wide text-white/70"
      }
    >
      {children}
    </h2>
  );
}

const changeProjectButtonClass =
  "shrink-0 rounded-lg border border-white/25 bg-white/10 text-white transition hover:bg-white/20 hover:border-white/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-white";

function SidebarContent({
  collapsed,
  loc,
  project,
  headerButton,
}: {
  collapsed: boolean;
  loc: AppLocation;
  /** The selected project: the one open, else the last one opened, else the first ongoing one. */
  project: ProjectSummaryDto | null;
  headerButton: React.ReactNode;
}) {
  const { user, hasAnyPermission } = useAuth();
  const uid = useId();
  const visible = (items: readonly NavItem[]) =>
    items.filter((item) => canSeeNavItem(item, hasAnyPermission));
  const workspaceItems = visible(WORKSPACE_NAV);
  const badgeCounts = useNavBadgeCounts();
  const projectItems = visible(PROJECT_NAV);
  const [changingProject, setChangingProject] = useState(false);

  const projectCode = project ? formatProjectCode(project.codePrefix) : "";
  const projectCodeAndYear = project
    ? `${projectCode}${project.interventionYear ? ` · ${project.interventionYear}` : ""}`
    : "";

  return (
    <>
      {/* Brand header (pinned to the top). Collapsed, the logo sits above the expand button so
          neither is clipped in the 68 px rail. */}
      <div
        className={`${
          collapsed
            ? "flex flex-col items-center gap-2 py-2"
            : "flex items-center justify-between px-1.5 py-2"
        } mb-3 border-b border-white/10 shrink-0`}
      >
        <Link
          to="/app"
          title={user?.tenant?.name || APPLICATION_NAME}
          className="flex items-center gap-2.5 overflow-hidden hover:opacity-90 transition rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
        >
          <div className="w-9 h-9 rounded-full bg-white flex items-center justify-center p-0.5 shrink-0">
            <BrandLogo
              logoUrl={user?.tenant?.brandingConfig?.logoUrl}
              alt={user?.tenant?.name || APPLICATION_NAME}
              className="w-full h-full"
            />
          </div>
          {!collapsed && (
            <div className="min-w-0">
              <div className="text-white font-bold text-sm leading-tight truncate">
                {shortOrganisationName(user?.tenant?.name) || APPLICATION_NAME}
              </div>
              <div className="text-[11px] text-white/90 truncate">
                {user?.tenant?.brandingConfig?.tagline ||
                  "Project Monitoring Portal"}
              </div>
            </div>
          )}
        </Link>
        {headerButton}
      </div>

      {/* Scrollable middle (design round 2): "Platform" on top, then "Project". */}
      <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden -mr-1.5 pr-1.5 pb-2 flex flex-col gap-4">
        {workspaceItems.length > 0 && (
          <nav aria-labelledby={`${uid}-ws`}>
            <GroupHeading id={`${uid}-ws`} collapsed={collapsed}>
              {NAV_GROUP_LABEL.workspace}
            </GroupHeading>
            <ul className="space-y-0.5">
              {workspaceItems.map((item) => (
                <NavEntry
                  key={item.key}
                  item={item}
                  project={project}
                  loc={loc}
                  collapsed={collapsed}
                  badgeCount={item.badge ? badgeCounts[item.badge] : undefined}
                />
              ))}
            </ul>
          </nav>
        )}

        {project && (
          <nav
            aria-labelledby={`${uid}-pr`}
            className={
              workspaceItems.length > 0
                ? "pt-3 border-t border-white/10"
                : undefined
            }
          >
            <GroupHeading id={`${uid}-pr`} collapsed={collapsed}>
              {NAV_GROUP_LABEL.project}
            </GroupHeading>
            {collapsed ? (
              // The rail has no room for the code: one icon button, named and with a tooltip.
              <div className="mb-1 flex justify-center">
                <p className="sr-only">
                  {projectCodeAndYear}: {project.name}
                </p>
                <button
                  type="button"
                  onClick={() => setChangingProject(true)}
                  aria-label="Change project"
                  title={`Change project (now ${projectCodeAndYear})`}
                  className={`${changeProjectButtonClass} p-2`}
                >
                  <ArrowLeftRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            ) : (
              // Code and year only; the name is the tooltip and screen-reader text.
              <div className="mb-1.5 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 py-1.5 pl-2.5 pr-1.5">
                <p
                  className="min-w-0 flex-1 truncate text-sm font-semibold text-amber-200 tabular-nums"
                  title={project.name}
                >
                  {projectCode}
                  {project.interventionYear ? (
                    <span className="font-normal text-white/85">
                      {" "}
                      · {project.interventionYear}
                    </span>
                  ) : null}
                  <span className="sr-only">: {project.name}</span>
                </p>
                <button
                  type="button"
                  onClick={() => setChangingProject(true)}
                  aria-label="Change project"
                  title="Change project"
                  className={`${changeProjectButtonClass} p-1.5`}
                >
                  <ArrowLeftRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            )}
            {changingProject && (
              <ChangeProjectDialog
                currentProjectId={project.id}
                onClose={() => setChangingProject(false)}
              />
            )}
            <ul className="space-y-0.5">
              {projectItems.map((item) => (
                <NavEntry
                  key={item.key}
                  item={item}
                  project={project}
                  loc={loc}
                  collapsed={collapsed}
                />
              ))}
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
  const triggerRef = useRef<HTMLButtonElement>(null);
  const currentAccountRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  // Long demo casts scroll inside the menu: bring the signed-in account into view on open.
  useEffect(() => {
    if (open) currentAccountRef.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  useEffect(() => {
    function handleOutsideClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node))
        setOpen(false);
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
          triggerRef.current?.focus();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="true"
        aria-controls={open ? menuId : undefined}
        className="w-full flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-white/10 transition text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
      >
        <div className="w-8 h-8 rounded-full bg-white text-brand-primary font-bold text-xs flex items-center justify-center shrink-0 shadow-sm">
          {getInitials(user?.fullName || "User")}
        </div>
        <div className={collapsed ? "sr-only" : "overflow-hidden"}>
          <div className="text-xs font-semibold text-white truncate">
            {user?.fullName}
          </div>
          <div className="text-[11px] text-white/75 truncate">
            {user?.roleName || user?.roleCode || "Team member"}
          </div>
        </div>
      </button>

      {open && (
        // Never taller than the space above the user button: the cast list scrolls, the header and
        // the menu's own actions stay in view.
        <div
          id={menuId}
          className="absolute bottom-14 left-2 w-64 max-h-[calc(100vh-6rem)] supports-[height:100dvh]:max-h-[calc(100dvh-6rem)] flex flex-col bg-white text-slate-900 rounded-xl shadow-2xl border border-slate-200 p-2 z-50"
        >
          <div className="px-2.5 py-1.5 border-b border-slate-100 shrink-0">
            <div className="text-xs font-semibold text-slate-900 truncate">
              {user?.fullName}
            </div>
            {user?.email && (
              <div className="text-[11px] text-slate-500 truncate" title={user.email}>
                {user.email}
              </div>
            )}
          </div>

          {IS_DEMO_MODE && (
            <>
              <div className="px-2.5 pt-2 pb-1 shrink-0">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  Switch user
                </div>
                <div className="text-[11px] text-slate-500">
                  Sign in as another member of the demo cast
                </div>
              </div>
              <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain py-1 space-y-0.5">
                {demoAccounts.map((acct) => {
                  const isCurrent = user?.email === acct.email;
                  return (
                    <button
                      key={acct.email}
                      ref={isCurrent ? currentAccountRef : undefined}
                      type="button"
                      disabled={switchingAccount}
                      aria-current={isCurrent ? "true" : undefined}
                      onClick={() => handleRoleSwitch(acct.email)}
                      className={`w-full text-left px-2.5 py-1.5 rounded-lg text-xs hover:bg-slate-100 flex items-center justify-between transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary ${
                        isCurrent
                          ? "font-semibold text-brand-primary bg-brand-primary/5"
                          : "text-slate-700"
                      }`}
                    >
                      <div>
                        <div>{acct.roleTitle.split(" (")[0]}</div>
                        <div className="text-[10px] text-slate-500 font-normal">
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

          <div className="pt-1 mt-1 border-t border-slate-100 space-y-0.5 shrink-0">
            <Link
              to="/app/settings?tab=account"
              onClick={() => setOpen(false)}
              className="block w-full text-left px-2.5 py-1.5 rounded-lg text-xs font-medium text-brand-primary hover:bg-brand-primary/5 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary"
            >
              Account and password
            </Link>
          </div>

          <div className="pt-1 mt-1 border-t border-slate-100 shrink-0">
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                requestLeave(() => {
                  logout();
                  navigate("/login");
                });
              }}
              className="w-full text-left px-2.5 py-1.5 rounded-lg text-xs text-red-600 hover:bg-red-50 font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-red-500"
            >
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
