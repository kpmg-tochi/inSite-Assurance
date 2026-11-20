# Process Flow Fit and Gap Analysis: Central and Co-Funded Delivery Models

**Date:** 2026-11-20
**Source reviewed:** *Institutional Diagnostic Review: Project Cycle Redesign* (draft, February 2026, depersonalised), 54 slides. Central Delivery Model: flow on slide 6, policies slides 7–13, process tables slides 14–31. Co-Funded Delivery Model: flow on slide 33, policies slides 34–39, process tables slides 40–54.
**Platform state reviewed:** branch `saas`, after Phase 10.

---

## 1. Verdict

| Question | Answer |
| :--- | :--- |
| Can the platform be configured today to run both models **from site mobilisation to closure**? | **Mostly. About 60–70% of the controls in those stages work through configuration alone.** Field supervision, geotagged evidence, cadence and late reports, report approval chains, valuation and payment chains, schedule variance, handover and defects all fit. |
| What blocks a faithful run of those stages? | Six gaps (section 5, P1): no project type / delivery model, no contract milestone and deadline tracking (award, kick-off, the mobilisation deadline, escalation to Legal), no general document register with sign-offs, no Certificate of Completion gate, one reporting cadence per project (weekly supervision and quarterly M&E can't run side by side), and no structured site inspection checklist. |
| Can it run the stages **before** mobilisation (needs assessment, budget, RDAP, procurement planning, procurement)? | **No.** These are annual, programme-level cycles: portfolio scoring, steering committees, bid evaluation and No Objection clearance. The platform starts at a single project with an awarded contract. Section 6 recommends capturing what those stages produce, not rebuilding them. |
| Do the two models need separate builds? | **No.** After mobilisation they differ mainly in **who** acts (programme HQ vs regional delivery entity), **deadlines** (mobilisation within 3 weeks vs 14 days) and **a few extra steps** (co-funded: programme of works at kick-off, minutes within 3 working days, lessons learned, post-closure evaluation, archiving and audit). A configurable project type that holds those differences covers both (section 4). |

---

## 2. Scope boundary

```
 Needs        Budget /     Procurement   Procurement   Kick-off   Site           Monitoring &   Project
 Assessment   RDAP         Plan          Process       meeting    Mobilisation   Evaluation     Closure
 ───────────── programme level, annual ─────────────────┤├──────────── one project, one contract ───────────
             OUT OF CORE SCOPE (section 6)              │  GAPS      PARTIAL        STRONG FIT     PARTIAL
```

The platform's unit is a **project with a contract and a contractor**. Everything from the contract award onwards maps onto a project. Everything before it is portfolio planning across many candidate projects.

---

## 3. What already fits: configuration recipe per model

Assumes **one tenant per Programme Authority**. Regional delivery entities, contractors and accredited M&E firms are **organisations** in that tenant (category `GOVERNMENT_MDA`, `CONTRACTOR`, `ADVISORY_MONITOR`). One tenant keeps the authority's cross-programme view; a tenant per regional entity would lose it.

| Setting | Central Delivery Model | Co-Funded Delivery Model | Where it lives today |
| :--- | :--- | :--- | :--- |
| Workflow template | "Central Delivery Model" | "Co-Funded Delivery Model" | Tenant workflow templates ([process.schema.ts](../shared/src/schemas/process.schema.ts)) |
| Disbursement mechanism | `IPC_CLAIM_REQUIRED` *(assumption: the deck does not describe contractor payment; see Q1)* | Same | Process step |
| Tranches and CPs | Off (one implicit tranche) unless funds are released in instalments | Possibly on, if programme funds reach the regional entity in tranches (Q2) | `enableTranchesAndCps` |
| Hold points | On (foundations, buried WASH works, borehole casing) | On | `enableHoldPoints`, BOQ step |
| Contractor field reporting | On ("contractors and supervisors submit progress updates", slide 30) | On ("contractors submit progress reports", slide 52) | `allowContractorFieldReporting` |
| Report approval | On; chain: Resident Supervisor → M&E officer | On; chain: regional M&E → programme regional representative | `requireReportApproval` + report chain |
| Disbursement chain | Certify (Resident Supervisor / M&E) → review (Director Physical Planning) → release (Finance & Accounts) | Certify (regional M&E) → review (Regional Management) → release (regional finance) | Disbursement chain, `requiredRoleId` per step |
| Handover module | On (beneficiary school or community via secure link) | On | `enableHandoverModule` |
| Retention module | On if contracts hold retention (Q3) | Same | `enableRetentionModule` |
| Standards | WASH, solar, toilets as required components (policy: "essential facilities") | Same | Standards step |
| Reporting cadence | `WEEKLY` (supervision "on a weekly basis or as required") | `WEEKLY` | Reporting step |
| Geofence | Radial or perimeter per school | Same | Site step |
| Field roles | Resident Supervisor → `INDEPENDENT_RESIDENT`; M&E officer and accredited firm → `MONITOR_INSPECTOR`; contractor → `CONTRACTOR_ENGINEER` | Same, plus programme regional representatives as `MONITOR_INSPECTOR` | Roles; provisioned accounts for staff (decision G), join codes for contractors |
| Parties | Monitor = the authority's M&E; "Lender" = the authority (Finance & Accounts) | Monitor = regional M&E; "Lender" = the regional entity or the authority (Q2) | Parties step |
| Schedule | Contractor's programme of works becomes the schedule baseline | Same (co-funded makes it mandatory at kick-off) | Schedule step |
| Site mobilisation of people | Participants roster with planned mobilisation dates, reminders, no-show alerts | Same | Mobilisation module |

### Stage-by-stage coverage (post-award)

Legend: **Fit** works by configuration · **Partial** works with a workaround or loses a control · **Gap** needs a build.

| Stage / control (slide) | Central | Co-funded | Status | Notes |
| :--- | :---: | :---: | :---: | :--- |
| Contract award, acceptance letter in 3 days (10, 37) | ✓ | ✓ | Gap | No award date, acceptance date or deadline tracking. G2 |
| Award publication, notification to regional offices (24, 46) | ✓ | ✓ | Gap | Outside scope except as a document and date. G2, G3 |
| Kick-off briefing pack sent within 1 week of contract execution; notice ≥1 week before (11, 37) | ✓ | ✓ | Gap | No meeting record, invitee list or receipt evidence. Messaging can send emails. G2 |
| Kick-off quorum: one authorised rep per stakeholder group (11, 37) | ✓ | ✓ | Gap | G2 |
| Kick-off minutes and mobilisation agreement signed by all stakeholders (26, 48) | ✓ | ✓ | Gap | Co-funded: approved and uploaded within 3 working days (38). G2, G3 |
| Programme of works and mobilisation plan at or before kick-off (38) | – | ✓ | Partial | Schedule step holds the dates, but the monitor enters them; no "submitted by contractor" record or deadline. G2 |
| Letter of introduction to beneficiary school within 1 week of kick-off (11, 24, 49) | ✓ | ✓ | Gap | Document plus deadline. G2, G3 |
| Mobilisation documentation complete before mobilising (11, 49) | ✓ | ✓ | Gap | No document checklist gate. G2, G3 |
| Resident Supervisor assigned; 1 supervisor per 7–10 nearby sites (11, 27) | ✓ | – | Partial | Provisioned users can be assigned to many projects; no ratio check or workload view. G9 |
| Contractor mobilises within 3 weeks (Central) / 14 calendar days of kick-off (Co-funded) (12, 38) | ✓ | ✓ | Gap | Mobilisation today tracks **people** checking in, not the **contractor's** contractual deadline. G2 |
| Mobilisation check every two weeks; delays flagged (28, 50) | ✓ | ✓ | Partial | Attendance and no-show alerts exist; no mobilisation compliance report. G2 |
| Default referred to Legal; termination with Chief Executive / Regional CE approval (6, 12, 38) | ✓ | ✓ | Gap | No default or termination case; a contractor with activity cannot be removed or replaced ([contractors.service.ts](../server/src/modules/projects/contractors.service.ts)). G7 |
| Monitoring framework: indicators, templates, platform access, visit frequency (29, 51) | ✓ | ✓ | Partial | Setup wizard covers templates, access and frequency; no custom indicators. G6 |
| Baseline data collection: photos, site conditions, contractor readiness (29, 51) | ✓ | ✓ | Partial | Captures work, but no "baseline survey" report type separate from progress reports. G5 |
| Weekly supervision by Resident Supervisors (12, 38) | ✓ | ✓ | Fit | Weekly cadence, obligations, late/missed flags |
| Quarterly M&E visits (or as required) (12, 38) | ✓ | ✓ | Gap | One cadence per project; obligations are owed by "verifier" as a whole ([cadence.service.ts](../server/src/modules/cadence/cadence.service.ts)). G4 |
| Visit checklist: progress vs programme, workmanship, material standards, H&S, valuation, environment (12, 38) | ✓ | ✓ | Partial | Reports are per BOQ item; standards check covers materials, method and safety; schedule covers progress. No site-level checklist report. G5 |
| Reports uploaded within 1 week of visit, with geotagged photos (12, 38) | ✓ | ✓ | Fit | Due time and grace per period; captures are geotagged and geofence-checked |
| Online dashboard: progress, compliance, risks, resource use (13) | ✓ | ✓ | Partial | Portfolio map, executive matrix, schedule badge, disbursed vs budget. No KPI view per process stage. G8 |
| Independent M&E by accredited firms (13, 39) | ✓ | ✓ | Fit | Advisory monitor organisation + `MONITOR_INSPECTOR` role |
| Valuation of works done (12) | ✓ | ✓ | Fit | IPC reconciliation, certification, chain |
| Final evaluation at completion, before handover (13, 30, 52) | ✓ | ✓ | Partial | Can be done as a final report or valuation; no "final evaluation report" record that gates handover. G6 |
| Certificate of Completion, signed by department heads and beneficiary; required before handover, final payment or closure (13, 39) | ✓ | ✓ | Gap | Phase moves have no CoC record or multi-signatory sign-off; final payment is not gated. G6 |
| Handover ceremony within 1 week of CoC; signed handover certificate (13, 31, 53) | ✓ | ✓ | Partial | Handover link records accept / accept with snags / reject from the beneficiary; no CoC-relative deadline and no certificate PDF. G6 |
| Records compiled and filed: contracts, reports, photos, financial records (31, 53) | ✓ | ✓ | Partial | All operational records exist and the audit chain is sealed; no closure file export and contracts are not stored. G3, G6 |
| Lessons learned and feedback (13, 52) | ✓ | ✓ | Gap | G6 |
| Post-closure evaluation: beneficiary feedback, contractor performance rating, within 2 weeks (54) | – | ✓ | Gap | G6 |
| Archiving and audit of closure file (54) | – | ✓ | Partial | `ARCHIVED` is read-only and the ledger is hash-chained; no audit sign-off or closure pack. G6 |
| Every stage's KPIs (slides 14–54) | ✓ | ✓ | Partial | Several are computable from existing data (section 5, G8) |

---

## 4. The two models side by side, after award

Only differences the platform has to represent:

| Aspect | Central | Co-Funded | Platform implication |
| :--- | :--- | :--- | :--- |
| Lead entity | Programme Authority HQ (Director Physical Planning) | Regional Delivery Entity, with Programme Authority review | A project needs an **implementing organisation** and an **oversight organisation**, not only monitor and lender (G1, G10) |
| Kick-off owner | Regional/area Physical Planning Officers | Regional Planning, Research & Statistics dept; sign-off by M&E | Role per milestone, set by project type (G2) |
| Mobilisation deadline | "Not exceed three weeks from the date of contract award" (slide 12) **but** "within three weeks after the kick-off meeting" (slide 6 note 4) | 14 calendar days from kick-off | Configurable rule: N days from an anchor event (G2). **The deck contradicts itself for Central; the client must pick one anchor (Q4).** |
| Programme of works at kick-off | Not stated | Required | Milestone with required document (G2, G3) |
| Kick-off minutes | Signed, filed | Approved and uploaded within 3 working days | Working-day deadlines (G2) |
| Default approval | Chief Executive | Regional Chief Executive | Approval chain for default cases (G7) |
| CoC issued by | Programme Authority | Regional Delivery Entity | Signatory list per project type (G6) |
| Closure steps | Completion verification, beneficiary handover | Adds post-closure evaluation (2 weeks) and archiving & audit | Closure checklist per project type (G6) |
| M&E steps | Five | Adds lessons learned & feedback | Same (G6) |

These differences are about **who, when and which extra steps**, which argues for one data-driven "project type", not two code paths.

---

## 5. Gaps and what is needed

Sizes are rough engineering estimates for one developer: **S** under 3 days, **M** 1–2 weeks, **L** 3+ weeks. They exclude UI click-through.

### P1: needed to run the post-award stages faithfully

#### G1. Project type (delivery model) — M

| | |
| :--- | :--- |
| **Process needs** | Two models with different owners, deadlines and steps, running side by side; dashboards and KPIs split by model. |
| **Today** | `WorkflowTemplate` copies process switches and approval chains into a project, then is kept as "provenance only" (`ProjectProcessConfig.workflowTemplateId`). Templates do not carry cadence, deadlines, milestones, required documents, party slots or closure steps, and the project carries no classification to filter on. |
| **Needed** | <ul><li>A `ProjectType` per tenant (or extend `WorkflowTemplate`) that bundles: process config, both chains, default cadence, milestone and deadline rules (G2), required documents (G3), closure checklist and CoC signatories (G6), and party slots (G10).</li><li>`Project.projectTypeId`, set at the Basics step, kept after setup and shown as a filter and column on the directory, executive matrix and portfolio map.</li><li>Applying a type pre-fills the wizard steps; per-project overrides stay possible. Changing a type on a live project does not rewrite milestones already in flight (same rule as approval chain versions).</li><li>Seed both types for the demo tenant.</li></ul> |

#### G2. Contract milestones, deadlines and escalation — L

| | |
| :--- | :--- |
| **Process needs** | Award → acceptance letter (3 days) → award letter (1 week) → kick-off notice (≥1 week ahead, within 1 week of contract execution) → kick-off with quorum → signed minutes (co-funded: 3 working days) → letter of introduction (1 week) → mobilisation documents complete → contractor mobilised (3 weeks / 14 days) → fortnightly mobilisation checks. Late items are flagged; mobilisation default goes to Legal. |
| **Today** | `ProjectContractor.plannedMobilizationDate` is a plain date. Mobilisation (Phase 8) tracks individual participants checking in on site; nothing tracks contract events or the contractor's deadline. |
| **Needed** | <ul><li>`ProjectMilestone` table: key, label, responsible role, anchor (another milestone or a project date), offset in calendar or working days, due date (computed, server-side), completed date, completed by, evidence document IDs (G3), status `PENDING / DUE / OVERDUE / DONE / WAIVED` with a waiver reason.</li><li>Milestone templates live on the project type (G1); applying a type creates the rows.</li><li>Kick-off record: date, invitees by stakeholder group, notice sent at, attendance per group, quorum met (computed: one attendee per group), minutes document, sign-offs.</li><li>Contractor mobilisation milestone completed by the first in-geofence check-in of a session bound to that contractor (reuse `markParticipantsOnSite` / `firstCheckIn`), or manually with evidence.</li><li>New job `milestone-deadlines` (same pattern as `overdue-reports`) raising web notifications and emails for due and overdue items to the responsible role.</li><li>Overdue mobilisation opens a default case (G7).</li><li>Optional activation gate: the project type decides which milestones must be done before `DRAFT → ACTIVE`, or before field reporting starts.</li><li>New permissions (`milestones:manage`, `milestones:waive`), audit actions, a "Pre-construction" setup step or project tab.</li></ul> |

#### G3. Project document register with sign-offs — M

| | |
| :--- | :--- |
| **Process needs** | Nearly every stage outputs a filed, often signed document: contract, award and acceptance letters, briefing pack, kick-off minutes, mobilisation agreement, site possession form, letter of introduction, supervisor assignment record, CoC, handover certificate, final evaluation report, closure file. Policy: "uploaded to the central repository", "filed for audit". |
| **Today** | Documents exist only in silos: needs-assessment docs, standards docs, IPC supporting documents, handover attachments. CP evidence is a URL string (`ConditionPrecedent.evidenceDocumentUrl`), not a stored object. |
| **Needed** | <ul><li>`ProjectDocument`: type (tenant-configurable list, seeded with the types above), title, object key, version, uploaded by, linked milestone / CP / phase, `requiresSignOff`.</li><li>`ProjectDocumentSignOff`: user, role, organisation, signed at, statement acknowledged (same model as the certifier acknowledgement; not a qualified e-signature, consistent with Phase 10 scope).</li><li>Reuse storage, multipart upload and the authenticated media endpoint; audit every upload, version and sign-off.</li><li>Migrate CP evidence to a document reference.</li><li>Required document types per project type (G1) feed the milestone and CoC gates.</li></ul> |

#### G4. More than one reporting stream per project — M

| | |
| :--- | :--- |
| **Process needs** | Resident Supervisors report weekly; the M&E department visits quarterly or as required; contractors report progress continuously. |
| **Today** | One `reportingCadence` per project. Obligations are owed by `verifier` (all independent verifiers as one) or by a contractor scope. A quarterly M&E visit can only be modelled as `INSPECTION_ONLY`, which has no periods, so a missed quarterly visit is never flagged. |
| **Needed** | <ul><li>Cadence per reporter stream: allow `ReportingObligation.reporterScope` keyed by role (e.g. `role:<roleId>`) with its own cadence; the project cadence stays the default.</li><li>Add `QUARTERLY` (or rely on `CUSTOM_INTERVAL` of ~91 days, if the client accepts calendar drift) to the cadence enum and `reportingPeriod.ts` maths.</li><li>Mobile: a period card per stream the user owes.</li><li>Brief dispatch and overdue jobs iterate streams. This touches Phase 8 core logic and its tests; budget accordingly.</li></ul> |

#### G5. Site inspection report with a configurable checklist — M

| | |
| :--- | :--- |
| **Process needs** | Each visit assesses progress against the work programme, quality of workmanship, material standards, health and safety, valuation of works done and environmental safeguards. Baseline visits record site conditions and contractor readiness. |
| **Today** | Reports are per BOQ item (quantity and summary). Standards and omission checks run per item. Incidents cover four categories only. There is no site-level visit record. |
| **Needed** | <ul><li>A `SiteInspectionReport` per visit (project-level, not per item): visit type (`BASELINE`, `ROUTINE`, `MOBILISATION_CHECK`, `FINAL_EVALUATION`), checklist answers (rating + comment + captures per item), overall finding, linked item reports.</li><li>Checklist templates per tenant, assigned by project type, seeded with the six areas above.</li><li>Mobile: one more report type through the existing outbox and capture registration; counts towards the stream's obligation (G4).</li><li>Web: inspection list and detail, filter by finding; failed items can raise a query or a defect-style action.</li></ul> |

#### G6. Completion and closure governance — M

| | |
| :--- | :--- |
| **Process needs** | Final evaluation → Certificate of Completion signed by department heads and the beneficiary institution → **no handover, final payment or closure without it** → handover ceremony within 1 week → closure file → (co-funded) post-closure evaluation within 2 weeks with beneficiary feedback and contractor performance ratings → archiving and audit. Lessons learned are captured and circulated. |
| **Today** | `constructionPhase` moves `ACTIVE_CONSTRUCTION → HANDOVER_IN_PROGRESS → RETENTION_PERIOD → COMPLETED_CLOSED` with checks on open claims, an accepted handover and retention held ([projectPhase.service.ts](../server/src/modules/closeout/projectPhase.service.ts)). No CoC, no final evaluation record, no gate on final payment, no lessons, ratings or closure pack. Only the valuation report has a PDF ([pdf-report.service.ts](../server/src/integrations/pdf-report.service.ts)). |
| **Needed** | <ul><li>CoC as a document type (G3) with a signatory list from the project type (roles or organisations, including the beneficiary). Fully signed CoC records `practicalCompletionDate`.</li><li>New phase-transition checks, switchable per project type: final evaluation report (G5 `FINAL_EVALUATION`) before CoC; signed CoC before `HANDOVER_IN_PROGRESS → RETENTION_PERIOD`, before a final valuation or retention release, and before `COMPLETED_CLOSED`.</li><li>Handover link deadline: due 7 days after CoC (a G2 milestone); the handover submission produces a handover certificate PDF.</li><li>Closure checklist per project type (documents filed, evaluation done, post-closure evaluation, audit sign-off) gating `COMPLETED_CLOSED`.</li><li>`ContractorPerformanceRating` per contractor per project (time, quality, safety, responsiveness; 1–5 with comments) and a tenant-wide contractor history view, useful at bid evaluation later.</li><li>`LessonLearned` entries per project with category and tags, browsable across the tenant.</li><li>Closure pack export: a ZIP or combined PDF of documents, final evaluation, CoC, handover certificate, valuation history and the audit ledger extract.</li></ul> |

### P2: needed for reporting and day-to-day management

#### G7. Contractor default and termination — M

Today a contractor with field sessions or IPCs cannot be removed, and there is no record of default. Needed: a `ContractorDefaultCase` (raised automatically by an overdue mobilisation milestone, or manually) with notice to the Legal role, an approval chain ending in the Chief Executive or Regional Chief Executive (reuse the approval chain engine with a new chain type), outcome (`CURED`, `EXTENSION_GRANTED`, `TERMINATED`), and on termination: the package's join codes deactivate, open claims close, and a replacement contractor can be added under the same BOQ items with history kept. Termination is a contract-level state, not the project's `ARCHIVED`.

#### G8. Programme KPI dashboard — M

The deck defines a KPI for every phase. Many are computable now:

| KPI | Source today | Gap |
| :--- | :--- | :--- |
| % reports submitted online / on time | Reporting obligations (`SUBMITTED`, `LATE`, `MISSED`) | View only |
| % visits conducted vs planned | Obligations | Needs G4 for M&E visits |
| % contractors mobilised on time | — | Needs G2 |
| % projects with supervisors assigned | User assignments with a field persona | View only |
| % sites with baseline data uploaded | — | Needs G5 |
| % projects delivered to specification / handed over | Construction phase, handover decisions | Needs G6 for CoC |
| % kick-offs documented and signed; % letters issued on time | — | Needs G2, G3 |
| Approval turnaround time | Approval actions carry timestamps | View only |
| % lessons documented, % audited post-closure | — | Needs G6 |

Needed: a KPI page under the executive area, filterable by project type, region and implementing organisation, with CSV export. Build the "view only" rows first; they need no new data.

#### G9. Supervisor workload — S

Show each provisioned verifier's active project count and spread, and warn (not block) when a project type's ratio (e.g. 10 sites per supervisor) is exceeded at assignment. A "nearby sites" check can use project geofence centroids.

#### G10. Parties, regions and organisation-scoped visibility — M

| | |
| :--- | :--- |
| **Today** | A project has a monitor, a lender and contractors. Region is a free-text `stateLocation`. Web users see either assigned projects or the whole tenant. "Lender" wording is hard-coded in the Parties step ([PartiesStep.tsx](../web/src/pages/projects/setup/steps/PartiesStep.tsx)) and parts of the UI. |
| **Needed** | <ul><li>Extra party slots: implementing organisation (regional entity or HQ), oversight organisation, beneficiary institution (school or community: name, contact, used by handover and CoC), and, if confirmed (Q2), co-funder(s) with a funding share.</li><li>A tenant-managed region list (region → area), selected at Basics, used for filters and KPIs.</li><li>New visibility scope `projects:view_own_organization` (or by region) so a regional entity's staff see all its projects without per-project assignment.</li><li>Tenant-configurable label for the "Lender" party (e.g. "Funding authority"). Roles are already tenant-named.</li></ul> |

#### G11. Contractor-submitted programme of works — S

Let a contractor-side web user propose the initial schedule baseline (items' planned dates and dependencies) for the monitor to accept, recorded as the "programme of works" milestone. Today only the monitor edits the baseline before go-live.

### P3: worth confirming before building

| ID | Item | Note |
| :--- | :--- | :--- |
| G12 | Certification without a professional licence | Certifying an IPC or a milestone requires a licence type and number on the certifier's profile ([reconciliation.service.ts](../server/src/modules/reconciliation/reconciliation.service.ts)). If government Resident Supervisors certify and are not registered (most will hold COREN registration), add a project-type setting. Keep it on by default. |
| G13 | Co-funding split | If "co-funded" means two funding sources paying shares of each certificate, the platform needs funding sources per project and a split on each tranche decision. One lender and one pot exist today. Size L. Only build if Q2 confirms it. |
| G14 | Custom indicators | "Monitoring framework … including indicators" may mean programme outcome indicators (enrolment, classrooms delivered). Needs a definition from the client before design. |

---

## 6. Pre-award stages: recommendation

| Stage | Central | Co-funded | Recommendation |
| :--- | :---: | :---: | :--- |
| Needs assessment (data gathering, stakeholder engagement, validation, costing, prioritisation 60/40, approval) | ✓ | ✓ | **Do not build now.** Keep `needsAssessmentMode` for attaching the approved needs report to the project. Record the prioritisation score and rank as project fields if the client wants them on dashboards. |
| Budget preparation, integration into annual budget | ✓ | – | Out of scope. Record the approved budget line reference and amount at Basics. |
| Regional Delivery Action Plan (draft, submit, review, resubmit in 5 working days, approve by 30 Nov) | – | ✓ | Out of scope for now. Of all the pre-award stages it fits the platform best (a document with a review-and-return chain), but it is programme-level, not project-level. A small "Programme plan" module could reuse G3 documents and the approval chain engine later. |
| Procurement plan and procurement process (bid docs, advert, opening, evaluation, COI declarations, due diligence, No Objection, Tender Board) | ✓ | ✓ | **Do not build.** E-procurement is a separate product with statutory requirements. Capture what procurement produces as the first milestones of G2: procurement reference, contract award date, No Objection reference, signed contract (G3). |

The honest boundary: InSite Assurance is strongest from the signed contract onwards. Building portfolio planning or e-procurement would dilute it and compete with government financial systems the client already runs.

---

## 7. Suggested phasing

| Phase | Contents | Size |
| :--- | :--- | :--- |
| 11 | G1 project type, G3 document register, G10 parties / regions / visibility / labels | ~4–5 weeks |
| 12 | G2 milestones and deadlines (incl. kick-off and mobilisation), G7 default cases, G11 programme of works | ~4–5 weeks |
| 13 | G4 reporting streams, G5 inspection checklists | ~3–4 weeks |
| 14 | G6 completion and closure governance, G8 KPI dashboard, G9 workload | ~4 weeks |

Phase 11 first, because G2, G5 and G6 all hang their per-model rules on the project type and their evidence on the document register. The G8 "view only" KPIs could ship earlier as a quick win.

---

## 8. Open questions for the client

| ID | Question | Why it matters |
| :--- | :--- | :--- |
| Q1 | How are contractors paid: certified interim valuations (IPCs), milestone payments, or only advance plus final payment? | Picks the disbursement mechanism and the certifier role. The deck only mentions "valuation of works done" and "final payment". |
| Q2 | In the co-funded model, who releases money to the contractor, and is it split between the authority and the regional entity? | Decides the "lender" party, tranches and whether G13 is needed. |
| Q3 | Do these contracts hold retention and a defects liability period? | Decides the retention module setting. |
| Q4 | Central mobilisation deadline: 3 weeks from contract award (slide 12) or from kick-off (slide 6)? | The deck contradicts itself; the milestone anchor (G2) must be one or the other. |
| Q5 | Who signs the Certificate of Completion, by role, for each model? | Signatory list for G6. |
| Q6 | Should the platform hold one tenant for the authority with regional entities as organisations (recommended), or a tenant per regional entity? | Shapes G10 and every dashboard. |
| Q7 | Do government certifiers hold QSRBN or COREN registration? | Decides G12. |

---

## 9. Assumptions made in this analysis

- The depersonalised names (Programme Authority, Regional Delivery Entity, Procurement Oversight Authority) map to one programme authority and several regional implementing entities.
- Resident Supervisors, M&E officers and programme regional representatives are staff with accounts (provisioned mobile users); contractors join by code.
- Slides with blank placeholders (e.g. slide 35 item 2, slides 42–43 output columns) refer to the Regional Delivery Action Plan.
- The analysis is based on code and plan documents; Phases 5–10 web and mobile flows are still awaiting full click-through and device testing (see the phase files), so "Fit" means the behaviour exists and is tested at the API level.
