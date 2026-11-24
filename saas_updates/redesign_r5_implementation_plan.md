# Redesign R5: Mobile (Dashboard, Visits, Form Filler, Site Log)

**Spec:** [client_flow_redesign.md](client_flow_redesign.md) sections 1, 3.2, 4 (field roles), 5, 6.1–6.3, 6.2a, 6.5, 8.1 (officer actions), 8.2, 12 (decisions S, X, Z, P2–P5) and 14 (R5).
**Branch:** `UBEC` (client-specific; decision P).
**Depends on:** R1 (done), R2 (done), R3 (form library, frozen visit form snapshot, answers contract, shared `validateVisitAnswers`) and R4 (visit server: feed, responses, check-in, submission, findings re-check, site log). Both are planned in parallel; section 4 lists exactly what this plan needs from them.
**Baseline before R5:** take real numbers at the start of R5a (typecheck, lint, web build, server unit + route, mobile). Last measured (R2d, 2026-11-24): mobile **57** tests in 10 files.
**Status:** Plan. Not started.
**Cross-plan contracts:** [redesign_contracts_r3_r7.md](redesign_contracts_r3_r7.md) settles the names and ownership shared by R3–R7. Where this plan differs, the register wins.

Each slice must leave `npm run typecheck`, `npm run lint` (0 errors) and the mobile suite green before the next one starts. Where a slice touches the server (D-R5.3, D-R5.13), the server unit + route suites must stay green too.

---

## 1. Goal

Replace the per-item chat app with the visit app the client described (spec 8.2):

```
 Sign in ─▶ Home (all field roles)
            ├─ Calendar: week ⇄ month, dots planned / overdue / done
            ├─ Visits of the selected day: Confirm · Move · Propose date · Decline (+ comment)
            ├─ My projects (one active project → its card opens fully)
            └─ + Unscheduled visit
 Visit ─▶ Check in (geofence preview) ─▶ Form (one section per screen, draft on every change)
       ─▶ Review ─▶ Submit (queued behind its photos, works offline)
 Project ─▶ details, sprints, units, findings, defects, past visits, site log
 Site log ─▶ photo / voice / note, any time, geotagged, offline; attachable to a submission
 Outbox ─▶ waiting, failed, retry
```

Deleted: the WBS inbox, the WBS chat thread, the end-of-day sheet (`ConfirmAiSummarySheet`), the workday report flow, the Phase 14 inspection and findings screens, cadence/period UI.

---

## 2. Read first

1. `CLAUDE.md` (all; especially the **Mobile** paragraph and the R1d field-account model: one account token, a `FieldAgentSession` per project resolved by `findOrCreateProvisionedSession`).
2. `saas_updates/client_flow_redesign.md` sections listed above.
3. `saas_updates/redesign_r3_implementation_plan.md` and `redesign_r4_implementation_plan.md` once written: reconcile every name in section 4 before R5a starts and record differences in section 10.
4. `saas_updates/redesign_r2_implementation_plan.md` (sprints, facility units, `/scope`; geofences are radial or perimeter only since R2).
5. Current mobile code you will replace or reuse:

