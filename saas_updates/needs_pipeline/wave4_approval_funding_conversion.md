# Needs Pipeline · Wave 4: Approval, funding, BEAP, conversion, project integration (N6 + N7b–e)

Parent plan: `saas_updates/needs_pipeline_implementation_plan.md`. **Contract names: parent plan section 17.**

**Starts when:** wave 3 exit criteria are met. **Outcome:** the DI suite and the MG suite run green end to end; funded proposals are projects; nothing goes live without an origin; the old D1 upload flow is gone.

## 0. Start of wave (main thread)

1. Read wave 3 "Found during implementation". Settle the `// wave 4 settles` schemas (submissions, BEAP items, counterpart, funding import, out-of-cycle request, lot assignment).
2. **Main builds the shared submission base first** (`server/src/modules/needs/submissions/submissions.service.ts`: create a submission, load the cycle's chain steps, act through the pure engine functions with the cycle's `orgContext`, progress DTO, audit `NEEDS_SUBMISSION_CREATED` / `NEEDS_APPROVAL_ACTION`). Tracks A and B extend it in their own files.
3. Project documents: **read-through** (no copy, no migration): the project's Documents page shows a "Needs assessment" group fetched from its proposal and cycle (read-only). Record here if that changes.

## 1. Tracks

### Track A (agent): server, approval and out-of-cycle (N6)

Owns: `server/src/modules/needs/submissions/portfolio.service.ts`, `outOfCycle.service.ts`, their route file, `server/src/tests/routes.needs.n6.test.ts`.

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| A1 | Portfolio submission from the finalised ranking (included / excluded with reasons), management review, final approval with the memo required on the last step; approved → `FUNDING`; excluded → `NOT_SELECTED`; `SAME_PERSON_APPROVAL` | `routes.needs.n6.test.ts` suite "N6 A1: the portfolio and its approval chain" (11 tests incl. ANNUAL only, SAME_PERSON_APPROVAL, memo, return and resubmit, effects and ledger); scenario DI-10 | VERIFIED |
| A2 | MG state approval uses the same chain with SUBEB-scoped steps | `routes.needs.n6.test.ts` suite "N6 A2" (1); scenario MG-06 (dpp@ refused 403 NOT_STEP_ORGANIZATION on the SUBEB step) | VERIFIED |
| A3 | Out-of-cycle: request (reason, authorising document, optional needs assessment upload) → `OUT_OF_CYCLE` chain → on approval converts with origin `OUT_OF_CYCLE` | `routes.needs.n6.test.ts` suite "N6 A3: out-of-cycle requests" (7: container, edit and withdraw, isolation, return then correct with a needs assessment then approve, MG Chairman then UBEC, list, CLOSED-cycle reads); scenarios OOC-01, R1, R3 | VERIFIED |

### Track B (agent): server, funding, BEAP, activation (N7b–c)

