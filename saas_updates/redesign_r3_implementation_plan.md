# Redesign R3: Form Builder

**Spec:** [client_flow_redesign.md](client_flow_redesign.md) sections 5, 6.1, 6.2, 6.2a, 6.3, 6.5 (re-check items only), 8.2 (offline forms), 10.2 (tenant entry "Forms & facilities"), 10.3 (Monitoring group), 12 (decisions P3, Y) and 14 (R3).
**Branch:** `UBEC` (client-specific; decision P).
**Depends on:** R2 (R2a–R2d, done): `Facility` catalogue with archetypes, `FacilityUnit` (start/end sprint, `plannedQuantity`, `quantityUnit`), `ProjectSprint`, `BoqItem.facilityUnitId`, `shared/src/utils/scope.ts` (`unitsActiveInSprint`, `deriveSprintStatus`, `sprintDateOrder`).
**Baseline before R3:** after R2 and the geofence follow-up (`20261208090000_geofence_default_radius_no_corridors`): typecheck clean, lint 0 errors, server ~150 unit + ~250 route, mobile 57. **Take the real numbers at the start** and record them in section 9.
**Status:** Done (R3a–R3e, 2026-11-24). Browser click-through owed (section 11).
**Cross-plan contracts:** [redesign_contracts_r3_r7.md](redesign_contracts_r3_r7.md) settles the names and ownership shared by R3–R7. Where this plan differs, the register wins.

Each slice must leave typecheck, lint (0 errors), the web build, and the server and mobile suites green before the next one starts.

---

## 1. Goal

Replace Phase 14 checklist templates with the client's form model:

```
 Form library (tenant)                                   Project scope (R2)
 ├─ Fixed sections        "Health & safety", "Materials"  facilities, units, sprints
 ├─ Facility sub-forms    one per facility; facilities          │
 │                        without one use their archetype's     │
 │                        default (4 defaults cover 50)         │
 └─ Visit form templates  per visit kind: ordered sections      │
                          + where the facility sub-forms go     │
                │                                               │
                └──────────── assembleVisitForm() ◀─────────────┘
                              + visit kind, visit date (→ sprint), open findings to re-check
                                        │
                                        ▼
                              VisitFormSnapshot (frozen, self-contained, offline-ready)
                                        │  answers
                                        ▼
                              validateVisitAnswers() → errors, photo gaps, findings to raise,
                                                       units reported complete, re-check results
```

R3 builds the library, its editor, the pure assembly and validation functions, and the stored frozen snapshot. Nothing in R3 schedules, submits or approves a visit: R4 calls the R3 functions, R5 renders the snapshot on the phone.

---

## 2. Read first

1. `CLAUDE.md` (all; especially "Contracts first", the server request path, migrations and hand-written SQL, seeds, Windows gotchas).
2. `saas_updates/client_flow_redesign.md` sections 5, 6 (all), 8.2, 10.2, 10.3, 12, 14.
3. `saas_updates/redesign_r2_implementation_plan.md`, especially section 9 (what R2 actually built).
4. `saas_updates/redesign_r1_implementation_plan.md` (what R1 removed; "ai" names left for R2–R5).
5. Current code R3 replaces or touches:
   - `shared/src/schemas/inspection.schema.ts` (`InspectionVisitTypeEnum`, `ChecklistItemSchema`, `ChecklistSectionsSchema`, `SaveChecklistTemplateRequestSchema`, `ProjectTypeInspectionsConfigSchema`, `MobileInspectionPackSchema`), `shared/src/utils/inspectionChecklist.ts` (`validateInspectionAnswers`: the "missing photos are never a server error" rule).
   - `server/src/modules/inspections/checklistTemplates.service.ts` (versioning pattern: advisory lock per tenant, unused latest edited in place, used → version + 1), `inspectionTemplates.routes.ts`, `inspectionPack.service.ts`.
   - `server/prisma/schema.prisma`: `InspectionChecklistTemplate`, `SiteInspectionReport`, `InspectionFinding`, `FieldEvidenceLog.siteInspectionReportId/checklistItemKey`, `Facility`, `FacilityUnit`, `ProjectSprint`.
   - `shared/src/schemas/projectType.schema.ts` (`ProjectTypeConfigSchema`; every key defaulted), `web/src/components/deliveryModels/MonitoringRulesEditor.tsx`, `ProjectTypesTab.tsx`.
   - `shared/src/schemas/facility.schema.ts` (`DEFAULT_FACILITIES`, `FACILITY_ARCHETYPE_META`), `server/src/modules/facilities/facilities.service.ts` (`ensureFacilities`, `provisionDefaultFacilities`), `server/src/modules/rbac/rbac.service.ts` (`createTenantWithDefaults`).
   - Web: `web/src/pages/settings/SettingsPage.tsx` (tabs `FACILITIES`, `INSPECTIONS`), `web/src/components/facilities/FacilitiesCard.tsx`, `web/src/components/inspections/ChecklistTemplatesCard.tsx`.
   - Seeds: `server/src/db/seedPhase14.ts` (checklist content worth reusing), `server/src/db/seedR2.ts` (PRG-102, PRG-105, LKK-402, ABJ-108 have units and sprints).

---

## 3. Decisions

Defaults below are the plan. Items marked **(confirm)** are reasonable defaults the owner may change; build the default unless told otherwise, and record it in section 9.

### 3.1 Library model

