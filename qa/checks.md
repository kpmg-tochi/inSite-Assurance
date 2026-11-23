# UI Verification Checks (Phases 5 to 12 and 14)

Built 2026-11-20 for Phase 1 of [ui_verification_and_design_plan.md](../saas_updates/ui_verification_and_design_plan.md) from every **unticked** web or mobile item in `phase_5` … `phase_10_implementation_plan.md` (UI steps and Definition of done), plus the Phase 7 gap-closure notes and the "not clicked / not on device" notes in Phases 9 and 10. **Extended the same day at the owner's request** with Phases 11, 12 and 14 (sections 7 to 9; Phase 13 is not started). Phases 1 to 4 keep their IDs in [physical_testing_checklist.md](../saas_updates/physical_testing_checklist.md); section 0 below says which track runs which of those.

- **IDs:** `P<phase>-W-<nn>` web (track 1a, Playwright MCP), `P<phase>-M-<nn>` mobile (track 1b, Maestro MCP). `X-<nn>` links a cross-surface pair (section 10).
- **Source:** each check names the phase-file item it verifies, so the coordinator can tick it at the end.
- **Results** go only in the track's findings file (`qa/findings/web.md`, `qa/findings/mobile.md`), never here.
- Items that are server-only (no screen) were left out: Phase 8 Step 2 job env switch, Step 4 messaging adapters, retries and caps. They are not UI and stay with automated tests.

## Seeded projects (demo tenant)

| Code | What it is | Owner track for settings |
| :--- | :--- | :--- |
| LKK-402 | Linear corridor, DAILY, IPC claims, contractor + resident reporting, 4 weeks behind with a pending schedule revision | **Mobile** (web may read and act, not change settings) |
| EDO-410 | M&E only, WEEKLY, direct milestone release, report approval on, two standards, a needs-assessment fixture | **Mobile** (web may read and act, not change settings) |
| ABJ-108 | Radial, DAILY, IPC, on schedule, has a dependency | Nobody changes settings (both may read and act) |
| KAN-210 | Multi-prime (`MULTI_PRIME_SEPARATE_IPC`), three packages, radial, DAILY | Web |
| OGN-305 | Perimeter geofence, WEEKLY | Web |
| ENU-501 | Seeded draft, three steps complete | Read only (web creates its own `QAW-` drafts) |
| OGN-501 | Handover in progress, a pending code link | Web |
| KWR-502 | Retention / liability period, 5% held, two defect tickets | Web |
| `QAW-*` | Projects the web track creates in this run | Web |

### Programme tenant (slug `programme-authority`, Phases 11, 12, 14)

Logins, all `Password123!`, `@insite.ng`: `programme.admin` (tenant admin), `flagship.admin`, `north.admin`, `south.admin` (Organisation Administrators), `programme.monitor` (Monitor, **no registration**), `programme.funder` (Lender role in the flagship, funder-scoped release), `me.officer` (M&E officer, over the Co-Funded site limit). Use these, not `admin@`, for programme-tenant checks (`admin@` is a platform super admin and sees both tenants; see W-003). Terminology here: funder "Funding authority", tranche "Payment milestone", IPC "Payment claim". Credential policy `OPTIONAL` / `OPTIONAL` (the demo tenant is unset, so `REQUIRED`).

| Code | What it is | Owner track for settings |
| :--- | :--- | :--- |
| PRG-211 | Co-Funded type, North; streams (resident, quarterly "M&E visit" with a 7-day deadline, contractor progress); approved baseline survey, a late routine visit, a routine visit with a major finding | **Mobile** (web may read, review inspections and act on findings; no settings) |
| PRG-102 | Central type, live, three fixed payment milestones with mapped BOQ items; `programme.monitor` and `programme.funder` assigned | Web |
| PRG-221 | Co-Funded type, South, live, a missed quarterly visit | Web |
| PRG-101, PRG-201 | Seeded drafts (Central; Co-Funded South) | Read only (web creates `QAW-` drafts in this tenant) |

Programme tenant-wide rules: do **not** save changes to the credential policy, terminology, or the seeded project types' configs (preview only, or restore at once). Checklist templates: create `QAW` ones freely; of the seeded ones, only **"Baseline survey"** may be edited (P14-W-02, version bump); never edit "Routine monitoring visit" (the mobile track uses it).

---

## 0. Phases 1 to 4 (IDs from physical_testing_checklist.md)

