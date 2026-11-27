# Needs Pipeline · Wave 2: Standards, cycles, template v2, upload, proposal page (N2 + N3)

Parent plan: `saas_updates/needs_pipeline_implementation_plan.md`. **Contract names: parent plan section 17 (written by wave 1); it wins over this file.**

**Starts when:** wave 1 exit criteria are met. **Outcome (demoable):** the Standards page with a costing standard; a DI and an MG cycle opened; single and multi-file upload of needs assessments; proposals with versions, sites, the intervention and facilities breakdown, documents and flags.

## 0. Start of wave (main thread)

1. Read wave 1 "Found during implementation" and parent plan section 17. Update this file where names moved.
2. Main thread first: fix the template v2 parser **signature** (`parseNeedsWorkbook(buffer, ctx) → { parsed: ParsedNeedsAssessment | null, issues: SheetIssue[] }` or as section 17 says) so tracks A and B can work at the same time.
3. Brief the agents with: section 17, their owned files, the files they must not touch, their scenario steps.

## 1. Tracks

States: `TODO` · `BUILT (owed WT-…)` · `VERIFIED` (named test passes in a recorded gate).

### Track A (agent): template v2, pure

Owns: `server/src/modules/needs/workbook/needsWorkbook.ts` (builder + parser), `server/src/tests/needsWorkbook.n3.test.ts`, `server/src/tests/fixtures/needs/*` (generator script + committed `.xlsx` files). Must not touch: other server modules, web, shared (ask main for schema changes).

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| A1 | Builder: sheets of plan 6.4 (UBEC styling via `ubecSheetStyle.ts`, title band, header row 3, dropdowns, locked formulas, hidden protected Lists and Rates; Instructions with `INSITE-NEEDS-v2` and the costing standard version); pre-filled for a cycle (programme, year, State) and, for a new version, from the proposal's current version | `needsWorkbook.n3.test.ts` "names the blank and pre-filled files and stamps the version", "round trip: blank template, filled in, parses to the expected content", "a pre-filled build re-parses to the same content (DI and MG)"; `routes.needs.n3.test.ts` "templates (blank per cycle, pre-filled per proposal) and stored version files" | VERIFIED; opening it in Excel/LibreOffice (dropdowns, LGA list, rate formula) owed WT-N2-13 |
| A2 | Parser: columns by header name, header row found in the top 10 rows, row issues with sheet, row, column, reason, amounts recomputed, minimum fields per stage from config, essential and breakdown checks through `facilityBreakdown.ts`, costing summary through `needsCosting.ts` | `needsWorkbook.n3.test.ts` suite "Needs template v2: parser rules" (10 tests: header row, minimum fields per stage, year, State, amounts recomputed, standard rate filled, retired facility, other standard version, not a workbook) | VERIFIED |
| A3 | Old files: a pre-v2 scope workbook imports at Identification only (no breakdown) with a warning; v2 required from Design on | `needsWorkbook.n3.test.ts` "reads sites and BoQ lines with no breakdown, a warning, and BREAKDOWN waived", "a v1 file without BoQ lines is refused at Matching Grants identification…"; `routes.needs.n3.test.ts` "a v1 scope workbook is accepted at DI Identification with a warning, and refused at a later stage" | VERIFIED |
| A4 | Fixtures: valid DI draft, valid DI design, valid MG complete, row errors, duplicate of the valid DI draft's school, essential-facility gap, rate variance, missing S&M line; a batch of five (one invalid) | `needsWorkbook.n3.test.ts` suite "Needs template v2: fixtures" (incl. "each fixture raises exactly the flags it is named for", "the invalid fixtures give their row issues") | VERIFIED |

### Track B (agent): server

