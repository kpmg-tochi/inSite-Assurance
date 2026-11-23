# Client Flow Redesign: How the Platform Should Run the Project Cycle Manual

**Date:** 2026-11-23 (revision 2: owner answers, facility-based forms, scheduled visits)
**Status:** Proposal. No code changed.
**Source:** *Institutional Diagnostic Review: Project Cycle Redesign* (draft, Feb 2026, depersonalised), 54 slides. Central Delivery Model: slides 6–31. Co-Funded Delivery Model: slides 33–54.
**Builds on:** [process_flow_gap_analysis.md](process_flow_gap_analysis.md) and Phases 11–16. This branch is tailored to this client. Where this document conflicts with decisions A–O in [saas_implementation_plan.md](saas_implementation_plan.md), this document wins (section 12).

---

## 1. Summary

| Question | Answer |
| :--- | :--- |
| What does the client need? | An **online monitoring portal** for school infrastructure projects. M&E officers visit sites on a schedule and fill in forms with geotagged photos. The portal tracks deadlines and sign-offs from contract award to closure and shows a dashboard. Their diagram (slides 6, 33) puts the "online platform" on Needs Assessment and Monitoring & Evaluation. |
| Why the platform feels busy | It is two products in one: the lender/IPC assurance tool and the programme delivery tool. This branch keeps only the second. **The lender product is deleted** (owner, Q1). |
| Central idea of the redesign | **Scope → Facilities → Sprints → Visits → Forms.** Each BoQ line is tagged with a facility (Classroom, Toilet, Borehole…). Sprints of variable length say which lines are being built when. The admin schedules visits. Each visit's form is **assembled automatically** from fixed sections plus the facility sub-forms of the facilities in that sprint. |
| Getting the data in | A downloadable **needs-assessment workbook** (Excel, with dropdowns fed by the tenant's facility list) holds the project details, the BoQ and the sprints. Upload it, preview it, import it. The scope, sprints and visit forms then build themselves. |
| Mobile | Opens on a **dashboard**: a week calendar of upcoming visits (tap to expand to a scrollable month) and the officer's active projects. Visit → check in → form → submit. A free **site log** for photos, voice notes and notes at any time. The chat UI and morning brief are gone. |
| AI | All removed. Whisper voice-note transcription stays. |
| Payments | Happen outside the platform. The platform keeps a **payment record**: entered by Finance now, fed by an ERP later (the client has no ERP yet). Retention and defects stay for the demo; retention is calculated from recorded payments, not tranches. |

---

## 2. The client's flow, and where the platform sits

```
 Needs        Budget /     Procurement   Procurement   Kick-off    Site           Monitoring &   Project
 Assessment   RDAP         Plan          Process       meeting     Mobilisation   Evaluation     Closure
 [ONLINE]                                                                         [ONLINE]
 ─── programme level, annual ─────────────────────────┤├─────────── one project, one contract ──────────
  NEXT MODULE        OUT (record outputs only)          │ THIS REDESIGN: kick-off → closure
  (reuses the workbook)
```

| | Central Delivery Model | Co-Funded Delivery Model |
| :--- | :--- | :--- |
| Who runs delivery | Programme Authority HQ + regional/area offices | Regional Delivery Entity, overseen by Programme Authority regional reps |
| Kick-off run by | Physical Planning (regional/area officers) | Planning, Research & Statistics |
| Programme of works | Not stated | Required at or before kick-off |
| Kick-off minutes | Signed within 1 week | Approved and uploaded within 3 working days |
| Mobilisation deadline | 21 days from kick-off (decision M) | 14 days from kick-off |
| Termination approval | Chief Executive | Regional Chief Executive |
| Extra closure steps | – | Post-closure evaluation, archiving and audit |

These differences stay as project-type data (Phase 11).

---

## 3. Modules: keep, simplify, replace, delete

### 3.1 Keep

| Module | Client stage / policy | Change |
| :--- | :--- | :--- |
| Project types (Central / Co-Funded) | Two delivery models | Editor regrouped (section 10) |
| Organisations, regions, hierarchy, visibility | HQ, regional offices, regional delivery entities | None |
| Terminology labels | Client's words | None |
| Contract dates and kick-off | Award, acceptance in 3 days, notice ≥1 week before, quorum, signed minutes | One guided "Kick-off" page |
| Contract milestones and deadlines | Mobilise in 14/21 days, minutes deadline, handover within 1 week of CoC | Payment-related anchors removed |
| Default case → Legal → Chief Executive | Failure to mobilise | None |
| Document register with sign-offs | Letters, contract, minutes, mobilisation documents, closure file | None |
| Findings | "Non-compliance flagged for corrective action" | Raised from failed form answers. Re-checked on the next visit (section 6.5) |
| Officer workload | Supervisor ratio 7–10 sites | Measured on scheduled visits and assigned projects |
| Certificate of Completion, handover certificate | No handover or closure without a signed CoC | Final-payment gate becomes a flag (section 9) |
| Retention | Not in the deck; mentioned by the client in a meeting. Kept for the demo | **Reworked**: today it is withheld inside lender tranche decisions and released through a `RETENTION_RELEASE` valuation, both of which are deleted. New version: % per project, held amount calculated from recorded payments, release recorded by Finance after the defects period, gated by the CoC (section 9) |
| Defects and defects liability period | Not in the deck; kept until the client confirms after the demo | Contractor side removed (no contractor login). Defects are logged by staff, re-checked on visits like findings, and closed by an officer with photo evidence |
| Closure checklist, ratings, lessons, closure pack, audit sign-off | Closure and post-closure | None |
| Programme KPIs | Online dashboard | Trimmed (section 11) |
| Audit ledger | Audit readiness | Moves under project "More" |
| Whisper transcription | – | None |

### 3.2 Replace

| Today | Replaced by |
| :--- | :--- |
| BOQ step (hold points, packages, tranches, dependencies) | **Scope**: BoQ lines tagged with a facility, imported from the workbook or entered by hand |
| Schedule (earned-schedule variance, revisions, catch-up wizard) | **Sprints**: variable-length, named, with deliverables and the BoQ lines they cover. Status per sprint: on track / late / verified |
| Reporting cadence, reporting streams, obligations, morning briefs | **Visit plan**: scheduled visits per project, by type and officer |
| Checklist templates + inspection reports + workday reports | **Form builder** (fixed sections + facility sub-forms) and **visit submissions** |
| WBS inbox, WBS chat thread, AI summary sheet | **Mobile dashboard + calendar, visit form, site log** |
| Payment milestones, IPCs, valuations, disbursement chain | **Payment record** (manual now, ERP later) |

### 3.3 Delete from this branch

| Area | Notes |
| :--- | :--- |
| All AI: `azure-openai.service.ts` and callers (briefs, omission check, standards check, reconciliation rater, BOQ/standards extraction), engine labels, demo fallbacks | Whisper stays |
| Lender product: IPC state machine, reconciliation, evidence ratings, valuations, tranches, conditions precedent, facility step, disbursement chain, segregated disbursement permissions, lender roles | Owner Q1 |
| Hold points, packages, item dependencies, schedule revisions | Replaced by sprints |
| Professional registration (bodies, policy, certifier snapshots) | Owner Q6 |
| Multi-contractor modes, contractor replacement across contractors | One contractor per project (Q5). Termination stays |
| Contractor access, web and mobile: join codes, field sessions, identity assurance wizard, the defects module's contractor side, the public handover link | No contractor login (decision P2) |
| Mobilisation participant roster, attendance check job, background telemetry | Replaced by the mobilisation check visits |
| Executive risk matrix | Merged into the portfolio dashboard |

---

## 4. Roles

| Client role | What they do in the platform | Web / mobile | Platform role |
| :--- | :--- | :--- | :--- |
| Chief Executive / Executive Secretary (Regional CE in co-funded) | Decides default cases; portfolio and KPIs | Web | Executive |
| Director Physical Planning (process owner) | Owns projects: kick-off, mobilisation, escalation; signs CoC | Web | Programme Manager |
| Physical Planning Officers / Planning, Research & Statistics | Create projects, import the workbook, run kick-off, issue letter of introduction | Web | Project Officer |
| Director M&E | Builds the form library; sets visit plans per project type; verifies sprints; final evaluation; lessons | Web | M&E Manager |
| **M&E Officers** (the field users) | Visit assigned sites on schedule; fill in visit forms; site log; re-check findings | **Mobile first**, web to view | M&E Officer |
| Resident Supervisors | Same as M&E Officers. Same app and home screen; with one active project, the home screen opens that project's card fully (section 8.2). The deck gives each supervisor 7–10 sites (slides 11, 27), so "one project" is not assumed | Mobile | Resident Supervisor (same permissions as M&E Officer) |
| Programme Authority regional reps (co-funded) | Join visits, verify completion | Mobile + web | M&E Officer or Reviewer |
| Accredited independent M&E firm | Ad hoc independent visits | Mobile | Independent Monitor (same app, own organisation) |
| Director Procurement / Procurement | Records award and contract; **signs** the CoC and closure (Q7) | Web | Procurement Officer |
| Finance & Accounts | Records payments until the ERP feed exists | Web | Finance Officer |
| Director Legal | Receives default referrals, starts termination | Web | Legal Officer |
| Audit Department | Audit sign-off on the closure file | Web | Auditor |
| ICT Support | Users, roles, organisations, facility list | Web | Tenant Admin |
| Contractor | No login (Q-C default). Organisation record with contacts; gets emails (kick-off notice, findings summary) | – | – |
| Beneficiary school / community | No login. Kick-off attendee; signs CoC and handover certificate on paper | – | – |

---

## 5. The core model

```
 Facility catalogue (tenant)          Form library (tenant)
 CLASSROOM, TOILET, BOREHOLE …  ───▶  one sub-form per facility (1–3 questions)
                                      + fixed sections per visit type
        │ tagged on                            │ assembled into
        ▼                                      ▼
 Project scope (BoQ lines) ──▶ Sprints ──▶ Visits ──▶ Visit form (frozen snapshot)
 line: facility, qty, unit,     name, start,  date, type,   fixed sections
       amount, start/end sprint end,          officer(s)    + sub-forms for facilities
                                deliverables                  active in the sprint
                                                            + open findings to re-check
                                                                     │ submit
                                                                     ▼
                                                  Submission → approval → findings,
                                                  sprint verification, KPIs
```

| Concept | Definition |
| :--- | :--- |
| **Facility** | Tenant catalogue entry: code, name, category, archetype (section 6.2). Seeded with your 50-item list. Tenant admins can add, rename or retire entries. A retired facility stays on existing projects. |
| **Facility unit** | One physical instance of a facility on this project, with a label: "Ground floor male toilet", "Teachers' lounge female toilet", "Block A classroom 2". Supply items (desks, kits) are one unit with a quantity ("Pupils' furniture: 120 desks"). Has a start sprint and an end sprint. |
| **Scope line** | BoQ line: item no., facility unit, description, unit of measure, quantity, rate, amount (computed by the server). Many lines can belong to one facility unit (blockwork, roofing, finishes for the same toilet). |
| **Sprint** | Named period with a start date, end date and deliverables text, set by the admin, any length. The units in a sprint are the facility units whose start–end range covers it. Status: upcoming, active, late (past its end, not verified), verified. |
| **Visit** | One scheduled site visit: project, visit type, planned date, assigned officer(s), status (planned, in progress, submitted, approved, missed, cancelled). |
| **Visit type** | Mobilisation check, Baseline, Routine, Quarterly M&E, Final evaluation, Post-closure evaluation, Ad hoc. Each has fixed sections and a rule for which facilities to include (section 6.3). |
| **Submission** | The answers, captures, check-in location, comment thread and approval of one visit. |
| **Site log** | Free photos, voice notes and notes per project. Can be attached to a submission. Unattached items show in the project timeline (Q9). |

---

## 6. Form builder

### 6.1 Building blocks

| Block | Built by | Example |
| :--- | :--- | :--- |
| **Fixed section** | M&E Manager, per visit type | "Health & safety": PPE worn? Site fenced? Incidents since last visit? |
| **Facility sub-form** | M&E Manager, one per facility | TOILET: % complete; plumbing connected (Y/N, photo if Y); defects observed (text) |
| **Visit type template** | M&E Manager | Routine visit = Header + Progress vs work programme + [facility sub-forms] + Workmanship + Materials + H&S + Environmental + Summary |

Field types (v1): short/long text, number with unit, percentage, yes/no/N/A, single choice, multiple choice, date, rating 1–5, photo (min/max count, geotag required), voice note (transcribed).

Rules (v1): required; "if answer is X, require photo/comment"; "if answer is X, raise a finding of severity Y". No formulas or scripting.

### 6.2 Seeding 50 sub-forms without writing 50 by hand

Most of your list falls into four groups that need similar questions. Each facility starts from its group's default sub-form, and M&E then adjusts the facilities that need it.

| Archetype | Facilities (examples) | Default questions |
| :--- | :--- | :--- |
| **Building works** | Classroom, Office, Store, Toilet, Laboratory, Workshop, Library, ICT lab, Hall, Admin block, Staff quarters, Staff room, Hostel, Clinic, Kitchen, Shop, Crèche, Gate house, Nanny station | Stage reached (substructure / superstructure / roofing / finishes / complete); % complete; workmanship acceptable (Y/N → photo + comment if N); photo |
| **Supply & installation** (furniture, equipment, kits) | Pupils/teachers/principal/lab/library/workshop furniture, Magnetic board, Science kit, ICT/robotics/sports/play/tailoring/baking/phone-repair/electrical equipment, Computer, File cabinet, Fridge, Bookshelf, Bed + beddings, Shoe & bag | Quantity delivered (of planned); matches specification (Y/N → comment); installed/in use (Y/N); photo |
| **Utilities** | Borehole, Overhead tank, Generator, Solar power | Installed (Y/N); functional when tested (Y/N → finding if N); output/yield reading (number); photo |
| **External works** | Fence, Landscaping, Drainage/exterior works, Football pitch, Playground | % complete; length/area done (number + unit); finish acceptable (Y/N); photo |

### 6.2a One sub-form per facility per visit, aware of its units

The sub-form appears once per facility, and its questions are about the units of that facility in the current sprint:

```
 TOILET  ·  3 in this sprint
 Ground floor male toilet · Ground floor female toilet · Teachers' lounge female toilet
 ─────────────────────────────────────────────────
 Stage reached (all 3)                 [ Roofing ▼ ]
 Workmanship acceptable?               ( Yes ) ( No )
 Photos                                ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
                                       │ Ground floor │ │ Ground floor │ │ Teachers'    │
                                       │ male    📷   │ │ female  📷   │ │ lounge F 📷  │
                                       └──────────────┘ └──────────────┘ └──────────────┘
```

- **Question text can use placeholders**: `{count}`, `{facility}`, `{units}`, `{plannedQty}`, `{uom}`. "Are all {count} {facility} roofed?" becomes "Are all 3 toilets roofed?".
- **Photo field mode "one per unit"**: one labelled slot per unit, each needing a geotagged photo inside the site boundary. This is stricter than "3 photos": it guarantees each toilet has its own photo, not three of the same one. Other modes: "at least N" and "per unit, optional".
- **Answer scope per question**: "whole facility" (one answer, as above) or "per unit" (repeats for each unit, e.g. "% complete" for each toilet). M&E picks the scope when building the sub-form. The default is whole facility, so forms stay short.
- Supply items show the planned quantity: "Quantity delivered: __ of 120 desks". The server refuses a delivered quantity above the planned one unless there's a comment.

### 6.3 How a visit form is assembled

| Visit type | Facility sub-forms included |
| :--- | :--- |
| Mobilisation check | None (fixed questions: contractor on site, personnel, equipment, materials, letter presented) |
| Baseline | All facilities in scope (existing condition only) |
| Routine | Facility units **active in the sprint covering the visit date**, plus units from earlier sprints not yet reported complete, grouped into one sub-form per facility |
| Quarterly M&E | Same as Routine, with the M&E fixed sections (incl. valuation of works estimate) |
| Final evaluation | All facilities in scope |
| Post-closure evaluation | None (fixed questions: in use, beneficiary feedback, issues) |
| Ad hoc | Officer picks from the project's facilities |

The form is **frozen when the visit is assigned** and downloaded to the phone. Editing a template later does not change visits already assigned, and a visit can be done fully offline. An admin can "rebuild form" on a visit that hasn't started.

### 6.4 Sprint verification

When a sprint ends, the M&E Manager marks it **met / partly met / not met**, seeing the latest submission's answers for each facility in it. This is the "M&E runs verification" step (Q7), and it is the event an ERP would listen to later (section 9).

### 6.5 Findings loop without contractor logins

A failed answer raises a finding on that facility. Open findings are added to the **next visit's form** as "Re-check: [finding]. Resolved? Y/N + photo". The contractor gets an email summary of open findings after each approved visit. A finding open for N days escalates to the Programme Manager.

---

## 7. Needs-assessment workbook (Excel)

Generated by the server for each tenant (exceljs is already a server dependency), so the dropdown lists always match the tenant's live facility and unit lists. Downloaded from project setup, filled in offline, uploaded back.

| Sheet | Contents | Dropdowns / checks |
| :--- | :--- | :--- |
| Instructions | How to fill it in; version stamp | – |
| Project | Name, school, region, LGA, address, GPS (lat/long), delivery model, budget, strategic justification, assumptions | Region, delivery model |
| Facility units | Unit ID, Facility, Label ("Ground floor male toilet"), Quantity (supply items), Start sprint, End sprint | Facility (tenant list), Start/End sprint (from the Sprints sheet) |
| BoQ | Item no., Unit ID, Description, Unit of measure, Quantity, Rate, Amount (formula) | Unit ID (from the Facility units sheet), Unit of measure |
| Sprints (optional) | No., Name, Start date, End date, Deliverables | Date validation |
| Lists (hidden, protected) | Facilities, units, regions, models | Source of the dropdowns |

Import rules:
- Find columns by header name, not by position, and check the version stamp.
- **Re-validate everything on the server.** Excel dropdowns can be bypassed by pasting, so an unknown facility, bad date or missing quantity is a row-level error.
- Recompute amounts on the server. Warn when the BoQ total is more than the budget.
- Show a preview (scope lines grouped by facility and sprint, plus errors) and let the user confirm before saving. Nothing is written before confirmation.
- Draft projects: re-import replaces scope and sprints. Live projects: re-import is refused; scope changes go through the scope page and are audited.
- Drawings and other attachments go to the document register, not the workbook.

The **Needs Assessment module** (next) will use the same workbook: regions submit it, the need is validated and prioritised, and an approved need becomes a draft project with scope and sprints already loaded.

---

## 8. Visits: scheduling (web) and the mobile app

### 8.1 Visit planner (web, M&E Manager)

- **Planner page** (tenant level): week/month grid of officers × days, filterable by region and project. Drag to reschedule.
- **Create visits**: project, type, date, officer(s). Generators: "Routine every N weeks during sprint X / during construction", "Mobilisation check every 2 weeks until contractor on site", "Quarterly", "Final evaluation when completion notice received".
- **Who decides dates**: the M&E Manager plans visits. The officer responds to each one:

  | Officer action | Effect |
  | :--- | :--- |
  | **Confirm** | Visit is confirmed. Unconfirmed visits remind the officer 2 days before |
  | **Move** within the tolerance (default ±2 working days, same sprint), with a comment | Applied at once; manager notified (web notification + visits page) |
  | **Propose a new date** outside the tolerance, with a comment | Manager accepts or rejects; until then the original date stands |
  | **Decline**, with a comment | Manager reassigns or moves it |
  | **Unscheduled visit** | Allowed; recorded as Ad hoc and counts as conducted, not planned |

  Every change keeps the original planned date and is audited. "% visits conducted vs planned" measures against the agreed date. Reschedule count per officer is a separate figure on the planner.
- **Defaults per project type**: the type holds a default visit plan. When a project is activated, the plan becomes proposed visits that the manager confirms.
- **Warnings** (not blocks): officer over the site limit (7–10), several visits on one day in different regions, a sprint with no visit, an active project with no visit in N weeks.
- **Deadlines**: submission due within 1 week of the visit date (slide 12, configurable). Missed visits and late submissions count in KPIs.

### 8.2 Mobile app

```
 ┌──────────────────────────────────┐
 │ Good morning, Ada         🔔  ⟳  │
 │ ◀  Nov 2026                    ▼ │  ← tap ▼ to expand to the month;
 │ M  T  W  T  F  S  S              │    swipe for other months
 │ 23 24 25 26 27 28 29             │
 │ •     ••    •                    │  ← dots: planned / overdue / done
 │──────────────────────────────────│
 │ Mon 23 Nov                       │
 │ ▸ KWR-502 Routine visit          │
 │   Sprint 3: Roofing · 4 facilities│
 │ ▸ OGN-501 Mobilisation check     │
 │   Overdue 2 days                 │
 │──────────────────────────────────│
 │ My projects (6)                  │
 │ ▸ KWR-502  Sprint 3 of 5 · 2 open findings │
 │ ▸ OGN-501  Mobilising · day 9 of 14       │
 │ + Unscheduled visit              │
 └──────────────────────────────────┘
```

| Screen | Contents |
| :--- | :--- |
| **Home** | Collapsible calendar (week ↔ month, swipe months); visits for the selected day, each with Confirm / Move / Decline; "My projects" cards (stage, current sprint, next visit, open findings); unscheduled visit button. With exactly one active project, its card opens fully (sprint deliverables, units, findings, site log shortcut) in place of the list. Same screen for every field role |
| **Visit** | Project, school, visit type, sprint name and deliverables, facilities to check, findings to re-check; **Check in** (location checked against the site boundary); Start form |
| **Form** | One section per screen, progress bar, photos taken in-app (geotagged), voice notes transcribed, pick from site log; draft saved on every change; review → submit |
| **Project** | Details, sprints, documents (read-only), site log, past visits, findings |
| **Site log** | Photo / voice / note for any project, any time, geotagged, offline |
| **Outbox** | What is waiting to send, what failed, retry |

The app downloads the next 14 days of visits (forms included) when online, so visits work offline.

---

## 9. Payments and ERP

| Now | Later (ERP) |
| :--- | :--- |
| Finance records payments manually: date, amount, reference, description, optional sprint, "final payment" flag | Inbound API (tenant API key), idempotent on the ERP reference; source = `ERP` |
| Dashboard shows paid to date vs contract sum | Outbound webhooks for **sprint verified**, **CoC issued**, **handover signed**, so the ERP can release payments on platform events |
| A final payment recorded before the CoC is signed is **flagged as an exception** (the platform can't block a payment it doesn't make) | Same flag on ERP-fed payments |

The payment record should be built so an ERP feed slots in without a migration: source, external reference, idempotency key. The client has no ERP yet, so nothing beyond those fields is built now.

**Retention on the payment record:**
- A retention % is set per project, defaulting from the project type.
- Each payment is recorded gross. The platform shows the retention held (gross × %) and the net amount, and Finance can override the held amount with a reason.
- Release follows: CoC signed → defects period ends (or all defects closed) → Finance records the release payment, flagged `RETENTION_RELEASE`.
- The certification and lender-decision chain is removed. Most of the existing maths in `shared/src/utils/retention.ts` stays.

---

## 10. Web

### 10.1 Project setup: 5 steps

| Step | Contents |
| :--- | :--- |
| 1. Project | Delivery model, name, school, region, location (map pin and radius), budget |
| 2. Contract | Contractor (one), contract sum, award date, acceptance, signed contract, planned kick-off, planned completion |
| 3. Scope & sprints | Download workbook / upload / preview / confirm, or edit by hand |
| 4. Team & visits | M&E officer(s) with workload warning; proposed visit plan from the type |
| 5. Review | Checklist; activate |

### 10.2 Navigation

| Level | Entries |
| :--- | :--- |
| Tenant | Portfolio (landing) · **Visit planner** · KPIs · Lessons learned · **Forms & facilities** · Settings |
| Project | **Overview** (stage bar Kick-off → Mobilisation → Construction → Completion → Closure, current sprint, next visit, next deadline) · Kick-off & mobilisation · **Sprints & scope** · **Visits & reports** · Findings · Payments · Documents · Completion & handover · More ▸ (Audit ledger, Settings) |

### 10.3 Project type editor

Four groups that follow the deck: Kick-off & mobilisation (deadlines, documents), Monitoring (default visit plan, visit types, submission deadline), Completion & closure (CoC signatories, closure checklist), KPI targets. Advanced keys sit behind "Advanced".

---

## 11. KPIs (post-award, as named in the deck)

% contracts with kick-off agenda prepared · timeliness of kick-off notifications · kick-off attendance rate · % kick-off meetings documented and signed · % projects with officers assigned · % contractors mobilised on time · % sites with baseline data · **% visits conducted vs planned** · **% reports submitted within 1 week** · % sprints verified on time · % projects delivered to specification · % projects with full documentation · % projects handed over · % lessons documented · % projects audited post-closure.

Payment KPIs that need amounts move to "paid to date vs contract sum" from the payment record. KPIs that depend on IPCs or retention are deleted.

---

## 12. Owner decisions recorded (2026-11-23)

| # | Decision | Replaces |
| :--- | :--- | :--- |
| P | This branch is client-specific. The lender/IPC product is deleted, not hidden. | B, D, K, parts of O |
| Q | Payments happen outside the platform; the platform records them (manual now, ERP later). | K |
| R | Sprints have variable durations set by the admin. | Phase 8 cadence and Phase 14 streams for reporting |
| S | The client's M&E team does the reporting through scheduled visits. Admins schedule visits; the mobile app opens on a dashboard with a calendar of visits and active projects. | Phase 8 briefs, WBS chat |
| T | One contractor per project. | D |
| U | Professional registration removed. | N |
| V | M&E runs verification and the closure file; Procurement signs. | – |
| W | Needs Assessment is the next module after this redesign. | Gap analysis section 6 |
| X | Site log exists on its own; unattached captures show in the project timeline. | – |
| Y | Forms are assembled from fixed sections and facility sub-forms; facilities come from the BoQ via the needs-assessment workbook. | Phase 14 checklist templates |
| Z | No AI anywhere except voice-note transcription. | AI sections of `CLAUDE.md` |
| P1 | Retention and defects stay for the demo; retention moves onto the payment record. Revisit after the demo. | O (retention via tranches) |
| P2 | No contractor login, web or mobile. | – |
| P3 | One sub-form per facility per visit. Questions reference the facility's units in the sprint (count, labels); photos can be required one per unit. | – |
| P4 | Resident Supervisors use the same app and role permissions as M&E Officers. | – |
| P5 | The M&E Manager plans visits; officers confirm, move within a tolerance, propose a new date or decline, always with a comment. | – |
| P6 | No ERP yet; the payment record is ERP-ready only. | – |
| P7 | Monorepo stays; `@insite/shared` stays the single source of contracts. | – |

---

## 13. Open questions

Q-A to Q-F are answered (decisions P1–P7). Still open, to confirm with the client at the demo, not blocking:

| ID | Question | Default |
| :--- | :--- | :--- |
| Q-G | Is a retention % and defects liability period actually in their contracts? | Kept, default 5% / 6 months, editable per type |
| Q-H | Reschedule tolerance (±2 working days) | ±2 working days, configurable per tenant |

---

## 14. Order of work

| Step | Contents | Depends on |
| :--- | :--- | :--- |
| R1 | **Delete**: AI, lender/IPC/reconciliation/tranches/CPs/valuations, registrations, contractor access (web and mobile), briefs, telemetry, attendance, multi-contractor, risk matrix. **Rework, don't delete**: retention (onto the payment record, section 9) and defects (staff-only). Keep the tests green. | – |
| R2 | Facility catalogue (seeded with the 50 items + archetypes); scope lines; sprints; workbook generator + importer with preview | R1 |
| R3 | Form builder: fixed sections, facility sub-forms, visit type templates, assembly and frozen snapshots; replaces checklist templates | R2 |
| R4 | Visits: planner, generators, type defaults, check-in, submissions, approval, findings loop, sprint verification, deadlines, KPIs | R3 |
| R5 | Mobile: dashboard + calendar, visit, form filler, site log, outbox; delete WBS inbox/chat/AI sheet | R4 (API) |
| R6 | Web: 5-step setup, navigation, Overview stage bar, payment record, regrouped type editor | R2–R4 |
| R7 | Seed, demo script, `CLAUDE.md`, configuration reference rewritten for the new model | All |

R1 is large but mechanical. It should go first because it removes about a third of the surface that every later step would otherwise have to work around.
