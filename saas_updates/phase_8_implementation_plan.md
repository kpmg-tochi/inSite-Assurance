# Phase 8: Reporting Cadence, Late Reports, Mobilization and Attendance Alerts

| | |
| :--- | :--- |
| **Status** | Not started |
| **Depends on** | Phase 5 (provisioned users), Phase 6 (contractors, drafts, tenant timezone), Phase 7 (persona briefs, report statuses) |
| **Unblocks** | Phase 9 |
| **Read first** | [Master plan](saas_implementation_plan.md) sections 2, 3 and 6 |

This phase merges the original cadence and mobilization phases because both are about scheduled work: deciding what is due when, and telling people.

---

## 1. Overview

**Objective**
1. Make reporting cadence real: briefs go out at the start of each reporting period, reports have a due time, late and missing reports are flagged.
2. Let admins pre-register who is expected on a project and when, remind them to get set up, and raise an alert when someone expected does not check in.

**In scope:** a reliable job runner, period calculation, late and overdue handling, a notification channel for people without the app, expected-participant roster, reminders, no-show and missed check-in alerts, manual check-in on mobile.

**Out of scope:** schedule variance (Phase 9).

---

## 2. Context for the implementing agent

**Cadence today**
- `Project.reportingCadence` (`DAILY`, `WEEKLY`, `BI_WEEKLY`, `INSPECTION_ONLY`) is stored and shown, and drives nothing.
- [morningBriefCron.ts](../server/src/jobs/morningBriefCron.ts) is a `setInterval` every 15 minutes in the API process. It loads every project and generates daily briefs once the project's `workdayStartTime` has passed. It will run once per API instance if the API is scaled out.
- `getTodayWatDateString` adds one hour to UTC. Phase 6 replaced fixed-offset helpers with tenant-timezone helpers; use those.
- `BoqItem.isScheduledToday` and `planningTier` decide which items get briefs. Reports are keyed by `workdayDate`.
- Mobile reads none of this. Strings and state are daily: "Daily Report", "Submitted Today", `isReportedToday`, telemetry between 07:00 and 19:00 device time. After Phase 4, "reported" is derived from reports for the current period, so this phase only has to define the period.

**Mobilization today**
- People exist only after they join (a `FieldAgentSession`) or, after Phase 5, when a provisioned user first opens a project. There is no record of who is expected.
- `ProjectContractor.plannedMobilizationDate` exists from Phase 6.
- `SiteTelemetryPing.pingSource` already includes `MANUAL_CHECKIN`; the permission `field:manual_checkin` exists; nothing in the app sends one.
- Permissions `mobilization:manage_roster`, `mobilization:configure_reminders`, `presence:manage_noshow_alerts` exist and gate nothing yet (roster is used for join codes since Phase 2).
- The platform can send push notifications to registered devices and in-app notifications. It has **no email or SMS capability**.

---

## 3. Decisions

**Needs owner input**

| ID | Question | Default being built |
| :--- | :--- | :--- |
| D-8.1 | Which channel and provider reaches people who have not installed the app (email, SMS, both)? In Nigeria, SMS or WhatsApp will reach site staff more reliably than email, but costs per message and needs a provider account and sender registration. | An outbound-message service with an adapter interface. Email adapter first (provider chosen by env, console adapter in dev). SMS adapter slot left empty. Push and in-app are always used when a device is registered. |

**Made here**
- Jobs run in the API process, guarded by a database lock so only one instance runs each job, and each job is idempotent. A dedicated queue can replace this later without changing job code.
- All period maths lives in one pure module in `shared`, so server, web and mobile agree.
- A late report is accepted and flagged, never refused.
- Excusing an alert requires a note and is audited.

---

## 4. Schema changes

**Cadence**
- `ReportingCadence`: add `MONTHLY`, `CUSTOM_INTERVAL`.
- `Project`: add `workWeekDays Int[] @default([1,2,3,4,5,6])` (ISO weekdays), `periodStartDayOfWeek Int @default(1)`, `customIntervalDays Int?`, `reportDueTime String?` (defaults to `workdayEndTime`), `reportGraceMinutes Int @default(0)`, `cadenceAnchorDate String?` (for bi-weekly and custom).
- `MorningDeliverableBrief` and `WorkdayReport`: add `reportingPeriodStart String`, `reportingPeriodEnd String`, `dueAt DateTime`. Brief uniqueness becomes `(projectId, boqItemId, reportingPeriodStart, targetPersona)`. Keep `workdayDate` on reports as the day the work was done.
- `WorkdayReport`: add `isLateSubmission Boolean @default(false)`, `lateByMinutes Int?`.
- New `ReportingObligation (id, projectId, boqItemId, reporterScope, periodStart, periodEnd, dueAt, status PENDING|SUBMITTED|LATE|MISSED|EXCUSED, workdayReportId?, alertedAt?)`. `reporterScope` identifies who owes it: a `projectContractorId`, or "verifier" for the monitoring side. Unique on `(projectId, boqItemId, reporterScope, periodStart)`.

