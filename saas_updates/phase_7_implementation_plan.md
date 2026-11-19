# Phase 7: Process Engine, Standards, Needs Assessments, Persona-Aware AI and Approval Chains

| | |
| :--- | :--- |
| **Status** | Implemented; web click-through and on-device testing pending (see section 7) |
| **Depends on** | Phase 3 (state machine, limits, segregation of duties), Phase 4 (report pipeline, evidence provider), Phase 6 (wizard step registry, contractor model, drafts) |
| **Unblocks** | Phases 8, 10 |
| **Read first** | [Master plan](saas_implementation_plan.md) sections 2, 3 and 6 |

This phase carries the content of the original "Phase 2" plan, adjusted for what Phases 2 to 6 changed.

---

## 1. Overview

**Objective:** let each tenant shape the process a project follows.

1. **Workflow templates and per-project process configuration:** which steps are required, optional or off.
2. **Project standards and needs-assessment documents:** set during the wizard and manageable afterwards.
3. **Persona-aware, standards-aware AI:** verifiers get an inspection checklist and are never told to do construction work; contractors get execution scope and the standards they must meet. Submitted reports are checked against applicable standards.
4. **Approval chains** for field reports and for disbursements, as ordered steps.
5. **IPC-optional disbursement:** release against a verified milestone with no contractor claim.

**Out of scope:** cadence behaviour (Phase 8), handover and retention behaviour (Phase 10; this phase only stores their on/off switches).

---

## 2. Context for the implementing agent

**What earlier phases give you**
- Phase 3: `assertIpcTransition`, server-computed amounts, release bounds, CP block and waiver, the same-user block between certifier and approver, `ValuationReport` revisions, final `TrancheDecision` with reversal, rule caps and engine provenance in reconciliation.
- Phase 4: `WorkdayReport` with a status enum, idempotent submission, AI omission check running after the response (`aiCheckStatus`), captures linked to reports, and `evidenceProvider.ts`, which today counts **confirmed** reports.
- Phase 5: provisioned mobile users; `req.fieldAgent` is filled the same way for both origins.
- Phase 6: the wizard step registry, draft projects, `ProjectContractor` with `allowFieldReporting`, contractor models, object-key storage with the authenticated media endpoint.

**Briefs today**
- `generateMorningDeliverableBrief` in [azure-openai.service.ts](../server/src/integrations/azure-openai.service.ts) always addresses the reader as a site engineer doing the work. Its fallback does the same.
- `MorningDeliverableBrief` is unique on `(projectId, boqItemId, workdayDate)`, so whoever opens an item first decides what everyone sees (formerly TD-P2-2).
- [morningBrief.service.ts](../server/src/modules/morning-briefs/morningBrief.service.ts) and [morningBriefCron.ts](../server/src/jobs/morningBriefCron.ts) generate daily for every project. Phase 8 changes the schedule; do not change it here beyond the persona dimension.
- Mobile renders the brief text verbatim with fixed headings ("Morning Deliverable Brief", "Report Pointers:", "Record EOD Summary & Submit") in [WbsChatThreadScreen.tsx](../mobile/src/screens/WbsChatThreadScreen.tsx) and [WbsInboxScreen.tsx](../mobile/src/screens/WbsInboxScreen.tsx). None of it branches on persona.

**Reports today**
- `evaluateWorkdayReportOmissions` checks hold-point and checklist omissions only.
- A submitted report becomes `CONFIRMED` at once (or `STAGED_UNVERIFIED` behind the assurance gate). There is no review step (formerly TD-P2-4).
- `ReportQuery.source` is `MONITOR` or `AI_OMISSION_CHECK`.

**Disbursement today**
- Everything hangs off `IpcClaim`: `ValuationReport.ipcClaimId` is required and the workbench shows an empty state without an IPC (formerly TD-P2-6).

---

## 3. Decisions

**No new owner input required.** D-3.1 and D-3.2 (master plan) carry over and apply to both disbursement modes.

