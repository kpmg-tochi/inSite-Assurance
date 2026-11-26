import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { FundingSourceCodeEnum, lgaByCode, NigeriaZoneCodeEnum, stateByCode, type PortfolioOverviewDto, type ProjectListFilters } from "@insite/shared";
import { usePortfolioOverviewQuery, useProjectRegisterOptionsQuery } from "../../queries/projects/useProjectsQueries";
import { useAuth } from "../../lib/auth-context";
import { formatCompactNaira } from "../../lib/formatters";
import { DeliveryModelFilters } from "../../components/projects/DeliveryModelFilters";
import { Tabs, TabPanel, useUrlTab } from "../../components/common/Tabs";
import Loader from "../../components/Loader";
import { ProgrammeKpisPage } from "../kpis/ProgrammeKpisPage";
import { VisitPlannerPage } from "../visits/VisitPlannerPage";
import { StatStrip, type Stat } from "./StatStrip";
import { PortfolioMap } from "./PortfolioMap";
import { PortfolioProjectsTable, type ProjectTableFilter } from "./PortfolioProjectsTable";
import { PortfolioPaymentsTab } from "./PortfolioPaymentsTab";

type HomeTab = "overview" | "kpis" | "visits" | "payments";

/**
 * The workspace home (UBEC rebrand). "portfolio" is the programme admins' Portfolio
 * (`projects:view_portfolio`); "dashboard" is everyone else's home, over the projects they are
 * assigned to (it also reads "Portfolio" on screen since design round 2). Both:an Overview tab (headline figures, the map, the projects table: the only way
 * into a project), a KPIs tab (`kpis:view`), a Monitoring visits tab (the monitoring planner,
 * `visits:view`; URL value `?tab=visits`) and a
 * Payments tab (client demo updates G.2: every payment in the period across the visible projects,
 * `payments:view`).
 */
export function WorkspaceHomePage({ variant, onOpenProject }: { variant: "portfolio" | "dashboard"; onOpenProject: (projectId: string) => void }) {
  const { hasPermission } = useAuth();
  const tabs = useMemo(
    () =>
      [
        { id: "overview" as const, label: "Overview" },
        ...(hasPermission("kpis:view") ? [{ id: "kpis" as const, label: "KPIs" }] : []),
        ...(hasPermission("visits:view") ? [{ id: "visits" as const, label: "Monitoring visits" }] : []),
        ...(hasPermission("payments:view") ? [{ id: "payments" as const, label: "Payments" }] : []),
      ] satisfies { id: HomeTab; label: string }[],
    [hasPermission]
  );
  const [active, setActive] = useUrlTab<HomeTab>(tabs.map((t) => t.id));
  const tab = active ?? "overview";

  return (
    <div className="space-y-4">
      {tabs.length > 1 && <Tabs tabs={tabs} active={tab} onChange={setActive} label="Portfolio views" idPrefix="home" />}
      <TabPanel idPrefix="home" id={tab}>
        {tab === "overview" && <OverviewTab variant={variant} onOpenProject={onOpenProject} />}
        {tab === "kpis" && <ProgrammeKpisPage onOpenProject={onOpenProject} />}
        {tab === "visits" && <VisitPlannerPage embedded />}
        {tab === "payments" && <PortfolioPaymentsTab onOpenProject={onOpenProject} />}
      </TabPanel>
    </div>
  );
}

/**
 * UBEC IRL: the register's filters, status button and search live in the URL (replace, not push), so
 * a reload or a shared link shows the same register. `tab` (the home tab) is left as it is.
 */
const FILTER_PARAMS = {
  projectTypeId: "type",
  regionId: "region",
  owningOrganizationId: "owner",
  lga: "lga",
  contractorOrganizationId: "contractor",
  interventionYear: "year",
  fundingSource: "funding",
  // Client demo updates (wave 1): zone / state / LGA codes and the funding source code.
  zone: "zone",
  stateCode: "state",
  lgaCode: "lgaCode",
  fundingSourceCode: "fundingCode",
} as const satisfies Record<keyof ProjectListFilters, string>;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TABLE_FILTERS: readonly ProjectTableFilter[] = ["ongoing", "behind", "completed", "archived", "drafts"];

