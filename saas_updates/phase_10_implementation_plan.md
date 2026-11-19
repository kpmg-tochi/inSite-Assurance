# Phase 10: Stakeholder Handover and Retention / Defects Liability

| | |
| :--- | :--- |
| **Status** | Implemented; web clicked through; mobile on-device testing pending (see section 7) |
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
- `ProjectProcessConfig.enableHandoverModule` and `enableRetentionModule` exist from Phase 7. Everything here is hidden and refused when the switch is off.
- Disbursement after Phases 3 and 7: a `ValuationReport` (source `IPC_CLAIM`, `MILESTONE_DIRECT` or, from this phase, `RETENTION_RELEASE`) moves through the project's disbursement chain to a final `TrancheDecision`, with server-computed amounts, bounds, CP rules and segregation of duties.
- `ProjectContractor` (Phase 6) is the liable party for defects; in the unified model, the main contractor is liable unless a ticket names a subcontractor.
- Storage is object keys plus the authenticated media endpoint (Phase 2). External stakeholders have no token, so handover uploads have their own narrowly scoped path.
- Outbound messages (Phase 8) send email; SMS depends on D-8.1.
- Permissions `handover:manage_links`, `handover:review_feedback`, `retention:manage_defects`, `retention:release_escrow` now gate the features below.
- Mobile captures signed, geotagged photos (Phase 4). Defect verification reuses that.
- The handover endpoints are the only public routes besides login and join; treat them as the most exposed surface.

---

## 3. Decisions

**No owner input required.** Assumptions, as built:

| Assumption | Detail |
| :--- | :--- |
| Retention is a percentage withheld from each certified release | Set per project on the Facility step (0 to 20%). Applied at the lender decision. Release at practical completion is a configurable share of everything withheld (default 0 = all at the end). |
| Retention release reuses the disbursement chain | A retention release is a valuation with source `RETENTION_RELEASE`, so the same approvers, bounds and audit apply. |
| Handover does not release money by itself | An accepted, reviewed handover is a precondition for the liability period; it starts the period. |
| Stakeholders are identified by the link plus a one-time code | Default: code required (email). The monitor can create a no-code link. |
| Stakeholder media | Photos 15 MB, PDF 20 MB, audio/video 100 MB, 300 MB and 60 files per link; no executables, archives, HTML or SVG. Quarantined under `.../handover/{linkId}/`, never registered as captures. |

Decisions taken during implementation (also in section 7):

| Topic | Decision |
| :--- | :--- |
| Who initiates vs certifies a release | `POST /retention/release-request` (`retention:release_escrow`, lender by default) creates a `RetentionReleaseRequest`. A licensed holder of the project's certification permission certifies it, which creates the `RETENTION_RELEASE` valuation and starts the chain. The lender releases at the last step; certifier ≠ releaser. |
| Money flow | The tranche records the full approved amount; `Project.disbursedToDateNgn` (paid to the contractor) increases by approved minus retention. A retention release never touches a tranche or its CPs; it moves held → released and increases `disbursedToDateNgn`. |
| Anchor tranche | `ValuationReport.trancheId` is required, so retention valuations are anchored on the project's last tranche (accounting only). |
| Retention split | IPC: the claim's contractor. Direct milestone in multi-prime: split by verified amount per item owner. Unified/single: main contractor. The split is stored on `TrancheDecision.retentionAllocationJson` so a reversal undoes exactly what was withheld; reversal is refused if that retention was already released. |
| Defect sides | Told apart by organisation, not role: a web user whose organisation is a contractor on the project (or a `CONTRACTOR_EXECUTOR` field session) is the liable side and only marks own tickets fixed; everyone else with `retention:manage_defects` raises, assigns, verifies, reopens, rejects. |
| Handover module off | Handover → retention needs a reviewed, accepted handover only when the handover module is on; otherwise the monitor records practical completion directly. |

---

## 4. Schema changes (as built)

Migrations `20261124090000_phase10_handover_retention`, `20261124091000_phase10_release_request_audit`, `20261124092000_phase10_notification_targets` (`WebNotification.targetOrganizationId` and `hideFromProjectContractors`; mobile `DEFECT_UPDATE` and `OPEN_DEFECTS`). No hand-written SQL needed; the Phase 7 `ValuationReport` CHECKs already allow `RETENTION_RELEASE` (no IPC, no verification).

