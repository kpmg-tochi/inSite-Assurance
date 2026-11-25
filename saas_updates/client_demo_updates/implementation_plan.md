# Client demo updates: implementation plan

**Started:** 2026-11-25 (owner). **Status:** collecting items. Nothing is implemented. When every item is in, the owner and Claude split this file into phases (section 7) and execute them one by one, following the "Working on a plan" steps in `CLAUDE.md`.

**Read with:** [ubec_research_notes.md](ubec_research_notes.md) (sources and quotes), `saas_updates/next_steps/role_catalogue_migration_plan.md` and `seed_replacement_plan.md` (items B and C5 fold into them), `saas_updates/next_steps/irl_follow_ups.md` (sign-in policy, email, hosting), `saas_updates/client_flow_redesign.md`.

**Sources** (full list in the research notes): **PCM** = KPMG Project Cycle Manual draft (the process-design PDF), **GL** = UBEC Intervention Fund guidelines (Nov 2026), **WEB** = ubec.gov.ng, **CM** = UBEC construction manual, **BPP** = federal standard works contract, **IRL** = our information requirements list.

**Status key:** **Decided** = owner decision recorded. **Proposed** = Claude's recommendation; built as written unless the owner changes it. **Needs input** = blocked on the owner or the client (section 6).

---

## 0. Items

| # | Item | Status | Depth |
| :--- | :--- | :--- | :--- |
| A | UBEC terminology, renamed in depth (server, web, mobile, documents) | Decided (4 terms), Proposed (the rest) | Very deep: schema, enums, permission keys, routes, stored JSON, mobile SQLite, workbook |
| B | Roles: full catalogue in the system, small cast in the demo | Decided (approach), client to confirm the catalogue | Roles, permissions, seed, tests, demo switcher |
| C1 | Zone → State → LGA reference data (dropdowns), replacing free-form regions | Proposed | Schema, shared data, filters, workbook |
| C2 | Multi-site projects: a project is a shared goal (one lot/batch, one contractor) delivered at several sites | Decided (model), Needs input (spreadsheet details, section 6) | Very deep: new site level under geofence, visits, scope, progress, mobile |
| C3 | UBEC project IDs generated automatically (`DI-2CLR n`, `REN n`, `LOT x BATCH y`, numbering per year) | Decided (shape), Needs input (lot codes) | Shared rules, server, register import |
| C4 | Funding source as a dropdown | Proposed | Small |
| C5 | Realistic UBEC seed: 18 projects (10 in the north), 3 demo projects covering the real scenarios | Decided (shape), Proposed (detail) | Seed, tests |
| C6 | Government-agency requirements | Proposed | Mixed; part already in `irl_follow_ups.md` |
| D1 | Start project creation from the needs assessment upload: template parsing for the demo; AI fallback later, subject to NDPA | Decided | Server, web, workbook; AI adapter later |
| D2 | Drop the organisations section from project creation | Proposed | Web, server defaults |
| D3 | Location by address (geocoded) or by coordinates | Decided | New integration |
| D4 | Visit plan section as a calendar, frequency stated above it | Proposed | Web |
| D5 | Intervention year validation by fiscal year (January–December) | Decided | Shared rule, server, web, import |
| E1 | Security: MFA, encryption (demo talking points; build later) | Decided (timing) | Later phase |
| E2 | Tamper evidence beyond the audit ledger (database edits detected) | Decided: demo talking points only, build later | Later phase |
| E3 | Annual approved project lists + cross-checks (red flags) | Proposed | New module, rules, web |
| E4 | Signed paper documents: QR-bound forms, compared with the original, verified before the project moves on | Decided (approach) | Document generation, scan comparison, gates |
| F | Contractor register, reliability rating and performance flags with decided actions | Proposed (new, owner 2026-11-25) | New module, rules, form field, web, seed |
| G | Payments: period filter on the project page; programme-wide Payments tab in the portfolio | Proposed (new, owner 2026-11-25) | Shared schemas, server query + export, web |

---

## A. UBEC terminology, renamed in depth

### A.1 Decided (owner, 2026-11-25)

| Today | New term | Evidence |
| :--- | :--- | :--- |
| Sprint(s) | **Work phase(s)** | No UBEC equivalent. PCM measures "progress vs work program". Note: PCM also uses "Phase" for its process steps, a different thing |
| Construction (stage and phase) | **Execution** | WEB "project execution"; CM "During Project Execution"; GL "project implementation" |
| Defects liability / liability period | **Defects liability period** | BPP "Defects Liability Period"; CM's alternative is "warranty period" |
| Region (two levels) | **Zone → State** (+ LGA, item C1) | WEB: 6 zonal offices, one per geopolitical zone; state offices in 36 States and the FCT |

The rename is **in depth**: database, API, permission keys, web, mobile, PDFs and emails all use the new terms.

### A.2 Proposed wording (default: adopt)

| Today | Proposed | Evidence |
| :--- | :--- | :--- |
| Nav "Project stages" | **Project cycle** (frees "stage") | The PCM is the *Project Cycle Manual* |
| Stage bar Kick-off · Mobilisation · Construction · Completion · Closure | Kick-off meeting · Site mobilisation · **Execution** · Completion & handover · Project closure | PCM sub-processes |
| "Scope & sprints" (page, step 3) | **BoQ & work phases** | PCM "BoQs" |
| Nav "Reports" ("Visits, reports and findings") | **Monitoring** (tabs Visits · Findings · Site log) | PCM stage "Monitoring & Evaluation" |
| Visit (generic) | **Monitoring visit** ("Visit" where the context is clear) | PCM "Routine Monitoring Visits" |
| Visit submission | **Monitoring report** | PCM "routine monitoring reports" |
| "Baseline" / form "Baseline survey" | **Baseline monitoring** | PCM "Baseline monitoring report" |
| "Re-check" | **Follow-up check** | GL "follow-up monitoring" |
| Finding status "Resolved" | **Rectified** | GL "rectify the anomaly or defect" |
| "Snag(s)" | **Punch list item(s)** | CM "Punch List" |
| "Defect ticket(s)" | **Defect(s)** | – |
| Phase labels Construction / Handover / Defects liability / Closed | **Execution** / Handover / **Defects liability period** / Closed | – |
| Milestone "Contractor on site" | **Mobilised to site** | GL "Mobilisation to Site" |
| Milestone "Programme accepted" | **Programme of works accepted** | PCM p38 |
| "Closure pack" | **Project closure file** | PCM p53 |
| "Closeout report" | **Lessons learned report** | PCM p52 |
| Alert "Site update overdue" / "Spend ahead of progress" | **Monitoring overdue** / **Paid ahead of work done** | – |
| KPI "Sprints verified on time" | **Work phases verified on time** | – |
| Doc types "Contract", "Kick-off minutes", "Kick-off notice receipt", "Supervisor assignment", "Certificate of completion" | **Signed contract**, **Kick-off meeting minutes**, **Evidence of receipt (kick-off notification)**, **Supervisor assignment record**, **Certificate of Completion (CoC)** | PCM |
| Doc type "Condition precedent evidence" | **Remove** (lender leftover; CPs deleted in R1b) | – |
| *(missing doc types)* | Site mobilisation report, Mobilisation compliance report, Baseline monitoring report, Completion verification report, Published contract award notice; consider Site Acceptance Certificate | PCM outputs; CM p107 |
| CoC slots "Head of M&E" / "Head of Physical Planning" | **Director, Monitoring & Evaluation** / **Director, Physical Planning** (with role codes, item B) | PCM; WEB |
| Chain step "Director Legal review" | **Director, Legal review** | PCM |
| Terminology "Independent monitor" | **Independent M&E firm** | PCM "COREN-certified firms" |
| Payment kinds | Add **Mobilisation fee** (new enum value) | GL §4.4(v) |
| *(missing)* | **Stop-work order** on a project with major defects (feature; scope it with the client) | GL §4.4(vi) |

Keep: Milestones, Findings, Defects, Retention, Kick-off, Mobilisation, Needs assessment, Programme of works, Letter of introduction, Site possession form, Handover certificate, Completion notice, Resident Supervisor, Intervention year, KPI labels. Spelling stays British (programme, mobilisation, centre).

