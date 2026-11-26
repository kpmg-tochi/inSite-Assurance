/**
 * WEB-DEMO1-09: a slim % complete bar for the BoQ & work phases page (units, lines, project).
 * The figure is always written out beside the bar, and "Complete" at 100%, so the status never
 * rests on colour. The bar carries the accessible name and value.
 */

/** "96%", "86.8%": one decimal only when there is one. */
export function formatProgressPct(pct: number): string {
  const v = Math.round(Math.min(100, Math.max(0, pct)) * 10) / 10;
  return `${Number.isInteger(v) ? v.toFixed(0) : v.toFixed(1)}%`;
}

export function ProgressMeter({
  pct,
  label,
  size = "sm",
  showText = true,
  className = "",
}: {
  pct: number;
  /** Accessible name, e.g. "U01 Classroom block % complete". */
  label: string;
  size?: "sm" | "lg";
  /** False when the figure is already written next to the bar (e.g. a large heading). */
  showText?: boolean;
  className?: string;
}) {
  const v = Math.min(100, Math.max(0, pct));
  const done = v >= 100;
  const text = done ? "100% · Complete" : formatProgressPct(v);
  return (
    <div className={`flex min-w-0 items-center gap-2 ${className}`}>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(v * 10) / 10}
        aria-valuetext={text}
        className={`${size === "lg" ? "h-2" : "h-1.5"} min-w-[3rem] flex-1 overflow-hidden rounded-full bg-slate-200`}
      >
        <div className={`h-full rounded-full ${done ? "bg-emerald-600" : "bg-brand-primary"}`} style={{ width: `${v}%` }} />
      </div>
      {showText && (
        <span aria-hidden="true" className={`shrink-0 tabular-nums font-semibold ${size === "lg" ? "text-sm" : "text-xs"} ${done ? "text-emerald-700" : "text-slate-800"}`}>
          {text}
        </span>
      )}
    </div>
  );
}
