import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { OverviewVisitMonth } from "@insite/shared";
import { CHART_COLORS, GRID_LINE, chartOptions, tooltipHtml, usePrefersReducedMotion } from "./chartTheme";
import { ChartEmpty, ChartLegend, ChartPanel } from "./ChartPanel";
import { LazyChart } from "./LazyChart";
import { fmtMonth } from "../overviewFormat";

const HEIGHT = 230;

/** Stack order bottom → top; colours validated as an adjacent set (green, blue, amber, red), then the neutral. */
const STATUSES = [
  { key: "accepted", label: "Accepted", color: CHART_COLORS.green },
  { key: "awaitingReview", label: "Awaiting review", color: CHART_COLORS.blue },
  { key: "returned", label: "Returned", color: CHART_COLORS.amber },
  { key: "missed", label: "Missed", color: CHART_COLORS.red },
  { key: "upcoming", label: "Upcoming", color: CHART_COLORS.neutral },
] as const;

/** "Jan 2027" for a January, else "Jul" (short, so all nine fit; the tooltip names the year). */
function monthLabel(m: OverviewVisitMonth): string {
  return fmtMonth(m.month, m.month.endsWith("-01"));
}

/**
 * "Monitoring visits": stacked columns of visits by planned month (six months back, this month, two
 * ahead), one segment per status. The current month is named under its column.
 */
export function VisitsByMonthChart({ months, today, projectId, className }: { months: OverviewVisitMonth[]; today: string; projectId: string; className?: string }) {
  const reducedMotion = usePrefersReducedMotion();
  const thisMonth = today.slice(0, 7);
  const total = months.reduce((s, m) => s + STATUSES.reduce((t, st) => t + m[st.key], 0), 0);

  const { series, options } = useMemo(() => {
    const categories = months.map((m) => (m.month === thisMonth ? [monthLabel(m), "This month"] : monthLabel(m)));
    const series = STATUSES.map((s) => ({ name: s.label, data: months.map((m) => m[s.key]) }));
    const max = Math.max(1, ...months.map((m) => STATUSES.reduce((t, st) => t + m[st.key], 0)));
    const options = chartOptions(reducedMotion, {
      chart: { type: "bar", stacked: true },
      colors: STATUSES.map((s) => s.color),
      plotOptions: { bar: { columnWidth: "22px", borderRadius: 4, borderRadiusApplication: "end", borderRadiusWhenStacked: "last" } },
      // The 2px surface gap between stacked segments.
      stroke: { show: true, width: 2, colors: ["#ffffff"] },
      grid: { xaxis: { lines: { show: false } }, yaxis: { lines: { show: true } } },
      xaxis: {
        categories,
        labels: { style: { fontSize: "11px" }, rotate: 0, hideOverlappingLabels: false, trim: false },
        axisBorder: { show: true, color: GRID_LINE },
        axisTicks: { show: false },
        tooltip: { enabled: false },
      },
      yaxis: { min: 0, max: max <= 4 ? 4 : undefined, tickAmount: 4, forceNiceScale: true, labels: { formatter: (v: number) => String(Math.round(v)), style: { fontSize: "11px" } } },
      states: { hover: { filter: { type: "lighten" } } },
      tooltip: {
        shared: true,
        intersect: false,
        custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
          const m = months[dataPointIndex];
          if (!m) return "";
          const rows = STATUSES.filter((s) => m[s.key] > 0).map((s) => ({ color: s.color, value: String(m[s.key]), label: s.label.toLowerCase() }));
          return tooltipHtml(`${fmtMonth(m.month, true)}${m.month === thisMonth ? " (this month)" : ""}`, rows.length ? rows : [{ value: "0", label: "monitoring visits" }]);
        },
      },
    });
    return { series, options };
  }, [months, thisMonth, reducedMotion]);

  return (
    <ChartPanel
      className={className}
      title="Monitoring visits"
      subtitle="Monitoring visits by planned month and status."
      legend={total > 0 ? <ChartLegend items={STATUSES.map((s) => ({ label: s.label, color: s.color, kind: "rect" }))} /> : null}
      table={{
        caption: "Monitoring visits by month and status",
        columns: ["Month", ...STATUSES.map((s) => s.label)],
        rows: months.map((m) => [`${fmtMonth(m.month, true)}${m.month === thisMonth ? " (this month)" : ""}`, ...STATUSES.map((s) => m[s.key])]),
      }}
      footer={
        <Link
          to={`/app/projects/${projectId}/visits`}
          className="rounded text-xs font-semibold text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
        >
          Monitoring visits
        </Link>
      }
    >
      {total === 0 ? (
        <ChartEmpty>No monitoring visits planned in these months.</ChartEmpty>
      ) : (
        <LazyChart
          type="bar"
          series={series}
          options={options}
          height={HEIGHT}
          summary={`Stacked column chart of ${total} monitoring visits over ${months.length} months by status: ${STATUSES.map(
            (s) => `${months.reduce((t, m) => t + m[s.key], 0)} ${s.label.toLowerCase()}`,
          ).join(", ")}.`}
        />
      )}
    </ChartPanel>
  );
}