Owns: `server/src/modules/needs/funding/*`, `server/src/modules/needs/submissions/beap.service.ts`, its route file, `server/src/tests/routes.needs.n7.test.ts`; the activation gate change in the project activation service (one function, agreed with main).

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| B1 | DI budget submission record (date, amount, acknowledgement document) | `routes.needs.n7.test.ts` suite B1 (2) | VERIFIED |
| B2 | Appropriated schedule import (approved-list workbook + "Proposal reference" column; preview: matched, partly funded, not funded, unknown rows refused unless an approved out-of-cycle proposal; confirm in one transaction under the tenant lock): conversion of matched proposals, `NOT_SELECTED` ("Not funded, carried forward") for the rest, `ApprovedList` (kind `DI_SCHEDULE`) written with rows linked to the new projects (D-N.12); `SAME_PERSON_FUNDING` | `routes.needs.n7.test.ts` suite B2 (6: template and preview outcomes, refused rows, FILE_CHANGED, list exists, SAME_PERSON_FUNDING, confirm effects, ALREADY_IMPORTED); scenarios DI-11, R4 | VERIFIED |
| B3 | Procurement plan: assign lots and batches to converted DI drafts (`procurement:plan_lots`; existing `lotChoice` on a draft without a lot); approved plan uploaded as a cycle document | `routes.needs.n7.test.ts` suite B3 (2); scenario DI-12 | VERIFIED |
| B4 | BEAP: build from approved proposals (lot, batch, procurement method, timeline per item; narrative document; counterpart amount and evidence), submit, UBEC review (per-item comment, request removal; return), SUBEB revision (new versions, `BEAP_REVISION`), resubmit, approval → conversion (owner = SUBEB, lot and batch from the BEAP), `ApprovedList` (kind `MG_BEAP`) written | `routes.needs.n7.test.ts` suite B4 (5: build and submit, per-item review, revision, approval with lots and the MG_BEAP list); scenarios MG-07, MG-08, MG-09, R2 | VERIFIED |
| B5 | Activation gate: origin required (D-N.13); MG with `requireCounterpartEvidenceBeforeActivation` needs the BEAP's evidence (409 codes recorded in section 17) | `routes.needs.n7.test.ts` suite B5 (4, incl. the out-of-cycle exemption); `routes.r6a.test.ts` five-step draft (409 then 200); scenarios DI-12, MG-10 | VERIFIED |

### Track C (agent): web

Owns: `web/src/components/needs/submissions/*`, `web/src/components/needs/funding/*`, Approvals and Procurement plan tabs, the New project menu, Portfolio Pipeline tab, project Overview Origin card, Sprints & scope Facilities tab, Documents "Needs assessment" group.

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| C1 | Approval review (count, total, distribution by zone/State/LGA, exclusions, memo, decide) | web typecheck, lint (0 errors), build | BUILT (owed WT-N4-01 … -07) |
| C2 | BEAP workspace (SUBEB build and submit; UBEC review per item; revision; approval) | web typecheck, lint, build | BUILT (owed WT-N4-47 … -53) |
| C3 | Funding tab (DI budget submission; appropriated schedule import preview and confirm); Procurement plan tab (lots) | web typecheck, lint, build | BUILT (owed WT-N4-40 … -46) |
| C4 | New project menu: "New proposed project" (upload into the open cycle) and "Out-of-cycle project" | web typecheck, lint, build | BUILT (owed WT-N4-08 … -14, -21) |
| C5 | Portfolio → Pipeline tab; project Origin card; Facilities tab on Sprints & scope; Documents group | web typecheck, lint, build | BUILT (owed WT-N4-15 … -20) |
| C6 | `WT-N4-*` owed checks | `web_testing_checklist.md` section 6j (WT-N4-01 … -21, -40 … -53) | DONE |

### Main thread, last: retire the old paths (N7e)

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| M1 | **Full gate before deleting code** | Section 4 "Before N7e deletion" (run 1 failures were test expectations; fixed and rerun, section 5.6 item 18) | VERIFIED |
| M2 | Remove `/projects/from-needs-assessment/*`, the D1 web flow and their tests; keep `createProjectDraftInTx` and the scope-import internals (used by conversion) | Section 4 "End of wave 4" (typecheck, build, routes without the D1 test) | VERIFIED |
| M3 | Register import: admin only, origin `REGISTER_IMPORT`; "Outside annual cycle" chip on portfolio rows and exports for `OUT_OF_CYCLE` | `routes.irl.register.test.ts`, `routes.demo.lots.test.ts` (admin@ imports; origin column in the export); web WT-N4-19, -20 owed | VERIFIED |
| M4 | Closure pack: `needs-assessment/` folder (versions, validation, scores, approval memo, funding record) | `needs.closurePack.n7e.test.ts` (1) | VERIFIED |
| M5 | Demo pack: remove the D1 file, keep the approved-list upload file for past years | `buildDemoPack.ts` typechecks; the D1 file removed from `saas_updates/demo_pack/`; README updated | VERIFIED |

## 2. Scenario steps turned green

DI-10 … DI-13, MG-06 … MG-10, OOC-01. **Both suites fully green except FIELD-01.**

## 3. End of wave

