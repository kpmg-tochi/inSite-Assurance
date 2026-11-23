# Phase 16: Programme KPIs, Configuration Reference and End-to-End Demo

| | |
| :--- | :--- |
| **Status** | Implemented; migrated, seeded, unit- and route-tested; web click-through and device runs pending (see section 7) |
| **Depends on** | Phases 11–15 |
| **Unblocks** | Client demo and fine-tuning |
| **Read first** | [Master plan](saas_implementation_plan.md) sections 2, 3 and 6; [gap analysis](process_flow_gap_analysis.md) G8 and section 3 |

---

## 1. Overview

**Objective:** make the programme delivery work demonstrable and tunable.

1. **KPI dashboard:** the process flow defines a KPI for every stage. Compute them per project, project type, region and owning organisation, with targets set per project type.
2. **Configuration reference:** one document listing every setting added in Phases 11–15 (where it lives, default, what it changes), so the client conversation can go setting by setting.
3. **Demo dataset and script:** a seeded programme tenant with projects at every stage of both models, plus a presenter script.
4. **Click-through verification** of Phases 11–15 in the browser and on a device (the verification bar in CLAUDE.md).

**Out of scope:** BI tool integrations, custom KPI formulas written by tenants (catalogue only).

---

## 2. Context for the implementing agent

- Existing aggregate views: executive matrix and portfolio summary (`PortfolioExecutiveSummaryDto`), portfolio map, schedule badge, retention summary. Visibility through `buildProjectVisibilityWhere` (Phase 11 adds organisation-tree scope).
- Data sources by phase: obligations (Phase 8), approval actions with timestamps (Phase 7), contract milestones and kick-off (Phase 13), streams and inspections (Phase 14), CoC, handover, closure, ratings, lessons (Phase 15), valuations and tranche decisions (Phases 3, 7, 12).
- Project type snapshot (`projectTypeSnapshotJson`) holds the targets a project was created with.

---

## 3. Decisions

| Topic | Decision |
| :--- | :--- |
| Catalogue | KPIs are defined in shared code (key, label, stage, description, numerator, denominator, unit, direction). Tenants set targets and choose which to show per project type; they do not write formulas. |
| Computation | On request for the current period, from live data, with a daily `kpi-snapshot` job storing per-project values for trends. One `JobRun` per tenant-day. |
| Period filter | Month, quarter or custom range; KPIs that are not period-based (e.g. "% with supervisor assigned") show the current value. |
| Visibility | Same visibility as projects: a subsidiary sees its projects' KPIs; the flagship sees all with the tree permission. Permission `kpis:view`. |
| Missing data | A KPI whose inputs are not configured on a project (e.g. no inspection stream) shows "not tracked", never 0%. |

### KPI catalogue (initial)

| Stage | KPI | Source |
| :--- | :--- | :--- |
| Kick-off | % contracts with kick-off agenda prepared | Kick-off meeting with agenda document |
| Kick-off | Timeliness of notifications (% notices sent ≥ lead days before) | Kick-off notice milestone |
| Kick-off | Kick-off attendance rate | Invitees attended / invited |
| Kick-off | % meetings documented and signed | Minutes milestone |
| Mobilisation | % projects with supervisors assigned | Assignments with a supervisor role |
| Mobilisation | % letters of introduction issued on time | Milestone |
| Mobilisation | % contractors mobilised on time | Mobilisation milestones done by due date |
| Mobilisation | % projects with full mobilisation documentation | `beforeMobilisation` documents |
| M&E | % projects with monitoring framework established | Streams configured and project active |
| M&E | % sites with baseline data uploaded | Approved `BASELINE` inspection |
| M&E | % visits conducted vs planned | Inspection obligations met / due |
| M&E | % reports submitted online / on time | Obligations `SUBMITTED` (on time) / due |
| M&E | Average approval turnaround (days) | Approval actions |
| Payments | Payment milestone turnaround (verification → release) | Valuations and decisions |
| Payments | Financial utilisation (disbursed / budget) | Project amounts |
| Closure | % projects verified on time / delivered to specification | Final evaluation and CoC vs planned end |
| Closure | % projects handed over (within N days of CoC) | Handover milestone |
| Closure | % projects with full documentation | Closure checklist |
| Closure | % lessons learned documented | Lessons per closed project |
| Closure | % projects audited post-closure | Audit sign-off item |
| Schedule | Projects on schedule / behind | Phase 9 badge |

