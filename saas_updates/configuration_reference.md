# Configuration Reference: Programme Delivery (Phases 11–16)

**For:** the delivery team preparing client workshops on the Central and Co-Funded delivery models.
**Use:** go through it setting by setting with the client. Each row says where the setting lives, its default, what it changes, and which process-flow control (gap analysis IDs G1–G14) it serves.

**Last updated:** 2026-11-24 (redesign R2: facility catalogue, scope and sprints, the needs-assessment workbook; schedule revisions and the programme-of-works proposal removed).

---

## 1. How to read this

**Where settings live**

| Level | Who sets it | When it applies |
| :--- | :--- | :--- |
| **Workspace (tenant)** | Tenant administrator, in Settings | At once, for every project. |
| **Project type** | Holder of `project_types:manage`, in Settings → Project types, regions & documents | Saving writes a new type version. **New projects take the version current when the type is applied; existing projects keep theirs.** Exception: KPI targets apply to every project of the type at once. |
| **Workflow template** | Holder of the workflow permission, in Settings → Workflow templates | Process switches and approval chains, copied to a project when its type is applied. |
| **Project** | Project team, in the setup wizard (drafts) or project settings (live) | That project only. |

**Defaults.** Every setting defaults to how the platform behaved before Phase 11. A project with no project type behaves exactly as before.

**Every project type setting below has a field in the type editor.** The one exception is the beneficiary signature mode: it has a single value ("recorded by staff") until D-15.1 changes, so there is nothing to choose. Role and template pickers list the workspace's roles, visit form templates and (legacy) checklist templates. A code that no longer exists is flagged so it can be removed.

---

## 2. Workspace (tenant) settings

