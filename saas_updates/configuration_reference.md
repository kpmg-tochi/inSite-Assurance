# Configuration Reference: Programme Delivery (Phases 11–16)

**For:** the delivery team preparing client workshops on UBEC's Direct Intervention and Matching Grants delivery models.
**Use:** go through it setting by setting with the client. Each row says where the setting lives, its default, what it changes, and which process-flow control (gap analysis IDs G1–G14) it serves.

**Last updated:** 2026-11-26 (client demo wave 4: approved list upload permission, no new settings, section 2.2). Before that 2026-11-25 (client demo waves 1–3: workspace values without a Settings control yet, section 2.2). Before that 2026-11-24 (redesign R6: type editor tabs, the five-step project setup, new page names and routes; redesign R5f: reporting cadence, hold points, contractor field reporting, the `inspections` type key and checklist templates removed, see 1.1).

---

## 1. How to read this

**Where settings live**

| Level | Who sets it | When it applies |
| :--- | :--- | :--- |
| **Workspace (tenant)** | Tenant administrator, in Settings | At once, for every project. |
| **Project type** | Holder of `project_types:manage`, in Settings → Project types, regions & documents → Project types (editor tabs in section 3) | Saving writes a new type version. **New projects take the version current when the type is applied; existing projects keep theirs.** Exception: KPI targets apply to every project of the type at once. |
| **Workflow template** | Holder of the workflow permission, in Settings → Workflow templates | Process switches and approval chains, copied to a project when its type is applied. |
| **Project** | Project team, in the five-step setup wizard (drafts, `/setup/project`) or More ▸ Settings (live, `/settings/project`); section 5 | That project only. |

**Defaults.** Every setting defaults to how the platform behaved before Phase 11. A project with no project type behaves exactly as before.

**Every project type setting below has a field in the type editor.** The one exception is the beneficiary signature mode: it has a single value ("recorded by staff") until D-15.1 changes, so there is nothing to choose. Role and template pickers list the workspace's roles and visit form templates. A code that no longer exists is flagged so it can be removed.

### 1.1 Settings removed (redesign R4f and R5f)

These no longer exist; do not offer them in a workshop. Visits (sections 3.3 and 5) replace them.

| Removed | Was | Removed in |
| :--- | :--- | :--- |
| Reporting streams and reporting obligations | Type keys `reportingStreams`, `reportingDefaults`; the Reporting setup step | R4f |
| Reporting cadence and reporting period | Per project: cadence, period start day, custom interval, report due time and grace, cadence anchor, pending cadence change. **Working days stay** (visits use them). | R5f |
| Hold points | Process switch "Hold points", the hold-point flag and instruction on BoQ lines, hold-point alerts | R5f |
| Contractor field reporting | Process switch for contractor reports from the field (contractors have had no login since R1d) | R5f |
| Phase 14 inspections | Type key `inspections` (checklist template per visit type) and its editor section; workspace inspection checklist templates; site inspection reports | R5f |
| Workday reports and WBS chat | The old app's daily reports, report queries and per-item chat | R5f |

---

## 2. Workspace (tenant) settings

