# Phase 11: Delivery Models: Project Types, Organisation Hierarchy, Parties and Terminology

| | |
| :--- | :--- |
| **Status** | Implemented; web click-through and on-device testing pending (see section 7) |
| **Depends on** | Phase 6 (organisations, wizard), Phase 7 (process config, workflow templates, approval chains) |
| **Unblocks** | Phases 12, 13, 14, 15, 16 (they all hang their per-model rules on the project type) |
| **Read first** | [Master plan](saas_implementation_plan.md) sections 2, 3 and 6; [process flow gap analysis](process_flow_gap_analysis.md) sections 3–5 |

---

## 1. Overview

**Objective:** let one tenant run several delivery models side by side. A project belongs to a **project type** (e.g. "Central Delivery Model", "Co-Funded Delivery Model") that sets its process, defaults and later its milestones, documents, reporting streams and closure rules. A project is **owned** by a flagship organisation or one of its subsidiaries, and people see the projects their part of the organisation owns. The words the UI uses ("Lender", "Tranche", "IPC") can be changed per tenant.

**In scope:** organisation hierarchy, project ownership and extra parties (owner, funder, beneficiaries), regions, organisation-scoped visibility, organisation scope on approval steps, project types with versioned snapshots, tenant terminology, filters by type / region / owner, seed.

**Out of scope:** milestones, documents, credentials, payments, streams, closure (Phases 12–15). This phase only creates the **slots** on the project type that those phases fill.

**Why first:** client requirements are provisional (master plan decision J). Every client-specific rule from now on must be data on a project type or tenant, not code.

---

## 2. Context for the implementing agent

- `Organization` ([schema.prisma](../server/prisma/schema.prisma)) is flat: `categories[]`, no parent. `Project` has `monitorOrganizationId`, `lenderOrganizationId` and `ProjectContractor` rows. `stateLocation` / `lgaLocation` are free text.
- Visibility: `buildProjectVisibilityWhere` and the project guard in [accessControl.ts](../server/src/utils/accessControl.ts) (around lines 25–60 and 128) give either assigned projects or the whole tenant (`projects:view_all_tenant`).
- `WorkflowTemplate` holds process switches + both approval chains and is **copied** into a project (`ProjectProcessConfig.workflowTemplateId` is provenance only). Service: `server/src/modules/process/workflowTemplates.service.ts`.
- Approval step gating: `holdsStep` and `canAct` in [approvalChain.ts](../server/src/modules/process/approvalChain.ts) check permission, optional role and segregation of duties. No organisation check.
- Setup wizard: `PROJECT_SETUP_STEPS` in [projectSetup.schema.ts](../shared/src/schemas/projectSetup.schema.ts), server `projectSetup.service.ts`, web `web/src/pages/projects/setup/stepRegistry.ts` and `steps/*`.
- Precedent for tenant-configurable wording: `Tenant.evidenceRatingLabels` + `resolveRatingLabels` (decision B: canonical values never change, only labels).
- "Lender" is hard-coded in `PartiesStep.tsx`, reconciliation and closeout pages, PDFs and notifications.

---

## 3. Decisions

