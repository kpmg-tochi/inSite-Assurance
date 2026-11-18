# Phase 3: Disbursement Integrity, Reconciliation Workflow and Rating Labels

| | |
| :--- | :--- |
| **Status** | Implemented, with carry-overs (section 7). Server verified by tests; web built and typechecked, not clicked through in a browser. |
| **Depends on** | Phase 2 |
| **Unblocks** | Phases 6, 7, 10 |
| **Read first** | [Master plan](saas_implementation_plan.md) sections 2, 3 and 6 |

---

## 1. Overview

**Objective:** make the path from contractor claim to lender release trustworthy. Amounts are computed by the server, the certifier is the authenticated professional, states can only move forward in a defined order, and releases are bounded. Also deliver tenant-configurable evidence rating labels, because they touch the same files.

**In scope:** IPC state machine, certification rules, lender decision rules, queries, AI reconciliation correctness and provenance, derived project metrics, rating labels, and the web reconciliation workbench.

**Out of scope:** where evidence comes from (Phase 4), IPC-optional direct milestone release and configurable approval chains (Phase 7), multi-contractor IPCs (Phase 6).

---

## 2. Context for the implementing agent

**The flow today** ([reconciliation.service.ts](../server/src/modules/reconciliation/reconciliation.service.ts), [reconciliation.routes.ts](../server/src/modules/reconciliation/reconciliation.routes.ts)):
1. `submitContractorIpcClaim` creates an `IpcClaim` with line items, then calls `runAiReconciliationForIpc` synchronously outside the transaction.
2. `runAiReconciliationForIpc` sends each line with its confirmed `FieldEvidenceLog` rows to `azureOpenAiService.reconcileIpcLineItems`, stores a rating per line and sets `Project.portfolioHealth`.
3. Monitor raises queries (`createMonitorLineQuery`), contractor responds (`respondToMonitorLineQuery`), monitor certifies (`certifyIpcValuationByMonitor`, upserts `ValuationReport`), lender decides (`recordLenderTrancheDecision`, upserts `TrancheDecision`).

**What is wrong with it**
- No state checks. Any step can run in any state, including re-certifying after the lender decided and responding to a query after certification (which changes the claimed amount).
- `certifierFullName`, `certifierLicenseType`, `certifierLicenseNumber` come from the request. The web sends `user.professionalLicenseNumber || "3842"` and hardcodes `certifierDigitalSignatureAck: true` with no checkbox ([ReconciliationWorkbenchPage.tsx](../web/src/pages/reconciliation/ReconciliationWorkbenchPage.tsx), `handleCertify`).
- `monitorCertifiedAmountNgn`, `recommendedReleaseAmountNgn` and `approvedDisbursementAmountNgn` are client-supplied and unchecked against each other, the tranche allocation or Conditions Precedent.
- A second lender decision increments `releasedAmountNgn` and `disbursedToDateNgn` again (formerly TD-P2-3). `APPROVE_FULL` forces `portfolioHealth` to `EVIDENCE_SUPPORTED`.
- Nothing ever sets a `MonitorQuery` or `ReportQuery` to `RESOLVED`.
- `Project.certifiedProgressPct` is read in many places and never written.
- "Open conflicts" and "unfulfilled hold points" are computed two different ways in `listProjectsForUser` and `getPortfolioExecutiveSummary` ([projects.service.ts](../server/src/modules/projects/projects.service.ts)).
- Tenant Super Admin receives every permission in `createTenantWithDefaults`, including certify and approve, and `hasWebPermission` lets a platform super admin pass every check.

**AI reconciliation** ([azure-openai.service.ts](../server/src/integrations/azure-openai.service.ts), `reconcileIpcLineItems`):
- The rules (hold point needs independent evidence, contractor-only evidence caps the rating) exist only as prompt text. The model's answer is stored unchecked.
- The user message is `JSON.stringify(params)`, which includes free-text field notes written by the party being assessed.
- On any error it silently falls back to deterministic rules that never compare quantities: one in-geofence independent log yields `SUPPORTED` for any claimed percentage.
- The audit entry always names the actor `AZURE-GPT4O-RECONCILER`, whichever engine ran.
- Evidence is every confirmed log for the BOQ item, ever, not bounded by the claim period.

