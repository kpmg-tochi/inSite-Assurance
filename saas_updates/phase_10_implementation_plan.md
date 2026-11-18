# Phase 10: Stakeholder Handover and Retention / Defects Liability

| | |
| :--- | :--- |
| **Status** | Not started |
| **Depends on** | Phase 6 (project lifecycle, contractors), Phase 7 (module switches, disbursement chain, direct release) |
| **Unblocks** | none |
| **Read first** | [Master plan](saas_implementation_plan.md) sections 2, 3 and 6 |

---

## 1. Overview

**Objective:** cover the end of a project's life.

1. **Handover:** send external stakeholders (community representatives, client staff, end users) a secure link where they can accept the works, accept with snags, or reject, with comments and attachments. No account needed.
2. **Retention:** hold back a percentage of certified value, track defects during the liability period against the responsible contractor, and release the retained money only when the period has elapsed and defects are closed.

**In scope:** construction-phase sub-states on a project, handover links and submissions, a public handover page, retention accrual, defect tickets, retention release through the disbursement chain.

**Out of scope:** e-signature products, payments integration, a general ticketing system.

---

## 2. Context for the implementing agent

- Project lifecycle from Phase 6 is `DRAFT`, `ACTIVE`, `ARCHIVED`. This phase adds a second field for where an active project is in its life; it does not change the three statuses.
- `ProjectProcessConfig.enableHandoverModule` and `enableRetentionModule` exist from Phase 7 and switch nothing yet. Everything here is hidden and refused when the switch is off.
- Disbursement after Phases 3 and 7: a `ValuationReport` (source `IPC_CLAIM` or `MILESTONE_DIRECT`) moves through the project's disbursement chain to a final `TrancheDecision`, with server-computed amounts, bounds, CP rules and segregation of duties. Holdback today means "claimed minus recommended release" on one valuation; it is not retention and is not accumulated anywhere.
- `ProjectContractor` (Phase 6) is the liable party for defects; in the unified model, the main contractor is liable unless a ticket names a subcontractor.
- Storage is object keys plus the authenticated media endpoint (Phase 2). External stakeholders have no token, so handover uploads need their own narrowly scoped path.
- Outbound messages (Phase 8) can send email; SMS depends on D-8.1.
- Permissions `handover:manage_links`, `handover:review_feedback`, `retention:manage_defects`, `retention:release_escrow` exist and gate nothing yet.
- Mobile can already capture signed, geotagged photos (Phase 4). Defect verification should reuse that.
- There are no public (unauthenticated) API routes today other than login and join. Treat the handover endpoints as the most exposed surface in the system.

---

## 3. Decisions

**No owner input required.** Assumptions:

| Assumption | Detail |
| :--- | :--- |
| Retention is a percentage withheld from each certified release | Set per project (typical values are 5 to 10 percent). It accumulates in a retention balance. Half may be released at practical completion and half at the end of the liability period, configurable; default is all at the end. |
| Retention release reuses the disbursement chain | A retention release is a valuation with source `RETENTION_RELEASE`, so the same approvers, bounds and audit apply. |
| Handover does not release money by itself | An accepted handover is a precondition the monitor confirms; it starts the liability period. |
| Stakeholders are identified by the link plus a one-time code | The link alone is not enough when the tenant requires a code. Default: code required. |
| Stakeholder media | Photos and documents up to a size cap; audio or video up to a larger cap; no executable types. Files are quarantined from the main evidence set and never count as field evidence. |

---

## 4. Schema changes