| Area | Files | Fate |
| :--- | :--- | :--- |
| Navigation | `navigation/RootNavigator.tsx`, `navigation/types.ts` (`RootStackParamList`) | Rewritten (R5b) |
| Account / projects | `context/ProfileContext.tsx` (`prepareProject`, `switchProject`, `activeProjectId`), `config/authRegistry.ts`, `storage/secureProfileStore.ts` (device state v4) | Kept; `prepareProject` runs for every project (D-R5.6) |
| Old home and chat | `screens/WbsInboxScreen.tsx`, `screens/WbsChatThreadScreen.tsx`, `screens/ConfirmAiSummarySheet.tsx`, `storage/wbsRepository.ts`, `api/wbs/wbsChatApi.ts`, `queries/wbs/useWbsQueries.ts`, `api/boq/boqApi.ts` (`GET /boq`) | Deleted (R5e) |
| Reports | `storage/reportStore.ts`, `storage/reportPayload.ts`, `api/workday/workdayApi.ts`, `utils/reportStatus.ts`, `utils/projectCadence.ts`, `utils/activeCadence.ts`, `components/PeriodCard.tsx` | Deleted (R5e) |
| Inspections | `screens/InspectionScreen.tsx`, `screens/InspectionFindingsScreen.tsx`, `storage/inspectionStore.ts` (`inspection_drafts`), `utils/inspections.ts`, `api/inspections/inspectionsApi.ts` | Deleted (R5e); draft pattern reused for visit drafts |
| Defects | `screens/DefectsScreen.tsx`, `storage/defectActionStore.ts`, `utils/defects.ts`, outbox `DEFECT_ACTION` | Kept, entry moves to the project screen (D-R5.15) |
| Incidents | `screens/SpecialIncidentModal.tsx`, `storage/incidentStore.ts`, outbox `INCIDENT` | Kept, entry moves to the project screen (D-R5.16) |
| Outbox | `storage/outbox/outboxPolicy.ts` (`OutboxKind`, `SESSION_BOUND_KINDS`, `dependencyState`), `outboxStore.ts`, `outboxProcessor.ts`, `handlers.ts`, `storage/heldItems.ts`, `screens/BacklogReviewModal.tsx` | Kinds replaced (D-R5.9); `BacklogReviewModal` becomes the Outbox screen |
| Captures | `storage/captureStore.ts` (`saveCapture`, signed, geotagged, `CAPTURE` outbox row), `components/camera/*` (`SiteEvidenceCameraModal`, `InSiteCamera`), `components/audio/*` (`VoiceNoteRecorder`, `VoiceNoteBubble`) | Reused unchanged where possible |
| Location | `services/locationService.ts` (`acquireFix`, `previewGeofence`, `geofenceBadgeText`, `captureCurrentGeotag`) on shared `verifyPointAgainstGeofence` | Reused |
| SQLite | `storage/db/migrations.ts` (latest v8, `DATA_TABLES`), `storage/db/migrations.test.ts` | v9 (R5a), v10 (R5e) |
| Wording | `utils/personaCopy.ts` (+ test) | Rewritten for visits (R5b) |
| Push | `hooks/usePushNotifications.ts` (`routeFor`), `screens/NotificationCenterModal.tsx`, `components/notifications/NotificationCard.tsx`, shared `notification.schema.ts` (`OPEN_WBS_CHAT`, `OPEN_DEFECTS`, …) | Rerouted to visits (R5e) |
| Server the app calls today | `server/src/modules/auth/auth.routes.ts` (`/auth/mobile/login`, `/auth/mobile/projects`, `/auth/mobile/projects/:id/baseline`, `/session`), `auth.service.ts` (`buildBaselinePack`, `getProjectBaselinePack`, `listMobileProjects`), `modules/evidence/captures.routes.ts` (`POST /captures`, `GET /captures/mine`), `/evidence/presign`, workday reports (`/workday-reports`, `/suggest`: the only Whisper call path today), inspections (`/inspections`, `/inspections/field-pack`, `/inspection-findings/:id/resolve`), defects | See D-R5.3, D-R5.13 |

---

## 3. Decisions

Defaults below are the plan. Items marked **(confirm)** are reasonable defaults the owner may change; build the default unless told otherwise, and note it in section 10.

