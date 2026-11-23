# Phase 1a findings: web (Playwright MCP)

_Track 1a writes only this file. Format: saas_updates/ui_verification_and_design_plan.md, "Finding format"._

Run: 2026-11-20, Playwright MCP (Chromium, 1440x900 unless noted). Screenshot paths are relative to `qa/`.

## Findings

### W-001 · Minor · Home page shows sample corridor figures as a live pilot, not as an example
- **Check:** P4-W-10 (physical_testing_checklist.md)
- **Role / project:** signed out / public `/`
- **Steps:** 1. Open `http://localhost:5173/`.
- **Expected:** sample positions and figures are labelled as examples (as the login page and Mobile app page do: "Example corridor geofence (illustration)", "Inside corridor · KM 14+200 (example)").
- **Actual:** the hero card reads "LIVE PILOT CORRIDOR · LKK-402 … 98.4% Within Corridor · KM 12+400 · Tier 1 Monitor · KM 14+210 · Hold-Point WBS 02.01.2" with an "IPC #02 LINE ITEM CLAIM VS. EVIDENCE" panel, with no "example" or "illustration" label. The login page shows the same "98.4% Within Corridor" figure, but under an "Example corridor geofence (illustration)" caption. No "liveness" or "Live Verified Camera" wording found on any public page (that part passes).
- **Evidence:** screenshots/web/public/home__default.png, screenshots/web/public/login__default.png
- **Suspected area:** `web/src/pages/public/HomePage.tsx` (hero card)

### W-002 · Minor · Opening /login while signed out shows two "Signed out of InSite Assurance." toasts
- **Check:** P4-W-10 (seen on the way)
- **Role / project:** signed out (fresh browser, no token) / `/login`
- **Steps:** 1. With no stored token, open `http://localhost:5173/login`.
- **Expected:** no sign-out message (the user never signed in in this browser).
- **Actual:** two identical toasts "Signed out of InSite Assurance." appear; console shows two `GET /api/v1/auth/me` → 401 (the unauthorised handler fires once per request).
- **Evidence:** screenshots/web/public/login__default.png; console 2× 401 `auth/me`
- **Suspected area:** `web/src/lib/auth-context.tsx` / `registerUnauthorizedHandler`

