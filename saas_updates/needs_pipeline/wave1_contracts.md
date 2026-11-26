# Needs Pipeline · Wave 1: Contracts, migration, roles (N0 + N1)

Parent plan: `saas_updates/needs_pipeline_implementation_plan.md` (sections 3–8 are the spec; this file is the work order). Waves: `wave1_contracts.md` → `wave2_upload_standards.md` → `wave3_validation_costing_scoring.md` → `wave4_approval_funding_conversion.md` → `wave5_field_seed_docs.md`.

**Who runs it:** one agent in the main thread. No subagents: everything here is shared contracts, the Prisma schema, the migration and the seed, which must stay sequential (CLAUDE.md, "Working on a plan", step 4).

**Outcome:** every name later waves depend on exists, is built and tested; the database has every pipeline table; the seed has the people the scenario tests need; the two scenario tests exist as `todo`. No service, route or page of the pipeline is built yet (except the N0 kick-off warning and the type-editor tab placeholder).

## 0. Before you start

1. Follow CLAUDE.md "Working on a plan" steps 1–7.
2. **Demo answers.** Read the parent plan section 16.1. The owner fills it after the Minister demo (2026-11-27). If rows are blank, the section 3 assumptions stand. If an answer changes an assumption, apply it to the contracts below and record it in 16.1. Ask the owner (one AskUserQuestion round, at most 4 questions) only about answers that conflict with each other or with this file; then do not stop again.
3. Baseline: take it from the last verification record (`saas_updates/client_demo_updates/working_plan.md`, pre-demo round). Rerun the full gate only if `git status` shows changes since then, and record it in section 6 below.

## 1. Read first (targeted)

| File | For |
| :--- | :--- |
| Parent plan sections 3–8 and 16 | The spec |
| `shared/src/enums.ts` (permission categories, `SYSTEM_PERMISSIONS_CATALOG`, `AuditActionTypeEnum`, `ApprovalChainTypeEnum`) | Where keys and enums go |
| `shared/src/schemas/projectType.schema.ts`, `projectTypeConfigGroups.ts`, `server/src/tests/typeConfigGroups.r6.test.ts` | New type key `needsPipeline` |
| `server/src/modules/process/approvalChain.ts` | Pure functions reused by the cycle chains (D-N.23) |
| `shared/src/schemas/facility.schema.ts`, `scope.schema.ts` (`UNITS_OF_MEASURE`), `shared/src/data/nigeriaAdminAreas.ts`, `shared/src/utils/geofence*` (distance) | Breakdown rows, sites, duplicate distance |
| `server/src/modules/scope/workbook/scopeWorkbook.ts` (parsed shapes) | The parsed needs assessment shape must map onto sites, units and BoQ lines |
| `server/src/db/seedPhase13.ts` (DI milestone templates), the PRG-102 mobilisation story, `server/src/tests/*phase13*` | N0 |
| `server/src/db/seedUbecRoster.ts`, `seedDemoOverlay.ts` (roles `EXECUTIVE_SECRETARY`, `DIRECTOR_PHYSICAL_PLANNING`, `FINANCE_OFFICER`), `seedDatabase.ts` reset list | Roles, logins, reset order |

## 2. Decisions added by this wave (already in the parent plan section 5)

| ID | Decision |
| :--- | :--- |
| D-N.23 | **Cycle approval chains get their own tables** (`NeedsApprovalStep`, `NeedsApprovalAction`, keyed on `cycleId`), because `ApprovalStep.projectId` and `ApprovalAction.projectId` are required and a cycle has no project. They reuse the pure engine functions in `approvalChain.ts` (`stepApplies`, `nextApplicableStep`, `organizationScopeAllows`, `holdsStep`, `gateForStep`, `assertMayAct`); the cycle's owning organisation supplies `orgContext`. Steps are copied from `needsPipeline.approvalChains` when the cycle opens (versioned per cycle, like project chains). |
| D-N.24 | **No web notifications for the pipeline** (`WebNotification.projectId` is required). Work reaches people through the computed task queue ("Waiting for me", nav badge count) and email via `sendMessage` (deadline reminders, "returned to you", "submitted for your approval"). Revisit if the owner wants notification-centre entries. |
| D-N.25 | **Pipeline people in the normal seed.** The scenario tests need distinct people per stage, so `seedUbecRoster.ts` creates them (section 3.6); the demo overlay reuses an existing user by email instead of creating it again. |

## 3. Work

States: `TODO` · `BUILT (owed <id>)` (code exists and typechecks; a click-through is owed in `web_testing_checklist.md`) · `VERIFIED` (the named test passes in a recorded gate). Only VERIFIED counts as done. Fill "Verified by" with the test file and test name.

