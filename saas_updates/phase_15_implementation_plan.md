# Phase 15: Certificate of Completion and Closure Governance

| | |
| :--- | :--- |
| **Status** | Implemented; migrated, seeded and route-tested; web partly clicked through (see section 7) |
| **Depends on** | Phase 10 (construction phases, handover, retention), Phase 11 (project types, ownership), Phase 12 (credentials, fixed payment milestones), Phase 13 (documents, milestones), Phase 14 (final evaluation inspection) |
| **Unblocks** | Phase 16 |
| **Read first** | [Master plan](saas_implementation_plan.md) sections 2, 3 and 6; [Phase 10](phase_10_implementation_plan.md) sections 3 and 7; [gap analysis](process_flow_gap_analysis.md) G6 |

---

## 1. Overview

**Objective:** enforce the closing rules of both delivery models.

> No project shall proceed to handover, final payment, or closure without an approved Certificate of Completion duly signed off by relevant department heads and the beneficiary institution. A formal handover ceremony shall be conducted within 1 week of CoC issuance.

1. **Final evaluation** (a Phase 14 inspection) gates the CoC.
2. **Certificate of Completion:** a document with configurable signatories, signed by organisation admins holding a configurable permission (answer Q5) and the beneficiary, generated as a PDF.
3. **Gates:** CoC required for handover → retention, final payment and closure (each switchable per project type).
4. **Handover certificate** PDF from the accepted handover, due within N days of CoC.
5. **Closure checklist** per project type, including (Co-Funded) post-closure evaluation and audit sign-off.
6. **Contractor performance ratings** and **lessons learned**, browsable across the tenant.
7. **Closure pack export** for audit.

**Out of scope:** qualified e-signatures, archiving to external records systems.

---

## 2. Context for the implementing agent

- Phases: `ACTIVE_CONSTRUCTION → HANDOVER_IN_PROGRESS → RETENTION_PERIOD → COMPLETED_CLOSED`; checks in `checkTransition` ([projectPhase.service.ts](../server/src/modules/closeout/projectPhase.service.ts)); handover → retention needs a reviewed accepted handover when the module is on and sets `practicalCompletionDate`.
- Public handover router (`handoverPublic.routes.ts` / `.service.ts`): token hash, OTP with lockout, session JWT on a derived key, quarantined uploads. It is the most exposed surface; extend it carefully or not at all.
- Retention release stages `COMPLETION` and `FINAL` (`RetentionReleaseRequest`); final payment can also be the last payment milestone (Phase 12).
- Project `ARCHIVED` status is read-only and separate from `constructionPhase`.
- Only the valuation report has a PDF today (`pdf-report.service.ts`).
- Phase 13 provides `ProjectDocument` with versions and sign-offs, document types `COMPLETION_CERTIFICATE`, `HANDOVER_CERTIFICATE`, `FINAL_EVALUATION_REPORT`, `CLOSURE_FILE`, and milestone anchors.

---

## 3. Decisions

