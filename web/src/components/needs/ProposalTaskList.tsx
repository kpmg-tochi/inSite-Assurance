import React from "react";
import { Ban, CheckCircle2, Circle, MinusCircle } from "lucide-react";
import type { NeedsProposalTask } from "@insite/shared";

/**
 * Needs pipeline wave 2 (C5) and wave 3 (C4): the proposal's tasks as the server computes them, in
 * the GOV.UK task list pattern: one row per task (active verb), a status tag on the right (icon +
 * words). The viewer's own open tasks are highlighted and marked "For you".
 */

const TAG: Record<NeedsProposalTask["status"], { label: string; icon: React.ComponentType<{ className?: string }>; cls: string }> = {
  TODO: { label: "To do", icon: Circle, cls: "border-brand-primary/30 bg-brand-primary/5 text-brand-primary" },
  DONE: { label: "Completed", icon: CheckCircle2, cls: "border-emerald-200 bg-emerald-50 text-emerald-800" },
  BLOCKED: { label: "Cannot start yet", icon: Ban, cls: "border-slate-200 bg-slate-100 text-slate-600" },
  NOT_NEEDED: { label: "Not needed", icon: MinusCircle, cls: "border-slate-200 bg-white text-slate-500" },
};

export function ProposalTaskList({ tasks }: { tasks: NeedsProposalTask[] }) {
  const mineOpen = tasks.filter((t) => t.mine && t.status === "TODO").length;
  return (
    <section aria-labelledby="proposal-tasks" className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="proposal-tasks" className="text-sm font-bold text-slate-900">
          Tasks
        </h3>
        {tasks.length > 0 && (
          <p className="text-[11px] text-slate-600">
            {mineOpen > 0 ? `${mineOpen} for you` : "Nothing for you right now"} · {tasks.filter((t) => t.status === "DONE").length} of{" "}
            {tasks.filter((t) => t.status !== "NOT_NEEDED").length} completed
          </p>
        )}
      </div>
      {tasks.length === 0 ? (
        <p className="mt-1 text-xs text-slate-500">Nothing to do on this proposed project at its current stage.</p>
      ) : (
        <ul className="mt-2 divide-y divide-slate-100 border-y border-slate-100">
          {tasks.map((t) => {
            const tag = TAG[t.status];
            const Icon = tag.icon;
            const forYou = t.mine && t.status === "TODO";
            return (
              <li
                key={t.key}
                className={`flex flex-wrap items-center justify-between gap-2 py-2 ${forYou ? "-mx-2 rounded-lg bg-brand-primary/[0.06] px-2" : ""}`}
              >
                <span className={`text-xs ${t.status === "NOT_NEEDED" ? "text-slate-500" : "font-semibold text-slate-900"}`}>
                  {t.label}
                  {forYou && <span className="ml-2 text-[11px] font-semibold text-brand-primary">For you</span>}
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