- `Project`: `constructionPhase` (`ACTIVE_CONSTRUCTION | HANDOVER_IN_PROGRESS | RETENTION_PERIOD | COMPLETED_CLOSED`), `constructionPhaseChangedAt`, `retentionPercentage`, `retentionReleaseAtCompletionPct`, `retentionDurationMonths`, `practicalCompletionDate`, `retentionStartDate`, `retentionEndDate`, `retentionHeldNgn`, `retentionReleasedNgn` (sums of the contractor balances).
- `ProjectContractor`: `retentionHeldNgn`, `retentionReleasedNgn`.
- `TrancheDecision`: `retentionWithheldNgn`, `retentionAllocationJson`.
- `ValuationReport.source`: `RETENTION_RELEASE`.
- `HandoverLink` (plan fields plus `handoverSummary`, `lockedAt`, `reissuedFromLinkId`, `reservedUploadBytes`, `reservedUploadCount`).
- `HandoverSubmission` (as planned).
- `RetentionDefectTicket` (plan fields plus `ticketNumber`, `location`, `sourceSnagIndex`, `snagPhotoKeys`, `assignedAt`, `rectificationNotes`, `rectifiedAt`, `rectifiedByLabel`, `verificationCaptureIds`, `verificationNotes`, `verifiedByLabel`, `resolutionReason`, `reopenCount`).
- New `RetentionReleaseRequest` (`stage COMPLETION|FINAL`, `amountNgn`, `status PENDING_CERTIFICATION|CERTIFIED|CANCELLED`, `valuationReportId`).
- Audit actions: the ten planned plus `RETENTION_RELEASE_REQUESTED`, `RETENTION_RELEASE_CANCELLED`.

---

## 5. Implementation checklist

Verification: server route tests `src/tests/routes.phase10.test.ts` (24 tests), unit tests `src/tests/retention.phase10.test.ts`, mobile `src/utils/defects.test.ts`, and browser click-throughs on 2026-11-19: the public page at phone width (including a dropped connection and a resumed 12 MB upload), the Handover tab, the Retention tab as monitor, lender and certifier (request, certify, release), the Facility step retention fields and validation, the lender decision window on a milestone valuation, and the executive view.

### Step 1: Project phases
- [x] Shared transition guard (`shared/src/utils/retention.ts` table + `modules/closeout/projectPhase.service.ts`): construction → handover (undecided IPCs/valuations need an override with reason), handover → retention (reviewed accepted handover; sets practical completion and liability dates; excuses pending reporting obligations), retention → closed (nothing held). Only backwards move: handover → construction with a reason.
- [x] `GET/POST /projects/:id/phase`, POST guarded by `projects:edit_baseline`, audited `PROJECT_PHASE_CHANGED`.
- [x] During `RETENTION_PERIOD` and `COMPLETED_CLOSED`: IPC submission, milestone verification and brief generation refused (`PROJECT_CONSTRUCTION_ENDED`); scheduled construction jobs skip the project (`LIVE_PROJECT_WHERE`); field sessions may only write defect work (defects, captures, presign, telemetry, notifications). Tested: field report refused, brief dispatch refused. IPC/milestone refusal is covered by code only.

### Step 2: Handover links (authenticated side)
- [x] Create (`handover:manage_links`, only in handover): 256-bit token, SHA-256 stored, URL returned once.
- [x] Link emailed (`HANDOVER_LINK` template); code sent separately at access time (`HANDOVER_CODE`). Link and code are redacted from the stored payload after delivery.
- [x] List, revoke (immediate), re-issue (revokes old, new token, clears a lockout).
- [x] Review (`handover:review_feedback`, once) and "create defect tickets from snags" (also needs `retention:manage_defects`; idempotent per snag).

