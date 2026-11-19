# Phase 9: Schedule Variance and "Catch Project Up" Re-Baselining

| | |
| :--- | :--- |
| **Status** | Implemented; web clicked through; mobile inbox on-device check pending (see section 7) |
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
- New `ScheduleRevision (id, projectId, revisionNumber, initiatedByUserId, approvedByUserId?, status DRAFT|PENDING_APPROVAL|APPLIED|REJECTED|WITHDRAWN, reason, previousProjectedEndDate, newProjectedEndDate, totalShiftedWorkdays, itemAdjustmentsJson, createdAt, decidedAt?)`.
- Audit actions: `SCHEDULE_BASELINE_SET`, `SCHEDULE_REVISION_PROPOSED`, `SCHEDULE_REVISION_APPLIED`, `SCHEDULE_REVISION_REJECTED`, `SCHEDULE_REVISION_WITHDRAWN`.

Dates are `YYYY-MM-DD` strings in the tenant timezone, consistent with `workdayDate`.

---

## 5. Implementation checklist

### Step 1: Shared schedule maths
- [x] `shared/src/utils/schedule.ts`, pure functions:
  - `addWorkdays(date, n, workWeekDays)` and `workdaysBetween(a, b, workWeekDays)`
  - `expectedPctAt(item, date)`: linear between planned start and end
  - `itemVariance(item, progressPct, today)` returns workdays ahead or behind and a status (`NOT_STARTED`, `ON_TRACK`, `AHEAD`, `BEHIND`, `COMPLETE`, `UNSCHEDULED`)
  - `projectVariance(items)`: budget-weighted, plus the projected end date from remaining work at planned rates
  - `propagateShift(items, dependencies, changes)`: returns new dates for all affected successors, respecting lag and the work-week; detects cycles
  - `formatVariance(workdays)`: "On schedule", "1 week ahead", "4 weeks behind"
- [x] Table-driven tests for each, including a six-day week, dependency chains, diamonds and a cycle. (`server/src/tests/schedule.phase9.test.ts`, 49 cases; also covers `validateScheduleBaseline`, `proposeItemDates`, `itemPeriodStatus`.)

### Step 2: Server
- [x] Baseline endpoints (`projects:edit_baseline`): set project dates; bulk set item dates and dependencies; validate items fall within project dates, successors do not start before predecessors finish plus lag, and there are no cycles. First save sets the original baseline and writes `SCHEDULE_BASELINE_SET`.
- [x] Optional helper: propose item dates from the BOQ order, quantities and `dailyTargetQuantity` between project start and end, for the user to adjust. Suggestion only.
- [x] `actualStartDate` is set on the first confirmed report for an item; `actualCompletionDate` when certified progress reaches 100.
- [x] `GET /projects/:projectId/schedule` (`schedule:view_variance`): items with planned, original, actual dates, both progress measures, variance, dependencies, project summary and projected end.
- [x] Portfolio and executive summaries include each project's variance badge.
- [x] Revision flow:
  - `POST .../schedule/revisions/preview` (`schedule:catch_up_refactor`): input is a list of delayed items with new dates or a shift in workdays, plus a reason; output is the propagated plan and the new projected end. Nothing is saved.
  - `POST .../schedule/revisions`: saves as `PENDING_APPROVAL`, or applies at once if the projected end is unchanged.
  - `POST .../schedule/revisions/:id/approve` and `/reject` (`schedule:approve_refactor`, not the initiator).
  - Applying writes new item dates and `currentProjectedEndDate` in one transaction with `SCHEDULE_REVISION_APPLIED`; originals untouched.
  - Only one pending revision per project.
- [x] `brief-dispatch` (Phase 8) chooses items whose planned window overlaps the reporting period, plus up to three unblocked fallback items whose predecessors are complete. Remove reads of `isScheduledToday`; keep `planningTier` only as a manual override.
- [x] `schedule-variance` job: daily, recompute and store each project's variance badge; raise a web notification when a project crosses a "behind" threshold (default two weeks) for the first time.

### Step 3: Web
- [x] Wizard: add a "Schedule" step after "BOQ" (optional for activation; placed after "Reporting", see section 7 item 4): project dates, item dates in a table with the "propose dates" helper, dependencies by picking predecessors.
- [x] Project "Schedule" tab: a simple timeline (rows are BOQ items grouped by section; bars for original, current planned and actual; a today line), variance column, both progress measures. Build it with plain SVG or CSS grid; do not add a Gantt dependency unless it is clearly lighter than writing it.
- [x] "Catch Project Up" wizard: (1) choose delayed items, suggested from variance; (2) enter new dates or a shift; (3) preview with before and after, the list of moved items and the new end date; (4) reason and submit.
- [x] Revision history list with status, initiator, approver and a diff view. Approve and reject actions for eligible users; withdraw for the proposer.
- [x] Variance badges on the directory, dashboard and executive matrix.

### Step 4: Mobile
- [ ] Inbox shows each item's planned window and a simple status (due this period, upcoming, overdue). Built (SQLite v5, `itemPeriodStatus`); verified by typecheck and the migration test only, not on a device.
- [x] No schedule editing on mobile.

