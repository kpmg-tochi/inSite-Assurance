# UBEC Project Monitoring Portal: Platform Overview

**Date:** 27 November 2026
**Covers:** the platform as built on the `ubec-needs-pipeline` branch (needs pipeline waves 1–5; wave 5, field verification, is finishing).
**Reference document ("PCM"):** *UBEC Project Cycle Redesign: Institutional Diagnostic Review*, draft for discussion, February 2026 (file `Project Context/MoE_Process Design for Direct & Matching Grant Project Delivery__Draft.pdf`). The document calls itself the Project Cycle Manual. Page numbers below refer to its slides (p.1 = cover).

---

## 1. Summary

**The UBEC Project Monitoring Portal turns the Project Cycle Manual into a working system.** It takes every school infrastructure intervention, under both Direct Intervention and Matching Grants, from the first identified need to an audited, archived closure file. It does this by:

- running each step of the manual as a guided workflow, with named owners, deadlines, required documents and approvals;
- collecting evidence from site through an offline field app that records geotagged, time-stamped photos;
- recording every decision in a tamper-evident ledger.

The portfolio dashboard, KPIs and closure packs are built from the same records the work produced, not from reports compiled separately afterwards.

The PCM asks for this platform directly. It puts an "online platform" on Needs Assessment and on Monitoring & Evaluation (p.6, p.33). It requires that "all records (data, stakeholder inputs, validation reports, cost estimates, prioritisation outcomes) shall be uploaded to UBEC's central repository" (p.8), that BEAPs be "submitted electronically through UBEC's designated online portal" (p.35), and that "an online monitoring dashboard shall be maintained … to provide real-time visibility into project progress, compliance, risks, and utilisation of resources" (p.13). The portal covers those two stages and everything between them that can be run digitally.

### What it gives UBEC

| Value | How |
| :--- | :--- |
| **One record from need to closure** | A live project carries its origin: the needs assessment it came from, its validation, cost estimate, committee score, approval and funding decision. Nothing is typed in twice. Sites, facilities and the costed Bill of Quantities (BoQ) carry over into the project. |
| **The manual's rules are enforced, not only written down** | Deadlines, essential facilities, the supervision and monitoring cost line, separation of duties and the Certificate of Completion gates are checked by the system at the moment a step is taken. |
| **Site evidence that can be trusted** | Photos are taken in the app. Each one carries a GPS position, accuracy and compass heading and is checked against the site boundary. Files are fingerprinted and signed by the device. Faked locations are flagged. |
| **Early warning, not after-the-fact reporting** | Late mobilisation, stalled sites, overdue site updates, spending ahead of progress and poorly performing contractors are flagged automatically to the people who must act. |
| **Audit-ready by default** | Every change is written to a hash-chained ledger in the same step as the change itself. The closure pack exports the full file with fingerprints and a ledger verification. |
| **Works where UBEC works** | Needs assessments and costing are prepared in Excel templates that match how the work is done today. The field app works offline and sends everything once there is signal. |
| **Two programmes, one platform** | Direct Intervention (UBEC-led) and Matching Grants (SUBEB-led, UBEC gatekeeps) share one system. Their differences (owners, deadlines, approval chains, extra closure steps) are settings on each programme. |

---

## 2. The project cycle at a glance

```
 ANNUAL, PROGRAMME LEVEL ─────────────────────────────────────────┐  ONE PROJECT, ONE CONTRACT ───────────────────────────────
 Needs        Budget (DI) /     Procurement   Procurement        │  Kick-off   Site          Monitoring &   Project
 Assessment   BEAP (MG)         Plan          Process            │  meeting    Mobilisation  Evaluation     Closure
 [run]        [run / recorded]  [run]         [outside: award    │  [run]      [run]         [run: web +    [run]
                                               recorded]          │                           field app]
 ────────── proposed projects ──────── funding gate ──► draft project ──► activation ──► live project ──► closed, archived
```

