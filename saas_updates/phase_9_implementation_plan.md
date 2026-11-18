# Phase 9: Schedule Variance and "Catch Project Up" Re-Baselining

| | |
| :--- | :--- |
| **Status** | Not started |
| **Depends on** | Phase 6 (wizard, contractors), Phase 8 (work-week rules, period maths, job runner) |
| **Unblocks** | none |
| **Read first** | [Master plan](saas_implementation_plan.md) sections 2, 3 and 6 |

---

## 1. Overview

**Objective:** give every project a planned timeline at BOQ-item level, show how far ahead or behind it is, and provide a controlled way to re-baseline downstream dates when a delay is accepted.

**In scope:** planned and actual dates on projects and BOQ items, dependencies, a variance engine, a schedule view, the "Catch Project Up" wizard with approval and audit, and using planned dates to decide which items are scheduled in a reporting period.

**Out of scope:** resource levelling, critical-path optimisation, importing from scheduling tools. Keep it a simple, explainable model.

---

## 2. Context for the implementing agent

- Neither `Project` nor `BoqItem` stores dates. `BoqItem` has `isScheduledToday`, `planningTier` (`PLAN_A`, `FALLBACK_BACKLOG`, `UNBLOCKED_POOL`) and `dailyTargetQuantity`, set by hand or seed. Phase 8's `brief-dispatch` job still uses those flags to choose items.
- `BoqItem.cumulativeCertifiedPct` is the certified progress (written only by certification, Phase 3). `Project.certifiedProgressPct` is the budget-weighted mean.
- Verified-but-not-yet-certified progress is available from `evidenceProvider.ts` (Phase 4): approved or confirmed report quantities per item.
- Work-week rules and timezone-aware date helpers are in `shared/src/utils/reportingPeriod.ts` (Phase 8). Use `listWorkdaysInPeriod` for all working-day arithmetic.
- Permissions `schedule:view_variance`, `schedule:catch_up_refactor`, `schedule:approve_refactor` exist in the catalog and gate nothing yet.
- Phase 7 has approval chains for reports and disbursements. A schedule revision needs only a single approval, so it does not use the chain tables.
- BOQ items can be revised after activation through `BoqRevision` (Phase 6).

---

## 3. Decisions

**No owner input required.** Assumptions:

| Assumption | Detail |
| :--- | :--- |
| Two progress measures are shown | "Certified" (from valuations) and "Reported" (from field evidence). Variance badges use certified progress by default, with reported progress shown beside it, because certified lags by design. |
| Variance is expressed in working weeks | Rounded to the nearest half week, using the project's work-week. |
| Catch-up shifts dates, not rates | Daily production targets stay as they are; durations stay; start and end dates move. |
| Approval | A revision that moves the project's projected end date needs approval by a user with `schedule:approve_refactor` who is not the initiator. A revision that does not move the end date applies immediately. |
| Original baseline is never overwritten | First planned dates are kept as the original baseline; each revision is recorded. |

---

## 4. Schema changes

- `Project`: add `plannedStartDate String?`, `plannedEndDate String?`, `originalPlannedEndDate String?`, `currentProjectedEndDate String?`, `actualStartDate String?`.
- `BoqItem`: add `plannedStartDate String?`, `plannedEndDate String?`, `originalPlannedStartDate String?`, `originalPlannedEndDate String?`, `actualStartDate String?`, `actualCompletionDate String?`. Deprecate `isScheduledToday` (remove once nothing reads it).
- New `BoqItemDependency (id, projectId, predecessorBoqItemId, successorBoqItemId, lagWorkdays Int @default(0))`, unique on the pair. Finish-to-start only.
- New `ScheduleRevision (id, projectId, revisionNumber, initiatedByUserId, approvedByUserId?, status DRAFT|PENDING_APPROVAL|APPLIED|REJECTED, reason, previousProjectedEndDate, newProjectedEndDate, totalShiftedWorkdays, itemAdjustmentsJson, createdAt, decidedAt?)`.
- Audit actions: `SCHEDULE_BASELINE_SET`, `SCHEDULE_REVISION_PROPOSED`, `SCHEDULE_REVISION_APPLIED`, `SCHEDULE_REVISION_REJECTED`.

Dates are `YYYY-MM-DD` strings in the tenant timezone, consistent with `workdayDate`.

---

## 5. Implementation checklist

