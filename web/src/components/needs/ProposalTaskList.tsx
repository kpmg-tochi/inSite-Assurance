import React from "react";
import { Ban, CheckCircle2, Circle, MinusCircle } from "lucide-react";
import type { NeedsProposalTask } from "@insite/shared";

/**
 * Needs pipeline wave 2 (C5): the proposal's tasks in the GOV.UK task list pattern: one row per task
 * (active verb), a status tag on the right (icon + words), "For you" on the viewer's own tasks.
 */

const TAG: Record<NeedsProposalTask["status"], { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  TODO: { label: "To do", icon: Circle, cls: "border-brand-primary/30 bg-brand-primary/5 text-brand-primary" },
  DONE: { label: "Completed", icon: CheckCircle2, cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  BLOCKED: { label: "Cannot start yet", icon: Ban, cls: "border-slate-200 bg-slate-100 text-slate-600" },
  NOT_NEEDED: { label: "Not needed", icon: MinusCircle, cls: "border-slate-200 bg-white text-slate-500" },
};

export function ProposalTaskList({ tasks }: { tasks: NeedsProposalTask[] }) {
  return (
    <section aria-labelledby="proposal-tasks" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 id="proposal-tasks" className="text-sm font-bold text-slate-900">
        Tasks
      </h3>
      {tasks.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">Nothing to do on this proposed project at its current stage.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 border-y border-slate-100">
          {tasks.map((t) => {
            const tag = TAG[t.status];
            const Icon = tag.icon;
            return (
              <li key={t.key} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className={`text-xs ${t.status === "NOT_NEEDED" ? "text-slate-500" : "font-semibold text-slate-900"}`}>
                  {t.label}
                  {t.mine && t.status === "TODO" && <span className="ml-2 text-[11px] font-semibold text-brand-primary">For you</span>}
                </span>
                <span className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tag.cls}`}>
                  <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
                  {tag.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