### A.3 Proposed code names

| Area | Today | New |
| :--- | :--- | :--- |
| Prisma model / table | `ProjectSprint` / `project_sprints` | `ProjectWorkPhase` / `project_work_phases` |
| Foreign keys | `sprintId`, `startSprintId`, `endSprintId` (units, payments, visits) | `workPhaseId`, `startWorkPhaseId`, `endWorkPhaseId` |
| Enums | `SprintStatus`; facility rule `SPRINT`; `ConstructionPhase` `ACTIVE_CONSTRUCTION`, `HANDOVER_IN_PROGRESS`, `RETENTION_PERIOD`, `COMPLETED_CLOSED`; stage `CONSTRUCTION`; closure gate `HANDOVER_TO_RETENTION`; audit actions `SPRINTS_SAVED`, … | `WorkPhaseStatus`; `WORK_PHASE`; `DeliveryPhase` `EXECUTION`, `HANDOVER`, `DEFECTS_LIABILITY_PERIOD`, `CLOSED`; stage `EXECUTION`; `HANDOVER_TO_DLP`; `WORK_PHASES_SAVED`, … |
| Project field | `constructionPhase`, `constructionPhaseChangedAt` | `deliveryPhase`, `deliveryPhaseChangedAt` (it spans more than execution) |
| Permission keys | `sprints:view_status`, `sprints:verify` | `work_phases:view_status`, `work_phases:verify` |
| Routes | `PUT /scope/sprints`, sprint verification routes | `PUT /scope/work-phases`, … |
| Type config keys | `monitoring.sprintVerificationDays`, sprint-driven visit plan rules, `closure.requireCocFor` values | renamed in the schemas and the seeded types |
| KPI key | `sprints_verified_on_time` | `work_phases_verified_on_time` |
| Shared utils | `validateSprints`, `deriveSprintStatus`, `sprintScheduleStatus`, `sprintForDate`, `unitsActiveInSprint` | `…WorkPhase…` |
| Regions | `Region`, `regionId` | Item C1 (structural change, not a rename) |
| Workbook | Sheet "Sprints"; columns "Start sprint", "End sprint" | "Work phases"; "Start work phase", "End work phase"; version stamp bumped |
| Mobile | SQLite columns and JSON fields carrying `sprint*`; copy "in this sprint" | New SQLite migration |

### A.4 Rules for the rename

**Owner, 2026-11-25:** the database is re-seeded as part of this work (C5), so old audit rows, old drafts, queued phone submissions and old workbook files do not need to survive. That removes most compatibility work:

| Rule | Detail |
| :--- | :--- |
| Rename everything, audit action values included | Safe only because the ledger is re-seeded: the hash preimage includes `action`, `summaryText` and `payload` (`audit.service.ts`). **From the first real deployment on, stored audit rows are never renamed again** |
| One migration with plain renames | No data-preserving tricks needed; still keep every hand-written index and CHECK listed in `CLAUDE.md` (check the generated SQL for drops) |
| No old-name aliases | Routes, outbox fields and workbook headers use only the new names. Field phones get a fresh install for the demo (note in `physical_testing_checklist.md`) |
| Web redirects stay | Old in-app paths (`/scope`, `/milestones`, `?tab=`) keep their redirects; `routes.r6b.test.ts` still checks every `actionUrl` |
| Terminology is no longer display-only for these terms | Enum values, permission keys and API fields follow the new names (owner: in depth) |

### A.5 Done when

- `grep -ri sprint`, `grep -ri region` and `grep -ri construction` (as a stage or phase name; "Construction of …" in project and facility names stays) over `shared/`, `server/src`, `web/src`, `mobile/src` return only migrations and comments naming the history.
- Every surface shows the new terms: web, mobile, PDFs (CoC, handover certificate, closure file index, register PDF), emails, Excel exports, the needs assessment template, seed text, demo pack, demo script, `configuration_reference.md`, `CLAUDE.md`.
- Full gate green on a fresh seed.

---

## B. Roles: full catalogue in the system, small cast in the demo

### B.1 The approach (owner, 2026-11-25: 17 roles is too many to demo)

Two layers:

1. **The system knows UBEC's whole structure.** The role catalogue (B.3, trimmed to 14) is built and seeded, one login each. Settings → Roles shows each role with its PCM responsibility. Every sign-off and approval button names the responsible role ("Awaiting: Director, Legal review").
2. **The demo uses a cast of five.** One click switches between them (B.4). The other nine roles are there for Q&A ("who signs the CoC?" → open the role, or sign in as it).

To show understanding in one minute, the demo deck has a **process map slide** (B.5), not a platform page (owner, 2026-11-25).

### B.2 Principles

1. A role is a **function**. Where UBEC and SUBEBs have the same function (Director Physical Planning, M&E officer, Finance), one role serves both, and the holder's **organisation** (UBEC HQ, a zonal or state office, a SUBEB) sets what they see (D-R7.7).
2. Where the **title** differs and the client will look for it (Executive Secretary vs SUBEB Executive Chairman), there are separate roles even if their permissions are the same.
3. The System Administrator configures the platform but **signs nothing** on projects.
4. Bodies outside the monitoring scope (Tender Board, BPP, FEC, Steering Committee, Bid Evaluation Committee) appear as document signatories or approvals, not users.

### B.3 Catalogue (14 roles)

Surfaces: **Web** = portal only; **Field** = mobile app only (refused on the web, rule R7b); **Both** = same credentials on both. Trimmed from 17: Physical Planning Officer and Management Viewer dropped (add later if asked); SUBEB Director PRS merged into Project Coordinator (same kick-off function, different organisation).

| # | Role | Held in | Surface | Does in the platform | Source |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | **System Administrator** (ICT) | UBEC HQ | Web | Users, roles, workspace settings, form library, facilities, project types, visit plan rules. No project sign-offs | PCM p30 |
| 2 | **Executive Secretary** | UBEC HQ | Web | Programme dashboard, KPIs, register, integrity status; decides Direct Intervention contractor default cases; receives escalations | PCM p6 note 4 |
| 3 | **SUBEB Executive Chairman** | SUBEB | Web | Same as 2 for the state's Matching Grants projects | PCM p38, GL p31 |
| 4 | **Zonal Director** | UBEC zonal office | Web | Oversight of every project in the zone; escalations; reads reports | WEB |
| 5 | **Director, Physical Planning** | UBEC HQ, SUBEB | Web | Process owner: creates projects from the needs assessment, BoQ & work phases, contractor, letter of introduction, Resident Supervisor assignment, raises defaults to Legal, drafts and signs the CoC, activates projects | PCM p6, p24, p27 |
| 6 | **Director, Monitoring & Evaluation** | UBEC HQ, SUBEB | Web | Visit plans, last approval of monitoring reports, work phase verification, handover review, findings escalations, lessons, signs the CoC, verifies signed documents (E4) | PCM p13, p28–30 |
| 7 | **M&E Officer** (QA) | UBEC HQ, zonal/state office, SUBEB | Both | Mobilisation checks, baseline, quarterly M&E, evaluations; reviews Resident Supervisor reports; raises and rectifies findings; records the handover response | PCM p28–31; IRL output 3 |
| 8 | **Project Coordinator** (UBEC State Office; SUBEB PRS) | UBEC state office, SUBEB | Both | Kick-off: notification, meeting, minutes sign-off; letter of introduction delivery; beneficiary handover; joint monitoring of Matching Grants projects | PCM p25–26, p31, p47 |
| 9 | **Resident Supervisor** (SUBEB: Project Supervisor) | UBEC state/zonal office, SUBEB | Field | Weekly supervision visits, baseline, site log, incidents, defect verification photos; 7–10 sites each | PCM p11, p27, p51 |
| 10 | **Director, Procurement** | UBEC HQ, SUBEB | Web | Contract award record: contractor, contract sum, award and acceptance letters, signed contract, published award notice; uploads the annual approved list (E3) | PCM p24 |
| 11 | **Finance Officer** | UBEC HQ, SUBEB | Web | Only role that records payments (interim, mobilisation fee, final, retention release) | PCM p18; GL |
| 12 | **Director, Legal** | UBEC HQ, SUBEB | Web | Reviews contractor default cases; termination procedure | PCM p6, p12 |
| 13 | **Internal Auditor** | UBEC HQ, SUBEB | Web | Read-only everything incl. ledger and payments; integrity checks and red flags (E2, E3); only role that signs the closure audit | PCM p54 |
| 14 | **Independent M&E** (COREN-certified firm) | Firm organisation | Both | Independent monitoring visits and findings on assigned projects | PCM p13 |

