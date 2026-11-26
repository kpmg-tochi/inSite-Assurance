import React, { useId, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

/**
 * Completion & handover page (design round 2026-11-26): the building blocks every tab shares, so the
 * four tabs read alike. One white panel per area, a status header (state + the one next action),
 * collapsible sub-sections instead of a long scroll of boxes, and a horizontal stage progress.
 */

export const panelClass = "rounded-2xl border border-slate-200 bg-white p-5";
export const primaryAction =
  "inline-flex items-center gap-1.5 rounded-xl bg-brand-primary px-3.5 py-2 text-xs font-semibold text-white shadow-sm hover:bg-brand-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";
export const secondaryAction =
  "inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";
export const linkAction =
  "inline-flex items-center gap-1 rounded font-semibold text-brand-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary";

/**
 * The top of a tab: an icon, the title, one status line (what state it is in) and at most one short
 * help line; the next action on the right (below on small screens).
 */
export function StatusHeader({
  icon,
  title,
  titleId,
  status,
  help,
  actions,
}: {
  icon: React.ReactNode;
  title: string;
  titleId?: string;
  status?: React.ReactNode;
  help?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-primary/10 text-brand-primary" aria-hidden="true">
          {icon}
        </span>
        <div className="min-w-0">
          <h2 id={titleId} className="text-base font-bold text-slate-900">
            {title}
          </h2>
          {status && <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-slate-700">{status}</div>}
          {help && <p className="mt-1 text-xs text-slate-500">{help}</p>}
        </div>
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div>}
    </div>
  );
}

/** A "·" between items of a status line. */
export const Dot = () => (
  <span className="text-slate-400" aria-hidden="true">
    ·
  </span>
);

/**
 * A sub-section that opens and closes (native details/summary: keyboard and screen readers get it
 * for free). The hint after the title says its state while it is closed.
 */
export function CollapsibleSection({
  id,
  title,
  hint,
  defaultOpen = false,
  children,
}: {
  id?: string;
  title: string;
  hint?: React.ReactNode;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details id={id} open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className="group rounded-2xl border border-slate-200 bg-white">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 py-4 hover:bg-slate-50/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-primary [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-bold text-slate-900">{title}</span>
          {hint && <span className="mt-0.5 block text-xs text-slate-600">{hint}</span>}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-500 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      <div className="border-t border-slate-100 px-5 py-4">{children}</div>
    </details>
  );
}

export type StageState = "done" | "current" | "todo";

/**
 * A horizontal progress of a few stages (Draft → Signatures → Issued). Each stage has a number or a
 * tick and its state in words for screen readers, so the state never rests on colour alone.
 */
export function StageProgress({ label, stages }: { label: string; stages: { label: string; detail?: string; state: StageState }[] }) {
  const id = useId();
  return (
    <ol aria-label={label} className="flex flex-wrap items-center gap-y-2">
      {stages.map((s, i) => (
        <li key={`${id}-${s.label}`} className="flex items-center">
          {i > 0 && <span className={`mx-2 h-px w-6 sm:w-12 ${s.state === "todo" ? "bg-slate-300" : "bg-brand-primary"}`} aria-hidden="true" />}
          <span className="inline-flex items-center gap-2">
            <span
              aria-hidden="true"
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold tabular-nums ${
                s.state === "done"
                  ? "bg-brand-primary text-white"
                  : s.state === "current"
                    ? "border-2 border-brand-primary bg-white text-brand-primary"
                    : "border border-slate-300 bg-white text-slate-500"
              }`}
            >
              {s.state === "done" ? <Check className="h-3.5 w-3.5" strokeWidth={3} /> : i + 1}
            </span>
            <span className="leading-tight">
              <span className={`block text-xs font-semibold ${s.state === "todo" ? "text-slate-500" : "text-slate-900"}`}>{s.label}</span>
              {s.detail && <span className="block text-[11px] text-slate-600">{s.detail}</span>}
              <span className="sr-only">{s.state === "done" ? " (done)" : s.state === "current" ? " (current)" : " (not yet)"}</span>
            </span>
          </span>
        </li>
      ))}
    </ol>
  );
}

/** A thin progress bar with "n of m" (the text carries the value). */
export function ProgressBar({ done, total, label }: { done: number; total: number; label?: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <span className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700">
      {label && <span className="font-normal text-slate-600">{label}</span>}
      <span className="h-1.5 w-20 overflow-hidden rounded-full bg-slate-100" aria-hidden="true">
        <span className="block h-full rounded-full bg-brand-primary" style={{ width: `${pct}%` }} />
      </span>
      <span className="tabular-nums">
        {done} of {total}
      </span>
    </span>
  );
}
