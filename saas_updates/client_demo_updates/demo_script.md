# Demo script: 30-minute walkthrough

**Written:** 2026-11-26, after wave 4 and the pre-demo fixes. **Updated:** 2026-11-27 for needs pipeline wave 5: new opening act 0 "From need to project"; scene 3 no longer uploads a needs assessment (the D1 upload was removed in needs pipeline wave 4) and works on the draft act 0 creates; file 15 is now a 2024 list. **Not yet rehearsed (owed):** do one full run on the overlay seed, act 0 included, and correct this file where the screens differ.
**Format:** an interactive walkthrough, not a pitch. Each scene is a click path plus the few points worth saying; stop for questions whenever they come. About 30 minutes of screens with act 0; in a 30-minute slot cut as below to leave room for questions.
**Replaces** [demo_script_wave1.md](demo_script_wave1.md) for the client demo (keep it for its recovery notes and the wave 4 scene detail). Logins, permissions and reseeding: [demo_accounts.md](demo_accounts.md). Open questions to ask UBEC: [demo_questions.md](demo_questions.md).

## Running order

| # | Scene | Who (login) | Min |
| :--- | :--- | :--- | ---: |
| 0 | From need to project | Director, Physical Planning (`dpp@`), Procurement Officer (`procurement@`), M&E Officer (`me.officer@`, web and phone), Finance Officer (`finance@`) | 9 |
| 1 | The programme at a glance | Executive Secretary (`es@`) | 3 |
| 2 | Approved lists and the budget check | Director, Physical Planning | 2 |
| 3 | The converted draft: sites and contractor | Director, Physical Planning | 2 |
| 4 | Contractors and a performance flag | Director, Physical Planning | 3 |
| 5 | A monitoring visit, web and phone | M&E Officer + Resident Supervisor (phone) | 6 |
| 6 | Payments across the programme | Finance Officer | 3 |
| 7 | Completion and closure | Executive Secretary | 2 |
| | **Total** | | **30** |

If time runs short, cut in this order: scene 7, the Kano step of act 0 (0.7), the upload in scene 2, scene 3, the batch upload in act 0 (0.2).

**Projects used** (codes show as "LOT n BATCH m" with the intervention year beside them):

| Name in this script | Code | Where | Why it is used |
| :--- | :--- | :--- | :--- |
| Dawakin Tofa | Proposed project `2027-DI-001`; after act 0 a draft, then **LOT n BATCH 1 (2027)** | Kano, Direct Intervention, 3 schools in 2 LGAs | Waits at Funding in the open 2027 cycle; appropriated live in act 0 |
| Argungu | Proposed project `2027-DI-006` | Kebbi, Direct Intervention, one school | At Validation with an open essential-facility gap; the M&E officer's field verification (act 0) |
| Demo 1 | LOT 1 BATCH 1 (2026) | FCT, Direct Intervention | On track; today's monitoring visit |
| Demo 2 | LOT 4 BATCH 1 (2026) | Kano, Matching Grants, 6 schools in 3 LGAs | In trouble: behind, alerts, contractor flagged, budget +17% over the approved BEAP |
| Demo 3 | LOT 2 BATCH 1 (2025) | Lagos, Direct Intervention | At the end of its defects liability period, ready to close |

---

## Before you start