| ID | Decision |
| :--- | :--- |
| D-R5.1 | **No new navigation or calendar dependency.** One native stack (as today) plus modals; no bottom tabs. Home header carries Notifications, Outbox (with a pending badge) and Profile. The calendar is our own component over pure helpers (`utils/visitCalendar.ts`); the month view swipes with a horizontal paging `FlatList`. **(confirm)**: `@react-navigation/bottom-tabs` or `react-native-calendars` would save UI work but add native surface to an app with no device verification yet. |
| D-R5.2 | **Screens after R5**: `Landing`, `SignIn`, `ChangePassword`, `Home`, `Project` (`{ projectId }`), `Visit` (`{ visitId }`), `VisitForm` (`{ visitId }`, section screens inside one route), `VisitReview` (`{ visitId }`), `SiteLog` (`{ projectId }`), `Defects` (`{ projectId }`); modals `Profile` (account, sign out, settings link; was `ProfileAndProjectsScreen`), `SettingsModal`, `NotificationsModal`, `Outbox` (was `BacklogModal`), `VisitRespond` (`{ visitId, action }`), `UnscheduledVisit` (`{ projectId? }`), `SiteLogEntry` (`{ projectId, kind }`), `IncidentModal` (`{ projectId }`). Every project-scoped screen takes `projectId` as a param; `activeProjectId` survives only as "last opened project" for push routing defaults. Initial route: `ChangePassword` if forced, `Landing` without an account, else `Home` (the `Projects` picker step goes). |
| D-R5.3 | **Baseline pack v2 is R5's server change (confirm, unless R4 takes it).** `MobileBaselinePackSchema` (`shared/src/schemas/auth.schema.ts`) loses `boqItems`, `holdPoints`, `reportingCadence`, `cadence`, `inspections`; gains `projectStatus`, `stage` (R6 stage bar value if it exists by then, else `constructionPhase` + kick-off/mobilisation dates), `school` (primary beneficiary name), `address`, `contractorName`, `sprints` (number, name, start, end, deliverables, derived status via R2 `deriveSprintStatus`), `facilityUnits` (id, code, label, facility code/name/archetype, planned quantity + unit, start/end sprint), `openFindings` (id, facility, severity, text, raised on, due), `openDefectCount`, `mobilisation` (deadline, day N of M, when the milestone is open), `adHocForm` (D-R5.12). `buildBaselinePack` / `getProjectBaselinePack` in `auth.service.ts` change accordingly; R5a adds one route test. Geofence fields unchanged (radial or perimeter). |
| D-R5.4 | **Visit data is downloaded, not computed.** The app never derives which visits exist, their forms, tolerances or due dates. It stores what the R4 feed returns and shows a status the server computed, except two local overlays: an unsent response/check-in/submission ("Waiting to send") and "overdue" for a planned visit whose date has passed in the project zone while offline. |
| D-R5.5 | **Download window**: on sign-in, pull-to-refresh, app foreground and every 15 minutes while online, fetch the account feed for **today − 30 days … today + 14 days** (spec 8.2: next 14 days; the past 30 give calendar dots and unsubmitted overdue visits), then download every form snapshot in it that is not cached (keyed by `formSnapshotId` + `formHash`). Month view outside the window fetches that month online and does not cache forms for it. Offline, the calendar shows what is cached and says so. |
| D-R5.6 | **Every assigned project is prepared, not only the active one.** `ProfileContext.prepareProject` (pack + session) runs for all projects on sign-in and refresh, sequentially, failures ignored per project (the stored pack still works). The dashboard needs every pack for project cards and geofence previews. |
| D-R5.7 | **Single-project home** (spec 4, 8.2; decision P4): when the account has exactly one project with `projectStatus = ACTIVE`, Home shows that project's card fully (current sprint and deliverables, units in the sprint, open findings, next visit, site log and defects shortcuts) instead of the list. Calendar and unscheduled visit stay. Same screen and permissions for M&E Officers, Resident Supervisors and Independent Monitors; no persona branches. |
| D-R5.8 | **SQLite v9** (R5a, additive): `visits` (`id` server visit id or client UUID for unscheduled, `project_id`, `planned_date`, `status`, `summary_json` (the feed DTO), `form_snapshot_id`, `form_hash`, `local_state_json` (pending response / check-in overlay), `synced_at`), `visit_forms` (`snapshot_id` + `form_hash` primary key, `json`, `downloaded_at`), `visit_drafts` (`id` = `clientSubmissionId`, `visit_id` unique, `project_id`, `status` `DRAFT \| QUEUED \| SENT \| REFUSED`, `form_hash`, `draft_json`, `request_json`, `server_id`, `last_error`, `updated_at`), `site_log_entries` (`id` = `clientEntryId`, `project_id`, `kind` `PHOTO \| VOICE \| NOTE`, `text`, `capture_id`, `captured_at`, latitude/longitude/accuracy/is_mocked, `status`, `server_id`, `attached_submission_id`, `created_at`). All added to `DATA_TABLES`. Drafts and requests never hold file paths, base64 or display strings: photos and voice notes are `clientCaptureId`s; options are option keys; units are `facilityUnitId`s. |
| D-R5.9 | **Outbox kinds after R5**: kept `CAPTURE`, `INCIDENT`, `DEFECT_ACTION`; new `VISIT_RESPONSE`, `VISIT_CHECK_IN`, `VISIT_SUBMISSION`, `UNSCHEDULED_VISIT`, `SITE_LOG_ENTRY`; removed `REPORT`, `REVALIDATION`, `CHAT_MESSAGE`, `SITE_INSPECTION`, `FINDING_RESOLUTION`. Dependencies: `VISIT_SUBMISSION` depends on every capture it names, its visit's `VISIT_CHECK_IN` and, for an unscheduled visit, its `UNSCHEDULED_VISIT`; `VISIT_CHECK_IN` depends on `UNSCHEDULED_VISIT` when there is one; `SITE_LOG_ENTRY` depends on its capture. All new kinds are in `SESSION_BOUND_KINDS`. Every request carries a client UUID; handlers treat the server's "already applied" replies as done on a retry (pattern of `DEFECT_ALREADY_APPLIED_CODES`). |
| D-R5.10 | **Removed kinds on upgrade (confirm)**: SQLite v10 (R5e) deletes outbox rows of the removed kinds and drops `wbs_items`, `chat_messages`, `workday_reports`, `server_reports`, `inspection_drafts` and the empty `assurance_submissions`; captures linked only to deleted reports stay until purged. Their server endpoints are gone or going (R4), so they could never be sent. Acceptable because no production devices exist (decision A); if field pilots start before R5e ships, sync devices first. |
| D-R5.11 | **Responses** (spec 8.1, decision P5): Confirm, Move (within the server-given window), Propose a new date (outside it), Decline; Move/Propose/Decline require a comment; Confirm's comment is optional. The app offers Move only for dates inside `moveWindow` from the feed (it does not compute working days or sprint bounds itself) and Propose for any later date. Offline: queued as `VISIT_RESPONSE` and shown as "Waiting to send"; a Move shows the new date marked pending; a Propose keeps the original date (it stands until the manager decides). Each request carries `basedOnVersion`; a 409 `VISIT_CHANGED` dead-letters with "This visit changed since you responded. Refresh and respond again." |
| D-R5.12 | **Unscheduled visit** (spec 8.1: recorded as Ad hoc): created offline with a client UUID (`UNSCHEDULED_VISIT` outbox row) from the project's `adHocForm` in the pack: a snapshot holding the Ad hoc fixed sections and **every** facility sub-form of the project; the officer picks facilities and the unpicked sections are omitted from the answers (`selectedFacilityIds` on the submission). **(confirm with R3/R4)**: the alternative (assemble online only) breaks "a visit can be done fully offline". |
| D-R5.13 | **Voice transcription stays server-side (Whisper) and never blocks submission (confirm, tiny server change unless R4 has it).** Today the only transcription path is `POST /workday-reports/suggest`, which goes with workday reports. New: when a `VOICE_NOTE` capture is registered, the server transcribes it off the request path (scheduler hook like `setAiOmissionCheckScheduler`, test hook included) and stores `transcript` / `transcriptionStatus` on the capture; `GET /projects/:id/captures/mine?since=` already returns them in `CaptureDto`. The app shows the transcript under the voice note once available; a voice-note answer is the capture id(s), the officer may type text in the comment. No transcript is ever invented or shown when the server did not produce one. |
| D-R5.14 | **Photo rules on the device** (spec 6.2a): photos are taken in-app only (no gallery). A required photo slot is satisfied only by a capture with a real fix whose geofence preview is `INSIDE` or `WITHIN_TOLERANCE` and not `isMocked`; otherwise the slot shows "Outside the site boundary" / "No location" and asks for a retake. Modes: `ONE_PER_UNIT` (one labelled slot per unit, each required), `PER_UNIT_OPTIONAL` (labelled slots, none required), `AT_LEAST_N` (min/max). The server re-checks; its result counts. **(confirm)**: whether an outside-boundary photo may be kept with a comment (default: no for required slots). |
| D-R5.15 | **Defects kept as their own screen (confirm).** `DefectsScreen` (close with photos / reopen through `DEFECT_ACTION`) stays, opened from the project screen when the project is past construction or has open defects. If the R3/R4 snapshot carries defect re-check items, the form renders them like findings; the standalone screen remains for closing between visits. |
| D-R5.16 | **Incidents kept (confirm).** `SpecialIncidentModal` stays as is, opened from the project screen menu. Not part of the visit model. |
| D-R5.17 | **Findings are re-checked only inside a visit form** (spec 6.5). The standalone `InspectionFindingsScreen` and `FINDING_RESOLUTION` go; the project screen lists open findings read-only. **(confirm)**: an officer can no longer close a finding between visits from the phone. |
| D-R5.18 | **Check-in** (spec 8.2): takes a fresh fix (`acquireFix`), shows the local preview (`previewGeofence`, distance from site) and queues `VISIT_CHECK_IN` (`clientCheckInId`, fix, `isMocked`, `capturedAt`). Outside the boundary or with no fix the officer may still check in with a reason; the server flags it. **(confirm)**: block instead of flag. Starting the form requires a check-in on this device (the form is locked to the snapshot from then on, D-R5.19). |
| D-R5.19 | **Form snapshot changes**: once checked in, the visit's draft is bound to its `formHash`. If the feed later shows a different hash (manager rebuilt the form before the server saw the check-in), the app keeps the draft, shows "The form was rebuilt", re-maps answers by question key and unit id onto the new snapshot and drops what no longer exists, listing it. A submission refused with `FORM_SNAPSHOT_STALE` is marked `REFUSED` with that message (not silently retried). |
| D-R5.20 | **One submission per visit.** If another officer on the same visit submitted first, the server's `VISIT_ALREADY_SUBMITTED` marks the draft `REFUSED` and keeps it on the device; the person can delete it. Returned-for-correction (if R4 has it) reopens a new draft pre-filled from the server's answers and submits with `revisesSubmissionId`. **(confirm with R4)**; if R4 has no return step, R5 builds none. |
| D-R5.21 | **Comments on a submission are read-only on the phone in R5 (confirm).** The visit screen shows the reviewer thread; replying from the phone is a follow-up (the chat UI is deleted, decision S). |
| D-R5.22 | **Site log** (decision X): entries are standalone records per project (`SITE_LOG_ENTRY`), photo/voice through the normal capture path. In a form, a photo field offers "Pick from site log" for photos of the same project captured on the visit day (project zone); the same D-R5.14 rule applies to the picked capture. Attaching an entry to a submission sends its `clientEntryId` in `attachedSiteLogEntryIds`; unattached entries stay in the project timeline (server). **(confirm with R4)**: site log server model is R4's. |
| D-R5.23 | **Wording**: `personaCopy` keeps one call shape but returns visit wording only (no cadence argument); tenant terms through `useActiveBranding().terminology` for project, contractor and funder. No "AI", "summary suggestion" or chat wording anywhere (decision Z). |
| D-R5.24 | **Server endpoints only the old app used** (workday report submit/revalidate/suggest, `/inspections/field-pack`, `/inspection-findings/:id/resolve`, `/boq` for mobile, `/boq/:id/chat`): R5 stops calling them; their deletion belongs to R4's clean-up slice, which must land **after** R5e or the app on `UBEC` breaks in between. **(confirm ordering with R4)**. |