| ID | Track | Note |
| :--- | :--- | :--- |
| S-01 | Coordinator | **NOT RUN by rule:** re-seeding is forbidden in this run; the owner seeded before the run. |
| S-02 | Coordinator | Verified in step 1.0: presign `uploadUrl` starts with `http://192.168.1.156:4000`. |
| S-03 | Coordinator | Verified in step 1.0: health ok, `objectStorage: LOCAL_DISK_DEV`; Whisper is `LIVE_STANDALONE_WHISPER` because a key is set (allowed by the check). |
| S-04, S-05 | Coordinator | **NOT RUN:** the owner installed a development build (`com.kpmg.insiteassurance.mobile`); the EAS build itself and `EAS_PROJECT_ID` were not checked. |
| S-06 | Mobile | Only reproducible after clearing app data (Maestro `clearState`). Do it once at the start of the run. |
| P2-W-01 | Web | Rename a **QAW-created** role or rename and immediately restore; never rename Monitor Inspector, Clerk of Works or Contractor Site Engineer while the mobile track runs. Mobile half: **NOT RUN** unless it can be paired without disturbing the mobile track. |
| P3-W-01 … P3-W-05 | Web | Use ABJ-108 or KAN-210 (act, do not change settings). P3-W-04: change a rating label and restore it in the same check. |
| P4-W-01 … P4-W-10 | Web | P4-W-06/08/09 are the web halves of X-02 and X-03. |
| P4-M-01 … P4-M-24 | Mobile | P4-M-09 and P4-M-24 need a second phone: **NOT RUN (needs device)**. P4-M-21 needs real push delivery to the emulator; run only if pushes arrive, otherwise **NOT RUN (needs device)**. P4-M-23 needs an hour on site; run only if time allows. |
| P14-M-01 … P14-M-06 | Mobile | Added to scope by the owner (2026-11-20); see section 9. PRG-211. The "second phone" contractor in P14-M-05 runs on the same emulator after switching persona. |

---

## 1. Phase 5: provisioned mobile users

### Web (Step 4)
- **P5-W-01** · admin · Settings → Roles. Open a mobile-capable role's editor. Expected: an "Onboarding" control with "Join code" and "Pre-provisioned account", each with a one-line explanation; choosing provisioned disables and unchecks identity assurance. On a role with active codes (Clerk of Works) choosing provisioned shows a confirmation that lists the affected projects. **Cancel** there; to save a mode change, use a new `QAW Field Role`. _Source: P5 Step 4 item 1._
- **P5-W-02** · admin · Settings → Users. Add a user `qaw.user1@insite.ng` (use a QAW name). Expected: a "Mobile access" field listing only provisioned mobile roles plus "None", a phone-number field, and a mobile badge in the table for users with mobile access (monitor@ has one). _Source: P5 Step 4 item 2._
- **P5-W-03** · admin · Settings roster (field sessions). Expected: join-code sessions and provisioned users are told apart (origin, linked user, device), and devices have a revoke action. **Do not revoke** monitor@'s device or any session the mobile track uses; confirm the button and its confirmation only, unless a QAW-owned device exists. _Source: P5 Step 4 item 3._
- **P5-W-04** · admin · KAN-210 → Join codes. Expected: provisioned roles (Monitor Inspector) are not offered for codes, with a short explanation of why. _Source: P5 Step 4 item 4._