### Step 5: Seed and tests
- [x] Seed one project on schedule, one four weeks behind with a pending revision. (`server/src/db/seedPhase9.ts`: ABJ-108 on schedule; LKK-402 exactly 24 working days behind with revision 1 pending; dated relative to the seed day.)
- [x] Server tests (`server/src/tests/routes.phase9.test.ts`, 18 tests): baseline validation; variance for fixtures; preview equals applied result; approval rules (initiator cannot approve; unchanged end date applies at once); original baseline survives two revisions; brief item selection follows planned windows.

---

## 6. Definition of done

- Every project with a baseline shows an explainable variance in working weeks.
- A catch-up revision moves all dependent dates, is approved by a second person when it moves the end date, and is fully reconstructible from the ledger and revision history.
- Briefs are driven by planned dates.
- Master plan status updated.

## 7. Found during implementation

**Verification (2026-11-19):** `npm run typecheck` clean; server 165 unit + 194 route tests pass; mobile 61 tests pass; web build passes. Browser click-through as monitor and lender: schedule page and timeline, approving a pending revision (lender), the Catch Project Up wizard through to an immediate apply (monitor), the settings Schedule step in locked mode with inline dependency validation, badges on the directory, dashboard and executive matrix. Not done: draft-wizard click-through of the Schedule step (route test only); mobile inbox on a device.

**Decisions taken where the plan was silent**

| Topic | Decision |
| :--- | :--- |
| Variance sign | Positive = ahead, negative = behind, in working days; stored rounded to the nearest half week. |
| Variance method | Earned schedule: progress x planned working days, minus working days elapsed before today (today's work is not due yet). Within half a week = on schedule. |
| Project variance | Budget-weighted mean of item variances (equal weights without budgets). A forecast end (remaining work at planned rates, pushed through dependencies) is shown beside it. |
| Reported progress | Counted report quantities summed per item and persona (contractor and verifier describe the same work); the larger persona total is used, capped at 100% and never below certified. `evidenceProvider.getReportedProgressByItem`. |
| Original baseline | While a draft, the original follows the plan on every save; from activation it is set once per item and never overwritten. |
| Baseline after activation | Project dates and dated items are locked (409 `SCHEDULE_BASELINE_LOCKED`) and move only through a revision. Undated items (e.g. from a BOQ revision) can still be dated, and dependencies edited. |
| "Projected end" | `currentProjectedEndDate` = latest planned item end. A revision "moves the end" when that changes. A plan that would end earlier keeps the recorded end. |
| Revision inputs | Per item: a new start date or a shift in working days; durations kept. Successors are only pushed later, never pulled earlier. |
| Approval | Stored adjustments are applied as-is after checking every item still has its "previous" dates (else 409 `SCHEDULE_REVISION_STALE`), so applied = previewed. No new revision while one is pending (also partial unique index `schedule_revisions_one_pending_per_project`, hand-written, keep it). The rejecter is stored in `approvedByUserId` (DTO: `decidedBy*`). |
| Briefs | Scheduled = window overlaps the period, or ended before it and the item is not done (overdue work stays due), or `planningTier = PLAN_A` (manual override). "Done" = certified 100% or reported 100%. Fallbacks: up to three not-done items whose predecessors are all done, earliest planned start first. Brief tier is now PLAN_A / FALLBACK_BACKLOG from this selection. |
| `isScheduledToday` | Removed from the schema, server, seed, tests and mobile reads (the mobile SQLite column stays, unused). |
| Alerts | `schedule-variance` runs hourly, one JobRun per project per project-day; alerts `schedule:view_variance` holders once at 2+ working weeks behind (`SCHEDULE_BEHIND_ALERT_WEEKS`), re-arms after recovery. Revision pending/decided notifications go to `schedule:approve_refactor` / `schedule:catch_up_refactor`. |
| Extra columns | `Project.scheduleStatus`, `scheduleVarianceWorkdays`, `scheduleVarianceComputedAt`, `scheduleBehindAlertedAt`; `ScheduleRevision.decisionNotes`. |

**Open items and defects found (not fixed here)**

1. `npm run lint` reports 1 error in `server/src/integrations/textExtractor.ts:29` (`no-control-regex`). Pre-existing (file untouched since e00f453); CLAUDE.md expects 0 errors.
2. ~~The initiator of a pending revision cannot withdraw it.~~ Resolved 2026-11-19: `POST .../schedule/revisions/:id/withdraw` (`schedule:catch_up_refactor`, proposer only, pending only). Status `WITHDRAWN`, audit `SCHEDULE_REVISION_WITHDRAWN`, no dates change, approvers get a notification, and the pending slot is freed. Route-tested and clicked through.
3. The schedule uses the project's current `workWeekDays`; a pending cadence change (Phase 8 `pendingCadenceJson`) is ignored, and a later work-week change alters item durations in working days (dates stay).
4. ~~The Schedule step came before the Reporting step that sets the work-week.~~ Resolved 2026-11-19: the Schedule step now follows Reporting (order 61, still after BOQ as the plan asks), so dates are entered against the project's real work-week.
5. Mobile "Overdue" uses certified progress (what the device has), so an item reported complete but not yet certified shows overdue until certification.
6. Seeded LKK-402 items have no dependencies: their four-weeks-behind windows overlap, so no finish-to-start link is valid. ABJ-108 has one.
