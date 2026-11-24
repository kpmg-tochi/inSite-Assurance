import React from "react";
import { CONSTRUCTION_PHASE_LABELS } from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import Loader from "../../components/Loader";
import { useAuth } from "../../lib/auth-context";
import { useClosureChecklistQuery } from "../../queries/closure/useClosureQueries";
import { ClosureChecklistPanel } from "../../components/closure/ClosureChecklistPanel";
import { ContractorRatingsPanel } from "../../components/closure/ContractorRatingsPanel";
import { CloseoutReportCard } from "../../components/closure/CloseoutReport";
import { ClosurePackPanel } from "../../components/closure/ClosurePackPanel";

/**
 * Phase 15, Completion & handover → Closure (redesign R6b, D-R6.16): the closure checklist (before
 * closing, before archiving), contractor ratings, the closeout report and the closure pack export.
 * UBEC: the closeout report (a CLOSEOUT_REPORT register document) replaces lessons learned on the
 * project; `components/closure/LessonsPanel.tsx` stays on disk, unused here. The Certificate of
 * Completion has its own tab. Shown to CLOSURE_VIEW_PERMISSIONS; panels hide what the caller cannot use.
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
      {checklist.isLoading ? (
        <Loader />
      ) : checklist.isError ? (
        <p className="text-xs text-rose-700">The closure checklist could not be loaded.</p>
      ) : (
        checklist.data && <ClosureChecklistPanel projectId={project.id} checklist={checklist.data} />
      )}
      <CloseoutReportCard project={project} />
      <ContractorRatingsPanel projectId={project.id} readOnly={project.status === "ARCHIVED"} />
      {hasPermission("closure:export_pack") && <ClosurePackPanel projectId={project.id} />}
    </div>
  );
}
