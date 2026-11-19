# Phase 6: Organisations, Contractor Model, Geofence Modes and Staged Project Creation

| | |
| :--- | :--- |
| **Status** | Implemented; web click-through and on-device testing pending (see section 8) |
| **Depends on** | Phase 2, Phase 3 (IPC rules this phase extends to multiple contractors) |
| **Unblocks** | Phases 7, 8, 9, 10 |
| **Read first** | [Master plan](saas_implementation_plan.md) sections 2, 3 and 6 |

---

## 1. Overview

**Objective:** rebuild project setup. A project is created as a draft through a multi-page wizard that saves at every step and goes live only when the final step's "Set project active" toggle is on. Along the way, deliver the pieces the wizard needs: an organisation directory, a monitor input, the contractor model with multiple contractors, and a third geofence mode.

**In scope**
1. Organisation directory and tenant-configurable input mode (free text, dropdown, or both).
2. Project parties: monitor, lender, and contractors under a chosen contractor model.
3. Geofence modes: radial, linear corridor, perimeter; tenant chooses which are offered.
4. Project lifecycle (`DRAFT`, `ACTIVE`, `ARCHIVED`) and the staged wizard.
5. Tenant settings that are stored but unused today (currency, timezone) and remaining hardcoded branding.

**Out of scope:** workflow templates, standards and needs-assessment steps (Phase 7 adds them to the wizard built here), cadence behaviour (Phase 8), schedule dates (Phase 9).

---

## 2. Context for the implementing agent

**Project creation today**
- Web: [CreateProjectPage.tsx](../web/src/pages/projects/CreateProjectPage.tsx) is one 1,650-line component at `/app/projects/new`. It holds all state locally and posts once at the end. Form defaults are demo values (an ₦8.5bn budget, "InfraCredit", "J&S Civil Eng.", Kaduna and Abuja coordinates, Conditions Precedent pre-set to `SATISFIED`) and are not gated by demo mode. On submit it silently coerces bad input (empty coordinates become Abuja, target 0 becomes 50). Its CSV parser turns `"12,500"` into quantity 1 and can pick "Item No" as the description; uploading an .xlsx after CSV rows sends both.
- Server: `createProjectBaseline` in [projects.service.ts](../server/src/modules/projects/projects.service.ts) does everything in one transaction: find-or-create lender and contractor organisations by name, create the project, assign the creator, generate join codes for all mobile roles, create tranches and CPs. BOQ upload is a separate call ([boq.service.ts](../server/src/modules/boq/boq.service.ts)).
- `monitorOrganizationId` is set to the creator's own organisation, whatever it is.
- `UpdateProjectBaselineSchema` is `CreateProjectRequestSchema.partial()`; several accepted fields are silently ignored on update.
- The Projects directory already has "Drafts" and "Pending Approval" tabs that can never be non-zero ([ProjectsDirectoryPage.tsx](../web/src/pages/projects/ProjectsDirectoryPage.tsx)).

**Organisations today**
- `Organization (tenantId, name, category)`; one category per organisation, set by first use. Find-or-create by case-insensitive name in three places (`registerWebUser`, `createUserInTenant`, `createProjectBaseline`). No list or CRUD endpoint, no admin screen. Phase 2 added a unique index on `(tenantId, lower(name))`.

**Contractors today**
- `Project.contractorOrganizationId` is a single required FK. It is read in `listProjectsForUser`, `getPortfolioExecutiveSummary`, `listContractorVerifications`, `generateIpcValuationPdf`, and in web types and screens (`AppShell.tsx`, `ProjectsDirectoryPage.tsx`, `PortfolioExecutivePage.tsx`).
- BOQ items, join codes, sessions and IPCs are project-wide. Web contractor users see a project through `UserProjectAssignment` and can submit an IPC for any BOQ item.
- After Phase 3: one open IPC per tranche, server-assigned IPC numbers, claim lines must belong to the claim's tranche.

