# Web Testing Checklist

Browser checks of the web portal that automated tests do not cover. Companion to [physical_testing_checklist.md](physical_testing_checklist.md) (phone and device checks). Nothing here has been run yet: the redesign slices R2–R6 were verified by typecheck, build, lint and server tests only. Run everything once, at the end of the platform edits, and report failures by ID (for example "WEB-R6-08 failed: …" plus a screenshot).

| | |
| :--- | :--- |
| **Covers** | Redesign R2 (scope, facilities), R3 (form library), R4 (visits), R5f (old-app removals, web side), R6 (web shell) |
| **Last updated** | 2026-11-24 |
| **Needs** | API and web dev servers running against a freshly seeded database (`npm run prisma:seed` from `server/`); Playwright MCP; logins with `Password123!` |

---

## 0. Setup and conventions

- Web `http://localhost:5173`, API on `:4000`. Seed first; the seed resets the dev database.
- Conventions from [ui_verification_and_design_plan.md](ui_verification_and_design_plan.md): findings in `qa/findings/web.md` (format there), screenshots `qa/screenshots/web/<role>/<area>__<state>.png`, saved flows `qa/flows/web/*.spec.ts`.
- axe: inject `https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js` with `browser_evaluate` (no dependency is installed).
- Seeded stages: PRG-101 is a **draft** (no seeded live project is in the Kick-off stage), PRG-102 Mobilisation, PRG-105 Construction (sprint 3 of 3, a recorded payment), PRG-104 Completion (CoC signed once), PRG-103 Closure (defects liability period), PRG-241 closure checklist pending, PRG-242 Closure (archived), PRG-221 default case at the executive step, LKK-402 / ABJ-108 legacy (Platform tenant).
- What each slice built and decided: R6 plan section 15, R5 plan section 10, R4 plan section 10, R3 plan section 11, R2 plan section 9.

---

## 1. R6: navigation and project pages

| ID | Login | Check |
| :--- | :--- | :--- |
| WEB-R6-01 | `admin@ubec.test` | Sidebar: Workspace group (Portfolio · Projects · Visit planner · KPIs · Lessons learned · Forms & facilities · Settings) and Project group (Overview · Kick-off & mobilisation · Sprints & scope · Visits & reports · Findings · Payments · Documents · Completion & handover · More ▸) in that order. More ▸ opens and closes by keyboard (Enter, Escape returns focus) and opens by itself when one of its entries is active. Active entry has `aria-current="page"`. |
| WEB-R6-02 | same | Project switcher keeps the sub-page (and a plain `?tab=`) when the user may see it on the other project; otherwise opens the Overview. |
| WEB-R6-03 | same | Below 1024 px the sidebar is a drawer: menu button opens it, focus moves in and stays inside, Escape and the backdrop close it, focus returns to the button. |
| WEB-R6-04 | same | Header shows the page name from the nav config and the stage chip (text, not colour only); no "Project settings" button. |
| WEB-R6-05 | same | Old URLs land on the right place with the query kept: `/milestones?case=…` → Kick-off & mobilisation, Milestones tab, case open; `/handover` → Completion, Handover; `/retention?ticket=…` → Completion, Defects, ticket highlighted; `/closure` → Completion, Closure; `/boq`, `/schedule` → Sprints & scope; `/inspections` → Visits; `/about` → `/`. |
| WEB-R6-06 | same | Notification links (milestones, default cases, defects, handover, completion, lessons) open the right page and tab. |
| WEB-R6-07 | `admin@ubec.test` | Kick-off & mobilisation on PRG-102: guided kick-off sequence (award and acceptance → notice → held and minutes, current step marked in text), Milestones tab, Mobilisation tab (contractor-on-site milestone, `MOBILISATION_CHECK` visits, compliance panel); complete "contractor on site". |
| WEB-R6-08 | `admin@ubec.test` (acting for the Director Legal), `lagos.admin@ubec.test` | PRG-221 default case from the Milestones tab; the executive step is visible to `lagos.admin@ubec.test`. |
| WEB-R6-09 | `me.officer@ubec.test` | Completion & handover on PRG-104: Certificate (rendered once), Handover (record a response), Defects, Closure tabs; Handover and Defects tabs hidden on a project type with the module off. |
| WEB-R6-10 | `lagos.me@ubec.test`, `admin@ubec.test` | PRG-241 closure checklist and audit sign-off; PRG-242 closure pack download (archived, read-only elsewhere). |
| WEB-R6-11 | `admin@ubec.test` | Forms & facilities (`/app/forms`): Facilities add, rename, retire, restore; the Settings page no longer has a Forms tab. |
| WEB-R6-12 | `me.officer@ubec.test`, `independent.me@ubec.test`, `lender@` | Entries hidden or read-only exactly per permission; every URL the sidebar hides answers with the RequirePermission screen. More ▸ Settings shows only for `projects:edit_baseline`. Holders of only `payments:record` or `audit:view_ledger` no longer see Completion & handover (intended, R6 plan 15.5). |
| WEB-R6-13 | `admin@` (Platform tenant) | LKK-402 and ABJ-108: Overview shows Construction with Kick-off and Mobilisation "Not tracked". |
| WEB-R6-14 | any | Portfolio and directory show the stage chip; directory "Open overview" and "Sprints & scope (n lines)" actions; KPIs and Lessons pages unchanged. |
| WEB-R6-15 | signed out | `/` and `/mobile-app`: no lender, AI or join-code text; browser tab title is the programme title. Login inputs have labels. |

