# UBEC demo pack

Files the presenter uses during the live Direct Intervention demo. Regenerate them **on the demo day** (dates are relative to the day the script runs):

```bash
cd server
npm run demo:pack            # or: npm run demo:pack -- 2026-12-01 to build for another day
```

The script overwrites the `.xlsx` and `.pdf` files here (this README is kept). It needs no database. It reads every workbook back with the real parser and fails if one would not import cleanly (the one batch file built with row errors must read back with them). Every PDF is a specimen with a "SPECIMEN – demo data" footer.

**Needs pipeline (wave 5, 2026-11-27): the demo now starts from the need.** The live project is no longer created by hand: it is the seeded proposed project **Y-DI-001** "WASH upgrade, Government Primary School Dawakin Tofa" (Y = the year after the run day, e.g. 2027), waiting at Funding in the open Direct Intervention cycle with Y-DI-002 and Y-DI-003 (normal seed and overlay, `server/src/db/seedNeedsPipeline.ts`). Finance imports file 16 and the three become draft projects with their sites, units and BoQ from the needs assessment; Procurement puts the demo project in a lot; the rest of the walk is unchanged from step 2 (setup, documents 01–03, activation). The D1 file `Dawakin Tofa needs assessment.xlsx` left the pack in wave 4 (still in git history). The demo pack must be built on the same day as the seed's year (both take Y from the run day).

## Files and when to use them

| File | When in the demo | Where in the app |
| :--- | :--- | :--- |
| `01 Letter of award.pdf` | Setup step 2 (drafts accept documents) or after activation | Documents → **Add document**, type Award letter |
| `02 Acceptance of award.pdf` | Same; then complete the "Acceptance letter received" milestone | Documents, type Acceptance letter, contractor Kurmi |
| `03 Contract agreement.pdf` | Same. A contractor created with **New contractor** is Inactive until this is on file: uploading it makes Kurmi Active | Documents, type Signed contract |
| `04 Kick-off agenda and briefing pack.pdf` | Scheduling the kick-off | Kick-off & mobilisation → Kick-off → **Briefing pack (sent with the notice)** → Upload new |
| `05 Kick-off meeting minutes.pdf` | Recording the kick-off as held; then sign off as the admin and as `me.officer@` | Kick-off → **Record the meeting as held** → Minutes; Documents → **Sign off** |
| `06 Letter of introduction to the Head Teacher.pdf` | After the kick-off | Documents, type Letter of introduction |
| `07 Resident Supervisor assignment.pdf` | After the kick-off | Documents, type Supervisor assignment |
| `08 Mobilisation agreement (PPE clause).pdf` | After the kick-off; sign off. Its PPE clause is what the inspector's finding pays off | Documents, type Mobilisation agreement, contractor Kurmi |
| `09 Site possession form.pdf` | After the kick-off; sign off | Documents, type Site possession form, contractor Kurmi |
| `10 Programme of works.pdf` | Optional; signing it off completes "Programme accepted" milestones | Documents, type Programme of works |
| `11 Mobilisation plan.pdf` | Optional | Documents, type Mobilisation plan |
| `12 Certificate of Completion - signed paper copy.pdf` | Completion: the beneficiary's slot (live project or PRG-104) | Completion & handover → Certificate → **Record signed copy** |
| `13 Closeout report.pdf` | Closure: before archiving (PRG-106 or the live project) | Completion & handover → Closure → **Upload closeout report** |
| `14 Project register import.xlsx` | Bringing the existing register in (any time; independent of PRG-110) | Portfolio → projects table → **Import projects** → choose the file → preview → **Import** |
| `15 Approved list upload.xlsx` | Uploading an approved list of a **past** year (any time; `approved_lists:manage`: System Administrator, Director, Physical Planning) | Needs assessment → **Upload approved list** → choose the file → check → **Confirm**. The **2024** Approved Projects & Implementation Schedule (Executive Secretary, UBEC, approved 2023-10-16): 6 rows in FCT, Kano, Lagos, Borno and Sokoto, NGN 248,550,000; a new list on both databases (the seeded lists are 2025 and 2026). Project ID is blank. Wave 5 moved it from 2027 to 2024 (D-N.12): the open year's list is written by the appropriation (file 16), and an upload can neither create it first (the import is then refused, 409 NEEDS_APPROVED_LIST_EXISTS) nor replace it afterwards. Uploading it again with a changed estimate updates the list in place |
| `16 Appropriated schedule Y.xlsx` | **Opening act**, as `finance@`: the appropriation | Needs assessment → cycle "Direct Intervention Y" → **Funding** tab → (optional: record the budget submission) → **Import appropriated schedule** → choose the file → preview (3 rows: Y-DI-001 and -002 funded at their approved amounts, Y-DI-003 partly funded at 90 %) → appropriation date → **Confirm**. Three draft projects are created (origin "Needs pipeline"); the approved list "Y Appropriated schedule" is written with each row linked. Then as `procurement@`: **Procurement plan** tab → select the Dawakin Tofa draft → new lot "Provision of Water, Sanitation and Hygiene (WASH) Facilities in Public Schools" → its code becomes `LOT n BATCH 1`. Once only per cycle |
| `17 Needs assessment, Kumo and Akko schools.xlsx` | Optional, as `procurement@`: a new proposed project | Needs assessment → open Direct Intervention cycle → **Upload needs assessments** → the file → preview → **Confirm**: created as the next reference at Identification (two schools in Akko LGA, Gombe; no flags) |
| `18 Batch 1 … 18 Batch 5` | Optional, as `procurement@`: several files at once | Same dialog, the five files together: four are created (Taraba, Jigawa, Osun, Edo; two with a BoQ, two with preliminary costs only) and **18 Batch 4 (row errors)** is refused with its row, column and reason (an intervention action not on the list, a missing proposed quantity, a facility not in the catalogue). Nothing in the batch duplicates a seeded proposal |

