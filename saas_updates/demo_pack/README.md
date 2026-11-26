# UBEC demo pack

Files the presenter uses during the live Direct Intervention demo. Regenerate them **on the demo day** (dates are relative to the day the script runs):

```bash
cd server
npm run demo:pack            # or: npm run demo:pack -- 2026-12-01 to build for another day
```

The script overwrites the `.xlsx` and `.pdf` files here (this README is kept). It needs no database. It reads the workbook back with the real parser and fails if it would not import cleanly. Every PDF is a specimen with a "SPECIMEN – demo data" footer.

**Demo project: start from the needs assessment** (client demo wave 2). Portfolio → **New project** → **Upload needs assessment** → choose `Dawakin Tofa needs assessment.xlsx`. The check dialog shows what the file gives (name, delivery model Direct Intervention, intervention year, State Kano, LGA Dawakin Tofa, funding source, budget NGN 48,500,000, lot), the 3 sites, the work phases, units and BoQ, and the code it will get; nothing needs typing. **Confirm** creates the draft with its lot/batch code, sites, 2 work phases, 3 units and 8 BoQ lines in one step. The lot title is not one of the seeded lots, so it becomes a new lot of the year (the next lot number: LOT 5 on the overlay database in 2026). Each setup step then shows a "From needs assessment" panel; "Needs your input" lists anything the file left out (nothing, with this file).

**Older flow** (the normal seed, and `routes.demo.test.ts`): "Start without one", type name "WASH upgrade, Government Primary School Dawakin Tofa", code `PRG-110`, state "Kano State", budget NGN 48,500,000, delivery model Direct Intervention, region Kano, leave the LGA empty; then import the same file in setup step 3 (BoQ & work phases), which fills the LGA and empty fields.

## Files and when to use them

| File | When in the demo | Where in the app |
| :--- | :--- | :--- |
| `Dawakin Tofa needs assessment.xlsx` | Creating the project (first) | New project → **Upload needs assessment** → check dialog → **Confirm**. Older flow: setup step 3, BoQ & work phases → **Import needs assessment** → preview → **Import and fill N project field(s)** |
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
| `15 Approved list upload.xlsx` | Uploading an approved list (any time; `approved_lists:manage`: System Administrator, Director, Physical Planning) | Needs assessment → **Upload approved list** → choose the file → check → **Confirm**. The 2027 Approved Projects & Implementation Schedule (Executive Secretary, UBEC, approved 2026-10-14): 6 rows in FCT, Kano, Lagos, Borno and Sokoto, NGN 248,550,000; a new list on both databases (the seeded lists are 2025 and 2026). Project ID is blank; on the overlay, type `2027-LOT-1-BATCH-1` on row 1 (LEA Primary School, Bwari) to link draft #11. Uploading it again with a changed estimate updates the list in place |

## What the workbook contains

Project sheet: name, school "Government Primary School, Dawakin Tofa", region Kano, **State** Kano, LGA Dawakin Tofa, site address, GPS 12.1006, 8.3354 (approximate, demo only; the import draws a 150 m radial boundary on it), delivery model Direct Intervention, **Lot title** "Provision of Water, Sanitation and Hygiene (WASH) Facilities in Public Schools", budget NGN 48,500,000, **intervention year** = the year of the run day (so the file never ages out of the years a new project may take), **funding source** "UBEC Intervention Fund" (read as the funding source "Direct Intervention (Educational Imbalance Fund)"), strategic justification and assumptions. The State and Lot title rows and the Sites sheet are new in client demo wave 2; the template version stamp is unchanged, so files without them still import.

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