| When | Do |
| :--- | :--- |
| Once | The demo database needs the needs pipeline migrations of waves 2–5 (not yet applied there): stop the API, `cd server && npx prisma migrate deploy`, then reseed. |
| Day before | Reseed: `cd server && SEED_PROFILE=ubec-demo npm run prisma:seed`. Take a `pg_dump` snapshot ([demo_accounts.md](demo_accounts.md)). Dates are relative to the seed day, so reseed no earlier than the day before. |
| Day before | Rebuild the demo pack the same day as the seed: `cd server && npm run demo:pack`. Both take the open year (2027) from the run day, and file 16 names the seeded references. |
| Day before | Rehearse once end to end, then restore the snapshot. |
| Laptop | Web demo build (`VITE_DEMO_MODE=true` in `web/.env`): the user menu has **Switch user**. Files at hand in `saas_updates/demo_pack/`: `16 Appropriated schedule 2027.xlsx`, the five `18 Batch …` files and `17 Needs assessment, Kumo and Akko schools.xlsx` (act 0), `15 Approved list upload.xlsx` (scene 2). |
| Phone | Field app demo build (`EXPO_PUBLIC_DEMO_MODE=true`): the sign-in screen lists **Demo accounts**. Same network as the API; mirrored on screen; location on (act 0 records the phone's position). |
| 15 min before | Web signed in as the Director, Physical Planning on **Needs assessment**, cycle "Direct Intervention 2027". Phone signed in as **Ngozi Eze, M&E Officer**: pull down on Home and check the site verification of `2027-DI-006` shows on its due date (3 days after the seed day), then open it once so its form downloads. Check Demo 1 has a routine monitoring visit today for the Resident Supervisor (Monitoring → Calendar, today). |

Password for every login: `Password123!`. Switch people with **Switch user** in the user menu (one click; a live installation has no such menu). **The Procurement Officer is not in Switch user:** sign out and sign in as `procurement@ubec.test`, then use Switch user again for the others.

---

## 0. From need to project (9 min)

The platform starts where the project starts: the annual needs assessment. The open cycle is the 2027 Direct Intervention cycle (it runs in 2026), seeded with proposed projects at every stage.

### 0.1 The cycle at a glance (2 min)

**Director, Physical Planning** (`dpp@ubec.test`, process owner).

1. **Needs assessment** → cycle picker **Intervention year 2027 · Direct Intervention**. The facts row (Open, owner UBEC HQ, number of proposed projects, costing standard version, template) and the **deadline strip**: Identification 30 May … Approval 31 Oct, each with its state.
2. **Proposed projects** (switch off "Waiting for me" if the list is short): one row per proposed project with stage, status and flags. Point at:
   - `2027-DI-006` (Kebbi): **essential facilities** flag, no water at the school; `2027-DI-007`: **possible duplicate** of 006 (same school).
   - `2027-DI-010` (Adamawa) at Costing: **rate variance**, desks 30 % above the costing standard.
   - `2027-DI-008` returned by the M&E officer; `2027-DI-012` not validated (the State already renovated the school); `2027-DI-009` at Design; `2027-DI-011` still a draft.
   - `2027-DI-013` (Kogi storm damage): out of cycle, waiting for the Executive Secretary.
3. **Prioritisation**: the Steering Committee's finalised ranking, the **funding line** under rank 4 (the ceiling), `2027-DI-005` below it. On `2027-DI-003` the **divergence** mark: two members scored one criterion 2 points apart; open it to show the min and max.
4. **Approvals**: the Prioritised Project Portfolio approved by Management review and the Executive Secretary, memo attached; `2027-DI-004` excluded at approval ("Not funded, carried forward").

**Points to make**
- One place for the whole cycle, with your calendar: who has to act and by when.
- Flags are rules the platform runs on every upload (duplicates within 100 m, toilets / water / solar at every school, rates against the costing standard, cost ceilings); a person resolves each one with a reason.
- Scores are independent: a member sees no one else's score until the chair finalises.

### 0.2 Proposed projects arrive (1.5 min)

**Sign out → sign in as Procurement Officer** (`procurement@ubec.test`, Zainab Abdullahi).

1. **Proposed projects → Upload needs assessments** → select the five `18 Batch …` files together → **Check 5 files**.
2. The check: four valid (Taraba, Jigawa, Osun, Edo; each with sites, facilities, costs and any flags it will raise) and **18 Batch 4 (row errors)** refused, with sheet, row, column and reason for each error (an intervention action not on the list, a missing proposed quantity, a facility not in the catalogue).
3. **Save 4 valid files**: four new references at Identification.

Short of time: upload `17 Needs assessment, Kumo and Akko schools.xlsx` alone instead (one proposed project, two schools in Gombe, no flags).

**Points to make**
- The States' and directorates' needs assessments arrive in one template; a file with errors is refused with exactly what to fix, the others go in.
- Nobody retypes the file: sites, facilities and costs are read from it.

### 0.3 Field verification on the phone (2 min)

**Phone:** **Ngozi Eze, M&E Officer** (already signed in).

1. Home: the calendar dot on the due date → **Site verification · 2027-DI-006**. Open it: the proposed project, the instructions, the school site.
2. **Record location here** at the school: the phone shows the accuracy and the distance from the location in the needs assessment.
3. The form: "The school is at this site" Yes, two photos of the school; then one block per facility row: existing quantity counted, condition, "Matches the needs assessment", one photo.
4. **Review and submit → Submit site verification**.

**Points to make**
- The officer stands at the school: the location and every photo carry GPS, time and direction, taken in the app.
- No signal in the field: it waits on the phone and sends itself later.

### 0.4 Accept it on the web (1.5 min)

**Switch user → M&E Officer** (`me.officer@ubec.test`; in Direct Intervention the M&E officer verifies and validates).

1. Needs assessment → `2027-DI-006` → **Validation** tab → **Field verification** card: "Waiting for review" → **Review**.
2. The drawer: the recorded location against the stored one with the distance ("Acceptance moves the site…"); each facility row, needs assessment against what was counted, rows that differ outlined; the photos.
3. **Accept** with "Correct the site coordinates" ticked: the drawer lists the site moved (from → to, distance). The photos are filed as documents of the proposed project.
4. In the validation record: **Use the field verification**: method "Field app visit", date, officer and photos filled in. Write the desk review and the justification for the missing water (the community's hand pump); save. Do not decide: the stage decision stays with the validator.

Because the phone is in the meeting room, not at the school, the site moves to the room: say "in the field this is the few metres between the file's point and the school gate". The snapshot restore undoes it.

### 0.5 The appropriation (1 min)

**Switch user → Finance Officer** (`finance@ubec.test`).

1. Cycle Direct Intervention 2027 → **Funding** tab → **Import appropriated schedule** → `16 Appropriated schedule 2027.xlsx`.
2. The preview: `2027-DI-001` and `-002` funded at their approved amounts, `2027-DI-003` **partly funded** at 90 %. Enter the appropriation date → **Confirm**.
3. The result: three **draft projects**, origin "Needs pipeline", each with its sites, units and BoQ from its needs assessment; the "2027 Appropriated schedule" approved list is written with each row linked.

### 0.6 Into a lot (1 min)

**Sign out → sign in as Procurement Officer** (`procurement@ubec.test`).

1. **Procurement plan** tab → tick the Dawakin Tofa draft → **Assign to a lot** → new lot "Provision of Water, Sanitation and Hygiene (WASH) Facilities in Public Schools" → its code becomes **LOT n BATCH 1** (2027).
2. Open the draft → **Overview**: the **Origin** card (reference `2027-DI-001` linked, approved and funded amounts, rank, needs assessment versions). Its three schools, units and BoQ are already there (scene 3).

**Points to make**
- The proposed project becomes the project: no second entry, and the project keeps its history (versions, validation, scores, approval) one click away.
- A partly funded project is created at the amount appropriated.

### 0.7 Kano: the State's side (optional, 1 min)

**Switch user → Director, Physical Planning.**

1. Cycle picker → **Matching Grants · Kano**. **BEAP** tab: Kano SUBEB's Budget and Expenditure Action Plan, submitted, in **UBEC Physical Planning review** (dpp@'s step): its items `2027-MG-KN-001` and `-002` with lot, method, dates and a **Site visit** column (UBEC can send its own officer before approving). Do not approve live (it creates the drafts).
2. `2027-MG-KN-003` at Field verification: assigned to Kano's Director, Physical Planning, who verifies on the phone (Demo accounts → **Kabiru Sule**, if time allows).

**Points to make**
- Matching Grants run per State, owned by the SUBEB; UBEC gatekeeps at the BEAP.
- The same field verification serves the SUBEB's validation and UBEC's BEAP review.

---

## 1. The programme at a glance (3 min)

**Switch user → Executive Secretary** (`es@ubec.test`).

1. **Portfolio → Overview.** The four figures: total commitment (contract sums, the budget where a project is not yet contracted), progress, ongoing projects, behind schedule.
2. **The map:** one pin per school, across all six zones. Click a Kano pin: school, LGA, % complete, status.
3. **The register** below the map: codes **LOT n BATCH m** with the **Intervention year** column; **Contract sum**; Stage; alert chips. Expand Demo 2's row: its six schools, two of them **Behind**.
4. Filters **Zone** North West → **State** Kano → **LGA** Dala: the map and register follow. Clear them.
5. Open **Demo 2** → Overview: the stage bar (Execution), the alert chips (**Delayed**, **Monitoring overdue**, **Paid ahead of work done**), the contractor card with its **flag**, the approved-list card with the **budget mismatch**.

**Points to make**
- The register is the one you keep in Excel, with your codes. The year column matters: LOT 1 BATCH 1 exists in 2025 and in 2026.
- States and LGAs come from the national list, not typed in, so everything rolls up by zone, State and LGA.
- The alerts are rules, raised by the platform itself: behind its work phases, no monitoring report for 14 days, paid ahead of the work verified.

---

## 2. Approved lists and the budget check (2 min)

**Switch user → Director, Physical Planning** (`dpp@ubec.test`).

1. **Needs assessment → Approved lists** tab: the 2026 Approved Projects & Implementation Schedule and the approved BEAPs per State; each row with its linked project and match status. Demo 2: **Budget ₦84.0m vs approved BEAP ₦71.5m (+17%)**. The **2027 Appropriated schedule** from act 0 is there too, written by the appropriation, each row linked to its draft.
2. Optional: **Upload approved list** → choose `15 Approved list upload.xlsx` (the **2024** schedule, a past year). The check step: 6 new rows, ₦248.55m, no errors. **Import**: the 2024 list opens with "Uploaded today by Ifeoma Nwosu".

**Points to make**
- From 2027 the approved list is written by the appropriation itself; earlier years' lists come in by upload, checked row by row (a file with one error is refused whole).
- Every project is compared with its approved estimate; beyond ±10% it is flagged.
- Only the Director, Physical Planning and the System Administrator can upload; the Executive Secretary sees the lists.

---

## 3. The converted draft: sites and contractor (2 min)

Still **Director, Physical Planning**. Open the Dawakin Tofa draft (LOT n BATCH 1 (2027)) from act 0.

1. Setup step **Project → Sites**: the three schools came from the needs assessment (with the coordinates the needs assessment, or an accepted field verification, gave). On one site, **Find address**: the pin and boundary appear; drag the pin if the match says "Town only".
2. Setup step **Contract → Contractor**: the picker shows each contractor's stars and number of reports. Mention **New contractor** (it starts Inactive until the signed contract is on file) without creating one.
3. Leave the draft (the snapshot restore removes it).

**Points to make**
- The needs assessment became the project: schools, units and BoQ, no retyping; only the work phases, the contractor and the team are added here.
- The project code is assigned by the platform in order within the lot; nobody types codes.
- The address lookup sends only the address to Google, and the officer still places the pin. Rural schools often resolve to the town only.

---

## 4. Contractors and a performance flag (3 min)

Still **Director, Physical Planning**.

1. **Contractors** (sidebar): ten contractors with star ratings, report counts and status. Filter **Flagged**.
2. Open **Sahel Build & Civil Works Ltd**: the rating breakdown (workmanship, work phases met, findings, mobilisation), its projects, and the **flag**: five monitoring reports rating workmanship 3 or below within 60 days, each listed as evidence.
3. **Decide** → **Payment hold** with a short reason → recorded and in effect at once. Point at the other options: additional monitoring visits, formal warning, and the heavier actions (deduction, stop-work, replacement, suspension) that go to Legal review.

**Points to make**
- The rating is computed from the monitoring reports, not entered by anyone.
- The flag is a rule (three poor reports in 60 days by default); the decision stays with a person and is recorded.
- The hold you just set appears in Finance's view in scene 6.

---

## 5. A monitoring visit, web and phone (6 min)

**Switch user → M&E Officer** (`me.officer@ubec.test`).

1. **Demo 1 → Monitoring → Monitoring visits.** The plan as a list, then **Calendar** (month and week; colour and icon per status). Today's routine monitoring visit for the Resident Supervisor. If it is only proposed: open it → **Publish**.

**Phone:** sign-in screen → **Demo accounts → Musa Danladi, Resident Supervisor** (one tap).

2. Home: today's monitoring visit on Demo 1 (pull to refresh if missing). Open it → **Confirm** → **Check in** (inside the school's boundary).
3. The form: answer a few questions, take two photos. Point at the camera hint **"Photograph the works, not pupils."**
4. **Review → Submit.**

