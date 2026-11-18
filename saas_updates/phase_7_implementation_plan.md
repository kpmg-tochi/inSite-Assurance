# Phase 7: Process Engine, Standards, Needs Assessments, Persona-Aware AI and Approval Chains

| | |
| :--- | :--- |
| **Status** | Not started |
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
- [ ] Enums: `NeedsAssessmentModeEnum`, `StandardsSpecificationModeEnum`, `DisbursementMechanismEnum`, `StandardCategoryEnum`, `NeedsAssessmentDocTypeEnum`, `ApprovalChainTypeEnum`; extend `WorkdayReportStatusEnum`, `ReportQuerySourceEnum`, audit actions.
- [ ] `shared/src/schemas/process.schema.ts`: `ProjectProcessConfigSchema` with `DEFAULT_PROJECT_PROCESS_CONFIG`, `ApprovalStepConfigSchema`, `WorkflowTemplateConfigSchema`, template DTO and request schemas, standards and needs-assessment DTO and request schemas, `StandardsViolationItemSchema { standardCode, standardTitle, severity CRITICAL|WARNING, violationSummary, requiredRectification }`, `ReviewWorkdayReportRequestSchema { decision, notes? }`, `VerifyDirectMilestoneRequestSchema { trancheId, verificationSummary, lineVerifications[{ boqItemId, verifiedCumulativePct }], trancheRecommendation, holdbackReleaseAmountNgn? }` (no client-supplied totals; Phase 3 rules).
- [ ] A chain validator: steps are contiguous; the disbursement chain contains the certification step and ends with the release step.
- [ ] Brief DTO: add `targetPersona`, `appliedStandards[{ code, title, summaryRule }]`. Report DTO: standards fields, approval position and history.

### Step 2: Server process module
- [ ] `server/src/modules/process/`: templates CRUD (`templates:manage_workflows`); project process config get and update (`projects:edit_baseline`); chain get and replace (writes a new `version`, never edits steps in place).
- [ ] `getProcessConfig(projectId)` with a per-request cache; every service that branches on a setting reads through it.
- [ ] Applying a template to a draft copies settings and chains into project rows.
- [ ] Seed three templates: "Standard institutional project finance" (IPC required, hold points on, standards optional, contractor and monitor reporting), "M&E-only oversight with direct milestone release" (contractor field reporting off, direct milestone, report approval on, needs assessment and standards required), "Rapid CapEx / lightweight monitoring" (direct milestone, minimal chain, standards optional).
- [ ] Effects of settings on existing behaviour:
  - `allowContractorFieldReporting = false`: no contractor-executor join codes at activation; existing ones deactivated on change, with confirmation.
  - `enableContractorIdentityAssurance = false`: the assurance gate is skipped for the project regardless of the role flag.
  - `enableHoldPoints = false`: hold-point flags are ignored by reconciliation caps and hidden in UI.
  - `enableTranchesAndCps = false`: a single implicit tranche; CP checks skipped.

### Step 3: Standards and needs assessments
- [ ] Standards CRUD and needs-assessment upload, list, delete under the project (`projects:manage_standards_docs`), using object keys and the media endpoint.
- [ ] `getApplicableStandards(projectId, wbsCode)`: project-wide standards plus those whose `applicableWbsCodes` match the code or a prefix.
- [ ] Optional AI summary of an uploaded needs-assessment document into `extractedSummaryText` and key findings; store "pending" when the provider is unavailable, never invent text.
- [ ] A starter library of common Nigerian infrastructure standards as selectable suggestions (data file in `shared`), clearly marked as templates for the monitor to edit, not as authoritative text.

### Step 4: Persona-aware, standards-aware briefs
- [ ] `generateMorningDeliverableBrief` takes `targetPersona` and `applicableStandards`.
  - Verifier: the system prompt states the reader is an independent inspector, must not be told to build or execute anything, and must receive (1) what progress and dimensions to verify, (2) which standards and tolerances to check, (3) what photos, test-witness records and notes to include.
  - Contractor: execution target, the listed standards to follow, and the proof and quantities to log.
  - Both fallbacks follow the same split.
