# Needs Pipeline: from identified need to funded project (N0–N9)

Status: **wave 1 (N0 + N1) built 2026-11-26; waves 2–5 not started.** Written 2026-11-26, the day before the Minister of Education demo (2026-11-27). Wave 1 was executed on the owner's instruction that day on the section 3 assumptions (section 16.1 had no answers yet): fold the demo answers into 16.1 before wave 2 starts. Contract names: section 17.

## 1. Goal

Today the platform starts at the end of the funnel: an approved list is uploaded and projects are created from one needs assessment file each (client demo D1, E3). The process design (`Project Context/MoE_Process Design for Direct & Matching Grant Project Delivery__Draft.pdf`, "PCM" below) puts the whole annual needs assessment on the platform: "All records (data, stakeholder inputs, validation reports, cost estimates, prioritisation outcomes) shall be uploaded to UBEC's central repository" (PCM p.8; MG: "All BEAPs shall be submitted electronically through UBEC's designated online portal", p.35).

After this plan:

- The **Needs assessment** page is the repository of **proposed projects** for each annual **cycle**: uploaded (one or many files), validated, completed, costed, scored, approved and funded on the platform, with every version and decision kept.
- Each proposed project carries its **needs assessment versions**, an **intervention and facilities breakdown**, its sites, BoQ and costing against UBEC's **costing standards**.
- Direct Intervention (DI) proposals become projects at **appropriation**; Matching Grants (MG) proposals at **UBEC's approval of the State's BEAP** (owner decision, 2026-11-26).
- No project goes live without a traceable origin: a converted proposal, an approved out-of-cycle exception, or a legacy import.
- A **Standards** page holds costing standards (rates, ceilings, supervision and monitoring share), design standards (standard drawings, essential facilities) and a read-only view of the monitoring standards (from the form library).

Background for the reader: `Project Context/ubec_process_alignment/Flow analysis.txt` (the reasoning) and the conversation summary in section 4.

## 2. Read first

| What | Why |
| :--- | :--- |
| PCM pp.7–8, 14–21 (DI needs assessment, budget, procurement plan), pp.33–36, 40–43 (MG needs assessment, BEAP) | The process this plan models |
| `saas_updates/client_demo_updates/working_plan.md` waves 2–4 (D1 needs assessment first, E3 approved lists) and "Pre-demo round" | The features this plan repositions |
| `server/src/modules/needsAssessment/`, `server/src/modules/approvedLists/`, `server/src/modules/scope/workbook/scopeWorkbook.ts`, `scopeImport.service.ts` | Reused for upload, parsing and conversion |
| `server/src/modules/process/approvalChain.ts`, `server/src/modules/organizations/hierarchy.ts` (`orgContextForStep`) | Approval chains reused for portfolio, BEAP and exception approvals |
| `shared/src/schemas/projectTypeConfigGroups.ts`, `components/deliveryModels/ProjectTypeEditor` | New type key `needsPipeline` needs a group and an editor tab |
| `shared/src/data/defaultFormLibrary.ts`, `server/src/modules/forms/` | Monitoring standards view; verification form (N8) |
| `saas_updates/next_steps/role_catalogue_migration_plan.md` | Roles are still tailored in the seed; new roles follow that pattern |

## 3. Working assumptions until the Minister demo

Owner instruction (2026-11-26): build on these; replace them with the demo answers before N1 starts. Each row says what changes if the answer differs, so a different answer is a config change where possible.

| # | Assumption | Basis | If the answer differs |
| :--- | :--- | :--- | :--- |
| A1 | Needs assessments are prepared **outside** the platform by whoever does the assessment; **Procurement** officers (UBEC for DI, SUBEB for MG) upload the drafts | Owner | Upload is the permission `needs:submit`; grant it to another role |
| A2 | Calendar in section 4.3 (dates that honour every date the PCM gives and make the sequence possible) | PCM dates conflict ("31 September", DI validation before submission, MG durations past 30 Oct) | Dates are cycle settings (type defaults, editable per cycle) |
| A3 | DI mobilisation counts **21 days from contract award**; the kick-off happens inside that window (PCM p.12 policy; the p.6 flowchart note says "after kick-off") | Owner | One milestone template value (N0) |
| A4 | MG mobilisation stays **14 calendar days from kick-off** (PCM p.38 states it explicitly; no conflict inside MG) | PCM | Same template value |
| A5 | MG **counterpart funds**: States must release counterpart funds to access the grant (confirmed in press reports; ratio unconfirmed, so no ratio is encoded). The BEAP records the declared counterpart amount and evidence; UBEC may approve the BEAP without it, but an MG project cannot be **activated** until its BEAP's counterpart evidence is recorded | Owner: "you decide" | Type setting `requireCounterpartEvidenceBeforeActivation` (default on) |
| A6 | Scoring: two fixed dimensions Impact 60 / Ease of Implementation 40 (PCM), five sub-criteria each, scale 1–5 with descriptors, equal sub-weights (assumed; not in the PCM) | Flow analysis §13–15 | Rubric is type config, frozen per cycle when it opens |
| A7 | DI **validation** = desk review plus a site verification for every proposal; MG field verification likewise | PCM p.15 "independently verifying", p.40 "physical assessment" | Type setting `requireSiteVerification` |
| A8 | DI keeps a **Design** stage (full needs assessment with drawings, BoQ, preliminary cost due 30 Sept, after the July validation of the need); MG drafts must be complete at upload (no Design stage) | Makes the PCM DI dates consistent; MG calendar has no room for a second round | Stage list is type config |
| A9 | UBEC **Executive Management** decisions (DI management review, MG BEAP approval) are clicked by one accountable user (ES or delegate) with the meeting minutes attached | No platform users for a collective body | Approval steps are configurable |
| A10 | The ES both chairs the DI Steering Committee and approves the portfolio (PCM p.16–17). Kept, with a management review step between them and the ES's own scores visible | PCM | Flag to UBEC as a separation-of-duties weakness |

## 4. The process

### 4.1 Direct Intervention (process owner: Director Physical Planning)

P = platform · O→P = outside, result recorded or uploaded · O = outside only

| # | Stage (code) | Who | What | Where |
| :--- | :--- | :--- | :--- | :--- |
| 0 | Cycle open | Director Physical Planning | Year, deadlines, template and costing standard versions, rubric, indicative ceiling | P |
| 1 | Identification (`IDENTIFICATION`) | Procurement officers upload; Physical Planning curates | Draft needs assessments: need, sites, facilities breakdown, justification. Sources: carried-forward proposals, monitoring findings, field visits, requests. Stakeholder engagement summary uploaded to the cycle | P (assessment work O) |
| 2 | Validation (`VALIDATION`) | **M&E Department** | Desk review + site verification (web evidence in N4, field app in N8); outcome per proposal; **Validated Project List** generated | P |
| 3 | Design (`DESIGN`) | Procurement upload | Full needs assessment: drawings, BoQ, preliminary cost (template v2) | O→P |
| 4 | Costing (`COSTING`) | Physical Planning (QS) | Costed version against costing standards; variance flags; **Cost Estimate Report** generated | O→P (Excel) |
| 5 | Prioritisation (`PRIORITISATION`) | **Steering Committee** (chair ES; Physical Planning, Procurement, Finance) | Conflict declarations, independent scoring, ranking, funding line, overrides with reasons; **Prioritised Project Portfolio** generated | P (meeting O, minutes O→P) |
| 6 | Approval (`APPROVAL`) | Procurement submits; management review; **ES approves** | One decision on the list, exclusions with reasons, signed memo | P |
| 7 | Funding (`FUNDING`) | Finance & Accounts | Records the budget submission to the Ministry (O→P), then imports the **appropriated schedule**: appropriated proposals **convert to draft projects**; the rest are "Not funded, carried forward" | O→P |
| 8 | Procurement plan | Procurement; Director Procurement signs; ES approves | Lots and batches assigned to the converted drafts on the platform; approved plan uploaded | P + O→P |
| 9 | Procurement → award | Procurement, Bid Evaluation Committee, Tender Board/BPP/FEC | Bidding outside; award, contractor, contract sum and contract recorded in project setup | O→P |
| 10+ | Kick-off → mobilisation (21 days from award) → supervision, M&E → CoC → handover → DLP → closure | | Existing platform | P |

### 4.2 Matching Grants (owned by the SUBEB; UBEC gatekeeps)

| # | Stage | Who | What | Where |
| :--- | :--- | :--- | :--- | :--- |
| 0 | Cycle open (circular) | **SUBEB** Director Physical Planning | State cycle opened inside UBEC's template; circular uploaded | P |
| 1 | Identification | SUBEB Procurement uploads | Complete needs assessments (A8): school/community requests, LGA plans, SUBEB field observations | P (assessment O) |
| 2 | Validation ("Field verification") | SUBEB Physical Planning | Site verification; validated project needs | P |
| 3 | Costing | SUBEB Physical Planning (finance and technical) | Costed version, UBEC guidelines | O→P |
| 4 | Prioritisation | **SUBEB Steering Committee** | Same mechanism as DI | P |
| 5 | Approval | SUBEB Management reviews → **SUBEB Executive Chairman endorses** | Decision on the list | P |
| 6 | Funding ("BEAP") | SUBEB Physical Planning drafts and submits; **UBEC Physical Planning** reviews (desk, site visits, distribution); SUBEB revises; **UBEC Executive Management approves** | BEAP built from the approved proposals, with lots, procurement method, timelines, counterpart funding; on approval the proposals **convert to draft projects** owned by the SUBEB | P |
| 7 | Procurement → award | SUBEB Procurement, Bid Evaluation Committee (appointed by the Executive Chairman), Tender Board | Outside; award recorded | O→P |
| 8+ | Kick-off (programme of works) → mobilisation (14 days from kick-off) → supervision, M&E → SUBEB issues CoC → handover → post-closure evaluation → audit | | Existing platform; activation also needs the counterpart evidence (A5) | P |

