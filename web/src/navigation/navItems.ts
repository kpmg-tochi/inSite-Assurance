import type { LucideIcon } from "lucide-react";
import {
  ClipboardCheck,
  ClipboardList,
  HardHat,
  FolderOpen,
  Globe2,
  LayoutDashboard,
  Route,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import type { ProjectStageSummary } from "@insite/shared";
import { MILESTONE_VIEW_PERMISSIONS } from "../components/contracts/contractUi";
import { COMPLETION_PAGE_PERMISSIONS } from "../pages/completion/completionPermissions";

/**
 * Redesign R6b (D-R6.11): the portal navigation as data. `AppShell` renders the groups, the header
 * takes its page name from here, and switching project keeps the sub-page through `findNavItem`.
 * Gates are today's permissions (D-R6.27); a hidden entry's route still answers with the
 * RequirePermission screen.
 */

export type NavGroup = "workspace" | "project";

/** Sidebar section headers (design round 2, 2026-11-26): the workspace entries read "Platform". */
export const NAV_GROUP_LABEL: Readonly<Record<NavGroup, string>> = { workspace: "Platform", project: "Project" };

export interface NavItem {
  key: string;
  label: string;
  /** Header page name when it differs from the label. */
  pageTitle?: string;
  icon: LucideIcon;
  group: NavGroup;
  /** Workspace entries ignore the project id. */
  to: (projectId: string) => string;
  /** When the target depends on the project (e.g. its current stage); wins over `to` when a project is known. */
  toForProject?: (project: { id: string; stage: ProjectStageSummary | null }) => string;
  /** Header page name per route segment, for an entry that spans several pages. */
  segmentTitles?: Readonly<Record<string, string>>;
  /** Route segments this entry owns: its own and the legacy ones that redirect to it. */
  segments: readonly string[];
  /** Active only on this `?tab=` value, or never on it (two entries on one page). */
  tab?: { only?: string; not?: string };
  /** Shown when the user holds any of these; omitted = everyone who can open the portal. */
  anyOf?: readonly string[];
  /** Hidden when the user holds any of these (the assigned-projects home is for people without the Portfolio). */
  noneOf?: readonly string[];
}

/**
 * UBEC rebrand: the workspace home. `/app/portfolio` for programme admins, `/app/dashboard` (the
 * projects they are assigned to) for everyone else; both read "Portfolio" on screen (design round 2).
 */
export const PORTFOLIO_PERMISSION = "projects:view_portfolio";

export function workspaceHomePath(hasAnyPermission: (...keys: string[]) => boolean): string {
  return hasAnyPermission(PORTFOLIO_PERMISSION) ? "/app/portfolio" : "/app/dashboard";
}

const projectPath = (projectId: string, rest: string) => `/app/projects/${projectId}/${rest}`;

/** Holders of any of these administer the workspace and see Settings in the sidebar. */
export const SETTINGS_ADMIN_PERMISSIONS: readonly string[] = [
  "users:invite_manage",
  "roles:create_edit",
  "project_types:manage",
  "forms:manage",
  "facilities:manage",
  "tenant:manage_settings",
];

/**
 * The stage pages of a project, in the order a project moves through them. "Project stages" opens
 * the one the project is in: kick-off until mobilisation is over, scope and sprints while it is
 * being built, completion and handover from then on.
 */
export const STAGE_PAGES = [
  { segment: "kickoff", label: "Kick-off & mobilisation", anyOf: MILESTONE_VIEW_PERMISSIONS },
  { segment: "scope", label: "BoQ & work phases", anyOf: ["scope:view"] as readonly string[] },
  { segment: "completion", label: "Completion & handover", anyOf: COMPLETION_PAGE_PERMISSIONS },
] as const;

export function currentStageSegment(stage: ProjectStageSummary | null | undefined): "kickoff" | "scope" | "completion" {
  switch (stage?.current) {
    case "CONSTRUCTION":
      return "scope";
    case "COMPLETION":
    case "CLOSURE":
      return "completion";
    default:
      return "kickoff";
  }
}

/**
 * Tenant entries (UBEC rebrand): only the workspace home and Settings. Projects, the visit planner
 * and the KPIs are tabs of the home page; Forms & facilities is a Settings tab; the lessons library
 * has no entry (lessons come in the closeout report). Projects are opened from the home page only.
 */
export const WORKSPACE_NAV: readonly NavItem[] = [
  {
    key: "portfolio",
    label: "Portfolio",
    icon: Globe2,
    group: "workspace",
    to: () => "/app/portfolio",
    // Client demo updates G.2: "payments" is the home page's Payments tab (/app/payments redirects).
    segments: ["portfolio", "projects", "kpis", "visits", "payments"],
    anyOf: [PORTFOLIO_PERMISSION],
  },
  {
    // Design round 2: the assigned-projects home also reads "Portfolio" (route and gate unchanged).
    key: "dashboard",
    label: "Portfolio",
    icon: LayoutDashboard,
    group: "workspace",
    to: () => "/app/dashboard",
    segments: ["dashboard", "projects", "kpis", "visits", "payments"],
    noneOf: [PORTFOLIO_PERMISSION],
  },
  {
    // Client demo updates E3 (wave 3): annual approved lists and budget mismatches.
    key: "needs-assessment",
    label: "Needs assessment",
    icon: ClipboardList,
    group: "workspace",
    to: () => "/app/needs-assessment",
    segments: ["needs-assessment"],
    anyOf: ["approved_lists:view"],
  },
  {
    // Client demo updates F.1 (wave 2): the contractor register.
    key: "contractors",
    label: "Contractors",
    icon: HardHat,
    group: "workspace",
    to: () => "/app/contractors",
    segments: ["contractors"],
    anyOf: ["contractors:view_register"],
  },
  {
    key: "settings",
    label: "Settings",
    icon: Settings,
    group: "workspace",
    to: () => "/app/settings",
    segments: ["settings", "forms"],
    // Admins only (owner, UBEC rebrand); everyone keeps their account page through the user menu.
    anyOf: SETTINGS_ADMIN_PERMISSIONS,
  },
];

/**
 * Project entries (UBEC rebrand: as few as possible for non-technical users). Project stages holds
 * the kick-off, scope and completion pages as stage tabs; Reports holds visits, findings and the site
 * log as tabs of one page.
 */
export const PROJECT_NAV: readonly NavItem[] = [
  // Design round 2: "Project overview" → "Overview", "Project cycle" → "Cycle" (they sit under the "Project" header).
  { key: "overview", label: "Overview", icon: LayoutDashboard, group: "project", to: (id) => projectPath(id, "dashboard"), segments: ["dashboard"] },
  {
    key: "stages",
    // Client demo updates (glossary): "Project stages" → "Project cycle", "Scope & sprints" → "BoQ & work phases".
    label: "Cycle",
    icon: Route,
    group: "project",
    to: (id) => projectPath(id, "kickoff"),
    toForProject: (p) => projectPath(p.id, currentStageSegment(p.stage)),
    segments: ["kickoff", "milestones", "scope", "boq", "schedule", "completion", "handover", "retention", "closure"],
    segmentTitles: { kickoff: "Kick-off & mobilisation", scope: "BoQ & work phases", completion: "Completion & handover" },
    anyOf: [...MILESTONE_VIEW_PERMISSIONS, "scope:view", ...COMPLETION_PAGE_PERMISSIONS],
  },
  {
    key: "reports",
    // Client demo updates (glossary): "Reports" / "Visits, reports and findings" → "Monitoring".
    label: "Monitoring",
    pageTitle: "Monitoring",
    icon: ClipboardCheck,
    group: "project",
    to: (id) => projectPath(id, "visits"),
    segments: ["visits", "inspections"],
    anyOf: ["visits:view"],
  },
  { key: "payments", label: "Payments", icon: Wallet, group: "project", to: (id) => projectPath(id, "payments"), segments: ["payments"], anyOf: ["payments:view", "payments:record"] },
  { key: "documents", label: "Documents", icon: FolderOpen, group: "project", to: (id) => projectPath(id, "documents"), segments: ["documents"], anyOf: ["documents:view", "documents:upload"] },
  // Design round 2026-11-26: Audit ledger and Project settings are plain entries (no "More ▸").
  { key: "audit", label: "Audit ledger", icon: ShieldCheck, group: "project", to: (id) => projectPath(id, "audit"), segments: ["audit"], anyOf: ["audit:view_ledger"] },
  {
    key: "project-settings",
    label: "Project settings",
    pageTitle: "Project settings",
    icon: SlidersHorizontal,
    group: "project",
    to: (id) => projectPath(id, "settings/project"),
    segments: ["settings"],
    // As the header button it replaces; the setup shell itself stays read-only for others.
    anyOf: ["projects:edit_baseline"],
  },
];

/** Header names of pages that have no navigation entry. */
const OTHER_PROJECT_PAGES: Record<string, string> = { setup: "Project setup" };
const OTHER_WORKSPACE_PAGES: Record<string, string> = { organizations: "Contractor ratings", lessons: "Lessons learned" };

export interface AppLocation {
  /** Set on /app/projects/:projectId/... (not on /app/projects or /app/projects/new). */
  projectId: string | null;
  /** First segment after /app/projects/:projectId/ ("dashboard" when empty), or after /app/. */
  segment: string;
  tab: string | null;
  /** /app/projects/new */
  isNewProject: boolean;
}

export function parseAppLocation(pathname: string, search: string): AppLocation {
  const parts = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  const tab = new URLSearchParams(search).get("tab");
  // parts[0] === "app"
  if (parts[1] === "projects" && parts[2] && parts[2] !== "new") {
    return { projectId: parts[2], segment: parts[3] ?? "dashboard", tab, isNewProject: false };
  }
  return { projectId: null, segment: parts[1] ?? "", tab, isNewProject: parts[1] === "projects" && parts[2] === "new" };
}

export function navItemMatches(item: NavItem, loc: AppLocation): boolean {
  const isProjectItem = item.group !== "workspace";
  if (isProjectItem !== Boolean(loc.projectId)) return false;
  if (!item.segments.includes(loc.segment)) return false;
  if (item.tab?.only !== undefined && loc.tab !== item.tab.only) return false;
  if (item.tab?.not !== undefined && loc.tab === item.tab.not) return false;
  return true;
}

/** The entry for a location (project pages, then workspace pages). */
export function findNavItem(loc: AppLocation): NavItem | null {
  const list = loc.projectId ? PROJECT_NAV : WORKSPACE_NAV;
  return list.find((item) => navItemMatches(item, loc)) ?? null;
}

/** The workspace entry for a location, among the entries this user sees (the two home entries share segments). */
export function findVisibleNavItem(loc: AppLocation, hasAnyPermission: (...keys: string[]) => boolean): NavItem | null {
  const list = loc.projectId ? PROJECT_NAV : WORKSPACE_NAV;
  return list.find((item) => canSeeNavItem(item, hasAnyPermission) && navItemMatches(item, loc)) ?? null;
}

export function canSeeNavItem(item: NavItem, hasAnyPermission: (...keys: string[]) => boolean): boolean {
  if (item.noneOf && hasAnyPermission(...item.noneOf)) return false;
  return !item.anyOf || hasAnyPermission(...item.anyOf);
}

/** The header page name for a location. */
export function pageNameFor(loc: AppLocation, hasAnyPermission?: (...keys: string[]) => boolean): string {
  if (loc.isNewProject) return "New project";
  const item = hasAnyPermission ? findVisibleNavItem(loc, hasAnyPermission) : findNavItem(loc);
  if (item) return item.segmentTitles?.[loc.segment] ?? item.pageTitle ?? item.label;
  if (loc.projectId) return OTHER_PROJECT_PAGES[loc.segment] ?? "Project";
  return OTHER_WORKSPACE_PAGES[loc.segment] ?? "";
}

/**
 * Where to go when another project is picked: the same entry for the new project when the user may
 * see it (keeping a plain `?tab=`), else its Overview.
 */
export function sameSubPageFor(
  loc: AppLocation,
  projectId: string,
  hasAnyPermission: (...keys: string[]) => boolean
): string {
  const item = loc.projectId ? findNavItem(loc) : null;
  if (!item || !canSeeNavItem(item, hasAnyPermission)) return projectPath(projectId, "dashboard");
  const to = item.segments.includes(loc.segment) && item.segmentTitles?.[loc.segment] ? projectPath(projectId, loc.segment) : item.to(projectId);
  if (loc.tab && !item.tab?.only && !to.includes("?")) return `${to}?tab=${encodeURIComponent(loc.tab)}`;
  return to;
}
