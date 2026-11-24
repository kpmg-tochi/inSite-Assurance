# Redesign R3–R7: Cross-plan Contract Register

**Status:** Agreed baseline for the R3–R7 plans (2026-11-24). Written after the five plans were drafted in parallel, to settle the names and ownership they disagreed on.
**Rule:** where a plan's wording differs from this register, **this register wins**. Each plan's "Found during implementation" section records any later change here first.

Plans: [R3 form builder](redesign_r3_implementation_plan.md) · [R4 visits](redesign_r4_implementation_plan.md) · [R5 mobile](redesign_r5_implementation_plan.md) · [R6 web](redesign_r6_implementation_plan.md) · [R7 roles, seed, docs](redesign_r7_implementation_plan.md).

---

## 1. Shared contracts (R3 owns; R4 and R5 consume)

| Topic | Canonical | Replaces (in plan) |
| :--- | :--- | :--- |
| Visit kinds | `VisitKindEnum` + `VISIT_KIND_META` (`MOBILISATION_CHECK`, `BASELINE`, `ROUTINE`, `QUARTERLY_ME`, `FINAL_EVALUATION`, `POST_CLOSURE_EVALUATION`, `AD_HOC`), `shared/src/schemas/form.schema.ts`. DTO field name: `visitKind`. | R4 `VisitTypeEnum` / `visitType`; R5 `visitType` |
| Snapshot | `VisitFormSnapshotSchema` (`schemaVersion` 1), stored by R3 in `VisitFormSnapshot`; R4 adds `Visit.formSnapshotId`. | – |
| Answers | `VisitFormAnswersSchema` / `VisitFormAnswerSchema`, keyed by R3 answer paths `s:<SECTION>/<key>`, `f:<FACILITY>/<key>[@unitId]`, `r:<recheckId>`. | R4/R5 `VisitAnswersSchema`; R5's section/question/unit keying |
| Validation | `validateVisitAnswers(snapshot, answers, captureFacts?)` → `{ valid, errors, photoGaps, findingsToRaise, signals, recheckResults }`. Photo gaps are not server errors; the phone blocks on them. | R4's `{ errors, findings, expectedPhotoSlots, missingPhotos }` shape |
| Form identity | `formSnapshotId` + `formHash` (SHA-256 of `canonicalVisitFormSnapshot`, server helper `hashVisitFormSnapshot`). Stale form: **409 `FORM_SNAPSHOT_STALE`**. | R4 `formVersion` / `FORM_VERSION_STALE` |
| Re-check items | **Inside the snapshot** (R3 `RecheckInputSchema`, items `r:<recheckId>`). R4 supplies the open findings/defects when freezing and **re-freezes an unstarted visit** when the open set changes (spec 6.3 "rebuild form"). Results come back in `recheckResults`. | R4 `Visit.recheckJson` (drop it) |
| Answer semantics | R3 **signals** (`FormFieldSignalSchema`), extended in R3a to the kinds R4 needs: `UNIT_COMPLETE`, `CONTRACTOR_ON_SITE`, `PERCENT_COMPLETE`, `QUANTITY_DELIVERED`, `OVERALL_FINDING`. `validateVisitAnswers` returns them in `signals`. | R4 "question tags" (`metric`) |
| Placeholders | `renderPlaceholders` and `facilityNoun` (rendered into the snapshot at build time; the phone does not re-render). | R5 `renderQuestionText` |
| Finding severity | `FormFindingSeverityEnum` = `MINOR`, `MAJOR`, `CRITICAL` (same values as `InspectionFindingSeverity`). | – |
| Offline Ad hoc | `VisitFormLibraryBundleSchema` (`buildVisitFormLibraryBundle`); the phone runs `assembleVisitForm`; R4 re-assembles and compares `formHash` before accepting a phone-built snapshot. | R5 "ad hoc form in the baseline pack" |

## 2. API (R4 owns; R5 consumes)

