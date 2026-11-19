# Physical Testing Checklist

Manual checks on the web portal and on a phone that automated tests cannot cover. Each phase adds its section when it is implemented. Run everything at the end of the programme, then report failures by ID (for example "P4-M-07 failed: …" plus a screenshot) so they can be debugged one by one.

| | |
| :--- | :--- |
| **Covers** | Phases 1 to 4 (Phase 4 implemented) |
| **Last updated** | 2026-11-19 |
| **Needs** | A computer running the API and web app, one Android phone (a second phone helps for the duplicate-photo test), the seeded demo data |

---

## 0. Setup

### 0.1 Server and web
- [ ] **S-01** Reset the dev database and seed it: `cd server && npx prisma migrate reset --force && npm run prisma:seed`. Expected: the seed ends with "✅ Seed complete!" and prints the logins and mobile join codes. Keep that output.
- [ ] **S-02** In `server/.env`, set `PUBLIC_API_BASE_URL` to the computer's LAN address, for example `http://192.168.1.20:4000`. Phones cannot reach `localhost`, and uploads to local storage use this address.
- [ ] **S-03** Start the API (`npm run dev:server`) and the web app (`npm run dev:web`). Open `/api/v1/health`. Expected: `objectStorage` is `LOCAL_DISK_DEV` (or `S3_COMPATIBLE` if S3 is configured), and `standaloneWhisper` is `NOT_CONFIGURED` unless a key is set.

Seeded web logins (password `Password123!`): `admin@insite.ng`, `monitor@insite.ng`, `lender@insite.ng`, `lto@insite.ng`, `contractor@insite.ng`.

### 0.2 Mobile development build
SQLCipher and push notifications do not work in Expo Go, so testing needs a development build.
- [ ] **S-04** In `mobile/eas.json`, replace the placeholder API hosts (`SET-…-API-HOST.invalid`) for the profiles you will use. Set `EAS_PROJECT_ID` (an EAS secret or environment variable) so push tokens work.
- [ ] **S-05** Build and install: `cd mobile && eas build --profile development --platform android`. Then run `npx expo start --dev-client` on the same network as the phone.
- [ ] **S-06** Expected on first launch: no notification permission prompt yet (it is asked later, in context), and no background-location prompt at any point.

---

## 1. Carried over from Phases 1 to 3 (web)

- [ ] **P2-W-01** Rename a role in Settings → Roles. Expected: the new name shows in the web header of a user with that role, and in the mobile profile of a field user who joined with it.
- [ ] **P3-W-01** Full claim cycle on a project with no IPC, signed in as the contractor, monitor, then lender:
  1. Submit an IPC.
  2. Run reconciliation.
  3. Raise a query, respond to it, then resolve it.
  4. Certify (dry run first).
  5. Approve as lender.
  6. Reverse the decision.

  Expected: each step is allowed only for the right role, and the status moves as described in the Phase 3 plan.
- [ ] **P3-W-02** A user who both certified and approves the same IPC is blocked (D-3.1).
- [ ] **P3-W-03** Release with an unsatisfied mandatory condition precedent is blocked; waiving it with a reason allows release (D-3.2).
- [ ] **P3-W-04** Change a rating label in tenant settings. Expected: the new label shows everywhere a rating appears (workbench, drawer, PDF).
- [ ] **P3-W-05** Withdraw an IPC. Expected: it becomes read-only.

---

## 2. Phase 4: web portal

- [ ] **P4-W-01** Project dashboard map. Expected:
  - pins only for captures that have a GPS fix
  - "No data" when there are no captures
  - the integrity pod shows real counts ("N mock location · N duplicate photo")
  - no "100% Within" or "Verified" text on an empty project
- [ ] **P4-W-02** Click a pin. Expected: the side card shows the WBS item, caption or transcript, geofence result, signature result ("Signature checked", "Unsigned" or "Signature invalid"), reporter, and GPS accuracy.
- [ ] **P4-W-03** Audit → Site Presence → open a report. Expected:
  - a thumbnail for each photo; clicking one opens it full size
  - "Play voice note" plays the recording
  - badges on the report for any location issue (for example "Low GPS accuracy")
  - notes typed in the chat are listed
  - the omission check is labelled "Rules omission check" (or "AI omission check" if Azure is configured)
- [ ] **P4-W-04** Presence pings are labelled "App open", "Capture" or "Report submitted". There is no "hourly" wording anywhere.
- [ ] **P4-W-05** Reconciliation workbench → evidence drawer on a line. Expected: each piece of evidence shows "Inside geofence", "Outside geofence" or "Location unknown", photo thumbnails, and the signature state.
- [ ] **P4-W-06** Contractor verification queue. Expected: three selfie photos (front, left, right) and the ID photo are visible, with the label "Selfie set (3 poses) for manual review". There is no "liveness verified", "3D liveness" or "head-turn" wording.
- [ ] **P4-W-07** Settings and the executive page describe identity checks as a photo ID plus a guided selfie set reviewed by a person.
- [ ] **P4-W-08** After a reporter revises a queried report (P4-M-16), the monitor clicks "Mark resolved" on the query in Site Presence. Expected:
  - the query shows RESOLVED
  - the reporter gets a "Query resolved" notification
  - the phone can no longer revise that report
- [ ] **P4-W-09** On a query nobody has answered yet, the button reads "Withdraw query" and behaves the same way.
- [ ] **P4-W-10** The login page and the public pages (Home, About, Mobile app) label sample positions as examples. Their integrity claims match the Phase 4 claims table (no "Live Verified Camera", no "liveness").

