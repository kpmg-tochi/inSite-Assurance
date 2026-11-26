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
| A1 | Builder: sheets of plan 6.4 (UBEC styling via `ubecSheetStyle.ts`, title band, header row 3, dropdowns, locked formulas, hidden protected Lists and Rates; Instructions with `INSITE-NEEDS-v2` and the costing standard version); pre-filled for a cycle (programme, year, State) and, for a new version, from the proposal's current version | | TODO |
| A2 | Parser: columns by header name, header row found in the top 10 rows, row issues with sheet, row, column, reason, amounts recomputed, minimum fields per stage from config, essential and breakdown checks through `facilityBreakdown.ts`, costing summary through `needsCosting.ts` | | TODO |
| A3 | Old files: a pre-v2 scope workbook imports at Identification only (no breakdown) with a warning; v2 required from Design on | | TODO |
| A4 | Fixtures: valid DI draft, valid DI design, valid MG complete, row errors, duplicate of the valid DI draft's school, essential-facility gap, rate variance, missing S&M line; a batch of five (one invalid) | | TODO |

### Track B (agent): server

Owns: `server/src/modules/needs/` (except `workbook/`), `server/src/modules/standards/`, presign kind `NEEDS_DOCUMENT` (evidence presign module: only the new kind), `server/src/tests/routes.needs.n2.test.ts`, `routes.needs.n3.test.ts`, and un-todo of its scenario steps. Mounting in `app.ts` and `server/package.json` test lists: ask main. Must not touch: web, shared, Prisma.

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| B1 | Costing standards: list versions, read, Excel template and upload (preview → confirm on sha256), save = new version once locked; audit `COSTING_STANDARD_SAVED`; `standards:manage` to write, any web user to read | | TODO |
| B2 | Standards read endpoint: costing (current version), design standards (documents, essential groups from each type's config), monitoring standards (visit form templates and facility sub-forms rendered from the form library, read-only) | | TODO |
| B3 | Visibility helper `needsAccess.ts`: cycles in the user's organisation subtree; UBEC `needs:review_beap` holders see MG cycles with a submitted BEAP (wave 4 uses it); every route reads proposals through an ownership loader that checks the URL cycle | | TODO |
| B4 | Cycles: open (config snapshot, deadlines, chain steps copied into `NeedsApprovalStep`, D-N.23), update deadlines and ceiling, close; circular and cycle documents (upload, supersede, list) | | TODO |
| B5 | Upload: `POST …/uploads/preview` (many files; per file: parsed summary or issues; nothing written) and `…/confirm` (files by sha256; each valid file is its own proposal or a new version of a named proposal; invalid files listed, not written; one transaction per file; audit) | | TODO |
| B6 | Versions, sites and breakdown rows of the current version replaced in the version's transaction; reference numbering under a per-cycle advisory lock | | TODO |
| B7 | Flags on each new version: duplicates (open proposals and project sites within the lookback), essential gaps, rate variance, ceiling, missing S&M line | | TODO |
| B8 | Proposal documents (drawings, photos, reports; versions); list and detail DTOs; download template (blank for a cycle, pre-filled for a proposal) | | TODO |
| B9 | Carry-forward offer at open (D-N.19): list of the previous cycle's `NOT_SELECTED`; carry selected | | TODO |

### Track C (agent): web

Owns: `web/src/api/needs*`, `web/src/queries/needs/*`, `web/src/mutations/needs/*`, `web/src/pages/needsAssessment/*` (rework), `web/src/components/needs/*`, `web/src/pages/standards/*`, `web/src/components/standards/*`, the `needsPipeline` tab in `components/deliveryModels/*`, nav entries in `navItems.ts`. Must not touch: server, shared, existing approved-list components (reuse them).

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| C1 | Standards page `/app/standards` (Costing · Design · Monitoring), costing upload dialog (preview → confirm), nav entry | typecheck, build | TODO |
| C2 | Needs assessment page: cycle picker, deadline strip, tabs (Proposed projects working; Prioritisation, Approvals, Procurement plan as empty states; Cycle documents; **Approved lists** = the current E3 table moved here) | | TODO |
| C3 | Open-cycle dialog (incl. circular for MG, carry-forward list) | | TODO |
| C4 | Upload dialog: multi-file drop, per-file result list (row, column, reason; downloadable error list), confirm valid files | | TODO |
| C5 | Proposal page: stage bar, task list (GOV.UK pattern), tabs Summary · Sites (map) · **Intervention & facilities** (grouped by facility, site sub-rows, shortfall, essential checks) · Versions · Documents · History; later tabs as empty states | | TODO |
| C6 | Project type editor tab "Needs assessment": stages, deadlines, rubric (descriptors), essential groups, tolerances, chains | | TODO |
| C7 | Owed click-through checks added to `saas_updates/web_testing_checklist.md` as `WT-N2-*` | | TODO |

## 2. Scenario steps turned green

DI-01, DI-02, DI-03, MG-01, MG-02, MG-03 (`routes.needs.scenarios.test.ts`).

## 3. End of wave

- Main merges, removes those `todo`s, runs the **full gate** in the background; docs (configuration reference: `needsPipeline` key; CLAUDE.md short section) written meanwhile.
- Review: `/code-review high` on the wave diff, focus: cycle visibility, ownership loaders, upload (file trust, sha256 binding).
- Record the gate below and in the parent plan section 15.

## 4. Verification

| Gate | Typecheck | Lint | Web build | Server unit | Server routes | Mobile | Seed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| End of wave 2 | | | | | | | |

## 5. Found during implementation

## 6. Exit criteria

Every row VERIFIED or BUILT with an owed `WT-N2-*`; six scenario steps green; full gate recorded; review findings fixed or recorded.
