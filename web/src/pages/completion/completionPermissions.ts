/**
 * Redesign R6b (D-R6.16): who sees the Completion & handover page and each of its tabs. Every tab
 * keeps the gate its own page had before the merge (D-R6.27: no new permissions).
 */

/** Closure tab (Phase 15): the certificate's drafters and signatories, checklist, ratings, lessons, pack. */
export const CLOSURE_VIEW_PERMISSIONS = [
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

/** Handover tab (Phase 10, R1d): officers who record responses and reviewers. */
export const HANDOVER_VIEW_PERMISSIONS = ["handover:record_response", "handover:review_feedback"];

/** Defects tab: the server's defect readers (`GET /projects/:id/defects`). */
export const DEFECT_VIEW_PERMISSIONS = ["retention:manage_defects", "payments:view", "handover:review_feedback"];

/** The page: the union of the tabs. The certificate is readable by any of them. */
export const COMPLETION_PAGE_PERMISSIONS = Array.from(
  new Set([...CLOSURE_VIEW_PERMISSIONS, ...HANDOVER_VIEW_PERMISSIONS, ...DEFECT_VIEW_PERMISSIONS])
);
