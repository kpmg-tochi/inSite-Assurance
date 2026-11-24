# Demo Script: Programme Delivery (Central and Co-Funded)

**For:** presenters running the client demo of the two delivery models.
**Length:** about 55 minutes (two storylines of ~15 minutes, the field visit on the phone ~10, KPIs ~5, configuration live ~10).
**Status:** written against the redesign R4 seed (visits, findings, sprint verification), the R5 visit app and the R6 web shell (sidebar, Overview, 5-step setup, merged pages). R5f (removal of the old app's workday reports, WBS chat, Phase 14 inspections, hold points and cadence from the server) is in progress; nothing below depends on them. **Not yet rehearsed in the browser or on a phone:** do one full dry run on a fresh seed before the client session, and note anything that differs here.

---

## 0. Before the demo

1. Reset and seed: from `server/`, `npm run prisma:seed`. Dates are relative to the seed day, so seed **on the demo day** (or the day before).
2. Start the API (`npm run dev` in `server/`) and the web app (`npm run dev` in `web/`). Leave scheduled jobs on: the KPI snapshot job and the deadline jobs run at start-up.
3. Phone: a development build of the app (see `physical_testing_checklist.md` sections 0.1–0.2), with `PUBLIC_API_BASE_URL` set to the computer's LAN address so the phone can reach the API and upload photos.
4. **Site boundary for the phone part.** Photos taken outside a project's site boundary do not satisfy a photo slot, and a simulated location counts as no location. Unless you demo at the PRG-105 site, sign in as `programme.admin@`, open PRG-105 → More ▸ Settings → Project → Location, and move the radial pin to the demo venue (keep the 150 m radius). The change is audited. Do this **before** signing in on the phone.
5. Sign in on the phone as `resident.supervisor@` while online, so it downloads the visits of the next 14 days, their forms and the project packs. Pull down on Home to refresh if you re-seeded.
6. Have a signed handover form ready to describe (paper; the beneficiary has no login, redesign R1d). PRG-104's handover response is left for you to record.
7. Open one browser profile per persona you will switch to quickly (or use private windows).

**Logins** (password `Password123!` for all):

| Persona | Login | Used for |
| :--- | :--- | :--- |
| Programme administrator | `programme.admin@insite.ng` | Settings changes, drafts, KPI page |
| Flagship admin (Programme Authority) | `flagship.admin@insite.ng` | Central owner; second CoC signatory |
| Subsidiary admin, North | `north.admin@insite.ng` | Visibility contrast (sees North only) |
| Subsidiary admin, South | `south.admin@insite.ng` | Co-Funded owner; default case decision |
| South M&E (second signatory) | `south.me@insite.ng` | Co-Funded CoC |
| Funding authority | `programme.funder@insite.ng` | Records payments made outside the platform |
| Monitor (M&E manager) | `programme.monitor@insite.ng` | Visit planner, visit review, findings, handover review |
| M&E officer | `me.officer@insite.ng` | Supervision workload (over the site limit) |
| Resident Supervisor (phone) | `resident.supervisor@insite.ng` | The field visit on the phone; visit officer on PRG-102, PRG-105, PRG-211 and PRG-221, also assigned to PRG-104 |
| Legal officer | `legal.officer@insite.ng` | Default case review |
| Resident, single project (optional, main workspace) | `resident.abj@insite.ng` | The single-project home on the phone (ABJ-108 only; no visits planned there) |

**The demo programme** ("Programme Authority (demo programme)"). The Stage column is what the Overview's stage bar shows.

| Stage | Central | Co-Funded |
| :--- | :--- | :--- |
| Draft (kick-off planned) | PRG-101 (kick-off in 9 days, agenda filed) | PRG-201 (draft) |
| Mobilisation | PRG-102 (on time, due in ~5 days; sprints start in a week; first mobilisation check published) | PRG-221 (overdue, default case at the decision step; a missed quarterly M&E visit) |
| Construction | PRG-105 (sprint 3 of 3; behind: sprint 1 verified partly met, sprint 2 not verified in time; a routine visit tomorrow) | PRG-211 (accepted baseline, a late routine visit, a major finding escalated) |
| Payments | PRG-105 (one interim payment recorded, 5% retention held) | – |
| Completion | PRG-104 (CoC signed once, waiting for the flagship and the beneficiary) | – |
| Closure: defects liability period | PRG-103 (two open defects) | – |
| Closure: closed | – | PRG-241 (post-closure evaluation and audit pending) |
| Closure: archived | – | PRG-242 (closure pack built) |

**No seeded live project is in the Kick-off stage:** PRG-101 is a draft, and a draft has no Overview or Kick-off & mobilisation page. Show the kick-off rules on PRG-101's Contract step and the held kick-off on PRG-102 (A1).

**Where things are (web).** Left sidebar, two groups:
- **Workspace:** Portfolio · Projects · Visit planner · KPIs · Lessons learned · Forms & facilities · Settings.
- **Project** (the selected project's code, with a project switcher that keeps the current page): Overview · Kick-off & mobilisation · Sprints & scope · Visits & reports · Findings · Payments · Documents · Completion & handover · More ▸ (Audit ledger, Settings).

**Where things are (phone).** Home: calendar (week or month), the selected day's visits, My projects, "+ Unscheduled visit"; the header has Notifications, Outbox (with a waiting count) and Profile. A project card opens the Project screen (details, sprints, units, open findings, past visits, Site log, Defects, Report an incident).

---

## 1. Opening: one programme, two models (2 min)

**Login:** `programme.admin@`. **Click:** Portfolio.

**Say:** "This is one programme authority running two delivery models side by side. Central projects are owned and funded by the Programme Authority; Co-Funded ones by a regional delivery entity, itself funded by the authority. The rules for each model are configuration on a project type, not code."

**Click:** the project type filter (Central, then Co-Funded); the region filter (North, South). **Show:** the stage chip on each row (Mobilisation, Construction, Completion, Closure).

---

## 2. Storyline A: Central Delivery Model (15 min)

### A1. Setup, contract award and kick-off (process slide: Kick-off)

**Login:** `programme.admin@`. **Open:** Projects → Drafts → PRG-101. Setup opens.

**Show:** the five setup steps on the left: 1 Project, 2 Contract, 3 Scope & sprints, 4 Team & visits, 5 Review (Advanced, under a divider, is only offered in project settings).

**Click:** step 2 Contract (`/setup/contract`): Contractor, Contract and kick-off, Retention and defects liability.

**Say:** "Award and signing dates drive every deadline. The kick-off is set for nine days from now, so the notice is due seven days before it. The agenda is filed in the document register and goes out with the notice." **Show:** the milestone preview under Contract and kick-off (acceptance letter, notice, meeting, minutes, mobilisation).

**Click:** step 5 Review: open issues grouped by step, each with a Fix link to its section.

**Open:** PRG-102 → Kick-off & mobilisation → Kick-off tab: the guided sequence (contract award and acceptance → notice → meeting held and minutes), all done: notice sent on time, quorum met, minutes signed by the owner and the monitor. **Then:** the Milestones tab.

### A1b. Scope and sprints from the needs-assessment workbook (redesign R2)

**Login:** `programme.admin@`. **Open:** PRG-101 (draft) → setup step 3 Scope & sprints.

**Say:** "The scope comes from the needs assessment. Every bill line belongs to a facility on site: a classroom block, a toilet, 120 desks. Sprints say which facilities are being built when. The facility list is the programme's own, and it feeds the workbook's dropdowns."

**Click:** Download workbook. Open it: the Facility units sheet's Facility column is a dropdown of the 50 facilities; BoQ Amount is a formula. Fill two sprints, three units (one Classroom, one Toilet, one Pupils' furniture with 120 desks) and four BoQ lines; on the Project sheet enter the school name, LGA and GPS point. (Have a filled copy ready to save time.)

**Click:** Import workbook → choose the file. **Show:** the preview: lines grouped by facility and sprint, amounts recomputed as quantity × rate, the project fields that will be filled (only empty ones), and any warning (for example the total above the budget). Nothing is saved yet.

**Click:** Import. **Show:** the Scope & sprints section is complete; the lines took their planned dates from their sprints.

**Optional:** paste an unknown facility name into the workbook and import again: the preview shows a row-level error and Import stays disabled.

**Show (live project):** PRG-102 → Sprints & scope: three sprints, three units; Import is disabled ("change the scope below, every change is audited"). Forms & facilities → Facilities shows the catalogue; retiring a facility hides it from new scope but keeps it on PRG-102.

### A2. Mobilisation (process slide: Mobilisation)

**Open:** PRG-102 → Overview.

**Show:** the stage bar (Kick-off done, Mobilisation current), Current sprint ("starts in a week"), Next visit (the mobilisation check), Next deadline (contractor on site, due in about 5 days).

**Open:** Kick-off & mobilisation → Mobilisation tab.

**Say:** "Central contracts allow 21 days from kick-off to mobilise. Officers visit every two weeks until the contractor is on site: the first accepted mobilisation check that says so completes the milestone, dated on the visit, and cancels the later checks. The letter of introduction and the mobilisation documents are tracked alongside."

**Show:** the contractor-on-site milestone, the mobilisation check visits (the first one published to `resident.supervisor@`), and the mobilisation compliance panel (documents still missing, days left).

### A3. Monitoring and evaluation (process slide: M&E)

**Open:** PRG-105 → Overview: stage Construction, Current sprint (sprint 3 of 3, its facility units), schedule badge Behind, Next visit (tomorrow's routine visit), Budget and payments bar, KPI card. **Say:** "The schedule follows sprint verification: sprint 1 was verified partly met, and sprint 2 ended without being verified in time with a unit below 100%."

**Then:** Sprints & scope: sprint statuses (Verified, Late). **Verify** on an ended sprint shows, per facility, the latest accepted visit's answers, unit progress and open findings.

### A3a. Visit planning (redesign R4)

**Login:** `programme.monitor@` (M&E manager). **Open:** Visit planner: officers × days for the week; drag a visit to another day (asks for a note). Side panel: a date proposal waiting (accept it) and a declined visit (reassign it). **Then:** PRG-105 → Visits & reports (Plan tab): the plan with confirmations, the warnings, **Generate from plan**, publish a proposed visit.

**Say:** "Each visit's form is frozen when it is published, so the officer answers exactly what was planned. Open findings are added as re-check items to every visit that has not started."

### A3b. The field visit, on the phone (redesign R5, ~10 min)

**Phone:** signed in as `resident.supervisor@` (step 0.5).

**Say:** "Field staff sign in with their own account and see all their sites at once. Contractors and beneficiaries have no login. Everything you see now also works with no signal."

1. **Home.** The calendar opens on this week. Switch to Month and swipe between months; dots mark planned, overdue and done visits (different shapes, explained in words under the calendar). Tap tomorrow: PRG-105's routine visit in the day list. Scroll to My projects: one card per project (code, name, stage, "Sprint 3 of 3", next visit, open findings; PRG-102 shows its mobilisation day count).
2. **Respond.** On tomorrow's visit tap **Confirm** (the comment is optional). Open the response sheet again to show the other answers: **Move** offers only the dates inside the allowed window (2 working days either side of the original date, inside its sprint); **Propose a date** takes a later date and goes to the manager (that is the proposal you accepted in A3a); **Decline** needs a comment. Cancel.
3. **Go offline.** Turn on airplane mode. Everything from here works without a connection.
4. **Check in.** Open the visit: project, school, visit type, planned and first planned date, report due date, the sprint and its deliverables, facilities to check, findings to re-check. Tap **Check in**: the phone takes a fresh position and shows "On site", "Just outside the boundary" or "Outside the site boundary" with the distance. **Say:** "An officer can always check in; an outside check-in is flagged for the reviewer, never refused." The form opens.
5. **Fill the form.** One section per screen with a progress bar. In the Toilet block, "Plumbing connected" is asked for each unit, and answering Yes asks for a photo of that unit: one labelled slot per unit. Take the photos in the app (there is no gallery import). Show a rule note ("This answer will raise a finding") and a comment that appears only when the answer needs it. **Optional:** close the app and reopen it: the draft resumes where you left it.
6. **Review and submit.** The review screen lists anything still missing by section (tap to jump back), says how many findings the report will raise, and asks for the overall finding and a summary. Tap **Submit report**. The Visit screen shows "Waiting to send".
7. **Site log.** Back to the project (from Home, tap the PRG-105 card) → Site log: add a photo, a voice note and a typed note. Each is geotagged and saved offline. **Say:** "The site log is for anything seen between visits. A site log photo taken on the visit day can also be picked into the form, and entries can be attached to a report."
8. **Outbox.** Tap Outbox in the Home header: rows for PRG-105 labelled Photo, Check-in, Visit report and Site log entry, all waiting. Turn airplane mode off and pull down on Home. The outbox empties in order: photos first, then the check-in, then the report. A failed row would show its error and a Retry button.

**Back on the web** as `programme.monitor@`: PRG-105 → Visits & reports → the visit just submitted: answers by section with the photos per unit, the check-in location (flagged if it was outside), **Approve** or **Return**.

**Say:** "An accepted visit updates unit progress, raises findings from the form's rules, and emails the contractor the open findings."

**Show:** Findings (open, resolved, dismissed; re-check count, escalated) and Visits & reports → Site log (the entries just sent).

**Optional on the phone:**
- **+ Unscheduled visit** on Home: pick PRG-105 and a facility; the Ad hoc visit is created on the phone, offline, then checked in and filled like any other.
- Sign in as `resident.abj@` (main workspace): with one active project, Home shows that project's card in full instead of a list.
- Voice notes are transcribed on the server once uploaded, only when Whisper is configured; without it no transcript is shown.

### A3c. Visit forms (redesign R3)

**Login:** `programme.monitor@`. **Open:** Forms & facilities.

**Say:** "Fifty facilities, but nobody wrote fifty forms. Each facility starts from one of four archetype sub-forms, and the M&E team customises only the ones that differ. The fixed sections (health & safety, materials…) are written once and reused by every visit type."

**Show:** Facility sub-forms: the four archetype defaults; filter "Customised only": Toilet is customised (v1). **Click:** Edit on Toilet: the building questions plus "Plumbing connected", asked per unit, photo when yes. Show preview → Routine: "Workmanship acceptable on all 3 toilets", one photo slot per toilet. Cancel.

**Show:** Fixed sections and Visit form templates: Routine = Progress → [facility sub-forms] → Workmanship → Materials → Health & safety → Environment.

**Click:** Preview → PRG-105, Routine, today → Build form. **Show:** the sprint 3 header and deliverables, one block per facility with its units (the classroom block and the toilet block), the Toilet's per-unit plumbing question and one photo slot per unit, the rules on each question. **Say:** "This is the form the phone got in the field part. It is frozen when a visit is published: editing a template later never changes a visit already assigned." Switch to Ad hoc, pick Toilet: only the toilet block.

**Optional (carry-over):** as `monitor@` (main workspace), preview LKK-402 Routine: sprint 2's units plus sprint 1's earthworks and culverts, which ended four weeks ago and are not complete.

### A4. Payments (process slide: Payments)

**Login:** `programme.funder@`. **Open:** PRG-105 → Payments.

**Say:** "Payments are made through your own finance process, outside the platform. Finance records each one here, so progress, retention and the closure checks stay complete. Later the ERP can feed these records directly."

**Click:** Record payment → Interim payment, today, NGN 20,000,000, reference PV-DEMO-01, sprint 3 (optional). Point out the 5% retention held automatically and the net amount, the sprint column, and the paid-against-contract-sum bar. Then record a **Final payment** of any amount: it is accepted but flagged "Final payment recorded before the Certificate of Completion was issued", and a notification goes to the payments team. Use the filters (kind, sprint, exceptions only). Void the final payment with a reason to show that entries are corrected, never deleted.

**Show:** the Release checks panel (Certificate of Completion issued, liability period end, open defects), then Overview: the payments bar has moved.

### A5. Completion (process slide: Completion and handover)

**Login:** `flagship.admin@`. **Open:** PRG-104 → Completion & handover → Certificate tab.

**Say:** "The Certificate of Completion needs the Head of Physical Planning and the Head of M&E of the owning organisation, and then the beneficiary. The programme administrator has signed; I sign as Head of M&E."

**Click:** sign the "Head of M&E" slot. Then, as `programme.admin@`, record the beneficiary's signed paper copy (upload any PDF, attest). The last signature issues the certificate and its PDF.

**Handover:** as `programme.monitor@`, open PRG-104 → Completion & handover → Handover tab → Record handover response: the head teacher accepted with one snag; tick the attestation that it matches the signed copy. Then mark it reviewed: the handover certificate is issued and the handover milestone is done.

**Show:** PRG-104 → Overview: the stage bar (Completion current) and the phase action **Start defects liability period**. **Say:** "Before the certificate was issued this button explained why it could not proceed; now it can." (Optional: run it.)

### A6. Liability period (process slide: Defects liability)

**Login:** `programme.monitor@`. **Open:** PRG-103 → Completion & handover → Defects tab.

**Say:** "Snags from the handover became defect tickets against the contractor. Officers close them on site with photos from the phone; the contractor has no login. Retention is released by recording a retention-release payment; one recorded before the period ends or with defects still open is flagged."

**Show:** PRG-103 → Payments → Release checks: the liability period end and the two open defects.

---

## 3. Storyline B: Co-Funded Delivery Model (15 min)

### B1. Ownership and visibility

**Login:** `north.admin@`, then `south.admin@`. **Click:** Projects.

**Say:** "Each delivery entity sees only its own projects. The Programme Authority sees everything below it."

### B2. Mobilisation overdue and default (process slide: Contractor default)

**Login:** `south.admin@`. **Open:** PRG-221 → Kick-off & mobilisation → Milestones tab.

**Say:** "Co-Funded contracts allow 14 days. No officer confirmed the contractor on site, so the milestone went overdue and a default case opened by itself. Legal has reviewed it and served notice. The decision belongs to the delivery entity's executive."

**Click:** the default case → decide (for example, a cure period of 7 days).

### B3. Supervision and visits (process slide: M&E)

**Login:** `programme.monitor@`. **Open:** PRG-211 → Visits & reports.

**Show:** the accepted baseline, the routine visit uploaded late, and in Findings the major finding (work at height without harnesses) open past escalation. On PRG-221 → Visits & reports, the missed quarterly M&E visit. Then, as `programme.admin@`, Settings → Supervisors (was "Inspections & supervisors"): the M&E officer (`me.officer@`) supervises more sites than the Co-Funded limit of 2. The system warns and never blocks. The contractor has no login: it gets the findings by email after each accepted visit.

### B4. Closure (process slide: Closure)

**Open:** PRG-241 → Completion & handover → Closure tab.

**Say:** "Closed, rated and two lessons published. Archiving waits for the post-closure evaluation two weeks after closing, and for an audit sign-off that cannot be waived."

**Open:** PRG-242 → Completion & handover → Closure tab. **Say:** "This one is archived. The closure pack is one ZIP for the auditor: index, every document and certificate, the payment record, visit summaries, the audit ledger and a check that the ledger chain is intact."

**Click:** download the closure pack.

---

## 4. Programme KPIs (5 min) (process slide: KPIs per stage)

**Login:** `programme.admin@`. **Click:** KPIs.

**Say:** "The process flow defines a KPI for each stage. Here they are for everything I can see, against the targets set for each model."

**Show:**
- The period selector (this quarter by default; switch to this month).
- Mobilisation: "Contractors mobilised on time" says targets vary. Central is 90% and Co-Funded 85%, with the per-model breakdown underneath.
- M&E: "Visits conducted vs planned" (PRG-221's missed visit counts against it) and "Sprints verified on time".
- Click a tile → the contributing projects. Click a project to open it.
- Filter by Co-Funded and by South.
- "Not tracked" versus 0%: point at a KPI with nothing to count yet (for example audits done after closure on a type with no closed projects): it shows "not tracked", never 0%.
- Export CSV.
- Log in as `north.admin@`: the same page shows only North's project.

---

## 5. Configuration, live (10 min)

Change each setting, show the effect, and say whether it applies at once or to new projects. The project type editor (Settings → Project types, regions & documents → Project types) has general fields on top and five tabs: Kick-off & mobilisation, Monitoring, Completion & closure, KPI targets, Advanced.

| Setting | Where (as `programme.admin@`) | Change | Show | Applies |
| :--- | :--- | :--- | :--- | :--- |
| **Terminology** | Settings → Tenant Settings → Terminology | "Retention" → "Retention money" | PRG-105 → Payments and PRG-103 → Completion & handover; phone labels too | At once |
| **Mobilisation days** | Project types → Central → Kick-off & mobilisation tab → "Contractor mobilised on site" | 21 → 28 days | Save (new version). Create a new Central draft (Projects → + New Project), set a planned kick-off on step 2 Contract, and see the deadline at +28 in the milestone preview. PRG-102 keeps +21. | New projects (existing projects keep their version) |
| **CoC signatories** | Project types → Co-Funded → Completion & closure tab | Add a third slot, e.g. "Programme Authority M&E", scope "Owning organisation or above" | Save. A new Co-Funded project's certificate shows three staff slots. | New projects |
| **Visit plan** (optional) | Project types → Central → Monitoring tab | Routine visits every 2 weeks → every week | Save. A new Central draft's step 4 Team & visits previews weekly routine visits. | New projects |
| **KPI targets** (optional) | Project types → Co-Funded → KPI targets tab | Mobilised on time 85 → 95 | KPIs: the Co-Funded figure turns from met to missed | At once |

**Say:** "Every rule you saw is a setting with today's behaviour as the default. When a type changes, projects already running keep the rules they started with, and that is recorded."

---

## 6. If something goes wrong

| Symptom | Cause | Fix |
| :--- | :--- | :--- |
| KPI trends show "Trend after two months of snapshots" | Snapshots missing (reset without the seed) | Re-run the seed. |
| A deadline looks a day off | Seeded the day before | Re-seed on the demo day. |
| PRG-105 shows extra payments | Recorded in an earlier rehearsal | Void them, or re-seed. |
| The phone shows no visits, or old ones | Signed in before the re-seed, or never online since | Pull down on Home (online). If the projects changed, sign out and in again. |
| Photo slots say "Outside the site boundary" | The demo venue is not inside PRG-105's boundary | Step 0.4: move the pin, then pull down on Home. A simulated location never counts. |
| The Visit screen says the form is not on this phone | Forms download in the background after sign-in | Tap "Download the form" (online). |
| The report stays "Waiting to send" | Still offline, or a row failed | Open Outbox: Retry the failed row; photos and the check-in must go first. |
| No transcript under a voice note | Whisper not configured | Expected; transcripts appear only when the server produced one. |
