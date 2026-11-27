# Needs Pipeline · Wave 3: Validation, design, costing, prioritisation, conversion core (N4 + N5 + N7a)

Parent plan: `saas_updates/needs_pipeline_implementation_plan.md`. **Contract names: parent plan section 17.**

**Starts when:** wave 2 exit criteria are met. **Outcome (demoable):** a proposal goes from Identification to a finalised ranking with every decision recorded and the three cycle reports generated; the conversion function exists and is tested (not yet called by a gate).

## 0. Start of wave (main thread)

1. Read wave 2 "Found during implementation". Settle the request schemas marked `// wave 3 settles` in `needsPipeline.schema.ts` (stage decisions, validation record, costing acknowledgement, committee, score sheets, ranking) and `npm run build:shared` before briefing.
2. Route files per track (no two agents in one file): `needsDecisions.routes.ts` (A), `needsCommittee.routes.ts` (B); main mounts them.

## 1. Tracks

### Track A (agent): server, stage work (N4)

Owns: `server/src/modules/needs/decisions/*`, `server/src/modules/needs/reports/*`, `server/src/jobs/needsDeadlines.ts`, `server/src/tests/routes.needs.n4.test.ts`.

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| A1 | Submit, return (reason), resubmit, withdraw; stage decisions (batch, per-item outcome, one evidence set) with `allowedProposalActions` and `separationViolation` enforced; **override = a second person's authorisation** (parent plan 16.2 O-1): the blocked person asks (`SeparationOverrideRequestSchema` → open `SEPARATION_OVERRIDE` flag, audit), another holder of `needs:override_separation` decides (`SeparationOverrideDecisionRequestSchema` → flag `AUTHORISED` / `REFUSED`; the asker cannot decide), then the action passes `checkSeparation` with that authorisation and writes `NEEDS_SEPARATION_OVERRIDDEN`; the authorisers see the request in the task queue | `routes.needs.n4.test.ts` suite "A1: submit, return…" (6 tests: a batch with one item short of the minimum fields is refused whole; only the stage actor of the owning organisation acts; withdraw needs a reason; submit moves the drafts and emails each validator once; a stage without decisions refused; return keeps the stage and emails the uploader) and suite "A1: separation-of-duties overrides (Kano)" (5 tests); scenarios DI-04, DI-05, MG-04 | VERIFIED |
| A2 | Validation records (desk notes, site verification evidence uploaded on the web, duplicate resolutions, essential-gap justification); gate rules of plan 6.2 | `routes.needs.n4.test.ts` suite "A2: validation records and flag resolutions" (4 tests); scenarios DI-06 | VERIFIED |
| A3 | Design submission (DI): new version with the design minimum fields | `routes.needs.n4.test.ts` "A3: design" › "leaving Design needs the full needs assessment…"; scenarios DI-07 | VERIFIED |
| A4 | Costing: costed version (source `COSTING`), flags acknowledged with reasons, costed amount stored | `routes.needs.n4.test.ts` suite "A4: costing" (3 tests); scenarios DI-08, MG-04 | VERIFIED |
| A5 | Change rule: a later version that changes scope or cost returns the proposal to the stage `reopenStageFor` names | `routes.needs.n4.test.ts` suites "A5: the change rule (pure)" (3) and "A5: the change rule on uploads" (2) | VERIFIED |
| A6 | Generated cycle reports: Validated Project List, Cost Estimate Report (xlsx via `exportSheet.ts`, PDF via pdfkit, UBEC styling), stored as generated cycle documents linked to the proposals they cover | `routes.needs.n4.test.ts` suite "A6: generated cycle reports" (2) and the last A2 test (reads the xlsx and PDF back); scenarios DI-06, DI-08 | VERIFIED |
| A7 | Task queue `GET /api/v1/needs/tasks` (+ count) computed from stage, status, permissions, committee membership and separation; emails (returned to you, waiting for you, deadline in 7 days, overdue) | `routes.needs.n4.test.ts` "A7: the task queue on drafts", "A7: the queue at Costing", "A7: committee tasks", the email checks of the A1 submit and return tests; scenarios MG-04 (the authoriser's queue) | VERIFIED |
| A8 | Job `needs-deadlines` (one `JobRun` per cycle-day), registered in `registerAllJobs()` | `routes.needs.n4.test.ts` "A8: the needs-deadlines job" › "emails DUE_SOON seven days before a stage deadline and OVERDUE the day after…; one JobRun per cycle-day" | VERIFIED |

### Track B (agent): server, prioritisation (N5)

Owns: `server/src/modules/needs/committee/*`, `server/src/tests/routes.needs.n5.test.ts`.

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| B1 | Committee: chair appoints members (`needs:score` eligibility), conflict declarations before scoring opens, recusals (`recusalsFor`) | `routes.needs.n5.test.ts` suite B1 (6 tests: chair and member rules 422 NEEDS_COMMITTEE_MEMBER_INVALID; opening needs declarations and a quorum; non-member declaration 403; recusals follow the duty history and the declaration; open once; Lagos 404 / UBEC HQ 403 on the Kano cycle) | VERIFIED |
| B2 | Score sheets: one per member and proposal, rubric from the cycle snapshot, editable until finalisation | `routes.needs.n5.test.ts` suite B2 (8 tests: rubric keys 422 NEEDS_SCORE_INCOMPLETE; recused 409 NEEDS_MEMBER_RECUSED; one sheet per member, live score stored, NEEDS_SCORE_SUBMITTED; member with sheets not removable; new conflict deletes the sheet; independent sheets; closing freezes; divergence ≥ 2 flagged with its label) | VERIFIED |
| B3 | Ranking view: scores, divergence (`divergentCriteria`), rank, cumulative cost, funding line against the ceiling; chair overrides (move, reason) and sets the line | `routes.needs.n5.test.ts` suite B3 (5 tests: unscored placement refused; ties by Impact then cost, cumulative cost, ceiling line; non-chair member 403 NEEDS_SCORES_HIDDEN and hidden scores, incl. the proposal list and detail (main thread); line moved with reason; placements with reasons) | VERIFIED |
| B4 | Finalise (quorum rule): ranks stored, proposals move to Approval with their line position; Prioritised Project Portfolio generated (plan: list, business case, location, impact, beneficiaries, cost, timeline, strategy); minutes upload | `routes.needs.n5.test.ts` suite B4 (8 tests: quorum refusal lists proposals; report before finalisation 409; minutes only as COMMITTEE_MINUTES; finalise stores ranks and moves to Approval with a decision row and ledger entry; Prioritised Project Portfolio xlsx + PDF registered; read-only after; late arrivals 409; regeneration supersedes); scenarios DI-09, MG-05 (`helpers/needsScenarioSteps.n5.ts`) | VERIFIED |

### Track C (agent): web, stage work

Owns: `web/src/components/needs/decisions/*`, proposal page tabs Validation and BoQ & costing, the batch action bar, "Waiting for me" filter, nav badge, Cycle documents tab.

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| C1 | Batch action bar (actions common to every selected proposal only), decision drawer (per-item outcome and reason, evidence upload) | web typecheck, lint (0 errors, 0 warnings), build | BUILT (owed WT-N3-02 … -09) |
| C2 | Validation tab (records, evidence, flag resolution), return and resubmit | web typecheck, lint, build | BUILT (owed WT-N3-10 … -14) |
| C3 | BoQ & costing tab (lines, rate vs standard, variance and ceiling flags with acknowledgement) | web typecheck, lint, build | BUILT (owed WT-N3-15 … -17) |
| C4 | Task list on the proposal page driven by the server's allowed actions; "Waiting for me" default filter; nav badge | web typecheck, lint, build | BUILT (owed WT-N3-01, -18 … -20) |
| C5 | Cycle documents tab (generated + signed copies) | web typecheck, lint, build | BUILT (owed WT-N3-21 … -23) |
| C6 | `WT-N3-*` owed checks | `web_testing_checklist.md` section 6i, WT-N3-01 … -23 | DONE |

### Track D (agent): web, committee

Owns: `web/src/components/needs/committee/*`, the Prioritisation tab, the proposal page Scores tab.

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| D1 | Chair: members, declarations status, scoring progress, open/close scoring | web typecheck, lint (0 errors, 0 warnings), build | BUILT (owed WT-N3C-01 … -04) |
| D2 | Member: proposals to score, rubric with descriptors, save and submit | web typecheck, lint, build | BUILT (owed WT-N3C-05 … -09) |
| D3 | Ranking table: divergence marks, cumulative cost, the funding line, override with reason, finalise | web typecheck, lint, build | BUILT (owed WT-N3C-10 … -18) |
| D4 | `WT-N3C-*` owed checks | `web_testing_checklist.md` section 6i, WT-N3C-01 … -19 | DONE |

### Main thread: SUBEB committee roster (parent plan 16.2 O-2)

Seed, so it stays in the main thread; do it before briefing Track B, whose MG-05 test needs it.

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| R1 | `seedUbecRoster.ts`: umbrella role `SUBEB_COMMITTEE_MEMBER` ("SUBEB Steering Committee Member": stands for the SUBEB directorates on the committee, e.g. M&E, Finance, Administration), web, `needs:view` + `needs:score`; three Kano SUBEB logins (`kano.committee1@` … `kano.committee3@ubec.test`); `needs:score` added to the SUBEB Administrator grants (the Chairman scores too). Update `NEEDS_PIPELINE_GRANTS` / `NEEDS_PIPELINE_PEOPLE` and the tests that assert them (`routes.needs.n1.test.ts` "nobody else gained a pipeline permission", "each pipeline role holds exactly its plan section 8 grants") | `routes.needs.n1.test.ts` "the ten cycle logins (incl. the three SUBEB committee members, wave 3) exist in their organisations, are web roles and sign in", "each pipeline role holds exactly its plan section 8 grants", "the existing roles got theirs: …" (Chairman scores; `SUBEB_COMMITTEE_MEMBER` = view + score), "nobody else gained a pipeline permission": 16/16 (with `needs.n1.test.ts` 63/63) | VERIFIED |

### Main thread: conversion core (N7a)

Owns: `server/src/modules/needs/conversion/*`, `server/src/tests/needs.conversion.n7a.test.ts`.

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| M1 | Pure mapper `needsToScopeImport(parsed)`: sites → `ProjectSite`, breakdown rows → `FacilityUnit` (unit ID, site, planned quantity), BoQ lines → `BoqItem` by unit ID (no sprints) | `needs.conversion.n7a.test.ts` suite "N7a: needsToScopeImport (pure)" (3 tests: units per proposed row, lines on their unit and amounts; a draft without lines; issues for a file it cannot map) | VERIFIED |
| M2 | `convertProposalToProject(tx, proposal, { fundedAmountNgn, lot? })`: `createProjectDraftInTx` (type applied, parties derived, year from the cycle, code = proposal reference unless a lot is given), scope import internals, `origin = NEEDS_PIPELINE`, `needsProposalId`, proposal `CONVERTED` + `projectId`, ledger entry `PROJECT_CREATED_FROM_PROPOSAL` with the proposal's history reference | `needs.conversion.n7a.test.ts` "a Direct Intervention proposal becomes a draft: …", "a Matching Grants proposal with a lot gets the lot/batch code and the State SUBEB as owner", "the year comes from the cycle, outside the new-draft window; …" | VERIFIED |
| M3 | Tests on proposals built directly in the database from the fixtures: counts and amounts match; idempotent refusal on a converted proposal | `needs.conversion.n7a.test.ts` 8/8 (incl. "converting the same proposal again is refused (409 NEEDS_PROPOSAL_ALREADY_CONVERTED) and creates nothing", "a proposal whose file cannot be mapped is refused (422 NEEDS_CONVERSION_INVALID) and nothing is written") | VERIFIED |

## 2. Scenario steps turned green

DI-04 … DI-09, MG-04, MG-05.

## 3. End of wave

Full gate (background); `/code-review high` focused on separation rules, the task queue's permission logic, score maths and conversion; record below and in parent plan section 15.

## 4. Verification

| Gate | Typecheck | Lint | Web build | Server unit | Server routes | Mobile | Seed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Baseline (wave 2 record, run 2; tree clean at `0aebe61`) | ✓ | 0 errors (52 warnings) | ✓ | 329/329 | 514/514 pass, 19 todo | 169/169 | normal ✓, overlay ✓ |
| End of wave 3, run 1 (2026-11-27, before the review fixes) | ✓ | 0 errors (52 warnings) | ✓ | 329/329 | 589/589 pass, 11 todo of 600 (533 + 30 `routes.needs.n4` + 29 `routes.needs.n5` + 8 `needs.conversion.n7a`; scenario steps DI-04–09 and MG-04–05 green) | 169/169 | normal ✓, overlay ✓ (scratch `insite_needs_w1`, migration `20261230090000_needs_w3_committee` applied); schema diff empty |
| **End of wave 3, run 2 (2026-11-27, final code incl. review fixes)** | ✓ | 0 errors (52 warnings) | ✓ | **329/329** | **593/593 pass, 11 todo** of 604 (run 1 + 4 review-fix tests) | 169/169 | normal ✓, overlay ✓ (scratch `insite_needs_w1`); schema diff empty |

- Nothing was edited while a gate ran. The demo database `insite_assurance` was not touched: the wave 2 and wave 3 migrations are owed there (`npx prisma migrate deploy` from `server/`, then a reseed), on the owner's word.

## 5. Found during implementation

Wave 3 ran on 2026-11-27 on the owner's instruction (no Minister demo answers yet: the plan section 3 assumptions stand). No clarification round: every open point had a default that follows the plan or the platform's rules (below). Main thread: shared contracts (plan 17.9), Prisma and migration, seed (R1), server seams, route mounts, test lists, the conversion core (M1–M3), integration; four agents: Track A (server stage work), Track B (server committee), Track C (web stage work), Track D (web committee). Each server agent ran its route tests on its own test database (`insite_w3a_test`, `insite_w3b_test`; main `insite_w3main_test`, gate `insite_w3gate_test`).

### 5.1 Before starting

| # | Finding | What was done |
| :--- | :--- | :--- |
| 1 | The owner's instruction named `wave3_upload_standards.md` | The wave 3 file is this one (`wave3_validation_costing_scoring.md`) |
| 2 | Database | Migration and seeds on the scratch database `insite_needs_w1` only (`DATABASE_URL` set per command). `insite_assurance` (tomorrow's demo database) was not touched: waves 2 and 3 migrations are owed there |
| 3 | Baseline | From the wave 2 record (run 2: unit 329, routes 514 + 19 todo, mobile 169); the tree was clean at `0aebe61` |

### 5.2 Decisions and deviations (main thread)

| # | Topic | Decision |
| :--- | :--- | :--- |
| 4 | Contracts | Settled before briefing (parent plan 17.9): batch actions, outcomes per stage (`STAGE_DECISION_OUTCOMES`), resolutions per flag kind and who resolves them, the validation record, override details, task queue, committee, scoring, ranking (`resolveRankingLine`: the ceiling draws a line, the chair may move it and place single proposals across it, each with a reason) |
| 5 | Migration `20261230090000_needs_w3_committee` | One migration: `NeedsCycle.scoringOpened*` / `scoringClosed*` (the chair opens and closes scoring, D1) and `fundingLineReason`; audit values `NEEDS_SEPARATION_OVERRIDE_REQUESTED`, `NEEDS_RANKING_OVERRIDDEN` (nothing in the migration uses them). Additive; schema diff against the scratch database empty after deploy |
| 6 | Duty history (`needsFacts.ts`, shared by separation and recusals) | Uploaders = versions of source UPLOAD, CORRECTION, BEAP_REVISION (a CARRY_FORWARD version is written by whoever opened the next cycle; a COSTING version by the coster); validators = validation recorders and ADVANCE deciders at Validation; costers = COSTING uploaders and ADVANCE deciders at Costing |
| 7 | Validation record vs decision | The record (per proposal, current version) carries the validator's finding, desk review, site verification and flag resolutions; the batch stage decision moves proposals, and an ADVANCE needs an ADVANCE record on the current version |
| 8 | DI-05 | `procurement@` holds no `needs:validate` (plan section 8), so the route answers 403; the step first asserts that, then grants the permission to the role in the test database (a small office where one person holds both duties), asserts 409 `SAME_PERSON_VALIDATION` and removes the grant (`clearAuthCache()`: the auth context is cached 30 s) |
| 9 | Generated reports (`needsGeneratedDocuments.ts`) | Two steps: files stored after the decision commits, then registered in a short transaction under the cycle lock (xlsx and PDF per report; each supersedes the current generated file of the same kind and type). A failure to generate leaves the decision standing (logged; the report can be regenerated). As in wave 2 (item 18), a failed registration leaves unreferenced objects in storage |
| 10 | Conversion core (M2) | `createProjectDraftInTx` gained `{ interventionYearFromCycle }` (plan section 11: the year comes from the cycle); `PROJECT_CODE_PREFIX_REGEX` accepts a proposal reference (D-N.15; was wave 4 in wave 1 item 22). Owner: a State cycle's projects are owned by the cycle's owner (its SUBEB): the D2 derivation finds a SUBEB by `stateCode`, which the normal seed's SUBEBs lack (wave 2 item 16); a national one keeps the derived owner, else the cycle's. Sites and scope sections are marked saved (scope stays incomplete until work phases are set). The project ledger gets `PROJECT_TYPE_APPLIED` before `PROJECT_DRAFT_CREATED` and `PROJECT_CREATED_FROM_PROPOSAL` (with the proposal id, reference, version, sha256 and the last tenant-ledger seq of the proposal's history); the tenant ledger gets `NEEDS_PROPOSAL_CONVERTED`. A v1-only proposal cannot be converted (422 `NEEDS_CONVERSION_INVALID`). New codes: `NEEDS_PROPOSAL_ALREADY_CONVERTED` (409), `NEEDS_PROPOSAL_CLOSED` (409), `NEEDS_CONVERSION_INVALID` (422), `NEEDS_FUNDED_AMOUNT_REQUIRED` (422) |
| 11 | Independent scoring in the proposal reads (integration fix) | Track B hid combined scores from non-chair members on its routes; the wave 2 list and detail still returned the live `scoreTotal`. Fixed in `needsProposals.service.ts` (score, rank and line null for such a member before finalisation; `aboveLine` null for everyone before finalisation, since the column holds the chair's placement until then). Test: `routes.needs.n5.test.ts` B3 "independent scoring: …" (extended) |
| 12 | Scenario steps DI-09 and MG-05 | Written by Track B as `stepDI09` / `stepMG05` (`server/src/tests/helpers/needsScenarioSteps.n5.ts`), proven in its n5 test on the same starting state, then wired into `routes.needs.scenarios.test.ts` by the main thread |

### 5.3 Track A (server stage work)

| # | Decision |
| :--- | :--- |
| A-1 | Batches all or nothing: every item is checked first; the error carries the first problem's status and code with every problem in `details.items` (`NeedsBatchProblem[]`) |
| A-2 | Separation: VALIDATE on ADVANCE and NOT_VALIDATED at Validation and on every validation record; COST on the costing sign-off and on costed uploads; RETURN never separated. Resolving a flag applies the rule of the stage it blocks. At sign-off separation is checked before the costed-version rule |
| A-3 | Template v2 is required when leaving Design or any later stage (Matching Grants: from Costing on) |
| A-4 | Resolutions: NOT_VALIDATED only inside a NOT_VALIDATED record; MERGED refused on an ADVANCE record, one merge per request, target another open proposal of the cycle |
| A-5 | A flag a person resolved (justified, acknowledged, not a duplicate) is not raised again by a later version with identical findings (sorted JSON); different findings raise a new flag. Without it a justified gap came back on every design or costed version (`needsFlags.service.ts`) |
| A-6 | Change rule (`decisions/versionChange.ts`): applies when the version carries no status update (carry-forward untouched); reopening sets IN_PROGRESS, clears `costedAmountNgn`, writes `statusReason` "Version N: Scope changed: back to Validation." and says so in the ledger (`reopenedStage`, `change`) |
| A-7 | Upload sources: COSTING at Costing IN_PROGRESS or RETURNED at Prioritisation (UPLOAD_COSTED_VERSION); otherwise CORRECTION when RETURNED, else UPLOAD. A new proposal (no target) needs the first stage's actor permission, since the route now admits `needs:cost` |
| A-8 | Queue: a platform super admin counts as holding every pipeline permission; SCORE for a member with `needs:score`, not recused, before finalisation; FINALISE_PRIORITISATION for the CHAIR (or any chair-permission holder while no committee exists); an asker with a pending override gets no task (the page shows "Separation-of-duties override requested" BLOCKED). Task ids `PROPOSAL_ACTION:<proposalId \| flagId>`, `SCORE:<proposalId>`, `CONFLICT_DECLARATION:<cycleId>`, `CYCLE:<cycleId>`; sorted by deadline state, due date, reference |
| A-9 | Ledger: `NEEDS_STAGE_DECIDED` per item (with `proposalId`, `decisionId`, so the proposal history shows it); RETURN also `NEEDS_PROPOSAL_RETURNED`; SUBMIT / RESUBMIT `NEEDS_PROPOSAL_SUBMITTED` (`resubmitted: true`); WITHDRAW `NEEDS_PROPOSAL_WITHDRAWN` |
| A-10 | Reports: generated only when the decision advanced something; the Cost Estimate Report's preliminary cost is the latest non-costed version's; "at standard rates" and the variance cover lines whose item the standard lists |
| A-11 | Emails (`NEEDS_TASK_NOTICE`): WAITING leaves out the person who moved the proposals; DUE_SOON is sent even when nothing is open at that stage; OVERDUE only when open proposals are at that stage or earlier; a stage without an actor (Approval) sends nothing. **Gap:** `MESSAGING_RECIPIENT_DAILY_CAP` (5 a day) also limits pipeline emails, so a busy validator may miss WAITING emails; the task queue is the reliable channel |
| A-12 | Found: a RETURN at Prioritisation did not look at the scoring state and the returned proposal's score sheets stayed. **Resolved by review fixes R3 and R6** (chair only, before finalisation; sheets, score and placement cleared) |
| A-13 | New error codes: `NEEDS_TEMPLATE_V2_REQUIRED`, `NEEDS_OUTCOME_NOT_ALLOWED`, `NEEDS_EVIDENCE_INVALID`, `NEEDS_SITE_VERIFICATION_REQUIRED`, `NEEDS_FLAG_RESOLUTION_INVALID`, `NEEDS_MERGE_TARGET_INVALID`, `NEEDS_SUPERVISION_LINE_MISSING`, `NEEDS_OVERRIDE_ACTION_NOT_SUPPORTED` (422); `NEEDS_VALIDATION_RECORD_REQUIRED`, `NEEDS_COSTED_VERSION_REQUIRED`, `NEEDS_FLAG_ALREADY_RESOLVED`, `NEEDS_OVERRIDE_NOT_NEEDED`, `NEEDS_OVERRIDE_PENDING`, `NEEDS_OVERRIDE_SELF`, `NEEDS_OVERRIDE_DECIDED` (409); `NEEDS_FLAG_NOT_FOUND`, `NEEDS_REPORT_NOT_FOUND` (404). First thrown: `NEEDS_STAGE_ACTION_NOT_ALLOWED`, `NEEDS_FLAGS_UNRESOLVED`, `NEEDS_MINIMUM_FIELDS_MISSING` (now an HTTP 422 too), `SAME_PERSON_VALIDATION`, `SAME_PERSON_COSTING` |

### 5.4 Track B (server committee)

| # | Decision |
| :--- | :--- |
| B-1 | Once a committee exists only its chair changes it (403 `NEEDS_NOT_COMMITTEE_CHAIR`); the CHAIR row must be the caller (422 `NEEDS_COMMITTEE_MEMBER_INVALID`); a non-member cannot declare (403 `NEEDS_NOT_COMMITTEE_MEMBER`) |
| B-2 | Scoring: OPEN twice 409 `NEEDS_SCORING_ALREADY_OPEN`; CLOSE when not open 409 `NEEDS_SCORING_NOT_OPEN`; opening below quorum 409 `NEEDS_QUORUM_NOT_MET` (`{ quorum, scorers }`); nothing at Prioritisation 409 `NEEDS_NOTHING_TO_SCORE`. Sheets change only while OPEN; saving is submitting (upsert, the web's "save and submit" is one action); declarations change until finalisation |
| B-3 | A sheet counts only when the member holds `needs:score` (current role) and is not recused; the opening quorum counts members holding `needs:score`; the live score is stored on the proposal after each save |
| B-4 | Independent scoring (main thread addition): before finalisation a non-chair member gets 403 `NEEDS_SCORES_HIDDEN` on the ranking and no score, rank, line or divergence on proposal scores (own sheet only); readers outside the committee and the chair see the live ranking (min, max and spread, never who scored what) |
| B-5 | Finalisation: an override reason is kept only where the placement crossed the line; `fundingLinePosition` = the number above after placements; every proposal at Prioritisation moves to Approval IN_PROGRESS (above or below the line) with one `NeedsStageDecision` (item reason "Rank n, above/below the funding line (override: …)"); quorum refusal lists `{ proposalId, reference, sheetCount, eligibleCount }` in `details.items` |
| B-6 | Prioritised Project Portfolio after commit ("<year> <DI\|MG> [<State>] Prioritised Project Portfolio.xlsx/.pdf"; beneficiaries = the file's text plus the sites' enrolment; business case, timeline, strategy from the current version); a generation failure leaves the ranking final (logged; `POST …/ranking/report` reruns it; before finalisation 409 `NEEDS_RANKING_NOT_FINALISED`) |
| B-7 | **Known limit:** a proposal that reaches Prioritisation after finalisation is outside the ranking (409 `NEEDS_RANKING_FINALISED` on scoring); wave 4 decides how a late or returned proposal re-enters |
| B-8 | Minutes reuse `presignNeedsDocument` / `registerCycleDocument` behind the chair check; a wrong kind is 422 `NEEDS_DOCUMENT_KIND_MISMATCH`; unscored placement 409 `NEEDS_PROPOSAL_NOT_SCORED`; scoring outside Prioritisation 409 `NEEDS_STAGE_ACTION_NOT_ALLOWED`; incomplete sheet 422 `NEEDS_SCORE_INCOMPLETE`; removing a member with sheets 409 `NEEDS_COMMITTEE_MEMBER_HAS_SCORES` |

### 5.5 Tracks C and D (web)

| # | Decision |
| :--- | :--- |
| C-1 | Stage decisions offered only when every selected row is IN_PROGRESS in the same decision stage and allows the outcome's action; the selection is frozen while a dialog is open |
| C-2 | "Waiting for me" is on by default when `GET /tasks?cycleId=` returns a task with a `proposalId`; the user's own toggle wins |
| C-3 | The validation form is stricter than the schema for a Validate finding (every open duplicate and gap resolved; site verification when required; no future date) |
| C-4 | "Ask for an override" is also offered up front on the Separation of duties card (a separation 409 on the costed upload only reaches a toast inside the upload dialog) |
| C-5 | Signed copies of generated reports are ordinary cycle documents of the report's kind (`needs:manage_cycle`, wave 2 rule); costing compares against the cycle's costing standard version; `stageLabel` moved to `needsUi.tsx` (re-exported) |
| C-6 | Nav badge as data: `NavItem.badge`, `NAV_BADGES` in `navItems.ts`; `AppShell` fetches the count only for `needs:view` holders (polled every 60 s) |
| D-1 | The Prioritisation tab's three areas (Your scoring, Committee, Ranking) are local tabs, not in the URL (`useUrlTab` would drop `?cycle=`); default area by role and state |
| D-2 | A non-chair member gets no combined score in the web either (the ranking query is not sent); the members table is read-only for every `needs:view` reader and never shows scores |
| D-3 | Ranking and members are plain tables scrolling in their card, not `StandardTable` (pagination would split the ranking at the funding line) |
| D-4 | Members declare against the cycle's open proposals (not only those at Prioritisation), so they can declare early; recusal and role labels live in `committeeUi.tsx` (shared has none) |

### 5.6 Review (`/code-review high` on the wave diff, 2026-11-27; focus: separation rules, the task queue's permission logic, score maths, conversion)

Nine findings (six important, three nits), all fixed in the main thread after gate run 1; gate run 2 ran on the fixed code (section 4).

| # | Finding (severity) | Fix | Verified by |
| :--- | :--- | :--- | :--- |
| R1 | Finalisation stored the number of proposals above the line as `fundingLinePosition`, so after a chair placement the stored ranking drew the line in the wrong place and read "Moved by the chair" (important) | The line in force is stored (`ranking.linePosition`); the count above goes in the ledger payload (`aboveCount`) | `routes.needs.n5.test.ts` B4 "finalise: …" (line 2, three above, payload), scenario DI-09 (line 1, two above) |
| R2 | A costing sign-off after finalisation put a proposal at Prioritisation where nothing could move it (important) | A COSTING ADVANCE into a finalised ranking is refused (409 `NEEDS_RANKING_FINALISED`, checked first); RESUBMIT and the costed correction at Prioritisation are not offered after finalisation; how late proposals re-enter is wave 4's (B-7) | `routes.needs.n5.test.ts` B4 "review fix: a costing sign-off cannot send a proposal into a finalised ranking …" |
| R3 | A proposal re-entering Prioritisation brought back its old sheets, score and chair placement (important) | A return at Prioritisation and a version that reopens a stage delete the proposal's score sheets and clear score, rank, `aboveLine` and `lineOverrideReason` (resolves A-12) | `routes.needs.n5.test.ts` B3 "review fix: only the committee chair returns … the return takes it out of the ranking with its sheets, score and placement" |
| R4 | Overrides could be asked for, and authorised, where they could never be used (another stage), leaving stale "Authorise" tasks (important) | Asked only while the proposal is at the guarded step (`overrideApplies`: VALIDATE at Validation, COST at Costing or returned at Prioritisation; else 409 `NEEDS_OVERRIDE_NOT_NEEDED`); authorising a request whose proposal has moved on is 409 `NEEDS_OVERRIDE_STALE` (it can still be refused) | `routes.needs.n4.test.ts` A1 overrides "review fix: no override is asked once the proposal is past the step …" |
| R5 | A proposal first uploaded as an old v1 file went back to Validation when its required v2 file added the breakdown (important) | `compareVersions` compares only the sites when the previous version had no breakdown | `routes.needs.n4.test.ts` A5 (pure) "review fix: after an old v1 file …" |
| R6 | Any holder of `needs:chair_committee` in the owning organisation could return proposals at Prioritisation during scoring (important) | Only the committee's CHAIR returns at Prioritisation, and not after finalisation (403 `NEEDS_NOT_COMMITTEE_CHAIR`, 409 `NEEDS_RANKING_FINALISED`); `narrowActions` offers RETURN and FINALISE only to the chair (also before a committee exists: resolves the nit "finalise offered without a committee") | `routes.needs.n5.test.ts` B3 "review fix: only the committee chair returns …"; `routes.needs.n4.test.ts` A5 upload test (es@ chairs before returning) |
| R7 | An authorisation stopped counting if the authoriser later lost `needs:override_separation` (nit) | An AUTHORISED flag carries the permission it was decided with (the decision route required it), as `SeparationAuthorisation` says | code review; the pure authorisation test passes |
| R8 | The chair's queue offered "Open scoring" without a quorum of scorers (nit) | The task also needs `rubric.quorum` members holding `needs:score` | `routes.needs.n4.test.ts` A7 "committee tasks" (unchanged outcome with a quorum) |
| R9 | FINALISE_PRIORITISATION offered to a chair-permission holder while no committee existed (nit) | Covered by R6 | as R6 |

New error code: `NEEDS_OVERRIDE_STALE` (409).

## 6. Exit criteria

**State on 2026-11-27: met.** Every A, B, M and R row is VERIFIED by a named test in the recorded gate (section 4, run 2); C1–C5 and D1–D3 are BUILT with owed checks WT-N3-01 … -23 and WT-N3C-01 … -19 in `web_testing_checklist.md` 6i (C6, D4 done). Scenario steps DI-04 … DI-09, MG-04, MG-05 pass (14 of 25 green; 11 stay `todo` for waves 4–5); conversion tests 8/8. The review's nine findings are fixed (section 5.6). **Owed outside this wave:** the wave 2 and 3 migrations on the demo database `insite_assurance` (owner's word; not touched here).

Every row VERIFIED or BUILT with owed checks; eight scenario steps green; conversion tests green; full gate recorded.