| Topic | Decision |
| :--- | :--- |
| Who signs the CoC | Signatory slots come from the project type. Each slot: label, permission (default new `completion:sign_certificate`), optional role, organisation scope (`PROJECT_OWNER`, `PROJECT_OWNER_OR_ANCESTOR`, `FUNDER`, `MONITOR`, `ANY`), and whether it is the **beneficiary** slot. Default slots for both seeded types: "Head of Physical Planning", "Head of M&E" (owner organisation, permission `completion:sign_certificate`), "Beneficiary institution". |
| Q5 mapping | `completion:sign_certificate` is granted to the Phase 11 "Organisation Administrator" default role and to Tenant Super Admin. Tenants can grant it to any role. Each slot needs a different user. |
| Credentials on signature | Follows the Phase 12 certifier policy only if the type sets `cocSignatureUsesCertifierPolicy` (default off). |
| Beneficiary signature | Two ways, chosen per project type: `HANDOVER_LINK` (the beneficiary signs through a dedicated public link, reusing the Phase 10 token + OTP infrastructure with a new link purpose) or `RECORDED_BY_STAFF` (an officer uploads the beneficiary's signed paper certificate and attests). Default `RECORDED_BY_STAFF`, to keep the public surface unchanged until the client confirms. |
| Order of events | Final evaluation approved → CoC drafted → signatures → CoC issued (sets `practicalCompletionDate` if empty) → handover ceremony milestone due CoC + 7 days → handover accepted → retention period. CoC can be drafted in `ACTIVE_CONSTRUCTION` or `HANDOVER_IN_PROGRESS`. |
| Gates | Project type `closure.requireCocFor[]`: `HANDOVER_TO_RETENTION`, `FINAL_PAYMENT`, `PROJECT_CLOSE`. Both seeded types: all three. |
| Final payment | A valuation on the highest-numbered payment milestone, or a `RETENTION_RELEASE` with stage `FINAL`. Gate checked at certification and again at the final decision. |
| Revoking a CoC | Allowed before handover is accepted, with reason and permission `completion:revoke_certificate`; reopens dependent milestones. After handover acceptance, refused. |
| Closure checklist | Two lists on the type: `beforeClose` (gates `COMPLETED_CLOSED`) and `beforeArchive` (gates `ARCHIVED`). Item kinds: `DOCUMENT_TYPE`, `INSPECTION_VISIT_TYPE`, `CONTRACT_MILESTONE`, `CONTRACTOR_RATINGS`, `LESSONS_LEARNED`, `AUDIT_SIGNOFF`, `MANUAL`. |
| Co-Funded extras | Post-closure evaluation (2 weeks after close) and archiving & audit sit in `beforeArchive`. |
| Ratings visibility | Hidden from contractor organisations by default (`closure.shareRatingsWithContractor`). |
| Lessons | Tenant-wide library; drafts visible to the project team, published lessons to anyone with `lessons:view`. |

---

## 4. Schema changes

- New `CompletionCertificate (id, projectId, certificateNumber, status DRAFT|PENDING_SIGNATURES|ISSUED|REVOKED, scopeSummary, completionDate, finalEvaluationInspectionId?, documentId?, issuedAt?, revokedAt?, revokedReason?, createdByUserId, createdAt)`; unique `(projectId)` where status ≠ `REVOKED` (hand-written partial unique index; add it to the CLAUDE.md list).
- New `CompletionCertificateSignature (id, certificateId, slotKey, slotLabel, userId?, roleId?, organizationId?, isBeneficiary, beneficiaryName?, beneficiaryRole?, evidenceDocumentId?, statement, statementHash, signedAt)`, unique `(certificateId, slotKey)` and `(certificateId, userId)`.
- `HandoverLink.purpose HandoverLinkPurpose @default(HANDOVER)` (`COC_BENEFICIARY_SIGNATURE` added only if `HANDOVER_LINK` signing is built).
- New `ClosureChecklistItemState (id, projectId, list BEFORE_CLOSE|BEFORE_ARCHIVE, itemKey, status PENDING|DONE|WAIVED, completedByUserId?, completedAt?, notes?, waivedReason?)`.
- New `ContractorPerformanceRating (id, projectId, projectContractorId, stage COMPLETION|POST_CLOSURE, criteriaJson [{key, score 1–5, comment}], overallScore Decimal, comments?, ratedByUserId, createdAt)`; tenant `ratingCriteriaJson` default: time, quality, health & safety, responsiveness, documentation.
- New `LessonLearned (id, tenantId, projectId, category, title, description, recommendation, stage, tags String[], status DRAFT|PUBLISHED, sharedWithContractor Boolean, createdByUserId, publishedAt?, createdAt)`.
- New `ClosurePackExport (id, projectId, status QUEUED|RUNNING|DONE|FAILED, documentId?, requestedByUserId, createdAt, finishedAt?, error?)`.
- `ProjectTypeConfigSchema.closure = { cocSignatories[], beneficiarySignatureMode, cocSignatureUsesCertifierPolicy, requireFinalEvaluationBeforeCoc, requireCocFor[], handoverDueDaysAfterCoc, beforeClose[], beforeArchive[], shareRatingsWithContractor }`. Phase 13 anchors gain `COC_ISSUED`.
- Permissions: `completion:draft_certificate`, `completion:sign_certificate`, `completion:revoke_certificate`, `closure:manage_checklist`, `closure:audit_signoff`, `closure:export_pack`, `contractors:rate_performance`, `lessons:manage`, `lessons:view`.
- Audit actions: `COC_DRAFTED`, `COC_SIGNED`, `COC_ISSUED`, `COC_REVOKED`, `HANDOVER_CERTIFICATE_ISSUED`, `CLOSURE_ITEM_COMPLETED`, `CLOSURE_ITEM_WAIVED`, `CLOSURE_AUDIT_SIGNED`, `CONTRACTOR_RATED`, `LESSON_PUBLISHED`, `CLOSURE_PACK_EXPORTED`.

---

## 5. Implementation checklist

### Step 1: Final evaluation gate
- [x] Drafting a CoC requires an approved `FINAL_EVALUATION` inspection when the type says so (422 with the reason and a link target).

### Step 2: Certificate of Completion
- [x] Draft (`completion:draft_certificate`): number, scope summary pre-filled from project and evaluation, completion date.
- [x] Sign (`completion:sign_certificate` + slot rules + organisation scope): one transaction, signature row, audit; the same user cannot fill two slots.
- [x] Beneficiary slot `RECORDED_BY_STAFF`: upload the signed paper certificate (document type `COMPLETION_CERTIFICATE`, version note "beneficiary signed copy") and attest.
- [x] All slots signed → `ISSUED`: generate the CoC PDF (tenant branding, terminology, signatures with names, roles, organisations, registration only where present and policy allows), store as a register document, set `practicalCompletionDate` if empty, complete or create the "handover ceremony" milestone due CoC + `handoverDueDaysAfterCoc`, notify the owner organisation, monitor and contractor.
- [x] Revoke with reason (before handover acceptance only).
- [ ] Web: "Completion" section on the project closeout tab: status, slots with signer or "awaiting", sign button for eligible users, PDF link. *(Built on the Handover tab; viewed in the browser with seeded PRG-103; the draft, sign, record-copy and revoke dialogs were not clicked through.)*

### Step 3: Gates
- [x] `checkTransition`: `HANDOVER_TO_RETENTION` and `PROJECT_CLOSE` require an issued CoC when configured; clear reasons in the phase-change UI.
- [x] Final payment gate in direct verification / IPC certification for the last payment milestone and in the final retention release (request, certification and decision).
- [x] Route tests for every gate on and off.

### Step 4: Handover certificate
- [x] Reviewing an accepted handover submission generates a handover certificate PDF (beneficiary, decision, date, snag count, CoC number) stored as `HANDOVER_CERTIFICATE`; completes the handover ceremony milestone.
- [ ] *(Deferred by design: D-15.1 unanswered, default `RECORDED_BY_STAFF` built; `HandoverLink.purpose` added with only `HANDOVER`.)* If `HANDOVER_LINK` beneficiary signing is chosen later: new link purpose on the existing public router, same token/OTP/rate limits, a page that shows the CoC and records the signature; abuse tests as in Phase 10. Build only when the client confirms (section 3).

### Step 5: Closure checklist
- [x] Items generated from the type when the project enters `HANDOVER_IN_PROGRESS`; automatic kinds evaluated live (document present and signed, inspection approved, milestone done, ratings recorded for every contractor, at least one published lesson); manual and audit items completed by permission.
- [x] `COMPLETED_CLOSED` refused while a `beforeClose` item is pending; archiving (`ARCHIVED`) refused while a `beforeArchive` item is pending. Waivers with reason.
- [x] Post-closure evaluation (Co-Funded): a contract milestone anchored on the close date + 14 days, completed by a `FINAL_EVALUATION`-style inspection or an uploaded report (type-configurable).
- [ ] Web: "Closure" tab with the two lists, progress, actions. *(Built at `/app/projects/:id/closure`; viewed in the browser with seeded PRG-241; actions not clicked through.)*

### Step 6: Contractor ratings and lessons learned
- [x] Rate each contractor at completion and (optional) post-closure; one rating per stage per rater.
- [x] Organisation detail page: a contractor's ratings across projects (average per criterion, list), hidden from contractor users unless shared.
- [x] Lessons: create, edit, publish per project; tenant "Lessons learned" library with filters (project type, region, category, tag) and search; optional share with the contractor (aimed notification).

### Step 7: Closure pack export
- [x] `POST /projects/:id/closure-pack` (`closure:export_pack`) queues a job; the job builds a ZIP: index PDF (project summary, parties, timeline of phases and milestones, payments and retention, KPIs), all current document versions, CoC and handover certificate, valuation PDFs, inspection reports (PDF summary per inspection), audit ledger extract (CSV with entry hashes and a chain verification result).
- [x] Stored as a `CLOSURE_FILE` document; download through the media endpoint; size limits and streaming so large projects do not exhaust memory.

### Step 8: Seed and tests
- [x] Seed: one Central project with an issued CoC, accepted handover and handover certificate, in retention; one Co-Funded project closed with its post-closure evaluation pending (cannot archive), ratings and two published lessons.
- [x] Route tests: slot rules and org scope; the same user cannot sign twice; issuance side effects; each gate; revoke rules; closure checklist evaluation; archive gate; rating visibility to contractors; closure pack contains the expected entries and a valid chain check.

---

## 6. Definition of done

- Neither handover into the liability period, the final payment nor closure can happen without an issued CoC signed by the configured organisation admins and the beneficiary, when the project type requires it.
- The handover ceremony deadline is tracked from the CoC date.
- A Co-Funded project cannot be archived until its post-closure evaluation and audit sign-off are done.
- A closure pack can be exported and verified.
- Master plan status updated; CLAUDE.md gains a "Completion and closure (Phase 15)" paragraph.

## 7. Found during implementation

**Where things are.** Server `server/src/modules/completion/` (`completion.service.ts` CoC and gates, `handoverCertificate.service.ts`, `closure.service.ts` checklist, `ratings.service.ts`, `lessons.service.ts`, `closurePack.service.ts`, `completion.routes.ts`), PDFs `integrations/closure-pdf.service.ts`, ZIP `utils/zipWriter.ts`, contracts `shared/src/schemas/closure.schema.ts`. Web `components/closure/*`, `pages/closure/ProjectClosurePage.tsx`, `pages/lessons/LessonsLibraryPage.tsx`, `pages/organizations/OrganizationRatingsPage.tsx`, type editor `components/deliveryModels/ClosureRulesEditor.tsx`. Tests `routes.phase15.test.ts` (16) and `closure.phase15.test.ts` (6). Migration `20261128090000_phase15_completion_closure` (hand-written partial unique index `completion_certificates_one_live_per_project`).

**Decisions taken while building (switchable):**
1. **Final payment = the highest-numbered tranche.** On a project with a single tranche every release on it is "final", so with the gate on, partial measured releases on that tranche also need a CoC. Retention: only stage `FINAL` (request, certification, decision).
2. **Gate order.** Handover → liability period reports the CoC gate before "a stakeholder must accept the works" (CoC precedes the handover).
3. **Practical completion.** The liability-period transition now keeps a date the CoC already set (Phase 10 used the handover review date). An explicit date in the request still wins.
4. **Handover ceremony milestone.** Uses the type's milestone anchored on `COC_ISSUED`; if the type has none, issuing creates `handover-ceremony` (mode `AUTO_HANDOVER_ACCEPTED`), which template syncs never delete. New anchors `COC_ISSUED`, `PROJECT_CLOSED`; new modes `AUTO_COC_ISSUED` (reopened by a revoke), `AUTO_HANDOVER_ACCEPTED`, `AUTO_FINAL_EVALUATION_APPROVED` (only rows that already have a date).
5. **Generated documents carry genuine sign-offs.** The issued CoC PDF is signed off by its staff signatories; the handover certificate by the reviewer. The beneficiary's paper copy is a separate `COMPLETION_CERTIFICATE` document ("beneficiary signed copy"). A revoke archives the issued PDF.
6. **Archive gate scope.** `beforeArchive` holds only once the checklist exists (the project entered handover) or the project is closed; a project abandoned earlier can still be archived.
7. **Closure pack on archived projects.** `POST /closure-pack` is the one write an archived project accepts (`ARCHIVED_WRITE_RE` in `accessControl.ts`); it files a `CLOSURE_FILE` document. Built in-process (setImmediate) with a `closure-packs` job sweeping queued/stuck exports. No new dependency: in-house ZIP writer, no ZIP64, 1 GB cap, files over 30 MB skipped and listed in `manifest.json`.
8. **Contractors and the Closure tab.** The route is not permission-gated so the "lesson shared" notification works; contractors see only shared, published lessons (ratings 404 unless the type shares them).
9. **Milestone-deadlines job** now covers active projects in every phase (it skipped projects past handover, so the post-closure evaluation would never be notified). Not covered by a dedicated test.

10. **Where the certificate is shown.** On the Closure tab for everyone with project access (contractors read-only) and also on the Handover tab when that module is on. The Closure tab opens to `completion:*` holders: the default signatories (Organisation Administrators) hold no handover permission and could not reach the Handover tab. Gate messages and certificate notifications point to the Closure tab. Clicked through as `flagship.admin` on PRG-103.
11. **Rating criteria** are edited in Settings → Tenant Settings ("Contractor rating criteria", `tenant:manage_settings`). Keys are fixed once saved (recorded ratings refer to them); new rows get a key from the label. Clicked through: rename and save.

**Open / not done:**
- Supervision workload (Phase 14) counts projects in their liability period (seeded PRG-103 raised the M&E officer to 4 sites).
- Seeded PRG-241 is closed while its liability period runs (nothing held, which Phase 10 allows).
- No organisation detail page existed; ratings live at `/app/organizations/:id/ratings`, linked from the Closure tab.
- Web click-through of the dialogs (draft, sign, record copy, revoke, tick/waive, rate, lesson, export) is outstanding.
