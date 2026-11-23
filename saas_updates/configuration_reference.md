# Configuration Reference: Programme Delivery (Phases 11–16)

**For:** the delivery team preparing client workshops on the Central and Co-Funded delivery models.
**Use:** go through it setting by setting with the client. Each row says where the setting lives, its default, what it changes, and which process-flow control (gap analysis IDs G1–G14) it serves.

**Last updated:** 2026-11-23 (Phase 16: every project type setting editable in the web app; KPI periods in the tenant time zone).

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

**Every project type setting below has a field in the type editor.** The one exception is the beneficiary signature mode: it has a single value ("recorded by staff") until D-15.1 changes, so there is nothing to choose. Role and template pickers list the workspace's roles and checklist templates. A code that no longer exists is flagged so it can be removed.

---

## 2. Workspace (tenant) settings

| Setting | Where | Default | Effect | Control |
| :--- | :--- | :--- | :--- | :--- |
| Organisation hierarchy (parent organisation) | Settings → Organisations | None (flat) | Up to 5 levels. Lets a flagship see and approve for its subsidiaries; cycles are refused. | G10 |
| Regions and areas | Settings → Project types, regions & documents → Regions | None | Two levels (region → area). Used by project filters, the portfolio map and KPIs. A region filter includes its areas. | G10 |
| Terminology | Settings → Tenant Settings → Terminology | Funder, Independent monitor, Contractor, Beneficiary, Hold point, Retention | Display labels only (singular and plural), on web and mobile. API fields and audit text keep the canonical names. Demo tenant: funder = "Funding authority". (Redesign R1b removed Tranche, Condition precedent, IPC and Valuation.) | G1 |
| Professional registration policy | Settings → Tenant Settings → Professional registration | `REQUIRED` for certifiers and for field assurance (platform default) | `REQUIRED`, `OPTIONAL` or `HIDDEN`. Every form, validation, message and PDF follows it. A project type can override it. Permissions and segregation of duties never depend on it. Demo tenant: `OPTIONAL`. | G12 |
| Registration bodies | Settings → Tenant Settings → Professional registration | QSRBN, COREN, ARCON, CORBON, ICAN, Other | The bodies users and certifiers choose from. The body name and prefix are copied onto each certification, so PDFs print as signed. | G12 |
| Document types | Settings → Project types, regions & documents → Document types | 18 types (contract, award and acceptance letters, kick-off pack, minutes, mobilisation agreement and plan, letter of introduction, site possession, supervisor assignment, CoC, handover certificate, final evaluation, closure file and others) | Per type: sign-off required, allowed files, and whether contractors can see it. Milestones, checklists and KPIs refer to types by code. | G3 |
| Inspection checklist templates | Settings → Inspections & supervisors | None. The demo has Baseline survey, Routine visit, Mobilisation check and Final evaluation. | Versioned by code; a version that has been used is never edited. Items: pass/fail, yes/no, rating 1–5, number, text, with photo rules. A failed item raises a finding against the contractor. | G5 |
| Contractor rating criteria | Settings → Tenant Settings → Rating criteria | Time, Quality, Health & safety, Responsiveness, Documentation | Criteria scored 1–5 at completion and after closure. | G6 |

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

### 3.3 Reporting defaults

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Reporting defaults | Off | Pre-fills the Reporting step of new projects; values already saved are kept. Demo: Central weekly, Co-Funded bi-weekly. | G4 |
| Cadence, working days, period start day | Weekly; Mon–Sat; Monday | Daily, weekly, every two weeks, monthly, quarterly, custom period, or no periods (inspections only). | G4 |
| Custom period length, quarter start month, first period date | – ; January; project start | Shown for the cadences that use them. | G4 |
| Work hours, report due time, grace | 08:00–17:00; end of the working day; 0 min | When a report becomes due and late. | G4 |

### 3.4 Credentials (Phase 12) and payments (redesign R1b)

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Certifier registration | Use the workspace setting | `REQUIRED` / `OPTIONAL` / `HIDDEN` for whoever signs certificates. Removed in redesign R1d. | G12 |
| Field assurance registration | Use the workspace setting | The same, for field staff completing identity assurance. | G12 |
| Retention percentage | None | Pre-fills the Retention step of a new project. Recorded payments hold this percentage back (another amount needs a reason). Payments are made outside the platform and recorded on the project's Payments page. | Decision Q |
| Defects liability period (months) | None | Pre-fills the Retention step. The retention release is flagged when recorded before the period ends. | Decision P1 |

### 3.5 Contract milestones and kick-off (Phase 13)