- [ ] Post-check the verifier output in code for imperative construction verbs aimed at the reader; regenerate once, then use the fallback.
- [ ] Persona resolution in the brief service: from the caller's session persona; forced to verifier when contractor field reporting is off; a web caller may request either with a query parameter.
- [ ] Cache and cron generate per persona present on the project (do not generate a contractor brief when no contractor reports).
- [ ] Standards text is passed to the model as delimited reference data (Phase 3 prompt-hygiene rule).

### Step 5: Standards check and report approval
- [ ] Extend the post-response report check (Phase 4) to run, according to config, the omission check and a standards check returning `standardsCompliancePassed` and violations. Include a rule-based evaluator for when the provider is unavailable (numeric tolerances and required-test keywords found in the standard text versus the report); if neither can decide, leave `null` and say "not checked".
- [ ] A failed check raises an `AI_STANDARDS_CHECK` query to the reporter, a `STANDARDS_VIOLATION_FLAGGED` web notification, and an audit event.
- [ ] Report approval: when `requireReportApproval` is on, an approved-session report enters `PENDING_APPROVAL` with the current chain version. `POST /workday-reports/:reportId/review` checks the caller against the current step, records an `ApprovalAction`, and advances, completes (`APPROVED_COMPLETED`) or returns (`RETURNED_FOR_REVISION`, with a query to the reporter). A returned report is revised through the existing revalidation path and re-enters at step 1.
- [ ] Evidence provider: count `APPROVED_COMPLETED` reports when approval is on, `CONFIRMED` when off.
- [ ] Reviewer may not be the reporter (relevant once provisioned users report).

### Step 6: Disbursement chain and direct milestone
- [ ] Generalise the Phase 3 flow so certification and release are steps of the project's disbursement chain. With the default two-step chain, behaviour is identical to Phase 3. Extra steps (for example a second reviewer above an amount threshold) insert `ApprovalAction`s between them. All Phase 3 bounds and blocks remain where they are.
- [ ] `minAmountThresholdNgn`: a step is skipped when the recommended release is below it.
- [ ] `POST /projects/:projectId/milestones/direct-verify` (`milestone:verify_direct_release`), only for projects in direct mode: builds a system claim from verified progress (evidence provider quantities and the verifier's per-item percentages, bounded like a certification), creates a `MILESTONE_DIRECT` valuation at the certification step, and continues down the chain. The verifier needs a professional licence, as for certification.
- [ ] In direct mode, `POST /ipcs` is refused; in IPC mode, the direct endpoint is refused.
- [ ] PDF: supports a valuation with no IPC.

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
- [ ] Config schema defaults; chain validator accepts and rejects the right shapes.
- [ ] Verifier brief contains no execution instruction (stubbed model returning one triggers regeneration then fallback); contractor brief lists standards; the two are cached separately.
- [ ] Standards check flags a fixture violation with the provider stubbed and with the rule-based evaluator.
- [ ] Report approval: advance, complete, return, re-entry; wrong-step and same-user-consecutive refusals; provider counts only approved reports when approval is on.
- [ ] Disbursement chain with a third step and a threshold; Phase 3 tests still pass unchanged with the default chain.
- [ ] Direct milestone: full cycle with no IPC; bounds and CP rules enforced; refused in IPC mode.
- [ ] Template application copies rows; later template edits do not change the project.

---

## 6. Definition of done

- Two projects in one tenant run different processes (IPC with contractor reporting; M&E-only with direct release and report approval) end to end.
- An inspector's brief never tells them to build anything.
- All Phase 3 and Phase 4 tests still pass.
- Master plan status updated.

## 7. Found during implementation

_Add items here rather than expanding scope._
