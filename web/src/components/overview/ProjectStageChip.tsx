import { projectStageChipLabel, type ProjectStageSummary } from "@insite/shared";

const TONE: Record<ProjectStageSummary["current"], string> = {
  KICKOFF: "bg-sky-50 text-sky-800 ring-sky-200",
  MOBILISATION: "bg-amber-50 text-amber-800 ring-amber-200",
  CONSTRUCTION: "bg-indigo-50 text-indigo-800 ring-indigo-200",
  COMPLETION: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  CLOSURE: "bg-slate-100 text-slate-700 ring-slate-300",
};

/** Redesign R6 (D-R6.20, D-R6.22): the stage as text, never colour alone. */
export function ProjectStageChip({ stage, className = "" }: { stage: ProjectStageSummary | null | undefined; className?: string }) {
  if (!stage) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${TONE[stage.current]} ${className}`}
    >
      <span className="sr-only">Stage: </span>
      {projectStageChipLabel(stage)}
      {stage.contractTerminated && <span className="font-semibold text-red-700"> · Contract terminated</span>}
    </span>
  );
}
