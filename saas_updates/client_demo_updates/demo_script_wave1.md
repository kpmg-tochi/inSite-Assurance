# Demo script: wave 1 (it looks and speaks like UBEC)

> **Superseded for the client demo by [demo_script.md](demo_script.md)** (30-minute walkthrough, 2026-11-26). Kept for the wave detail and recovery notes.

**Written:** 2026-11-25, before the wave 1 integration. **Not yet rehearsed.** Rehearse once on the overlay seed and fix this file where the screens differ.
**Length:** about 10 minutes of screens, plus the slides marked **[SLIDE]** (outline: [slides_outline.md](slides_outline.md)).
**Covers wave 1:** user switcher, map across six zones, LOT/BATCH codes, zone/State/LGA filters, new project, payments by period, the field visit. **Wave 4 add-on scenes** (approved list upload, visit calendar, payments Breakdown) are at the end: [Wave 4 scenes](#wave-4-scenes-add-on-2026-11-26). The full 45-minute story is [../demo_script_programme_delivery.md](../demo_script_programme_delivery.md) (older wording: read "sprint" as work phase, "Reports" as Monitoring).
**Logins and reseeding:** [demo_accounts.md](demo_accounts.md).

**Codes.** Project codes come from the overlay seed (`SEED_PROFILE=ubec-demo`); the table holds the codes it writes (the screen shows "LOT n BATCH m" with the intervention year beside it). Story numbers follow `working_plan.md` section 7.1.

| Story | Placeholder | Where | What it shows here |
| :--- | :--- | :--- | :--- |
| Demo 1, on track | LOT 1 BATCH 1 (2026) | FCT (North Central), Direct Intervention, 2026 | Payments by quarter; the live field visit |
| Demo 2, in trouble | LOT 4 BATCH 1 (2026) | Kano (North West), Matching Grants, 2026 | Alerts: Delayed, Monitoring overdue, Paid ahead of work done |
| Demo 3, closing out | LOT 2 BATCH 1 (2025) | Lagos (South West), Direct Intervention, 2025 | A 2025 project in the register; full payment history (fallback for payments) |
| Background 14 | LOT 1 BATCH 4 (2026) | Kaduna (North West), Direct Intervention, 2026 | Final payment before the CoC (payment exception) |
| Background 15 | LOT 1 BATCH 5 (2026) | Borno (North East), Direct Intervention, 2026 | Stalled |

---

## Before you start

| When | Do |
| :--- | :--- |
| Day before | Reseed: `cd server && SEED_PROFILE=ubec-demo npm run prisma:seed`. Check the codes the seed prints match the table above. Take a `pg_dump` snapshot ([demo_accounts.md](demo_accounts.md)). |
| Web | `VITE_DEMO_MODE=true` in `web/.env` (the switcher and its account list exist only in demo builds); restart the web dev server after changing it. Never in a production build. |
| 15 min before | Web signed in as the Executive Secretary on the Portfolio. Phone signed in as `resident.supervisor@ubec.test` (field app; the web refuses this account), on the same network as the API, mirrored on screen. |
| Rehearsal check | Is a routine visit on Demo 1 planned for today with the Resident Supervisor? If not, scene 4 moves one to today (allow 1 extra minute). |

Password for every login: `Password123!`.

---

## Scene 0. The process, before any screen (1 min) **[SLIDE]**

**[SLIDE 1–2]** Process map, Direct Intervention then Matching Grants.

> "This is your Project Cycle Manual: each step, who is responsible, the screen where it happens, and the deadline you set. Everything I show next sits on one of these rows."

---

## Scene 1. Executive Secretary: the programme at a glance (3 min)

**Login:** `es@ubec.test` (Executive Secretary).

**Show:**
1. **Portfolio** → **Overview**: the map. Pins across all six zones: North Central (FCT, Niger), North West (Kano, Kaduna, Sokoto), North East (Borno), South West (Lagos, Oyo, Ogun), South East (Enugu, Anambra), South South (Delta, live; Rivers, archived).
2. The register below the map: codes read **LOT n BATCH m** (e.g. Demo 1, LOT 1 BATCH 1), with the **Intervention year** column beside them. Point at LOT 1 BATCH 1 twice: Demo 1 (2026, FCT) and the Lagos project in its defects liability period (2025): the year column tells them apart.
3. Filters: **Zone** = North West → the register and the map narrow to Kano, Kaduna and Sokoto. **State** = Kano → Demo 2 and the imported Kano project. **LGA** = Dala → Demo 2 only. Clear the filters.
4. Demo 2 (LOT 4 BATCH 1, 2026): its alert chips (**Delayed**, **Stalled**, **Monitoring overdue**, **Paid ahead of work done**). Background 15 (LOT 1 BATCH 5, 2026) in Borno: **Stalled**.

**Say:**
> "This is the register you keep in Excel today, with your codes: LOT and BATCH, and the intervention year beside them, because LOT 5 BATCH 7 in 2025 and LOT 5 BATCH 7 in 2026 are different contracts.
>
> States and LGAs come from the national list, not typed in, so every report rolls up by zone, State and LGA without cleaning.
>
> And the platform raises the alarm itself: a project behind its work phases, a site with no monitoring report for two weeks, money paid ahead of the work done."

**[SLIDE 3]** 14 roles, while you open the user menu.

> "Instead of one administrator doing everything, each person signs in as themselves. For the demo I can switch between them in one click; a live installation has no such switch."

---

## Scene 2. Director, Physical Planning: a new project (2 min)

**Switch user** (user menu) → **Director, Physical Planning** (`dpp@ubec.test`).

**Show:**
1. Portfolio register → **New project**. Delivery model **Direct Intervention**.
2. **State**: a dropdown of the 36 States and FCT; pick FCT. The **Zone** fills in (North Central). **LGA**: only FCT's six area councils are offered.
3. **Intervention year**: only the current and next year are offered (2026 and 2027 if the demo is in 2026; the year follows UBEC's January–December fiscal year).
4. **Lot**: pick an existing lot of that year (e.g. "Renovation, Equipment and Furnishings of Public Schools"); the preview reads **"Will be LOT n BATCH m"**. Or start a new lot: the preview shows the next lot number.
5. **Funding source**: the dropdown (Matching Grant, Direct Intervention (Educational Imbalance Fund), Good Performance Fund, Special Needs Education Fund, Constituency Projects, Zonal Intervention Projects, North East Intervention, Development partner, Other). Pick **Direct Intervention**.
6. Create. The draft's code is assigned on creation and shows as **LOT n BATCH m**.

**Say:**
> "Nobody types a project code any more. The platform numbers lots in order within the year and batches within the lot, the way your 2025 register does. Two people creating projects at the same moment can't get the same code.
>
> The intervention year can only be this year or next: a project planned for 2023 today would be a mistake, or something to explain. Older projects come in through the register import."

Do not finish the draft. Leave it; the reseed removes it.

---

## Scene 3. Finance Officer: payments by period (2 min)

**Switch user** → **Finance Officer** (`finance@ubec.test`).

**Show:**
1. Demo 1 (LOT 1 BATCH 1, 2026) → **Payments**. Period filter → **This quarter**, then **Last quarter**: the list and totals follow. **Export to Excel**: the file has the same rows. (If a quarter is empty, use Demo 3 (LOT 2 BATCH 1, 2025), which has interim, final and retention release payments over 2025–2026.)
2. **Portfolio** → **Payments** tab. Default period: **this fiscal year**. Cards: gross paid, retention held, retention released, net paid, number of payments, payments with exceptions, paid against contract sum, paid against % complete.
3. Filter **Zone** = North West: the totals change. Point at the Background 14 (LOT 1 BATCH 4, 2026) payment flagged **Final payment before CoC**.
4. **Export to Excel** with the filters on screen.

**Say:**
> "Payments are made in your finance system; the platform records them against the contract and checks them. It holds retention, and it flags what shouldn't happen: a final payment before the Certificate of Completion, or more paid than the work verified on site.
>
> Finance can look at any quarter or the whole fiscal year, by zone, State or LGA, and take it to Excel in one click."

---

## Scene 4. M&E Officer and Resident Supervisor: the field visit (3 min)

**Switch user** → **M&E Officer** (`me.officer@ubec.test`).

**Show (web):** Demo 1 (LOT 1 BATCH 1) → **Monitoring** → **Visits**: the visit plan. If today's routine visit is not there, open the next proposed one → **Move or reassign** → today, officer the Resident Supervisor → **Publish**.

**Show (phone, `resident.supervisor@ubec.test`):**
1. Home: the project card shows **LOT n BATCH m**; today's visit on the calendar. Pull to refresh if it is missing.
2. Open the visit → **Confirm** → **Check in**: inside the school's boundary.
3. The form: answer a few questions, take two photos. Point at the camera hint: **"Photograph the works, not pupils."**
4. **Review** → **Submit**.

**Show (web, M&E Officer):** Demo 1 → **Monitoring** → the submitted **monitoring report**: answers, photos with time, location and the direction the camera faced, check-in inside the boundary → **Approve**. **BoQ & work phases**: progress follows the report.

**Say** (while the form is filled):
> "This is the Resident Supervisor's weekly report. Photos are taken in the app, never picked from the gallery, stamped with time, place and direction, and signed by the phone. No signal at the school? It waits on the phone and goes when it can.
>
> The officer who submits a report can never approve it. Only approved monitoring reports move the progress you saw on the map."

---

## Close (1 min) **[SLIDE]**

**[SLIDE 5, 7]** Security, then tamper evidence ("tamper-evident, not tamper-proof").
**[SLIDE 8]** What's next. Strike anything already shown.
**[SLIDE 9–10]** Questions for UBEC; write the answers into [demo_questions.md](demo_questions.md).

---

## If something goes wrong

| Problem | Recovery |
| :--- | :--- |
| No **Switch user** in the menu | The web build is not a demo build: set `VITE_DEMO_MODE=true` in `web/.env` and restart the web dev server. Meanwhile sign out and in with the logins in [demo_accounts.md](demo_accounts.md). |
| Codes show as `PRG-…` | The database has the normal seed, not the overlay. Restore the snapshot or reseed with `SEED_PROFILE=ubec-demo`. |
| A zone has no pin | Check the zone filter is cleared. South South has a live project in Delta (LOT 1 BATCH 2, 2026, Asaba) and the archived Rivers project; the map leaves archived projects out. |
| The intervention year offers other years | The server date or the fiscal year start month differs; say "this year and next" and move on. |
| The phone does not show the visit | Pull to refresh; check the visit was **published**, not only planned. |
| A photo won't upload | The report waits in the Outbox; approve it once it lands, or move on and come back. |
| Anything after the demo | Restore the `pg_dump` snapshot before the next rehearsal. |

---

## Wave 4 scenes (add-on, 2026-11-26)

**Written:** 2026-11-26, after the wave 4 build. **Not yet rehearsed.** Everything in this section is wave 4. Each scene stands alone: slot it after the wave 1 scene named, or show it on request. Uploading the list changes the database: restore the snapshot afterwards ([demo_accounts.md](demo_accounts.md)).

| Scene | Login | Slot after | Length |
| :--- | :--- | :--- | :--- |
| W4-A. Approved list upload | `dpp@ubec.test` (Director, Physical Planning) | Scene 2 | 2 min |
| W4-B. Visit calendar | `me.officer@ubec.test` (M&E Officer) | Scene 4 (web part) | 1 min |
| W4-C. Payments Breakdown | `finance@ubec.test` (Finance Officer) | Scene 3 | 2 min |

**Before you start:** the demo pack file `saas_updates/demo_pack/15 Approved list upload.xlsx` on the presenting laptop (`npm run demo:pack` in `server/` writes it). For the optional link, open it once before the demo and type `2027-LOT-1-BATCH-1` in row 1's **Project ID** (LEA Primary School, Bwari): save it as a second copy so both versions are at hand.

### W4-A. Director, Physical Planning: upload the approved list (2 min)

**Show:**
1. **Needs assessment**: the 2025 and 2026 lists (Direct Intervention schedule, BEAPs), Demo 2's budget mismatch. 2027 has no list yet.
2. **Upload approved list** → **Download template**: point at the Instructions sheet, the List sheet (year, kind, State for a BEAP) and the Rows sheet. Close it.
3. Choose `15 Approved list upload.xlsx`. **Check the approved list**: the 2027 Approved Projects & Implementation Schedule, 6 new rows (FCT, Kano ×2, Lagos, Borno, Sokoto), total ₦248,550,000. With the linked copy: row 1 links draft #11 (LOT 1 BATCH 1, 2027).
4. **Confirm**: the 2027 list opens with its rows' match status and "Uploaded <today> by Ifeoma Nwosu · <file>".

**Say:**
> "The Board approves the list once a year. You upload it as it is, in this template; the platform checks every row before anything is saved, and a file with one error is refused whole. Next year's revision updates the same list: rows are matched by their reference, so projects already linked stay linked.
>
> From then on every project is compared with its approved estimate, and a budget that drifts beyond 10% is flagged, as you saw on the Kano project."

Only the Director, Physical Planning and the System Administrator see the upload button; the Executive Secretary sees the lists.

### W4-B. M&E Officer: the monitoring calendar (1 min)

**Show:**
1. Demo 1 (LOT 1 BATCH 1, 2026) → **Monitoring** → **Visits** → **Calendar**: the month's visits, coloured and with an icon per status, legend below. **Week** for the detail; a busy day shows "+N more", which opens that week.
2. Click a visit: the same visit drawer as the list.
3. **Portfolio** → **Visits** (the planner) → **Calendar**: every visible project's visits on one month, with the planner's filters.

**Say:**
> "The same plan, as a calendar: who goes where this month, what was approved, what was missed. It reads the plan; changes are still made in the list, so nothing moves by accident."

### W4-C. Finance Officer: where the money went (2 min)

**Show:**
1. **Portfolio** → **Payments** (this fiscal year) → **Breakdown** → **Zone**: gross paid, retention and net per zone; the totals row equals the cards above.
2. Click **North West** → its States; click **Kano** → its LGAs. Demo 2 (LOT 4 BATCH 1) has schools in Dala, Gwale and Kano Municipal: its payments show under each LGA, marked "shared across LGAs"; the total still counts them once. Click an LGA → its projects; a project opens its payments page.
3. Clear the filters. In the payments list, **Group by** → **Quarter**: subtotal rows per quarter, covering every payment in the period, not only the page shown.
4. Breakdown back to **Zone** → **Export to Excel**: sheets Summary, **Breakdown** (by zone) and Payments.

**Say:**
> "Finance asked for one question answered: how much has gone to each zone, State and LGA this year. Any grouping, any period, and straight to Excel. A project with schools in three LGAs is shown in each, and flagged, so the LGA figures add up honestly."

### Wave 4 recovery

| Problem | Recovery |
| :--- | :--- |
| No **Upload approved list** button | Signed in as someone without `approved_lists:manage`; switch to the Director, Physical Planning. |
| The check step shows the 2027 rows as unchanged | The list was uploaded in an earlier rehearsal: restore the snapshot. Meanwhile say "uploading the same list again changes nothing". |
| Row 1 says the project was not found | The database has the normal seed (no `2027-LOT-1-BATCH-1`) or the code was mistyped; upload the copy with Project ID blank. |
| The calendar month is empty | Go to the next month (Demo 1's routine visits are weekly from the seed day). |
| Breakdown shows no LGA rows under Kano | The period filter excludes Demo 2's payments (70 and 20 days before the seed day); set the period to **All time**. |

## Words to use (glossary)

Work phase (not sprint) · Execution (not construction stage) · Zone / State (not region) · Project cycle · Monitoring, monitoring report · Follow-up check · Rectified · Mobilised to site · Defects liability period · Monitoring overdue · Paid ahead of work done · Project closure file · Certificate of Completion (CoC). Full list: `working_plan.md` section 8.