**Made here**
- Approval chains are tables (master decision H). Templates may hold their configuration as validated JSON, because a template is copied into real rows when applied to a project.
- When report approval is on, only approved reports count as evidence. The evidence provider takes this from the project's process configuration.
- A chain step names a permission, and optionally a specific role. One user may not act on two consecutive steps of the same item. The disbursement chain always ends with a step requiring `tranche:approve_disbursement`, and always contains a certification step; tenants add steps around those two, they cannot remove them.
- Direct milestone release uses the same valuation, bounds, CP rules and segregation rules as an IPC. The only difference is that the claim is system-generated from verified progress.
- Changing a project's process configuration after activation applies to new items only; items in flight finish on the chain they started with.

---

## 4. Schema changes

**Process configuration**
- `WorkflowTemplate (id, tenantId, name, description, isDefault, configJson, createdAt, updatedAt)`; `configJson` validated by `WorkflowTemplateConfigSchema` (process settings plus both chains).
- `ProjectProcessConfig` (1:1 with `Project`), typed columns:
  - `workflowTemplateId String?` (provenance only)
  - `needsAssessmentMode`, `standardsSpecificationMode`: `REQUIRED_AT_CREATION | OPTIONAL_AT_CREATION | DISABLED`
  - `disbursementMechanism`: `IPC_CLAIM_REQUIRED | MILESTONE_DIRECT_DISBURSEMENT`
  - `enableTranchesAndCps`, `enableHoldPoints`, `allowContractorFieldReporting`, `enableContractorIdentityAssurance`, `enableAiOmissionCheck`, `enableAiStandardsCheck`, `requireReportApproval`, `enableHandoverModule`, `enableRetentionModule` (booleans)
- `ApprovalStep (id, projectId, chainType REPORT|DISBURSEMENT, stepOrder, label, requiredPermissionKey, requiredRoleId?, minAmountThresholdNgn?, isSystemStep, isActive, version)`, `@@unique([projectId, chainType, version, stepOrder])`.
- `ApprovalAction (id, projectId, chainType, subjectType WORKDAY_REPORT|VALUATION_REPORT, subjectId, stepId, stepOrder, decision APPROVE|RETURN|REJECT, actorUserId, notes, createdAt)`.

**Standards and needs assessments**
- `ProjectStandardSpecification (id, projectId, code, title, category, specificationText @db.Text, documentObjectKey?, applicableWbsCodes Json, isMandatory, createdByUserId, createdAt, updatedAt)`, `@@unique([projectId, code])`. Category enum: `MATERIAL_QUALITY | EXECUTION_METHOD | TESTING_TOLERANCE | SAFETY_ENVIRONMENT | GENERAL_SPECIFICATION`.
- `ProjectNeedsAssessmentDocument (id, projectId, title, documentType, objectKey, mimeType, byteSize, extractedSummaryText?, keyFindingsJson, uploadedByUserId, uploadedAt)`. Type enum: `COMMUNITY_NEEDS_ASSESSMENT | FEASIBILITY_STUDY | ENVIRONMENTAL_SOCIAL_IMPACT | STAKEHOLDER_REQUIREMENTS | TECHNICAL_BASELINE`.

**Briefs and reports**
- `MorningDeliverableBrief`: add `targetPersona` (`CONTRACTOR_EXECUTOR | INDEPENDENT_VERIFIER`), `appliedStandardsJson`; unique becomes `(projectId, boqItemId, workdayDate, targetPersona)`.
- `WorkdayReport`: add `reporterPersonaType`, `standardsCompliancePassed Boolean?` (null until checked), `standardsViolationsJson`, `approvalChainVersion Int?`, `currentApprovalStep Int @default(0)`, `approvedCompletedAt DateTime?`. Status enum gains `PENDING_APPROVAL`, `APPROVED_COMPLETED`, `RETURNED_FOR_REVISION`.
- `ReportQuery.source` gains `AI_STANDARDS_CHECK`; convert to an enum.

**Disbursement**
- `ValuationReport`: `ipcClaimId` nullable; add `projectId`, `trancheId`, `source` (`IPC_CLAIM | MILESTONE_DIRECT`), `approvalChainVersion`, `currentApprovalStep`. Constraint: `ipcClaimId` set exactly when `source = IPC_CLAIM`.
- New `MilestoneVerification (id, projectId, trancheId, verifiedByUserId, verificationSummary, lineVerificationsJson, createdAt)` linked from a `MILESTONE_DIRECT` valuation.