**Geofence today**
- [geofence.schema.ts](../shared/src/schemas/geofence.schema.ts): discriminated union of `RADIAL` and `LINEAR_CORRIDOR`. [geofence.ts](../shared/src/geo/geofence.ts): `verifyRadialGeofence`, `verifyLinearCorridorGeofence`, and the dispatcher `verifyPointAgainstGeofence`, which treats anything not radial as linear.
- Prisma enum `GeofenceMode` has two values. The result type has `distanceFromCenterOrLineMeters`, `chainageKm`, `corridorOffsetMeters`.
- Phase 4 removed the duplicate branches on server and mobile; confirm with a grep for `LINEAR_CORRIDOR` before starting.
- Web: two mode cards and two hand-typed coordinate editors in the create page, no map drawing. [LiveGeospatialMap.tsx](../web/src/components/LiveGeospatialMap.tsx) (Leaflet with `react-leaflet` 4) falls back to a hardcoded Lagos centre for an unknown mode. `web/src/api/types.ts` hardcodes the two-mode union.

**Tenant settings today**
- `Tenant.defaultCurrency` and `timezone` are editable and never used: [formatters.ts](../web/src/lib/formatters.ts) hardcodes `₦` and `en-NG`, times are labelled "WAT", server date helpers add one hour to UTC.
- Branding applies three CSS variables. Still hardcoded: fallback `/KPMG-logo.svg`, "Capital Advisory", the page title, login and public layouts, about 150 literal `blue-/sky-/indigo-` utility classes, mobile logo and colours.

---

## 3. Decisions

**No owner input required.** Assumptions, stated so they can be corrected:

| Assumption | Detail |
| :--- | :--- |
| Organisation input mode is a tenant setting | `FREE_TEXT` (type a name; created on save), `DIRECTORY` (pick from configured organisations only), `BOTH` (pick or type a new one). Default `BOTH`. |
| An organisation can play different parts on different projects | Categories become a set of tags on the organisation, used to filter dropdowns, not a single fixed type. |
| Contractor models | `SINGLE_CONTRACTOR` (one contractor, one IPC stream; the simple default), `MAIN_PLUS_SUBS_UNIFIED_IPC` (main contractor submits IPCs covering all packages; subcontractors can field-report only), `MULTI_PRIME_SEPARATE_IPC` (each contractor submits IPCs for its own BOQ items). |
| Draft visibility | A draft is visible to its creator and to users with `projects:create` or `projects:edit_baseline` who can see the project. It never appears on mobile, in portfolio or executive figures, in scheduled jobs, or in notifications. |
| Activation is one-way | `ACTIVE` cannot return to `DRAFT`. It can be `ARCHIVED` (read-only, hidden from mobile). |
| Join codes are issued at activation | A draft has none. |
| Tranche allocations | Their sum may not exceed the project budget. Less than the budget is allowed with a warning. |
| Geofence modes offered | Tenant setting `enabledGeofenceModes`, default all three. A project keeps its mode if the tenant later disables it. |
| Geofence tolerance (owner, 2026-11-19) | Every mode has a tolerance band outside its boundary. A position outside the boundary but within the tolerance counts as valid and is noted on the capture or report ("63 m outside the boundary, within tolerance"). Beyond the tolerance it is outside. Tenant default `defaultGeofenceToleranceMeters` = 100; a project may override it. |
| Project time zone (owner, 2026-11-19) | Set in the wizard, defaulting to the tenant zone. It defines the reporting day (one report per WBS item per day) and is enforced by the server since Phase 4. |

---

## 4. Schema changes

**Organisations**
- `Organization`: replace `category` with `categories OrganizationCategory[]`; add `registrationNumber String?`, `contactEmail String?`, `contactPhone String?`, `isArchived Boolean @default(false)`.
- `Tenant`: add `organizationInputMode OrgInputMode @default(BOTH)`, `enabledGeofenceModes GeofenceMode[]` (default all).
- Permission: `organizations:manage` (category `TENANT_ADMIN`).

**Project lifecycle and parties**
- `Project`: add `status ProjectStatus @default(DRAFT)` (`DRAFT | ACTIVE | ARCHIVED`), `setupState Json @default("{}")` (per-step `{ completedAt, completedByUserId }`), `activatedAt`, `activatedByUserId`, `archivedAt`, `createdByUserId`.
- `Project`: make nullable for drafts: `stateLocation`, `totalBudgetNgn`, `geofenceMode`, `geofenceGeoJson`, `monitorOrganizationId`, `lenderOrganizationId`. Remove `contractorOrganizationId`.
- `Project`: add `contractorExecutionMode ContractorExecutionMode?`.
- New `ProjectContractor (id, projectId, organizationId, tradeCategory, tradeCode, isMainContractor, allocatedBudgetNgn?, allowFieldReporting @default(true), plannedMobilizationDate?, plannedCompletionDate?)`, `@@unique([projectId, organizationId])`, `@@unique([projectId, tradeCode])`.
- Add nullable `projectContractorId` to `BoqItem`, `ProjectJoinCode`, `FieldAgentSession`, `IpcClaim`.
- `ProjectJoinCode`: uniqueness on `(projectId, roleId, projectContractorId)`.
- Permission: `projects:activate` (category `PORTFOLIO_PROJECTS`), granted wherever `projects:create` is by default.