### Mobile (Steps 5, 6, 7, 8, Definition of done)
- **P5-M-01** · signed out · Landing. Expected: two paths, "Sign in" and "Join with a project code". _Source: Step 5 item 1._
- **P5-M-02** · monitor@ · Sign in. Expected: no join code, no assurance step; the Projects screen lists every active project the account can see (LKK-402, EDO-410, ABJ-108, KAN-210, OGN-305, OGN-501, KWR-502; no drafts); name and phone come from the account (no typed role title). _Source: Step 5 items 1, 2, 5, 8; DoD 1._
- **P5-M-03** · a new account · Create via the API as admin a user `qam.inspector1@insite.ng` with mobile role Monitor Inspector and a temporary password that must be changed, assigned to LKK-402. Sign in on mobile. Expected: forced password-change screen; after changing, the Projects screen shows LKK-402. _Source: Step 5 item 2._
- **P5-M-04** · monitor@ · Projects screen: pull to refresh; pending-sync count per project from the outbox; switching project keeps queued work. _Source: Step 5 items 5, 3, 4._
- **P5-M-05** · monitor@ · "Join another project with a code" with a resident (COW) code for a project the account does not see by assignment, or a second persona on a seen one. Expected: additive; the account and its projects remain. _Source: Step 5 item 6._
- **P5-M-06** · monitor@ · Sign out with an item pending (offline). Expected: the outbox stops, a warning about pending items, account data cleared. Then sign in again. _Source: Step 5 item 7._
- **P5-M-07** · join-code contractor (CON code, LKK-402) vs resident (COW code) · Expected: the assurance wizard appears only for the role that requires it. _Source: Step 5 item 8; DoD 2._
- **P5-M-08** · monitor@ · Two projects. Expected: inbox, threads and notifications follow the active project; switching shows the other project's items only. _Source: Step 6 item 1; DoD 3._
- **P5-M-09** · monitor@ · Push token routing: tap a push for another project switches to it. Needs real push: **NOT RUN (needs device)** if pushes do not arrive. _Source: Step 6 item 2._
- **P5-M-10** · each persona · Profile header shows the server role name and assurance weight; any persona switcher is under a visible demo banner only. _Source: Step 6 item 3._
- **P5-M-11** · each persona · Chat sender labels show the server role name. _Source: Step 6 item 4._
- **P5-M-12** · monitor@ · Manual script: offline, capture on LKK-402, switch to EDO-410, capture, go online. Expected: each capture lands on its own project (check via the API as monitor: `GET /projects/:id/captures`). _Source: Step 7 manual script._
- **P5-M-13** · resident (COW, LKK-402) · Held items. Queue a photo, a note and a report offline; revoke that session via the API as admin (`listProjectFieldSessions` → revoke); come online (session-ended screen, "Sending paused"); rejoin with the code. Expected: each unsent item shows an amber exclamation; tapping explains it; **Remove** deletes it (never reaches the server); **Update** re-sends under the new session (web shows "Re-submitted after session ended", see X-04); a held report offers Re-confirm. _Source: Step 8 items 1–3; also P4-M-22._
- **P5-M-14** · two sessions on LKK-402 (account + a join session on the same device, if the app allows) · Notification centre: an actioned item moves out of "needs action" and shows "Answered by {name}". **NOT RUN (needs device)** if a second session cannot be held on one emulator. _Source: Step 8 "Mobile notification centre"._

---

## 2. Phase 6: organisations, contractors, geofence, wizard

### Web
- **P6-W-01** · admin · Settings → Organisations: table, add `QAW Org One` with tags, edit, archive; archived hidden from pickers. _Source: Step 1 web._
- **P6-W-02** · admin · Workspace settings → organisation input mode. Switch to `DIRECTORY`, check the wizard parties step and the add-user drawer show a select only; `FREE_TEXT` shows a text field; restore `BOTH`. _Source: Step 1 `OrganizationInput`._
- **P6-W-03** · admin · Header "New Project" → basics. Create draft `QAW-601`, leave after basics, return from the Drafts tab and continue; create `QAW-602` and delete it from the Drafts tab. "Pending Approval" tab is gone. _Source: Step 5 items 1, 9, 10; DoD 1._
- **P6-W-04** · admin · Setup shell on QAW-601: step navigation shows complete, incomplete and current; "Saved" indicator; Back and "Save and continue"; leaving with unsaved changes asks "Save and leave / Leave without saving / Stay". _Source: Step 5 item 2; follow-up "unsaved changes"._
- **P6-W-05** · admin · No demo values in empty fields; "Fill with sample data" shows only in demo mode (the API reports `demoMode: true`). _Source: Step 5 item 4._
- **P6-W-06** · admin · Invalid input (blank coordinates, budget 0, target 0) shows a field error and the step is not marked complete; nothing is silently replaced. _Source: Step 5 item 5._
- **P6-W-07** · admin · Parties step: `OrganizationInput` for monitor and lender; three contractor-model cards with explanations; contractor columns change by model (main flag for unified, trade code + package budget for multi-prime, field-reporting toggle always). _Source: Step 5 item 6._
- **P6-W-08** · admin · Site step: `GeofenceEditor` places a radial centre and radius, corridor waypoints and half-width, and polygon vertices by clicking; typed/pasted coordinates work; a self-intersecting polygon is refused; tolerance override and project time zone (IANA list, default the tenant zone). _Source: Step 3 items "Tenant settings" and "GeofenceEditor"._
- **P6-W-09** · admin · BOQ step: upload a CSV with `"12,500"` quantities and an "Item No" column; preview with per-row warnings; hold-point and tranche columns; contractor column only with more than one contractor; "Suggest packages" opens the suggestion for review; "Accept suggested tranches" maps only suggested items, and unmapped items block activation. _Source: Step 5 item 7._
- **P6-W-10** · admin · Review step: summary cards with edit links, issues list, "Set project active" disabled with a reason while issues exist, button reads "Save draft" with the toggle off; once clean, activation succeeds and join codes appear. _Source: Step 5 item 8._
- **P6-W-11** · admin · A draft banner shows on any draft project page (QAW-601, ENU-501). _Source: Step 5 item 11._
- **P6-W-12** · admin · KAN-210 settings (`/settings/:step`): edits save and are audited; changing the code prefix, or the contractor model once an IPC exists, is refused with a reason. _Source: section 5 "After activation"._
- **P6-W-13** · admin · Archive a QAW project from the directory card "⋯" menu and from the settings header: confirmation with an optional reason; afterwards read-only, codes deactivated. **Only QAW projects.** _Source: Step 4 `POST archive`; follow-up "Archiving"._
- **P6-W-14** · monitor · Map on ABJ-108 (radial), LKK-402 (corridor), OGN-305 (perimeter): each shape is drawn and fitted; no jump to Lagos; mode labels read correctly in the header, dashboard and evidence drawer. _Source: Step 3 "LiveGeospatialMap"._
- **P6-W-15** · monitor · A capture outside the boundary but within tolerance shows "Within tolerance (N m outside)" (OGN-305, after X-05). _Source: Step 3 "Web and mobile badges"._
- **P6-W-16** · monitor · "Corridor" and "chainage" appear on LKK-402 only, never on ABJ-108, KAN-210 or OGN-305. _Source: Step 3 "Wording"._
- **P6-W-17** · monitor and contractor users · KAN-210 reconciliation workbench: contractor filter and contractor column on IPC lists; a contractor's claim form offers only its own items. _Source: Step 6 item 1._
- **P6-W-18** · monitor · Contractor verification queue shows each session's contractor organisation. _Source: Step 6 item 2._
- **P6-W-19** · lender · Executive and directory views show the main contractor plus "+N" for KAN-210. _Source: Step 6 item 3._
- **P6-W-20** · any · Money and dates use the tenant currency and zone (no hard-coded "WAT" when the zone abbreviation differs). Read-only: **do not change tenant currency or time zone.** _Source: Step 7 item 1._
- **P6-W-21** · signed out, then admin · No KPMG logo, tagline or page title on tenant surfaces unless the tenant's own branding says so; login and public pages use the neutral InSite default; open one valuation PDF and check its header. _Source: Step 7 item 3._
- **P6-W-22** · admin · Branding: live preview before save. **Do not save** (mobile reads tenant branding). _Source: Step 7 item 5._
- **P6-W-23** · any · Brand-coloured elements follow the brand tokens (Cosmetic findings for literal blue that should be brand). _Source: Step 7 item 4._
- **P6-W-24** · contractor users of two KAN-210 contractors · Multi-prime claim cycle for two contractors independently (submit, reconcile, certify, decide each), and neither sees the other's IPC. Create QAW users in the contractor organisations if none exist. _Source: DoD 3._
- **P6-W-25** · lender, admin · QAW-601 (draft) and ENU-501 are absent from the executive page, portfolio figures and notifications. _Source: DoD 2._

