# Demo build: working plan

**Written:** 2026-11-25, evening. **Demo:** not scheduled yet; may be ad hoc. **Status:** ready to execute on the owner's go.
**Design reference:** [implementation_plan.md](implementation_plan.md) (section letters below point into it). **Deferred work:** `saas_updates/next_steps/client_demo_follow_ups.md`. **Questions for the demo:** [demo_questions.md](demo_questions.md).

---

## 1. How this plan works

The demo date is unknown, so the work is split into **waves in priority order**. Each wave ends **demo-ready**: checks green, demo database re-seeded, its checklist ticked. If the demo happens mid-way, the last finished wave is what gets shown. Inside a wave, workstreams run in parallel on separate files.

| Decision | Detail |
| :--- | :--- |
| Labels only | Terminology changes the words users see (web, mobile, PDFs, emails, exports, the Excel template, seed text). Code names, tables, enums and routes are renamed after the demo |
| Additive only | New tables, nullable columns, new endpoints. Nothing deleted or renamed, so existing tests and screens keep working |
| Demo data as an overlay | `SEED_PROFILE=ubec-demo npm run prisma:seed` runs the normal seed, then `seedDemoOverlay.ts`, which relocates, re-codes and enriches the 11 existing UBEC projects and adds 7 lighter ones (18; 10 in the north). Tests keep the normal seed |
| Minimal roles in the platform | 8 roles (section 3). The full 14-role breakdown against the process flow is a **slide**, not built |
| No mocks in the product | Anything not built is talked about from slides, not shown on screen. Nothing is labelled "Preview" (owner) |
| Prioritise by value for effort | High-effort items of lower demo value are left out (section 2) |

---

## 2. Priorities

| Wave | Goal | Items | Effort |
| :--- | :--- | :--- | :--- |
| **1** | **It looks and speaks like UBEC** | Labels (A); LOT/BATCH codes with year column (C3); State and LGA dropdowns, zone/state/LGA filters (C1); funding source dropdown (C4); intervention year rule (D5); 8 roles + user switcher (B); seed: 18 projects across six zones, UBEC names and codes; payments period filter + portfolio Payments tab (G) | Medium |
| **2** | **It works the way UBEC runs projects** | Multi-site projects, light version (C2: sites with school, LGA, coordinates; per-site progress and status from their units; register sub-rows; one map pin per site); needs assessment upload first, with a Sites sheet (D1); organisations section hidden, owner and funder derived (D2); contractor register, picker with stars, Inactive until the signed contract is signed off (F.1–F.3) | Medium–high |
| **3** | **It catches problems** | Contractor flags and decisions (F.4: flag rule, decision drawer, "additional visits" proposes visits, "payment hold" banner and exception; heavier actions recorded as "Sent to Legal review"); Needs assessment page with seeded approved lists, links and the budget-mismatch flag (E3, read-only) | Medium |
| **4** | If time allows | Approved list upload (E3); payments breakdown table (G); visit plan calendar, read-only (D4); Google address lookup (D3, only when the owner has a key) | Medium each |

**Left out (talked about from slides, built after the demo):**

| Item | Why left out |
| :--- | :--- |
| In-depth code rename (A.3) | Very high effort, no visible value in a demo |
| 14-role catalogue and role migration (B) | Owner: slide with roles against the process flow; minimal roles in the platform |
| Per-site visit scheduling, per-site check-in boundary, per-site handover, site-aware field app (C2 full) | High effort across server, web and mobile; the light version shows the model |
| Signed-document QR forms and comparison (E4) | High effort; slide |
| Tamper evidence (E2), MFA and encryption (E1) | Owner: talking points |
| Contractor replacement (F.5), deductions, stop-work, suspension effects | High effort; the decision is recorded, its effect comes later |
| Red-flag rules beyond budget mismatch (E3) | Medium–high effort for each rule |
| AI parsing (D1.1) | Owner: template only; NDPA question for UBEC |

---

## 3. Roles in the platform (minimal)

The feedback was that one "Admin" doing everything is too vague. The smallest fix is to split the administrator into the people who actually do the work in the demo, and give the existing roles UBEC titles. The full breakdown (14 roles against the PCM process, implementation plan B.3) goes on a slide.

