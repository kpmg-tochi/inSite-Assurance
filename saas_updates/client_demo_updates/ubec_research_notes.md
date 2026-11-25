# UBEC research notes (evidence for the client demo updates)

**Collected:** 2026-11-25. **Used by:** [implementation_plan.md](implementation_plan.md). This file holds the evidence; the plan holds the decisions.

## 1. Sources

| Tag | Source | Where | Weight |
| :--- | :--- | :--- | :--- |
| **PCM** | KPMG, *UBEC Project Cycle Redesign* (draft Project Cycle Manual), Feb 2026, 55 pp. KPMG Confidential | `Project Context/MoE_Process Design for Direct & Matching Grant Project Delivery__Draft.pdf`; text in `sources/pcm_process_design_text.txt` | 1st: the process UBEC is adopting |
| **GL** | UBEC, *Guidelines for Accessing, Disbursing and Utilizing the FGN-UBE Intervention Funds*, Nov 2026, 58 pp. Text is outlined vector paths, so no text extract is saved; quotes below were read from page images | https://wwwapi.ubec.gov.ng/uploads/1795169637685_Guidelines%20for%20FGN-UBE%20Intervention%20Funds_compressed.pdf | 2nd |
| **WEB** | ubec.gov.ng: a React single-page app, so page text was taken from its JS bundle and API | `sources/ubec_website_text.txt` (one line per string, prefixed by bundle offset) | 2nd |
| **CM** | UBEC, *Construction, Renovation & WASH Manual for SBMC-SIP*, 1st ed., Mar 2026, 114 pp. | https://wwwapi.ubec.gov.ng/uploads/CONSTRUCTION_AND_RENOVATION_MANUAL.pdf; text in `sources/ubec_construction_manual_text.txt` | 3rd (school-led WASH projects) |
| **ACT** | Compulsory, Free Universal Basic Education Act 2004 | https://placng.org/lawsofnigeria/print.php?sn=108; text in `sources/ube_act_2004_text.txt` | Legal basis |
| **BPP** | Bureau of Public Procurement, *Standard Bidding Document for Works* (federal, ~2011) | https://bpp-storage.s3.eu-west-2.amazonaws.com/wp-content/uploads/2025/09/13205602/SBD_Works1.doc | 4th: federal contract wording, not UBEC's |
| **IRL** | KPMG Information Requirements List for UBEC | `Project Context/UBEC_IRL.xlsx` | Our own scoping |

Not reachable: UBEC annual reports 2022–2024, the Q4 2025 Key Performance Report, SBMC guides (old `wp-content` links now return the app shell); "Revised Minimum Standards for Infrastructural Facilities" (cited by GL, not online). ubec.gov.ng has no ACTU, FOI, BPP or "No Objection" pages.

## 2. Terminology evidence

| Concept | UBEC wording | Quote | Source |
| :--- | :--- | :--- | :--- |
| Work periods | None in UBEC sources. Closest: programme of works, work programme, stage of execution | "progress vs work program" (monitoring checklist); "Contractors shall submit a detailed programme of works" | PCM p12, p38 |
| Milestones | key project milestones | "timely coverage of key project milestones" | PCM p12 |
| Construction stage | project implementation / execution | "Ensuring the overall success of projects implementation"; "monitoring of project execution"; "QA Table: During Project Execution" | GL §3.4.2; WEB; CM p106 |
| Retention | Not in UBEC sources. Federal contract: Retention | "half the total amount retained shall be repaid … the remaining half shall be repaid when the Defects Liability Period has passed" | BPP GCC 67 |
| Defects period | Federal: Defects Liability Period. CM: warranty period | "The Defects Liability Period shall be extended for as long as Defects remain to be corrected"; "initiating the contractor's one-year warranty period" | BPP; CM p107 |
| Defects | defects, anomalies, rectify | "The Commission shall issue "STOPWORK ORDER" for projects with major defects … shall not pay such contractors till they rectify the defect" | GL §4.4(vi) p32 |
| Findings | findings | "Findings are documented and uploaded to the online platform for transparency" | PCM p29, p51 |
| Visits | site visit, routine monitoring visits, supervision, monitoring (routine, specialized, mid-term, final, follow-up) | "Supervisors conduct scheduled site visits (minimum once per week or twice per month)"; "routine project and Specialized Monitoring" | PCM p29; WEB |
| Follow-up | follow-up monitoring | "after the conduct of follow-up monitoring the state did not rectify the anomaly or defect" | GL §4.9(ii) |
| Final acceptance | Punch List, Site Acceptance Certificate | "Formal client acceptance is granted only upon clearance of the Punch List and issuance of the Site Acceptance Certificate" | CM p107 |
| Mobilisation | Mobilisation to Site; mobilisation fees | "Contractors requesting for mobilisation fees shall satisfy the requirements of Public Procurement Act-2007" | GL §4.4(v) |
| Lots | lots | "Projects are packaged into lots, procurement methods are assigned" | PCM p20 |
| Year | intervention year | "a maximum of two waivers per intervention year" | GL §4.5.1 |
| Statuses | Completed / On-going / Completion Rate | "On-going Projects", "Completed Facilities" | WEB Key Performance Report |
| Project naming | "Construction of a Block of Two (2) Classrooms with Office & Store and Supply of Furniture" | | WEB constituency projects |
| Facilities | classrooms, toilets, VIP latrines, boreholes (hand pump / motorized), perimeter fencing, solar, admin block, ECCDE centres, furniture | "compartment ventilated improved pit (VIP) latrines" | GL p16–19; WEB |
| Coding | projects must be coded | "All infrastructure projects … must be properly coded and documented in line with UBEC guidelines" | GL §4.7 p34 |

