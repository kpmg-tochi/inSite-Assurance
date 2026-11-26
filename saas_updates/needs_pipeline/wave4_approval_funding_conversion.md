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
| A1 | Portfolio submission from the finalised ranking (included / excluded with reasons), management review, final approval with the memo required on the last step; approved → `FUNDING`; excluded → `NOT_SELECTED`; `SAME_PERSON_APPROVAL` | | TODO |
| A2 | MG state approval uses the same chain with SUBEB-scoped steps | | TODO |
| A3 | Out-of-cycle: request (reason, authorising document, optional needs assessment upload) → `OUT_OF_CYCLE` chain → on approval converts with origin `OUT_OF_CYCLE` | | TODO |

### Track B (agent): server, funding, BEAP, activation (N7b–c)

Owns: `server/src/modules/needs/funding/*`, `server/src/modules/needs/submissions/beap.service.ts`, its route file, `server/src/tests/routes.needs.n7.test.ts`; the activation gate change in the project activation service (one function, agreed with main).

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| B1 | DI budget submission record (date, amount, acknowledgement document) | | TODO |
| B2 | Appropriated schedule import (approved-list workbook + "Proposal reference" column; preview: matched, partly funded, not funded, unknown rows refused unless an approved out-of-cycle proposal; confirm in one transaction under the tenant lock): conversion of matched proposals, `NOT_SELECTED` ("Not funded, carried forward") for the rest, `ApprovedList` (kind `DI_SCHEDULE`) written with rows linked to the new projects (D-N.12); `SAME_PERSON_FUNDING` | | TODO |
| B3 | Procurement plan: assign lots and batches to converted DI drafts (`procurement:plan_lots`; existing `lotChoice` on a draft without a lot); approved plan uploaded as a cycle document | | TODO |
| B4 | BEAP: build from approved proposals (lot, batch, procurement method, timeline per item; narrative document; counterpart amount and evidence), submit, UBEC review (per-item comment, request removal; return), SUBEB revision (new versions, `BEAP_REVISION`), resubmit, approval → conversion (owner = SUBEB, lot and batch from the BEAP), `ApprovedList` (kind `MG_BEAP`) written | | TODO |
| B5 | Activation gate: origin required (D-N.13); MG with `requireCounterpartEvidenceBeforeActivation` needs the BEAP's evidence (409 codes recorded in section 17) | | TODO |

### Track C (agent): web

Owns: `web/src/components/needs/submissions/*`, `web/src/components/needs/funding/*`, Approvals and Procurement plan tabs, the New project menu, Portfolio Pipeline tab, project Overview Origin card, Sprints & scope Facilities tab, Documents "Needs assessment" group.

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| C1 | Approval review (count, total, distribution by zone/State/LGA, exclusions, memo, decide) | | TODO |
| C2 | BEAP workspace (SUBEB build and submit; UBEC review per item; revision; approval) | | TODO |
| C3 | Funding tab (DI budget submission; appropriated schedule import preview and confirm); Procurement plan tab (lots) | | TODO |
| C4 | New project menu: "New proposed project" (upload into the open cycle) and "Out-of-cycle project" | | TODO |
| C5 | Portfolio → Pipeline tab; project Origin card; Facilities tab on Sprints & scope; Documents group | | TODO |
| C6 | `WT-N4-*` owed checks | | TODO |

### Main thread, last: retire the old paths (N7e)

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| M1 | **Full gate before deleting code** | | TODO |
| M2 | Remove `/projects/from-needs-assessment/*`, the D1 web flow and their tests; keep `createProjectDraftInTx` and the scope-import internals (used by conversion) | | TODO |
| M3 | Register import: admin only, origin `REGISTER_IMPORT`; "Outside annual cycle" chip on portfolio rows and exports for `OUT_OF_CYCLE` | | TODO |
| M4 | Closure pack: `needs-assessment/` folder (versions, validation, scores, approval memo, funding record) | | TODO |
| M5 | Demo pack: remove the D1 file, keep the approved-list upload file for past years | | TODO |

## 2. Scenario steps turned green

DI-10 … DI-13, MG-06 … MG-10, OOC-01. **Both suites fully green except FIELD-01.**

## 3. End of wave

Full gate after M2–M5; `/code-review high` focused on conversion, the activation gate, chain organisation scope and the funding import; record below and in parent plan section 15.

## 4. Verification

| Gate | Typecheck | Lint | Web build | Server unit | Server routes | Mobile | Seed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Before N7e deletion | | | | | | | |
| End of wave 4 | | | | | | | |

## 5. Found during implementation

## 6. Exit criteria

Every row VERIFIED or BUILT with owed checks; DI and MG suites green (FIELD-01 still todo); both gates recorded.
