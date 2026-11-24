# Redesign R4: Visits

**Spec:** [client_flow_redesign.md](client_flow_redesign.md) sections 3, 4, 5, 6.3–6.5, 8, 9, 11, 12 (decisions S, P3, P5, X), 13 (Q-H) and 14 (R4).
**Branch:** `UBEC` (client-specific; decision P).
**Depends on:** R2 (done: sprints, facility units, scope lines) and R3 (form library, visit types, frozen form snapshots, answer validation, findings rules). Mobile UI is R5; R4 only defines and serves the API R5 consumes.
**Baseline before R4:** measure at the start of R4a, after R3 is merged (R3 changes the counts). Last recorded (end of R2d): typecheck clean, lint 0 errors (67 warnings), server 148 unit + 249 route, mobile 57, all passing. Record the real numbers in section 10 before writing code.
**Status: Plan. Not started.**
**Cross-plan contracts:** [redesign_contracts_r3_r7.md](redesign_contracts_r3_r7.md) settles the names and ownership shared by R3–R7. Where this plan differs, the register wins.

Each slice must leave typecheck, lint (0 errors), the web build, and the server and mobile suites green before the next one starts.

---

## 1. Goal

Replace cadence obligations, reporting streams and checklist inspections with **scheduled visits**:

```
Project type default visit plan ──activation──▶ PROPOSED visits ──manager publishes──▶ PLANNED (form frozen)
                                                       ▲                                    │
 Planner (web, M&E Manager): create, generate, move,   │      officer: confirm / move (±tolerance,
 reassign, cancel, accept/reject proposals ────────────┘      same sprint) / propose date / decline
                                                                                            │
 Field app (R5): check in (geofence) → form (frozen snapshot + findings to re-check) → submit (offline, idempotent)
                                                                                            ▼
 SUBMITTED ──REPORT approval chain──▶ APPROVED ──▶ findings raised / re-checked / resolved
        │                                  ├──▶ unit progress → line progress → project progress
        └─▶ RETURNED → resubmit            ├──▶ mobilisation check: AUTO_CONTRACTOR_ON_SITE done
                                           ├──▶ final / post-closure evaluation: CoC gate, closure checklist, milestones
                                           └──▶ contractor email: open findings summary
 Sprint ends ──▶ M&E Manager verifies met / partly met / not met ──▶ schedule badge, KPIs
 Jobs: visit reminders, missed visits, finding escalation, sprint verification due
```

---

## 2. Read first

1. `CLAUDE.md` (all; especially "Contracts first", the server request path, jobs, migrations and hand-written SQL, seeds, the Windows gotchas).
2. `saas_updates/client_flow_redesign.md` sections 3, 4, 5, 6.3–6.5, 8, 9, 11, 12, 13, 14.
3. `saas_updates/redesign_r2_implementation_plan.md` section 9 (what R2 built; D-R2.15 badge; D-R2.16 programme of works) and `redesign_r1_implementation_plan.md` "Found during implementation" lists (contractor-side leftovers "go with R4"; `mobilizationReminderOffsetsDays` fixed until "the R4 deadline settings").
4. The R3 plan and its "Found during implementation" section: the exact names of the form library contracts (section 4 below lists what R4 assumes).
5. Code R4 replaces or touches:
   - Inspections (the closest existing pattern; copy its shape): `server/src/modules/inspections/inspections.service.ts` (`submitSiteInspection`: idempotent replay on `clientReportId`, `loadInspectionCaptures` with the retryable 409 `CAPTURES_NOT_REGISTERED`, geotag evaluation, chain start; `reviewSiteInspection`: `gateForStep` + `orgContextForStep` + `recordApprovalAction`), `findings.service.ts` (`autoRaiseFindingsForInspection`, resolve/dismiss), `supervision.service.ts` (`getSupervisorWorkloads`), `inspectionPack.service.ts`.
   - Cadence: `server/src/modules/cadence/*` (`obligationDispatch.ts`, `streams.service.ts`, `cadence.service.ts`, `cadence.routes.ts`), `server/src/jobs/cadenceJobs.ts` (`LIVE_PROJECT_WHERE`, `reporting-obligations`, `overdue-reports`), `shared/src/utils/reportingPeriod.ts`, `shared/src/schemas/cadence.schema.ts`.
   - Approval engine `server/src/modules/process/approvalChain.ts`; `processConfig.service.ts` (`ensureChain`, `getChainVersionSteps`, `getProcessConfig`).
   - Milestones `server/src/modules/contracts/milestones.service.ts` (`autoCompleteMilestones`, `reopenMilestones`, `SYSTEM_ACTOR`, `webActor`); completion `server/src/modules/completion/completion.service.ts` (final evaluation gate), `closure.service.ts` (checklist kind `INSPECTION_VISIT_TYPE`); `closeout/projectPhase.service.ts` (`changeProjectPhase`).
   - Progress and badge: `modules/progress/progress.service.ts` (`refreshProjectProgress`), `modules/evidence/evidenceProvider.ts`, `modules/schedule/schedule.service.ts` (`refreshScheduleBadge`), `jobs/scheduleJobs.ts`, `shared/src/utils/scope.ts` (`sprintScheduleStatus`, `deriveSprintStatus`, `unitsActiveInSprint`).
   - KPIs: `shared/src/schemas/kpi.schema.ts`, `server/src/modules/kpis/kpiEngine.ts` (`KpiProjectFacts`, `KPI_FUNCTIONS`), `kpiFacts.ts`.
   - Geofence: `shared/src/geo/geofence.ts` (radial or perimeter only), `server/src/utils/geofenceEvaluation.ts` (`evaluateProjectGeofence`, `GEOFENCE_CONTEXT_SELECT`).
   - Access: `server/src/utils/accessControl.ts` (`DRAFT_ROUTE_RE`, `FIELD_DEFECT_WORK_RE`, `ARCHIVED_WRITE_RE`), `utils/ownership.ts` (`loadFacilityUnitInProject`, `loadSprintInProject`).
   - Messaging: `server/src/integrations/messaging/templates.ts` (`TEMPLATES`), `index.ts` (`sendMessage`); notifications `modules/notifications/notifications.service.ts`.
   - Mobile auth routes `server/src/modules/auth/auth.routes.ts` (`/auth/mobile/projects`, `/auth/mobile/projects/:projectId/baseline`), `modules/auth/mobileAccess.ts` (`findOrCreateProvisionedSession`).
   - Web: `pages/inspections/ProjectInspectionsPage.tsx`, `components/inspections/*`, `components/ReportingCadencePanel.tsx`, `pages/projects/setup/steps/ReportingStep.tsx` and `TeamStep.tsx`, `components/deliveryModels/ProjectTypesTab.tsx`, the Scope & sprints panel (`ScopeAndSprintsPanel`).

---

## 3. Decisions

Defaults below are the plan. Items marked **(confirm)** are reasonable defaults the owner may change; build the default unless told otherwise, and note it in section 10.

### Model