## 2. R6: 5-step setup

| ID | Login | Check |
| :--- | :--- | :--- |
| WEB-R6-20 | `admin@ubec.test` | + New Project → lands on `/setup/project#section-parties`. Project step: Central type pre-fills owner and funder; school card before organisations; map pin with the workspace default radius; tolerance and time zone collapsed. Save and continue. |
| WEB-R6-21 | same | Contract step: contractor (trade pre-filled "Main contract", collapsed), sum, dates, retention; acceptance-letter milestone date shows in the preview; a planned completion before the last sprint shows `PLANNED_COMPLETION_BEFORE_SPRINTS_END` once sprints exist. |
| WEB-R6-22 | same | Scope & sprints step: download the blank template and the project needs assessment (check the UBEC styling and file names), import with a deliberate row error (preview shows it, confirm refused), fix and confirm; hand-edit a unit and a line; standards and needs-assessment section below. |
| WEB-R6-23 | same | Team & visits step: add an officer over the site limit → workload warning; visit officers, working days and plan preview; saving officers keeps them on the team. |
| WEB-R6-24 | same | Review: issues grouped by step with "Fix" links jumping to `#section-<id>`; "not saved" text names the step (`Open step 2 "Contract" and save it.`); activate; lands on the Overview. |
| WEB-R6-25 | same | "Save and continue" on an untouched required step marks it saved; leaving with unsaved edits prompts once (not twice). Advanced (process) is reachable from the draft and from live settings, under a divider. |
| WEB-R6-26 | same | Old setup URLs: `/setup/basics`, `/setup/parties`, `/setup/site` → Project; `/settings/facility`, `/setup/contractor` → Contract; `/setup/standards` → Scope & sprints; `/setup/visits` → Team & visits; `/settings/process` → Advanced; each scrolls to its section. |

## 3. R6: Overview, payments, type editor

| ID | Login | Check |
| :--- | :--- | :--- |
| WEB-R6-30 | `me.officer@ubec.test` | Overview of PRG-102, PRG-105, PRG-104, PRG-103, PRG-242: stage bar matches the seeded stage (states in text, `aria-current="step"`, vertical below 768 px); current sprint (or next/last, or "No sprints yet"); next visit; next deadline with overdue count; budget and paid-vs-contract bar; progress; findings and defects counts; default cases; map; KPIs. No "Geofence & Capture Integrity" or "Latest Reported Capture" card. |
| WEB-R6-31 | a user without `scope:view` / `visits:view` / payments permissions | The matching Overview cards are absent (not shown as zero). |
| WEB-R6-32 | `me.officer@ubec.test` | Phase action on PRG-104 from the stage bar; refusal text under the button when the CoC gate blocks. |
| WEB-R6-33 | `admin@ubec.test` | Payments on PRG-105: record an interim payment naming a sprint; final payment before CoC flagged as an exception; void with a reason; filters (type, sprint incl. "No sprint named", exceptions only); Release checks panel; Overview bar updates. Removing a sprint a payment names is refused (`SPRINT_IN_USE`) on Sprints & scope. |
| WEB-R6-34 | `admin@ubec.test` | Settings → project types: General block, then tabs Kick-off & mobilisation, Monitoring, Completion & closure, KPI targets, Advanced; a validation error shows a count on its tab and in the summary near Save; Save new version; leaving the editor (or switching Settings tab) with unsaved changes prompts. |