- `Project`: add `constructionPhase ConstructionPhase @default(ACTIVE_CONSTRUCTION)` (`ACTIVE_CONSTRUCTION | HANDOVER_IN_PROGRESS | RETENTION_PERIOD | COMPLETED_CLOSED`), `retentionPercentage Decimal?`, `retentionReleaseAtCompletionPct Decimal @default(0)`, `retentionDurationMonths Int?`, `practicalCompletionDate String?`, `retentionStartDate String?`, `retentionEndDate String?`, `retentionHeldNgn Decimal @default(0)`, `retentionReleasedNgn Decimal @default(0)`.
- `TrancheDecision`: add `retentionWithheldNgn Decimal @default(0)`.
- `ValuationReport.source`: add `RETENTION_RELEASE`.
- New `HandoverLink (id, projectId, tokenHash @unique, label, recipientName, recipientContact, stakeholderType, requiresOtp, otpHash?, otpExpiresAt?, otpAttempts, expiresAt, maxSubmissions @default(1), revokedAt?, createdByUserId, createdAt, lastAccessedAt?)`.
- New `HandoverSubmission (id, handoverLinkId, projectId, decision ACCEPTED|ACCEPTED_WITH_SNAGS|REJECTED, submitterName, submitterRole, feedbackText @db.Text, snagsJson, attachmentsJson, submittedAt, clientIp, userAgent, reviewedByUserId?, reviewedAt?, reviewNotes?)`.
- New `RetentionDefectTicket (id, projectId, projectContractorId, boqItemId?, sourceHandoverSubmissionId?, title, description, severity, status OPEN|ASSIGNED|RECTIFIED_PENDING_VERIFICATION|VERIFIED_CLOSED|REJECTED_NOT_A_DEFECT, dueDate?, raisedByUserId, rectificationCaptureIds Json, verifiedByUserId?, verifiedAt?, createdAt, updatedAt)`.
- Audit actions: `HANDOVER_LINK_CREATED`, `HANDOVER_LINK_REVOKED`, `HANDOVER_SUBMITTED`, `HANDOVER_REVIEWED`, `PROJECT_PHASE_CHANGED`, `RETENTION_WITHHELD`, `DEFECT_TICKET_RAISED`, `DEFECT_TICKET_UPDATED`, `DEFECT_TICKET_CLOSED`, `RETENTION_RELEASED`.

---

## 5. Implementation checklist

### Step 1: Project phases
- [ ] Shared transition guard for `constructionPhase`: construction to handover (monitor action, all tranches decided or an explicit override with reason), handover to retention (requires a reviewed, accepted handover; sets practical completion and retention dates), retention to closed (retention fully released, or zero retention). No backwards moves except handover back to construction with a reason.
- [ ] Endpoints guarded by `projects:edit_baseline`, audited with `PROJECT_PHASE_CHANGED`.
- [ ] During `RETENTION_PERIOD` and `COMPLETED_CLOSED`: no new IPCs or briefs; reporting obligations stop; field access is limited to defect work.

### Step 2: Handover links (authenticated side)
- [ ] Create link (`handover:manage_links`): generate a 256-bit random token, store only its hash, return the URL once. Options: expiry (default 14 days, max 60), code required, recipient details, maximum submissions.
- [ ] Send the link by outbound message (Phase 8) and the one-time code by a separate message at access time.
- [ ] List, revoke and re-issue. Revoking takes effect immediately.
- [ ] Review submissions (`handover:review_feedback`): mark reviewed with notes; convert listed snags into defect tickets in one action.

### Step 3: Public handover endpoints
- [ ] Mounted on a separate router with its own strict rate limits per IP and per token, small body limits, and no access to any other route.
- [ ] `GET /public/handover/:token`: constant-time token lookup by hash; returns only what the stakeholder needs (tenant name and logo, project name and location, a monitor-written handover summary, whether a code is required). Generic 404 for unknown, expired or revoked links.
- [ ] `POST .../otp/request` and `.../otp/verify`: six-digit code, hashed, ten-minute expiry, five attempts, then lock the link until re-issued. Verification returns a short-lived handover session token bound to that link.
- [ ] `POST .../uploads/presign`: only with a handover session; allow-listed content types; size caps; keys under `tenants/{id}/projects/{id}/handover/{linkId}/`; a per-link total cap.
- [ ] `POST .../submit`: validates against `maxSubmissions`, stores the submission with IP and user agent, writes `HANDOVER_SUBMITTED`, notifies users with `handover:review_feedback`.
- [ ] Free text is stored as text and rendered escaped. "Rich text" means a small allow-list (paragraphs, lists, bold, italics) sanitised on the server; no raw HTML is ever stored or rendered.
- [ ] Uploaded files are served to reviewers only through the authenticated media endpoint, with `Content-Disposition: attachment` for anything that is not an image, audio or video.