### 4.3 Default calendar (A2)

The cycle for intervention year Y runs in Y − 1. Dates are deadlines ("by"); each is a type default (month, day) copied into the cycle when it opens and editable there.

| Stage | DI deadline | MG deadline | PCM |
| :--- | :--- | :--- | :--- |
| Cycle open | 1 March | 31 July (circular) | MG p.34 |
| Identification closes | 30 May (stakeholder engagement summary by 30 June) | 31 August | DI p.14–15 |
| Validation | 31 July | 30 September | DI p.15; MG "31 Sept" read as 30 Sept |
| Design | 30 September | – | DI "31 Sept" read as 30 Sept |
| Costing | 14 October | 14 October | 2 weeks |
| Prioritisation | 21 October | 21 October | 1 week |
| Approval | 31 October (ES) | 27 October (management), 30 October (Chairman) | DI p.8, MG p.35 |
| Funding | Budget submission 15 December; appropriation date unknown (recorded when it happens) | BEAP submitted 15 November; UBEC review 22 November; revision 5 working days; approval 30 November | MG p.35–36 |
| Procurement plan | 6 weeks after appropriation | Inside the BEAP | DI p.20–21 |

## 5. Decisions

| ID | Decision |
| :--- | :--- |
| D-N.1 | **Separate records.** A proposed project (`NeedsProposal`) is not a `Project`. It becomes one only at the funding gate (DI appropriation, MG BEAP approval). Reason: directory, KPIs, alerts and visibility all assume a project is funded work; unfunded drafts would pollute them. |
| D-N.2 | **Stage and status are separate** (Pega guidance: ≤10 statuses). Stages are type config (section 6.2); statuses are fixed: `DRAFT`, `IN_PROGRESS`, `RETURNED`, `CONVERTED`, `NOT_VALIDATED`, `NOT_SELECTED`, `WITHDRAWN`, `MERGED`. Labels combine them ("Pending costing", "Returned for correction", "Not funded, carried forward"). |
| D-N.3 | **Versions are never overwritten.** A new needs assessment version is required only when content changes (upload, correction, costing, BEAP revision). Validation, scoring and approval are **decision records**, not new files. |
| D-N.4 | **Batch decisions with per-item outcomes.** Validation, costing sign-off, prioritisation, approval and funding act on a selection; each item gets its own outcome and reason; one evidence file can cover the batch. Bulk actions offer only what is valid for every selected item. |
| D-N.5 | **Cycle documents live once on the cycle** (preliminary needs report, stakeholder engagement summary, Validated Project List, Cost Estimate Report, Prioritised Project Portfolio, approval memo, appropriated schedule, BEAP) and are linked to each proposal they cover. Generated ones are produced by the platform (xlsx + PDF, UBEC styling) from the records; a signed copy can be uploaded beside it. |
| D-N.6 | **One needs assessment template family.** Template v2 (`INSITE-NEEDS-v2`) adds the facilities breakdown and costing sheets and drops the Sprints sheet (work phases are set after award). The in-project scope workbook keeps v1 with Sprints. Parsers share column readers. |
| D-N.7 | **Facilities breakdown rows are one facility × one site.** "Number of sites" is derived by grouping. At conversion each row becomes a `FacilityUnit` on its `ProjectSite`, and the costed BoQ lines tagged with the row's unit ID become `BoqItem`s. Nothing is re-typed. |
| D-N.8 | **Costing standards are a versioned rate library** maintained on the platform (Excel round trip). A version referenced by a costed needs assessment is never edited (save = new version), like the form library. The template carries the version it was built from; costing compares each rate to it. |
| D-N.9 | **Separation of duties is enforced on the server** (section 7). Where a SUBEB lacks people, the person blocked asks for an override with a reason and **another person** holding `needs:override_separation` authorises or refuses it (owner decision 2026-11-26: a second person's authorisation, never one's own); the override is flagged on the proposal and in the ledger (compensating control). |
| D-N.10 | **Scoring follows grant-panel practice:** rubric frozen when the cycle opens; conflict declarations when the committee is formed; independent scores; divergence flagged (≥ 2 points on one sub-criterion), never silently averaged; the committee's decision is the funding line and the items either side of it; overrides need a reason. Ties: higher Impact, then lower cost. |
| D-N.11 | **Approvals run on the existing approval-chain engine**: new chain types `NEEDS_PORTFOLIO`, `BEAP`, `OUT_OF_CYCLE`; steps per type with organisation scope (`orgContext` from the cycle's owning organisation). |
| D-N.12 | **The approved list becomes an output.** The funding gate writes the `ApprovedList` (DI: the appropriated schedule; MG: the approved BEAP) with one row per proposal, linked to the new project; `budgetMismatch` and the Overview link card keep working. Manual approved-list upload stays for past years (`approved_lists:manage`). |
| D-N.13 | **Project origin.** New `Project.origin`: `NEEDS_PIPELINE`, `OUT_OF_CYCLE`, `REGISTER_IMPORT`, `LEGACY` (every project that exists when the migration runs). Activation requires origin ≠ none: a manual "Start without one" draft no longer exists. Portfolio and exports show an "Outside annual cycle" chip for `OUT_OF_CYCLE`. |
| D-N.14 | **Out-of-cycle route** replaces "Start without one": reason category (`EMERGENCY`, `PRESIDENTIAL_DIRECTIVE`, `SUPPLEMENTARY_BUDGET`, `OTHER_FUNDING_SOURCE`, `CARRY_OVER_APPROPRIATED`), authorising document required, `OUT_OF_CYCLE` chain (DI: ES; MG: Executive Chairman then UBEC), needs assessment upload optional but encouraged; on approval it converts like any proposal. The register import stays for onboarding ongoing projects (admin only, origin `REGISTER_IMPORT`). |
| D-N.15 | **Codes.** A proposal has a reference `<year>-DI-<nnn>` or `<year>-MG-<state>-<nnn>`, shown everywhere. A converted DI draft keeps that reference as its code until Procurement assigns a lot (then `LOT n BATCH m`, existing `lotChoice` on a draft without a lot). An MG draft gets its lot and batch from the BEAP at conversion. |
| D-N.16 | **Duplicate detection** on every new version: same school (normalised name + LGA) or a site within 100 m of another open proposal, or of a project site created in the last 3 years (type setting). A flag, never a block; the validator resolves it (not a duplicate / merge / not validated). |
| D-N.17 | **Essential facilities rule** (PCM p.7, p.35): each school site must show, for each group, a proposed row or an existing row in condition Functional. Default groups: Toilets {`TOILET`}, Water {`BOREHOLE`, `OVERHEAD_TANK`}, Solar {`SOLAR_POWER`}. A gap is a warning that needs a written justification before validation can pass. |
| D-N.18 | **Supervision and monitoring cost** (PCM p.8): the costing sheet has a required "Supervision and monitoring" line at the standard's percentage; a costed version without it fails validation of the file. |
| D-N.19 | **Carry forward.** When a cycle opens, proposals of the previous cycle with status `NOT_SELECTED` (below the line, excluded at approval, not funded) are offered for carry-forward; a carried proposal starts at Validation (the need is re-confirmed after a year) with its versions linked. |
| D-N.20 | **Mobile verification is a later slice (N8).** Until then validation evidence is uploaded on the web (report, photos). N8 adds verification visits in the field app (geotagged, per site, per breakdown row). |
| D-N.21 | **No AI.** Every check here is a deterministic rule (decision Z). |
| D-N.22 | **DI mobilisation from award** (A3): template `contractor-mobilised` anchor `CONTRACT_AWARD` + 21 days; `mobilisation-documents` anchor `CONTRACT_AWARD` + 21; a planned kick-off later than award + 14 days warns in the kick-off planner (notice ≥ 7 days before, pack within 7 days of contract: PCM p.11). MG unchanged. |
| D-N.23 | **Cycle approval chains get their own tables** (`NeedsApprovalStep`, `NeedsApprovalAction`, keyed on `cycleId`): `ApprovalStep.projectId` and `ApprovalAction.projectId` are required and a cycle has no project. They reuse the pure functions of `approvalChain.ts`; steps are copied from `needsPipeline.approvalChains` when the cycle opens. |
| D-N.24 | **No web notifications for the pipeline** (`WebNotification.projectId` is required). Work reaches people through the computed task queue ("Waiting for me", nav badge) and email. Revisit if notification-centre entries are wanted. |
| D-N.25 | **Pipeline people are in the normal seed** (`seedUbecRoster.ts`): the scenario tests need a distinct person per stage. `es@`, `dpp@`, `finance@` move from the demo overlay into the normal seed; the overlay reuses them. |

## 6. Model

### 6.1 Records

```
NeedsCycle (tenant, project type, intervention year, State for MG, owning organisation, status DRAFT|OPEN|CLOSED,
            deadlines, rubric snapshot, template version, costing standard version, indicative ceiling)
 ├─ CycleDocument (kind, generated|uploaded, file versions, covers → proposals)
 ├─ CommitteeMember (user, role CHAIR|MEMBER, conflict declaration, recusals)
 ├─ StageDecision (stage, decided by, outcome per proposal, evidence, reason)        ← batch decisions
 ├─ PortfolioSubmission / BeapSubmission (approval-chain subject; items; memo; counterpart for BEAP)
 └─ NeedsProposal (reference, title, stage, status, State/LGA, current version, latest amounts, flags,
                   carriedFromId, mergedIntoId, projectId once converted)
     ├─ NeedsAssessmentVersion (n, source UPLOAD|CORRECTION|COSTING|BEAP_REVISION, file, sha256,
     │                          template version, costing standard version, parsedJson, totals)
     ├─ ProposalSite (current version: site no., school, level, LGA, GPS, enrolment)
     ├─ FacilityBreakdownRow (current version; section 6.3)
     ├─ ValidationRecord (outcome, desk notes, site verification evidence, duplicate resolutions)
     ├─ ScoreSheet (member, sub-criterion scores, comment)                         ← one per member
     ├─ ProposalDocument (drawings, photos, site reports; versions)
     └─ ProposalFlag (DUPLICATE | ESSENTIAL_FACILITY_GAP | RATE_VARIANCE | CEILING_EXCEEDED | SEPARATION_OVERRIDE …)
CostingStandard (version, rates by item code and zone factor, supervision and monitoring %, contingency %, ceilings,
                 design standard documents)
Project.origin, Project.needsProposalId
```

The current version's sites and breakdown rows are tables (for filters, duplicate checks, totals and conversion); every version keeps its full parse in `parsedJson`. Audit: proposal and cycle events go on the tenant ledger (`projectId` null, `cycleId`/`proposalId` in the payload; the audit log already allows a null project); conversion writes the first entry of the project's ledger with the proposal's history reference.

### 6.2 Stages (type config `needsPipeline.stages`)

| Code | DI label / actor permission | MG label / actor permission | Gate needs |
| :--- | :--- | :--- | :--- |
| `IDENTIFICATION` | Identification / `needs:submit` | Identification / `needs:submit` | Template minimum fields for the stage; submit |
| `VALIDATION` | Validation / `needs:validate` | Field verification / `needs:validate` | Validation record; site verification (A7); duplicate and essential-facility flags resolved |
| `DESIGN` | Needs assessment completion / `needs:submit` | – (not used, A8) | Version with BoQ, drawings, preliminary cost |
| `COSTING` | Costing / `needs:cost` | Costing / `needs:cost` | Costed version; rate and ceiling flags acknowledged; S&M line |
| `PRIORITISATION` | Prioritisation / `needs:chair_committee` | Prioritisation / `needs:chair_committee` | Every non-recused member scored (or chair closes with quorum ≥ 3); line set |
| `APPROVAL` | Approval / chain `NEEDS_PORTFOLIO` (Procurement submits, management review, ES) | State approval / chain `NEEDS_PORTFOLIO` (SUBEB management, Executive Chairman) | Chain complete; memo |
| `FUNDING` | Budget and appropriation / `needs:record_funding` | BEAP / chain `BEAP` (SUBEB submits, UBEC PP reviews, UBEC EM approves) | Appropriated schedule matched / BEAP approved → convert |

Statuses are D-N.2. "Returned" sends a proposal back to the stage's submitter with a reason; resubmission returns it to the same stage.

### 6.3 Facilities breakdown row (from the owner's table)

| Field | Type | Notes |
| :--- | :--- | :--- |
| Facility | facility code (tenant catalogue) | Retired facilities refused on new versions |
| Intervention action | `NEW_CONSTRUCTION`, `RENOVATION`, `EXPANSION`, `FURNISHING`, `EQUIPPING`, `REPLACEMENT` | |
| Existing quantity | number ≥ 0 | |
| Existing condition | `FUNCTIONAL`, `PARTLY_FUNCTIONAL`, `DILAPIDATED`, `NON_FUNCTIONAL`, `ABSENT` | `ABSENT` requires existing quantity 0 |
| Required quantity | number ≥ 0 | Assessed need |
| Proposed quantity | number > 0 | Under this project; may be below required (shortfall shown) |
| Unit of measure | `UNITS_OF_MEASURE` | |
| Site | site no. (Sites sheet) | One row per facility per site; "Number of sites" derived |
| Unit ID | text, unique per proposal | Ties BoQ lines; becomes the `FacilityUnit` unit ID |
| Preliminary cost | ₦, computed from BoQ lines when present, else entered | |
| Technical justification | text, required | |
| Priority / criticality | `ESSENTIAL`, `HIGH`, `MEDIUM`, `OPTIONAL` | Shown to the committee as context |
| Supporting evidence | text references (photo, site report, drawing, BoQ ref) + linked proposal documents | |

### 6.4 Template v2 sheets

Instructions (version stamp, costing standard version, rules) · Project (title, programme, year, State, justification, assumptions, beneficiaries, estimated duration in months) · Sites · **Facilities breakdown** · **BoQ** (lines by unit ID, item code from the costing standard, quantity, rate (standard rate pre-filled, editable), amount formula) · **Costing summary** (subtotal, supervision and monitoring %, contingency %, total; locked formulas) · Rates (protected copy of the standard's rates) · Lists (hidden). Required fields per stage come from the type config (`needsPipeline.minimumFields`), so a DI identification draft may leave BoQ empty and a DI design version may not.

## 7. Separation of duties (server rules, `shared/src/utils/needsSeparation.ts`, pure)

| Rule | Error |
| :--- | :--- |
| The uploader of any version of a proposal cannot validate it | 409 `SAME_PERSON_VALIDATION` |
| The validator cannot cost it | 409 `SAME_PERSON_COSTING` |
| A committee member is recused from proposals they uploaded, validated or costed, and from those named in their conflict declaration (recusal recorded) | – (excluded from scoring) |
| An approval-chain step cannot be decided by the person who submitted the list, nor twice by one person in one chain | 409 `SAME_PERSON_APPROVAL` |
| UBEC BEAP review steps need an organisation outside the State's SUBEB subtree (organisation scope) | 403 |
| Funding import (appropriation) cannot be confirmed by the person who approved the portfolio | 409 `SAME_PERSON_FUNDING` |
| Override (D-N.9): the blocked person asks with a reason; another holder of `needs:override_separation` authorises (flag `SEPARATION_OVERRIDE`, resolution `AUTHORISED` / `REFUSED`) | – |

Other legitimacy controls: activation gate (D-N.13), frozen versions (a changed scope or cost after a gate opens a new version and returns the proposal to the earliest affected stage: scope → Validation, cost → Costing), duplicate and site checks (D-N.16, N8 geotags), committee record (declarations, scores, overrides, minutes), hash-chained ledger, contract sum vs approved amount (existing `budgetMismatch`).

## 8. Permissions and roles

New catalogue category **"Needs assessment & funding"** (first, before Portfolio & projects), plus one key in Portfolio & projects:

`needs:view`, `needs:manage_cycle`, `needs:submit`, `needs:validate`, `needs:cost`, `needs:score`, `needs:chair_committee`, `needs:submit_portfolio`, `needs:review_portfolio`, `needs:approve_portfolio`, `needs:record_funding`, `needs:prepare_beap`, `needs:review_beap`, `needs:approve_beap`, `needs:approve_out_of_cycle`, `needs:override_separation`, `standards:manage`, `procurement:plan_lots`.

Visibility: a cycle belongs to an owning organisation (DI: UBEC HQ; MG: the State's SUBEB); users see cycles in their organisation subtree, and UBEC users with `needs:review_beap` see MG cycles once a BEAP is submitted. Committee membership is per cycle (`needs:score` is eligibility).

Seed roles (tailored in `seedUbecRoster.ts` and the overlay until the role migration):

| Role | Code | Grants |
| :--- | :--- | :--- |
| Procurement Officer (UBEC) | `PROCUREMENT_OFFICER` (new) | view, submit, submit_portfolio, `procurement:plan_lots`, score |
| Quantity Surveyor (UBEC Physical Planning) | `QUANTITY_SURVEYOR` (new) | view, cost, `standards:manage` |
| Director, Physical Planning | `DIRECTOR_PHYSICAL_PLANNING` | view, manage_cycle, review_portfolio, review_beap, score, `standards:manage` |
| UBEC M&E Officer | `UBEC_ME_OFFICER` | view, validate |
| Finance Officer | `FINANCE_OFFICER` | view, record_funding, score |
| Executive Secretary | `EXECUTIVE_SECRETARY` | view, chair_committee, score, approve_portfolio, approve_beap, approve_out_of_cycle |
| SUBEB Director, Physical Planning | `SUBEB_DIRECTOR_PHYSICAL_PLANNING` (new) | view, manage_cycle, validate, cost, prepare_beap, score |
| SUBEB Procurement Officer | `SUBEB_PROCUREMENT_OFFICER` (new) | view, submit, submit_portfolio, score |
| SUBEB Executive Chairman | `ORGANIZATION_ADMIN` (existing) | view, chair_committee, review_portfolio, approve_portfolio, approve_out_of_cycle, override_separation |
| System Administrator | `TENANT_SUPER_ADMIN` | all |

New logins: `procurement@`, `qs@`, `kano.dpp@`, `kano.procurement@` (`ubec.test`).

## 9. Screens

| Screen | Content |
| :--- | :--- |
| **Needs assessment** `/app/needs-assessment` | Cycle picker (year, programme, State) and a deadline strip (stage dates, today, overdue). Tabs: **Proposed projects** (StandardTable: reference, title, State/LGA, sites, facilities summary, preliminary/costed cost, stage, status, score and rank, flags, next actor; filters incl. "Waiting for me", default when the user has tasks; batch action bar), **Prioritisation**, **Approvals** (portfolio, BEAP, out-of-cycle), **Cycle documents**, **Approved lists** (the current E3 table, moved), **Procurement plan** (DI, converted drafts → lots). "Upload needs assessments" (multi-file: per-file preview with row, column, reason; valid files commit, invalid ones stay listed with a downloadable error list). Nav badge with the user's task count. |
| **Proposed project** `/app/needs-assessment/proposals/:id` | Stage bar + **task list** (GOV.UK pattern: active-verb tasks with status tags, e.g. "Resolve possible duplicate", "Upload drawings", "Record site verification"). Tabs: Summary · Sites (map) · **Intervention & facilities** (the breakdown, grouped by facility with site sub-rows, shortfall and essential-facility checks) · BoQ & costing (rate variance against the standard) · Versions (timeline; changes in cost, quantities, sites) · Validation · Scores · Documents · History |
| **Committee workspace** | Member: proposals to score, rubric with descriptors per score, progress. Chair: ranked table, divergence flags, cumulative cost against the indicative ceiling with the funding line, overrides with reasons, finalise |
| **Approval review** | Count, total, distribution by zone/State/LGA (MG: senatorial district once the data exists, section 13), exclusions with reasons, memo upload, decision |
| **BEAP workspace** (MG) | Build from approved proposals: lot, procurement method and timeline per proposal, narrative upload, counterpart amount and evidence; submit; UBEC review per proposal (accept / comment / request removal) and return; revision; approval |
| **Funding** (DI) | Record budget submission (date, acknowledgement); import appropriated schedule (preview: matched, partly funded, not funded, unknown rows → refused unless an approved out-of-cycle proposal); confirm converts |
| **Standards** `/app/standards` (Platform nav) | Costing standards (versions, rates, zone factors, S&M %, contingency, ceilings; Excel template and upload) · Design standards (standard drawings and specifications, essential facility groups) · Monitoring standards (read-only render of the visit form templates and facility sub-forms). Read: any web user; edit: `standards:manage` |
| **Portfolio → Pipeline** tab | Proposals at Approval/Funding and converted drafts not yet live, with stage and amount |
| **Project** | Overview "Origin" card (reference, approved and funded amounts, link to the proposal, versions); Documents shows the proposal and cycle documents read-only under "Needs assessment"; Sprints & scope gets a **Facilities** tab (breakdown fields per unit beside live progress) |
| **New project** button | "New proposed project" (opens the upload in the open cycle) and "Out-of-cycle project" |

## 10. Mobile (N8)

`NeedsVerification` (proposal, site, assigned officer, due date, status) with its own feed `GET /api/v1/needs-verifications/mine`; a fixed verification form (new form library template kind `NEEDS_VERIFICATION`: per site GPS and photos; per breakdown row: existing quantity and condition confirmed, photo); submitted through the outbox (kind `NEEDS_VERIFICATION_SUBMISSION`, waits on captures); accepted submissions fill the validation record and correct site coordinates. Mobile accounts get access by assignment (not by project session). Used by DI M&E, MG SUBEB Physical Planning and UBEC BEAP site visits.

## 11. What changes in existing features

| Feature | Change |
| :--- | :--- |
| Needs assessment page (E3 approved lists) | Becomes the pipeline; lists move to the "Approved lists" tab and are written by the funding gate (D-N.12) |
| New project → Upload needs assessment (D1, `/projects/from-needs-assessment`) | Replaced by the pipeline upload; endpoints removed in N7 once conversion reuses `createProjectDraftInTx` and the scope-import internals |
| "Start without one" | Out-of-cycle route (D-N.14) |
| Lot and batch at creation | DI: assigned at the procurement plan; MG: from the BEAP; `lotChoice` on a draft without a lot already exists |
| `allowedInterventionYears` | Not applied to conversion (the year comes from the cycle) |
| Register import | Admin only, origin `REGISTER_IMPORT` |
| Activation | Origin required (D-N.13); MG also counterpart evidence (A5) |
| DI contract milestones | Mobilisation from award (D-N.22) |

## 12. Slices

**Execution is by wave; the work orders are in `saas_updates/needs_pipeline/`:**

| Wave | File | Slices | Ends with |
| :--- | :--- | :--- | :--- |
| 1 | `wave1_contracts.md` | N0 + N1 (main thread only) | Contracts, one migration, seed people, scenario tests as `todo`; full gate |
| 2 | `wave2_upload_standards.md` | N2 + N3 (3 agents) | Upload, breakdown, standards; full gate |
| 3 | `wave3_validation_costing_scoring.md` | N4 + N5 + N7a (4 agents + main) | Validation to ranking; conversion core; full gate |
| 4 | `wave4_approval_funding_conversion.md` | N6 + N7b–e (3 agents, then main) | Both suites green; old D1 flow removed between two full gates |
| 5 | `wave5_field_seed_docs.md` | N8 + N9 | Field verification, seed, demo, docs; final gate |

**Ticking:** each wave file lists its items with a "Verified by" column and one of three states: `TODO`, `BUILT (owed WT-…/PT-…)` (code typechecks; a click-through or device check is owed in the testing checklists), `VERIFIED` (the named test passes in a recorded gate). Only VERIFIED counts as done. `server/src/tests/routes.needs.scenarios.test.ts` walks DI and MG from upload to a live project; its steps start as `todo` and each wave turns its own green, so it is the progress bar. The checklists below are the scope summary; tick them only when the wave file's rows are VERIFIED.

Gate = typecheck, lint, web build, server unit + route tests, mobile tests, seed. Full gate at the end of every wave (background, docs written meanwhile); affected test files only inside a wave.

### N0: DI mobilisation from award (independent, small)
- [x] `seedPhase13` DI templates (D-N.22); kick-off planner warning; seed projects' snapshots updated without a version bump (seed only). _Wave 1; the notice on the kick-off tab is owed a click-through (WEB-NP1-02)_
- [x] Tests: milestone dates for a DI project; MG unchanged

### N1: Contracts and model
- [x] Shared: `needsPipeline.schema.ts` (cycle, proposal, version, site, breakdown row, stage config, statuses, decisions, rubric, flags, DTOs), `costingStandard.schema.ts`; pure utils `needsStages.ts` (allowed actions per stage/status/permissions, next stage, return targets), `needsSeparation.ts`, `needsScoring.ts` (normalise, weight, divergence, rank, ties, funding line), `facilityBreakdown.ts` (essential groups, shortfall, totals), `proposalReference.ts`
- [x] Type config key `needsPipeline` (stages, deadlines, rubric, minimum fields, essential groups, tolerances, duplicate window, counterpart gate, verification required) + group entry + editor tab "Needs assessment". _The tab is a read-only summary, owed a click-through (WEB-NP1-01); editing is wave 2_
- [x] Permission catalogue (section 8), audit actions, cycle chain tables (D-N.23); no notification categories (D-N.24)
- [x] Prisma models + migration `<ts>_needs_pipeline` (additive; `Project.origin` default backfilled `LEGACY`). _Two migrations (enum values first); applied to a scratch database, not yet to the dev database (16.2)_
- [x] Unit tests for every pure util

### N2: Costing standards and Standards page
- [ ] `CostingStandard` versions, Excel template/upload (preview → confirm), lock on use; design standard documents; essential groups shown
- [ ] Monitoring standards read-only render from the form library
- [ ] Web `/app/standards`, nav entry; route tests

### N3: Cycle, template v2, upload, proposal page (Identification)
- [ ] Cycle open/close, deadlines, circular and cycle documents, carry-forward offer (D-N.19)
- [ ] Template v2 builder and parser (D-N.6), pre-filled rates; multi-file upload preview/confirm; versions; sites and breakdown tables; duplicate and essential-facility flags
- [ ] Proposal documents (presign kind `NEEDS_DOCUMENT`, keys under the cycle)
- [ ] Web: Needs assessment page (Proposed projects tab, upload dialog), proposal page with Intervention & facilities tab
- [ ] **Full gate**

### N4: Validation, design, costing
- [ ] Stage decisions (batch, per-item outcomes, return/resubmit), validation records with web evidence, duplicate resolution
- [ ] Costing: costed version, rate variance and ceiling flags, acknowledgements; generated Validated Project List and Cost Estimate Report
- [ ] Separation rules enforced; "Waiting for me"; job `needs-deadlines` (one `JobRun` per cycle-day: reminders 7 days before, overdue notices)

### N5: Prioritisation
- [ ] Committee formation, conflict declarations, recusals; score sheets; divergence; chair ranking, line, overrides; generated Prioritised Project Portfolio; minutes upload
- [ ] Web committee workspace
- [ ] **Full gate**

### N6: Approval and out-of-cycle
- [ ] `NEEDS_PORTFOLIO` chain (type-configured steps, organisation scope from the cycle), exclusions, memo; `OUT_OF_CYCLE` chain and route; New project button
- [ ] Web approval review

### N7: Funding, conversion, BEAP, project integration
- [ ] DI: budget submission record; appropriated schedule import (approved-list workbook with proposal reference column) → conversion
- [ ] MG: BEAP build, submit, UBEC review, revision, approval → conversion; counterpart evidence; activation gate
- [ ] `convertProposalToProject` (one transaction: draft with type applied and parties derived, sites, units from breakdown rows, BoQ lines, budget = funded amount, origin, approved-list row, documents linked, ledger entry)
- [ ] DI procurement plan tab (lots on converted drafts); Portfolio Pipeline tab; project Origin card, Facilities tab, Documents link
- [ ] Remove `/projects/from-needs-assessment` and the D1 web flow; register import admin-only
- [ ] **Full gate**

### N8: Field app verification
- [ ] Section 10; physical checks added to `physical_testing_checklist.md`

### N9: Seed, demo, docs
- [ ] Seed: one DI cycle (2027) with ~12 proposals across every stage and status (incl. a duplicate, an essential-facility gap, a rate variance, a returned one, a below-line one), committee with scores and one divergence; one MG cycle (Kano) with a BEAP in UBEC review; one out-of-cycle request; the overlay's projects get origin `NEEDS_PIPELINE` with proposals for their history
- [ ] Demo pack: template v2 files (single and a batch of five, one with errors)
- [ ] Demo script, `CLAUDE.md`, `configuration_reference.md`, `web_testing_checklist.md`
- [ ] **Full gate**

Parallel work (CLAUDE.md step 4): after N1 is built, server (services, routes, tests), web and docs run as separate agents per slice; Prisma, migrations and seed stay in the main thread.

## 13. Out of scope (recorded for later)

- Senatorial districts (MG BEAP review checks distribution across them, PCM p.35): needs an LGA → senatorial district dataset from a verified source; the distribution view uses zone/State/LGA until then.
- Budget preparation inside the platform (collation, consolidation, Ministry submission): recorded only.
- Procurement (bidding, evaluation, Tender Board): outside, award recorded as today.
- KPIs for the needs assessment process (PCM: data completeness > 90 %, validated > 80 %, complaints < 10 %): add to the KPI catalogue later.
- A complaints channel for prioritisation outcomes.
- Public publication of the procurement plan.

## 14. Risks

| Risk | Mitigation |
| :--- | :--- |
| Size: larger than R4 | Slices ship independently; N0 and N2 are standalone; N8 can slip without blocking validation |
| Demo answers change stages or actors | Stages, actors, deadlines, rubric and gates are type config; assumptions in section 3 say what changes |
| Two people needed per stage in small SUBEBs | Override with reason (D-N.9), visible to UBEC in the BEAP review |
| The ES chairs and approves (A10) | Management review step; ES scores visible; raise with UBEC |
| Removing D1 breaks the current demo script | D1 removal is last in N7; the demo script is rewritten in N9 |
| Excel variety from the field | Template v2 is the only accepted layout; per-file errors with row, column and reason; previous v1 files import at Identification only (no breakdown) |

## 15. Verification

| Gate | Typecheck | Lint | Web build | Server unit | Server routes | Mobile | Seed |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Baseline (pre-demo round record: unit 262, routes 443, mobile 169; rerun 2026-11-26 on the tree with the design round) | ✓ | 0 errors (52 warnings) | ✓ | 262/262 | 454/454 | 169/169 | not rerun |
| Wave 1 (N0 + N1), 2026-11-26 | ✓ | 0 errors (52 warnings) | ✓ | **310/310** (262 + 47 in `needs.n1.test.ts` + 1 in `visits.r4.test.ts`) | **470/470 pass, 25 todo** of 495 (454 + 16 in `routes.needs.n1.test.ts` + the 25 todo scenario steps) | 169/169 | normal ✓, overlay ✓, normal ✓, overlay ✓ (scratch database `insite_needs_w1`); schema diff against it empty |
| N3 | | | | | | | |
| N5 | | | | | | | |
| N7 | | | | | | | |
| N9 | | | | | | | |

## 16. Found during implementation

### 16.1 Minister demo answers (2026-11-27)

**State on 2026-11-26 (wave 1):** this table was empty and the demo had not taken place, so wave 1 was built on the section 3 assumptions, as `wave1_contracts.md` section 0 directs. Each assumption is a type setting, a seed value or a permission grant, so an answer that differs is a change to the place named below, not to the contracts. **Before wave 2:** replace each "no answer" with the answer and apply the change it names.

| # | Answer | Where it lives (change here if the answer differs) |
| :--- | :--- | :--- |
| A1 | _No answer recorded when wave 1 ran (2026-11-26)._ Assumption kept | Grant of `needs:submit`: `NEEDS_PIPELINE_GRANTS` in `seedUbecRoster.ts` (Procurement Officer, SUBEB Procurement Officer) |
| A2 | _No answer recorded when wave 1 ran (2026-11-26)._ Assumption kept | `cycleOpens`, `stages[].deadline`, `extraDeadlines`, chain step `deadline` in `needsPipelineDefaults.ts`; copied to each cycle, editable there |
| A3 | _No answer recorded when wave 1 ran (2026-11-26)._ Assumption kept | `seedPhase13.ts` DI templates `contractor-mobilised` and `mobilisation-documents` (anchor `CONTRACT_AWARD`, 21 days); `KICKOFF_AFTER_AWARD_WINDOW_DAYS` (14) |
| A4 | _No answer recorded when wave 1 ran (2026-11-26)._ Assumption kept | `seedPhase13.ts` MG templates (anchor `KICKOFF`, 14 days), unchanged |
| A5 | _No answer recorded when wave 1 ran (2026-11-26)._ Assumption kept | `requireCounterpartEvidenceBeforeActivation` (MG true, DI false); the gate itself is wave 4 |
| A6 | _No answer recorded when wave 1 ran (2026-11-26)._ Assumption kept | `DEFAULT_NEEDS_RUBRIC` (60 / 40, five sub-criteria each, descriptors 1–5, threshold 2, quorum 3) |
| A7 | _No answer recorded when wave 1 ran (2026-11-26)._ Assumption kept | `requireSiteVerification` (true for both) |
| A8 | _No answer recorded when wave 1 ran (2026-11-26)._ Assumption kept | `stages` (DI has `DESIGN`, MG does not) and `minimumFields` |
| A9 | _No answer recorded when wave 1 ran (2026-11-26)._ Assumption kept | `approvalChains` steps (one accountable user per step) |
| A10 | _No answer recorded when wave 1 ran (2026-11-26)._ Assumption kept | DI `NEEDS_PORTFOLIO` chain (management review, then ES approval); the ES holds `needs:chair_committee`, `needs:score` and `needs:approve_portfolio`. Still to raise with UBEC as a separation-of-duties weakness |

### 16.2 Owner decisions after wave 1 (2026-11-26)

| # | Decision | Where it lands |
| :--- | :--- | :--- |
| O-1 | A separation-of-duties override is **a second person's authorisation**: the blocked person asks with a reason, another holder of `needs:override_separation` authorises or refuses | Done in wave 1's contracts: `checkSeparation(action, actor, history, authorisation)`, `authorisationProblem`, `NeedsSeparationActionEnum`, `SeparationOverrideRequestSchema`, `SeparationOverrideDecisionRequestSchema`, resolutions `AUTHORISED` / `REFUSED`; the request field on stage decisions is gone. Wave 3 builds the routes (A1) |
| O-2 | The extra SUBEB people a committee needs are represented by **one umbrella role** (in reality they are several roles: M&E, Finance, other directorates) | Wave 3, main thread: role `SUBEB_COMMITTEE_MEMBER` (`needs:view`, `needs:score`) held by **three** Kano logins, and `needs:score` for the SUBEB Administrator (Chairman). Three logins, not one: each score sheet is one person and the quorum counts people |
| O-3 | The demo shows the highlights of the pipeline, not the whole of it; the full click-through runs once, when every wave is done | No per-wave click-through; owed checks collect in `web_testing_checklist.md` |

### 16.3 Wave 1 (2026-11-26)

Decisions, deviations and open points are in `needs_pipeline/wave1_contracts.md` section 5. The ones later waves must know:

- **Two migrations**, not one: PostgreSQL cannot use a new enum value in the transaction that adds it, so the enum values come first.
- **`NeedsProposal` has no `projectId` column:** the one-to-one is `Project.needsProposalId`.
- **`Project.origin` is nullable** (null = no origin); projects created by the seed have no origin yet. Wave 4 sets it in the seed before it adds the activation gate.
- **Cycle chains have their own enum** (`NeedsChainTypeEnum`), not `ApprovalChainTypeEnum`; the chain engine's pure functions take any step with the fields they read (`ChainStepLike`).
- **N0 changed one visit plan rule.** With mobilisation due 21 days from award, less than one two-week interval can be left after the kick-off, and no mobilisation check was proposed before the due date. `EVERY_N_WEEKS_UNTIL_MOBILISED` now proposes one check on the due date in that case (wave 1 section 5, item 25).
- **Breakdown rows:** one row per facility, intervention action and site; proposed quantity 0 records an existing facility without work (so D-N.17 can be met).
- **Matching Grants roster:** settled by the owner after wave 1 (16.2, O-1 and O-2).
- **Dev database:** wave 1 ran its migrations and seeds on a scratch database (`insite_needs_w1`); that evening, on the owner's word, the dev database was backed up, migrated and reseeded with the demo overlay (wave 1 section 5, item 2).

## 17. Contract names

Written by wave 1 (2026-11-26). Wins over the wave files where they differ. Everything in 17.1–17.3 is exported from `@insite/shared`. "Wave N settles" marks shapes a later wave may extend; names do not change.

### 17.1 Shared schemas (`shared/src/schemas/needsPipeline.schema.ts`)

| Kind | Names |
| :--- | :--- |
| Stage and status | `NeedsStageEnum` (`IDENTIFICATION`, `VALIDATION`, `DESIGN`, `COSTING`, `PRIORITISATION`, `APPROVAL`, `FUNDING`), `NEEDS_STAGE_ORDER`, `NEEDS_STAGE_LABELS`, `NEEDS_REQUIRED_STAGES` (all but `DESIGN`); `NeedsProposalStatusEnum` (`DRAFT`, `IN_PROGRESS`, `RETURNED`, `CONVERTED`, `NOT_VALIDATED`, `NOT_SELECTED`, `WITHDRAWN`, `MERGED`), `NEEDS_OPEN_PROPOSAL_STATUSES`; `NeedsCycleStatusEnum` (`DRAFT`, `OPEN`, `CLOSED`) |
| Versions and routes | `NeedsVersionSourceEnum` (`UPLOAD`, `CORRECTION`, `COSTING`, `BEAP_REVISION`, `CARRY_FORWARD`) + `NEEDS_VERSION_SOURCE_LABELS`; `NeedsProposalRouteEnum` (`ANNUAL`, `OUT_OF_CYCLE`); `OutOfCycleReasonEnum` + `OUT_OF_CYCLE_REASON_LABELS`; `NEEDS_TEMPLATE_VERSION` = `INSITE-NEEDS-v2` |
| Breakdown | `InterventionActionEnum` + `INTERVENTION_ACTION_LABELS`; `ExistingConditionEnum` + `EXISTING_CONDITION_LABELS`; `FacilityCriticalityEnum` + `FACILITY_CRITICALITY_LABELS` |
| Flags and decisions | `ProposalFlagKindEnum` (`DUPLICATE`, `ESSENTIAL_FACILITY_GAP`, `RATE_VARIANCE`, `CEILING_EXCEEDED`, `MISSING_SUPERVISION_LINE`, `SEPARATION_OVERRIDE`) + `PROPOSAL_FLAG_KIND_META` (label, `blocksStage`); `ProposalFlagResolutionEnum` (`NOT_A_DUPLICATE`, `MERGED`, `NOT_VALIDATED`, `JUSTIFIED`, `ACKNOWLEDGED`, `CORRECTED`, and `AUTHORISED` / `REFUSED` for a separation override request; wave 3 settles per kind); `StageOutcomeEnum` (`ADVANCE`, `RETURN`, `NOT_VALIDATED`, `NOT_SELECTED`); `SiteVerificationMethodEnum` (`WEB_EVIDENCE`, `FIELD_APP`) |
| Submissions and chains | `NeedsSubmissionKindEnum` (`PORTFOLIO`, `BEAP`, `OUT_OF_CYCLE`); `NeedsChainTypeEnum` (`NEEDS_PORTFOLIO`, `BEAP`, `OUT_OF_CYCLE`: its own enum, **not** part of `ApprovalChainTypeEnum`); `NEEDS_CHAIN_FOR_SUBMISSION`; `NeedsSubmissionStatusEnum` (`DRAFT`, `IN_REVIEW`, `RETURNED`, `APPROVED`; wave 4 settles) |
| Documents | `CycleDocumentKindEnum` (14 kinds) + `CYCLE_DOCUMENT_KIND_META` (label, `generated`); `ProposalDocumentKindEnum` (`DRAWING`, `SPECIFICATION`, `PHOTO`, `SITE_REPORT`, `SITE_VERIFICATION_EVIDENCE`, `AUTHORISING_DOCUMENT`, `OTHER`) + `PROPOSAL_DOCUMENT_KIND_LABELS` |
| Project origin | `ProjectOriginEnum` (`NEEDS_PIPELINE`, `OUT_OF_CYCLE`, `REGISTER_IMPORT`, `LEGACY`) + `PROJECT_ORIGIN_LABELS`. `Project.origin` null = no origin |
| Committee | `CommitteeRoleEnum` (`CHAIR`, `MEMBER`), `ScoreDimensionEnum` (`IMPACT`, `EASE`), `RecusalReasonEnum` (`UPLOADED`, `VALIDATED`, `COSTED`, `DECLARED_CONFLICT`) |
| Rows | `ProposalSiteSchema` (site no., school, level, LGA, address, GPS, enrolment); `FacilityBreakdownRowSchema` (plan 6.3; `unitId`, `siteNumber`, `facilityCode`, …); `NeedsBoqLineSchema` (`wbsCode`, `unitId`, `itemCode`, `description`, `unit`, `totalQuantity`, `rateNgn`, `amountNgn`: the scope line names); `CostingSummarySchema`; `ParsedNeedsProjectSchema`; **`ParsedNeedsAssessmentSchema`** (`templateVersion`, `costingStandardVersion`, `project`, `sites`, `breakdownRows`, `boqLines`, `costingSummary`); `NeedsFileIssueSchema` (sheet, row, column, reason); limits `NEEDS_SITES_MAX` 50, `NEEDS_BREAKDOWN_ROWS_MAX` 500, `NEEDS_BOQ_LINES_MAX` 5000 |
| Type config | `NeedsPipelineConfigSchema` (key `needsPipeline`; section 17.4), `needsPipelineConfigIssues`, `NeedsStageConfigSchema`, `NeedsExtraDeadlineSchema`, `MonthDaySchema`, `NeedsRubricSchema`, `RubricDimensionSchema`, `RubricCriterionSchema`, `RUBRIC_SCALE` 5, `RUBRIC_CRITERION_KEY_REGEX`, `EssentialFacilityGroupSchema`, `NeedsChainStepConfigSchema`, `NeedsApprovalChainsConfigSchema`, `NeedsFundingGateEnum` (`APPROPRIATION`, `BEAP_APPROVAL`), `NeedsReferencePrefixEnum` (`DI`, `MG`), `NeedsCycleScopeEnum` (`NATIONAL`, `STATE`), `NeedsTemplateFieldKeyEnum` (`NEED`, `JUSTIFICATION`, `SITES`, `BREAKDOWN`, `BOQ`, `DRAWINGS`, `PRELIMINARY_COST`) + `NEEDS_TEMPLATE_FIELD_LABELS` |
| DTOs | `NeedsCycleDto`, `NeedsCycleSummaryDto`, `NeedsCycleDocumentDto`, `NeedsDeadline` (+ `NeedsDeadlineStateEnum`: `NOT_SET`, `UPCOMING`, `DUE_SOON`, `DUE_TODAY`, `OVERDUE`), `NeedsProposalSummaryDto`, `NeedsProposalDetailDto`, `NeedsAssessmentVersionDto`, `ProposalFlagDto`, `NeedsValidationRecordDto` (+ `SiteVerificationSchema`), `NeedsProposalDocumentDto`, `NeedsProposalHistoryEntry`, `NeedsProposalTask`, `NeedsTaskDto` (task queue row), `ScoreSheetDto`, `CommitteeMemberDto`, `NeedsSubmissionDto`, `NeedsSubmissionItemDto`, `NeedsApprovalStepDto` (each with its `…Schema`) |
| Requests | `StageDecisionRequestSchema` (stage, batch reason, evidence ids, items `{ proposalId, outcome, reason }`), `SeparationOverrideRequestSchema` (`proposalId`, `action`, `reason`), `SeparationOverrideDecisionRequestSchema` (`decision` `AUTHORISED` \| `REFUSED`, `note`), `ScoreSheetSchema` (`proposalId`, `scores` criterion → 1–5, `comment`), `ConflictDeclarationRequestSchema` (`hasConflict`, `conflictedProposalIds`, `statement`); `NeedsProposalActionEnum` (the action codes of `allowedProposalActions`) |

`shared/src/schemas/costingStandard.schema.ts`: `CostingStandardRateSchema` (`itemCode`, `description`, `facilityCode`, `unitOfMeasure`, `rateNgn`), `CostingZoneFactorsSchema` + `DEFAULT_COSTING_ZONE_FACTORS`, `CostingCeilingSchema` (`facilityCode`, `interventionAction`, `maxNgnPerUnit`), `CostingStandardSchema` (`rates`, `zoneFactors`, `supervisionMonitoringPct`, `contingencyPct`, `ceilings`), `SaveCostingStandardRequestSchema`, `CostingStandardVersionDto`, `COSTING_ITEM_CODE_REGEX`, `COSTING_RATES_MAX`, helpers `costingZoneFactor`, `standardRateFor(standard, itemCode, zone)`.

`shared/src/data/needsPipelineDefaults.ts`: `DEFAULT_DI_NEEDS_PIPELINE`, `DEFAULT_MG_NEEDS_PIPELINE`, `DEFAULT_NEEDS_RUBRIC`, `DEFAULT_ESSENTIAL_FACILITY_GROUPS`.

### 17.2 Pure functions (`shared/src/utils`)

| File | Functions |
| :--- | :--- |
| `needsStages.ts` | `stagesFor(config)`, `stageConfigOf(config, stage)`, `nextStage(config, stage)`, `previousStage(config, stage)`, `returnTarget(config, stage)` → `{ correctionStage, actorPermissionKey, resubmitTo }` (the actor of the stage before corrects; the proposal comes back to the same stage), `reopenStageFor('SCOPE' \| 'COST')` → `VALIDATION` / `COSTING`, `allowedProposalActions({ stage, status }, config, permissionKeys)`, `proposalStatusLabel({ stage, status }, config)`, `minimumFieldsFor(config, stage)`, `missingMinimumFields(parsed, required, { drawingCount })`, `NEEDS_SUBMIT_PERMISSION_KEY` |
| `needsSeparation.ts` | `separationViolation(action, actorUserId, history)` (actions `VALIDATE`, `COST`, `APPROVE_STEP`, `CONFIRM_FUNDING`: `NeedsSeparationActionEnum`), `checkSeparation(action, actorUserId, history, authorisation \| null)` → `{ violation, allowed, overridden }` (16.2 O-1: the authorisation is another person's), `authorisationProblem(action, actor, authorisation)` → `WRONG_ACTION` / `WRONG_PERSON` / `SELF_AUTHORISED` / `NOT_AUTHORISER` / `NO_REASON` / null, type `SeparationAuthorisation`, `recusalsFor(memberUserId, proposals, declarations)`, `NEEDS_OVERRIDE_SEPARATION_PERMISSION_KEY` |
| `needsScoring.ts` | `proposalScore(sheets, rubric)` → `{ impact, ease, total }` on 0–100 (mean ÷ scale; Impact 4.5/5 and Ease 3/5 → 78), `criterionMeans`, `divergentCriteria(sheets, threshold)`, `rankProposals(items)` (total, then Impact, then lower cost, then reference), `fundingLine(ranked, ceilingNgn)` → `{ linePosition, totalAboveNgn, items }` |
| `facilityBreakdown.ts` | `validateBreakdownRows(rows, sites, facilities)` → `{ row, column, reason }[]`, `essentialFacilityGaps(rows, sites, groups)`, `breakdownTotals(rows)`, `groupBreakdownByFacility(rows)`, `breakdownShortfall(row)`, `FACILITY_BREAKDOWN_COLUMNS` (sheet headers), type `BreakdownRowDraft` |
| `needsCosting.ts` | `costingSummary(lines, standard, zone)` (adds `atStandardRatesNgn`), `rateVariances(lines, standard, zone, tolerancePct)`, `ceilingBreaches(rows, lines, standard)`, `breakdownRowCost(row, lines)`, `hasSupervisionLine(summary)` |
| `proposalReference.ts` | `formatProposalReference({ interventionYear, prefix, stateCode, sequence })`, `parseProposalReference(text)`, `PROPOSAL_REFERENCE_REGEX` |
| `needsDuplicates.ts` | `normaliseSchoolName(name)`, `findDuplicateMatches(site, candidates, radiusMeters)`; `distanceMeters(a, b)` added to `shared/src/geo/geofence.ts` |
| `needsCalendar.ts` | `cycleDeadlines(config, interventionYear)` (keys `cycle-opens`, `stage:<STAGE>`, `chain:<CHAIN>:<n>`, `extra:<key>`), `cycleDate`, `monthDayInYear`, `deadlineState(date, today)`, `NEEDS_DEADLINE_REMINDER_DAYS` 7 |
| `contractMilestones.ts` (N0) | `kickoffAfterAwardWindow({ templates, contractAwardDate, plannedKickoffDate })`, `KICKOFF_AFTER_AWARD_WINDOW_DAYS` 14; `contract.schema.ts`: `KickoffWarningCodeEnum` (`KICKOFF_AFTER_AWARD_WINDOW`), `KickoffWarningSchema`, `ProjectKickoffDto.warnings` |

Server, D-N.23: `ChainStepLike` and `ChainActionLike` in `server/src/modules/process/approvalChain.ts`. `stepApplies`, `nextApplicableStep`, `organizationScopeAllows`, `holdsStep`, `gateForStep` and `assertMayAct` accept `NeedsApprovalStep` / `NeedsApprovalAction` rows as they are; the org context is `{ owningOrganizationId: cycle.owningOrganizationId, ownerAncestorIds, funderOrganizationId: null }`.

### 17.3 Permissions, audit actions, error codes

Permission category `NEEDS_FUNDING` ("Needs assessment & funding", after Forms & facilities, before Portfolio & projects): `needs:view`, `needs:manage_cycle`, `needs:submit`, `needs:validate`, `needs:cost`, `needs:score`, `needs:chair_committee`, `needs:submit_portfolio`, `needs:review_portfolio`, `needs:approve_portfolio`, `needs:record_funding`, `needs:prepare_beap`, `needs:review_beap`, `needs:approve_beap`, `needs:approve_out_of_cycle`, `needs:override_separation`, `standards:manage`. In Portfolio & projects: `procurement:plan_lots`. All web.

Audit actions (shared `AuditActionTypeEnum` and Prisma `AuditActionType`): `NEEDS_CYCLE_OPENED`, `NEEDS_CYCLE_UPDATED`, `NEEDS_CYCLE_CLOSED`, `NEEDS_PROPOSAL_CREATED`, `NEEDS_VERSION_ADDED`, `NEEDS_PROPOSAL_SUBMITTED`, `NEEDS_PROPOSAL_RETURNED`, `NEEDS_PROPOSAL_WITHDRAWN`, `NEEDS_PROPOSAL_MERGED`, `NEEDS_FLAG_RESOLVED`, `NEEDS_STAGE_DECIDED`, `NEEDS_VALIDATION_RECORDED`, `NEEDS_COMMITTEE_UPDATED`, `NEEDS_CONFLICT_DECLARED`, `NEEDS_SCORE_SUBMITTED`, `NEEDS_RANKING_FINALISED`, `NEEDS_SUBMISSION_CREATED`, `NEEDS_APPROVAL_ACTION`, `NEEDS_FUNDING_RECORDED`, `NEEDS_PROPOSAL_CONVERTED`, `NEEDS_SEPARATION_OVERRIDDEN`, `COSTING_STANDARD_SAVED`, `PROJECT_CREATED_FROM_PROPOSAL`. Cycle and proposal events go on the tenant ledger (`projectId` null, `cycleId` / `proposalId` in the payload).

Error codes. Nothing throws them yet. The first row is in code (plan section 7); the rest are names proposed here so the agents of a wave agree with each other: a wave may rename one by amending this table first.

| Code | HTTP | Wave | When |
| :--- | :--- | :--- | :--- |
| `SAME_PERSON_VALIDATION`, `SAME_PERSON_COSTING`, `SAME_PERSON_APPROVAL`, `SAME_PERSON_FUNDING` | 409 | 3–4 | Plan section 7 (`NeedsSeparationErrorCodeEnum`, messages in `NEEDS_SEPARATION_ERROR_MESSAGES`) |
| `NEEDS_FILE_CHANGED` | 409 | 2 | Confirm with another sha256 than the preview (as `SCOPE_IMPORT_FILE_CHANGED`) |
| `NEEDS_FILE_INVALID` | 422 | 2 | A file with row issues is refused (row, column, reason) |
| `NEEDS_MINIMUM_FIELDS_MISSING` | 422 | 2–3 | The version lacks a field its stage requires |
| `NEEDS_CYCLE_NOT_OPEN`, `NEEDS_CYCLE_EXISTS` | 409 | 2 | Writes on a draft or closed cycle; a second cycle for the same type, year and scope |
| `NEEDS_STAGE_ACTION_NOT_ALLOWED` | 409 | 3 | An action `allowedProposalActions` does not offer |
| `NEEDS_FLAGS_UNRESOLVED` | 409 | 3 | A stage gate with open blocking flags |
| `NEEDS_QUORUM_NOT_MET`, `NEEDS_CONFLICT_NOT_DECLARED`, `NEEDS_MEMBER_RECUSED` | 409 | 3 | Prioritisation |
| `COSTING_STANDARD_LOCKED` | 409 | 2 | Editing a version in use |
| `PROJECT_ORIGIN_REQUIRED`, `COUNTERPART_EVIDENCE_REQUIRED` | 409 | 4 | Activation gates (D-N.13, A5) |
| `KICKOFF_AFTER_AWARD_WINDOW` | – | 1 | A warning code in `ProjectKickoffDto.warnings`, never an error |

### 17.4 Type config `needsPipeline` (`NeedsPipelineConfigSchema`)

`enabled` (default false), `fundingGate`, `referencePrefix`, `cycleScope`, `cycleOpens` `{ month, day }`, `stages[]` `{ stage, label, actorPermissionKey \| null, deadline \| null }`, `extraDeadlines[]` `{ key, label, stage, deadline }`, `minimumFields` `{ [stage]: NeedsTemplateFieldKey[] }`, `rubric` `{ scale 5, dimensions[], criteria[] { key, dimension, label, descriptors[5] }, divergenceThreshold 2, quorum 3 }`, `essentialFacilityGroups[]` `{ label, facilityCodes[] }`, `rateVarianceTolerancePct` 15, `duplicateRadiusMeters` 100, `duplicateLookbackYears` 3, `requireSiteVerification` true, `requireCounterpartEvidenceBeforeActivation` false, `approvalChains` `{ NEEDS_PORTFOLIO, BEAP, OUT_OF_CYCLE }` of `{ label, requiredPermissionKey, organizationScope, deadline \| null }`. An enabled pipeline must have the six required stages in process order, both rubric dimensions adding up to 100 with at least one criterion each, a portfolio and an out-of-cycle chain, and a BEAP chain when the gate is `BEAP_APPROVAL`. Editor group `needs` ("Needs assessment", first tab); the tab is read-only until wave 2.

Criterion keys of the default rubric: Impact `strategic_alignment`, `severity_of_need`, `beneficiary_reach`, `educational_benefit`, `equity`; Ease `site_readiness`, `technical_feasibility`, `design_scope_readiness`, `cost_funding_feasibility`, `delivery_complexity`.

### 17.5 Prisma models (migrations `20261228090000_needs_pipeline_enums`, `20261228090001_needs_pipeline`)

Enum-like columns are strings checked by the shared enums, except `Project.origin` (`ProjectOrigin`), `decision` (`ApprovalDecision`) and `organizationScope` (`ApprovalOrganizationScope`). "By" columns are `…ByUserId` + `…ByName` without a relation; committee members and approval actions relate to `User`.

| Model (table) | Key columns | Unique / notes |
| :--- | :--- | :--- |
| `NeedsCycle` (`needs_cycles`) | `tenantId`, `projectTypeId`, `interventionYear`, `stateCode?`, `scopeKey` (`NATIONAL` or the State code), `owningOrganizationId`, `status`, `configSnapshotJson`, `deadlinesJson`, `templateVersion`, `costingStandardVersionId?`, `indicativeCeilingNgn?`, `proposalSequence`, `fundingLinePosition?`, `rankingFinalisedAt/ByUserId/ByName`, `openedAt/By…`, `closedAt/By…` | unique (`tenantId`, `projectTypeId`, `interventionYear`, `scopeKey`) |
| `NeedsCycleDocument` (`needs_cycle_documents`) | `cycleId`, `kind`, `title`, `generated`, `objectKey`, `fileName`, `mimeType`, `byteSize`, `sha256`, `supersedesId?`, `coveredProposalIds[]`, `uploadedBy…` | |
| `NeedsProposal` (`needs_proposals`) | `tenantId`, `cycleId`, `reference`, `sequence`, `title`, `route`, `outOfCycleReason?`, `authorisingDocumentId?`, `stage`, `status`, `statusReason?`, `stateCode?`, `lgaCodes[]`, `currentVersionId?`, `preliminaryAmountNgn?`, `costedAmountNgn?`, `approvedAmountNgn?`, `fundedAmountNgn?`, `scoreImpact?`, `scoreEase?`, `scoreTotal?`, `rank?`, `aboveLine?`, `lineOverrideReason?`, `carriedFromId?`, `mergedIntoId?`, `createdBy…` | unique (`tenantId`, `reference`), (`cycleId`, `sequence`). **No `projectId` column:** the one-to-one is `Project.needsProposalId`, read as `proposal.project` |
| `NeedsAssessmentVersion` (`needs_assessment_versions`) | `proposalId`, `number`, `source`, file columns, `templateVersion`, `costingStandardVersionId?`, `parsedJson`, `siteCount`, `breakdownRowCount`, `boqLineCount`, `preliminaryCostNgn?`, `costedTotalNgn?`, `uploadedBy…`, `uploadedAt` | unique (`proposalId`, `number`) |
| `NeedsProposalSite` (`needs_proposal_sites`) | `proposalId`, `siteNumber`, `schoolName`, `schoolNameKey` (`normaliseSchoolName`), `schoolLevel`, `lgaCode`, `address?`, `latitude?`, `longitude?`, `enrolment?` | unique (`proposalId`, `siteNumber`); index (`lgaCode`, `schoolNameKey`). Current version only |
| `NeedsFacilityBreakdownRow` (`needs_facility_breakdown_rows`) | the plan 6.3 fields, `evidenceDocumentIds[]`, `sortOrder` | unique (`proposalId`, `unitId`). Current version only |
| `NeedsProposalDocument` (`needs_proposal_documents`) | `proposalId`, `kind`, `title`, file columns, `supersedesId?`, `uploadedBy…` | |
| `NeedsProposalFlag` (`needs_proposal_flags`) | `proposalId`, `kind`, `detailsJson`, `raisedOnVersionId?`, `raisedOnVersionNumber?`, `raisedAt`, `resolvedAt?`, `resolvedBy…`, `resolution?`, `resolutionReason?` | |
| `NeedsValidationRecord` (`needs_validation_records`) | `proposalId`, `versionId`, `outcome`, `deskNotes?`, `siteVerificationJson?`, `duplicateResolutionsJson`, `recordedBy…`, `recordedAt` | |
| `NeedsStageDecision` (`needs_stage_decisions`) + `NeedsStageDecisionItem` (`needs_stage_decision_items`) | decision: `cycleId`, `stage`, `reason?`, `evidenceDocumentIds[]`, `decidedBy…`, `decidedAt`; item: `decisionId`, `proposalId`, `outcome`, `reason?`, `toStage?`, `toStatus?` | item unique (`decisionId`, `proposalId`) |
| `NeedsCommitteeMember` (`needs_committee_members`) | `cycleId`, `userId` (relation), `role`, `conflictDeclaredAt?`, `conflictStatement?`, `conflictedProposalIds[]` | unique (`cycleId`, `userId`) |
| `NeedsScoreSheet` (`needs_score_sheets`) | `cycleId`, `proposalId`, `memberId`, `scoresJson`, `comment?`, `submittedAt` | unique (`proposalId`, `memberId`) |
| `NeedsSubmission` (`needs_submissions`) + `NeedsSubmissionItem` (`needs_submission_items`) | submission: `cycleId`, `kind`, `status`, `chainVersion`, `currentStepOrder?` (null = complete, 0 = not started or returned), `submittedBy…`, `submittedAt?`, `decidedAt?`, `memoDocumentId?`, `counterpartDeclaredNgn?`, `counterpartEvidenceDocumentId?`; item: `submissionId`, `proposalId`, `included`, `exclusionReason?`, `amountNgn?`, `lotTitle?`, `lotNumber?`, `batchNumber?`, `procurementMethod?`, `reviewOutcome?`, `reviewComment?` | item unique (`submissionId`, `proposalId`) |
| `NeedsApprovalStep` (`needs_approval_steps`) + `NeedsApprovalAction` (`needs_approval_actions`) | the `ApprovalStep` / `ApprovalAction` columns with `cycleId` for `projectId`; `chainType` a string; action `subjectId` = the submission | step unique (`cycleId`, `chainType`, `version`, `stepOrder`). An action restricts its step: delete actions before steps |
| `CostingStandardVersion` (`costing_standard_versions`) | `tenantId`, `version`, `ratesJson`, `zoneFactorsJson`, `supervisionMonitoringPct`, `contingencyPct`, `ceilingsJson`, `designStandardDocumentIds[]`, `note?`, `isLocked`, `savedBy…`, `savedAt` | unique (`tenantId`, `version`); a cycle or a version that refers to it restricts its deletion |
| `Project` | `origin ProjectOrigin?` (existing rows backfilled `LEGACY`; no database default), `needsProposalId?` (unique, SET NULL) | |

`NeedsVerification` (N8) is not in these migrations. No hand-written SQL beyond the backfill and the permission rows; nothing for regenerated migrations to keep.

### 17.6 Routes reserved for later waves

`/api/v1/needs/cycles`, `/api/v1/needs/proposals`, `/api/v1/needs/tasks`, `/api/v1/costing-standards`, `/api/v1/standards`. Wave 5: `/api/v1/needs-verifications/mine`. Web: `/app/needs-assessment` (existing page becomes the pipeline), `/app/needs-assessment/proposals/:id`, `/app/standards`. No pipeline route or page exists after wave 1.

### 17.7 Seed

Roles and logins (`server/src/db/seedUbecRoster.ts`: `NEEDS_PIPELINE_ROLES`, `NEEDS_PIPELINE_GRANTS`, `NEEDS_PIPELINE_PEOPLE`, `seedNeedsPipelinePeople`; emails `ES_EMAIL`, `DPP_EMAIL`, `FINANCE_EMAIL`, `PROCUREMENT_EMAIL`, `QS_EMAIL`, `KANO_DPP_EMAIL`, `KANO_PROCUREMENT_EMAIL`). Type rules: `server/src/db/seedNeedsPipeline.ts` (runs after `seedAlerts`, before the overlay; wave 5 adds the demo cycles there). Reset list: the needs tables are deleted first in `runSeed`.
