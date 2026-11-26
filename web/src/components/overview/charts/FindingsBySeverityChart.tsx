import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Clock } from "lucide-react";
import type { OverviewFindingSeverityRow } from "@insite/shared";
import { CHART_COLORS, GRID_LINE, LABEL_TEXT, chartOptions, tooltipHtml, usePrefersReducedMotion } from "./chartTheme";
import { ChartEmpty, ChartLegend, ChartPanel } from "./ChartPanel";
import { LazyChart } from "./LazyChart";

const SEVERITY_ORDER = ["CRITICAL", "MAJOR", "MINOR"] as const;
const SEVERITY_LABEL: Record<(typeof SEVERITY_ORDER)[number], string> = { CRITICAL: "Critical", MAJOR: "Major", MINOR: "Minor" };
const STATES = [
  { key: "open", label: "Open", color: CHART_COLORS.red },
  { key: "resolved", label: "Resolved", color: CHART_COLORS.green },
  { key: "dismissed", label: "Dismissed", color: CHART_COLORS.neutral },
] as const;

/** "Findings by severity": a horizontal stacked bar per severity (open, resolved, dismissed) and the overdue open count in words. */
export function FindingsBySeverityChart({ rows, projectId, className }: { rows: OverviewFindingSeverityRow[]; projectId: string; className?: string }) {
  const reducedMotion = usePrefersReducedMotion();
  const ordered = useMemo(
    () => SEVERITY_ORDER.map((s) => rows.find((r) => r.severity === s) ?? { severity: s, open: 0, openOverdue: 0, resolved: 0, dismissed: 0 }),
    [rows],
  );
  const total = ordered.reduce((s, r) => s + r.open + r.resolved + r.dismissed, 0);
  const overdue = ordered.reduce((s, r) => s + r.openOverdue, 0);
  const open = ordered.reduce((s, r) => s + r.open, 0);

  const { series, options } = useMemo(() => {
    const series = STATES.map((st) => ({ name: st.label, data: ordered.map((r) => r[st.key]) }));
    const max = Math.max(1, ...ordered.map((r) => r.open + r.resolved + r.dismissed));
    const options = chartOptions(reducedMotion, {
      chart: { type: "bar", stacked: true },
      colors: STATES.map((s) => s.color),
      plotOptions: { bar: { horizontal: true, barHeight: "56%", borderRadius: 4, borderRadiusApplication: "end", borderRadiusWhenStacked: "last" } },
      stroke: { show: true, width: 2, colors: ["#ffffff"] },
      grid: { xaxis: { lines: { show: true } }, yaxis: { lines: { show: false } } },
      xaxis: {
        categories: ordered.map((r) => SEVERITY_LABEL[r.severity]),
        min: 0,
        max: max <= 4 ? 4 : undefined,
        tickAmount: 4,
        labels: { formatter: (v: string) => String(Math.round(Number(v))), style: { fontSize: "11px" } },
        axisBorder: { show: true, color: GRID_LINE },
        axisTicks: { show: false },
      },
      yaxis: { labels: { style: { fontSize: "12px", colors: LABEL_TEXT } } },
      states: { hover: { filter: { type: "lighten" } } },
      tooltip: {
        shared: true,
        intersect: false,
        custom: ({ dataPointIndex }: { dataPointIndex: number }) => {
          const r = ordered[dataPointIndex];
          if (!r) return "";
          return tooltipHtml(
            `${SEVERITY_LABEL[r.severity]} findings`,
            STATES.map((st) => ({ color: st.color, value: String(r[st.key]), label: st.label.toLowerCase() })),
            r.openOverdue > 0 ? `${r.openOverdue} open past the escalation period` : undefined,
          );
        },
      },
    });
    return { series, options };
  }, [ordered, reducedMotion]);

  return (
    <ChartPanel
      className={className}
      title="Findings by severity"
      subtitle="Findings raised on monitoring visits: open, resolved and dismissed."
      legend={total > 0 ? <ChartLegend items={STATES.map((s) => ({ label: s.label, color: s.color, kind: "rect" }))} /> : null}
      table={{
        caption: "Findings by severity and status",
        columns: ["Severity", "Open", "Open, overdue", "Resolved", "Dismissed"],
        rows: ordered.map((r) => [SEVERITY_LABEL[r.severity], r.open, r.openOverdue, r.resolved, r.dismissed]),
      }}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          {overdue > 0 ? (
            <span className="inline-flex items-center gap-1.5 font-semibold text-rose-700">
              <Clock className="h-3.5 w-3.5" aria-hidden="true" />
              {overdue} open finding{overdue === 1 ? "" : "s"} past the escalation period
            </span>
          ) : (
            <span className="text-slate-600">{open > 0 ? "No open finding is past the escalation period." : total > 0 ? "No open findings." : ""}</span>
          )}
          <Link
            to={`/app/projects/${projectId}/visits?tab=findings`}
            className="rounded font-semibold text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary"
          >
            Findings
          </Link>
        </div>
      }
    >
      {total === 0 ? (
        <ChartEmpty height={96}>No findings raised yet.</ChartEmpty>
      ) : (
        <LazyChart
          type="bar"
          series={series}
          options={options}
          height={170}
          summary={`Stacked bar chart of ${total} findings by severity: ${ordered
            .map((r) => `${SEVERITY_LABEL[r.severity].toLowerCase()} ${r.open} open, ${r.resolved} resolved, ${r.dismissed} dismissed`)
            .join("; ")}.`}
        />
      )}
    </ChartPanel>
  );
}
