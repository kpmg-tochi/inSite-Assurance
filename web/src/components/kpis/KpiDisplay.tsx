import React, { useState } from "react";
import { CheckCircle2, CircleDashed, CircleSlash, MinusCircle, TriangleAlert, XCircle } from "lucide-react";
import { formatKpiValue, type KpiDefinition, type KpiStatus, type KpiTrendPoint } from "@insite/shared";

/**
 * Phase 16: shared KPI display pieces. Status colours are the reserved status steps (good,
 * warning, critical) and always come with an icon and a label, never colour alone. Text stays in
 * the slate text tokens; colour sits on the icon only. Charts read their colours from CSS custom
 * properties (`--kpi-*`), so a theme can redefine them in one place.
 */

export const KPI_STATUS_META: Record<KpiStatus, { label: string; icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; color: string }> = {
  MET: { label: "Met", icon: CheckCircle2, color: "var(--kpi-good, #0ca30c)" },
  NEAR: { label: "Near target", icon: TriangleAlert, color: "var(--kpi-warning, #c98a00)" },
  MISSED: { label: "Missed", icon: XCircle, color: "var(--kpi-critical, #d03b3b)" },
  NO_TARGET: { label: "No target", icon: MinusCircle, color: "var(--kpi-muted, #64748b)" },
  NO_DATA: { label: "No data in period", icon: CircleDashed, color: "var(--kpi-muted, #64748b)" },
  NOT_TRACKED: { label: "Not tracked", icon: CircleSlash, color: "var(--kpi-muted, #94a3b8)" },
};

export function KpiStatusChip({ status, label }: { status: KpiStatus; label?: string }) {
  const meta = KPI_STATUS_META[status];
  const Icon = meta.icon;
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-700 whitespace-nowrap">
      <Icon className="w-3 h-3 shrink-0" style={{ color: meta.color }} />
      {label ?? meta.label}
    </span>
  );
}

/** "At least 90%" / "At most 14 days" / "No target". */
export function targetText(def: Pick<KpiDefinition, "unit" | "direction">, target: number | null, varies = false): string {
  if (varies) return "Targets vary by project type";
  if (target === null) return "No target";
  return `${def.direction === "HIGHER_IS_BETTER" ? "At least" : "At most"} ${formatKpiValue(def, target)}`;
}

export function countText(def: Pick<KpiDefinition, "unit">, numerator: number, denominator: number): string {
  if (def.unit === "DAYS") return denominator > 0 ? `${denominator} item${denominator === 1 ? "" : "s"}` : "none in period";
  const fmt = (n: number) => (Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : String(Math.round(n * 10) / 10));
  return `${fmt(numerator)} of ${fmt(denominator)}`;
}

const monthLabel = (periodStart: string) =>
  new Date(`${periodStart}T12:00:00Z`).toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });

/**
 * A single-series monthly sparkline: a 2px line in the de-emphasis hue, the latest month as an
 * 8px accent dot, gaps where a month had nothing to count. Hover (or focus) shows the month and
 * value; the dashboard's drill-down table is the table view.
 */
export function KpiSparkline({ def, points, width = 112, height = 32 }: { def: Pick<KpiDefinition, "unit">; points: KpiTrendPoint[]; width?: number; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <span className="text-[10px] text-slate-400">Trend after two months of snapshots</span>;
  const values = points.map((p) => p.value).filter((v): v is number => v !== null);
  const max = def.unit === "PERCENT" ? 100 : Math.max(1, ...values);
  const pad = 5;
  const x = (i: number) => pad + (i * (width - pad * 2)) / (points.length - 1);
  const y = (v: number) => height - pad - (v / max) * (height - pad * 2);
  // Segments between consecutive months that both have a value.
  const segments: string[] = [];
  let current = "";
  points.forEach((p, i) => {
    if (p.value === null) {
      if (current) segments.push(current);
      current = "";
      return;
    }
    current += `${current ? "L" : "M"}${x(i).toFixed(1)},${y(p.value).toFixed(1)}`;
  });
  if (current) segments.push(current);
  const lastIndex = points.length - 1 - [...points].reverse().findIndex((p) => p.value !== null);
  const shown = hover ?? null;

  return (
    <div className="relative inline-block" onMouseLeave={() => setHover(null)}>
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`Monthly trend: ${points.map((p) => `${monthLabel(p.periodStart)} ${formatKpiValue(def, p.value)}`).join(", ")}`}
        className="overflow-visible"
      >
        <line x1={pad} x2={width - pad} y1={height - pad} y2={height - pad} stroke="var(--kpi-grid, #e2e8f0)" strokeWidth={1} />
        {segments.map((d) => (
          <path key={d} d={d} fill="none" stroke="var(--kpi-trend, #94a3b8)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
        ))}
        {points.map((p, i) =>
          p.value === null ? null : (
            <circle
              key={p.periodStart}
              cx={x(i)}
              cy={y(p.value)}
              r={i === lastIndex ? 4 : hover === i ? 3 : 0}
              fill={i === lastIndex ? "var(--kpi-accent, rgb(var(--color-brand-primary)))" : "var(--kpi-trend, #94a3b8)"}
              stroke="var(--kpi-surface, #fff)"
              strokeWidth={i === lastIndex ? 2 : 0}
            />
          )
        )}
        {/* Hit targets wider than the marks. */}
        {points.map((p, i) => (
          <rect
            key={`hit-${p.periodStart}`}
            x={x(i) - (width - pad * 2) / (points.length - 1) / 2}
            y={0}
            width={(width - pad * 2) / (points.length - 1)}
            height={height}
            fill="transparent"
            tabIndex={0}
            onMouseEnter={() => setHover(i)}
            onFocus={() => setHover(i)}
            onBlur={() => setHover(null)}
          />
        ))}
      </svg>
      {shown !== null && (
        <div
          className="pointer-events-none absolute z-10 -top-8 whitespace-nowrap rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-medium text-white shadow"
          style={{ left: Math.min(Math.max(x(shown) - 40, -20), width - 60) }}
        >
          {monthLabel(points[shown].periodStart)}: {formatKpiValue(def, points[shown].value)}
        </div>
      )}
    </div>
  );
}