| Setting | Where | Default | Effect | Control |
| :--- | :--- | :--- | :--- | :--- |
| Organisation hierarchy (parent organisation) | Settings → Organisations | None (flat) | Up to 5 levels. Lets a flagship see and approve for its subsidiaries; cycles are refused. | G10 |
| Regions and areas | Settings → Project types, regions & documents → Regions | None | Two levels (region → area). Used by project filters, the portfolio map and KPIs. A region filter includes its areas. | G10 |
| Terminology | Settings → Tenant Settings → Terminology | Funder, Independent monitor, Contractor, Beneficiary, Hold point, Retention | Display labels only (singular and plural), on web and mobile. API fields and audit text keep the canonical names. Demo tenant: funder = "Funding authority", client project ID = "UBEC project ID" (UBEC IRL: the key `externalReference`, default "Client project ID", names the client's own project ID on forms, the register, exports and the import template). (Redesign R1b removed Tranche, Condition precedent, IPC and Valuation. Hold point has no screen left once R5f removes hold points.) | G1 |
| Document types | Settings → Project types, regions & documents → Document types | 18 types (contract, award and acceptance letters, kick-off pack, minutes, mobilisation agreement and plan, letter of introduction, site possession, supervisor assignment, CoC, handover certificate, final evaluation, closure file and others) | Per type: sign-off required, allowed files, and whether contractors can see it. Milestones, checklists and KPIs refer to types by code. | G3 |
| Visit move tolerance (redesign R4) | Settings → Tenant Settings → Workspace settings | 2 working days (0–10) | An officer may move a visit this many working days either side of its original date, inside the same sprint, without asking; further moves are proposed to the manager. Measured from the original date, so repeated small moves cannot walk a visit away. | Q-H, P5 |
| Contractor rating criteria | Settings → Tenant Settings → Rating criteria | Time, Quality, Health & safety, Responsiveness, Documentation | Criteria scored 1–5 at completion and after closure. | G6 |
| Site boundaries (redesign) | Settings → Tenant Settings → Workspace settings | Radial and perimeter enabled; default radius 150 m; tolerance 100 m | Which boundary types projects may use (linear corridors were removed). The default radius pre-fills a new radial boundary and the boundary made from a workbook's GPS point; each project sets its own radius and may override the tolerance in the Location section of setup step 1 Project. | G5 |
| Facility catalogue (redesign R2) | Forms & facilities (`/app/forms`) → Facilities (`facilities:manage`) | 50 facilities: 19 building works (Classroom, Toilet, Hostel…), 22 supply & installation (pupils' furniture, science kit, computers…), 4 utilities (Borehole, Overhead tank, Generator, Solar power), 5 external works (Fence, Drainage, Football pitch…) | Scope lines are tagged with facilities through facility units. Per facility: code (locked once a unit uses it), name, plural (R3: only when the plain plural is wrong; set by default for Staff quarters, Solar power, Landscaping, Drainage), category, archetype (decides whether units carry a planned quantity and the default sub-form). A retired facility stays on the projects that use it and leaves the pickers and the workbook. | Decision Y |
| Form library (redesign R3) | Forms & facilities (`/app/forms`): Facility sub-forms, Fixed sections, Visit form templates, Preview (`forms:manage`) | 10 fixed sections, 4 archetype sub-forms, 7 visit form templates (one per visit kind, code = kind); see 2.1 | The questions of every visit form. Versioned: a version a built form used is never edited, saving makes a new one. | Decision Y, P3 |
| Project register import (UBEC IRL) | Projects table → Import projects (`projects:create`) | Template with the workspace's lists (states, project types, organisations, contractors, funding sources, statuses) | One row per project. "Not started" (or blank) creates a draft; "Ongoing" and "Completed" create live projects with the reported % complete (they need GPS and the contractor; contract milestones already due and the pre-construction ones are waived; ongoing projects get the type's visit proposals). Codes: blank or taken → the next free code after the highest in use. Preview first; the whole file is imported or nothing is. Live imported projects take their first needs assessment like a draft; the computed progress then replaces the reported %. | IRL 6 |
| Project register export (UBEC IRL) | Projects table → Export (Excel / PDF) | The register as filtered | One row per visible project (code, client project ID, school, state, LGA, type, owner, contractor, contract sum, paid to date for `payments:view` holders, intervention year, funding source, stage, schedule, % complete and its basis, last approved update, open findings). | IRL 7 |
| Units of measure (redesign R2) | Fixed list (not editable in v1) | m, m², m³, nr, item, LS, kg, t, set, lot, l | The workbook dropdown, the Sprints & scope page and server validation. A client list would become a workspace setting later (D-R2.7). | – |

### 2.1 Form library (redesign R3)

Three kinds of component, each versioned. A form is built ("frozen") from them when R4 assigns a visit; later edits never change it.

| Component | What it is | Default |
| :--- | :--- | :--- |
| Fixed section | A reusable group of questions, by code. Templates list sections by code, so a section is written once and used by several visit kinds. A section a live template lists cannot be archived. | Mobilisation, Site conditions, Progress vs work programme, Quality of workmanship, Material standards, Health & safety, Environmental safeguards, Valuation of works (estimate), Delivery to specification, Post-closure |
| Facility sub-form | One per facility. Each archetype has a default; "Customise" gives a facility its own copy, "Reset" returns it to the default. A facility moved to another archetype follows the new default. | Building works, Supply & installation, Utilities, External works (spec 6.2) |
| Visit form template | One visit kind: sections in order and at most one slot for the facility sub-forms (not for Mobilisation check and Post-closure). The header and the summary come from the visit; re-check items for open findings are added after the last block. | One per kind |

**Visit kinds and their facilities** (fixed): Mobilisation check (none), Baseline (every facility in scope), Routine and Quarterly M&E (units active in the sprint covering the visit date, plus earlier units not yet reported complete), Final evaluation (every facility), Post-closure evaluation (none), Ad hoc (the officer picks facilities).

**Field types:** short text (≤ 300), long text (≤ 4000), number (unit, min, max), percentage (0–100), yes/no (optionally N/A), single choice, multiple choice (min/max picks), date, rating 1–5, photo, voice note (transcribed).

**Rules** (up to 5 per question): when the answer is / is one of / is at most / is at least X, then require a photo, require a comment, or raise a finding (minor, major, critical). A missing comment blocks the submission; a missing photo is flagged (the phone asks for it). No formulas or cross-question conditions.

**Signals** (one per question) tell the visit what an answer means: unit complete (sub-forms; when the answer is X), contractor on site (sections; yes/no), progress % (sub-forms; 100 also means complete), quantity delivered (sub-forms; at least the planned quantity also means complete), overall finding (sections; single choice).

**Sub-form only:** placeholders `{count}`, `{facility}`, `{units}`, `{plannedQty}`, `{uom}` ("Are all {count} {facility} roofed?" → "Are all 3 toilets roofed?"); answer scope (whole facility, or per unit: the question repeats for each unit); photo mode (at least N, one per unit with a labelled slot each, per unit optional); "bounded by the planned quantity" on numbers (the label shows "of 120 nr"; more than planned needs a comment); "asked on" visit kinds (one sub-form serves Baseline, progress visits and Final).

**Limits:** 40 questions per section or sub-form (the editor warns above 5 on a sub-form), 30 options, 20 blocks per template, 600 questions per built form. A question's key never changes type across versions.

**Preview:** Forms & facilities → Preview builds the form a project would get for a visit kind and date, from the live library and the project's scope, without saving anything.

### 2.2 Client demo settings (waves 1–4)

Workspace values added for the client demo. **None has a Settings control yet** (follow-ups): they are columns on the tenant, changed in the database, and every one takes its default until set. Control column: section of `client_demo_updates/implementation_plan.md`.

| Setting | Where | Default | Effect | Control |
| :--- | :--- | :--- | :--- | :--- |
| Fiscal year start month (wave 1) | `Tenant.fiscalYearStartMonth`, no UI yet | 1 (January) | Starts the fiscal year used by the payment period filter (this / last fiscal year, quarters) and the portfolio Payments tab, and decides which intervention years a new draft may take (current and next fiscal year). | D5, G |
| Contractor performance (wave 2–3) | `Tenant.contractorPerformanceJson`, no UI yet (`ContractorPerformanceSettingsSchema`; `{}` = every default) | See the rows below | How the contractor register's star rating is computed and when a contractor is flagged on a project. Ratings are recomputed nightly (`contractor-ratings` job) or with "Refresh ratings". | F.3, F.4 |
| ↳ `weights` | same | workmanship 0.4, schedule 0.2, findings 0.2, closure 0.2 | Weight of each rating component: workmanship on accepted monitoring reports; work phases verified met on time and mobilisation on time; major and critical findings and how fast they were rectified; closure ratings on completed projects. A component with no facts yet passes its weight to the others in proportion. | F.3 |
| ↳ `windowMonths` | same | 24 (3–60) | Monitoring reports older than this are not counted. | F.3 |
| ↳ `halfLifeMonths` | same | 6 (1–36) | A report's weight halves every N months, so recent work counts most. | F.3 |
| ↳ `minReports` | same | 5 (1–50) | Below this many accepted reports the contractor shows "Not yet rated" instead of stars. | F.3 |
| ↳ `flagRule` | same | `enabled` true, `reportCount` 3, `workmanshipAtOrBelow` 3 (of 5), `withinDays` 60 (7–365) | Flags a contractor on a project when that many accepted monitoring reports within the window rate workmanship at or below the threshold. Checked daily and when a report is accepted; one open flag per contractor and project. Holders of `contractors:manage` (in the demo, the Director, Physical Planning) are notified and decide the action. | F.4 |
| Budget mismatch tolerance (wave 3) | `Tenant.budgetMismatchTolerancePct`, no UI yet | 10 (%) | A project whose budget differs from the cost estimate on its approved list row (Direct Intervention schedule or the State's approved BEAP) by more than this is red-flagged on the Overview and the Needs assessment page, e.g. "Budget ₦84.0m vs approved BEAP ₦71.5m (+17%)". | E3 |

**Wave 4 (2026-11-26) adds no setting.** The fiscal year start month above still has no control.

| Feature | Settings | Access |
| :--- | :--- | :--- |
| Approved list upload (E3) | None. The template (`INSITE-APPROVED-LIST-v1`) is fixed: one list per file; an upload replaces the list of the same year, kind and State. | New permission `approved_lists:manage` (Upload Approved Project Lists, category Portfolio & projects). Granted to `TENANT_SUPER_ADMIN` (UBEC Administrator; System Administrator in the demo overlay) by migration, and by the demo overlay to the Director, Physical Planning (`DIRECTOR_PHYSICAL_PLANNING`). Viewing stays `approved_lists:view`. |
| Payments Breakdown and Group by month / quarter (G.1, G.2) | None. Groupings are fixed (zone, State, LGA, contractor, project, month, quarter); months and quarters follow the fiscal year start month. | `payments:view`, as the rest of the Payments tab. |
| Visit calendar (D4, read-only) | None. Status colours and icons are fixed; it uses the page's own filters. | As the visit plan and the planner (`visits:view`). |

### 2.3 Server environment: address lookup (D3, 2026-11-26)

Set on the API server (`server/.env`), not per workspace: it applies to every workspace on that server.

| Variable | Default | Effect | Notes |
| :--- | :--- | :--- | :--- |
| `GOOGLE_MAPS_KEY` | empty (off) | Turns on **Find address** on project sites (setup → Sites) and the project's own Location boundary. The server looks the typed text up with Google Maps Platform: Places API (New) text search, then Geocoding API v4 when Places finds nothing; Nigeria only, and only matches in the project's State when it has one. One match fills the coordinates (and an empty address), several show a pick list with the match quality ("Named place", "Street", "Area only", "Town only"). Empty: `GET /api/v1/geocode/status` says disabled and the button is not shown. | The key stays on the server (never sent to the browser or the app). Only the address text (plus the State name) is sent to Google, nothing about the project or user. Signed-in web users only, 30 lookups a minute per user; results are not stored. The key's Cloud project needs Places API (New) and Geocoding API enabled; the legacy Geocoding API needs billing and is not used. Tests blank it. |

### 2.4 Demo builds and local storage links (pre-demo round, 2026-11-26)

Build and server environment, not workspace settings.

| Variable | Where | Default | Effect | Notes |
| :--- | :--- | :--- | :--- | :--- |
| `VITE_DEMO_MODE` | `web/.env` (build time) | `false` | `true` builds the demo web: user menu → **Switch user**, the demo accounts on the sign-in page, sample values on New project. Vite drops the demo code and the account list from other builds. | Restart the web dev server after changing it. Never in a build real users see. |
| `EXPO_PUBLIC_DEMO_MODE` | `mobile/.env` (bundle time) | `false` | `true` builds the demo field app: **Demo accounts** quick sign-in on the sign-in screen (Resident Supervisor, M&E Officer, SUBEB M&E Officer, Independent M&E; each tap is a normal password sign-in) and Settings → Demo controls. Metro drops the demo account module from other bundles. | Restart Metro after changing it. Never in a build real users see. |
| `PUBLIC_API_BASE_URL` | `server/.env` | `http://localhost:<PORT>` | Local-dev storage only (no S3 configured): signed file links use the **origin of the request** being served, so the web on `localhost` gets localhost links and a phone on the LAN address gets LAN links. Links written outside a request (jobs, emails) use this value. | With S3-compatible storage the provider's presigned URLs are used and this does not apply. `X-Forwarded-Host` is read only when Express `trust proxy` is set. |

### 2.5 Standards (needs pipeline wave 2, 2026-11-26)

Workspace data on **Standards** (`/app/standards`, Platform navigation): read by every web user, changed with `standards:manage` (Director, Physical Planning; Quantity Surveyor; System Administrator).

| Setting | Default | Effect | Notes |
| :--- | :--- | :--- | :--- |
| **Costing standard** (rates by item code, zone factors, supervision and monitoring %, contingency %, ceilings per facility and action) | None. Seed: version 1 for UBEC = `DEFAULT_COSTING_STANDARD` (16 **specimen** rates, S&M 5 %, contingency 5 %, NE × 1.1, SS × 1.05, five ceilings; `shared/src/data/defaultCostingStandard.ts`) | A cycle uses the latest version when it opens; the needs assessment template carries that version's rates (pre-filled in the BoQ), and uploaded versions are checked against it (rate tolerance and ceilings from the type's `needsPipeline`, supervision and monitoring line). | Edited by Excel round trip ("Download template", "Upload costing standard": preview, then save). A version a cycle or a needs assessment uses is locked: saving then makes the next version. The specimen rates are placeholders, not UBEC's. |
| **Design standard documents** (standard drawings, specifications, guidelines; optional facilities) | None | Listed on the Standards page beside each programme's essential facility groups. | A new version supersedes the earlier one; both stay listed. |
| Monitoring standards | – | Read-only view of the form library (visit form templates, facility sub-forms). | Edited in Forms & facilities. |

---

## 3. Project type settings

Set in Settings → Project types, regions & documents → Project types. One type per delivery model. The demo (UBEC) has "Direct Intervention" (type code `CENTRAL`) and "Matching Grants" (type code `CO_FUNDED`).

**The type editor (redesign R6e).** General fields sit above six tabs (five in R6; the needs pipeline added "Needs assessment", first). A tab with a validation error shows its error count; leaving the editor with unsaved changes asks first; "Save new version" saves every tab.

| Editor place | Settings in it | Type config keys | Section below |
| :--- | :--- | :--- | :--- |
| General (above the tabs) | Code, name, colour, description, default type, active | – | 3.1 |
| **Needs assessment** tab | The annual needs assessment cycle: stages and deadlines, scoring rubric, essential facilities, checks, approval chains (editable since needs pipeline wave 2; a cycle keeps its own copy) | `needsPipeline` | 3.9 |
| **Kick-off & mobilisation** tab | Contract milestone templates (incl. mobilisation days), kick-off quorum and notice lead time, required documents, contractor default cases (Legal role) | `contractMilestones`, `kickoff`, `documentRequirements`, `defaultCases` | 3.5, 3.6 |
| **Monitoring** tab | Visit plan and deadlines, visit form per visit kind, supervisor roles and limits | `monitoring`, `visitForms`, `supervision` (and the legacy `inspections` until R5f removes it) | 3.3, 3.6 |
| **Completion & closure** tab | CoC signatories and gates, handover due, closure checklists, rating sharing; retention defaults | `closure`, `payments` | 3.7, 3.4 |
| **KPI targets** tab | Target and "shown" per KPI | `kpiTargets` | 3.8 |
| **Advanced** tab | Workflow template, owner and party rules, funder default | `ownership`, `parties` (+ the workflow template) | 3.1, 3.2 |

### 3.1 Identity and process

General fields, except the workflow template (Advanced tab).

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Code, name, colour, description | – | Shown on the directory, map, matrix and KPIs. | G1 |
| Workflow template | Required | Process switches and approval chains copied to the project (section 4). | G1 |
| Default type | Off | Pre-selected for new drafts. Once a tenant has active types, every new draft needs a type. | G1 |
| Active | On | Archived types cannot be applied to new drafts. | G1 |

### 3.2 Ownership and parties

Advanced tab.

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Owning organisation required | Off | The "School and organisations" section (setup step 1 Project) needs an accountable owner. | G10 |
| Allowed owners | Any organisation | Limits who can own projects of the type. Demo: Direct Intervention = UBEC only; Matching Grants = Kano SUBEB or Lagos SUBEB. | G10 |
| Default owner | None | Pre-filled on new drafts (must be an allowed owner). | G10 |
| Monitor / funder / beneficiary / region required | Monitor and funder on; beneficiary and region off | Setup step 1 Project (sections "Project details" and "School and organisations") refuses to continue without them. | G10 |
| Funder default | `NONE` | `OWNER`: the owner funds the project (Matching Grants: the SUBEB). `FIXED`: a named organisation (Direct Intervention: UBEC). | G10 |

### 3.3 Visit plan and deadlines (redesign R4, type key `monitoring`)

Monitoring tab. Replaces the Phase 8 reporting defaults and the Phase 14 reporting streams (both removed in R4f); R5f removes the remaining per-project reporting cadence (section 1.1). Like every type rule except KPI targets, a project keeps the version it was created with.

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Visit plan rules (visit kind, when, interval, sprints, offsets) | None (demo: mobilisation checks every 2 weeks until the contractor is on site (when less than one interval is left before mobilisation is due, as on a Direct Intervention project whose 21 days count from contract award, one check on the due date; needs pipeline N0); baseline 5 working days after the later of activation and kick-off; routine every week during construction (UBEC manual: weekly supervision); quarterly M&E 5 working days into each quarter's last month; final evaluation 5 working days after the completion notice; Matching Grants: post-closure evaluation on its closure milestone, else 180 days after closing) | Activation proposes the visits (all of them, through the last sprint); a live sprint change regenerates the proposed sprint-driven ones; the completion notice proposes the final evaluation, closing the post-closure one. The M&E manager assigns officers and publishes them. Dates fall on working days. | P3, Q-H |
| Submit within | 7 days | The submission deadline is the visit date plus this many calendar days; later is late, and with nothing submitted the visit becomes missed. | Spec 8.1 |
| Remind unconfirmed | 2 days before | Officers who have not confirmed get one reminder. | Spec 8.1 |
| Escalate findings after | 14 days | An open finding is escalated once to holders of `findings:receive_escalations`. | Confirm |
| Warn after no visit for | 4 weeks | Planner warning only. | Spec 8.1 |
| Verify sprints within | 7 days | After a sprint ends it should be verified within this many days; then it shows Late and, with a unit below 100%, the schedule badge turns behind. | Confirm |
| Email the contractor the open findings | On | After each accepted visit with open or newly resolved findings, the contractor organisation's contact email gets a summary (no comments, no photos). | Spec 6.5 |
| Early-warning alerts: Delayed (on/off) | On | Alert when the schedule badge is Behind (a facility unit due by an ended sprint is not complete), in construction and handover. Web notification "Behind schedule" to holders of `sprints:view_status`. | IRL 5 |
| Early-warning alerts: Stalled (on/off, days) | On, 30 days | Alert when, in construction and below 100%, no accepted visit has raised a facility unit's progress for this many calendar days, counted from the first sprint's start (activation without sprints). A project without facility units counts any accepted visit. Web notification to holders of `findings:receive_escalations`; mobile notification and push to the project's field officers. | IRL 5 |
| Early-warning alerts: Site update overdue (on/off, days) | On, 14 days | Alert when, in mobilisation or construction, no visit has been accepted for this many calendar days (counted from the last accepted visit's date, or from activation before the first). Web notification to holders of `visits:plan`; mobile notification and push to the project's field officers. | IRL 5 |
| Early-warning alerts: Spend ahead of progress (on/off, points) | On, 15 points | Alert when net paid as a % of the contract sum exceeds % complete by more than this many percentage points, in construction and handover, only with a contract sum and at least one recorded payment. Web notification to holders of `payments:view`; the alert chip is shown only to users who see payments. | IRL 5 |

Early-warning alerts (UBEC IRL) are checked once a day per project by the `project-alerts` job (Delayed also by `schedule-variance` when it stores the badge). Each alert is sent once when its condition starts and shows as a chip on the project Overview (and in the project rows) until the condition clears; a later occurrence alerts again. Field officers are the project's default visit officers, the officers of its open visits and every account with an active field session on it. Thresholds come from the project's type snapshot like the other monitoring rules; a project without a type uses the defaults.

### 3.4 Payments (redesign R1b)

Completion & closure tab (retention defaults). Professional registration (policy, bodies, certifier snapshots) was removed in redesign R1d (decision U).

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Retention percentage | None | Pre-fills "Retention and defects liability" (setup step 2 Contract) of a new project. Recorded payments hold this percentage back (another amount needs a reason). Payments are made outside the platform and recorded on the project's Payments page. | Decision Q |
| Defects liability period (months) | None | Pre-fills "Retention and defects liability". The retention release is flagged when recorded before the period ends. | Decision P1 |

### 3.5 Contract milestones and kick-off (Phase 13)

Kick-off & mobilisation tab.

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Contract milestone templates | None | Dated obligations created on each project. Per milestone: key, label, anchor (contract award, contract signed, kick-off, activation, another milestone, CoC issued, project closed), offset (calendar or working days, negative = before), completion mode, required documents, a sign-off permission, responsible role and organisation, one per contractor. | G2 |
| Completion modes | Manual | Contractor on site (confirmed by an officer through the complete button; telemetry was removed in redesign R1e), and automatic: kick-off notice sent, kick-off quorum, programme accepted (the programme of works document is signed off; redesign R2d), CoC issued, handover accepted, final evaluation approved. | G2 |
| **Mobilisation days** | – | The anchor and offset of the "mobilised to site" milestone. Demo (needs pipeline N0, D-N.22, 2026-11-26): **Direct Intervention 21 days from contract award** (PCM p.12; "mobilisation documents complete" counts the same 21 days), **Matching Grants 14 days from the kick-off** (PCM p.38). Where mobilisation counts from award, the kick-off tab warns (`KICKOFF_AFTER_AWARD_WINDOW`, never a block) when the scheduled or planned kick-off is later than 14 days after award; the 14 days are fixed, not a setting. | G2 |
| Kick-off quorum groups | None | At least one attendee per group (demo: owner, monitor, contractor, beneficiary), or a waiver reason. | G2 |
| Kick-off notice lead time | 7 days | The notice must go out this many days ahead, or the shortfall is waived with a reason. | G2 |

### 3.6 Documents, default cases, visit forms and supervision (Phases 13–14, R3)

Documents and default cases: Kick-off & mobilisation tab. Visit forms and supervision: Monitoring tab.

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Documents needed before going live | None | Document types needed before the project can go live. | G3 |
| Documents needed before mobilisation | None | Shown on the mobilisation compliance panel per contractor. Counted by the "full mobilisation documentation" KPI. Demo: mobilisation agreement and site possession form. | G3 |
| Legal role | None | The Legal role: told about new default cases, and names the review step. Demo (UBEC roster): `TENANT_SUPER_ADMIN` ("UBEC Administrator", who acts for the Director Legal; there is no Legal login). | G7 |
| Open a default case when mobilisation is overdue | On | An overdue contractor-on-site milestone opens a default case once. The case runs Legal review, then the executive decision (`contracts:decide_default`). | G7 |
| Visit forms (redesign R3) | Default (the template whose code is the visit kind) | The visit form template per visit kind. Only a live template of that kind can be chosen. Projects keep the choice they were created with; the latest version of the template is used when a form is built. Demo: code = kind for every kind. | Decision Y |
| Supervisor roles | None | Roles whose users count as supervisors (workload view, "supervisor assigned" KPI). Demo (UBEC): `UBEC_ME_OFFICER`, `SUBEB_ME_OFFICER`, `MONITOR` (Independent M&E), `INDEPENDENT_RESIDENT` (Resident Supervisor). | G9 |
| Most sites per supervisor / furthest distance between sites | No limit | The workload warns above them and never blocks. Demo: Direct Intervention 10 sites, Matching Grants 2 sites (a demo value; the manual gives 7 to 10), 50 km. | G9 |

### 3.7 Completion and closure (Phase 15)

Completion & closure tab. The results show on the project's Completion & handover page (tabs Certificate, Handover, Defects, Closure).

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| **CoC signatories** | Head of Physical Planning and Head of M&E (owning organisation), plus the beneficiary institution | Up to 8 slots, each with a permission (default `completion:sign_certificate`), an optional role, and an organisation scope (any, owner, owner or above, funder, monitor). One slot per person. The last signature issues the certificate and its PDF. | G6, decision O |
| Beneficiary signature | Recorded by staff | Staff upload the signed paper copy and attest (D-15.1). The beneficiary has no login (R1d). | G6 |
| Final evaluation before the CoC | Off | A CoC can only be drafted after an accepted final evaluation visit. (Approved Phase 14 final evaluation inspections stop counting when R5f removes inspections.) | G6 |
| Gates needing an issued CoC | None | Liability period (handover → retention) and closure are refused without it. Final payment: a FINAL payment or retention release recorded without it is flagged as an exception (payments are made outside the platform). | G6 |
| Handover due after the CoC | 7 days | Dates the handover ceremony milestone. | G6 |
| Before-closing checklist | None | Items: document filed (and, per item, whether its current version must be signed), visit accepted (of a chosen visit kind), milestone done, contractors rated, lessons published, audit sign-off, manual. Each must be met or waived before closing. | G6 |
| Before-archiving checklist | None | The same item kinds, needed before archiving. Demo: both types need the closeout report (document type `CLOSEOUT_REPORT`: final evaluation, lessons learned, beneficiary feedback); Matching Grants also the post-closure evaluation 14 days after closing and the Audit Department's sign-off, which cannot be waived. | G6 |
| Share ratings with the contractor | Off | Contractors see their own ratings when on. | G6 |

### 3.8 KPI targets (Phase 16)

KPI targets tab. **Changes apply to every project of the type at once.** Unlike the rules above, targets are reporting settings.

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Target per KPI | Catalogue default (section 6) | "At least" for percentages, "at most" for durations. Blank means no target, and the KPI is shown without a status colour. Met = on target; near = within 10%; missed = further. | G8 |
| Shown | On | Off hides the KPI for projects of the type. A KPI hidden on every type in view drops off the page. | G8 |

Demo values: Direct Intervention (mobilisation 90%, reports 85%, visits 90%); Matching Grants (mobilisation 85%, reports 80%, visits 85%, approval 7 days). Financial utilisation has no target.

---

### 3.9 Needs assessment cycle (needs pipeline, type key `needsPipeline`)

Needs assessment tab, editable since needs pipeline wave 2 (2026-11-26). **What runs on these settings after wave 2:** opening a cycle (scope, owner, calendar, rubric and chains are copied into the cycle), the upload checks (minimum fields of the stage, drawings excepted until submission) and the flags on every uploaded version (duplicates, essential facilities, rate tolerance, ceilings, supervision and monitoring line). Validation, costing, prioritisation, approval and funding come in waves 3–4 of `needs_pipeline_implementation_plan.md`. A cycle keeps its own copy of these rules from the day it opens, so a change applies to new cycles. Defaults: `DEFAULT_DI_NEEDS_PIPELINE` and `DEFAULT_MG_NEEDS_PIPELINE` in `shared/src/data/needsPipelineDefaults.ts`, merged into the two UBEC types by the seed.

| Setting | Default (no pipeline) | Direct Intervention | Matching Grants | Effect |
| :--- | :--- | :--- | :--- | :--- |
| Enabled | Off | On | On | Off: the type has no needs assessment cycle; nothing else here applies. |
| Funding gate | Appropriation | Appropriation | BEAP approval | What turns a proposed project into a draft project. |
| Reference | DI | `<year>-DI-<nnn>` | `<year>-MG-<State>-<nnn>` | The reference of a proposed project. |
| Cycle scope | National | National (owner UBEC HQ) | One per State (owner the SUBEB) | Who a cycle belongs to. Users with `needs:view` see the cycles owned by their organisation or one below it (UBEC HQ sees every State cycle); only users of the owning organisation itself open, change, close or upload to it. |
| Cycle opens | 1 March | 1 March | 31 July (the circular) | In the year before the intervention year. |
| Stages (label, who moves it on, deadline) | None | Identification 30 May · Validation 31 July · Needs assessment completion 30 Sept · Costing 14 Oct · Prioritisation 21 Oct · Approval 31 Oct · Budget and appropriation (no fixed date) | Identification 31 Aug · Field verification 30 Sept · Costing 14 Oct · Prioritisation 21 Oct · State approval 30 Oct · BEAP 30 Nov | The stage list a proposed project passes. Required: every stage but "Needs assessment completion" (`DESIGN`). |
| Other dated events | None | Stakeholder engagement summary 30 June; budget submission 15 Dec | BEAP submitted 15 Nov | Shown in the deadline strip. |
| Minimum fields per stage | None | Identification: the need, sites, breakdown, justification. Completion: plus BoQ, drawings, preliminary cost | Identification: all of them | What a needs assessment must contain to leave the stage. |
| Scoring rubric | Empty | Impact 60%, Ease of implementation 40%; five criteria each, scores 1–5 with descriptors; divergence flagged at 2 points; quorum 3 | Same | Frozen on the cycle. The two weights must add up to 100. |
| Essential facilities | None | Toilets (`TOILET`), Water (`BOREHOLE`, `OVERHEAD_TANK`), Solar (`SOLAR_POWER`) | Same | Each school site needs a proposed row, or an existing Functional one, in each group; a gap needs a written justification. |
| Rate tolerance | 15% | 15% | 15% | A BoQ rate this far from the costing standard's rate (for the zone) is flagged. |
| Duplicate check | 100 m, 3 years | Same | Same | Same school and LGA, or a site within the radius, among open proposed projects and recent projects. A flag, never a block. |
| Site verification required | On | On | On | Validation needs a site verification for every proposed project. |
| Counterpart evidence before activation | Off | Off | On | A converted project cannot be activated until its BEAP's counterpart funding evidence is recorded (wave 4). |
| Approval chains (label, permission, organisation scope, deadline) | None | Portfolio: Management review, Executive Secretary approval. Out-of-cycle: Executive Secretary | Portfolio: SUBEB management review (27 Oct), Executive Chairman endorsement (30 Oct). BEAP: UBEC Physical Planning review (22 Nov), UBEC Executive Management approval (30 Nov). Out-of-cycle: Executive Chairman, then UBEC | Steps are copied to the cycle when it opens. "Owning organisation" is the cycle's owner. |

---

## 4. Workflow template settings (process switches and chains)

Phases 11–15 **added no new process switches**. The switches from Phases 7 and 10 are what the programme templates set. On a project they are in More ▸ Settings → Advanced (`/settings/advanced`), filled from the type's workflow template when the type is applied.

| Switch | Default | Demo programme | Effect |
| :--- | :--- | :--- | :--- |
| Report approval | Off | On | Visit submissions go through the report chain (off: accepted at once). Feeds the approval turnaround KPI. |
| Handover module / retention module | Off | On | Handover response and certificate, liability period, defects, and retention held on recorded payments. Off hides the Handover and Defects tabs of Completion & handover. |

The hold points and contractor field reporting switches are removed in R5f (section 1.1).

Approval chain additions:

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Step organisation scope (Phase 11) | `ANY` | `PROJECT_OWNER`, `PROJECT_OWNER_OR_ANCESTOR` or `FUNDER`: the actor must belong to that organisation. Applies to everyone, including the platform super admin. Demo: report and default-case steps limited to the owner. | G10 |
| Contract default chain (Phase 13) | Legal review, then the executive decision | Built from the type's Legal role; the final step needs `contracts:decide_default`. Demo (UBEC): "Director Legal review", then "Executive Secretary (ES) decision" (Direct Intervention) or "SUBEB Executive Chairman decision" (Matching Grants), written by the seed as each project's chain. | G7 |

---

## 5. Project settings (wizard and project settings)

**Setup is five wizard steps (redesign R6a).** Each step groups sections; a section is still the unit that is saved, checked and audited. Drafts open at `/setup/<step>`, live projects at `/settings/<step>` (More ▸ Settings). "Save and continue" saves every changed section of the step and every required section never saved. Old step addresses (`/setup/basics`, `/settings/facility`, …) open the step that holds the section and scroll to it.

| Step (route) | Sections (section id) |
| :--- | :--- |
| 1 Project (`project`) | Project details (`basics`), School and organisations (`parties`), Location (`site`) |
| 2 Contract (`contract`) | Contractor (`contractor`, required), Contract and kick-off (`contract`), Retention and defects liability (`facility`, when the retention module is on) |
| 3 Scope & sprints (`scope`) | Scope & sprints (`scope`, required), Needs assessment and standards (`standards`) |
| 4 Team & visits (`team`) | Team (`team`), Visits (`visits`) |
| 5 Review (`review`) | Open issues grouped by step with Fix links; set the project active |
| Advanced (`advanced`, settings only) | Workflow and process (`process`): template, process switches, approval chains |

| Setting | Where | Effect | Control |
| :--- | :--- | :--- | :--- |
| Project type | Step 1 Project → Project details (drafts only) | Applies the type: copies the template, snapshots the config, pre-fills parties and retention. Locked once live. | G1 |
| Intervention year, funding source, client project ID (UBEC IRL) | Step 1 Project → Project details (drafts and live projects) | Register fields: shown on the Overview and the register, filterable (with LGA and contractor) on the register and KPIs, exported. Year 2000–2100; funding source free text with suggestions (UBEC Intervention Fund, Matching grant (SUBEB counterpart), Special intervention, Development partner); the client project ID is unique in the workspace. The needs assessment's Project sheet fills the year and funding source when empty. | IRL 6–7 |
| Owning organisation, region, beneficiaries (one primary) | Step 1 Project → Project details / School and organisations | Visibility, filters, approvals and the handover recipient. | G10 |
| Site boundary, tolerance, time zone | Step 1 Project → Location (tolerance and time zone collapsed) | Check-in and photo boundary checks on the phone and the server; the project's dates. | G5 |
| Contractor | Step 2 Contract → Contractor | The one contractor organisation, its contacts and planned completion (trade pre-filled "Main contract"). A planned completion before the last sprint's end is warned. | G2 |
| Contract reference, award, signed and kick-off dates | Step 2 Contract → Contract and kick-off | Anchor the contract milestones (preview shown). Every change recomputes due dates and is audited. | G2 |
| Visit officers, working days (redesign R4) | Step 4 Team & visits → Visits (old route `visits` opens it) | The default officers given to proposed visits (the first is the lead; someone not on the project is assigned to it) and the project's working days (visit dates, the move tolerance and deadlines count them). The section previews the visits the type will propose. | D-R4.39 |
| Visits (redesign R4) | Project → Visits & reports (`/visits`, tabs Plan, Findings, Site log; Findings also in the sidebar); Workspace → Visit planner (`/app/visits`) | Create, generate, publish, move, reassign and cancel visits; accept or reject officers' date proposals; review submissions; findings and the site log. Officers respond, check in and submit from the phone only. | P3, P5 |
| Sprint verification (redesign R4) | Sprints & scope → Verify | Met, partly met or not met once a sprint has started (early needs a note). Drives the sprint status (Late, Verified), the schedule badge and the on-time KPI. | Decision V |
| Scope & sprints (redesign R2) | Step 3 Scope & sprints (route `scope`; `/setup/boq` opens it) and the project page Sprints & scope (`/scope`) | Sprints (name, dates, deliverables; any length, gaps allowed, no overlaps; numbered by date), facility units (a facility, a label such as "Ground floor male toilet", start and end sprint, planned quantity for supply items) and BoQ lines (item no., unit, description, unit of measure, quantity, rate; amount = quantity × rate, computed by the server). Lines take their planned dates from their unit's sprints; the project's planned start and end follow the first and last sprint. To activate: at least one sprint and one line, every line on a unit, every unit with both sprints. On a live project every change is audited; units and lines with field evidence cannot be removed, nor a sprint a unit starts or ends in. | Decision R |
| Needs assessment template (redesign R2; named and UBEC-styled in R7) | Step 3 Scope & sprints → Download needs assessment / Import needs assessment | Excel file (title band, green header row, banded rows; files in the older layout still import) with the workspace's live lists (facilities, units of measure, regions, delivery models), pre-filled from the project. Import is for drafts: preview first (lines by facility and sprint, row errors, warnings such as the total being above the budget), then confirm; confirm replaces the draft's sprints, units and lines and fills only the project fields that are empty (a primary school beneficiary, region, LGA, site address, budget, delivery model, a radial site boundary of the workspace default radius from the GPS point, intervention year, funding source, strategic justification, assumptions). The blank "UBEC needs assessment template" (the workspace's lists only) downloads from Forms & facilities → Facilities → Download template; a project's own "<code> needs assessment" file also downloads from the "Needs assessment and standards" section of step 3. Live projects change scope on the Sprints & scope page instead, except a project imported from the register that has no scope yet (UBEC IRL), which takes its first needs assessment. | Decision Y |
| Retention percentage and liability period | Step 2 Contract → Retention and defects liability (section id `facility`) | Held from each recorded payment; changes apply to later payments. | Decision Q |
| Payments | Project → Payments | Record interim, final and retention-release payments made outside the platform, optionally naming a sprint (a sprint a payment names cannot be removed); void a wrong entry with a reason. Exceptions are flagged, not blocked. Filters (kind, sprint, exceptions only), a paid-against-contract-sum bar (also on the Overview) and a Release checks panel (CoC issued, liability period end, open defects). | Decision Q |
| Project stage and phase changes (redesign R6c) | Project → Overview | The stage bar (Kick-off, Mobilisation, Construction, Completion, Closure) is derived, not set. The phase actions under it ("Start handover", "Start defects liability period", "Close the project") change the construction phase; a blocked action shows why (for example the CoC gate). | G6 |

---

## 6. Permission catalogue (redesign R7a)

The catalogue lives in `SYSTEM_PERMISSIONS_CATALOG` (`shared/src/enums.ts`). Code owns the permission rows: `syncPermissionCatalog` upserts every entry at server start, in the seed and when a tenant is provisioned, and never deletes; renames and removals are migration SQL (`20261225090000_r7a_permission_catalogue`), so a renamed key keeps its row and every role that held it, default or custom, keeps it. Categories follow the programme flow and only group the role editor.

**Roles.** The UBEC demo uses six roles, applied to its tenant by the seed (`tailorUbecRoles` in `server/src/db/seedUbecRoster.ts`); the shared defaults (`shared/src/defaultRoles.ts`: Tenant Super Admin, Independent Monitor, Funder / Finance Officer, Organisation Administrator, Monitor Inspector, Independent Resident) still serve the legacy test tenant. Role codes are unchanged. The final role set is decided after the demo and promoted to the shared defaults then (`next_steps/role_catalogue_migration_plan.md`).

| UBEC role (code) | Surface | Permissions in short |
| :--- | :--- | :--- |
| UBEC Administrator (`TENANT_SUPER_ADMIN`) | Web | Every permission. Acts for the functions without a login (Director Legal, Executive Secretary, Procurement, Finance & Accounts, Audit). |
| SUBEB Administrator (`ORGANIZATION_ADMIN`) | Web | Organisation tree, portfolio, KPIs, audit ledger, `payments:view`, visits view, finding escalations, documents, milestones (manage, waive), kick-off, default cases (raise, decide), CoC (draft, sign, revoke), closure checklist and pack, ratings, lessons. |
| UBEC M&E Officer (`UBEC_ME_OFFICER`), SUBEB M&E Officer (`SUBEB_ME_OFFICER`) | Both | Assigned projects only. Scope view, schedule status, visits (view, plan, review, submit), findings and escalations, `incidents:view`, sprint verification, documents (view, upload), handover (record, review), defects, milestones, CoC signature, ratings, lessons, KPIs. |
| Independent M&E, COREN-certified firm (`MONITOR`) | Both | Assigned projects only. Scope view, schedule status, visits (view, submit), `incidents:view`, documents (view, upload), lessons, KPIs. |
| Resident Supervisor (`INDEPENDENT_RESIDENT`) | Field app | Visits (view, submit), scope view, findings, defects. Web sign-in refused (below). |
| Needs pipeline roles (wave 1, 2026-11-26; `NEEDS_PIPELINE_GRANTS`): Executive Secretary (`EXECUTIVE_SECRETARY`), Director, Physical Planning (`DIRECTOR_PHYSICAL_PLANNING`), Finance Officer (`FINANCE_OFFICER`), Procurement Officer (`PROCUREMENT_OFFICER`), Quantity Surveyor (`QUANTITY_SURVEYOR`), SUBEB Director, Physical Planning (`SUBEB_DIRECTOR_PHYSICAL_PLANNING`), SUBEB Procurement Officer (`SUBEB_PROCUREMENT_OFFICER`) | Web | In the normal seed only their needs assessment permissions (plan section 8; the SUBEB Director also reviews the portfolio). The UBEC M&E Officer also holds `needs:view` and `needs:validate`; the SUBEB Administrator the Executive Chairman's grants (chair, review, approve, out-of-cycle, override). The demo overlay adds the project permissions of its cast. |

**Rules that hold whatever the role (redesign R7b).**
- A user whose main role's surface is Field app (Resident Supervisor) cannot sign in on the web: 403 `WEB_ACCESS_NOT_ALLOWED`, and web tokens issued earlier stop working. Roles with surface Both use the same credentials on the web and the field app. Platform super admins are never refused.
- The person who recorded a handover response cannot review it: 409 `SAME_PERSON_REVIEW`. Another holder of `handover:review_feedback` reviews it.

### 6.1 Catalogue

| Category | Key | Name | Surface | Legacy default roles holding it |
| :--- | :--- | :--- | :--- | :--- |
| Workspace & access | `tenant:manage_branding` | Manage Workspace Branding | Web | – |
| Workspace & access | `tenant:manage_settings` | Manage Workspace Settings | Web | – |
| Workspace & access | `roles:create_edit` | Create & Edit Roles | Web | – |
| Workspace & access | `users:invite_manage` | Manage Users & Project Assignments | Web | – |
| Workspace & access | `users:revoke_device` | Revoke Field App Devices & Sessions | Web | MONITOR |
| Workspace & access | `organizations:manage` | Manage Organisation Directory | Web | – |
| Workspace & access | `regions:manage` | Manage Regions | Web | – |
| Workspace & access | `project_types:manage` | Manage Project Types | Web | – |
| Workspace & access | `templates:manage_workflows` | Configure Workflow Templates | Web | – |
| Workspace & access | `documents:manage_types` | Manage Document Types | Web | – |
| Forms & facilities | `facilities:manage` | Manage Facility Catalogue | Web | MONITOR |
| Forms & facilities | `forms:manage` | Manage Form Library | Web | MONITOR |
| Needs assessment & funding | `needs:view` | View Needs Assessment Cycles | Web | – |
| Needs assessment & funding | `needs:manage_cycle` | Open & Manage Cycles | Web | – |
| Needs assessment & funding | `needs:submit` | Upload Needs Assessments | Web | – |
| Needs assessment & funding | `needs:validate` | Validate Proposed Projects | Web | – |
| Needs assessment & funding | `needs:cost` | Cost Proposed Projects | Web | – |
| Needs assessment & funding | `needs:score` | Score Proposed Projects | Web | – |
| Needs assessment & funding | `needs:chair_committee` | Chair the Steering Committee | Web | – |
| Needs assessment & funding | `needs:submit_portfolio` | Submit the Prioritised Portfolio | Web | – |
| Needs assessment & funding | `needs:review_portfolio` | Review the Portfolio | Web | – |
| Needs assessment & funding | `needs:approve_portfolio` | Approve the Portfolio | Web | – |
| Needs assessment & funding | `needs:record_funding` | Record Budget & Appropriation | Web | – |
| Needs assessment & funding | `needs:prepare_beap` | Prepare the BEAP | Web | – |
| Needs assessment & funding | `needs:review_beap` | Review BEAPs | Web | – |
| Needs assessment & funding | `needs:approve_beap` | Approve BEAPs | Web | – |
| Needs assessment & funding | `needs:approve_out_of_cycle` | Approve Out-of-Cycle Projects | Web | – |
| Needs assessment & funding | `needs:override_separation` | Authorise Separation of Duties Overrides | Web | – |
| Needs assessment & funding | `standards:manage` | Manage Costing & Design Standards | Web | – |
| Portfolio & projects | `projects:view_assigned` | View Assigned Projects | Web | MONITOR, LENDER, ORGANIZATION_ADMIN |
| Portfolio & projects | `projects:view_all_tenant` | View Every Project | Web | MONITOR, LENDER |
| Portfolio & projects | `projects:view_organization_tree` | View Projects Owned by My Organisation Tree | Web | ORGANIZATION_ADMIN |
| Portfolio & projects | `projects:view_portfolio` | View Portfolio Dashboard | Web | MONITOR, LENDER, ORGANIZATION_ADMIN |
| Portfolio & projects | `kpis:view` | View Programme KPIs | Web | MONITOR, LENDER, ORGANIZATION_ADMIN |
| Portfolio & projects | `projects:create` | Create Projects | Web | MONITOR |
| Portfolio & projects | `projects:activate` | Activate Draft Projects | Web | MONITOR |
| Portfolio & projects | `projects:edit_baseline` | Edit Project Details & Site | Web | MONITOR |
| Portfolio & projects | `projects:manage_standards_docs` | Manage Standards & Needs Assessments | Web | MONITOR |
| Portfolio & projects | `procurement:plan_lots` | Plan Procurement Lots | Web | – |
| Portfolio & projects | `approved_lists:view` | View Approved Project Lists (client demo wave 3) | Web | – (see 2.2) |
| Portfolio & projects | `approved_lists:manage` | Upload Approved Project Lists (client demo wave 4) | Web | – (see 2.2) |
| Scope & sprints | `scope:view` | View Scope & Sprints | Both | MONITOR, LENDER, ORGANIZATION_ADMIN, MONITOR_INSPECTOR, INDEPENDENT_RESIDENT |
| Scope & sprints | `scope:edit` | Edit Scope & Sprints | Web | MONITOR |
| Scope & sprints | `sprints:view_status` | View Schedule Status | Web | MONITOR, LENDER, ORGANIZATION_ADMIN |
| Scope & sprints | `sprints:verify` | Verify Sprints | Web | MONITOR |
| Contract & kick-off | `contractors:manage` | Manage the Project Contractor | Web | MONITOR |
| Contract & kick-off | `milestones:manage` | Manage Contract Milestones | Web | MONITOR, ORGANIZATION_ADMIN |
| Contract & kick-off | `milestones:waive` | Waive Contract Milestones | Web | ORGANIZATION_ADMIN |
| Contract & kick-off | `kickoff:manage` | Manage the Kick-off Meeting | Web | MONITOR, ORGANIZATION_ADMIN |
| Contract & kick-off | `contracts:raise_default` | Raise and Review Contractor Default Cases | Web | MONITOR, ORGANIZATION_ADMIN |
| Contract & kick-off | `contracts:decide_default` | Decide Contractor Default Cases | Web | ORGANIZATION_ADMIN |
| Contract & kick-off | `documents:view` | View Project Documents | Web | MONITOR, LENDER, ORGANIZATION_ADMIN |
| Contract & kick-off | `documents:upload` | Upload Project Documents | Web | MONITOR, ORGANIZATION_ADMIN |
| Visits & findings | `visits:view` | View Visits | Both | MONITOR, LENDER, ORGANIZATION_ADMIN, MONITOR_INSPECTOR, INDEPENDENT_RESIDENT |
| Visits & findings | `visits:plan` | Plan Visits | Web | MONITOR |
| Visits & findings | `visits:submit` | Carry Out Visits | Field app | MONITOR, MONITOR_INSPECTOR, INDEPENDENT_RESIDENT |
| Visits & findings | `visits:review` | Review Visit Submissions | Web | MONITOR |
| Visits & findings | `findings:manage` | Raise and Close Findings | Web | MONITOR, MONITOR_INSPECTOR, INDEPENDENT_RESIDENT |
| Visits & findings | `findings:receive_escalations` | Receive Finding Escalations | Web | ORGANIZATION_ADMIN |
| Visits & findings | `defects:manage` | Manage Defect Tickets | Both | MONITOR, MONITOR_INSPECTOR, INDEPENDENT_RESIDENT |
| Visits & findings | `incidents:view` | View & Follow Up Incidents | Web | MONITOR |
| Visits & findings | `incidents:view_confidential` | View Confidential Reporter Identity | Web | – |
| Payments & retention | `payments:view` | View Payments & Retention | Web | MONITOR, LENDER, ORGANIZATION_ADMIN |
| Payments & retention | `payments:record` | Record & Void Payments | Web | LENDER |
| Completion & closure | `completion:draft_certificate` | Draft Certificates of Completion | Web | MONITOR, ORGANIZATION_ADMIN |
| Completion & closure | `completion:sign_certificate` | Sign Certificates of Completion | Web | ORGANIZATION_ADMIN |
| Completion & closure | `completion:revoke_certificate` | Revoke Certificates of Completion | Web | ORGANIZATION_ADMIN |
| Completion & closure | `handover:record_response` | Record Handover Responses | Web | MONITOR |
| Completion & closure | `handover:review_feedback` | Review Handover Responses | Web | MONITOR, LENDER |
| Completion & closure | `closure:manage_checklist` | Manage the Closure Checklist | Web | MONITOR, ORGANIZATION_ADMIN |
| Completion & closure | `closure:audit_signoff` | Sign Off the Closure Audit | Web | LENDER |
| Completion & closure | `closure:export_pack` | Export the Closure Pack | Web | MONITOR, LENDER, ORGANIZATION_ADMIN |
| Completion & closure | `contractors:rate_performance` | Rate Contractor Performance | Web | MONITOR, ORGANIZATION_ADMIN |
| Completion & closure | `lessons:manage` | Record Lessons Learned | Web | MONITOR, ORGANIZATION_ADMIN |
| Completion & closure | `lessons:view` | Browse Lessons Learned | Web | MONITOR, LENDER, ORGANIZATION_ADMIN |
| Completion & closure | `audit:view_ledger` | View the Audit Ledger | Web | MONITOR, LENDER, ORGANIZATION_ADMIN |

### 6.2 Keys renamed or removed in the redesign

Renamed in R7a (migration `20261225090000_r7a_permission_catalogue`; also `RENAMED_PERMISSION_KEYS` in shared). Where two old keys map to one new key, holders of either hold the new one. `reports:raise_query` became `incidents:view` (it only gated incidents), so no role gained visit review.

| Old key | New key |
| :--- | :--- |
| `boq:view` | `scope:view` |
| `boq:upload_edit` | `scope:edit` |
| `schedule:view_variance` | `sprints:view_status` |
| `contractors:manage_packages` | `contractors:manage` |
| `sessions:revoke_device` | `users:revoke_device` |
| `retention:manage_defects` | `defects:manage` |
| `inspections:manage_findings` | `findings:manage` |
| `reports:approve_completion` | `visits:review` |
| `reports:raise_query` | `incidents:view` |
| `field:submit_report` | `visits:submit` |
| `inspections:submit` | `visits:submit` |
| `reports:view_all` | `visits:view` |
| `inspections:view` | `visits:view` |
| `field:raise_incident` | removed |
| `reports:respond_query` | removed |

Removed earlier: R1d `field:join_project`, `assurance:review_credentials` (and `handover:manage_links` renamed to `handover:record_response`; the contractor roles are gone, decision P2); R1e `projects:view_executive_matrix`, `mobilization:manage_roster`, `mobilization:configure_reminders`, `presence:view_telemetry`, `presence:manage_noshow_alerts`, `field:manual_checkin`; R2d `schedule:catch_up_refactor`, `schedule:approve_refactor`, `schedule:propose_programme`, `boq:configure_hold_points`; R3e `inspections:manage_templates` (its holders got `forms:manage`).

---

## 7. KPI catalogue (Phase 16)

The catalogue is fixed in code; tenants set targets and visibility only (section 3.8). "Not tracked" means the KPI's inputs are not configured on a project; it is never shown as 0%.

| Stage | KPI | Counted from | Period-based | Default target |
| :--- | :--- | :--- | :--- | :--- |
| Kick-off | Kick-off agenda prepared | Kick-off meeting with an agenda document | Yes | ≥ 100% |
| Kick-off | Kick-off notices sent on time | Kick-off notice milestone done by its due date | Yes | ≥ 90% |
| Kick-off | Kick-off attendance | Invitees attended / invited | Yes | ≥ 80% |
| Kick-off | Meetings documented and signed | Minutes filed and signed (counted from 7 days after the meeting) | Yes | ≥ 90% |
| Mobilisation | Projects with a supervisor assigned | Assigned users in the type's supervisor roles, or a lead officer on a published visit | No | ≥ 100% |
| Mobilisation | Letters of introduction on time | Milestones needing a letter of introduction | Yes | ≥ 90% |
| Mobilisation | Contractors mobilised on time | Contractor-on-site milestones | Yes | ≥ 90% |
| Mobilisation | Full mobilisation documentation | The type's before-mobilisation documents filed (projects under construction) | No | ≥ 100% |
| M&E | Sites with baseline data | An accepted baseline visit (projects whose plan has one) | No | ≥ 100% |
| M&E | Visits conducted vs planned | Planned visits dated in the period: submitted / (submitted + missed); unscheduled visits are not counted | Yes | ≥ 90% |
| M&E | Reports submitted on time | Visits whose deadline fell in the period, submitted by it | Yes | ≥ 85% |
| M&E | Average approval turnaround | Days from submission to final approval of visit submissions (legacy workday reports and inspections stop counting when R5f removes them) | Yes | ≤ 5 days |
| M&E | Sprints verified on time | Sprints verified by their end date + the verification period | Yes | ≥ 90% |
| Payments | Financial utilisation | Paid to date (net, from the payment record) / budget (weighted by budget) | No | none |
| Closure | Verified on time and to specification | CoC completion date ≤ planned end, no major issues in the final evaluation | Yes | ≥ 80% |
| Closure | Handed over on time after the CoC | Handover milestone done by its due date | Yes | ≥ 90% |
| Closure | Full closure documentation | Every document item of the closure checklists filed (liability period or closed) | No | ≥ 100% |
| Closure | Lessons learned documented | Closed projects with the closeout report filed (it carries the lessons; R7) | No | ≥ 100% |
| Closure | Audited after closure | Audit sign-off item done (closed projects whose checklists include one) | No | ≥ 100% |
| Schedule | Projects on schedule | Schedule badge on track or complete (computed from sprints and, since R4, their verification) | No | ≥ 80% |

Period-based KPIs count what fell due, was held, issued or decided in the chosen period (month, quarter or custom). The others show today's value. A daily job stores each project's figures for the monthly trend lines.

**Time zone.** Periods are read in the tenant's time zone (Settings → Tenant Settings → Workspace settings): "this month", the default period, the snapshot day and the trend months are the tenant's. Events counted into a period (approvals, release decisions, certificate issue) are dated in the tenant's zone. Project deadlines and on-time checks use the project's own zone, as everywhere else in the platform. The page shows the zone next to the period.

---

## 8. Questions to settle with the client

| Topic | Setting | Default if not answered |
| :--- | :--- | :--- |
| Who signs the CoC, and in which organisation? | CoC signatories | Two owner-organisation admins + beneficiary. |
| Mobilisation period per model | Mobilisation milestone offset | 21 days Direct Intervention, 14 days Matching Grants. |
| Which gates need an issued CoC? | Closure gates | All three on in the demo. |
| KPI targets per model | KPI targets | Catalogue defaults; demo values above. |
| Supervisor site limits | Supervision limits | 2 sites / 50 km on Matching Grants in the demo. |
| What "indicators" means in the monitoring framework | (not built, G14) | Programme outcome indicators are not tracked. |
