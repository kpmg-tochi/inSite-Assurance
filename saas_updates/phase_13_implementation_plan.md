# Phase 13: Document Register, Contract Milestones, Kick-off and Mobilisation Compliance

| | |
| :--- | :--- |
| **Status** | Not started |
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

### Step 1: Document register
- [ ] Shared schemas and DTOs; `documentTypeRules` helper (mime, sign-off).
- [ ] Server `modules/documents/`: upload (reuses presign + multipart; server reads size, type and SHA-256 from storage), new version, list with filters, download through the media endpoint (permission + project + contractor visibility), sign-off (refuses a second sign-off by the same user on the same version), archive.
- [ ] CP evidence picks a register document.
- [ ] Document types managed in tenant settings.
- [ ] Web: project "Documents" tab (table by type, versions drawer, sign-off list, upload with progress); reusable `DocumentPicker` for other screens.

### Step 2: Contract step and milestone generation
- [ ] New setup step `contract` (order 25, required when the type has milestones): fields in section 4; validation award ≤ signed ≤ kick-off.
- [ ] Shared pure `computeMilestoneDueDates(templates, anchors, workWeek)` (table tests: calendar vs working days, negative offsets, chained milestones, a missing anchor leaves the date null).
- [ ] Applying the project type (Phase 11) creates milestone rows from the snapshot; `perContractor` templates create one row per contractor and follow contractor add/remove while a draft.
- [ ] Changing an anchor recomputes pending rows; audited.

### Step 3: Milestone tracking and notifications
- [ ] `POST .../milestones/:id/complete` checks required documents present and signed where needed; `.../waive`.
- [ ] Job `milestone-deadlines` (hourly, one `JobRun` per project-day): `PENDING → DUE` on the due date, `→ OVERDUE` after it; notifications to the responsible role within the responsible organisation scope; reminders using the project's reminder offsets (Phase 8 pattern); register in `registerAllJobs()`.
- [ ] Web: project "Milestones" tab: ordered checklist with anchor, due date, days left / overdue, evidence, actions; a compact "Next deadlines" card on the project overview; overdue count on the directory row.
- [ ] Optional activation gate: `documentRequirements.beforeActivation` checked by activation readiness.

### Step 4: Kick-off meeting
- [ ] Create / edit the meeting; invitees by stakeholder group (pre-filled from parties, beneficiaries and assigned users).
- [ ] "Send notice": one email per invitee with date, location and the briefing pack link (authenticated or, for externals, the agenda as attachment); records `outboundMessageId`; refuses if fewer than `noticeLeadDays` remain unless waived.
- [ ] "Record meeting held": attendance per invitee, computed quorum, minutes document, sign-off requests to attendees with accounts.
- [ ] Auto-completes the kick-off milestones (`AUTO_KICKOFF_QUORUM`); sets `kickoffHeldAt`. If the meeting is held on a different day from the planned date, ask whether to move the anchor (default yes) and recompute.

### Step 5: Contractor mobilisation compliance
- [ ] `AUTO_CONTRACTOR_ON_SITE` completion from the first in-geofence check-in (hook in `firstCheckIn` path; idempotent).
- [ ] Mobilisation compliance panel on the existing mobilisation page: per contractor, deadline, days left, check-in status, documents still missing from `beforeMobilisation`.
- [ ] Phase 12 hook: completion rule `CONTRACT_MILESTONE_DONE` for a payment milestone (e.g. an advance tied to signed contract), available but unused by the seed.

### Step 6: Default cases and termination
- [ ] Overdue mobilisation milestone opens a case automatically (once per milestone) and notifies the role(s) holding `contracts:raise_default` and the Legal role named in the project type; manual raise for other defaults.
- [ ] Case moves through the `CONTRACT_DEFAULT` chain (reuse engine, versioning, `RETURN`). Final decision: `CURE_PERIOD` (new due date), `EXTENSION_GRANTED` (moves the milestone's due date, audited), `TERMINATED`, or `CLOSED` (no action).
- [ ] Termination (one transaction): contractor `TERMINATED`; its join codes deactivated; its field sessions revoked; open IPCs closed as withdrawn; direct verifications and briefs exclude its items; its open defect tickets stay open for the record.
- [ ] Replacement: add a contractor with `replacesProjectContractorId`; move uncertified BOQ items to it (certified % stays history); new mobilisation milestone generated from the type with anchor `MILESTONE:<termination>` or a new kick-off.
- [ ] Web: "Default cases" panel on the contractor card and project overview; chain editor gains the third chain type.

### Step 7: Programme of works
- [ ] Contractor web users with `schedule:propose_programme` submit item dates and dependencies (same validation as the baseline). One pending submission per contractor.
- [ ] Monitor accepts (writes the baseline through the existing service, auto-completes the milestone) or returns with notes.
- [ ] Before activation only, or after activation for items still undated; dated live items keep moving only through Phase 9 revisions.

### Step 8: Seed and tests
- [ ] Seed both types' milestone templates:
  - Central: acceptance letter (award + 3 days), kick-off notice (kick-off − 7), kick-off held (kick-off), minutes signed (kick-off + 7), letter of introduction (kick-off + 7), supervisor assignment (kick-off + 7), mobilisation documents complete (kick-off + 14), contractor mobilised (kick-off + 21).
  - Co-Funded: as Central, plus programme of works and mobilisation plan (kick-off + 0), minutes approved and uploaded (kick-off + 3 working days); contractor mobilised (kick-off + 14).
- [ ] Seed one Central project mid-mobilisation (kick-off held, minutes signed, mobilisation due in 5 days) and one Co-Funded project with an overdue mobilisation and an open default case at the second chain step.
- [ ] Route tests: due-date maths; anchor move recompute; completion refused without required signed documents; job transitions and one notification per state; quorum; auto mobilisation completion from a check-in; default case chain with org scope; termination side effects; replacement keeps history; contractor document visibility; programme of works accept writes the baseline.

---

## 6. Definition of done

- A project of either type shows every post-award obligation with a due date computed from the kick-off date, and overdue ones are flagged and notified.
- The kick-off record proves notice, quorum and signed minutes.
- A contractor that has not checked in on site by kick-off + N days triggers a default case that reaches the right executive and can end in termination and replacement without losing history.
- All required documents are in one register with versions and sign-offs.
- Master plan status updated; CLAUDE.md gains a "Contract milestones and documents (Phase 13)" paragraph.

## 7. Found during implementation

*(empty)*