**Audit actions:** `WORKFLOW_TEMPLATE_SAVED`, `PROJECT_PROCESS_CONFIG_UPDATED`, `PROJECT_STANDARD_CREATED`, `PROJECT_STANDARD_UPDATED`, `PROJECT_STANDARD_DELETED`, `NEEDS_ASSESSMENT_UPLOADED`, `NEEDS_ASSESSMENT_DELETED`, `WORKDAY_REPORT_APPROVED`, `WORKDAY_REPORT_RETURNED`, `STANDARDS_VIOLATION_FLAGGED`, `APPROVAL_STEP_ACTIONED`, `DIRECT_MILESTONE_VERIFIED`.

**Web notification categories:** `STANDARDS_VIOLATION_FLAGGED`, `REPORT_PENDING_APPROVAL`, `DISBURSEMENT_PENDING_APPROVAL`.

---

## 5. Implementation checklist

### Step 1: Shared
- [x] Enums: `NeedsAssessmentModeEnum`, `StandardsSpecificationModeEnum`, `DisbursementMechanismEnum`, `StandardCategoryEnum`, `NeedsAssessmentDocTypeEnum`, `ApprovalChainTypeEnum`; extend `WorkdayReportStatusEnum`, `ReportQuerySourceEnum`, audit actions.
- [x] `shared/src/schemas/process.schema.ts`: `ProjectProcessConfigSchema` with `DEFAULT_PROJECT_PROCESS_CONFIG`, `ApprovalStepConfigSchema`, `WorkflowTemplateConfigSchema`, template DTO and request schemas, standards and needs-assessment DTO and request schemas, `StandardsViolationItemSchema { standardCode, standardTitle, severity CRITICAL|WARNING, violationSummary, requiredRectification }`, `ReviewWorkdayReportRequestSchema { decision, notes? }`, `VerifyDirectMilestoneRequestSchema { trancheId, verificationSummary, lineVerifications[{ boqItemId, verifiedCumulativePct }], trancheRecommendation, holdbackReleaseAmountNgn? }` (no client-supplied totals; Phase 3 rules).
- [x] A chain validator: steps are contiguous; the disbursement chain contains the certification step and ends with the release step.
- [x] Brief DTO: add `targetPersona`, `appliedStandards[{ code, title, summaryRule }]`. Report DTO: standards fields, approval position and history.

### Step 2: Server process module
- [x] `server/src/modules/process/`: templates CRUD (`templates:manage_workflows`); project process config get and update (`projects:edit_baseline`); chain get and replace (writes a new `version`, never edits steps in place).
- [x] `getProcessConfig(projectId)` with a per-request cache; every service that branches on a setting reads through it.
- [x] Applying a template to a draft copies settings and chains into project rows.
- [x] Seed three templates: "Standard institutional project finance" (IPC required, hold points on, standards optional, contractor and monitor reporting), "M&E-only oversight with direct milestone release" (contractor field reporting off, direct milestone, report approval on, needs assessment and standards required), "Rapid CapEx / lightweight monitoring" (direct milestone, minimal chain, standards optional).
- [x] Effects of settings on existing behaviour:
  - `allowContractorFieldReporting = false`: no contractor-executor join codes at activation; existing ones deactivated on change, with confirmation.
  - `enableContractorIdentityAssurance = false`: the assurance gate is skipped for the project regardless of the role flag.
  - `enableHoldPoints = false`: hold-point flags are ignored by reconciliation caps and hidden in UI.
  - `enableTranchesAndCps = false`: a single implicit tranche; CP checks skipped.

### Step 3: Standards and needs assessments
- [x] Standards CRUD and needs-assessment upload, list, delete under the project (`projects:manage_standards_docs`), using object keys and the media endpoint.
- [x] `getApplicableStandards(projectId, wbsCode)`: project-wide standards plus those whose `applicableWbsCodes` match the code or a prefix.
- [x] Optional AI summary of an uploaded needs-assessment document into `extractedSummaryText` and key findings; store "pending" when the provider is unavailable, never invent text.
- [x] A starter library of common Nigerian infrastructure standards as selectable suggestions (data file in `shared`), clearly marked as templates for the monitor to edit, not as authoritative text.