## The demo project's needs assessment (seeded proposal Y-DI-001)

The seed uploads it as a template v2 file (Identification, by `procurement@`), and it goes through the whole cycle: validation by `me.officer@` (the water gap at school 1 justified), costing by `qs@` (the per-unit cost ceilings acknowledged), the Steering Committee (ranked 1st), the portfolio approved by `dpp@` and `es@`. Its sites, units and BoQ are the ones below (`DEMO_SITES`, `DEMO_UNITS`, `DEMO_LINES` in `server/src/scripts/demoProject.ts`), plus existing facilities in working order recorded without work (no unit). Approved amount NGN 48,702,500 (BoQ NGN 44,275,000 + 5 % supervision and monitoring + 5 % contingency). After the appropriation the presenter sets the two work phases on the Sprints & scope page (dates below) and places T1, BH1 and SP1 in them; the project's own site boundary (setup, Location) is drawn on school 1.

The previous D1 workbook held the same content; its description follows for reference. Project sheet: name, school "Government Primary School, Dawakin Tofa", region Kano, **State** Kano, LGA Dawakin Tofa, site address, GPS 12.1006, 8.3354 (approximate, demo only; the import draws a 150 m radial boundary on it), delivery model Direct Intervention, **Lot title** "Provision of Water, Sanitation and Hygiene (WASH) Facilities in Public Schools", budget NGN 48,500,000, **intervention year** = the year of the run day (so the file never ages out of the years a new project may take), **funding source** "UBEC Intervention Fund" (read as the funding source "Direct Intervention (Educational Imbalance Fund)"), strategic justification and assumptions. The State and Lot title rows and the Sites sheet are new in client demo wave 2; the template version stamp is unchanged, so files without them still import.

**Sites sheet** (3 schools in 2 LGAs of Kano; coordinates approximate, demo only; each located site gets a radial boundary of the workspace default radius):