**Rating values are hardcoded** in: Prisma enum `EvidenceStrengthRating`, `shared/src/enums.ts` (`EvidenceStrengthRatingEnum`, `EVIDENCE_RATING_META`, which the web ignores), `web/src/components/EvidenceBadge.tsx`, `EvidenceOverlayDrawer.tsx`, `ReconciliationWorkbenchPage.tsx` (local label and variant maps, KPI counts, row tint), `web/src/api/types.ts`, and [pdf-report.service.ts](../server/src/integrations/pdf-report.service.ts). Colours already disagree between these places. Per master decision B, only the label and description become configurable.

**Web workbench defects to fix here**
- "Submit First IPC Claim" opens a modal that is rendered after the `!selectedIpc` early return, so a project with no IPC can never create one.
- `handleSubmitIpc` is a stub: first tranche, first four BOQ items, previous percentage plus 15.
- Certification summary, credit-committee reference and lender notes are demo strings used as form defaults outside demo mode.
- `APPROVE_FULL` sends the monitor's recommended amount; the lender cannot enter an amount.
- [EvidenceOverlayDrawer.tsx](../web/src/components/EvidenceOverlayDrawer.tsx) falls back to `projectEvidenceLogs[0]` when nothing matches the line, shows a fake audio player with a fixed duration, and prints "Human-Confirmed" and "(Verified)" unconditionally.
- Pages toast in addition to mutation hooks. `useTelemetryMutations.ts` invalidates `["project-audit", id]`; the real key is `['audit-trail', id]`. PDF export has no error handling.

**Seam with Phase 4.** Phase 4 changes where evidence comes from. To keep the two phases independent, this phase introduces one function, `getEvidenceForBoqItems(projectId, boqItemIds, upTo)`, in a new `server/src/modules/evidence/evidenceProvider.ts`, returning a normalised list (id, reporter role name, persona, weight, in-geofence, summary, quantities with units, blockers, captured-at, integrity flags). Reconciliation must use only this function. For now it reads confirmed `FieldEvidenceLog` rows as today.

---

## 3. Decisions

**Needs owner input**

| ID | Question | Default being built |
| :--- | :--- | :--- |
| D-3.1 | Segregation of duties | The user who certified an IPC cannot record the lender decision on it. Default Tenant Super Admin role does not hold `ipc:certify_valuation` or `tranche:approve_disbursement`. The platform super admin bypass does not apply to those two permissions. A tenant can still grant both to one custom role; the same-user block remains. |
| D-3.2 | Unmet mandatory Conditions Precedent | Release is blocked while any mandatory CP on the tranche is `PENDING` or `BREACHED`. A CP can be set to `WAIVED` by a user with `tranche:approve_disbursement`, with a required reason, recorded in the ledger. |

**Made here**
- Certification requires a professional licence on the user's own profile. No licence, no certification.
- A lender decision is final. Corrections are a new, linked reversal record, never an edit.
- One open IPC per tranche at a time; IPC numbers are assigned by the server.
- When the AI provider is unavailable, the rules engine runs and says so. It never rates higher than `PARTIALLY_SUPPORTED` without quantity coverage.

---

## 4. Schema changes

