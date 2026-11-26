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
| A1 | Submit, return (reason), resubmit, withdraw; stage decisions (batch, per-item outcome, one evidence set) with `allowedProposalActions` and `separationViolation` enforced; **override = a second person's authorisation** (parent plan 16.2 O-1): the blocked person asks (`SeparationOverrideRequestSchema` → open `SEPARATION_OVERRIDE` flag, audit), another holder of `needs:override_separation` decides (`SeparationOverrideDecisionRequestSchema` → flag `AUTHORISED` / `REFUSED`; the asker cannot decide), then the action passes `checkSeparation` with that authorisation and writes `NEEDS_SEPARATION_OVERRIDDEN`; the authorisers see the request in the task queue | | TODO |
| A2 | Validation records (desk notes, site verification evidence uploaded on the web, duplicate resolutions, essential-gap justification); gate rules of plan 6.2 | | TODO |
| A3 | Design submission (DI): new version with the design minimum fields | | TODO |
| A4 | Costing: costed version (source `COSTING`), flags acknowledged with reasons, costed amount stored | | TODO |
| A5 | Change rule: a later version that changes scope or cost returns the proposal to the stage `reopenStageFor` names | | TODO |
| A6 | Generated cycle reports: Validated Project List, Cost Estimate Report (xlsx via `exportSheet.ts`, PDF via pdfkit, UBEC styling), stored as generated cycle documents linked to the proposals they cover | | TODO |
| A7 | Task queue `GET /api/v1/needs/tasks` (+ count) computed from stage, status, permissions, committee membership and separation; emails (returned to you, waiting for you, deadline in 7 days, overdue) | | TODO |
| A8 | Job `needs-deadlines` (one `JobRun` per cycle-day), registered in `registerAllJobs()` | | TODO |

### Track B (agent): server, prioritisation (N5)

Owns: `server/src/modules/needs/committee/*`, `server/src/tests/routes.needs.n5.test.ts`.

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| B1 | Committee: chair appoints members (`needs:score` eligibility), conflict declarations before scoring opens, recusals (`recusalsFor`) | | TODO |
| B2 | Score sheets: one per member and proposal, rubric from the cycle snapshot, editable until finalisation | | TODO |
| B3 | Ranking view: scores, divergence (`divergentCriteria`), rank, cumulative cost, funding line against the ceiling; chair overrides (move, reason) and sets the line | | TODO |
| B4 | Finalise (quorum rule): ranks stored, proposals move to Approval with their line position; Prioritised Project Portfolio generated (plan: list, business case, location, impact, beneficiaries, cost, timeline, strategy); minutes upload | | TODO |

### Track C (agent): web, stage work

Owns: `web/src/components/needs/decisions/*`, proposal page tabs Validation and BoQ & costing, the batch action bar, "Waiting for me" filter, nav badge, Cycle documents tab.

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| C1 | Batch action bar (actions common to every selected proposal only), decision drawer (per-item outcome and reason, evidence upload) | | TODO |
| C2 | Validation tab (records, evidence, flag resolution), return and resubmit | | TODO |
| C3 | BoQ & costing tab (lines, rate vs standard, variance and ceiling flags with acknowledgement) | | TODO |
| C4 | Task list on the proposal page driven by the server's allowed actions; "Waiting for me" default filter; nav badge | | TODO |
| C5 | Cycle documents tab (generated + signed copies) | | TODO |
| C6 | `WT-N3-*` owed checks | | TODO |

### Track D (agent): web, committee

Owns: `web/src/components/needs/committee/*`, the Prioritisation tab, the proposal page Scores tab.

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| D1 | Chair: members, declarations status, scoring progress, open/close scoring | | TODO |
| D2 | Member: proposals to score, rubric with descriptors, save and submit | | TODO |
| D3 | Ranking table: divergence marks, cumulative cost, the funding line, override with reason, finalise | | TODO |
| D4 | `WT-N3C-*` owed checks | | TODO |

### Main thread: SUBEB committee roster (parent plan 16.2 O-2)

Seed, so it stays in the main thread; do it before briefing Track B, whose MG-05 test needs it.

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| R1 | `seedUbecRoster.ts`: umbrella role `SUBEB_COMMITTEE_MEMBER` ("SUBEB Steering Committee Member": stands for the SUBEB directorates on the committee, e.g. M&E, Finance, Administration), web, `needs:view` + `needs:score`; three Kano SUBEB logins (`kano.committee1@` … `kano.committee3@ubec.test`); `needs:score` added to the SUBEB Administrator grants (the Chairman scores too). Update `NEEDS_PIPELINE_GRANTS` / `NEEDS_PIPELINE_PEOPLE` and the tests that assert them (`routes.needs.n1.test.ts` "nobody else gained a pipeline permission", "each pipeline role holds exactly its plan section 8 grants") | | TODO |

### Main thread: conversion core (N7a)

Owns: `server/src/modules/needs/conversion/*`, `server/src/tests/needs.conversion.n7a.test.ts`.

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| M1 | Pure mapper `needsToScopeImport(parsed)`: sites → `ProjectSite`, breakdown rows → `FacilityUnit` (unit ID, site, planned quantity), BoQ lines → `BoqItem` by unit ID (no sprints) | | TODO |
| M2 | `convertProposalToProject(tx, proposal, { fundedAmountNgn, lot? })`: `createProjectDraftInTx` (type applied, parties derived, year from the cycle, code = proposal reference unless a lot is given), scope import internals, `origin = NEEDS_PIPELINE`, `needsProposalId`, proposal `CONVERTED` + `projectId`, ledger entry `PROJECT_CREATED_FROM_PROPOSAL` with the proposal's history reference | | TODO |
| M3 | Tests on proposals built directly in the database from the fixtures: counts and amounts match; idempotent refusal on a converted proposal | | TODO |

## 2. Scenario steps turned green

DI-04 … DI-09, MG-04, MG-05.

## 3. End of wave

Full gate (background); `/code-review high` focused on separation rules, the task queue's permission logic, score maths and conversion; record below and in parent plan section 15.

## 4. Verification

| Gate | Typecheck | Lint | Web build | Server unit | Server routes | Mobile | Seed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| End of wave 3 | | | | | | | |

## 5. Found during implementation

## 6. Exit criteria

Every row VERIFIED or BUILT with owed checks; eight scenario steps green; conversion tests green; full gate recorded.
