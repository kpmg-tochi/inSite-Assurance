# Phase 13: Document Register, Contract Milestones, Kick-off and Mobilisation Compliance

| | |
| :--- | :--- |
| **Status** | Implemented; migrated, seeded and route-tested; web click-through and on-device run pending (see section 7) |
| **Depends on** | Phase 11 (project types, ownership, beneficiaries), Phase 12 (payment milestone completion rules), Phase 8 (job runner, messaging, mobilisation), Phase 9 (schedule baseline) |
| **Unblocks** | Phase 15 (CoC and closure use documents and milestones), Phase 16 (mobilisation KPIs) |
| **Read first** | [Master plan](saas_implementation_plan.md) sections 2, 3 and 6; [gap analysis](process_flow_gap_analysis.md) G2, G3, G7, G11 |

---

## 1. Overview

**Objective:** cover the stretch between contract award and the contractor working on site, where the process flow has the most deadlines and the platform has the fewest controls.

1. **Document register:** every project document (contract, letters, minutes, mobilisation agreement, CoC later) stored, typed, versioned and, where required, signed off.
2. **Contract milestones:** dated obligations computed from anchor dates (contract award, kick-off) with offsets per project type, flagged when due or overdue.
3. **Kick-off meeting record:** invitees by stakeholder group, notice sent, quorum, minutes, sign-off.
4. **Contractor mobilisation compliance:** the deadline is **kick-off + N days** (answer Q4: 21 days Central, 14 days Co-Funded, configurable), completed by the contractor's first verified check-in on site.
5. **Default cases:** an overdue mobilisation (or a manual referral) opens a case to Legal with an approval chain ending in termination, extension or cure; termination allows a replacement contractor.
6. **Programme of works:** the contractor proposes the schedule baseline; the monitor accepts it.

**Out of scope:** procurement steps before award, e-signature products, letters generated from templates (a later nicety; uploads only now).

---

## 2. Context for the implementing agent

- Documents today live in silos: `ProjectNeedsAssessmentDocument`, standards docs, `IpcSupportingDocument`, handover attachments. `ConditionPrecedent.evidenceDocumentUrl` is a URL string.
- Storage: object keys, presigned upload, multipart for > 5 MB (Phase 10: `/uploads/multipart/*`), authenticated media endpoint. Reuse; do not add a second upload path.
- `ProjectContractor.plannedMobilizationDate` is a plain date. Phase 8 mobilisation tracks **people** (`ExpectedProjectParticipant`), not the contractor's obligation. First in-geofence check-in: `firstCheckIn` / `markParticipantsOnSite` in `server/src/modules/mobilization/`.
- Jobs: `server/src/jobs/` with `runUnit(jobName, scopeKey, fn)`, advisory lock per tick, `LIVE_PROJECT_WHERE`. Messaging: `sendMessage` with console/resend/push adapters.
- Approval chains: `ApprovalChainTypeEnum = REPORT | DISBURSEMENT`, engine in `approvalChain.ts`, validator `validateApprovalChain`. Phase 11 added `organizationScope`.
- Contractors with field sessions or IPCs cannot be removed (`contractors.service.ts` ~185). There is no contractor status.
- Schedule baseline save: `schedule.service.ts`; only monitors (`projects:edit_baseline`) edit it.

---

## 3. Decisions

