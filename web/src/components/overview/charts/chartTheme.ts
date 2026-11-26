import { useEffect, useState } from "react";
import type { ApexOptions } from "apexcharts";

/**
 * Design round 2026-11-26: the Overview dashboard's chart colours and shared ApexCharts options.
 *
 * Categorical slots (identity), validated with the dataviz skill's validator (light mode, white
 * panel surface): 1 green #007a5c, 2 amber #d97706, 3 blue #2a78d6, 4 red #c0262d. Slot 1 is UBEC
 * deep green #00715D snapped to the nearest step that clears the chroma floor (0.093 → 0.10, same
 * hue). Worst adjacent CVD ΔE 11.0, normal-vision ΔE 26.4, all ≥ 3:1 on white. The same four hues in
 * the order green, blue, amber, red (the monitoring visit stack) also pass every check.
 * Planned values are a reference, not a series: slate ink, dashed on the line chart. Neutrals mean
 * "not yet" (upcoming, remaining) and are never the only carrier of meaning: every chart has a
 * legend with words and a table view.
 */
export const CHART_COLORS = {
  green: "#007a5c",
  amber: "#d97706",
  blue: "#2a78d6",
  red: "#c0262d",
  /** Verification late (serious): between amber and red, always with its label. */
  orange: "#c2410c",
  /** Planned / target marks. */
  reference: "#334155",
  /** Upcoming, remaining. */
  neutral: "#cbd5e1",
  /** Ended, not verified yet. */
  neutralDark: "#94a3b8",
} as const;

export const CHART_FONT = 'Inter, system-ui, -apple-system, "Segoe UI", sans-serif';
/** slate-500 on white: 4.76:1. */
export const AXIS_TEXT = "#64748b";
export const LABEL_TEXT = "#334155";
export const GRID_LINE = "#e2e8f0";

export function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(query);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === "object" && v !== null && !Array.isArray(v);

function merge(base: Plain, extra: Plain): Plain {
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(extra)) {
    out[k] = isPlain(v) && isPlain(out[k]) ? merge(out[k] as Plain, v) : v;
  }
  return out;
}

/** The look every Overview chart shares: app font, no toolbar or zoom, recessive grid, no Apex legend (ours is HTML). */
export function chartOptions(reducedMotion: boolean, extra: ApexOptions): ApexOptions {
  const base: ApexOptions = {
    chart: {
      fontFamily: CHART_FONT,
      foreColor: AXIS_TEXT,
      toolbar: { show: false },
      zoom: { enabled: false },
      selection: { enabled: false },
      animations: { enabled: !reducedMotion },
      parentHeightOffset: 0,
      redrawOnParentResize: true,
    },
    grid: {
      borderColor: GRID_LINE,
      strokeDashArray: 0,
      padding: { left: 4, right: 12, top: 0, bottom: 0 },
    },
    legend: { show: false },
    dataLabels: { enabled: false },
    tooltip: { theme: "light", style: { fontFamily: CHART_FONT, fontSize: "12px" } },
    states: { active: { filter: { type: "none" } } },
  };
  return merge(base as Plain, extra as Plain) as ApexOptions;
}

/** Tooltip HTML is built from strings: every label goes through this. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

/** One tooltip: a heading, then rows led by the value (strong) and keyed by a short line of the series colour. */
export function tooltipHtml(heading: string, rows: Array<{ color?: string; dashed?: boolean; value: string; label: string }>, note?: string): string {
  const row = (r: (typeof rows)[number]) => {
    const key = r.color
      ? `<span style="display:inline-block;width:12px;height:0;border-top:2px ${r.dashed ? "dashed" : "solid"} ${r.color};margin-right:6px;vertical-align:middle"></span>`
      : "";
    return `<div style="display:flex;align-items:center;gap:2px;margin-top:3px">${key}<strong style="color:#0f172a;font-weight:600">${escapeHtml(r.value)}</strong><span style="color:#475569;margin-left:6px">${escapeHtml(r.label)}</span></div>`;
  };
  return `<div style="padding:8px 10px;font-family:${CHART_FONT.replace(/"/g, "'")};font-size:12px;line-height:1.35;max-width:280px;white-space:normal"><div style="color:#334155;font-weight:600">${escapeHtml(heading)}</div>${rows.map(row).join("")}${
    note ? `<div style="color:#475569;margin-top:4px">${escapeHtml(note)}</div>` : ""
  }</div>`;
}