| Topic | Decision |
| :--- | :--- |
| Organisation hierarchy | `Organization.parentOrganizationId`, any depth up to 5, cycles refused. A tenant can have several roots. |
| Project ownership | `Project.owningOrganizationId`: the organisation accountable for delivery (flagship for Central, subsidiary for Co-Funded). Separate from the monitor and the funder. |
| Funder | Keep the `lenderOrganizationId` column (no churn); the party is shown as "Funding organisation" through terminology. Co-Funded: funder = subsidiary (owner), which is itself funded by the flagship (answer Q2). One funder per project; co-funding splits stay out of scope (gap G13). |
| Visibility | A user sees a project if **any** of: assigned; holds `projects:view_all_tenant`; holds new `projects:view_organization_tree` and the project's owner is the user's organisation or a descendant of it. Flagship staff with the tree permission see all subsidiaries' projects. |
| Approval step org scope | New optional `organizationScope` on `ApprovalStep`: `ANY` (default, today's behaviour), `PROJECT_OWNER`, `PROJECT_OWNER_OR_ANCESTOR`, `FUNDER`. Enforced in `holdsStep`. |
| Project type vs workflow template | A project type **references** a workflow template (approvals and switches) and holds everything else in its own config. Templates stay reusable across types. |
| Live projects and type edits | Applying a type writes `Project.projectTypeSnapshotJson` (config at that time, with `projectTypeVersion`). Later edits to the type affect new projects only, like approval chain versions. Type can change only while `DRAFT`. |
| No type | `projectTypeId` is nullable. Tenants without types, and all existing seed projects, behave exactly as today. |
| Terminology scope | Tenant level only in this phase. Keys are fixed in shared code; values are tenant text. |
| Regions | Tenant `Region` table, two levels (region → area). Optional on a project; required when the project type says so. |

---

## 4. Schema changes

- `Organization`: `parentOrganizationId String? @db.Uuid` (self relation, `onDelete: Restrict`), index.
- `Project`: `owningOrganizationId String?`, `projectTypeId String?`, `projectTypeVersion Int?`, `projectTypeSnapshotJson Json?`, `regionId String?`. Indexes on each.
- New `Region (id, tenantId, name, code, parentRegionId?, isArchived, createdAt, updatedAt)`, unique `(tenantId, code)`.
- New `ProjectBeneficiary (id, projectId, name, beneficiaryType SCHOOL|COMMUNITY|INSTITUTION|OTHER, contactName?, contactEmail?, contactPhone?, address?, isPrimary, createdAt)`.
- New `ProjectType (id, tenantId, code, name, description?, colour?, workflowTemplateId, configJson, version Int @default(1), isActive, isDefault, createdAt, updatedAt)`, unique `(tenantId, code)`.
- `ApprovalStep`: `organizationScope ApprovalOrganizationScope @default(ANY)` (new enum); include it in `ApprovalStepConfigSchema` and template JSON.
- `Tenant`: `terminologyLabels Json @default("{}")`.
- Permissions: `projects:view_organization_tree`, `project_types:manage`, `regions:manage`.
- Audit actions: `PROJECT_TYPE_SAVED`, `PROJECT_TYPE_APPLIED`, `ORGANIZATION_HIERARCHY_CHANGED`, `TERMINOLOGY_UPDATED`.

### `ProjectTypeConfigSchema` (shared)

One Zod object. Every key is optional with a `.default()`, so a type saved now stays valid when later phases add keys. This phase defines:

```ts
{
  ownership: { owningOrganizationRequired: boolean; allowedOwningOrganizationIds: string[] | null; defaultOwningOrganizationId: string | null },
  parties:   { monitorRequired: boolean; funderRequired: boolean; beneficiaryRequired: boolean; regionRequired: boolean },
  reportingDefaults: ProjectReportingStep | null,   // pre-fills the Reporting step
  // Reserved, filled by later phases (validated as unknown-but-present until then):
  credentials?: ...,          // Phase 12
  payments?: ...,             // Phase 12
  contractMilestones?: ...,   // Phase 13
  documentRequirements?: ..., // Phase 13
  reportingStreams?: ...,     // Phase 14
  inspections?: ...,          // Phase 14
  supervision?: ...,          // Phase 14
  closure?: ...,              // Phase 15
  kpiTargets?: ...,           // Phase 16
}
```

---

## 5. Implementation checklist

### Step 1: Organisation hierarchy
- [x] Shared: `parentOrganizationId` on organisation DTOs and save schema; `organizationAncestry` / `validateOrganizationParent` / `organizationTreeOrder` (pure, `shared/src/utils/organizationHierarchy.ts`).
- [x] Server: save refuses self-parenting, cycles and depth > 5 (subtree height counted when moving); hierarchy edits serialised per tenant (advisory lock); `organizationSubtreeIds` / `organizationAncestorIds` (recursive CTE, memoised per request); archived parents allowed and flagged (`parentIsArchived`). Route-tested.
- [ ] Web: organisation directory tree (indentation, expand/collapse) and parent picker. Built; typecheck/lint/build only, click-through pending.
- [x] Audit `ORGANIZATION_HIERARCHY_CHANGED` on parent changes (route-tested).

### Step 2: Regions and parties
- [x] `Region` CRUD (`regions:manage`, `/api/v1/regions`); two levels only (route-tested). Web: Settings → Project types & regions → Regions (click-through pending).
- [x] Basics step: region; Parties step: owning organisation (type may limit the choice), funding organisation (the lender field, relabelled), monitor, contractors, beneficiaries (exactly one primary). Server route-tested; web forms click-through pending.
- [x] Activation readiness honours the type's `parties` rules (owner required/allowed, monitor, funder, beneficiary; region on the Basics step), server-computed (route-tested).
- [ ] Phase 10 handover link form pre-fills recipient, contact, label and stakeholder type from the primary beneficiary (project DTOs carry `primaryBeneficiary`). Built; click-through pending.

### Step 3: Organisation-scoped visibility
- [x] `projectAccessBranch` is the one rule for `buildProjectVisibilityWhere` and the project guard (assigned, or `view_all_tenant`, or `view_organization_tree` + owner in the subtree). Mobile account visibility follows it too.
- [x] Lists pick it up: directory, executive matrix, per-project guard (baseline, web notifications, audit ledger) route-tested. No multi-project portfolio map exists in the web app (see section 7).
- [x] Default role "Organisation Administrator" (`ORGANIZATION_ADMIN`, web, persona `NONE`) holds the tree permission; Monitor and Lender do not.

### Step 4: Organisation scope on approval steps
- [x] `organizationScope` in the shared schema (default `ANY`), validator, template JSON, chain DTOs, chain editor (one select per step; editor click-through pending).
- [x] `holdsStep` / `gateForStep` resolve the actor's organisation against owner, owner's ancestors or funder; reason text for `cannotActReason`; error code `NOT_STEP_ORGANIZATION`. Certification step checked in `startValuationOnChain`. Owner/funder-scoped steps notify that organisation only.
- [x] Tests: subsidiary approver acts on its own project, not a sibling's; flagship approver with `PROJECT_OWNER_OR_ANCESTOR` acts on both; `FUNDER` follows the funder (service-level gate tests on seeded chains).

### Step 5: Project types
- [x] Shared: `ProjectTypeConfigSchema`, `SaveProjectTypeRequestSchema`, `ProjectTypeDtoSchema`, `ProjectTypeSnapshotSchema`, `resolveProjectTypeConfig`, `partyRulesFor`.
- [x] Server `modules/projectTypes/`: list, get, create, update (bumps `version`), archive (`project_types:manage`). Phase 12 hook: `templateConflictsWithType` (refuses nothing yet). A template used by a type cannot be deleted (409 `WORKFLOW_TEMPLATE_IN_USE`).
- [x] Type picker first on Basics (required when the tenant has an active type; draft creation refuses without one). Applying a type copies its template, writes the snapshot, pre-fills owner, funder and Reporting without overwriting saved values, audits `PROJECT_TYPE_APPLIED`. Route-tested; picker click-through pending.
- [x] Changing the type on a draft re-applies; on a live project 409 `PROJECT_TYPE_LOCKED` (route-tested).
- [x] Project DTOs (directory, baseline, setup, executive matrix) carry `projectType { id, code, name, colour, version }`, region and owner.
- [ ] Web: Settings → "Project types & regions": list and editor (general, workflow template, ownership, parties, reporting defaults). Built; click-through pending.
- [x] Filters by type, region (includes its areas) and owning organisation: server query params on `/projects` and the executive summary (route-tested); web filter bar and type chip on the directory and executive matrix (click-through pending).

### Step 6: Terminology
- [x] Shared `TERMINOLOGY_DEFAULTS` / `TERMINOLOGY_KEYS`, `resolveTerminology`, `resolveTerm(labels, key, { plural, lower })`.
- [x] Tenant settings: `GET/PUT /rbac/tenant/settings/terminology` (`tenant:manage_settings`), `TERMINOLOGY_UPDATED` (route-tested). Web: terminology card with live preview (click-through pending).
- [ ] Web `useTerm()` from the auth context; strings converted on Parties, Facility, reconciliation workbench, certify and decision modals, submit-IPC modal, line items, direct milestone panel, retention page, executive view, directory, notifications (list below). Built; click-through pending.
- [x] PDF (`pdf-report.service.ts`) uses resolved terms; disbursement and retention notification labels use them. Outbound message templates contain none of the keyed words (section 7).
- [x] Mobile: `terminology` arrives in `tenantBranding`; used for "Hold point" (report confirm) and the funder in the incident screen. Typecheck and unit tests only; device run pending.
- [x] Canonical values, enum names, API fields, audit text and AI prompts unchanged (route test asserts DTO field names).

### Step 7: Seed and tests
- [x] `seedPhase11.ts`: second tenant `programme-authority` ("Programme Authority (demo programme)"); flagship "Programme Authority" with "Regional Delivery Entity – North" / "– South"; regions North (Kano, Kaduna) and South (Lagos, Enugu); templates "Central delivery process" (release `FUNDER`) and "Co-funded delivery process" (owner review `PROJECT_OWNER`, release `PROJECT_OWNER_OR_ANCESTOR`); types "Central Delivery Model" and "Co-Funded Delivery Model"; terminology funder "Funding authority", tranche "Payment milestone", ipc "Payment claim"; drafts PRG-101 (Central) and PRG-201 (Co-Funded, South); live PRG-102 (Central), PRG-211 (North), PRG-221 (South); Organisation Administrators flagship.admin@, north.admin@, south.admin@ and tenant admin programme.admin@ `insite.ng`. Projects are created through the real setup services. New tables are in the reset list.
- [x] Existing seed projects keep `projectTypeId = null`. The new projects are in their own tenant, so no earlier project-list assertion changed; the Phase 1 unit test of the visibility `where` shape was updated (the access branch now sits under `AND`).
- [x] Route tests (`routes.phase11.test.ts`, 22 tests): hierarchy cycle/self/depth refused and audited; tree visibility (flagship sees all three, each subsidiary its own, sibling neither; guard, notifications, ledger, executive matrix); filters; approval scope; snapshot isolation; draft re-apply and live lock; type required; party rules; template-in-use; regions two levels; terminology per tenant, validation, audit and permission.

Full run at the end of the phase: server 178 unit + 238 route tests pass; mobile 65 pass; `npm run typecheck` clean; `npm run lint` 0 errors; web build OK.

---

## 6. Definition of done

- A tenant can define two project types and create a project of each, owned by different organisations in one hierarchy. **Met (seed + route tests).**
- Subsidiary staff see only their projects; flagship staff with the tree permission see all. **Met (route tests).**
- An approval step can be limited to the project owner's organisation. **Met (gate tests on seeded chains).**
- The UI, PDF and emails say "Funding authority" and "Payment milestone" for the seeded tenant and "Lender" / "Tranche" for the others. **Server side met (profile terms, PDF); web and mobile wording built but not clicked through; emails contain none of these words.**
- Master plan status updated; CLAUDE.md gains a "Delivery models (Phase 11)" paragraph. **Done.**

## 7. Found during implementation

1. **Visibility filter without a query.** `buildProjectVisibilityWhere` is synchronous and used in many places, so the tree branch is expressed as nested `parentOrganization` relation filters bounded to five levels (`ownedByOrganizationTreeWhere`) instead of a pre-fetched subtree. The guard runs the same `where` as a `count`. `organizationSubtreeIds` (CTE) exists for callers that need ids.
2. **Funder default per type (small addition).** The plan's party config had no way to express "Co-Funded: funder = owner" or "Central: funder = flagship". Added `parties.funderDefault` (`NONE` | `OWNER` | `FIXED`) and `defaultFunderOrganizationId`; applied when a type is applied and when the Parties step leaves the funder empty. Consequence: with `OWNER`/`FIXED` the funder cannot be left blank.
3. **Owner on live projects.** Clearing the owner of a live project whose chain has owner-scoped steps is refused (409 `OWNER_REQUIRED_BY_CHAIN`). Changing the owner is allowed and audited through the Parties step entry; it immediately changes who can see and approve.
4. **"Owner or above" notifications.** A `PROJECT_OWNER_OR_ANCESTOR` step cannot be targeted at one organisation, so its notification goes to every permission holder (only owner or funder steps are aimed). Acting is still enforced.
5. **No platform-admin bypass for organisation scope.** The platform super admin's organisation is in the default tenant, so they can never act on an organisation-scoped step. Intended (fail closed); flag if support staff need it.
6. **Resolved: `GET /projects/all/web-notifications` returned 500** (the guard let `all` through; the service used it as a UUID). `all` is now scoped with `buildProjectVisibilityWhere` (live and archived projects the user can see). The guard also allows exactly two writes on `all`: `PATCH /all/web-notifications/:id/read` and `POST /all/web-notifications/read-all`, both scoped the same way. Route-tested.
7. **Resolved: portfolio dashboard.** New permission `projects:view_portfolio` (Tenant Super Admin, Monitor, Lender, Organisation Administrator). `GET /projects/portfolio/overview` (same visibility rule and type/region/owner filters) returns a map point per live project (geofence centroid) and KPIs (commitment, disbursed, budget-weighted progress, evidence health, behind schedule, open issues, quiet sites with no capture for 7 days, handover/defects and retention held). Web: `/app/portfolio` (map with health-coloured pins, project list and detail, KPI cards, filters), sidebar entry "Portfolio", and it is the landing page for users holding the permission. Route-tested; web click-through pending.
8. **Outbound message templates** (mobilisation reminder, handover link and code) contain none of the terminology words, so nothing was converted. Audit summaries, server error messages and AI prompts keep canonical words by design.
9. **Terms in web strings: left unconverted.** "Interim payment certificate" spelled out in full (a term would change the default wording); short "Monitor"/"the monitor" (the `monitorParty` default is "Independent monitor"); the default tranche name `Tranche n` and CP reference `CP-01` (saved values); demo summary text; raw CP status chips; server-supplied unmet-condition strings.
10. **Mid-sentence casing** uses `termMidSentence`: the first letter is lower-cased unless the first word is an acronym ("IPC"). A tenant word that starts with a proper noun would be lower-cased mid-sentence.
11. **Typed organisations and the owner.** The owner is picked from the directory only (by id), unlike monitor/funder, which still accept typed names. Owners need to be in the hierarchy, so free text makes no sense there.
12. **Seed join codes.** Live programme projects are switched on directly (no BOQ, tranches or schedule) and get join codes, so they appear in mobile lists; they are for visibility and approval demos, not field reporting.

### Converted web strings (grep-able)

- `PartiesStep.tsx`: section title/description (owner, `monitorParty`, `funderParty`), monitor and funder labels, beneficiaries section, "IPCs" in contractor-model texts.
- `ProjectsDirectoryPage.tsx`: "No lender" → `No ${term("funderParty", { lower: true })}`.
- `PortfolioExecutivePage.tsx`: "Lender:" counterparty line and tooltip, "Tranche #n", header "Lender Credit Desk & Independent Monitoring Committee" → `{funderParty} & {monitorParty} oversight`.
- `FacilityStep.tsx`: tranche allocation error, "Facility tranches", "Add tranche", tranches-off explanation, "No tranches yet.", "Tranche n name", remove aria label, "Conditions precedent", "Retention" heading and "Retention (%)".
- `ReconciliationWorkbenchPage.tsx`: "Withdraw IPC #n", "Frees the tranche…", "All contractors", IPC option labels, "Submit first IPC claim", "+ Submit new IPC", certify/re-certify/pending valuation, "Record tranche decision", "Contractor claim", unmet hold point (x2), "Valuation and release", "Awaiting the lender decision.", "Not yet certified by the independent monitor."
- `CertifyValuationModal.tsx`: "Certify valuation", "IPC #n" subtitle, "…I sign this valuation…".
- `LenderDecisionModal.tsx`: "Tranche disbursement decision", "Tranche unreleased allocation", "Retention withheld", "Paid to the contractor", conditions precedent (x3), tranche allocation error, "valuation revision n", reverse modal "IPC #n", "the IPC returns to certified", "Reverse tranche decision".
- `DirectMilestonePanel.tsx`: hold point, tranche option/step/select labels and placeholder, "no contractor claim", fully released / verification / no BOQ items on this tranche, "sign this valuation", conditions precedent off, contractor claim explanation.
- `SubmitIpcModal.tsx`: tranche options and label, IPC subtitle, open-tranche rules, BOQ items in this tranche (x2), "Hold point", "Submit IPC".
- `LineItemsTable.tsx`: "Hold point unmet" / "Hold point", "Contractor Claim", "Monitor Valuation", "IPC #n: Claim vs. Field Evidence".
- `RetentionDefectsPage.tsx`: "Retention and defects" (x2), no retention percentage, retention held/released, per contractor / main contractor, request/certify retention release, "valuation" (x2), "Retention release decision", responsible contractor (x3).
- `Notifications.tsx`: category labels for contractor onboarding, tranche disbursement, retention release; "…and IPC flags appear here."
- Settings: `ProjectTypesTab.tsx` (party toggles use terms).
- Mobile: `ConfirmAiSummarySheet.tsx` "Hold point:", `SpecialIncidentModal.tsx` "Monitor and Lender" (x2).
