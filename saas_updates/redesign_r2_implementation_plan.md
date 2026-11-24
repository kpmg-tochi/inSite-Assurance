# Redesign R2: Facilities, Scope, Sprints and the Workbook

**Spec:** [client_flow_redesign.md](client_flow_redesign.md) sections 5, 6.2, 6.2a (unit model only), 7, 10.1 (step 3) and 14 (R2).
**Branch:** `UBEC` (client-specific; decision P).
**Depends on:** R1 (R1a–R1e, done). Briefs, telemetry, the attendance roster and the risk matrix are gone; see D-R2.13.
**Baseline before R2 (measured 2026-11-24):** typecheck clean, lint 0 errors (71 warnings), server 163 unit + 234 route, mobile 57, all passing. **Status: R2a–R2d done** (section 9).

Each slice must leave typecheck, lint (0 errors), the web build, and the server and mobile suites green before the next one starts.

---

## 1. Goal

Replace the BOQ-with-hold-points-and-packages and the earned-schedule model with the client's model:

```
Facility catalogue (tenant)  ──tagged on──▶  Facility units (project)  ◀── BoQ lines (scope)
CLASSROOM, TOILET, BOREHOLE…                 "Ground floor male toilet"      item no., description,
archetype: BUILDING / SUPPLY /               start sprint → end sprint        UoM, qty, rate, amount
UTILITY / EXTERNAL                           planned qty (supply items)
                                                     │
                                             Sprints (project): no., name, start, end, deliverables
```

Data gets in two ways: by hand on a new **Scope & sprints** page, or from a downloadable **needs-assessment workbook** (Excel) that is uploaded, previewed and confirmed. R3 (form builder) and R4 (visits) build on these tables; nothing in R2 builds forms or visits.

---

## 2. Read first

1. `CLAUDE.md` (all of it; especially "Contracts first", the server request path, migrations, seeds and the Windows gotchas).
2. `saas_updates/client_flow_redesign.md` sections 1, 3, 5, 6.2–6.3, 7, 10, 12, 14.
3. `saas_updates/redesign_r1_implementation_plan.md` (what R1 removed, and its "Found during implementation" lists).
4. Current code you will replace or touch:
   - `server/prisma/schema.prisma`: `BoqItem`, `BoqRevision`, `BoqItemDependency`, `ScheduleRevision`, `Project` schedule fields.
   - `server/src/modules/boq/*` (`boqParser.ts` shows how exceljs is used and how the old preview works), `server/src/modules/schedule/*`, `server/src/modules/progress/progress.service.ts`, `server/src/modules/projects/projectSetup.service.ts` (step statuses, activation).
   - `shared/src/schemas/projectSetup.schema.ts` (`PROJECT_SETUP_STEPS`, step save schemas), `shared/src/schemas/boq.schema.ts`, `shared/src/utils/schedule.ts`.
   - `web/src/pages/projects/setup/stepRegistry.ts`, `web/src/pages/projects/setup/steps/BoqStep.tsx`, `ScheduleStep`, `web/src/pages/schedule/*`, Settings page tabs.
   - `server/src/modules/rbac/rbac.service.ts` (`createTenantWithDefaults`: tenant provisioning, where catalogue seeding goes).

---

## 3. Decisions

Defaults below are the plan. Items marked **(confirm)** are reasonable defaults the owner may change; build the default unless told otherwise, and note it in section 9.