| ID | Decision |
| :--- | :--- |
| D-R4.1 | **Two tables: `Visit` (the plan) and `VisitSubmission` (what was sent).** A visit has many submissions (a returned one is followed by a resubmission); at most one is live (`PENDING_APPROVAL` or `APPROVED`), enforced by a hand-written partial unique index `visit_submissions_one_live_per_visit` (add to the `CLAUDE.md` list). Officers are `VisitAssignee` rows (user, `isLead`); exactly one lead. |
| D-R4.2 | **Visit statuses:** `PROPOSED` (generated from the type plan, not yet published to officers), `PLANNED`, `IN_PROGRESS` (checked in), `SUBMITTED` (awaiting approval), `RETURNED`, `APPROVED`, `MISSED`, `CANCELLED`. The spec's six plus `PROPOSED` (spec 8.1 "proposed visits that the manager confirms") and `RETURNED` (so a returned visit is visible as such in lists). **(confirm)** |
| D-R4.3 | **Confirmation is separate from status:** `confirmation` = `UNCONFIRMED` / `CONFIRMED` / `DECLINED`. A declined visit stays `PLANNED` with `DECLINED` until the manager reassigns, moves (both reset to `UNCONFIRMED`) or cancels it. |
| D-R4.4 | **Dates.** `originalPlannedDate` (never changes after publish) and `plannedDate` (the agreed date; all KPIs and deadlines use it). Dates are `YYYY-MM-DD` in the project zone, like sprints. Every change is a `VisitDateChange` row (kind `MANAGER_MOVE`, `OFFICER_MOVE`, `OFFICER_PROPOSAL`; status `APPLIED`, `PENDING`, `ACCEPTED`, `REJECTED`, `WITHDRAWN`; from, to, comment, who, decision note) plus an audit event. One pending proposal per visit (hand-written partial unique index `visit_date_changes_one_pending_per_visit`). `Visit.rescheduleCount` counts applied officer moves and accepted proposals (the planner's per-officer figure). |
| D-R4.5 | **Visit type** is the R3 enum (assumed `VisitTypeEnum`: `MOBILISATION_CHECK`, `BASELINE`, `ROUTINE`, `QUARTERLY_ME`, `FINAL_EVALUATION`, `POST_CLOSURE_EVALUATION`, `AD_HOC`). If R3 stores it in Prisma, reuse that enum; otherwise R4a adds Prisma `VisitType`. The Phase 14 `InspectionVisitType` stays only for the legacy inspection tables until R5 drops them. |
| D-R4.6 | **Form freezing (spec 6.3).** A visit's form is assembled with the R3 `assembleVisitForm` and stored in `Visit.formSnapshotJson` when the visit is **published** (`PROPOSED → PLANNED`) or created directly as `PLANNED`. `PROPOSED` visits have no snapshot (the planner shows a preview on demand). "Rebuild form" is allowed while `PLANNED` and not checked in; a manager move into a different sprint rebuilds automatically. Each rebuild bumps `Visit.formVersion`. |
| D-R4.7 | **Re-check block is not part of the frozen template.** Open findings to re-check are stored separately in `Visit.recheckJson` (finding id, facility, unit, question, description, severity, raised date) and refreshed on every not-yet-started visit of the project whenever a finding is raised, resolved or dismissed; each refresh bumps `formVersion` so the phone re-downloads. Once checked in, the re-check list is fixed. Built by a shared pure `buildRecheckItems(findings)`; answers ("Resolved? Y/N", photo required when Y, comment) validated by a shared `validateRecheckAnswers`. This keeps R3's snapshot contract untouched. |
| D-R4.8 | **Who can submit:** a field principal (provisioned mobile account, `visits:submit`) who is an assignee of the visit. Web users cannot submit (photos come from the field app), matching `CAPTURES_NEED_FIELD_APP` today. Supporting assignees can view the form; the first accepted submission wins. **(confirm)** |
| D-R4.9 | **Unscheduled visits (spec 8.1):** created from the field app as `AD_HOC`, `origin = UNSCHEDULED`, idempotent on `clientVisitId`. Offline, the phone assembles the ad hoc form itself with the shared `assembleVisitForm` from the form library in the field pack, sends the template versions and picked facilities it used, and the server re-assembles with the same inputs and validates answers against its own result (a mismatch in template versions is 409 `FORM_VERSION_STALE` with the current versions). Counts as conducted, never as planned (D-R4.33). |

### Planning and responses

| ID | Decision |
| :--- | :--- |
| D-R4.10 | **Type default visit plan.** New `ProjectTypeConfig` key `monitoring` (every field defaulted, so existing snapshots parse): `visitPlan` (rules, below), `submissionDeadlineDays` (7), `unconfirmedReminderDays` (2), `findingEscalationDays` (14, **confirm**), `noVisitWarningWeeks` (4), `sprintVerificationDays` (7, **confirm**), `emailContractorFindingsSummary` (true), `finalEvaluationOffsetWorkdays` (5). A new key needs an editor section (`components/deliveryModels/MonitoringPlanEditor.tsx` in `ProjectTypesTab.tsx`); R6 regroups the editor. Like every type rule except KPI targets, a project reads it from its snapshot (`resolveProjectTypeConfig`). |
| D-R4.11 | **Plan rules (generators)**, pure in `shared/src/utils/visitPlan.ts` (`generateVisitDates(rule, context)` returns dates; context = activation day, kick-off held date, sprints, mobilisation milestone due date, construction end (last sprint end), work week, quarter anchor). Rule kinds: `EVERY_N_WEEKS_DURING_CONSTRUCTION`, `EVERY_N_WEEKS_IN_SPRINTS` (sprint numbers, empty = all), `EVERY_N_WEEKS_UNTIL_MOBILISED`, `QUARTERLY` (calendar quarters from `quarterAnchorMonth`, visit `offsetWorkdays` into the quarter's last month, **confirm**), `ONCE_AFTER_START` (baseline: `offsetWorkdays` after the later of activation and kick-off held), `ON_COMPLETION_NOTICE` (final evaluation), `AFTER_PROJECT_CLOSED` (post-closure evaluation; dated from the type's `PROJECT_CLOSED`-anchored milestone when there is one, else `offsetDays`). Dates fall on the next working day (`nextWorkdayOnOrAfter`, project `workWeekDays`). Each generated visit stores `generatorKey` (`rule key:date`) so regeneration never duplicates. |
| D-R4.12 | **When generators run.** On activation: date-driven rules create `PROPOSED` visits through the construction end (all of them, so the planner shows the whole plan). On a sprint save on a live project: `PROPOSED` visits of sprint-driven rules are regenerated; `PLANNED` ones are kept and listed as warnings if they now fall outside their sprint. On entering `HANDOVER_IN_PROGRESS` (the contractor's completion notice, `changeProjectPhase`): `ON_COMPLETION_NOTICE` rules create a `PROPOSED` final evaluation. On `COMPLETED_CLOSED`: `AFTER_PROJECT_CLOSED` rules. `EVERY_N_WEEKS_UNTIL_MOBILISED` creates up to the mobilisation milestone's due date; the `visit-deadlines` job proposes one more each interval while the milestone stays open; when it completes, the project's not-started mobilisation checks are cancelled (reason recorded). The manager can also run any rule by hand from the planner ("Generate"). **(confirm: activation proposes, the manager publishes; spec 8.1)** |
| D-R4.13 | **Default plans seeded on both programme types:** mobilisation check every 2 weeks until mobilised; baseline once, 5 working days after start; routine every 2 weeks during construction; quarterly M&E; final evaluation on completion notice; post-closure evaluation (Co-Funded only, from its existing `PROJECT_CLOSED` milestone). **(confirm intervals with the client)** |
| D-R4.14 | **Officer responses (decision P5)**, each with an idempotent `clientActionId` (the phone sends them from the outbox): **Confirm**; **Move** within the tolerance, which applies at once only when the new date is within ±`Tenant.visitRescheduleToleranceWorkdays` working days of the **original** planned date **and** inside the same sprint as the original date (projects without sprints: tolerance only), else 422 `MOVE_OUTSIDE_TOLERANCE` telling the app to propose instead; **Propose** a date outside the tolerance (original date stands until decided); **Decline**. Comment required on move, propose, decline (spec "always with a comment"; confirm needs none). Responses are refused once the visit is checked in, submitted or closed. The manager is notified (web notification) of moves, proposals and declines. |
| D-R4.15 | **Tolerance is a tenant setting** `Tenant.visitRescheduleToleranceWorkdays` (default 2, range 0–10; Q-H says per tenant), edited in Settings → Tenant settings. Measured from `originalPlannedDate` so repeated small moves cannot walk a visit away. **(confirm: from the original, not the current date)** |
| D-R4.16 | **Manager actions** (`visits:plan`): create (project, type, date, officers), publish (one or many `PROPOSED`), move (applies at once, `MANAGER_MOVE`, resets confirmation), reassign, cancel (reason), accept or reject a proposal (accept moves the date and confirms the visit), rebuild form, generate. A manager move keeps `originalPlannedDate` only if the visit was never published; after publish the original stays fixed. **(confirm)** |
| D-R4.17 | **Assignees.** An officer must be able to see the project (`projectAccessBranch`) and hold `visits:submit` on their mobile role. Assigning a user who is not yet on the project team adds a `UserProjectAssignment` (audited), so the field session works (`findOrCreateProvisionedSession`). **(confirm: auto-assign rather than refuse)** |
| D-R4.18 | **Warnings, never blocks** (spec 8.1), computed by `server/src/modules/visits/planWarnings.ts`: officer over the type's `supervision.maxSitesPerSupervisor` (sites with a planned visit in the next 30 days plus assigned live projects); one officer with visits on one day in different regions; an active or upcoming sprint with no visit; an active project with no visit in `noVisitWarningWeeks`; a planned visit outside its sprint after a sprint change. Returned on the planner response and the project visits response. The supervision workload (`getSupervisorWorkloads`) gains the visit count. |

### Field, submission and approval

| ID | Decision |
| :--- | :--- |
| D-R4.19 | **Check-in** is its own idempotent call (`clientCheckInId`, device time, geotag) so the planner sees `IN_PROGRESS`, and can also ride inside the submission when the phone was offline the whole time. The server evaluates the geotag (`evaluateProjectGeofence`); `OUTSIDE` is recorded and flagged, never refused (the server never refuses evidence over GPS; the phone warns). **(confirm)** |
| D-R4.20 | **Submission** copies `submitSiteInspection`: replay on `clientSubmissionId` (same submitter → 200 with the stored DTO; other submitter → 409); answers validated with R3 `validateVisitAnswers` against the stored snapshot (or the re-assembled ad hoc form), re-check answers with `validateRecheckAnswers`; `formVersion` older than the visit's is 409 `FORM_VERSION_STALE` unless only the re-check block changed after check-in (it is fixed then, D-R4.7); captures named by answers must be registered, in this project, taken by the **same user** (any of their devices, `fieldSession.userId`), and unlinked, else 409 `CAPTURES_NOT_REGISTERED` (retryable) / 403 / 409; a capture names its question and, for "one per unit" photos, its unit. Site log entries can be attached (D-R4.27). One transaction: submission row, capture links, visit status, chain start, audit. |
| D-R4.21 | **Deadline (spec 8.1, slide 12):** `submissionDeadline = plannedDate + submissionDeadlineDays` calendar days (unscheduled: visit date + days). Late = the device's confirmation day (project zone) is after the deadline, as inspections do today (`confirmedAt` more than 15 minutes in the future is refused). The server receipt time is stored too (`receivedAt`) and shown when it is much later than `confirmedAt`. |
| D-R4.22 | **Missed.** The `visit-deadlines` job marks a `PLANNED` / `IN_PROGRESS` / `RETURNED` visit `MISSED` once its submission deadline has passed with no live submission (audit `VISIT_MISSED`, web notification to `visits:plan`). A submission that arrives later (offline phone) is still accepted: the visit moves on to `SUBMITTED`, is flagged late, and keeps `missedAt` for the audit trail; it counts as conducted, late (D-R4.33). |
| D-R4.23 | **Approval reuses the project's `REPORT` chain** with a new `ApprovalSubjectType.VISIT_SUBMISSION`, through `ensureChain`, `nextApplicableStep`, `gateForStep` (with `orgContextForStep`), `recordApprovalAction`, `buildApprovalProgress`; the submitter can never approve their own submission. When `requireReportApproval` is off or the chain has no applicable step, a submission is `APPROVED` at once (one acceptance path for everything downstream). **(confirm: no separate VISIT chain type)** |
| D-R4.24 | **Acceptance effects** (one function `onSubmissionAccepted(tx, submission)`, called from both paths): raise findings from the R3 findings-rule output; apply re-check outcomes; update unit progress (D-R4.26); mobilisation check → `autoCompleteMilestones(AUTO_CONTRACTOR_ON_SITE, at = visit date)` when the R3 "contractor on site" question is yes, then cancel the project's other not-started mobilisation checks; final evaluation → completes `AUTO_FINAL_EVALUATION_APPROVED` milestones **not** anchored on `PROJECT_CLOSED`; post-closure evaluation → completes the dated ones anchored on `PROJECT_CLOSED`; queue the contractor email (D-R4.29). Staff "complete" for `AUTO_CONTRACTOR_ON_SITE` stays as the fallback. **(confirm the final/post-closure split)** |
| D-R4.25 | **Return** sets the submission `RETURNED`, the visit `RETURNED`, adds the reviewer's note to the visit's comment thread (`VisitComment`) and sends a mobile notification. The officer resubmits with a new `clientSubmissionId`; the deadline does not move. |

### Progress, findings, site log, sprints

| ID | Decision |
| :--- | :--- |
| D-R4.26 | **Progress from visits.** New `FacilityUnit.progressPct`, `progressAsOf`, `progressSubmissionId`, set on acceptance from the R3 progress-tagged questions (per-unit answer, or a whole-facility answer applied to every unit in that block; supply items: delivered ÷ planned quantity). `refreshProjectProgress` then sets each line's `cumulativeCertifiedPct` from its unit's `progressPct` when the unit has one, and falls back to counted workday reports otherwise (legacy projects and the old app until R5). A later accepted visit can lower progress (it is an observation, not a claim). Routine forms include units from earlier sprints whose `progressPct` is below 100 (input to R3 assembly). **(confirm)** |
| D-R4.27 | **Site log server side is R4** (decision X), because the submission contract needs it; R5 builds the screens. `SiteLogEntry`: project, author user, field session, kind `PHOTO` / `VOICE` / `NOTE`, capture (photo and voice; the capture carries the geotag), text, device time, optional geotag for notes, `attachedSubmissionId`. Idempotent on `clientEntryId`. Attaching to a submission links the capture. Unattached entries list per project for the project timeline (R6 builds the timeline view; R4 adds a site log list on the visits page). Entries are never deleted (an author may hide a note; audited). **(confirm)** |
| D-R4.28 | **Findings stay in `InspectionFinding`** (`inspection_findings`), generalised: `inspectionId` becomes nullable; new `visitId`, `visitSubmissionId`, `facilityId`, `facilityUnitId`, `questionKey`, `recheckCount`, `lastRecheckedSubmissionId`, `lastRecheckedAt`, `escalatedAt`; CHECK `inspection_findings_source_check` (`"inspectionId" IS NOT NULL OR "visitSubmissionId" IS NOT NULL`, hand-written; add to the list). The service moves to `server/src/modules/findings/`; the routes move to `/projects/:id/findings` with `/inspection-findings` kept as an alias until R5 deletes the old app's calls. The Prisma model is renamed `Finding` with `@@map("inspection_findings")` in R7 with the role catalogue, not now. Manual raise from a visit stays (`inspections:manage_findings`). A finding resolves on acceptance of a re-check answered "resolved" with a photo, or by staff resolve/dismiss as today. **(confirm: extend, do not create a second findings table)** |
| D-R4.29 | **Contractor email (spec 6.5):** after each accepted visit, when the project has open findings or the visit resolved any, and `emailContractorFindingsSummary` is on, send template `FINDINGS_SUMMARY` to the contractor organisation's `contactEmail` (`sendMessage`, after commit, `OutboundMessage` records it; no email = audit note only). Content: project, visit type and date, open findings (facility, unit, description, severity, raised date, times re-checked), resolved this visit. No internal comments, no photos (links would need a public URL, which R1d removed). **(confirm)** |
| D-R4.30 | **Escalation:** the `finding-escalations` job stamps `escalatedAt` once a finding is open for `findingEscalationDays` and sends a web notification to holders of the new permission `findings:receive_escalations` (default: Tenant Super Admin and Organisation Admin now; the Programme Manager role in R7). One `JobRun` per finding (`runUnit('finding-escalations', findingId)`). |
| D-R4.31 | **Sprint verification (spec 6.4, decision V):** new `ProjectSprint` fields `verificationOutcome` (`MET` / `PARTLY_MET` / `NOT_MET`), `verifiedAt`, `verifiedByUserId`, `verificationNotes`, `firstVerifiedAt` (for the on-time KPI), `verificationDueAlertedAt`. Permission `sprints:verify` (Monitor default role now; M&E Manager in R7). Allowed once the sprint has started (normally after it ends; verifying early needs a note). Re-verifying replaces the outcome, keeps `firstVerifiedAt`, and is audited (`SPRINT_VERIFIED`). The verify dialog shows, per facility in the sprint, the latest accepted submission's answers, unit progress and open findings. `deriveSprintStatus` gains `LATE` (ended, not verified) and `VERIFIED`. The `visit-deadlines` job notifies `sprints:verify` holders once when a sprint ends unverified. Verification is the event an ERP webhook will listen to later (spec 9); nothing is sent now. |
| D-R4.32 | **Schedule badge (replaces D-R2.15's "lines at 100%"):** `BEHIND` when any ended sprint's current outcome is `PARTLY_MET` or `NOT_MET`, or an ended sprint is unverified past `sprintVerificationDays` and still has a unit below 100% (the R2 rule as fallback, so the badge does not go stale); `COMPLETE` when every sprint is verified `MET`; `NOT_STARTED`, `UNSCHEDULED`, `ON_TRACK` as now. Re-verifying a sprint `MET` after catching up clears it. `sprintScheduleStatus` takes the outcomes; the job and `projects_on_schedule` KPI keep working. **(confirm)** |

### KPIs (spec 11)

| ID | Decision |
| :--- | :--- |
| D-R4.33 | **Re-based on visits** (facts loaded in batches in `kpiFacts.ts`, no per-project queries): `visits_conducted` = planned visits (not unscheduled, not cancelled) whose planned date is in the period and that are resolved (submitted/approved, or missed): conducted ÷ resolved; unscheduled visits are reported as a separate count in the KPI detail, not added to the numerator (the spec's "counts as conducted" read literally would let the KPI pass 100%) **(confirm)**. `reports_on_time` = submissions within the deadline ÷ visits whose deadline fell in the period. `baseline_uploaded` = live projects with an accepted `BASELINE` visit, where the plan has a baseline rule. `approval_turnaround_days` = visit submissions approved in the period. `verified_on_time` keeps its key and label; its final-evaluation finding comes from the accepted final evaluation visit (R3 overall-finding question). `supervisors_assigned` also counts a project with a lead officer on a planned visit. |
| D-R4.34 | **New KPI `sprints_verified_on_time`** (stage MONITORING, percent, higher is better, period-based, default target 90): sprints whose `endDate + sprintVerificationDays` falls in the period, verified by then ÷ those sprints. |
| D-R4.35 | **Deleted KPI:** `monitoring_framework_established` (streams). Its `KpiSnapshot` rows and `kpiTargets` entries are removed (migration and a tolerant config parse). Other KPIs not named in spec 11 (`introduction_letters_on_time`, `mobilisation_documents_complete`, `approval_turnaround_days`, `projects_on_schedule`, `financial_utilisation`) stay; trimming is a client call at the demo. **(confirm)** |

### Deletions and ownership

| ID | Decision |
| :--- | :--- |
| D-R4.36 | **R4 deletes what only the server and web use** (slice R4f): reporting streams (model, `streams.service.ts`, routes, `ReportingStreamsEditor`, type key `reportingStreams`, `createStreamsFromProjectType`); reporting obligations (model, its two hand-written partial unique indexes and CHECK, `obligationDispatch.ts`, jobs `reporting-obligations` and `overdue-reports`, obligation list/excuse/overview routes and `ReportingCadencePanel`, `fulfilObligation` calls in workday reports, audit action `REPORTING_OBLIGATION_EXCUSED`, web notification `INSPECTION_MISSED`); the cadence reporter scopes (`reporterScopeFor`, `sessionsForScope`, `reportingPersonasForProject`); the `reporting` setup step and type key `reportingDefaults`; the web inspections page, `InspectionOverviewCard`, `ChecklistTemplatesCard` (if R3 has not already) and the inspection overview endpoint; `BoqItem.dailyTargetQuantity`, `expectedDeliverable` (server-only); the unreachable contractor-side branches R1d listed (documents `visibleToContractors` / `documentViewerFor` contractor path, ratings `shareRatingsWithContractor`, lessons `sharedWithContractor`, web notifications `targetOrganizationId` / `hideFromProjectContractors`): the contractor gets emails only (kick-off notice, findings summary). **(confirm the contractor-side clean-up is in R4; otherwise R6)** |
| D-R4.37 | **R5 deletes what the current mobile app still calls**, in its final slice once the new app ships: workday reports (+ the hand-written index `workday_reports_one_report_per_period`, report queries, `aiOmissionCheck.ts`, `reportRules.ts`, the standards check), WBS chat (`WbsChatMessage`, routes), `SiteInspectionReport`, `InspectionChecklistTemplate` (unless R3 already removed it), `/inspections/*` and `/inspections/field-pack`, the `/inspection-findings` alias, hold points (`isHoldPoint`, `holdPointInstruction`, `enableHoldPoints`, `HOLD_POINT_ALERT`), `planningTier`, project cadence columns + `reportingPeriod.ts` + `cadence.service.ts` (the mobile pack's `cadence` and the workday report period fields need them until then), `FieldPersonaType.CONTRACTOR_EXECUTOR` (mobile tests reference it), mobile notification type `REPORT_OVERDUE`, `CompletionCertificate.finalEvaluationInspectionId`. Briefs, telemetry and the roster are already gone (R1e). **(confirm)** |
| D-R4.38 | **`Project.workWeekDays` and `timezone` stay permanently** (working-day maths for tolerance, generators, milestones). `mobilizationReminderOffsetsDays` stays as is (moving it into `monitoring` is R6's type editor regrouping). |
| D-R4.39 | **Setup step:** the `reporting` step is replaced by a `visits` step (not required): officers for the project and a preview of the visit plan the type will propose at activation (computed, nothing stored on a draft). R6 merges it into "Team & visits". Add `visit-plan` to `DRAFT_ROUTE_RE` for the preview. **(confirm)** |
| D-R4.40 | **Phases.** Visits are allowed in every construction phase of an `ACTIVE` project (final evaluation in handover, post-closure after close): add `visits`, `site-log` and `findings` to `FIELD_DEFECT_WORK_RE`. Visit jobs cover every `ACTIVE` project of a non-suspended tenant (like `milestone-deadlines`), not `LIVE_PROJECT_WHERE`. Archived projects are read-only as today. |
| D-R4.41 | **Permissions** (catalogue + default roles; R7 renames roles): `visits:view` (web staff: Monitor, Org Admin, Funder; field roles), `visits:plan` (Monitor, Tenant Super Admin), `visits:submit` (MOBILE/BOTH: `MONITOR_INSPECTOR`, `INDEPENDENT_RESIDENT`), `sprints:verify` (Monitor), `findings:receive_escalations` (Tenant Super Admin, Org Admin). Approvals use the chain steps' own permissions (default `reports:approve_completion`). Field principals respond to their own visits with `visits:submit`. |
| D-R4.42 | **Notifications.** Web categories (shared enum; the Prisma column is a string): `VISIT_RESCHEDULED`, `VISIT_DATE_PROPOSED`, `VISIT_DECLINED`, `VISIT_PENDING_APPROVAL`, `VISIT_MISSED`, `FINDING_ESCALATED`, `SPRINT_VERIFICATION_DUE`. Mobile types (Prisma + shared): `VISIT_ASSIGNED`, `VISIT_CHANGED`, `VISIT_REMINDER`, `VISIT_RETURNED`; action `OPEN_VISIT`. Mobile notifications go to the officer's field session on that project (`findOrCreateProvisionedSession`) plus push. |

---

## 4. What R4 assumes from R3

R4 is blocked on these. Names are assumptions; use R3's real names and record any difference in section 10.

| Contract (shared unless noted) | R4 uses it for |
| :--- | :--- |
| `VisitTypeEnum` (7 values, D-R4.5), labels; per-type rule for which facilities to include (spec 6.3) | Visit rows, generators, planner, KPIs, closure checklist kind |
| Tenant form library, versioned (fixed sections per visit type, facility sub-forms, visit type templates); a used version is never edited | Freezing; ad hoc re-assembly by version |
| `assembleVisitForm({ visitType, visitDate, library, scope: { facilities, units (with sprint numbers, planned qty, `complete` flag from `progressPct`), sprints }, pickedFacilityIds? })` → `VisitFormSnapshot`; pure and deterministic for the same inputs | Publish/rebuild (server), unscheduled visits (phone and server) |
| `VisitFormSnapshotSchema`: sections (fixed / facility), each facility block with its units (id, label, planned qty, UoM), questions with key, type, answer scope (`WHOLE_FACILITY` / `PER_UNIT`), photo mode (`ONE_PER_UNIT`, `AT_LEAST_N`, `PER_UNIT_OPTIONAL`), geotag flag, resolved placeholder text, rules; `templateRefs` (ids + versions) | Storage in `Visit.formSnapshotJson`, the form DTO, capture slot checks |
| `VisitAnswersSchema` + `validateVisitAnswers(snapshot, answers)` → `{ valid, errors, findings: [{ questionKey, facilityId, unitId?, severity, text }], expectedPhotoSlots, missingPhotos }`, including the supply rule (delivered above planned needs a comment) | Submission validation, finding raising, photo checks |
| Question semantic tags (assumed `metric`): `PERCENT_COMPLETE`, `QUANTITY_DELIVERED`, `CONTRACTOR_ON_SITE`, `OVERALL_FINDING` (satisfactory / minor / major) | Progress (D-R4.26), mobilisation milestone (D-R4.24), final evaluation KPI and CoC gate. **If R3 has no tags, R4a adds them to the R3 question schema (confirm with the R3 owner).** |
| Finding severity enum compatible with `InspectionFindingSeverity` (`MINOR`, `MAJOR`, `CRITICAL`) | Findings table reuse |

---

## 5. Schema changes (Prisma)

| Change | Slice |
| :--- | :--- |
| `enum VisitType` (only if R3 did not add it), `enum VisitStatus`, `enum VisitConfirmation { UNCONFIRMED CONFIRMED DECLINED }`, `enum VisitOrigin { PLAN MANUAL UNSCHEDULED }` | R4a |
| `model Visit` (`projectId`, `visitType`, `status`, `origin`, `generatorKey String?`, `originalPlannedDate`, `plannedDate`, `sprintId?` (SetNull), `confirmation`, `confirmedAt?`, `formSnapshotJson Json?`, `formVersion Int @default(0)`, `formAssembledAt?`, `recheckJson Json @default("[]")`, `submissionDeadline String?`, `rescheduleCount Int @default(0)`, `publishedAt?`, `publishedByUserId?`, `cancelledAt?`, `cancelledReason?`, `missedAt?`, `createdByUserId?`, `clientVisitId String? @unique`, timestamps; `@@unique([projectId, generatorKey])`, `@@index([projectId, plannedDate])`, `@@index([status, plannedDate])`, `@@map("visits")`) | R4a |
| `model VisitAssignee` (`visitId` Cascade, `userId`, `isLead`; `@@unique([visitId, userId])`, `@@index([userId])`, `@@map("visit_assignees")`) | R4a |
| `Tenant.visitRescheduleToleranceWorkdays Int @default(2)` | R4a |
| `enum VisitDateChangeKind`, `enum VisitDateChangeStatus`; `model VisitDateChange` (`visitId`, `kind`, `status`, `fromDate`, `toDate`, `comment`, `byUserId`, `clientActionId String? @unique`, `decidedByUserId?`, `decidedAt?`, `decisionNote?`, `createdAt`); hand-written partial unique index `visit_date_changes_one_pending_per_visit` (`("visitId") WHERE "status" = 'PENDING'`) | R4b |
| `Visit.checkInAt`, `checkInGeotag Json?`, `checkInGeofenceStatus GeofenceStatus?`, `clientCheckInId String? @unique` | R4c |
| `enum VisitSubmissionStatus { PENDING_APPROVAL RETURNED APPROVED }`; `model VisitSubmission` (`clientSubmissionId @unique`, `visitId`, `projectId`, `revisionNumber`, `submittedByUserId`, `fieldSessionId`, `reporterName`, `reporterRoleName`, `answersJson`, `recheckAnswersJson`, `summaryText @db.Text`, `formVersion`, `submissionGeotag Json?`, `geofenceStatus?`, `integrityFlags Json @default("[]")`, `confirmedAt`, `receivedAt @default(now())`, `isLate`, `status`, `approvalChainVersion Int?`, `currentApprovalStep Int @default(0)`, `approvedAt?`, `returnedNotes?`, timestamps); hand-written partial unique index `visit_submissions_one_live_per_visit` (`("visitId") WHERE "status" IN ('PENDING_APPROVAL','APPROVED')`) | R4c |
| `model VisitComment` (`visitId`, `submissionId?`, `authorUserId?`, `authorName`, `text @db.Text`, `createdAt`) | R4c |
| `enum SiteLogKind { PHOTO VOICE NOTE }`; `model SiteLogEntry` (`clientEntryId @unique`, `projectId`, `authorUserId`, `fieldSessionId`, `kind`, `captureId String? @unique`, `text?`, `latitude?`, `longitude?`, `accuracyMeters?`, `geofenceStatus?`, `capturedAtDevice`, `attachedSubmissionId?`, `hiddenAt?`, `createdAt`; `@@index([projectId, capturedAtDevice])`) | R4c |
| `FieldEvidenceLog.visitSubmissionId?`, `formQuestionKey?`, `facilityUnitId?` (+ index on `visitSubmissionId`) | R4c |
| `ApprovalSubjectType.VISIT_SUBMISSION`; mobile notification types and action (D-R4.42); audit actions (below) | R4b–R4d |
| `InspectionFinding`: `inspectionId` nullable; `visitId?`, `visitSubmissionId?`, `facilityId?`, `facilityUnitId?`, `questionKey?`, `recheckCount Int @default(0)`, `lastRecheckedSubmissionId?`, `lastRecheckedAt?`, `escalatedAt?`; hand-written CHECK `inspection_findings_source_check` | R4d |
| `FacilityUnit.progressPct Decimal? @db.Decimal(5,2)`, `progressAsOf String?`, `progressSubmissionId?` | R4d |
| `CompletionCertificate.finalEvaluationVisitId String? @db.Uuid` | R4d |
| `enum SprintVerificationOutcome { MET PARTLY_MET NOT_MET }`; `ProjectSprint.verificationOutcome?`, `verifiedAt?`, `verifiedByUserId?`, `verificationNotes?`, `firstVerifiedAt?`, `verificationDueAlertedAt?` | R4e |
| Drop `ProjectReportingStream`, `ReportingObligation` (+ `ReportingStreamKind`, `ReportingObligationStatus`, the two hand-written indexes and the CHECK), `BoqItem.dailyTargetQuantity`, `expectedDeliverable`; remove `REPORTING_OBLIGATION_EXCUSED`, `REPORTING_STREAMS_SAVED` audit rows and enum values; delete `KpiSnapshot` rows for `monitoring_framework_established` | R4f |

**Audit actions** (shared enum and Prisma `AuditActionType`): `VISITS_GENERATED`, `VISIT_CREATED`, `VISIT_PUBLISHED`, `VISIT_UPDATED` (manager move, reassign), `VISIT_CANCELLED`, `VISIT_FORM_REBUILT` (R4a); `VISIT_RESPONDED`, `VISIT_DATE_DECIDED` (R4b); `VISIT_CHECKED_IN`, `VISIT_SUBMITTED`, `VISIT_MISSED`, `SITE_LOG_ADDED` (R4c); `VISIT_REVIEWED`, `FINDING_ESCALATED`, `FINDINGS_SUMMARY_SENT` (R4d); `SPRINT_VERIFIED` (R4e).

**Migrations** (one per slice, generated with `prisma migrate diff`, reviewed by hand; timestamps in the `202612150900xx` range): `20261215090000_r4a_visits`, `20261215090001_r4b_visit_responses`, `20261215090002_r4c_visit_submissions_site_log`, `20261215090003_r4d_visit_review_findings`, `20261215090004_r4e_sprint_verification`, `20261215090005_r4f_remove_streams_obligations`. Add the three new hand-written objects to the `CLAUDE.md` list in the slice that creates them; R4f removes the Phase 14 obligation indexes and CHECK from that list (dropped with their table; intended). R4f starts with a data clean-up (removed audit rows, notifications, `JobRun` rows of the removed jobs) as R1d/R1e did; deleting audit rows breaks hash-chain verification on a database with data (dev DB is disposable, decision A).

---

## 6. Implementation checklist

### R4a: Visits, type plans and generators
- [ ] Shared `visit.schema.ts`: `VisitStatusEnum`, `VisitConfirmationEnum`, `VisitOriginEnum`, labels; `VisitDto` (project summary, type, status, confirmation, dates, sprint (number, name), assignees, facility count, open re-check count, form version, warnings), `VisitPlanRuleSchema`, `ProjectTypeMonitoringConfigSchema` (D-R4.10) added to `ProjectTypeConfigSchema` as `monitoring`; `CreateVisitRequest`, `UpdateVisitRequest` (move, reassign), `PublishVisitsRequest`, `CancelVisitRequest`, `GenerateVisitsRequest`.
- [ ] Shared `utils/visitPlan.ts`: `generateVisitDates`, `withinRescheduleTolerance(original, proposed, toleranceWorkdays, workWeekDays, sprints)`, `submissionDeadlineFor`, `sprintForDate`. Pure; unit-tested.
- [ ] Permissions `visits:view`, `visits:plan`, `visits:submit` (catalogue + default roles); audit actions for R4a.
- [ ] Prisma: R4a models + `Tenant.visitRescheduleToleranceWorkdays` + migration.
- [ ] Server `modules/visits/`: `visits.service.ts` (list per project with filters, get, create, update, publish (assembles and freezes the form, sets the deadline), cancel, rebuild form), `visitPlan.service.ts` (`proposeVisitsFromType(tx, projectId, trigger)`, idempotent on `generatorKey`; called from `activateProject`, the live sprint save in `scope.service.ts`, `changeProjectPhase`), `planWarnings.ts`; serializers; ownership loader `loadVisitInProject`. Routes `visits.routes.ts` under `/projects` (`guardProjectRoutes`), `visit-plan/preview` in `DRAFT_ROUTE_RE`.
- [ ] Setup: `visits` step replaces `reporting` in `PROJECT_SETUP_STEPS` and the step registry (D-R4.39); team options keep working.
- [ ] Web: project **Visits** page `/app/projects/:id/visits` (plan table by date: type, officers, status, confirmation, warnings; create/edit/cancel/publish dialogs; "Generate from plan"); `MonitoringPlanEditor` in the type editor; tolerance field in Settings → Tenant settings. Mutation hooks own toasts; `useGuardedNavigate`.
- [ ] Seed `seedR4.ts` (after `seedR3`): default plans on both programme types (no version bump, like Phase 13–16), proposed and published visits on PRG-102 and PRG-105; new tables in the reset list.
- [ ] Tests: `visits.r4.test.ts` (generators per rule kind, working-day roll-forward, tolerance incl. sprint boundary, deadline); `routes.r4.test.ts` (activation proposes, publish freezes the form and bumps nothing on a second publish, rebuild bumps `formVersion`, sprint change regenerates only `PROPOSED`, cross-project and permission refusals, audit). Add both to `server/package.json` lists. Before measuring the baseline, fix `test:unit` still listing the deleted `boq.parser.test.ts` (section 10).

### R4b: Officer responses and the planner
- [ ] Shared: `RespondToVisitRequest` (`action: CONFIRM | MOVE | PROPOSE | DECLINE`, `toDate?`, `comment?`, `clientActionId`), `DecideVisitProposalRequest`, `VisitDateChangeDto`, `PlannerQuery` / `PlannerDto` (officers × days, visits, per-officer reschedule count, warnings, pending proposals and declines).
- [ ] Prisma `VisitDateChange` + hand-written index + migration; notification enum values.
- [ ] Server `visitResponses.service.ts` (D-R4.14–D-R4.16; idempotent on `clientActionId`; one transaction with audit; notifications), tenant router `visitPlanner.routes.ts` at `/api/v1/visits` (`GET /` planner; `GET /mine` comes in R4c; visit writes stay project-scoped, section 7); job `visit-reminders` (hourly; one `JobRun` per visit and reminder day; unconfirmed visits `unconfirmedReminderDays` before; mobile notification + push).
- [ ] Web: **Visit planner** `/app/visits` (tenant nav entry; week/month grid of officers × days; filters region, project, officer, type; drag to move (manager move, asks for a note); proposals and declines side panel with accept/reject; warnings; reschedule count per officer). Project Visits page shows each visit's date history.
- [ ] Tests: move inside tolerance applies; outside → 422; other sprint → 422; propose keeps the date until accepted; accept/reject; decline then reassign resets confirmation; replayed `clientActionId`; responses refused after check-in; reminder job sends once.

### R4c: Field API: feed, form, check-in, site log, submission, deadlines
- [ ] Shared: `MyVisitsFeedDto`, `VisitFormDto` (snapshot, re-check items, sprint deliverables, units, project geofence, form version), `VisitCheckInRequest`, `SubmitVisitRequest` (D-R4.20), `VisitSubmissionDto`, `CreateUnscheduledVisitRequest`, `SiteLogEntryDto`, `CreateSiteLogEntryRequest`, `VisitFieldPackDto` (form library versions for ad hoc assembly, project facilities, units, sprints, open findings).
- [ ] Prisma: check-in fields, `VisitSubmission` + index, `VisitComment`, `SiteLogEntry`, `FieldEvidenceLog` links + migration.
- [ ] Server `visitSubmissions.service.ts` (check-in, submit with replay and capture checks, unscheduled create + re-assembly, comments), `modules/site-log/` (create, list, hide), `GET /visits/mine` for web and mobile principals, field pack. Add `visits`, `site-log`, `findings` to `FIELD_DEFECT_WORK_RE`.
- [ ] Job `visit-deadlines` (hourly per project): mark `MISSED` (D-R4.22), notify; extend mobilisation checks (D-R4.12). Register in `registerAllJobs()`.
- [ ] Web: submission detail drawer on the Visits page (answers by section, photos per unit with geofence badges, check-in location, comments); site log list per project.
- [ ] Tests: replay; other submitter 409; stale form 409; unregistered capture 409; capture from another project 403; capture from another user 403; capture already linked 409; per-unit photo slot mapping; check-in outside boundary flagged not refused; late flag; missed then late submission accepted; unscheduled visit with stale template version 409; site log attach; field principal on another project refused.

### R4d: Approval, findings loop, progress, milestones, closure
- [ ] Shared: `ReviewVisitSubmissionRequest`, re-check helpers (`buildRecheckItems`, `validateRecheckAnswers`), `FindingDto` extended (facility, unit, visit, re-check count, escalated), `FINDINGS_SUMMARY` template data; `findings:receive_escalations`; closure checklist kind `INSPECTION_VISIT_TYPE` accepts `VisitTypeEnum` values (stored key unchanged; label "Visit accepted").
- [ ] Prisma: `VISIT_SUBMISSION` subject, findings columns + CHECK, `FacilityUnit` progress fields, `CompletionCertificate.finalEvaluationVisitId` + migration.
- [ ] Server: review (chain, D-R4.23/D-R4.25), `onSubmissionAccepted` (D-R4.24), findings service moved to `modules/findings/` with visit raising, re-check refresh on open visits (D-R4.7), `/findings` routes + `/inspection-findings` alias; `refreshProjectProgress` per D-R4.26; completion gate `requireFinalEvaluationBeforeCoc` and the closure checklist read accepted visits (legacy inspection rows still count until R5); job `finding-escalations`; template `FINDINGS_SUMMARY` + send after commit.
- [ ] Web: approve/return on the submission drawer (`ApprovalProgressDto`); findings tab on the Visits page (filters, resolve, dismiss); completion section links to the visit, not `/inspections`.
- [ ] Tests: approval chain with org scope and self-approval refusal; no-chain auto-approval; return then resubmit; findings raised from rules; re-check "resolved" with photo resolves on acceptance, "not resolved" increments; re-check list refreshed and `formVersion` bumped on open visits only; escalation once; email sent to `contactEmail` (`consoleOutbox`), skipped without one; mobilisation check completes `AUTO_CONTRACTOR_ON_SITE` dated on the visit and cancels later checks (and cures a default case in cure period); final vs post-closure milestones; CoC draft needs an accepted final evaluation visit; progress from per-unit and whole-facility answers, fallback to reports.

### R4e: Sprint verification, badge and KPIs
- [ ] Shared: `VerifySprintRequest`, `SprintVerificationViewDto` (facilities in the sprint with latest accepted answers, unit progress, open findings), `deriveSprintStatus` with `LATE`/`VERIFIED`, `sprintScheduleStatus` per D-R4.32; KPI catalogue: `sprints_verified_on_time` added, `monitoring_framework_established` removed, descriptions of re-based KPIs updated.
- [ ] Prisma sprint fields + migration; `sprints:verify`.
- [ ] Server: `GET/POST /projects/:id/scope/sprints/:sprintId/verification`; badge refresh after verification; `visit-deadlines` sends `SPRINT_VERIFICATION_DUE` once; `kpiFacts.ts` loads visits, submissions and sprint verifications in batches; `kpiEngine.ts` per D-R4.33–D-R4.35.
- [ ] Web: Verify on the Scope & sprints sprint rows (status chip incl. Late/Verified; dialog with the facility table); KPI page picks up the new KPI (icon + label chips).
- [ ] Tests: verification rules (early needs a note, re-verify keeps `firstVerifiedAt`); badge per D-R4.32; KPI functions on fixtures (visits conducted, unscheduled excluded, reports within a week, sprints verified on time, baseline, final evaluation finding); snapshot job still writes one row set per tenant-day.

### R4f: Delete what visits replace, seed and docs
- [ ] Per D-R4.36: remove streams, obligations, their jobs and routes, the cadence reporter scopes, `reportingStreams` / `reportingDefaults` type keys (tolerant parse of old snapshots: unknown keys are stripped), the web inspections page (`/inspections` redirects to `/visits`), `InspectionOverviewCard`, `ReportingCadencePanel` obligation parts, `dailyTargetQuantity`, `expectedDeliverable`, and the contractor-side branches. Keep everything D-R4.37 lists for R5.
- [ ] Migration with data clean-up first.
- [ ] Seeds: re-tell the Phase 14 inspection stories as visits in `seedR4.ts` (PRG-211: accepted baseline, a late routine visit, one with a major finding open past escalation; PRG-221: a missed quarterly M&E visit; PRG-102: mobilisation checks every 2 weeks, one due in the demo window; PRG-105: an ended sprint verified `PARTLY_MET`, one awaiting verification; a pending date proposal and a decline for `programme.monitor@`; `resident.supervisor@` with visits this week). Remove stream and obligation seeding from `seedPhase14.ts`; keep legacy inspection rows only where Phase 15/16 stories still need them until R5. Update seed header comments and the `CLAUDE.md` seed paragraph.
- [ ] Tests: delete stream/obligation tests (`routes.phase8.test.ts`, `routes.phase14.test.ts` parts) or rewrite around visits; removed endpoints 404 and removed jobs not registered; earlier route tests that assert seed contents updated.

### Docs (every slice)
- [ ] `CLAUDE.md`: a "Visits (redesign R4)" architecture paragraph (models, statuses, responses, submission, acceptance effects, jobs, field API); jobs list; hand-written SQL list (add three, remove the Phase 14 obligation objects in R4f); remove the Phase 8 obligations and Phase 14 streams text in R4f.
- [ ] `configuration_reference.md`: `monitoring` type key, plan rules, tenant tolerance, deadlines, escalation, permissions; remove streams/obligations settings.
- [ ] `demo_script_programme_delivery.md`: planner, officer response, submission review, findings email, sprint verification.
- [ ] This file: section 10 per slice.

---

## 7. API summary (new)

### Web (staff)

| Method and path | Permission | Notes |
| :--- | :--- | :--- |
| `GET /api/v1/visits` | `visits:view` | Planner: `from`, `to`, `regionId`, `projectId`, `officerId`, `visitType`; visibility as the directory (`projectAccessBranch`); warnings, proposals, declines, reschedule counts |
| `GET /projects/:id/visits` | `visits:view` (field principals: their own) | List + warnings |
| `GET /projects/:id/visit-plan/preview` | `visits:plan` | Draft and live; nothing written |
| `POST /projects/:id/visits/generate` | `visits:plan` | Runs the type plan (or one rule) |
| `POST /projects/:id/visits` | `visits:plan` | Create (`PLANNED` or `PROPOSED`) |
| `PATCH /projects/:id/visits/:visitId` | `visits:plan` | Move, reassign |
| `POST /projects/:id/visits/publish` | `visits:plan` | Many `PROPOSED` → `PLANNED` |
| `POST /projects/:id/visits/:visitId/cancel` | `visits:plan` | Reason required |
| `POST /projects/:id/visits/:visitId/rebuild-form` | `visits:plan` | Not started only |
| `POST /projects/:id/visits/:visitId/date-changes/:changeId/decide` | `visits:plan` | Accept / reject a proposal |
| `GET /projects/:id/visits/:visitId` | `visits:view` | Visit, date history, submissions, comments |
| `POST /projects/:id/visits/:visitId/submissions/:submissionId/review` | chain step | Approve / return |
| `POST /projects/:id/visits/:visitId/comments` | `visits:view` | Comment thread |
| `GET/POST /projects/:id/scope/sprints/:sprintId/verification` | `boq:view` / `sprints:verify` | Verification view / record |
| `GET /projects/:id/findings`, `POST .../findings/:findingId/resolve`, `.../dismiss`, `POST /projects/:id/visits/:visitId/findings` | `inspections:view` / `inspections:manage_findings` | `/inspection-findings` alias until R5 |
| `GET /projects/:id/site-log` | `visits:view` | Unattached by default |

### Field (the contracts R5 consumes)

All under the existing mobile account token; project routes resolve the account's field session for the URL project (`guardProjectRoutes`). Every write is idempotent on a client UUID so the outbox can retry.

| Method and path | Body / response | Notes |
| :--- | :--- | :--- |
| `GET /api/v1/visits/mine?from&to` | `MyVisitsFeedDto` | Visits assigned to the caller across projects: default from 7 days back to 14 days ahead, plus every overdue, returned or proposal-pending visit; each with project card data (code, name, stage, current sprint, open findings, next visit) and `formVersion`. Drives the calendar and "My projects" |
| `GET /projects/:id/visits/:visitId/form` | `VisitFormDto` | Frozen snapshot + re-check items + sprint deliverables + units + geofence; `formVersion` (send `If-None-Match`; 304 when unchanged) |
| `GET /projects/:id/visits/field-pack` | `VisitFieldPackDto` | Library versions and project scope for offline unscheduled visits; open findings |
| `POST /projects/:id/visits/:visitId/respond` | `RespondToVisitRequest` → `VisitDto` | Confirm / move / propose / decline; `clientActionId` |
| `POST /projects/:id/visits/:visitId/check-in` | `VisitCheckInRequest` → `VisitDto` | `clientCheckInId`, device time, geotag |
| `POST /projects/:id/visits/:visitId/submissions` | `SubmitVisitRequest` → `VisitSubmissionDto` | `clientSubmissionId`, `formVersion`, answers, re-check answers, captures by `clientCaptureId` with question key and unit, site log entry ids, optional check-in, `confirmedAt`, summary; 201 created / 200 replay; 409 `CAPTURES_NOT_REGISTERED` is retryable |
| `POST /projects/:id/visits/unscheduled` | `CreateUnscheduledVisitRequest` → `VisitDto` | `clientVisitId`, type `AD_HOC`, date, picked facilities, template versions used |
| `POST /projects/:id/site-log` | `CreateSiteLogEntryRequest` → `SiteLogEntryDto` | `clientEntryId`; photo/voice name a registered capture |
| `GET /projects/:id/site-log?mine=true` | `SiteLogEntryDto[]` | Device reconciliation |
| `GET /projects/:id/findings?status=OPEN` | `FindingDto[]` | Project screen |
| Existing, unchanged | | `/auth/mobile/login`, `/auth/mobile/projects`, `/auth/mobile/projects/:id/session`, `/projects/:id/evidence/presign`, `/projects/:id/captures`, `/projects/:id/media`, `/projects/:id/notifications`, defects |

Route files stay thin; services own transactions and audit; responses go through explicit serializers; IDs from bodies (captures, site log entries, findings, units) are checked against the URL project.

---

## 8. Out of scope

Mobile screens, outbox kinds and SQLite storage for visits and the site log (R5); deleting workday reports, WBS chat, legacy inspections and the other D-R4.37 items (R5); 5-step setup, navigation regrouping, Overview stage bar, project timeline view, type editor regrouping (R6); role catalogue (M&E Manager, M&E Officer, Programme Manager) and renaming `InspectionFinding` (R7); ERP webhooks on sprint verified (spec 9, later); Needs Assessment.

---

## 9. Definition of done

- All six slices merged in order, each green at the time: `npm run typecheck` clean, `npm run lint` 0 errors, `npm --workspace=@insite/web run build` passes, server unit + route tests and mobile tests pass.
- On a seeded programme project: activation proposes the type's visit plan; the manager publishes it; an officer (API) confirms one visit, moves another within tolerance, proposes a date for a third; the manager accepts; a submission with per-unit photos is approved; a failed answer raises a finding that appears on the next visit's re-check list; the contractor email is in `consoleOutbox`; a mobilisation check completes "contractor on site"; a sprint is verified and the badge and KPIs follow.
- The field API in section 7 is covered by route tests that exercise replay and offline ordering (captures after submission → 409 then success).
- Streams, obligations and their jobs are gone; seed runs; docs updated.
- Web verified at least by typecheck, build and lint; note any browser click-through done or still owed.

---

## 10. Found during implementation

**Baseline (before R4a):** _to measure._

- Pre-existing, found while writing this plan: `server/package.json` `test:unit` still lists `src/tests/boq.parser.test.ts`, which R2d deleted (working tree). Check how `tsx --test` treats the missing path before taking the baseline, and remove it from the list.