### 3.1 Part A: N0, DI mobilisation from award (D-N.22)

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| A1 | DI templates in `seedPhase13.ts`: `contractor-mobilised` and `mobilisation-documents` anchor `CONTRACT_AWARD`, offset 21 days; MG unchanged | `routes.needs.n1.test.ts` "the Direct Intervention type counts both mobilisation milestones 21 days from award; Matching Grants 14 days from the kick-off" | VERIFIED |
| A2 | Seed stories keep their meaning: PRG-102 "mobilisation due in 5 days" (set its `contractAwardDate` so award + 21 = today + 5); every DI story whose dates move is checked against the tests that assert them | `routes.needs.n1.test.ts` "PRG-102 (Direct Intervention): mobilisation is due 21 days from award, which is in 5 days", "every other Direct Intervention project counts its mobilisation from award too"; `visits.r4.test.ts` "until mobilised: a window shorter than the interval still gets one check, on the due date (needs pipeline N0)"; the story tests that read these projects pass (`routes.r4`, `r5`, `r6c`, `phase13`, `phase16`; `routes.demo.test.ts` after the rule fix of section 5 item 25) | VERIFIED |
| A3 | Kick-off planning returns a non-blocking warning `KICKOFF_AFTER_AWARD_WINDOW` when the planned kick-off is later than award + 14 days (DI types: rule from the type's milestone templates, not the type code); shown on the kick-off tab | `needs.n1.test.ts` "warns when the planned kick-off is later than award + 14 days"; `routes.needs.n1.test.ts` "warns on the kick-off tab when the planned kick-off is later than award + 14 days, and never blocks", "a draft with a kick-off planned inside the window has no warning; moving the award back raises it" | VERIFIED (server); the notice on the kick-off tab is BUILT (owed WEB-NP1-02) |
| A4 | Tests: DI milestone due dates from award; MG due dates unchanged; warning present/absent | `routes.needs.n1.test.ts` suite "Needs pipeline N0" (7 tests, incl. "PRG-221 (Matching Grants) is unchanged: 14 days from the kick-off", "does not warn once the kick-off is held, nor on a Matching Grants project"); `needs.n1.test.ts` suite "Needs pipeline N0" (2 tests) | VERIFIED |

### 3.2 Part B: shared contracts (N1)

Files to create (names are binding for later waves; deviations go in section 5 and the contract-names table):

| # | File | Contents | Verified by | State |
| :--- | :--- | :--- | :--- | :--- |
| B1 | `shared/src/schemas/needsPipeline.schema.ts` | Enums: `NeedsStageEnum` (`IDENTIFICATION`, `VALIDATION`, `DESIGN`, `COSTING`, `PRIORITISATION`, `APPROVAL`, `FUNDING`), `NeedsProposalStatusEnum` (D-N.2), `NeedsCycleStatusEnum` (`DRAFT`, `OPEN`, `CLOSED`), `NeedsVersionSourceEnum` (`UPLOAD`, `CORRECTION`, `COSTING`, `BEAP_REVISION`, `CARRY_FORWARD`), `InterventionActionEnum`, `ExistingConditionEnum`, `FacilityCriticalityEnum` (plan 6.3), `ProposalFlagKindEnum` (`DUPLICATE`, `ESSENTIAL_FACILITY_GAP`, `RATE_VARIANCE`, `CEILING_EXCEEDED`, `MISSING_SUPERVISION_LINE`, `SEPARATION_OVERRIDE`), `StageOutcomeEnum` (`ADVANCE`, `RETURN`, `NOT_VALIDATED`, `NOT_SELECTED`), `NeedsSubmissionKindEnum` (`PORTFOLIO`, `BEAP`, `OUT_OF_CYCLE`), `CycleDocumentKindEnum` (circular, preliminary needs report, stakeholder engagement summary, Validated Project List, Cost Estimate Report, Prioritised Project Portfolio, committee minutes, approval memo, budget submission acknowledgement, appropriated schedule, BEAP, procurement plan, counterpart evidence, other), `ProposalDocumentKindEnum`, `OutOfCycleReasonEnum` (D-N.14), `ProjectOriginEnum` (D-N.13). Row schemas: `ProposalSiteSchema`, `FacilityBreakdownRowSchema` (plan 6.3), `NeedsBoqLineSchema`, `CostingSummarySchema`, **`ParsedNeedsAssessmentSchema`** (project fields, sites, breakdown rows, BoQ lines, costing summary, template version, costing standard version: the `parsedJson` shape and the conversion input). Type config: `NeedsPipelineConfigSchema` (section 3.3). DTOs: `NeedsCycleDto`, `NeedsCycleSummaryDto`, `NeedsProposalSummaryDto`, `NeedsProposalDetailDto`, `NeedsAssessmentVersionDto`, `ProposalFlagDto`, `NeedsTaskDto` (task queue row), `StageDecisionRequestSchema` (selection + per-item outcome + reason + evidence ids), `ScoreSheetSchema`, `CommitteeMemberDto`, `ConflictDeclarationRequestSchema`, `NeedsSubmissionDto`. Request schemas for later waves may be stubs if their fields are not settled; mark them `// wave N settles` | `needs.n1.test.ts` suites "type config and defaults", "stages", "separation of duties" (enums, row schemas, `ParsedNeedsAssessmentSchema`, config, `StageDecisionRequestSchema`, `ConflictDeclarationRequestSchema`) and "the shared enums and the database enums agree" | VERIFIED (enums, rows, config, requests). The DTO schemas only typecheck until a service returns them (waves 2–4) |
| B2 | `shared/src/schemas/costingStandard.schema.ts` | `CostingStandardRateSchema` (item code, description, facility code optional, unit of measure, rate ₦), zone factors (6 zones, default 1.0), supervision and monitoring %, contingency %, ceilings (facility code, intervention action optional, max ₦ per unit), `CostingStandardVersionDto`, save request | `needs.n1.test.ts` "defaults the zone factors to 1 and applies the zone to the standard rate" and the costing suite, which parses a standard | VERIFIED (schema, helpers). `CostingStandardVersionDto` and the save request only typecheck until wave 2 |
| B3 | `shared/src/data/needsPipelineDefaults.ts` | `DEFAULT_DI_NEEDS_PIPELINE` and `DEFAULT_MG_NEEDS_PIPELINE` (calendar from plan 4.3, stages from 6.2, rubric A6 with these assumed sub-criteria: Impact = strategic alignment, severity of need, beneficiary reach, educational benefit, equity; Ease = site readiness, technical feasibility, design and scope readiness, cost and funding feasibility, delivery complexity; descriptors 1–5 for each), essential groups (D-N.17), chain steps (plan 6.2 / section 8) | `needs.n1.test.ts` "the Direct Intervention default follows plan 3.3, 4.3 and 6.2", "the Matching Grants default has no Design stage, a BEAP gate and the counterpart rule", "both defaults share the A6 rubric, the essential groups and the tolerances", "every permission the defaults name is in the catalogue, and the 18 keys are there" | VERIFIED |
| B4 | `shared/src/utils/needsStages.ts` | `stagesFor(config)`, `nextStage(config, stage)`, `returnTarget(config, stage)`, `allowedProposalActions({ stage, status }, config, permissionKeys)`, `proposalStatusLabel({ stage, status }, config)`, `reopenStageFor(change: 'SCOPE' \| 'COST')` | `needs.n1.test.ts` suite "Needs pipeline N1: stages" (6 tests) | VERIFIED |
| B5 | `shared/src/utils/needsSeparation.ts` | `separationViolation(action, actorUserId, history)` → error code or null (plan section 7 rules and codes), `recusalsFor(memberUserId, proposals, declarations)` | `needs.n1.test.ts` suite "Needs pipeline N1: separation of duties" (9 tests: each rule and code, the override, recusals) | VERIFIED |
| B6 | `shared/src/utils/needsScoring.ts` | `proposalScore(sheets, rubric)` → `{ impact, ease, total }` on 0–100, `divergentCriteria(sheets, threshold)`, `rankProposals(items)` (ties D-N.10), `fundingLine(ranked, ceilingNgn)` | `needs.n1.test.ts` suite "Needs pipeline N1: scoring, ranking and the funding line" (5 tests, incl. "the plan's example: Impact 4.5/5 and Ease 3/5 give 78") | VERIFIED |
| B7 | `shared/src/utils/facilityBreakdown.ts` | `validateBreakdownRows(rows, sites, facilities)` (row issues with row number, column, reason), `essentialFacilityGaps(rows, sites, groups)`, `breakdownTotals(rows)`, `groupBreakdownByFacility(rows)` | `needs.n1.test.ts` suite "Needs pipeline N1: facilities breakdown" (5 tests) | VERIFIED |
| B8 | `shared/src/utils/needsCosting.ts` | `costingSummary(lines, standard, zone)`, `rateVariances(lines, standard, zone, tolerancePct)`, `ceilingBreaches(rows, lines, standard)`, `hasSupervisionLine(summary)` | `needs.n1.test.ts` suite "Needs pipeline N1: costing against the standard" (4 tests) | VERIFIED |
| B9 | `shared/src/utils/proposalReference.ts`, `shared/src/utils/needsDuplicates.ts`, `shared/src/utils/needsCalendar.ts` | `formatProposalReference` / `parseProposalReference` (`2027-DI-014`, `2027-MG-KN-007`); `normaliseSchoolName`, `findDuplicateMatches(site, candidates, radiusMeters)` (existing distance helper); `cycleDeadlines(config, interventionYear)` (cycle for year Y runs in Y − 1), `deadlineState(date, today)` | `needs.n1.test.ts` suite "Needs pipeline N1: references, duplicates and the calendar" (7 tests, incl. "carries a deadline before the opening date across the year boundary") | VERIFIED |
| B10 | Exports in `shared/src/index.ts`; `npm run build:shared` | – | `npm run build:shared` (first step of the gate typecheck); every test above imports from `@insite/shared` | VERIFIED |
| B11 | Type config key `needsPipeline` on `ProjectTypeConfigSchema` (default: disabled, so tenants without it are unchanged), group entry in `projectTypeConfigGroups.ts` (tab "Needs assessment"), placeholder editor tab in `ProjectTypeEditor` (read-only summary of stages, deadlines and rubric; editing comes in wave 2) | – | `typeConfigGroups.r6.test.ts` (5 tests); `needs.n1.test.ts` "a type without needsPipeline parses to a disabled pipeline, and the other keys are unchanged", "refuses an enabled pipeline without its stages, rubric or chains"; `routes.needs.n1.test.ts` "both programme types carry their pipeline, and the type API returns it", "another tenant's types are unchanged: no pipeline" | VERIFIED (key, default, group). The read-only editor tab is BUILT (owed WEB-NP1-01) |
| B12 | Permission category `NEEDS_FUNDING` ("Needs assessment & funding", first in the flow order) and the 18 keys of plan section 8 (`procurement:plan_lots` under Portfolio & projects); names and descriptions in UBEC wording | – | `routes.r7a.test.ts` "seeds exactly the catalogue, so the start-up sync has nothing to do" (catalogue = database, 3 tests); `permissions.r7a.test.ts` (6 tests); `routes.needs.n1.test.ts` "nobody else gained a pipeline permission" | VERIFIED. The category in the role editor is BUILT (owed WEB-NP1-03) |
| B13 | Audit actions in `AuditActionTypeEnum` and the Prisma enum: `NEEDS_CYCLE_OPENED`, `NEEDS_CYCLE_UPDATED`, `NEEDS_CYCLE_CLOSED`, `NEEDS_PROPOSAL_CREATED`, `NEEDS_VERSION_ADDED`, `NEEDS_PROPOSAL_SUBMITTED`, `NEEDS_PROPOSAL_RETURNED`, `NEEDS_PROPOSAL_WITHDRAWN`, `NEEDS_PROPOSAL_MERGED`, `NEEDS_FLAG_RESOLVED`, `NEEDS_STAGE_DECIDED`, `NEEDS_VALIDATION_RECORDED`, `NEEDS_COMMITTEE_UPDATED`, `NEEDS_CONFLICT_DECLARED`, `NEEDS_SCORE_SUBMITTED`, `NEEDS_RANKING_FINALISED`, `NEEDS_SUBMISSION_CREATED`, `NEEDS_APPROVAL_ACTION`, `NEEDS_FUNDING_RECORDED`, `NEEDS_PROPOSAL_CONVERTED`, `NEEDS_SEPARATION_OVERRIDDEN`, `COSTING_STANDARD_SAVED`, `PROJECT_CREATED_FROM_PROPOSAL` | – | `needs.n1.test.ts` suite "the shared enums and the database enums agree" (2 tests: the 146 audit actions are the same list in shared and Prisma; the 23 pipeline actions are there) | VERIFIED |

### 3.3 `NeedsPipelineConfigSchema` (key `needsPipeline`)

| Key | Type | DI default | MG default |
| :--- | :--- | :--- | :--- |
| `enabled` | boolean | true (seed) | true (seed) |
| `fundingGate` | `APPROPRIATION` \| `BEAP_APPROVAL` | `APPROPRIATION` | `BEAP_APPROVAL` |
| `referencePrefix` | `DI` \| `MG` | `DI` | `MG` (+ State code) |
| `cycleScope` | `NATIONAL` \| `STATE` | `NATIONAL` | `STATE` |
| `cycleOpens` | month, day | 1 Mar | 31 Jul |
| `stages[]` | stage, label, actor permission key, deadline (month, day, or null) | plan 6.2 and 4.3 | plan 6.2 and 4.3 (no `DESIGN`) |
| `minimumFields` | per stage, list of template field keys | DI identification: need, sites, breakdown, justification; design: + BoQ, drawings, preliminary cost | identification: everything (A8) |
| `rubric` | scale 5; dimensions `IMPACT` 60, `EASE` 40; criteria with labels and 5 descriptors; `divergenceThreshold` 2; `quorum` 3 | A6 | A6 |
| `essentialFacilityGroups[]` | label, facility codes | D-N.17 | D-N.17 |
| `rateVarianceTolerancePct` | number | 15 | 15 |
| `duplicateRadiusMeters` / `duplicateLookbackYears` | number | 100 / 3 | 100 / 3 |
| `requireSiteVerification` | boolean | true | true |
| `requireCounterpartEvidenceBeforeActivation` | boolean | false | true |
| `approvalChains` | `NEEDS_PORTFOLIO`, `BEAP`, `OUT_OF_CYCLE`: steps (label, permission key, organisation scope) | portfolio: Management review (`needs:review_portfolio`), ES approval (`needs:approve_portfolio`); out-of-cycle: ES (`needs:approve_out_of_cycle`) | portfolio: SUBEB management review, Executive Chairman endorsement (both `PROJECT_OWNER` scope = the SUBEB); BEAP: UBEC Physical Planning review (`needs:review_beap`), UBEC Executive Management approval (`needs:approve_beap`); out-of-cycle: Executive Chairman, then UBEC (`needs:approve_out_of_cycle`) |

### 3.4 Part C: Prisma models and migration

One additive migration `<timestamp>_needs_pipeline` generated with `prisma migrate diff` (CLAUDE.md), reviewed, applied. Column design is yours within these constraints; record the final names in section 4.

| # | Model | Must have | State |
| :--- | :--- | :--- | :--- |
| C1 | `NeedsCycle` | tenant, project type, intervention year, State code (MG), owning organisation, status, config snapshot (JSON, frozen at open), deadlines (JSON), template version, costing standard version id, indicative ceiling, opened/closed by and at; unique (tenant, type, year, State) | VERIFIED: `routes.needs.n1.test.ts` "a cycle holds everything under it, keeps its unique rules, and takes it all with it" (unique per tenant, type, year and `scopeKey`) |
| C2 | `NeedsCycleDocument` | cycle, kind, generated flag, file key, name, size, mime, sha256, supersedes id, uploaded by; covered proposals (join table or JSON ids) | VERIFIED: `routes.needs.n1.test.ts` "a cycle holds everything under it, keeps its unique rules, and takes it all with it" (`coveredProposalIds`) |
| C3 | `NeedsProposal` | cycle, reference (unique per tenant), sequence, title, route (`ANNUAL` \| `OUT_OF_CYCLE` + reason, authorising document), stage, status, State/LGA, current version id, latest preliminary / costed / approved / funded amounts, rank and score, line position, `carriedFromId`, `mergedIntoId`, `projectId` (unique, set on conversion), created by | VERIFIED: `routes.needs.n1.test.ts` "a cycle holds everything under it, keeps its unique rules, and takes it all with it"; "Project.origin is empty on a new row, takes the four origins, and a project links to one proposed project". No `projectId` column (section 5, item 6) |
| C4 | `NeedsAssessmentVersion` | proposal, number, source, file key and metadata, sha256, template version, costing standard version id, `parsedJson`, totals, uploaded by and at; unique (proposal, number) | VERIFIED: `routes.needs.n1.test.ts` "a cycle holds everything under it, keeps its unique rules, and takes it all with it" (unique per proposal and number) |
| C5 | `NeedsProposalSite`, `NeedsFacilityBreakdownRow` | rows of the current version (replaced in the same transaction as a new version) | VERIFIED: `routes.needs.n1.test.ts` "a cycle holds everything under it, keeps its unique rules, and takes it all with it" |
| C6 | `NeedsProposalDocument` | proposal, kind, file metadata, sha256, supersedes id, uploaded by | VERIFIED: `routes.needs.n1.test.ts` "a cycle holds everything under it, keeps its unique rules, and takes it all with it" |
| C7 | `NeedsProposalFlag` | proposal, kind, details JSON, raised on version, resolved by/at, resolution, reason | VERIFIED: `routes.needs.n1.test.ts` "a cycle holds everything under it, keeps its unique rules, and takes it all with it" |
| C8 | `NeedsValidationRecord` | proposal, version, outcome, desk notes, site verification (method, date, officer, evidence document ids), duplicate resolutions, recorded by | VERIFIED: `routes.needs.n1.test.ts` "a cycle holds everything under it, keeps its unique rules, and takes it all with it" |
| C9 | `NeedsStageDecision` + `NeedsStageDecisionItem` | cycle, stage, decided by, reason, evidence ids; items: proposal, outcome, reason | VERIFIED: `routes.needs.n1.test.ts` "a cycle holds everything under it, keeps its unique rules, and takes it all with it" |
| C10 | `NeedsCommitteeMember` | cycle, user, role (`CHAIR` \| `MEMBER`), conflict declaration (text, conflicted proposal ids, declared at); unique (cycle, user) | VERIFIED: `routes.needs.n1.test.ts` "a cycle holds everything under it, keeps its unique rules, and takes it all with it" (unique per cycle and user) |
| C11 | `NeedsScoreSheet` | cycle, proposal, member, scores JSON (criterion → 1–5), comment, submitted at; unique (proposal, member) | VERIFIED: `routes.needs.n1.test.ts` "a cycle holds everything under it, keeps its unique rules, and takes it all with it" (unique per proposal and member) |
| C12 | `NeedsSubmission` + `NeedsSubmissionItem` | cycle, kind, status, submitted by/at, memo document id; BEAP: counterpart declared amount, evidence document id; items: proposal, included/excluded, reason, lot and batch and procurement method (BEAP) | VERIFIED: `routes.needs.n1.test.ts` "a cycle holds everything under it, keeps its unique rules, and takes it all with it" |
| C13 | `NeedsApprovalStep` + `NeedsApprovalAction` (D-N.23) | same shape as the project tables, `cycleId` instead of `projectId`, subject = submission id | VERIFIED: `routes.needs.n1.test.ts` "a cycle holds everything under it, keeps its unique rules, and takes it all with it"; `needs.n1.test.ts` "walks the steps in order and gates on permission, organisation and the previous approver" |
| C14 | `CostingStandardVersion` | tenant, version, rates JSON, zone factors, S&M %, contingency %, ceilings JSON, design standard document ids, locked flag, saved by/at; unique (tenant, version) | VERIFIED: `routes.needs.n1.test.ts` "a cycle holds everything under it, keeps its unique rules, and takes it all with it" (unique per tenant and version; in use = cannot be deleted) |
| C15 | `Project.origin` (enum, migration backfills `LEGACY`, default for new rows set in code, not the database) and `Project.needsProposalId` (unique, nullable) | | VERIFIED: `routes.needs.n1.test.ts` "Project.origin is empty on a new row, takes the four origins, and a project links to one proposed project". The `LEGACY` backfill is one `UPDATE` in the migration (read, not run against old rows: the scratch database was empty) |
| C16 | `npx prisma generate`; seed reset list (children before parents; `NeedsProposal.carriedFromId`/`mergedIntoId` cleared before delete, like other self-references) | | VERIFIED: `npx prisma generate`; the seed ran four times (normal, overlay, normal, overlay) on the scratch database (section 6), each run clearing the needs tables first |

N8's `NeedsVerification` is **not** in this migration (wave 5 adds it).

### 3.5 Part D: tests

| # | Item | State |
| :--- | :--- | :--- |
| D1 | `server/src/tests/needs.n1.test.ts` (added to `test:unit`): every pure function in B4–B9, including each separation rule and error code, score maths on the plan's example (Impact 4.5/5, Ease 3/5 → 78), divergence, ties, funding line, essential gaps, rate variance, references, deadlines across the year boundary | VERIFIED: `needs.n1.test.ts`, 47 tests, in `test:unit` |
| D2 | Config defaults parse; a type without `needsPipeline` parses unchanged (existing type tests still pass) | VERIFIED: `needs.n1.test.ts` suite "type config and defaults" (6 tests); the earlier type tests pass unchanged (`projectTypeConfig.r1.test.ts`, `typeConfigGroups.r6.test.ts`, `routes.phase11.test.ts`) |
| D3 | `server/src/tests/routes.needs.scenarios.test.ts` (added to `test:routes`): two suites, **DI** and **MG** (+ `OOC-01`, `FIELD-01`), one subtest per step in section 3.7, each `{ todo: 'wave N' }`. Later waves remove the `todo` as they land | VERIFIED: `routes.needs.scenarios.test.ts` in `test:routes`: 25 steps (13 DI; 10 MG + OOC-01 + FIELD-01 = 12 in the Matching Grants suite), all `todo` (the gate counts todo 25) |
| D4 | Seed runs; `routes.r7a.test.ts` (catalogue = database) passes; tests that assert role or user lists updated for the new seed people | VERIFIED: seed normal and demo (section 6); `routes.r7a.test.ts` 3/3 (its migration replay adapted, section 5 item 20); `routes.needs.n1.test.ts` suite "seed people and grants" (4 tests). No earlier test asserted a role or user list that the new people changed |

### 3.6 Part E: seed people (D-N.25)

In `seedUbecRoster.ts` (normal seed; UBEC tenant only), grants as plan section 8:

| Login (`ubec.test`, `Password123!`) | Role | Notes |
| :--- | :--- | :--- |
| `procurement@` | Procurement Officer (`PROCUREMENT_OFFICER`) | new |
| `qs@` | Quantity Surveyor (`QUANTITY_SURVEYOR`) | new |
| `es@`, `dpp@`, `finance@` | `EXECUTIVE_SECRETARY`, `DIRECTOR_PHYSICAL_PLANNING`, `FINANCE_OFFICER` | moved from the overlay into the normal seed; the overlay reuses them by email |
| `kano.dpp@`, `kano.procurement@` | `SUBEB_DIRECTOR_PHYSICAL_PLANNING`, `SUBEB_PROCUREMENT_OFFICER` (Kano SUBEB) | new |
| existing `me.officer@`, `kano.admin@`, `admin@` | add `needs:view` + `needs:validate`; Chairman grants (plan section 8); all | |

The two UBEC programme types get `DEFAULT_DI_NEEDS_PIPELINE` / `DEFAULT_MG_NEEDS_PIPELINE` merged into their config without a version bump (seed only, like Phases 13–16). Also run `SEED_PROFILE=ubec-demo npm run prisma:seed` once to prove the overlay still works.

### 3.7 Scenario steps (D3) and the wave that turns each green

| ID | Step | Wave |
| :--- | :--- | :--- |
| DI-01 | `dpp@` opens the 2027 DI cycle; config snapshot and deadlines stored | 2 |
| DI-02 | `procurement@` uploads three files at once; the file with row errors is refused with row, column and reason; two proposals created with references | 2 |
| DI-03 | Duplicate and essential-facility flags raised on the right proposal | 2 |
| DI-04 | `procurement@` submits both to Validation | 3 |
| DI-05 | `procurement@` cannot validate (409 `SAME_PERSON_VALIDATION`) | 3 |
| DI-06 | `me.officer@` validates one (duplicate resolved, essential gap justified), returns the other; it is resubmitted and validated; Validated Project List generated | 3 |
| DI-07 | Design versions uploaded (v2 each; v1 kept) | 3 |
| DI-08 | `qs@` uploads costed versions; a rate variance is acknowledged with a reason; S&M line present; Cost Estimate Report generated | 3 |
| DI-09 | Committee (`es@` chair, `dpp@`, `finance@`, `procurement@`): declarations, `procurement@` recused from its uploads, scores, one divergence flagged, ranking, line, override with reason, finalised; Prioritised Project Portfolio generated | 3 |
| DI-10 | `procurement@` submits the portfolio; `dpp@` management review; `es@` approves with one exclusion and the memo | 4 |
| DI-11 | `finance@` records the budget submission and imports the appropriated schedule; the funded proposal converts; the excluded one is "Not funded, carried forward" | 4 |
| DI-12 | The draft project has the proposal's sites, units from breakdown rows, BoQ lines and funded budget, origin `NEEDS_PIPELINE`, an approved-list row; `procurement@` assigns a lot; a draft with origin none cannot be activated | 4 |
| DI-13 | Opening the 2028 cycle offers the carried-forward proposal; carried, it starts at Validation with its versions linked | 4 |
| MG-01 | `kano.dpp@` opens the Kano 2027 MG cycle with the circular | 2 |
| MG-02 | `kano.procurement@` uploads; a file without BoQ is refused (MG minimum fields) | 2 |
| MG-03 | Lagos SUBEB users cannot see the Kano cycle | 2 |
| MG-04 | `kano.dpp@` field-verifies; asks for a separation override to cost (the same person validated); `kano.admin@` (Executive Chairman) authorises it; `kano.dpp@` costs; the override stays flagged and is in the ledger | 3 |
| MG-05 | SUBEB committee (`kano.admin@` chair, three members with the umbrella role `SUBEB_COMMITTEE_MEMBER`; `kano.dpp@` and `kano.procurement@` recused) scores and finalises | 3 |
| MG-06 | SUBEB management review and `kano.admin@` endorsement | 4 |
| MG-07 | BEAP built (lot, batch, procurement method per proposal; counterpart declared) and submitted | 4 |
| MG-08 | `dpp@` reviews, comments on one proposal and returns; SUBEB revises (new version) and resubmits | 4 |
| MG-09 | `es@` approves (Executive Management); proposals convert, owner Kano SUBEB, lot and batch from the BEAP | 4 |
| MG-10 | Activation refused until counterpart evidence is recorded; then allowed | 4 |
| OOC-01 | Out-of-cycle request (emergency, authorising document) approved by `es@`; converts with origin `OUT_OF_CYCLE` | 4 |
| FIELD-01 | A verification visit submitted from the field app fills the validation record and corrects a site's coordinates | 5 |

## 4. Deliverable for later waves: contract names

When Part B and C are done, add section 17 "Contract names" to the parent plan: every shared schema and util name, every Prisma model and its key columns, permission keys, audit actions, error codes reserved so far, and the route prefixes reserved for later waves (`/api/v1/needs/cycles`, `/api/v1/needs/proposals`, `/api/v1/needs/tasks`, `/api/v1/costing-standards`, `/api/v1/standards`). Later waves' agent briefs cite that section; it wins over the wave files where they differ.

## 5. Found during implementation

Wave 1 ran on 2026-11-26 in the main thread, no subagents. No clarification round was held: the two points that could have been asked had a safe default (items 1 and 2).

### 5.1 Before starting

| # | Finding | What was done |
| :--- | :--- | :--- |
| 1 | **Demo answers.** Parent plan 16.1 was empty and the Minister demo is on 2026-11-27, the day after this wave ran | Section 0 step 2 applied: the section 3 assumptions stand. 16.1 now says, per assumption, where it lives, so an answer that differs is one change. **Fill 16.1 before wave 2** |
| 2 | **Dev database.** The pre-demo round recorded the dev database (`insite_assurance`) as "demo-ready; snapshot taken" for 2026-11-27. This wave has to apply migrations and run the seed twice | Nothing was run against the dev database. Migrations and seeds ran on a scratch database, `insite_needs_w1`, on the same server (`DATABASE_URL` set for those commands only). **Owed:** after the demo, from `server/`: `npx prisma migrate deploy`, then `npm run prisma:seed` (or `SEED_PROFILE=ubec-demo npm run prisma:seed`). The migrations are additive and safe for older code (new tables, a nullable `Project.origin` without a default, enum values); the scratch database can be dropped. **Done on the owner's word the same evening:** the dev database was backed up (`pg_dump`, custom format: `../insite_db_backups/insite_assurance_2026-11-26_pre-needs-pipeline.dump` next to the repo; 27 projects, 19 users, last migration `20261227090003`), migrated (`prisma migrate deploy`: both needs pipeline migrations) and reseeded with `SEED_PROFILE=ubec-demo`. Checked after: no schema drift; 18 UBEC demo projects (26 in all: the click-through's leftover draft is gone), 23 users incl. the 7 pipeline logins, both programme types carry the pipeline, story 7 mobilisation due award + 21 with two checks proposed. Restore if needed: `pg_restore --clean --if-exists --no-owner -d <url> <file>`. Phones must sign out and in (the seed replaced record ids). |
| 3 | **Baseline.** The tree had uncommitted work since the last recorded gate (the design round: Overview charts, navigation) | Baseline rerun before any edit (section 6) |