| Site no. | School | Level | LGA | Latitude, longitude |
| ---: | :--- | :--- | :--- | :--- |
| 1 | Government Primary School, Dawakin Tofa (the Project sheet's school and GPS point) | Primary | Dawakin Tofa | 12.1006, 8.3354 |
| 2 | LGEA Primary School, Kwa | Primary | Dawakin Tofa | 12.0712, 8.2958 |
| 3 | Government Junior Secondary School, Tofa | JSS | Tofa | 12.0517, 8.2623 |

| Unit ID | Site no. | Facility | Label | Work phases |
| :--- | ---: | :--- | :--- | :--- |
| T1 | 1 | Toilet | Toilet block, 8 cubicles (boys and girls) | 1–2 |
| BH1 | 2 | Borehole | Motorised borehole with overhead tank | 1–2 |
| SP1 | 3 | Solar power | Solar pump for the school's existing borehole | 2 |

| Item | Unit | Description | Qty | Rate (NGN) | Amount (NGN) |
| :--- | :--- | :--- | ---: | ---: | ---: |
| 01.01 | T1 | Excavation, blinding and strip foundations | 42 m3 | 38,000 | 1,596,000 |
| 01.02 | T1 | 225 mm sandcrete block walls, plastered and painted | 310 m2 | 18,500 | 5,735,000 |
| 01.03 | T1 | Roof: timber trusses and long-span aluminium sheets | 96 m2 | 24,000 | 2,304,000 |
| 01.04 | T1 | Sanitary fittings and plumbing, septic tank and soakaway | 1 LS | 8,400,000 | 8,400,000 |
| 02.01 | BH1 | Drill, case and develop a 150 mm borehole (80 m), yield test | 80 m | 95,000 | 7,600,000 |
| 02.02 | BH1 | Steel tank stand with a 5,000-litre overhead tank | 1 item | 6,500,000 | 6,500,000 |
| 02.03 | BH1 | Reticulation to the toilet block and four taps | 120 m | 22,000 | 2,640,000 |
| 03.01 | SP1 | 1.5 kW solar submersible pump, controller, 8 × 400 W panels, fitted to the existing borehole | 1 set | 9,500,000 | 9,500,000 |
| | | **Total** | | | **44,275,000** |

Work phases (sheet "Sprints", name kept for the importer): work phase 1 starts on the first working day 22 days after the run day and lasts 5 weeks; work phase 2 follows for 6 weeks. Suggested contract values for step 2: contract reference `UBEC/DI/2026/110`, contract sum NGN 46,490,000, award date today − 14 days, signed today − 7 days, planned kick-off today. The contractor is new: in the contractor picker choose **New contractor** and enter "Kurmi Waterworks & Construction Ltd" (it is created Inactive until "03 Contract agreement.pdf" is uploaded as the Signed contract).

The same data drives `server/src/tests/routes.demo.test.ts`, which walks the whole demo through the API on every route-test run.

## What the project register import contains

`14 Project register import.xlsx` is the import template (version `INSITE-REGISTER-v1`) with six projects of the existing register. Codes are blank, so the platform numbers them after the highest PRG code (on a freshly seeded database: PRG-243 to PRG-248). Dates are relative to the run day.

| UBEC project ID | Project | State | Type | Status | Contractor | Result |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| UBEC/DI/2026/KN/031 | Renovation of a three-classroom block, LGEA Primary School Gwarzo | Kano | Direct Intervention | Not started | – | Draft |
| UBEC/MG/2026/LA/012 | Perimeter fence and gatehouse, Agege JSS | Lagos | Matching Grants (Lagos SUBEB) | Not started | – | Draft |
| UBEC/DI/2025/KN/014 | Two-classroom block, GPS Bichi | Kano | Direct Intervention | Ongoing, 55% | Sahel Build & Civil Works Ltd (existing) | Live |
| UBEC/MG/2025/LA/007 | WASH facilities, Ikorodu Community Primary School | Lagos | Matching Grants (Lagos SUBEB) | Ongoing, 30% | Eko Waterline Engineering Ltd (new) | Live |
| UBEC/MG/2025/KN/019 | Library and ICT room, Dala JSS | Kano | Matching Grants (Kano SUBEB) | Ongoing, 72% | Sahel Build & Civil Works Ltd (existing) | Live |
| UBEC/DI/2024/KN/022 | Solar-powered borehole, Tudun Wada Model Primary School | Kano | Direct Intervention | Completed, 100% | Gwale Borehole Services Ltd (new) | Live |

The preview shows 2 drafts, 4 live projects and 2 new contractors with no errors. Importing the same file twice is refused: every UBEC project ID is then taken. `server/src/tests/routes.irl.register.test.ts` imports this file on a freshly seeded database on every route-test run.