### Step 4: Persona-aware, standards-aware briefs
- [x] `generateMorningDeliverableBrief` takes `targetPersona` and `applicableStandards`.
  - Verifier: the system prompt states the reader is an independent inspector, must not be told to build or execute anything, and must receive (1) what progress and dimensions to verify, (2) which standards and tolerances to check, (3) what photos, test-witness records and notes to include.
  - Contractor: execution target, the listed standards to follow, and the proof and quantities to log.
  - Both fallbacks follow the same split.
- [x] Post-check the verifier output in code for imperative construction verbs aimed at the reader; regenerate once, then use the fallback.
- [x] Persona resolution in the brief service: from the caller's session persona; forced to verifier when contractor field reporting is off; a web caller may request either with a query parameter.
- [x] Cache and cron generate per persona present on the project (do not generate a contractor brief when no contractor reports).
- [x] Standards text is passed to the model as delimited reference data (Phase 3 prompt-hygiene rule).

### Step 5: Standards check and report approval
- [x] Extend the post-response report check (Phase 4) to run, according to config, the omission check and a standards check returning `standardsCompliancePassed` and violations. Include a rule-based evaluator for when the provider is unavailable (numeric tolerances and required-test keywords found in the standard text versus the report); if neither can decide, leave `null` and say "not checked".
- [x] A failed check raises an `AI_STANDARDS_CHECK` query to the reporter, a `STANDARDS_VIOLATION_FLAGGED` web notification, and an audit event.
- [x] Report approval: when `requireReportApproval` is on, an approved-session report enters `PENDING_APPROVAL` with the current chain version. `POST /workday-reports/:reportId/review` checks the caller against the current step, records an `ApprovalAction`, and advances, completes (`APPROVED_COMPLETED`) or returns (`RETURNED_FOR_REVISION`, with a query to the reporter). A returned report is revised through the existing revalidation path and re-enters at step 1.
- [x] Evidence provider: count `APPROVED_COMPLETED` reports when approval is on, `CONFIRMED` when off.
- [x] Reviewer may not be the reporter (relevant once provisioned users report).

