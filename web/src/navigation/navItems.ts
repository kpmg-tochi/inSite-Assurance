import type { LucideIcon } from "lucide-react";
import {
  CalendarDays,
  ClipboardList,
  FileSearch,
  Flag,
  FolderKanban,
  FolderOpen,
  Gauge,
  Globe2,
  Handshake,
  LayoutDashboard,
  Lightbulb,
  School,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
} from "lucide-react";
import { MILESTONE_VIEW_PERMISSIONS } from "../components/contracts/contractUi";
import { COMPLETION_PAGE_PERMISSIONS } from "../pages/completion/completionPermissions";

/**
 * Redesign R6b (D-R6.11): the portal navigation as data. `AppShell` renders the groups, the header
 * takes its page name from here, and switching project keeps the sub-page through `findNavItem`.
 * Gates are today's permissions (D-R6.27); a hidden entry's route still answers with the
 * RequirePermission screen.
 */

export type NavGroup = "workspace" | "project" | "more";

export interface NavItem {
  key: string;
  label: string;
  /** Header page name when it differs from the label. */
  pageTitle?: string;
  icon: LucideIcon;
  group: NavGroup;
  /** Workspace entries ignore the project id. */
  to: (projectId: string) => string;
  /** Route segments this entry owns: its own and the legacy ones that redirect to it. */
  segments: readonly string[];
  /** Active only on this `?tab=` value, or never on it (two entries on one page). */
  tab?: { only?: string; not?: string };
  /** Shown when the user holds any of these; omitted = everyone who can open the portal. */
  anyOf?: readonly string[];
}

const projectPath = (projectId: string, rest: string) => `/app/projects/${projectId}/${rest}`;

/** Tenant entries, in spec order (D-R6.13). */
export const WORKSPACE_NAV: readonly NavItem[] = [
  { key: "portfolio", label: "Portfolio", icon: Globe2, group: "workspace", to: () => "/app/portfolio", segments: ["portfolio"], anyOf: ["projects:view_portfolio"] },
  { key: "projects", label: "Projects", icon: FolderKanban, group: "workspace", to: () => "/app/projects", segments: ["projects"] },
  { key: "visit-planner", label: "Visit planner", icon: CalendarDays, group: "workspace", to: () => "/app/visits", segments: ["visits"], anyOf: ["visits:view"] },
  { key: "kpis", label: "KPIs", pageTitle: "Programme KPIs", icon: Gauge, group: "workspace", to: () => "/app/kpis", segments: ["kpis"], anyOf: ["kpis:view"] },
  { key: "lessons", label: "Lessons learned", icon: Lightbulb, group: "workspace", to: () => "/app/lessons", segments: ["lessons"], anyOf: ["lessons:view"] },
  { key: "forms", label: "Forms & facilities", icon: School, group: "workspace", to: () => "/app/forms", segments: ["forms"], anyOf: ["facilities:manage", "forms:manage"] },
  { key: "settings", label: "Settings", icon: Settings, group: "workspace", to: () => "/app/settings", segments: ["settings"] },
];

/** Project entries, in spec 10.2 order (D-R6.14). */
export const PROJECT_NAV: readonly NavItem[] = [
  { key: "overview", label: "Overview", icon: LayoutDashboard, group: "project", to: (id) => projectPath(id, "dashboard"), segments: ["dashboard"] },
  {
    key: "kickoff",
    label: "Kick-off & mobilisation",
    icon: Flag,
    group: "project",
    to: (id) => projectPath(id, "kickoff"),
    segments: ["kickoff", "milestones"],
    anyOf: MILESTONE_VIEW_PERMISSIONS,
  },
  { key: "scope", label: "Sprints & scope", icon: ClipboardList, group: "project", to: (id) => projectPath(id, "scope"), segments: ["scope", "boq", "schedule"], anyOf: ["boq:view"] },
  {
    key: "visits",
    label: "Visits & reports",
    icon: CalendarDays,
    group: "project",
    to: (id) => projectPath(id, "visits"),
    segments: ["visits", "inspections"],
    tab: { not: "findings" },
    anyOf: ["visits:view"],
  },
  {
    key: "findings",
    label: "Findings",
    icon: FileSearch,
    group: "project",
    to: (id) => projectPath(id, "visits?tab=findings"),
    segments: ["visits"],
    tab: { only: "findings" },
    anyOf: ["visits:view"],
  },
  { key: "payments", label: "Payments", icon: Wallet, group: "project", to: (id) => projectPath(id, "payments"), segments: ["payments"], anyOf: ["payments:view", "payments:record"] },
  { key: "documents", label: "Documents", icon: FolderOpen, group: "project", to: (id) => projectPath(id, "documents"), segments: ["documents"], anyOf: ["documents:view", "documents:upload"] },
  {
    key: "completion",
    label: "Completion & handover",
    icon: Handshake,
    group: "project",
    to: (id) => projectPath(id, "completion"),
    segments: ["completion", "handover", "retention", "closure"],
    anyOf: COMPLETION_PAGE_PERMISSIONS,
  },
];

/** "More ▸" entries of the project group. */
export const PROJECT_MORE_NAV: readonly NavItem[] = [
  { key: "audit", label: "Audit ledger", icon: ShieldCheck, group: "more", to: (id) => projectPath(id, "audit"), segments: ["audit"], anyOf: ["audit:view_ledger"] },
  {
    key: "project-settings",
    label: "Settings",
    pageTitle: "Project settings",
    icon: SlidersHorizontal,
    group: "more",
    to: (id) => projectPath(id, "settings/project"),
    segments: ["settings"],
    // As the header button it replaces; the setup shell itself stays read-only for others.
    anyOf: ["projects:edit_baseline"],
  },
];

export const ALL_PROJECT_NAV: readonly NavItem[] = [...PROJECT_NAV, ...PROJECT_MORE_NAV];

/** Header names of pages that have no navigation entry. */
const OTHER_PROJECT_PAGES: Record<string, string> = { setup: "Project setup" };
const OTHER_WORKSPACE_PAGES: Record<string, string> = { organizations: "Contractor ratings" };

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
  const list = loc.projectId ? ALL_PROJECT_NAV : WORKSPACE_NAV;
  return list.find((item) => navItemMatches(item, loc)) ?? null;
}

export function canSeeNavItem(item: NavItem, hasAnyPermission: (...keys: string[]) => boolean): boolean {
  return !item.anyOf || hasAnyPermission(...item.anyOf);
}

/** The header page name for a location. */
export function pageNameFor(loc: AppLocation): string {
  if (loc.isNewProject) return "New Project";
  const item = findNavItem(loc);
  if (item) return item.pageTitle ?? item.label;
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
  const to = item.to(projectId);
  if (loc.tab && !item.tab?.only && !to.includes("?")) return `${to}?tab=${encodeURIComponent(loc.tab)}`;
  return to;
}