Full gate after M2–M5; `/code-review high` focused on conversion, the activation gate, chain organisation scope and the funding import; record below and in parent plan section 15.

## 4. Verification

| Gate | Typecheck | Lint | Web build | Server unit | Server routes | Mobile | Seed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Baseline (wave 3 record, run 2; tree clean at `9c3f2d0`) | ✓ | 0 errors (52 warnings) | ✓ | 329/329 | 593/593 pass, 11 todo | 169/169 | normal ✓, overlay ✓ |
| Before N7e deletion (M1), 2026-11-27 | ✓ | 0 errors (52 warnings) | ✓ | 327/329 (2 test expectations: pipeline audit count, draft visibility clause) | 654 pass, 3 fail, 1 todo of 658 (test expectations: two `routes.demo.sites` drafts behind the origin gate, n1 "no default origin"); the five files fixed and rerun green | 169/169 | normal ✓, overlay ✓ (scratch `insite_needs_w1`, migration `20261231090000_needs_w4_funding`); schema diff empty |
| **End of wave 4, 2026-11-27 (after M2–M5 and the review fixes)** | ✓ | 0 errors (52 warnings) | ✓ | **329/329** | **653/653 pass, 1 todo** of 654 (M1 − `routes.demo.needsAssessment` + review tests; scenario steps all green but FIELD-01) | 169/169 | normal ✓ (19 projects LEGACY), overlay ✓ (26) on scratch `insite_needs_w1`; schema diff empty |

- Nothing was edited while a gate ran. The demo database `insite_assurance` was not touched: the wave 2, 3 and 4 migrations are owed there (`npx prisma migrate deploy` from `server/`, then a reseed), on the owner's word.

## 5. Found during implementation

Wave 4 ran on 2026-11-27 on the owner's instruction (no Minister demo answers: the plan section 3 assumptions stand; no clarification round). Main thread: shared contracts (plan 17.10), migration, submission base, conversion extensions, the out-of-cycle container cycle, the activation gate, seed, mounts, test lists, web tab slots, M2–M5, DI-13, integration; four agents: Track A (server approval, out-of-cycle, project integration reads, task queue), Track B (server funding, BEAP, procurement plan, activation tests), Track C (web approvals, out-of-cycle, New project menu, Pipeline tab, Origin card, Facilities tab, Documents group, origin chip), Track D (web Funding / BEAP and Procurement plan tabs). Server agents used their own test databases (`insite_w4a_test`, `insite_w4b_test`; main `insite_w4main_test`).

### 5.1 Before starting

| # | Finding | What was done |
| :--- | :--- | :--- |
| 1 | The owner's instruction named `wave4_upload_standards.md` | The wave 4 file is this one (`wave4_approval_funding_conversion.md`) |
| 2 | Database | Migration and seeds on the scratch database `insite_needs_w1` only. `insite_assurance` (the demo database) was not touched: waves 2, 3 and 4 migrations are owed there |
| 3 | Baseline | From the wave 3 record (run 2: unit 329, routes 593 + 11 todo, mobile 169); the tree was clean at `9c3f2d0` |

### 5.2 Decisions and deviations (main thread)