### Step 6: Disbursement chain and direct milestone
- [x] Generalise the Phase 3 flow so certification and release are steps of the project's disbursement chain. With the default two-step chain, behaviour is identical to Phase 3. Extra steps (for example a second reviewer above an amount threshold) insert `ApprovalAction`s between them. All Phase 3 bounds and blocks remain where they are.
- [x] `minAmountThresholdNgn`: a step is skipped when the recommended release is below it.
- [x] `POST /projects/:projectId/milestones/direct-verify` (`milestone:verify_direct_release`), only for projects in direct mode: builds a system claim from verified progress (evidence provider quantities and the verifier's per-item percentages, bounded like a certification), creates a `MILESTONE_DIRECT` valuation at the certification step, and continues down the chain. The verifier needs a professional licence, as for certification.
- [x] In direct mode, `POST /ipcs` is refused; in IPC mode, the direct endpoint is refused.
- [x] PDF: supports a valuation with no IPC.

### Step 7: Web
- [ ] Wizard: register two steps (Phase 6 registry). "Workflow and process": template picker that pre-fills, then toggles and both chains as ordered, editable step lists. "Standards and needs assessment": standards editor with "add from library", document upload. Each step's requiredness follows the modes in the config. Activation validation includes them.
- [ ] Project settings: the same two pages after activation, with the "applies to new items" note on chain edits.
- [ ] Settings: "Workflow templates" tab (`templates:manage_workflows`).
- [ ] BOQ page brief preview: persona switcher and applied-standards pills.
- [ ] Report review ([SitePresencePanel.tsx](../web/src/components/SitePresencePanel.tsx)): standards status badge with violation detail; approval bar showing chain position, with Approve and Return when the user can act on the current step.
- [ ] Reconciliation workbench: chain progress on a valuation; in direct mode, a "Verify milestone" flow in place of claim submission (tranche, items with evidence-derived suggested percentages, summary), then the usual release step.
- [ ] Hide tranche, CP and hold-point UI when those modules are off.

### Step 8: Mobile
- [ ] Persona-aware copy keyed off the session persona: inbox subtitle, brief card title, pointers heading, end-of-day button, verification-pending and backlog wording. Verifier wording is about inspecting and verifying.
- [ ] Brief card shows applied standards.
- [ ] `AI_STANDARDS_CHECK` queries render with their own label, listing the standard codes and required rectification.
- [ ] Report status shows pending approval, approved, returned.

### Step 9: Tests (`server/src/tests/process.phase7.test.ts`)
- [x] Config schema defaults; chain validator accepts and rejects the right shapes.
- [x] Verifier brief contains no execution instruction (stubbed model returning one triggers regeneration then fallback); contractor brief lists standards; the two are cached separately.
- [x] Standards check flags a fixture violation with the provider stubbed and with the rule-based evaluator.
- [x] Report approval: advance, complete, return, re-entry; wrong-step and same-user-consecutive refusals; provider counts only approved reports when approval is on.
- [x] Disbursement chain with a third step and a threshold; Phase 3 tests still pass unchanged with the default chain.
- [x] Direct milestone: full cycle with no IPC; bounds and CP rules enforced; refused in IPC mode.
- [x] Template application copies rows; later template edits do not change the project.

---

## 6. Definition of done

- Two projects in one tenant run different processes (IPC with contractor reporting; M&E-only with direct release and report approval) end to end.
- An inspector's brief never tells them to build anything.
- All Phase 3 and Phase 4 tests still pass.
- Master plan status updated.

## 7. Found during implementation

_Add items here rather than expanding scope._

**Verification state (2026-11-21, after gap closure).** Server `npm run test` passes: 94 unit, 162 route (27 in `process.phase7.test.ts`). Root `npm run typecheck`, `npm run lint` (0 errors), the web build and the mobile unit tests (56, including an in-memory SQLite migration test) pass. Migrations `20261121090000_phase7_process_engine` and `20261121091000_phase7_project_document_media` are applied to the dev database with no drift. Web and mobile screens compile but have not been clicked through or run on a device, so Steps 7 and 8 and the Definition of done stay unticked.

**Plan conflicts, resolved as follows**
1. "Tenants add steps around" certification and release: a step before certification has nothing to act on (the valuation does not exist yet), so certification is always step 1 and release always last; added steps go between them. The validator enforces this.
2. A disbursement-chain step that returns a valuation needed an IPC transition. Adding `return_valuation` to the state machine would have changed the Phase 3 state-machine test, which the plan says must pass unchanged. A return therefore uses the existing Phase 3 "reopen a certified IPC" transition (`MONITOR_CERTIFIED → QUERIED_BY_MONITOR`); with no open queries the IPC can be certified again. The valuation is superseded and the BOQ percentages it wrote are reverted.
3. `ReportQuery.source` became an enum with `AI_STANDARDS_CHECK`. A new nullable `standardsViolationsPayload` column carries the violations so mobile can list codes and rectification on the query itself (not in the plan's schema list).
4. Needs-assessment documents and standards reference files needed an upload media type: `PROJECT_DOCUMENT` was added (shared enum, Prisma enum, upload policy: PDF, images, Word, plain text, 25 MB). The draft-route allowlist now includes `process`, `standards`, `needs-assessments`, `evidence/presign` and `media`, so the wizard can upload on a draft.
5. The Phase 5 route test hard-codes the monitor's mobile project list; the new seeded project EDO-410 is visible to the monitor through `projects:view_all_tenant`, so that expectation was updated (as Phase 6 did for its own seeded projects). No other earlier test changed.

**Decisions taken (easy to change)**
- `milestone:verify_direct_release` joined `SEGREGATED_DISBURSEMENT_PERMISSIONS` (D-3.1): it is a certification, so the tenant super admin role no longer holds it and the platform bypass does not apply.
- Chain step permission checks use the role's permissions only for segregated keys and `hasWebPermission` (with the platform bypass) for others. The "one user, not two consecutive steps" rule looks at the last approval in the current pass (actions since the last return). With the default chain it is exactly the Phase 3 certifier/approver rule, which is also still checked directly.
- A HOLD decision is recorded on the release step as `REJECT`; approvals as `APPROVE`. No endpoint accepts `REJECT` on reports or added steps: those are returned instead.
- Evidence: CONFIRMED and APPROVED_COMPLETED reports both count. With approval on, no new CONFIRMED reports are created, so only approved reports count for new items, while reports accepted before approval was switched on keep counting (config changes apply to new items only). Captures of earlier revisions are loaded whatever the earlier revision's status (e.g. returned).
- A returned report's revision re-enters the same chain version at step 1. A report submitted while approval was off but revised after it was switched on goes onto the current chain.
- The standards check fails a report only on a CRITICAL violation (a mandatory standard); warnings are stored and shown but raise no query. Missing proof is reported once per standard. A reported value is compared with a tolerance; a missing value is not a violation (e.g. 28-day cube results cannot exist on pour day).
- Briefs: a field caller always gets its own persona; web callers choose (default contractor when contractors report). Dispatch and the cron generate per persona present on the project (an active session, active join code, or assigned provisioned account of that persona).
- Direct milestone: the system claim per item is the evidence-derived cumulative percentage (usable counted evidence in the BOQ unit / total quantity, capped at 100). The verifier cannot exceed it or go below the previous certified percentage; at least one item must advance. Only one direct verification per tranche can be open at a time. `?dryRun` is a body flag here (`dryRun: true`).
- Tranches off: activation creates one "Whole project" tranche for the whole budget when none exists and maps unmapped items to it; CP checks are skipped at release. With hold points off, reconciliation, briefs, the omission check and IPC DTOs treat no item as a hold point.
- New drafts get the tenant's default template (`isDefault`); deleting a template never changes projects (they hold their own copy).
- Seed: the three starter templates, explicit default process rows for every seeded project, and EDO-410 (M&E-only, direct release, report approval on, two standards, one needs-assessment fixture) with its own verifier account `verifier@insite.ng` / `Password123!` (COREN licence). LKK-402 and EDO-410 are the two projects that run different processes.
- Web applies a template by copying it into the form and saving the process step (the user can edit first); `POST /process/apply-template` exists but the UI does not call it.

**Gaps closed (2026-11-21)**
- Needs-assessment text extraction: plain text, PDF (`unpdf`, loaded with a real dynamic import because the server is CommonJS) and .docx (`mammoth`). Files with no readable text (scanned PDF, image) or an unsupported format (legacy .doc) become `UNAVAILABLE` (new status); no text is invented. With no AI provider a readable file stays `PENDING`; `POST /needs-assessments/:id/summarise` retries.
- Contractor reporting off: existing contractor-executor sessions get 403 `CONTRACTOR_FIELD_REPORTING_DISABLED` on captures, reports and revisions, and provisioned contractor-executor accounts no longer see or open the project. Mobile treats the refusal as permanent, shows a clear message and marks the report "Not sent".
- `GET /workday-reports` for a provisioned-account session returns the account's reports from every device on the project; mobile keeps them in a status-only table (SQLite v4 `server_reports`) so "Today's report" shows for a report sent from another device.
- Web: tranche, CP and hold-point UI is hidden when off on the executive page (per project; one cached settings request per listed project), the wizard BOQ step, the visit itinerary and the evidence drawer. The workbench honours `?valuationId=`. The pending-approval filter calls `?status=PENDING_APPROVAL`. Notification badges show the category name for every category. Summary polling stops after 10 tries (5 minutes).
- Tests added for every settings side effect, standards CRUD, document storage and summary states, and text extraction.

**Remaining**
- Browser click-through and a device run (Steps 7 and 8, Definition of done). The mobile SQLite v3/v4 migrations are tested against Node's in-memory SQLite, not expo-sqlite/SQLCipher.
- No OCR: scanned PDFs and images stay `UNAVAILABLE`.
- The executive page's portfolio-wide summary cards still count hold points across all projects.
- Mobile: if a contractor's capture is refused first, the dependent report's pill still says "Waiting to send" (the capture itself shows the clear message).
- Found, out of scope: `npm audit --omit=dev` reports existing high-severity advisories in `sharp` (libvips) and `zod`, and moderate ones in `react-router`, `exceljs`/`uuid` and `expo`. None come from the packages added in this phase.