### Mobile
- **P6-M-01** · signed out, then each persona · Neutral branding before sign-in; tenant logo and primary colour after sign-in or join. _Source: Step 7 item 6._
- **P6-M-02** · resident (COW code, OGN-305) · Set the emulator location inside the perimeter, just outside within tolerance, and well outside; capture each. Expected: "In geofence", "Within tolerance (N m outside)", "Outside geofence"; mode label reads perimeter. Web half X-05. _Source: Step 3 mobile badge and "Verify with a perimeter project"; DoD 4._
- **P6-M-03** · contractor (CON code with trade segment, KAN-210) · Join response and profile show the contractor name and trade; the inbox lists only that contractor's items. Joining is allowed; do not change KAN-210 settings. _Source: Step 6 item 4._
- **P6-M-04** · monitor@ · No draft (ENU-501, any QAW draft) appears on the Projects screen. _Source: DoD 2._
- **P6-M-05** · each project · "Corridor" and "chainage" appear on LKK-402 only. _Source: Step 3 "Wording"._

---

## 3. Phase 7: process engine, standards, approval chains

### Web
- **P7-W-01** · admin · QAW-601 wizard "Workflow and process": template picker pre-fills; toggles; both chains as ordered, editable lists; removing the certification step or the release step is refused. _Source: Step 7 item 1._
- **P7-W-02** · admin · "Standards and needs assessment": add from library, edit, delete; upload a document (PDF or .txt; also an image to see `UNAVAILABLE`); the summary shows pending, done or unavailable and "summarise" retries; requiredness follows the modes; activation validation lists a missing required standard. _Source: Step 7 item 1; gap closure "text extraction"._
- **P7-W-03** · admin · The same two pages under KAN-210 settings show the "applies to new items" note on chain edits. View EDO-410's and LKK-402's pages read-only. _Source: Step 7 item 2._
- **P7-W-04** · admin · Settings → "Workflow templates": list the three seeded templates; create and edit `QAW Template`; tab hidden for roles without `templates:manage_workflows` (role sweep). _Source: Step 7 item 3._
- **P7-W-05** · monitor · EDO-410 BOQ page brief preview: persona switcher and applied-standards pills; with contractor reporting off the brief is the verifier's, and it never tells the reader to build anything. _Source: Step 7 item 4; DoD 2._
- **P7-W-06** · verifier / monitor · EDO-410 Site presence: report shows a standards badge with violation detail; approval bar with chain position; Approve and Return shown only to a user who can act on the current step; reviewer ≠ reporter. Web half of X-06/X-07. _Source: Step 7 item 5._
- **P7-W-07** · monitor / lender · Reconciliation workbench on LKK-402 or ABJ-108: a valuation shows its chain progress; `?valuationId=` opens that valuation. _Source: Step 7 item 6; gap closure._
- **P7-W-08** · verifier, then lender · EDO-410 workbench: "Verify milestone" instead of claim submission (tranche, items with evidence-derived suggested %, summary, dry run), then the release step for the lender; the same user cannot do both. _Source: Step 7 item 6; DoD 1._
- **P7-W-09** · admin · On a QAW project with tranches/CPs and hold points off (e.g. "Rapid CapEx" template, then turn them off): tranche, CP and hold-point UI hidden on the executive page, wizard BOQ step, visit itinerary and evidence drawer. _Source: Step 7 item 7; gap closure._
- **P7-W-10** · monitor · Site presence "Pending approval" filter shows only `PENDING_APPROVAL` reports. _Source: gap closure._
- **P7-W-11** · any · Notification badges show the category name for every category (incl. standards violation, report pending approval, disbursement pending approval). _Source: gap closure._
- **P7-W-12** · admin, then reviewers · KAN-210 disbursement chain: add a review step between certification and release with an amount threshold; a valuation above it shows the added step's Review action to an eligible user; one below it skips the step. _Source: Step 6 behaviour seen through Step 7 UI._
- **P7-W-13** · contractor, monitor, lender · DoD 1 end-to-end on the web: LKK-402 or ABJ-108 IPC cycle (contractor reporting) and EDO-410 direct release with report approval (P7-W-06 + P7-W-08). Result is PASS only if both halves pass. _Source: DoD 1._