function useRegisterUrlState() {
  const [params, setParams] = useSearchParams();
  const read = (key: keyof ProjectListFilters) => params.get(FILTER_PARAMS[key])?.trim() || undefined;
  const id = (key: "projectTypeId" | "regionId" | "owningOrganizationId" | "contractorOrganizationId") => {
    const v = read(key);
    return v && UUID_RE.test(v) ? v : undefined;
  };
  const yearText = read("interventionYear");
  const year = yearText && /^\d{4}$/.test(yearText) ? Number(yearText) : undefined;
  const state = stateByCode(read("stateCode"));
  const lga = lgaByCode(read("lgaCode"));
  const filters: ProjectListFilters = {
    projectTypeId: id("projectTypeId"),
    regionId: id("regionId"),
    owningOrganizationId: id("owningOrganizationId"),
    lga: read("lga"),
    contractorOrganizationId: id("contractorOrganizationId"),
    interventionYear: year !== undefined && year >= 2000 && year <= 2100 ? year : undefined,
    fundingSource: read("fundingSource"),
    // Client demo updates (wave 1): known codes only; an LGA must be in the chosen state.
    zone: NigeriaZoneCodeEnum.safeParse(read("zone")?.toUpperCase()).data,
    stateCode: state?.code,
    lgaCode: lga && (!state || lga.stateCode === state.code) ? lga.code : undefined,
    fundingSourceCode: FundingSourceCodeEnum.safeParse(read("fundingSourceCode")?.toUpperCase()).data,
  };
  // Only the filters in use, so the query key and the export carry no empty keys.
  (Object.keys(filters) as Array<keyof ProjectListFilters>).forEach((k) => filters[k] === undefined && delete filters[k]);
  const status = params.get("status") as ProjectTableFilter | null;
  const tableFilter: ProjectTableFilter = status && TABLE_FILTERS.includes(status) ? status : "all";
  const search = params.get("q") ?? "";

  const update = useCallback(
    (change: (next: URLSearchParams) => void) =>
      setParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          change(next);
          return next;
        },
        { replace: true }
      ),
    [setParams]
  );
  const setFilters = useCallback(
    (next: ProjectListFilters) =>
      update((p) => {
        (Object.keys(FILTER_PARAMS) as Array<keyof ProjectListFilters>).forEach((k) => {
          const v = next[k];
          if (v === undefined || v === null || v === "") p.delete(FILTER_PARAMS[k]);
          else p.set(FILTER_PARAMS[k], String(v));
        });
      }),
    [update]
  );
  const setTableFilter = useCallback(
    (f: ProjectTableFilter) => update((p) => (f === "all" ? p.delete("status") : p.set("status", f))),
    [update]
  );
  const setSearch = useCallback((q: string) => update((p) => (q ? p.set("q", q) : p.delete("q"))), [update]);
  return { filters, setFilters, tableFilter, setTableFilter, search, setSearch };
}