| Role | Login (`Password123!`) | Change | In the demo |
| :--- | :--- | :--- | :--- |
| System Administrator | `admin@ubec.test` | Renamed from "UBEC Administrator"; keeps every permission tonight (covers Legal and Audit steps off-screen) | – |
| Executive Secretary | `es@ubec.test` | New | ✓ dashboard, alerts, contractors, default decision |
| Director, Physical Planning | `dpp@ubec.test` | New | ✓ creates projects, picks the contractor, kick-off, contractor flag decision |
| Finance Officer | `finance@ubec.test` | New | ✓ payments |
| M&E Officer | `me.officer@`, `lagos.me@` (existing) | Renamed (UBEC and SUBEB variants keep their codes) | ✓ reviews reports, findings |
| Resident Supervisor | `resident.supervisor@` (existing) | Unchanged | ✓ field app |
| Independent M&E (COREN-certified firm) | `independent.me@` (existing) | Unchanged | – |
| SUBEB Executive Chairman | `kano.admin@`, `lagos.admin@` (existing) | Renamed from "SUBEB Administrator" | – |

**User switcher:** a "Switch user" entry in the user menu lists the demo cast and signs in as that person in one click. Only with `DEMO_MODE` on (the server refuses it otherwise; production refuses `DEMO_MODE`); each switch is audited like a sign-in.

---

## 4. Wave 1: looks and speaks like UBEC

### 4.1 Step 0 (main thread, first)

| Part | Contents |
| :--- | :--- |
| Glossary | Section 8 |
| Shared | `data/nigeriaAdminAreas.ts` (WS-REF, below); `utils/projectCode.ts` (`buildLotBatchCode`, `parseLotBatchCode`, `formatProjectCode`; `PROJECT_CODE_PREFIX_REGEX` widened to accept `^\d{4}-LOT-\d+-BATCH-\d+$`); `schemas/lot.schema.ts` (`ProjectLotDto`, `LotChoice` = `{ lotId }` or `{ newLotTitle }`); `utils/fiscalYear.ts` (`PeriodPresetEnum`, `periodRange`, `fiscalYearOf`, `allowedInterventionYears`); `FUNDING_SOURCES` + `FundingSourceCodeEnum`; payments: `PaymentPeriodQuerySchema`, `PortfolioPaymentsQuerySchema`, summary and row DTOs; basics request gains `stateCode`, `lotChoice`, `fundingSourceCode`, validated `interventionYear`; filters gain `zone`, `stateCode`, `lgaCode` |
| Prisma (one additive migration) | `ProjectLot` (tenant, intervention year, number, title; unique per tenant and year); `Project.lotId`, `batchNumber`, `stateCode`, `fundingSourceCode`; `Tenant.fiscalYearStartMonth` (default 1); audit action `PROJECT_LOT_CREATED`. Check the generated SQL keeps every hand-written index and CHECK listed in `CLAUDE.md` |
| Web shell | `navItems.ts` labels (Project cycle, Monitoring); Payments tab route; nothing else in these files is edited by workstreams |
| Gate | `npm run build:shared`, `npx prisma generate`, migration applied, `npm run typecheck` green |

### 4.2 Workstreams (parallel)