**Geofence**
- Prisma `GeofenceMode`: add `PERIMETER`.
- `Tenant`: add `defaultGeofenceToleranceMeters Int @default(100)`. `Project`: add `geofenceToleranceMeters Int?` (null means the tenant default). The perimeter schema's own `toleranceMeters` is replaced by this general setting.
- Add a Prisma enum `GeofenceStatus { INSIDE, WITHIN_TOLERANCE, OUTSIDE }` and a nullable `geofenceStatus` column on `FieldEvidenceLog`, `SiteTelemetryPing` and the stored report geotag (null = not evaluated). Keep `isWithinGeofence` as `INSIDE or WITHIN_TOLERANCE` so existing readers keep working.
- `FieldEvidenceLog` and telemetry: add `distanceToBoundaryMeters Float?`; keep chainage fields for linear.

**BOQ baseline**
- New `BoqRevision (id, projectId, revisionNumber, uploadedByUserId, reason, itemCount, createdAt)`; `BoqItem.lastRevisionId`.

**Audit actions:** `ORGANIZATION_CREATED`, `ORGANIZATION_UPDATED`, `PROJECT_DRAFT_CREATED`, `PROJECT_SETUP_STEP_SAVED`, `PROJECT_ACTIVATED`, `PROJECT_ARCHIVED`, `PROJECT_CONTRACTOR_ADDED`, `PROJECT_CONTRACTOR_REMOVED`, `BOQ_REVISED`.

---

## 5. The wizard

One page per step, each with its own route, its own save, and its own validation. Leaving a step saves it. Steps can be visited in any order after step 1; the final step shows what is incomplete.

| # | Route segment | Focus | Saves | Required to activate |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `basics` | Name, code, state, LGA, description, total budget | Creates the draft on first save | Yes |
| 2 | `parties` | Monitor organisation, lender organisation, contractor model, contractors (trade, main flag, field reporting on/off) | Organisations, `ProjectContractor` rows | Yes: monitor, lender, at least one contractor, exactly one main contractor in the unified model |
| 3 | `site` | Geofence mode and geometry, drawn on a map | Geofence | Yes |
| 4 | `facility` | Tranches and Conditions Precedent | Tranches, CPs | Yes: at least one tranche, sum within budget |
| 5 | `boq` | BOQ upload, lump-sum flags, hold points, tranche mapping, contractor package assignment with AI suggestion | BOQ items | Yes: at least one item; every item mapped to a tranche; in multi-prime, every item assigned to a contractor |
| 6 | `reporting` | Cadence, workday start and end | Cadence fields | Yes |
| 7 | `team` | Web users with access, provisioned mobile users, which join-code roles will be issued | Assignments | No |
| 8 | `review` | Summary of every step with status, issues list, **"Set project active" toggle**, Save | Activates if the toggle is on and validation passes; otherwise stays a draft | n/a |

Phase 7 registers additional steps ("Workflow and process", "Standards and needs assessment") between 6 and 7. Build the step list as a registry (id, title, route, component, server validator, required flag) so adding a step does not touch the shell.

After activation, the same step pages serve as project settings under `/app/projects/:id/settings/:step`, with edits audited and restricted by `projects:edit_baseline`. Changes that would invalidate live data (code prefix, contractor model once an IPC exists, removing a contractor with sessions or claims) are refused with a reason.

---

## 6. Implementation checklist