| Topic | Decision |
| :--- | :--- |
| Kick-off date | Captured in a new wizard step **Contract and kick-off** (after Parties): contract reference, award date, signed date, contract sum, planned kick-off date. Required for activation when the project type has a milestone anchored on it (both seeded types). |
| Anchors | `CONTRACT_AWARD`, `CONTRACT_SIGNED`, `KICKOFF`, `ACTIVATION`, another milestone's completion (`MILESTONE:<key>`). Phase 15 adds `COC_ISSUED`. |
| Offsets | Signed integer with unit `CALENDAR_DAYS` or `WORKING_DAYS` (project work-week, Phase 8 helpers). Negative = before the anchor (kick-off notice: −7 calendar days). |
| Moving the kick-off | Recomputes due dates of pending milestones anchored on it. On a live project: `milestones:manage`, a reason, audited. Completed milestones keep their dates. |
| Milestone completion | Manual (with optional required document types and sign-offs), or automatic (`AUTO_CONTRACTOR_ON_SITE`, `AUTO_KICKOFF_QUORUM`, `AUTO_SCHEDULE_BASELINE_SET`). Waiver needs `milestones:waive` and a reason. |
| Mobilisation completion | First check-in inside the geofence by a session bound to that contractor (join code) or by a provisioned user of the contractor's organisation. Multi-contractor projects get one mobilisation milestone per contractor. |
| Quorum | At least one attendee per required stakeholder group (groups come from the project type). Holding a kick-off without quorum needs a waiver with reason. |
| Notice evidence | An `OutboundMessage` with status `SENT` per invitee, or an uploaded receipt document. The platform does not claim the email was read. |
| Default cases | New chain type `CONTRACT_DEFAULT`; the last step needs `contracts:decide_default`, default organisation scope `PROJECT_OWNER` (Chief Executive for Central, Regional Chief Executive for Co-Funded through roles). |
| Termination | A contract state on `ProjectContractor` (`ACTIVE`, `TERMINATED`), never the project's `ARCHIVED`. History, certified progress and retention stay with the terminated contractor. |
| Document visibility | Per document type: `visibleToContractors` (default false), plus the uploader's own documents. Contractor web users see only their organisation's documents of visible types. |
| Signatures | A sign-off is an authenticated acknowledgement (user, role, organisation, time, statement hash, document version), like the certifier acknowledgement. Not a qualified e-signature. |

---

## 4. Schema changes