| ID | Decision |
| :--- | :--- |
| D-R3.1 | **Three tenant-level component kinds**, each versioned: **fixed section** (`FormSection`, by `code`), **facility sub-form** (`FacilitySubForm`, by subject: one archetype or one facility), **visit form template** (`VisitFormTemplate`, by `code`, for one visit kind). Sections are a reusable library: a template lists section codes, so "Health & safety" is written once and used by Routine, Quarterly and Final. The spec says sections are built "per visit type"; reuse gives the same result with less to maintain. |
| D-R3.2 | **Visit kinds are a fixed shared enum** `VisitKindEnum`: `MOBILISATION_CHECK`, `BASELINE`, `ROUTINE`, `QUARTERLY_ME`, `FINAL_EVALUATION`, `POST_CLOSURE_EVALUATION`, `AD_HOC` (spec 5, 6.3). The four Phase 14 values keep their names so R4 maps `InspectionVisitType` 1:1 (closure checklist `inspectionVisitType`, KPI facts). Which facilities a kind includes is fixed per kind in `VISIT_KIND_META.facilityRule` (`NONE`, `ALL`, `SPRINT`, `PICKED`), per the spec 6.3 table. Tenants pick templates per kind; they cannot add kinds. **(confirm)** |
| D-R3.3 | **Header and summary are not form sections.** The header (project, school, visit kind, date, officers, sprint name and deliverables, check-in) comes from the visit (R4) and is shown from the snapshot's `context`. The summary stays two submission fields as in Phase 14 (`overallFinding`, `summaryText`), owned by R4's submission schema. A template's layout is an ordered list of blocks: `{ type: 'SECTION', sectionCode }` and at most one `{ type: 'FACILITIES' }` (refused for kinds whose rule is `NONE`). Re-check items are appended by the assembler after the last block, never placed by the template. |
| D-R3.4 | **Field types v1** (spec 6.1), `FormFieldTypeEnum` and the answer `value` each takes: `SHORT_TEXT` / `LONG_TEXT` (string, ≤ 300 / ≤ 4000), `NUMBER` (number; `unit` label, optional `min`/`max`), `PERCENTAGE` (number 0–100), `YES_NO` (`'YES' \| 'NO' \| 'NA'`; `NA` only when `allowNa`), `SINGLE_CHOICE` (option key), `MULTI_CHOICE` (option keys, `minSelected`/`maxSelected`), `DATE` (`YYYY-MM-DD`), `RATING_1_5` (integer), `PHOTO` (value null; captures), `VOICE_NOTE` (value null; audio captures, transcribed by the existing Whisper path in R4/R5). Choice options carry a stable `key` and a `label`. |
| D-R3.5 | **Rules v1** (spec 6.1), per field: `required`, plus up to 5 conditional rules `{ when, then }`. `when` is one of `{ equals }`, `{ anyOf: [...] }` (yes/no and choice values), `{ atMost: n }`, `{ atLeast: n }` (number, percentage, rating) **(confirm: the spec only says "if answer is X"; numeric thresholds are needed for "rating ≤ 2" and "% below 100")**. `then` is `REQUIRE_PHOTO`, `REQUIRE_COMMENT` or `RAISE_FINDING` with `severity` (`FormFindingSeverityEnum`: `MINOR`, `MAJOR`, `CRITICAL`, the Phase 14 values). Every field may carry photos and a comment; rules decide when they are required. No formulas, scripting or cross-field conditions. There is no implicit "rating ≤ 2 fails" any more: the default library states it as rules. |
| D-R3.6 | **Signals** let R4 react to answers without hard-coding field keys. A field may carry `signal: { kind, when }`: `UNIT_COMPLETE` (facility sub-forms only: the unit, or all units of a whole-facility answer, is reported complete; used for the Routine carry-over and sprint verification) and `CONTRACTOR_ON_SITE` (fixed sections only: completes `AUTO_CONTRACTOR_ON_SITE` milestones in R4). Nothing else in v1. **(confirm)** |

### 3.2 Facility sub-forms (spec 6.2, 6.2a, P3)

| ID | Decision |
| :--- | :--- |
| D-R3.7 | **Archetype defaults plus per-facility overrides, resolved at assembly.** Each tenant has four archetype sub-forms (`BUILDING_WORKS`, `SUPPLY_INSTALLATION`, `UTILITIES`, `EXTERNAL_WORKS`). A facility uses its own sub-form when it has an unarchived one, else its archetype's. "Customise" on a facility copies the archetype default into a facility sub-form (v1); "Reset to default" archives it. So 50 facilities have forms from 4 rows, an edit to a default reaches every uncustomised facility, and a facility moved to another archetype (R2 allows it) follows the new default. Alternative: copy 4 defaults into 50 rows at provisioning (simpler resolution, but a default edit then has to be repeated 50 times). **(confirm)** |
| D-R3.8 | **One sub-form per facility (P3), with a per-field visit-kind filter.** A field may list `visitKinds` (null = every kind that includes facilities). The archetype defaults use it for the three uses of one sub-form: existing condition on `BASELINE`, progress on `ROUTINE`/`QUARTERLY_ME`/`AD_HOC`, delivered-to-specification on `FINAL_EVALUATION`. A facility whose sub-form has no field for the visit kind is listed with its units but has no questions (assembly warning `SUBFORM_EMPTY_FOR_KIND`). Alternative: separate sub-forms per kind (3× the editing). **(confirm)** |
| D-R3.9 | **Placeholders** (spec 6.2a): `{count}`, `{facility}`, `{units}`, `{plannedQty}`, `{uom}`, rendered into the snapshot at assembly (the raw text is kept as `labelTemplate`). `{facility}` is the facility noun for `{count}`: singular for 1, else `Facility.pluralName` when set, else a simple English plural of `name` (`y→ies`, `s/x/ch/sh→es`, else `+s`); supply facilities never pluralise ("Pupils' furniture"). The first letter is lower-cased only when the second is lower case ("toilets", "ICT labs"). New nullable `Facility.pluralName` (editable on the Facilities card) for irregular names. **(confirm)** `{units}` joins unit labels with ", ". `{plannedQty}` and `{uom}`: the sum of the units' planned quantities when they share one `quantityUnit`; mixed units render as a list ("120 desks, 40 chairs") and `{uom}` renders empty. An unknown placeholder is a save error. Placeholders are allowed in labels and guidance of facility sub-forms only. |
| D-R3.10 | **Answer scope and photo modes.** Sub-form fields have `scope: 'WHOLE_FACILITY'` (default, one answer) or `'PER_UNIT'` (the field repeats per unit in the snapshot, `{units}` = that unit, `{count}` = 1). `PHOTO` fields have `photoMode`: `AT_LEAST_N` (`minCount`, `maxCount`), `ONE_PER_UNIT` (one labelled slot per unit, each needs a geotagged photo), `PER_UNIT_OPTIONAL` (labelled slots, none required). Fixed sections allow only `WHOLE_FACILITY` and `AT_LEAST_N`. `geotagRequired` defaults to true for photos. Validity matrix enforced by `validateFormFields` (shared) on save. |
| D-R3.11 | **Supply quantity bound** (spec 6.2a): a `NUMBER` field may set `boundedByPlannedQuantity: true` (sub-forms only). Its snapshot label shows "of 120 desks" (from the units' planned quantity; per-unit fields use the unit's). A value above the planned quantity without a comment is a validation **error** (`QUANTITY_ABOVE_PLANNED`), so the server refuses it in R4. |
| D-R3.12 | **Stable keys and answer paths.** Field keys follow `CHECKLIST_KEY_REGEX` (lower case, ≤ 48) and are unique within a component; the editor derives them from the label on create and never regenerates them. A key that appeared in an earlier version of the same component may not change its `type` (`FIELD_KEY_TYPE_CHANGED`); use a new key. Snapshot paths are deterministic strings: `s:<SECTION_CODE>/<key>`, `f:<FACILITY_CODE>/<key>` (whole facility), `f:<FACILITY_CODE>/<key>@<unitId>` (per unit), `r:<recheckId>`. R4 compares answers across visits by path, so sprint verification can show "latest answer per facility and unit". |

### 3.3 Versioning, assembly and snapshots

