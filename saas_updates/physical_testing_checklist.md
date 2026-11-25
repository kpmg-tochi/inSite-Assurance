# Physical Testing Checklist

Manual checks on the web portal and on a phone that automated tests cannot cover. Each phase adds its section when it is implemented. Run everything at the end of the programme, then report failures by ID (for example "R5-M-07 failed on iOS: …" plus a screenshot) so they can be debugged one by one.

| | |
| :--- | :--- |
| **Covers** | Phases 1 to 4 (web), the redesign R5 visit app (section 4). Checks for removed features are listed in section 5. |
| **Last updated** | 2026-11-24 |
| **Needs** | A computer running the API and web app, one Android phone and one iPhone (a second phone of either kind helps for the two-officer and duplicate-photo tests), the seeded demo data |

---

## 0. Setup

### 0.1 Server and web
- [ ] **S-01** Reset the dev database and seed it: `cd server && npx prisma migrate reset --force && npm run prisma:seed`. Expected: the seed ends with "✅ Seed complete!" and prints the demo logins. Keep that output. (There are no join codes since redesign R1d: every phone user signs in with an account.)
- [ ] **S-02** In `server/.env`, set `PUBLIC_API_BASE_URL` to the computer's LAN address, for example `http://192.168.1.20:4000`. Phones cannot reach `localhost`, and uploads to local storage use this address.
- [ ] **S-03** Start the API (`npm run dev:server`) and the web app (`npm run dev:web`). Open `/api/v1/health`. Expected: `objectStorage` is `LOCAL_DISK_DEV` (or `S3_COMPATIBLE` if S3 is configured), and `standaloneWhisper` is `NOT_CONFIGURED` unless a key is set.

Seeded logins (password `Password123!`):
- Main workspace, web: `admin@insite.ng`, `monitor@insite.ng`, `lender@insite.ng`, `lto@insite.ng`, `verifier@insite.ng`.
- Main workspace, phone: `resident.cow@insite.ng` and `field.officer@insite.ng` (LKK-402), `resident.abj@insite.ng` (ABJ-108 only).
- UBEC tenant, web (UBEC roster): `admin@ubec.test` (UBEC Administrator; also acts for Legal, the Executive Secretary, Finance and Audit), `kano.admin@ubec.test` and `lagos.admin@ubec.test` (SUBEB Administrators), `me.officer@ubec.test` (UBEC M&E Officer); also seeded, not in the quick login: `lagos.me@ubec.test` (SUBEB M&E Officer), `independent.me@ubec.test` (Independent M&E).
- UBEC tenant, phone: `resident.supervisor@ubec.test` (Resident Supervisor, mobile only; visit officer; see section 4), and the three M&E accounts `me.officer@`, `lagos.me@`, `independent.me@ubec.test` (web and phone; one seeded visit each, section 4).

There are no contractor logins (redesign R1d).

### 0.2 Mobile development build
SQLCipher and push notifications do not work in Expo Go, so testing needs a development build.
- [ ] **S-04** In `mobile/eas.json`, replace the placeholder API hosts (`SET-…-API-HOST.invalid`) for the profiles you will use. Set `EAS_PROJECT_ID` (an EAS secret or environment variable) so push tokens work.
- [ ] **S-05** Build and install: `cd mobile && eas build --profile development --platform android` (and `--platform ios` for the iPhone). Then run `npx expo start --dev-client` on the same network as the phone.
- [ ] **S-06** Expected on first launch: no notification permission prompt yet (it is asked later, in context), and no background-location prompt at any point.

---

## 1. Carried over from Phases 1 to 3 (web)

- [ ] **P2-W-01** Rename a role in Settings → Roles & Permissions. Expected: the new name shows in the web header of a user with that role, and in the phone profile of a field user who signs in with it.

The Phase 3 claim checks (P3-W-01 to P3-W-05) are retired: see section 5.

---

## 2. Phase 4: web portal

