import React, { useState } from "react";
import { Archive, Flag } from "lucide-react";
import { CONSTRUCTION_PHASE_LABELS, type ProjectPhaseTransitionDto } from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import Loader from "../../components/Loader";
import { useAuth } from "../../lib/auth-context";
import { formatDateShort } from "../../lib/formatters";
import { StatusText } from "../../components/common/StatusText";
import { useClosureChecklistQuery } from "../../queries/closure/useClosureQueries";
import { useProjectPhaseQuery } from "../../queries/closeout/useCloseoutQueries";
import { ClosureChecklistPanel } from "../../components/closure/ClosureChecklistPanel";
import { ContractorRatingsPanel } from "../../components/closure/ContractorRatingsPanel";
import { CloseoutReportCard } from "../../components/closure/CloseoutReport";
import { ClosurePackPanel } from "../../components/closure/ClosurePackPanel";
import { Dot, ProgressBar, StatusHeader, panelClass, primaryAction } from "../../components/closure/closureUi";
import { PhaseChangeModal } from "../../components/overview/PhaseActions";
import { ArchiveProjectDialog } from "../../components/projects/ArchiveProjectDialog";

/**
 * Phase 15, Completion & handover → Project closure (redesign R6b, D-R6.16): the closure checklist,
 * contractor ratings, the closeout report and the closure pack export. UBEC: the closeout report (a
 * CLOSEOUT_REPORT register document) replaces lessons learned on the project;
 * `components/closure/LessonsPanel.tsx` stays on disk, unused here. Shown to
 * CLOSURE_VIEW_PERMISSIONS; panels hide what the caller cannot use.
 *
 * Design round 2026-11-26: a status header (phase, the defects liability period end, progress of the
 * two gates, and the one next action: Close the project, through the same phase change as the
 * Overview, or Archive project once closed), the checklist grouped by who completes it, the closure
 * file as its own small area, then the lessons learned report and contractor performance as
 * collapsible sections.
 */
export function ClosureTab({ project }: { project: ProjectSummaryDto }) {
  const { hasPermission } = useAuth();
  const live = project.status === "ACTIVE";
  const archived = project.status === "ARCHIVED";
  const checklist = useClosureChecklistQuery(project.id, true);
  const phaseQuery = useProjectPhaseQuery(project.id, live);
  const [closing, setClosing] = useState<ProjectPhaseTransitionDto | null>(null);
  const [archiving, setArchiving] = useState(false);

  const phase = phaseQuery.data;
  const closeMove = live && phase?.canChangePhase ? (phase.transitions.find((t) => t.to === "COMPLETED_CLOSED") ?? null) : null;
  const canArchive = live && project.constructionPhase === "COMPLETED_CLOSED" && hasPermission("projects:edit_baseline");
  const archiveBlocked = checklist.data?.archiveBlockedReason ?? null;

  const endDate = phase?.retentionEndDate ?? project.retentionEndDate;
  const days = phase?.daysRemaining ?? null;
  const liability = endDate
    ? `Defects liability period ${days !== null && days < 0 ? "ended" : "ends"} ${formatDateShort(endDate)}${days !== null && days >= 0 ? ` (${days} days left)` : ""}`
    : null;

  const blockedNote = closeMove && !closeMove.allowed ? closeMove.reason : canArchive && archiveBlocked ? archiveBlocked : null;
  const c = checklist.data;

  return (
    <div className="space-y-5">
      <section className={`${panelClass} space-y-5`} aria-labelledby="closure-heading">
        <StatusHeader
          icon={<Flag className="h-5 w-5" />}
          title="Project closure"
          titleId="closure-heading"
          status={
            <>
              <StatusText
                label={archived ? "Archived" : CONSTRUCTION_PHASE_LABELS[project.constructionPhase]}
                tone={archived || project.constructionPhase === "COMPLETED_CLOSED" ? "good" : "neutral"}
              />
              {liability && (
                <>
                  <Dot />
                  <span>{liability}</span>
                </>
              )}
            </>
          }
          help={
            blockedNote ??
            (c && !c.generated && c.beforeClose.length + c.beforeArchive.length > 0
              ? "The checklist starts when the project enters handover; items the platform checks already show their state."
              : "What must be done before the project is closed and archived.")
          }
          actions={
            <>
              {closeMove && (
                <button type="button" onClick={() => setClosing(closeMove)} disabled={!closeMove.allowed && !closeMove.overridable} className={primaryAction}>
                  <Flag className="h-3.5 w-3.5" aria-hidden="true" /> Close the project
                </button>
              )}
              {canArchive && (
                <button type="button" onClick={() => setArchiving(true)} disabled={Boolean(archiveBlocked)} className={primaryAction}>
                  <Archive className="h-3.5 w-3.5" aria-hidden="true" /> Archive project
                </button>
              )}
            </>
          }
        />

        {checklist.isLoading ? (
          <Loader />
        ) : checklist.isError ? (
          <p className="text-xs text-rose-700">The closure checklist could not be loaded.</p>
        ) : (
          c && (
            <>
              {c.beforeClose.length + c.beforeArchive.length > 0 && (
                <div className="flex flex-wrap gap-x-8 gap-y-2 rounded-xl bg-slate-50 px-4 py-3">
                  {c.beforeClose.length > 0 && <ProgressBar label="Before closing" done={c.progress.beforeClose.done} total={c.beforeClose.length} />}
                  {c.beforeArchive.length > 0 && <ProgressBar label="Before archiving" done={c.progress.beforeArchive.done} total={c.beforeArchive.length} />}
                </div>
              )}
              <ClosureChecklistPanel projectId={project.id} checklist={c} />
            </>
          )
        )}
      </section>

      {hasPermission("closure:export_pack") && <ClosurePackPanel projectId={project.id} />}

      <div className="space-y-3">
        <CloseoutReportCard project={project} />
        <ContractorRatingsPanel projectId={project.id} readOnly={archived} />
      </div>

      {closing && <PhaseChangeModal projectId={project.id} transition={closing} onClose={() => setClosing(null)} />}
      {archiving && (
        <ArchiveProjectDialog projectId={project.id} projectName={project.name} codePrefix={project.codePrefix} onClose={() => setArchiving(false)} />
      )}
    </div>
  );
}