- `IpcClaim`: add `submittedByUserId`, `ratingEngine String?`, `ratingEngineDetail String?`, `reconciledAt DateTime?`. Add `REJECTED_WITHDRAWN` to `IpcClaimStatus`.
- `IpcLineItem`: add `evidenceQuantityTotal Decimal?`, `evidenceCoveragePct Decimal?`, `ratingEngine String?`, `ruleCapsApplied Json @default("[]")`.
- `ValuationReport`: remove client-supplied identity as a source of truth. Keep `certifierFullName`, `certifierLicenseType`, `certifierLicenseNumber` as snapshots copied from the `User` at certification. Add `revisionNumber Int @default(1)` and `supersededAt DateTime?`; drop the unique on `ipcClaimId` in favour of `@@unique([ipcClaimId, revisionNumber])`.
- `TrancheDecision`: add `reversesDecisionId String?`, `cpSnapshotJson Json`. Remove upsert semantics (plain create).
- `ConditionPrecedent`: add `waivedByUserId String?`, `waiverReason String?`, `statusChangedAt DateTime?`.
- `MonitorQuery`: add `raisedByUserId`, `respondedByUserId`, `resolvedByUserId`, `resolutionNote`.
- `Tenant`: add `evidenceRatingLabels Json @default("{}")`, shape `{ SUPPORTED: { label, description }, ... }` validated by a shared Zod schema with max lengths. Missing keys fall back to defaults in `EVIDENCE_RATING_META`.
- `AuditActionType`: add `CP_STATUS_CHANGED`, `CP_WAIVED`, `MONITOR_QUERY_RESOLVED`, `IPC_WITHDRAWN`, `TRANCHE_DECISION_REVERSED`, `TENANT_SETTINGS_UPDATED`.

---

## 5. Implementation checklist

### Step 1: State machine
- [x] Define the allowed IPC transitions once in `shared` and export a guard `assertIpcTransition(from, action)`:
  - `SUBMITTED` to `AI_RECONCILED` (reconcile)
  - `AI_RECONCILED` to `QUERIED_BY_MONITOR` (raise query) or `MONITOR_CERTIFIED` (certify)
  - `QUERIED_BY_MONITOR` to `AI_RECONCILED` (all queries resolved, reconciliation re-run) or `MONITOR_CERTIFIED` (certify with no open queries)
  - `MONITOR_CERTIFIED` to `LENDER_DECIDED` (decide), or back to `QUERIED_BY_MONITOR` if the monitor reopens before a decision
  - `SUBMITTED`, `AI_RECONCILED`, `QUERIED_BY_MONITOR` to `REJECTED_WITHDRAWN` (contractor withdraws)
  - `LENDER_DECIDED` is terminal
- [x] Enforce the guard at the top of every service function, inside the transaction, with a row lock on the IPC (`SELECT ... FOR UPDATE`).

### Step 2: Claim submission
- [x] Server assigns `ipcNumber` (max + 1 per project, in the transaction). Remove it from the request schema.
- [x] Reject a new claim if the tranche already has an IPC that is not `LENDER_DECIDED` or `REJECTED_WITHDRAWN`.
- [x] Each line: claimed cumulative percentage must be greater than the item's certified percentage and at most 100; the BOQ item must be mapped to the claim's tranche; no duplicates.
- [x] `periodEnd` after `periodStart` and not in the future.
- [x] Reconciliation runs after the create transaction; if it throws, the claim stays `SUBMITTED`, the response is 201 with a "reconciliation pending" flag, and the monitor can retry. Never return 500 for a saved claim.

### Step 3: Queries
- [x] Respond: only when the query is `OPEN`, only while the IPC is `QUERIED_BY_MONITOR`, only by a user with `reports:respond_query`. A revised percentage follows the Step 2 bounds.
- [x] New endpoint `POST .../queries/:queryId/resolve` (`reports:raise_query`) with a note. When the last open query on an IPC is resolved, re-run reconciliation and move to `AI_RECONCILED`.
- [x] Certification is refused while any query is `OPEN` or `RESPONDED`.