Owns: `server/src/modules/needs/` (except `workbook/`), `server/src/modules/standards/`, presign kind `NEEDS_DOCUMENT` (evidence presign module: only the new kind), `server/src/tests/routes.needs.n2.test.ts`, `routes.needs.n3.test.ts`, and un-todo of its scenario steps. Mounting in `app.ts` and `server/package.json` test lists: ask main. Must not touch: web, shared, Prisma.

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| B1 | Costing standards: list versions, read, Excel template and upload (preview → confirm on sha256), save = new version once locked; audit `COSTING_STANDARD_SAVED`; `standards:manage` to write, any web user to read | `routes.needs.n2.test.ts` suite "N2 costing standard: Excel round trip and the save rule" (5 tests) and "a reader cannot write; a mobile token is refused" | VERIFIED |
| B2 | Standards read endpoint: costing (current version), design standards (documents, essential groups from each type's config), monitoring standards (visit form templates and facility sub-forms rendered from the form library, read-only) | `routes.needs.n2.test.ts` "a reader sees the seeded costing standard v1 on the Standards page…", "the essential facility groups of both programmes…", "monitoring standards: the form library without archived components", suite "N2 design standard documents" (3 tests), "N2 tenant isolation" | VERIFIED |
| B3 | Visibility helper `needsAccess.ts`: cycles in the user's organisation subtree; UBEC `needs:review_beap` holders see MG cycles with a submitted BEAP (wave 4 uses it); every route reads proposals through an ownership loader that checks the URL cycle | `routes.needs.n3.test.ts` suite "visibility and the write rule" (3 tests); `routes.needs.scenarios.test.ts` MG-03 | VERIFIED |
| B4 | Cycles: open (config snapshot, deadlines, chain steps copied into `NeedsApprovalStep`, D-N.23), update deadlines and ceiling, close; circular and cycle documents (upload, supersede, list) | `routes.needs.n3.test.ts` "refuses a programme without a pipeline…", "dpp@ opens the 2027 DI cycle: config frozen, deadlines with the override, chain steps copied, costing standard locked, ledger entry", "kano.dpp@ opens the Kano 2027 MG cycle…", "cycle documents: presign, PUT, register (circular)…", "closing a cycle stops uploads"; `routes.needs.scenarios.test.ts` DI-01, MG-01 | VERIFIED |
| B5 | Upload: `POST …/uploads/preview` (many files; per file: parsed summary or issues; nothing written) and `…/confirm` (files by sha256; each valid file is its own proposal or a new version of a named proposal; invalid files listed, not written; one transaction per file; audit) | `routes.needs.n3.test.ts` suite "upload" ("preview reads every file and writes nothing…", "confirm creates one proposal per valid file…", "the same file twice… 422", "a sha256 that does not match… 409", "kano.procurement@ uploads… the file without BoQ is refused"); `routes.needs.scenarios.test.ts` DI-02, MG-02 | VERIFIED |
| B6 | Versions, sites and breakdown rows of the current version replaced in the version's transaction; reference numbering under a per-cycle advisory lock | `routes.needs.n3.test.ts` "a new version of a named proposal: v2 current, v1 kept, tables replaced, flags re-run and a fixed one resolved CORRECTED", "a new version of a proposal of another cycle is 404" | VERIFIED |
| B7 | Flags on each new version: duplicates (open proposals and project sites within the lookback), essential gaps, rate variance, ceiling, missing S&M line | `routes.needs.n3.test.ts` "each flag kind is raised by its fixture (duplicate, essential gap, rate variance, missing S&M line)", "a ceiling breach and a project-site duplicate are found by the flag rules"; `routes.needs.scenarios.test.ts` DI-03 | VERIFIED |
| B8 | Proposal documents (drawings, photos, reports; versions); list and detail DTOs; download template (blank for a cycle, pre-filled for a proposal) | `routes.needs.n3.test.ts` "lists the cycle's proposals with labels, next actor and \"waiting for me\"", "the detail carries versions, flags, tasks, allowed actions and history", "proposal documents: a drawing on 2027-DI-001…", "templates (blank per cycle, pre-filled per proposal) and stored version files" | VERIFIED |
| B9 | Carry-forward offer at open (D-N.19): list of the previous cycle's `NOT_SELECTED`; carry selected | `routes.needs.n3.test.ts` "a NOT_SELECTED proposal of 2027 is offered when 2028 opens; carried, it starts at Validation with its version linked" | VERIFIED |

### Track C (agent): web

Owns: `web/src/api/needs*`, `web/src/queries/needs/*`, `web/src/mutations/needs/*`, `web/src/pages/needsAssessment/*` (rework), `web/src/components/needs/*`, `web/src/pages/standards/*`, `web/src/components/standards/*`, the `needsPipeline` tab in `components/deliveryModels/*`, nav entries in `navItems.ts`. Must not touch: server, shared, existing approved-list components (reuse them).

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| C1 | Standards page `/app/standards` (Costing · Design · Monitoring), costing upload dialog (preview → confirm), nav entry | typecheck, lint, web build | BUILT (owed WT-N2-01, -02, -03) |
| C2 | Needs assessment page: cycle picker, deadline strip, tabs (Proposed projects working; Prioritisation, Approvals, Procurement plan as empty states; Cycle documents; **Approved lists** = the current E3 table moved here) | typecheck, lint, web build | BUILT (owed WT-N2-04, -11) |
| C3 | Open-cycle dialog (incl. circular for MG, carry-forward list) | typecheck, lint, web build | BUILT (owed WT-N2-05, -06) |
| C4 | Upload dialog: multi-file drop, per-file result list (row, column, reason; downloadable error list), confirm valid files | typecheck, lint, web build | BUILT (owed WT-N2-07, -09) |
| C5 | Proposal page: stage bar, task list (GOV.UK pattern), tabs Summary · Sites (map) · **Intervention & facilities** (grouped by facility, site sub-rows, shortfall, essential checks) · Versions · Documents · History; later tabs as empty states | typecheck, lint, web build | BUILT (owed WT-N2-08, -10) |
| C6 | Project type editor tab "Needs assessment": stages, deadlines, rubric (descriptors), essential groups, tolerances, chains | typecheck, lint, web build | BUILT (owed WT-N2-12) |
| C7 | Owed click-through checks added to `saas_updates/web_testing_checklist.md` as `WT-N2-*` | `saas_updates/web_testing_checklist.md` section 6h, WT-N2-01 … -13 (13 added by the main thread: the template in a spreadsheet app) | DONE |

## 2. Scenario steps turned green

DI-01, DI-02, DI-03, MG-01, MG-02, MG-03 (`routes.needs.scenarios.test.ts`).

## 3. End of wave

- Main merges, removes those `todo`s, runs the **full gate** in the background; docs (configuration reference: `needsPipeline` key; CLAUDE.md short section) written meanwhile.
- Review: `/code-review high` on the wave diff, focus: cycle visibility, ownership loaders, upload (file trust, sha256 binding).
- Record the gate below and in the parent plan section 15.

## 4. Verification

| Gate | Typecheck | Lint | Web build | Server unit | Server routes | Mobile | Seed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Baseline (wave 1 record, tree clean at `03b45b1`) | ✓ | 0 errors (52 warnings) | ✓ | 310/310 | 470/470 pass, 25 todo | 169/169 | normal ✓, overlay ✓ |
| End of wave 2, run 1 (2026-11-27, before the review fixes) | ✓ | 0 errors (52 warnings) | ✓ | 328/329: `needs.n1.test.ts` counted 21 pipeline audit actions (wave 2 added `NEEDS_DOCUMENT_ADDED`) | 511/513 pass, 19 todo: `routes.needs.n1.test.ts` assumed no costing standard is seeded (wave 2 seeds v1); both tests updated | 169/169 | normal ✓, overlay ✓ (scratch `insite_needs_w1`); schema diff empty |
| **End of wave 2, run 2 (2026-11-27, final code incl. review fixes)** | ✓ | 0 errors (52 warnings) | ✓ | **329/329** (310 + 19 in `needsWorkbook.n3.test.ts`) | **514/514 pass, 19 todo** of 533 (470 + 13 `routes.needs.n2` + 25 `routes.needs.n3` + 6 scenario steps) | 169/169 | normal ✓, overlay ✓ (scratch `insite_needs_w1`, migration `20261229090000_needs_w2_standards` applied); schema diff empty |

- Nothing was edited while a gate ran. The demo database `insite_assurance` was not touched: wave 2's migration is owed there (`npx prisma migrate deploy` from `server/`, then a reseed), on the owner's word.

## 5. Found during implementation

Wave 2 ran on 2026-11-26 on the owner's instruction (no Minister demo answers yet: the plan section 3 assumptions stand). No clarification round: every open point had a default that follows the plan or the platform's existing rules (below). Main thread: shared contracts, Prisma and migration, seed, `app.ts` mounts, test lists; four agents: Track A (template v2), Track B split into B1 (standards, `server/src/modules/standards/` new files) and B2 (`server/src/modules/needs/`), Track C (web). Each server agent ran its route tests on its own test database (`insite_w2b1_test`, `insite_w2b2_test`): the test helper drops and recreates one database name, so two agents on the default would clobber each other.

### 5.1 Before starting

| # | Finding | What was done |
| :--- | :--- | :--- |
| 1 | Database | Migration and seeds ran on the scratch database `insite_needs_w1` only (`DATABASE_URL` set per command). `insite_assurance` (the demo database) was not touched |
| 2 | Baseline | Taken from the wave 1 record (310 unit, 470 routes + 25 todo, 169 mobile); the tree was clean at `03b45b1` |
| 3 | `server/src/modules/standards/` already exists (Phase 7 project standards, `standards.service.ts`) and so does `shared/src/schemas/standards.schema.ts` | The wave's standards code goes in new files beside them (`costingStandards.*`, `designStandards.service.ts`, `standardsPage.*`); the new shared contracts are in `shared/src/schemas/needsStandards.schema.ts` |

### 5.2 Decisions and deviations

| # | Topic | Decision |
| :--- | :--- | :--- |
| 4 | **Cycle visibility (B3)** | The plan's "cycles in the user's organisation subtree" is read with the platform's organisation-tree rule (`projects:view_organization_tree`): a user with `needs:view` sees a cycle when its owning organisation is the user's organisation or below it. In the seed UBEC HQ is the parent of the SUBEBs, so UBEC HQ users see the State (Matching Grants) cycles from the day they open; a SUBEB sees only its own; another SUBEB sees nothing. The plan's extra clause (`needs:review_beap` holders see an MG cycle once a BEAP is submitted) is a seam for wave 4 (it matters for UBEC users outside HQ). **Writes** (open, update, close, upload, documents) need the route's permission **and** the user's organisation to be the cycle's owning organisation itself, so UBEC HQ reads a SUBEB cycle but cannot act in it, and a SUBEB cannot see or act in the national cycle. Errors: 404 `NEEDS_CYCLE_NOT_FOUND` (not visible), 403 `NEEDS_CYCLE_FORBIDDEN` (visible, not the owner) |
| 5 | Cycle status | A cycle is created `OPEN`; `DRAFT` stays in the enum, unused until a wave needs it |
| 6 | Cycle owner | NATIONAL: the type's default owning organisation (UBEC HQ). STATE: the State's SUBEB (the D2 derivation's lookup) |
| 7 | **Minimum fields at upload** | `minimumFieldsFor(config, stage)` **without `DRAWINGS`**: drawings are proposal documents, uploaded after the proposal exists, so the Matching Grants identification rule (everything, A8) could never be met by an upload. Drawings are checked when the proposal leaves the stage (wave 3) |
| 8 | **Old (v1) files (A3) against DI minimum fields** | The DI identification minimum fields include `BREAKDOWN`, which a v1 file cannot have. A v1 file is accepted at Identification with a warning and the `BREAKDOWN` requirement waived at upload; the stage's minimum fields still apply when it leaves Identification (wave 3), so with the default config a v2 version is needed before validation. The wave file said "v2 required from Design on": with the seeded config it is required one stage earlier, by config, not by code |
| 9 | Presign kind `NEEDS_DOCUMENT` | Not a new `MediaType` (a Prisma enum tied to project captures and their policy): the needs module has its own presign route on the cycle, with `NEEDS_DOCUMENT_UPLOAD_POLICY`, keys under `tenants/<tenant>/needs/cycles/<cycleId>/needs_document/`. Helpers for non-project files: `server/src/utils/tenantUploads.ts` (key namespace check, presign, inspect from storage, store a server-held buffer) |
| 10 | Design standard documents | No table existed (`CostingStandardVersion.designStandardDocumentIds` was a placeholder): new model `DesignStandardDocument` (table `design_standard_documents`, versions by `supersedesId`), migration `20261229090000_needs_w2_standards` with the audit values `NEEDS_DOCUMENT_ADDED` and `DESIGN_STANDARD_DOCUMENT_ADDED` (not used by the migration itself, so one migration). `designStandardDocumentIds` on the costing standard version stays unused (documents are versioned on their own) |
| 11 | Costing standard seed | No costing standard existed. `DEFAULT_COSTING_STANDARD` (`shared/src/data/defaultCostingStandard.ts`): 16 **specimen** rates on catalogue facilities, S&M 5 % and contingency 5 % (assumed: PCM p.8 names the line, not the percentage), zone factors NE 1.1 and SS 1.05, five ceilings. The normal seed saves it as version 1 of the programme tenant, unlocked (`seedNeedsPipeline.ts`); the fixtures are built on it. UBEC replaces it by upload |
| 12 | Costing standard lock and save | A version is locked when a cycle opens with it or a needs assessment version names it. Save: none → v1; latest unlocked → edited in place; latest locked → latest + 1. `COSTING_STANDARD_LOCKED` is thrown by `PUT /costing-standards/:versionId` on a locked or older version |
| 13 | Upload integrity | The server recomputes each file's sha256; any mismatch on confirm → 409 `NEEDS_FILE_CHANGED`, nothing written. Each valid file is its own transaction; invalid files are listed as refused; 422 `NEEDS_FILE_INVALID` only when nothing was written. The same file twice in a request, or a file already stored as a version in the cycle, is refused. The uploaded file is stored and its key kept on the version |
| 14 | Flags on later versions | A flag kind that still applies keeps its open flag (details refreshed); an open flag whose condition no longer holds is resolved `CORRECTED` by the system; separation overrides are never touched |
| 15 | New error codes | All in plan 17.8 (the agents added `NEEDS_CYCLE_STATE_REQUIRED`, `NEEDS_CYCLE_STATE_NOT_ALLOWED`, `NEEDS_DEADLINE_UNKNOWN`, `NEEDS_CYCLE_OWNER_NOT_FOUND`, `NEEDS_CARRY_FORWARD_INVALID`, `NEEDS_DOCUMENT_KIND_MISMATCH`, `NEEDS_DOCUMENT_NOT_FOUND`, `NEEDS_VERSION_NOT_FOUND`, `COSTING_STANDARD_NOT_FOUND`, `DESIGN_STANDARD_DOCUMENT_*`, `UNKNOWN_FACILITY_CODE`) |
| 16 | SUBEB owner lookup (B2) | The normal seed's Kano and Lagos SUBEBs carry no `stateCode`, so the owner of a State cycle is found by `stateCode`, else by a SUBEB organisation whose name contains the State's name. Setting `stateCode` in `seedPhase11` would be cleaner but would change the D2 party derivation in earlier route tests; left for the role/seed migration (`next_steps/seed_replacement_plan.md`) |
| 17 | Template v2 details (Track A) | A blank BoQ rate with a known item code takes the zone's standard rate, with a warning; a blank year (or MG State) takes the cycle's, with a warning; a DI State left blank is taken from the sites when they agree; a BoQ line on a row proposing no work is an issue (it would have no unit at conversion); an item code not in the standard is kept with a warning and not compared; a percentage typed as a fraction (0.05) reads as 5 %; a minimum-field issue is not repeated on a sheet that already has row issues; facilities are read by code, name or "Name (CODE)". A v1 file takes facility archetypes from `DEFAULT_FACILITIES` (the parse context has none) and the cycle standard's percentages for its summary |
| 18 | Upload details (B2) | The MISSING_SUPERVISION_LINE flag is raised only on a version with BoQ lines or a costing subtotal (an Identification draft has neither); no essential-gap flag on a v1 file (it has no breakdown); a duplicate flag is raised on the proposal of the new version only, not on the one it matches (reasons `SAME_SCHOOL`, `NEARBY`, `SAME_SCHOOL_AND_NEARBY`); a new version takes the file's title; a file naming a costing standard version the workspace lacks gets a warning. **Known gap:** the .xlsx is stored before its transaction, so a file refused in a race (e.g. the same file confirmed twice at once) leaves an unreferenced object in storage; harmless, recorded |
| 19 | Costing workbook (B1, main thread fix) | B1 read rates with the lenient register reader (`parseSheetNumber` strips every non-digit, so "about 85k" read as ₦85). A costing standard must not silently mis-read a rate: `strictSheetNumber` in `costingStandardWorkbook.ts` reads a text cell only when it is an amount ("₦ 120,000", "5 %"); anything else is an issue. Test: `routes.needs.n2.test.ts` "a file with an unknown facility code and a bad rate…" (rows DRN-CONC and BRD-MAG). B1 also refuses unknown facility codes on the JSON save, and lists a changed description/facility/unit in `changes.changed` with the same rate on both sides |
| 20 | Costing lock race (main thread fix) | B2 locked the version with a plain update; a save editing the latest version in place could interleave with a cycle starting to use it. `lockCostingStandardVersion` (needs) now calls `lockCostingStandardVersionInTx` (standards), which takes the same per-tenant advisory lock as saves |
| 21 | Web (Track C) | Write buttons show when the user holds the permission and belongs to the cycle's owning organisation (the DTO has no `canWrite`; the server enforces it). A passed deadline reads "Overdue" only while open proposals are at that stage or earlier, else "Passed". The circular is optional in the open-cycle dialog (also addable under Cycle documents). The essential-facility check on the proposal page is computed in the browser from the cycle's groups. The monitoring standards view is a read-only field list (`FormSnapshotView` needs an assembled snapshot). No nav task badge: there is no tasks route until wave 3. `NeedsPipelineSummary.tsx` was deleted (replaced by `NeedsPipelineEditor.tsx`) |

### 5.3 Review (`/code-review high` on the wave diff, 2026-11-27; focus: cycle visibility, ownership loaders, upload file trust and sha256 binding)

Ten findings, all fixed in the main thread after the first gate; the gate was rerun on the fixed code (section 4).

| # | Finding (severity) | Fix | Verified by |
| :--- | :--- | :--- | :--- |
| R1 | Batch confirm: an error inside one file's transaction (e.g. the cycle closed meanwhile) escaped the loop, so the request failed after earlier files were committed (important) | Each file's save is caught and reported REFUSED on that file; a closed cycle refuses that file and every later one; 422 only when nothing was written. The stored-before-transaction orphan object stays a recorded gap (item 18): the storage service has no delete | `routes.needs.n3.test.ts` (upload suite, unchanged outcomes) |
| R2 | Duplicate flags named proposals and projects the viewer cannot open (other cycles, projects outside their visibility) in the flag details and the preview sentence (important) | Matching stays tenant-wide (D-N.16: the same school must not be funded twice); `redactFlagsForViewer` / `expectedFlagsForViewer` (`needsFlags.service.ts`) replace a match the viewer cannot open with `hidden: true` and a label ("a project you cannot open", "a proposed project in a cycle you cannot open"), keeping reason and distance. Wave 3's flag UI must show `label` for hidden matches | `routes.needs.n3.test.ts` "a ceiling breach and a project-site duplicate are found by the flag rules" (procurement@ sees it redacted, admin@ sees the code) |
| R3 | A new version never updated the proposal's State, so a national proposal moved to another State kept its old State and zone for rate flags (important) | The version writes the proposal's State (national: the file's; State cycles: the cycle's) and the flags use it | `routes.needs.n3.test.ts` upload suite (versions); no dedicated State-move test |
| R4 | 20 files × 5 MB as base64 cannot pass the API's 15 MB JSON limit (important) | `NEEDS_UPLOAD_MAX_TOTAL_BYTES` = 10 MB for all files of one request (schema refinement; the upload dialog checks it before reading the files) | `routes.needs.n3.test.ts` "review fixes: … files over 10 MB together are refused" |
| R5 | A cycle or proposal document could supersede one already superseded: two current versions (important) | `assertDocumentRegistrable` under the cycle lock: 409 `NEEDS_DOCUMENT_SUPERSEDED` | `routes.needs.n3.test.ts` "proposal documents: …" |
| R6 | One uploaded file could be registered as many documents (nit) | Same guard: 409 `NEEDS_DOCUMENT_EXISTS` | same test |
| R7 | Confirm re-checked only `UPLOAD_VERSION`, not the stage the file was checked against (nit) | A proposal that moved stage since the check refuses the file ("check the file again") | code review; no race test |
| R8 | Close and update did not take the cycle lock that confirm relies on (nit) | Both take `lockCycle` and re-read the status (409 `NEEDS_CYCLE_NOT_OPEN`) | `routes.needs.n3.test.ts` "closing a cycle stops uploads" |
| R9 | One file aimed at a proposal outside the cycle failed the whole batch with 404 (nit) | Per-file issue "…is not in this cycle" | `routes.needs.n3.test.ts` "a new version of a proposal of another cycle is refused on that file…", "review fixes: …" |
| R10 | Carry-forward at opening did not check the opener could see the previous cycle (nit) | The previous cycle must match `visibleCycleWhere(user)`, else nothing can be carried (422) | code review; the carry-forward test passes |

New error codes: `NEEDS_DOCUMENT_EXISTS`, `NEEDS_DOCUMENT_SUPERSEDED` (409; plan 17.8).

## 6. Exit criteria

**State on 2026-11-27: met.** Every A and B row is VERIFIED by a named test in the recorded gate (section 4, run 2); C1–C6 are BUILT with owed checks WT-N2-01 … -13 in `web_testing_checklist.md` 6h (C7 done). Scenario steps DI-01–03 and MG-01–03 pass; the other 19 stay `todo`. The review's ten findings are fixed (section 5.3). **Owed outside this wave:** wave 2's migration on the demo database `insite_assurance` (owner's word; not touched here).

Every row VERIFIED or BUILT with an owed `WT-N2-*`; six scenario steps green; full gate recorded; review findings fixed or recorded.