| # | Topic | Decision |
| :--- | :--- | :--- |
| 4 | Contracts | Settled before briefing (plan 17.10): submission statuses (portfolio created IN_REVIEW; BEAP and out-of-cycle DRAFT first; RETURNED; APPROVED), decisions APPROVE / RETURN only (no rejection: a returned list can be withdrawn or resubmitted), portfolio items and exclusions, memo on the last step, out-of-cycle request, funding records, appropriated schedule (approved-list columns with a required "Proposal reference" in place of "Project ID": `APPROPRIATED_SCHEDULE_COLUMNS`; the manual approved-list template is unchanged), procurement plan, BEAP items (lot title, procurement method, planned dates; lot and batch numbers given at conversion), BEAP review outcomes, counterpart, pipeline rows, project origin DTO; `ProjectRegisterFields.origin` on every project DTO; pure `needsDistribution` |
| 5 | Migration `20261231090000_needs_w4_funding` | Additive: `NeedsFundingRecord`, `NeedsProposal.outOfCycleDetails`, `NeedsSubmission.narrativeDocumentId` and `counterpartRecorded*`, `NeedsSubmissionItem.plannedStartDate/EndDate`, audit values `NEEDS_SUBMISSION_UPDATED`, `NEEDS_COUNTERPART_RECORDED`, `NEEDS_LOTS_ASSIGNED` (unused in the migration) |
| 6 | Submission base (`submissions/submissions.service.ts`) | One engine for the three cycle chains; each track owns its routes and effects (hooks `beforeAct`, `onApproved`, `onReturned`). Gate order: permission (403 NOT_STEP_APPROVER), separation (409 SAME_PERSON_APPROVAL: the submitter, or anyone who approved a step of the current pass; a return counts as acting), organisation scope against the cycle owner (403 NOT_STEP_ORGANIZATION, no bypass), then plan section 7's UBEC rule: on a State cycle, an `ANY` step of the BEAP or OUT_OF_CYCLE chain needs an organisation outside the SUBEB's subtree (403 NOT_STEP_ORGANIZATION). Submission-level ledger entries carry `proposalIds`; the proposal history now reads them |
| 7 | Late proposals (wave 3 B-7) | They re-enter through the out-of-cycle route; no second ranking round in wave 4 |
| 8 | Out-of-cycle container | A request is filed in the programme's cycle for that year and scope (OPEN or CLOSED); a year without one gets a CLOSED container cycle (`ensureCycleForOutOfCycle`; ledger `NEEDS_CYCLE_OPENED` with `container: true`). Opening the annual cycle of that year later adopts the container (review fix R1) |
| 9 | Conversion (N7a extended) | `origin` (default NEEDS_PIPELINE, OUT_OF_CYCLE for that route), `approvedListRowId`; an out-of-cycle request without a needs assessment converts to a bare draft (name, type, year, State, budget, justification = the request's details; sites and scope not marked saved) |
| 10 | Activation gate (`funding/activationGate.ts`, first check in `activateProject`) | 409 PROJECT_ORIGIN_REQUIRED only for drafts whose type snapshot runs the needs pipeline: programmes without it have no way to give an origin, so they are not gated. 409 COUNTERPART_EVIDENCE_REQUIRED reads the cycle's frozen `requireCounterpartEvidenceBeforeActivation` and the APPROVED BEAP that includes the proposal. Both before the setup issues (422 PROJECT_INCOMPLETE). The setup DTO's `canActivate` does not include the origin (the web shows the 409's message) |
| 11 | Seed | Every seeded project (normal and overlay) gets origin LEGACY at the end of `runSeed`, as the wave 1 migration did for existing rows. `needsFundingRecord` added to the reset list. The SUBEB Director, Physical Planning already held `needs:review_portfolio` (SUBEB management review in MG-06) |
| 12 | Tests hit by the gate | `routes.r6a.test.ts` (the five-step draft now asserts 409 PROJECT_ORIGIN_REQUIRED, then is given LEGACY; the other drafts get LEGACY at creation) and `routes.demo.test.ts` (the walk predates the pipeline: its draft is LEGACY until wave 5 rewrites the demo) |
| 13 | M3 register import | Admin only = `projects:create` and `tenant:manage_settings`; created projects (drafts too) get origin REGISTER_IMPORT. Register export: "Origin" column (xlsx) and a line in "Year / funding" (PDF) reading "Outside annual cycle" for OUT_OF_CYCLE |
| 14 | M4 closure pack | `needs-assessment/` (`completion/closurePackNeeds.ts`): versions (files), the proposal's documents, cycle documents that cover it or that its submissions and funding records name (memo, narrative, counterpart evidence, schedule …), `validation-records.csv`, `score-sheets.csv`, `approvals-and-funding.json`, `proposal-history.csv` (tenant ledger); unreadable files listed in the manifest. Only for projects with a proposal |
| 15 | `beapReviewerCycleBranch` | Holders of `needs:review_beap` or `needs:approve_beap` see a State cycle once a BEAP has been submitted (UBEC HQ already sees SUBEB cycles below it; this covers a SUBEB outside its tree) |
| 16 | Web tab slots | The main thread added the Funding tab ("BEAP" on a Matching Grants cycle) and rendered `ApprovalsTab` (Track C), `FundingTab` and `ProcurementPlanTab` (Track D) from stubs, so no two agents edit `NeedsAssessmentPage.tsx` (Track C only adds `?upload=1`) |
| 17 | Converted drafts (found by Track A) | A draft was visible only to its creator and to holders of `projects:create` / `projects:edit_baseline`, so a Matching Grants draft converted by a UBEC approver was invisible to the SUBEB. A draft with a proposal (`needsProposalId`) now follows the project visibility rule (owner tree, assignment, tenant-wide) in both the guard and the list filter (`accessControl.ts`). **Resolved after the wave (owner, 2026-11-27):** the SUBEB Administrator gets `projects:edit_baseline`, `projects:activate`, `scope:edit`, `contractors:view_register` (`SUBEB_ADMIN_PROJECT_GRANTS` in `seedUbecRoster.ts`, seed-tailored until the role catalogue migration), still limited to its SUBEB's subtree; scenario MG-09 asserts it |

### 5.3 Track A (server: approval, out-of-cycle, integration, queue)

| # | Decision |
| :--- | :--- |
| A-1 | A portfolio covers only route ANNUAL proposals at Approval / IN_PROGRESS; submitted out-of-cycle requests at the same stage are neither required nor accepted (main thread's correction after Track C's report) |
| A-2 | A RETURNED portfolio is resubmitted through `POST /cycles/:cycleId/portfolio` (same submission, items replaced, new pass, `NEEDS_SUBMISSION_UPDATED` with `resubmitted: true`) |
| A-3 | Exclusions at any APPROVE step; the memo is required on the last step (validated if sent earlier) and stored on the submission; a memo not of this cycle 422 NEEDS_APPROVAL_MEMO_REQUIRED, another kind 422 NEEDS_DOCUMENT_KIND_MISMATCH. The memo upload stands in for `needs:manage_cycle` with the step gate; it covers the portfolio's items, so it shows on their projects |
| A-4 | Approval writes one `NeedsStageDecision` (stage APPROVAL, evidence = memo) and a `NEEDS_STAGE_DECIDED` per item; an item that left Approval / IN_PROGRESS makes the whole approval 409. A chain without steps approves at once |
| A-5 | Lock order: cycle advisory lock, submission row, proposals (conversion re-takes the cycle lock: reentrant) |
| A-6 | Out-of-cycle: a national programme files in the national cycle but the request keeps its State (the project's State); statuses read Draft, Pending approval, Returned for correction, Approved (converted), Withdrawn; a request's needs assessment never moves it (no change rule), never overwrites title or amount, must be template v2 and must map to a project (`needsToScopeImport`) so approval cannot fail at conversion; a return sets the proposal RETURNED (`NEEDS_PROPOSAL_RETURNED`) |
| A-7 | `narrowActions` offers nothing for an out-of-cycle request, nor for DRAFT / RETURNED at Approval (the wave 3 batch SUBMIT and generic upload cannot move them); INCLUDE_IN_PORTFOLIO only after finalisation with no live portfolio; INCLUDE_IN_BEAP only while no BEAP is in review or approved |
| A-8 | Queue: task ids `CYCLE:<id>:PORTFOLIO\|FUNDING\|BEAP\|LOTS`, `APPROVAL_STEP:<submission>`, `PROPOSAL_ACTION:<proposal>` (the requester's draft or returned request); step tasks on any visible cycle in any status, pre-filtered by the step permission, then `gateForSubmission`; due = the chain step deadline, else the stage's; "Review …" for `:review_` keys, else "Approve …"; links `tab=approvals` (steps, out-of-cycle), `tab=funding` (funding, BEAP), `tab=procurement` (lots). No emails for approval steps (D-N.24: the queue) |
| A-9 | Needs-origin files: `GET /projects/:id/needs-origin/files/:scope/:id` answers `NeedsFileLinkDto` with `?format=json`, else a 302; the documents group shows the proposal's current documents, every version and the cycle's current documents covering it; out-of-cycle files in a CLOSED container stay readable through the wave 2 proposal routes |
| A-10 | Request bodies for the out-of-cycle needs assessment preview / confirm and withdraw are server-local Zod schemas (route file); new error codes in plan 17.10 |

### 5.4 Track B (server: funding, BEAP, procurement plan, activation)

| # | Decision |
| :--- | :--- |
| B-1 | The budget submission is a record (several may be recorded); it does not gate the import |
| B-2 | The appropriated schedule is the approved-list workbook (same sheets and stamp `INSITE-APPROVED-LIST-v1`) with `APPROPRIATED_SCHEDULE_COLUMNS`; the template is pre-filled (row ref and proposal reference = the reference, amount = the approved amount); a plain approved-list file is refused (`WORKBOOK_COLUMN_MISSING`). `buildApprovedListWorkbook` gained optional `columns`, `title`, `intro`, `steps` (approved-list output unchanged); `approvedListImport.service.ts` exports `lockApprovedLists` |
| B-3 | The list: `approvedBy` = the file's "Approved by", else the confirmer; `approvedOn` = the appropriation date; title from the file, else "<year> Appropriated schedule"; `documentId` = the stored APPROPRIATED_SCHEDULE cycle document (covers the converted proposals) |
| B-4 | Row issue codes: `PROPOSAL_REFERENCE_REQUIRED`, `PROPOSAL_LISTED_TWICE`, `PROPOSAL_NOT_FOUND`, `PROPOSAL_OTHER_CYCLE`, `PROPOSAL_NOT_AT_FUNDING`, `ABOVE_APPROVED_AMOUNT`, `NO_APPROVED_AMOUNT`, `OUT_OF_CYCLE_NOT_APPROVED`, `PROPOSAL_OTHER_PROGRAMME`, `PROJECT_ARCHIVED`; file codes `NEEDS_APPROPRIATION_YEAR`, `NEEDS_APPROPRIATION_KIND`; the confirm blockers also show in the preview (`canConfirm` false). Approved amount = `approvedAmountNgn`, else `costedAmountNgn`; equal within 0.5 kobo |
| B-5 | An out-of-cycle row must be a CONVERTED, non-archived request of the same programme: its project is linked (moved from any earlier row, audited); nothing converts |
| B-6 | The file is stored before the transaction (a refused confirm leaves an unreferenced object, as wave 3 item 9). Lock order: approved-list lock, then the cycle lock |
| B-7 | SAME_PERSON_FUNDING compares with the approvers of the last pass of each APPROVED portfolio of the cycle; no override (the wave 3 override covers VALIDATE and COST only) |
| B-8 | The funding record's amount = the total converted (out-of-cycle rows left out); summary = preview totals + `convertedCount`, `approvedListRowCount`, `appropriatedOn`. Stage decision items: ADVANCE → CONVERTED ("Partly funded …" when below), NOT_SELECTED "Not funded at appropriation" |
| B-9 | Lots: on open or closed cycles (owning organisation); items naming the same new lot title in one request share it; all or nothing |
| B-10 | BEAP edits keep each remaining item's UBEC review until the reviewer overwrites it; an existing item keeps its amount (a revision may have changed it), a new item takes the approved (else costed) amount; evidence given in the PUT also sets `counterpartRecorded*` |
| B-11 | Review route `POST /cycles/:cycleId/beap/review-items`; no exclusions at approval (422 NEEDS_BEAP_EXCLUSIONS_NOT_ALLOWED): the reviewer requests removal and returns; a chain without steps approves at submit |
| B-12 | On approval: list title "Approved BEAP <year>: <State> State"; `approvedBy` = the final approver; `approvedOn` = the tenant's today; `documentId` = the narrative; row ref = the reference; lots grouped by title (case and spacing ignored): the first item opens the lot, the next take its batches; excluded items NOT_SELECTED "Excluded from the BEAP: <reason>" |
| B-13 | The counterpart may be recorded on a closed cycle; its evidence upload follows the open-cycle document rule |
| B-14 | BEAP revision: while the BEAP is DRAFT or RETURNED (or not started), by a `needs:prepare_beap` holder; the version keeps stage and status (no reopening); `costedAmountNgn` and the item amount follow the new costed total; `approvedAmountNgn` unchanged. **Resolved after the wave (owner, 2026-11-27):** a revision whose costed total is above the proposal's approved amount is refused per file ("above the amount approved", Costing summary sheet; `routes.needs.n7.test.ts` B4 revision test) |
| B-15 | Found and fixed: the counterpart gate applies to ANNUAL proposals only (an out-of-cycle Matching Grants project has no BEAP to carry the evidence and could never be activated) |
| B-16 | MG-10 completes the converted draft's setup through the API as admin@ (one work phase and units on it, parties (monitor), basics, a 150 m radial site boundary, a new contractor, award / signed / kick-off dates and contract sum, team, visit officers and working days); no documents needed |

### 5.5 Tracks C and D (web)

| # | Decision |
| :--- | :--- |
| C-1 | The out-of-cycle request is a page `/app/needs-assessment/out-of-cycle/:proposalId` (stable link for tasks), under the existing nav segment |
| C-2 | The portfolio builder lists route ANNUAL proposals at Approval / IN_PROGRESS; below-line rows fixed as excluded ("Below the funding line"); after a return it starts from the returned choices |
| C-3 | In pipeline workspaces the header and register "New project" is a menu ("New proposed project" → upload on the user's organisation's open cycle, `?upload=1`; "Out-of-cycle project"); the plain link stays for workspaces without pipeline programmes; nothing shows while the options load |
| C-4 | The memo is uploaded at once and selected (an existing memo can be reused); converted drafts link to `/app/projects/:id/setup` |
| C-5 | The Facilities tab (Sprints & scope, `?tab=facilities`) shows only when the origin has breakdown rows; live % complete on live projects, "From activation" on drafts |
| C-6 | "Import projects" shows only with `projects:create` and `tenant:manage_settings` (M3) |
| D-1 | BEAP items = the BEAP's items plus any open proposal at Funding not on it yet; the editor keeps the order fixed while open; uploads attach on save or submit; "Submit" saves first, then submits, listing what is missing |
| D-2 | Lots: only drafts without a lot are selectable; the selected rows go into one lot, batches in table order |
| D-3 | The appropriation import is hidden once an APPROPRIATION record exists; Confirm needs `canConfirm`, no `cannotConfirmReason` and the appropriation date |
| D-4 | "Record counterpart evidence" is offered to the SUBEB while the BEAP is IN_REVIEW or APPROVED (the editor holds those fields in DRAFT / RETURNED); the A5 warning shows while evidence is missing |

### 5.6 Gate before the deletion (M1) and the old paths (M2–M5)

| # | Finding | What was done |
| :--- | :--- | :--- |
| 18 | M1 gate run 1 (section 4): 2 unit and 3 route failures, all test expectations that wave 4 changes on purpose: the pipeline audit count (21 → 24), the draft visibility clause (converted drafts, decision 17), two `routes.demo.sites` drafts refused by the origin gate before their setup checks, and `routes.needs.n1`'s "no default origin" reading a seeded project the seed now marks LEGACY | Tests updated (the sites drafts get LEGACY; n1 clears the origin first); the five files rerun green (unit 54/54, routes 23/23) before the deletion |
| 19 | M2 | Removed `server/src/modules/needsAssessment/` (routes and service), its mount, `routes.demo.needsAssessment.test.ts`, the D1 preview / confirm contracts in `needsAssessment.schema.ts`, and the web D1 flow (`components/needsAssessment/*`, `api/needsAssessment.ts`, `mutations/needsAssessment.ts`, the D1 start of `NewProjectPage`, now the manual form only). Kept: `createProjectDraftInTx`, the scope-import internals, and the setup DTO's `needsAssessmentImport` for drafts D1 made (reader moved to `projects/needsAssessmentImportState.ts`) |
| 20 | M5 | The demo pack no longer writes `Dawakin Tofa needs assessment.xlsx` (removed from the folder; still in git history); `demoWorkbookData` stays for `routes.demo.test.ts`; the approved list upload file stays; the pack README says so. Wave 5 adds the template v2 files and rewrites the demo script |

### 5.7 Review (`/code-review high` on the wave diff, 2026-11-27; focus: conversion, the activation gate, chain organisation scope, the funding import)

Six findings (four important, two nits), all fixed before the end-of-wave gate.

| # | Finding (severity) | Fix | Verified by |
| :--- | :--- | :--- | :--- |
| R1 | An out-of-cycle container cycle made the year's annual cycle impossible to open (409 NEEDS_CYCLE_EXISTS) (important) | `openCycle` adopts a CLOSED container never opened (status OPEN, config, deadlines, standard, opener; keeps its requests and chain steps; ledger `adoptedContainer: true`); resolves decision 8's known limit | `routes.needs.scenarios.test.ts` "R1 an out-of-cycle request for a year without a cycle makes a CLOSED container; opening that year adopts it …" |
| R2 | After the cycle closed, counterpart evidence could no longer be filed, so BEAP-funded drafts could never be activated (important) | COUNTERPART_EVIDENCE may be presigned and registered on a closed cycle by the owning organisation (`presignNeedsDocument` / `registerCycleDocument` option `allowClosed`); every other kind still needs an OPEN cycle | "R2 after the Kano cycle closes, the SUBEB can still file counterpart evidence (A5), but no other BEAP document" |
| R3 | Another State's SUBEB holding the permission could take UBEC's BEAP or out-of-cycle step ("outside the subtree" was the rule) (important) | UBEC's step on a State cycle needs an organisation strictly above the SUBEB (an ancestor); `beapReviewerCycleBranch` returns null again (those organisations see the cycle through the tree) | "R3 another State's SUBEB never takes UBEC's step …"; `routes.needs.n6` / `n7` NOT_STEP_ORGANIZATION tests (gate) |
| R4 | A manual approved-list upload could replace the list a funding gate wrote and unlink its projects (important) | The upload refuses (issue `APPROVED_LIST_FROM_FUNDING_GATE`, `canConfirm` false) when the existing list's `APPROVED_LIST_IMPORTED` entry has `source: 'NEEDS_FUNDING'` | "R4 the approved list the appropriation wrote cannot be replaced by an upload" |
| R5 | An appropriation row could link an out-of-cycle request of another year and move its project off that year's list (nit) | Row issue `OUT_OF_CYCLE_OTHER_YEAR` | Code review (the n7 out-of-cycle row test covers the same-year case) |
| R6 | Three request schemas lived in the route file (CLAUDE.md: contracts in shared) (nit) | `OutOfCycleFileRequestSchema`, `OutOfCycleFileConfirmRequestSchema`, `WithdrawOutOfCycleRequestSchema` in shared; the route and the web API use them | typecheck |

## 6. Exit criteria

**State on 2026-11-27: met.** A1–A3, B1–B5, M1–M5 VERIFIED by named tests in the recorded gate (section 4); C1–C5 BUILT with owed checks WT-N4-01 … -21 and -40 … -53 (`web_testing_checklist.md` 6j; C6 done). Scenario steps DI-01 … DI-13, MG-01 … MG-10, OOC-01 pass; FIELD-01 stays `todo` (wave 5). The review's six findings are fixed (section 5.7). **Resolved after the wave (owner, 2026-11-27):** a BEAP revision above the approved amount is refused (B-14); the SUBEB Administrator completes and activates its converted drafts (decision 17). **Still owed:** the wave 2–4 migrations on `insite_assurance`.

Every row VERIFIED or BUILT with owed checks; DI and MG suites green (FIELD-01 still todo); both gates recorded.