### Step 1: Organisations
- [x] Shared: organisation DTO and request schemas; `OrgInputModeEnum`.
- [x] Server: `/api/v1/organizations` list (filter by tag, search, archived), create, update, archive, guarded by `organizations:manage` for writes and any authenticated tenant user for list. One `resolveOrganization(tx, tenantId, { id?, name?, tag })` helper used everywhere an organisation is taken from input; it enforces the tenant's input mode. Replace the three find-or-create copies.
- [x] Tenant settings endpoint (`tenant:manage_settings`): `organizationInputMode`, `enabledGeofenceModes`.
- [ ] Web: "Organisations" tab in Settings (table, add, edit, archive, tags). A reusable `OrganizationInput` that renders a text field, a searchable select, or a creatable select according to the tenant mode. Use it in the wizard and in the add-user drawer.

### Step 2: Parties and contractor model (server)
- [x] `ProjectContractor` CRUD under the project, guarded by `contractors:manage_packages`.
- [x] Remove `contractorOrganizationId`. Add a `getProjectContractors` helper and update every reader listed in section 2. Lists and the PDF show the main contractor, with "+N" where space is tight.
- [x] Monitor organisation is an explicit input. Pre-fill with the creator's organisation only if it is tagged `ADVISORY_MONITOR`.
- [x] Contractor scoping for web users: a user whose organisation is a project contractor acts for that `ProjectContractor`. Enforce in IPC submission:
  - `SINGLE_CONTRACTOR` and `MAIN_PLUS_SUBS_UNIFIED_IPC`: only the main contractor's users may submit; lines may cover any BOQ item of the tranche.
  - `MULTI_PRIME_SEPARATE_IPC`: lines must be BOQ items assigned to the submitter's contractor. The "one open IPC per tranche" rule from Phase 3 becomes one per tranche per contractor. IPC numbering is per contractor.
- [x] Contractor users see only their own IPCs and queries in multi-prime.
- [x] Join codes: for contractor-executor join-code roles, issue one code per contractor with `allowFieldReporting`, format `{prefix}-{suffix}-{tradeCode}-{random}`. Sessions carry `projectContractorId`. No code for a contractor with field reporting off.
- [x] Evidence provider and reconciliation treat a contractor's own field evidence as contractor-sourced for that contractor's items, as now.
- [x] AI contractor suggestion: `POST /projects/:projectId/boq/suggest-contractors` returns packages (`suggestedTradeCategory`, `tradeCode`, `matchedWbsCodes`, `estimatedPackageBudgetNgn`, `rationale`), with a deterministic section-and-keyword fallback. It suggests only; nothing is saved until the user confirms.

### Step 3: Geofence
- [x] Shared schema: `PerimeterGeofenceSchema { mode: 'PERIMETER', perimeterCoordinates: LonLat[] (min 3, ring auto-closed, max ~500), toleranceMeters (default 0, max 500), siteLabel? }`. Reject self-intersecting rings. Add to the union.
- [x] Shared maths: `verifyPerimeterGeofence` using point-in-polygon plus distance to the nearest edge. Add the Turf modules it needs to `shared/package.json`.
- [x] Tolerance for all modes: `verifyPointAgainstGeofence(point, geofence, toleranceMeters)` returns `status` (`INSIDE`, `WITHIN_TOLERANCE`, `OUTSIDE`) and `distanceOutsideMeters` (0 when inside). Radial: distance beyond the radius; linear: offset beyond the half-width; perimeter: distance to the nearest edge when outside.
- [x] Server: `server/src/utils/geofenceEvaluation.ts` (the single helper from Phase 4) takes the project's effective tolerance and stores `geofenceStatus` and the distance on captures, telemetry and report geotags. Add a `WITHIN_GEOFENCE_TOLERANCE` flag (not critical) so it shows as a badge.
- [x] Reconciliation: `WITHIN_TOLERANCE` counts as usable evidence and the line rationale notes it (`reconciliationEngine.ts` currently counts only `isWithinGeofence === true`).
- [ ] Web and mobile badges: "Within tolerance (N m outside)". The mobile preview uses the same shared function and the tolerance from the baseline pack.
- [x] Dispatcher becomes an exhaustive switch with a compile-time `never` check.
- [x] Result type: add `distanceToBoundaryMeters`; keep the old distance field populated for radial and linear so existing readers work; chainage stays null for non-linear.
- [x] `geofenceCentroid(geofence)` and `geofenceBounds(geofence)` helpers for maps.
- [x] Server: validate the project's mode against the tenant's `enabledGeofenceModes` on save.
- [ ] Tenant settings: `defaultGeofenceToleranceMeters` (0 to 1000). Wizard step 3: tolerance override, and project time zone (IANA list, default the tenant zone; `Project.timezone` exists since Phase 4). Both go into the mobile baseline pack.
- [ ] Web: one `GeofenceEditor` built on the existing Leaflet setup: pick a mode, then click to place a centre and drag a radius, click to add corridor waypoints and set half-width, or click to add polygon vertices. Coordinates can still be typed or pasted as a fallback. Replace the two hand-typed editors.
- [ ] Web: `LiveGeospatialMap` draws all three shapes and fits to `geofenceBounds`; remove the Lagos fallback. Replace mode ternaries in `AppShell.tsx`, `PortfolioDashboardPage.tsx`, `EvidenceOverlayDrawer.tsx` with a label helper. Delete the local union in `web/src/api/types.ts`.
- [ ] Mobile: mode label helper; nothing else should need changing after Phase 4. Verify with a perimeter project.
- [ ] Wording: "corridor" and "chainage" appear only for linear projects.

