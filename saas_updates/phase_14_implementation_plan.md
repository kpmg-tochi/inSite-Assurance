# Phase 14: Monitoring Streams, Site Inspection Checklists and Supervision Workload

| | |
| :--- | :--- |
| **Status** | Not started |
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

### Step 1: Quarterly cadence and streams (shared and server)
- [ ] `reportingPeriod.ts`: `QUARTERLY` periods (table tests across year end, anchor months, work-weeks).
- [ ] `cadenceSettingsForDate` and `periodKeyForDate` take a stream (fall back to project fields); pending cadence change (`pendingCadenceJson`) applies per stream.
- [ ] Obligation generation iterates streams: `ITEM_REPORTS` as today scoped to the stream's roles; `INSPECTION` creates one obligation per period.
- [ ] `fulfilObligation` matches the report's stream by the reporter's role (and contractor scope).
- [ ] `brief-dispatch` and `overdue-reports` iterate streams; briefs only for `ITEM_REPORTS` streams.
- [ ] Reporting step: streams editor (add, edit, remove while draft; live edits apply from the next period, same rule as cadence changes). Implicit stream shown as "Default".
- [ ] Phase 8 tests still pass unchanged for projects without streams.

### Step 2: Checklist templates
- [ ] Shared `ChecklistSectionsSchema` and `validateInspectionAnswers(template, answers)` (pure; used by server, web and mobile).
- [ ] Tenant settings: template list and editor (sections, items, response types, rules); saving a used template creates a new version.
- [ ] Seed four templates: Baseline survey (site conditions, existing facilities, access, utilities, contractor readiness), Routine monitoring visit (the six process-flow areas, each with sub-items), Mobilisation check (personnel, equipment, materials, site set-up, signage, letter of introduction presented), Final evaluation (deliverables against specification, quality, WASH and solar components functional, snags).

### Step 3: Site inspection reports (server)
- [ ] `POST /projects/:id/inspections` (field sessions and web users with `inspections:submit`): idempotent on `clientReportId`, answers validated against the stored template version, captures linked per item (the Phase 4 registration path; refuse captures from other projects), geotag and geofence evaluated, late flag, obligation fulfilled, approval chain started when on.
- [ ] Review endpoints mirror workday report review (approve / return with notes).
- [ ] Findings: raise from an inspection item, aimed notifications to the contractor's users and sessions, resolve with captures, dismiss with reason.
- [ ] Lists with filters (visit type, finding, stream, late); detail DTO with template, answers, captures and findings.
- [ ] The AI omission check (`aiOmissionCheck.ts`) gains an inspection mode: flag required photo items without photos. Off the request path, rules fallback, engine recorded.

### Step 4: Mobile
- [ ] Baseline pack carries streams the user owes and the templates their visit types use.
- [ ] Period card per owed stream (reuse `PeriodCheckInCard`).
- [ ] "Inspection" flow: choose visit type → checklist sections (one screen per section) → photos per item through the live camera → summary and overall finding → confirm. Draft survives app restarts (SQLite). Queued as `SITE_INSPECTION` behind its captures.
- [ ] Contractor sees and resolves findings aimed at it (with photos).
- [ ] Wording in `personaCopy.ts`.

### Step 5: Web
- [ ] Project "Inspections" tab: list, detail with answers and photos per item, review actions, findings board.
- [ ] Project overview: last inspection per visit type, next due inspection, open findings.
- [ ] Baseline completeness indicator (has an approved `BASELINE` inspection).

### Step 6: Supervision workload
- [ ] Team step and assignment screens: when adding a supervisor role user, show their active project count and the furthest distance between project geofence centroids; warn above the type's thresholds.
- [ ] Tenant "Supervisors" view: per supervisor, projects, distance spread, last inspection per project.

### Step 7: Seed and tests
- [ ] Seed both types with streams: "Resident supervision" (weekly, `ITEM_REPORTS`, Resident Supervisor role), "M&E visit" (quarterly, `INSPECTION`, routine template, 7-day deadline), "Contractor progress" (weekly, contractor role). Seed projects with a baseline survey, two routine inspections (one late, one with a major finding), and one supervisor over the threshold.
- [ ] Route tests: quarterly maths; obligations per stream; a missed quarterly visit becomes `MISSED`; inspection idempotency; answers validation against the version; captures from another project refused; findings aimed at the right contractor; approval chain on inspections; project without streams unchanged.
- [ ] Mobile unit tests: answers validation, outbox ordering behind captures.

---

## 6. Definition of done

- One project runs weekly supervision and quarterly M&E visits side by side, and a missed quarterly visit is flagged.
- An M&E officer completes a checklist inspection offline with photos per item; failed items reach the contractor as findings.
- Supervisors over their site limit are visible before they are assigned.
- Master plan status updated; CLAUDE.md gains a "Streams and inspections (Phase 14)" paragraph; mobile on-device run listed in `physical_testing_checklist.md`.

## 7. Found during implementation

*(empty)*
