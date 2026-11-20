# Phase 16: Programme KPIs, Configuration Reference and End-to-End Demo

| | |
| :--- | :--- |
| **Status** | Not started |
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
- [ ] Shared catalogue and DTOs (`KpiDefinition`, `KpiValueDto`, `KpiDashboardDto`).
- [ ] Server `modules/kpis/`: one function per KPI returning numerator and denominator for a project set and period; batched queries (no per-project N+1); unit tests with fixtures per KPI.
- [ ] `GET /kpis?projectTypeId&regionId&owningOrganizationId&from&to` and `GET /projects/:id/kpis`.
- [ ] `kpi-snapshot` job registered in `registerAllJobs()`.

### Step 2: Web
- [ ] Executive area "Programme KPIs" page: filters, KPIs grouped by stage, value vs target with status colour, trend sparkline from snapshots, drill-down to the contributing projects, CSV export.
- [ ] Project overview "KPIs" card with the project's values.
- [ ] Project type editor: "KPI targets" tab.
- [ ] Follow the dataviz guidance for charts; light and dark themes.

### Step 3: Configuration reference
- [ ] `saas_updates/configuration_reference.md`: every tenant setting, project type key, process switch and permission added in Phases 11–15: where it is set, default, effect, and which process-flow control it serves. Written for the delivery team preparing client workshops.

### Step 4: Demo dataset
- [ ] `seedPhase16.ts` on the programme tenant (adds to the reset list): about ten projects across both types, two regions and both subsidiaries, at every stage: draft with kick-off planned; mobilising on time; mobilisation overdue with a default case; active with weekly supervision, a late quarterly visit and an open finding; a fixed payment milestone awaiting release; CoC pending a signature; in retention with a defect; closed with post-closure evaluation pending; closed and archived with a closure pack.
- [ ] Dates relative to the seed day (Phase 9 pattern) so KPIs and deadlines look live on any demo day.
- [ ] Logins per persona for the demo, printed by the seed: flagship admin, subsidiary admin, Resident Supervisor (mobile, provisioned), M&E officer, contractor, beneficiary link.

### Step 5: Demo script
- [ ] `saas_updates/demo_script_programme_delivery.md`, written for presenters: two storylines (Central and Co-Funded) mapped to the process flow slides, the login to use at each step, what to click, what to say, and which settings to change live to show configurability (terminology, registration policy, mobilisation days, CoC signatories).

### Step 6: Verification
- [ ] Browser click-through of every web flow from Phases 11–15 as each persona; record results in each phase's section 7.
- [ ] Device run of the Phase 12 assurance step and Phase 14 inspection flow; add them to `physical_testing_checklist.md`.
- [ ] Full test suites, typecheck, lint (0 errors), web build.

---

## 6. Definition of done

- The KPI page shows every catalogue KPI for the seeded programme, filterable by model, region and organisation, with targets.
- The demo script runs end to end on a fresh seed without manual data fixes.
- Every setting is listed in the configuration reference.
- Phases 11–15 are clicked through and their checklists ticked only where verified.
- Master plan status updated.

## 7. Found during implementation

*(empty)*