---

## 3. Phase 4: mobile app

### 3.1 Join and storage
- [ ] **P4-M-01** Join a project with an independent (non-contractor) join code. Expected:
  - you go straight to the WBS inbox
  - you are asked for notification permission right after joining
- [ ] **P4-M-02** Open Sync status (from the inbox banner, or Notifications → backlog). Expected: no "Local data is not encrypted" warning. That warning means the build lacks SQLCipher.
- [ ] **P4-M-03** Settings → clear local data, then rejoin. Expected: the app works normally, with no crash or stale threads.

### 3.2 Captures in the WBS chat
- [ ] **P4-M-04** Take two photos in a WBS thread with location on. Expected:
  - each photo appears straight away with "Pending upload"
  - it then changes to "In geofence" (or "Outside geofence") once sent
  - on the web (P4-W-01) the capture shows "Signature checked"
- [ ] **P4-M-05** Turn location off and take a photo. Expected:
  - the photo is saved with the badge "Location unavailable"
  - the thread header shows "Location unavailable" instead of a zone
  - no made-up coordinates or "Ch 14+200" anywhere
- [ ] **P4-M-06** Use a mock-location app (Android developer options) and take a photo. Expected: "Mock location flagged". On the web the capture fails integrity and does not count as evidence.
- [ ] **P4-M-07** Record a voice note. Expected: it plays back on the phone and on the web (P4-W-03).
- [ ] **P4-M-08** Send a typed note, for example "Cement arrived 2 days late". Expected: it shows as "Waiting to send" offline, and as sent once online.
- [ ] **P4-M-09** Duplicate photo: photograph the same printed picture from two different phones and accounts. Expected: the second one is flagged as a recycled photo on the web.

### 3.3 Daily report (one per WBS item per day)
- [ ] **P4-M-10** Open "Submit full report for today". Expected:
  - the hold-point checkbox appears only on hold-point items, starts unticked, and shows that item's own instruction
  - Submit is disabled until "This is my full report for today" is ticked and a GPS fix is shown
- [ ] **P4-M-11** Submit with a poor fix (indoors, accuracy over 50 m). Expected: the phone warns "low accuracy, the report will show a badge", and on the web the report shows "Low GPS accuracy".
- [ ] **P4-M-12** Submit, then try to submit again for the same item the same day. Expected:
  - the thread shows "Report submitted for today ✓"
  - a second report is refused with "already submitted"
  - on the web the report lists every photo, voice note and typed note from that thread
- [ ] **P4-M-13** Change the phone's time zone to one several hours away from the project's, then submit. Expected: the report's day matches the project's local date (Africa/Lagos for the seed), not the phone's date.
- [ ] **P4-M-14** **Offline end to end.**
  1. Turn on airplane mode.
  2. Take three photos and a voice note on one WBS item, then submit the report.
  3. Force-close the app, reopen it, and turn airplane mode off.

  Expected:
  - Sync status counts down to zero
  - on the web the report appears once, with four captures
  - in the reconciliation workbench that line's evidence includes the report

### 3.4 Queries and revisions
- [ ] **P4-M-15** On the web, raise a query on the report from P4-M-12. Expected:
  - the phone shows the query in the thread, with a push notification if permission was granted
  - the button changes to "Revise report (query open)"
- [ ] **P4-M-16** Add a photo and revise the report. Expected:
  - on the web the query shows as resubmitted and the report becomes revision 2
  - the phone cannot revise again until a new query is raised

### 3.5 Identity check (contractor role)
- [ ] **P4-M-17** Join with a contractor join code. Expected:
  - the identity wizard opens (ID photo, then three selfies: front, left, right)
  - the wording never mentions liveness
  - after submitting you are asked for notification permission
  - the "Under review" screen says reports are held until approval
- [ ] **P4-M-18** Before approval, submit a daily report. Expected:
  - Sync status shows it as "Held until identity approval"
  - on the web it is staged and not counted as evidence
- [ ] **P4-M-19** On the web, reject the submission with a reason. Expected:
  - the phone shows the reason (open the app, or tap the push) and returns to the wizard
  - the session is not signed out
- [ ] **P4-M-20** Resubmit, then approve on the web. Expected:
  - the phone shows "Identity approved"
  - the held report becomes confirmed on the web without being resent from the phone

### 3.6 Push, sync and sessions
- [ ] **P4-M-21** With the app in the background, approve or reject on the web. Expected: a push arrives; tapping it opens the right screen (the wizard for a rejection).
- [ ] **P4-M-22** Revoke the field session on the web while the phone has items waiting. Expected:
  - the phone shows the session-ended screen
  - Sync status shows "Sending paused"
  - nothing is deleted
  - after rejoining, note what happens to the old items (sent, or listed under "Could not be sent" with a reason). This is not settled yet; Phase 5 decides how items from an ended session are handled.
- [ ] **P4-M-24** Notifications are per person: on two phones joined to the same project, open the notification centre on one and read a project-wide notice (a morning brief). Expected: it stays unread on the other phone.
- [ ] **P4-M-23** Presence: keep the app open on site for over an hour. Expected: presence pings appear on the web only for the times the app was open, plus one per capture and report.

---

## 4. Not ready to test yet

- Configurable geofence tolerance (moved to Phase 6).
- Moving queued items between sessions after a revoke and rejoin (Phase 5).
