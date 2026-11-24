import type { ProjectStage, ProjectStageState } from "@insite/shared";
import { Check, Circle, CircleDot, Minus } from "lucide-react";
import { formatDateShort } from "../../lib/formatters";

const STATE_TEXT: Record<ProjectStageState, string> = {
  DONE: "Done",
  CURRENT: "Current stage",
  UPCOMING: "Upcoming",
  NOT_TRACKED: "Not tracked",
};

const STATE_STYLE: Record<ProjectStageState, { box: string; icon: string; label: string }> = {
  DONE: { box: "border-emerald-200 bg-emerald-50/60", icon: "bg-emerald-600 text-white", label: "text-emerald-800" },
  CURRENT: { box: "border-brand-primary bg-brand-primary/5 ring-1 ring-brand-primary", icon: "bg-brand-primary text-white", label: "text-brand-primary" },
  UPCOMING: { box: "border-slate-200 bg-white", icon: "bg-slate-100 text-slate-500", label: "text-slate-500" },
  NOT_TRACKED: { box: "border-dashed border-slate-300 bg-slate-50", icon: "bg-slate-100 text-slate-400", label: "text-slate-500" },
};

function StateIcon({ state }: { state: ProjectStageState }) {
  const cls = "h-3.5 w-3.5";
  if (state === "DONE") return <Check className={cls} aria-hidden="true" />;
  if (state === "CURRENT") return <CircleDot className={cls} aria-hidden="true" />;
  if (state === "NOT_TRACKED") return <Minus className={cls} aria-hidden="true" />;
  return <Circle className={cls} aria-hidden="true" />;
}

/**
 * Redesign R6c (D-R6.19): Kick-off → Mobilisation → Construction → Completion → Closure. An ordered
 * list; every stage states its state in text (never colour alone) and the current one carries
 * `aria-current="step"`. A row from `md` up, a vertical list below.
 */
export function ProjectStageBar({ stage }: { stage: ProjectStage }) {
  return (
    <ol className="flex flex-col gap-2 md:flex-row md:items-stretch" aria-label="Project stages">
      {stage.stages.map((s, i) => {
        const style = STATE_STYLE[s.state];
        const terminated = s.state === "CURRENT" && stage.flags.contractTerminated;
        const rawNote = terminated ? s.note?.replace(/\s*·?\s*Contract terminated$/, "") || null : s.note;
        const note = rawNote && rawNote !== STATE_TEXT[s.state] ? rawNote : null;
        return (
          <li
            key={s.key}
            aria-current={s.state === "CURRENT" ? "step" : undefined}
            className={`flex min-w-0 flex-1 items-start gap-2.5 rounded-xl border px-3 py-2.5 ${style.box}`}
          >
            <span className={`mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${style.icon}`}>
              <StateIcon state={s.state} />
            </span>
            <span className="min-w-0 space-y-0.5">
              <span className="block text-xs font-bold text-slate-900">
                <span className="sr-only">Stage {i + 1} of {stage.stages.length}: </span>
                {s.label}
              </span>
              <span className={`block text-[11px] font-semibold ${style.label}`}>
                {STATE_TEXT[s.state]}
                {s.enteredAt && s.state !== "UPCOMING" ? ` · ${s.state === "DONE" ? "started" : "since"} ${formatDateShort(s.enteredAt)}` : ""}
              </span>
              {note && <span className="block text-[11px] text-slate-600">{note}</span>}
              {terminated && <span className="block text-[11px] font-semibold text-red-700">Contract terminated</span>}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