---

## 4. Contracts the app depends on

Names are proposals; R3/R4 own them. Reconcile before R5a (section 2, item 3). Everything below is a shared Zod schema exported from `@insite/shared`; the app never hand-writes a type.

### 4.1 From R3: form snapshot and answers

| Need | Detail |
| :--- | :--- |
| `VisitFormSnapshotSchema` | `snapshotId`, `formHash` (stable content hash), `visitType`, `sections[]` in order. Section: `key`, `kind` `FIXED \| FACILITY \| RECHECK`, `title`, `facility` (FACILITY: `facilityId`, code, name, archetype) and `units[]` (`facilityUnitId`, label, `plannedQuantity`, `quantityUnit`), `questions[]`. |
| Question | `key` (stable within the snapshot and, for the same template question, across rebuilds), `type` (short text, long text, number with `unit`, percentage, yes/no/N/A, single choice, multiple choice, date, rating 1–5, photo, voice note), `text` with placeholders, `required`, `options[]` (`key`, label), `scope` `FACILITY \| PER_UNIT`, photo `mode` `ONE_PER_UNIT \| PER_UNIT_OPTIONAL \| AT_LEAST_N` + `min`/`max` + `geotagRequired`, `rules[]` (`when` answer equals / in, `then` `REQUIRE_PHOTO \| REQUIRE_COMMENT \| RAISE_FINDING` with severity), supply quantity cap flag. |
| Re-check item | In a `RECHECK` section: `findingId` (or `defectId`, D-R5.15), facility, unit, severity, original text and date; questions "Resolved? Y/N", comment, photo. |
| `renderQuestionText(text, ctx)` | Shared, pure: `{count}`, `{facility}`, `{units}`, `{plannedQty}`, `{uom}`. The phone and web render the same text. |
| `VisitAnswersSchema` | Keyed by `sectionKey` + `questionKey` (+ `facilityUnitId` for `PER_UNIT`): `value` (string / number / option key(s) / `YYYY-MM-DD` / boolean-or-NA), `comment`, `clientCaptureIds[]` with optional `facilityUnitId` per photo slot; re-check answers by `findingId`. |
| `validateVisitAnswers(snapshot, answers, ctx)` | Shared, pure, the one rule set: required, conditional photo/comment, supply quantity above planned needs a comment, photo counts per mode. `ctx.captures` gives each capture's geofence status and `isMocked` so the per-unit boundary rule runs identically on the phone (local preview) and the server (its own evaluation). Returns issues with `sectionKey`, `questionKey`, `facilityUnitId?`, `code`, `severity` (`ERROR` blocks submit on the phone). Also returns the findings the answers would raise, so the review screen can say "This will raise 2 findings". |

