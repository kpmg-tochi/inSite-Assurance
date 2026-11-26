import { useId, type ReactNode } from "react";
import { TAB_LIST_CLASS, tabItemClass } from "../../common/Tabs";

export const PANEL_CLASS = "rounded-2xl border border-slate-200/80 bg-white shadow-sm";

export interface ChartTable {
  caption: string;
  columns: string[];
  rows: Array<Array<ReactNode>>;
}

/**
 * A dashboard panel: title (sentence case), a one-line subtitle saying what is measured, optional
 * controls on the right, the chart, its legend, and a "View as table" disclosure (the chart's text
 * alternative, reachable by keyboard and screen readers).
 */
export function ChartPanel({
  title,
  subtitle,
  actions,
  legend,
  table,
  footer,
  className = "",
  children,
}: {
  title: string;
  subtitle: ReactNode;
  actions?: ReactNode;
  legend?: ReactNode;
  table?: ChartTable | null;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const headingId = useId();
  return (
    <section className={`${PANEL_CLASS} flex min-w-0 flex-col p-4 sm:p-5 ${className}`} aria-labelledby={headingId}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <div className="min-w-0">
          <h2 id={headingId} className="text-sm font-semibold text-slate-900">
            {title}
          </h2>
          <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>
        </div>
        {actions}
      </div>
      {legend && <div className="mt-3">{legend}</div>}
      <div className="mt-2 min-w-0">{children}</div>
      {footer && <div className="mt-3">{footer}</div>}
      {table && table.rows.length > 0 && <TableDisclosure table={table} />}
    </section>
  );
}

function TableDisclosure({ table }: { table: ChartTable }) {
  return (
    <details className="group mt-3 border-t border-slate-100 pt-2">
      <summary className="w-fit cursor-pointer rounded text-xs font-semibold text-brand-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary">
        View as table
      </summary>
      <div className="mt-2 max-h-72 overflow-auto">
        <table className="min-w-full text-left text-xs">
          <caption className="sr-only">{table.caption}</caption>
          <thead>
            <tr className="border-b border-slate-200">
              {table.columns.map((c, i) => (
                <th key={c} scope="col" className={`whitespace-nowrap py-1.5 pr-3 font-semibold text-slate-600 ${i > 0 ? "text-right" : ""}`}>
                  {c}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {table.rows.map((row, r) => (
              <tr key={r} className="border-b border-slate-100 last:border-0">
                {row.map((cell, i) =>
                  i === 0 ? (
                    <th key={i} scope="row" className="py-1.5 pr-3 font-medium text-slate-800">
                      {cell}
                    </th>
                  ) : (
                    <td key={i} className="whitespace-nowrap py-1.5 pr-3 text-right tabular-nums text-slate-700">
                      {cell}
                    </td>
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

export interface LegendItem {
  label: string;
  color: string;
  /** line: a 2px stroke (line series); dash: a dashed stroke (planned); rect: a filled swatch (bars); marker: a short vertical tick (target marker). */
  kind: "line" | "dash" | "rect" | "marker";
}

/** The chart's legend: a key that mirrors the mark, then the name in text ink (never the series colour). */
export function ChartLegend({ items, extra }: { items: LegendItem[]; extra?: ReactNode }) {
  return (
    <ul className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
      {items.map((item) => (
        <li key={item.label} className="inline-flex items-center gap-1.5">
          <LegendKey item={item} />
          {item.label}
        </li>
      ))}
      {extra}
    </ul>
  );
}

function LegendKey({ item }: { item: LegendItem }) {
  if (item.kind === "rect") return <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: item.color }} aria-hidden="true" />;
  if (item.kind === "marker") return <span className="h-3 w-[3px] shrink-0 rounded-full" style={{ background: item.color }} aria-hidden="true" />;
  return (
    <svg width="16" height="6" viewBox="0 0 16 6" className="shrink-0" aria-hidden="true">
      <line x1="1" y1="3" x2="15" y2="3" stroke={item.color} strokeWidth="2" strokeLinecap="round" strokeDasharray={item.kind === "dash" ? "4 3" : undefined} />
    </svg>
  );
}

/** "Nothing yet" inside a panel. */
export function ChartEmpty({ children, height = 120 }: { children: ReactNode; height?: number }) {
  return (
    <div style={{ minHeight: height }} className="flex items-center justify-center rounded-xl border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-slate-500">
      <div>{children}</div>
    </div>
  );
}

/** A segmented control (not tabs: it changes the chart in place). */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<{ id: T; label: string }>;
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className={TAB_LIST_CLASS}>
      {options.map((o) => {
        const selected = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={selected}
            onClick={() => onChange(o.id)}
            className={tabItemClass(selected)}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
