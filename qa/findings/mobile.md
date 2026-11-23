# Phase 1b findings: mobile (Maestro MCP)

_Track 1b writes only this file. Format: saas_updates/ui_verification_and_design_plan.md, "Finding format"._

## Findings

_Run stopped early at 14:05 WAT on 2026-11-20 by the owner (demo). Screenshots under `qa/screenshots/mobile/monitor/` unless noted._

### M-001 · Major · Another reporter's query is shown to monitor@ with "Revise report (query open)"
- **Check:** P4-M-15 (seen while exploring) / LKK-402
- **Role / project:** monitor@insite.ng / LKK-402, WBS 02.01.1
- **Steps:** 1. Sign in as monitor@, open LKK-402. 2. Open WBS 02.01.1 (monitor@ has not reported it). 3. Tap "Revise report (query open)".
- **Expected:** Only the reporter's own queries drive the revise button; monitor@ sees "Record inspection summary & submit".
- **Actual:** The thread shows the seeded contractor report's OPEN AI query (report `407494c9…`, Chukwudi Nnamdi) and the button opens "Revise your report · Answering a query". Not submitted, so whether the server refuses is unknown.
- **Evidence:** thread__lkk-402-others-query-shown.png, revise-report__others-query.png

### M-002 · Major · Attaching two photos in one batch fails with a raw exception
- **Check:** P4-M-04
- **Role / project:** monitor@ / LKK-402, WBS 01.02.1
- **Steps:** 1. Take a site photo. 2. "+ Add Another Angle / Photo", take a second. 3. Add caption, "Attach 2 Photos to Thread".
- **Expected:** Both photos saved to the thread.
- **Actual:** Toast "Not saved — Call to function 'FileSystemFile.digest' has been rejected → Caused by: java.io.FileNotFoundException: /data/user/0/com.kpmg.insiteassurance.mobile/files/captures/49bd3b36-….jpg: open failed: ENOENT". Nothing attached. A single photo per batch works every time.
- **Evidence:** capture__not-saved-error.png
- **Suspected area:** mobile capture save (file moved/copied before digest)

### M-003 · Major · Cross-tenant projects listed and openable from "Demo workspaces"
- **Check:** P11-M-02
- **Role / project:** monitor@ (demo tenant)
- **Steps:** 1. Profile and project switcher. 2. Scroll to "Demo workspaces" (banner "Demo mode: verification is skipped"). 3. Tap PRG-211.
- **Expected:** No programme-tenant project is visible to a demo-tenant account.
- **Actual:** PRG-102, PRG-211, PRG-221 are listed; tapping PRG-211 opens its inbox ("This fortnight's deliverables") as monitor@. Only reachable in demo mode, but demo mode is what will be shown.
- **Evidence:** profile__cross-tenant-projects.png, profile__demo-workspaces.png, inbox__prg-211-via-demo-workspace.png

### M-004 · Major · Returned report still shows "Awaiting approval"
- **Check:** P7-M-04
- **Role / project:** monitor@ / EDO-410, WBS 01.01
- **Steps:** 1. Submit a report (PENDING_APPROVAL). 2. verifier@ returns it via the API (13:51). 3. Reopen the thread.
- **Expected:** Status reads returned / needs revision.
- **Actual:** Pill stays "Awaiting approval"; the return only appears as a "Monitor query" card. Revising works.
- **Evidence:** thread__edo-410-returned.png

### M-005 · Major · Raw SQLite error banner on the inbox
- **Check:** P4-M-16 (after a revision)
- **Role / project:** monitor@ / LKK-402
- **Actual:** Inbox banner "cannot commit - no transaction is active" with Retry; Retry cleared it. Seen once.
- **Evidence:** inbox__sqlite-transaction-error.png

### M-006 · Minor · Weekly project still worded per day
- **Check:** P8-M-01
- **Role / project:** monitor@ / EDO-410 (WEEKLY)
- **Actual:** Inbox is correct ("This week's deliverables", "Due Sat 17:00"), but the thread says "Today's inspection brief" and the report form says "This is my full report for today… this item today".
- **Evidence:** report-form__edo-410-weekly-says-today.png

### M-007 · Minor · Inbox statuses inconsistent with the schedule
- **Check:** P9-M-01
- **Role / project:** monitor@ / ABJ-108
- **Actual:** 01.01.1 is COMPLETE (100 %) but still listed under "Other unblocked" with no status; 02.01.1 (starts Nov 26) shows "Fallback Ready" while 02.02.1 with the same window shows "Upcoming". "Fallback Ready" is unexplained jargon (also on EDO-410). Planned windows are shown; no schedule editing anywhere.
- **Evidence:** inbox__abj-108-all-items.png

