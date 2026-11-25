# Demo script: one school, from needs assessment to closure

**Status:** written 2026-11-25 from the verified API walk-through (`server/src/tests/routes.demo.test.ts`). **Not yet rehearsed in a browser or on a phone.** Rehearse once end to end before the real demo; note anything that differs and fix this file.
**Length:** about 45 minutes (a 25-minute cut is marked ✂ at the end).
**Updated 2026-11-25** for the IRL items built before the demo: bulk project import, register fields and filters, exports, early-warning alerts, photo compression and compass heading.
**Audience:** UBEC management and the departments in the MoE process design (Physical Planning, M&E, Procurement, Finance & Accounts, Legal, Audit).
**Everything shown is demo data.** The school, people, contractor and amounts are illustrative; the PDFs carry a "SPECIMEN – demo data" footer.

---

## Before the demo

| When | Do |
| :--- | :--- |
| The day before | `npm run prisma:seed` (from `server/`); start the API and the web app; sign in once with every login below, web and phone. |
| **On the demo day** | `npm run demo:pack` (from `server/`). It rebuilds `saas_updates/demo_pack/` with dates relative to today. Run it on a weekday: the demo project works Monday to Friday. Copy the pack to the presenting laptop's desktop. |
| A few days before | Install a fresh **EAS dev build** of the field app on both phones: photo compression and compass heading need it (an older build still works, but keeps full-size photos and records no heading). |
| 15 minutes before | Phones on the same network as the API, field app signed in: phone A as `resident.supervisor@ubec.test`, phone B as `independent.me@ubec.test` (one phone works too: sign out and in, about a minute). Mirror the phones on screen. |
| Browser tabs | Tab 1: `admin@ubec.test` on the Portfolio. Tab 2 (another browser profile or a private window): `me.officer@ubec.test` on the Dashboard. |

Password for every account: `Password123!`. Full list: [demo_accounts.md](demo_accounts.md).

| Who (in the story) | Login | Where |
| :--- | :--- | :--- |
| Hauwa Bello, UBEC Administrator (acts for Physical Planning, Procurement, Finance, Legal and the ES today) | `admin@ubec.test` | Web, tab 1 |
| Ngozi Eze, UBEC M&E Officer | `me.officer@ubec.test` | Web, tab 2 |
| Musa Danladi, Resident Supervisor | `resident.supervisor@ubec.test` | Phone A |
| Engr. Emeka Obi, Independent M&E (COREN-certified firm) | `independent.me@ubec.test` | Phone B |

**What is live and what was prepared.** Acts 1–5 happen live on a project created in front of the audience (code `PRG-110`). Completion and closure need months of site work, so Acts 6 and 7 use two schools the seed has already taken further: PRG-104 (completion) and PRG-106 (closure). Say so plainly when you switch: it reads as confidence, not a trick.

### Threads to plant and pay off (presenter only)

Each detail below is planted early and pays off later. Don't point at them; let the audience connect them.

