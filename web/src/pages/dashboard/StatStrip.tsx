import React from "react";

export interface Stat {
  key: string;
  label: string;
  value: React.ReactNode;
  detail?: React.ReactNode;
  /** "alert" colours the value when it needs attention (always with words in `detail`, never colour alone). */
  tone?: "default" | "alert";
  /** When set, the cell is a button (e.g. filter the projects table). */
  onSelect?: () => void;
  selected?: boolean;
}

/** Literal class names so Tailwind keeps them. */
const LG_COLS: Record<number, string> = { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-4" };

/**
 * The home page's headline figures: one panel split into cells, so four numbers read as one
 * summary rather than four competing cards. Cells with `onSelect` filter the table below.
 */
export function StatStrip({ stats, label }: { stats: Stat[]; label: string }) {
  return (
    <section aria-label={label} className="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden">
      <ul className={`grid grid-cols-2 ${LG_COLS[Math.min(4, Math.max(1, stats.length))]}`}>
        {stats.map((s, i) => {
          const lastOfOdd = stats.length % 2 === 1 && i === stats.length - 1;
          const borders = [
            lastOfOdd ? "col-span-2 lg:col-span-1" : i % 2 === 0 ? "border-r" : "",
            i < 2 ? "border-b lg:border-b-0" : "",
            i < stats.length - 1 ? "lg:border-r" : "lg:border-r-0",
          ].join(" ");
          const body = (
            <>
              <span className="block text-xs font-medium text-slate-600">{s.label}</span>
              <span className={`mt-1 block text-2xl font-bold tracking-tight tabular-nums ${s.tone === "alert" ? "text-rose-700" : "text-slate-900"}`}>
                {s.value}
              </span>
              {s.detail && <span className="mt-0.5 block text-xs text-slate-500">{s.detail}</span>}
            </>
          );
          return (
            <li key={s.key} className={`min-w-0 border-slate-100 ${borders}`}>
              {s.onSelect ? (
                <button
                  type="button"
                  onClick={s.onSelect}
                  aria-pressed={s.selected}
                  title={s.selected ? "Showing these projects in the table. Select again to show all." : "Show these projects in the table"}
                  className={`w-full h-full text-left px-5 py-4 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-primary ${
                    s.selected ? "bg-brand-primary/[0.06]" : "hover:bg-slate-50"
                  }`}
                >
                  {body}
                </button>
              ) : (
                <div className="px-5 py-4">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