### Step 1: Shared schedule maths
- [ ] `shared/src/utils/schedule.ts`, pure functions:
  - `addWorkdays(date, n, workWeekDays)` and `workdaysBetween(a, b, workWeekDays)`
  - `expectedPctAt(item, date)`: linear between planned start and end
  - `itemVariance(item, progressPct, today)` returns workdays ahead or behind and a status (`NOT_STARTED`, `ON_TRACK`, `AHEAD`, `BEHIND`, `COMPLETE`, `UNSCHEDULED`)
  - `projectVariance(items)`: budget-weighted, plus the projected end date from remaining work at planned rates
  - `propagateShift(items, dependencies, changes)`: returns new dates for all affected successors, respecting lag and the work-week; detects cycles
  - `formatVariance(workdays)`: "On schedule", "1 week ahead", "4 weeks behind"
- [ ] Table-driven tests for each, including a six-day week, dependency chains, diamonds and a cycle.

### Step 2: Server
- [ ] Baseline endpoints (`projects:edit_baseline`): set project dates; bulk set item dates and dependencies; validate items fall within project dates, successors do not start before predecessors finish plus lag, and there are no cycles. First save sets the original baseline and writes `SCHEDULE_BASELINE_SET`.
- [ ] Optional helper: propose item dates from the BOQ order, quantities and `dailyTargetQuantity` between project start and end, for the user to adjust. Suggestion only.
- [ ] `actualStartDate` is set on the first confirmed report for an item; `actualCompletionDate` when certified progress reaches 100.
- [ ] `GET /projects/:projectId/schedule` (`schedule:view_variance`): items with planned, original, actual dates, both progress measures, variance, dependencies, project summary and projected end.
- [ ] Portfolio and executive summaries include each project's variance badge.
- [ ] Revision flow:
  - `POST .../schedule/revisions/preview` (`schedule:catch_up_refactor`): input is a list of delayed items with new dates or a shift in workdays, plus a reason; output is the propagated plan and the new projected end. Nothing is saved.
  - `POST .../schedule/revisions`: saves as `PENDING_APPROVAL`, or applies at once if the projected end is unchanged.
  - `POST .../schedule/revisions/:id/approve` and `/reject` (`schedule:approve_refactor`, not the initiator).
  - Applying writes new item dates and `currentProjectedEndDate` in one transaction with `SCHEDULE_REVISION_APPLIED`; originals untouched.
  - Only one pending revision per project.
- [ ] `brief-dispatch` (Phase 8) chooses items whose planned window overlaps the reporting period, plus up to three unblocked fallback items whose predecessors are complete. Remove reads of `isScheduledToday`; keep `planningTier` only as a manual override.
- [ ] `schedule-variance` job: daily, recompute and store each project's variance badge; raise a web notification when a project crosses a "behind" threshold (default two weeks) for the first time.

### Step 3: Web
- [ ] Wizard: add a "Schedule" step after "BOQ" (optional for activation): project dates, item dates in a table with the "propose dates" helper, dependencies by picking predecessors.
- [ ] Project "Schedule" tab: a simple timeline (rows are BOQ items grouped by section; bars for original, current planned and actual; a today line), variance column, both progress measures. Build it with plain SVG or CSS grid; do not add a Gantt dependency unless it is clearly lighter than writing it.
- [ ] "Catch Project Up" wizard: (1) choose delayed items, suggested from variance; (2) enter new dates or a shift; (3) preview with before and after, the list of moved items and the new end date; (4) reason and submit.
- [ ] Revision history list with status, initiator, approver and a diff view. Approve and reject actions for eligible users.
- [ ] Variance badges on the directory, dashboard and executive matrix.

### Step 4: Mobile
- [ ] Inbox shows each item's planned window and a simple status (due this period, upcoming, overdue).
- [ ] No schedule editing on mobile.

### Step 5: Seed and tests
- [ ] Seed one project on schedule, one four weeks behind with a pending revision.
- [ ] Server tests: baseline validation; variance for fixtures; preview equals applied result; approval rules (initiator cannot approve; unchanged end date applies at once); original baseline survives two revisions; brief item selection follows planned windows.

---

## 6. Definition of done

- Every project with a baseline shows an explainable variance in working weeks.
- A catch-up revision moves all dependent dates, is approved by a second person when it moves the end date, and is fully reconstructible from the ledger and revision history.
- Briefs are driven by planned dates.
- Master plan status updated.

## 7. Found during implementation

_Add items here rather than expanding scope._