| ID | Decision |
| :--- | :--- |
| D-R3.13 | **Versioning as Phase 14 templates:** a version used by a stored snapshot is never edited; saving creates version + 1; an unused latest version is edited in place; saves are serialised per tenant with `pg_advisory_xact_lock(hashtext('form-library:<tenantId>'))`. "Used" = referenced by any `VisitFormSnapshot` (D-R3.15). Templates reference sections **by code**, resolved to the latest unarchived version at assembly, so a section edit does not re-version templates. Archiving a section that an unarchived template lists is refused (409 `SECTION_IN_USE`). Codes are immutable. |
| D-R3.14 | **Assembly is one pure, deterministic shared function**, `assembleVisitForm(input)` in `shared/src/utils/visitForm.ts`, so the server (scheduled visits, R4) and the phone (offline unscheduled Ad hoc visits, R5) build the same form. Inputs are plain data (D-R3.24). No clock reads: `builtAt` is passed in and excluded from the hash. Rules: **sprint for the date** = the sprint whose start–end covers it; in a gap or after the last sprint, the latest sprint that started before it; before sprint 1, none (warning `NO_SPRINT_FOR_DATE`). Facility rule `ALL`: every unit in scope. `SPRINT`: units active in that sprint (`unitsActiveInSprint`) plus units whose end sprint is earlier and that are not in `completedUnitIds` (spec 6.3 "not yet reported complete"). `PICKED`: all units of `pickedFacilityIds`. `NONE`: no facility blocks. Units without sprints (legacy) count only for `ALL` and `PICKED`. Units are grouped into one block per facility (facility `sortOrder`, then unit `sortOrder`); retired facilities still appear. Re-checks are appended in the order given. Snapshot field count is capped at `MAX_SNAPSHOT_FIELDS` = 600 (error `FORM_TOO_LARGE`). |
| D-R3.15 | **Snapshots are stored in R3** in `VisitFormSnapshot` (tenant, project, visit kind, visit date, sprint, template id, the section and sub-form ids used, `snapshotJson`, `contentSha256`, `schemaVersion`). R3 has no visit row: R4 adds `Visit.formSnapshotId` and creates the snapshot in the same transaction that assigns the visit ("frozen when assigned"), replaces it on "rebuild form" while the visit has not started (deleting the old row when nothing else references it), and never mutates a stored snapshot. Storing them in R3 makes "a used version is never edited" testable now. |
| D-R3.16 | **Answer validation is pure and shared**, `validateVisitAnswers(snapshot, answers, captureFacts?)`, replacing `validateInspectionAnswers`. Blocking **errors**: unknown or repeated path, required value missing, value not fitting the type/options/range, `REQUIRE_COMMENT` unmet, `QUANTITY_ABOVE_PLANNED` without a comment, re-check answered "No" without a comment. **Photo gaps** (required photo or audio missing, a `ONE_PER_UNIT` slot empty, a photo without a geotag or outside the boundary per `captureFacts`) are returned separately and are **not** server errors, as in Phase 14: the phone blocks submit on them, the server records them as flags, because captures upload separately and an offline submission must not be stranded. **(confirm)** The result also lists `findingsToRaise`, `signals` (`UNIT_COMPLETE` unit ids, `CONTRACTOR_ON_SITE`) and `recheckResults`. |
| D-R3.17 | **Re-check items** (spec 6.5): the assembler takes `rechecks: RecheckInput[]` (`id`, `kind` `FINDING` \| `DEFECT`, title, description, severity, raised date, optional facility and unit). Each becomes one item "Re-check: <title>. Resolved?" (`YES`/`NO`), photo required when `YES` (a photo gap), comment required when `NO` (an error). R3 does not decide which findings are open or which kinds get re-checks; `VISIT_KIND_META.recheckByDefault` is a hint (true for Routine, Quarterly, Final, Ad hoc, Post-closure). |

### 3.4 Configuration, Phase 14, permissions, web

