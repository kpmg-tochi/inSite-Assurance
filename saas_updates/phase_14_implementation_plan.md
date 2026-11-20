# Phase 14: Monitoring Streams, Site Inspection Checklists and Supervision Workload

| | |
| :--- | :--- |
| **Status** | Implemented; migration and route test run pending (web click-through and device run pending) |
| **Depends on** | Phase 11 (project types), Phase 8 (cadence, obligations, jobs), Phase 4 (captures, outbox) |
| **Unblocks** | Phase 15 (final evaluation is an inspection), Phase 16 (visit and baseline KPIs) |
| **Read first** | [Master plan](saas_implementation_plan.md) sections 2, 3 and 6; [gap analysis](process_flow_gap_analysis.md) G4, G5, G9 |

---

## 1. Overview

**Objective:** match how monitoring actually happens in the process flow.

1. **Reporting streams:** more than one reporting obligation per project, each with its own cadence and owners. Resident Supervisors report weekly per BOQ item (today's behaviour); the M&E department owes one inspection per quarter; contractors report progress continuously.
2. **Site inspection reports:** a project-level visit report built from a configurable checklist (progress against the work programme, workmanship, material standards, health and safety, valuation of works done, environmental safeguards), with photos per checklist item. Visit types: baseline survey, routine visit, mobilisation check, final evaluation.
3. **Supervision workload:** a supervisor should cover at most 7–10 sites in close proximity; show it and warn.

**Out of scope:** custom outcome indicators (enrolment, classrooms delivered; gap G14, needs a client definition), scoring models across inspections beyond simple counts.

---

## 2. Context for the implementing agent

- Cadence lives on `Project` (`reportingCadence`, `workWeekDays`, `customIntervalDays`, …), period maths in `shared/src/utils/reportingPeriod.ts`, server mapping in `cadence.service.ts` (`cadenceSettingsForDate`, `periodKeyForDate`, `fulfilObligation`, `reporterScopeFor`).
- `ReportingObligation` is per BOQ item, reporter scope (`verifier` or `contractor:<id>`) and period. `INSPECTION_ONLY` has no periods, so infrequent visits are never flagged.
- Jobs `brief-dispatch` and `overdue-reports` (`cadenceJobs.ts`) iterate projects and periods; mobile computes the period from the baseline pack `cadence` (`mobile/src/utils/projectCadence.ts`).
- Reports: `WorkdayReport` per WBS item; captures register as `FieldEvidenceLog`; mobile outbox kinds with dependencies on captures (`storage/outbox`). Report approval chain (Phase 7) applies to workday reports.
- Field identity: join-code sessions with persona and role; provisioned accounts (Phase 5) see all assigned projects.

---

## 3. Decisions

| Topic | Decision |
| :--- | :--- |
| Streams | `ProjectReportingStream` rows. A project with none behaves exactly as today (one implicit stream from the project cadence). Applying a project type creates its streams. |
| Stream kinds | `ITEM_REPORTS` (per BOQ item per period, today's obligations) or `INSPECTION` (one site inspection report of a given visit type per period). |
| Who owes a stream | A list of role IDs, optionally limited to a contractor package. A user or session owes a stream when its role is in the list. Contractor streams keep the per-contractor scope. |
| Quarterly | Add `QUARTERLY` to `ReportingCadence` with real calendar quarters (anchor month configurable, default January). Not approximated by 91-day custom intervals. |
| Upload deadline | `INSPECTION` streams have `submissionDeadlineDays` after the visit date (process: 7). Late = submitted after it; the obligation for the period is still met. |
| Checklist templates | Tenant-level, versioned; an inspection stores the template version it used. Response types: `RATING_1_5`, `PASS_FAIL_NA`, `YES_NO`, `NUMBER`, `TEXT`, `PHOTO_ONLY`. Per item: required, photo required, photo required on fail. |
| Approval | Inspections use the project's report approval chain when `requireReportApproval` is on (new subject type). |
| Findings | Failed or low-rated items can raise an `InspectionFinding` aimed at a contractor (Phase 10 aimed-notification pattern), closed with evidence. Not merged with defects (defects are post-completion). |
| Workload | Warn, never block. Thresholds on the project type (`maxSitesPerSupervisor`, `maxSpreadKm`); a "supervisor" is any user or session whose role is in the type's supervisor role list. |

---

## 4. Schema changes

- `ReportingCadence` + `QUARTERLY`; `Project.cadenceQuarterAnchorMonth Int @default(1)` (and on streams).
- New `ProjectReportingStream (id, projectId, key, label, kind, roleIds String[], projectContractorId?, reportingCadence, workWeekDays Int[], periodStartDayOfWeek, customIntervalDays?, quarterAnchorMonth?, reportDueTime?, reportGraceMinutes, cadenceAnchorDate?, visitType?, submissionDeadlineDays?, isActive, sortOrder)`, unique `(projectId, key)`.
- `ReportingObligation`: `streamId String?` (null = implicit stream), `boqItemId` nullable for `INSPECTION` obligations; update the unique key accordingly (hand-written partial unique index if Prisma cannot express it; record it in CLAUDE.md like the existing ones).
- New `InspectionChecklistTemplate (id, tenantId, code, name, visitTypes InspectionVisitType[], version, sectionsJson, isArchived, createdAt)`, unique `(tenantId, code, version)`.
- New `SiteInspectionReport (id, projectId, streamId?, visitType BASELINE|ROUTINE|MOBILISATION_CHECK|FINAL_EVALUATION, templateId, templateVersion, visitDate, reporter fields (same pattern as WorkdayReport: fieldSessionId?/userId?, persona, role), answersJson, overallFinding SATISFACTORY|MINOR_ISSUES|MAJOR_ISSUES, summaryText, submissionGeotagJson, geofenceStatus, clientReportId (idempotency), status SUBMITTED|APPROVED|RETURNED, isLate, approval fields as WorkdayReport, createdAt)`.
- Capture link: `FieldEvidenceLog.siteInspectionReportId` + `checklistItemKey`.
- New `InspectionFinding (id, projectId, inspectionId, checklistItemKey, projectContractorId?, description, severity, status OPEN|RESOLVED|DISMISSED, resolvedNotes?, resolutionCaptureIds[], raisedByUserId?, resolvedByUserId?, createdAt, resolvedAt?)`.
- `ApprovalSubjectType` + `SITE_INSPECTION`.
- `ProjectTypeConfigSchema.reportingStreams[]`, `.inspections = { templateCodeByVisitType }`, `.supervision = { supervisorRoleCodes[], maxSitesPerSupervisor, maxSpreadKm }`.
- Permissions: `inspections:submit` (field and web), `inspections:view`, `inspections:manage_templates`, `inspections:manage_findings`.
- Mobile notification type `INSPECTION_FINDING`; outbox kind `SITE_INSPECTION`.
- Audit actions: `INSPECTION_SUBMITTED`, `INSPECTION_REVIEWED`, `INSPECTION_FINDING_RAISED`, `INSPECTION_FINDING_RESOLVED`, `REPORTING_STREAMS_SAVED`, `CHECKLIST_TEMPLATE_SAVED`.

---

## 5. Implementation checklist

Verification state: the database was not migrated during this phase (Phases 12 and 14 ran side by side; the coordinator generates both migrations at the end), so **no route test of this phase has run yet**. Items marked "route test written, pending migration" are covered by `server/src/tests/routes.phase14.test.ts`. Web and mobile UI: typecheck, lint and build only; click-through and device runs pending.

### Step 1: Quarterly cadence and streams (shared and server)
- [x] `reportingPeriod.ts`: `QUARTERLY` periods (table tests across year end, anchor months, work-weeks). `server/src/tests/inspections.phase14.test.ts` (8 table cases, a tiling check over a year for five anchors, next period, wording).
- [ ] `cadenceSettingsForDate` and `periodKeyForDate` take a stream (fall back to project fields); pending cadence change (`pendingCadenceJson`) applies per stream. Built as `streamCadenceRow` (a stream as a project-shaped cadence row, its own pending change mapped in) in `modules/cadence/streams.service.ts`. Route test written, pending migration.
- [ ] Obligation generation iterates streams: `ITEM_REPORTS` as today scoped to the stream's roles; `INSPECTION` creates one obligation per period. Route test written, pending migration.
- [ ] `fulfilObligation` matches the report's stream by the reporter's role (and contractor scope). Route test written, pending migration.
- [ ] `brief-dispatch` and `overdue-reports` iterate streams; briefs only for `ITEM_REPORTS` streams. Route test written, pending migration.
- [ ] Reporting step: streams editor (add, edit, remove while draft; live edits apply from the next period, same rule as cadence changes). Implicit stream shown as "Default". Server route-test written (pending migration); web built (`components/inspections/ReportingStreamsEditor.tsx`), click-through pending.
- [ ] Phase 8 tests still pass unchanged for projects without streams. Not run (needs the migrated test DB); only a type-level fix in `routes.phase9.test.ts` (`boqItemId!`, the column is now nullable).

### Step 2: Checklist templates
- [x] Shared `ChecklistSectionsSchema` and `validateInspectionAnswers(template, answers)` (pure; used by server, web and mobile). Unit-tested in server and mobile.
- [ ] Tenant settings: template list and editor (sections, items, response types, rules); saving a used template creates a new version. Server route-tested (pending migration: version 2 after use); web Settings → "Inspections & supervisors" built, click-through pending.
- [ ] Seed four templates (in both tenants): Baseline survey, Routine monitoring visit (six areas), Mobilisation check, Final evaluation (`seedPhase14.ts`). Written; seed not run (needs the migration).

### Step 3: Site inspection reports (server)
- [ ] `POST /projects/:id/inspections`: idempotent, answers validated against the stored version, captures linked per item (other projects refused), geofence, late flag, obligation, approval chain. Route test written, pending migration.
- [ ] Review endpoints mirror workday report review (approve / return with notes). Route test written, pending migration.
- [ ] Findings: raise from an inspection item, aimed notifications, resolve with captures, dismiss with reason. Route test written, pending migration.
- [ ] Lists with filters (visit type, finding, stream, late); detail DTO with template, answers, captures and findings. Route test written, pending migration.
- [ ] The omission check gains an inspection mode (missing required photos; engine `RULES`, off the request path, swept). Route test written, pending migration.

### Step 4: Mobile
- [ ] Baseline pack carries streams the user owes and the templates their visit types use (`inspections` on the pack, also `GET /projects/:id/inspections/field-pack`). Route test written, pending migration.
- [ ] Period card per owed stream (reuse `PeriodCheckInCard`). Card choice unit-tested (`streamPeriodCards`); device run pending.
- [ ] "Inspection" flow (`screens/InspectionScreen.tsx`): visit type → one screen per section → photos per item → summary and overall finding → confirm. Draft in SQLite (migration 6, `inspection_drafts`). Queued as `SITE_INSPECTION` behind its captures. Draft rules and outbox ordering unit-tested; device run pending.
- [ ] Contractor sees and resolves findings aimed at it, with photos (`screens/InspectionFindingsScreen.tsx`, outbox kind `FINDING_RESOLUTION`). Device run pending.
- [ ] Wording in `personaCopy.ts` (`inspectionEntry`, `findingsEntry`, `findingsSubtitle`; quarterly span). Built; device run pending.

### Step 5: Web
- [ ] Project "Inspections" tab: list with filters, detail with answers and photos per item, review actions, findings board (`pages/inspections/ProjectInspectionsPage.tsx`). Built; click-through pending.
- [ ] Project overview: last inspection per visit type, next due inspection, open findings, missed visits (`InspectionOverviewCard` on the project dashboard). Built; click-through pending.
- [ ] Baseline completeness indicator (accepted `BASELINE` inspection). Built; click-through pending.

### Step 6: Supervision workload
- [ ] Team step: workload of the supervisors on the team with this project counted, warning above the type's thresholds (`TeamWorkloadNotice`, `GET /projects/:id/supervision/workload`). Maths unit-tested; route and click-through pending.
- [ ] Tenant "Supervisors" view (Settings → "Inspections & supervisors"; `GET /api/v1/supervision`). Route test written (seeded supervisor over the limit), pending migration; click-through pending.

### Step 7: Seed and tests
- [ ] Seed both types with streams ("Resident supervision", "M&E visit" quarterly with a 7-day deadline, "Contractor progress"); PRG-211 with an approved baseline survey, a late routine visit and a routine visit with a major finding; PRG-221 with a missed quarterly visit; M&E officer `me.officer@insite.ng` over the Co-Funded limit. Written; not run (needs the migration).
- [ ] Route tests (`routes.phase14.test.ts`, 17 tests): quarterly obligations per stream; missed quarterly visit; idempotency; answers against the version; captures from another project refused; findings aimed at the right contractor; approval chain on inspections; project without streams unchanged; live stream change pending; mobile pack; omission check; supervisor over the limit. Written and typechecked; pending migration.
- [x] Mobile unit tests: answers validation, outbox ordering behind captures (`mobile/src/utils/inspections.test.ts`, 6 tests).

Run at the end of the phase (shared schema built, Prisma client generated, no migration): `npm run typecheck` clean; `npm run lint` 0 errors (75 warnings, none in Phase 14 files); server unit tests 213 pass (includes 25 Phase 14); mobile 76 pass; web build OK.

---

## 6. Definition of done

- One project runs weekly supervision and quarterly M&E visits side by side, and a missed quarterly visit is flagged. **Built; route-tested only once migrated.**
- An M&E officer completes a checklist inspection offline with photos per item; failed items reach the contractor as findings. **Built; device run pending.**
- Supervisors over their site limit are visible before they are assigned. **Built (team step and Supervisors view); click-through pending.**
- Master plan status updated; CLAUDE.md gains a "Streams and inspections (Phase 14)" paragraph; mobile on-device run listed in `physical_testing_checklist.md` (section 3.7). **Done.**

## 7. Found during implementation

### 7.1 Migration requirements (for the coordinator)

Generate with `prisma migrate diff` after Phase 12's migration, then **append the hand-written SQL below**. The schema change set:

- Enums: `ReportingCadence` + `QUARTERLY`; `ApprovalSubjectType` + `SITE_INSPECTION`; `AuditActionType` + `INSPECTION_SUBMITTED`, `INSPECTION_REVIEWED`, `INSPECTION_FINDING_RAISED`, `INSPECTION_FINDING_RESOLVED`, `REPORTING_STREAMS_SAVED`, `CHECKLIST_TEMPLATE_SAVED`; `MobileNotificationType` + `INSPECTION_FINDING`; `NotificationActionType` + `OPEN_INSPECTION_FINDINGS`. New enums `ReportingStreamKind`, `InspectionVisitType`, `InspectionOverallFinding`, `SiteInspectionStatus` (`SUBMITTED`, `PENDING_APPROVAL`, `APPROVED`, `RETURNED`), `InspectionFindingSeverity`, `InspectionFindingStatus`. (Postgres: `ALTER TYPE ... ADD VALUE` cannot be used in the same transaction as the new value; Prisma's generated migration handles this.)
- `Project.cadenceQuarterAnchorMonth INTEGER NOT NULL DEFAULT 1`.
- `FieldEvidenceLog.siteInspectionReportId UUID NULL` (FK → `site_inspection_reports.id`, `ON DELETE SET NULL`), `checklistItemKey TEXT NULL`, index on `siteInspectionReportId`.
- `reporting_obligations`: `boqItemId` becomes nullable; new `streamId UUID NULL` (FK → `project_reporting_streams.id`, `ON DELETE CASCADE`) and `siteInspectionReportId UUID NULL` (FK → `site_inspection_reports.id`, `ON DELETE SET NULL`); the Prisma unique `reporting_obligations_projectId_boqItemId_reporterScope_periodStart_key` is **dropped** and replaced by plain indexes `(projectId, boqItemId, reporterScope, periodStart)` and `(streamId, periodStart)`.
- New tables `project_reporting_streams` (unique `(projectId, key)`), `inspection_checklist_templates` (unique `(tenantId, code, version)`), `site_inspection_reports` (unique `clientReportId`; FK to template `ON DELETE RESTRICT`, to stream `ON DELETE SET NULL`), `inspection_findings` (FK to inspection `ON DELETE CASCADE`, to project contractor `ON DELETE SET NULL`).

Hand-written SQL (the schema cannot express it; keep it in every regenerated migration):

```sql
-- Phase 14: one item obligation per item, reporter scope, period and stream (the implicit stream is
-- NULL, so COALESCE makes it a real value); one inspection obligation per stream, scope and period.
-- createMany({ skipDuplicates }) relies on these (INSERT ... ON CONFLICT DO NOTHING).
CREATE UNIQUE INDEX "reporting_obligations_item_period_key"
  ON "reporting_obligations" ("projectId", "boqItemId", "reporterScope", "periodStart",
    COALESCE("streamId", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "boqItemId" IS NOT NULL;

CREATE UNIQUE INDEX "reporting_obligations_inspection_period_key"
  ON "reporting_obligations" ("streamId", "reporterScope", "periodStart")
  WHERE "boqItemId" IS NULL;

-- An obligation is either per BOQ item or belongs to a stream (inspection obligations always do).
ALTER TABLE "reporting_obligations"
  ADD CONSTRAINT "reporting_obligations_item_or_stream_check"
  CHECK ("boqItemId" IS NOT NULL OR "streamId" IS NOT NULL);
```

No code calls the dropped compound unique (`projectId_boqItemId_reporterScope_periodStart`); checked with grep.

### 7.2 Decisions and deviations

1. **Field naming.** The project column is `cadenceQuarterAnchorMonth` (as planned) and the same name is used in `CadenceSettings`, the cadence DTO and the Reporting step body, so one name flows through. Streams store `quarterAnchorMonth`; `streamCadenceRow` maps it.
2. **Stream pending change.** `ProjectReportingStream` gained `pendingCadenceJson` / `pendingCadenceEffectiveFrom` (not in the plan's column list) so "live edits apply from the next period" works per stream. Due time and grace apply at once, as for projects. A stream removed on a live project is deactivated, never deleted; its kind cannot change once live (409 `STREAM_KIND_LOCKED`).
3. **Streams replace the implicit stream.** A project with at least one active stream owes only its streams. An item report takes its period from the reporter's `ITEM_REPORTS` stream (role and package); a reporter whose role owes no stream is still accepted, keyed on the project cadence, and fulfils nothing. Brief lists per persona use that persona's first `ITEM_REPORTS` stream; briefs stay unique per (item, period start, persona), so two item streams with the same persona and period share briefs.
4. **Inspection obligations.** Scope `inspection`, `boqItemId` null, `streamId` set, and `siteInspectionReportId` (new column) records the inspection that met it. `lateAfter` = due time + grace + the stream's `submissionDeadlineDays`, so a visit late in a quarter still has its upload window. A MISSED obligation met later becomes LATE. The visit counts towards the stream of its visit type owed by the reporter's role (else the first stream of that visit type).
5. **Findings.** Every failed item raises a finding at submission, aimed at the project's only contractor or its main contractor (monitoring side when neither); monitors can raise more from a failed item and aim them at any package. A field inspector cannot choose the contractor. Findings must come from failed items (422 `FINDING_ITEM_NOT_FAILED`). Sides are by organisation, reusing `defectViewerFor`.
6. **Second outbox kind.** Finding resolutions from the phone are queued as `FINDING_RESOLUTION` behind their photos (the plan listed only `SITE_INSPECTION`), the same pattern as `DEFECT_ACTION`.
7. **Photos.** The server never refuses an inspection for a missing photo; the omission check (inspection mode, engine `RULES`, deterministic) flags it and notifies `inspections:view`. The phone requires every needed photo before confirming. Web submissions cannot attach photos (400 `CAPTURES_NEED_FIELD_APP`); the API accepts web submissions but no web submission form was built.
8. **Extra validation rule.** A failed item needs a comment of at least 3 characters (shared validator), so every finding has a description.
9. **Statuses.** `PENDING_APPROVAL` was added to the planned `SUBMITTED | APPROVED | RETURNED`. A returned inspection is not revised: the inspector submits a new one (new `clientReportId`); the returned one keeps the obligation it met.
10. **Identity.** A field session whose identity is not approved (with identity assurance on) gets 403 `IDENTITY_NOT_APPROVED`; inspections are not staged like workday reports.
11. **No device signature** on inspections (no canonical string was defined for them). Follow-up if inspections must be signed like reports.
12. **Supervision.** Counts user accounts (assigned live projects), not join-code sessions. In the team step only listed users holding the project type's supervisor roles are shown, with this project counted and its type's thresholds; the tenant view uses the strictest thresholds of the person's projects.
13. **Project type editor.** `ProjectTypesTab` has no fields yet for `reportingStreams`, `inspections` or `supervision`; it keeps them on save (`...rest`). They are set through the API and the seed for now.
14. **Seed.** The programme types' Phase 14 config is written straight into `configJson` and the projects' snapshots **without a version bump**, because Phase 11 route tests assert version 1; this is seed-only. The Co-Funded site limit is 2 so the M&E officer (three live sites, ~830 km apart) is over it. Templates are seeded in both tenants (tenant-chain audit entries `CHECKLIST_TEMPLATE_SAVED`); earlier route tests that count tenant audit entries, templates or programme users may need updating once the suite runs.
15. **Baseline pack.** `inspections` is added on `GET /auth/mobile/projects/:id/baseline` (in `auth.routes.ts`, because `auth.service.ts` was being changed by Phase 12) and on `GET /projects/:id/inspections/field-pack`. The pack returned by join does not carry it until the first baseline refresh.
16. **Draft routes.** `DRAFT_ROUTE_RE` now also allows `reporting-streams` and `supervision` (the streams editor and team-step workload on drafts).
17. **Mobile storage.** SQLite migration 6 adds `inspection_drafts` (draft JSON and the confirmed request; never file paths). It is in `DATA_TABLES`.