### Step 4: Public handover page (web)
- [ ] Route outside the authenticated shell, tenant-branded, mobile-first, no navigation to the rest of the app: summary, code entry, decision (three options), feedback, snag list (title, location, photo), attachments with progress, review and submit, confirmation screen.
- [ ] Works on low bandwidth: resumable or chunk-safe uploads where the storage provider allows; clear retry on failure; nothing lost on refresh before submit (local draft).
- [ ] Plain-language copy; no jargon about tranches or IPCs.

### Step 5: Retention accrual
- [ ] Wizard "Facility" step and project settings: retention percentage, liability duration, release split. Hidden when the module is off.
- [ ] In the lender decision (Phase 3 code path), when retention is enabled: `retentionWithheldNgn = approved amount x retention percentage`; the amount released to the contractor is the approved amount minus that; add it to `Project.retentionHeldNgn`; write `RETENTION_WITHHELD`. Show the split in the lender modal, the valuation PDF and the ledger.
- [ ] Reversal (Phase 3) reverses the withheld part too.
- [ ] Retention is tracked per contractor in multi-prime (store per `ProjectContractor`, sum for the project).

### Step 6: Defect tickets
- [ ] CRUD and status transitions (`retention:manage_defects`): raise (monitor, or from a handover snag), assign to a `ProjectContractor`, contractor marks rectified with evidence, monitor verifies and closes or reopens, or rejects as not a defect with a reason.
- [ ] Contractor web users see and update only their own tickets.
- [ ] Mobile: a "Defects" list for sessions belonging to the liable contractor and for verifiers; rectification and verification photos go through the Phase 4 capture path and are linked by capture ID.
- [ ] Notifications on assignment, rectification and closure; overdue reminder from a `defect-reminders` job.

### Step 7: Retention release
- [ ] `POST /projects/:projectId/retention/release-request` (`retention:release_escrow` to initiate): creates a `RETENTION_RELEASE` valuation for a contractor.
- [ ] Preconditions checked by the server: phase is `RETENTION_PERIOD`; for the final release, today is on or after `retentionEndDate` and the contractor has no ticket in `OPEN`, `ASSIGNED` or `RECTIFIED_PENDING_VERIFICATION`; for the completion-stage release, practical completion is set. Amount is bounded by the contractor's held balance and the configured split.
- [ ] It then runs through the disbursement chain exactly like any other valuation (certification step by a licensed monitor, release step by the lender, same-user block).
- [ ] On the final decision: reduce held, increase released, write `RETENTION_RELEASED`. When held reaches zero for all contractors, allow the move to `COMPLETED_CLOSED`.

### Step 8: Web (authenticated)
- [ ] Project "Handover" tab: links table with status, create and revoke; submissions with decision, feedback, snags and attachments; review action; "create defect tickets from snags".
- [ ] Project "Retention and defects" tab: held, released and remaining per contractor; liability period countdown; ticket board by status; release request button with the unmet preconditions listed when disabled.
- [ ] Phase banner and phase-change actions on the project header.
- [ ] Executive view: projects in retention with held amounts and days remaining.

### Step 9: Seed and tests
- [ ] Seed one project in handover with a pending link and one in retention with two tickets.
- [ ] Tests:
  - phase transitions, allowed and refused
  - handover token: unknown, expired and revoked look identical; code lockout; rate limits; submission cap; HTML in feedback is neutralised; disallowed upload types refused; a handover session token cannot call any other route
  - retention arithmetic across three releases and a reversal; per-contractor balances in multi-prime
  - release refused before the end date and with an open ticket; allowed after; chain and segregation rules apply
  - module switches off: endpoints return 404 and UI is hidden

---

## 6. Definition of done

- A stakeholder with no account completes a handover from a phone, and the monitor turns their snags into tickets.
- Retention is withheld on every release, visible everywhere money is shown, and cannot be released early or with open defects.
- The public endpoints pass the abuse tests above.
- Master plan status updated; all phases complete.

## 7. Found during implementation

_Add items here rather than expanding scope._