### Step 4: Certification
- [x] Request body shrinks to: per-line `monitorCertifiedCumulativePct` and remarks, `trancheRecommendation`, `executiveCertificationSummary`, `certifierDigitalSignatureAck`. Remove amounts and certifier identity from `CertifyIpcValuationRequestSchema`.
- [x] The user must have `professionalLicenseType` and `professionalLicenseNumber` on their profile, else 422. Snapshot them onto the report.
- [x] Every line of the IPC must be valued. Certified percentage must be between the previous certified percentage and the claimed percentage.
- [x] Server computes: line certified amount = (certified minus previous) x budgeted cost; total certified; recommended release = total certified for `SUPPORT_FULL_RELEASE`, a stated lower figure for `SUPPORT_WITH_HOLDBACK` (the one amount the monitor may enter, bounded by total certified), zero for `HOLD`; holdback = total claimed minus recommended release.
- [x] Re-certification before a lender decision creates a new revision and marks the previous one superseded. After a decision it is refused.
- [x] `BoqItem.cumulativeCertifiedPct` is updated only here. Recompute `Project.certifiedProgressPct` as the budget-weighted mean of BOQ certified percentages in the same transaction.

### Step 5: Lender decision
- [x] D-3.1: refuse if the caller is the certifier of the current revision. Check the two permissions explicitly from role permissions, without the platform super admin bypass.
- [x] D-3.2: refuse `APPROVE_*` while a mandatory CP is `PENDING` or `BREACHED`. Add CP status and waiver endpoints with audit events.
- [x] Bounds: approved amount at most the recommended release and at most the tranche's allocated minus released. `HOLD` means zero. `APPROVE_FULL` means exactly the recommended release; the request carries no amount for it.
- [x] Plain create; a second decision on the same revision is refused. Reversal endpoint creates a linked record with negative effect on `releasedAmountNgn` and `disbursedToDateNgn`.
- [x] `isReleased` is true when released equals allocated. Remove the forced `portfolioHealth` write.
- [x] Snapshot CP statuses into `cpSnapshotJson`.

### Step 6: Reconciliation engine
- [x] Create `evidenceProvider.ts` as described in section 2 and use it exclusively. Bound evidence to `capturedAt <= periodEnd`.
- [x] Compute per line, in code, before any model call: total evidenced quantity in the BOQ unit (ignore mismatched units and list them), coverage = evidenced quantity over claimed quantity for the period, whether any in-geofence independent evidence exists, whether integrity-flagged evidence exists, whether blockers were reported.
- [x] Enforce rule caps in code after the engine returns, and record which fired in `ruleCapsApplied`:
  - no evidence: `UNSUPPORTED`
  - contractor-only evidence: at most `PARTIALLY_SUPPORTED`, visit-planner flag on
  - hold point without independent evidence: at most `PARTIALLY_SUPPORTED`, missing-hold-point flag on
  - coverage below 50 percent: at most `PARTIALLY_SUPPORTED`
  - integrity-flagged evidence is excluded from support
- [x] Rules engine (used when the provider is unavailable or errors): `SUPPORTED` requires independent in-geofence evidence and coverage of at least 90 percent; `CONTRADICTED` when independent evidence shows materially less than claimed or reports an active blocker on the item; otherwise as capped above.
- [x] Prompt hygiene: pass computed facts as structured fields; pass free text in a clearly delimited data block with an instruction that it is untrusted content; never include instructions-like text from field notes in the system message.
- [x] Record `ratingEngine` (`AZURE_OPENAI` or `RULES_ENGINE`) and deployment name on the IPC and each line; the audit actor reflects the engine that ran. Show it in the workbench and the PDF. *Server and ledger verified by tests; workbench and PDF display built, not checked by eye.*
- [x] One shared helper `derivePortfolioHealth(lines)` and one for conflict and hold-point counts. Use them in reconciliation, `listProjectsForUser` and `getPortfolioExecutiveSummary`.

### Step 7: Roles and seed
- [x] In the default-role definition (created in Phase 2), remove `ipc:certify_valuation` and `tranche:approve_disbursement` from Tenant Super Admin, matching the Phase 1 catalog.
- [x] Seed: demo monitor has a licence; add a second lender-side user so the demo can show the same-user block.