### Mobile
- **P7-M-01** · monitor@ on EDO-410 (verifier) and contractor (CON code, LKK-402) · Persona-aware copy: inbox subtitle, brief card title, pointers heading, end-of-day button, verification-pending and backlog wording. Verifier wording is about inspecting and verifying; contractor wording is about executing. _Source: Step 8 item 1._
- **P7-M-02** · monitor@ on EDO-410 · Brief card lists the applied standards. _Source: Step 8 item 2._
- **P7-M-03** · monitor@ or resident on EDO-410 · Submit a report that misses a mandatory standard's required proof or tolerance. Expected: an `AI_STANDARDS_CHECK` query with its own label, the standard codes and the required rectification. Web half X-07. _Source: Step 8 item 3._
- **P7-M-04** · reporter on EDO-410 · Report status shows pending approval, then approved or returned after the web acts (X-06); a returned report can be revised. _Source: Step 8 item 4._
- **P7-M-05** · monitor@ on EDO-410 · The inspector's brief never tells them to build or execute work. _Source: DoD 2._
- **P7-M-06** · contractor session (LKK-402) · **Run last.** Turn contractor field reporting off on LKK-402 via the API (mobile track owns LKK-402), submit from the contractor session. Expected: a clear refusal message, the report marked "Not sent". Restore the setting and record what happened to the contractor join codes. _Source: gap closure "Contractor reporting off"._
- **P7-M-07** · monitor@ · After a report is sent, clear app data (a new device ID), sign in again. Expected: "Today's report" still shows for that item (server reports table). _Source: gap closure `server_reports`._

---

## 4. Phase 8: cadence, late reports, mobilization, attendance

### Web
- **P8-W-01** · admin · QAW-601 Reporting step: work-week day picker, period start day, custom interval, due time, grace, and a plain-language preview ("Briefs go out Monday 08:00. Reports are due Saturday 17:00."). On OGN-305 settings, a cadence change shows as pending from the next period. _Source: Step 7 item 1._
- **P8-W-02** · admin · Team step (QAW-601) and KAN-210 settings: expected participants table: add (name + email or phone, role), link a user, planned date, reminder offsets, status chips. _Source: Step 7 item 2; Step 5 CRUD._
- **P8-W-03** · admin · Reminder schedule at project level (`mobilization:configure_reminders`) with a per-participant override. _Source: Step 5 "Reminder schedule editing"._
- **P8-W-04** · monitor · Site presence on a weekly project (EDO-410, OGN-305): grouped by period, not day; late and missed badges; a "Due and overdue" list. _Source: Step 7 item 3._
- **P8-W-05** · monitor · Attendance alerts panel: filters; acknowledge; excuse (note required); resolve. If no alerts exist, record **BLOCKED (no data)** and the reason. _Source: Step 7 item 4._
- **P8-W-06** · monitor · Excuse a missed reporting obligation: note required; audited. _Source: section 7 decision 9._
- **P8-W-07** · monitor · Site presence KPI cards: late/missed reports this period and open attendance alerts. _Source: Step 7 item 5._

