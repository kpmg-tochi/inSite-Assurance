import { COMPLETION_CERTIFICATE_STATUS_META, type DefectStatus, type HandoverSubmissionDto } from "@insite/shared";
import type { ProjectSummaryDto } from "../../api/types";
import { useClosureChecklistQuery, useProjectCompletionQuery } from "../../queries/closure/useClosureQueries";
import { useDefectTicketsQuery, useHandoverSubmissionsQuery } from "../../queries/closeout/useCloseoutQueries";

export const OPEN_DEFECT_STATUSES: DefectStatus[] = ["OPEN", "ASSIGNED", "RECTIFIED_PENDING_VERIFICATION"];

/** The most recent handover response (the list is not guaranteed to be ordered). */
export function latestHandoverResponse(list: HandoverSubmissionDto[] | undefined): HandoverSubmissionDto | null {
  if (!list || list.length === 0) return null;
  return [...list].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
}

/** Short handover state for the tab hint and the Handover tab's status line. */
export function handoverStateLabel(phase: ProjectSummaryDto["constructionPhase"], latest: HandoverSubmissionDto | null): string {
  if (latest) {
    if (!latest.reviewedAt) return "Awaiting review";
    return latest.decision === "ACCEPTED" ? "Accepted" : latest.decision === "ACCEPTED_WITH_SNAGS" ? "Accepted, punch list" : "Rejected";
  }
  if (phase === "ACTIVE_CONSTRUCTION") return "Not started";
  if (phase === "HANDOVER_IN_PROGRESS") return "Awaiting response";
  return "No response recorded";
}

/**
 * Design round 2026-11-26: one short state per tab ("Draft · 0 of 3 signed", "2 open", "4 of 9
 * items"). Each hint reads the query its tab already uses (same keys, so the tab opens from cache);
 * a tab the caller cannot see fires no request. While a query loads the hint is left out.
 */
export function useCompletionTabHints(
  project: ProjectSummaryDto,
  visible: { handover: boolean; defects: boolean; closure: boolean }
): Partial<Record<"certificate" | "handover" | "defects" | "closure", string>> {
  const completion = useProjectCompletionQuery(project.id);
  const submissions = useHandoverSubmissionsQuery(project.id, visible.handover);
  const defects = useDefectTicketsQuery(project.id, visible.defects);
  const checklist = useClosureChecklistQuery(project.id, visible.closure);

  const hints: Partial<Record<"certificate" | "handover" | "defects" | "closure", string>> = {};

  if (completion.data) {
    const cert = completion.data.certificate;
    hints.certificate = !cert
      ? "Not drafted"
      : cert.status === "ISSUED"
        ? "Issued"
        : `${COMPLETION_CERTIFICATE_STATUS_META[cert.status].label} · ${cert.signedCount} of ${cert.slots.length} signed`;
  }
  if (visible.handover && submissions.data) {
    hints.handover = handoverStateLabel(project.constructionPhase, latestHandoverResponse(submissions.data));
  }
  if (visible.defects && defects.data) {
    const open = defects.data.filter((t) => OPEN_DEFECT_STATUSES.includes(t.status)).length;
    hints.defects = defects.data.length === 0 ? "None" : open === 0 ? "None open" : `${open} open`;
  }
  if (visible.closure && checklist.data) {
    const total = checklist.data.beforeClose.length + checklist.data.beforeArchive.length;
    const done = checklist.data.progress.beforeClose.done + checklist.data.progress.beforeArchive.done;
    if (total > 0) hints.closure = `${done} of ${total} items`;
  }
  return hints;
}