### Step 3: Public handover endpoints
- [x] Own router at `/api/v1/public/handover`, mounted before the app JSON parser: 64 kb body limit, per-IP and per-token rate limits, `no-store`, own 404.
- [x] `GET /:token`: hash lookup; identical 404 for unknown, malformed, expired, revoked, or no-longer-in-handover links; returns only the listed fields.
- [x] `otp/request` and `otp/verify`: six digits, HMAC-hashed, 10 minutes, single use, five attempts then locked (423) until re-issued. Session token: separate signing key, audience `handover`, bound to the link, 2 hours. `POST /:token/session` for no-code links.
- [x] `uploads/presign`: session required, allow-list, per-file caps, atomic per-link byte and file caps, keys under `.../handover/{linkId}/`.
- [x] `submit`: session, `maxSubmissions` under row lock, files confirmed against storage (type and size from storage, not the client), IP and user agent, `HANDOVER_SUBMITTED`, web notification to reviewers.
- [x] Text stored as sanitised plain text; formatting (paragraphs, lists, bold, italics) parsed and rendered as React text nodes, never HTML.
- [x] Handover files served only to `handover:review_feedback` through the media endpoint, `Content-Disposition: attachment` unless image/audio/video; capture registration refuses handover keys.

### Step 4: Public handover page (web)
- [x] `/handover/:token` outside the shell, tenant colour and logo (https only), mobile-first: summary, code entry, three decisions, feedback, snags with photos, attachments with progress, review, confirmation. Clicked through at 390 px.
- [x] Low bandwidth: a local draft survives refresh; files above 5 MB go up in 5 MB parts (S3 multipart; local storage mimics it) with per-part retry. The server issues a signed upload ticket bound to the link (no table). On resume the page asks which parts arrived and sends only the rest; after a reload the upload shows as paused until the same file is chosen again. Route-tested and clicked through (part 1 not re-sent after a reload; assembled file byte-exact).
- [x] Plain-language copy.

### Step 5: Retention accrual
- [x] Facility step and live settings: percentage, liability period, release split. Clicked through (saved, audited, validation when the period is missing).
- [x] Lender decision: withheld = approved × percentage, split per contractor, `RETENTION_WITHHELD` audit. Split shown in the lender decision window (clicked through: preview of ₦1,000,000 on ₦20,000,000 matched what the server withheld), the valuation PDF (generated, content not inspected) and the audit ledger summaries.
- [x] Reversal reverses the withheld part with the same split.
- [x] Per-contractor balances in multi-prime.

### Step 6: Defect tickets
- [x] Raise, assign, mark fixed with evidence (captures by clientCaptureId), verify close / reopen with reason, reject as not a defect with reason.
- [x] Contractor web users see and update only their own tickets (others are 404).
- [ ] Mobile "Defects" screen for the liable contractor and verifiers, photos through the Phase 4 capture path, action queued in the outbox (`DEFECT_ACTION`) behind its captures: typecheck and unit tests only; on-device run pending.
- [x] Aimed notifications. Contractor-facing ones (assigned, closed, reopened, rejected, its own overdue tickets) reach only the liable contractor: its organisation's web users, and the field sessions joined through that contractor's join codes (mobile `DEFECT_UPDATE` with push, opening the Defects screen). Monitoring-side ones ("fixed: verify", overdue summary) are hidden from every contractor on the project and also go to the verifiers' devices. `defect-reminders` job once per project per day. Route-tested.
- [x] Evidence follows the project's reporting set-up. When contractors report from site, the contractor's repair photos come with "mark fixed". When only the monitoring side reports (`allowContractorFieldReporting` off), a verifier may close an Open/Assigned ticket after seeing the repair on site, and closing needs their photos (`VERIFICATION_EVIDENCE_REQUIRED`); web users can only reopen. Route- and unit-tested; mobile on-device pending.

### Step 7: Retention release
- [x] `POST /projects/:id/retention/release-request` (`retention:release_escrow`) creates a request; certification creates the `RETENTION_RELEASE` valuation.
- [x] Preconditions checked by the server at request, certification and again at the lender decision (a ticket raised after certification blocks release).
- [x] Runs through the disbursement chain (licensed certifier, lender release step, same-user block tested).
- [x] Final decision moves held → released, `RETENTION_RELEASED`; closing the project allowed once nothing is held.