### Step 8: Rating labels
- [x] Shared: `EvidenceRatingLabelsSchema`, `resolveRatingLabels(tenantLabels)` returning label, description and the fixed colour token for each canonical value. Make `EVIDENCE_RATING_META` the only source of defaults and colours.
- [x] Server: `GET` and `PUT /rbac/tenant/settings/rating-labels` (`tenant:manage_settings`); include resolved labels in the web user profile and the mobile session profile; audit `TENANT_SETTINGS_UPDATED`.
- [ ] Web: a "Evidence ratings" card in tenant settings with label and description per canonical value, the fixed meaning shown read-only beside each, and reset to default. *Built and typechecked; not verified in a browser.*
- [ ] Web: one `EvidenceBadge` that takes a canonical value and renders the tenant label, with the description as a tooltip. Replace every local map, switch, count label and row tint with it or with `resolveRatingLabels`. *Built and typechecked; not verified in a browser.*
- [x] PDF and audit summaries print the tenant label; payloads keep the canonical value. *Audit summary verified by test; PDF text not inspected (the test only checks a PDF is produced).*
- [x] AI prompts and stored data use canonical values only.

### Step 9: Web workbench
- [ ] Split [ReconciliationWorkbenchPage.tsx](../web/src/pages/reconciliation/ReconciliationWorkbenchPage.tsx) (about 1,500 lines) into the page plus `SubmitIpcModal`, `CertifyValuationModal`, `LenderDecisionModal`, `RaiseQueryModal`, `LineItemsTable`. *Built and typechecked; not verified in a browser.*
- [ ] Render the submit modal in the empty state too. *Built and typechecked; not verified in a browser.*
- [ ] Real claim form: tranche select (only tranches with no open IPC), BOQ items of that tranche with previous percentage and an input for claimed percentage, remarks, period dates, supporting document upload through presign, live total computed for display only. *Built and typechecked; not verified in a browser.*
- [ ] Certification modal: licence shown read-only from the profile with a link to fix it if missing; an explicit acknowledgement checkbox; server-computed totals shown after a dry-run call or on response. *Built and typechecked; not verified in a browser.*
- [ ] Lender modal: CP checklist with waive action; amount field only for holdback; clear message when blocked by D-3.1 or D-3.2. *Built and typechecked; not verified in a browser.*
- [ ] Query resolve action; query status chips. *Built and typechecked; not verified in a browser.*
- [ ] Evidence drawer: no fallback log; an explicit "no evidence linked" state; real audio playback from the media endpoint or no player; remove unconditional "Verified" and "Human-Confirmed" text. *Built and typechecked; not verified in a browser.*
- [ ] Remove demo strings as defaults outside demo mode. Remove page-level toasts that duplicate hook toasts. Fix the audit invalidation key. Handle PDF export errors. *Built and typechecked; not verified in a browser.*
- [ ] Replace hand-written IPC and query types in `web/src/api/types.ts` with shared types. *Built and typechecked; not verified in a browser.*

### Step 10: Tests
- [x] Every illegal transition is refused.
- [x] Certification without a licence is refused; amounts are server-derived for a known fixture.
- [x] Decision bounds, CP block, waiver, same-user block, reversal arithmetic, no double counting.
- [x] Rule caps: each cap with a fixture, with a stubbed model that returns `SUPPORTED` for everything.
- [x] Provider failure yields `RULES_ENGINE` in line items and the ledger.
- [x] Rating labels: update, resolve, fall back, and canonical values unchanged in storage.

---

## 6. Definition of done

| Criterion | Status (2026-11-18) |
| :--- | :--- |
| A full claim-to-release cycle works from the web on a project that starts with no IPC | **API verified; web not clicked through.** `routes.phase3.test.ts` runs submit, query, respond, resolve, certify (dry run and revision), CP waiver, decision, reversal and corrected decision on ABJ-108. The seed now gives ABJ-108 an open Tranche 2 with no IPC. The web flow uses the same endpoints and typechecks, but has not been used in a browser. |
| No amount that affects a release is accepted from a client without a server bound | Met. Claim amounts, certified amounts and the APPROVE_FULL amount are computed by the server. The two amounts a client can enter (holdback recommendation, holdback approval) are bounded and tested. |
| Changing a rating label changes every place the rating is shown, and nothing in the database rows | Met on the server: profile, audit summaries, PDF input; stored values unchanged (tested). The web reads labels from the profile through one `EvidenceBadge`; not checked by eye. The public Home and About pages still name the default labels and were left alone. |
| Master plan status updated | Met. |