| Purpose | Canonical endpoint | Replaces (R5 draft) |
| :--- | :--- | :--- |
| Visit feed, all projects | `GET /api/v1/visits/mine?from&to` → `MyVisitsFeedDto` (default 7 days back, 14 ahead, plus overdue, returned and pending) | `GET /auth/mobile/visits` |
| Frozen form | `GET /projects/:id/visits/:visitId/form` → `VisitFormDto` (snapshot, `formSnapshotId`, `formHash`, sprint deliverables, units, geofence; 304 when unchanged) | – |
| Offline Ad hoc pack | `GET /projects/:id/visits/field-pack` → `VisitFieldPackDto` (= `VisitFormLibraryBundle` + project scope + open re-check items) | baseline pack v2 carrying the ad hoc form |
| Officer response | `POST /projects/:id/visits/:visitId/respond` `{ clientActionId, action: CONFIRM \| MOVE \| PROPOSE \| DECLINE, date?, comment }`; errors 409 `VISIT_CHANGED`, 422 `MOVE_OUTSIDE_WINDOW` | `.../responses` with `clientResponseId` |
| Check-in | `POST .../check-in` `{ clientCheckInId, ... }`; outside the boundary is flagged, not refused | – |
| Submission | `POST .../submissions` `{ clientSubmissionId, formSnapshotId, formHash, answers, captures by clientCaptureId with answer path, siteLogEntryIds, checkInId?, confirmedAt }`; 201 / 200 replay; 409 `CAPTURES_NOT_REGISTERED` (retry); 409 `FORM_SNAPSHOT_STALE`; 409 `VISIT_ALREADY_SUBMITTED` | – |
| Unscheduled visit | `POST /projects/:id/visits/unscheduled` `{ clientVisitId, visitKind: AD_HOC, plannedDate, pickedFacilityIds, formHash, component versions }` | `selectedFacilityIds` |
| Site log | `POST /projects/:id/site-log` (`clientEntryId`), `GET /projects/:id/site-log?mine=true&since=` | – |
| Findings | `GET /projects/:id/findings?status=OPEN`; `/inspection-findings` stays as an alias until R5e | – |
| Notifications | `VISIT_ASSIGNED`, `VISIT_CHANGED`, `VISIT_REMINDER`, `VISIT_RETURNED` (+ approved), action `OPEN_VISIT` | – |

Visit statuses are R4's (spec six plus `PROPOSED` and `RETURNED`); R5 builds the returned-for-correction flow (D-R5.20's condition is met).

## 3. Ownership decisions

| Item | Owner | Note |
| :--- | :--- | :--- |
| Site log server model and API | **R4** (R4c) | R5 agreed (D-R5.22) |
| Whisper transcription when a voice capture is registered (no workday report needed) | **R4** (R4c) | R5 draft claimed it "unless R4"; R4 takes it so R5 is mobile-only |
| Baseline pack changes for multi-project home (every assigned project, permissions in the session) | **R5** (D-R5.3) | Forms come from the R4 field pack, not the baseline pack |
| Phase 14 checklist template authoring | **R3e** retires it | `forms:manage` added |
| Phase 14 inspections runtime (server/web) | **R4** replaces | Closure checklist, CoC gate, KPI facts, closure pack switch to visits |
| Endpoints the current app calls (workday reports, WBS chat, inspection field pack, finding resolve, mobile `/boq`, cadence columns) | Deleted in **R5f** (a sequential slice after R5e and R6; owner decision 2026-11-24, R5 plan 10.2), after the app no longer calls them | R4 D-R4.37 and R5 D-R5.24 agree |
| Findings table | **R4** extends `InspectionFinding`; **R7** renames the model `Finding` | |
| "Forms & facilities" | **R3d** builds it as a Settings tab; **R6b** moves it to the tenant nav entry `/app/forms` | Settings → Facilities folds into it |
| Permission catalogue sync at start-up | **R7a** (`syncPermissionCatalog`) | Until then, **every slice that adds a permission ships an idempotent backfill migration** (insert the permission, grant it to the default roles that hold it), as `20261208090001_r2_facilities_permission_backfill` does. Otherwise a migrated, not reseeded database lacks the key. |
| Permission keys | R3: `forms:manage`. R4: `visits:view`, `visits:plan`, `visits:submit`, `sprints:verify`, `findings:receive_escalations`. R7 renames the legacy keys (`boq:*` → `scope:*`, `schedule:view_variance` → `sprints:view_status`, …) per R7 section 5.3. | |

## 4. Migration timestamp ranges

| Plan | Range |
| :--- | :--- |
| R3 | `202612100900xx` |
| R4 | `202612150900xx` |
| R6 | `202612200900xx` |
| R5f (old-app server clean-up, after R6) | `202612220900xx` |
| R7 | `202612250900xx` |

R5 adds no server migration of its own (phone SQLite versions v9, v10 only).

## 5. Order and parallel work

R3 → R4 → R5. R6a (5-step setup), R6d (payments) and R6e (type editor) can run alongside R3/R4; R6b (navigation) and R6c (Overview) wait for R4 (R6 D-R6.1). R7 runs last.