| Planted | Paid off |
| :--- | :--- |
| Opening question: "Was the toilet block built?" | Closing: answered in ten seconds from the project page. |
| "The folder" (paper, late, can't be checked, never says no) | Closure: the closure pack, a folder that built itself, with a verified audit trail. |
| The MoE rule: mobilise within three weeks of the kick-off | Act 4: the Resident Supervisor's report closes the mobilisation milestone, dated. Closing: "Contractors mobilised on time" on the KPI page. |
| The mobilisation agreement's PPE clause (Act 3) | Act 5: the inspector answers "PPE worn: No", and a finding opens by itself and comes back on the next visit. |
| The kick-off's one-week notice rule | Act 3: the platform refuses short notice unless you record why. Act 6: it refuses to let one person record and approve the same handover. |
| "The folder arrives late" | Closing: the platform raises the alarm itself (stalled, update overdue, behind), on the web and on the phone. |
| "Excel is where the work lives today" (Act 1) | Act 1 imports the register from Excel; Act 5 and the closing export back to Excel and PDF in one click. |

---

## Act 0. Opening (3 min)

**Show:** nothing yet. Tab 1 is open on the Portfolio but leave the title slide or a blank screen up.

**Say:**
> "Before I show you anything, a question to hold on to.
>
> Pick any school UBEC funded last year that was getting a new toilet block. Was the toilet block built? Not paid for. Not reported as completed. Built, to the specification, within the contract period.
>
> How long would it take to answer that today, with evidence you'd be comfortable showing an auditor?
>
> Keep your answer. We'll come back to it."

**Show:** the Portfolio (tab 1): the map of Kano and Lagos with project pins and the portfolio cards. Don't point at the red alert chips in the register yet: they pay off at the end.

**Say:**
> "This is the programme as the platform sees it. Every pin is a project: Direct Intervention projects that UBEC runs from headquarters, and Matching Grants projects that a SUBEB runs. Every colour is a stage.
>
> Today the answer to my question lives somewhere else: in a folder. The award letter is in one office, the kick-off minutes in another. The Resident Supervisor's weekly report arrives on paper, or as a photo on WhatsApp with no date and no location. The M&E visit comes three months later.
>
> The folder isn't anyone's fault. But it has three habits. It arrives late. It can't be checked. And it never says no: a payment can go out before a Certificate of Completion exists, and a contractor can miss the three-week mobilisation window without anyone noticing until the term is over.
>
> Your process design already says what should happen at every step, who does it and what document comes out of it. What you need is that process running in one place. So let's follow one school through it."

---

## Act 1. The need (7 min)

### 1a. The projects you already have (2 min)

**Say:**
> "Before any new school, a practical question: UBEC already has hundreds of projects running, and today they live in spreadsheets. Day one can't mean retyping them."

**Show** (tab 1, `admin@ubec.test`): Portfolio register → **Import projects** → `14 Project register import.xlsx` from the demo pack → preview: six rows, two **drafts** (not started) and four **live** projects already under way, each with its new code, UBEC project ID and reported % complete → **Import**. In the register, filter by **LGA** or **contractor** to find one; its progress shows "reported" until its first verified visit.

**Say:**
> "Projects that haven't started arrive as drafts. Projects already on site arrive live, with the percentage UBEC reported and UBEC's own project ID next to ours. From their next verified visit, the platform takes over the figure."

### 1b. A new school (5 min)

**Say:**
> "Our school is Government Primary School, Dawakin Tofa, in Kano. The State office's needs assessment found what the MoE design asks every school project to cover: toilets, water and power. A toilet block, a motorised borehole and solar power to run it. About forty-four million naira of works."

**Show** (tab 1, `admin@ubec.test`):
1. Dashboard → projects table → **New project**.
2. Delivery model **Direct Intervention**. Name "WASH upgrade, Government Primary School Dawakin Tofa", code `PRG-110`, UBEC project ID `UBEC/DI/2026/KN/110`, state "Kano State", region Kano, budget 48,500,000. Leave the LGA, intervention year and funding source empty.
3. Go to step 3, **Scope & sprints** → **Import needs assessment** → `Dawakin Tofa needs assessment.xlsx` from the demo pack.
4. On the preview, point at: 3 facility units, 8 BoQ lines, NGN 44,275,000, no errors, and the project fields it will fill (LGA, school, site address, intervention year, funding source, justification, assumptions, site boundary).
5. **Import and fill 8 project field(s)** (the number on the button may differ by one or two if you typed a field the file also carries; that's fine).

**Say:**
> "That's the needs assessment template, the same file the State offices fill in. It carries the BoQ, the facilities, the sprints and the GPS point of the school. The platform reads it, checks every row and refuses a file it can't trust. Nobody retypes a BoQ.
>
> Notice the sprints. Instead of one long contract period, the works are cut into two sprints, each with a date and a list of what must be finished. That's what the supervisors will be checked against."

**Show:** step 1 **Project** → the site map with the 150 m boundary drawn around the GPS point.

**Say:**
> "And the school now has a boundary. Every visit later is checked against it."

---

## Act 2. The contract and the people (5 min)

**Show** (still `admin@ubec.test`, still in the draft):
1. Step 1 **Project** → parties: Independent monitor = "Independent M&E Consultants (COREN-certified)". Save.
2. Step 2 **Contract** → Contractor: type "Kurmi Waterworks & Construction Ltd" → **Use "Kurmi Waterworks & Construction Ltd"**. Contract: reference `UBEC/DI/2026/110`, sum 46,490,000, award date two weeks ago, signed one week ago, planned kick-off **today**. Save.
3. Step 4 **Team & visits** → Team: add Ngozi Eze (UBEC M&E Officer), Engr. Emeka Obi (Independent M&E) and Musa Danladi (Resident Supervisor). Save.
4. Visits: visit officer **Musa Danladi**, working days Monday to Friday. Show the visit plan preview. Save.
5. Documents → **Add document**: `01 Letter of award.pdf` (Award letter), `02 Acceptance of award.pdf` (Acceptance letter), `03 Contract agreement.pdf` (Contract).

**Say** (while you set the team):
> "Two people matter most from here. Musa is the Resident Supervisor, the State office engineer who visits every week. The design caps him at seven to ten sites, and the platform warns when someone goes over. Engr. Obi is from the COREN-certified firm UBEC engages for independent monitoring.
>
> The visit plan comes from the project type, not from memory: mobilisation checks every two weeks until the contractor is on site, weekly supervision, quarterly M&E, a final evaluation. Physical Planning sets it once per programme."

**Show:**
1. Step 5 **Review** → the checklist is green → **Set project active** → **Save and set active**.
2. The project **Overview**: the stage bar and the proposed visits.
3. Kick-off & mobilisation → **Milestones**: the contract milestones with due dates. **Complete** "Acceptance letter received".

**Say:**
> "The project is live. The milestones on this page come from the dates we just entered: acceptance within three days of the award, kick-off, mobilisation within three weeks. Each one has a due date, and each one will go amber and then red on its own."

---

## Act 3. The kick-off and the three-week clock (5 min)

**Show** (Kick-off & mobilisation → **Kick-off**):
1. Schedule the meeting today, invitees from the four groups: UBEC (Hauwa Bello), M&E (Ngozi Eze), the contractor (Kurmi Waterworks, any name and email), the beneficiary (the Head Teacher). Briefing pack: `04 Kick-off agenda and briefing pack.pdf`.
2. **Send notice**. The platform refuses: the notice must go out a week before the meeting.

**Say:**
> "That's the first time the platform says no. Your design asks for a week's notice. We're compressing a month into a morning, so I'll do what a real officer would have to do: record why."

**Show:**
3. Give a reason → **Send with short notice**.
4. **Record the meeting as held**: tick every attendee (quorum: one per group), minutes `05 Kick-off meeting minutes.pdf`. "Kick-off notice sent" and "Kick-off meeting held" complete on their own.
5. Documents → **Add document**: `06 Letter of introduction to the Head Teacher.pdf`, `07 Resident Supervisor assignment.pdf`, `08 Mobilisation agreement (PPE clause).pdf`, `09 Site possession form.pdf`. Open the mobilisation agreement and point at the PPE clause, then **Sign off** it and the site possession form, and the minutes.

**Say** (with the mobilisation agreement open):
> "The mobilisation agreement is the contractor's promise: people, plant, materials and, here, safety equipment on site from day one. Hold on to this clause.
>
> From this morning the three-week clock is running. In the folder that clock is a sentence in a manual. Here it's a date."

---

## Act 4. The first report from site (6 min)

**Say:**
> "Fast-forward to the contractor's first day on site. The design says UBEC checks every two weeks until the contractor has mobilised. The platform planned that check. Ngozi brings it forward to today and sends it to Musa."

**Show** (tab 2, `me.officer@ubec.test`):
1. PRG-110 → **Visits** → the proposed mobilisation check → **Move or reassign** → date today, officer Musa Danladi → **Publish**.

**Show** (phone A, Musa):
1. Home: the calendar shows the visit today. Open it → **Confirm** → **Check in**: the app shows he is inside the school's boundary.
2. The form: ten questions. Contractor on site **Yes**, letter of introduction presented **Yes**, equipment **Yes** (photo), site office and signboard **Yes** (photo), the rest as you like. Take the photos on the spot.
3. **Review** → **Submit**.

**Say** (while Musa fills the form):
> "This is the weekly report that used to arrive on paper. Every answer is a question the M&E department wrote once, in the form library. Photos are taken in the app, stamped with time, place and the direction the camera was facing, and they can't be picked from the gallery. The app shrinks each one to a few hundred kilobytes, so a weak signal still gets them through. It works offline: if there's no signal at the school, the report waits on the phone and goes when it can."

**Show** (tab 2, Ngozi):
1. PRG-110 → **Visits** → the submitted check → visit drawer: answers, photos (hover one: time, GPS accuracy and the direction the camera faced, e.g. "Facing NE (47°)"), the check-in inside the boundary → **Approve**.
2. Kick-off & mobilisation → **Milestones**: "Contractor mobilised on site" is **done**, dated today. The Overview stage has moved on.

**Say:**
> "Remember the three-week clock. It just stopped, and it stopped because of evidence, not a phone call. If Musa had answered no, the clock would have kept running, the platform would have planned the next check, and on day twenty-two Legal would have a default case waiting for them, with the history already attached."

---

## Act 5. The inspector's visit (7 min)

**Say:**
> "Weekly supervision is UBEC's own eyes. The design also asks for independent eyes: a COREN-certified firm that visits when UBEC asks. Ngozi asks."

**Show** (tab 2, Ngozi):
1. PRG-110 → **Visits** → **New visit** → kind **Ad hoc**, date today, officer Engr. Emeka Obi (lead), facilities to check: **Toilet** only → **Plan and publish**.

**Say:**
> "Eight questions, because the form is built from what's being built: the toilet block's own questions, plus health and safety. No generic twelve-page checklist."

**Show** (phone B, Engr. Obi):
1. The visit is on his calendar → **Confirm** → **Check in**.
2. Toilet: stage **Substructure**, **15%**, workmanship acceptable **Yes**, a photo of the unit, plumbing connected **No**.
3. Health & safety: PPE worn by all workers **No**. The app asks for a photo and a comment. Comment: "Two labourers on the foundation without boots or helmets." Site fenced **Yes**, incidents **No**.
4. **Submit**.

**Show** (tab 2, Ngozi):
1. The submission → **Approve**.
2. PRG-110 → **Visits** → **Findings** tab: a finding is **open**: PPE not worn, minor, raised by the form itself from Engr. Obi's answer.
3. **Sprints & scope**: the toilet block shows 15%.
4. Publish the next proposed routine visit and open its form: at the top, a **re-check** of the PPE finding.
5. Findings tab → **Export to Excel**: the same list, UBEC-styled, ready to attach to a memo. (Visits, payments and KPIs have the same button; the register exports to Excel and PDF.)

**Say:**
> "Remember the clause in the mobilisation agreement? Nobody had to remember it. The answer 'no' opened a finding, the contractor got an email listing it, and the finding will follow the project. Every next visit asks about it again until someone on site says it's fixed, with a photo. And if it stays open too long, it escalates to the people who can do something about it.
>
> In the folder, this observation is a line in a report that arrives in March. Here it was on Ngozi's screen before Engr. Obi left the school."

---

## Act 6. Completion (6 min)

**Say:**
> "Building takes months, so let's not wait. Here's another school that started the same journey last year: a Direct Intervention project in Lagos, PRG-104. The works are done, the final evaluation has been accepted, and the Certificate of Completion is half-signed."

**Show** (tab 1, admin, then tab 2):
1. PRG-104 → **Completion & handover** → **Certificate**: the slots. Head of Physical Planning signed; Head of M&E and the beneficiary still open.
2. Tab 2 (Ngozi) → **Sign** the Head of M&E slot.
3. Tab 1 (admin) → beneficiary slot → **Record signed copy** → `12 Certificate of Completion - signed paper copy.pdf`, tick the attestation. The certificate is **issued** and its PDF is generated.

**Say:**
> "The design is clear: no handover, no final payment and no closure without a signed certificate. The platform enforces it. Try to start the defects period without one and it refuses. Record a final payment without one and it's flagged as an exception for Finance and Audit.
>
> The beneficiary doesn't need a login. The Head Teacher signs on paper, as today, and the officer files the signed copy and attests to it."

**Show:**
4. **Handover** tab. Tab 2 (Ngozi) → **Record handover response**: accepted, by the Head Teacher, attestation ticked.
5. Still as Ngozi → **Mark reviewed**. The platform refuses: *"You recorded this handover response, so another officer must review it."*

**Say:**
> "That's the platform saying no again, and politely. The person who records the handover can't also approve it. Four eyes, every time, with no exceptions."

**Show:**
6. Tab 1 (admin) → **Mark reviewed** → the handover certificate is issued and "Handover ceremony held" is done.
7. **Overview** → **Start the defects liability period** is now allowed.

---

## Act 7. Closure (4 min)

**Say:**
> "One more jump. PRG-106, Gwale Central Primary School in Kano, finished its defects liability period last month. The retention has been released, the contractor rated, the as-built drawings handed over. One thing is left: closing the file.
>
> A month ago the platform would have refused. A project can't be closed while its twelve-month defects liability period is still running: the school keeps its protection until the last day."

**Show** (tab 1, admin, PRG-106):
1. **Completion & handover** → **Closure**: the checklist, everything green before closing.
2. **Overview** → **Close the project**.
3. **Closure** tab → **Upload closeout report** → `13 Closeout report.pdf`. (Archiving is refused until it's there.)
4. Project settings → **Archive project**.
5. **Closure** tab → **Export closure pack** → download the ZIP and open it: the index, every document and certificate, the visit summaries with their photos, and the audit ledger with its verification result.

**Say:**
> "This is the folder. The same one from the beginning, except nobody assembled it. It built itself, one visit and one signature at a time, and anyone can check that nothing in it was changed after the fact. That's the audit ledger: every action in this project, chained together, verified on export."

---

## Closing (3 min)

**Say:**
> "One more habit of the folder: it arrives late. You find out a site went quiet when someone finally asks."

**Show:** the Portfolio register: the alert chips on PRG-105 (**Delayed**, **Stalled**, **Site update overdue**) and PRG-211 (**Site update overdue**); the "projects with early-warning alerts" figure. Open the notification bell: the same alerts, each linked to the page that needs action. On phone A, Musa's notifications show the overdue-update alert for his site.

**Say:**
> "Nobody had to ask. A project with no verified progress for a month is flagged as stalled; a site with no approved report for two weeks is overdue; a project paid ahead of its verified progress is flagged to Finance. The thresholds are set per programme, and the people who can act are told, on the web and on the phone."

**Show:** Programme KPIs (`/app/kpis`): "Contractors mobilised on time", "Visits conducted vs planned", "Reports submitted on time", "Verified on time and to specification", and the monthly trend. These are the KPIs of the MoE process design.

**Say:**
> "The three-week rule from the manual is now a number on this page, per programme and per state, every month."

**Show:** back to PRG-110 → **Overview**: the toilet block at 15%, the open PPE finding, the visits with their photos.

**Say:**
> "So, the question from the beginning: was the toilet block built?
>
> For Dawakin Tofa the answer takes ten seconds. Fifteen percent, at substructure, checked by an independent engineer this morning, inside the school's boundary, with photos. One safety issue open, and it'll be asked about again on the next visit.
>
> That's the difference. The folder tells you what someone said happened. This tells you what was seen, by whom, where and when. And it keeps asking until the answer is yes."

---

## Questions you are likely to get

| Question | Short answer |
| :--- | :--- |
| Does it work without network at the school? | Yes. The field app works offline; reports, photos and check-ins queue on the phone and send when a signal returns. |
| Is there AI in it? | No. Every rule is a written rule from your forms and process (decision Z). The only automatic step is turning voice notes into text. |
| Can the contractor log in? | No. Contractors receive emails (kick-off notice, findings summaries). UBEC staff record what contractors submit. |
| Payments? | Payments stay in UBEC's finance system. The platform records each payment against the project, holds 5% retention and flags exceptions, such as a final payment before the Certificate of Completion. |
| Matching Grants? | Same platform, different rules on the project type: the SUBEB owns the project, its Executive Chairman decides default cases, and there's a post-closure evaluation and an audit sign-off before archiving. See the optional scene below. |
| Who can see what? | UBEC HQ sees everything. A SUBEB sees only its own projects. M&E officers and independent monitors see the projects they're assigned to. |
| Can we bring in our existing projects? | Yes: the register import (Act 1a) takes the whole list from Excel; projects already on site come in live with their reported progress. |
| Can we get the data out? | Yes: the register to Excel and PDF; visits, findings, payments and KPIs to Excel, each with the filters on screen. UBEC's own report templates come once we receive them (IRL item 11). |

### Not in the platform yet (say so plainly if asked)

| Topic | What to say |
| :--- | :--- |
| Sign-in security | Today: password, account lockout after repeated failures, every action in the audit ledger. Before go-live, sign-in will also offer **multi-factor authentication** (an authenticator app, required for administrators) and **short-lived sessions** with automatic sign-out when idle, plus a self-service password reset. |
| Email | The platform sends email today through a mail service; before go-live it will send through **UBEC's own mail server** (SMTP) from a UBEC address (IRL item 14). |
| Finance systems | Payments are recorded in the platform today. A feed from UBEC's finance and procurement systems follows once we know which systems they are (IRL item 3). |
| Hosting | The platform will run on the hosting UBEC chooses; the hosting setup and backup plan follow that decision (IRL items 1–2). |
| Report templates and statuses | Exports exist; UBEC's report templates, a formal status list (stalled, abandoned) and condition reporting follow UBEC's definitions (IRL items 9–11). |

## Optional scenes (if time or questions allow)

| Scene | Login | Show |
| :--- | :--- | :--- |
| A SUBEB's view | `kano.admin@ubec.test` | The portfolio shows only Kano SUBEB's project (PRG-211); UBEC HQ's Kano projects are invisible. |
| A missed mobilisation | `lagos.admin@ubec.test` | PRG-221 → Kick-off & mobilisation → the default case waiting at "SUBEB Executive Chairman decision", with the Legal review attached. |
| A late sprint | `me.officer@ubec.test` | PRG-105 → Sprints & scope: sprint 1 verified PARTLY MET, the BEHIND badge on the directory. |
| Configuration | `admin@ubec.test` | Forms & facilities (the form library and facility sub-forms); Settings → Project types (visit plan, milestones, closure rules, KPI targets); Settings → Roles. |
| Payments | `admin@ubec.test` | PRG-106 → Payments: interim and final payments, retention held then released after the liability period; **Export to Excel**. |
| Alert settings | `admin@ubec.test` | Settings → Project types → Direct Intervention → Monitoring: the early-warning alerts, each with a switch and a threshold, and who receives it. |

## ✂ The 25-minute cut

Skip Act 1a (mention the register import in one sentence), the Act 2 document uploads (say they're there), the kick-off notice detour in Act 3 (schedule and record held only), the routine-visit re-check in Act 5 (just show the finding), and the closure pack download in Act 7 (show the button and the checklist). Keep Act 0 and the closing intact: they carry the story.

## If something goes wrong

| Problem | Recovery |
| :--- | :--- |
| The import preview shows errors | The pack was built on another day. Run `npm run demo:pack` again and re-import. |
| The phone doesn't show the visit | Pull to refresh on the phone's home screen; check the visit was **published**, not only planned. |
| A photo won't upload | Leave it: the report queues on the phone (Outbox) and you can approve it once it lands. Move on to the next scene and come back. |
| Approve is missing on a submission | Make sure you are in tab 2 (Ngozi) for reports submitted by Musa or Engr. Obi; the person who submitted a report can't approve it. |
| The code PRG-110 is taken (second run) | Use PRG-111; nothing else depends on the code. Reseed after the demo. |
| The register import says a project ID already exists (second run) | The file was imported before: reseed, or skip Act 1a and show the projects it created last time. |
| Anything else | Switch to the seeded PRG-105 (mid-construction, findings, late sprint) and tell the same story there. |
