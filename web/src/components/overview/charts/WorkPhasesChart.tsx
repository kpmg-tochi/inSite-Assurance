import { useMemo } from "react";
import { Link } from "react-router-dom";
import type { OverviewWorkPhase } from "@insite/shared";
import { CHART_COLORS, GRID_LINE, LABEL_TEXT, chartOptions, tooltipHtml, usePrefersReducedMotion } from "./chartTheme";
import { ChartEmpty, ChartLegend, ChartPanel } from "./ChartPanel";
import { LazyChart } from "./LazyChart";
import { DAY_MS, dateMs, fmtDay, fmtRange } from "../overviewFormat";

type PhaseState = "MET" | "PARTLY_MET" | "NOT_MET" | "VERIFIED" | "ACTIVE" | "UPCOMING" | "ENDED" | "LATE";

/** Fixed order and colour per state (colour follows the state, never the row). Words always shown with it. */
const STATE_META: Record<PhaseState, { short: string; long: string; color: string }> = {
  MET: { short: "Met", long: "Verified: met", color: CHART_COLORS.green },
  PARTLY_MET: { short: "Partly met", long: "Verified: partly met", color: CHART_COLORS.amber },
  NOT_MET: { short: "Not met", long: "Verified: not met", color: CHART_COLORS.red },
  VERIFIED: { short: "Verified", long: "Verified", color: CHART_COLORS.green },
  ACTIVE: { short: "Active", long: "Active", color: CHART_COLORS.blue },
  UPCOMING: { short: "Upcoming", long: "Upcoming", color: CHART_COLORS.neutral },
  ENDED: { short: "Not verified", long: "Ended, not verified yet", color: CHART_COLORS.neutralDark },
  LATE: { short: "Verification late", long: "Ended, verification late", color: CHART_COLORS.orange },
};
const STATE_ORDER: PhaseState[] = ["MET", "VERIFIED", "PARTLY_MET", "NOT_MET", "ACTIVE", "ENDED", "LATE", "UPCOMING"];

function stateOf(p: OverviewWorkPhase): PhaseState {
  if (p.status === "VERIFIED") return p.verificationOutcome ?? "VERIFIED";
  return p.status;
}

/**
 * "Work phases": a timeline bar per work phase from its start to its end, coloured by state (with
 * the state in the row label, tooltip and legend) and a "Today" line.
 */
export function WorkPhasesChart({ phases, today, projectId, className }: { phases: OverviewWorkPhase[]; today: string; projectId: string; className?: string }) {
  const reducedMotion = usePrefersReducedMotion();
  const sorted = useMemo(() => [...phases].sort((a, b) => a.number - b.number), [phases]);
  const height = sorted.length * 34 + 56;

  const { series, options } = useMemo(() => {
    const rows = sorted.map((p) => ({ phase: p, state: stateOf(p) }));
    const series = [
      {
        name: "Work phases",
        data: rows.map(({ phase, state }) => ({
          x: `Work phase ${phase.number} · ${STATE_META[state].short}`,
          // A phase covers its whole end day.
          y: [dateMs(phase.startDate), dateMs(phase.endDate) + DAY_MS],
          fillColor: STATE_META[state].color,
        })),
      },
    ];
    const todayX = dateMs(today);
    const starts = sorted.map((p) => dateMs(p.startDate));
    const ends = sorted.map((p) => dateMs(p.endDate) + DAY_MS);
    const min = Math.min(todayX, ...starts) - 3 * DAY_MS;
    const max = Math.max(todayX, ...ends) + 3 * DAY_MS;
    const options = chartOptions(reducedMotion, {
      chart: { type: "rangeBar" },
      plotOptions: { bar: { horizontal: true, barHeight: "56%", borderRadius: 4, borderRadiusApplication: "around" } },
      stroke: { width: 0 },
      grid: { xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } } },
      xaxis: {
        type: "datetime",
        min,
        max,
        labels: { datetimeUTC: true, datetimeFormatter: { year: "yyyy", month: "MMM 'yy", day: "d MMM" }, style: { fontSize: "11px" } },
        axisBorder: { show: true, color: GRID_LINE },
        axisTicks: { show: false },
      },
      yaxis: { labels: { maxWidth: 240, style: { fontSize: "12px", colors: LABEL_TEXT } } },
      annotations: {
        xaxis: [
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
        ],
      },
      tooltip: {
        custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
          const row = rows[dataPointIndex];
          if (!row) return "";
          const { phase, state } = row;
          return tooltipHtml(
            `Work phase ${phase.number}${phase.name ? ` · ${phase.name}` : ""}`,
            [
              { color: STATE_META[state].color, value: STATE_META[state].long, label: "" },
              { value: fmtRange(phase.startDate, phase.endDate), label: "" },
              { value: String(phase.unitCount), label: phase.unitCount === 1 ? "facility unit" : "facility units" },
            ],
          );
        },
      },
    });
    return { series, options };
  }, [sorted, today, reducedMotion]);

  const present = STATE_ORDER.filter((s) => sorted.some((p) => stateOf(p) === s));
  return (
    <ChartPanel
      className={className}
      title="Work phases"
      subtitle="Each work phase from start to end, with its verification state."
      legend={sorted.length > 0 ? <ChartLegend items={present.map((s) => ({ label: STATE_META[s].long, color: STATE_META[s].color, kind: "rect" }))} /> : null}
      table={{
        caption: "Work phases",
        columns: ["Work phase", "Start", "End", "Facility units", "State"],
        rows: sorted.map((p) => [
          `${p.number}${p.name ? ` · ${p.name}` : ""}`,
          fmtDay(p.startDate),
          fmtDay(p.endDate),
          p.unitCount,
          STATE_META[stateOf(p)].long,
        ]),
      }}
    >
      {sorted.length === 0 ? (
        <ChartEmpty>
          No work phases yet.{" "}
          <Link to={`/app/projects/${projectId}/scope`} className="font-semibold text-brand-primary hover:underline">
            BoQ & work phases
          </Link>
        </ChartEmpty>
      ) : (
        <LazyChart
          type="rangeBar"
          series={series}
          options={options}
          height={height}
          summary={`Timeline of ${sorted.length} work phases from ${fmtDay(sorted[0].startDate)} to ${fmtDay(sorted[sorted.length - 1].endDate)}; ${present
            .map((s) => `${sorted.filter((p) => stateOf(p) === s).length} ${STATE_META[s].long.toLowerCase()}`)
            .join(", ")}.`}
        />
      )}
    </ChartPanel>
  );
}