Edited in the type editor's contract rules section.

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Contract milestone templates | None | Dated obligations created on each project. Per milestone: key, label, anchor (contract award, contract signed, kick-off, activation, another milestone, CoC issued, project closed), offset (calendar or working days, negative = before), completion mode, required documents, a sign-off permission, responsible role and organisation, one per contractor. | G2 |
| Completion modes | Manual | Automatic: contractor on site (first in-geofence check-in), kick-off notice sent, kick-off quorum, schedule baseline set, CoC issued, handover accepted, final evaluation approved. | G2 |
| **Mobilisation days** | – | The offset of the "contractor mobilised" milestone from kick-off. Demo: Central 21 days, Co-Funded 14 days (decision M). | G2 |
| Kick-off quorum groups | None | At least one attendee per group (demo: owner, monitor, contractor, beneficiary), or a waiver reason. | G2 |
| Kick-off notice lead time | 7 days | The notice must go out this many days ahead, or the shortfall is waived with a reason. | G2 |

### 3.6 Documents, default cases, streams, inspections and supervision (Phases 13–14)

Edited in the type editor's "Required documents and contractor default" and "Monitoring: streams, inspections and supervision" sections.

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| Documents needed before going live | None | Document types needed before the project can go live. | G3 |
| Documents needed before mobilisation | None | Shown on the mobilisation compliance panel per contractor. Counted by the "full mobilisation documentation" KPI. Demo: mobilisation agreement and site possession form. | G3 |
| Legal role | None | The Legal role: told about new default cases, and names the review step. Demo: `LEGAL_OFFICER`. | G7 |
| Open a default case when mobilisation is overdue | On | An overdue contractor-on-site milestone opens a default case once. The case runs Legal review, then the executive decision (`contracts:decide_default`). | G7 |
| Reporting streams (name, key, kind, roles, cadence fields, visit type, upload deadline) | None | Streams created on each new project (roles by code). With any active stream, only streams are owed. Item-report streams owe per-item reports; inspection streams owe one visit per period, late after the due time + grace + submission deadline. Demo: weekly resident supervision plus inspection visits. On a project, streams are edited in the Reporting step. | G4 |
| Checklist template per visit type | None | The checklist template per visit type (baseline, routine, mobilisation check, final evaluation). | G5 |
| Supervisor roles | None | Roles whose users count as supervisors (workload view, "supervisor assigned" KPI). | G9 |
| Most sites per supervisor / furthest distance between sites | No limit | The workload warns above them and never blocks. Demo: Co-Funded 2 sites, 50 km. | G9 |

### 3.7 Completion and closure (Phase 15)

Edited in the type editor's closure rules section.