---

## 4. Schema changes

- New `KpiSnapshot (id, tenantId, projectId, kpiKey, periodStart, periodEnd, numerator, denominator, value Decimal?, computedAt)`, unique `(projectId, kpiKey, periodStart)`.
- `ProjectTypeConfigSchema.kpiTargets = { [kpiKey]: { target: number, shown: boolean } }`.
- Permission `kpis:view`; audit nothing new (read-only).

---

## 5. Implementation checklist

### Step 1: KPI engine
- [x] Shared catalogue and DTOs (`KpiDefinition`, `KpiValueDto`, `KpiDashboardDto`).
- [x] Server `modules/kpis/`: one function per KPI returning numerator and denominator for a project set and period; batched queries (no per-project N+1); unit tests with fixtures per KPI.
- [x] `GET /kpis?projectTypeId&regionId&owningOrganizationId&from&to` and `GET /projects/:id/kpis`.
- [x] `kpi-snapshot` job registered in `registerAllJobs()`.

### Step 2: Web
- [ ] Executive area "Programme KPIs" page: filters, KPIs grouped by stage, value vs target with status colour, trend sparkline from snapshots, drill-down to the contributing projects, CSV export.
- [ ] Project overview "KPIs" card with the project's values.
- [ ] Project type editor: "KPI targets" tab.
- [ ] Follow the dataviz guidance for charts; light and dark themes.

### Step 3: Configuration reference
- [x] `saas_updates/configuration_reference.md`: every tenant setting, project type key, process switch and permission added in Phases 11–15: where it is set, default, effect, and which process-flow control it serves. Written for the delivery team preparing client workshops.

### Step 4: Demo dataset
- [x] `seedPhase16.ts` on the programme tenant (adds to the reset list): about ten projects across both types, two regions and both subsidiaries, at every stage: draft with kick-off planned; mobilising on time; mobilisation overdue with a default case; active with weekly supervision, a late quarterly visit and an open finding; a fixed payment milestone awaiting release; CoC pending a signature; in retention with a defect; closed with post-closure evaluation pending; closed and archived with a closure pack.
- [x] Dates relative to the seed day (Phase 9 pattern) so KPIs and deadlines look live on any demo day.
- [x] Logins per persona for the demo, printed by the seed: flagship admin, subsidiary admin, Resident Supervisor (mobile, provisioned), M&E officer, contractor, beneficiary link.

### Step 5: Demo script
- [x] `saas_updates/demo_script_programme_delivery.md`, written for presenters: two storylines (Central and Co-Funded) mapped to the process flow slides, the login to use at each step, what to click, what to say, and which settings to change live to show configurability (terminology, registration policy, mobilisation days, CoC signatories).

### Step 6: Verification
- [ ] Browser click-through of every web flow from Phases 11–15 as each persona; record results in each phase's section 7.
- [ ] Device run of the Phase 12 assurance step and Phase 14 inspection flow; add them to `physical_testing_checklist.md`.
- [x] Full test suites, typecheck, lint (0 errors), web build.

---

## 6. Definition of done

- The KPI page shows every catalogue KPI for the seeded programme, filterable by model, region and organisation, with targets.
- The demo script runs end to end on a fresh seed without manual data fixes.
- Every setting is listed in the configuration reference.
- Phases 11–15 are clicked through and their checklists ticked only where verified.
- Master plan status updated.

## 7. Found during implementation

### 7.1 What was built (2026-11-23)

