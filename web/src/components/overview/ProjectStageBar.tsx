import type { ProjectStage, ProjectStageEntry, ProjectStageState } from "@insite/shared";
import { Check, Minus } from "lucide-react";
import { formatDateShort } from "../../lib/formatters";

/** Read out with every stage, so the state never depends on colour or shape alone. */
const STATE_TEXT: Record<ProjectStageState, string> = {
  DONE: "Done",
  CURRENT: "Current stage",
  UPCOMING: "Upcoming",
  NOT_TRACKED: "Not tracked",
};

const reached = (state: ProjectStageState) => state === "DONE" || state === "CURRENT";

/** The line under the stage name: when it started, or why there is no date. */
function dateLine(s: ProjectStageEntry): string | null {
  if (s.state === "NOT_TRACKED") return "Not tracked";
  if (s.state === "UPCOMING") return null;
  if (!s.enteredAt) return s.state === "DONE" ? "Done" : null;
  return `${s.state === "CURRENT" ? "Since" : "From"} ${formatDateShort(s.enteredAt)}`;
}

function Checkpoint({ state }: { state: ProjectStageState }) {
  // Every circle sits in the same 28px box, so the line meets each centre.
  return (
    <span className="relative z-10 flex h-7 w-7 shrink-0 items-center justify-center">
      {state === "DONE" && (
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-brand-primary text-white">
          <Check className="h-3.5 w-3.5" strokeWidth={3} aria-hidden="true" />
        </span>
      )}
      {state === "CURRENT" && (
        <span className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-brand-primary bg-white ring-4 ring-brand-primary/15">
          <span className="h-3 w-3 rounded-full bg-brand-primary" />
        </span>
      )}
      {state === "UPCOMING" && <span className="h-6 w-6 rounded-full border-2 border-slate-300 bg-white" />}
      {state === "NOT_TRACKED" && (
        <span className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-dashed border-slate-300 bg-white text-slate-400">
          <Minus className="h-3 w-3" aria-hidden="true" />
        </span>
      )}
    </span>
  );
}

/**
 * Redesign R6c (D-R6.19), UBEC timeline: Kick-off → Mobilisation → Construction → Completion →
 * Closure as checkpoints on one line. Done: filled green with a check; current: a larger ring;
 * upcoming: an outline; not tracked: dashed. Under each, the name and the date it started.
 * Horizontal from `sm`, a vertical list below. An ordered list; the current stage carries
 * `aria-current="step"` and every stage states its state in text for screen readers.
 */
export function ProjectStageBar({ stage }: { stage: ProjectStage }) {
  const last = stage.stages.length - 1;
  return (
    <ol className="flex flex-col sm:flex-row" aria-label="Project stages">
      {stage.stages.map((s, i) => {
        const terminated = s.state === "CURRENT" && stage.flags.contractTerminated;
        const date = dateLine(s);
        const sub = s.state === "CURRENT" && s.key === "CLOSURE" ? stage.subLabel : null;
        const nextReached = i < last && reached(stage.stages[i + 1].state);
        return (
          <li
            key={s.key}
            aria-current={s.state === "CURRENT" ? "step" : undefined}
            className="relative flex min-w-0 flex-1 items-start gap-3 pb-4 last:pb-0 sm:flex-col sm:items-center sm:gap-0 sm:pb-0 sm:text-center"
          >
            {i < last && (
              <span
                aria-hidden="true"
                className={`absolute left-[13px] top-7 bottom-0 w-0.5 sm:left-1/2 sm:right-auto sm:top-[13px] sm:bottom-auto sm:h-0.5 sm:w-full ${
                  nextReached ? "bg-brand-primary" : "bg-slate-200"
                }`}
              />
            )}
            <Checkpoint state={s.state} />
            <span className="min-w-0 pt-1 sm:px-1 sm:pt-2">
              <span className={`block text-xs ${s.state === "CURRENT" ? "font-bold text-brand-primary" : reached(s.state) ? "font-semibold text-slate-900" : "font-semibold text-slate-500"}`}>
                <span className="sr-only">
                  Stage {i + 1} of {stage.stages.length}, {STATE_TEXT[s.state]}:{" "}
                </span>
                {s.label}
              </span>
              {sub && <span className="block text-[11px] font-semibold text-slate-700">{sub}</span>}
              {date && <span className="block text-[11px] text-slate-500">{date}</span>}
              {terminated && <span className="block text-[11px] font-semibold text-red-700">Contract terminated</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