| ID | Decision |
| :--- | :--- |
| D-R2.1 | **Scope lines are `BoqItem` rows**, extended with `facilityUnitId`. A new table would orphan the 30+ server files that reference `BoqItem` (captures, reports, progress, KPIs, defects). `wbsCode` is the item no., `unit` the unit of measure, `budgetedCostNgn` the amount (always `rate × quantity`, computed by the server). `section` is set to the facility name for display. |
| D-R2.2 | **Facility catalogue** is a tenant table `Facility` (code, name, category text, archetype `BUILDING_WORKS \| SUPPLY_INSTALLATION \| UTILITIES \| EXTERNAL_WORKS`, `isRetired`, `sortOrder`). Every tenant is provisioned with the **50 facilities in spec 6.2** (19 building, 22 supply, 4 utilities, 5 external; codes upper snake case, e.g. `CLASSROOM`, `PUPILS_FURNITURE`, `BOREHOLE`). The list lives in shared (`DEFAULT_FACILITIES`), like `DEFAULT_DOCUMENT_TYPES`. Tenant admins add, rename, re-archetype and retire; a retired facility stays on existing projects and is hidden from pickers and the workbook. Codes are immutable once used. Archetype default sub-forms are R3, not R2. |
| D-R2.3 | **Facility unit** (`FacilityUnit`, project-scoped): `code` (the workbook "Unit ID", unique per project, e.g. `U01`), `facilityId`, `label`, `plannedQuantity` + `quantityUnit` (supply items; required when the facility's archetype is `SUPPLY_INSTALLATION`, otherwise null), `startSprintId`, `endSprintId` (start ≤ end by sprint number), `sortOrder`. Many BoQ lines per unit. |
| D-R2.4 | **Sprint** (`ProjectSprint`): `number` (1…n, unique per project), `name`, `startDate`, `endDate` (`YYYY-MM-DD` in the project zone, like Phase 9 dates), `deliverables` text. Sprints may differ in length and may leave gaps; **overlaps are refused**; numbers follow date order. Status is derived, never stored: `UPCOMING`, `ACTIVE`, `ENDED` (past its end). `LATE` and `VERIFIED` arrive with sprint verification in R4; do not add verification columns now. |
| D-R2.5 | **Item planned dates come from sprints.** On every scope or sprint save, each line's `plannedStartDate/plannedEndDate` is set from its unit's start sprint start and end sprint end. This keeps reporting obligations (`scheduledItemsForPeriod` in `cadence/obligationDispatch.ts`) and the schedule badge working until R4 replaces them, with no second source of truth. Lines without a unit keep their dates (legacy projects). |
| D-R2.6 | **Activation rule** (new drafts): at least one sprint; every facility unit has a start and end sprint; every BoQ line has a unit; at least one line. Projects already live or archived before R2 (all seeded projects, unless the seed is migrated, see D-R2.12) are not required to have units. Implement as setup issues on the new `scope` step, like the existing step issue codes. |
| D-R2.7 | **Units of measure** are a fixed shared list for v1 (`UNITS_OF_MEASURE`: `m, m2, m3, nr, item, LS, kg, t, set, lot, l` plus labels), used by the workbook dropdown, the scope page and server validation. **(confirm)**: the client may want its own list; then it becomes a tenant table in a later step. |
| D-R2.8 | **Workbook generator**: `GET /api/v1/projects/:projectId/scope/workbook` returns an `.xlsx` built with exceljs: sheets Instructions (with a version stamp, e.g. `INSITE-SCOPE-v1`), Project, Facility units, BoQ, Sprints, and a hidden protected Lists sheet (active facilities, units of measure, regions, delivery models). Dropdowns are data validations pointing at Lists; BoQ Amount is a formula; dates have date validation. When the project already has data the workbook is pre-filled, so a draft can round-trip. Build it in a pure module (`server/src/modules/scope/workbook/`) that takes plain data, so the Needs Assessment module can generate the same workbook without a project. |
| D-R2.9 | **Importer, preview then confirm, nothing written before confirm.** `POST .../scope/import/preview` and `POST .../scope/import/confirm`, both taking the file as base64 (same pattern and size cap as the old `/boq/preview`; JSON body limit is 15 MB). The server finds columns by header name, checks the version stamp, re-validates every row (unknown facility, bad date, missing quantity, unknown Unit ID, unit referencing an unknown sprint, overlapping sprints → row-level errors), recomputes amounts, warns when the BoQ total exceeds the budget. Preview returns lines grouped by facility and sprint, the errors and warnings, and a `sha256` of the file. Confirm re-parses the same bytes (refuses a different `sha256` with 409), refuses if there are errors (422 with the issues), then writes in one transaction with an audit event. |
| D-R2.10 | **Draft vs live.** Draft: confirm **replaces** units, lines and sprints (refused if any line already has captures or reports, which a draft should not have). Live: import is refused (409 `SCOPE_IMPORT_LIVE_PROJECT`); changes go through the scope page (add/edit/remove units, lines, sprints), each audited; removing a unit or line that has captures, reports, defects or findings is refused; changing a sprint's dates on a live project is allowed and audited (it re-derives item dates, D-R2.5). Reuse `BoqRevision` only if it fits naturally; otherwise audit events are enough. |
| D-R2.11 | **Project sheet**: on import into a draft, workbook values fill project fields that are **empty**; a differing non-empty value is a preview warning and is not overwritten. Mapping: name, region (by name/code), LGA, budget, delivery model (project type, only while the draft has none), school (primary beneficiary, created if none), GPS (a radial geofence with the tenant default radius, only when the draft has no geofence). New nullable `Project` fields: `siteAddress`, `strategicJustification`, `assumptions` (the Needs Assessment module needs them too). |
| D-R2.12 | **Seed**: provision the 50 facilities for every tenant. Give the demo programme projects (at least PRG-102 and PRG-105) facility units, sprints and lines linked to units, so the Scope & sprints page and R3/R4 have data. Older seeded projects (LKK-402, ABJ-108, …) may stay unit-less (legacy). Keep every existing seeded story working; update the seed header comments and the `CLAUDE.md` seed paragraph. |
| D-R2.13 | **R1e is done** (migration `20261203090000_r1e_remove_briefs_telemetry_roster`). New R2 migrations must have later timestamps. The `reporting-obligations` job (was `brief-dispatch`) owes items by their planned window, so D-R2.5 still matters until R4. |
| D-R2.14 | **What R2 deletes (slice R2d)**: item dependencies (`BoqItemDependency`), schedule revisions and the catch-up wizard (`ScheduleRevision`, `scheduleRevision.service.ts`, `schedule:catch_up_refactor`, `schedule:approve_refactor`), the Schedule setup step and page, contractor packages on BoQ lines (`BoqItem.projectContractorId`, `/boq/suggest-contractors`, `contractors:manage_packages` if nothing else uses it), and the old BOQ upload/mapping/preview path (`/boq/upload`, `/boq/mappings`, `/boq/preview`, `boqParser.ts`). **Kept until R3/R4**: hold points (`isHoldPoint`, `holdPointInstruction`: used by reports and the omission check), `planningTier`/`dailyTargetQuantity`/`expectedDeliverable` (briefs, R1e), `cumulativeCertifiedPct` (progress). |
| D-R2.15 | **Schedule badge after R2d**: `Project.scheduleStatus` is computed from sprints by the existing `schedule-variance` job: `BEHIND` when an ended sprint still has units whose lines are below 100% progress, `ON_TRACK` otherwise, `NOT_STARTED` before sprint 1, `UNSCHEDULED` with no sprints, `COMPLETE` when all lines are at 100%. `scheduleVarianceWorkdays` becomes null. The `projects_on_schedule` KPI keeps reading `scheduleStatus`. Earned-schedule maths in `shared/src/utils/schedule.ts` that nothing uses afterwards is deleted. **(confirm)**: R4 replaces "lines at 100%" with sprint verification. |
| D-R2.16 | **Programme of works (confirm).** Its item-dates proposal writes the Phase 9 schedule baseline, which R2d deletes. Default: the programme of works becomes a document (type `PROGRAMME_OF_WORKS` already exists); the "programme accepted" milestone completes when that document is signed off (the default type has `requiresSignOff: false` today; switch it to `true` in `DEFAULT_DOCUMENT_TYPES` and the seed); delete the proposal/decision endpoints and `ProgrammeOfWorksSubmission` in R2d. Alternative if the owner prefers: acceptance writes the sprint plan. |
| D-R2.17 | **Permissions**: new `facilities:manage` (tenant catalogue; Tenant Super Admin and Monitor). Scope and sprints reuse `boq:view` / `boq:upload_edit` for now; the role catalogue rework (R7) renames them. New audit actions in both the shared enum and Prisma: `FACILITY_SAVED`, `SCOPE_IMPORTED`, `SCOPE_UPDATED`, `SPRINTS_SAVED`. |
| D-R2.18 | **Web in R2** is limited to what is needed to use the model: Settings → **Facilities** (catalogue editor), and a **Scope & sprints** page used both as the setup step (new step id `scope` replacing `boq`; the `schedule` step goes in R2d) and as the live project page (replacing the BOQ & hold points page in the project nav; hold-point flags stay visible read-only on lines until R3/R4). The 5-step setup, navigation regrouping and Overview stage bar are R6. Mobile is R5: the baseline pack must keep compiling and working, nothing more. |

---

## 4. Schema changes (Prisma)

| Change | Slice |
| :--- | :--- |
| `enum FacilityArchetype { BUILDING_WORKS SUPPLY_INSTALLATION UTILITIES EXTERNAL_WORKS }` | R2a |
| `model Facility` (`tenantId`, `code`, `name`, `category String?`, `archetype`, `isRetired Boolean @default(false)`, `sortOrder Int`, timestamps; `@@unique([tenantId, code])`, `@@map("facilities")`) | R2a |
| `model ProjectSprint` (`projectId`, `number`, `name`, `startDate String`, `endDate String`, `deliverables String @db.Text @default("")`, timestamps; `@@unique([projectId, number])`) | R2b |
| `model FacilityUnit` (`projectId`, `facilityId` (Restrict), `code`, `label`, `plannedQuantity Decimal? @db.Decimal(14,3)`, `quantityUnit String?`, `startSprintId`/`endSprintId` (SetNull), `sortOrder`, timestamps; `@@unique([projectId, code])`) | R2b |
| `BoqItem.facilityUnitId String? @db.Uuid` (SetNull) + index | R2b |
| `Project.siteAddress`, `strategicJustification`, `assumptions` (`String? @db.Text`) | R2c |
| Drop `BoqItemDependency`, `ScheduleRevision` (+ enum `ScheduleRevisionStatus`), `BoqItem.projectContractorId`, `BoqItem.originalPlanned*` if unused, `Project.scheduleVarianceWorkdays` if unused; programme-of-works table per D-R2.16 | R2d |

Migrations: one per slice, generated with `prisma migrate diff` as `CLAUDE.md` describes, reviewed by hand. R2d's diff will try to drop the hand-written index `schedule_revisions_one_pending_per_project` with its table: that is intended; remove it from the `CLAUDE.md` list of hand-written SQL. Keep every other hand-written index and CHECK. Add a data clean-up at the top of R2d (as R1b/R1d did) so it applies on a database with data.

---

## 5. Implementation checklist

### R2a: Facility catalogue
- [x] Shared: `FacilityArchetypeEnum`, `FACILITY_ARCHETYPE_META` (label, description, "quantity-based" flag for supply), `DEFAULT_FACILITIES` (the 50, with archetype and category), `FacilityDto`, `CreateFacilityRequest`, `UpdateFacilityRequest`; permission `facilities:manage` in `SYSTEM_PERMISSIONS_CATALOG` and default roles; audit action `FACILITY_SAVED`.
- [x] Prisma model + migration.
- [x] Server `modules/facilities/`: list (active only, or `includeRetired=true`), create, update (code immutable once any unit uses it), retire/restore; routes at `/api/v1/facilities` (`facilities:manage` to write; read for any web user of the tenant; `boq:view` holders need it for pickers). Provision `DEFAULT_FACILITIES` in `createTenantWithDefaults` and in the seed (add the table to the seed reset list).
- [ ] Web: Settings → Facilities tab (StandardTable: code, name, archetype, category, status; create/edit dialog; retire/restore). Gate with `hasPermission('facilities:manage')`. **Built; verified by typecheck, build and lint only (browser click-through owed).**
- [x] Tests: unit (default list has 50 unique codes, 19/22/4/5 by archetype); route (`routes.r2.test.ts`: provisioning, CRUD, code immutability once used (after R2b), tenant isolation, permission checks). Add the new test files to the explicit lists in `server/package.json`.

### R2b: Units, sprints and scope lines
- [x] Shared `scope.schema.ts`: `ProjectSprintDto`, `FacilityUnitDto` (with facility summary, sprint numbers, line count, amount), `ScopeLineDto` (BoqItem fields + `facilityUnitId`), `ProjectScopeDto` (sprints, units grouped by facility, lines, totals, budget warning), save/patch request schemas, `UNITS_OF_MEASURE`, pure validators in `shared/src/utils/scope.ts` (`validateSprints` (order, overlap, dates), `validateUnits` (sprint refs, start ≤ end, quantity rule), `deriveSprintStatus(sprint, today)`, `unitsActiveInSprint`, `lineAmount`). Validators are shared so web and the importer use the same rules.
- [x] Prisma models + `BoqItem.facilityUnitId` + migration.
- [x] Server `modules/scope/`: `GET /projects/:id/scope`; sprints CRUD (`PUT /scope/sprints` replaces the list on a draft; on a live project individual add/edit, delete only when no unit uses the sprint); units CRUD; lines CRUD (amount computed); every write in one transaction with `recordAuditEvent` and the D-R2.5 date derivation and `refreshProjectProgress` where line budgets change. Ownership checks through `utils/ownership.ts` loaders (add loaders for unit, sprint, line). Add `scope` to `DRAFT_ROUTE_RE`.
- [x] Setup: new step `scope` in `PROJECT_SETUP_STEPS` (title "Scope & sprints", required, replacing `boq`), server step status with the D-R2.6 issues; legacy projects without units are not flagged once live.
- [ ] Web: Scope & sprints page (sprints table with derived status; units grouped by facility with sprint range and planned quantity; lines under each unit with computed amounts; totals vs budget). Same page in setup (`/setup/scope`) and live settings, through the step registry. Replace the BOQ entry in project navigation. Use `useGuardedNavigate`, mutation hooks own toasts. **Built; verified by typecheck, build and lint only (browser click-through owed).**
- [x] Tests: unit for the shared validators; route tests for CRUD, draft vs live rules, refusal to delete a unit/line with evidence, date derivation onto lines, activation issues, audit events.

### R2c: Workbook generator and importer
- [x] Shared: `ScopeWorkbookPreviewDto` (grouped lines, units, sprints, project-field changes, `issues[]` with sheet/row/column/code/message, `warnings[]`, `sha256`, totals), request schemas for preview/confirm, `SCOPE_WORKBOOK_VERSION`.
- [x] Server `modules/scope/workbook/`: `buildScopeWorkbook(data)` (exceljs; sheets and validations per D-R2.8; Lists sheet hidden and protected) and `parseScopeWorkbook(buffer, context)` (header-name lookup, version check, row validation through the shared validators, amount recompute) as pure functions; `scopeImport.service.ts` for preview/confirm (D-R2.9–D-R2.11). Routes: `GET /scope/workbook`, `POST /scope/import/preview`, `POST /scope/import/confirm` (`boq:upload_edit`).
- [x] Prisma: the three new `Project` text fields + migration; show them on the project basics where sensible (read-only is fine for R2).
- [ ] Web: on the Scope & sprints page, "Download workbook" and "Import workbook" (file picker → preview with grouped lines, row errors and warnings → confirm). Live projects show import disabled with the reason. **Built; verified by typecheck, build and lint only (browser click-through owed).**
- [x] Tests: generator round-trip (generate → parse → same data); header order independence; version stamp mismatch; pasted invalid facility / bad date / missing quantity / unknown Unit ID / overlapping sprints each produce a row-level issue; amount recompute ignores the sheet's values; budget warning; confirm with a different file → 409; confirm with errors → 422; draft replace; live refusal; project-sheet fill-empty-only behaviour. Keep generated test files out of the repo (build them in memory).

### R2d: Delete what sprints replace
- [x] Per D-R2.14 and D-R2.16: delete dependencies, schedule revisions, the catch-up wizard, the Schedule step and page, BoQ packages and contractor suggestions, the old BOQ upload/mapping/preview path and `boqParser.ts` (and `boq.parser.test.ts`), programme-of-works proposals (default). Remove the related permissions from the catalogue and default roles, and audit actions from both enums (with migration clean-up as in R1d).
- [x] Rework the `schedule-variance` job per D-R2.15; keep `Project.scheduleStatus`, the directory/portfolio badge and the `projects_on_schedule` KPI working.
- [x] Web and mobile: remove the deleted pages, dialogs, API fetchers and hooks; the mobile pack keeps compiling.
- [x] Seeds: remove schedule revisions and dependencies from `seedPhase9.ts` (LKK-402's pending revision story ends; keep "four weeks behind" by giving it an ended sprint with incomplete lines, or say in the header that it changed); remove the programme-of-works seed data.
- [x] Tests: delete tests that only exercise removed features (`schedule.phase9.test.ts` parts, `routes.phase9.test.ts` revision tests, programme-of-works tests in phase 13); add tests for the new badge rules.

### Docs (every slice)
- [x] `CLAUDE.md`: architecture paragraphs for facilities, scope, sprints, workbook; remove Phase 9 schedule-revision text and the hand-written index in R2d; seed paragraph and logins.
- [x] `configuration_reference.md`: facility catalogue, units of measure, scope rules, workbook; remove deleted settings.
- [x] `demo_script_programme_delivery.md`: show Scope & sprints and the workbook import on a draft.
- [x] This file: section 9 per slice (what was built, decisions taken, found during implementation), verification numbers.

---

## 6. API summary (new)

| Method and path | Permission | Notes |
| :--- | :--- | :--- |
| `GET /api/v1/facilities` | any web user of the tenant | `?includeRetired=true` for admins |
| `POST /api/v1/facilities`, `PATCH /api/v1/facilities/:id` | `facilities:manage` | retire/restore via PATCH `isRetired` |
| `GET /projects/:id/scope` | `boq:view` (field principals allowed, read-only) | sprints, units, lines, totals |
| `PUT /projects/:id/scope/sprints` | `boq:upload_edit` | draft: replace list; live: per D-R2.10 |
| `POST/PATCH/DELETE /projects/:id/scope/units[/:unitId]` | `boq:upload_edit` | |
| `POST/PATCH/DELETE /projects/:id/scope/lines[/:lineId]` | `boq:upload_edit` | amount server-computed |
| `GET /projects/:id/scope/workbook` | `boq:view` | `.xlsx`, pre-filled when data exists |
| `POST /projects/:id/scope/import/preview` | `boq:upload_edit` | base64 file; nothing written |
| `POST /projects/:id/scope/import/confirm` | `boq:upload_edit` | base64 file + `sha256`; draft only |

Route files stay thin; services own transactions and audit; responses go through explicit serializers.

---

## 7. Out of scope

Form builder, facility sub-forms and archetype question sets (R3); visits, sprint verification, findings loop, KPIs on sprints (R4); mobile dashboard and visit UI (R5); 5-step setup, navigation and Overview stage bar (R6); the role catalogue rework (R7); the Needs Assessment module (after R7, reuses the workbook).

---

## 8. Definition of done

- All four slices merged in order, each green at the time: `npm run typecheck` clean, `npm run lint` 0 errors, `npm --workspace=@insite/web run build` passes, server unit + route tests and mobile tests pass.
- A draft can go from empty to activated using only the workbook (download, fill, upload, preview, confirm, activate) and, separately, using only the Scope & sprints page.
- A live project's scope edits are audited; import on a live project is refused.
- Seed runs; demo programme projects show facilities, units, sprints and lines.
- Docs updated (section 5, Docs).
- Web verified at least by typecheck, build and lint; note any browser click-through done or still owed.

---

## 9. Found during implementation

**Baseline (before R2, 2026-11-24):** typecheck clean; lint 0 errors, 71 warnings; server 163 unit + 234 route; mobile 57; all passing. (Lower than the plan's expected 164/245/61: R1e removed tests after the plan was written.)

**Gate per slice** (typecheck, lint, web build, server unit + route, mobile), all green when the next slice started:

| Slice | Lint | Server unit | Server route | Mobile |
| :--- | :--- | :--- | :--- | :--- |
| R2a | 0 errors, 71 warnings | 166 | 239 | 57 |
| R2b | 0 errors, 70 warnings | 170 | 251 | 57 |
| R2c | 0 errors, 70 warnings | 182 | 258 | 57 |
| R2d | 0 errors, 67 warnings | 148 | 249 | 57 |

R2d test counts fall because the removed earned-schedule maths, BOQ parser and revision tests went (unit 182 → 148, route 258 → 249); the new sprint badge tests are included.

Migrations: `20261204090000_r2a_facility_catalogue`, `20261205090000_r2b_units_sprints_scope`, `20261206090000_r2c_scope_workbook`, `20261207090000_r2d_remove_schedule_revisions_packages` (hand-written data clean-up at the top).

### R2a: facility catalogue
- Built as planned: `shared/src/schemas/facility.schema.ts` (`DEFAULT_FACILITIES`: 19/22/4/5, categories Buildings / Furniture / Equipment / Utilities / External works), `server/src/modules/facilities/`, `/api/v1/facilities`, provisioning in `createTenantWithDefaults`, the seed (`seedR2.ts`) and lazily on first read (`ensureFacilities`, like document types), Settings → Facilities (`components/facilities/FacilitiesCard.tsx`).
- `facilities:manage` is held by the Tenant Super Admin (all permissions) and the Monitor role.
- Retire/restore is `PATCH { isRetired }`; every change is one `FACILITY_SAVED` event with the changed fields before/after.

### R2b: units, sprints and scope lines
- Sprints are saved as the full list (`PUT /scope/sprints`) on drafts and live projects alike. The server numbers them by date (the request carries no numbers) and renumbers without colliding on `(projectId, number)`. Removing a sprint: on a draft the units that start or end in it lose it; on a live project it is refused (`SPRINT_IN_USE`). Omitting `deliverables` keeps a sprint's text (found by a test: the first version cleared it). A renumbering that would make a unit end before it starts is refused (`UNIT_SPRINT_ORDER`).
- Removing a unit removes its lines. "Evidence" (refuses removal of a unit or line) = captures, workday reports, incident reports, report queries, a defect ticket naming the line, or progress above 0. Inspection findings are tied to checklist items, not lines, so they do not count.
- Live line edits keep one rule from the old BOQ revision: the quantity cannot go below the work already done (`BOQ_BELOW_CERTIFIED`). The old "rate cannot drop once work is reported" rule was not carried over (amounts are recomputed and audited; revisit with R4 payments if wanted).
- New lines must use `UNITS_OF_MEASURE`; a legacy line keeps a unit outside the list until someone changes it.
- `BoqRevision` is not reused (audit events record every change); `/boq/revisions` stays as a read-only history.
- D-R2.5 extended: `deriveLineDatesFromSprints` also sets `Project.plannedStartDate/plannedEndDate` from the first and last sprint, and `originalPlannedEndDate` while the project is a draft (or when it is empty). The on-time KPI reads these; nothing else wrote them once the Phase 9 baseline went.
- Setup DTO: `boq` became `scope` (sprint, unit, line, unassigned-line and hold-point counts, total). The issue codes are `SPRINT_REQUIRED`, `SCOPE_REQUIRED`, `LINE_UNIT_REQUIRED`, `UNIT_SPRINTS_REQUIRED`, `UNIT_QUANTITY_REQUIRED`, `UNIT_SPRINT_ORDER`, plus the warning `SCOPE_ABOVE_BUDGET`.
- Web: one `ScopeAndSprintsPanel` serves the setup step, live settings and the new project page `/app/projects/:id/scope` (nav "Scope & sprints"; `/boq` redirects). The old `BoqStep` and "BOQ & hold points" page were deleted in R2b, not R2d, because the step they belonged to no longer exists. Hold-point flags show read-only on lines.
- `routes.phase6.test.ts` now builds its draft through the scope API instead of `/boq/upload`.

### R2c: workbook generator and importer
- `buildScopeWorkbook` / `parseScopeWorkbook` are pure (`server/src/modules/scope/workbook/scopeWorkbook.ts`); `scopeImport.service.ts` loads the project and tenant lists around them.
- There is no tenant "default radius" setting (the tenant has a default *tolerance*). The GPS point becomes a radial geofence of `SCOPE_WORKBOOK_DEFAULT_RADIUS_METERS` = 150 m; the Site step adjusts it. If the workspace has radial boundaries turned off, the point is ignored with a warning.
- The Facility dropdown lists names; the parser matches a code or a name. Units reference sprints by their number on the Sprints sheet, so sprint numbers must follow the dates (`SPRINT_NUMBER_ORDER`). The Sprints sheet may be empty.
- A re-import into the same draft may keep a retired facility the draft already uses; elsewhere a retired facility is a row error.
- Found by a test: a row cleared in a spreadsheet tool that does not recalculate keeps a stale cached result in the Amount formula cell. Blank-row detection now ignores the computed Amount column.
- Dates: Excel date cells, serial numbers, `YYYY-MM-DD` and day-first `DD/MM/YYYY`. Numbers: thousands separators and a currency sign are accepted.
- The Lists sheet is hidden and protected without a password (it guards against slips, not people).
- Project sheet: name and budget are always set on a draft, so they are compared only (a difference is a `PROJECT_FIELD_DIFFERS` warning). An unknown region or delivery model is a warning and is ignored. The delivery model is applied through `applyProjectTypeToProject` (draft without a type only). The school becomes the primary beneficiary (type SCHOOL) only when the draft has none.
- Preview also reports `SCOPE_HAS_EVIDENCE` when an existing draft line has evidence (confirm would have to refuse anyway).
- New `Project` fields `siteAddress`, `strategicJustification`, `assumptions` show read-only on the Basics step ("Needs assessment" section) when set.

### R2d: delete what sprints replace
- Deleted: `BoqItemDependency`, `ScheduleRevision` (+ its hand-written index), `ProgrammeOfWorksSubmission`, `BoqItem.projectContractorId`, `BoqItem.originalPlannedStartDate/EndDate`, `Project.scheduleVarianceWorkdays`, and also `Project.currentProjectedEndDate` (only revisions and the programme of works used it). `/schedule/*`, `/programme-of-works/*`, `/boq/upload`, `/boq/mappings`, `/boq/preview`, `/boq/suggest-contractors`, `boqParser.ts`, `scheduleRevision.service.ts`, `programmeOfWorks.service.ts`, `boq.parser.test.ts`, the web Schedule page, step, timeline, catch-up wizard, revision history and programme panel, the BOQ upload/mapping hooks. `/schedule` redirects to `/scope`.
- Permissions removed: `schedule:catch_up_refactor`, `schedule:approve_refactor`, `schedule:propose_programme`, and `boq:configure_hold_points` (only the mappings endpoint used it). Kept: `contractors:manage_packages` (still guards the contractor endpoints; renamed "Manage the Project Contractor") and `schedule:view_variance` (the badge and the behind notification).
- Audit actions removed from both enums: `SCHEDULE_BASELINE_SET`, `SCHEDULE_REVISION_*` (4), `PROGRAMME_OF_WORKS_SUBMITTED/DECIDED`; web notification categories `SCHEDULE_REVISION_PENDING/DECIDED` and `PROGRAMME_OF_WORKS`. **The migration deletes the audit rows of the removed actions, as R1d did: on a database with data that breaks hash-chain verification for those tenants.** Acceptable for the disposable dev DB (decision A); a production database would need a chain re-seal or keeping the enum values.
- D-R2.16 (default built): the `PROGRAMME_OF_WORKS` document type needs a sign-off (shared defaults and a migration update for existing tenants); signing it completes `AUTO_SCHEDULE_BASELINE_SET` milestones (`signProjectDocument`). The enum value keeps its name because project type configs and snapshots store it; its label stays "Programme accepted".
- D-R2.15 interpretation: "an ended sprint still has units whose lines are below 100%" is implemented as *a unit whose end sprint has ended* has a line below 100%; a unit spanning sprints 1–3 is not late when sprint 1 ends. The job now runs for every live project (legacy projects without sprints get UNSCHEDULED); it notifies once when the status becomes BEHIND (the "two weeks behind" threshold has no meaning without variance) and links to `/scope`. The badge DTO lost `varianceWorkdays`; labels are On track / Behind / Not started / Complete / No sprints.
- Obligations: lines have no package, so `scheduledItemsForPeriod` owes nothing once the project's contractor is terminated (the old per-package filter did the same for seeded data).
- `ProjectContractorDto.boqItemCount` removed (it counted package lines).
- `shared/src/utils/schedule.ts` keeps only `addWorkdays`, `isScheduleWorkday`, `nextWorkdayOnOrAfter`, `windowEnd`, `windowOverlaps`, `itemPeriodStatus` (still used by contract milestones, KPIs, obligations and mobile); `schedule.schema.ts` keeps the status enum, its labels and the badge.
- Seed: `seedPhase9.ts` is deleted. LKK-402 and ABJ-108 get sprints and facility units in `seedR2.ts` (Drainage and Solar power facilities). This deviates from "may stay unit-less", because the BEHIND story needs sprints: LKK-402 is behind because sprint 1 ended four weeks ago with its earthworks and culvert units incomplete; the pending revision story ended. ABJ-108 is on track. PRG-105's schedule baseline is replaced by its sprints. Other older projects stay unit-less.
- Tests: `schedule.phase9.test.ts` and `routes.phase9.test.ts` rewritten around what remains plus the sprint badge rules; the programme-of-works test in phase 13 became "signing the document accepts it"; the phase 6 BOQ revision and package suggestion tests were deleted; the phase 2 cross-project hold-point test now targets `PATCH /scope/lines`.

### Not done / follow-ups
- **Browser click-through not done.** Web was verified by typecheck, build and lint only: Settings → Facilities, the Scope & sprints step and page (sprint editor, unit and line dialogs), the workbook download/import preview, the Basics "Needs assessment" section, the removed Schedule nav. Do one pass, ideally with the demo script's new A1b section, before the client demo.
- The workbook was verified by generating and re-reading it with exceljs; it has not been opened in Excel or LibreOffice yet (dropdowns, the hidden Lists sheet and date validation should be checked by eye once).
- `planningTier`, `dailyTargetQuantity`, `expectedDeliverable`, hold-point flags and `cumulativeCertifiedPct` remain on `BoqItem` as planned (R3/R4).
- Units cannot be reordered on the page (sort order is set on create; the workbook import uses row order).
- `UNITS_OF_MEASURE` is fixed (D-R2.7, confirm with the client).

### Follow-up after R2 (owner request, 2026-11-24)
- **Workspace default radius.** New `Tenant.defaultGeofenceRadiusMeters` (Settings → Tenant Settings → Workspace settings; 20–50,000, default 150, `DEFAULT_GEOFENCE_RADIUS_METERS`). It pre-fills a new radial boundary on the Site step (`GeofenceEditor` `defaultRadiusMeters`, from `setup.site.tenantDefaultRadiusMeters`) and the boundary made from a workbook's GPS point (replaces the R2c constant `SCOPE_WORKBOOK_DEFAULT_RADIUS_METERS`). Each project still sets its own radius on its Site step.
- **Linear corridors removed.** `GeofenceMode` is RADIAL | PERIMETER. Deleted the corridor schema and maths (chainage, `formatChainage`, `verifyLinearCorridorGeofence`), the chainage columns (`FieldEvidenceLog.chainageKm/chainageLabel/corridorOffsetMeters`, `WbsChatMessage.chainageLabel`) and their DTO fields, the editor's corridor mode and the map buffer drawing; mobile no longer shows chainage. Migration `20261208090000_geofence_default_radius_no_corridors` turns an existing corridor project into a perimeter (the corridor's bounding box widened by its half-width; redraw it on the Site step if too coarse) and removes the mode from workspace settings. The seed draws LKK-402 as a perimeter along the road. Public marketing pages no longer advertise corridors (they are otherwise stale; R6/R7).
- **Workbook downloads.** Blank workbook with the workspace's lists: `GET /api/v1/scope-workbook` (any web user), button in Settings → Facilities. The project's own workbook is also offered in the needs-assessment section of the Standards step (only shown when the project's process has needs assessments on), besides the Scope & sprints step.
- Gate after the follow-up: typecheck clean, lint 0 errors (67 warnings), web build, server 148 unit + 250 route, mobile 57, all passing.
- **Permission backfill.** Permissions reach the database only through the seed, so a migrated but not reseeded database had no `facilities:manage` (the Facilities tab was hidden). Migration `20261208090001_r2_facilities_permission_backfill` inserts it and grants it to `TENANT_SUPER_ADMIN` and `MONITOR` in every tenant (idempotent). The general fix (a start-up catalogue sync) is planned in R7a.
