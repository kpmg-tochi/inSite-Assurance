import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { TriangleAlert } from "lucide-react";
import type { OverviewUnitProgress } from "@insite/shared";
import { CHART_COLORS, GRID_LINE, LABEL_TEXT, chartOptions, tooltipHtml, usePrefersReducedMotion } from "./chartTheme";
import { ChartEmpty, ChartLegend, ChartPanel, SegmentedControl } from "./ChartPanel";
import { LazyChart } from "./LazyChart";
import { fmtPct } from "../overviewFormat";

const ROW_HEIGHT = 32;
const COLLAPSED_ROWS = 12;

interface Row {
  key: string;
  label: string;
  detail: string;
  progressPct: number;
  plannedPct: number | null;
  behind: boolean;
}

type View = "unit" | "site";

/** Budget-weighted % from units (a plain mean when the units carry no amount). */
function weighted(units: OverviewUnitProgress[], pick: (u: OverviewUnitProgress) => number | null): number | null {
  const withValue = units.filter((u) => pick(u) !== null);
  if (withValue.length === 0) return null;
  const total = withValue.reduce((s, u) => s + Math.max(0, u.amountNgn), 0);
  const value =
    total > 0
      ? withValue.reduce((s, u) => s + (pick(u) as number) * Math.max(0, u.amountNgn), 0) / total
      : withValue.reduce((s, u) => s + (pick(u) as number), 0) / withValue.length;
  return Math.round(value * 10) / 10;
}

function unitRows(units: OverviewUnitProgress[]): Row[] {
  return units.map((u) => ({
    key: u.unitId,
    label: `${u.unitCode} · ${u.facilityName}`,
    detail: u.siteNumber !== null ? `Site ${u.siteNumber}${u.siteName ? ` · ${u.siteName}` : ""}` : "",
    progressPct: u.progressPct,
    plannedPct: u.plannedPct,
    behind: u.behind,
  }));
}

function siteRows(units: OverviewUnitProgress[]): Row[] {
  const groups = new Map<string, OverviewUnitProgress[]>();
  for (const u of units) {
    const key = u.siteNumber === null ? "none" : String(u.siteNumber);
    groups.set(key, [...(groups.get(key) ?? []), u]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "none" ? 1 : b === "none" ? -1 : Number(a) - Number(b)))
    .map(([key, list]) => {
      const first = list[0];
      return {
        key,
        label: key === "none" ? "No site" : `Site ${first.siteNumber}${first.siteName ? ` · ${first.siteName}` : ""}`,
        detail: `${list.length} facility unit${list.length === 1 ? "" : "s"}`,
        progressPct: weighted(list, (u) => u.progressPct) ?? 0,
        plannedPct: weighted(list, (u) => u.plannedPct),
        behind: list.some((u) => u.behind),
      };
    });
}

/** Most behind first: units flagged behind, then by the gap to plan. */
function mostBehind(rows: Row[]): Row[] {
  const score = (r: Row) => (r.behind ? 1000 : 0) + ((r.plannedPct ?? r.progressPct) - r.progressPct);
  return [...rows].sort((a, b) => score(b) - score(a));
}

/**
 * "Progress by facility unit": a bullet chart. Each bar is the unit's % complete; the dark tick is
 * the % planned for today. Units behind (end work phase over, work below 100%) carry a warning sign
 * in their label and the word "Behind" in the tooltip and table. More than one site adds a
 * "By unit / By site" switch (sites budget-weighted from their units).
 */