| Setting | Where | Default | Effect | Control |
| :--- | :--- | :--- | :--- | :--- |
| Organisation hierarchy (parent organisation) | Settings → Organisations | None (flat) | Up to 5 levels. Lets a flagship see and approve for its subsidiaries; cycles are refused. | G10 |
| Regions and areas | Settings → Project types, regions & documents → Regions | None | Two levels (region → area). Used by project filters, the portfolio map and KPIs. A region filter includes its areas. | G10 |
| Terminology | Settings → Tenant Settings → Terminology | Funder, Independent monitor, Contractor, Beneficiary, Hold point, Retention | Display labels only (singular and plural), on web and mobile. API fields and audit text keep the canonical names. Demo tenant: funder = "Funding authority". (Redesign R1b removed Tranche, Condition precedent, IPC and Valuation.) | G1 |
| Document types | Settings → Project types, regions & documents → Document types | 18 types (contract, award and acceptance letters, kick-off pack, minutes, mobilisation agreement and plan, letter of introduction, site possession, supervisor assignment, CoC, handover certificate, final evaluation, closure file and others) | Per type: sign-off required, allowed files, and whether contractors can see it. Milestones, checklists and KPIs refer to types by code. | G3 |
| Inspection checklist templates (legacy) | Not editable since redesign R3e | The demo has Baseline survey, Routine visit, Mobilisation check and Final evaluation. A workspace created after R3 has none. | Only the old mobile app still submits Phase 14 inspections (until R5). Visits (redesign R4) use the form library. | G5 |
| Visit move tolerance (redesign R4) | Settings → Tenant Settings → Workspace settings | 2 working days (0–10) | An officer may move a visit this many working days either side of its original date, inside the same sprint, without asking; further moves are proposed to the manager. Measured from the original date, so repeated small moves cannot walk a visit away. | Q-H, P5 |
| Contractor rating criteria | Settings → Tenant Settings → Rating criteria | Time, Quality, Health & safety, Responsiveness, Documentation | Criteria scored 1–5 at completion and after closure. | G6 |
| Site boundaries (redesign) | Settings → Tenant Settings → Workspace settings | Radial and perimeter enabled; default radius 150 m; tolerance 100 m | Which boundary types projects may use (linear corridors were removed). The default radius pre-fills a new radial boundary and the boundary made from a workbook's GPS point; each project sets its own radius and may override the tolerance on its Site step. | G5 |
| Facility catalogue (redesign R2) | Settings → Forms & facilities → Facilities (`facilities:manage`) | 50 facilities: 19 building works (Classroom, Toilet, Hostel…), 22 supply & installation (pupils' furniture, science kit, computers…), 4 utilities (Borehole, Overhead tank, Generator, Solar power), 5 external works (Fence, Drainage, Football pitch…) | Scope lines are tagged with facilities through facility units. Per facility: code (locked once a unit uses it), name, plural (R3: only when the plain plural is wrong; set by default for Staff quarters, Solar power, Landscaping, Drainage), category, archetype (decides whether units carry a planned quantity and the default sub-form). A retired facility stays on the projects that use it and leaves the pickers and the workbook. | Decision Y |
| Form library (redesign R3) | Settings → Forms & facilities (`forms:manage`) | 10 fixed sections, 4 archetype sub-forms, 7 visit form templates (one per visit kind, code = kind); see 2.1 | The questions of every visit form. Versioned: a version a built form used is never edited, saving makes a new one. | Decision Y, P3 |
| Units of measure (redesign R2) | Fixed list (not editable in v1) | m, m², m³, nr, item, LS, kg, t, set, lot, l | The workbook dropdown, the Scope & sprints page and server validation. A client list would become a workspace setting later (D-R2.7). | – |

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

---

## 3. Project type settings

Set in Settings → Project types, regions & documents → Project types. One type per delivery model. The demo has "Central Delivery Model" and "Co-Funded Delivery Model".

### 3.1 Identity and process

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Code, name, colour, description | – | Shown on the directory, map, matrix and KPIs. | G1 |
| Workflow template | Required | Process switches and approval chains copied to the project (section 4). | G1 |
| Default type | Off | Pre-selected for new drafts. Once a tenant has active types, every new draft needs a type. | G1 |
| Active | On | Archived types cannot be applied to new drafts. | G1 |

### 3.2 Ownership and parties

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Owning organisation required | Off | The Parties step needs an accountable owner. | G10 |
| Allowed owners | Any organisation | Limits who can own projects of the type. Demo: Central = flagship only; Co-Funded = North or South. | G10 |
| Default owner | None | Pre-filled on new drafts (must be an allowed owner). | G10 |
| Monitor / funder / beneficiary / region required | Monitor and funder on; beneficiary and region off | The Parties and Basics steps refuse to continue without them. | G10 |
| Funder default | `NONE` | `OWNER`: the owner funds the project (Co-Funded). `FIXED`: a named organisation (Central: the flagship). | G10 |

### 3.3 Visit plan and deadlines (redesign R4, type key `monitoring`)

Replaces the Phase 8 reporting defaults and the Phase 14 reporting streams (both removed in R4f). Like every type rule except KPI targets, a project keeps the version it was created with.

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Visit plan rules (visit kind, when, interval, sprints, offsets) | None (demo: mobilisation checks every 2 weeks until the contractor is on site; baseline 5 working days after the later of activation and kick-off; routine every 2 weeks during construction; quarterly M&E 5 working days into each quarter's last month; final evaluation 5 working days after the completion notice; Co-Funded: post-closure evaluation on its closure milestone, else 180 days after closing) | Activation proposes the visits (all of them, through the last sprint); a live sprint change regenerates the proposed sprint-driven ones; the completion notice proposes the final evaluation, closing the post-closure one. The M&E manager assigns officers and publishes them. Dates fall on working days. | P3, Q-H |
| Submit within | 7 days | The submission deadline is the visit date plus this many calendar days; later is late, and with nothing submitted the visit becomes missed. | Spec 8.1 |
| Remind unconfirmed | 2 days before | Officers who have not confirmed get one reminder. | Spec 8.1 |
| Escalate findings after | 14 days | An open finding is escalated once to holders of `findings:receive_escalations`. | Confirm |
| Warn after no visit for | 4 weeks | Planner warning only. | Spec 8.1 |
| Verify sprints within | 7 days | After a sprint ends it should be verified within this many days; then it shows Late and, with a unit below 100%, the schedule badge turns behind. | Confirm |
| Email the contractor the open findings | On | After each accepted visit with open or newly resolved findings, the contractor organisation's contact email gets a summary (no comments, no photos). | Spec 6.5 |

### 3.4 Payments (redesign R1b)

Professional registration (policy, bodies, certifier snapshots) was removed in redesign R1d (decision U).

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Retention percentage | None | Pre-fills the Retention step of a new project. Recorded payments hold this percentage back (another amount needs a reason). Payments are made outside the platform and recorded on the project's Payments page. | Decision Q |
| Defects liability period (months) | None | Pre-fills the Retention step. The retention release is flagged when recorded before the period ends. | Decision P1 |

### 3.5 Contract milestones and kick-off (Phase 13)

Edited in the type editor's contract rules section.

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Contract milestone templates | None | Dated obligations created on each project. Per milestone: key, label, anchor (contract award, contract signed, kick-off, activation, another milestone, CoC issued, project closed), offset (calendar or working days, negative = before), completion mode, required documents, a sign-off permission, responsible role and organisation, one per contractor. | G2 |
| Completion modes | Manual | Contractor on site (confirmed by an officer through the complete button; telemetry was removed in redesign R1e), and automatic: kick-off notice sent, kick-off quorum, programme accepted (the programme of works document is signed off; redesign R2d), CoC issued, handover accepted, final evaluation approved. | G2 |
| **Mobilisation days** | – | The offset of the "contractor mobilised" milestone from kick-off. Demo: Central 21 days, Co-Funded 14 days (decision M). | G2 |
| Kick-off quorum groups | None | At least one attendee per group (demo: owner, monitor, contractor, beneficiary), or a waiver reason. | G2 |
| Kick-off notice lead time | 7 days | The notice must go out this many days ahead, or the shortfall is waived with a reason. | G2 |

### 3.6 Documents, default cases, inspections and supervision (Phases 13–14)

Edited in the type editor's "Required documents and contractor default" and "Monitoring: streams, inspections and supervision" sections (the latter also holds "Visit forms", redesign R3).

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Documents needed before going live | None | Document types needed before the project can go live. | G3 |
| Documents needed before mobilisation | None | Shown on the mobilisation compliance panel per contractor. Counted by the "full mobilisation documentation" KPI. Demo: mobilisation agreement and site possession form. | G3 |
| Legal role | None | The Legal role: told about new default cases, and names the review step. Demo: `LEGAL_OFFICER`. | G7 |
| Open a default case when mobilisation is overdue | On | An overdue contractor-on-site milestone opens a default case once. The case runs Legal review, then the executive decision (`contracts:decide_default`). | G7 |
| Visit forms (redesign R3) | Default (the template whose code is the visit kind) | The visit form template per visit kind. Only a live template of that kind can be chosen. Projects keep the choice they were created with; the latest version of the template is used when a form is built. Demo: code = kind for every kind. | Decision Y |
| Legacy inspection checklists (Phase 14) | None | The checklist template per visit type for Phase 14 inspections (removed in R4). | G5 |
| Supervisor roles | None | Roles whose users count as supervisors (workload view, "supervisor assigned" KPI). | G9 |
| Most sites per supervisor / furthest distance between sites | No limit | The workload warns above them and never blocks. Demo: Co-Funded 2 sites, 50 km. | G9 |

### 3.7 Completion and closure (Phase 15)

Edited in the type editor's closure rules section.

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| **CoC signatories** | Head of Physical Planning and Head of M&E (owning organisation), plus the beneficiary institution | Up to 8 slots, each with a permission (default `completion:sign_certificate`), an optional role, and an organisation scope (any, owner, owner or above, funder, monitor). One slot per person. The last signature issues the certificate and its PDF. | G6, decision O |
| Beneficiary signature | Recorded by staff | Staff upload the signed paper copy and attest (D-15.1). The beneficiary has no login (R1d). | G6 |
| Final evaluation before the CoC | Off | A CoC can only be drafted after an approved final evaluation inspection. | G6 |
| Gates needing an issued CoC | None | Liability period (handover → retention) and closure are refused without it. Final payment: a FINAL payment or retention release recorded without it is flagged as an exception (payments are made outside the platform). | G6 |
| Handover due after the CoC | 7 days | Dates the handover ceremony milestone. | G6 |
| Before-closing checklist | None | Items: document filed (and, per item, whether its current version must be signed), inspection approved, milestone done, contractors rated, lessons published, audit sign-off, manual. Each must be met or waived before closing. | G6 |
| Before-archiving checklist | None | The same item kinds, needed before archiving. Demo (Co-Funded): post-closure evaluation 14 days after closing, and an audit sign-off that cannot be waived. | G6 |
| Share ratings with the contractor | Off | Contractors see their own ratings when on. | G6 |

### 3.8 KPI targets (Phase 16)

Edited in the type editor's "KPI targets" section. **Changes apply to every project of the type at once.** Unlike the rules above, targets are reporting settings.

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Target per KPI | Catalogue default (section 6) | "At least" for percentages, "at most" for durations. Blank means no target, and the KPI is shown without a status colour. Met = on target; near = within 10%; missed = further. | G8 |
| Shown | On | Off hides the KPI for projects of the type. A KPI hidden on every type in view drops off the page. | G8 |

Demo values: Central (mobilisation 90%, reports 85%, visits 90%); Co-Funded (mobilisation 85%, reports 80%, visits 85%, approval 7 days). Financial utilisation has no target.

---

## 4. Workflow template settings (process switches and chains)

Phases 11–15 **added no new process switches**. The switches from Phases 7 and 10 are what the programme templates set:

| Switch | Default | Demo programme | Effect |
| :--- | :--- | :--- | :--- |
| Report approval | Off | On | Reports and inspections go through the report chain. Feeds the approval turnaround KPI. |
| Handover module / retention module | Off | On | Handover links, handover certificate, liability period, defects, and retention held on recorded payments. |

Approval chain additions:

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Step organisation scope (Phase 11) | `ANY` | `PROJECT_OWNER`, `PROJECT_OWNER_OR_ANCESTOR` or `FUNDER`: the actor must belong to that organisation. Applies to everyone, including the platform super admin. Demo: report and default-case steps limited to the owner. | G10 |
| Contract default chain (Phase 13) | Legal review, then the executive decision | Built from the type's Legal role; the final step needs `contracts:decide_default`. | G7 |

---

## 5. Project settings (wizard and project settings)

| Setting | Where | Effect | Control |
| :--- | :--- | :--- | :--- |
| Project type | Basics step (drafts only) | Applies the type: copies the template, snapshots the config, pre-fills parties and retention. Locked once live. | G1 |
| Owning organisation, region, beneficiaries (one primary) | Basics / Parties steps | Visibility, filters, approvals and the handover recipient. | G10 |
| Contract reference, award, signed and kick-off dates | Contract step | Anchor the contract milestones. Every change recomputes due dates and is audited. | G2 |
| Visit officers, working days (redesign R4) | Visits step (route `visits`, replaces the Reporting step) | The default officers given to proposed visits (the first is the lead; someone not on the project is assigned to it) and the project's working days (visit dates, the move tolerance and deadlines count them). The step previews the visits the type will propose. | D-R4.39 |
| Visits (redesign R4) | Project → Visits; tenant → Visit planner | Create, generate, publish, move, reassign and cancel visits; accept or reject officers' date proposals; review submissions; findings and the site log. | P3, P5 |
| Sprint verification (redesign R4) | Scope & sprints → Verify | Met, partly met or not met once a sprint has started (early needs a note). Drives the sprint status (Late, Verified), the schedule badge and the on-time KPI. | Decision V |
| Scope & sprints (redesign R2) | Scope & sprints step (route `scope`, replaces the BOQ step) and the project page Scope & sprints | Sprints (name, dates, deliverables; any length, gaps allowed, no overlaps; numbered by date), facility units (a facility, a label such as "Ground floor male toilet", start and end sprint, planned quantity for supply items) and BoQ lines (item no., unit, description, unit of measure, quantity, rate; amount = quantity × rate, computed by the server). Lines take their planned dates from their unit's sprints; the project's planned start and end follow the first and last sprint. To activate: at least one sprint and one line, every line on a unit, every unit with both sprints. On a live project every change is audited; units and lines with field evidence cannot be removed, nor a sprint a unit starts or ends in. | Decision R |
| Needs-assessment workbook (redesign R2) | Scope & sprints → Download workbook / Import workbook | Excel workbook with the workspace's live lists (facilities, units of measure, regions, delivery models), pre-filled from the project. Import is for drafts: preview first (lines by facility and sprint, row errors, warnings such as the total being above the budget), then confirm; confirm replaces the draft's sprints, units and lines and fills only the project fields that are empty (a primary school beneficiary, region, LGA, site address, budget, delivery model, a radial site boundary of the workspace default radius from the GPS point, strategic justification, assumptions). A blank workbook (the workspace's lists only) downloads from Settings → Facilities; a project's own workbook also downloads from the needs-assessment section of the Standards step. Live projects change scope on the page instead. | Decision Y |
| Retention percentage and liability period | Retention step (route `facility`) | Held from each recorded payment; changes apply to later payments. | Decision Q |
| Payments | Project → Payments | Record interim, final and retention-release payments made outside the platform; void a wrong entry with a reason. Exceptions are flagged, not blocked. | Decision Q |

---

## 6. Permissions added in Phases 11–16

Default roles: **TSA** Tenant Super Admin, **MON** Independent Monitor, **LEN** Lender/funder, **OA** Organisation Administrator. The Tenant Super Admin holds every permission except the segregated disbursement ones.

| Phase | Permission | What it allows |
| :--- | :--- | :--- |
| 11 | `project_types:manage` | Define delivery models. |
| R4 | `visits:view` | See visits, the planner, submissions, findings on visits and the site log (MON, LEN, OA, field roles). |
| R4 | `visits:plan` | Create, generate, publish, move, reassign and cancel visits; decide date proposals (MON, TSA). |
| R4 | `visits:submit` | Field roles: respond to their visits, check in and submit (Monitor Inspector, Independent Resident). |
| R4 | `sprints:verify` | Verify sprints (MON, TSA). |
| R4 | `findings:receive_escalations` | Notified of escalated findings (TSA, OA). |
| 11 | `regions:manage` | Manage regions and areas. |
| 11 | `projects:view_organization_tree` | See projects owned by the user's organisation or below it. |
| 11 | `projects:view_portfolio` | Portfolio dashboard (map and portfolio KPI cards). |
| 13 | `documents:view`, `documents:upload`, `documents:manage_types` | Document register and document types. |
| 13 | `milestones:manage`, `milestones:waive` | Complete and waive contract milestones; move anchor dates. |
| 13 | `kickoff:manage` | Schedule the kick-off, send the notice, record attendance and minutes. |
| 13 | `contracts:raise_default`, `contracts:decide_default` | Open and review default cases; make the final decision. |
| 14 | `inspections:submit`, `inspections:view`, `inspections:manage_findings` | Site inspections and findings (`inspections:manage_templates` was removed in R3e). |
| 15 | `completion:draft_certificate`, `completion:sign_certificate`, `completion:revoke_certificate` | Certificate of Completion. |
| 15 | `closure:manage_checklist`, `closure:audit_signoff`, `closure:export_pack` | Closure checklist, audit sign-off, closure pack. |
| 15 | `contractors:rate_performance` | Rate contractors and see ratings across projects. |
| 15 | `lessons:manage`, `lessons:view` | Record and browse lessons learned. |
| 16 | `kpis:view` | Programme KPIs page and the project KPI card (TSA, MON, LEN, OA). |
| R2 | `facilities:manage` | Manage the facility catalogue (TSA, MON). Scope and sprints use `boq:view` and `boq:upload_edit` until the R7 role rework. |
| R3 | `forms:manage` | Build the form library (TSA, MON; roles that held `inspections:manage_templates` got it). Reading the library also works with `project_types:manage` (type editor picker); the visit form preview also with `inspections:view`. |

Redesign R1d removed `field:join_project` and `assurance:review_credentials`, and renamed `handover:manage_links` to `handover:record_response` (record the beneficiary's handover response from the signed copy). The default roles `CONTRACTOR` (web) and `CONTRACTOR_ENGINEER` (mobile) are gone: contractors have no login (decision P2). Every mobile role signs in with an account.

Redesign R1e removed `projects:view_executive_matrix` (the executive risk matrix; `/app/executive` opens the portfolio), `mobilization:manage_roster`, `mobilization:configure_reminders`, `presence:view_telemetry`, `presence:manage_noshow_alerts` and `field:manual_checkin`, with morning briefs, telemetry, the participant roster and attendance alerts. Excusing a missed report now needs `reports:approve_completion`. The milestone reminder offsets (7, 3 and 1 days before due) are fixed until the R4 deadline settings; their editor went with the roster.

Redesign R2d removed `schedule:catch_up_refactor`, `schedule:approve_refactor` (schedule revisions), `schedule:propose_programme` (the programme of works is now a document whose sign-off accepts it; its document type needs a sign-off) and `boq:configure_hold_points` (hold-point flags stay visible read-only until R3/R4). `schedule:view_variance` now means: see the sprint schedule badge and get the behind-schedule notification.

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
| M&E | Average approval turnaround | Days from submission to final approval (visits, legacy reports and inspections) | Yes | ≤ 5 days |
| M&E | Sprints verified on time | Sprints verified by their end date + the verification period | Yes | ≥ 90% |
| Payments | Financial utilisation | Paid to date (net, from the payment record) / budget (weighted by budget) | No | none |
| Closure | Verified on time and to specification | CoC completion date ≤ planned end, no major issues in the final evaluation | Yes | ≥ 80% |
| Closure | Handed over on time after the CoC | Handover milestone done by its due date | Yes | ≥ 90% |
| Closure | Full closure documentation | Every document item of the closure checklists filed (liability period or closed) | No | ≥ 100% |
| Closure | Lessons learned documented | Closed projects with a published lesson | No | ≥ 100% |
| Closure | Audited after closure | Audit sign-off item done (closed projects whose checklists include one) | No | ≥ 100% |
| Schedule | Projects on schedule | Schedule badge on track or complete (computed from sprints and, since R4, their verification) | No | ≥ 80% |

Period-based KPIs count what fell due, was held, issued or decided in the chosen period (month, quarter or custom). The others show today's value. A daily job stores each project's figures for the monthly trend lines.

**Time zone.** Periods are read in the tenant's time zone (Settings → Tenant Settings → Workspace settings): "this month", the default period, the snapshot day and the trend months are the tenant's. Events counted into a period (approvals, release decisions, certificate issue) are dated in the tenant's zone. Project deadlines and on-time checks use the project's own zone, as everywhere else in the platform. The page shows the zone next to the period.

---

## 8. Questions to settle with the client

| Topic | Setting | Default if not answered |
| :--- | :--- | :--- |
| Who signs the CoC, and in which organisation? | CoC signatories | Two owner-organisation admins + beneficiary. |
| Mobilisation period per model | Mobilisation milestone offset | 21 days Central, 14 days Co-Funded. |
| Which gates need an issued CoC? | Closure gates | All three on in the demo. |
| KPI targets per model | KPI targets | Catalogue defaults; demo values above. |
| Supervisor site limits | Supervision limits | 2 sites / 50 km on Co-Funded in the demo. |
| What "indicators" means in the monitoring framework | (not built, G14) | Programme outcome indicators are not tracked. |