**Web (M&E Officer):**

5. Demo 1 → Monitoring → the visit: the **monitoring report** with answers and photos (time, place, direction the camera faced), check-in inside the boundary → **Approve**.
6. **BoQ & work phases:** % complete per unit and line, and the project's total, follow the approved report.

**Points to make**
- Photos are taken in the app, never picked from the gallery, and stamped and signed by the phone.
- No signal at the school: the report waits on the phone and sends itself later.
- The person who submits a report can never approve it, and only approved reports move progress.

---

## 6. Payments across the programme (3 min)

**Switch user → Finance Officer** (`finance@ubec.test`).

1. **Demo 2 → Payments:** the **payment hold** banner from scene 4. Open **Record payment**: an interim payment now needs an override reason and would be flagged "Paid during hold". Cancel.
2. **Portfolio → Payments** (this fiscal year): the cards (gross, retention held and released, net, exceptions, paid against contract sum and against % complete).
3. **Breakdown → Zone** → click **North West** → **Kano** → its LGAs: Demo 2 appears under Dala, Gwale and Kano Municipal, marked "shared across LGAs", counted once in the total. **‹ Back** returns a level.
4. Payments list → **Group by → Quarter**: subtotal rows. **Export to Excel**: Summary, Breakdown and Payments sheets.