| PCM stage | Direct Intervention (PCM) | Matching Grants (PCM) | On the platform |
| :--- | :--- | :--- | :--- |
| Needs assessment | p.7–8, 14–17 | p.34–35, 40–41 | **Run**: annual cycle, from upload to approval |
| Budget preparation (DI) / Basic Education Action Plan (MG) | p.8–9, 18–19 | p.35–36, 42–43 | **DI:** budget submission recorded, appropriated schedule imported, funded proposals become projects. **MG:** BEAP built, reviewed, revised and approved on the platform |
| Procurement plan | p.9, 20–21 | inside the BEAP (p.42) | **Run**: projects packaged into lots and batches; approved plan filed |
| Procurement process | p.9–10, 22–24 | p.36–37, 44–46 | **Outside** (Public Procurement Act processes, BPP, Tender Board). The award, contractor, contract sum and award documents are recorded |
| Project kick-off | p.11, 25–26 | p.37–38, 47–48 | **Run** |
| Site mobilisation | p.11–12, 27–28 | p.38, 49–50 | **Run** |
| Monitoring & evaluation | p.12–13, 29–30 | p.38–39, 51–52 | **Run** (web and field app) |
| Project closure | p.13, 31 | p.39, 53–54 | **Run**, including MG post-closure evaluation, archiving and audit |

---

## 3. Who uses it

| People | What they do on the platform | Web / phone |
| :--- | :--- | :--- |
| Executive Secretary (DI) / SUBEB Executive Chairman (MG) | Chairs the steering committee, approves the portfolio, decides mobilisation default cases, approves out-of-cycle projects | Web |
| Director Physical Planning (UBEC and SUBEB): the process owner | Opens the annual cycle, reviews the portfolio and BEAPs, owns project setup, kick-off and mobilisation | Web (SUBEB Director also on the phone for field verification) |
| Procurement officers | Upload needs assessments, submit the portfolio, plan lots and batches, record awards | Web |
| Quantity surveyors | Maintain costing standards, cost proposals | Web |
| Finance & Accounts | Record the budget submission and the appropriation, record payments | Web |
| M&E officers (UBEC and SUBEB) | Validate needs, plan and carry out monitoring visits, review monitoring reports, verify work phases, run the final evaluation | Web and phone |
| Resident Supervisors | Carry out scheduled visits, keep the site log, close defects with photo evidence | Phone only |
| Independent M&E firms (COREN-certified, PCM p.13) | Independent monitoring visits within their own organisation | Phone and web |
| Steering committee members | Declare conflicts, score proposals independently | Web |
| Director Legal, Audit | Review default cases, sign off the closure file | Web |
| System administrators | Users, roles, organisations, forms, programme settings | Web |
| Contractors and beneficiary schools | **No login.** Contractors are records in a contractor register and receive emails (kick-off notice, findings summary). Beneficiaries sign paper copies, which staff record with a declaration | – |

Visibility follows UBEC's structure. UBEC HQ sees the whole programme. A SUBEB sees its own State. M&E officers see only the projects they are assigned to.

---

## 4. The workflow, stage by stage

Each stage below shows what the PCM asks for, what the platform does and the controls that apply.

### 4.1 Annual needs assessment cycle

**PCM:** DI p.7–8, 14–17; MG p.34–35, 40–41.

A **proposed project** is kept apart from a project. It moves through the stages of its year's cycle and becomes a project only when it is funded. Unfunded ideas therefore never appear in the delivery dashboards, KPIs or alerts.