### Step 8: Web (authenticated)
- [x] Project "Handover" tab: links table with status, create, revoke, re-issue; submissions with decision, formatted feedback, snags with photos, attachments, review, snags → tickets. Clicked through.
- [x] Project "Retention and defects" tab: held/released/pending per contractor, countdown, stage options with unmet preconditions listed, release requests with certify/approve-step/decide/cancel, defect board with server-driven actions. Clicked through as monitor, lender (request, decide) and certifier (certify; the certifier gets no decide button).
- [x] Phase banner and phase-change actions on the project header. Viewed.
- [x] Executive view "Projects in retention" section. Clicked through (totals and per-project rows matched the retention tabs).

### Step 9: Seed and tests
- [x] Seed: OGN-501 in handover with a pending code link (URL printed by the seed), KWR-502 in its liability period with 5% retention held and two tickets. The seed reset clears the new tables; re-running the seed works.
- [x] Tests: phase transitions; token indistinguishability, lockout, rate limits, submission cap, HTML neutralised, disallowed types, session token isolation; retention arithmetic over three releases and a reversal; multi-prime split; release refused before the end date and with an open ticket, allowed after, chain and segregation; module switches return 404. (UI hiding with the switch off is enforced in code; not separately clicked.)

---

## 6. Definition of done

- [x] A stakeholder with no account completes a handover from a phone, and the monitor turns their snags into tickets (route tests and browser click-through).
- [x] Retention is withheld on every release and cannot be released early or with open defects (route tests). "Visible everywhere money is shown": decision DTO, lender decision window, PDF, audit ledger, retention tab, executive view (all but the PDF content clicked through).
- [x] The public endpoints pass the abuse tests above.
- [x] Master plan status updated; all phases complete.

## 7. Found during implementation

1. **Retention release needs a request record.** The plan's release-request endpoint is for `retention:release_escrow` (the lender), but a valuation needs a licensed certifier at creation. Added `RetentionReleaseRequest`; certification creates the valuation. Two extra audit actions record request and cancel.
2. **Anchor tranche.** Retention valuations are attached to the project's last tranche because `ValuationReport.trancheId` is required. Making it nullable would be cleaner but touches every valuation reader.
3. **`disbursedToDateNgn` now means "paid to the contractor"** (net of retention). Tranche `releasedAmountNgn` still records the full approved amount, so the two differ by the held retention on retention projects.
4. **Resolved: defect notifications are aimed.** Join codes bind field sessions to a contractor, so contractor-facing mobile notifications go to that contractor's sessions only. Web users have no join code, so they are matched by organisation (`WebNotification.targetOrganizationId`); monitoring-side notifications are hidden from project contractors (`hideFromProjectContractors`). Other notification categories are unchanged.
5. **Resolved: mobile defect notifications** (`DEFECT_UPDATE` / `OPEN_DEFECTS`, pushed after commit, opening the Defects screen).
6. **Resolved: evidence follows the reporting set-up.** With contractor field reporting off, the monitoring side captures the repair evidence and closes the ticket from the field app.
7. **Resolved: resumable uploads.** Operational follow-up for production: abandoned multipart uploads keep their parts, so the S3 bucket needs a lifecycle rule `AbortIncompleteMultipartUpload` (e.g. 7 days), and its CORS must allow PUT from the portal origin (no ETag exposure needed: the server completes from its own part list). Local development leaves `<object>.parts/` folders for abandoned uploads.
8. **OTP email cap.** Codes use the Phase 8 recipient cap (5 messages/day/address), which also limits code requests. Acceptable as abuse control; may need its own limit.
9. **Resolved: lint error** in `server/src/integrations/textExtractor.ts` (NUL removal no longer uses a control character in a regex). `npm run lint`: 0 errors.
10. **Production config.** `WEB_APP_BASE_URL` (https) is now required in production for handover links.
11. **Phase 5 route test fixture** updated: the tenant now has seven projects visible through `projects:view_all_tenant`.
12. **Browser automation note.** During the click-through the automated browser stopped delivering mouse input to one tab (no events reached the page; a direct DOM click opened the dialog). A fresh browser session worked normally. Not an app defect, recorded so it is not chased again.