## 4. R6: accessibility and responsive

| ID | Area | Check |
| :--- | :--- | :--- |
| WEB-R6-40 | Overview, each setup step, Payments, Kick-off & mobilisation, Completion & handover, type editor, Settings, Forms & facilities | axe: 0 serious or critical violations. |
| WEB-R6-41 | same | Keyboard: every control reachable in order with a visible focus ring; tabs with arrow keys, Home and End; modals trap and return focus. |
| WEB-R6-42 | same | One `h1` per page; nav landmarks labelled ("Workspace", "Project", "Setup steps"); status chips have text. |
| WEB-R6-43 | same | Every input has a label; errors linked with `aria-describedby`; retention override and void-reason inputs labelled. |
| WEB-R6-44 | sidebar, chips | Contrast: sidebar text and headings on the gradient, chip colours. |
| WEB-R6-45 | same pages | Widths 1440, 1280, 1024, 768, 390: no horizontal page scroll; tables scroll inside `StandardTable`; modals fit at 390. |
| WEB-R6-46 | drawer, skeletons | `prefers-reduced-motion` respected. |

## 5. Owed from R2, R3 and R4

| ID | Login | Check |
| :--- | :--- | :--- |
| WEB-R2-01 | `admin@ubec.test` | Sprints & scope page on PRG-105: sprints table with derived status, units grouped by facility with sprint range and planned quantity, lines with computed amounts, totals against budget. |
| WEB-R2-02 | same | Needs assessment download and import on a draft (preview with grouped lines, row errors and warnings → confirm); import disabled with its reason on a live project. |
| WEB-R2-03 | same | Settings → Workspace settings: default geofence radius (20–50,000) pre-fills a new radial boundary. |
| WEB-R3-01 | `admin@ubec.test` | Forms & facilities: facility sub-forms (archetype default and a facility override, e.g. the programme tenant's customised Toilet), fixed sections, visit form templates, preview; editors guard unsaved changes. |
| WEB-R3-02 | same | Type editor Monitoring tab → Visit forms picker ("Default" = template whose code is the kind). |
| WEB-R4-01 | `admin@ubec.test` | Visit planner (`/app/visits`): plan, drag to move (refused outside the window), publish, generate. |
| WEB-R4-02 | `me.officer@ubec.test` | Project Visits page: plan, findings, site log tabs; visit drawer with the submission, review (approve / return), comments, raise a finding. |
| WEB-R4-03 | same | Sprint verification on Sprints & scope (MET / PARTLY_MET / NOT_MET); badge and Overview sprint card follow. |
| WEB-R4-04 | `admin@ubec.test` | Type editor Monitoring tab → visit plan section; Settings → Workspace settings → reschedule tolerance. |

## 6. R5f: old app removed (web side)

| ID | Login | Check |
| :--- | :--- | :--- |
| WEB-R5F-01 | `admin@ubec.test` | Audit ledger has no "Field reports" tab; no page or link mentions workday reports, WBS chat, reporting periods or hold points. |
| WEB-R5F-02 | same | Settings: the inspections tab is now "Supervisors" (supervisor workload only); the type editor has no legacy inspections section. |
| WEB-R5F-03 | `admin@` | Legacy LKK-402 and ABJ-108 keep their progress figures after the report data was removed. |

## 6a. UBEC rebrand and simplification (2026-11-24)

| Ref | Login | Check |
| :--- | :--- | :--- |
| WEB-UBEC-01 | signed out | `/login`: UBEC photo and full logo on the left (lg+), plain form; no InSite or KPMG name anywhere; `/` opens the portal or sign-in; browser tab title and favicon are UBEC's. |
| WEB-UBEC-02 | `admin@ubec.test` | Sidebar shows only Portfolio and Settings until a project is opened; no project dropdown. Portfolio tabs: Overview, KPIs, Visits (`?tab=`). |
| WEB-UBEC-03 | same | Overview: four figures (total commitment, progress, ongoing projects, behind schedule); selecting Ongoing or Behind filters the table and selecting again clears it; map pin popup opens the project; table row opens the project; New project in the table header; Drafts filter for creators. |
| WEB-UBEC-04 | same | KPIs tab: plain tiles (name, value, status icon); selecting one shows its detail above the projects table; "All KPIs" and the browser Back return to the grid (`?kpi=`). |
| WEB-UBEC-05 | a login without `projects:view_portfolio` (e.g. `me.officer@ubec.test` or `independent.me@ubec.test`) | Sidebar shows Dashboard and Settings; Overview figures fit the permissions (visits and findings, or paid to date); only assigned projects on the map and table. `/app/portfolio` redirects to `/app/dashboard` and the reverse for admins. |
| WEB-UBEC-06 | `admin@ubec.test` | Inside a project the sidebar shows the project code and name with its pages; the header shows "code / page" with no stage or archived pills; the first page is "Project overview". |
| WEB-UBEC-07 | same | Old links redirect: `/app/projects`, `/app/kpis`, `/app/visits`, `/app/lessons` to the home page (tab kept), `/app/forms` to Settings → Forms & facilities. |
| WEB-UBEC-08 | same | Settings shows Users & visibility, Project types, Forms & facilities (sub-sections in `?section=`), Supervisors, Account; the hidden sections are absent. |
| WEB-UBEC-09 | user with `documents:upload` | PRG-241 Project overview shows "Upload the closeout report"; uploading it from there or from Completion & handover → Closure removes the prompt and ticks the before-archive checklist item; PRG-242 shows its report read-only. |
| WEB-UBEC-11 | `admin@ubec.test` | Every tab bar and segmented control: light green track, selected item solid green with white text. |
| WEB-UBEC-12 | same | Sidebar always shows a project (last opened, else the first ongoing) with "Change project"; entries: Project overview, Project stages (opens the current stage; stage tabs Kick-off & mobilisation / Scope & sprints / Completion & handover with ticks on done stages), Reports (Visits, Findings, Site log), Payments, Documents, More (Audit ledger, Project settings). |
| WEB-UBEC-13 | `me.officer@ubec.test` | No Settings, Audit ledger, Project settings or Payments in the sidebar; Dashboard (not Portfolio); "Account and password" in the user menu opens the account page. |
| WEB-UBEC-14 | `admin@ubec.test` | Settings → Supervisors: table (name, warning, sites) with search and filters; a row opens a drawer with the sites. Users & visibility uses the same table style. |
| WEB-UBEC-10 | all | Seeded names read UBEC / Kano State SUBEB / Lagos State SUBEB, Direct Intervention / Matching Grants; no "Central", "Co-Funded" or "Programme Authority" on screen. |
| WEB-UBEC-20 | `admin@ubec.test`, then each roster login | Settings → Users & visibility lists the seven roster users (Hauwa Bello, Aisha Musa, Chidi Okeke, Ngozi Eze, Bisi Adeyemi, Engr. Emeka Obi, Musa Danladi) and Roles lists exactly six: UBEC Administrator, SUBEB Administrator, UBEC M&E Officer, SUBEB M&E Officer, Independent M&E (COREN-certified firm), Resident Supervisor (mobile). The login page quick list shows only the four web logins in roster order. `kano.admin@`/`lagos.admin@` see only their SUBEB's projects; `me.officer@`, `lagos.me@` and `independent.me@` get the Dashboard (no Portfolio, Settings, Audit ledger or Payments) and see only their assigned projects (me.officer@: PRG-102, -103, -104, -105, -211, -221; lagos.me@: PRG-221, -241, -242; independent.me@: PRG-102, -105, -211), with the same lists on the phone. `resident.supervisor@ubec.test` is for the phone only. |

## 7. Known open items

| Ref | Item |
| :--- | :--- |
| W-R6-004 (`qa/findings/web.md`) | Login page showcase panel showed removed features; fixed in R5f's web clean-up (no WBS, hold points, corridors; "Officer's note"). Confirm on `/login` and mark it fixed in `qa/findings/web.md`. |
| Interrupted run | A first click-through was stopped part-way (owner decision: one run at the end). Before stopping it changed `ClosureChecklistPanel`, `ContractorRatingsPanel`, `LessonsPanel`, `CustomSelect`, `ModalShell`, `FormsAndFacilitiesTab` and the login page for accessibility; re-check those areas under section 4. |
| Phase 11–16 | The Phase 11–16 web click-through and demo rehearsal are still open (Phase 16 plan section 7); run them with [demo_script_programme_delivery.md](demo_script_programme_delivery.md). |
