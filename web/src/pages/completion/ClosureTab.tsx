import React from "react";
import { CONSTRUCTION_PHASE_LABELS, type LessonStage } from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import Loader from "../../components/Loader";
import { useAuth } from "../../lib/auth-context";
import { useClosureChecklistQuery } from "../../queries/closure/useClosureQueries";
import { ClosureChecklistPanel } from "../../components/closure/ClosureChecklistPanel";
import { ContractorRatingsPanel } from "../../components/closure/ContractorRatingsPanel";
import { LessonsPanel } from "../../components/closure/LessonsPanel";
import { ClosurePackPanel } from "../../components/closure/ClosurePackPanel";

function stageFor(phase: string): LessonStage {
  if (phase === "HANDOVER_IN_PROGRESS") return "HANDOVER";
  if (phase === "RETENTION_PERIOD") return "LIABILITY_PERIOD";
  if (phase === "COMPLETED_CLOSED") return "POST_CLOSURE";
  return "CONSTRUCTION";
}

/**
 * Phase 15, Completion & handover → Closure (redesign R6b, D-R6.16): the closure checklist (before
 * closing, before archiving), contractor ratings, lessons learned and the closure pack export. The
 * Certificate of Completion has its own tab. Shown to CLOSURE_VIEW_PERMISSIONS; panels hide what the
 * caller cannot use.
 */
export function ClosureTab({ project }: { project: ProjectSummaryDto }) {
  const { hasPermission } = useAuth();
  const checklist = useClosureChecklistQuery(project.id, true);
  return (
    <div className="space-y-5">
      <p className="text-xs text-slate-500">
        {CONSTRUCTION_PHASE_LABELS[project.constructionPhase]}
        {project.status === "ARCHIVED" ? " · archived" : ""} · what must be done before the project is closed and archived.
      </p>
      {checklist.isLoading ? <Loader /> : checklist.data && <ClosureChecklistPanel projectId={project.id} checklist={checklist.data} />}
      <ContractorRatingsPanel projectId={project.id} readOnly={project.status === "ARCHIVED"} />
      <LessonsPanel projectId={project.id} defaultStage={stageFor(project.constructionPhase)} readOnly={project.status === "ARCHIVED"} />
      {hasPermission("closure:export_pack") && <ClosurePackPanel projectId={project.id} />}
    </div>
  );
}