### M-008 · Minor · Check-in card does not say status is unavailable offline
- **Check:** P8-M-03
- **Actual:** Explicit "Check in on site" works ("Check-in saved. It is confirmed once it reaches the server" → "Checked in at 14:04"). In airplane mode the card still shows "Checked in at 14:04" instead of saying the status is unavailable.
- **Evidence:** inbox__abj-108-check-in.png, inbox__abj-108-checked-in.png, inbox__check-in-offline.png

### M-009 · Minor · Report form closes on Android back and loses typed text
- **Check:** P4-M-10
- **Actual:** Back (or keyboard dismiss via back) closes "Submit your inspection report" without a prompt; summary and quantity are lost. The revision form also does not prefill the previous summary/quantity.
- **Evidence:** report-form__reopened-after-back.png

### M-010 · Minor · Keyboard covers the note composer
- **Check:** P4-M-08
- **Actual:** In a WBS thread the keyboard hides the note field and Send button.
- **Evidence:** thread__keyboard-covers-composer.png

### M-011 · Minor · Status lag after sending
- **Check:** P4-M-08 / P4-M-12
- **Actual:** A typed note sent online stayed "Waiting to send" for ~2 minutes; "Daily report · Waiting to send" persisted after the server had CONFIRMED it (caught up later).

### M-012 · Minor · AI omission text misstates the evidence
- **Check:** P7-M-03 (content, not UI)
- **Actual:** LKK-402 report with 1 photo + 1 voice note: AI says "attaches two site photos and a voice note". EDO-410 report with 1 photo: AI says "no photographs of the repaired areas were attached".

### M-013 · Cosmetic · Raw timestamps and labels
- Inbox cards show raw UTC ISO strings ("2026-11-20T12:05:15.061Z"); last-activity label alternates "Photo" / "PHOTO"; icon-only buttons expose glyph code points as accessibility labels (settings "󰢻", close "󰅖", avatar "QF, 󰲶").
- **Evidence:** inbox__lkk-402-daily.png

## Results