### 4.2 From R4: visits server

| Need | Detail | Offline / idempotency |
| :--- | :--- | :--- |
| Account feed `GET /auth/mobile/visits?from=&to=` (mobile-account principal, across projects) | `VisitSummaryDto[]`: `id`, `projectId`, project code/name, `visitType`, `plannedDate`, `originalPlannedDate`, `status` (planned, confirmed, in progress, submitted, approved, returned?, missed, cancelled), `myResponse` (latest, pending proposal), `assignedOfficers`, `isUnscheduled`, sprint (number, name, deliverables), facility count/names, re-check count, `dueAt` (submission deadline), `moveWindow` (`earliest`, `latest`), `formSnapshotId`, `formHash`, `version`, `checkedInAt`, `submission` (id, status, submitted at). Only visits where the account is an assigned officer, on projects it can see. | Read; cached in `visits` |
| `GET /projects/:id/visits/:visitId/form` | The frozen `VisitFormSnapshot` (4.1). | Cached by `snapshotId` + `formHash` |
| `POST /projects/:id/visits/:visitId/responses` | `{ clientResponseId, action: CONFIRM \| MOVE \| PROPOSE \| DECLINE, date?, comment, basedOnVersion }` → updated `VisitSummaryDto`. 409 `VISIT_CHANGED`, 422 `MOVE_OUTSIDE_WINDOW`. | Idempotent on `clientResponseId` |
| `POST /projects/:id/visits/unscheduled` | `{ clientVisitId, visitType: AD_HOC, plannedDate, selectedFacilityIds }` → `VisitSummaryDto` whose `id` = `clientVisitId` (or a returned mapping). Built on the project's ad hoc snapshot (D-R5.12). | Idempotent on `clientVisitId` |
| `POST /projects/:id/visits/:visitId/check-in` | `{ clientCheckInId, location \| null, isMockLocation, capturedAt, reason? }` → geofence status as the server computed it. | Idempotent on `clientCheckInId`; one check-in per visit per officer |
| `POST /projects/:id/visits/:visitId/submissions` | `{ clientSubmissionId, formSnapshotId, formHash, answers, selectedFacilityIds?, attachedSiteLogEntryIds[], startedAt, completedAt, revisesSubmissionId? }`; captures referenced by `clientCaptureId` must be registered first (`CAPTURES_NOT_REGISTERED` = retry, as today). 409 `FORM_SNAPSHOT_STALE`, 409 `VISIT_ALREADY_SUBMITTED`, 422 with `validateVisitAnswers` issues. Re-check answers resolve or keep findings server-side. | Idempotent on `clientSubmissionId` (replay returns the original) |
| `GET /projects/:id/visits/:visitId` | Detail incl. submission status and the read-only comment thread (D-R5.21), and, if R4 returns submissions for correction, the submitted answers. | Read, online |
| `GET /projects/:id/visits?mine=past` | Past visits for the project screen. | Read, online; cached summaries |
| Site log `POST /projects/:id/site-log` | `{ clientEntryId, kind, text?, clientCaptureId?, capturedAt, location \| null, isMockLocation }`; `GET /projects/:id/site-log?mine=true&since=`. | Idempotent on `clientEntryId` |
| Captures | Unchanged `POST /projects/:id/captures` with `wbsItemId` null. If R4 retires `wbsItemId`, the app drops it. Voice transcripts on `CaptureDto` (D-R5.13). | As today |
| Notifications | Mobile types for visit assigned / changed / reminder (2 days before, unconfirmed) / proposal decided / submission returned / approved; action `OPEN_VISIT` with `visitId` + `projectId` in metadata. Server stops sending `OPEN_WBS_CHAT`. | Push + `NotificationsModal` |
| Permissions | The permission codes that gate responding, checking in, submitting and site log for field sessions, as returned by `GET /auth/mobile/projects/:id/session` (`permissions`). The app hides actions the session lacks. | – |