**Not users:** contractors (decision P2: emails only), beneficiary school and SBMC (paper, recorded by staff and verified, E4), LGEA Education Secretaries (invited to kick-off by email), Tender Board / BPP / FEC / committees. **Platform operator** (KPMG support): platform super admin, separate login, not a tenant role.

Permissions by area (V view, A act, S sign / approve, D decide):

| Role | Workspace & access | Forms & facilities | Portfolio & projects | Scope & work phases | Contract & kick-off | Visits & findings | Payments & retention | Completion & closure |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| System Administrator | A | A | V (all) | V | V | V | – | V |
| Executive Secretary | – | – | V (all) | V | D default | V | V | V |
| SUBEB Executive Chairman | – | – | V (SUBEB) | V | D default | V | V | V |
| Zonal Director | – | – | V (zone) | V | V | V, escalations | V | V |
| Director, Physical Planning | – | V | A create, activate | A | A, raise default | V | V | A draft CoC, S CoC |
| Director, M&E | – | V | V | S verify | V | A plan, S review | V | S CoC, S handover review, S documents, A lessons |
| M&E Officer | – | – | V (assigned) | V | V | A submit, review, findings | – | A record handover |
| Project Coordinator | – | – | V (state) | V | A kick-off | A submit | – | A record handover |
| Resident Supervisor | – | – | V (assigned) | V | – | A submit, defects | – | – |
| Director, Procurement | – | – | V | V | A contractor, award docs, approved lists | – | V | V |
| Finance Officer | – | – | V | V | V | – | A record, release | V |
| Director, Legal | – | – | V | – | S default review | – | V | V |
| Internal Auditor | V ledger, integrity | – | V (all) | V | V | V | V | S audit sign-off |
| Independent M&E | – | – | V (assigned) | V | – | A submit, findings | – | – |

Separation of duties (unit tests over the default roles): a monitoring report is never approved by its submitter (exists); handover recorded by M&E Officer / Project Coordinator, reviewed by Director M&E (`SAME_PERSON_REVIEW` exists); default raised by Director PP, reviewed by Director Legal, decided by ES / Executive Chairman; only Finance records payments; only Internal Audit signs the closure audit; a signed document is never verified by its uploader (E4); the System Administrator holds no sign-off permission.

### B.4 Demo cast and switcher

| Cast | Shows |
| :--- | :--- |
| **Director, Physical Planning** (UBEC HQ) | New project from the needs assessment (D1), contractor picked from the register (F); kick-off; acts on a contractor flag (F) |
| **Resident Supervisor** (phone) | Monitoring visit with photos and check-in, offline submit |
| **M&E Officer** | Reviews the report, raises a finding, verifies a signed scan (E4: in the demo the M&E Officer verifies; in the catalogue it is Director M&E) |
| **Finance Officer** | Records a payment, sees "Paid ahead of work done" |
| **Executive Secretary** | Dashboard, alerts, contractor register, decides the default case |
| *(optional)* **Internal Auditor** | Red flags (E3) |

The **switcher** is a "Switch role" menu that lists the cast with one line each and signs in as that seeded account in one click. It exists only with the demo flag on (`DEMO_MODE`): the server endpoint answers 404 otherwise, it is never built into a production configuration, and each switch is audited as a normal sign-in.

### B.5 Process map slide (not built in the platform)

One slide per delivery model: the PCM cycle (Needs assessment → … → Project closure; Matching Grants with BEAP), the responsible role under each step, the platform screen that does it, and the PCM timeline ("within 1 week of the kick-off meeting"). Produced with the demo script in the docs phase, from B.3.

### B.6 How it is built

This item **is step 0** of `role_catalogue_migration_plan.md` (the final role matrix). Build it with that plan's section 3.1 and **in the same pass as the seed replacement** (C5). Confirm the catalogue with the client; the plan's questions Q1–Q10 have provisional answers above.

---

## C. Data that matches a government agency

### C1. Zone → State → LGA

