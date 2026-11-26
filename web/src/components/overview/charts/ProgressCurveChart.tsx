import { useMemo } from "react";
import type { ApexOptions } from "apexcharts";
import type { OverviewProgressCurve } from "@insite/shared";
import { CHART_COLORS, GRID_LINE, LABEL_TEXT, chartOptions, tooltipHtml, usePrefersReducedMotion } from "./chartTheme";
import { ChartEmpty, ChartLegend, ChartPanel, type LegendItem } from "./ChartPanel";
import { LazyChart } from "./LazyChart";
import { dateMs, fmtDay, fmtMonth, fmtPct } from "../overviewFormat";

const HEIGHT = 280;

interface SeriesDef {
  key: "plannedPct" | "actualPct" | "paidPct";
  name: string;
  color: string;
  dashed: boolean;
}

/**
 * "Progress and payments over time": one % axis (0–100) with planned (dashed reference), actual and
 * paid by month. Crosshair with one tooltip for every series, a "Today" line, a legend and an end
 * label per series where the ends do not collide.
 */
export function ProgressCurveChart({ curve, today, className }: { curve: OverviewProgressCurve; today: string; className?: string }) {
  const reducedMotion = usePrefersReducedMotion();
  const points = curve.points;
  const paidLabel = curve.paidBasis === "BUDGET" ? "Paid (% of budget)" : "Paid (% of contract sum)";

  const defs = useMemo<SeriesDef[]>(() => {
    const out: SeriesDef[] = [];
    if (points.some((p) => p.plannedPct !== null)) out.push({ key: "plannedPct", name: "Planned", color: CHART_COLORS.reference, dashed: true });
    out.push({ key: "actualPct", name: "Actual", color: CHART_COLORS.green, dashed: false });
    if (curve.paidBasis !== null) out.push({ key: "paidPct", name: paidLabel, color: CHART_COLORS.amber, dashed: false });
    return out;
  }, [points, curve.paidBasis, paidLabel]);

  const { series, options } = useMemo(() => {
    const series = defs.map((d) => ({ name: d.name, data: points.map((p) => ({ x: dateMs(p.date), y: p[d.key] })) }));

    // End labels: the last value of each series; at the same date, a label within 8 points of one
    // already placed is dropped (the legend and tooltip carry it) rather than nudged off its line.
    const placed: Array<{ x: number; y: number }> = [];
    const endPoints: NonNullable<ApexOptions["annotations"]>["points"] = [];
    for (const d of [...defs].reverse()) {
      const last = [...points].reverse().find((p) => p[d.key] !== null);
      if (!last) continue;
      const x = dateMs(last.date);
      const y = last[d.key] as number;
      const collides = placed.some((p) => p.x === x && Math.abs(p.y - y) < 8);
      placed.push({ x, y });
      endPoints.push({
        x,
        y,
        marker: { size: 4, fillColor: d.color, strokeColor: "#ffffff", strokeWidth: 2 },
        label: collides
          ? { text: "", borderWidth: 0, style: { background: "transparent" } }
          : {
              text: `${d.name.split(" (")[0]} ${fmtPct(y, 0)}`,
              borderWidth: 0,
              textAnchor: "end",
              offsetX: -6,
              offsetY: 2,
              style: { background: "rgba(255,255,255,0.85)", color: LABEL_TEXT, fontSize: "11px", fontWeight: 600 },
            },
      });
    }

    const first = points[0] ? dateMs(points[0].date) : 0;
    const lastX = points.length ? dateMs(points[points.length - 1].date) : 0;
    const todayX = dateMs(today);
    const showToday = points.length > 1 && todayX >= first && todayX <= lastX;

    const options = chartOptions(reducedMotion, {
      chart: { type: "line" },
      colors: defs.map((d) => d.color),
      stroke: { width: 2, curve: "straight", lineCap: "round", dashArray: defs.map((d) => (d.dashed ? 5 : 0)) },
      markers: { size: points.length === 1 ? 4 : 0, strokeColors: "#ffffff", strokeWidth: 2, hover: { size: 5 } },
      grid: { xaxis: { lines: { show: false } }, yaxis: { lines: { show: true } } },
      xaxis: {
        type: "datetime",
        labels: { datetimeUTC: true, datetimeFormatter: { year: "yyyy", month: "MMM 'yy", day: "d MMM" }, style: { fontSize: "11px" } },
        axisBorder: { show: true, color: GRID_LINE },
        axisTicks: { show: false },
        crosshairs: { show: true, stroke: { color: "#94a3b8", width: 1, dashArray: 0 } },
        tooltip: { enabled: false },
      },
      yaxis: { min: 0, max: 100, tickAmount: 4, labels: { formatter: (v: number) => `${Math.round(v)}%`, style: { fontSize: "11px" } } },
      annotations: {
        xaxis: showToday
          ? [
              {
                x: todayX,
                borderColor: "#64748b",
                strokeDashArray: 0,
                label: {
                  text: "Today",
                  orientation: "horizontal",
                  position: "top",
                  borderWidth: 0,
                  offsetY: -4,
                  style: { background: "#ffffff", color: LABEL_TEXT, fontSize: "11px", fontWeight: 600 },
                },
              },
            ]
          : [],
        points: endPoints,
      },
      tooltip: {
        shared: true,
        intersect: false,
        custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
          const p = points[dataPointIndex];
          if (!p) return "";
          const heading = p.date === today ? `Today, ${fmtDay(p.date)}` : fmtDay(p.date);
          return tooltipHtml(
            heading,
            defs.map((d) => ({ color: d.color, dashed: d.dashed, value: p[d.key] === null ? "–" : fmtPct(p[d.key]), label: d.name })),
          );
        },
      },
    });
    return { series, options };
  }, [defs, points, today, reducedMotion]);

  const legend: LegendItem[] = defs.map((d) => ({ label: d.name, color: d.color, kind: d.dashed ? "dash" : "line" }));
  const summaryParts = [`${fmtPct(curve.currentPct)} complete today`];
  if (curve.plannedTodayPct !== null) summaryParts.push(`planned ${fmtPct(curve.plannedTodayPct)}`);
  const lastPaid = [...points].reverse().find((p) => p.paidPct !== null)?.paidPct ?? null;
  if (curve.paidBasis !== null) summaryParts.push(`paid ${fmtPct(lastPaid ?? 0)} of the ${curve.paidBasis === "BUDGET" ? "budget" : "contract sum"}`);

  const multiYear = points.length > 0 && points[0].month.slice(0, 4) !== points[points.length - 1].month.slice(0, 4);
  return (
    <ChartPanel
      className={className}
      title="Progress and payments over time"
      subtitle={
        curve.paidBasis === null
          ? "% complete by month: planned from the work phases, actual from accepted monitoring reports."
          : `% complete by month (planned and actual) and gross paid as a % of the ${curve.paidBasis === "BUDGET" ? "budget" : "contract sum"}.`
      }
      legend={points.length > 0 ? <ChartLegend items={legend} /> : null}
      table={{
        caption: "Progress and payments by month",
        columns: ["Month", ...defs.map((d) => d.name)],
        rows: points.map((p) => [fmtMonth(p.month, true) + (p.date === today ? " (to today)" : ""), ...defs.map((d) => fmtPct(p[d.key]))]),
      }}
    >
      {points.length === 0 ? (
        <ChartEmpty height={HEIGHT - 40}>No progress to plot yet. The curve starts once the project has work phases or accepted monitoring reports.</ChartEmpty>
      ) : (
        <LazyChart
          type="line"
          series={series}
          options={options}
          height={HEIGHT}
          summary={`Line chart of progress and payments by month${multiYear ? "" : ` in ${points[0].month.slice(0, 4)}`}: ${summaryParts.join(", ")}.`}
        />
      )}
    </ChartPanel>
  );
}