### Mobile
- **P8-M-01** · monitor@ on EDO-410 (weekly) and LKK-402 (daily) · Inbox period card and wording follow the cadence: "This week's deliverables", "Weekly report", "Due Sat 17:00" vs daily wording; a due countdown. _Source: Step 8 items 1, 2; DoD 1._
- **P8-M-02** · any persona · An overdue state shows on the inbox for a past-due period. _Source: Step 8 item 2._
- **P8-M-03** · resident or monitor@ · "Check in on site" inside the geofence: today's check-in status from the server; offline the card says the status is unavailable. Web half X-08. _Source: Step 6 mobile; Step 8 item 4._
- **P8-M-04** · any persona · Presence pings follow workday hours and `workWeekDays` (check the pings in the API outside hours: none). Record what could be observed on an emulator. _Source: Step 8 item 3._

---

## 5. Phase 9: schedule

### Web
- **P9-W-01** · admin · QAW-601 draft wizard Schedule step (after Reporting): project dates, item dates table, "propose dates" helper, dependencies by picking predecessors, inline validation (successor before predecessor, cycle), optional for activation. _Source: section 7 "Not done: draft-wizard click-through"._

### Mobile
- **P9-M-01** · monitor@ on LKK-402 (behind) and ABJ-108 (on schedule) · Inbox shows each item's planned window and a status: due this period, upcoming or overdue; no schedule editing anywhere. _Source: Step 4 item 1._

---

## 6. Phase 10: handover, retention, defects

### Web
- **P10-W-01** · monitor · On a project with the handover and retention modules off (ABJ-108 or LKK-402, read only), the Handover and Retention tabs and phase actions are hidden, and their URLs show not-found. _Source: Step 9 "UI hiding with the switch off is not separately clicked"._
- **P10-W-02** · monitor · KWR-502 defect board shows the ticket(s) acted on from the phone (X-09) with the repair photo. _Source: Step 6 mobile, web half._

### Mobile
- **P10-M-01** · liable contractor (CON code on KWR-502) · Defects screen lists only own tickets; mark one fixed with a photo **offline**; then online. Expected: Sync status sends the photo first, then the defect action; web shows it fixed with the photo (X-09). A construction report from this session is refused (retention period). _Source: Step 6 "Mobile Defects screen"; Step 1 field-session limits._
- **P10-M-02** · monitor@ on KWR-502 (verifier) · Defects screen for the monitoring side: verify close or reopen per the project's reporting set-up; with contractor reporting off, closing needs the verifier's photos. _Source: Step 6 "Evidence follows the project's reporting set-up"._
- **P10-M-03** · liable contractor · A `DEFECT_UPDATE` notification (in-app; push if it arrives) opens the Defects screen. _Source: Step 6 "Aimed notifications"._

---

## 7. Phase 11: delivery models (programme tenant)