| Area | Files |
| :--- | :--- |
| Shared | `shared/src/schemas/kpi.schema.ts` (catalogue of 21 KPIs, `resolveKpiTargets`, `kpiValue`, `kpiStatus`, DTOs, `KpiQuerySchema`); `ProjectTypeConfigSchema.kpiTargets` (record of `{ target, shown }`, default `{}`); permission `kpis:view` (TSA, MON, LEN, OA). |
| Schema | `KpiSnapshot` (`kpi_snapshots`), migration `20261129090000_phase16_kpis`; added to the seed reset list. |
| Server | `modules/kpis/kpiEngine.ts` (one pure function per KPI), `kpiFacts.ts` (17 batched queries per project set, none per project), `kpis.service.ts`, `kpis.routes.ts` (`GET /api/v1/kpis`, `GET /api/v1/projects/:id/kpis` behind the project guard); job `jobs/kpiJobs.ts` (`kpi-snapshot`, one `JobRun` per tenant-day, backfills earlier months once for period-based KPIs). |
| Web | `/app/kpis` (`pages/kpis/ProgrammeKpisPage.tsx`, nav "Programme KPIs"), `components/kpis/KpiDisplay.tsx` (status chip with icon and label, sparkline with hover), `ProjectKpisCard` on the project dashboard, `components/deliveryModels/KpiTargetsEditor.tsx` in the project type editor. |
| Seed | `seedPhase16.ts` (see its header table): new PRG-104, PRG-105 and PRG-242; PRG-101 kick-off planned; PRG-103 defects from its handover snags; KPI targets on both types; `resident.supervisor@` (provisioned mobile) and `sahel.contractor@`; a beneficiary handover link on PRG-104; KPI snapshots for six months. |
| Docs | `configuration_reference.md`, `demo_script_programme_delivery.md`, `physical_testing_checklist.md` 3.9–3.10. |
| Tests | `kpis.phase16.test.ts` (18 unit tests, a fixture per KPI), `routes.phase16.test.ts` (15 route tests, incl. tenant time zone). Full suites: unit 246/246, routes 318/318; typecheck, lint (0 errors) and web build pass. |

On the fresh seed, all 21 KPIs are tracked for the programme administrator over the last 60 days (asserted in `routes.phase16.test.ts`).

### 7.2 Decisions made here

1. **Targets come from the live project type, not the snapshot.** Section 2 says the snapshot holds the targets a project was created with. Reading them from there would mean a changed target never reaches existing projects, which defeats setting targets for a running programme. Targets are reporting settings, not project rules, so the dashboard reads `kpiTargets` from the current type; the type's other rules still come from the snapshot. The editor and the configuration reference say so. Reverse this if the client wants targets frozen per project.
2. **When targets differ across the types in view**, the programme figure has no single target (`targetVaries`, status "no target") and the tile shows the per-type breakdown with each type's status.
3. **KPI definitions that needed a rule** (all in the catalogue descriptions):
   - Minutes are counted from 7 days after the meeting (`MINUTES_GRACE_DAYS`), or earlier once signed. Fixed, not configurable.
   - Mobilisation documents and the monitoring framework count projects under construction only. Supervisors and baseline count live projects until closed.
   - "Full closure documentation" checks the document items of the closure checklists against the register. Other item kinds are not counted.
   - "Verified on time" uses `originalPlannedEndDate ?? plannedEndDate`, and "to specification" means no `MAJOR_ISSUES` in the latest approved final evaluation.
   - Approval turnaround uses report `humanConfirmedAt → approvedCompletedAt` and inspection `confirmedAt → approvedAt`. Payment turnaround uses `certifiedAt → decidedAt` of non-HOLD, unreversed decisions, including retention releases.
   - Milestone on-time KPIs count milestones due in the period that are already due (or done early). Waived ones are excluded.
