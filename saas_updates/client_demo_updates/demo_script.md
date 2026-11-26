# Demo script: 30-minute walkthrough

**Written:** 2026-11-26, after wave 4 and the pre-demo fixes. **Not yet rehearsed:** do one full run on the overlay seed and correct this file where the screens differ.
**Format:** an interactive walkthrough, not a pitch. Each scene is a click path plus the few points worth saying; stop for questions whenever they come. About 26 minutes of screens, leaving room for questions inside the 30.
**Replaces** [demo_script_wave1.md](demo_script_wave1.md) for the client demo (keep it for its recovery notes and the wave 4 scene detail). Logins, permissions and reseeding: [demo_accounts.md](demo_accounts.md). Open questions to ask UBEC: [demo_questions.md](demo_questions.md).

## Running order

| # | Scene | Who (login) | Min |
| :--- | :--- | :--- | ---: |
| 1 | The programme at a glance | Executive Secretary (`es@`) | 4 |
| 2 | Approved lists and the budget check | Director, Physical Planning (`dpp@`) | 3 |
| 3 | A new project from the needs assessment | Director, Physical Planning | 4 |
| 4 | Contractors and a performance flag | Director, Physical Planning | 3 |
| 5 | A monitoring visit, web and phone | M&E Officer (`me.officer@`) + Resident Supervisor (phone) | 6 |
| 6 | Payments across the programme | Finance Officer (`finance@`) | 4 |
| 7 | Completion and closure | Executive Secretary | 2 |
| | **Total** | | **26** |

If time runs short, cut in this order: scene 7, the upload in scene 2, the contractor creation in scene 3.

**Projects used** (codes show as "LOT n BATCH m" with the intervention year beside them):

| Name in this script | Code | Where | Why it is used |
| :--- | :--- | :--- | :--- |
| Demo 1 | LOT 1 BATCH 1 (2026) | FCT, Direct Intervention | On track; today's monitoring visit |
| Demo 2 | LOT 4 BATCH 1 (2026) | Kano, Matching Grants, 6 schools in 3 LGAs | In trouble: behind, alerts, contractor flagged, budget +17% over the approved BEAP |
| Demo 3 | LOT 2 BATCH 1 (2025) | Lagos, Direct Intervention | At the end of its defects liability period, ready to close |

---

## Before you start

| When | Do |
| :--- | :--- |
| Day before | Reseed: `cd server && SEED_PROFILE=ubec-demo npm run prisma:seed`. Take a `pg_dump` snapshot ([demo_accounts.md](demo_accounts.md)). Dates are relative to the seed day, so reseed no earlier than the day before. |
| Day before | Rehearse once end to end, then restore the snapshot. |
| Laptop | Web demo build (`VITE_DEMO_MODE=true` in `web/.env`): the user menu has **Switch user**. Files at hand: `saas_updates/demo_pack/15 Approved list upload.xlsx` and `saas_updates/demo_pack/Dawakin Tofa needs assessment.xlsx`. |
| Phone | Field app demo build (`EXPO_PUBLIC_DEMO_MODE=true`): the sign-in screen lists **Demo accounts**. Same network as the API; mirrored on screen. |
| 15 min before | Web signed in as the Executive Secretary on **Portfolio**. Phone on the sign-in screen. Check Demo 1 has a routine monitoring visit today for the Resident Supervisor (Monitoring → Calendar, today). |

Password for every login: `Password123!`. Switch people with **Switch user** in the user menu (one click; a live installation has no such menu).

---

## 1. The programme at a glance (4 min)

**Executive Secretary** (`es@ubec.test`).

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

## 2. Approved lists and the budget check (3 min)

**Switch user → Director, Physical Planning** (`dpp@ubec.test`).

1. **Needs assessment** (sidebar): the 2026 Approved Projects & Implementation Schedule and the approved BEAPs per State; each row with its linked project and match status. Demo 2: **Budget ₦84.0m vs approved BEAP ₦71.5m (+17%)**.
2. **Upload approved list** → choose `15 Approved list upload.xlsx` (the 2027 schedule). The check step: 6 new rows, ₦248.55m, no errors. **Import**: the 2027 list opens with "Uploaded today by Ifeoma Nwosu".

**Points to make**
- The approved list is uploaded once a year in a template; every row is checked first and a file with one error is refused whole.
- Every project is compared with its approved estimate; beyond ±10% it is flagged.
- Only the Director, Physical Planning and the System Administrator can upload; the Executive Secretary sees the lists.

---

## 3. A new project from the needs assessment (4 min)

Still **Director, Physical Planning**.

1. **Portfolio → New project → Upload needs assessment** → `Dawakin Tofa needs assessment.xlsx`. The check: every field the file gives (name, Direct Intervention, State Kano, LGAs, funding, budget), 3 schools in 2 LGAs, the work phases, units and BoQ lines, and the code it will get (**LOT n BATCH 1**). **Create draft**.
2. Setup step **Project → Sites**: the three schools. On one site, **Find address**: the pin and boundary appear; drag the pin if the match says "Town only".
3. Setup step **Contract → Contractor**: the picker shows each contractor's stars and number of reports. Mention **New contractor** (it starts Inactive until the signed contract is on file) without creating one.
4. Leave the draft (the snapshot restore removes it).

**Points to make**
- The needs assessment you already prepare becomes the project: schools, BoQ and work phases in one upload, no retyping.
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

## 6. Payments across the programme (4 min)

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

Restore the snapshot before any rehearsal or second run (the upload, the draft, the payment hold and the approved report all change the data).

## If something goes wrong

| Problem | Recovery |
| :--- | :--- |
| No **Switch user** in the menu | Not a demo build: sign out and in with the logins in [demo_accounts.md](demo_accounts.md) |
| No **Demo accounts** on the phone | Not a demo build of the field app: sign in as `resident.supervisor@ubec.test` / `Password123!` |
| Codes show as `PRG-…` | The database has the normal seed: restore the snapshot |
| The 2027 list shows as unchanged on upload | It was uploaded in a rehearsal: restore the snapshot, or say "uploading the same list again changes nothing" and move on |
| **Find address** missing | No Google key on the server: paste a Google Maps link or type the coordinates instead |
| Find address returns another school | Expected with generic names (Google has few LGEA schools): drag the pin to the right place |
| The phone does not show today's visit | Pull to refresh; check it was **published** on the web |
| A photo does not upload | The report waits in the Outbox; approve it once it lands, or move on and come back |
| Breakdown shows no Kano LGAs | Set the period to **All time** |

## Words to use

Monitoring visit · Monitoring report · Work phase · Execution · Zone / State · Project cycle · Follow-up check · Rectified · Mobilised to site · Defects liability period · Monitoring overdue · Paid ahead of work done · Project closure file · Certificate of Completion (CoC). Full list: `working_plan.md` section 8.
