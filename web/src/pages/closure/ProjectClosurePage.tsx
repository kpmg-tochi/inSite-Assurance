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
import { CompletionSection } from "../../components/closure/CompletionSection";

/** Who sees the Closure tab (the panels hide what the caller cannot use). */
export const CLOSURE_VIEW_PERMISSIONS = [
  // The certificate's drafters and signatories (often organisation admins without handover permissions).
  "completion:draft_certificate",
  "completion:sign_certificate",
  "completion:revoke_certificate",
  "closure:manage_checklist",
  "closure:audit_signoff",
  "closure:export_pack",
  "contractors:rate_performance",
  "lessons:manage",
  "lessons:view",
];

function stageFor(phase: string): LessonStage {
  if (phase === "HANDOVER_IN_PROGRESS") return "HANDOVER";
  if (phase === "RETENTION_PERIOD") return "LIABILITY_PERIOD";
  if (phase === "COMPLETED_CLOSED") return "POST_CLOSURE";
  return "CONSTRUCTION";
}

/**
 * Phase 15 project "Closure" tab: the Certificate of Completion (also shown on the Handover tab
 * when that module is on), the closure checklist (before closing, before archiving), contractor
 * ratings, lessons learned and the closure pack export.
 */
export function ProjectClosurePage({ project }: { project: ProjectSummaryDto }) {
  const { hasPermission } = useAuth();
  // Contractors reach this page from a "lesson shared" notification: they see the shared lessons only.
  const team = CLOSURE_VIEW_PERMISSIONS.some((k) => hasPermission(k));
  const checklist = useClosureChecklistQuery(project.id, team);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-bold text-slate-900">Closure</h1>
        <p className="text-xs text-slate-500">
          {project.codePrefix} · {CONSTRUCTION_PHASE_LABELS[project.constructionPhase]}
          {project.status === "ARCHIVED" ? " · archived" : ""} · what must be done before the project is closed and archived.
        </p>
      </div>
      <CompletionSection projectId={project.id} />
      {team && (checklist.isLoading ? <Loader /> : checklist.data && <ClosureChecklistPanel projectId={project.id} checklist={checklist.data} />)}
      <ContractorRatingsPanel projectId={project.id} />
      <LessonsPanel projectId={project.id} defaultStage={stageFor(project.constructionPhase)} />
      {hasPermission("closure:export_pack") && <ClosurePackPanel projectId={project.id} />}
    </div>
  );
}
