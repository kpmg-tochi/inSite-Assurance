import React, { useEffect, useMemo, useState } from "react";
import type { PortfolioOverviewDto, ProjectListFilters } from "@insite/shared";
import { usePortfolioOverviewQuery } from "../../queries/projects/useProjectsQueries";
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

type HomeTab = "overview" | "kpis" | "visits";

/**
 * The workspace home (UBEC rebrand). "portfolio" is the programme admins' Portfolio
 * (`projects:view_portfolio`); "dashboard" is everyone else's Dashboard, over the projects they are
 * assigned to. Both: an Overview tab (headline figures, the map, the projects table: the only way
 * into a project), a KPIs tab (`kpis:view`) and a Visits tab (the visit planner, `visits:view`).
 */
export function WorkspaceHomePage({ variant, onOpenProject }: { variant: "portfolio" | "dashboard"; onOpenProject: (projectId: string) => void }) {
  const { hasPermission } = useAuth();
  const tabs = useMemo(
    () =>
      [
        { id: "overview" as const, label: "Overview" },
        ...(hasPermission("kpis:view") ? [{ id: "kpis" as const, label: "KPIs" }] : []),
        ...(hasPermission("visits:view") ? [{ id: "visits" as const, label: "Visits" }] : []),
      ] satisfies { id: HomeTab; label: string }[],
    [hasPermission]
  );
  const [active, setActive] = useUrlTab<HomeTab>(tabs.map((t) => t.id));
  const tab = active ?? "overview";

  return (
    <div className="space-y-4">
      {tabs.length > 1 && <Tabs tabs={tabs} active={tab} onChange={setActive} label={variant === "portfolio" ? "Portfolio views" : "Dashboard views"} idPrefix="home" />}
      <TabPanel idPrefix="home" id={tab}>
        {tab === "overview" && <OverviewTab variant={variant} onOpenProject={onOpenProject} />}
        {tab === "kpis" && <ProgrammeKpisPage onOpenProject={onOpenProject} />}
        {tab === "visits" && <VisitPlannerPage embedded />}
      </TabPanel>
    </div>
  );
}

function OverviewTab({ variant, onOpenProject }: { variant: "portfolio" | "dashboard"; onOpenProject: (projectId: string) => void }) {
  const [filters, setFilters] = useState<ProjectListFilters>({});
  const [tableFilter, setTableFilter] = useState<ProjectTableFilter>("all");
  const { data, isLoading, isError, refetch } = usePortfolioOverviewQuery(filters);
  const [ownersSeen, setOwnersSeen] = useState<Array<{ id: string; name: string }>>([]);

  useEffect(() => {
    const found = (data?.projects ?? []).map((p) => p.owningOrganization).filter((o): o is { id: string; name: string } => Boolean(o));
    if (found.some((o) => !ownersSeen.some((s) => s.id === o.id))) {
      setOwnersSeen((prev) => [...prev, ...found.filter((o) => !prev.some((s) => s.id === o.id))]);
    }
  }, [data, ownersSeen]);

  const toggle = (f: ProjectTableFilter) => setTableFilter((cur) => (cur === f ? "all" : f));
  const stats = useStats(variant, data, tableFilter, toggle);

  if (isLoading) {
    return (
      <div className="flex justify-center p-10">
        <Loader />
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          {variant === "portfolio" ? "Every project in the programme you can see." : "The projects you are assigned to."} Figures follow the filters.
        </p>
        <DeliveryModelFilters filters={filters} onChange={setFilters} owners={ownersSeen} />
      </div>
      <StatStrip stats={stats} label={variant === "portfolio" ? "Portfolio figures" : "Your figures"} />
      <PortfolioMap projects={data.projects} onOpenProject={onOpenProject} />
      <PortfolioProjectsTable projects={data.projects} filter={tableFilter} onFilterChange={setTableFilter} onOpenProject={onOpenProject} />
    </div>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * The four headline figures. Portfolio (owner's choice): total commitment, progress, ongoing
 * projects, behind schedule. Dashboard: the user's projects and schedule, then what their
 * permissions say they act on (visits and findings, or payments), topped up with progress.
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
    detail: k.behindScheduleCount > 0 ? "A unit due by an ended sprint is unfinished" : "No project is behind",
    onSelect: () => toggle("behind"),
    selected: tableFilter === "behind",
  };
  const progress: Stat = { key: "progress", label: "Progress", value: `${k.weightedProgressPct}%`, detail: "Weighted by contract sum" };

  if (variant === "portfolio") {
    return [
      { key: "commitment", label: "Total commitment", value: formatCompactNaira(k.totalCommitmentNgn), detail: `Contract sums of ${plural(k.projectCount, "project")}` },
      progress,
      ongoing,
      behind,
    ];
  }

  const extra: Stat[] = [];
  if (hasPermission("visits:view")) {
    extra.push({
      key: "visits",
      label: "Visits in the next 7 days",
      value: k.upcomingVisitCount,
      tone: k.overdueVisitCount > 0 ? "alert" : "default",
      detail: k.overdueVisitCount > 0 ? `${plural(k.overdueVisitCount, "visit")} overdue or missed` : "None overdue",
    });
    extra.push({
      key: "findings",
      label: "Open findings",
      value: k.openFindingsCount,
      detail: k.openFindingsCount > 0 ? "Waiting for the contractor to correct" : "Nothing to correct",
    });
  }
  if (hasPermission("payments:view") || hasPermission("payments:record")) {
    extra.push({ key: "paid", label: "Paid to date", value: formatCompactNaira(k.totalDisbursedNgn), detail: `${k.disbursedPct}% of contract sums` });
  }
  return [ongoing, behind, ...extra, progress].slice(0, 4);
}