| Setting | Default | Effect | Control |
| :--- | :--- | :--- | :--- |
| **CoC signatories** | Head of Physical Planning and Head of M&E (owning organisation), plus the beneficiary institution | Up to 8 slots, each with a permission (default `completion:sign_certificate`), an optional role, and an organisation scope (any, owner, owner or above, funder, monitor). One slot per person. The last signature issues the certificate and its PDF. | G6, decision O |
| Beneficiary signature | Recorded by staff | Staff upload the signed paper copy and attest (D-15.1). A public signing link is not built. | G6 |
| CoC signatures follow the certifier registration policy | Off | Staff signatures print their registration. | G6, G12 |
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
| Project type | Basics step (drafts only) | Applies the type: copies the template, snapshots the config, pre-fills parties and reporting. Locked once live. | G1 |
| Owning organisation, region, beneficiaries (one primary) | Basics / Parties steps | Visibility, filters, approvals and the handover recipient. | G10 |
| Contract reference, award, signed and kick-off dates | Contract step | Anchor the contract milestones. Every change recomputes due dates and is audited. | G2 |
| Reporting streams, quarterly anchor month | Reporting step | Per-project streams (replace the type's on a draft). The quarterly cadence uses calendar quarters from the anchor month (default January). | G4 |
| Retention percentage and liability period | Retention step (route `facility`) | Held from each recorded payment; changes apply to later payments. | Decision Q |
| Payments | Project → Payments | Record interim, final and retention-release payments made outside the platform; void a wrong entry with a reason. Exceptions are flagged, not blocked. | Decision Q |

---

## 6. Permissions added in Phases 11–16

Default roles: **TSA** Tenant Super Admin, **MON** Independent Monitor, **LEN** Lender/funder, **OA** Organisation Administrator. The Tenant Super Admin holds every permission except the segregated disbursement ones.

| Phase | Permission | What it allows |
| :--- | :--- | :--- |
| 11 | `project_types:manage` | Define delivery models. |
| 11 | `regions:manage` | Manage regions and areas. |
| 11 | `projects:view_organization_tree` | See projects owned by the user's organisation or below it. |
| 11 | `projects:view_portfolio` | Portfolio dashboard (map and portfolio KPI cards). |
| 13 | `schedule:propose_programme` | Contractor submits the programme of works. |
| 13 | `documents:view`, `documents:upload`, `documents:manage_types` | Document register and document types. |
| 13 | `milestones:manage`, `milestones:waive` | Complete and waive contract milestones; move anchor dates. |
| 13 | `kickoff:manage` | Schedule the kick-off, send the notice, record attendance and minutes. |
| 13 | `contracts:raise_default`, `contracts:decide_default` | Open and review default cases; make the final decision. |
| 14 | `inspections:submit`, `inspections:view`, `inspections:manage_templates`, `inspections:manage_findings` | Site inspections, templates and findings. |
| 15 | `completion:draft_certificate`, `completion:sign_certificate`, `completion:revoke_certificate` | Certificate of Completion. |
| 15 | `closure:manage_checklist`, `closure:audit_signoff`, `closure:export_pack` | Closure checklist, audit sign-off, closure pack. |
| 15 | `contractors:rate_performance` | Rate contractors and see ratings across projects. |
| 15 | `lessons:manage`, `lessons:view` | Record and browse lessons learned. |
| 16 | `kpis:view` | Programme KPIs page and the project KPI card (TSA, MON, LEN, OA). |

Phase 12 added no permission: registration is a policy, not a permission.

---

## 7. KPI catalogue (Phase 16)

The catalogue is fixed in code; tenants set targets and visibility only (section 3.8). "Not tracked" means the KPI's inputs are not configured on a project; it is never shown as 0%.

| Stage | KPI | Counted from | Period-based | Default target |
| :--- | :--- | :--- | :--- | :--- |
| Kick-off | Kick-off agenda prepared | Kick-off meeting with an agenda document | Yes | ≥ 100% |
| Kick-off | Kick-off notices sent on time | Kick-off notice milestone done by its due date | Yes | ≥ 90% |
| Kick-off | Kick-off attendance | Invitees attended / invited | Yes | ≥ 80% |
| Kick-off | Meetings documented and signed | Minutes filed and signed (counted from 7 days after the meeting) | Yes | ≥ 90% |
| Mobilisation | Projects with a supervisor assigned | Assigned users in the type's supervisor roles | No | ≥ 100% |
| Mobilisation | Letters of introduction on time | Milestones needing a letter of introduction | Yes | ≥ 90% |
| Mobilisation | Contractors mobilised on time | Contractor-on-site milestones | Yes | ≥ 90% |
| Mobilisation | Full mobilisation documentation | The type's before-mobilisation documents filed (projects under construction) | No | ≥ 100% |
| M&E | Monitoring framework established | An active reporting stream (projects under construction) | No | ≥ 100% |
| M&E | Sites with baseline data | An approved baseline inspection | No | ≥ 100% |
| M&E | Visits conducted vs planned | Inspection obligations submitted / owed | Yes | ≥ 90% |
| M&E | Reports submitted on time | Obligations submitted on time / owed | Yes | ≥ 85% |
| M&E | Average approval turnaround | Days from submission to final approval | Yes | ≤ 5 days |
| Payments | Financial utilisation | Paid to date (net, from the payment record) / budget (weighted by budget) | No | none |
| Closure | Verified on time and to specification | CoC completion date ≤ planned end, no major issues in the final evaluation | Yes | ≥ 80% |
| Closure | Handed over on time after the CoC | Handover milestone done by its due date | Yes | ≥ 90% |
| Closure | Full closure documentation | Every document item of the closure checklists filed (liability period or closed) | No | ≥ 100% |
| Closure | Lessons learned documented | Closed projects with a published lesson | No | ≥ 100% |
| Closure | Audited after closure | Audit sign-off item done (closed projects whose checklists include one) | No | ≥ 100% |
| Schedule | Projects on schedule | Schedule badge on track, ahead or complete | No | ≥ 80% |

Period-based KPIs count what fell due, was held, issued or decided in the chosen period (month, quarter or custom). The others show today's value. A daily job stores each project's figures for the monthly trend lines.

**Time zone.** Periods are read in the tenant's time zone (Settings → Tenant Settings → Workspace settings): "this month", the default period, the snapshot day and the trend months are the tenant's. Events counted into a period (approvals, release decisions, certificate issue) are dated in the tenant's zone. Project deadlines and on-time checks use the project's own zone, as everywhere else in the platform. The page shows the zone next to the period.

---

## 8. Questions to settle with the client

| Topic | Setting | Default if not answered |
| :--- | :--- | :--- |
| Who signs the CoC, and in which organisation? | CoC signatories | Two owner-organisation admins + beneficiary. |
| Do certifiers need a registration number? | Registration policy | Optional on the programme tenant. |
| Mobilisation period per model | Mobilisation milestone offset | 21 days Central, 14 days Co-Funded. |
| Which gates need an issued CoC? | Closure gates | All three on in the demo. |
| KPI targets per model | KPI targets | Catalogue defaults; demo values above. |
| Supervisor site limits | Supervision limits | 2 sites / 50 km on Co-Funded in the demo. |
| What "indicators" means in the monitoring framework | (not built, G14) | Programme outcome indicators are not tracked. |