### 5.2 Decisions and deviations

| # | Topic | Decision |
| :--- | :--- | :--- |
| 4 | Migration count | **Two migrations**, not one: `20261228090000_needs_pipeline_enums` (enum values) and `20261228090001_needs_pipeline` (the rest). PostgreSQL does not let a transaction use an enum value it has just added, and the second file inserts permission rows in the new category `NEEDS_FUNDING` and grants them to `TENANT_SUPER_ADMIN`. Generated with `prisma migrate diff`, split by hand; the diff drops nothing and the earlier hand-written indexes are untouched |
| 5 | `Project.origin` | Prisma enum `ProjectOrigin`, **nullable**: null is "no origin" (D-N.13). The migration backfills `LEGACY`; there is no database default. Projects the seed creates (after the migration) have origin null: nothing reads it yet. **Wave 4** must give the seeded projects an origin before it adds the activation gate, and N7 sets `REGISTER_IMPORT` in the register import |
| 6 | `NeedsProposal.projectId` (C3) | Not a column. A second pointer would have to be kept in step with `Project.needsProposalId` (C15); the one-to-one is that unique foreign key, read as `proposal.project` |
| 7 | Cycle uniqueness (C1) | `scopeKey` (`NATIONAL` or the State code) beside the nullable `stateCode`: a unique index over a null State would let two national cycles in |
| 8 | Chain types (D-N.11, D-N.23) | `NeedsChainTypeEnum` (`NEEDS_PORTFOLIO`, `BEAP`, `OUT_OF_CYCLE`) is its own enum and a string column. Adding the values to `ApprovalChainTypeEnum` would offer them to workflow templates and project chains. The pure functions of `approvalChain.ts` now take `ChainStepLike` / `ChainActionLike` (the fields they read), so cycle rows pass as they are (test: "cycle approval steps reuse the chain engine") |
| 9 | Column types | Enum-like columns are strings checked by the shared Zod enums, as in the client demo waves. "By" columns are a user id and a name without a relation (like the ledger); committee members and approval actions relate to `User` |
| 10 | Breakdown row rules (plan 6.3 against D-N.17) | 6.3 says proposed quantity > 0, D-N.17 says "a proposed row or an existing row in condition Functional". Both hold only if a row can record an existing facility without work, so **proposed quantity 0 is allowed when the existing quantity is above 0**; such a row becomes no unit and carries no cost. And the uniqueness key is **facility + intervention action + site** (6.3 says facility + site), so a school can renovate one classroom block and build another |
| 11 | Config beyond section 3.3 | `extraDeadlines` and a `deadline` on chain steps, so the plan 4.3 calendar fits (stakeholder summary 30 June, budget submission 15 December, BEAP submitted 15 November, SUBEB management 27 October, UBEC review 22 November). Relative deadlines ("procurement plan 6 weeks after appropriation", "revision 5 working days") are not modelled: wave 4. A date before the cycle-opening date falls in the intervention year (the calendar may run past December) |
| 12 | Permission category order | `NEEDS_FUNDING` sits after Forms & facilities and before Portfolio & projects: first of the programme-flow categories, after the two workspace ones |
| 13 | Type editor tab (B11) | Group `needs`, label "Needs assessment", first tab. It is read-only (`NeedsPipelineSummary`); the editor still opens on Kick-off & mobilisation. The value rides in the editor's untouched `rest`, so a save keeps it |
| 14 | Seed roles | In the normal seed the seven pipeline roles hold **only** their needs pipeline grants, so no earlier test's notifications, visibility or counts change. The demo overlay upserts the three it used to create and adds its project permissions to the grants |
| 15 | **Grant added to plan section 8** | `needs:review_portfolio` for the SUBEB Director Physical Planning. MG-06's "SUBEB management review" needs someone in the SUBEB who is neither the submitter (SUBEB Procurement) nor the Executive Chairman (who endorses next); nobody else in the Kano SUBEB could hold the step |
| 16 | **Matching Grants roster: decided by the owner after wave 1** | Found: MG-04 needed one person to validate and cost on their own override, and nobody who costs held the override; MG-05 had nobody left to score (both Kano pipeline users are recused from every proposal; quorum 3). **Owner decisions (2026-11-26, parent plan 16.2):** (O-1) the override is a second person's authorisation; applied to this wave's contracts the same day (`checkSeparation` takes the authorisation, `authorisationProblem`, `SeparationOverrideRequestSchema`, `SeparationOverrideDecisionRequestSchema`, resolutions `AUTHORISED` / `REFUSED`; `needs:override_separation` renamed "Authorise Separation of Duties Overrides"; test "an override is a second person's authorisation, for this action and this person (D-N.9)", 53/53 with `permissions.r7a`). (O-2) one umbrella role for the extra committee members: seeded in wave 3. MG-04 and MG-05 in section 3.7 are rewritten to match |
| 17 | BEAP steps "outside the SUBEB subtree" (plan section 7) | No organisation scope means "not the owner". The default BEAP chain uses `ANY`; **wave 4** enforces the rule in the BEAP service |
| 18 | N0: seed stories | PRG-102: awarded 16 days ago, signed 12, kick-off held 8 days ago (award + 8), mobilisation due in 5 days (award + 21); its documents moved with it. PRG-101 (draft): awarded 3 days ago so its kick-off in 9 days is inside the window (it had been award + 21, which would now warn). PRG-106 (closure twin): mobilised 14 days after a kick-off held 20 days after award, which was on time under "kick-off + 21" and 13 days late under "award + 21"; its award moved to 7 days before the kick-off (signed 4 days before), so it mobilised on the day it was due. PRG-104, PRG-105 and the overlay's histories complete each milestone on or just before its due date, so they stay on time (test: "every other Direct Intervention project counts its mobilisation from award too"). PRG-103 was 9 days late before and is 29 days late now: still late, left as it is. **For N9:** those histories keep a kick-off 20 days after award, outside the new 14-day window (held, so no warning); re-date them when the demo data is rebuilt |
| 19 | N0: the warning | `KICKOFF_AFTER_AWARD_WINDOW` is in `ProjectKickoffDto.warnings` (a new required field of the DTO). It applies when the project's type snapshot has an `AUTO_CONTRACTOR_ON_SITE` milestone anchored on `CONTRACT_AWARD`, compares the scheduled meeting's day (else the planned kick-off date) with award + 14, and goes away once the kick-off is held. 14 is the shared constant `KICKOFF_AFTER_AWARD_WINDOW_DAYS`, not a type setting (D-N.22 gives the number). The kick-off routes are not served on a draft, so the notice is seen on live projects |
| 20 | `routes.r7a.test.ts` | Its replay of the R7a migration recreates `PermissionCategory` with eight values. The test now replays in history order: rows of a later category wait in an R7a one, then the category is added back and the sync restores them |
| 21 | `prisma format` | Run once on the schema: it re-aligned the columns of the blocks touched (whitespace only) |
| 22 | For wave 4 (D-N.15) | `PROJECT_CODE_PREFIX_REGEX` does not accept a proposal reference (`2027-DI-014`): widen it when a converted draft keeps the reference as its code |
| 23 | Snapshots | The pipeline defaults are merged into the two programme **types** only. A project snapshot written from now on carries the type's `needsPipeline`; earlier snapshots read as disabled, which is correct for them |
| 24 | Not built (as the wave says) | No pipeline service, route or page; no template v2; the D1 flow is untouched; no `NeedsVerification`; no web notification category (D-N.24) |
| 25 | **N0 consequence found by the gate: mobilisation checks** | The first full gate failed in `routes.demo.test.ts` (steps 2 and 4). With mobilisation due 21 days from award, the time left after the kick-off is 7 to 21 days, and the type's rule "mobilisation check every 2 weeks until mobilised" proposed no check before the due date when less than 14 days were left (the demo project: award 14 days before the kick-off; and PRG-102 lost its seeded check). Without a check the milestone would run overdue and open a default case unseen. **Fixed in the rule, not in the test:** `EVERY_N_WEEKS_UNTIL_MOBILISED` (`shared/src/utils/visitPlan.ts`) proposes one check on the last working day on or before the due date when the window holds no interval date, as a sprint shorter than the interval already gets one visit. Windows that hold an interval, a passed due date and Matching Grants (14 days from the kick-off, check on day 14) are unchanged. Test: `visits.r4.test.ts` "until mobilised: a window shorter than the interval still gets one check, on the due date (needs pipeline N0)"; the demo walk-through passes again |