| Check ID | Result (PASS / FAIL / BLOCKED / NOT RUN) | Finding IDs | Note |
| :--- | :--- | :--- | :--- |
| S-06 | PASS | | No notification or background-location prompt on first launch (foreground location asked after sign-in). |
| P4-M-01 | NOT RUN | | Deferred until after the demo. |
| P4-M-02 | NOT RUN | | Deferred until after the demo (Sync status screen not located yet). |
| P4-M-03 | NOT RUN | | Deferred until after the demo. |
| P4-M-04 | FAIL | M-002 | Single photo: "Pending upload" → "In geofence", server signatureVerified true. Multi-photo batch fails. |
| P4-M-05 | NOT RUN | | Deferred until after the demo. |
| P4-M-06 | NOT RUN | | Deferred until after the demo. |
| P4-M-07 | PASS | | Voice note records, plays, uploads (20 s). Web playback is X-01. |
| P4-M-08 | PASS | M-010, M-011 | Note sent and attached to report; keyboard/status issues logged. |
| P4-M-09 | NOT RUN | | Needs device (second phone). Note: emulator frames trip RECYCLED_PHOTO_PHASH_SIMILARITY on one device. |
| P4-M-10 | PASS | M-009 | Hold-point box only on hold-point items, unticked, own instruction; Submit disabled until confirm ticked. |
| P4-M-11 | NOT RUN | | Deferred until after the demo. |
| P4-M-12 | PASS | | "Submitted today ✓", no second report possible; server lists photo, voice, note. |
| P4-M-13 | NOT RUN | | Deferred until after the demo. |
| P4-M-14 | PASS | | Offline report with 4 captures arrived once. Dev build cannot cold-start offline (needs Metro), so the restart was done with network back. |
| P4-M-15 | PASS | M-001 | AI query shown, button "Revise report (query open)". |
| P4-M-16 | PASS | | Revision 2 created, query RESUBMITTED. |
| P4-M-17 … P4-M-20 | NOT RUN | | Deferred until after the demo. |
| P4-M-21 | NOT RUN | | Deferred until after the demo (needs real push). |
| P4-M-22 | NOT RUN | | Deferred until after the demo. |
| P4-M-23 | NOT RUN | | Deferred until after the demo. |
| P4-M-24 | NOT RUN | | Needs device (second phone). |
| P5-M-01 | PASS | | "Sign in" and "Join with a project code". |
| P5-M-02 | PASS | | 7 active demo projects, account name/role/phone, no code or assurance step. |
| P5-M-03 | NOT RUN | | Deferred until after the demo. |
| P5-M-04 | PASS | | Per-project "N item(s) not sent yet" and cross-project banner; pull-to-refresh hint present (refresh itself not separately verified). |
| P5-M-05 … P5-M-07 | NOT RUN | | Deferred until after the demo. |
| P5-M-08 | PASS | | Notification centre shows only the active project's items (LKK vs EDO). |
| P5-M-09 | NOT RUN | | Needs device (real push). |
| P5-M-10 | PASS | | monitor@ only: "Monitor Inspector (Visiting QS / COREN) · weight 1.00"; demo switcher under "Demo mode" banner. Other personas deferred. |
| P5-M-11 | PASS | | monitor@ only: note sender label shows server role name. |
| P5-M-12 | PASS | | Each offline capture landed on its own project. |
| P5-M-13, P5-M-14 | NOT RUN | | Deferred until after the demo. |
| P6-M-01 … P6-M-03 | NOT RUN | | Deferred until after the demo. |
| P6-M-04 | PASS | | No ENU-501 or QAW draft in "Your projects". |
| P6-M-05 | NOT RUN | | Deferred until after the demo (LKK-402 shows KM chainage; EDO/ABJ do not, but not fully swept). |
| P7-M-01 | NOT RUN | | Deferred until after the demo (verifier wording seen; contractor half not run). |
| P7-M-02 | PASS | | EDO-410 brief lists CONC-SLUMP / BLOCK-NIS87 under "Standards to check". |
| P7-M-03 | PASS | M-012 | "Standards check" query with CONC-SLUMP, Critical, required rectification. |
| P7-M-04 | FAIL | M-004 | Awaiting approval shown, revise works, but returned state not shown. Approve half awaits web (X-06). |
| P7-M-05 | PASS | | Verifier briefs say inspect/verify, never build. |
| P7-M-06, P7-M-07 | NOT RUN | | Deferred until after the demo. No LKK-402/EDO-410 settings were changed. |
| P8-M-01 | FAIL | M-006 | Inbox wording follows cadence; thread/form still "today". |
| P8-M-02 | NOT RUN | | Deferred until after the demo. |
| P8-M-03 | FAIL | M-008 | Check-in works online; offline state not shown as unavailable. |
| P8-M-04 | NOT RUN | | Deferred until after the demo. |
| P9-M-01 | FAIL | M-007 | Windows shown, statuses inconsistent. |
| P10-M-01, P10-M-03 | BLOCKED | | KWR-502 has no join codes (seed has none); mobile track may not create codes there. |
| P10-M-02 | NOT RUN | | Deferred until after the demo. |
| P11-M-01 | NOT RUN | | Deferred until after the demo. |
| P11-M-02 | FAIL | M-003 | Demo workspaces cross tenants. "Your projects" itself lists only demo projects. |
| P12-M-01 | NOT RUN | | Deferred until after the demo. |
| P14-M-01 … P14-M-07 | see DEMO-4M | | Only the demo device segment was run. |

## Cross-surface handoffs

_For each pair in qa/checks.md section 7: what the phone created (project, persona, item/BOQ code, report or capture client IDs, query or ticket IDs, time) so the web track can find it. Times are Africa/Lagos (WAT)._

### X-01 (P4-M-12 → P4-W-03) · LKK-402 · ready for web
- Persona: provisioned account monitor@insite.ng (QS Tunde Adebayo, FNIQS, Monitor Inspector), emulator GPS 6.4510, 3.5750 (inside corridor, KM 14+765).
- Item: **WBS 01.02.1** (Excavate unsuitable topsoil…), workday 2026-11-20, submitted 13:40 WAT.
- Report id `ed4ba544-72dc-45c1-96b0-581470d7ebd9` (clientReportId `ddfeec29-eebe-4e73-aba5-6f1a10ac4426`), status CONFIRMED, summary "QA M inspected laterite fill at KM 14+700 compaction tests witnessed", qty 120 m3.
- Captures: photo `20cc94e5-f1bb-4d95-a83f-6026a0af7217` (emulator camera frame is black with a date stamp: that is the emulator, not the app), voice note `61d2c47c-92a9-44e5-973a-dcc6cc60ff4b` (20 s, transcription PENDING at submit), typed note "QA M cement arrived 2 days late". Server: signatureVerified true, inside geofence, AI check by AZURE_OPENAI.
- Web to verify: thumbnail opens full size, "Play voice note" plays, typed note listed, "AI omission check" label.

