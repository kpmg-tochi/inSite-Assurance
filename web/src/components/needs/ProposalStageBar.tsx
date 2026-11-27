import React from "react";
import { CheckCircle2, Circle, CircleDot } from "lucide-react";
import { NEEDS_STAGE_LABELS, type NeedsPipelineConfig, type NeedsProposalStatus, type NeedsStage } from "@insite/shared";

/**
 * Needs pipeline wave 2 (C5): the cycle's stages in order, the proposal's current one highlighted.
 * Earlier stages read "Done"; a proposal that became a project has every stage done. Wraps on a phone.
 */
export function ProposalStageBar({
  stages,
  current,
  status,
}: {
  stages: NeedsPipelineConfig["stages"];
  current: NeedsStage;
  status: NeedsProposalStatus;
}) {
  const list = stages.length > 0 ? stages : [{ stage: current, label: NEEDS_STAGE_LABELS[current], actorPermissionKey: null, deadline: null }];
  const currentIndex = list.findIndex((s) => s.stage === current);
  const allDone = status === "CONVERTED";
  const stopped = status === "NOT_VALIDATED" || status === "NOT_SELECTED" || status === "WITHDRAWN" || status === "MERGED";

  return (
    <nav aria-label="Stages" className="rounded-2xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
      <ol className="flex flex-wrap gap-x-1 gap-y-2">
        {list.map((s, i) => {
          const state = allDone || i < currentIndex ? "done" : i === currentIndex ? "current" : "later";
          const Icon = state === "done" ? CheckCircle2 : state === "current" ? CircleDot : Circle;
          return (
            <li key={s.stage} className="flex items-center gap-1" aria-current={state === "current" ? "step" : undefined}>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                  state === "current"
                    ? stopped
                      ? "bg-slate-200 text-slate-800"
                      : "bg-brand-primary text-white"
                    : state === "done"
                      ? "text-emerald-800"
                      : "text-slate-500"
                }`}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {s.label}
                <span className="sr-only">{state === "done" ? " (done)" : state === "current" ? (stopped ? " (stopped here)" : " (current stage)") : " (later)"}</span>
              </span>
              {i < list.length - 1 && (
                <span className="text-slate-300" aria-hidden="true">
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