**Mobilization**
- `ExpectedProjectParticipant (id, projectId, projectContractorId?, roleId, userId?, fullName, email?, phoneNumber?, plannedMobilizationDate String, expectedCheckInTime String, checkInGraceMinutes Int @default(120), reminderOffsetsDays Int[] @default([7,3,1]), lastReminderSentAt?, linkedFieldSessionId?, mobilizationStatus INVITED|REGISTERED_PENDING_ASSURANCE|READY_FOR_MOBILIZATION|MOBILIZED_ON_SITE|NO_SHOW_FLAGGED|WITHDRAWN, createdByUserId, createdAt)`.
- `SiteAttendanceAlert (id, projectId, participantId?, fieldSessionId?, workdayDate, alertType MOBILIZATION_NO_SHOW|WORKDAY_MISSED_CHECKIN|UNVERIFIED_AT_MOBILIZATION, status OPEN|ACKNOWLEDGED|EXCUSED|RESOLVED, resolvedByUserId?, resolutionNotes?, createdAt)`, unique on `(projectId, participantId, workdayDate, alertType)`.

**Infrastructure**
- `JobRun (id, jobName, scopeKey, startedAt, finishedAt, status, detail)`, unique on `(jobName, scopeKey)` for idempotency (for example `brief-dispatch` + `projectId:periodStart`).
- `OutboundMessage (id, tenantId, projectId?, channel EMAIL|SMS|PUSH, toAddress, templateKey, payloadJson, status QUEUED|SENT|FAILED, providerMessageId?, error?, createdAt, sentAt?)`.

**Audit actions:** `REPORT_SUBMITTED_LATE`, `REPORT_MISSED`, `PARTICIPANT_PREREGISTERED`, `PARTICIPANT_REMINDER_SENT`, `ATTENDANCE_ALERT_RAISED`, `ATTENDANCE_ALERT_RESOLVED`, `MANUAL_CHECKIN_RECORDED`.

---

## 5. Implementation checklist

### Step 1: Period maths (shared)
- [ ] `shared/src/utils/reportingPeriod.ts`, pure functions taking cadence settings, an IANA timezone and an instant:
  - `getReportingPeriod(...)` returns `{ periodStart, periodEnd, dueAt, isWorkday }`
  - `listWorkdaysInPeriod(...)`
  - `nextPeriodStart(...)`
- [ ] Rules: `DAILY` period is one workday, due at the due time that day. `WEEKLY` starts on `periodStartDayOfWeek`, ends on the last configured workday of that week. `BI_WEEKLY` and `CUSTOM_INTERVAL` count from `cadenceAnchorDate`. `MONTHLY` is the calendar month, due on its last workday. `INSPECTION_ONLY` has no periods and no obligations.
- [ ] Table-driven tests including week boundaries, a six-day week, a period that starts on a non-workday, month ends, and a timezone other than Lagos.

### Step 2: Job runner
- [ ] `server/src/jobs/runner.ts`: registers named jobs with an interval; each tick takes `pg_try_advisory_lock` for the job; each unit of work claims a `JobRun` row first and skips if it exists.
- [ ] Jobs only consider `ACTIVE` projects in tenants that are not suspended.
- [ ] Replace `morningBriefCron.ts` with a `brief-dispatch` job. Failures are logged per project and do not stop the loop.
- [ ] An env switch to disable jobs in a given process (so a future worker process can own them).

### Step 3: Cadence-aware briefs and obligations
- [ ] `brief-dispatch`: at a project's period start (first workday of the period, at `workdayStartTime` in the tenant timezone), generate briefs per persona covering the period's scope, set period fields and `dueAt`, and create `ReportingObligation` rows for each item and reporter scope that owes a report.
- [ ] For weekly and longer periods, the brief describes the period's deliverables, not one day's. Adjust the prompt and fallback wording by cadence.
- [ ] Which items are in scope: keep `planningTier` and `isScheduledToday` for now (Phase 9 replaces this with planned dates); rename the flag's meaning in code comments to "scheduled this period".
- [ ] Report submission: compute the period from the work date, attach period fields, mark late against `dueAt + grace`, fulfil the matching obligation, write `REPORT_SUBMITTED_LATE` when late.
- [ ] `overdue-reports` job: after `dueAt + grace`, mark unfulfilled obligations `MISSED`, notify the reporter (push and in-app) and users with `reports:view_all` (web notification), write `REPORT_MISSED` once.
- [ ] Changing cadence on an active project takes effect from the next period; open obligations are left as they are.