Spelling: British nouns (programme, centre, enrolment); "mobilisation" in GL and PCM; WEB mixes -ize/-ise.

## 3. Roles evidence

| Role / unit | What the sources give it | Source |
| :--- | :--- | :--- |
| Executive Secretary (ES) | Approves procurement plan and prioritised projects; approves contract termination; heads the Steering Committee | PCM p6 note 4, p9, p16 |
| Executive Management | Approves budget, procurement plan, BEAP | PCM p19, p21, p43 |
| Director, Physical Planning | Process owner (both models); needs assessment; letter of introduction; Resident Supervisor assignment; notifies Legal on mobilisation default | PCM p6, p24, p27, p33 |
| State/Zonal Physical Planning Officers | Needs assessment data, site mobilisation | PCM p6 swimlane |
| Director, Monitoring & Evaluation | Owns the manual; monitoring framework; mobilisation checks; final evaluation; lessons learned | PCM p4, p13, p28–30 |
| M&E officer | Baseline data, routine monitoring visits (with Resident Supervisors) | PCM p29 |
| QA officers | "approve, reject or query each submission; only approved data reaches" the dashboard | IRL output 3 |
| Director, Finance & Accounts | Budget collation and consolidation | PCM p18 |
| Director, Procurement | Procurement plan, bid opening reports, award publication | PCM p9, p24 |
| Director, Legal (Legal/Risk Management) | Contract termination procedure; Advance Payment Guarantees and Performance Securities | PCM p6, p12; WEB |
| Audit department | Bidder verification; archiving and audit of the closure file | PCM p10, p54 |
| ICT Support | Online dashboard | PCM p30 |
| UBEC State/Zonal Offices | DI kick-off meeting preparation, notification, minutes; beneficiary handover | PCM p25–26, p31 |
| Zonal Director / State Coordinator | 6 zonal offices (one per geopolitical zone), headed by a Director; state offices in 36 States + FCT, headed by an Assistant Director / Principal QA Officer; zonal offices supervise DI and Constituency projects and verify MG Action Plans | WEB zonal offices page |
| Resident Supervisor | Technical staff (engineer) at State/Zonal Offices; 7–10 sites each; weekly supervision; continuous monitoring during mobilisation | PCM p11, p12, p27 |
| Independent M&E | COREN-certified firms engaged as required | PCM p13 |
| SUBEB Executive Chairman | MG: appoints Bid Evaluation Committee; refers mobilisation defaults; chairs the Tenders Board | PCM p36, p38; GL p31 |
| SUBEB Director Physical Planning / Procurement / PRS / M&E | MG: needs assessment circular, BEAP, procurement, kick-off (PRS), M&E | PCM p33, p47–52 |
| SUBEB Project Supervisors | MG: baseline data, routine monitoring visits | PCM p51 |
| Local Government Education Secretaries (LGEA) | Invited to MG kick-off; monitor implementation in their schools | PCM p47; GL §3.3.3 |
| SBMC / school head | Beneficiary representatives; sign Site Acceptance / Handover Certificate (CM) | PCM p11; CM p107 |
| Tender Board, BPP, FEC, Steering Committee, Bid Evaluation Committee | Approve awards and prioritisation (outside the platform) | PCM p10, p16, p23–24 |

Sizing (IRL, our assumption sheet): 60 users, 50 of whom do site visits; 10,000 active projects.

## 4. External facts checked for the plan

| Fact | Finding | Source |
| :--- | :--- | :--- |
| Nigerian states and LGAs | 36 States + FCT; 774 LGAs (FCT's 6 area councils included). Open datasets exist (e.g. `temikeezy/nigeria-geojson-data`, `xosasx/nigerian-local-government-areas` (MIT, with coordinates), npm `@some19ice/nigeria-geo-core`); a hosted RapidAPI exists but is low-use. None verified for completeness yet | [nigeria-geojson-data](https://temikeezy.github.io/nigeria-geojson-data), [xosasx repo](https://github.com/xosasx/nigerian-local-government-areas), [RapidAPI](https://rapidapi.com/globulus-technology-globulus-technology-default/api/nigeria-states-and-lga/details) |
| Google Geocoding pricing | Since 1 Mar 2025, Essentials SKUs (incl. Geocoding) have 10,000 free events a month per SKU. Paid rate after that reported as about $5 per 1,000 (third-party; not confirmed on Google's rate card) | [Google billing FAQ](https://developers.google.com/maps/billing-and-pricing/faq), [March 2025 changes](https://developers.google.com/maps/billing-and-pricing/march-2025), [Woosmap](https://www.woosmap.com/blog/google-maps-geocoding-api-pricing) |
| Nigerian federal fiscal year | Statutory default is January–December; the 2025 capital budget was extended to 31 Mar 2026 and the 2026 budget was backdated to 1 April, so 2026 runs April–March in practice. The Presidency (May 2026): "fiscal years are defined by law, not the calendar". No source supports October–September | [Presidency statement](https://statehouse.gov.ng/?p=64018), [AllAfrica](https://allafrica.com/stories/202605180093.html), [PLAC](https://placng.org/Legist/one-budget-multiple-extensions/) |
| UBEC "LOT / BATCH" codes | Not found online; Ekiti and Plateau SUBEB bid notices exist but name no lot/batch codes. Needs the sample the client shared | [Ekiti SUBEB](https://www.ekitistate.gov.ng/?p=31480), [Plateau SUBEB](https://gazettengr.com/plateau-subeb-opens-bid-for-258-classrooms/) |
| Retention in SUBEB practice | Benue SUBEB chair (news): contractors "complete the work or forfeit the retention fee"; payments "based on valuation" | [The Sun, Dec 2025](https://thesun.ng/benue-subeb-boss-monitors-project-tasks-contractors-on-quality-standards/) |