### Web
- **P11-W-01** · programme.admin · Settings → Organisations: tree with indentation and expand/collapse (Programme Authority → North, South); parent picker; add `QAW Org North 1` under North; setting Programme Authority's parent to North is refused (cycle). _Source: Step 1 web._
- **P11-W-02** · programme.admin · Settings → "Project types & regions": list shows Central and Co-Funded; editor tabs (general, workflow template, ownership, parties, reporting defaults); create and save `QAW Type`. Regions: North (Kano, Kaduna), South (Lagos, Enugu); add `QAW Region` with one area; a third level is impossible. _Source: Step 5 web; Step 2 regions._
- **P11-W-03** · programme.admin · New project: the type picker comes first and is required; choose Co-Funded, region South → Lagos; owner, funder and Reporting pre-filled; Parties: owner limited by type, funder labelled "Funding authority", beneficiaries with exactly one primary; Review lists party-rule issues. Switching type on the draft re-applies. On PRG-102 settings the type is locked. Draft code `QAW-111`. _Source: Step 2 and Step 5 (picker click-through)._
- **P11-W-04** · programme.admin · Directory and executive matrix: type chip; filter bar by type, region (a region includes its areas) and owning organisation. _Source: Step 5 filters._
- **P11-W-05** · flagship.admin, north.admin, south.admin · Visibility: flagship sees PRG-102, PRG-211, PRG-221; north sees only its own (PRG-211); south only its own (PRG-221); opening a sibling's project URL is refused; same in directory, executive and portfolio. _Source: Step 3; DoD 2._
- **P11-W-06** · programme.admin · Chain editor: one organisation-scope select per step (Any / Project owner / Owner or above / Funder) on the workflow step of `QAW-111` and on the Workflow templates tab. _Source: Step 4 editor click-through._
- **P11-W-07** · programme.monitor, programme.funder, a user of another organisation · PRG-102 valuation in flight (from P12-W-05): a user outside the scoped organisation sees the cannot-act reason; the funder can release. _Source: Step 4; DoD 3._
- **P11-W-08** · programme users, then a demo-tenant user · Terminology: programme tenant shows "Funding authority", "Payment milestone", "Payment claim" on Parties, Facility, workbench, certify and decision modals, direct milestone panel, retention page, executive view, directory, notifications; the demo tenant keeps "Lender", "Tranche", "IPC". Terminology card has a live preview (**do not save**). _Source: Step 6 web; DoD 4._
- **P11-W-09** · admin (demo) · OGN-501: add a primary beneficiary on the Parties settings step (allowed: web owns OGN-501), then open the handover "create link" form. Expected: recipient, contact, label and stakeholder type pre-filled from the primary beneficiary. _Source: Step 2 handover pre-fill._
- **P11-W-10** · programme.admin, monitor (demo), a role without `projects:view_portfolio` · `/app/portfolio`: landing page for holders; map with health-coloured pins, project list and detail, KPI cards, filters; no sidebar entry for non-holders. _Source: section 7 item 7._
- **P11-W-11** · programme.funder · The valuation PDF from P12-W-05 says "Funding authority" / "Payment milestone"; a demo-tenant PDF says "Lender" / "Tranche". _Source: DoD 4._

### Mobile
- **P11-M-01** · programme persona on PRG-211 vs monitor@ on LKK-402 · Terms: the incident screen names the funder "Funding authority" on PRG-211 and "Lender" on LKK-402; the report confirm sheet's hold-point label follows the tenant term. _Source: Step 6 mobile (device run pending)._
- **P11-M-02** · monitor@ (demo) and a programme account (e.g. me.officer@ if it has mobile access, else a programme join code) · No programme project appears for the demo account and no demo project for the programme account. _Source: Step 3 "Mobile account visibility follows it too"._

---

## 8. Phase 12: credentials and payment milestones

### Web
- **P12-W-01** · programme.admin · Credentials settings: two policy selects (certifier, field assurance) with explanatory copy (**do not save**); registration bodies: list the six seeded bodies, add `QAW Body`, then archive it. Project type editor "Credentials" tab offers "Use tenant setting" first. _Source: Step 2 UI; Step 1 CRUD._
- **P12-W-02** · programme.admin and admin (demo) · User create/edit: the registration body select lists the tenant's bodies (incl. `QAW Body` before archive); the field shows unless both policies are HIDDEN; profile of programme.monitor@ shows "None on file", never "Verified Credential". _Source: Step 1 selects; Step 3 web (profile, user forms)._
- **P12-W-03** · programme.monitor vs demo users · Policy in action: programme.monitor@ (no registration) can verify a PRG-102 milestone; the PDF prints no registration line. On the demo tenant (REQUIRED) a user without a registration sees the cannot-act reason on the certify button tooltip/modal; the contractor verification queue shows a registration number only when present. _Source: Step 3 web (certify modal, direct milestone panel, cannot-act, queue); DoD 1._
- **P12-W-04** · programme.admin · PRG-102 Facility settings: per payment milestone basis, rule, fixed amount (defaults to allocated), required %; switching a milestone to fixed while the process uses claims is refused with a reason (read the message; do not change the process). _Source: Step 4 Facility UI._
- **P12-W-05** · programme.monitor, then programme.funder · PRG-102 direct milestone panel: criteria and progress against them; release amount read-only for fixed basis; full release refused while incomplete with the unmet reasons; holdback needs an amount below the fixed amount and a reason; when complete, the funder's decision window shows basis, criteria met and retention withheld; the PDF shows basis and criteria. _Source: Step 4 panel and decision window; DoD 3._
- **P12-W-06** · lender, verifier (demo) · KWR-502 retention certify modal and the workbench cannot-act tooltip follow the policy (REQUIRED on the demo tenant). _Source: Step 3 web (retention certify, cannot-act)._

### Mobile
- **P12-M-01** · contractor join code on LKK-402 (demo, REQUIRED) and on PRG-211 (programme, OPTIONAL) · Assurance credentials step: required with a blocking message on LKK-402; optional with no blocking alert on PRG-211; the body picker lists the tenant's bodies. HIDDEN is not seeded: **NOT RUN** for that variant unless it can be seen without changing settings. Web half X-14. _Source: Step 3 mobile; DoD 2._