### Step 4: Outbound messages (D-8.1)
- [ ] `server/src/integrations/messaging/`: `sendMessage({ channel, to, templateKey, data })` writes an `OutboundMessage` and hands it to an adapter. Adapters: console (dev), one email provider behind env configuration, push (wrapping the existing push sender). Retries with backoff by a `message-dispatch` job.
- [ ] Templates as plain functions in code with tenant name and branding; no template editor.
- [ ] Per-tenant daily caps and per-recipient rate limits.
- [ ] No message is sent for draft projects.

### Step 5: Expected participants and reminders
- [ ] CRUD under the project (`mobilization:manage_roster`). A participant is either linked to an existing user (provisioned roles) or described by name plus email or phone (join-code roles).
- [ ] Linking: when a session is created by join code with a matching phone number, or lazily for a provisioned user, link it to the participant and advance `mobilizationStatus` (pending assurance, ready, on site).
- [ ] For join-code roles, the reminder includes the role's current join code for that project and contractor. Treat that message as sensitive: it is only sent to the address the admin entered.
- [ ] `mobilization-reminders` job: on each configured offset before `plannedMobilizationDate`, send a reminder to participants who are not yet ready, once per offset.
- [ ] Reminder schedule editing (`mobilization:configure_reminders`) at project level, with per-participant override.

### Step 6: Check-in and attendance alerts
- [ ] Mobile: a "Check in on site" action that records a `MANUAL_CHECKIN` ping through the Phase 4 capture path (signed, geofence-evaluated). The first in-geofence ping of any kind on a day also counts as a check-in.
- [ ] `attendance-check` job:
  - `MOBILIZATION_NO_SHOW`: on the mobilization date, no in-geofence check-in by expected time plus grace.
  - `UNVERIFIED_AT_MOBILIZATION`: on the mobilization date, the participant has not finished registration or assurance.
  - `WORKDAY_MISSED_CHECKIN`: on a configured workday after mobilization, for cadences that expect daily presence, no in-geofence check-in by expected time plus grace. Not raised for `INSPECTION_ONLY`.
- [ ] Alerts notify users with `presence:manage_noshow_alerts`; one alert per participant, day and type.
- [ ] Acknowledge, excuse (note required) and resolve endpoints, audited.

### Step 7: Web
- [ ] Wizard "Reporting" step (Phase 6): work-week day picker, period start day, custom interval, due time and grace, with a plain-language preview ("Briefs go out Monday 08:00. Reports are due Saturday 17:00.").
- [ ] Wizard "Team" step and project settings: expected participants table (add, link user, planned date, reminders), status chips.
- [ ] Site presence: period grouping instead of day grouping where cadence is not daily; late and missed badges; a "Due and overdue" list.
- [ ] Attendance alerts panel with filters and the three actions.
- [ ] Dashboard counts: late reports this period, open attendance alerts.

### Step 8: Mobile
- [ ] Read cadence and the current period from the baseline pack; compute with the shared module.
- [ ] Wording follows cadence: "This week's deliverables", "Weekly report", "Due Sat 17:00"; a due countdown and an overdue state on the inbox.
- [ ] Telemetry window follows the project's workday hours and `workWeekDays`; for `INSPECTION_ONLY`, pings only on check-in, capture and report.
- [ ] Check-in button and today's check-in status.

### Step 9: Tests
- [ ] Period maths (Step 1).
- [ ] Two runner instances against one database dispatch each period's briefs once.
- [ ] Weekly project: briefs on Monday, obligation due Saturday, a Sunday submission is late, a missing one becomes missed and alerts once.
- [ ] Reminders fire once per offset and stop when the participant is ready.
- [ ] Each alert type, with and without a qualifying check-in; excuse requires a note.
- [ ] Drafts and suspended tenants produce no jobs or messages.

---

## 6. Definition of done

- A weekly, six-day-week project shows one brief per period and flags late and missing reports correctly.
- An expected inspector who never signs in gets reminders, and the monitor gets a no-show alert on the day.
- Running two API instances does not duplicate briefs, reminders or alerts.
- Master plan status updated.

## 7. Found during implementation

_Add items here rather than expanding scope._