## 6. Verification

| Gate | Typecheck | Lint | Web build | Server unit | Server routes | Mobile | Seed (normal / demo) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Last recorded gate (pre-demo round, 2026-11-26) | ✓ | 0 errors (53 warnings) | ✓ | 262/262 | 443/443 | 169/169 | overlay ×2, normal, overlay ✓ |
| Baseline, rerun 2026-11-26 before any edit (the tree had the uncommitted design round) | ✓ | 0 errors (52 warnings) | ✓ | 262/262 | 454/454 | 169/169 | not rerun (the dev database was left alone, section 5 item 2) |
| End of wave 1, 2026-11-26 (full gate: migration and seed changed) | ✓ | 0 errors (52 warnings) | ✓ | **310/310** (262 + 47 in `needs.n1.test.ts` + 1 in `visits.r4.test.ts`) | **470/470 pass, 25 todo** of 495 (454 + 16 in `routes.needs.n1.test.ts` + the 25 todo scenario steps) | 169/169 | normal ✓, overlay ✓, normal ✓, overlay ✓ (scratch database `insite_needs_w1`); schema diff against it empty |

- **The recorded gate is the third run.** Run 1 failed in `routes.demo.test.ts` (2 steps): the mobilisation-check rule, fixed (section 5 item 25). Run 2 was stopped when the seeded data check showed PRG-106's mobilisation had turned late (section 5 item 18); its seed dates were fixed and a test added. Run 3, on the final code, is the row above; nothing was edited while it ran.
- **Database.** The gate's route tests use the test databases (`insite_assurance_test` and its template), as always. Migrations and seeds ran on the scratch database only: `prisma migrate deploy` (both new migrations applied), then the seed four times; `prisma migrate diff` from that database to the schema is an empty migration (no drift). The dev database `insite_assurance` was not touched (section 5 item 2).
- **Checked in the scratch database after the overlay seed:** every Direct Intervention `contractor-mobilised` milestone is anchored on `CONTRACT_AWARD` with due date award + 21, every Matching Grants one on `KICKOFF` + 14; story 7 (PRG-102) is due on today + 5 with its mobilisation checks proposed; story 3 (PRG-106) mobilised on its due date; 17 permissions in `NEEDS_FUNDING`; 13 roles and 15 logins on the UBEC tenant; `Project.origin` null on all 26 seeded projects (section 5 item 5).
- **Not verified by a test:** the three small web changes (type editor tab, kick-off notice, role editor category). They typecheck, lint and build; click-throughs are owed as WEB-NP1-01, -02, -03 in `web_testing_checklist.md` section 6g. The DTO schemas of B1 and B2 only typecheck until a service returns them.

## 7. Exit criteria (hand-off to wave 2)

**State on 2026-11-26: met, with three owed click-throughs and two things the owner has to do or decide.** Every row of section 3 is VERIFIED by a named test in the recorded gate (section 6), except the web parts of A3, B11 and B12, which are BUILT with owed checks WEB-NP1-01 to -03. The full gate passed. The parent plan has section 17 (contract names), section 16.1 (filled: no demo answers yet, assumptions stand) and 16.2. `routes.needs.scenarios.test.ts` lists the 25 steps as `todo`. **Before wave 2:** fill 16.1 with the demo answers; apply the migrations to the dev database (section 5 item 2). **Before wave 3:** the owner settles the Matching Grants roster (section 5 item 16).

- Every row in section 3 is VERIFIED (B11 may be BUILT with an owed click-through).
- The full gate passed and is recorded.
- Parent plan updated: section 17 (contract names), section 16.1 filled, any decision changed in this wave amended in section 5.
- `routes.needs.scenarios.test.ts` lists every step as `todo`.
- Not done in this wave (do not start): services, routes and pages for the pipeline; template v2; removal of the D1 flow.