- `Project`: `contractReference String?`, `contractAwardDate String?`, `contractSignedDate String?`, `contractSumNgn Decimal?`, `kickoffDate String?` (planned), `kickoffHeldAt DateTime?`.
- `ProjectContractor`: `contractStatus ContractStatus @default(ACTIVE)`, `terminatedAt`, `terminationCaseId`, `replacesProjectContractorId`.
- New `DocumentType (id, tenantId, code, name, description?, visibleToContractors, requiresSignOff, signOffPermissionKey?, allowedMimeTypes[], isArchived)`; seeded: CONTRACT, AWARD_LETTER, ACCEPTANCE_LETTER, KICKOFF_BRIEFING_PACK, KICKOFF_NOTICE_RECEIPT, KICKOFF_MINUTES, MOBILISATION_AGREEMENT, MOBILISATION_PLAN, PROGRAMME_OF_WORKS, LETTER_OF_INTRODUCTION, SITE_POSSESSION_FORM, SUPERVISOR_ASSIGNMENT, CP_EVIDENCE, COMPLETION_CERTIFICATE, HANDOVER_CERTIFICATE, FINAL_EVALUATION_REPORT, CLOSURE_FILE, OTHER.
- New `ProjectDocument (id, projectId, documentTypeId, title, currentVersion, uploadedByUserId, projectContractorId?, linkedMilestoneId?, linkedConditionPrecedentId?, isArchived, createdAt)` and `ProjectDocumentVersion (id, documentId, version, objectKey, mimeType, byteSize, sha256, uploadedByUserId, uploadedAt, note?)`.
- New `ProjectDocumentSignOff (id, documentId, version, userId, roleId, organizationId?, statement, statementHash, signedAt)`, unique `(documentId, version, userId)`.
- `ConditionPrecedent.evidenceDocumentUrl` → `evidenceDocumentId` (decision A: no backfill).
- New `ProjectContractMilestone (id, projectId, projectContractorId?, key, label, description?, anchor, anchorMilestoneKey?, offsetValue, offsetUnit, dueDate String?, status PENDING|DUE|OVERDUE|DONE|WAIVED, completionMode, requiredDocumentTypeCodes[], requiresSignOffPermissionKey?, responsibleRoleId?, responsibleOrganizationScope, completedAt?, completedByUserId?, completedNotes?, waivedReason?, lastNotifiedAt?, sortOrder)`, unique `(projectId, key, projectContractorId)`.
- New `KickoffMeeting (id, projectId, scheduledAt, location?, virtualLink?, agendaDocumentId?, minutesDocumentId?, noticeSentAt?, heldAt?, quorumMet Boolean?, quorumWaivedReason?)` and `KickoffInvitee (id, meetingId, stakeholderGroup, name, email?, phone?, organizationId?, userId?, outboundMessageId?, attended Boolean?)`.
- New `ContractorDefaultCase (id, projectId, projectContractorId, trigger MILESTONE_OVERDUE|MANUAL, milestoneId?, status OPEN|IN_REVIEW|CURE_PERIOD|EXTENSION_GRANTED|TERMINATED|CLOSED, summary, outcomeNotes?, newDueDate?, chainVersion, currentStepOrder, openedByUserId?, openedAt, decidedAt?)`; `ApprovalSubjectType` + `CONTRACT_DEFAULT_CASE`; `ApprovalChainType` + `CONTRACT_DEFAULT`.
- New `ProgrammeOfWorksSubmission (id, projectId, projectContractorId?, submittedByUserId, proposalJson, status PENDING|ACCEPTED|RETURNED, decidedByUserId?, decisionNotes?, createdAt, decidedAt?)`.
- `ProjectTypeConfigSchema.contractMilestones[]` (key, label, anchor, offset, unit, completionMode, requiredDocumentTypeCodes, signOffPermissionKey, responsibleRoleCode, perContractor), `.kickoff = { requiredStakeholderGroups[], noticeLeadDays }`, `.documentRequirements = { beforeActivation[], beforeMobilisation[] }`.
- Permissions: `documents:view`, `documents:upload`, `documents:manage_types`, `milestones:manage`, `milestones:waive`, `kickoff:manage`, `contracts:raise_default`, `contracts:decide_default`, `schedule:propose_programme`.
- Audit actions: `DOCUMENT_UPLOADED`, `DOCUMENT_VERSIONED`, `DOCUMENT_SIGNED`, `MILESTONE_COMPLETED`, `MILESTONE_WAIVED`, `MILESTONE_DATES_RECOMPUTED`, `KICKOFF_NOTICE_SENT`, `KICKOFF_HELD`, `DEFAULT_CASE_OPENED`, `DEFAULT_CASE_DECIDED`, `CONTRACTOR_TERMINATED`, `CONTRACTOR_REPLACED`, `PROGRAMME_OF_WORKS_SUBMITTED`, `PROGRAMME_OF_WORKS_DECIDED`.

---

## 5. Implementation checklist

Ticked = verified by tests (`server/src/tests/contracts.phase13.test.ts`, `routes.phase13.test.ts`) or by the seed run. Web items are built (typecheck, build, lint pass) but **not clicked through**; they stay unticked until then.