---

## 5. Implementation checklist

### R5a: Contracts, storage and sync (no UI change)
- [ ] Reconcile section 4 with the R3/R4 plans; record name changes in section 10.
- [ ] Server (D-R5.3): baseline pack v2 in `shared/src/schemas/auth.schema.ts` and `auth.service.ts` (`buildBaselinePack`, `getProjectBaselinePack`, route in `auth.routes.ts` without `buildMobileInspectionPack`); route test for the pack on a project with sprints and units (seed PRG-102/PRG-105). Old screens that read `boqItems`/`cadence`/`inspections` keep compiling by reading them as optional until R5e.
- [ ] Server (D-R5.13, if R4 does not): transcribe registered voice captures off the request path, with a test hook; route test that a registered voice note ends `DONE` with the stubbed provider and `PENDING` with none.
- [ ] SQLite v9 (D-R5.8) + `DATA_TABLES`; `migrations.test.ts` cases for v8 → v9 on a populated database.
- [ ] `api/visits/visitsApi.ts`, `api/siteLog/siteLogApi.ts` (every call through `mobileRequest`).
- [ ] `storage/visitStore.ts` (feed upsert by `version`, local overlays, form cache, drafts), `storage/siteLogStore.ts`.
- [ ] `services/visitSync.ts`: D-R5.5 window, form download, voice transcript refresh via `/captures/mine`; triggered from `useNetworkSync` and pull-to-refresh.
- [ ] `ProfileContext`: prepare every project (D-R5.6).
- [ ] Pure, Node-tested: `utils/visitCalendar.ts` (week of a date, month grid Monday-first, dots per day: planned / overdue / done from status + local overlay, visits grouped by day, project-zone "today"), `utils/homeLayout.ts` (single-project rule, project card model from pack + visits).