| Stage | DI deadline / MG deadline | Owner | What happens on the platform | PCM |
| :--- | :--- | :--- | :--- | :--- |
| **Cycle opens** | 1 Mar / 31 Jul (the SUBEB circular) | Director Physical Planning (UBEC for DI; the State's SUBEB for MG, one cycle per State) | Year, deadlines, template, costing standard and scoring rubric are fixed for the cycle. Last year's unfunded and excluded proposals are offered for carry-forward and restart at Validation | p.14 (sources incl. "previously budgeted but unfunded initiatives", "projects excluded during earlier prioritisation"); MG circular p.34 |
| **Identification** | 30 May / 31 Aug | Procurement officers upload; Physical Planning curates | Needs assessments come in on UBEC's Excel template (project, sites, facilities breakdown per site, BoQ priced at standard rates, costing summary). Many files can be uploaded at once. Each file is previewed and nothing is saved until confirmed. Each proposal gets a reference (e.g. `2027-DI-014`, `2027-MG-KN-007`). The preliminary needs report and stakeholder engagement summary are filed on the cycle | p.7 (minimum content), p.14–15 (data gathering, stakeholder engagement), p.40 |
| **Validation** (MG: "Field verification") | 31 Jul / 30 Sep | M&E Department (DI); SUBEB Physical Planning (MG) | Desk review and site verification per proposal. An officer can be assigned a **field verification** on the phone: GPS and photos per site, and existing quantity and condition per facility. Accepting it corrects wrong site coordinates and files the photos. Outcomes: advance, return for correction, not validated, merged as a duplicate. The **Validated Project List** is generated | p.15 ("independently verifying and validating"), p.40 ("physical assessment … verify the existence and severity") |
| **Design** (DI only) | 30 Sep | Procurement upload | Full needs assessment with drawings, BoQ and preliminary cost. The template is checked before the proposal can leave the stage | p.7 (drawings, BoQ by "31 September") |
| **Costing** | 14 Oct / 14 Oct | Quantity surveyors (Physical Planning) | The costed version is priced against UBEC's **costing standard**: a versioned rate library with supervision and monitoring share, contingency and ceilings. Rate variances are flagged. Sign-off stores the costed amount. The **Cost Estimate Report** is generated | p.8 (UBEC standards, templates, ceilings; supervision and monitoring cost), p.16 |
| **Prioritisation** | 21 Oct / 21 Oct | Steering committee (DI: chaired by the ES; MG: SUBEB steering committee) | Members declare conflicts. Each member scores independently on the weighted rubric (**Impact 60 % / Ease of Implementation 40 %**) and cannot see others' scores until the ranking is final. Large disagreements between scorers are flagged. A quorum is required. The chair sets the funding line against the ceiling; any override needs a written reason. The **Prioritised Project Portfolio** is generated and the minutes are filed | p.8 (rubric, portfolio content), p.16, p.35, p.41 |
| **Approval** | 31 Oct / 30 Oct | DI: management review, then ES approval. MG: SUBEB management review, then Executive Chairman endorsement | One decision on the whole list. Each exclusion carries a reason. The approval memo is attached | p.8 ("by 31st of October"), p.17, p.35 ("SUBEB Chairman … by 30 October"), p.41 |
| **Funding: DI** | Budget submission 15 Dec; appropriation when it happens | Finance & Accounts | The budget submission to the Ministry is recorded with its acknowledgement. The **appropriated schedule** is imported: appropriated proposals become **draft projects**, partly funded ones convert at the funded amount, and the rest are marked "Not funded, carried forward". The approved list for the year is written automatically | p.9 ("timestamps and acknowledgement receipts"; "procurement planning shall commence only after … the nationally approved … budget"; "no project is planned outside appropriated ceilings") |
| **Funding: MG (BEAP)** | Submitted 15 Nov, reviewed 22 Nov, approved 30 Nov | SUBEB drafts; UBEC Physical Planning reviews; UBEC Executive Management approves | The SUBEB builds its BEAP from the approved proposals: lot, procurement method, timelines, narrative and counterpart funding. UBEC reviews each item, through desk review and an optional field verification, and returns comments. A revision cannot exceed the approved amount. Approval turns the proposals into **draft projects owned by the SUBEB**, with lot and batch codes | p.35–36 (electronic submission, review, 5-day revision, approval by 30 Nov), p.42–43 |
| **Procurement plan** (DI) | 6 weeks after appropriation | Procurement | Funded drafts are packaged into lots and batches (`LOT 5 BATCH 7`). The approved plan is filed | p.20 ("projects are packaged into lots"), p.21 |

**Projects outside the annual cycle.** The PCM names direct requests from the Presidency, communities and States as inputs (p.14). The platform gives these a controlled route instead of a back door. The request names a reason (emergency, presidential directive, supplementary budget, other funding source, carried-over appropriation) and must attach an authorising document. It is approved by the ES (DI), or by the Executive Chairman and then UBEC (MG). It is marked **"Outside annual cycle"** on every list and export.

**Checks that run on every uploaded version:**

| Check | Rule | PCM |
| :--- | :--- | :--- |
| Minimum content | BoQ, justification, drawings, assumptions, cost estimate, site and location data required before the stage can be left | p.7, p.34 |
| Essential facilities | Each school must show toilets, water (borehole or tank) and solar, either proposed or existing and functional; a gap needs a written justification before validation | p.7, p.35 |
| Supervision and monitoring cost | A costed version must include the supervision and monitoring line at the standard's percentage | p.8 |
| Duplicates | Same school in the same LGA, or a site within 100 m of another open proposal or of a project site from the last 3 years: flagged for the validator to resolve | p.4 ("eliminating duplication") |
| Rate variance and ceilings | Rates compared with the costing standard (15 % tolerance by default); costs compared with ceilings | p.8, p.16 |
| Change after a decision | A new version that changes the scope after Validation sends the proposal back to Validation. One that changes the cost after Costing sends it back to Costing. Earlier versions are never overwritten | p.8 (records kept) |

**Keeping work moving:** each person has a "Waiting for me" task queue with a count badge, and email reminders go out when an item is returned, waiting, due within 7 days or overdue. A deadline strip shows each stage's date against today.

### 4.2 From funded draft to live project

**PCM:** the hand-off from procurement to delivery (p.24: award publication, letter of introduction; p.11).

- **Nothing is re-entered.** The draft project already holds its sites, facility units and costed BoQ lines from the needs assessment.
- **Guided setup** in four steps:
  - **Project:** basics, intervention year, funding source, State and LGA, sites located on a map with address lookup.
  - **Contract:** contractor chosen from the register, award and signing dates, contract sum, contract documents.
  - **Scope:** work phases, facility units and BoQ.
  - **Team & monitoring:** visit officers and a preview of the visit plan.
- **Contractor register:**
  - a duplicate registration number is refused;
  - a suspended contractor cannot be named on a new project;
  - a new contractor stays inactive until a signed contract is on file;
  - each contractor has a reliability rating built from monitoring data.
- **Activation gate.** No project goes live unless:
  - it has a traceable origin (a funded proposal, an approved out-of-cycle request, or an onboarding import of an existing project);
  - every site is located;
  - for Matching Grants, the BEAP's counterpart funding evidence is on file.

### 4.3 Project kick-off

**PCM:** DI p.11, 25–26; MG p.37–38, 47–48.

| PCM requirement | Platform |
| :--- | :--- |
| Briefing pack and notice to every stakeholder group (contractor, UBEC State/Zonal, HQ Finance, M&E, Legal, SUBEB, beneficiary) | Invitees by stakeholder group; the contractor is emailed the kick-off notice; the briefing pack and agenda are filed in the document register |
| Notice at least 1 week before the meeting | Deadline tracked as a contract milestone |
| Quorum: one authorised representative per group | Recorded attendance is checked against the groups. A waiver needs a written reason |
| Deliverables documented and signed | Minutes uploaded and signed off. MG: minutes within 3 working days (p.38) |
| MG: programme of works and mobilisation plan at or before kick-off (p.38) | Programme of works is a document that needs sign-off; its sign-off completes the "Programme accepted" milestone |
| DI: mobilisation within 3 weeks of award (p.12) | The kick-off planner warns when the planned kick-off is later than award + 14 days, which would leave too little of the mobilisation window |

### 4.4 Site mobilisation

**PCM:** DI p.6 (note 4), 11–12, 27–28; MG p.33 (note 2), 38, 49–50.

- **Deadlines calculated from the contract dates:**
  - DI: contractor on site within **21 days of contract award** (p.12);
  - MG: within **14 calendar days of the kick-off** (p.38);
  - letter of introduction within 1 week of kick-off (p.11);
  - mobilisation documents complete before mobilisation (p.11, p.49: contract, mobilisation agreement, site possession form, monitoring templates).
- **Resident Supervisor assignment** with a workload check against the PCM ratio of 7–10 sites per supervisor (p.11, p.27). It warns and does not block.
- **Mobilisation checks:** visits are proposed automatically every two weeks until the contractor is on site (p.28: "every two weeks or twice a month"). The first accepted monitoring report confirming the contractor is on site completes the milestone and cancels later checks.
- **Escalation to Legal:** an overdue mobilisation opens a **default case** that follows the PCM chain: Director Legal review, then the Executive Secretary's decision (DI) or the SUBEB Executive Chairman's (MG). A termination is recorded on the contractor's engagement, open milestones are waived, and the history is kept.

### 4.5 Monitoring & evaluation

**PCM:** DI p.12–13, 29–30; MG p.38–39, 51–52.

**Monitoring framework (p.29: "indicators, reporting templates, online reporting platform access, and visit frequency").**
- Each programme carries a visit plan: baseline visit, weekly routine visits, mobilisation checks, quarterly M&E visits, final evaluation and, for MG, the post-closure evaluation.
- The plan proposes visits automatically when a project goes live, when work phases are set, at the completion notice and at closure.
- The manager publishes the visits. Officers confirm them, move them within a set tolerance, or decline. A planner and calendar show every officer's schedule.

**Forms built for the visit.**
- Each visit's form is assembled automatically from fixed sections plus a sub-form for each facility being built in that work phase. The fixed sections cover the PCM checklist (p.12): progress against the work programme, workmanship, materials, health and safety, environmental safeguards.
- The form is frozen when the visit is published, so every officer answers the same version and the record shows exactly what was asked.

**Field app (p.12: "geo-tagged photographs"; p.29: "online & offline").**
- Works offline. Home is a calendar of the officer's visits.
- Check-in records position against the site boundary. Being outside it is flagged, not refused.
- The form is filled section by section, with photos taken in the app.
- Every photo carries GPS, accuracy and compass heading ("Facing NE (47°)").
- Voice notes are transcribed automatically.
- A free **site log** captures notes, photos and voice notes at any time.
- Everything waits in an outbox and is sent when signal returns, with no duplicates.

**Review and deadlines (p.12: "within one (1) week of the site visit").**
- Each monitoring report goes to M&E review. The person who submitted it cannot approve it.
- A submission deadline is tracked for every visit. Missed visits are marked.

**Findings and corrective action (p.28: "delays or non-compliance are flagged for corrective action").**
- Failed form answers raise findings automatically, with a severity.
- Each open finding is added as a re-check item to the next visit's form.
- Findings left open too long are escalated.
- The contractor is emailed a findings summary.

**Progress from evidence.**
- Accepted monitoring reports set the % complete of each facility unit. That rolls up to BoQ lines, sites and the project, weighted by budget.
- At the end of each work phase, M&E verifies it as met, partly met or not met. The schedule badge (on track, behind, complete) follows.

**Independent monitoring (p.13).** Independent M&E firms work in their own organisation with the same app, for ad hoc independent visits.

**Early-warning alerts.** Thresholds are set per programme:

| Alert | Raised when (defaults) | Goes to |
| :--- | :--- | :--- |
| Delayed | A facility unit whose work phase has ended is still below 100 % | Schedule followers |
| Stalled | No accepted monitoring report has raised progress for 30 days | Escalation holders and the field officers |
| Site update overdue | No accepted monitoring report for 14 days during execution | Visit planners and the field officers |
| Spend ahead of progress | % of contract sum paid exceeds % complete by more than 15 points | Finance |

**Contractor performance.**
- Each contractor gets a reliability rating built from monitoring data: workmanship, work phases met, mobilisation on time, serious findings and how fast they were fixed, and closure ratings.
- A contractor is **flagged** automatically after 3 accepted monitoring reports rate its workmanship 3 or lower within 60 days.
- Possible actions: extra visits, a formal warning, a payment hold (in force at once), or a referral to Legal review (deduction, stop work, replacement, suspension).

### 4.6 Payments and retention

**PCM:** "valuation of works done" (p.12), "financial utilisation" (p.30), "no project shall proceed to … final payment … without an approved Certificate of Completion" (p.13).

- Payments are made outside the platform and **recorded** on it by Finance (an ERP feed can follow).
- Retention is held at the project's percentage. Net paid to date and the retention balance stay in step with each payment.
- **Exceptions are flagged:** a final payment or retention release before the Certificate of Completion, a payment above the contract sum, a payment during a contractor payment hold.
- A wrong entry is voided with a reason, never deleted.
- Portfolio view breaks payments down by zone, State, LGA, contractor, project, month and quarter.
- Retention and the defects liability period are not in the PCM. They were added at UBEC's request.

### 4.7 Completion and closure

**PCM:** DI p.13, 30–31; MG p.39, 52–54.

| PCM requirement | Platform |
| :--- | :--- |
| Contractor completion notice; verification by Resident Supervisor and M&E (p.31, p.53) | The completion notice starts the handover phase and proposes the final evaluation visit |
| Final evaluation before handover (p.13, p.30) | The Certificate of Completion cannot be drafted until a final evaluation visit has been accepted |
| CoC "duly signed off by relevant department heads and beneficiary institution" (p.13, p.39) | Signature slots per department head. The beneficiary signature is recorded from the signed paper copy with a declaration. The last signature issues the CoC as a PDF |
| "No project shall proceed to handover, final payment, or closure without an approved CoC" (p.13) | Handover-to-retention and project close are **blocked** without an issued CoC. A final payment without one is **flagged** (payments happen outside the platform) |
| Handover ceremony within 1 week of CoC (p.13) | Handover milestone dated from the CoC issue |
| Signed handover certificate (p.31, p.53) | The beneficiary's response is recorded by one officer and reviewed by another. Acceptance issues the handover certificate. Snags become defect tickets |
| Lessons learned (p.13, p.52) | Captured in the closeout report and shared internally |
| MG post-closure evaluation: beneficiary feedback, contractor ratings (p.54) | Post-closure evaluation visit dated from the close date; contractor ratings per stage |
| MG archiving and audit (p.54) | Closure checklist with automatic and manual items. **Audit sign-off can never be waived.** Archiving waits for the checklist |
| "All project records … compiled and filed" (p.31, p.53) | **Closure pack:** one ZIP with an index, a manifest with fingerprints, every document and certificate, monitoring visit summaries, the audit ledger and its verification. The archived project becomes read-only |

The project also cannot close before the defects liability period has ended.

### 4.8 Programme oversight

| Feature | What it shows | PCM |
| :--- | :--- | :--- |
| Portfolio dashboard and map | Every project and site, stage, schedule status, alerts, commitment and paid to date; one pin per located site | p.13 (online dashboard) |
| Project register | Filters by zone, State, LGA, contractor, intervention year, funding source and status; site rows; Excel and PDF export | p.4 (audit-readiness, documentation) |
| Project overview | Stage bar, progress curve (planned vs actual vs paid), unit and work-phase progress, visits by month, findings by severity, money, origin card | p.30 (dashboards) |
| Programme KPIs | 21 KPIs taken from the PCM's own KPI columns (table below), with targets per programme, monthly trends and Excel export | KPI columns, p.25–31, p.47–54 |
| Needs assessment page | Each cycle's proposals, stages, deadlines, committee, approvals, funding, procurement plan, cycle documents, approved lists | p.8 (central repository) |
| Approved lists | Each year's DI schedule and MG BEAPs, with every project linked and a red flag when a budget differs from its approved amount by more than 10 % | p.9 (no project outside appropriated ceilings) |
| Exports | Visits, findings, payments, KPIs and register to Excel in UBEC styling | p.4 |

**KPIs taken from the PCM:**

| PCM stage | KPIs tracked |
| :--- | :--- |
| Kick-off (p.25–26) | Agenda prepared · notices sent on time · attendance · minutes documented and signed |
| Mobilisation (p.27–28) | Supervisor assigned · letters of introduction on time · contractors mobilised on time · full mobilisation documentation |
| Monitoring & evaluation (p.29–30) | Sites with baseline data · visits conducted vs planned · monitoring reports on time · approval turnaround · work phases verified on time · financial utilisation |
| Closure (p.31, p.53–54) | Verified on time and to specification · handed over on time after the CoC · full closure documentation · lessons documented · audited after closure |
| Overall | Projects on schedule |

---

## 5. Data flows

```
   Excel templates                 Field app (phone, offline)               Finance
   (needs assessments,             (field verification, monitoring          (payments,
    costing standards,              visits, photos, voice notes,             appropriation)
    appropriated schedule)          site log, defects)                          │
          │                                │                                    │
          ▼                                ▼                                    ▼
   ┌───────────────────┐  funding  ┌────────────────────────────────────────────────────┐
   │ Needs cycle       │──gate────►│ Project: sites · facility units · BoQ · contract   │
   │ proposals,        │  converts │ milestones · visits · findings · progress ·        │
   │ versions, flags,  │           │ payments · certificates · documents                │
   │ decisions, scores │           └────────────────────────────────────────────────────┘
   └───────────────────┘                     │                      │
          │                                  ▼                      ▼
          ▼                       Alerts, task queues,      Dashboards, KPIs, register,
   Generated cycle reports        emails, phone pushes      exports, closure pack
   (Validated Project List,
    Cost Estimate Report,         ───────── every change also written to the hash-chained audit ledger ─────────
    Prioritised Project Portfolio)
```

| Data in | From | How it is checked on the way in | What it drives |
| :--- | :--- | :--- | :--- |
| Needs assessment files | Procurement officers (UBEC / SUBEB) | Template version stamp; row-level errors shown in a preview; nothing saved until confirmed; the confirmed file must be identical to the previewed one | Proposals, sites, facilities breakdown, BoQ, flags |
| Costing standards | Quantity surveyors | Strict number checks; versioned; locked once a cycle or a costed proposal uses it | Standard rates, variance flags, ceilings |
| Field verification and monitoring reports | M&E officers, Resident Supervisors, independent firms | Frozen form and fingerprint; answer rules; GPS accuracy; faked-location detection; device signature; site boundary check | Validation records, corrected coordinates, findings, progress, milestones, contractor ratings |
| Documents (letters, contracts, minutes, signed paper copies) | Staff | Size, type and fingerprint read from storage; sign-offs per document type | Milestones, contractor activation, CoC, closure checklist |
| Appropriated schedule, approved lists | Finance, Director Physical Planning | Preview, then confirm; the whole file is refused if any row is wrong | Draft projects, approved-list links, budget mismatch flags |
| Payments | Finance | Amounts computed by the server; retention at the project rate; exceptions flagged | Paid to date, retention balance, spend-ahead alerts, payment KPIs |
| Project register import | Administrators (onboarding projects already under way) | Whole file refused on any error | Imported projects, marked with their origin |

| Data out | To |
| :--- | :--- |
| Validated Project List, Cost Estimate Report, Prioritised Project Portfolio (Excel and PDF) | Cycle documents; signed copies can be filed beside them |
| Certificate of Completion, handover certificate (PDF) | Project document register |
| Closure pack (ZIP) | Audit and archive |
| Kick-off notice, findings summary | Contractor (email) |
| Task notices, reminders, alerts | Staff (email, in-app, phone push) |
| Register, payments, KPI, visit and findings exports | Management reporting |

---

## 6. Security, integrity and validation

### 6.1 Access

- **Roles and permissions.** Every action checks a named permission. Screens show only what a person may do.
- **Organisation structure.**
  - UBEC HQ sees the programme. A SUBEB sees only its own State. M&E officers see only their assigned projects.
  - Approval steps are tied to organisations. For example, UBEC's BEAP review must be done by someone in an organisation above the SUBEB, never by the SUBEB itself.
- **Sign-in.**
  - Passwords are stored as one-way hashes.
  - An account locks for 15 minutes after 5 failed attempts. Sign-in attempts are rate-limited per network address.
  - Response times do not reveal whether an email address is registered.
- **Phone-only roles cannot sign in on the web.** Contractors and beneficiaries have no accounts at all.
- **Workspaces are kept apart.** Each programme authority (tenant) sees only its own data.

### 6.2 Separation of duties

| Rule | Stage |
| :--- | :--- |
| The person who uploaded a proposal cannot validate it | Validation |
| The validator cannot cost it | Costing |
| Committee members are recused from proposals they uploaded, validated or costed, or declared a conflict on | Prioritisation |
| The submitter of a list cannot approve it, and no one decides two steps of one approval chain | Approval, BEAP, out-of-cycle |
| The person who approved the portfolio cannot confirm the appropriation import | Funding |
| The submitter of a monitoring report cannot approve it | Monitoring |
| The officer who records a handover response cannot review it | Handover |

Where a SUBEB lacks enough people, the blocked person can ask for an **override with a reason**. A **different person** with override authority must approve it. The override is flagged on the proposal and in the ledger.

**For UBEC to note:** the PCM has the ES both chair the DI steering committee and approve the portfolio (p.16–17). The platform keeps this as written, with a management review step in between, but it is a separation-of-duties weakness in the manual.

### 6.3 Tamper-evident record

- Every change is written to the **audit ledger** in the same step as the change itself, so one cannot happen without the other.
- Each ledger entry is chained to the previous one with a SHA-256 fingerprint, so any later edit breaks the chain. The closure pack includes a chain verification.
- Needs assessment versions are **never overwritten**. Validation, scoring and approval are kept as decision records.
- Payments are voided, never deleted. Certificates are revoked with a reason, never erased.

### 6.4 Trustworthy field evidence

| Control | Effect |
| :--- | :--- |
| In-app camera with GPS, accuracy and compass heading | Each photo shows where it was taken and which way it faced |
| Faked-location detection and accuracy limits | Simulated or poor fixes are flagged, and are not used to correct site coordinates |
| Site boundary check at check-in | Visits recorded away from the site are flagged for the reviewer |
| Device signature and file fingerprint on every capture | A photo cannot be swapped after capture without detection |
| Frozen form with a fingerprint | The answers are tied to the exact questions asked |
| Captures must belong to the submitting officer and project | No reuse of another officer's or another site's photos |
| Offline outbox with unique client IDs | No lost or duplicated submissions on poor networks |

### 6.5 Validation and rules

- **Excel round trips are safe:**
  - templates carry a version stamp;
  - every upload is previewed with row-level reasons;
  - nothing is written until confirmed;
  - the confirmed file must match the previewed one byte for byte;
  - for bulk imports, one wrong row refuses the whole file.
- **Business rules are checked by the server**, not only on screen. Examples: the LGA must belong to the State; the intervention year must be allowed; essential facilities; the supervision and monitoring line; duplicate sites; rate variance; BEAP revision not above the approved amount; CoC gates; the activation gate.
- **Amounts are computed by the server** (BoQ line amounts, retention, net paid), never taken from the browser.
- **No AI.** At UBEC's requirement, every check is a fixed, explainable rule. The only model used is speech-to-text for voice notes.

### 6.6 Files and privacy

- Files are kept in object storage. They are reached only through short-lived signed links, under the same access rules as the record they belong to.
- Address lookup sends only the address text to the map provider. Results are not stored.

---

## 7. Configurability (in brief)

Most of the PCM's rules are settings on each programme (Direct Intervention, Matching Grants), so UBEC can change them as the manual is revised (p.4: "this manual will be reviewed periodically") without new development:

- needs assessment stages, deadlines, rubric, essential facility groups, tolerances, approval chains;
- contract milestones and their anchors (award, signing, kick-off, CoC);
- kick-off stakeholder groups and quorum;
- visit plan, submission deadlines, escalation periods and alert thresholds;
- form library (fixed sections and facility sub-forms, versioned);
- closure rules, CoC signature slots and checklist items;
- KPI targets;
- workspace terminology, facility catalogue and costing standards.

A cycle or project keeps the rules it started with. A change applies to new cycles and new projects.

---

## 8. Where the platform settles gaps in the PCM

The draft PCM has a few conflicts. The platform resolves each one as a setting, so UBEC can change the answer without new development:

| PCM text | Conflict | Platform default |
| :--- | :--- | :--- |
| Needs assessments by "31st of September" (p.7, p.34) | The date does not exist | 30 September |
| DI mobilisation "within three weeks after the project kick-off" (p.6) vs "three (3) weeks from the date of contract award" (p.12) | Two anchors | 21 days from award; kick-off warned if later than award + 14 days |
| MG flowchart "three weeks" (p.33) vs "14 calendar days of the project kick-off" (p.38) | Two durations | 14 days from kick-off |
| DI validation by 30 July (p.15), but full needs assessments due by 30 September (p.7) | Validation before submission | A Design stage after validation (need validated first, full design second) |
| Scoring sub-criteria | Not given; only the 60/40 split | Five sub-criteria per dimension, 1–5 scale, equal weights (assumption) |
| MG counterpart funding | Not in the PCM | Recorded on the BEAP; required before an MG project goes live (setting) |

---

## 9. Status and boundaries

| Area | Status |
| :--- | :--- |
| Needs pipeline (cycle, validation, design, costing, prioritisation, approval, funding, BEAP, out-of-cycle, conversion, activation gate) | Built (waves 1–4) |
| Field verification from the phone | Built, finishing (wave 5) |
| Project delivery (setup, kick-off, mobilisation, monitoring, payments record, completion, closure, KPIs, alerts, contractor register) | Built |
| Procurement process (bidding, evaluation, BPP, Tender Board) | Outside the platform by design; award, contractor and documents recorded |
| DI budget preparation internals (collation, consolidation, steering committee review, p.18–19) | Outside; the platform records the budget submission and imports the appropriation |
| Needs assessment KPIs (e.g. "% of projects validated > 80 %", p.15) | Deadlines and statuses are tracked per cycle; not yet on the KPI dashboard |
| Payments | Recorded manually; ERP feed later |
| Verification | Automated tests cover server, web build and mobile logic (wave 5's final run is still to be recorded). Browser click-through and on-device checks are still owed (collected in `web_testing_checklist.md` and `physical_testing_checklist.md`) |