**Decision (Claude's call, as asked): drop free-form regions.** State and LGA are fixed national reference data. The zone follows from the state.

| Part | Change |
| :--- | :--- |
| Reference data | `shared/src/data/nigeriaAdminAreas.ts`: 6 geopolitical zones, 36 States + FCT (code, name, zone), 774 LGAs (code, name, state). **Bundled, not an API**: the field app needs it offline, UBEC hosting may restrict outbound calls, and the hosted APIs found are low-use third-party services. Source: an open dataset (research notes 4), checked against the official list (37, 774, FCT's 6 area councils). Unit test on the counts |
| Project | `stateCode` and `lgaCode` replace `stateLocation`, `lgaLocation` and `regionId`; zone derived (with C2, these live on each site; the project keeps the state) |
| Web | State dropdown, then LGA dropdown filtered by state (searchable); zone read-only |
| Filters and exports | `zone`, `state`, `lga` replace `regionId` (directory, portfolio, KPIs, register export, visit planner) |
| Organisations | Optional `stateCode` on organisations (SUBEBs, UBEC state offices) so ownership can be derived (D2) |
| Workbook | State and LGA as dropdowns (LGA dependent on State through named ranges) |
| Removed | Regions module, Settings → Regions, `regionId` everywhere |

### C2. Multi-site projects (decided: sites inside the project)

**What the client's register shows (owner, 2026-11-25; the file is real data and stays with the owner):** a project is a **shared goal**, not "do X at school Y". Example: "Renovation, Equipment and Furnishings of Public Schools", 10 sites across 5 LGAs of one state. A project row has a "Number of Sites"; sub-rows per site carry their own completion %, facility breakdown and status; the contractor and the inspector are repeated on every sub-row (the same for all sites so far, not confirmed as a rule). PCM p20: "Projects are packaged into lots".

**Model (decided, option A):**

| Level | Holds |
| :--- | :--- |
| **Project** (the lot/batch: one contract) | Description (the shared goal), project ID (C3), state, delivery model, intervention year, funding source, the contractor (one; decision T stays), contract sum, milestones, kick-off, payments, retention, default cases, CoC |
| **Site** (`ProjectSite`, new) | School name and level (ECCDE / Primary / JSS), LGA, address or coordinates and its own boundary (D3), its Resident Supervisor (defaults to the project's), facility units and BoQ lines, status, completion % (from its lines), handover |
| Roll-up | Project completion = budget-weighted over all sites' lines (today's rule, one level up); project status and alerts consider every site ("2 of 10 sites behind") |

Defaults: visits are planned and generated **per site** (each with its own officer and calendar, D4); the field app lists sites as separate places to visit; check-in uses the site's boundary; the visit form is assembled from that site's units. CoC per project; handover per site (PCM p31: handover to "the beneficiary school/community"); the project enters the defects liability period when every site is handed over. A one-site project keeps today's screens. The portfolio map shows one pin per site; the register shows the project row expandable to its sites, as the client's spreadsheet does. The register import (and its template) reads project rows with site sub-rows.

**Owner's answers (2026-11-25):** all sites of a project are in **one state**; **one contractor** for all sites (repeated on every sub-row); **one Resident Supervisor per project** whatever the number of sites; internal and external M&E officers can be assigned to individual sites. Contract sums are **per project**.

**The client's register columns** (the register import template mirrors them): SN · CODE/LOT · Project description · Location · LGA · State · Number of Sites · Contractor per site (one sub-row per site) · Percent completion per site · Status per site · Contractor · Contract sum · Resident supervisor · one column per facility with its quantity (e.g. Toilets 5, Classrooms 7).

So the Resident Supervisor is set on the **project** (not per site); M&E officers are assigned per visit, and visits carry the site.

Site statuses (owner confirmed): Not started, Ongoing, Behind, Completed, Handed over. The 50 facility columns and their archetypes are in `working_plan.md` appendix A; the UBEC facility catalogue uses them.

### C3. UBEC project IDs generated automatically

`irl_follow_ups.md` deferred the convention "until UBEC sends it". The client's register (owner, 2026-11-25): 2024 rows use `DI-2CLR n` / `REN n`; **every 2025 row uses `LOT x BATCH y`, which replaces the older codes** (deprecated). Lots are numbered in order within the year: the first lot (category of project) takes the lowest number and each new lot the next one; batches number the projects within a lot.

**Decided (owner):**

| Part | Detail |
| :--- | :--- |
| Stored code | The project code itself (`Project.codePrefix`) is `{year}-LOT-{lot}-BATCH-{batch}`, e.g. `2026-LOT-5-BATCH-7`. Unique per tenant because the year is in it |
| Display | Shared `formatProjectCode(code)`: when the code matches `^\d{4}-LOT-\d+-BATCH-\d+$`, drop everything before the first hyphen and turn the other hyphens into spaces ("LOT 5 BATCH 7"); any other code is shown as stored (older seeded `PRG-102` stays as is) |
| Year | Tables (register, payments, visits planner, contractor projects) gain an **Intervention year** column so equal display codes from different years are told apart |
| Lots | `ProjectLot` (tenant, intervention year, number, title, e.g. "Renovation, Equipment and Furnishings of Public Schools"). Project creation picks an existing lot of the year or creates the next one; the batch is the next number in the lot. Assigned inside a per-tenant advisory lock; the code is previewed ("will be LOT 5 BATCH 7") |
| Validation | `PROJECT_CODE_PREFIX_REGEX` is widened to accept the new form (the old `AAA-999` form stays valid for existing data) |
| Legacy | `DI-2CLR n` / `REN n` are never generated; the register import keeps a legacy code in `externalReference` |

### C4. Funding source as a dropdown

Fixed list from GL's fund components and WEB's programmes: Matching Grant · Direct Intervention (Educational Imbalance Fund) · Good Performance Fund · Special Needs Education Fund · Constituency Projects · Zonal Intervention Projects (ZIP) · North East Intervention · Development partner (with a partner name, e.g. BESDA-AF, HOPE-EDU) · Other (specify). Stored as a code; the register import maps known labels and refuses unknown ones. Ask the client whether the list is complete.

### C5. Realistic seed (owner, 2026-11-25)

Replaces the target data in `seed_replacement_plan.md` section 2 (its ~30 projects become 18); its slices S1–S6 still apply.

**Geography (owner: 18 projects, 10 of them in the north):** about 50 sites, in all six zones, denser around Abuja, Lagos and the north:

| Zone | States (projects) |
| :--- | :--- |
| North Central | FCT (3), Niger (1) |
| North West | Kano (2), Kaduna (2), Sokoto (1) |
| North East | Borno (1) |
| South West | Lagos (3), Oyo (1), Ogun (1) |
| South East | Enugu (1), Anambra (1) |
| South South | Rivers (1) |

Projects are shared goals with 1–10 sites in different LGAs of one state (C2), e.g. "Renovation, Equipment and Furnishings of Public Schools" with 8 sites in 4 LGAs. Real LGAs. A SUBEB for every state with a Matching Grants project; UBEC HQ → 6 zonal offices → state offices. About 10 contractors in the register (F) with a spread of ratings: one flagged, one inactive waiting for its contract, one with a completed history.

**Three demo projects carry the walkthrough; 15 background projects make the portfolio, map, alerts and KPIs look real (Ogun and Anambra are plain on-track and mobilising projects):**

| Demo project | Story |
| :--- | :--- |
| **1. On track** (Direct Intervention, FCT, 3 sites) | Execution; weekly reports approved with photos; one finding raised and rectified on a follow-up check; interim payments; the live Resident Supervisor visit happens here |
| **2. In trouble** (Matching Grants, Kano, 6 sites in 3 LGAs) | 2 of 6 sites behind schedule; a late report and a missed visit; an open critical finding past escalation; "Paid ahead of work done"; red flag (budget differs from the approved BEAP, E3); **contractor flagged** after repeated low workmanship ratings (F), the demo picks an action |
| **3. Closing out** (Direct Intervention, Lagos, 2 sites) | CoC issued, both sites handed over, in the defects liability period with one open defect; retention held; closure checklist nearly done; the demo closes, archives and exports the closure file |
| *Live* | A new project created from the needs assessment template in the demo pack (D1), with fields flagged "Needs your input" and the contractor chosen from the register |

**Scenario coverage** (every scenario exists somewhere; the demo opens the ones in bold):

| Scenario | Project |
| :--- | :--- |
| **Approved monitoring reports with geotagged photos** | 1 |
| **Finding rectified on a follow-up check** | 1 |
| **Late report, missed visit, sites behind schedule** | 2 |
| **Open critical finding escalated** | 2 |
| **Paid ahead of work done** | 2 |
| **Red flag: needs assessment vs approved list mismatch** | 2 |
| **Contractor flagged, action decided** | 2 |
| **Defects liability period, open defect, retention held** | 3 |
| **Close, archive, closure file** | 3 |
| Stalled (no progress for 30 days) | background (Borno) |
| Mobilisation late → default case waiting for the ES | background (Sokoto) |
| Kick-off planned; mobilisation under way; contractor inactive until its contract is verified | background (Kaduna, Niger) |
| Handover of some sites recorded, waiting for review | background (Oyo) |
| CoC waiting for signatures; signed scan flagged (a changed amount, E4) | background (Enugu) |
| Closed and archived | background (Rivers) |
| Imported historical project (earlier intervention year) | background (Kano) |
| Drafts (one from a needs assessment with gaps) | background (FCT, Lagos) |
| Final payment before CoC (payment exception) | background (Kaduna) |

**Realism:** WEB-style names ("Construction of a Block of Two (2) Classrooms with Office & Store and Supply of Furniture …", "Renovation, Equipment and Furnishings of Public Schools"); renovation, VIP toilets, motorized boreholes, perimeter fencing, ECCDE centres; fictional but plausible contractor names (no real firms); Nigerian names for every login; contract sums by facility type in ranges to confirm with UBEC (seed plan: ₦40m–₦300m per project); specimen PDFs on UBEC letterhead with PCM document names; IDs from C3; intervention years 2025–2027 (D5); 6–9 months of history on long-running projects; Resident Supervisors at 7–10 sites. Seed time: history across ~50 sites is written in bulk where services would be slow (seed plan section 2), target under 3 minutes.

### C6. Government-agency requirements

Already planned in `irl_follow_ups.md`: MFA, short sessions, password reset and policy, sign-in log, SMTP email, hosting package. Added (proposals):

| Item | Proposal |
| :--- | :--- |
| Data protection | Nigeria Data Protection Act 2023: privacy notice in web and field app, purpose and retention of personal data (users, photos, voice notes, specimen signatures in E4), retention setting for archived projects. Confirm UBEC's DPO requirements |
| Safeguarding at schools | Field app camera hint "Photograph the works, not pupils"; same line in photo help text |
| Official formats | Dates DD/MM/YYYY; ₦ with two decimals; numbers in generated letters written "two (2)" |
| Reference data | National lists (C1, C4), not free text, wherever reports roll up |

---

## D. Project creation flow

### D1. Start from the needs assessment (template parsing; AI fallback later)

**Owner, 2026-11-25:**
- "No AI" (decision Z) was an internal assumption, not a UBEC requirement; the senior manager (in contact with UBEC) has overruled it. AI is allowed in principle.
- **For the demo, template parsing only**: the demo uses our template. The AI path is **not built now**. It is put to UBEC as an open question: adopt the structured template, or accept AI parsing of free-form documents, which sends documents outside Nigeria and needs NDPA work (consent, transfer basis, DPIA).
- When the AI path is built, rewrite decision Z in `CLAUDE.md` as: *"AI may assist with document parsing and checks; it never decides. Every AI result is a suggestion a named person confirms, and the feature can be switched off per workspace."* Until then the rule stays as written.

| Part | Design |
| :--- | :--- |
| Entry | Step 1 opens with **"Upload needs assessment"** (primary) and "Start without one" (secondary) |
| Template path | Deterministic: the UBEC needs assessment template (`buildScopeWorkbook` / `parseScopeWorkbook`) gains delivery model, project category (C3), State, funding source and intervention year dropdowns, and a **Sites sheet** (C2: school, school level, LGA dropdown, address or coordinates), with facility units and BoQ lines naming their site |
| Not the template | For the demo: a clear message ("This file is not the UBEC needs assessment template: download the template, or start without one") and the file can still be attached as a document. Later: the AI path (D1.1) |
| Server | `POST /api/v1/projects/from-needs-assessment/preview` (nothing written; returns values, their source, and issues) and `/confirm` (same sha256; creates the draft, applies the type, assigns the project ID (C3), imports sites, work phases, units and BoQ in one transaction; audit `PROJECT_CREATED` + `SCOPE_IMPORTED`). The response carries a `source` per value (`TEMPLATE` now, `AI` later) so the AI path adds no contract change |
| Wizard | Filled fields show a "From needs assessment" tag; missing or doubtful fields are highlighted "Needs your input" and listed at the top of each step; activation is blocked until they are done |
| Validation | After parsing, the cross-checks of E3 run (budget vs the approved list, location, duplicates) and show as warnings in the preview |

#### D1.1 AI adapter (later; not built for the demo)

Recorded so the later build has the design. Used by the D1 fallback and, optionally, the E4 signature-box check.

| Part | Design |
| :--- | :--- |
| Model | `claude-opus-5-5` (Claude Opus 5.5) through the official `@anthropic-ai/sdk`, with the server-side refusal `fallbacks` option on |
| Input | PDFs as document blocks (up to 32 MB / 600 pages per request); scans and photos as image blocks; Word converted to PDF or text on the server first; spreadsheets read by our own parser and passed as text |
| Output | Structured outputs (`output_config.format`) with a JSON schema generated from the shared Zod contract, so the result is always well-formed; validated again with Zod on our side |
| Records | Each call stored: model id, prompt version, input sha256, output, who confirmed what. Audited |
| Switch | `AI_PROVIDER=anthropic\|none` plus a workspace setting; tests use `none` and a stub; the platform works fully without it |
| Data handling | Documents leave UBEC's network to Anthropic's API: on-prem hosting needs outbound HTTPS, and cross-border processing of personal data falls under the NDPA, so UBEC must agree. There is no in-country processing option. Keep inputs to what the check needs (no voice notes, no unrelated documents) |
| Behaviour | Every AI value tagged "AI-suggested: check" with the page it came from; each must be confirmed by the user before save |

### D2. Organisations section: not needed in creation

**Decision (Claude's call, as asked): remove the "School and organisations" section from the wizard.** Every value is derived:

| Field | Derived from |
| :--- | :--- |
| Owner organisation | Direct Intervention → the UBEC State Office of the project's state (so the Zonal Director sees it through the tree); Matching Grants → the state's SUBEB |
| Funder | Direct Intervention → UBEC; Matching Grants → UBEC (Matching Grant, 50:50 with the SUBEB counterpart, shown as text) |
| Independent M&E firm | Assigned in step 4 Team & visits, when one is engaged |
| Beneficiary school | Moves into each site (C2): school name, school level (ECCDE / Primary / JSS) |

Shown on the Review step; changed under Project settings → Advanced (Director Physical Planning or System Administrator). `parties` stays as a server section for live projects.

### D3. Location: address or coordinates (owner, 2026-11-25)

| Part | Design |
| :--- | :--- |
| Input | Per site, a switch: **Address** (typed; geocoded by the server; the address stays on screen and on reports) or **Coordinates** (latitude/longitude, or paste a Google Maps link / "lat, lng"). Either way the map shows a pin and a radial boundary of the workspace default radius; the user can drag the pin |
| Provider | Google Geocoding API behind a server proxy (key never in the browser or app); adapter `google` / `none` like the messaging adapters; tests use `none`. Owner: the free allowance (10,000 requests a month) is more than enough |
| Accuracy | Rural school addresses often resolve only to the town: the form shows the match quality ("Street", "Town only"), and when the Resident Supervisor checks in on the baseline visit, an officer can **set the boundary from the check-in GPS** (audited) |
| Needs | Billing account holder; outbound internet from UBEC's hosting |

### D4. Visit plan as a calendar

The `visits` setup section shows a **month calendar** of the proposed visits (from `generateVisitDates`, the type's visit plan and the work phases), colour-coded by visit kind. Above it, the frequency in words: "Routine monitoring: weekly on Tuesday during execution · Mobilisation check: every 2 weeks until mobilised · Quarterly M&E · Final evaluation at completion". With multiple sites (C2), a site switcher and one schedule and officer per site. Click a day to add an ad hoc proposal; drag to move within the planner's tolerance rules. Reuse the planner calendar components from `/app/visits`.

### D5. Intervention year validation (decided: January–December)

The PCM line on slide 7 ("submitted … by 31st of September in each year for the succeeding year") is a **submission deadline for next year's plan**, not the start of a fiscal year. It fits a January–December year: needs assessments in September/October, ES approval by 31 October, budget to the Ministry, appropriation for January. (Side note for the PCM authors: September has 30 days; the deadline should read 30 September.) Nigeria's 2026 budget was backdated to April, so the start month is a setting, not a constant.

| Part | Detail |
| :--- | :--- |
| Setting | `Tenant.fiscalYearStartMonth` (Settings → Workspace settings), default **January** |
| Rule for new projects | Intervention year = **current year or next year** (next year because projects are planned a year ahead, per the PCM); the form offers only those |
| Historical records | Earlier years only through the register import, or a "Historical record" switch on the draft (Director Physical Planning or System Administrator, reason required, audited), created as imported |
| Where checked | Shared pure function `allowedInterventionYears(today, startMonth, zone)`, used by the web form, the `basics` save, draft creation, the needs assessment import and the register import (historical allowed) |

---

## E. Security, integrity and malpractice controls

### E1. Security (discuss in the demo, build later)

| Topic | What to say in the demo | Build later |
| :--- | :--- | :--- |
| MFA | Authenticator-app MFA for every web user, required for admins and signatories | `irl_follow_ups.md` §1 |
| Encryption in transit | HTTPS only (TLS 1.2+, HSTS); the field app pins the server certificate | Certificate pinning in the mobile app |
| Encryption at rest | Database and file storage on encrypted volumes; encrypted backups; sensitive columns (phone numbers, specimen signatures, E4) encrypted by the application with keys in a key vault, not in the database | Column encryption helper, key vault integration |
| Field evidence | Every photo is hashed and signed by the device that took it, geotagged, with compass heading (exists) | – |
| Sign-in policy, sessions, password reset | As in `irl_follow_ups.md` | – |

**Pushback on "API payload/response encryption":** encrypting request bodies on top of HTTPS adds little against the threats that matter here, hides traffic from UBEC's web application firewall, and adds key management to every client. The stronger controls are certificate pinning in the field app, signed field submissions (photos are already signed by the device), and column-level encryption of the few sensitive fields. Recommend these instead.

### E2. Tamper evidence beyond the audit ledger (demo talking points; build later)

**Owner, 2026-11-25:** present these in the demo; implement later; no Integrity page now. The design below is what the talking points describe and what the later build follows.

**The gap:** on an on-prem server, anyone with database access can change a row (a payment amount, a progress %, an approval) without going through the platform, and could even rewrite the audit ledger and recompute its hash chain, because the chain uses a plain SHA-256 anyone can recompute. Honest framing: no system whose administrators have full control of the servers is tamper-*proof*. It can be made tamper-*evident*: any change made outside the platform is detected and reported, and the history before the last anchor cannot be rewritten unnoticed.

| Layer | Design |
| :--- | :--- |
| 1. Record seals | For the records that matter (payments, approvals and sign-offs, monitoring reports and their answers, findings, defects, CoC, handover, documents and versions, project contract fields, users and role grants), every write through the platform stores a hash of the record's canonical state in the audit event of the same transaction. A nightly integrity job (and an on-demand "Check now") recomputes each sealed record's hash and compares it with the last sealed state. A difference = changed outside the platform |
| 2. Signed ledger | Each ledger entry is also signed (Ed25519) with a key held by the application server or a key vault/HSM, never stored in the database. A database administrator can no longer forge entries or recompute the chain without that key |
| 3. External anchors | Every hour (setting) the current chain head is anchored outside the server: an RFC 3161 timestamp from a trusted timestamping authority, and a copy sent to a write-once location (WORM/object-lock storage, or a daily email to Internal Audit and KPMG). Anchors prove the ledger's state at that time; anything earlier cannot be rewritten without detection |
| 4. Database controls | The platform's database user can only `INSERT`/`SELECT` the ledger (grants plus a trigger refusing `UPDATE`/`DELETE`); pgAudit logs database-level statements (including administrators') to a log server the DBA does not control. Requires the hosting team (`irl_follow_ups.md` §3) |
| 5. Files | Every document and photo already has a SHA-256 recorded; the integrity job re-hashes stored files and flags any that changed or vanished; storage with versioning or object lock where the hosting allows |
| 6. Separation of custody | The DBA, the holder of the signing key and the Internal Auditor are different people; key custody written into the hosting runbook |

**Later build (not now):** an Integrity page (Internal Auditor, Executive Secretary): last check, anchors and their receipts, ledger verification, sealed-record mismatches (record, field, sealed value vs current value), file mismatches. A mismatch raises a red flag (E3), notifies Internal Audit and the ES, and blocks the affected project's next gate until Internal Audit records a disposition. The closure file includes the integrity report.

**In the demo:** one slide with the six layers and the honest framing (tamper-evident, not tamper-proof), plus what exists today: the hash-chained ledger with chain verification in the closure file, device-signed and hashed photos, hashed documents.

### E3. Annual approved project lists and cross-checks

**Answer to the owner's question:** no, there is no place today for the annual needs assessment. The platform holds a needs assessment **per project** (the template in setup step 3, plus documents in the "Needs assessment and standards" section). Nothing holds the programme-level list a project should match.

| Part | Design |
| :--- | :--- |
| Where | Platform level (owner): **Needs assessment** in the workspace sidebar beside Portfolio, Contractors and Settings (`/app/needs-assessment`), not inside a project |
| Annual lists | New programme-level register per intervention year: **Approved Projects & Implementation Schedule** (Direct Intervention, approved by the ES, PCM p17) and **Approved BEAP** per state (Matching Grants, approved by UBEC, PCM p43). Uploaded by the Director Procurement or Director Physical Planning (template first, AI fallback as D1), with the approval letter attached as a verified document (E4). Rows: project, school(s), state, LGA, facility scope, cost estimate, lot |
| Link | Every project links to its row in the approved list. Activation needs the link (PCM: "Only validated and prioritised projects … shall be integrated into the budget"); an exception needs a reason, Director PP plus ES approval, audited |
| Checks (deterministic rules) | Project budget vs approved estimate (tolerance setting, default ±10%); contract sum vs budget; state/LGA/school differ from the list; facility counts differ; the same school and facility funded in the same or the previous two years (double funding); one approved row linked to two projects; contractor on more concurrent lots than a set limit; **the same photo reused across sites** (perceptual hash, which captures already store); check-ins outside the boundary (exists); report submitted long after the visit date; paid ahead of work done (exists); payment above contract sum (exists); a flagged contractor (F); later, a tamper mismatch (E2) |
| Red flags register | Each hit is a red flag: rule, severity, evidence, project; Internal Auditor and Director M&E see the list; disposition (explained / escalated / false positive) with a reason, audited; open high-severity flags block the next gate (setting) |
| Demo | Project 2 shows "Budget ₦84.0m vs approved BEAP ₦71.5m (+17%)" as a red flag |

### E4. Signed paper documents: verified before the project moves on

The owner's ask: physical documents with physical sign-off; an AI check that signatures look valid; projects cannot progress until a document is confirmed by AI and human review.

**Pushback, and a stronger design:**

1. **AI cannot tell whether a signature is genuine.** At most it can say a box is signed and something looks altered or pasted.
2. **The strongest control is not on paper.** UBEC and SUBEB staff sign in the platform with their own accounts (with MFA, E1). Paper is only needed for people without logins: the contractor, the school head and SBMC, community representatives.
3. **Bind every paper form to the platform with a QR code and compare it with the original** (owner's choice, below). This stops reused, fabricated and altered forms without AI.

**Owner, 2026-11-25 (decided):** the platform keeps the original of every form it issues, with its QR code. The signed scan is compared with that original: **anything changed other than the signature, signed date and name fields is flagged** (text, dates, amounts, quantities, names of parties).

| Step | Design |
| :--- | :--- |
| Document types | New flag `requiresVerifiedScan` on document types: kick-off meeting minutes, site possession form, mobilisation agreement, letter of introduction acknowledgement, CoC (beneficiary slot), handover certificate (per site), signed contract (F: activates the contractor), approved list approval letter |
| Issuing the form | The platform generates the form as a PDF, pre-filled with the project, site, parties, values and expected signatories. Each page carries a QR code (document id, version, page number, hash of the page content) and four corner alignment marks. The **fill-in zones** (signature, signed date, printed name; per signatory) are declared in the form template with their page coordinates. The original PDF and its layout are stored with the document (sha256 recorded) |
| Upload | Scan or phone photo (web or field app). Every page's QR is read: a page from another project, another form, an old version or a home-made form is refused at once |
| Comparison (deterministic, on our server, no AI, no data leaves UBEC) | Each page is aligned to its original with the corner marks (deskew, scale). The fill-in zones are masked. The rest is compared two ways: (1) **text**: OCR of the scan (Tesseract, run locally) against the original's known text, word by word, so a changed amount, date or name is reported as "₦12,400,000 → ₦14,200,000, page 2"; (2) **image**: a pixel difference of the aligned pages outside the masks, so handwritten additions, crossings-out and pasted strips are found even where OCR reads nothing. Each difference is a flag with its page location and a highlighted crop |
| Fill-in zones | Checked for presence only: each signature zone has ink (pixel density above a threshold); each date and name zone is not blank. Missing signatures are flags. Handwriting is not read |
| Human verification | A reviewer who did not upload it (Director M&E; in the demo the M&E Officer) sees the original and the scan side by side with the flags highlighted, and marks the document **Verified** or **Rejected** with a reason (a flag can be accepted with a reason, e.g. "stamp overlaps the table"). Audited |
| Gate | The milestone or transition that needs the document (kick-off held, mobilised, contractor active, CoC beneficiary slot, handover accepted) waits until it is Verified. Reuses the pattern where a document sign-off completes a milestone |
| Paper not issued by the platform | Allowed only with a reason, reviewed with no comparison, and marked "Not platform-issued" on the document and in the closure file |
| Later (optional) | AI check of the fill-in zones (is the signature plausible, does it match earlier verified ones) through D1.1, subject to the NDPA question; specimen signature register |

Accuracy note: phone photos of creased paper align less well than flatbed scans; the threshold settings are tuned on real samples, and the field app's camera shows a page frame to guide the shot. A comparison that cannot align a page reports "Could not compare page 3" instead of passing it.

---

## F. Contractor register, reliability rating and performance flags

**Owner, 2026-11-25 (new feature):** when several reports (configurable) reflect badly on a contractor (e.g. workmanship 3 or below out of 5), flag the contractor; an admin decides what to do (replace the contractor, dock pay, schedule more visits, …) through actions in the portal. A contractors page lists every contractor mobilised, current and previous, with a 0–5 star reliability rating calculated from reports. Project creation picks the contractor from a dropdown showing the stars, and can create a new one there. A contractor stays **inactive** until its contract is uploaded and verified.

**What exists:** contractors are `Organization` rows tagged `CONTRACTOR` (with `registrationNumber`, contact fields); one contractor per project (`ProjectContractor`, decision T; `contractStatus` ACTIVE/TERMINATED); every routine and quarterly M&E visit form already has a 1–5 "Overall workmanship" rating (`s:WORKMANSHIP/workmanship`; ≤ 2 raises a MAJOR finding); closure ratings per contractor on five criteria (Time, Quality, Health & safety, Responsiveness, Documentation; Phase 15) with `/app/organizations/:id/ratings`; default cases with the Legal → ES chain. Contractors have no login (decision P2) and that stays.

### F.1 Contractor register

| Part | Design |
| :--- | :--- |
| Page | `/app/contractors` (workspace nav). List: name, RC number, status, stars (with report count), current and completed projects, states worked in, open flags. Filters: status, state, work category, flagged. Export to Excel (same style as the other exports) |
| Detail | Profile (RC number from CAC, TIN, address, state, contact person, email, phone, work categories), rating with its breakdown and trend, projects (current and previous, with each project's outcome), flags and the decisions taken, documents (signed contracts, performance securities, warning letters) |
| Who | View: Executive Secretary, SUBEB Executive Chairman, Zonal Director, Director Physical Planning, Director M&E, Director Procurement, Internal Auditor (new key `contractors:view_register`). Create and edit: Director Procurement and Director Physical Planning (`contractors:manage`, exists). Owner's "admin-only" read as these management roles, since there is no single admin any more (B) |
| Duplicates | RC number is unique per tenant; creating a contractor first searches by RC number (exact) and name (close match) and offers the existing record |
| Status | **Inactive** (created; can be named on a draft) → **Active** (its signed contract for a project is uploaded and Verified, E4) → **Suspended** (by a decision, F.4: cannot be picked for new projects; current projects continue) → optionally **Debarred** (later, if UBEC records debarments). Each change audited with its reason |
| Per project | The engagement (`ProjectContractor`) has its own status: **Pending contract** → **Contracted** (signed contract Verified) → Completed / Terminated. A project cannot activate (and the kick-off notice cannot go out) until its engagement is Contracted. Imported live projects (register import) come in Contracted, with "imported" as the reason |

### F.2 Picking the contractor in project creation

Searchable dropdown (step 2 Contract): name, RC number, stars and report count, status, active projects, open flags. Inactive contractors show "Contract not yet verified"; suspended ones are listed greyed with the reason and cannot be picked. "+ New contractor" opens a short form (name, RC number, contact) and creates it Inactive.

**Pushback on what the stars do here:** under the Public Procurement Act the award is made before the project is set up (Tender Board, BPP "No Objection"), so the person creating the project is *recording* the awarded contractor, not choosing one. Stars in this dropdown are information, not a selection aid. The place where past performance can legitimately influence awards is the bid evaluation and due diligence (PCM p10, p23: "reference validation"). So also provide a **Contractor performance report** (PDF/Excel per contractor: rating, breakdown, projects, flags, decisions) for the Bid Evaluation Committee.

### F.3 Reliability rating (0–5 stars)

A pure shared function (`contractorReliability(facts, settings)`), facts loaded in batches like the KPIs, recomputed nightly (and when a report is accepted) into a snapshot per contractor so lists stay fast.

| Input (approved data only) | Weight (default, tenant setting) |
| :--- | :--- |
| Workmanship rating on accepted monitoring reports (1–5) | 40% |
| Schedule: share of its work phases verified MET on time, and mobilisation on time | 20% |
| Findings: major and critical findings per report, and how fast they were rectified, scaled to 1–5 | 20% |
| Closure ratings (the five Phase 15 criteria, average) when the contractor has completed projects | 20% (spread over the others until it has one) |

Recent reports count more (24-month window; weight halves every 6 months, settings). Shown only from 5 approved reports ("Not yet rated: 2 reports"). Displayed as stars to the half star plus the number and the basis: "★★★½ 3.6 · 42 reports on 5 projects". The detail page shows each component, so the rating can be explained if a contractor disputes it.

### F.4 Performance flags and actions

| Part | Design |
| :--- | :--- |
| Rule (tenant settings) | Flag a contractor on a project when **N** (default 3) accepted reports within **D** days (default 60) rate workmanship at or below **T** (default 3 of 5). Optional extra triggers (switches): a critical finding open past escalation; a site behind for 2 work phases; contractor-wide rating below 2.5 |
| Flag | One open flag per contractor and project; later negative reports join it as evidence. Notifies Director PP and Director M&E of the owning organisation and the ES / Executive Chairman (web category `CONTRACTOR_FLAGGED`). Shown on the contractor, the project overview's contractor card, the alerts and the red flags register (E3) |
| Decision | Director PP opens the flag, sees the evidence (reports, ratings, photos, findings) and records one or more actions with a reason |

| Action | Effect in the platform | Approval |
| :--- | :--- | :--- |
| Schedule additional site visits | Proposes extra visits for the affected sites (count, kind, officer) in the visit plan | Director M&E, at once |
| Formal warning | Generates a warning letter (UBEC letterhead) from the evidence; emailed to the contractor; stored as a document | Director PP |
| Payment hold | The engagement shows "Payment hold" to Finance; a payment recorded during the hold needs an override reason and is flagged (`PAID_DURING_HOLD` exception) | Legal review → ES / Executive Chairman (the existing default-case chain) |
| Deduction | A deduction instruction (amount, contract clause, e.g. liquidated damages) that Finance applies on the next payment; the payment record shows it as a line | Legal review → ES / Executive Chairman |
| Stop-work order | GL §4.4(vi): project or site marked "Stop work"; monitoring continues; payments held | Legal review → ES / Executive Chairman |
| Replace contractor | Terminates the engagement (exists, through the default case) and opens a new engagement for the remaining scope (F.5) | Legal review → ES / Executive Chairman |
| Suspend contractor | Contractor status Suspended (no new projects) | ES |
| No further action | Closes the flag with the reason | Director PP |

**Pushback on "dock pay":** payments are made outside the platform, so the platform can only instruct and check (a deduction line and an exception if it is not applied). A deduction needs a contractual basis, so it always goes through Legal review.

### F.5 Replacing a contractor (changes decision T)

Today a project has exactly one contractor and `syncProjectContractors` refuses a second (decision T). Replacement needs **sequential engagements**: one Contracted engagement at a time; the terminated one keeps its history, payments, retention balance and ratings (the per-engagement balances already exist from Phase 10); the new engagement takes the incomplete sites, units and lines; milestones re-sync for it; a new kick-off for the new contractor. This is a separate slice; for the demo, "Replace contractor" can stop at the approved termination, with the new engagement shown as the next step.

### F.6 Model and permissions

New: contractor fields on `Organization` (or a `ContractorProfile` beside it: status, TIN, address, state, work categories); `ContractorFlag`, `ContractorFlagAction` (action, parameters, approval reference, decided by); `ContractorRatingSnapshot`; engagement status on `ProjectContractor`; payment hold and deduction on the engagement and payment record; permission `contractors:view_register`; audit actions for create, status change, flag raised, action decided; settings group "Contractor performance" (weights, window, flag rule). Seed: about 10 contractors with a spread of ratings, one flagged on demo project 2, one Inactive (C5).

---

## G. Payments by period, and across the programme

**Owner, 2026-11-25:** add period filtering (per month, per quarter, …) to the payments page, and a Payments tab in the portfolio covering all payments in the period (default: the timeframe of the annual needs assessment), filterable by zone, state, LGA and so on.

**What exists:** `ProjectPayment.paidOn` (YYYY-MM-DD, project zone), kinds INTERIM / FINAL / RETENTION_RELEASE (+ Mobilisation fee, A.2), gross / retention held / net, exceptions, voiding. The project page (`/app/projects/:id/payments`) filters in the browser by search, kind, sprint (work phase) and exceptions only; the export takes the same filters. There is no programme-wide payments screen (`CLAUDE.md` Exports: "There is no programme-wide findings or payments screen").

### G.1 Period filter (shared by both screens)

| Part | Design |
| :--- | :--- |
| Presets | This month · Last month · This quarter · Last quarter · Quarter picker (Q1–Q4 of a fiscal year) · This fiscal year · Fiscal year picker · Intervention year (G.2 default) · Custom range (from–to) · All time |
| Fiscal basis | Quarters and years follow `Tenant.fiscalYearStartMonth` (D5; January by default, so Q1 = January–March). A shared pure helper `periodRange(preset, today, startMonth)` returns `{ from, to }` |
| Filtering | By `paidOn`, inclusive; server-side (`from`, `to` query parameters), so totals and exports match the screen. The project page moves its filtering to the server for this |
| Grouping | Optional "Group by month / quarter" with subtotals per group (gross, retention held, net), voided payments excluded from totals as today |
| URL | Period kept in the URL like the other filters |

### G.2 Portfolio → Payments tab

| Part | Design |
| :--- | :--- |
| Where | A **Payments** tab on the workspace home beside Projects, Visit planner and KPIs; `payments:view` only (Finance, ES, Executive Chairman, Zonal Director, Directors, Internal Auditor per B.3); the directory's visibility rule applies (a SUBEB sees its own projects) |
| Default period | The **intervention year of the latest approved list (E3)**, i.e. the fiscal year that list covers. Until E3 is built: the current fiscal year. Interpretation of "the timeframe set in the annual needs assessment" (Q18) |
| Filters | Period (G.1); zone, state, LGA (C1; LGA matches projects with a site in that LGA, C2); delivery model; project category (C3); intervention year; funding source (C4); contractor (F); project; payment kind; exceptions only; include voided |
| Summary | Cards: total gross paid, retention held, retention released, net paid, number of payments, payments with exceptions; **paid vs contract sum** and **paid vs % complete** for the filtered projects (the IRL "money against progress" view) |
| Breakdown | Toggle table: by zone, state, LGA, contractor, project or month, each row with the same totals (drill down: zone → state → LGA → project) |
| List | Payments table (StandardTable): date, project ID and name, state, contractor, kind, reference, gross, retention, net, exceptions; row opens the project's payments page |
| Export | `GET /api/v1/payments/export.xlsx` with the same filters (sheets: Summary, Breakdown, Payments), in the shared export style; "Paid to date" rules as today |
| Server | `GET /api/v1/payments` (list, paged) and `GET /api/v1/payments/summary` (cards + breakdown), with a shared `PortfolioPaymentsQuerySchema`; grouping done in SQL over the visible projects; updates the `CLAUDE.md` Exports note |

**Note on LGA and site:** payments are recorded per project (contract), not per site, so an LGA filter shows whole projects that have a site there, and totals by LGA count a multi-LGA project under each of its LGAs (marked "shared across LGAs"). Recording payments per site would change that; ask whether UBEC pays per site (Q19).

---

## 5. Cross-cutting checks for every phase

- Shared contracts first, then server, web and mobile in parallel (CLAUDE.md step 4).
- New owed click-throughs go to `web_testing_checklist.md` / `physical_testing_checklist.md`.
- `configuration_reference.md`, the demo script, demo pack and `CLAUDE.md` updated in the same phase as the change.

## 6. Open questions

Resolved on 2026-11-25: old Q1 (ID numbering, C3), Q2 (multi-site model A, C2), Q3 (AI allowed in principle; demo uses template only, D1), Q9 (E4 list accepted), Q10 (E2 deferred).

| # | Question | For | Blocks |
| :--- | :--- | :--- | :--- |
| Q4 | Confirm the 14-role catalogue and the demo cast of five | Owner, then client | B |
| Q5 | Google Maps billing holder; outbound internet from UBEC's hosting | Owner → client | D3 |
| Q6 | Are retention and a defects liability period in UBEC's contracts, and how long (BPP default 12 months; CM "one-year warranty")? (existing Q-G) | Client | A labels, retention defaults |
| Q7 | Is the funding source list (C4) complete? | Client | C4 |
| Q8 | Stop-work order: this round or later? (also an F.4 action) | Owner | A.2, F.4 |
| Q11 | From the register: are all sites of a project always in one state? Is the contractor always shared by all sites? Is the "inspector" one person per project or per site, and is it UBEC staff (Resident Supervisor) or a consultant? | Owner (spreadsheet) | C2 |
| Q12 | From the register: the list of LOT codes with the kind of project each stands for; does BATCH restart each year; are `DI-2CLR`/`REN` also used after 2025? | Owner (spreadsheet) | C3 |
| Q13 | From the register: the column headers (project rows and site sub-rows), the status values used, how "facility breakdown" is written, and whether contract sum and payments are per project or per site | Owner (spreadsheet) | C2, register import, G |
| Q14 | Open question for UBEC (demo): adopt the structured needs assessment template, or accept AI parsing of free-form documents with the NDPA work it needs | Client | D1.1 |
| Q15 | Contractor rating weights, the flag rule defaults (3 reports ≤ 3/5 in 60 days), and who may see the contractor register | Owner, then client | F |
| Q16 | Is "Replace contractor" needed end to end for the demo, or is stopping at the approved termination enough (F.5)? | Owner | F.5 |
| Q17 | Does UBEC keep CAC RC numbers for its contractors (used as the unique key)? | Client | F.1 |
| Q18 | Default period of the portfolio Payments tab = the fiscal year of the latest approved list (E3)? | Owner | G.2 |
| Q19 | Does UBEC pay per site or per project (contract)? | Owner (spreadsheet) → client | G, C2 |

## 7. Phasing (to do when the item list is complete)

Draft dependency notes, not yet the phase split:

1. **Rename first (A).** Mechanical across every layer; new features are then written with the new names once. Its own full gate.
2. **Reference data and model (C1–C4, D5 rule)**: zones/states/LGAs, sites, project categories and IDs, funding sources; the needs assessment template and register import that D1 builds on.
3. **Creation flow (D1–D4)**: template parsing, derived organisations, address/coordinates, visit calendar per site.
4. **Contractors and payments (F, G)**: the register is needed by the creation flow's contractor dropdown (F.2), so F.1–F.2 can move into step 3; flags and actions (F.3–F.4) after; F.5 replacement as its own slice.
5. **Controls (E3, E4)**: approved lists and red flags need C1–C3; scan comparison needs the generated forms.
6. **Roles, seed and demo switcher (B, C5)** together, so tests and logins are rewritten once (role plan section 5, seed plan section 3); the seed exercises every scenario in C5.
7. Docs, demo script (process map slide, E1 and E2 talking points, Q14 for UBEC) and demo pack rehearsal. E1, E2 and the AI path (D1.1) stay for after the demo.

## 8. Found during research

- The audit hash covers `action`, `summaryText` and `payload`, and uses plain SHA-256, so anyone with database access can recompute the chain (E2 layers 2–3 close this).
- `irl_follow_ups.md` §3 deferred the project code convention; C3 takes it.
- Captures already store a device signature and a perceptual hash (`evidence.service.ts`); E3's photo-reuse rule builds on them.
- Every routine and quarterly M&E visit form already has a 1–5 workmanship rating (`defaultFormLibrary.ts`, `s:WORKMANSHIP/workmanship`), and Phase 15 closure ratings exist: F's reliability rating has real inputs from day one.
- C3: numbering restarts each year, so the project ID can no longer be unique per tenant alone (today's `EXTERNAL_REFERENCE_TAKEN` rule); it becomes unique per tenant and intervention year.
- G: the project payments page filters in the browser today; period totals and exports need the filtering on the server.
- `Project Context/UBEC_IRL.xlsx` assumes 60 users (50 doing site visits) and 10,000 active projects; per-site scheduling (C2, D4) must handle officers covering many lots.
- PCM slide 7 says "31st of September" (no such date); tell the PCM authors.
- ubec.gov.ng is a single-page app; its text is saved in `sources/` for later phases.