- [ ] **P4-W-01** Project → Overview map. Expected:
  - pins only for captures that have a GPS fix
  - "No data" when there are no captures
  - no "100% Within" or "Verified" text on an empty project
  - (the "Geofence & Capture Integrity" card was removed from the Overview in redesign R6c)
- [ ] **P4-W-02** Click a pin. Expected: the side card shows the caption or transcript, geofence result, signature result ("Signature checked", "Unsigned" or "Signature invalid"), reporter, and GPS accuracy. (Its WBS item line goes when R5f removes the capture's WBS link.)
- [ ] **P4-W-10** Signed out: the public pages (Home, Mobile app) carry no lender, AI, join-code or "liveness" text, and label sample positions as examples. `/about` redirects to `/`.

P4-W-03 to P4-W-09 are retired: see section 5.

---

## 3. Phases 4 and 12–16: mobile app (old app)

Every check written for the old app (WBS inbox and chat, daily reports, end-of-day sheet, join codes, identity assurance, Phase 14 inspections and findings, registration on the assurance step, Phase 13 check-in) is retired: those screens were deleted in redesign R5e, and their server side goes in R5f. Section 5 lists each retired ID and the R5 check that replaces it. The new app's checks are in section 4.

---

## 4. Redesign R5: visit app on a device (device run pending)

No device run has been done since Phase 5. Run **every check on one Android and one iOS device** against a fresh seed (S-01), and report the platform with a failure.

Main account: `resident.supervisor@ubec.test`. It is assigned to PRG-102, PRG-104, PRG-105, PRG-211 and PRG-221 (and archived PRG-242, which the phone does not list). Its seeded visits: PRG-102 the first mobilisation check (published); PRG-105 a routine visit on the next working day, three published visits (one with a pending date proposal, one declined) and the proposed plan; PRG-211 three accepted past visits; PRG-221 a missed quarterly M&E visit. Web counterpart: `me.officer@ubec.test` (Visit planner and Visits & reports).

The three M&E roles are provisioned too (surface Both: web and phone with the same account). Each has one seeded upcoming visit to run the same checks with: `me.officer@ubec.test` a routine visit on PRG-105 (in two working days; sees her assigned projects PRG-102, PRG-103, PRG-104, PRG-105, PRG-211, PRG-221), `lagos.me@ubec.test` a mobilisation check on PRG-221 (in two working days; sees her assigned live projects PRG-221 and PRG-241), `independent.me@ubec.test` an ad hoc visit on PRG-105 picking one facility (in four working days; sees its assigned projects PRG-102, PRG-105, PRG-211).

- [ ] **R5-M-UBEC-01** Sign in on the phone as each of `me.officer@ubec.test`, `lagos.me@ubec.test` and `independent.me@ubec.test`. Expected: Home lists the projects that account can see and its seeded visit on the calendar; the visit opens, checks in and submits like the Resident Supervisor's; the same account still signs in on the web.

Photos must be taken inside the project's site boundary to fill a slot. Unless you test at a seeded site, move PRG-105's pin to where you are first (as `admin@ubec.test`: PRG-105 → More ▸ Settings → Project → Location), then pull down on Home.

### 4.1 Sign-in and Home
- [ ] **R5-M-01** Sign in as `resident.supervisor@ubec.test`. Expected: Home opens directly (no project picker); My projects shows PRG-102, PRG-104, PRG-105, PRG-211 and PRG-221, each card with code, name, stage, sprint ("Sprint 3 of 3" on PRG-105), next visit and open findings; PRG-102 shows its mobilisation deadline as on the web ("5 days left, due Sun 29 Nov"; "Due today"; "N days overdue"); PRG-242 (archived) is not listed. Visits show straight after sign-in, without pulling down (UBEC fix 2026-11-24; passes on the emulator, `mobile/.maestro/ubec_field_smoke.yaml`).
- [ ] **R5-M-02** Forced password change: sign in with an account that must change its password. Expected: the change-password screen comes first, then Home.
- [ ] **R5-M-03** Single-project home: sign in as `resident.abj@` (ABJ-108 only). Expected: Home shows that project's card in full (current sprint and deliverables, units in the sprint, open findings, next visit, Site log and Defects shortcuts) instead of a list; the calendar and "+ Unscheduled visit" are still there.
- [ ] **R5-M-04** Calendar: switch week ⇄ month; swipe several months forward and back. Expected: each swipe lands on the next or previous month (no skipped, blank or doubled months, no jump back to today); dots differ by shape as well as colour (planned, overdue, done) with a legend in words; tapping a day lists its visits.
- [ ] **R5-M-05** Airplane mode on Home. Expected: the cached window (30 days back, 14 days ahead) still shows with an offline note; a month outside it says it needs a connection and names the window. Online again, that month loads.
- [ ] **R5-M-06** Time zone (`Intl` under Hermes): set the phone to a zone far from Africa/Lagos (for example UTC−8, around the project's midnight). Expected: "today" on the calendar, overdue marking and the visit day follow the project's zone, not the phone's; check-in and photo times show in the project's zone; no crash or blank dates.

### 4.2 Responses
- [ ] **R5-M-07** Confirm the PRG-105 routine visit offline (optional comment). Expected: "Waiting to send" on the visit; online, the web planner shows it confirmed.
- [ ] **R5-M-08** Move offline. Expected: only dates inside the allowed window are offered (± 2 working days of the original date, inside its sprint); the new date shows marked pending; online, the web shows the moved date.
- [ ] **R5-M-09** Propose a date outside the window (a comment is required). Expected: the original date stays; the proposal waits in the web planner's side panel; after the manager accepts it and you pull down on Home, the phone shows the new date.
- [ ] **R5-M-10** Decline with a comment. Expected: the web planner lists the visit as declined.
- [ ] **R5-M-11** Move a visit on the web planner, then respond to it on the phone while still offline with the old data; go online. Expected: the response is refused with "This visit changed since you responded. Refresh and respond again."; the Outbox shows it failed and offers Remove.

### 4.3 Check-in
- [ ] **R5-M-12** Check in inside the boundary ("On site"), within the tolerance band ("Just outside the boundary") and outside it ("Outside the site boundary", with the distance). Expected: each is allowed; on the web the outside check-in is flagged on the visit.
- [ ] **R5-M-13** Check in with location off ("No location") and with a mock-location app on Android ("Simulated location"). Expected: check-in still allowed and flagged on the web.

### 4.4 Form, review and submission
- [ ] **R5-M-14** Form download (304): with the visit's form already on the phone, pull down on Home while online. Expected: the API log shows `304` for `GET …/visits/:id/form` (no second download) and the form still opens offline. If the Visit screen says the form is not on the phone, "Download the form" fetches it.
- [ ] **R5-M-15** Fill a Routine visit on PRG-105 offline: every field type (text, number with unit, percentage, yes/no/N/A, single and multiple choice, date, rating, photo, voice note); one photo per unit in the Toilet's per-unit slots; a rule-triggered comment; a rule note "This answer will raise a finding". Expected: one section per screen with a progress bar; photos only from the in-app camera.
- [ ] **R5-M-16** Photo boundary rule: take a photo for a slot outside the boundary, and one with a mock location. Expected: the slot shows "Outside the site boundary" (or no location) and asks for a retake; submission stays blocked until it is replaced.
- [ ] **R5-M-17** Re-check item: on a visit with an open finding (submit a visit that raises one first, then use the next unstarted visit). Expected: a re-check block per finding ("Resolved?", comment, photo).
- [ ] **R5-M-18** Close the app mid-form (swipe it away) and reopen. Expected: the draft resumes at the same section with its answers and photos.
- [ ] **R5-M-19** Review (`popTo`): tap an issue on the review screen. Expected: the form opens at that section; going back to review and submitting returns to the Visit screen, and the back button does not reopen the form or the review.
- [ ] **R5-M-20** Submit offline, then reconnect. Expected: the Outbox drains in order (photos, then the check-in, then the report); the web shows the submission with photos under each unit, the check-in location and the findings raised.
- [ ] **R5-M-21** Form rebuilt on the web after the phone checked in. Expected: opening the visit shows "The form was rebuilt" listing any answers that no longer fit; the notice survives a restart until dismissed.
- [ ] **R5-M-22** Two officers on one visit (second phone): the second officer submits first. Expected: the first phone's report shows "Report refused" with the already-submitted message, and offers "Copy into a new report" and Delete.
- [ ] **R5-M-23** One open draft per visit (expo-sqlite partial index): on a visit with a refused report, "Copy into a new report", fill a little, close and reopen the app. Expected: no database error; the visit resumes that one new draft and the refused report stays beside it.
- [ ] **R5-M-24** Return a submission on the web. Expected: the phone (online) starts a correction pre-filled with the answers and comments; photos and voice notes are dropped and listed.

### 4.5 Unscheduled visit
- [ ] **R5-M-25** In airplane mode: "+ Unscheduled visit" → PRG-105 → pick a facility → create, check in, fill and submit. Expected: all offline; online, the web shows an Ad hoc visit with its submission.

### 4.6 Site log
- [ ] **R5-M-26** Project → Site log: add a photo, a voice note and a note offline. Expected: each geotagged and saved; online, the web's Visits & reports → Site log shows them. With Whisper configured the voice note's transcript appears after upload; without it no transcript is shown.
- [ ] **R5-M-27** In a photo slot, "Pick from site log" with an unsent site log photo from the check-in day. Expected: it fills the slot and leaves the site log; a sent entry is not offered there, only "attach" on the review screen.

### 4.7 Defects, incidents, notifications
- [ ] **R5-M-28** Defects (a role with `defects:manage`, on a project past construction or with open defects; assign the account to PRG-103 on the web if needed): close a defect with photos offline, then online; reopen one. Expected: the web defect board follows.
- [ ] **R5-M-29** ~~Project → Report an incident.~~ Not ready: the shortcut is hidden (2026-11-24) because the web portal has no incident screen and the server alerts nobody. Re-enable in `ProjectScreen.tsx` once the portal reads incidents.
- [ ] **R5-M-30** Push with the app in the background: publish a visit to the officer on the web, and let a reminder fire for an unconfirmed visit. Expected: a push arrives; tapping it opens that visit.
- [ ] **R5-M-31** Notification centre across projects: generate notifications on two projects. Expected: one list merging every project; a project that fails to load shows a warning instead of hiding the rest; a visit notification opens the visit, a defect one opens Defects; old notification types show as "Update".

### 4.8 Outbox and sync
- [ ] **R5-M-32** Outbox actions: with failed and waiting rows of several kinds. Expected: rows grouped per project and labelled (Visit report, Check-in, Visit response, Site log entry, Photo, Defect update, Incident) with state, saved time and last error; Retry on failed rows; Remove only on a refused report, a failed response, a failed or held defect update, a failed incident, and a held photo or voice note (which also offers "Send again"); failed photos, check-ins, unscheduled visits and site log entries offer Retry only. The Home header badge counts waiting rows.
- [ ] **R5-M-33** Outbox shows no "Local data is not encrypted" warning (that warning means the build lacks SQLCipher).
- [ ] **R5-M-34** Remove the account from a project on the web while the phone has rows waiting for it. Expected: the session-ended screen offers "Continue with my other projects" (or Sign out); nothing is deleted.
- [ ] **R5-M-35** Sign out and back in. Expected: downloaded visits and forms are cleared and downloaded again; drafts and unsent work are kept.

### 4.9 Upgrade and native build
- [ ] **R5-M-36** Upgrade (SQLite v9 → v10): install a pre-R5 build, queue items of the old kinds offline (a daily report, a chat message, a site inspection, plus photos), then install the R5 build over it. Expected: the app opens without a crash; the old-kind rows are gone from the Outbox; photos are kept; the visit app works.
- [ ] **R5-M-38** UBEC branding after a native rebuild (`app.json` and `APPLICATION_NAME` reach the launcher only through a new build): the launcher label and the notification permission prompt say "UBEC Project Monitoring", Android notifications use UBEC green `#00715D`. JS-side branding (green headers, UBEC landing photo and logo, dot-and-text statuses) is already verified on the emulator.
- [ ] **R5-M-39** Navigation (owner, 2026-11-24): the Profile screen has no project list; Project, Visit and Site log screens have a Home button that returns to Home (calendar and every project). Passes on the emulator; repeat on a device.
- [ ] **R5-M-37** Permission texts after a native rebuild (the texts are in `app.json`, so they need a new EAS build, not only a JS reload): on first use, the camera, microphone and location prompts name visits, defects and the site log. Check on both platforms.

### 4.10 Photo compression and compass heading (UBEC IRL, 2026-11-25)
`expo-image-manipulator` is a new native module: these checks need a new development build (S-05), not a JS reload. Without it the camera falls back to the uncompressed photo.
- [ ] **IRL-M-01** Photo size: take 10 site photos in daylight (a busy scene, a plain wall, a signboard at ~5 m) and 2 indoors in low light on a mid-range Android phone and on an iPhone. Expected: each upload is 1600 px on the long edge and about 150–450 KB (server: `EvidenceMedia.byteSize`; web: open full size and check the dimensions); none above ~600 KB; the signboard lettering is readable at full size; portrait photos stay upright. Record the sizes here to correct the IRL storage sizing.
- [ ] **IRL-M-02** Integrity after compression: the same photos register without `CLIENT_HASH_MISMATCH`, `SIGNATURE_INVALID` or `IMAGE_NOT_DECODABLE`; two photos of the same scene seconds apart are not flagged as duplicates unless they really are near-identical.
- [ ] **IRL-M-03** Heading accuracy: stand at a known spot facing a known bearing (use a separate compass or map), take a photo facing N, E, S and W. Expected: the web visit drawer (hover the photo) and the evidence map show "Facing N/E/S/W (…°)" within about 20° once the compass is calibrated (figure-eight motion); the check-in sheet shows the heading under the GPS accuracy. Note whether the phone gave true or magnetic north (`Visit.checkInGeotag.headingReference`).
- [ ] **IRL-M-04** No compass or no reading: on a phone or emulator without a magnetometer (or with location permission denied), take a photo and check in. Expected: capture is not delayed by more than about a second; the photo shows "Heading not recorded" on the web; check-in and submission still go through.
- [ ] **IRL-M-05** Offline queue with compressed photos: in airplane mode take 20 photos across a visit, the site log and a defect, then reconnect. Expected: the Outbox drains; each photo uploads once; total data used is roughly 20 × 0.3 MB; the phone's `captures` folder holds the compressed files only (no full-size originals left in the cache after the app restarts).
- [ ] **IRL-M-06** Upgrade (SQLite v10 → v11): install this build over the previous one with unsent photos queued. Expected: the app opens without a crash; the old photos upload (without a heading); new photos carry one.

### 4.11 Client demo wave 1 (2026-11-25)
Labels and codes only (JavaScript), so a JS reload in Expo Go or the dev build is enough; the emulator's preview APK needs a rebuild to show them (working plan section 10). Needs the overlay seed (`SEED_PROFILE=ubec-demo`); account `resident.supervisor@ubec.test`.
- [ ] **PHY-DEMO1-01** Labels: Home, Project, Visit, VisitForm, VisitReview, Site log, Defects and Notifications use the glossary (work phase, Execution, monitoring report, follow-up check, rectified, punch list item, Mobilised to site, Defects liability period, Monitoring overdue). Expected: no "sprint", "construction" (as a stage), "re-check", "snag" or "region" on any screen. Note leftovers with the screen name.
- [ ] **PHY-DEMO1-02** Codes: project cards on Home, the Project header and the visit screens show "LOT n BATCH m" for the overlay's projects with "Intervention year" on the card and the Project screen (older codes as stored, no year); the same visit published on the web (WEB-DEMO1-09) appears, is confirmed, checked in and submitted.
- [ ] **PHY-DEMO1-03** Camera hint: opening the in-app camera from the visit form, the site log, a defect and an incident shows "Photograph the works, not pupils"; it does not cover the shutter or the frame, in portrait and landscape.
- [ ] **PHY-DEMO1-04** Follow-up check: a visit form with an open finding shows "Follow-up check: … Rectified?" with the answers "Rectified" / "Not rectified", and the review screen repeats them.

---

## 5. Retired checks

Not to be run. Listed so earlier reports that cite these IDs can be traced.

| IDs | Covered | Why retired | Replaced by |
| :--- | :--- | :--- | :--- |
| P3-W-01 to P3-W-05 | IPC claims, reconciliation, certification, conditions precedent, evidence ratings | Lender product deleted (R1b) | – |
| P4-W-03, P4-W-08, P4-W-09 | Site Presence reports, report queries | Workday reports deleted (R5e app, R5f server) | Visit review on the web (R5-M-20) |
| P4-W-04 | Presence pings | Presence telemetry deleted (R1e) | – |
| P4-W-05 | Reconciliation workbench evidence drawer | Lender product deleted (R1b) | – |
| P4-W-06, P4-W-07 | Contractor identity review (ID and selfies) | Identity assurance and contractor logins deleted (R1d) | – |
| P4-M-01, P4-M-03, P4-M-17 to P4-M-20 | Join codes, rejoining, identity wizard | Join codes and identity assurance deleted (R1d) | R5-M-01, R5-M-35 |
| P4-M-02 | Encryption warning in Sync status | Sync status became the Outbox (R5e) | R5-M-33 |
| P4-M-04 to P4-M-09 | Captures in the WBS chat (location, mock location, voice note, typed note, duplicate photo) | WBS chat deleted (R5e) | R5-M-15, R5-M-16, R5-M-26 |
| P4-M-10 to P4-M-14 | Daily report per WBS item, end-of-day sheet, offline report | Workday reports and the end-of-day sheet deleted (R5e) | R5-M-06, R5-M-15 to R5-M-20 |
| P4-M-15, P4-M-16 | Report queries and revisions | Workday reports deleted | R5-M-24 |
| P4-M-21 to P4-M-24 | Push for identity decisions, revoked join session, morning brief notices, presence | Identity, join sessions, morning briefs and presence deleted (R1d, R1e) | R5-M-30, R5-M-31, R5-M-34 |
| P14-M-01 to P14-M-06 | Reporting streams, Phase 14 inspections and findings on the phone | Streams deleted (R4f); inspection screens deleted (R5e), server side in R5f | R5-M-15 to R5-M-20, R5-M-17 |
| P13-M-01 to P13-M-03 | Contractor check-in completing mobilisation; join codes after termination | Telemetry check-in deleted (R1e); join codes deleted (R1d); mobilisation check visits complete the milestone (R4) | R5-M-12, R5-M-20 (on a PRG-102 mobilisation check) |
| P12-M-01 to P12-M-04 | Registration on the field assurance step | Registration and identity assurance deleted (R1d) | – |
| P16-M-01 | `resident.supervisor@ubec.test` project list | Superseded | R5-M-01 |
| P16-M-02, P16-M-03 | Resident supervision report; Phase 14 inspection flow and its KPI | Workday reports and inspections deleted | R5-M-20, then Programme KPIs "Visits conducted vs planned" |

---

## 6. Not ready to test yet

- Moving queued items between sessions after an account is removed from a project and added back: an exclamation on each item, with Remove or Update.
- Project-wide action notifications marked done for everyone once someone acts. The old app's action-required notifications (report queries, hold points, inspection findings) can no longer be completed from the phone; R5f cleans them up.