### Step 4: Lifecycle and wizard API
- [x] Shared: one Zod schema per step, plus `ProjectActivationSchema` composing them.
- [x] `POST /projects`: creates a `DRAFT` from the basics step only (`projects:create`), assigns the creator.
- [x] `GET /projects/:id/setup`: saved data per step and a computed validity report (`{ stepId, complete, issues[] }`).
- [x] `PUT /projects/:id/setup/:stepId`: validates that step, saves it in a transaction, updates `setupState`, writes `PROJECT_SETUP_STEP_SAVED` (one audit entry per save, payload lists changed fields only).
- [x] `POST /projects/:id/activate` (`projects:activate`): re-validates everything, issues join codes, sets `ACTIVE`, writes `PROJECT_ACTIVATED`. Returns the issues list with 422 if anything fails.
- [ ] `POST /projects/:id/archive`.
- [x] Draft exclusion, in one place: `buildProjectVisibilityWhere` takes a `statuses` option defaulting to `ACTIVE` only. Draft-aware callers (directory, wizard) ask for drafts explicitly. Scheduled jobs, mobile project lists, join, portfolio and executive summaries use the default. `requireProjectAccess` refuses field principals on non-active projects.
- [x] Draft deletion: a draft with no dependent records can be deleted by its creator or an admin.
- [x] Remove `createProjectBaseline` and the monolithic `CreateProjectRequestSchema`; replace `UpdateProjectBaselineSchema` with the step schemas.
- [x] BOQ: parsing of CSV and spreadsheet both happens on the server with one parser; return a preview with per-row warnings before commit. After activation, an upload creates a `BoqRevision` with a required reason; items with certified progress cannot have quantity or rate reduced below what is certified, and cannot be removed.

### Step 5: Wizard web
- [ ] Routes: `/app/projects/new` (basics), `/app/projects/:id/setup/:stepId`, `/app/projects/:id/settings/:stepId`.
- [ ] `ProjectSetupShell`: step navigation with complete, incomplete and current states, "Saved" indicator, Back and "Save and continue". Save on continue and on navigation away; warn on unload with unsaved changes.
- [ ] One component per step under `web/src/pages/projects/setup/`. Delete `CreateProjectPage.tsx`.
- [ ] No demo defaults. Empty fields are empty. A "Fill with sample data" button exists only in demo mode.
- [ ] No silent coercion. Invalid input shows a field error and the step is not marked complete.
- [ ] Parties step: `OrganizationInput` for monitor and lender; contractor model as three cards with a one-line explanation each; a contractor list whose columns change with the model (main flag for unified; trade code and package budget for multi-prime; field-reporting toggle always).
- [ ] BOQ step: upload with preview and warnings; hold-point and tranche columns; contractor column when there is more than one contractor; "Suggest packages" opens the AI suggestion for review and bulk apply. Fix "Confirm All" so it does not map every unmapped item to tranche 1; unmapped items stay unmapped and block activation.
- [ ] Review step: per-step summary cards with edit links, an issues list, the **"Set project active"** toggle (disabled with a reason while issues exist), and Save. With the toggle off, the button reads "Save draft".
- [ ] Projects directory: make the "Drafts" tab real, with resume and delete; remove "Pending Approval" until something feeds it.
- [ ] Header "New Project" goes to the basics step; a draft banner shows on any draft project page.