**Points to make**
- Payments are made in your finance system; the platform records them against the contract, holds retention and flags what should not happen (final payment before the CoC, paid during a hold, above the contract sum).
- Any period, any grouping, straight to Excel.

---

## 7. Completion and closure (2 min)

**Switch user → Executive Secretary.**

1. **Demo 3 → Project overview:** the stage bar at **Project closure · Defects liability period**.
2. **Completion & handover:** the **Certificate** tab (signatories, signed PDF), **Handover** (accepted, certificate issued), **Project closure** tab: the checklist with its automatic and manual items.
3. **Project closure file:** export it (index, documents, certificates, monitoring visit summaries, audit trail with its chain check).

**Points to make**
- The project cannot close until the checklist and the defects liability period allow it; the audit sign-off cannot be waived.
- The closure file is the whole history in one download, with a verifiable audit trail.

---

## After the demo

Restore the snapshot before any rehearsal or second run (the needs assessment uploads, the field verification and the moved site, the appropriation and its three drafts, the lot, the approved list upload, the payment hold and the approved report all change the data; the appropriation can be imported only once per cycle).

## If something goes wrong

| Problem | Recovery |
| :--- | :--- |
| No **Switch user** in the menu | Not a demo build: sign out and in with the logins in [demo_accounts.md](demo_accounts.md) |
| No **Demo accounts** on the phone | Not a demo build of the field app: sign in as `resident.supervisor@ubec.test` / `Password123!` |
| Codes show as `PRG-…` | The database has the normal seed: restore the snapshot |
| No 2027 cycle on the Needs assessment page, or file 16 refused for unknown references | The seed or the demo pack was built on another day (the open year and the references follow the run day): rebuild the pack the day of the seed, or reseed |
| The appropriation import is refused as already done | It was imported in a rehearsal (once per cycle): restore the snapshot |
| The batch upload says a file is "already uploaded" | Uploaded in a rehearsal: restore the snapshot, or upload file 17 instead |
| Procurement Officer not in **Switch user** | Expected: sign out and sign in as `procurement@ubec.test` |
| The phone does not show the site verification of 2027-DI-006 | Pull down on Home; it sits on its due date (3 days after the seed day), not today: tap that day. Still missing: the M&E Officer must be signed in on the phone, and the verification still Assigned on the web (Validation tab of 2027-DI-006) |
| "Form not on this phone" | Online: tap **Download the form**. Offline: it was never opened online; reconnect |
| Accept refused with a separation-of-duties message | The accepting login uploaded a version of the proposal: accept as `me.officer@`, who did not |
| The 2024 list shows as unchanged on upload | It was uploaded in a rehearsal: restore the snapshot, or say "uploading the same list again changes nothing" and move on |
| **Find address** missing | No Google key on the server: paste a Google Maps link or type the coordinates instead |
| Find address returns another school | Expected with generic names (Google has few LGEA schools): drag the pin to the right place |
| The phone does not show today's visit | Pull to refresh; check it was **published** on the web |
| A photo does not upload | The report waits in the Outbox; approve it once it lands, or move on and come back |
| Breakdown shows no Kano LGAs | Set the period to **All time** |

## Words to use

Needs assessment cycle · Proposed project · Site verification (field verification) · Steering Committee · Funding line · Prioritised Project Portfolio · Appropriation · BEAP · Monitoring visit · Monitoring report · Work phase · Execution · Zone / State · Project cycle · Follow-up check · Rectified · Mobilised to site · Defects liability period · Monitoring overdue · Paid ahead of work done · Project closure file · Certificate of Completion (CoC). Full list: `working_plan.md` section 8.