export function UnitProgressChart({ units, projectId, className }: { units: OverviewUnitProgress[]; projectId: string; className?: string }) {
  const reducedMotion = usePrefersReducedMotion();
  const [view, setView] = useState<View>("unit");
  const [showAll, setShowAll] = useState(false);
  const siteCount = new Set(units.map((u) => u.siteNumber).filter((n) => n !== null)).size;
  const activeView: View = siteCount > 1 ? view : "unit";

  const allRows = useMemo(() => (activeView === "site" ? siteRows(units) : unitRows(units)), [activeView, units]);
  const collapsible = allRows.length > COLLAPSED_ROWS;
  const rows = collapsible && !showAll ? mostBehind(allRows).slice(0, COLLAPSED_ROWS) : allRows;
  const behindCount = allRows.filter((r) => r.behind).length;
  const noun = activeView === "site" ? "site" : "facility unit";
  const height = rows.length * ROW_HEIGHT + 48;

  const { series, options } = useMemo(() => {
    const series = [
      {
        name: "% complete",
        data: rows.map((r) => ({
          x: `${r.behind ? "⚠ " : ""}${r.label}`,
          y: r.progressPct,
          goals:
            r.plannedPct === null
              ? []
              : [{ name: "Planned today", value: r.plannedPct, strokeWidth: 3, strokeHeight: 18, strokeColor: CHART_COLORS.reference, strokeLineCap: "round" as const }],
        })),
      },
    ];
    const options = chartOptions(reducedMotion, {
      chart: { type: "bar" },
      colors: [CHART_COLORS.green],
      plotOptions: { bar: { horizontal: true, barHeight: "58%", borderRadius: 4, borderRadiusApplication: "end" } },
      grid: { xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } } },
      xaxis: {
        min: 0,
        max: 100,
        tickAmount: 4,
        labels: { formatter: (v: string) => `${Math.round(Number(v))}%`, style: { fontSize: "11px" } },
        axisBorder: { show: true, color: GRID_LINE },
        axisTicks: { show: false },
      },
      yaxis: { labels: { maxWidth: 220, style: { fontSize: "12px", colors: LABEL_TEXT } } },
      states: { hover: { filter: { type: "lighten" } } },
      tooltip: {
        shared: false,
        intersect: false,
        custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
          const r = rows[dataPointIndex];
          if (!r) return "";
          const lines: Array<{ color: string; value: string; label: string }> = [{ color: CHART_COLORS.green, value: fmtPct(r.progressPct), label: "complete" }];
          if (r.plannedPct !== null) lines.push({ color: CHART_COLORS.reference, value: fmtPct(r.plannedPct), label: "planned today" });
          const note = [r.detail, r.behind ? "Behind: its last work phase has ended with work below 100%." : ""].filter(Boolean).join(" · ");
          return tooltipHtml(r.label, lines, note || undefined);
        },
      },
    });
    return { series, options };
  }, [rows, reducedMotion]);

  const subtitle =
    collapsible && !showAll
      ? `The ${COLLAPSED_ROWS} ${noun}s most behind plan: bar = % complete, tick = planned today.`
      : `% complete per ${noun} (bar) against the % planned for today (tick)${activeView === "site" ? ", budget-weighted from units" : ""}.`;

  return (
    <ChartPanel
      className={className}
      title={activeView === "site" ? "Progress by site" : "Progress by facility unit"}
      subtitle={subtitle}
      actions={
        siteCount > 1 ? (
          <SegmentedControl
            label="Group progress"
            options={[
              { id: "unit", label: "By unit" },
              { id: "site", label: "By site" },
            ]}
            value={activeView}
            onChange={(v) => {
              setView(v);
              setShowAll(false);
            }}
          />
        ) : undefined
      }
      legend={
        units.length > 0 ? (
          <ChartLegend
            items={[
              { label: "% complete", color: CHART_COLORS.green, kind: "rect" },
              { label: "Planned today", color: CHART_COLORS.reference, kind: "marker" },
            ]}
            extra={
              behindCount > 0 ? (
                <li className="inline-flex items-center gap-1.5 font-semibold text-amber-800">
                  <TriangleAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  Behind: {behindCount} {noun}
                  {behindCount === 1 ? "" : "s"}
                </li>
              ) : null
            }
          />
        ) : null
      }
      table={{
        caption: activeView === "site" ? "Progress by site" : "Progress by facility unit",
        columns: [activeView === "site" ? "Site" : "Facility unit", "% complete", "Planned today", "Status"],
        rows: allRows.map((r) => [r.label, fmtPct(r.progressPct), fmtPct(r.plannedPct), r.behind ? "Behind" : "–"]),
      }}
      footer={
        collapsible ? (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            aria-expanded={showAll}
            className="rounded text-xs font-semibold text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            {showAll ? `Show the ${COLLAPSED_ROWS} most behind` : `Show all ${allRows.length} ${noun}s`}
          </button>
        ) : null
      }
    >
      {units.length === 0 ? (
        <ChartEmpty>
          No facility units yet.{" "}
          <Link to={`/app/projects/${projectId}/scope`} className="font-semibold text-brand-primary hover:underline">
            BoQ & work phases
          </Link>
        </ChartEmpty>
      ) : (
        <div className={showAll ? "max-h-[480px] overflow-y-auto pr-1" : ""}>
          <LazyChart
            type="bar"
            series={series}
            options={options}
            height={height}
            summary={`Bar chart of % complete for ${rows.length} ${noun}s against the % planned for today; ${behindCount} behind.`}
          />
        </div>
      )}
    </ChartPanel>
  );
}