### R5b: Navigation, Home, Project and Visit screens, responses
- [ ] `navigation/types.ts` and `RootNavigator.tsx` per D-R5.2; Home becomes the initial route; `ProfileAndProjectsScreen` becomes the `Profile` modal (account, sign out, settings, per-project pending counts).
- [ ] `screens/HomeScreen.tsx`: greeting, collapsible calendar (week ⇄ month, swipe months, offline notice outside the cached window), day list with response buttons, "My projects" cards (code, name, stage, "Sprint 3 of 5", next visit, open findings, mobilisation day N of M), single-project layout (D-R5.7), "+ Unscheduled visit".
- [ ] `screens/ProjectScreen.tsx`: details (school, address, contractor), sprints with status and deliverables, units by facility, open findings (read-only), past visits, shortcuts to site log, defects (D-R5.15) and incident report (D-R5.16).
- [ ] `screens/VisitScreen.tsx`: project, school, type, planned/original date, due date, sprint name and deliverables, facilities to check, findings to re-check, comment thread (D-R5.21), Check in / Start or resume form, status and "Waiting to send" overlay.
- [ ] `VisitRespond` modal + outbox `VISIT_RESPONSE` handler (D-R5.11); `utils/visitResponses.ts` (allowed actions per status, date validity against `moveWindow`, request bodies), Node-tested.
- [ ] `personaCopy` rewrite (D-R5.23) and its test.
- [ ] Old `WbsInbox` / `WbsThread` / `EodConfirmModal` / `Inspection*` routes removed from the navigator (files deleted in R5e).

### R5c: Check-in, form filler, submission, unscheduled visit
- [ ] Check-in sheet (D-R5.18): fix, preview badge (`geofenceBadgeText`), distance, reason when outside / no fix; outbox `VISIT_CHECK_IN`.
- [ ] `screens/VisitFormScreen.tsx`: one section per screen, progress bar, section list jump, draft saved on every change (`visit_drafts`), resumes after restart.
- [ ] Field components (`components/form/*`), one per R3 type: text (short/long), number with unit, percentage (0–100), yes/no/N/A, single choice, multiple choice, date (project zone), rating 1–5, photo slots (D-R5.14: per-unit labelled slots, at-least-N, slot status, retake, pick from site log), voice note (`VoiceNoteRecorder`, transcript when available, D-R5.13). Per-unit scope repeats the field per unit with its label. Supply questions show "of {planned} {uom}". Placeholders through shared `renderQuestionText`.
- [ ] Conditional rules inline: required photo/comment appears when the answer triggers it; "This answer will raise a finding (severity)" note.
- [ ] Re-check section: per finding "Resolved? Y/N", comment, photo.
- [ ] `utils/visitForm.ts` (Node-tested): screens from a snapshot, answer keys, slot model per photo mode, draft → `submission request` mapping (ids only), issue mapping per section, D-R5.19 re-mapping onto a rebuilt snapshot.
- [ ] `VisitReviewScreen`: issues from `validateVisitAnswers` (errors block), findings to be raised, attached site log entries, Submit → queue `VISIT_SUBMISSION` behind captures, check-in and unscheduled visit (D-R5.9); handler maps `FORM_SNAPSHOT_STALE` / `VISIT_ALREADY_SUBMITTED` to `REFUSED` drafts with fixed messages (D-R5.19, D-R5.20) in `outboxPolicy` `PERMANENT_CODE_MESSAGES`.
- [ ] Unscheduled visit (D-R5.12): pick project (preset on single-project home) and facilities, create locally, `UNSCHEDULED_VISIT` row, then the normal check-in and form.
- [ ] `outboxPolicy.test.ts`: new kinds in `SESSION_BOUND_KINDS`, dependency chains (submission waits on captures + check-in + unscheduled visit; blocked when one is dead), new permanent codes.