| ID | Decision |
| :--- | :--- |
| D-R3.18 | **Project type config key `visitForms`**: `{ templateCodeByVisitKind: Partial<Record<VisitKind, code>> }` (defaulted `{}`), with an editor section in `MonitoringRulesEditor` (CLAUDE.md: every config key needs one). Template resolution for a project and kind: the project's **snapshot** config code (never the live type), else the tenant template whose code equals the kind (the provisioned default, e.g. `ROUTINE`), else the first unarchived template of that kind by code; none → 422 `NO_VISIT_FORM_TEMPLATE`. The seed merges `visitForms` into both programme types without a version bump (same pattern as Phases 13 and 15). Spec 10.3's regrouping of the editor is R6. |
| D-R3.19 | **Phase 14 checklists: R3 retires authoring, R4 deletes the runtime.** **(confirm)** Deleting `SiteInspectionReport`/`InspectionFinding`/streams in R3 would leave no monitoring path until R4 and break the CoC gate (`requireFinalEvaluationBeforeCoc` in `completion.service.ts`), the closure checklist kind `INSPECTION_VISIT_TYPE` (`closure.service.ts`), KPI facts (`kpiFacts.ts`: baseline, final evaluation, owed inspections), the closure pack and the mobile `InspectionScreen`. So R3e: removes `ChecklistTemplatesCard`, the checklist write routes (`POST`, `PUT`, archive on `/api/v1/inspection-templates`; they answer 404), `saveChecklistTemplate`/`setChecklistTemplateArchived` and the permission `inspections:manage_templates` (moved holders get `forms:manage`); keeps the table, the read route (the mobile pack and the type editor's legacy picker use it), the seeded Phase 14 templates and `inspections.templateCodeByVisitType` (labelled "Legacy inspection checklists" in the type editor) so Phase 14 inspections keep working. A new tenant created after R3 has no checklist templates and so no Phase 14 inspections: acceptable (decision A, dev DB). R4 deletes the rest together when visits replace inspections. Alternative: leave Phase 14 fully untouched in R3 and delete it all in R4 (two template editors side by side for one step). |
| D-R3.20 | **Permissions and audit.** New `forms:manage` (category with `facilities:manage`): Tenant Super Admin (all) and the Monitor role (today's M&E Manager stand-in; R7 renames roles). Reading the library: `forms:manage` or `project_types:manage` (pickers). Project preview (D-R3.23): `forms:manage` or `inspections:view` **(confirm; R4 swaps it for its visit permission)**. One new audit action in both the shared enum and Prisma: `FORM_COMPONENT_SAVED` (payload: component kind, code or subject, version, mode `created`/`edited`/`versioned`/`archived`/`restored`/`customised`/`reset`), like `FACILITY_SAVED`. |
| D-R3.21 | **Default library** lives in shared as data (`DEFAULT_FORM_LIBRARY`: sections, four archetype sub-forms, seven templates), parsed by the same schemas in a unit test. Provisioned in `createTenantWithDefaults`, lazily on first read (`ensureFormLibrary`, like `ensureFacilities`) and in the seed. Contents in section 4. |
| D-R3.22 | **Web placement:** Settings tab **"Forms & facilities"** replaces the "Facilities" tab and holds: Facilities (the existing `FacilitiesCard` plus "Plural" and "Sub-form" columns: archetype default / customised vN), Facility sub-forms, Fixed sections, Visit form templates, Preview. The tab shows for `forms:manage` or `facilities:manage`. The "Inspections & supervisors" tab keeps only `SupervisorsCard` (R4 moves workload to the planner). The tenant navigation entry (spec 10.2) is R6. |
| D-R3.23 | **Preview without storing:** `POST /projects/:projectId/visit-form/preview` (`visitKind`, `visitDate`, optional `pickedFacilityIds`) runs the real assembly for a project and returns the snapshot plus warnings; nothing is stored or marked used. `completedUnitIds` comes from the R2 rule (every line of the unit at 100% progress) until R4 supplies reported completion; re-checks are empty in R3. |
| D-R3.24 | **Offline bundle contract for R5:** `VisitFormLibraryBundle` (the resolved template per kind for the project, the sections they list, the sub-form for each facility in scope, all at their current versions) built by `buildVisitFormLibraryBundle(db, projectId)`. The phone assembles an unscheduled Ad hoc form from it with `assembleVisitForm`; R4 accepts that client-built snapshot only after re-assembling it from the named component versions and comparing the SHA-256 of `canonicalVisitFormSnapshot` (server helper `hashVisitFormSnapshot`). |
| D-R3.25 | **Limits:** ≤ 40 fields per section or sub-form (the editor warns above 5 on a sub-form: spec "1–3 questions"), ≤ 30 options per choice field, ≤ 20 blocks per template, label ≤ 300, guidance ≤ 1000. |

---

## 4. Default library (D-R3.21)

Reuse the wording of the Phase 14 seed templates (`seedPhase14.ts`) where it fits. Rules shown as `answer → action`.

**Fixed sections**

| Code | Title | Fields (type; rules) |
| :--- | :--- | :--- |
| `MOBILISATION` | Mobilisation | Contractor on site (yes/no; signal `CONTRACTOR_ON_SITE` when YES; NO → comment); key personnel on site (yes/no; NO → comment, finding MAJOR); workers on site (number); listed equipment on site (yes/no; YES → photo); first materials delivered (yes/no); site office and signboard (yes/no; YES → photo); letter of introduction presented (yes/no) |
| `SITE_CONDITIONS` | Site conditions | General site photos (photo, at least 4); topography and drainage (long text); site clear of encumbrances (yes/no; NO → comment); all-weather access (yes/no); water source (yes/no); grid power (yes/no) |
| `PROGRESS` | Progress vs work programme | Works on programme (rating; ≤ 2 → comment, finding MINOR); estimated overall completion (percentage); progress photos (photo, at least 2) |
| `WORKMANSHIP` | Quality of workmanship | Overall workmanship (rating; ≤ 2 → comment, photo, finding MAJOR) |
| `MATERIALS` | Material standards | Materials match the specification (yes/no; NO → photo, comment, finding MAJOR); test certificates available (yes/no/N/A) |
| `HEALTH_SAFETY` | Health & safety | PPE worn (yes/no; NO → photo, finding MINOR); site fenced (yes/no); incidents since last visit (yes/no; YES → comment) |
| `ENVIRONMENT` | Environmental safeguards | Waste managed (yes/no); erosion and run-off controlled (yes/no; NO → photo) |
| `VALUATION_ESTIMATE` | Valuation of works (estimate) | Estimated value of work done (number, NGN); agrees with the payment record (yes/no; NO → comment) |
| `FINAL_SPEC` | Delivery to specification | Project delivered to specification (yes/no; NO → comment, finding MAJOR); outstanding snags (long text, optional) |
| `POST_CLOSURE` | Post-closure | Facilities in use (yes/no; NO → comment); beneficiary feedback (long text); issues reported (yes/no; YES → comment, photo); voice note (voice, optional) |

**Archetype sub-forms** (spec 6.2; `visitKinds` per D-R3.8; B = Baseline, P = Routine/Quarterly/Ad hoc, F = Final)

| Archetype | Fields |
| :--- | :--- |
| `BUILDING_WORKS` | B: existing condition of {facility} (rating; ≤ 2 → comment), photo (at least 1). P: stage reached (single choice substructure / superstructure / roofing / finishes / complete; signal `UNIT_COMPLETE` when complete), % complete (percentage), workmanship acceptable (yes/no; NO → photo, comment, finding MAJOR), photos (one per unit). F: delivered as specified (yes/no; NO → comment, finding MAJOR; signal `UNIT_COMPLETE` when YES), photos (one per unit) |
| `SUPPLY_INSTALLATION` | B: none. P/F: quantity delivered (number, bounded by planned quantity; signal `UNIT_COMPLETE` at least the planned quantity — the assembler substitutes the unit's planned quantity, see section 6), matches specification (yes/no; NO → comment, finding MINOR), installed / in use (yes/no), photo (at least 1) |
| `UTILITIES` | B: existing source or supply (yes/no/N/A; YES → photo). P/F: installed (yes/no), functional when tested (yes/no/N/A; NO → comment, finding MAJOR; signal `UNIT_COMPLETE` when YES), output or yield reading (number), photo (at least 1) |
| `EXTERNAL_WORKS` | B: existing condition (rating), photo. P/F: % complete (percentage; signal `UNIT_COMPLETE` at least 100), length or area done (number, unit from the field), finish acceptable (yes/no; NO → photo, comment, finding MINOR), photo (at least 1) |

**Visit form templates** (code = kind)

| Code / kind | Blocks |
| :--- | :--- |
| `MOBILISATION_CHECK` | `MOBILISATION`, `HEALTH_SAFETY` |
| `BASELINE` | `SITE_CONDITIONS`, FACILITIES |
| `ROUTINE` | `PROGRESS`, FACILITIES, `WORKMANSHIP`, `MATERIALS`, `HEALTH_SAFETY`, `ENVIRONMENT` |
| `QUARTERLY_ME` | `PROGRESS`, FACILITIES, `WORKMANSHIP`, `MATERIALS`, `HEALTH_SAFETY`, `ENVIRONMENT`, `VALUATION_ESTIMATE` |
| `FINAL_EVALUATION` | FACILITIES, `FINAL_SPEC`, `HEALTH_SAFETY` |
| `POST_CLOSURE_EVALUATION` | `POST_CLOSURE` |
| `AD_HOC` | FACILITIES, `HEALTH_SAFETY` |

---

## 5. Schema changes (Prisma)

| Change | Slice |
| :--- | :--- |
| `enum VisitKind` (7 values, D-R3.2); `enum FormSubFormSubject { ARCHETYPE FACILITY }` | R3b |
| `Facility.pluralName String?` | R3b |
| `model FormSection` (`tenantId`, `code`, `version`, `title`, `description String?`, `fieldsJson Json`, `isArchived`, `createdByUserId String? @db.Uuid`, `createdAt`; `@@unique([tenantId, code, version])`, `@@index([tenantId, isArchived])`, `@@map("form_sections")`) | R3b |
| `model FacilitySubForm` (`tenantId`, `subject FormSubFormSubject`, `archetype FacilityArchetype?`, `facilityId String? @db.Uuid` (Restrict), `subjectKey String` (`ARCHETYPE:<archetype>` or `FACILITY:<facilityId>`, written by the service), `version`, `fieldsJson`, `isArchived`, `createdByUserId`, `createdAt`; `@@unique([tenantId, subjectKey, version])`, `@@index([facilityId])`, `@@map("facility_subforms")`) + hand-written CHECK `facility_subforms_subject_check` (`("subject" = 'ARCHETYPE' AND "archetype" IS NOT NULL AND "facilityId" IS NULL) OR ("subject" = 'FACILITY' AND "facilityId" IS NOT NULL AND "archetype" IS NULL)`) | R3b |
| `model VisitFormTemplate` (`tenantId`, `code`, `version`, `name`, `visitKind VisitKind`, `layoutJson Json`, `isArchived`, `createdByUserId`, `createdAt`; `@@unique([tenantId, code, version])`, `@@index([tenantId, visitKind])`, `@@map("visit_form_templates")`) | R3b |
| `model VisitFormSnapshot` (`tenantId`, `projectId` (Cascade), `visitKind`, `visitDate String`, `sprintId String? @db.Uuid` (SetNull), `templateId` (Restrict), `sectionIds String[] @db.Uuid`, `subFormIds String[] @db.Uuid`, `snapshotJson Json`, `contentSha256 String`, `schemaVersion Int`, `builtAt DateTime`, `builtByUserId String? @db.Uuid`; `@@index([projectId])`, `@@index([templateId])`, `@@map("visit_form_snapshots")`). Usage counts query `sectionIds: { has }` / `subFormIds: { has }`; add GIN indexes on the two arrays in the migration if the counts are slow (not needed at seed scale) | R3c |
| Audit action `FORM_COMPONENT_SAVED` (Prisma `AuditActionType` + shared enum) | R3b |
| Data clean-up: remove `inspections:manage_templates` role-permission rows, grant `forms:manage` to roles that had it (R1d pattern) | R3e |

Migrations, one per slice, generated with `prisma migrate diff` and reviewed by hand: `20261210090000_r3b_form_library`, `20261210090001_r3c_visit_form_snapshots`, `20261210090002_r3e_retire_checklist_authoring`. Add `facility_subforms_subject_check` to the `CLAUDE.md` list of hand-written SQL. Keep every existing hand-written index and CHECK (check the diff does not drop them).

---

## 6. Shared contracts (R4 and R5 consume these)

All in `shared/src/schemas/form.schema.ts` and `shared/src/utils/visitForm.ts`, exported from `shared/src/index.ts`. `inspection.schema.ts` keeps its Phase 14 exports until R4.

| Name | Kind | Purpose |
| :--- | :--- | :--- |
| `VisitKindEnum`, `VISIT_KIND_META` (`label`, `facilityRule`, `recheckByDefault`, `legacyInspectionVisitType`) | schema + const | Visit kinds and their facility rule (D-R3.2) |
| `FormFieldTypeEnum`, `FormFieldSchema`, `FormFieldRuleSchema`, `FormFieldSignalSchema`, `FormChoiceOptionSchema`, `PhotoModeEnum`, `AnswerScopeEnum`, `FormFindingSeverityEnum` | schema | Field definition (D-R3.4–D-R3.12) |
| `FormSectionDefinitionSchema`, `FacilitySubFormDefinitionSchema`, `VisitFormTemplateLayoutSchema` | schema | Component bodies (fields / blocks) with key uniqueness refinements |
| `SaveFormSectionRequestSchema`, `SaveFacilitySubFormRequestSchema`, `SaveVisitFormTemplateRequestSchema`, `SetFormComponentArchivedRequestSchema` | schema | Editor requests |
| `FormSectionDto`, `FacilitySubFormDto` (with `source: 'ARCHETYPE' \| 'FACILITY'`), `VisitFormTemplateDto`, `FormLibraryDto` (latest of each, usage counts, `isLatest`, facility → effective sub-form map) | schema | Editor responses |
| `ProjectTypeVisitFormsConfigSchema` | schema | Config key `visitForms` (D-R3.18) |
| `VisitFormSnapshotSchema` (`schemaVersion: 1`, `context` {projectId, visitKind, visitDate, sprint {id, number, name, startDate, endDate, deliverables} \| null}, `sources` {template {id, code, version}, sections[{id, code, version}], subForms[{id, subjectKey, version, facilityId}]}, `blocks[]` {key, kind `SECTION` \| `FACILITY` \| `RECHECK`, title, facility {id, code, name, archetype} \| null, units [{id, code, label, plannedQuantity, quantityUnit}], fields[]}, field {path, key, type, label, labelTemplate, guidance, required, options, unit, min, max, photo {mode, minCount, maxCount, geotagRequired, slots[{unitId, label}]}, scope, unitId, plannedQuantity, rules, signal}, `warnings[]`) | schema | The frozen form (D-R3.14–D-R3.15) |
| `RecheckInputSchema` | schema | Findings and defects to re-check (D-R3.17) |
| `VisitFormAnswerSchema` (`path`, `value: string \| number \| string[] \| null`, `comment`, `captures: [{ clientCaptureId, unitId \| null, kind: 'PHOTO' \| 'AUDIO' }]`), `VisitFormAnswersSchema` (≤ 2000) | schema | What the phone sends (R4 wraps it with `overallFinding`, `summaryText`, check-in) |
| `CaptureFact` (`clientCaptureId`, `geotagged`, `insideBoundary: boolean \| null`) | type | Optional input to validation (server fills it from `FieldEvidenceLog`) |
| `VisitFormLibraryBundleSchema` | schema | Offline assembly inputs for the phone (D-R3.24) |
| `validateFormFields(fields, { context: 'SECTION' \| 'SUBFORM', previousKeyTypes? })` | function | Save-time checks: keys, placeholders, scope/photo-mode matrix, rule/type fit, signal context, `FIELD_KEY_TYPE_CHANGED` |
| `renderPlaceholders(text, ctx)`, `facilityNoun(facility, count)` | function | D-R3.9 |
| `sprintForDate(sprints, date)` (in `utils/scope.ts`) | function | D-R3.14 sprint rule |
| `unitsForVisit({ kind, sprints, units, visitDate, completedUnitIds, pickedFacilityIds })` | function | D-R3.14 facility rule, exposed for the planner's "facilities to check" (R4) and the phone's visit card (R5) |
| `assembleVisitForm(input): { snapshot, warnings }` | function | D-R3.14 |
| `canonicalVisitFormSnapshot(snapshot)` | function | Canonical JSON string (sorted keys, `builtAt` removed). Shared has no SHA-256 implementation, so each side hashes this string: server `node:crypto` (`hashVisitFormSnapshot` in `modules/forms`), phone its existing crypto helper (D-R3.24) |
| `validateVisitAnswers(snapshot, answers, captureFacts?)`: `{ valid, errors[{path, code, message}], photoGaps[{path, unitId, code}], findingsToRaise[{path, fieldKey, severity, facilityId, unitId, sectionCode, label, answerText}], signals {unitComplete: unitId[], contractorOnSite: boolean}, recheckResults[{recheckId, resolved}] }` | function | D-R3.16, replaces `validateInspectionAnswers` |
| `DEFAULT_FORM_LIBRARY` | const | Section 4 |

`UNIT_COMPLETE` on a bounded quantity field means "at least the planned quantity": `when: { atLeast: 'PLANNED' }` is the one non-numeric threshold allowed, only on `boundedByPlannedQuantity` fields.

### What R4 must do with them

- Create a `VisitFormSnapshot` (via `freezeVisitFormSnapshot(tx, …)`) in the transaction that assigns a visit; set `Visit.formSnapshotId`; "rebuild form" only before the visit starts; never edit a stored snapshot.
- Supply `completedUnitIds` from reported completion (`signals.unitComplete` of approved submissions, or sprint verification) instead of the R3 "lines at 100%" stand-in, and `rechecks` from open findings and defects.
- On submission: run `validateVisitAnswers` with `captureFacts` from `FieldEvidenceLog`; refuse on `errors`; store `photoGaps` as flags (the omission check's inspection mode, renamed); raise findings from `findingsToRaise` (avoid a second open finding for the same path and unit); act on `signals` (`CONTRACTOR_ON_SITE` → `autoCompleteMilestones`); close or keep findings from `recheckResults`; link captures to the submission by `path` and `unitId` (replaces `FieldEvidenceLog.checklistItemKey`).
- Accept phone-built Ad hoc snapshots only after re-assembly gives the same `hashVisitFormSnapshot`.
- Replace Phase 14: map `InspectionVisitType` to `VisitKind` (closure `INSPECTION_VISIT_TYPE` items, CoC final-evaluation gate, KPI facts, closure pack), delete `InspectionChecklistTemplate`, `SiteInspectionReport`, streams, `inspections.templateCodeByVisitType`, `inspection.schema.ts` and `inspectionChecklist.ts` (keep `distanceKm`/workload maths elsewhere).

### What R5 must do with them

- Render `VisitFormSnapshot` (one block per screen, per-unit fields and `ONE_PER_UNIT` slots labelled by unit), never re-assemble a scheduled visit's form.
- Run `validateVisitAnswers` locally and block submit on `errors` and `photoGaps`.
- Build unscheduled Ad hoc forms offline from `VisitFormLibraryBundle` with `assembleVisitForm`.
- Send `VisitFormAnswer`s with captures referenced by `clientCaptureId` (no display strings, `file://` paths or base64, as `CLAUDE.md` requires).

---

## 7. Implementation checklist

### R3a: Shared contracts and pure functions (no database)
- [x] `shared/src/schemas/form.schema.ts`: every schema in section 6, `MAX_SNAPSHOT_FIELDS`, limits (D-R3.25); `VISIT_KIND_META`.
- [x] `shared/src/utils/visitForm.ts`: `validateFormFields`, `renderPlaceholders`, `facilityNoun`, `unitsForVisit`, `assembleVisitForm`, `canonicalVisitFormSnapshot` (sorted keys, `builtAt` removed; shared has no SHA-256, so hashing stays with the caller), `validateVisitAnswers`. `sprintForDate` in `utils/scope.ts`.
- [x] `DEFAULT_FORM_LIBRARY` (section 4).
- [x] Unit tests `server/src/tests/forms.r3.test.ts` (add to `test:unit` in `server/package.json`): default library parses and passes `validateFormFields`, every template's section codes exist, every kind has a template; placeholder rendering and plurals (Toilet/toilets, ICT lab/ICT labs, Library/libraries, Pupils' furniture unchanged, mixed quantity units); scope/photo-mode matrix; `FIELD_KEY_TYPE_CHANGED`; `sprintForDate` (inside, gap, after last, before first); assembly per kind (Mobilisation none, Baseline all, Routine active + incomplete carry-over, Quarterly same units as Routine, Final all, Post-closure none, Ad hoc picked), grouping and ordering, per-unit expansion and paths, `visitKinds` filter and `SUBFORM_EMPTY_FOR_KIND`, re-checks appended, `FORM_TOO_LARGE`, determinism (same input → same canonical string; `builtAt` ignored); validation (each type, options, required, conditional rules, `QUANTITY_ABOVE_PLANNED`, photo gaps per mode incl. `ONE_PER_UNIT`, geotag/boundary facts, findings to raise per unit, signals incl. whole-facility `UNIT_COMPLETE` covering all units, re-check results).

### R3b: Form library tables, services and routes
- [x] Prisma: enums, `Facility.pluralName`, `FormSection`, `FacilitySubForm` (+ CHECK), `VisitFormTemplate`, audit action; migration `20261210090000_r3b_form_library`; add the CHECK to `CLAUDE.md`.
- [x] Shared: permission `forms:manage` in `SYSTEM_PERMISSIONS_CATALOG` and the default roles (Monitor); `FORM_COMPONENT_SAVED` in the shared audit enum; `ProjectTypeConfigSchema.visitForms`; `FacilityDto.pluralName` + `subForm { source, version }`; `UpdateFacilityRequestSchema.pluralName`.
- [x] Server `modules/forms/`: `formLibrary.service.ts` (list latest, versions per code/subject, save section, save archetype sub-form, customise / save / reset facility sub-form, save template, archive/restore; versioning per D-R3.13 under the advisory lock; one transaction with `recordAuditEvent` each; explicit serializers), `formLibraryProvisioning.ts` (`provisionDefaultFormLibrary(tx, tenantId)`, `ensureFormLibrary`), `formLibrary.routes.ts` at `/api/v1/form-library` (thin; `validateBody`). Facility sub-form routes confirm the facility belongs to the tenant. Call provisioning from `createTenantWithDefaults`.
- [x] Facilities: `pluralName` on create/update and in the DTO; the Facilities card shows it.
- [x] Project types: `visitForms` copied on apply like every key; a template code that does not exist in the tenant is a save error in the type editor service.
- [x] Seed `server/src/db/seedR3.ts` (runs after `seedR2`): provision the library for every tenant; merge `visitForms` (codes = kinds) into both programme types without a version bump; customise one facility (`TOILET`: add a per-unit "Plumbing connected" yes/no, YES → photo, matching spec 6.1's example) so the demo shows an override. Add the new tables to the seed reset list. Update the seed comment in `seedDatabase.ts` and the `CLAUDE.md` seed paragraph.
- [x] Route tests `server/src/tests/routes.r3.test.ts` (add to `test:routes`): provisioning on a new tenant (4 archetype sub-forms, 10 sections, 7 templates), lazy `ensureFormLibrary`, create/edit-in-place/version (after R3c, used → v + 1), code immutability, `SECTION_IN_USE`, customise → reset → archetype default again, facility from another tenant 404, re-archetype follows the new default, permission checks (`forms:manage`, read with `project_types:manage`), audit events, type config `visitForms` round-trip.

### R3c: Assembly service, snapshots and preview
- [x] Prisma `VisitFormSnapshot` + migration `20261210090001_r3c_visit_form_snapshots`.
- [x] Server `modules/forms/visitForm.service.ts`: `resolveVisitFormTemplate(db, project, kind)` (D-R3.18), `loadAssemblyInput(db, projectId, { kind, visitDate, pickedFacilityIds, rechecks, completedUnitIds? })` (scope through the R2 tables; picked facilities must have units on the project, else 422 `FACILITY_NOT_IN_SCOPE`), `buildVisitForm` (load + `assembleVisitForm`), `freezeVisitFormSnapshot(tx, …)` (stores the row with source ids and hash; for R4), `deleteSnapshotIfUnused`, `buildVisitFormLibraryBundle(db, projectId)`. Usage counts in the library DTO read `VisitFormSnapshot`.
- [x] Route `POST /api/v1/projects/:projectId/visit-form/preview` (D-R3.23) in a project router wrapped by `guardProjectRoutes`; add `visit-form` to `DRAFT_ROUTE_RE` so a draft can be previewed in setup.
- [x] Tests (extend `routes.r3.test.ts`): preview on seeded PRG-102 and PRG-105 for each kind (units per sprint match `unitsActiveInSprint`; PRG-105's earlier-sprint unit below 100% carried into Routine); preview stores nothing; a stored snapshot (via `freezeVisitFormSnapshot` in the test) makes the section, sub-form and template versions "used" so the next save versions them; the snapshot is unchanged after a later edit; bundle + client assembly hash equals server assembly hash; project of another tenant 404; legacy project without units gets the warning and fixed sections only.

### R3d: Web "Forms & facilities"
- [x] API/queries/mutations: `web/src/api/forms`, `web/src/queries/forms`, `web/src/mutations/forms` (mutation hooks own toasts).
- [x] Settings tab "Forms & facilities" (D-R3.22): `components/forms/FacilitySubFormsCard.tsx` (archetype defaults; facilities with source and version; Customise / Edit / Reset), `FormSectionsCard.tsx`, `VisitFormTemplatesCard.tsx` (per kind: ordered blocks, add/remove/move, FACILITIES slot where allowed), `FormFieldsEditor.tsx` (shared by sections and sub-forms: type picker, options, required, scope, photo mode, rules, signal, `visitKinds`, placeholder chips; live preview rendered with `assembleVisitForm` over sample units, e.g. three toilets), `VisitFormPreviewCard.tsx` (pick project, kind, date, facilities for Ad hoc → read-only render), `FormSnapshotView.tsx` (read-only renderer of a snapshot, reused by R4's visit pages). Versions list per component with "used by N snapshots". Gate edits with `hasPermission('forms:manage')`. Use `StandardTable` and `components/common`. Any new `navigate()` uses `useGuardedNavigate`; the field editor has an unsaved-changes guard.
- [x] Facilities card: "Plural" and "Sub-form" columns.
- [x] Project type editor: `MonitoringRulesEditor` gets "Visit forms" (template per visit kind, from the library); the Phase 14 picker is relabelled "Legacy inspection checklists" (removed in R4).
- [x] Verify by typecheck, build and lint; record the click-through as owed if not done.

### R3e: Retire checklist authoring (D-R3.19) and docs
- [x] Remove `ChecklistTemplatesCard`, the checklist template write routes and service functions, the web hooks for them, and `inspections:manage_templates` (catalogue, default roles, migration `20261210090002_r3e_retire_checklist_authoring` with the R1d-style data clean-up; `requirePermission` lists on the read route lose it). Keep the table, the read route, seeded templates and Phase 14 inspections running. `seedPhase14.ts` creates templates directly through Prisma (or a kept internal helper) instead of `saveChecklistTemplate`.
- [x] Tests: the removed routes answer 404; `inspections.phase14.test.ts` and `routes.phase14.test.ts` lose the template authoring tests only; Phase 14 submission tests still pass on seeded templates.
- [x] `CLAUDE.md`: a "Form builder (R3)" architecture paragraph (library, resolution, assembly, snapshots, validation, the R4/R5 contracts), the hand-written CHECK, seed paragraph; note in the Phase 14 paragraph that template authoring moved to the form library.
- [x] `configuration_reference.md`: form library, field types, rules, signals, placeholders, scope and photo modes, `visitForms` type key, `Facility.pluralName`; remove checklist template authoring.
- [x] `demo_script_programme_delivery.md`: Forms & facilities walk-through (archetype default, customised Toilet, Routine preview on PRG-105 showing sprint units and carry-over).
- [x] This file: section 9 per slice, with verification numbers.

---

## 8. API summary (new)

| Method and path | Permission | Notes |
| :--- | :--- | :--- |
| `GET /api/v1/form-library` | `forms:manage` or `project_types:manage` | latest of every component, usage counts, effective sub-form per facility |
| `GET /api/v1/form-library/sections/:code/versions`, `.../subforms/:subjectKey/versions`, `.../templates/:code/versions` | `forms:manage` | newest first |
| `POST /api/v1/form-library/sections`, `PUT .../sections/:code`, `PATCH .../sections/:code` | `forms:manage` | create / save (in place or new version) / archive-restore |
| `PUT /api/v1/form-library/subforms/archetype/:archetype` | `forms:manage` | save an archetype default |
| `POST /api/v1/form-library/subforms/facility/:facilityId` | `forms:manage` | customise (copy of the archetype default, or the body) |
| `PUT /api/v1/form-library/subforms/facility/:facilityId` | `forms:manage` | save |
| `POST /api/v1/form-library/subforms/facility/:facilityId/reset` | `forms:manage` | archive → archetype default applies |
| `POST /api/v1/form-library/templates`, `PUT .../templates/:code`, `PATCH .../templates/:code` | `forms:manage` | as sections |
| `POST /api/v1/projects/:projectId/visit-form/preview` | `forms:manage` or `inspections:view` | `{ visitKind, visitDate, pickedFacilityIds? }`; nothing stored |
| `PATCH /api/v1/facilities/:id` | `facilities:manage` | now also `pluralName` |
| Removed (R3e): `POST /api/v1/inspection-templates`, `PUT/PATCH /api/v1/inspection-templates/:code…` (write routes) | – | 404 |

Internal (no route, for R4): `freezeVisitFormSnapshot`, `deleteSnapshotIfUnused`, `buildVisitForm`, `buildVisitFormLibraryBundle`, `resolveVisitFormTemplate`.

---

## 9. Out of scope

Visits, the planner and generators, type default visit plans, check-in, submissions, approval, the findings and defects loop runtime, contractor email summaries, sprint verification, deadlines and KPIs (R4); deleting Phase 14 inspection reports, findings, streams and the remaining checklist template table (R4, D-R3.19); the mobile form filler, site log and pack changes (R5); the 5-step setup, tenant navigation entry, Overview and the regrouped type editor (R6); the role catalogue (R7); formulas, cross-field conditions, tenant-defined visit kinds, form translations.

---

## 10. Definition of done

- All five slices merged in order, each green at the time: `npm run typecheck` clean, `npm run lint` 0 errors, `npm --workspace=@insite/web run build` passes, server unit + route and mobile tests pass.
- Every tenant (new, existing, seeded) has the default library; 50 facilities resolve to a sub-form with no per-facility rows except customised ones.
- The preview builds the right form for every visit kind on PRG-102 and PRG-105, with per-unit fields, one-per-unit photo slots, rendered placeholders and the Routine carry-over.
- A version referenced by a stored snapshot cannot be edited; saving creates a new version; stored snapshots never change.
- `assembleVisitForm` and `validateVisitAnswers` are pure, deterministic and covered by unit tests; the section 6 contracts are exported from `@insite/shared`.
- Checklist template authoring is gone; Phase 14 inspections still work on the seeded templates.
- Seed runs; docs updated (R3e).
- Web verified at least by typecheck, build and lint; browser click-through recorded as done or owed.

---

## 11. Found during implementation

### 11.1 Verification numbers

| Point | Typecheck | Lint | Web build | Server unit | Server route | Mobile |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Baseline (before R3) | clean | 0 errors, 67 warnings | pass | 148 | 250 | 57 |
| After R3a–R3c (gated together, see 11.3) | clean | 0 errors, 67 warnings | – | 180 | 266 | 57 |
| After R3d–R3e (final) | clean | 0 errors, 67 warnings | pass | 180 | 267 | 57 |

Seed runs (`npm run prisma:seed`). Web verified by typecheck, build and lint only: **browser click-through of Forms & facilities and the type editor's Visit forms section is owed** (with the Phase 11–16 click-through).

### 11.2 Migrations

- `20261210090000_r3b_form_library`: enums `VisitKind`, `FormSubFormSubject`; `facilities.pluralName` (+ backfill of the four irregular default plurals); `form_sections`, `facility_subforms` (+ hand-written CHECK `facility_subforms_subject_check`), `visit_form_templates`; audit `FORM_COMPONENT_SAVED`; idempotent `forms:manage` permission backfill (contract register section 3).
- `20261210090001_r3c_visit_form_snapshots`: `visit_form_snapshots` (no GIN indexes; usage counts use `&&` + `unnest`, fine at seed scale).
- `20261210090002_r3e_retire_checklist_authoring`: roles holding `inspections:manage_templates` get `forms:manage`; the old permission and its grants are deleted.

No existing hand-written index or CHECK was dropped by the generated diffs.

### 11.3 Decisions on the (confirm) items

All built as the default: D-R3.2 (fixed visit kinds), D-R3.5 (numeric thresholds `atMost`/`atLeast`), D-R3.6 (signals, extended per the register, below), D-R3.7 (archetype defaults + overrides resolved at assembly), D-R3.8 (one sub-form per facility, `visitKinds` filter), D-R3.9 (`Facility.pluralName`), D-R3.16 (photo gaps are not server errors), D-R3.19 (R3e retires authoring only), D-R3.20 (preview with `forms:manage` or `inspections:view`).

### 11.4 Found during implementation

1. **Signals (register section 1).** The register extends signals to `PERCENT_COMPLETE`, `QUANTITY_DELIVERED`, `OVERALL_FINDING` (R4's progress and KPI inputs). A field has one signal, and section 4 wanted `UNIT_COMPLETE` on the same fields that now carry `PERCENT_COMPLETE` / `QUANTITY_DELIVERED`, so `validateVisitAnswers` also reports units complete when a `PERCENT_COMPLETE` answer is 100 or a `QUANTITY_DELIVERED` answer is at least the planned quantity. `signals` therefore holds `unitComplete`, `contractorOnSite`, `percentComplete[]`, `quantityDelivered[]` and `overallFinding`. The default library does not use `OVERALL_FINDING` (the submission's `overallFinding` covers it); `atLeast: 'PLANNED'` stays available but unused by defaults.
2. **Slices R3a–R3c gated together.** R3a's `FacilityDto.pluralName`/`subForm` need R3b's column, and R3b's usage counts read R3c's `VisitFormSnapshot`, so the three were gated as one step; the migrations stay separate as planned.
3. **Placeholders.** Supply facilities are lower-cased like the others but never pluralised ("Quantity of pupils' furniture delivered"); section 7's "Pupils' furniture unchanged" was read as "not pluralised". A text starting with a placeholder keeps a capital ("Borehole installed"). Default plurals set: Staff quarters, Solar power systems, Landscaping, Drainage and exterior works (in `DEFAULT_FACILITIES` and the migration backfill).
4. **Bounded quantity label** uses the unit-of-measure code ("of 120 nr"): `FacilityUnit.quantityUnit` holds a code from the fixed UoM list, not a noun such as "desks". Mixed units render as a list, are not checked against the plan, and give a `MIXED_QUANTITY_UNITS` warning.
5. **Completed units stand-in** (D-R3.23): a unit counts as complete only when it has lines and all are at 100% (the R2 badge treats a unit without lines as complete).
6. **Carry-over on seeded data.** PRG-105's classroom unit spans sprints 1–3, so PRG-105 has no earlier-sprint unit to carry over. The carry-over route test and the demo use LKK-402 (sprint 1 units incomplete, now in sprint 2). PRG-105 is used for every-kind previews, the customised Toilet and the snapshot tests.
7. **Freezing builds under the lock.** `freezeVisitFormSnapshot(tx, opts)` takes the form-library advisory lock and assembles the form itself before storing it, so no component it read can be edited in place before the snapshot marks it used. R4 passes build options, not a pre-built snapshot.
8. **Re-checks** are generic `YES_NO` fields (rules: YES → photo, NO → comment) with the `RecheckInput` on `field.recheck`, so validation needs no special case.
9. **Photo fields:** the stored `required` flag is ignored; the snapshot's `required` comes from the photo mode. More photos than allowed is an error (`TOO_MANY_CAPTURES`), as is a per-unit photo naming a unit outside the field (`UNKNOWN_UNIT`).
10. **Assembly errors** are thrown as `VisitFormAssemblyError` (`FORM_TOO_LARGE`, `TEMPLATE_KIND_MISMATCH`, `INVALID_VISIT_DATE`, `NO_VISIT_FORM_TEMPLATE`) and become 422 on the server. Warnings: `NO_SPRINT_FOR_DATE`, `NO_FACILITIES_IN_SCOPE`, `SUBFORM_MISSING`, `SUBFORM_EMPTY_FOR_KIND`, `SECTION_MISSING`, `MIXED_QUANTITY_UNITS`.
11. **Library rules added:** a template's visit kind is locked across versions (`TEMPLATE_KIND_LOCKED`); restoring a template whose sections are archived is refused; a customised facility sub-form's `FIELD_KEY_TYPE_CHANGED` check includes its archetype default's keys (answers are compared by path across visits). The type editor checks only `visitForms` codes that changed, so archiving a type never fails on a template archived since.
12. **For R4:** `buildVisitFormLibraryBundle` loads the latest versions only; re-assembling a phone-built Ad hoc snapshot from the named component versions (D-R3.24) needs a pinned-versions variant. `deleteSnapshotIfUnused` deletes unconditionally in R3; R4 adds its `Visit.formSnapshotId` check.
13. **Web:** "Forms & facilities" uses sub-navigation (Facilities, Facility sub-forms, Fixed sections, Visit form templates, Preview). Editors register `useLeaveGuard` while dirty and confirm before closing. The type editor's Visit forms picker offers "Default" (template whose code is the kind). `FormSnapshotView` is exported for R4's visit pages.