### W-003 · Major · Platform super admin sees the programme tenant's projects inside the demo tenant's screens
- **Check:** role sweep / P5-W-02 / P5-W-04 (seen on the way)
- **Role / project:** admin@insite.ng (demo tenant, platform super admin) / PRG-221, PRG-211, PRG-102 (programme tenant)
- **Steps:** 1. Sign in as admin@. 2. Note the landing project. 3. Settings → Users & Visibility → Add Tenant User → "Assign Visible Projects". 4. Settings → Access & Assurance while PRG-221 is the active project.
- **Expected:** a demo-tenant workspace (header shows the demo tenant's name and branding) lists only demo-tenant projects; a tenant user cannot be given visibility of another tenant's project.
- **Actual:** admin@ lands on PRG-221 "Co-Funded — Ikeja Junior Secondary School" (programme tenant) under the demo tenant's header and branding; "Recent Active Projects" lists PRG-221/211/102 first; the add-user drawer offers PRG-221/211/102 as assignable projects for a new demo-tenant user; with PRG-221 active, the join-code "Mobile role" select lists both tenants' roles (Contractor Site Engineer and Independent Resident Clerk of Works twice each, plus Monitor Inspector although the note says pre-provisioned roles are not listed). `GET /projects` for admin@ returns 10 projects across two `tenantId`s. May be intended for the platform super admin, but the tenant-scoped forms should not mix tenants. Owner decision needed.
- **Evidence:** screenshots/web/admin/landing__loaded.png, screenshots/web/admin/settings-users__add-drawer.png
- **Suspected area:** `projectAccessBranch` / platform super admin bypass feeding tenant-scoped pickers.

### W-004 · Minor · "Liveness" wording remains in role and permission descriptions
- **Check:** P4-W-07
- **Role / project:** admin@insite.ng / Settings → Roles & Permissions
- **Steps:** 1. Settings → Roles & Permissions. 2. Read the Contractor Site Engineer card. 3. Open any role editor and read the "Mobilization & Access Assurance" permission group.
- **Expected:** identity checks described as a photo ID plus a guided selfie set reviewed by a person; no "liveness" (Phase 4 claims table).
- **Actual:** Contractor Site Engineer description: "requires ID and liveness assurance (weight 0.40)"; group description "review ID/liveness"; permission `assurance:review_credentials` description "Review mobile ID cards, 3D liveness selfies, and regulatory licenses." (The Access & Assurance tab text itself is correct: "guided selfie set (3 poses) … no automated liveness check is run".)
- **Evidence:** screenshots/web/admin/settings-roles__list.png, screenshots/web/admin/settings-roles__onboarding-confirm-projects.png
- **Suspected area:** `shared/src/defaultRoles.ts`, `SYSTEM_PERMISSIONS_CATALOG` in `shared/src/enums.ts` (seeded role descriptions may also need a data fix).

### W-005 · Minor · "Hourly" telemetry wording in the permission catalog
- **Check:** P4-W-04
- **Role / project:** admin@insite.ng / Settings → Roles & Permissions → any role editor
- **Steps:** 1. Open a role editor. 2. Read `presence:view_telemetry`.
- **Expected:** no "hourly" wording anywhere (pings are "App open", "Capture", "Report submitted").
- **Actual:** "Inspect hourly GPS telemetry, check-in timestamps, and submission geotags."
- **Evidence:** screenshots/web/admin/settings-roles__onboarding-confirm-projects.png (permission list)
- **Suspected area:** `SYSTEM_PERMISSIONS_CATALOG` (`shared/src/enums.ts`).

### W-006 · Minor · Forced password-change screen shows a "session has expired" error toast
- **Check:** P2-W-01 (QAW user first sign-in)
- **Role / project:** qaw.user1@insite.ng (new user with a temporary password)
- **Steps:** 1. Admin creates a user with a temporary password. 2. Sign in as that user.
- **Expected:** only the "Set a new password" screen.
- **Actual:** the screen is correct, but an error toast "Your session has expired or you do not have permission to view this data." appears and the console shows 2 errors (background project queries refused while the password must change).
- **Evidence:** screenshots/web/qaw-user/login__forced-password-change.png
- **Suspected area:** workspace queries start before the `mustChangePassword` gate.

### W-007 · Major · After changing a temporary password the workspace says "No projects yet" until the page is reloaded
- **Check:** P2-W-01 (QAW user first sign-in)
- **Role / project:** qaw.user1@insite.ng, assigned to KAN-210
- **Steps:** 1. Sign in with the temporary password. 2. Set a new password ("Save password").
- **Expected:** the workspace opens on KAN-210.
- **Actual:** "No projects yet — You have not been given access to any project." `GET /projects` with the same token returns KAN-210; a manual reload shows KAN-210. The failed project query from step 1 is not refetched after the token changes. Misleading for every new user.
- **Evidence:** screenshots/web/qaw-user/header__renamed-role.png (no projects), screenshots/web/qaw-user/landing__after-reload.png
- **Suspected area:** `web/src/lib/auth-context.tsx` (invalidate React Query cache after password change).

### W-008 · Cosmetic · Native browser confirm() dialogs for destructive actions
- **Check:** P5-W-03, P6-W-03, P6-W-08 (seen on the way)
- **Role / project:** admin@insite.ng
- **Steps:** 1. Settings → Access & Assurance → "Revoke device". 2. All Projects → Drafts → "Delete". 3. Site step → "Clear" or switch geofence type after drawing.
- **Expected:** the in-app confirmation modal used elsewhere (organisation archive, standard delete, onboarding change).
- **Actual:** unstyled `window.confirm` dialogs ("Revoke QAW Test Device for QAW User One? …", "Delete the draft "QAW-602 Delete Me"? This cannot be undone.", "Clear the shape you have drawn?", "Switch to Linear corridor? The shape you have drawn will be cleared.").
- **Evidence:** observed through Playwright dialog events; screenshots/web/admin/settings-access__revoke-device-confirm.png (taken behind the native dialog)
- **Suspected area:** device roster, drafts tab, `GeofenceEditor`.

### W-009 · Major · Draft setup pages show a different live project in the page header, with its actions
- **Check:** P6-W-03 / P6-W-04
- **Role / project:** admin@insite.ng / QAW-601 (draft), header shows PRG-221
- **Steps:** 1. "+ New Project" or open any draft's setup step (`/app/projects/<draft>/setup/parties`).
- **Expected:** the header names the draft being edited (or no project), and offers only actions for it.
- **Actual:** the header shows the last active live project ("PRG-221 / Co-Funded — Ikeja Junior Secondary School · Construction · Start handover · Project settings") while the body edits QAW-601. "Start handover" and "Project settings" in the header act on the other project. Drafts are not in the projects list, so the shell falls back to the previous selection.
- **Evidence:** screenshots/web/admin/project-new__basics-empty.png, screenshots/web/admin/project-setup__site-perimeter-self-intersecting.png
- **Suspected area:** `web/src/App.tsx` `activeProject` fallback when `urlProjectId` is a draft.

### W-010 · Minor · Geofence editor keeps a stale "perimeter crosses itself" error after switching type
- **Check:** P6-W-08
- **Role / project:** admin@insite.ng / QAW-601 Site step
- **Steps:** 1. Perimeter → paste a self-intersecting polygon → "Use these coordinates" (error shown, correct). 2. Switch to Linear corridor, draw points. 3. Switch to Radial, place a centre.
- **Expected:** the perimeter error disappears with the perimeter.
- **Actual:** "The perimeter crosses itself. Move the points so the edges do not cross." stays under the corridor and the radial editors (the radial save still succeeds). Also, map clicks made while a run was interrupted by the switch confirm were kept (corridor showed 6 points after 3 clicks).
- **Evidence:** screenshots/web/admin/project-setup__site-corridor-drawn.png, screenshots/web/admin/project-setup__site-radial-placed.png
- **Suspected area:** `GeofenceEditor` validation state.

### W-011 · Major · Tranche "Target progress %" of 0 is accepted and the Facility step is marked complete
- **Check:** P6-W-06
- **Role / project:** admin@insite.ng / QAW-601 Facility step
- **Steps:** 1. Add tranche, allocation 50,000,000, target progress 0. 2. Save.
- **Expected:** a field error; step not complete (as budget 0 on Basics correctly shows "Budget must be above zero").
- **Actual:** "Saved."; step 4 shows a green tick; after reload the target is still 0. (Budget 0 and blank coordinates behave correctly: field error / Save disabled and step not complete.)
- **Evidence:** screenshots/web/admin/project-setup__facility-target-zero-error.png, screenshots/web/admin/project-new__basics-budget-zero-error.png
- **Suspected area:** Facility step validation / tranche schema (`targetProgressPct` minimum).

### W-012 · Minor · Leaving a saved wizard step still triggers the browser "Leave site?" prompt
- **Check:** P6-W-04
- **Role / project:** admin@insite.ng / QAW-601 Facility and Standards steps
- **Steps:** 1. On Facility, save (toast "Saved."). 2. Reload. Or: on Standards, add a standard and upload documents (all saved server-side), then reload.
- **Expected:** no unsaved-changes prompt after everything is saved.
- **Actual:** a `beforeunload` prompt appears. (The in-app guard on navigation — "Save your changes first? / Save and leave / Leave without saving / Stay on this page" — works correctly with real unsaved changes.)
- **Evidence:** Playwright `beforeunload` dialog events; screenshots/web/admin/project-setup__unsaved-changes-dialog.png (the correct in-app guard)
- **Suspected area:** dirty tracking of the Facility and Standards steps.

### W-013 · Major · Needs-assessment summaries stay "Summary pending" forever; no retry
- **Check:** P7-W-02
- **Role / project:** admin@insite.ng / QAW-601 Standards and needs assessment
- **Steps:** 1. Upload a .txt document with "Ask for an AI summary" ticked. 2. Upload a .png the same way. 3. Wait 5+ minutes, revisit.
- **Expected:** text → summary done (Azure OpenAI is LIVE); image → `UNAVAILABLE` ("no readable text"); a "summarise" retry action.
- **Actual:** both rows show "Summary pending" after more than 5 minutes; API `GET /projects/:id/needs-assessments` returns `summaryStatus: "PENDING"`, `summaryEngine: null` for both; no retry/summarise button anywhere on the page.
- **Evidence:** screenshots/web/admin/project-setup__standards-docs-uploaded.png, screenshots/web/admin/project-setup__standards-docs-status.png
- **Suspected area:** needs-assessment summary job (not run, or failing without updating the status).

### W-014 · Major · Turning tranches/CPs and hold points off leaves tranche and hold-point UI visible
- **Check:** P7-W-09
- **Role / project:** admin@insite.ng / QAW-601 (Rapid CapEx template, then "Tranches and conditions precedent" and "Hold points" switched off, then activated)
- **Steps:** 1. Workflow step: apply Rapid CapEx, switch both off, save. 2. Activate. 3. Open the project dashboard and Settings → Bill of quantities.
- **Expected:** tranche, CP and hold-point UI hidden (the switch text says "the project is one implicit tranche and conditions precedent are not checked" / "hold-point flags are ignored … and hidden").
- **Actual:** dashboard shows "INTEGRITY CHECK · 0 Hold-Points" and "Release Readiness · Tranche 1 · Allocation ₦50,000,000 · Target 100% · Holdback Recommendation"; BOQ settings keeps the "Tranche" column, "Accept 0 suggested tranche(s)", "Every item must be mapped to a tranche before activation"; the sidebar still says "BOQ & Hold-Points". The hold-point column itself is hidden on the BOQ step (correct).
- **Evidence:** screenshots/web/admin/dashboard__qaw-601-new-active.png, screenshots/web/admin/project-settings__boq-tranches-off.png
- **Suspected area:** dashboard release-readiness card, BOQ step tranche column, nav label (process config `enableTranches`/`enableHoldPoints` not read there).

### W-015 · Minor · A pending cadence change shows only its date, not what changes
- **Check:** P8-W-01
- **Role / project:** admin@insite.ng / OGN-305 Settings → Reporting
- **Steps:** 1. Untick Saturday, Save ("Saved."). 2. Leave the step and return.
- **Expected:** the pending change is visible (e.g. "From 2026-11-23: Mon–Fri").
- **Actual:** the form shows the current settings again (Saturday pressed, preview "due Saturday 17:00") with only "A saved change takes effect on 2026-11-23, when the current period ends." The admin cannot see or undo what is pending. API `pendingChange` returns only `{ effectiveFrom }`.
- **Evidence:** screenshots/web/admin/project-settings__ogn-305-reporting-after-save.png

### W-016 · Cosmetic · Copy and interaction nits seen on the way
- **Check:** various
- **Actual:** dashboard card "0 Open Querys" (QAW-601); evidence drawer and report drawer do not close on Escape (a click on "Done reviewing" is needed); the project code in the header (`text-brand-sky`) stays light blue when the brand colour changes (P6-W-23 input).
- **Evidence:** screenshots/web/admin/dashboard__enu-501-draft.png, screenshots/web/admin/settings-branding__preview-pink-top.png

### W-017 · Minor · "Site inspections" card with "No accepted baseline survey" shows on every demo-tenant project
- **Check:** P4-W-01 (seen on the way)
- **Role / project:** monitor@ / LKK-402, OGN-305, QAW-601
- **Expected:** projects with no inspection stream do not nag for a baseline survey.
- **Actual:** every project dashboard has a "Site inspections" card with an amber "No accepted baseline survey" tag, "Next inspection due: Nothing scheduled".
- **Evidence:** screenshots/web/monitor/dashboard__lkk-402.png, screenshots/web/monitor/dashboard__ogn-305.png

### W-018 · Minor · "Due and overdue" lists contractor items as Due although a report exists for the period
- **Check:** P8-W-04
- **Role / project:** monitor@ / LKK-402 Site presence (2026-11-20)
- **Actual:** "Reports in this period 1 / 10 · 9 still due"; WBS 02.01.1 and 02.01.2 "Julius & Sons … Due" while the reports table lists Chukwudi Nnamdi (contractor) reports for both items today. May be seed data that does not fulfil obligations; needs triage.
- **Evidence:** screenshots/web/monitor/site-presence__lkk-402.png

### W-019 · Minor · Voice note shows "Not transcribed." although Whisper is live
- **Check:** P4-W-03 (X-01)
- **Role / project:** monitor@ / LKK-402 WBS 01.02.1 Rev #1, voice note 61d2c47c… (submitted 13:38)
- **Actual:** about 25 minutes later the report drawer still says "Not transcribed." (health reports `standaloneWhisper: LIVE_STANDALONE_WHISPER`). The recording itself plays.
- **Evidence:** screenshots/web/monitor/site-presence__report-rev1-x01.png

## Results

Run stopped early by the owner for a demo (2026-11-20 ~14:05 WAT). Unrun checks are deferred.

| Check ID | Result (PASS / FAIL / BLOCKED / NOT RUN) | Finding IDs | Note |
| :--- | :--- | :--- | :--- |
| P2-W-01 | PASS |  | Web half: renamed QAW Web Role; qaw.user1 header shows "QAW Web Role Renamed". Mobile half NOT RUN (by rule). |
| P3-W-01 | NOT RUN |  | Deferred until after the demo. |
| P3-W-02 | NOT RUN |  | Deferred until after the demo. |
| P3-W-03 | NOT RUN |  | Deferred until after the demo. |
| P3-W-04 | PASS |  | Labels "QAW Corroborated"/"QAW Partly corroborated" shown in LKK-402 workbench and evidence drawer; restored to blank (defaults) in the same check. PDF not checked (no certified valuation at the time). |
| P3-W-05 | NOT RUN |  | Deferred until after the demo. |
| P4-W-01 | PASS |  | Empty projects (KAN-210, OGN-305, QAW-601) show "No data", no "100% Within"; integrity pod shows "0 mock location · N duplicate photo". |
| P4-W-02 | PASS |  | LKK-402 pin card: WBS, caption, "Inside geofence · Signature checked", reporter, ±5.0m GPS. |
| P4-W-03 | PASS | W-019 | X-01 report (LKK-402 WBS 01.02.1 Rev #1): thumbnail opens full size (new tab), voice note plays (20 s), typed note listed, "AI omission check" label. Voice note shows "Not transcribed." (W-019). |
| P4-W-04 | FAIL | W-005 | Ping labels correct ("App open", "Capture", "Report submitted"); "hourly" remains in the permission catalog. |
| P4-W-05 | NOT RUN |  | Half done: seeded LKK-402 line drawer shows "Inside geofence", "Not signed by device"; X-10 photos not checked. Deferred until after the demo. |
| P4-W-06 | NOT RUN |  | Half done: LKK-402 has 1 pending contractor verification (Engr. Babatunde Fashanu); not opened. Deferred until after the demo. |
| P4-W-07 | FAIL | W-004 | Settings Access tab wording correct; role/permission descriptions still say "liveness". Executive page not checked. |
| P4-W-08 | PASS |  | X-02: "Mark resolved" on query 7d5df38f… → RESOLVED, toast "The reporter has been notified." |
| P4-W-09 | PASS |  | X-02: "Withdraw query" on unanswered query 6c15217a… → shown as RESOLVED (same behaviour). |
| P4-W-10 | FAIL | W-001, W-002 | Login and Mobile app pages label examples; Home hero does not. No liveness wording. |
| P5-W-01 | PASS |  | Onboarding control with both modes and explanations; provisioned disables/unchecks identity check. Confirmation listing affected projects verified on QAW Field Role (lists KAN-210); Clerk of Works editor opened and cancelled without saving (the tool refused to click Save on a seeded role). |
| P5-W-02 | PASS | W-006, W-007 | qaw.user1@insite.ng created with Mobile access (provisioned roles + None) and phone; mobile badge in table. |
| P5-W-03 | PASS | W-008 | Join-code sessions and provisioned devices in separate tables (origin, code, device). Revoked only the QAW-owned device (qaw.user1, created via mobile login API). |
| P5-W-04 | PASS |  | KAN-210 join-code role list excludes Monitor Inspector with explanation. |
| P6-W-01 | PASS |  | QAW Org One added (tags), edited, archived (in-app confirm); hidden from the add-user picker. |
| P6-W-02 | PASS |  | DIRECTORY: search picker only; FREE_TEXT: text field; in add-user drawer and parties step. Restored to BOTH in the same check. |
| P6-W-03 | PASS | W-008 | QAW-601 created, left, resumed from Drafts; QAW-602 created and deleted; no "Pending Approval" tab. |
| P6-W-04 | PASS | W-009, W-012 | Step states, Saved, Back/Save/Save and continue, in-app unsaved-changes dialog all correct. |
| P6-W-05 | PASS |  | Empty fields on a new draft; "Fill with sample data" shown (demoMode true). Monitor org pre-filled with the creator organisation (not a demo value). |
| P6-W-06 | FAIL | W-011 | Budget 0 → field error; blank geofence → Save disabled, step stays incomplete; target progress 0 accepted. |
| P6-W-07 | PASS |  | Three model cards with explanations; columns change per model (main flag / trade code + package budget / field reporting). |
| P6-W-08 | PASS | W-010 | Radial by click, corridor by clicks, typed coordinates, self-intersecting perimeter refused, tolerance override, time zone list default Africa/Lagos. |
| P6-W-09 | PASS |  | CSV with "12,500" and "Item No" parsed; preview; hold-point and tranche columns; no contractor column with one contractor; "Accept suggested tranches"; unmapped items blocked activation; KAN-210 "Suggest packages" opened an AI suggestion (not applied). |
| P6-W-10 | PASS |  | Summary cards with Edit, issues listed, activation blocked with reason, "Save draft" with toggle off; QAW-601 activated, 2 join codes issued. |
| P6-W-11 | FAIL | W-009 | Banner on setup pages (QAW-601, QAW-603, ENU-501). ENU-501 /dashboard shows no banner and renders QAW-601 dashboard instead. |
| P6-W-12 | NOT RUN |  | Half done: KAN-210 description edit saved and audited ("PROJECT SETUP STEP SAVED"); code field disabled "Fixed once the project is active." Contractor-model refusal not tested (KAN-210 has no IPC yet). |
| P6-W-13 | NOT RUN |  | Half done: directory "Actions for QAW-601" → Archive dialog with reason field seen and cancelled; settings header has "Archive project". Not archived. |
| P6-W-14 | NOT RUN |  | Half done: ABJ-108 radial, LKK-402 corridor, OGN-305 perimeter drawn and fitted on dashboards, header/dashboard labels correct; evidence drawer label not checked. |
| P6-W-15 | NOT RUN |  | Deferred until after the demo. |
| P6-W-16 | PASS |  | Corridor/chainage words only on LKK-402 (dashboards of ABJ-108, KAN-210, OGN-305, EDO-410: none). |
| P6-W-17 | NOT RUN |  | Deferred until after the demo. |
| P6-W-18 | NOT RUN |  | Deferred until after the demo. |
| P6-W-19 | NOT RUN |  | Deferred until after the demo. |
| P6-W-20 | NOT RUN |  | Deferred until after the demo. |
| P6-W-21 | NOT RUN |  | Deferred until after the demo. |
| P6-W-22 | PASS |  | Primary colour change previews live (CSS tokens); not saved; reload restored #00338D. |
| P6-W-23 | NOT RUN |  | Deferred until after the demo. |
| P6-W-24 | NOT RUN |  | Deferred until after the demo. |
| P6-W-25 | NOT RUN |  | Deferred until after the demo. |
| P7-W-01 | PASS |  | Template picker pre-fills (Rapid CapEx → direct milestone chain); toggles; chains editable; certification and release steps fixed (no remove). |
| P7-W-02 | FAIL | W-013 | Add from library, edit, delete work; requiredness follows mode (missing standard listed at activation); document summaries stuck "Summary pending", no retry. |
| P7-W-03 | PASS |  | KAN-210 shows "Chain and setting changes apply to new items only…"; EDO-410 and LKK-402 pages viewed only. |
| P7-W-04 | PASS |  | Three seeded templates listed; QAW Template created and edited. Hidden-tab part not swept (role sweep deferred). |
| P7-W-05 | NOT RUN |  | Deferred until after the demo. |
| P7-W-06 | PASS |  | X-06/X-07 on EDO-410: standards badge with CONC-SLUMP violation on Rev #1; chain position; reporter (monitor@) sees "someone else must review"; verifier@ approved Rev #2 in the UI. |
| P7-W-07 | NOT RUN |  | Deferred until after the demo. |
| P7-W-08 | NOT RUN |  | Half done: verifier@ sees "Verify milestone" (no claim submission) on EDO-410; dialog not opened. |
| P7-W-09 | FAIL | W-014 | QAW-601 with tranches/CPs and hold points off still shows tranche and hold-point UI. Executive page, itinerary and drawer not checked. |
| P7-W-10 | PASS |  | EDO-410 "Pending approval only" checkbox lists only the PENDING_APPROVAL report (only one report existed, weak check). |
| P7-W-11 | NOT RUN |  | Deferred until after the demo. |
| P7-W-12 | NOT RUN |  | Half done: KAN-210 review step "QAW high-value review" (ipc:view, Lender Technical Officer, from NGN 100,000,000) saved; no valuation yet to test it. |
| P7-W-13 | NOT RUN |  | Deferred until after the demo. |
| P8-W-01 | PASS | W-015 | QAW-601 Reporting step: day picker, week start, custom interval, due time, grace, preview. OGN-305: Saturday removed → "A saved change takes effect on 2026-11-23" (left pending; web-owned). |
| P8-W-02 | PASS |  | QAW-601 Team step: expected participants added (join-code role with email; provisioned role linked to QAW User One), planned date, offsets, status "Invited". KAN-210 settings variant not done. |
| P8-W-03 | PASS |  | Project schedule saved (5,2,1); per-participant override "No reminders for this person". |
| P8-W-04 | PASS | W-018 | EDO-410 grouped by weekly period "2026-11-16 → 2026-11-21"; "Due and overdue" list present (LKK-402). |
| P8-W-05 | BLOCKED |  | No data: no attendance alerts on LKK-402 or EDO-410. |
| P8-W-06 | NOT RUN |  | Deferred until after the demo. |
| P8-W-07 | PASS |  | KPI cards: reports this period, late/missed, open attendance alerts. |
| P9-W-01 | PASS |  | QAW-601 Schedule step: dates, Suggest item dates, predecessors, inline "starts before" error, cycle refused on save; saved 5 of 5. |
| P10-W-01 | NOT RUN |  | Deferred until after the demo. |
| P10-W-02 | NOT RUN |  | Deferred until after the demo. |
| P11-W-01 | NOT RUN |  | Deferred until after the demo. |
| P11-W-02 | NOT RUN |  | Deferred until after the demo. |
| P11-W-03 | NOT RUN |  | Deferred until after the demo. |
| P11-W-04 | NOT RUN |  | Deferred until after the demo. |
| P11-W-05 | NOT RUN |  | See W-003 for context. Deferred until after the demo. |
| P11-W-06 | NOT RUN |  | Deferred until after the demo. |
| P11-W-07 | NOT RUN |  | Deferred until after the demo. |
| P11-W-08 | NOT RUN |  | Deferred until after the demo. |
| P11-W-09 | NOT RUN |  | Deferred until after the demo. |
| P11-W-10 | NOT RUN |  | Deferred until after the demo. |
| P11-W-11 | NOT RUN |  | Deferred until after the demo. |
| P12-W-01 | NOT RUN |  | Deferred until after the demo. |
| P12-W-02 | NOT RUN |  | Deferred until after the demo. |
| P12-W-03 | NOT RUN |  | Deferred until after the demo. |
| P12-W-04 | NOT RUN |  | Deferred until after the demo. |
| P12-W-05 | NOT RUN |  | Deferred until after the demo. |
| P12-W-06 | NOT RUN |  | Deferred until after the demo. |
| P14-W-01 | NOT RUN |  | Deferred until after the demo. |
| P14-W-02 | NOT RUN |  | Deferred until after the demo. |
| P14-W-03 | NOT RUN |  | Deferred until after the demo. |
| P14-W-04 | NOT RUN |  | Deferred until after the demo. |
| P14-W-05 | NOT RUN |  | Deferred until after the demo. |
| P14-W-06 | NOT RUN |  | Deferred until after the demo. |
| X-01 | PASS |  | Web half = P4-W-03. |
| X-02 | PASS |  | Web half = P4-W-08/09. |
| X-06 | PASS |  | Web half = P7-W-06 (approved Rev #2 as verifier@ 14:04). |
| X-07 | PASS |  | Standards badge on EDO-410 Rev #1. |
| X-03 | NOT RUN |  | Deferred until after the demo. |
| X-04 | NOT RUN |  | Deferred until after the demo. |
| X-05 | NOT RUN |  | Deferred until after the demo. |
| X-08 | NOT RUN |  | Deferred until after the demo. |
| X-09 | NOT RUN |  | Deferred until after the demo. |
| X-10 | NOT RUN |  | Deferred until after the demo. |
| X-11 | NOT RUN |  | Deferred until after the demo. |
| X-12 | NOT RUN |  | Deferred until after the demo. |
| X-13 | NOT RUN |  | Deferred until after the demo. |
| X-14 | NOT RUN |  | Deferred until after the demo. |

## Role sweep

NOT RUN: deferred until after the demo. Seen on the way: admin@ (platform super admin) sees programme-tenant projects (W-003); qaw.user1 (QAW Web Role Renamed: boq:view, ipc:view, projects:view_assigned, reports:view_all) sees All Projects, Geospatial & Portfolio, IPC Reconciliation, BOQ & Hold-Point Rules, Settings only; monitor@ has no Handover/Retention entries on a construction project.

## Notes for CLAUDE.md

