# Redesign R6: Web Shell (5-Step Setup, Navigation, Overview, Payments, Type Editor)

**Spec:** [client_flow_redesign.md](client_flow_redesign.md) sections 3, 9, 10.1, 10.2, 10.3, 11, 12 and 14 (R6).
**Branch:** `UBEC` (client-specific; decision P).
**Depends on:** R2 (done). R3 and R4 for the parts listed in section 12; slices that do not need them can start now (D-R6.1).
**Baseline:** measure at the start of R6a and record it in section 15 (R3 and R4 change the counts). Last recorded (R2d, 2026-11-24): typecheck clean, lint 0 errors (67 warnings), server 148 unit + 249 route, mobile 57, all passing.
**Status:** Implemented (R6a–R6f, 2026-11-24; section 15). Browser click-through owed (`web_testing_checklist.md`).
**Cross-plan contracts:** [redesign_contracts_r3_r7.md](redesign_contracts_r3_r7.md) settles the names and ownership shared by R3–R7. Where this plan differs, the register wins.

Each slice must leave typecheck, lint (0 errors), the web build, and the server and mobile suites green before the next one starts.

---

## 1. Goal

Make the web portal follow the client's project cycle instead of the platform's history of phases:

```
Tenant   Portfolio · Projects · Visit planner · KPIs · Lessons learned · Forms & facilities · Settings
Project  Overview · Kick-off & mobilisation · Sprints & scope · Visits & reports · Findings · Payments
         · Documents · Completion & handover · More ▸ (Audit ledger, Settings)
Setup    1 Project → 2 Contract → 3 Scope & sprints → 4 Team & visits → 5 Review   (+ Advanced, optional)
Overview Kick-off ─ Mobilisation ─ Construction ─ Completion ─ Closure  |  current sprint · next visit · next deadline
```

R6 owns the shell: the setup wizard, the sidebar, the merged project pages, the Overview, the payment record polish and the project type editor layout. It does not build the form library (R3), visits, planner, findings or sprint verification (R4), mobile (R5) or the role catalogue, seed and docs rewrite (R7). Where those pages do not exist yet, R6 leaves a reserved slot (D-R6.12).

---

## 2. Read first

1. `CLAUDE.md` (all; especially **Web**: `api/`, `queries/`, `mutations/` hooks own toasts, `hasPermission` gating, `StandardTable`, the step registry, `useGuardedNavigate`, demo defaults behind the demo flag; and the Phase 10–16 paragraphs for the pages being merged).
2. `saas_updates/client_flow_redesign.md` sections 3, 9, 10, 11, 12, 14.
3. `saas_updates/redesign_r2_implementation_plan.md` section 9 (web built in R2, click-through still owed) and `redesign_r1_implementation_plan.md` ("Found during implementation": public pages, banner and archive dialog text left for R6).
4. The R3 and R4 plans (`redesign_r3_implementation_plan.md`, `redesign_r4_implementation_plan.md`) for route names, permission keys and type config keys before starting R6b, R6c or R6e (section 12).
5. Current code:
   - Shell and routes: `web/src/App.tsx` (`AuthenticatedWorkspace`, `handleSelectProject` sub-route regex, header "Project settings" button), `web/src/components/AppShell.tsx` (flat `NavLink` list, `PROJECT_PAGE_NAMES`, `WORKSPACE_PAGE_NAMES`, `SHOW_RECENT_PROJECTS`), `web/src/lib/navigationGuard.tsx`.
   - Setup: `shared/src/schemas/projectSetup.schema.ts` (`PROJECT_SETUP_STEPS`, `ProjectSetupStepIdEnum`, `PROJECT_STEP_SAVE_SCHEMAS`, `ProjectSetupDtoSchema`), `server/src/modules/projects/projectSetup.service.ts` (`computeStepIssues`, `stepRequired`, `stepVisible`, `buildStepStatuses`, `STEP_SAVERS`, `markStepSaved`, `activateProject`, `listDraftProjects`), `web/src/pages/projects/setup/` (`ProjectSetupShell.tsx`, `setupContext.tsx` (`useRegisterStep`), `stepRegistry.ts`, `NewProjectPage.tsx`, `steps/*`).
   - Project pages: `pages/dashboard/PortfolioDashboardPage.tsx` (the project overview, despite its name), `pages/milestones/ProjectKickoffPage.tsx`, `ProjectMilestonesPage.tsx`, `pages/closeout/ProjectHandoverPage.tsx`, `RetentionDefectsPage.tsx`, `pages/closure/ProjectClosurePage.tsx`, `pages/payments/ProjectPaymentsPage.tsx`, `pages/audit/AuditLedgerPage.tsx`, `components/closeout/ProjectPhaseBanner.tsx`, `components/contracts/ContractOverviewCards.tsx`.
   - Type editor: `web/src/components/deliveryModels/ProjectTypesTab.tsx` and its editors; `shared/src/schemas/projectType.schema.ts` (`ProjectTypeConfigSchema`).
   - Settings: `web/src/pages/settings/SettingsPage.tsx` (tabs ACCESS … ACCOUNT).
   - Verification conventions: `saas_updates/ui_verification_and_design_plan.md` (`qa/` artifacts, finding format, Playwright MCP).

---

## 3. Decisions

Defaults below are the plan. Items marked **(confirm)** are reasonable defaults the owner may change; build the default unless told otherwise, and note it in section 15.