function OverviewTab({ variant, onOpenProject }: { variant: "portfolio" | "dashboard"; onOpenProject: (projectId: string) => void }) {
  const { filters, setFilters, tableFilter, setTableFilter, search, setSearch } = useRegisterUrlState();
  const { data, isLoading, isError, refetch } = usePortfolioOverviewQuery(filters);
  const registerOptions = useProjectRegisterOptionsQuery().data;
  const [ownersSeen, setOwnersSeen] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    const found = (data?.projects ?? []).map((p) => p.owningOrganization).filter((o): o is { id: string; name: string } => Boolean(o));
    if (found.some((o) => !ownersSeen.some((s) => s.id === o.id))) {
      setOwnersSeen((prev) => [...prev, ...found.filter((o) => !prev.some((s) => s.id === o.id))]);
    }
  }, [data, ownersSeen]);

  const toggle = (f: ProjectTableFilter) => setTableFilter(tableFilter === f ? "all" : f);
  const stats = useStats(variant, data, tableFilter, toggle);

  if (isLoading) {
    return (
      <div className="flex justify-center p-10">
        <Loader inline />
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="bg-white rounded-2xl border border-rose-200 p-6 text-sm text-rose-700 flex flex-wrap items-center justify-between gap-3">
        <span>The projects could not be loaded. Check your connection, then try again.</span>
        <button type="button" onClick={() => refetch()} className="rounded-xl border border-rose-300 px-3 py-1.5 text-xs font-semibold hover:bg-rose-50">
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-sm text-slate-600">
          {variant === "portfolio" ? "Every project in the programme you can see." : "The projects you are assigned to."} Figures follow the filters.
        </p>
        <DeliveryModelFilters filters={filters} onChange={setFilters} owners={ownersSeen} registerOptions={registerOptions} register />
      </div>
      <StatStrip stats={stats} label={variant === "portfolio" ? "Portfolio figures" : "Your figures"} />
      <PortfolioMap projects={data.projects} onOpenProject={onOpenProject} />
      <PortfolioProjectsTable
        projects={data.projects}
        filter={tableFilter}
        onFilterChange={setTableFilter}
        onOpenProject={onOpenProject}
        search={search}
        onSearchChange={setSearch}
        registerFilters={filters}
      />
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The four headline figures. Portfolio (owner's choice): total commitment, progress, ongoing
 * projects, behind schedule. Dashboard: the user's projects and schedule, then what their
 * permissions say they act on (monitoring visits and findings, or payments), topped up with progress.
 * Commitment (owner decision 3, 2026-11-26): the contract sum where a project has one, else its budget.
 */
function useStats(
  variant: "portfolio" | "dashboard",
  data: PortfolioOverviewDto | undefined,
  tableFilter: ProjectTableFilter,
  toggle: (f: ProjectTableFilter) => void
): Stat[] {
  const { hasPermission } = useAuth();
  if (!data) return [];
  const k = data.kpis;
  const ongoing: Stat = {
    key: "ongoing",
    label: variant === "portfolio" ? "Ongoing projects" : "Your ongoing projects",
    value: k.ongoingCount,
    detail: `of ${plural(k.projectCount, "project")} in view`,
    onSelect: () => toggle("ongoing"),
    selected: tableFilter === "ongoing",
  };
  const behind: Stat = {
    key: "behind",
    label: "Behind schedule",
    value: k.behindScheduleCount,
    tone: k.behindScheduleCount > 0 ? "alert" : "default",
    detail: (
      <>
        {k.behindScheduleCount > 0 ? "A unit due by an ended work phase is unfinished" : "No project is behind"}
        {/* UBEC IRL: projects with any early-warning alert (delayed, stalled, site update overdue, spend ahead of progress). */}
        {k.projectsWithAlertsCount > 0 && (
          <span className="block font-medium text-rose-700">{plural(k.projectsWithAlertsCount, "project")} with early-warning alerts</span>
        )}
      </>
    ),
    onSelect: () => toggle("behind"),
    selected: tableFilter === "behind",
  };
  const progress: Stat = { key: "progress", label: "Progress", value: `${k.weightedProgressPct}%`, detail: "Weighted by contract sum or budget" };

  if (variant === "portfolio") {
    return [
      { key: "commitment", label: "Total commitment", value: formatCompactNaira(k.totalCommitmentNgn), detail: `Contract sums (budget where not yet contracted) of ${plural(k.projectCount, "project")}` },
      progress,
      ongoing,
      behind,
    ];
  }

  const extra: Stat[] = [];
  if (hasPermission("visits:view")) {
    extra.push({
      key: "visits",
      label: "Monitoring visits in the next 7 days",
      value: k.upcomingVisitCount,
      tone: k.overdueVisitCount > 0 ? "alert" : "default",
      detail: k.overdueVisitCount > 0 ? `${plural(k.overdueVisitCount, "monitoring visit")} overdue or missed` : "None overdue",
    });
    extra.push({
      key: "findings",
      label: "Open findings",
      value: k.openFindingsCount,
      detail: k.openFindingsCount > 0 ? "Waiting for the contractor to correct" : "Nothing to correct",
    });
  }
  if (hasPermission("payments:view") || hasPermission("payments:record")) {
    extra.push({ key: "paid", label: "Paid to date", value: formatCompactNaira(k.totalDisbursedNgn), detail: `${k.disbursedPct}% of total commitment` });
  }
  return [ongoing, behind, ...extra, progress].slice(0, 4);
}