---

## 9. Phase 14: streams, inspections, supervision

### Web
- **P14-W-01** · programme.admin · Reporting step streams editor: `QAW-111` draft add/edit/remove a stream; a project with no streams shows "Default"; on PRG-221 a live edit shows as pending from the next period; a stream's kind cannot change once live. _Source: Step 1 streams editor._
- **P14-W-02** · programme.admin · Settings → "Inspections & supervisors": template list and editor (sections, items, response types, rules); create `QAW Template`; edit the used seeded "Baseline survey" and save → version 2 (the old version is untouched). Supervisors view lists me.officer@ over the limit. _Source: Step 2 tenant settings; Step 6 Supervisors view._
- **P14-W-03** · programme.admin / programme.monitor · PRG-211 Inspections tab: filters (visit type, finding, stream, late); detail with answers and photos per item; the late routine visit flagged late; review actions on a pending inspection; findings board shows the major finding aimed at the main contractor. _Source: Step 5 Inspections tab._
- **P14-W-04** · programme.admin · Project overview `InspectionOverviewCard` on PRG-211 and PRG-221: last inspection per visit type, next due, open findings, missed visits (PRG-221's missed quarterly visit); baseline completeness indicator (PRG-211 accepted; PRG-221 none). _Source: Step 5 overview and baseline indicator; DoD 1._
- **P14-W-05** · programme.admin · PRG-221 Team settings (or `QAW-111` Team step): adding me.officer@ shows the workload warning above the type's thresholds; it warns and never blocks. _Source: Step 6 Team step; DoD 3._
- **P14-W-06** · programme.monitor · Web halves of X-11, X-12, X-13: the phone's inspection shows with photos under each item and its failed item as a finding for the main contractor; the contractor's resolution shows Resolved with the photo; the late upload shows late and the quarter's obligation LATE. _Source: physical checklist P14-M-04/05/06 web side; DoD 2._

### Mobile
Run P14-M-01 … P14-M-06 from `physical_testing_checklist.md` §3.7 on PRG-211 (inspector: me.officer@ if it is a provisioned mobile account, else a Monitor Inspector join code; contractor: the contractor engineer code), plus:
- **P14-M-07** · inspector and contractor · Wording: inspection and findings entry points and the findings subtitle read naturally per persona; the period card shows the quarter span ("Quarterly report", "Q4 2026" or similar). _Source: Step 4 wording._

---

## 10. Cross-surface pairs

The mobile track does the field half on the emulator. When its flow needs a web-side action in the middle (raise a query, approve identity, revoke a session), it uses the **API** as the named role (curl), never the shared Playwright browser, and lists what it created under "Cross-surface handoffs" in `qa/findings/mobile.md`. The web track checks the web half in the UI from that list; the coordinator relays the list if the web track finishes first.

| Pair | Mobile half | Web half | Project |
| :--- | :--- | :--- | :--- |
| X-01 | P4-M-12 report with photos, voice, note | P4-W-03 report detail | LKK-402 |
| X-02 | P4-M-15/16 query shown, revision sent | P4-W-08 mark resolved, P4-W-09 withdraw | LKK-402 |
| X-03 | P4-M-17…20 identity wizard, held report | P4-W-06 verification queue (selfies, ID, contractor org: P6-W-18) | LKK-402 |
| X-04 | P5-M-13 held items, Update | Capture list shows "Re-submitted after session ended" | LKK-402 |
| X-05 | P6-M-02 perimeter captures | P6-W-15 "Within tolerance" badge | OGN-305 |
| X-06 | P7-M-04 report pending approval / returned | P7-W-06 approve and return | EDO-410 |
| X-07 | P7-M-03 standards query | P7-W-06 standards badge | EDO-410 |
| X-08 | P8-M-03 check-in | P8-W-04/05 presence and attendance | LKK-402 or EDO-410 |
| X-09 | P10-M-01 defect fixed with photo | P10-W-02 defect board | KWR-502 |
| X-10 | P4-M-14 offline end to end | P4-W-05 workbench evidence drawer | LKK-402 |
| X-11 | P14-M-02/04 offline inspection with photos, a failed item | P14-W-06 inspection detail, finding for main contractor | PRG-211 |
| X-12 | P14-M-05 contractor resolves the finding with a photo | P14-W-06 finding Resolved with photo | PRG-211 |
| X-13 | P14-M-06 late upload | P14-W-06 inspection late, obligation LATE | PRG-211 |
| X-14 | P12-M-01 contractor assurance with optional registration | P12-W-03 verification queue shows the number only when present | PRG-211 / LKK-402 |