### R5d: Site log
- [ ] `screens/SiteLogScreen.tsx` (project's entries, newest first, upload state, server timeline not required) and `SiteLogEntry` modal: photo (camera), voice (`VoiceNoteRecorder`), note; geotagged with `captureCurrentGeotag`; outbox `SITE_LOG_ENTRY` behind its capture.
- [ ] "Pick from site log" in photo fields and "Attach site log entries" on the review screen (D-R5.22); attached entries recorded on the draft by `clientEntryId`.
- [ ] Node tests: `utils/siteLog.ts` (which entries are pickable for a visit day and project zone; attach/detach on a draft).

### R5e: Outbox screen, notifications, deletions
- [ ] `Outbox` modal (from `BacklogReviewModal`): waiting / failed / held rows per project, labelled by kind ("Visit report", "Check-in", "Visit response", "Site log entry", "Photo", "Defect update", "Incident"), last error, Retry (`retryOutboxItem`), Remove for refused drafts; Home header badge from `subscribeToSyncStatus`.
- [ ] Push and notification centre: `routeFor` and `NotificationCenterModal` route `OPEN_VISIT` → `Visit`, `OPEN_DEFECTS` → `Defects` with `projectId`, others → `NotificationsModal`; remove `OPEN_WBS_CHAT`, `OPEN_REPORT_SUMMARY`, `OPEN_BACKLOG_REVIEW` routing; remove those enum values from `shared/src/schemas/notification.schema.ts` only if the server no longer emits them (confirm with R4).
- [ ] Delete (section 2 table): WBS inbox, chat thread, `ConfirmAiSummarySheet`, `wbsRepository`, wbs API/queries, `boqApi`, report store/payload/status, cadence utils and `PeriodCard`, inspection screens/store/utils/API, `FINDING_RESOLUTION` and the removed outbox kinds and handlers, report/chat parts of `heldItems.ts`. Remove now-unused shared exports only if web/server do not use them.
- [ ] Baseline pack: drop the optional legacy fields kept in R5a.
- [ ] SQLite v10 (D-R5.10) + `DATA_TABLES`; migration test v9 → v10 with queued rows of removed kinds.
- [ ] `mobile/package.json` test list: remove `reportPayload.test.ts`, `reportStatus.test.ts`, `projectCadence.test.ts`, `inspections.test.ts` (20 tests); add `visitCalendar.test.ts`, `homeLayout.test.ts`, `visitResponses.test.ts`, `visitForm.test.ts`, `siteLog.test.ts`; keep the rest.
- [ ] `app.json` permission texts: camera, microphone and location name visits and the site log.

### Docs (every slice)
- [ ] `CLAUDE.md` Mobile paragraph: screens, outbox kinds, SQLite tables, sync window, transcription path; remove WBS/report/inspection wording.
- [ ] `demo_script_programme_delivery.md`: the field part of the demo on the phone (Home, respond, check in, form with per-unit photos, site log, outbox).
- [ ] `physical_testing_checklist.md`: add section 7 below.
- [ ] This file: section 10 per slice.

---

## 6. Tests

| Kind | What |
| :--- | :--- |
| Mobile unit (Node, `tsx --test`, explicit list) | Calendar model; single-project rule and card model; response rules against `moveWindow`; form screens, slot model per photo mode, boundary rule via shared `validateVisitAnswers`, draft → request mapping (no paths, no labels), snapshot re-mapping; site log pickability; outbox dependency chains and permanent codes; migrations v9 and v10 on populated databases. |
| Server (only for D-R5.3 / D-R5.13) | Pack v2 contents and access; voice transcription off the request path (stubbed Whisper, test hook). Everything else is R4's suite. |
| Expected count | 57 − 20 (removed report/cadence/inspection tests) + new; record the real number per slice in section 10. |

---

## 7. Device verification still owed (no device run has been done since Phase 5)

Run on one Android and one iOS device against the seeded demo (`resident.supervisor@`, `programme.monitor@`, `me.officer@` per R7 logins):

1. Sign in, forced password change, Home loads all projects; single-project home for a one-project account.
2. Calendar: week ⇄ month, swipe, dots; airplane mode shows cached window and the offline note.
3. Confirm, Move inside the window, Propose outside, Decline, each offline then online; `VISIT_CHANGED` after a web-side move.
4. Check in inside, within tolerance, outside (reason) and with location off.
5. Fill a Routine visit offline: every field type, a per-unit photo per unit, an outside-boundary photo refused for a required slot, a rule-triggered comment, a re-check item; kill the app mid-form and resume.
6. Submit offline; reconnect; outbox drains in order (captures → check-in → submission); web shows the submission and raised findings.
7. Form rebuilt on the web after check-in → re-map notice; second officer submits first → refused draft.
8. Unscheduled visit fully offline.
9. Site log photo/voice/note; transcript appears after upload (Whisper configured) and stays absent without it; pick a site log photo into a form.
10. Defects close with photos; incident report.
11. Push: visit assigned / reminder open the visit.
12. Upgrade from a pre-R5 build with queued items (v9, v10 migrations).

---

## 8. Out of scope

Server visit logic, planner, generators, approval, findings loop, sprint verification, KPIs (R4); form builder and assembly (R3); web (R6); role catalogue and seeded logins (R7); replying to comments from the phone (D-R5.21); gallery import; maps on the phone; Needs Assessment.

---

## 9. Definition of done

- R5a–R5e merged in order, each green at the time: typecheck clean, lint 0 errors, mobile tests pass (server unit + route too when a slice touched the server).
- An officer can, offline from the morning sync on, see the day's visits, respond, check in, fill and submit a visit with per-unit geotagged photos, log site photos/voice/notes, and see everything send when back online.
- No screen, store, outbox kind or API call of the WBS inbox, chat, end-of-day sheet, workday reports or Phase 14 inspections remains in `mobile/src`.
- Docs updated (section 5, Docs).
- Device verification (section 7) done or listed as still owed.

---

## 10. Found during implementation

_(empty)_