### Step 6: Downstream of multi-contractor
- [ ] Reconciliation workbench: contractor filter and contractor column on IPC lists; claim form limited to the submitter's items in multi-prime.
- [ ] Contractor verification queue shows the session's contractor organisation, not "the" project contractor.
- [ ] Executive and directory views show main contractor plus count.
- [ ] Mobile: the join response and session profile include the contractor name and trade; the inbox shows only BOQ items assigned to the session's contractor when in multi-prime.

### Step 7: Tenant settings and branding completion
- [ ] Shared money and date formatters that take tenant currency and timezone; use them in web, PDF and mobile. Rename `*Ngn` in display code paths only where it is a label; database column names stay.
- [x] Server date helpers take the tenant timezone (IANA) instead of a fixed one-hour offset. "WAT" labels become the zone abbreviation.
- [ ] Remove KPMG fallbacks from tenant-scoped surfaces: logo, tagline, page title, PDF. Keep a neutral InSite default. Login and public pages use the neutral default.
- [ ] Replace literal `blue-/sky-/indigo-` utilities that represent brand colour with brand tokens; leave semantic status colours alone.
- [ ] Live preview of branding before save.
- [ ] Mobile: tenant logo and primary colour from the session profile where the tenant is known; neutral before sign-in. Bundle identifier is a build-profile value.

### Step 8: Seed and tests
- [x] Seed: organisations with tags; one single-contractor project, one multi-prime project with three packages, one perimeter-geofence project, one draft project with three steps complete.
- [x] Tests:
  - each step validator; activation refuses with the exact issues; activation issues join codes once
  - drafts are absent from mobile lists, join, portfolio, executive summary and the cron query
  - organisation input mode enforced server-side (a typed name is refused in `DIRECTORY` mode)
  - multi-prime: a contractor cannot claim another contractor's item or see their IPC
  - perimeter verification: inside, outside, on-edge within tolerance, concave polygon, antimeridian not supported (documented)
  - BOQ revision cannot reduce below certified progress

---

## 7. Definition of done

- A user can start a project, leave after any step, return days later from the Drafts tab, and finish.
- Nothing about a draft is visible outside the wizard and the Drafts tab.
- A multi-prime project runs a full claim cycle for two contractors independently.
- A perimeter project accepts and rejects captures correctly on mobile and web.
- Master plan status updated.

## 8. Found during implementation

_Add items here rather than expanding scope._

**Verification state (2026-11-19).** Server: `npm run test` passes (94 unit incl. 15 Phase 6; 135 route incl. 24 Phase 6). Root typecheck, `npm run lint` (0 errors), web build and mobile unit tests (35) pass. Migration `20261119200000_phase6_orgs_contractors_lifecycle` is applied to the dev database with no drift. The web screens (wizard, Organisations tab, workspace settings, GeofenceEditor, map, directory, reconciliation contractor filter, branding) and the mobile changes compile but have not been clicked through in a browser or run on a device, so their checklist items stay unticked; so do the Definition of done items.

**Plan conflicts, resolved as follows**
1. Section 4 says the perimeter's own `toleranceMeters` is replaced by the general tolerance; Step 3 still listed it on the schema. Followed section 4 (the later owner decision): `PerimeterGeofenceSchema` has no tolerance.
2. The join code format `{prefix}-{suffix}-{tradeCode}-{random}` did not fit `JOIN_CODE_REGEX` (max 19 characters). The regex now accepts an optional 2–6 character trade segment and `JOIN_CODE_MAX_LENGTH` is 26. The trade code is included only when a project has more than one contractor; a single contractor's code keeps the short format but is still bound to the contractor.
3. "Only the main contractor's users may submit" means users who are not from a project contractor's organisation (for example a monitor holding `ipc:submit_claim`) can no longer submit IPCs (`NOT_A_PROJECT_CONTRACTOR`).
4. Uniqueness on `(projectId, roleId, projectContractorId)` would break rotation (rotated codes stay as history), so it is a partial unique index on active codes only (raw SQL, `ProjectJoinCode_active_project_role_contractor_key`). Keep it when generating later migrations. Issuing a second active code for the same role and contractor is now refused (`ACTIVE_JOIN_CODE_EXISTS`); rotate instead. Phase 2 and 5 tests were updated for this and for the extra seeded projects.