**Checks run:** 141 server tests pass (81 unit, of which 72 new; 60 route-level, of which 30 new). Root `npm run typecheck`, `npm run lint` (0 errors, 120 warnings) and the web production build pass.

## 7. Found during implementation

| # | Finding | Recommendation / owner phase |
| :--- | :--- | :--- |
| 1 | **Deviation:** `LENDER_DECIDED` is terminal except for the reversal action, which returns the IPC to `MONITOR_CERTIFIED` so a corrected decision can be recorded on the same revision. Otherwise a reversal would leave no way to record the correct decision. | Confirm with owner. Defined once in `shared/src/ipcStateMachine.ts`. |
| 2 | D-3.1 collided with the Phase 2 escalation guard: without certify/approve, Tenant Super Admin could no longer assign the Monitor or Lender roles. The two segregated permissions are now exempt from "the caller must hold it", **except** when the change would give them to the caller (own role or own account). The exception applies to platform admins too. | Confirm with owner. Tested. |
| 3 | The rules engine rates `CONTRADICTED` when independent evidence with a measured quantity covers less than 50% of the period claim, or when the latest independent log reports a blocker. A single sparse inspection can therefore contradict a claim that contractor logs cover. | Review the threshold with monitors (`CONTRADICTION_MAX_INDEPENDENT_COVERAGE_PCT`). |
| 4 | Coverage counts only evidence captured inside the claim period, inside the geofence and integrity-clean, against the quantity claimed for the period. Independent hold-point evidence may predate the period. Older evidence is shown but not counted. | Confirm with owner. Phase 4 may refine this once captures are per item. |
| 5 | Definitions chosen: lender `heldBackAmountNgn` = total claimed minus approved; valuation holdback = total claimed minus recommended release. A HOLD recommendation gives a recommended release of 0, so the lender can only record HOLD. | Confirm with owner. |
| 6 | The default Monitor role holds `ipc:submit_claim`, so a monitor can submit claims that they later certify. Not changed here. | Owner decision; probably remove. |
| 7 | `ReportQuery` (workday-report queries) is still never set to `RESOLVED`. Step 3 covered `MonitorQuery` only. | Phase 4 (evidence pipeline). |
| 8 | Without S3 configured, presign returns a key but stores nothing, because no local-dev upload route exists. Supporting documents and the media endpoint therefore do not work in local dev. Pre-existing. | Add a local-dev storage route or use MinIO in dev. |
| 9 | The dev database was **not** migrated. The Phase 3 migration adds NOT NULL columns, and Prisma refuses `migrate reset` from an AI agent without the owner's explicit consent. The disposable `_test` database is rebuilt from migrations on every test run. | Run `npx prisma migrate reset` in `server/` (decision A). |
| 10 | Seed changes: IPC #2 is now `QUERIED_BY_MONITOR` because it has an open query. The tranche-1 earthworks line was removed from the tranche-2 claim, so the total is now 1,263.4M. Seeded ratings are attributed to `SEED_FIXTURE` rather than Azure. ABJ-108 gains an open Tranche 2 with evidence and a pending CP. `lto@insite.ng` (a custom role holding certify and approve) demonstrates the same-user block. | None. |
| 11 | The evidence drawer's workday-report geotag panel calls an endpoint that roles without `reports:view_all` (the default Lender) cannot read, so the panel stays hidden for them. Pre-existing. | None unless lenders need it. |
| 12 | Seeded `Project.certifiedProgressPct` values are hand-written and disagree with the BOQ percentages until the first certification recomputes them. | Compute them in the seed when it is next touched. |
| 13 | The executive summary's holdback total still sums line-level claimed minus certified amounts, not the holdback on the live valuation revision. | Phase 6 or 7, with the portfolio views. |
| 14 | The web bundle is a single 989 kB chunk. Pre-existing. | Code-split by route. |
