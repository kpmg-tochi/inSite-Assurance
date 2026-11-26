import type React from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Clock, TrendingDown, TrendingUp } from "lucide-react";
import { SCHEDULE_STATUS_META, type ProjectOverviewChartsDto, type ProjectOverviewDto } from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { formatCompactNaira } from "../../lib/formatters";
import { StatusText, type StatusTone } from "../common/StatusText";

const SCHEDULE_TONE: Record<string, StatusTone> = { positive: "good", neutral: "neutral", warning: "pending", critical: "bad", muted: "neutral" };

/** A stat tile: label, value (proportional figures), at most three short lines and one link. */
function StatTile({
  title,
  value,
  lines = [],
  link,
}: {
  title: string;
  value: React.ReactNode;
  lines?: React.ReactNode[];
  link?: { to: string; label: string } | null;
}) {
  const shown = lines.filter(Boolean);
  return (
    <section className="flex min-w-0 flex-col rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm" aria-label={title}>
      <h2 className="text-xs font-semibold text-slate-500">{title}</h2>
      <div className="mt-1 text-2xl font-bold leading-tight tracking-tight text-slate-900">{value}</div>
      {shown.length > 0 && (
        <div className="mt-1 space-y-0.5 text-xs text-slate-600">
          {shown.map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
      {link && (
        <Link
          to={link.to}
          className="mt-auto self-start rounded pt-3 text-xs font-semibold text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          {link.label}
        </Link>
      )}
    </section>
  );
}

/** "3.2 pts behind plan" / "ahead of plan" / "On plan": icon plus words, never colour alone. */
function PlanGap({ actual, planned }: { actual: number; planned: number }) {
  const gap = Math.round((actual - planned) * 10) / 10;
  if (Math.abs(gap) < 0.5) {
    return (
      <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-700" aria-hidden="true" />
        On plan
      </span>
    );
  }
  const behind = gap < 0;
  const Icon = behind ? TrendingDown : TrendingUp;
  return (
    <span className={`inline-flex items-center gap-1 font-semibold ${behind ? "text-rose-700" : "text-emerald-800"}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {Math.abs(gap).toFixed(1)} pts {behind ? "behind" : "ahead of"} plan
    </span>
  );
}

/**
 * The Overview's stat row: % complete against plan, paid (or the budget for readers without
 * payments), open findings, open defects. Tiles the caller may not see are left out.
 */
export function OverviewStatRow({
  project,
  overview,
  charts,
}: {
  project: ProjectSummaryDto;
  overview: ProjectOverviewDto;
  charts: ProjectOverviewChartsDto | undefined;
}) {
  const tiles: React.ReactNode[] = [];
  const curve = charts?.progressCurve ?? null;
  const current = curve?.currentPct ?? project.certifiedProgressPct;
  const badge = project.scheduleVariance;

  tiles.push(
    <StatTile
      key="progress"
      title="% complete"
      value={
        <span title={project.progressIsImported ? "Reported at import; replaced by verified progress once the scope is added" : "Budget-weighted, from accepted monitoring reports"}>
          {current.toFixed(1)}%
          {project.progressIsImported && <span className="ml-2 text-xs font-semibold tracking-normal text-slate-500">Reported at import</span>}
        </span>
      }
      lines={[
        curve?.plannedTodayPct != null ? (
          <span key="plan" className="flex flex-wrap items-center gap-x-2">
            <span>Planned today {curve.plannedTodayPct.toFixed(1)}%</span>
            <PlanGap actual={current} planned={curve.plannedTodayPct} />
          </span>
        ) : null,
        badge ? (
          <StatusText
            key="badge"
            tone={SCHEDULE_TONE[SCHEDULE_STATUS_META[badge.status].tone]}
            label={badge.status === "UNSCHEDULED" ? "No work phases to schedule against" : `Schedule: ${badge.label.toLowerCase()}`}
          />
        ) : null,
      ]}
      link={overview.hasSprints !== null ? { to: `/app/projects/${project.id}/scope`, label: "BoQ & work phases" } : null}
    />,
  );

  const money = charts?.money ?? null;
  if (money) {
    const basis = money.contractSumNgn ?? money.budgetNgn;
    const pct = basis > 0 ? Math.round((money.paidGrossNgn / basis) * 100) : null;
    tiles.push(
      <StatTile
        key="paid"
        title="Paid (gross)"
        value={formatCompactNaira(money.paidGrossNgn)}
        lines={[
          pct !== null
            ? `${pct}% of the ${money.contractSumNgn !== null ? "contract sum" : "budget"} (${formatCompactNaira(basis)})`
            : null,
        ]}
        link={{ to: `/app/projects/${project.id}/payments`, label: "Payments" }}
      />,
    );
  } else if (charts && charts.money === null) {
    tiles.push(<StatTile key="budget" title="Budget" value={formatCompactNaira(project.totalBudgetNgn)} />);
  }

  if (overview.openFindingCount !== null) {
    const rows = charts?.findingsBySeverity ?? null;
    const open = (s: "CRITICAL" | "MAJOR") => rows?.find((r) => r.severity === s)?.open ?? 0;
    const overdue = rows ? rows.reduce((s, r) => s + r.openOverdue, 0) : 0;
    tiles.push(
      <StatTile
        key="findings"
        title="Open findings"
        value={overview.openFindingCount}
        lines={[
          rows ? `${open("CRITICAL")} critical · ${open("MAJOR")} major` : null,
          overdue > 0 ? (
            <span key="o" className="inline-flex items-center gap-1 font-semibold text-rose-700">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {overdue} past the escalation period
            </span>
          ) : null,
        ]}
        link={{ to: `/app/projects/${project.id}/visits?tab=findings`, label: "Findings" }}
      />,
    );
  }

  if (overview.openDefectCount !== null) {
    tiles.push(
      <StatTile
        key="defects"
        title="Open defects"
        value={overview.openDefectCount}
        lines={[overview.openDefectCount === 0 ? "No defect ticket is open." : "Defect tickets not yet closed."]}
        link={{ to: `/app/projects/${project.id}/completion?tab=defects`, label: "Defects" }}
      />,
    );
  }

  const cols = tiles.length >= 4 ? "sm:grid-cols-2 xl:grid-cols-4" : tiles.length === 3 ? "sm:grid-cols-3" : tiles.length === 2 ? "sm:grid-cols-2" : "";
  return <div className={`grid grid-cols-1 gap-3 ${cols}`}>{tiles}</div>;
}