**Decisions taken (easy to change)**
- Draft deletion: "an admin" means a platform super admin or a holder of `tenant:manage_settings`. Deletion is audited at tenant scope (`PROJECT_DRAFT_DELETED`, added to the audit enum) because project-scope entries are deleted with the project.
- A step is complete when it has no issues **and** has been saved once (basics is saved at creation), so steps with valid defaults (reporting) must still be opened and saved in a draft. `setupState` = `{ steps: { [id]: { savedAt, savedByUserId, completedAt, completedByUserId } }, team: { joinCodeRoleIds } }`.
- Steps report `warnings` as well as `issues` (tranches below the budget, package budgets above it).
- Setup never sets a Condition Precedent's status: new CPs are PENDING, and status changes go through the Phase 3 CP actions.
- A BOQ upload no longer turns the AI's suggested tranche into a mapping: new items arrive unmapped with `aiSuggestedTrancheId`, and "Accept suggested tranches" maps only items that have a suggestion. Draft uploads replace the draft BOQ (`mode: REPLACE`); after activation an upload is a `BoqRevision` with a reason. Certified items keep at least their certified quantity, their rate cannot go down, and their certified percentage is recomputed so the certified quantity stays the same.
- Web requests on a draft are limited to the setup, activate, contractors, BOQ, baseline and join-code routes (`PROJECT_IS_DRAFT`); any non-GET request on an archived project is refused (`PROJECT_ARCHIVED`). Archiving deactivates the project's join codes.
- Changing an active project's contractors issues codes for new field-reporting contractors (for contractor roles already issued there) and deactivates the codes of contractors whose field reporting is turned off.
- A provisioned contractor-executor account is bound to its organisation's `ProjectContractor` on that project when its session is created.
- Web money and dates read the tenant currency and zone set at sign-in (`setDisplayContext` in `web/src/lib/formatters.ts`). The names `formatNaira` etc. were kept so call sites did not change. Currency and time zone moved out of the branding form into Workspace settings, because the branding form could overwrite them.
- Neutral InSite default branding: no logo URL (the InSite mark is shown) and the tagline "Field Evidence Assurance". The default colours `#00338D` / `#0C233C` were kept because they are the InSite logo's own colours. They also match KPMG blue, so an owner decision is needed if a distinct InSite palette is wanted. KPMG text remains in public marketing copy (`pages/public/AboutPage.tsx`), and the mobile app still has `assets/KPMG-logo.svg` (unreferenced), the `app.json` `primaryColor` and the `com.kpmg…` bundle default (now overridable with `APP_BUNDLE_ID` per EAS profile).
- `/auth/me` for join sessions now also returns `contractor` and `tenantBranding`. Sessions stored on a device before this change get them on the next `/auth/me` or on rejoin.

**Follow-ups done (2026-11-20)**
- Leaving a wizard step with unsaved changes asks first: "Save and leave", "Leave without saving" or "Stay". `web/src/lib/navigationGuard.tsx` intercepts in-app link clicks (sidebar, breadcrumbs) and is used by the button-driven navigation (project switcher, header buttons, sign-out). The app uses `BrowserRouter`, which has no route blocker, so a new `navigate()` call elsewhere must use `useGuardedNavigate` to be covered. Browser back/forward is not covered. Reload and tab close still use the browser's own warning.
- Archiving has a button in a "⋯" menu on each active project card in the projects directory and in the project settings header (`projects:edit_baseline`). Both open one confirmation dialog with an optional reason, which goes to the audit ledger. Covered by a route test: archived, codes deactivated, writes refused, still readable, gone from mobile and the executive summary.
- The stored "metres outside the boundary" value is now `distanceOutsideMeters` on `FieldEvidenceLog`, `SiteTelemetryPing`, the stored report geotag and every DTO (migration `20261120090000_phase6_distance_outside_rename` also renames the key inside existing geotags). `distanceToBoundaryMeters` remains only on the shared verification result, where it really is the distance to the boundary from either side.

**Not done / gaps**
- `ProjectContractor.plannedCompletionDate` is stored but not editable in the parties step (Phase 9 owns schedule dates).
- On mobile, a trade-code join code typed with no hyphen after the role suffix cannot be split unambiguously; the person must type that hyphen.