### Step 1: Document register
- [x] Shared schemas and DTOs (`shared/src/schemas/contract.schema.ts`); `documentMimeAllowed`, `defaultSignOffStatement`.
- [x] Server `modules/documents/`: upload (reuses `/evidence/presign` with `PROJECT_DOCUMENT`; the server reads size, type and SHA-256 from storage), new version, list with filters, download (`/documents/:id/download`) and the media endpoint both apply permission + project + contractor visibility, sign-off (second sign-off by the same user on the same version refused; superseded versions refused), archive.
- [x] CP evidence picks a register document (`evidenceDocumentId` on the CP status action; other projects' documents refused).
- [ ] Document types managed in tenant settings (API `/api/v1/document-types` done; web card not clicked through).
- [ ] Web: project "Documents" tab and reusable `DocumentPicker` (built, not clicked through).

### Step 2: Contract step and milestone generation
- [x] New setup step `contract` (order 25, required when the type has milestones or documents before activation); award ≤ signed ≤ kick-off, also against stored values.
- [x] Shared pure `computeMilestoneDueDates` with table tests (calendar vs working days, negative offsets, chained milestones, missing anchor → null, cycles).
- [x] Applying the project type creates milestone rows from the snapshot; `perContractor` templates create one row per contractor and follow contractor add/remove.
- [x] Changing an anchor recomputes open rows; audited (`MILESTONE_DATES_RECOMPUTED`); live projects need `milestones:manage` and a reason.

### Step 3: Milestone tracking and notifications
- [x] `POST .../milestones/:id/complete` checks required documents present and signed; `.../waive`.
- [x] Job `milestone-deadlines` (hourly, one `JobRun` per project-day): `PENDING → DUE → OVERDUE`, one notification per state to the responsible role within the responsible organisation, reminders on the project's reminder offsets; registered in `registerAllJobs()`.
- [ ] Web: "Milestones" tab, "Next deadlines" card, overdue count on the directory row (`overdueMilestoneCount` served and tested through the seed; UI not clicked through).
- [x] Optional activation gate: `documentRequirements.beforeActivation` is a contract-step issue.

### Step 4: Kick-off meeting
- [x] Create / edit the meeting; invitees by stakeholder group, pre-filled from parties, beneficiaries and assigned users.
- [x] "Send notice": one email per invitee with an address; `outboundMessageId` recorded; refused inside the lead time unless waived with a reason. (Externals get the agenda title, not an attachment: see 7.2.)
- [x] "Record meeting held": attendance, computed quorum (or waiver), minutes document, sign-off request emails to attendees with accounts.
- [x] Auto-completes `AUTO_KICKOFF_QUORUM` (and `AUTO_KICKOFF_NOTICE_SENT`); sets `kickoffHeldAt`; held on another day moves the anchor (default yes) and recomputes.

### Step 5: Contractor mobilisation compliance
- [x] `AUTO_CONTRACTOR_ON_SITE` completion from the first in-geofence check-in (telemetry hook; idempotent; only the checking-in contractor's row).
- [ ] Mobilisation compliance panel (API `/mobilisation-compliance` tested; web panel not clicked through).
- [x] Phase 12 hook: completion rule `CONTRACT_MILESTONE_DONE` with `completionContractMilestoneKey` (unit-tested; not used by the seed).

### Step 6: Default cases and termination
- [x] Overdue mobilisation milestone opens a case once and notifies `contracts:raise_default` and the type's Legal role; manual raise for other defaults (one running case per contractor).
- [x] Case moves through the `CONTRACT_DEFAULT` chain (engine, versioning, `RETURN`, organisation scope). Outcomes `CURE_PERIOD` (lapses back to the decision step), `EXTENSION_GRANTED` (moves the milestone, audited), `TERMINATED`, `CLOSED`.
- [x] Termination (one transaction): refused while any claim of the contractor is unpaid; then contractor `TERMINATED`; join codes deactivated; field sessions revoked; briefs and direct verifications exclude its items; open milestones waived; claims and defect tickets untouched.
- [x] Replacement: new contractor with `replacesProjectContractorId`; items not fully certified move (certified % stays); new per-contractor milestones counted from the replacement day.
- [ ] Web: "Default cases" panel and the third chain in the chain editor (API tested; UI not clicked through).

### Step 7: Programme of works
- [x] Contractor web users with `schedule:propose_programme` submit item dates and dependencies (baseline validation; each dependency ends at a proposed item); one pending submission per contractor; only their package's items. Web form with dependencies clicked through.
- [x] Monitor accepts (writes the baseline through the schedule service, completes the milestone) or returns with notes.
- [x] Before activation any item; after activation only undated items (`ITEM_ALREADY_DATED`).

### Step 8: Seed and tests
- [x] Seed both types' milestone templates (Central and Co-Funded as listed; see 7.2 for the extra `kickoff-notice` mode).
- [x] Seed PRG-102 mid-mobilisation (kick-off held 16 days ago, minutes filed and signed, mobilisation due in 5 days) and PRG-221 with an overdue mobilisation and an open default case at the second chain step.
- [x] Route tests: all listed scenarios (`routes.phase13.test.ts`, 12 tests) plus unit tests (`contracts.phase13.test.ts`, 9 tests).

## 6. Definition of done

- A project of either type shows every post-award obligation with a due date computed from the kick-off date, and overdue ones are flagged and notified.
- The kick-off record proves notice, quorum and signed minutes.
- A contractor that has not checked in on site by kick-off + N days triggers a default case that reaches the right executive and can end in termination and replacement without losing history.
- All required documents are in one register with versions and sign-offs.
- Master plan status updated; CLAUDE.md gains a "Contract milestones and documents (Phase 13)" paragraph.

## 7. Found during implementation

### 7.1 Migration (for the coordinator)

`server/prisma/migrations/20261127090000_phase13_documents_milestones_kickoff` (generated with `prisma migrate diff` after the Phase 12/14 migration, then deployed). It drops `ConditionPrecedent.evidenceDocumentUrl` (decision A) and adds `evidenceDocumentId`. Hand-written SQL appended (keep it in every regenerated migration):

```sql
-- One milestone per project, key and contractor (project-level rows have a NULL contractor).
CREATE UNIQUE INDEX "contract_milestones_project_key_contractor_key"
  ON "project_contract_milestones" ("projectId", "key",
    COALESCE("projectContractorId", '00000000-0000-0000-0000-000000000000'::uuid));
```

### 7.2 Decisions and deviations

1. **Uploads.** There is no authenticated multipart upload (Phase 10's multipart is the public handover router only). Documents use the existing single presigned PUT (`/evidence/presign`, `PROJECT_DOCUMENT`, 25 MB cap). The register only accepts keys under `.../project_document/`. Follow-up if documents above 25 MB are needed.
2. **Extra completion mode `AUTO_KICKOFF_NOTICE_SENT`**, so "kick-off notice sent" completes from the platform notice. A notice sent outside the platform is recorded by filing `KICKOFF_NOTICE_RECEIPT` and waiving the milestone with a reason.
3. **Template fields.** `responsibleScope` covers the Phase 11 scopes plus `MONITOR` and `CONTRACTOR`; it is stored as `responsibleOrganizationScope`. Two config keys were added beside the planned ones: `kickoff` (required groups, notice lead days) and `defaultCases` (`legalRoleCode`, `autoOpenOnOverdueMobilisation`, default on).
4. **`anchorDateOverride`** (new column) replaces the planned `MILESTONE:<termination>` anchor. A replacement contractor's per-contractor milestones count from the replacement day with the template's offset. An extension sets the override to the new date with offset 0.
5. **Chained milestones** count from the day the referenced milestone was done (a waived one from its due date). Until then they have no date.
6. **Status** is stored by the job (for notifications) and derived for today on every read, so the API is right between ticks. Reminders fire on the exact reminder-offset day. A tick that misses the day does not catch up.
7. **Notifications** go to the responsible role (else `milestones:manage`) within the responsible organisation (owner, funder, monitor or contractor organisation). `PROJECT_OWNER_OR_ANCESTOR` notifies the owner organisation only.
8. **Kick-off.**
   - There is one meeting per project. Rescheduling clears the notice, which must then be sent again.
   - The messaging adapters have no attachments. Invitees with an account get a link to the project documents; externals get the agenda title and "available on request".
   - Kick-off routes work on live projects only, because messaging only sends for live projects.
   - Sign-off requests to attendees are emails; there is no per-user web notification target.
9. **Sign-offs** are allowed on any document type. `requiresSignOff` drives "awaiting sign-off" and milestone checks. Hash: `sha256(documentId|version|versionSha256|userId|statement)`.
10. **Contractor side** is decided by organisation, as for defects. Its uploads are forced to its own contractor, and it can change only what it uploaded.
11. **Default chain.**
    - The default is created on first use: "Legal review" (`contracts:raise_default`, role = the type's Legal role), then "Executive decision" (`contracts:decide_default`, system step, `PROJECT_OWNER` when the project has an owner, else `ANY`).
    - Workflow templates do not carry this chain.
    - Edits go through `PUT .../process/chains/CONTRACT_DEFAULT`. `ProjectProcessSettingsDto.contractDefaultChain` is new; `ProjectProcessStepSchema` was not extended.
12. **Cure period.** If the milestone is done within the period, the case closes as cured. If the period ends without a cure, the job moves the case back to the decision step (`cureLapsedAt`) and notifies the decision step.
13. **Active claims block termination** (owner decision, 2026-11-23).
    - While the contractor has a claim that is submitted, reconciled, queried or certified and not yet decided by the lender (`OPEN_IPC_STATUSES`), the "terminate" outcome is refused (409 `ACTIVE_CLAIMS_BLOCK_TERMINATION`, `details.claims`) and nothing is recorded.
    - The case DTO lists the blocking claims (`terminationBlockedBy`); the web disables "Terminate" and says which claims must be paid or withdrawn first. The other outcomes stay available.
    - Termination no longer withdraws claims. Paid claims stay as history.
    - In single and unified models, claims have no contractor and belong to the main contractor, so they block the main contractor's termination.
    - Open milestones of the contractor are waived ("Contract terminated").
    - IPC submission by a terminated contractor is refused (409 `CONTRACTOR_TERMINATED`).
14. **Direct verification.** Items of a terminated contractor are excluded. A fixed-amount milestone with an item rule cannot complete while such items are below 100% (reason given), so it cannot pay without them.
15. **Replacement.**
    - Items below 100% certified move (certified % is kept); fully certified items stay with the terminated contractor.
    - The main-contractor flag moves to the replacement.
    - Model rules (`contractorModelIssues`) and join codes ignore terminated contractors.
16. **Permissions granted.**
    - Monitor: `documents:view|upload`, `milestones:manage`, `kickoff:manage`, `contracts:raise_default`.
    - Organisation Administrator: those plus `milestones:waive` and `contracts:decide_default`.
    - Lender: `documents:view`.
    - Contractor: `documents:view|upload`, `schedule:propose_programme`.
    - The tenant super admin gets everything (none of these are segregated).
    - Read endpoints for milestones, kick-off, compliance and cases need only web project access. The web shows the pages to holders of the Phase 13 permissions.
17. **Draft routes.** `DRAFT_ROUTE_RE` also allows `documents`, `milestones` and `programme-of-works`.
18. **Seed.**
    - The programme types' config and project snapshots are written without a version bump (as Phase 14).
    - Programme tenant: a custom "Legal Officer" role and `legal.officer@insite.ng`.
    - Document files are written only to local storage, when S3 is not configured.
    - The Phase 11 read-all test now counts South's visible unread notifications instead of a fixed 1: the seeded PRG-221 case notifies South's executives.
19. **Project-type editor.** Settings → "Project types, regions & documents" → a type now edits contract milestones (label, key, anchor or another milestone, days and counting, how it is done, required documents and sign-off permission, responsible role and organisation, one per contractor, order) and the kick-off rules (quorum groups, notice lead days). Validation is the shared schema (duplicate keys, unknown or circular anchors). `documentRequirements` and `defaultCases` still have no fields: they are kept on save and set through the API or the seed.
    Verified in the browser: added a milestone counted from another milestone and changed the notice lead days; saved as version 2 with the new milestone, and the other config (streams, document requirements) kept.
20. **Programme of works dependencies.** The web form has a "Starts after" column (predecessor: any item of the project; lag in working days). The server requires every dependency to end at an item of the proposal (422 `DEPENDENCY_OUTSIDE_PROGRAMME`); predecessors need dates (baseline rule). Submissions show item names to contractors too (from the BOQ; the schedule is not readable for them).
    Verified in the browser: KAN-210, contractor proposed 01.01 and 01.02 with "01.02 after 01.01 + 1 working day"; the monitor accepted, and the baseline holds the link.
21. **Web assumptions to check in the click-through.** Kick-off times are entered in the browser's time zone and sent as UTC. The programme form lists the contractor's own items from `GET /boq` (needs `boq:view`).