| ID | Decision |
| :--- | :--- |
| D-R6.1 | **Order.** R6a (setup), R6d (payments) and R6e (type editor) need only R2 and can run before R3/R4. R6b (navigation and merged pages) and R6c (Overview) run after R4's API and pages exist, as spec 14 says. If the owner wants the shell earlier, R6b/R6c ship with the reserved slots of D-R6.12 and R3/R4 switch them on. **(confirm)** |
| D-R6.2 | **Two levels in the setup registry.** Today's step ids become **sections** (the unit the server saves, validates and audits); five **wizard steps** group them. No change to the save endpoint (`PUT /projects/:id/setup/:stepId` keeps taking a section id), to `setupState` JSON or to audit payloads, so drafts in the database, the seed and existing route tests keep working. Shared: the current list is renamed `PROJECT_SETUP_SECTIONS` (each entry gains `stepId`); `PROJECT_SETUP_STEPS` becomes the wizard list (`id`, `title`, `route`, `order`, `sectionIds`, `settingsOnly`). `ProjectSetupStepIdEnum` is renamed `ProjectSetupSectionIdEnum`; a new `ProjectSetupWizardStepIdEnum` holds `project, contract, scope, team, review, advanced`. A unit test asserts every save schema key belongs to exactly one wizard step. |
| D-R6.3 | **Section → step mapping** (full table in section 4). Project: `basics`, `parties`, `site`. Contract: `contractor` (new, split from `parties`), `contract`, `facility` (retention). Scope & sprints: `scope`, `standards`. Team & visits: `team`, `reporting` (until R4 removes cadence; R4 adds its visit plan section here). Review: no section. Advanced (settings-only entry under a divider, also reachable from a draft): `process`. Nothing is deleted from the server: every field keeps its validation and activation check. |
| D-R6.4 | **Contractor becomes its own section `contractor`** (`ProjectContractorSectionSchema = { contractors: array max(1) }`), saved by the contractor half of today's `saveParties`. `ProjectPartiesStepSchema.contractors` becomes optional: omitted keeps the current contractor (today it defaults to `[]`, which removes it). Sending `contractors` through `parties` stays accepted for one release so the seed (`seedPhase11.ts`, `seedPhase16.ts`) and tests keep working; such a save also marks the `contractor` section saved (`markStepSaved`), otherwise seeded drafts would fail activation on `contractor:STEP_NOT_SAVED`. R7 moves the seed to the new section. `contractorIssues` and `CONTRACTOR_BUDGETS_EXCEED_PROJECT` move from `parties` to `contractor`. |
| D-R6.5 | **"Not saved" is still per section, the message names the step.** `STEP_NOT_SAVED` keeps firing per required section; its text becomes `Open step 2 "Contract" and save it.` On "Save and continue" the shell saves every dirty section of the step **and** every required section of the step that has never been saved (with its current values), so one click marks the step reviewed. No new endpoint. |
| D-R6.6 | **Setup DTO is additive.** `ProjectSetupDto.steps` keeps its shape (section statuses with `stepId` = section id) and gains `wizardSteps: [{ id, title, sectionIds, required, saved, complete, issueCount, warningCount }]`. Activation 422 issues keep `stepId` (section) and add `wizardStepId`. `listDraftProjects` counts required **wizard** steps. Renaming `steps` to `sections` is left for a later clean-up. **(confirm)** |
| D-R6.7 | **Contract step contents.** Contractor (organisation, contacts via `OrganizationInput`), contract reference, contract sum, award date, signed date, planned kick-off, the contractor's planned completion date, retention and defects liability (when the retention module is on), and the read-only milestone preview already on `ContractStep` (shows the acceptance letter due date: "acceptance" in spec 10.1 is the `acceptance-letter` milestone, not a new field). Trade category/code stay in the schema but are pre-filled ("Main contract" / `MAIN`) and shown collapsed; `allocatedBudgetNgn` and `plannedMobilizationDate` are hidden (contract sum and the mobilisation milestone replace them). New warning `PLANNED_COMPLETION_BEFORE_SPRINTS_END` on the `contract` section when the planned completion is earlier than the last sprint's end. **(confirm)** |
| D-R6.8 | **Project step contents.** Delivery model first (applying it pre-fills owner, funder, retention and reporting as today), then name, code, region, state/LGA, description, budget; **School** (the primary beneficiary, labelled with `useTerm()`; others listed below it); **Location** (`GeofenceEditor`, radial pin pre-filled with the workspace default radius; perimeter on request); **Organisations** (owner, monitor, funder; pre-filled by the type); tolerance and time zone under a collapsed "Location: advanced"; the R2c needs-assessment fields read-only. `NewProjectPage` keeps creating the draft from the basics fields, then opens `/setup/project`. |
| D-R6.9 | **Process (workflow template, switches, approval chains) leaves the wizard** for the settings-only **Advanced** entry. It is optional today and filled from the type's workflow template on apply, so drafts lose nothing. **(confirm)** |
| D-R6.10 | **Old step URLs redirect.** `/setup/<section>` and `/settings/<section>` redirect to the wizard step that holds the section, with `#section-<id>` so the page scrolls to it (`basics`, `parties`, `site` → `project`; `facility` → `contract`; `standards` → `scope`; `reporting` → `team`; `process` → `advanced`). Live projects open settings at `/settings/project`. |
| D-R6.11 | **Navigation is a declarative config** (`web/src/navigation/navItems.ts`: `key`, `label`, `icon`, `to(projectId)`, `anyOf` permissions, optional `module` gate (handover/retention), optional `enabled`), rendered by `AppShell` in two groups: **Workspace** and **Project** (with the selected project's code and a project switcher). "More ▸" is a disclosure (button with `aria-expanded`) holding Audit ledger and Settings. Header page names come from the same config, replacing `PROJECT_PAGE_NAMES` / `WORKSPACE_PAGE_NAMES`. The header "Project settings" button goes (More ▸ Settings replaces it). |
| D-R6.12 | **Reserved slots for R3/R4 pages.** `web/src/navigation/redesignModules.ts` exports compile-time booleans `{ forms, visits }` (not env flags, not the demo flag). Nav items, the Team & visits visit-plan slot, the Overview "Next visit" card and the type editor's Monitoring group read them. R3 flips `forms`, R4 flips `visits`, each in the slice that ships the page. While `visits` is false: "Visits & reports" points to today's `/inspections` page under the new label, "Findings" is hidden (the findings board stays on `/inspections`), "Visit planner" is hidden, the Overview shows no "Next visit" card. **(confirm)** |
| D-R6.13 | **Tenant navigation order:** Portfolio (landing) · **Projects** · Visit planner · KPIs · Lessons learned · Forms & facilities · Settings. "Projects" (the directory with its Drafts tab and "+ New Project") is not in spec 10.2 but is the only way to drafts; it stays. **(confirm)** |
| D-R6.14 | **Project navigation follows spec 10.2 order exactly.** Labels as in the spec ("Sprints & scope" in the sidebar; the setup step keeps "Scope & sprints" as in spec 10.1). **(confirm: use one label everywhere)** |
| D-R6.15 | **Kick-off & mobilisation** is one page at `/kickoff` with tabs **Kick-off** (today's `ProjectKickoffPage` body, presented as a guided sequence: contract award and acceptance → notice → meeting held and minutes), **Milestones** (today's `ProjectMilestonesPage`: summary cards, milestone list, default cases), **Mobilisation** (`MobilisationCompliancePanel`, the contractor-on-site milestone, and R4's mobilisation check visits when `visits` is on). `/milestones` redirects to `/kickoff?tab=milestones`, keeping the query (`?case=` from notifications). `MobilisationCompliancePanel` leaves the Team step (it is already on the milestones page). |
| D-R6.16 | **Completion & handover** is one page at `/completion` with tabs **Certificate** (`CompletionSection`, today rendered on both the Handover and Closure pages), **Handover** (today's handover responses and snag conversion; tab shown when `enableHandoverModule`), **Defects** (the defect board from `RetentionDefectsPage`; shown when `enableRetentionModule`), **Closure** (`ClosureChecklistPanel`, `ContractorRatingsPanel`, `LessonsPanel`, `ClosurePackPanel`). Page visible to the union of today's permission sets (`CLOSURE_VIEW_PERMISSIONS`, handover permissions, `retention:manage_defects`); each tab keeps its own gate. `/handover`, `/retention` (keeps `?ticket=`) and `/closure` redirect to the matching tab. |
| D-R6.17 | **Retention summary moves to Payments.** The three retention cards on `RetentionDefectsPage` duplicate the Payments summary; they are deleted and the Payments page gains a "Release checks" panel (CoC issued, liability period end, open defects; all already in `ProjectPaymentsSummaryDto`). `GET /projects/:id/retention` stays (closure checklist and tests use it). |
| D-R6.18 | **Overview data comes from one new endpoint** `GET /api/v1/projects/:projectId/overview` (`ProjectOverviewDto`), so the page does not fan out to five permission-specific queries. Stage maths is a pure shared function `deriveProjectStage(facts)` in `shared/src/utils/projectStage.ts` with unit tests. Sources in section 6. The route stays `/dashboard` (label "Overview") to avoid touching every `navigate()` and notification link. **(confirm)** |
| D-R6.19 | **Stage rules** (section 6.1): Completion = `HANDOVER_IN_PROGRESS` (or a CoC drafted while still in construction); Closure = `RETENTION_PERIOD`, `COMPLETED_CLOSED` and archived, with a sub-label ("Defects liability period", "Closed", "Archived"). A later fact implies the earlier stages are done ("done, not recorded" when the earlier date is missing), so legacy projects without kick-off data show Construction correctly. **(confirm: retention period under Closure rather than Completion)** |
| D-R6.20 | **Phase actions move to the Overview.** `ProjectPhaseBanner`'s transition buttons and `PhaseChangeModal` move to the stage bar ("Start handover", "Start defects liability period", "Close the project"); the header keeps only a small stage chip. **(confirm)** |
| D-R6.21 | **Overview drops** the "Geofence & Capture Integrity" card (opacity screening, cadence, device signatures) and the "Latest Reported Capture" card; they describe the old evidence model. The map stays (pins from captures until R4 changes the source). `InspectionOverviewCard` stays until R4 replaces it with visit figures. |
| D-R6.22 | **Stage on lists.** The directory and the portfolio table show a stage chip, from a batched loader beside the existing `overdueMilestoneCounts` (no per-project queries). The project summary DTO moves from the hand-written `web/src/api/types.ts` to a shared Zod schema (`ProjectSummaryDtoSchema` in `shared/src/schemas/project.schema.ts`) as part of adding `stage` (contracts first). **(confirm)** |
| D-R6.23 | **Payment record polish** (what exists: `/payments` with summary cards, table, record and void dialogs, exception flags): add the **optional sprint** of spec 9 (`ProjectPayment.sprintId`, FK `ProjectSprint`, `onDelete: Restrict`; deleting a sprint a payment names is refused with the existing `SPRINT_IN_USE`), a paid-vs-contract-sum bar (page and Overview), filters (kind, exceptions only, sprint), the Release checks panel (D-R6.17), labels on the retention override inputs. No CSV export, no ERP UI. |
| D-R6.24 | **Type editor groups** (spec 10.3): tabs **Kick-off & mobilisation** (`ContractRulesEditor`, `DocumentRulesEditor`), **Monitoring** (R4's default visit plan, visit types and submission deadline; supervision site limit; until R4: `MonitoringRulesEditor` and reporting defaults), **Completion & closure** (`ClosureRulesEditor`, retention defaults), **KPI targets** (`KpiTargetsEditor`), **Advanced** (workflow template, ownership, parties, funder default; legacy reporting streams until R4 deletes them). General fields (name, code, colour, description, default, active) stay above the tabs. Shared `PROJECT_TYPE_CONFIG_GROUPS` maps every `ProjectTypeConfigSchema` key to one group; a unit test fails when a key has no group (enforces the `CLAUDE.md` rule "a new config key needs an editor section too"). Validation errors map to their tab and show a count on it. **(confirm: retention defaults under Completion & closure)** |
| D-R6.25 | **Forms & facilities page.** The tenant page `/app/forms` is R3's. If R3 has not created it when R6b starts, R6b creates the page frame with one tab, **Facilities** (`FacilitiesCard` moved out of Settings), and R3 adds its tabs. Settings → Facilities is removed either way; Settings → "Inspections & supervisors" is removed by R3/R4 when checklist templates and supervision move. |
| D-R6.26 | **Deleted pages and dead code** (section 5.3). Public pages are rewritten, not edited: `HomePage` becomes a short product page with sign-in, `MobileAppPage` describes account sign-in only, `AboutPage`, `CitationRef` and the lender/AI/join-code copy are deleted (`/about` redirects to `/`). **(confirm)** |
| D-R6.27 | **No new permissions in R6.** Every page keeps today's gates; R7 renames them with the role catalogue. |
| D-R6.28 | **Migrations:** one, `20261220090000_r6d_payment_sprint` (R6d). Further R6 migrations, if any, take the next numbers in the `202612200900xx` range. |

---

## 4. Setup: where every current step goes

### 4.1 Mapping

| Current step (section id) | Fields | New step | Change |
| :--- | :--- | :--- | :--- |
| Basics (`basics`) | project type, name, code, region, state, LGA, description, budget; read-only site address, strategic justification, assumptions | 1 Project | None to the data. Type picker first. |
| Parties (`parties`) | owner, monitor, funder, beneficiaries | 1 Project ("School" and "Organisations") | `contractors` optional, omitted keeps (D-R6.4). |
| Parties (`parties`.contractors) | contractor organisation, trade, allocated budget, planned mobilisation and completion | 2 Contract | New section `contractor` (D-R6.4, D-R6.7). |
| Site (`site`) | geofence; tolerance; time zone | 1 Project ("Location"; tolerance and zone collapsed) | None. |
| Contract and kick-off (`contract`) | reference, award, signed, sum, planned kick-off, change reason; milestone preview | 2 Contract | Warning `PLANNED_COMPLETION_BEFORE_SPRINTS_END`. |
| Retention (`facility`) | retention %, liability months, release at completion % | 2 Contract ("Retention and defects liability", module on only) | Section id stays `facility` (renaming would rewrite `setupState`). |
| Scope & sprints (`scope`) | sprints, units, lines, workbook | 3 Scope & sprints | None. |
| Standards and needs assessment (`standards`) | standards, needs-assessment documents, project workbook download | 3 Scope & sprints ("Needs assessment and standards") | Visibility and requiredness unchanged (process modes). |
| Reporting (`reporting`) | cadence, working day, streams | 4 Team & visits ("Reporting", until R4) | R4 deletes the section and adds the visit plan. |
| Team (`team`) | web and mobile users, `TeamWorkloadNotice` | 4 Team & visits | `MobilisationCompliancePanel` removed from the step (D-R6.15). |
| Workflow and process (`process`) | template, switches, chains | Advanced (settings-only) | D-R6.9. |
| Review | checklist, activate | 5 Review | Issues grouped by wizard step, each with a link to `#section-<id>`. |

Steps that disappear as pages: Basics, Parties, Site, Retention, Reporting, Standards, Process (their components become sections, see 4.3). No section disappears from the server.

### 4.2 Server changes (R6a)

| Item | Change |
| :--- | :--- |
| `shared/src/schemas/projectSetup.schema.ts` | `PROJECT_SETUP_SECTIONS` (today's list + `contractor`, each with `stepId`), `PROJECT_SETUP_STEPS` (wizard), `ProjectSetupSectionIdEnum`, `ProjectSetupWizardStepIdEnum`, `ProjectContractorSectionSchema`, `contractors` optional in `ProjectPartiesStepSchema`, `wizardSteps` on `ProjectSetupDtoSchema`, `wizardStepFor(sectionId)`. |
| `computeStepIssues` | New key `contractor` (contractor issues and budget warning move there); `PLANNED_COMPLETION_BEFORE_SPRINTS_END` warning on `contract`. |
| `stepRequired` | `contractor` required (as `parties` was for the contractor). Others unchanged. |
| `buildStepStatuses` | Unchanged output per section; `STEP_NOT_SAVED` message names the wizard step. New `buildWizardStepStatuses` aggregates (required = any visible required section; complete = all visible sections complete). |
| `STEP_SAVERS` | Add `contractor` (extracted from `saveParties`); `saveParties` skips the contractor sync when `contractors` is omitted. |
| `activateProject` | Issues gain `wizardStepId`. Validation unchanged (`ProjectActivationSchema` plus every section's issues). |
| `listDraftProjects` | `completedRequiredSteps` / `totalRequiredSteps` count wizard steps. |

### 4.3 Web changes (R6a)

| Item | Change |
| :--- | :--- |
| `setupContext.tsx` | `useRegisterStep` becomes `useRegisterSection(sectionId, dirty, save)`; the shell keeps a map of handles. Dirty = any section dirty; leave-guard save = save dirty sections in order, stop on the first failure and scroll to it. |
| `steps/*` | Move to `setup/sections/` as section components (no `StepSection` wrapper duplication); new step pages `ProjectStep`, `ContractStep` (rebuilt), `ScopeStep` (scope + standards), `TeamAndVisitsStep`, `ReviewStep`, `AdvancedStep` compose them. Each section renders with `id="section-<id>"`. |
| `stepRegistry.ts` | Maps wizard step ids to step pages; `findStep(route)` also resolves legacy section routes (D-R6.10). |
| `ProjectSetupShell.tsx` | Left list = 5 steps + "Advanced" under a divider; status icon per wizard step from `wizardSteps`; save logic per D-R6.5. |
| `NewProjectPage.tsx`, `ProjectsDirectoryPage.tsx`, `App.tsx` | Links to `/setup/project`, `/settings/project`. |
| `useProjectSetupMutations.ts` | Section ids; invalidation for `contractor` as for `parties`. |

---

## 5. Navigation and project pages

### 5.1 Tenant

| Entry | Route | Gate | Source |
| :--- | :--- | :--- | :--- |
| Portfolio (landing) | `/app/portfolio` | `projects:view_portfolio` | unchanged; stage chip (D-R6.22) |
| Projects | `/app/projects` | any | unchanged; stage chip |
| Visit planner | R4 route | R4 permission | R4; hidden while `visits` is false |
| KPIs | `/app/kpis` | `kpis:view` | unchanged (R4 trims KPIs) |
| Lessons learned | `/app/lessons` | `lessons:view` | unchanged |
| Forms & facilities | `/app/forms` | `facilities:manage` or R3's permission | D-R6.25 |
| Settings | `/app/settings` | any | Facilities tab removed (D-R6.25) |

### 5.2 Project

| Entry | Route | Gate (unchanged from today) | Built from |
| :--- | :--- | :--- | :--- |
| Overview | `/dashboard` | any project viewer | rebuilt (section 6) |
| Kick-off & mobilisation | `/kickoff` (`?tab=kickoff\|milestones\|mobilisation`) | `MILESTONE_VIEW_PERMISSIONS` | D-R6.15 |
| Sprints & scope | `/scope` | `boq:view` | `ProjectScopePage` (R4 adds verification) |
| Visits & reports | R4 route; `/inspections` while `visits` is false | R4 / `inspections:view`, `inspections:manage_findings` | D-R6.12 |
| Findings | R4 route | R4 | hidden while `visits` is false |
| Payments | `/payments` | `payments:view`, `payments:record` | polished (R6d) |
| Documents | `/documents` | `documents:view`, `documents:upload` | unchanged |
| Completion & handover | `/completion` (`?tab=certificate\|handover\|defects\|closure`) | union (D-R6.16) | D-R6.16 |
| More ▸ Audit ledger | `/audit` | `audit:view_ledger` | unchanged (Field reports tab stays until R4) |
| More ▸ Settings | `/settings/project` | `projects:edit_baseline` (read-only for others, as today) | setup shell |

Redirects (keep the query string): `/milestones` → `/kickoff?tab=milestones`; `/handover` → `/completion?tab=handover`; `/retention` → `/completion?tab=defects`; `/closure` → `/completion?tab=closure`; existing `/boq` and `/schedule` → `/scope` stay. Server `actionUrl`s are updated to the new routes in the same slice (4 × `/milestones`, 3 × `/closure`, 1 × `/handover`, 1 × `/retention?ticket=`); `/audit?tab=presence` (6) and `/inspections` (5) are R4's. `handleSelectProject` in `App.tsx` keeps the current sub-page when switching project; its regex becomes a lookup over the nav config.

### 5.3 Deleted or merged

| Item | Fate |
| :--- | :--- |
| `pages/milestones/ProjectMilestonesPage.tsx`, `ProjectKickoffPage.tsx` | Become tab components of `pages/kickoff/KickoffMobilisationPage.tsx`. |
| `pages/closeout/ProjectHandoverPage.tsx`, `RetentionDefectsPage.tsx`, `pages/closure/ProjectClosurePage.tsx` | Become tabs of `pages/completion/CompletionHandoverPage.tsx`; retention cards deleted (D-R6.17); `CompletionSection` rendered once. |
| `pages/dashboard/PortfolioDashboardPage.tsx` | Replaced by `pages/overview/ProjectOverviewPage.tsx` (the old name was misleading). |
| Overview cards "Geofence & Capture Integrity", "Latest Reported Capture" | Deleted (D-R6.21). |
| `ProjectPhaseBanner` actions | Move to the stage bar (D-R6.20); `ArchiveProjectDialog` text loses the IPC line. |
| Header "Project settings" button | Deleted (More ▸ Settings). |
| `AppShell` `SHOW_RECENT_PROJECTS` block, `App.tsx` `useProjectBoqQuery` (fetched, never used) | Deleted. |
| `pages/public/AboutPage.tsx`, `components/CitationRef.tsx`; lender/AI/join-code copy in `HomePage`, `MobileAppPage`, `PublicLayout` | D-R6.26. |
| Settings → Facilities tab | Moves to Forms & facilities (D-R6.25). |
| Not R6's to delete | `/inspections` page, Settings → Inspections & supervisors, `WorkdayReportsPanel`, `ReportingCadencePanel`, `InspectionOverviewCard` (R3/R4); `web/src/config/demoAccounts.ts` `lender@`/`lto@` (R7). |

---

## 6. Overview

### 6.1 Stage bar

`deriveProjectStage(facts) → { current, stages: [{ key, label, state: DONE | CURRENT | UPCOMING | NOT_TRACKED, enteredOn, note }], flags }`, `key` ∈ `KICKOFF, MOBILISATION, CONSTRUCTION, COMPLETION, CLOSURE`.

| Stage | Current when | Entered on | Source |
| :--- | :--- | :--- | :--- |
| Kick-off | ACTIVE, kick-off not held, nothing later true | activation date | `Project.activatedAt`, `kickoffHeldAt` |
| Mobilisation | kick-off held, contractor not on site | `kickoffHeldAt` | `ContractMilestone` with `completionMode = AUTO_CONTRACTOR_ON_SITE` (status, `completedAt`); R4 adds the last mobilisation check visit as a note |
| Construction | contractor on site (or no such milestone and kick-off held, or legacy), phase `ACTIVE_CONSTRUCTION` | on-site milestone `completedAt` | milestone, `constructionPhase` |
| Completion | `HANDOVER_IN_PROGRESS`, or a CoC drafted or issued while in construction | `constructionPhaseChangedAt` / CoC draft date | `constructionPhase`, `CompletionCertificate` (`issuedCertificateSummary`) |
| Closure | `RETENTION_PERIOD`, `COMPLETED_CLOSED`, ARCHIVED | phase change date / `archivedAt` | `constructionPhase`, `retentionEndDate`, `status` |

Rules: an untyped project with no milestones shows Kick-off and Mobilisation as `NOT_TRACKED`; a later true fact marks earlier stages `DONE` (note "not recorded" when the date is missing); flags `contractTerminated` (any `ProjectContractor.contractStatus = TERMINATED`, shown as a red note on the current stage) and `archived`. Labels go through terminology where a key exists. Drafts have no Overview.

### 6.2 Cards

| Card | Data | Gate | Empty state |
| :--- | :--- | :--- | :--- |
| Stage bar + phase actions | `stage`; transitions from the existing phase endpoint (`useProjectPhaseQuery`) | any viewer; actions as today (`canChangePhase`) | – |
| Current sprint | active sprint for today in the project zone (`deriveSprintStatus`), else next upcoming, else last ended: number of total, name, dates, deliverables (first line), facility units active (`unitsActiveInSprint`), status; R4 adds verification state | `boq:view` | "No sprints yet" + link to Sprints & scope |
| Next visit | R4: next planned visit (date, type, officers, confirmed or not) | R4 permission | hidden while `visits` is false |
| Next deadline | earliest open contract milestone by due date (`getProjectMilestones` derivation); R4 adds visit submission deadlines as candidates; overdue count | `MILESTONE_VIEW_PERMISSIONS` | "No open deadlines" |
| Budget and payments | budget, paid to date vs contract sum bar, retention held, exception count (`ProjectPaymentsSummaryDto`) | `payments:view`, `payments:record`; others see budget only | – |
| Progress | `certifiedProgressPct`, `ScheduleBadge` | any | – |
| Open default cases | `OpenDefaultCasesCard` | `DEFAULT_CASE_VIEW_PERMISSIONS` | hidden |
| Map | `LiveGeospatialMap` | any | – |
| Project KPIs | `ProjectKpisCard` | `kpis:view` | – |

`ProjectOverviewDto` (`shared/src/schemas/projectOverview.schema.ts`): `{ projectId, today, stage, currentSprint | null, nextVisit | null, visitsEnabled, nextDeadline | null, overdueMilestoneCount, openDefectCount | null }`. The server fills `nextVisit` through a stub `loadNextVisit(projectId)` returning null that R4 replaces. Sections the caller may not see are null, never zero.

---

## 7. Schema changes (Prisma)

| Change | Slice |
| :--- | :--- |
| `ProjectPayment.sprintId String? @db.Uuid` → `ProjectSprint` (`onDelete: Restrict`) + index `(projectId, sprintId)`; back-relation `payments` on `ProjectSprint`. Migration `20261220090000_r6d_payment_sprint`, generated with `prisma migrate diff`, reviewed by hand; keep every hand-written index listed in `CLAUDE.md`. | R6d |

No other schema change: setup sections, the Overview and the type editor need none.

---

## 8. Implementation checklist

### R6a: 5-step setup
- [ ] Shared: registry split, enums, contractor section schema, optional `contractors` on parties, `wizardSteps` DTO, `wizardStepFor` (D-R6.2–D-R6.6). Unit test `projectSetupRegistry.r6.test.ts`: every save schema key in exactly one wizard step; every wizard step id has a route; legacy routes resolve.
- [ ] Server per section 4.2; route tests: `contractor` section save, issues moved (`contractor:CONTRACTOR_REQUIRED`, `contractor:STEP_NOT_SAVED`), `parties` without `contractors` keeps the contractor, `parties` with `contractors` still works, `wizardSteps` aggregation, activation issues carry `wizardStepId`, `PLANNED_COMPLETION_BEFORE_SPRINTS_END`, draft list counts. Update `routes.phase6.test.ts` expectations. Add new files to the explicit lists in `server/package.json`.
- [ ] Web per section 4.3: five steps + Advanced, sections with anchors, composite save, legacy URL redirects, Review grouped by step with "Fix" links. `useGuardedNavigate` for every new `navigate()`; mutation hooks own toasts.
- [ ] A draft can be created and activated through the five steps only (route test drives the same section sequence the web sends).

### R6b: Navigation and merged pages (after R4, or with reserved slots per D-R6.1/D-R6.12)
- [ ] `web/src/navigation/navItems.ts`, `redesignModules.ts`; `AppShell` renders Workspace and Project groups, the project switcher, More ▸, header page names from the config; `aria-current="page"` on the active entry.
- [ ] Below `lg` the sidebar becomes an off-canvas drawer opened from a header menu button (focus moves into it, Escape closes, focus returns).
- [ ] `KickoffMobilisationPage` (D-R6.15) and `CompletionHandoverPage` (D-R6.16) with an accessible `components/common/Tabs.tsx` (tablist, arrow keys, tab in the URL).
- [ ] Redirects with query strings (section 5.2); server `actionUrl`s updated; route test that the notifications seeded and raised in tests point at existing routes (string check against the route list).
- [ ] Forms & facilities frame if R3 has not built it (D-R6.25); Settings → Facilities removed.
- [ ] Deletions in section 5.3 (except the Overview cards: R6c; public pages: R6f).

### R6c: Overview with stage bar
- [ ] Shared `projectStage.ts` + `ProjectOverviewDto`; unit tests for every row and rule of 6.1 (legacy project, terminated contractor, CoC drafted in construction, archived, untyped).
- [ ] Server `GET /projects/:id/overview` (`modules/projects/overview.service.ts`; facts loaded in one pass; permission filtering per 6.2; explicit serializer); route tests per role (null sections for callers without the permission), on seeded PRG-101 (kick-off planned), PRG-102 (mobilising), PRG-105 (construction, sprints, payment), PRG-104 (completion), PRG-103 (closure: liability period), PRG-242 (archived).
- [ ] Batched stage loader for the directory and portfolio (D-R6.22); move the project summary DTO to shared.
- [ ] Web `ProjectOverviewPage`: stage bar (ordered list, `aria-current="step"`, text state on every stage, not colour only), phase actions (D-R6.20), cards per 6.2, removal of the old page and cards; stage chip in directory and portfolio.

### R6d: Payment record polish
- [ ] Prisma `sprintId` + migration; shared `RecordPaymentRequestSchema.sprintId`, `PaymentDto.sprint`; server validates the sprint with `loadSprintInProject`, audits it in `PAYMENT_RECORDED`; scope service refuses deleting a sprint a payment names (`SPRINT_IN_USE`).
- [ ] Web: sprint picker in the record dialog, sprint column, filters, paid-vs-contract-sum bar, Release checks panel, labelled override inputs.
- [ ] Tests: record with a sprint of another project → 404 `SPRINT_NOT_FOUND`; sprint deletion refused; DTO carries the sprint.

### R6e: Project type editor regrouped
- [ ] Shared `PROJECT_TYPE_CONFIG_GROUPS` + unit test (every config key in exactly one group).
- [ ] `ProjectTypesTab` editor: General block, then tabs per D-R6.24 with error counts; unsaved-changes guard (`useLeaveGuard`) while editing; "Save new version" unchanged. R4's editors slot into Monitoring when `visits` is on.

### R6f: Clean-up, click-through, accessibility
- [ ] Public pages rewrite (D-R6.26).
- [ ] Browser click-through (section 10) and accessibility/responsive check (section 11); findings in `qa/findings/web.md`, fixed or listed here.
- [ ] Docs: `CLAUDE.md` (**Web** paragraph: two-level setup registry, nav config, merged pages, Overview endpoint; Phase 13/15 paragraphs' route names); route and label fixes in `demo_script_programme_delivery.md` and `configuration_reference.md` so they stay correct (their rewrite is R7); this file's section 15.

---

## 9. API summary

| Method and path | Permission | Notes |
| :--- | :--- | :--- |
| `PUT /projects/:id/setup/contractor` | as other setup sections (`projects:create` on drafts, `projects:edit_baseline` live) | new section; body `{ contractors }` |
| `PUT /projects/:id/setup/parties` | unchanged | `contractors` optional, omitted keeps |
| `GET /projects/:id/setup` | unchanged | adds `wizardSteps` |
| `GET /projects/:id/overview` | any principal passing `guardProjectRoutes` (web users) | sections filtered by permission; `nextVisit` from R4 |
| `POST /projects/:id/payments` | `payments:record` | optional `sprintId` (same project) |
| `GET /projects`, `GET /projects/portfolio/overview` | unchanged | rows gain `stage` |

Route files stay thin; services own transactions and audit; responses through explicit serializers.

---

## 10. Browser click-through checklist

Owed since Phase 5 for the web, never done for R2. Run in R6f with Playwright MCP against the owner's running dev servers (`http://localhost:5173`, freshly seeded; do not start, stop or re-seed), following `ui_verification_and_design_plan.md` (finding format, `qa/findings/web.md`, screenshots `qa/screenshots/web/<role>/<area>__<state>.png`, saved flows `qa/flows/web/*.spec.ts`). Logins `Password123!`.

| # | Role (login) | Check |
| :--- | :--- | :--- |
| C1 | `programme.admin@` | Sidebar shows the Workspace and Project groups in spec order; More ▸ opens and closes by keyboard; switching project keeps the sub-page. |
| C2 | `programme.admin@` | New project → Project step: Central type pre-fills owner/funder; school, map pin with the workspace default radius; save and continue. |
| C3 | same | Contract step: contractor, sum, dates; acceptance milestone date shows; planned completion before the last sprint shows the warning after step 3. |
| C4 | same | Scope & sprints: download blank and project workbook, import with a deliberate row error (preview shows it, confirm refused), fix and confirm; hand-edit a unit and a line. |
| C5 | same | Team & visits: add an officer over the site limit → workload warning; visit plan slot (R4) or Reporting section. |
| C6 | same | Review: issues grouped by step, "Fix" jumps to the section; activate; lands on Overview. |
| C7 | same | Old URLs `/setup/basics`, `/settings/facility`, `/milestones?case=…`, `/retention?ticket=…`, `/closure` land on the right step/tab. |
| C8 | `programme.monitor@` | Overview of PRG-101, PRG-102, PRG-105, PRG-104, PRG-103, PRG-242: stage bar matches section 6.1; current sprint and next deadline correct; no "Next visit" card while `visits` is off. |
| C9 | `programme.monitor@` | Phase action on PRG-104 from the stage bar (refusal text when the CoC gate blocks). |
| C10 | `programme.admin@` | Kick-off & mobilisation on PRG-102: guided kick-off sequence, milestones tab, mobilisation tab; complete "contractor on site". |
| C11 | `legal.officer@` | PRG-221 default case from the milestones tab; executive step visible to `south.admin@`. |
| C12 | `programme.funder@` | Payments on PRG-105: record an interim payment with a sprint; final payment before CoC flagged; void with reason; filters; Release checks panel; Overview bar updates. |
| C13 | `programme.monitor@` | Completion & handover on PRG-104: Certificate, Handover (record response), Defects, Closure tabs; tabs hidden when the module is off. |
| C14 | `south.me@` / `programme.admin@` | PRG-241 closure checklist and audit sign-off; PRG-242 closure pack download (archived, read-only elsewhere). |
| C15 | `programme.admin@` | Settings → project types: each tab, Advanced, validation error count on a tab, save new version, unsaved-changes prompt. |
| C16 | `programme.admin@` | Forms & facilities → Facilities: add, rename, retire, restore (R2 owed). |
| C17 | `me.officer@`, `resident.supervisor@` (web view), `lender@` | Entries hidden or read-only exactly per permission; no page reachable by URL that the sidebar hides (each answers with the RequirePermission screen). |
| C18 | `admin@` (Platform tenant) | Legacy LKK-402 and ABJ-108: Overview shows Construction with Kick-off/Mobilisation "not tracked"; Audit ledger → Field reports still reachable. |
| C19 | any | Portfolio and directory stage chips and filters; KPIs and Lessons pages unchanged. |
| C20 | signed out | Public home and mobile pages carry no lender, AI or join-code text; `/about` redirects. |

---

## 11. Accessibility and responsive check

| Area | Check | Tool |
| :--- | :--- | :--- |
| Automated | axe-core over Overview, each setup step, Payments, Kick-off & mobilisation, Completion & handover, type editor, Settings: 0 serious/critical violations. Inject axe through `browser_evaluate` from a pinned CDN build, or add `@axe-core/playwright` to `qa/` (**confirm**). | Playwright MCP |
| Keyboard | Every control reachable in order; visible focus ring (`focus-visible:ring-brand-primary`); tabs with arrow keys; More ▸ and the drawer with Enter/Escape; modals trap and return focus (`ModalShell`). | manual via MCP key presses |
| Semantics | One `h1` per page; nav landmarks labelled ("Workspace", "Project", "Setup steps"); `aria-current` on nav and steps; stage and status chips have text, not colour alone (as `components/kpis/*` already do). | snapshot |
| Forms | Every input has a label (fix the unlabeled retention override inputs and any others found); errors linked with `aria-describedby`; Review issues link to fields. | snapshot |
| Contrast | Sidebar text (`text-white/80`, `text-white/55` headings) on the gradient ≥ 4.5:1 (headings ≥ 3:1 if large); chip colours. | axe + spot check |
| Responsive | 1440, 1280, 1024, 768 and 390 px wide: no horizontal page scroll; sidebar drawer below `lg`; setup step list stacks above the form (already `lg:grid-cols-[220px_1fr]`); tables scroll inside `StandardTable`; stage bar wraps to a vertical list below `md`; modals fit at 390 px. | `browser_resize` + screenshots |
| Motion | Respect `prefers-reduced-motion` for the drawer and skeleton pulses. | manual |

---

## 12. Dependencies on R3, R4, R5 and R7

| Needed from | What R6 needs | Used in | If not ready |
| :--- | :--- | :--- | :--- |
| R3 | Route and permission of the Forms & facilities page; whether R3 creates `/app/forms` | R6b nav, D-R6.25 | R6b builds the frame with the Facilities tab |
| R3 | Where visit types / fixed sections are edited (form library, not the type editor) and any type config key R3 adds | R6e Monitoring group, `PROJECT_TYPE_CONFIG_GROUPS` test | R3 adds its key to a group; the test fails until it does |
| R4 | Visit planner route and permission | tenant nav | hidden (`visits` false) |
| R4 | Visits & reports and Findings routes and permissions | project nav | `/inspections` under the new label; Findings hidden |
| R4 | Visit plan section component and its setup section id (and whether it is required) | Team & visits step | Reporting section stays |
| R4 | Deletion of cadence/streams (`reporting` section, `reportingDefaults`, `reportingStreams`, `inspections` config) | Team & visits, type editor Monitoring/Advanced | they stay visible as today |
| R4 | `loadNextVisit(projectId)` and next submission deadline | Overview cards | "Next visit" hidden; deadline from milestones only |
| R4 | Mobilisation check visits for a project | Kick-off & mobilisation → Mobilisation tab, stage note | tab shows the milestone and compliance panel only |
| R4 | Sprint verification state | Overview current sprint, Sprints & scope | derived status only (upcoming, active, ended) |
| R4 | Default visit plan, visit types, submission deadline type keys and editors | type editor Monitoring group | `MonitoringRulesEditor` and reporting defaults |
| R4 | Open findings count; replacement of `InspectionOverviewCard`, `/inspections`, Field reports tab | Overview, Audit ledger | kept as today |
| R5 | Nothing (mobile). The mobile app must keep compiling; R6 changes no API it reads except additive DTO fields. | – | – |
| R7 | Role catalogue and permission renames; seed moved to the `contractor` section; demo script and configuration reference rewrite | gates, seed | R6 keeps today's permission keys and the parties compatibility path |

---

## 13. Out of scope

Form library and form builder UI (R3); visit planner, visit pages, findings pages, sprint verification, mobilisation check visits, KPI changes (R4); mobile (R5); role catalogue, permission renames, seed and demo rewrite (R7); design cleanup with Impeccable beyond the screens R6 rebuilds (`ui_verification_and_design_plan.md` Phase 3); payment CSV export, ERP API and webhooks (spec 9, later); the Needs Assessment module.

---

## 14. Definition of done

- All slices merged in order, each green at the time: `npm run typecheck` clean, `npm run lint` 0 errors, `npm --workspace=@insite/web run build` passes, server unit + route tests and mobile tests pass.
- A draft goes from "+ New Project" to active through the five steps only; every section's validation still runs on activation; old step URLs and notification links land on the right place.
- Sidebar and project pages match spec 10.2 (with D-R6.12 slots if R4 is not in); Overview shows the stage bar, current sprint, next deadline (and next visit once R4 is in) for every seeded stage.
- Payments record an optional sprint; the type editor has the four groups plus Advanced and the config-key coverage test passes.
- Browser click-through (section 10) and the accessibility/responsive check (section 11) done, findings fixed or listed in section 15.
- `CLAUDE.md` updated; demo script and configuration reference free of stale routes.

---

## 15. Found during implementation

### 15.1 Verification numbers

| Point | Typecheck | Lint | Web build | Server unit | Server route | Mobile |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Baseline (R4 final record, tree clean) | clean | 0 errors, 64 warnings | pass | 195 | 293 | 57 |
| After R5a–R5e and R6a–R6e (gated together, before R5f) | clean | 0 errors, 57 warnings | pass | 217 | 330 | 147 |
| Final, after R5f (migrations up to date, seed runs) | clean | 0 errors, 47 warnings | pass | 173 | 301 | 147 |

### 15.2 Run with R5 in parallel (2026-11-24)

R6 and R5 were run in parallel, after R4. Review of the two plans before starting:

| Topic | Finding | Decision |
| :--- | :--- | :--- |
| Can R5 and R6 run in parallel? | Yes for R5a–R5e (mobile + the baseline pack in `auth.*`) and every R6 slice: they share only `shared/src/index.ts`, `server/package.json` test lists and docs. **No** for D-R4.37 (the server/Prisma/seed/web deletion of the old app's endpoints, which the register gives to R5's last slice): it edits the Prisma schema, the seed, KPIs and web pages R6 rewrites. | Owner: R5 and R6 in parallel; the D-R4.37 clean-up runs afterwards as a separate sequential slice **R5f**. Shared index exports, test-list entries and stubs were created before the agents started; each agent owned a disjoint file set. |
| D-R6.1 / D-R6.12 | R3 and R4 are done, so every slice can run and there is nothing to reserve. | `redesignModules.ts` is not built. Visit planner = `/app/visits`; Visits & reports = `/app/projects/:id/visits`; Findings = `/visits?tab=findings` (R4 put findings on the Visits page). |
| Section 4.1 mapping | R4f deleted the `reporting` section and added `visits` (officers, working days, plan). | Team & visits = `visits` + `team`; `/setup/visits` resolves to the `team` step. |
| D-R6.21 | `InspectionOverviewCard` and the inspections page are already gone (R4). | Nothing to keep. |
| D-R6.25 | R3 built Forms & facilities as a Settings tab. | R6b moves it to `/app/forms` (register section 3). |
| Overview contracts (written first) | `deriveProjectStage` (`shared/src/utils/projectStage.ts`), `ProjectStageSchema`/`ProjectStageSummarySchema`/`ProjectOverviewDtoSchema` (`projectOverview.schema.ts`), batched `loadProjectStageFacts`/`loadProjectStageSummaries` (`server/src/modules/projects/projectStage.service.ts`, also used by the R5 baseline pack). | Deviations: `enteredAt` is an ISO timestamp (the UI formats it) instead of `enteredOn`; `visitsEnabled` dropped; `hasSprints` and `openFindingCount` added. "Kick-off tracked" = the project has a type or any contract milestone. |

### 15.3 R6c: Overview

- Built: `GET /projects/:id/overview` (`modules/projects/overview.service.ts`, `overview.routes.ts`, mounted in `app.ts` right after `projectsRoutes` so `/portfolio/overview` keeps matching first); stage on `GET /projects` and `/projects/portfolio/overview` rows (batched); `ProjectCoreDtoSchema`/`ProjectSummaryDtoSchema` in `shared/src/schemas/project.schema.ts` (web `api/types.ts` re-exports it); `ProjectOverviewPage` with `ProjectStageBar` and `PhaseActions`/`PhaseChangeModal` (moved from the banner; refusal text shown under the button); stage chip in the directory, the portfolio rows and the header. Deleted: `PortfolioDashboardPage.tsx`, `ProjectPhaseBanner.tsx`, `NextDeadlinesCard`.
- Gates (server): milestones = the web `MILESTONE_VIEW_PERMISSIONS` list; next visit = `visits:view`; findings = `inspections:view`, `inspections:manage_findings` or `visits:view`; defects = `retention:manage_defects`; sprints = `boq:view`; stage = every viewer. Hidden sections are null.
- Next visit: PLANNED / IN_PROGRESS / RETURNED from today (project zone), earliest. Visit deadline candidate: the earliest `submissionDeadline` of an open visit, even when overdue; a milestone wins a tie. Payments stay a separate query (`useProjectPaymentsQuery`); the bar uses gross paid (`paidGrossNgn`, the figure `PAID_ABOVE_CONTRACT_SUM` uses).
- Stale copy fixed in the phase modal (public handover link, reporting obligations).
- **Seed vs plan:** PRG-101 is a draft (`seedPhase16`), so no seeded live project is in the Kick-off stage; the test asserts 409 `PROJECT_IS_DRAFT`. C8 cannot show Kick-off; R7's seed should add one. PRG-102 Mobilisation, PRG-105 Construction (sprint 3 of 3), PRG-104 Completion, PRG-103 Closure (liability period), PRG-242 Closure (archived), LKK-402 Construction with Kick-off/Mobilisation not tracked.
- Tests: `routes.r6c.test.ts` 16, `projectStage.r6.test.ts` 10.

### 15.4 R6d and R6e

- Migration `20261220090000_r6d_payment_sprint`: `project_payments.sprintId` + index `(projectId, sprintId)` + FK `ON DELETE RESTRICT`. The diff held only this change; deployed on the dev DB.
- R6d: `RecordPaymentRequestSchema.sprintId`, `PaymentSprintRefSchema`, `PaymentDto.sprint`; `ProjectPaymentsSummaryDto` gained `sprints`, `today`, `retentionPeriodEnded`. A sprint of another project → 404 `SPRINT_NOT_FOUND`; `PAYMENT_RECORDED` audits the sprint. `saveSprints` refuses to remove a sprint any payment names (voided included) with 409 `SPRINT_IN_USE` on drafts and live projects (else the FK would surface as 500). Web: sprint picker and column, client-side filters (kind, sprint incl. "No sprint named", exceptions only), paid-vs-contract bar, Release checks panel, labelled override and void inputs.
- **Seed fix:** the reset list deleted sprints before payments, which the Restrict FK would refuse once a payment names a sprint (C12 creates one); `projectPayment.deleteMany()` now runs first.
- R6e: `PROJECT_TYPE_CONFIG_GROUP_DEFS` / `PROJECT_TYPE_CONFIG_GROUPS` / `projectTypeEditorSectionForPath` (`shared/src/schemas/projectTypeConfigGroups.ts`): kickoff = `contractMilestones`, `kickoff`, `documentRequirements`, `defaultCases`; monitoring = `monitoring`, `visitForms`, `supervision`, `inspections` (legacy, until R5f); completion = `closure`, `payments` (retention defaults; D-R6.24 kept); kpis = `kpiTargets`; advanced = `ownership`, `parties` (+ the workflow template field). `ProjectTypeEditor`: General block, tabs (panels stay mounted), error counts per tab, leave guard on a dirty payload.
- Tests: `routes.r6d.test.ts` 4, `typeConfigGroups.r6.test.ts` 5.

### 15.5 R6b and the R6f public pages

- Built: `web/src/navigation/navItems.ts` (Workspace and Project groups in spec order, More ▸ Audit ledger and Settings → `/settings/project`; legacy segments per entry so names and active state work on old URLs; helpers `parseAppLocation`, `findNavItem`, `canSeeNavItem`, `pageNameFor`, `sameSubPageFor`), `components/common/Tabs.tsx` (`Tabs`, `TabPanel`, `useUrlTab`; changing tab drops `case`/`ticket`), `pages/kickoff/*` (Kick-off guided sequence, Milestones with `?case=`, Mobilisation with the on-site milestone, `MOBILISATION_CHECK` visits and `MobilisationCompliancePanel`), `pages/completion/*` (Certificate, Handover, Defects with `?ticket=` highlight, Closure; retention cards deleted), `pages/forms/FormsFacilitiesPage.tsx` (`/app/forms`, `facilities:manage` or `forms:manage`; the Settings tab is gone). `AppShell` rewritten (project switcher, More ▸ disclosure, `aria-current`, drawer below `lg` with focus trap and Escape, header stage chip). Redirects keep the query string. Settings tabs go through `useGuardedAction` (the type editor's leave guard otherwise unmounted silently).
- Deleted: `pages/milestones/*`, `pages/closeout/*`, `pages/closure/ProjectClosurePage.tsx`, `AboutPage.tsx`, `CitationRef.tsx`; `HomePage`, `MobileAppPage`, `PublicLayout` rewritten without lender/AI/join-code copy; `ArchiveProjectDialog` IPC line replaced.
- Server `actionUrl`s moved to the new routes (default cases now open the case: `/kickoff?tab=milestones&case=<id>`). `routes.r6b.test.ts` (no database) reads the web routes from `App.tsx` and every `/app/...` link in server source and the seed (27) and checks each opens a page and a tab that exists. Legacy `/inspections` and `/audit?tab=presence` links are allowed until R5f.
- Decisions: Findings entry gated `visits:view`; More ▸ Settings shown only for `projects:edit_baseline` (the gate of the header button it replaces; the route stays read-only for others); no `module` field (the page gates its tabs on the module switches). Completion & handover = union of closure, handover and defect-reader permissions incl. `payments:view` (a server defect reader); holders of only `payments:record` or `audit:view_ledger` lose the page, which only showed them the money cards now on Payments. The merged pages' `h1` is the header's.
- Tests: `routes.r6b.test.ts` 3.

### 15.6 R6a: 5-step setup

- Built: `PROJECT_SETUP_SECTIONS` (with `stepId`; new section `contractor`), `PROJECT_SETUP_STEPS` = wizard (`project`, `contract`, `scope`, `team`, `review`, settings-only `advanced`), `ProjectSetupSectionIdEnum`, `ProjectSetupWizardStepIdEnum` (old `ProjectSetupStepIdEnum` removed, unused elsewhere), `wizardStepFor`, `wizardStepLabel`, `resolveSetupRoute`, `ProjectContractorSectionSchema`, optional `contractors` on parties, `wizardStepId` on section statuses and activation issues, `ProjectSetupDto.wizardSteps`; drafts list counts wizard steps. Server: `contractor` saver; `saveParties` touches the contractor only when sent and then also marks `contractor` saved (D-R6.4 compatibility, seed unchanged); contractor issues moved to `contractor`; warning `PLANNED_COMPLETION_BEFORE_SPRINTS_END`; `STEP_NOT_SAVED` names the step. Fixed: `PUT /setup/toString` (inherited property names) now 404.
- Web: `steps/*Step.tsx` → `sections/*Section.tsx` + `ContractorSection`; `sectionRegistry.ts`; one data-driven `steps/SectionsStep.tsx` instead of four step pages (deviation); `ReviewStep`, `ProjectSetupShell`, `setupContext` (`useRegisterSection`), `stepRegistry` rewritten; `NewProjectPage` opens `/setup/project#section-parties`.
- Decisions: D-R6.2 – D-R6.10 at their defaults (D-R6.6: `steps` keeps its name). Project = basics, parties (school card, then organisations), site. Contract = contractor, contract, facility (trade pre-filled "Main contract"/`MAIN`, collapsed; allocated budget and planned mobilisation hidden, resent unchanged). **Team & visits = team then visits** (saving visit officers adds them to the team, so team saves first). Legacy URLs: basics/parties/site → project; facility/contractor → contract; standards/boq → scope; visits/reporting → team; process → advanced; each to `#section-<id>`, query kept. Save and continue saves dirty sections, then required never-saved ones, stopping at the first failure. Process no longer counts as unsaved on an untouched draft. `MobilisationCompliancePanel` left the Team section. The shell's own step moves use plain `navigate()` after its save (the guard would prompt twice).
- **For R7:** move the seed (`seedPhase11.ts`, `seedPhase16.ts`) to the `contractor` section; seeded draft ENU-501 (written straight into `setupState`) now shows `contractor:STEP_NOT_SAVED` (no test activates it).
- **Test infrastructure:** concurrent route-test runs from different agents collided while building the shared `_tmpl` template (`permissions_key_key` unique violation), although the plan said the template is keyed per PID. The full gate is run alone. The R6a agent used a private `insite_r6a_test` database (and its `_tmpl`), which can be dropped.
- Tests: `setupRegistry.r6.test.ts` 7, `routes.r6a.test.ts` 10; `routes.phase6` expectations moved to `contractor:*`.

### 15.7 Click-through and accessibility check (sections 10 and 11)

Owner decision (2026-11-24): no browser click-through in this run. Sections 10 and 11 are carried, updated to what was built, into [web_testing_checklist.md](web_testing_checklist.md) (IDs `WEB-R6-*`, plus the R2/R3/R4 checks still owed), to be run once when the platform edits are finished. A first run was stopped part-way: it fixed the login page labels and contrast, the browser tab title, and accessibility in a few closure, select and modal components (`qa/findings/web.md` W-R6-001 – W-R6-004); W-R6-004 (login showcase panel) stays open.