### X-02 (P4-M-15/16 → P4-W-08/09) · LKK-402 · ready for web
- Same report chain as X-01 (monitor@, WBS 01.02.1). The live AI (Azure) raised the query on its own, so no manual query was needed.
- Query 1 `7d5df38f-4733-49bb-8ec5-0476132275e0` (AI_OMISSION_CHECK, raised 13:41 WAT) → phone revised at 13:44 WAT → query now **RESUBMITTED**; revision 2 is report `0eb2f6a3-5990-4887-b17a-b1a911d9f5a5` (clientReportId `16032949-0f1a-40ca-a798-9359ec5a8825`, new photo `566e2400-6f9d-4d01-84b9-3cde569f68a2`). **P4-W-08: click "Mark resolved" on this query.**
- Query 2 `6c15217a-94b2-4b19-941e-9f51573e9e7b` (AI_OMISSION_CHECK on revision 2, OPEN, nobody answered). **P4-W-09: use it for "Withdraw query".**
- After the web acts, the mobile track re-checks the phone (resolved notification; no further revise).

### X-06 / X-07 (P7-M-03/04 → P7-W-06) · EDO-410 · ready for web
- Persona: monitor@insite.ng (Monitor Inspector, verifier persona), GPS 6.3177, 5.6146 (inside). Item **WBS 01.01** (Reinforced concrete column and beam repairs), weekly period 2026-11-16…22.
- Revision 1: report `67447023-b7e0-4eeb-b819-ede0acd89632` (clientReportId `1d4ca052-d5ca-4500-9117-e67a448aa3bc`), submitted 13:49 WAT, summary states slump 140 mm. AI raised **AI_STANDARDS_CHECK** query `03a750cc-1fbf-40c2-a920-8216dcf55ab0` (CONC-SLUMP, CRITICAL, still OPEN) and omission query `62696886-b9d9-4da2-ba8e-4a71c5014847`. **X-07 web: standards badge with violation detail on this report.** Photo `aa597a12-a0ea-492f-b352-354bc507a745` is flagged RECYCLED_PHOTO_PHASH_SIMILARITY (emulator frames are all black, so every photo after the first looks recycled).
- The mobile track **returned** revision 1 via the API as verifier@ at 13:51 WAT (notes "QA M return: slump 140 mm is out of tolerance…") → RETURNED_FOR_REVISION; return query `23e036a3-e343-4436-844a-804804080b2d` (MONITOR, now RESUBMITTED).
- Revision 2: report `cd19f5a6-bbcf-4b9c-94b9-89c11c3b5c15` (clientReportId `20336d09-c300-4ff1-97ce-fc69624e3d5a`), submitted 13:54 WAT, **PENDING_APPROVAL. X-06 web: approve it in the UI as a user who can act (verifier@ or another eligible reviewer, not monitor@ who reported).** The mobile track will then check the phone shows it approved.

### X-10 (P4-M-14 → P4-W-05) · LKK-402 · ready for web
- Persona monitor@insite.ng. Airplane mode on 13:56–14:02 WAT; 3 photos + 1 voice note on **WBS 03.01.1** (wet-mix macadam base course), report submitted offline, app force-stopped, network restored, app cold-started: outbox drained.
- Report `f63611d2-b46b-4456-be0e-99d9cfa7a7e7` (clientReportId `dc69e5cf-3af0-4d46-8f66-18ba93e7a88e`), CONFIRMED, exactly 4 captures: photos `f347b133-6260-4b46-8df9-92b30c37a6f5`, `480ac08f-ab77-4775-95a2-b1c104480f51`, `38480bd8-2be1-47bd-87cb-cd682c35316b`, voice `771fc61e-e1f5-4570-84c8-e9f26b248932`. GPS 6.4525, 3.6000 (KM 17+532, inside).
- Web to verify: the report appears once with four captures; workbench evidence drawer for WBS 03.01.1 includes it (photos 2–3 will carry a recycled-photo flag because emulator frames are identical).
- Also P5-M-12: offline photo on EDO-410 WBS 01.02, capture `bdad0c15-ccd2-4180-aa2d-300b96c431e3` (13:00 WAT), landed on EDO-410 (outside geofence: GPS was still at LKK-402).

### X-08 (P8-M-03 → P8-W-04/05) · LKK-402 and EDO-410
- monitor@ was checked in automatically by its first capture: LKK-402 "Checked in at 13:37", EDO-410 "Checked in at 13:48" (WAT). Explicit "Check in on site" button: see ABJ-108 entry below once run.

## Notes for CLAUDE.md