| WS | Scope | Owns | Must not touch |
| :--- | :--- | :--- | :--- |
| **REF** (during step 0) | 6 zones, 36 States + FCT, 774 LGAs from an open dataset (`xosasx/nigerian-local-government-areas`, MIT, or another), checked: counts, FCT's 6 area councils, a few known LGAs; unit test | `shared/src/data/nigeriaAdminAreas.ts` + test | everything else |
| **A** Labels | Glossary over shared label constants (`projectStage.ts`, `retention.ts` labels, `VISIT_KIND_META`, document type names, `defaultFormLibrary.ts` text, KPI and alert labels), web pages not owned below, PDFs, email templates, export headers (except payments), demo pack text | those files | files owned by B1, B2, D, H, SEED; `navItems.ts`, `App.tsx` |
| **B1** Server: codes, location | Lots and codes (`assignLotBatchCode` in a per-tenant advisory lock; `/api/v1/project-lots`); basics save: `stateCode` (sets `stateLocation` text too, for old screens), intervention year rule, funding code; `zone` / `stateCode` / `lgaCode` filters on the directory, portfolio, register export; `formatProjectCode` in its PDFs and exports | `modules/projects/*`, `modules/setup/*`, `modules/projectRegister/*`, portfolio overview service | payments, seed |
| **B2** Web: creation, register | BasicsSection (lot picker with code preview "LOT 5 BATCH 7", State dropdown, intervention year dropdown, funding dropdown; LGA dropdown while single-site); register and directory: Intervention year column, zone/state/LGA filters, `formatProjectCode` on every code shown in its files | `sections/BasicsSection.tsx`, `components/projects/*`, `PortfolioProjectsTable.tsx`, `WorkspaceHomePage.tsx` filters | payments, visits, other sections |
| **D** Payments | Server: `from`/`to` on the project payments list and export (filtering moves to the server); `GET /api/v1/payments`, `/payments/summary`, `/payments/export.xlsx` with period, zone/state/LGA, delivery model, year, funding source, contractor, kind, exceptions; directory visibility; `payments:view`. Web: `PeriodFilter` (this/last month, this/last quarter, quarter picker, this fiscal year, year picker, custom, all), ProjectPaymentsPage on server filters, `PortfolioPaymentsTab` (cards: gross, retention held, released, net, count, exceptions, paid vs contract sum, paid vs % complete; list; export). Default period: current fiscal year | `modules/payments/*`, payments in `modules/exports/*`, `pages/payments/*`, `components/payments/*`, `pages/dashboard/PortfolioPaymentsTab.tsx` | everything else |
| **H** Mobile | Glossary in `personaCopy.ts` and screens; `formatProjectCode`; camera hint "Photograph the works, not pupils" | `mobile/src/*` | server, web |
| **SEED** Overlay part 1, roles, switcher | `seedDemoOverlay.ts` part 1 (section 7.1, 7.3); `SEED_PROFILE` switch (one line in `seedDatabase.ts`); roles of section 3 and their permissions (type configs' Legal role and CoC slots pointed at them, no version bump); `POST /api/v1/demo/switch-user` + `components/demo/UserSwitcher.tsx` | `server/src/db/seedDemoOverlay.ts`, demo routes, `components/demo/*` | other seed files except the switch line |
| **DOCS** | Slide outline (roles against the process flow, security and tamper, what's next); demo script for wave 1; demo accounts; `CLAUDE.md` notes | `saas_updates/*`, `CLAUDE.md` | code |

**Integration (main):** Payments tab in `WorkspaceHomePage`, user switcher in `AppShell`, leftover glossary grep, overlay seed twice, full gate.

### 4.3 Wave 1 checklist

1. Switch between the five cast members in one click.
2. No "sprint", "construction" or "region" on the screens of the walkthrough.
3. Codes read "LOT 5 BATCH 7" with an Intervention year column; map pins spread over all six zones.
4. Filter the register by zone, state, LGA.
5. New project: State dropdown, lot picker with preview, intervention year limited to the current and next year, funding dropdown.
6. Payments: project page by quarter; portfolio Payments tab for the year with totals and export.

---

## 5. Wave 2: works the way UBEC runs projects

### 5.1 Step 0 (main)

Shared: `schemas/site.schema.ts` (`SchoolLevelEnum`, `SiteStatusEnum` `NOT_STARTED|ONGOING|BEHIND|COMPLETED|HANDED_OVER`, `ProjectSiteDto`, `SaveProjectSitesRequest` (full list), `SiteLocationInput` + `parseMapsLink`); `schemas/contractor.schema.ts` (`ContractorStatusEnum` `INACTIVE|ACTIVE|SUSPENDED`, summary/detail/create DTOs, `ContractorRatingDto`, `ContractorPerformanceSettingsSchema` with defaults); `utils/contractorRating.ts` (`contractorReliability`, pure); setup section `sites` (step `project`, required; `parties` not required for typed projects); permission `contractors:view_register`; audit actions `SITES_SAVED`, `CONTRACTOR_CREATED`, `CONTRACTOR_STATUS_CHANGED`.
Prisma: `ProjectSite` (project, site number, school name, school level, `lgaCode`, location text, address, latitude, longitude, boundary); `FacilityUnit.siteId`; contractor fields on `Organization` (`contractorStatus` default `ACTIVE` for existing rows, `tin`, `address`, `stateCode`); `ContractorRatingSnapshot`.
Stubs: `sites.service.ts` (`saveProjectSites`, `getProjectSites`), `contractors.service.ts` (`activateContractorOnSignedContract`, `getContractorRatings`); web `ContractorPicker`, `ContractorCard`; routes and the **Contractors** sidebar entry.

### 5.2 Workstreams

| WS | Scope | Owns |
| :--- | :--- | :--- |
| **B1** Sites server | Sites service and routes; setup section `sites` (save, validate, audit; activation needs every site located); per-site progress and status computed on read from its units (budget-weighted, as projects are); register, directory and portfolio DTOs with `sites[]` and **one map point per site**; units carry `siteId`; derived owner and funder on type apply (D2) | `modules/sites/*`, `modules/projects/*`, `modules/setup/*`, portfolio overview |
| **B2** Sites web | SitesSection (site cards: school, level, LGA dropdown, location by coordinates or a pasted Google Maps link, or address text; map with pin and boundary); PartiesSection hidden for typed projects; register rows expand to sites (completion %, status); portfolio map pins per site; site list on the overview | `sections/{Sites,Site,Parties}Section.tsx`, `components/projects/*`, `LiveGeospatialMap.tsx`, `components/geofence/*` |
| **B3** Needs assessment first | Template: project fields (delivery model, lot title, State, funding source, intervention year) and a Sites sheet; units name their site; `POST /api/v1/projects/from-needs-assessment/preview|confirm` (draft, code, sites, work phases, units, BoQ in one transaction); "New project" dialog with **Upload needs assessment** first; "From needs assessment" / "Needs your input" tags; demo pack file rebuilt | `modules/scope/workbook/*`, `scopeImport.service.ts`, new-project dialog, `ScopeWorkbookToolbar.tsx`, `scripts/buildDemoPack.ts` |
| **C** Contractors | `/api/v1/contractors` (list, detail, create with duplicate check by RC number and name, update); rating from accepted reports' workmanship, findings, work phase verification and closure ratings (batched facts, nightly snapshot, refresh on demand); Inactive → Active hook in the signed-contract sign-off; `/app/contractors` list and detail (stars with the number of reports, breakdown, current and previous projects); `ContractorPicker` with stars and "New contractor" in ContractorSection; `ContractorCard` | `modules/contractors/*`, `ContractorSection.tsx`, `components/contractors/*`, `pages/contractors/*`, the hook line in documents sign-off |
| **SEED** part 2 | Sites for all 18 projects (section 7.2), units assigned to sites, 10 contractors, Inactive contractor on project 17; the UBEC tenant's facility catalogue made to match the client's 50 register columns (appendix A: rename and add facilities, retire the rest; existing units re-pointed) | `seedDemoOverlay.ts` |
| **H** Mobile | None needed (visits stay per project) | – |

### 5.3 Wave 2 checklist

1. Map shows about 50 site pins; register rows expand to sites with completion % and status.
2. New project from the demo pack needs assessment: preview, draft with code, sites, units and BoQ; "Needs your input" fields listed.
3. Sites section: add a site by pasting a Maps link; pin and boundary appear.
4. Contractor picked with stars; "New contractor" creates an Inactive one; Contractors page shows ratings and history.

---

## 6. Wave 3: catches problems

| WS | Scope |
| :--- | :--- |
| **C** Flags and decisions | Shared `contractorFlagDue` (N reports at or below T in D days; defaults 3, 3/5, 60 days; settings); `ContractorFlag`, `ContractorFlagAction`; flag raised by a job and on report acceptance; notification `CONTRACTOR_FLAGGED` to Director PP and the ES; flag on the contractor, the project's contractor card and the alerts; decision drawer: **Additional visits** (proposes visits through the visit plan service), **Formal warning** (recorded, letter later), **Payment hold** (banner on payments; a payment recorded during the hold is flagged `PAID_DURING_HOLD`), **Deduction / Stop-work / Replace / Suspend** (recorded with status "Sent to Legal review"), **No further action** |
| **E** Approved lists | `ApprovedList`, `ApprovedListRow`, `Project.approvedListRowId`; `/api/v1/approved-lists` (read, link); **Needs assessment** page in the sidebar (years, lists, rows, linked projects, match status); budget-mismatch flag (default ±10%) on the project overview and the page; row picker in BasicsSection |
| **SEED** part 3 | Demo 2 contractor flagged (3 reports with workmanship ≤ 3 in 60 days); approved lists 2025–2026 with links; project 2 at +17% |

Wave 3 checklist: Demo 2 shows the flag; the decision "Additional visits" adds visits; "Payment hold" shows to Finance and flags a new payment; the Needs assessment page shows the 2026 lists and project 2's mismatch.

---

## 7. Seed overlay

### 7.1 Part 1 (wave 1): projects, places, codes, people

| # | Source | State (zone) | Model | Year | Story |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | PRG-105 | FCT (NC) | DI | 2026 | **Demo 1, on track**: execution, approved reports with photos, a finding rectified on follow-up, interim payments; the live field visit |
| 2 | PRG-211 | Kano (NW) | MG | 2026 | **Demo 2, in trouble**: behind, late report and missed visit, critical finding escalated, paid ahead of work done (wave 3: contractor flagged, +17% vs BEAP) |
| 3 | PRG-106 | Lagos (SW) | DI | 2025 | **Demo 3, closing out**: ready to close, archive, export the closure file |
| 4 | PRG-103 | Lagos (SW) | DI | 2025 | Defects liability period, open defect, retention held |
| 5 | PRG-104 | Lagos (SW) | DI | 2025 | CoC signed once, handover response to record |
| 6 | PRG-101 | Kaduna (NW) | DI | 2026 | Kick-off planned |
| 7 | PRG-102 | Niger (NC) | DI | 2026 | Mobilising; site possession form pending |
| 8 | PRG-221 | Sokoto (NW) | MG | 2026 | Mobilisation overdue, default case waiting for the Executive Chairman |
| 9 | PRG-241 | Enugu (SE) | MG | 2025 | Closed, audit sign-off pending |
| 10 | PRG-242 | Rivers (SS) | MG | 2025 | Closed and archived |
| 11 | PRG-201 (draft) | FCT (NC) | DI | 2027 | Draft with fields still to fill |
| 12 | new | FCT (NC) | DI | 2026 | Execution, on track |
| 13 | new | Kano (NW) | DI | 2025 | Imported from the register, ongoing at the imported % |
| 14 | new | Kaduna (NW) | DI | 2026 | Execution; final payment before the CoC (exception) |
| 15 | new | Borno (NE) | DI | 2026 | Stalled |
| 16 | new | Oyo (SW) | MG | 2025 | Handover recorded, waiting for review |
| 17 | new | Ogun (SW) | MG | 2026 | Mobilising (wave 2: contractor Inactive) |
| 18 | new | Anambra (SE) | DI | 2026 | CoC waiting for signatures |

North 10 (FCT 3, Kano 2, Kaduna 2, Niger, Sokoto, Borno), South 8 (Lagos 3, Oyo, Ogun, Enugu, Anambra, Rivers). Codes `{year}-LOT-{n}-BATCH-{m}` with lots in order per year and UBEC-style titles ("Renovation, Equipment and Furnishings of Public Schools", "Construction of a Block of Two (2) Classrooms with Office & Store and Supply of Furniture"). Coordinates inside real LGAs of each state. Organisations: UBEC HQ, SUBEBs for the Matching Grants states (existing Kano/Lagos SUBEB records reused where they fit), owners re-pointed. New projects get light data written directly (units, progress, a few visits and payments), marked in comments. Story table in the file header.

### 7.2 Part 2 (wave 2): sites and contractors

Sites per project: 1 → 3, 2 → 6 in 3 LGAs, 3 → 2, 4 → 2, 5 → 1, 6 → 2, 7 → 2, 8 → 3, 9 → 4, 10 → 2, 11 → 2, 12 → 4, 13 → 3, 14 → 3, 15 → 2, 16 → 5, 17 → 2, 18 → 3 (about 50); schools named in UBEC style ("LGEA Primary School, <Town>", "Government Junior Secondary School, <Town>"); existing units spread over the sites. 10 fictional contractors (no real firms), CAC-style RC numbers, spread of ratings, one with only completed projects, project 17's Inactive.

### 7.3 Logins

Section 3. The seed prints the table.

---

## 8. Glossary (labels only)

| Old label | New label |
| :--- | :--- |
| Sprint(s) | Work phase(s) |
| Scope & sprints | BoQ & work phases |
| Construction (stage, phase) | Execution |
| Defects liability / Liability period | Defects liability period |
| Region / Area | Zone / State |
| Project stages | Project cycle |
| Reports (nav) / Visits, reports and findings | Monitoring |
| Visit submission / report | Monitoring report |
| Baseline / Baseline survey | Baseline monitoring |
| Re-check | Follow-up check |
| Resolved (finding) | Rectified |
| Snag(s) | Punch list item(s) |
| Defect ticket(s) | Defect(s) |
| Contractor on site | Mobilised to site |
| Programme accepted | Programme of works accepted |
| Closure pack | Project closure file |
| Closeout report | Lessons learned report |
| Site update overdue / Spend ahead of progress | Monitoring overdue / Paid ahead of work done |
| Contract / Kick-off minutes / Kick-off notice receipt / Supervisor assignment / Certificate of completion (doc types) | Signed contract / Kick-off meeting minutes / Evidence of receipt (kick-off notification) / Supervisor assignment record / Certificate of Completion (CoC) |
| Head of M&E / Head of Physical Planning | Director, Monitoring & Evaluation / Director, Physical Planning |
| Independent monitor | Independent M&E firm |

---

## 9. Checks at the end of each wave

| Check | Detail |
| :--- | :--- |
| Per workstream | `npm run typecheck` + its own test files; unit tests for new pure functions (`formatProjectCode`, `periodRange`, `allowedInterventionYears`, `parseMapsLink`, `contractorReliability`, `contractorFlagDue`, LGA counts) |
| End of wave (background) | typecheck, lint, web build, server unit + route tests (existing counts unchanged), mobile tests, both seed profiles, the overlay twice in a row |
| Demo database | Re-seeded with `SEED_PROFILE=ubec-demo`; `pg_dump` snapshot to restore after a rehearsal |
| Checklist | The wave's checklist, clicked through |

## 10. Demo devices

| Device | What runs | Tonight's changes |
| :--- | :--- | :--- |
| Physical phone | Expo Go, loading the app from the dev server | Picked up at once (all changes are JavaScript) |
| Emulator | Preview build (APK); the app code is fixed at build time (no over-the-air updates configured) | Not picked up. Either run the app in Expo Go on the emulator too (recommended, no build), or rebuild the preview APK (`eas build --profile preview`) once the last wave is done |

Mobile changes are small (labels, project codes, camera hint), so the phone app looks right on either device after a reload or rebuild.

## 11. Risks

| Risk | Mitigation |
| :--- | :--- |
| Two agents editing one file | Ownership tables; step 0 owns `App.tsx`, `navItems.ts`; integration owns `AppShell`, the overview and home tabs |
| A label test asserting old text | Fix the assertion, not the behaviour |
| Overlay relies on services not written yet | Each overlay part runs after its wave's services; direct writes for bulk history |
| Demo called mid-wave | Demo the last finished wave; the demo script marks what belongs to each wave |
| Features talked about but not built (slides) | Speak of them as the design and the next release; if the client asks to try one or wants it in acceptance, say when it lands (follow-ups file) |

---

## Appendix A. Client facility catalogue and site statuses (owner, 2026-11-25)

**Site statuses** match `SiteStatusEnum`: Not started, Ongoing, Behind, Completed, Handed over (owner confirmed against the register).

**Facilities:** the client's register has one quantity column per facility. The UBEC tenant's catalogue uses exactly these 50 names (title case in the UI, e.g. "ICT Lab / Room"). The archetype decides the facility sub-form (redesign R3); quantities of supply items are the unit's planned quantity.

| Archetype | Facilities (register column names) |
| :--- | :--- |
| `BUILDING_WORKS` | CLASSROOM, OFFICE, STORE, TOILET, LABORATORY, WORKSHOP, LIBRARY, ICT LAB / ROOM, GATE HOUSE, HALL, STAFF QUARTERS, ADMIN BLOCK, CRECHE, CLINIC, KITCHEN, SHOP, NANNY STATION, HOSTEL, STAFF ROOM |
| `SUPPLY_INSTALLATION` | PUPILS FURNITURE, TEACHERS FURNITURE, HEADMASTER / PRINCIPAL FURNITURE, LAB FURNITURE, LIBRARY FURNITURE, WORKSHOP FURNITURE, MAGNETIC BOARD, SCIENCE KIT, PLAY EQUIPMENT, ROBOTICS EQUIPMENT, PHONE REPAIR EQUIPMENT, ELECTRICAL WIRING EQUIPMENT, ICT EQUIPMENT, SPORTS EQUIPMENT, COMPUTER, FILE CABINET, FRIDGE, BOOKSHELF / CUPBOARD, SHOE & BAG EQUIPMENT, BED + BEDDINGS, FASHION DESIGN + TAILORING EQUIPMENT, CAKE/BAKING EQUIPMENT |
| `UTILITIES` | BOREHOLE, OVERHEAD TANK, GENERATOR, SOLAR POWER |
| `EXTERNAL_WORKS` | FENCE, LANDSCAPING, DRAINAGE / EXTERIOR WORKS, FOOTBALL PITCH, PLAYGROUND |

The register (and its export) can show a project's facility quantities in this column order, summed over its sites, as the client's spreadsheet does (wave 2, B2, if time).

---

## Wave 1: verification

| Gate | When | Result |
| :--- | :--- | :--- |
| Step 0 | 2026-11-25 | `build:shared` ✓, `prisma generate` ✓, migration `20261227090000_demo_w1_lots_codes_reference` applied (additive: no hand-written index or CHECK touched) ✓, `npm run typecheck` (shared, server, web, mobile) ✓; unit `demoWave1.unit.test.ts` + `nigeriaAdminAreas.demo.test.ts` + `projectRegister.irl.test.ts`: 21/21 ✓ |
| Baseline (step 0 applied, before workstreams) | 2026-11-25 | Server unit 232/232 (220 existing + 12 new), routes 365/365 (362 existing + 3 step 0 placeholders), mobile 163/163. "Counts unchanged" below = the 220 / 362 / 163 existing tests still pass |
| Workstreams | 2026-11-25 | Each ran typecheck, eslint on its files and its own tests: REF 5/5; A1 135 unit + 201 route + 166 mobile; A2 web build; B1 116 route; B2 web build; D 35 route; H 166 mobile; SEED overlay twice + plain seed |
| **Wave 1 full gate** | 2026-11-25 | `npm run typecheck` ✓ · `npm run lint` 0 errors (51 warnings, all pre-existing: the 18 in files wave 1 touched sit on lines unchanged from HEAD) ✓ · web build ✓ · server unit **232/232** (220 existing + 12 new) ✓ · server routes **380/380** (362 existing + 9 lots + 9 payments; the switcher placeholder removed, W1.9) ✓ · mobile **166/166** (163 existing + 3 new) ✓ · `SEED_PROFILE=ubec-demo` seed twice in a row ✓ (≈18 s each; overlay ≈3 s) · normal seed ✓ · overlay again (database left demo-ready) ✓ |
| Click-through (4.3) | deferred | Owner, 2026-11-25: run once after all waves. Owed checks: `web_testing_checklist.md` WEB-DEMO1-01…09, `physical_testing_checklist.md` PHY-DEMO1-01…04 |

## Wave 1: found during implementation

**Step 0 decisions**

| # | Decision |
| :--- | :--- |
| W1.1 | Workstream A split into A1 (shared + server text) and A2 (web text): the label surface is large and the two halves touch disjoint files |
| W1.2 | `Project.lgaCode` added beside `stateCode` (not in the step 0 list): the single-site LGA dropdown and the LGA filter need a code before wave 2's sites exist. Wave 2 sites carry their own `lgaCode`; the project's stays for single-site projects |
| W1.3 | `codePrefix` and `stateLocation` became optional in the basics request (loosening only). Create without a code and without `lotChoice` → 400 `PROJECT_CODE_REQUIRED`; save without a code keeps the current one |
| W1.4 | `PROJECT_CODE_PREFIX_REGEX` accepts both forms; the register's series numbering (`splitProjectCode`) uses the older `AAA-999` form only (`LEGACY_PROJECT_CODE_REGEX`), so a lot code never feeds `PRG`-style numbering |
| W1.5 | Periods are resolved in the browser (`periodRange`) and sent as `from`/`to`; the server never interprets presets. `allowedInterventionYears(today, startMonth)` takes today as a zoned `YYYY-MM-DD` (the caller zones it) instead of a zone argument, so the function stays pure |
| W1.6 | Funding source: new `fundingSourceCode` beside the existing free-text `fundingSource`, which keeps the label (or "label: detail" for a development partner or Other) so older screens and exports read on. `FUNDING_SOURCE_SUGGESTIONS` (workbook lists) unchanged |
| W1.7 | No Settings control for `Tenant.fiscalYearStartMonth` in wave 1 (default January, as decided); the value reaches the web through the lots list and the payments summaries. Settings control moved to follow-ups |
| W1.8 | Three routers (`/api/v1/project-lots`, `/api/v1/payments`, `/api/v1/demo`), the `SEED_PROFILE` switch, the lot reset line and every new test file were created in step 0, so no workstream edits `app.ts`, `seedDatabase.ts` or `server/package.json` |
| W1.9 | **User switcher: reused the existing one, no new endpoint.** The AppShell user menu already had a one-click account switcher (`web/src/config/demoAccounts.ts`, loaded only in demo builds with `VITE_DEMO_MODE`; each switch is a normal password sign-in, audited as a login). A password-less `POST /demo/switch-user` would have added a sign-in-as-anyone path for no gain, so it was not built: the cast list was replaced with the section 3 roles and the menu heading reads "Switch user". Production safety: the list and password are absent from non-demo bundles (build flag), and the server's `DEMO_MODE` refusal in production is unchanged. The step 0 stub router `/api/v1/demo` and its placeholder test were removed |

**Workstream decisions**

| WS | Decision |
| :--- | :--- |
| B1 | A lot choice wins over a typed code; typing a lot-style code by hand is refused (422 `LOT_CODE_NOT_MANUAL`), so lot numbering stays the server's |
| B1 | Changing the year of a lot-coded draft without a new lot choice moves it to the same-titled lot of the new year (created if missing) |
| B1 | `PROJECT_LOT_CREATED` is written to the tenant ledger (`projectId` null) |
| B1 | State / LGA / funding text sent without a code is mapped to a code (`findStateByName`, `findLgaByName`, `fundingSourceCodeFromText`), so older clients and service-created seed projects get codes. **Unknown funding text is kept with no code and no error**, also in the register import: plan C4 says "refuses unknown ones". Kept lenient until UBEC confirms the list (Q7); follow-up |
| B1 | Register import: any Nigerian state is accepted even if it is not a workspace region; a lot code with a blank year takes the code's year, a different year is `CODE_YEAR_MISMATCH`; a taken lot code gets the next batch of its lot; a new lot takes the project name as its title |
| B1 | The register workbook's funding list is `FUNDING_SOURCES` and its State list includes Nigeria's states |
| main | `routes.irl.register.test.ts` hardcoded 2026/2027 as draft years, which the year rule would fail from 2028; now relative to today (`allowedInterventionYears`). 11/11 |
| B2 | The tenant region picker stays, labelled "Programme zone (workspace list)", because Phase 11 filters and KPIs still read it; in the register it shows only when a link carries it. Removal is C1's follow-up |
| B2 | Older projects: state, LGA and funding are preselected from their text when it maps; otherwise the text shows as "Recorded as …" and an empty select is not sent, so the old text is kept |
| A2 | A new work phase's default name is "Work phase N" (stored data, not a code name) |
| D | The period lives in the URL as `period`, `fy`, `qtr`, `from`, `to` (`qtr`, not `q`: the register search already uses `q` on the home page); the Payments tab's other filters stay in the tab's state |
| D | Project payments page: period defaults to All time (nothing changes until chosen); a footer totals the matching payments; the project's to-date totals are unchanged. `from` after `to` is 400 `INVALID_PERIOD` |
| D | Summary `exceptionCount` counts payments with exceptions (not exception codes). Paid vs contract sum = net paid to date over the matching projects; % complete weighted by contract sum |
| D | `filterPayments` moved from the exports module into `payments.service.ts` (one filter for the page, the list and both exports) |
| D | **Cut:** "group by month / quarter" subtotals (G.1, optional) and the Breakdown table/sheet (G.2; already wave 4). Follow-ups |
| main | Payments tab mounted on the home page for `payments:view`, after Visits; `/app/payments` opens it |
| A1 | Audit `summaryText` strings are unchanged (hashed ledger text); phase-change summaries read "Execution" because they use the phase labels. Default role names (incl. "Independent Monitor") unchanged in `defaultRoles.ts`: the overlay renames the UBEC roles |
| A1 | Needs assessment workbook: sheet "Sprints", headers "Start sprint" / "End sprint" and the Project row "Region" stay, because the importer reads them by name; Instructions and messages use the new words. Renaming them is the in-depth rename |
| A1 | Demo pack file is now "13 Lessons learned report.pdf" (pack rebuilt); demo work phases are named "Work phase N" |
| H | Mobile shows the intervention year from the lot code itself (no server field); older `PRG-…` codes show none. "Unscheduled visit", "Ad hoc visit" and "Problems found after handover" kept |
| SEED | `sokoto.admin@ubec.test` (Abubakar Shehu, SUBEB Executive Chairman) added: the Matching Grants default case moved with PRG-221 to Sokoto, and its decision step is scoped to the project owner, so `lagos.admin@` could no longer decide it. After the overlay no Matching Grants project is in Lagos; `lagos.me@` keeps its assignments (now Sokoto, Enugu, Rivers) |
| SEED | DI default cases are decided by the Executive Secretary, MG by the SUBEB Executive Chairman; the Legal step stays with the System Administrator. CoC slots relabelled; the DI first slot requires Director, Physical Planning. Type changes without a version bump, snapshots updated |
| SEED | **Simplified** (marked "light demo data" in the file): #16 has no CoC (the Oyo SUBEB has no signatories); Demo 1 has work phases verified met and a recent progress-raising visit, but **not** the approved photo reports and the finding rectified on a follow-up check that 7.1 lists; Demo 2 has a stand-in scope and payments until wave 2's sites; 4 new fictional contractors (the 10 are wave 2) |
| main | Glossary grep (integration): fixed 11 leftover user-visible strings (setup issues "zone or state", "work phase"; register export "Programme zone"; workbook prompts; regions errors; finding notes "Rectified on the …"; stage tabs label "Project cycle") and seed labels "Mobilised to site", "Lessons learned report filed …", "Lessons learned report: …". Left: audit summaries, enum values, parsed workbook headers |
| main | `CLAUDE.md` said Prisma reads the root `.env`; it reads `server/.env` (`dotenv/config` from `server/`). Corrected |

**Wave 2–3 impact**

- **Demo 1's monitoring story is not seeded yet** (approved photo reports, a finding rectified on a follow-up check). The wave 1 checklist does not need it, but the demo's scene 4 and wave 3's contractor rating do: add it to SEED part 2 (wave 2).
- The overlay keys on `PRG-*` codes before re-coding; anything that looks projects up by `PRG-*` (demo pack, the older 45-minute demo script, `routes.demo.test.ts`) runs on the normal seed only. Wave 2's sites and contractors must be added inside `seedDemoOverlay.ts` after re-coding, keyed on the story number.
- Contractor-dependent wave 3 work (flags on Demo 2) can reuse the overlay's 4 new contractors; wave 2 adds the rest to reach 10.
- The register options endpoint has no zones or states, and the needs assessment import neither sets `stateCode`/`lgaCode` nor applies the year rule: D1 (wave 2, needs assessment first) must close both.

**Found**

- Parallel route-test runs from several agents dropped the shared test template (`<db>_test_tmpl`); the agents switched to their own `TEST_DATABASE_URL`. Leftover disposable databases: `insite_assurance_b1_test`, `insite_assurance_main_test` (and their `_tmpl`).
- The needs assessment import (`modules/scope/scopeImport.service.ts`) still writes only the LGA text and does not apply the intervention year rule; `GET /projects/register/options` has no zones or states. Follow-ups.