4. **The period** defaults to the current month on the API and to "this quarter" on the page. Drafts are excluded (decision C); archived projects are included, for the closure KPIs.
5. **Seed shortcuts** (seed history only, everything else through the real services):
   - PRG-105's milestone 1–2 items were set to 100% certified so the fixed milestones can be verified without seeded evidence.
   - Milestone 1's verification and release were moved back to 21 and 12 days ago.
   - Earlier contract milestones of the new projects are marked done the day before they were due.
   - The programme tenant's `INDEPENDENT_RESIDENT` role was switched to a provisioned account through `updateRoleForTenant`. That deactivates the programme tenant's resident join codes; the default tenant is unchanged.
6. Phase 11 route tests asserted the seeded programme project lists and portfolio totals; they now include PRG-104, PRG-105 and PRG-242.

### 7.2a Follow-up (2026-11-23, owner request): every type setting editable; KPIs in the tenant time zone

- **Type editor covers every `ProjectTypeConfig` key.** New sections:
  - "Required documents and contractor default" (`DocumentRulesEditor`: before activation and before mobilisation; Legal role; auto-open on overdue mobilisation).
  - "Monitoring: streams, inspections and supervision" (`MonitoringRulesEditor`: streams with key, kind, roles by code, every cadence field, visit type and upload deadline; checklist template per visit type; supervisor roles and the two limits).

  Also: the full Reporting defaults (working days, period start, custom length, quarter month, first period date, due time, grace, through the shared `CadenceFields`); the expected disbursement mechanism under payments; "needs a sign-off" on document checklist items. `beneficiarySignatureMode` has one value only, so it has no control.
- **Bug fixed on the way.** The editor used to rebuild `reportingDefaults` from cadence and hours only, so saving a type silently dropped its other reporting fields. It now keeps and edits the whole object.
- **Read access widened.** `GET /rbac/roles` and `GET /inspection-templates` now also accept `project_types:manage`, so a type manager without role or inspection permissions can fill the pickers. The Phase 13 milestone editor had the same gap. Both lists are read-only.
- **KPIs follow `Tenant.timezone`.** The default period, the page presets, the snapshot job's day (`JobRun` scope key) and month, and the trend months are the tenant's. Events counted into a period (approvals, release decisions, CoC issue) are dated in the tenant's zone; project deadlines, the kick-off day and on-time checks stay in the project's zone. DTOs carry `timeZone`, and the page shows it beside the period. An unknown zone falls back to `Africa/Lagos` (`safeZone`). Covered by three route tests (a tenant in `Pacific/Kiritimati` at 12:00 UTC on 30 November gets December).

### 7.3 Outstanding and found

- **Not verified in a browser.** The Programme KPIs page, the KPI card and the KPI targets editor are verified by typecheck, lint, the web build and the API tests only. The Playwright browser was held by another session, so the Phase 16 click-through and the Phase 11–15 click-through (Step 6) were not done. **The demo script has not been rehearsed end to end.** That definition-of-done item is open.
- **Device runs not done.** They are listed in `physical_testing_checklist.md` 3.7, 3.9 and 3.10.
- **No dark theme exists in the web app.** The KPI charts take their colours from CSS custom properties (`--kpi-good`, `--kpi-trend`, `--kpi-accent` and others) with light fallbacks, so a theme can set them in one place. No dark theme was built (out of scope).
- **Status colour for "near target".** The page uses a darker amber (`#c98a00`) than the dataviz reference warning step (`#fab219`, contrast 1.79 on white). It is used on the icon only, next to a text label.
- **Trends start with backfilled months.** The first snapshot backfills five earlier months for period-based KPIs from today's data (for example, an obligation excused later shows as excused in the past month). Non-period KPIs have history only from the first daily snapshot.
- The "Visits conducted" and "Reports on time" figures depend on obligations the cadence jobs generate as days pass. On a fresh seed they reflect the Phase 14 seeded obligations only.
- No dataviz palette validator run was needed: no categorical palette is used. Series identity in the per-type breakdown is by name, not colour.
