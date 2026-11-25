# Redesign R7: Role Catalogue, Seed, Demo Script and Docs for the New Model

**Spec:** [client_flow_redesign.md](client_flow_redesign.md) sections 2, 4 (roles), 10.2, 11, 12, 13 and 14 (R7).
**Branch:** `UBEC` (client-specific; decision P).
**Depends on:** R1 (done), R2 (done), R3, R4, R5, R6 (all merged before R7a starts; section 10 lists what R7 needs from each).
**Status:** R7a done (permission catalogue). R7b reduced to two server rules (done). R7c (seed) and the role parts of R7b deferred by the owner on 2026-11-25: see section 12.1. R7d partly done (permission docs).
**Cross-plan contracts:** [redesign_contracts_r3_r7.md](redesign_contracts_r3_r7.md) settles the names and ownership shared by R3–R7. Where this plan differs, the register wins.

Each slice must leave typecheck, lint (0 errors), the web build, and the server and mobile suites green before the next one starts.

---

## 1. Goal

R1–R6 change what the platform does. R7 makes everything around it match:

| Area | Today (after R2) | After R7 |
| :--- | :--- | :--- |
| Permission catalogue | 57 keys in 8 categories; nouns from the old model (`boq:*`, `schedule:*`, `reports:*`, `inspections:*`, `field:*`, `sessions:*`), plus whatever R3–R6 add | One catalogue named after the new model (scope, sprints, visits, findings, forms), in categories that follow the client's flow; legacy keys gone |
| Default roles | 6 (`TENANT_SUPER_ADMIN`, `MONITOR`, `LENDER`, `ORGANIZATION_ADMIN`, `MONITOR_INSPECTOR`, `INDEPENDENT_RESIDENT`); `LEGAL_OFFICER` and `LENDER_TECHNICAL_OFFICER` exist only as seeded custom roles | The 12 roles of spec section 4, one permission matrix (section 5) |
| Existing tenants | New catalogue keys reach the database **only through the seed**: no migration or start-up step inserts them (R2a's `facilities:manage` is not in a migrated, unseeded database) | Code owns the permission rows (start-up sync); a migration carries renames, role-code changes and stored keys |
| Seed | Phase-ordered chain (`seedDatabase` → 6 → 7 → 10 → 11 → 12 → 14 → 13 → 15 → 16 → R2, plus whatever R3–R6 add), type configs merged "without a version bump" four times, lender-era logins (`lender@`, `lto@`) | One demo programme built in its final form on both delivery models, one login per role; the old KPMG tenant kept only as a test fixture (D-R7.12) |
| Docs | `CLAUDE.md`, `configuration_reference.md`, the demo script, `Project Context/project_context_current.md` and the public pages still describe parts of the old product | Rewritten for the new model; history kept in the phase files |

---

## 2. Read first

1. `CLAUDE.md` (all; "Contracts first" for permissions and audit actions in shared and Prisma; the seed paragraph; "Earlier route tests assert seed contents").
2. `saas_updates/client_flow_redesign.md` sections 2, 4, 8.1, 10, 11, 12, 13.
3. `saas_updates/redesign_r1_implementation_plan.md` ("Found during implementation": role catalogue deferred to R7, leftovers) and `redesign_r2_implementation_plan.md` (D-R2.17, section 9).
4. The R3–R6 plan files and their section 9 ("Found during implementation"): the exact permission keys, audit actions, seed files and test files they added. **R7a starts by filling section 10 of this file with the real names.**
5. Code:
   - `shared/src/enums.ts` (`PermissionCategoryEnum`, `PERMISSION_CATEGORY_META`, `SYSTEM_PERMISSIONS_CATALOG`, `ProfessionalLicenseTypeEnum` leftover), `shared/src/defaultRoles.ts` (`DEFAULT_TENANT_ROLES`, `FIELD_BASE_PERMISSIONS`).
   - `shared/src/schemas/process.schema.ts` (`REPORT_APPROVAL_PERMISSION_KEY`, `DEFAULT_REVIEW_PERMISSION_KEY`, `DEFAULT_DECISION_PERMISSION_KEY`, `KNOWN_PERMISSION_KEYS`), `shared/src/schemas/closure.schema.ts` (`DEFAULT_COC_SIGNATORIES`, slot `permissionKey`/`roleCode`, checklist item `permissionKey`), `shared/src/schemas/auth.schema.ts` (`WebRegisterRequestSchema.roleCode` defaults to `"MONITOR"`).
   - `server/src/modules/rbac/rbac.service.ts` (`provisionDefaultRoles`, `createTenantWithDefaults`, `updateRoleForTenant`, `assertCallerHoldsAll`, `assertTenantKeepsRoleAdmin`), `server/src/modules/auth/auth.service.ts` (`registerWebUser`, demo-only route), `server/src/modules/documents/documentTypes.service.ts` (`KNOWN_PERMISSIONS`).
   - Every `server/src/db/seed*.ts`, `server/src/db/seedFieldAccounts.ts`, `server/src/db/seedPayments.ts`, `server/src/tests/helpers/testDb.ts`.
   - Tests that assert roles or seed contents: `rbac.phase1.test.ts` (catalogue uniqueness, every category used), `scope.r2.test.ts`, and the route tests (counts in section 3).
   - Web: `web/src/components/rbac/RolesPermissionsTab.tsx`, `web/src/config/demoAccounts.ts`, `web/src/pages/audit/AuditLedgerPage.tsx` (infers actor kind from `"MONITOR"`/`"LENDER"` substrings), `web/src/pages/public/*`, `web/src/components/PublicLayout.tsx`, `web/src/components/CitationRef.tsx`.

---

## 3. Baseline (measure at the start of R7a)

Record in section 12 before any change: `npm run typecheck`, `npm run lint` (errors, warnings), web build, server unit + route counts, mobile count, and `npm run prisma:seed` succeeding. Last recorded (R2d, 2026-11-24): lint 0 errors / 67 warnings, server 148 unit + 249 route, mobile 57. R3–R6 change these; use the measured numbers.

Also record (grep, 2026-11-24 figures for orientation; re-count at the start):

| What | Count |
| :--- | :--- |
| Catalogue keys / categories | 57 / 8 |
| Test references to `monitor@` / `admin@` / `lender@` / `programme.admin@` | 135 / 46 / 29 / 16 |
| Test references to legacy projects LKK-402 / ABJ-108 / EDO-410 / KWR-502 / OGN-501 / KAN-210 / ENU-501 / OGN-305 | 21 / 13 / 12 / 6 / 5 / 3 / 2 / 0 |
| Test references to programme projects PRG-211 / 221 / 242 / 102 / 241 / 105 / 101 / 201 / 103 / 104 | 30 / 22 / 14 / 12 / 11 / 9 / 6 / 6 / 4 / 3 |
| Seed source | 15 files, ~4,000 lines (before R3–R6 additions) |

---

## 4. Decisions

Defaults below are the plan. Items marked **(confirm)** are reasonable defaults the owner may change; build the default unless told otherwise, and note it in section 12.

| ID | Decision |
| :--- | :--- |
| D-R7.1 | **Rename a key only where its noun is gone from the product.** `boq`, `schedule`, `reports`, `inspections`, `field`, `sessions`, `retention:manage_defects` go; keys whose noun still exists keep their key and get a new name/description (e.g. `projects:edit_baseline`, `tenant:manage_branding`, whose description still mentions "PDF valuation report headers"). Keeps call-site churn to what the model change demands. |
| D-R7.2 | **Final catalogue and categories as in section 5.** Categories follow the client's flow and the R6 navigation: `TENANT_ADMIN` (Workspace & access), `FORMS_FACILITIES` (new), `PORTFOLIO_PROJECTS`, `SCOPE_SPRINTS` (was `BOQ_SCHEDULE`), `CONTRACT_KICKOFF` (new: contractor, kick-off, milestones, defaults, documents), `VISITS_FINDINGS` (replaces `MOBILIZATION_ASSURANCE`, `FIELD_PRESENCE`, `REPORT_APPROVALS`), `PAYMENTS`, `COMPLETION_CLOSURE` (was `AUDIT_CLOSEOUT`). Prisma enum `PermissionCategory` changes with it. **(confirm)** category labels. |
| D-R7.3 | **Code owns the permission rows.** New `syncPermissionCatalog(db)` (`server/src/modules/rbac/permissionCatalog.ts`) upserts every catalogue entry by key (name, description, category, surface). It runs at server start (before jobs register), in the seed, and in `createTenantWithDefaults`. It never deletes: removals and renames are migration SQL, so role grants survive renames (same row id). The seed stops deleting and recreating `permissions`, so a route test can assert "database keys = catalogue keys" and catch a migration that forgot a removal. |
| D-R7.4 | **The 12 default roles of spec section 4**, codes: `TENANT_ADMIN`, `EXECUTIVE`, `PROGRAMME_MANAGER`, `PROJECT_OFFICER`, `ME_MANAGER`, `ME_OFFICER`, `RESIDENT_SUPERVISOR`, `INDEPENDENT_MONITOR`, `PROCUREMENT_OFFICER`, `FINANCE_OFFICER`, `LEGAL_OFFICER`, `AUDITOR`. Permission matrix in section 5.2. No separate "Reviewer" role: the Programme Authority's regional reps on co-funded projects get `ME_OFFICER` (spec 4 offers "M&E Officer or Reviewer"). **(confirm)** |
| D-R7.5 | **Resident Supervisor = M&E Officer permissions (decision P4)**, from one shared constant (`FIELD_OFFICER_PERMISSIONS`) so they cannot drift. Surfaces differ as the spec says: `ME_OFFICER` is `BOTH` (mobile first, web to view), `RESIDENT_SUPERVISOR` is `MOBILE`. Both persona `INDEPENDENT_VERIFIER`. A unit test asserts the two permission sets are equal. |
| D-R7.6 | **Tenant Admin keeps every permission.** `assertCallerHoldsAll` stops an admin granting what they lack, so the ICT admin of spec 4 must hold everything to manage every role. Code renamed `TENANT_SUPER_ADMIN` → `TENANT_ADMIN`, name "Tenant Admin". **(confirm)** the rename (touches `createTenantWithDefaults`, three tests, demo accounts). |
| D-R7.7 | **Visibility through the organisation tree, not separate HQ/regional roles.** Executive, Programme Manager and Project Officer hold `projects:view_organization_tree`: a user in the Programme Authority (root) sees every project, a user in Delivery Entity South sees South's. Central functions (M&E Manager, Procurement, Finance, Legal, Audit) hold `projects:view_all_tenant`. Field roles see assigned projects only. One role then serves both delivery models (the Chief Executive and the Regional Chief Executive are both `EXECUTIVE`). |
| D-R7.8 | **Separation of duties fixed in the defaults** (R1d follow-up: one Monitor could record and review the same handover): Project Officer / M&E Manager **record** the handover response, Programme Manager **reviews** it; Legal **reviews** a default case (`contracts:raise_default`, the chain's review step), Executive **decides** (`contracts:decide_default`); Finance **records** payments, nobody else; Auditor alone holds `closure:audit_signoff`. |
| D-R7.9 | **CoC signatories follow decision V/Q7**: default slots become Programme Manager (`roleCode: PROGRAMME_MANAGER`, scope `PROJECT_OWNER`), Procurement (`roleCode: PROCUREMENT_OFFICER`, scope `ANY`) and the beneficiary (paper copy). Replaces "Head of Physical Planning / Head of M&E" in `DEFAULT_COC_SIGNATORIES` and the seeded type configs. **(confirm)** with the client: does Procurement sign in every region, or the region's own procurement? |
| D-R7.10 | **New permission `closure:sign_file`** (Procurement "signs closure", Q7). Used as the item permission of a manual closure-checklist item "Closure file signed by Procurement" in both seeded types (checklist items already support `permissionKey`). **(confirm)**: alternative is no new key and reuse `completion:sign_certificate` for that item. |
| D-R7.11 | **Migrating existing tenants (SQL, one migration per slice)**: (a) permission renames are `UPDATE permissions SET key = …` (row id kept, so every role holding it, default or custom, keeps it); (b) merges (two old keys → one new) re-point `role_permissions` with `INSERT … ON CONFLICT DO NOTHING` then delete the old row; (c) a replaced key with no rename (e.g. one R4 left as a legacy alias) grants its replacement to every role that held it, then is deleted; (d) pure removals delete the row (cascade). Custom roles are therefore mapped by the key map in section 5.3, never by guessing from role names. (e) Role codes: `UPDATE roles SET code/name/description` on system-default roles per section 5.4; existing permissions follow (a)–(d). (f) Missing default roles are **not** inserted by SQL (that would duplicate the matrix); `ensureDefaultRoles(db, tenantId)` (replaces `provisionDefaultRoles`: creates missing defaults only, never edits an existing role) runs at start-up for every tenant. |
| D-R7.12 | **Keep the legacy KPMG tenant (`kpmg-nigeria`) as a test fixture, out of the demo.** Its logins and projects carry most route tests (`monitor@` alone appears 135 times); moving them to the programme tenant is a large rewrite with no product value. It shrinks: projects no test references are removed (today OGN-305; re-grep after R3–R6), `lto@` and the custom `LENDER_TECHNICAL_OFFICER` role go, users move to the new role codes (`monitor@` → M&E Manager, `lender@` → Finance Officer), the tenant is renamed "Test fixtures (legacy)" and its branding loses the lender wording. It never appears in the demo script or the login page's demo accounts. **(confirm)**; alternative: delete it and port the tests (estimate: every route test file). |
| D-R7.13 | **Programme tenant seed rewritten in its final form**, keeping the project codes and stage stories that tests and the demo rely on (PRG-101–105, PRG-201, PRG-211, PRG-221, PRG-241, PRG-242). Project types are written once with their complete config (visit plans, forms, closure rules, KPI targets): no more "merge without a version bump". Builders move to `server/src/db/programme/` (one file per stage, section 7); the fixture tenant's files move to `server/src/db/fixtures/` unchanged apart from role codes. Everything goes through the real services, as Phase 16 does. |
| D-R7.14 | **One demo login per role** (section 7.2), named after the role. Renamed logins: `flagship.admin@` → `programme.manager@`, `north.admin@` → `north.manager@`, `south.admin@` → `south.executive@` (South decides its default cases), `programme.monitor@` → `me.manager@`, `programme.funder@` → `finance@`. Kept: `programme.admin@`, `me.officer@`, `south.me@`, `resident.supervisor@`, `legal.officer@`. New: `executive@`, `project.officer@`, `independent.monitor@`, `procurement@`, `auditor@`. The few test references to renamed programme logins (north 3, south 2, flagship 2, funder 2, programme.monitor via `payloadFor`) are updated in the same slice. **(confirm)** names. |
| D-R7.15 | **Public marketing pages are removed, not rewritten** (`HomePage`, `AboutPage`, `MobileAppPage`, `PublicLayout`, `CitationRef`; `/`, `/about`, `/mobile-app` redirect to `/login`). They sell the lender/AI product (stale-term hits: About 31, Home 12, Mobile 2); a client-specific branch needs a sign-in page, not marketing. R1a assigned the rewrite to R6: if R6 already rewrote them, R7 only checks wording. **(confirm)** |
| D-R7.16 | **`Role.assuranceWeight` leaves the role editor and the default roles** (a lender-era corroboration weight; every default is 1.0 except the old resident, 0.85). The column and the session snapshot stay unless R4/R5 removed the evidence code that reads it (`evidence.service.ts`); then R7b drops them. |
| D-R7.17 | **Self-registration (demo mode only)** defaults to `PROJECT_OFFICER` instead of `MONITOR`: the lowest-risk web role that can still walk the demo. Still refused for any role holding a `TENANT_ADMIN` permission. |
| D-R7.18 | **Migrations** in the `202612250900xx` range: `20261225090000_r7a_permission_catalogue`, `20261225090001_r7b_role_catalogue`. Each starts with a hand-written data section (as R1b/R1d/R2d did) and keeps every hand-written index and CHECK listed in `CLAUDE.md` (check the diff for drops). |
| D-R7.19 | **Stored keys and role codes are rewritten in the same migration as the rename.** Permission keys (they contain `:` and are unique strings) may be replaced as quoted strings in JSON text; **role codes may not**, because `"MONITOR"` is also an organisation-scope value in CoC slots, milestone scopes and kick-off stakeholder groups. Role codes in JSON are rewritten by path only (`roleCode`, `roleCodes`, `supervisorRoleCodes`, and any R4 visit-plan role field). Section 6 lists the columns. |

---

## 5. The catalogue

### 5.1 Final permission catalogue

R3–R6 keys are written as *placeholders in italics*; R7a replaces them with the real keys from those plans (section 10). Surface: W web, M mobile, B both.

| Category | Key | Surface | Was |
| :--- | :--- | :--- | :--- |
| TENANT_ADMIN | `tenant:manage_branding`, `tenant:manage_settings`, `roles:create_edit`, `users:invite_manage`, `organizations:manage`, `regions:manage`, `project_types:manage`, `templates:manage_workflows`, `documents:manage_types` | W | unchanged (descriptions rewritten) |
| TENANT_ADMIN | `users:revoke_device` | W | `sessions:revoke_device` |
| FORMS_FACILITIES | `facilities:manage` | W | unchanged (category moves) |
| FORMS_FACILITIES | *R3 form-library permission(s)* | W | `inspections:manage_templates` |
| PORTFOLIO_PROJECTS | `projects:view_assigned`, `projects:view_all_tenant`, `projects:view_organization_tree`, `projects:view_portfolio`, `projects:create`, `projects:activate`, `projects:edit_baseline` (name "Edit project details and site"), `kpis:view` | W | unchanged |
| PORTFOLIO_PROJECTS | `projects:manage_standards_docs` | W | kept only if R3–R5 kept the standards reference files; otherwise deleted |
| SCOPE_SPRINTS | `scope:view` | B | `boq:view` |
| SCOPE_SPRINTS | `scope:edit` | W | `boq:upload_edit` |
| SCOPE_SPRINTS | `sprints:view_status` | W | `schedule:view_variance` |
| SCOPE_SPRINTS | *R4 sprint-verification permission* | W | new in R4 |
| CONTRACT_KICKOFF | `contractors:manage` | W | `contractors:manage_packages` |
| CONTRACT_KICKOFF | `milestones:manage`, `milestones:waive`, `kickoff:manage`, `contracts:raise_default`, `contracts:decide_default`, `documents:view`, `documents:upload` | W | unchanged (category moves) |
| VISITS_FINDINGS | *R4 visit-planning permission* | W | new in R4 |
| VISITS_FINDINGS | *R4 visit-submission permission* | B | `field:submit_report`, `inspections:submit` |
| VISITS_FINDINGS | *R4 visit-view permission* | B | `reports:view_all`, `inspections:view` |
| VISITS_FINDINGS | *R4 submission review/approval permission* | W | `reports:approve_completion`, `reports:raise_query` |
| VISITS_FINDINGS | `findings:manage` (or R4's name) | B | `inspections:manage_findings` |
| VISITS_FINDINGS | `defects:manage` | B | `retention:manage_defects` |
| VISITS_FINDINGS | `incidents:view_confidential` | W | kept only if incident reports survive R4/R5 |
| PAYMENTS | `payments:view`, `payments:record` | W | unchanged |
| COMPLETION_CLOSURE | `completion:draft_certificate`, `completion:sign_certificate`, `completion:revoke_certificate`, `handover:record_response`, `handover:review_feedback`, `closure:manage_checklist`, `closure:audit_signoff`, `closure:export_pack`, `contractors:rate_performance`, `lessons:manage`, `lessons:view`, `audit:view_ledger` | W | unchanged (category moves) |
| COMPLETION_CLOSURE | `closure:sign_file` | W | new (D-R7.10) |

**Deleted outright:** `field:raise_incident` (no call site), `reports:respond_query` (contractor-side query answers; no contractor login), any R3–R6 legacy alias left "until R7". Shared constants follow: `REPORT_APPROVAL_PERMISSION_KEY` points at the R4 review key; `WebNotification.targetPermissionKey` default (`"reports:view_all"` in Prisma) becomes the R4 view key.

### 5.2 Default role matrix

TA Tenant Admin · EX Executive · PM Programme Manager · PO Project Officer · MM M&E Manager · MO M&E Officer and Resident Supervisor (identical, D-R7.5) · IM Independent Monitor · PR Procurement Officer · FI Finance Officer · LE Legal Officer · AU Auditor. TA holds every permission (D-R7.6) and is omitted below.

| Permission | EX | PM | PO | MM | MO | IM | PR | FI | LE | AU |
| :--- | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: | :-: |
| `users:revoke_device` | | | | ● | | | | | | |
| `project_types:manage` | | | | ● | | | | | | |
| `facilities:manage`, *R3 forms* | | | | ● | | | | | | |
| `projects:view_assigned` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `projects:view_all_tenant` | | | | ● | | | ● | ● | ● | ● |
| `projects:view_organization_tree` | ● | ● | ● | | | | | | | |
| `projects:view_portfolio` | ● | ● | ● | ● | | | ● | ● | | ● |
| `projects:create`, `projects:edit_baseline` | | | ● | | | | | | | |
| `projects:activate` | | ● | | | | | | | | |
| `projects:manage_standards_docs` (if kept) | | | ● | ● | | | | | | |
| `kpis:view` | ● | ● | ● | ● | | | ● | ● | | ● |
| `scope:view` | ● | ● | ● | ● | ● | ● | ● | ● | | ● |
| `scope:edit` | | | ● | | | | | | | |
| `sprints:view_status` | ● | ● | ● | ● | | | | ● | | |
| *R4 sprint verification* | | | | ● | | | | | | |
| `contractors:manage` | | | ● | | | | ● | | | |
| `milestones:manage` | | ● | ● | | | | ● | | | |
| `milestones:waive` | | ● | | | | | | | | |
| `kickoff:manage` | | ● | ● | | | | | | | |
| `contracts:raise_default` | | ● | | | | | | | ● | |
| `contracts:decide_default` | ● | | | | | | | | | |
| `documents:view` | ● | ● | ● | ● | ● | ● | ● | ● | ● | ● |
| `documents:upload` | | ● | ● | ● | | | ● | | ● | |
| *R4 visit planning* | | | | ● | | | | | | |
| *R4 visit submission* | | | | ● | ● | ● | | | | |
| *R4 visit view* | ● | ● | ● | ● | ● | ● | | | | ● |
| *R4 review / approval* | | | | ● | | | | | | |
| `findings:manage` | | | | ● | ● | | | | | |
| `defects:manage` | | | | ● | ● | | | | | |
| `incidents:view_confidential` (if kept) | | | | ● | | | | | | |
| `payments:view` | ● | ● | | | | | ● | ● | | ● |
| `payments:record` | | | | | | | | ● | | |
| `completion:draft_certificate` | | | ● | ● | | | | | | |
| `completion:sign_certificate` | | ● | | | | | ● | | | |
| `completion:revoke_certificate` | | ● | | | | | | | | |
| `handover:record_response` | | | ● | ● | | | | | | |
| `handover:review_feedback` | | ● | | | | | | | | |
| `closure:manage_checklist` | | | | ● | | | | | | |
| `closure:sign_file` | | | | | | | ● | | | |
| `closure:audit_signoff` | | | | | | | | | | ● |
| `closure:export_pack` | | | | ● | | | | | | ● |
| `contractors:rate_performance` | | ● | | ● | | | ● | | | |
| `lessons:manage` | | | | ● | | | | | | |
| `lessons:view` | ● | ● | ● | ● | | | ● | ● | ● | ● |
| `audit:view_ledger` | ● | ● | | ● | | | | | ● | ● |

| Role | Surface | Persona | Notes |
| :--- | :--- | :--- | :--- |
| Tenant Admin | W | NONE | every permission |
| Executive, Programme Manager, Project Officer, M&E Manager, Procurement, Finance, Legal, Auditor | W | NONE | |
| M&E Officer | B | INDEPENDENT_VERIFIER | web is read-only by permissions |
| Resident Supervisor | M | INDEPENDENT_VERIFIER | same permissions as M&E Officer |
| Independent Monitor | M | INDEPENDENT_VERIFIER | own organisation; ad hoc and assigned visits; does not resolve findings or close defects **(confirm)** |

Open points in the matrix, each **(confirm)**: Programme Manager (not Project Officer) activates drafts; M&E Manager holds `project_types:manage` (spec 4: "sets visit plans per project type"; the type editor has no per-group permission); Procurement holds `milestones:manage` for award and contract dates.

### 5.3 Key map used by the migration (D-R7.11)

| Old key | New key | Kind |
| :--- | :--- | :--- |
| `boq:view` | `scope:view` | rename |
| `boq:upload_edit` | `scope:edit` | rename |
| `schedule:view_variance` | `sprints:view_status` | rename |
| `contractors:manage_packages` | `contractors:manage` | rename |
| `sessions:revoke_device` | `users:revoke_device` | rename |
| `retention:manage_defects` | `defects:manage` | rename |
| `inspections:manage_findings` | `findings:manage` (or R4's key) | rename (or merge if R4 already added the new key) |
| `inspections:manage_templates` | R3 form-library key | merge if R3 added it; else rename |
| `field:submit_report`, `inspections:submit` | R4 submission key | merge |
| `reports:view_all`, `inspections:view` | R4 view key | merge |
| `reports:approve_completion`, `reports:raise_query` | R4 review key | merge |
| `field:raise_incident`, `reports:respond_query` | – | delete |

If R3/R4 already removed some of these keys, their rows are absent and the statements are no-ops; write them with `WHERE key = …` so they are.

### 5.4 Role-code map (system-default roles only)

| Old code | New code | Note |
| :--- | :--- | :--- |
| `TENANT_SUPER_ADMIN` | `TENANT_ADMIN` | |
| `MONITOR` | `ME_MANAGER` | today's "Independent Monitor" web role is the M&E lead |
| `LENDER` | `FINANCE_OFFICER` | |
| `ORGANIZATION_ADMIN` | `PROGRAMME_MANAGER` | org-tree owner |
| `MONITOR_INSPECTOR` | `INDEPENDENT_MONITOR` | |
| `INDEPENDENT_RESIDENT` | `RESIDENT_SUPERVISOR` | |
| custom `LEGAL_OFFICER` (seeded) or any custom role already using a new code | same code | adopted: `isSystemDefault = true`, permissions kept |

A custom role whose code clashes with a new default code in another way does not exist today; the migration refuses (raises) rather than renaming silently. Remapped roles keep their (renamed) permissions; they are not reset to the matrix. A new **"Reset to default permissions"** action on system-default roles (`POST /api/v1/rbac/roles/:id/reset-defaults`, `roles:create_edit`, audit `ROLE_RESET_TO_DEFAULT` in both enums, escalation guard applies) lets an admin align them. **(confirm)**: alternative is resetting every system-default role in the migration, losing tenant edits.

---

## 6. Stored keys and codes the migrations rewrite (D-R7.19)

| Table.column | Holds | R7a (keys) | R7b (codes) |
| :--- | :--- | :-: | :-: |
| `approval_steps.requiredPermissionKey` | step permission | ● | |
| `web_notifications.targetPermissionKey` (+ Prisma default) | audience | ● | |
| `document_types.signOffPermissionKey` | sign-off permission | ● | |
| `contract_milestones.requiresSignOffPermissionKey` | sign-off permission | ● | |
| `workflow_templates.configJson` | chain steps | ● | |
| `project_types.configJson`, `projects.projectTypeSnapshotJson` | CoC slots, closure checklist items, R4 visit plan; `supervisorRoleCodes`, slot `roleCode`, any role field R4 adds | ● | ● (by path) |
| `completion_certificates.slotsJson` | copied slots | ● | ● (`roleCode` by path) |
| Any R3/R4 table storing a permission key or role code | per R3/R4 section 9 | ● | ● |

`field_agent_sessions.roleNameSnapshot` and audit rows are history and stay as written.

---

## 7. Seed

### 7.1 Structure (D-R7.12, D-R7.13)

| Path | Contents |
| :--- | :--- |
| `server/src/db/seedDatabase.ts` | `runSeed`: reset list (no longer deletes `permissions`), `syncPermissionCatalog`, then fixtures, then programme; prints every demo login |
| `server/src/db/fixtures/` | The legacy tenant (today `seedDatabase.ts` body, `seedPhase6/7/10.ts`, the LKK/ABJ parts of `seedR2.ts`, `seedPayments.ts` helpers), role codes updated, unused projects removed |
| `server/src/db/programme/tenant.ts` | Tenant, regions, organisations (Programme Authority, Delivery Entity North/South, an accredited M&E firm, contractors), users per role, facilities, forms (R3), both project types with complete config |
| `server/src/db/programme/projects.ts` | Project table (code, type, region, owner, stage) and drafts |
| `server/src/db/programme/{kickoff,construction,payments,completion,closure,kpis}.ts` | Stage builders through the real services: kick-off and mobilisation; sprints, scheduled visits, submissions, findings, sprint verification (R4); payments; CoC and handover; closure, ratings, lessons, archive and pack; KPI snapshots |
| `server/src/db/seedFieldAccounts.ts` | Kept (provisioned mobile accounts) |

The seed header table (one row per project: model, region, stage, what the demo shows) moves to `programme/projects.ts`.

### 7.2 Demo programme and logins

Project codes and stages stay as today (Phase 16 table), re-expressed in the new model:

| Stage | Central | Co-Funded |
| :--- | :--- | :--- |
| Draft (workbook imported, kick-off planned) | PRG-101 | PRG-201 |
| Mobilising (mobilisation check visits scheduled) | PRG-102 (on time) | PRG-221 (overdue, default case at the executive decision) |
| Construction: sprints, visit calendar, submissions, open finding re-checked on the next visit | PRG-105 (sprint 3 of 3, interim payment recorded) | PRG-211 (late sprint, missed visit, finding escalated) |
| Completion | PRG-104 (CoC signed by the Programme Manager, waiting for Procurement and the beneficiary) | – |
| Liability period | PRG-103 (defects from snags, re-checked on a visit) | – |
| Closed / archived | – | PRG-241 (post-closure evaluation visit and audit pending), PRG-242 (archived, closure pack) |

Logins (`@insite.ng`, `Password123!`):

| Role | Login | Organisation | Used in the demo for |
| :--- | :--- | :--- | :--- |
| Tenant Admin | `programme.admin@` | Programme Authority | settings, roles, facilities |
| Executive (Chief Executive) | `executive@` | Programme Authority | portfolio, KPIs |
| Executive (Regional CE, South) | `south.executive@` | Delivery Entity South | PRG-221 default decision |
| Programme Manager | `programme.manager@` | Programme Authority | kick-off, CoC signature, handover review |
| Programme Manager, North | `north.manager@` | Delivery Entity North | visibility contrast |
| Project Officer | `project.officer@` | Programme Authority | draft, workbook import, activation hand-off |
| M&E Manager | `me.manager@` | Programme Authority | visit planner, form library, sprint verification, approvals |
| M&E Manager, South | `south.me@` | Delivery Entity South | Co-Funded approvals, final evaluation |
| M&E Officer | `me.officer@` | Programme Authority | mobile visits; web view; over the site limit |
| Resident Supervisor | `resident.supervisor@` | Programme Authority | mobile, one active project (card opens fully) |
| Independent Monitor | `independent.monitor@` | accredited M&E firm | ad hoc visit |
| Procurement Officer | `procurement@` | Programme Authority | CoC and closure-file signature |
| Finance Officer | `finance@` | Programme Authority | payments |
| Legal Officer | `legal.officer@` | Programme Authority | default case review |
| Auditor | `auditor@` | Programme Authority | PRG-241 audit sign-off |

`web/src/config/demoAccounts.ts` lists these (behind the demo flag), not the fixture tenant's `admin@`/`monitor@`/`lender@`/`lto@`. `admin@` stays the platform super admin (fixture tenant) for tenant provisioning; the demo script mentions it only under "Before the demo" if needed.

---

## 8. Implementation checklist

### R7a: Permission catalogue
- [ ] Baseline (section 3) recorded in section 12; section 10 filled with the real R3–R6 keys, audit actions, seed files and test files.
- [ ] Shared: categories and `PERMISSION_CATEGORY_META` per D-R7.2; catalogue per section 5.1 with rewritten names and descriptions (no BOQ, hold points, tranches, valuation, executive matrix, contractor wording); `closure:sign_file`; constants in `process.schema.ts`; delete `ProfessionalLicenseTypeEnum` and `PROFESSIONAL_LICENSE_META` (no reader since R1d; verify by grep). Default roles keep their old codes in this slice, with renamed keys.
- [ ] Prisma: `PermissionCategory` enum; `WebNotification.targetPermissionKey` default. Migration `20261225090000_r7a_permission_catalogue`: hand-written data section first (section 5.3 renames, merges, deletes; section 6 key rewrites), then the generated enum change (update rows to new categories before the old values are dropped).
- [ ] Server: `syncPermissionCatalog` (D-R7.3) called at start-up (`server/src/index.ts`, before `registerAllJobs()`), in the seed and in `createTenantWithDefaults`; the seed's reset list no longer deletes `permissions`. Rename every call site (per-key file counts on 2026-11-24, before R3–R6: `boq:view` server 3 / web 3 / tests 3; `boq:upload_edit` server 1 / web 2; `schedule:view_variance` server 1 / tests 1; `contractors:manage_packages` server 1; `sessions:revoke_device` server 3 / web 1; `retention:manage_defects` server 2 / web 4 / mobile 2 / tests 2; `inspections:manage_findings` server 2 / web 3 / mobile 2; re-count at the start).
- [ ] Web and mobile: `hasPermission` keys renamed; role editor groups by the new categories (`CATEGORY_ORDER` in `RolesPermissionsTab.tsx`).
- [ ] Tests: `rbac.phase1.test.ts` (every category used, no duplicates) passes on the new catalogue; new route test (`routes.r7.test.ts`): after seed, permission keys in the database equal the catalogue; a migrated permission row keeps its id and its grants (simulate: rename via the same SQL on a scratch role); a custom role holding `boq:view` holds `scope:view` afterwards; stored keys in a type config and an approval step are rewritten; `KNOWN_PERMISSION_KEYS` rejects an old key in a workflow template save.

### R7b: Default roles
- [ ] Shared: `DEFAULT_TENANT_ROLES` = the 12 roles (section 5.2) built from named constants (`FIELD_OFFICER_PERMISSIONS`, …); `assuranceWeight` removed from `DefaultRoleDefinition` (D-R7.16); `DEFAULT_COC_SIGNATORIES` per D-R7.9; `WebRegisterRequestSchema.roleCode` default `PROJECT_OFFICER` (D-R7.17).
- [ ] Prisma: audit action `ROLE_RESET_TO_DEFAULT` (both enums). Migration `20261225090001_r7b_role_catalogue`: section 5.4 role-code updates (system defaults only; adopt custom roles with a new default code; raise on any other clash), role-code JSON rewrites by path (section 6).
- [ ] Server: `ensureDefaultRoles` replaces `provisionDefaultRoles` (create missing defaults only), called at start-up for every tenant, in `createTenantWithDefaults` (admin gets `TENANT_ADMIN`) and the seed; `POST /rbac/roles/:id/reset-defaults`; `registerWebUser` fallback code.
- [ ] Web: role editor without the assurance-weight control; "Reset to default permissions" on system-default roles; `AuditLedgerPage` stops inferring actor kind from `"MONITOR"`/`"LENDER"` in actor strings (use `actorType`; `CLAUDE.md`: never infer roles from names or codes); organisation tag `FINANCIER_LENDER` labelled "Funder" (value kept).
- [ ] Tests: unit: 12 roles, unique codes, every key in the catalogue, `ME_OFFICER` and `RESIDENT_SUPERVISOR` sets equal, Tenant Admin holds every key, Finance is the only non-admin with `payments:record`, Auditor the only one with `closure:audit_signoff`, no role holds both `handover:record_response` and `handover:review_feedback` except TA. Route: a migrated tenant gets the missing default roles at start-up without its edited roles changing; reset-defaults (escalation guard, audit); `LAST_TENANT_ADMIN` still holds after the code rename.

### R7c: Seed and demo logins
- [ ] Fixture tenant per D-R7.12 (move, rename, shrink, role codes); re-grep tests for every project and login before removing it.
- [ ] Programme tenant per D-R7.13 and section 7 (structure, stage table, logins); types written once in final form; every builder through the real services; seed dates relative to the seed day.
- [ ] `demoAccounts.ts` per section 7.2; seed prints the login table.
- [ ] Update route tests that assert seed contents or use renamed logins (`north.admin@`, `south.admin@`, `flagship.admin@`, `programme.funder@`, `programme.monitor@`; fixture `lto@`); keep the assertions' meaning.
- [ ] `npm run prisma:seed` twice in a row succeeds (idempotent reset); `server/src/tests/helpers/testDb.ts` template still builds.

### R7d: Docs and public pages
- [ ] `demo_script_programme_delivery.md` rewritten end to end for the new model: before the demo; logins (7.2); opening on the portfolio; Central storyline (Project Officer imports the workbook into PRG-101 → Programme Manager activates and runs kick-off → M&E Manager plans visits → M&E Officer on mobile: calendar, check-in, form with per-unit photos, site log → M&E Manager approves, finding raised and re-checked on the next visit, sprint verified → Finance records a payment → CoC: Programme Manager and Procurement sign, beneficiary paper copy → handover recorded and reviewed → defects); Co-Funded storyline (ownership and visibility with `north.manager@`, PRG-221 default: Legal reviews, `south.executive@` decides; PRG-211 late sprint and escalated finding; PRG-241/242 closure, audit by `auditor@`, closure pack); KPIs (spec section 11 list); configuration live (forms and facilities, type editor groups, roles matrix); recovery notes. Mark it "Not yet rehearsed" until a browser dry run is done.
- [ ] `configuration_reference.md` rewritten for the new model: tenant settings, facility catalogue, form library, project type groups (Kick-off & mobilisation, Monitoring, Completion & closure, KPI targets, Advanced), project settings (5 setup steps), the permission catalogue and role matrix (section 5) replacing the "added in Phases 11–16" list, KPI catalogue as R4 left it, questions for the client (Q-G, Q-H, D-R7.4/9/10/12 confirms). Removed-permission history collapses to one table "renamed or removed in the redesign" (section 5.3).
- [ ] `CLAUDE.md` rewritten: one-line description (programme delivery monitoring, not "drawdown reconciliation"); workspace table; the redesign paragraph (R1–R7 done; `client_flow_redesign.md` is the spec); architecture paragraphs reorganised around the new model (scope and sprints, forms, visits and findings, mobile, payments, completion and closure, KPIs) with the superseded Phase 7–9/14 text removed; roles and permissions paragraph (catalogue, `syncPermissionCatalog`, `ensureDefaultRoles`, key-rename rule D-R7.11/19); seed paragraph rewritten from section 7 (fixture tenant vs demo programme, logins); hand-written SQL list re-checked against the migrations; verification bar updated.
- [ ] Public pages per D-R7.15 (or a wording check if R6 rewrote them).
- [ ] Docs audit: `Project Context/project_context_current.md` describes the lender product: replace its header with a pointer to `client_flow_redesign.md` and mark the rest historical **(confirm)**: or rewrite it as a 1–2 page product summary; add a one-line "historical: superseded by the redesign" note at the top of `saas_implementation_plan.md` decisions that the redesign replaced (B, D, K, N, O) and of `process_flow_gap_analysis.md`; leave phase files as history. Grep the repo (excluding phase files and migrations) for `lender`, `IPC`, `tranche`, `valuation`, `join code`, `AI`, `brief`, `hold point`, `BOQ`, `Clerk of Works`, `MONITOR_INSPECTOR`, `LENDER`, `TENANT_SUPER_ADMIN` and fix or list each hit in section 12 (known today: `ProjectPhaseBanner` stakeholder link text, `ArchiveProjectDialog` IPC text, `WorkspaceSettingsCard`, `OrganizationsTab`, `ClosureRulesEditor`, `CompletionSection`, `ClosureChecklistPanel`).
- [ ] This file: section 12 per slice, verification numbers.

---

## 9. Out of scope

New product behaviour (R3–R6 own it); the Needs Assessment module; per-group permissions inside the project type editor; a production-grade audit-chain re-seal for rows deleted by earlier migrations (decision A: dev DB is disposable); renaming legacy internal names that R3–R5 did not reach (listed in section 12 instead); browser click-through itself (owed; recorded in section 12).

---

## 10. Dependencies on R3–R6 (fill at the start of R7a)

| From | R7 needs | Filled in |
| :--- | :--- | :--- |
| R3 | Form-library permission key(s); whether `inspections:manage_templates` was removed or left as an alias; checklist-template tables gone or kept; form/sub-form seed builders to call from `programme/tenant.ts` | `forms:manage`; `inspections:manage_templates` removed in R3e (the R7a migration still deletes it if present); checklist templates deleted in R5f; library provisioned by `provisionDefaultFormLibrary` / `seedR3.ts` |
| R4 | Keys for visit planning, submission, view, review/approval, findings, sprint verification; which of `field:submit_report`, `reports:*`, `inspections:*`, `schedule:view_variance` remain; tables/JSON storing permission keys or role codes (visit plan defaults, officer assignment); whether workday reports, incident reports, standards docs and `assuranceWeight` readers survive; KPI catalogue after R4; seed builders for visits, submissions, findings, verification | `visits:view`, `visits:plan`, `visits:submit`, `sprints:verify`, `findings:receive_escalations`. R4 added **no** review or findings key: visit review used `reports:approve_completion` (chain step), findings `inspections:manage_findings`; R7a renamed them `visits:review` and `findings:manage`. All `reports:*`, `inspections:*`, `field:*` and `schedule:view_variance` were still in the catalogue. No R4 table stores a permission key; role codes only in `supervision.supervisorRoleCodes` and CoC slots. Workday reports gone (R5f); incident reports and standards docs survive (keys kept: `incidents:view_confidential`, `projects:manage_standards_docs`); `assuranceWeight` column still present |
| R5 | Mobile `hasPermission` keys and the persona copy; whether mobile still reads `field:submit_report`; device revocation UI | Mobile reads only `retention:manage_defects` (`utils/defects.ts`), renamed `defects:manage`; no `field:submit_report` reader |
| R6 | Navigation labels (category names should match); 5-step setup step ids (demo script, config reference); whether the public pages were rewritten (D-R7.15); payment and Overview pages for the demo script; type editor groups | No new keys (D-R6.27); nav gates in `web/src/navigation/navItems.ts` renamed; category labels match the nav ("Scope & sprints", "Forms & facilities"). Public pages, demo script: R7d, not done |
| R3–R6 | New audit actions and their test files (so R7 tests do not collide); test files added to `server/package.json` lists; current test counts | R7 test files: `permissions.r7a.test.ts`, `webSignIn.r7.test.ts` (unit), `routes.r7a.test.ts`, `routes.r7b.test.ts` (routes). Counts in 12.3 |

---

## 11. Definition of done

- Four slices merged in order, each green at the time: `npm run typecheck` clean, `npm run lint` 0 errors, web build passes, server unit + route and mobile tests pass.
- On a database migrated from before R7 and **not** reseeded: every catalogue key exists, no removed key remains, custom roles hold the renamed keys, the six old default roles carry the new codes, the six new default roles exist after start-up, stored keys and role codes in configs and slots resolve.
- `npm run prisma:seed` succeeds; every demo login in section 7.2 signs in and lands where the demo script says.
- Demo script, configuration reference and `CLAUDE.md` describe only the new model; docs audit hits fixed or listed.
- Web verified at least by typecheck, build and lint; note any browser click-through done or still owed.

---

## 12. Found during implementation

### 12.1 Owner decisions (2026-11-25)

| Topic | Decision | Effect on this plan |
| :--- | :--- | :--- |
| Seed (R7c, D-R7.12/13) | Do R7a and R7b now; the seed follows `next_steps/seed_replacement_plan.md` later (delete the first tenant, not keep it as a fixture). | R7c not started here; D-R7.12 superseded. |
| Roles (D-R7.4–7.6, 7.8 roles, 7.9, 7.10, 7.11e/f, 7.14, 7.16, 7.17, section 5.2, 5.4, 7.2) | Keep the six UBEC roles the owner already chose (`seedUbecRoster.ts`), codes unchanged. After the demo more roles may appear; the full role migration is done once the role list is known. | Not built. Written up in `next_steps/role_catalogue_migration_plan.md`. The R7 login table (7.2, `@insite.ng`) is obsolete: demo logins are the UBEC roster, `saas_updates/demo_accounts.md`. |
| Separation of duties (D-R7.8, handover) | Roles unchanged; the server refuses a review by the person who recorded the handover response (409 `SAME_PERSON_REVIEW`). | R7b, done. |
| Mobile-only web sign-in (`next_steps/resident_supervisor_web_login.md`) | Build now. `MOBILE` roles refused on the web (403 `WEB_ACCESS_NOT_ALLOWED`, existing tokens too); `BOTH` roles use the same credentials on web and phone. | R7b, done. |

### 12.2 R7a as built

- **Catalogue** (`shared/src/enums.ts`): 56 keys (62 before: 15 legacy keys renamed, merged or removed; 9 new names, incl. `visits:review` and `incidents:view`) in the eight categories of D-R7.2 (labels: Workspace & access, Forms & facilities, Portfolio & projects, Scope & sprints, Contract & kick-off, Visits & findings, Payments & retention, Completion & closure; default labels kept). Names and descriptions rewritten (no BOQ, hold point, tranche, valuation, whistleblower, AI or contractor-side wording; a unit test enforces it). `ProfessionalLicenseTypeEnum` / `PROFESSIONAL_LICENSE_META` deleted (no reader).
- **Key map** (section 5.3 with the real keys; also `RENAMED_PERMISSION_KEYS` in shared): `boq:view` → `scope:view`, `boq:upload_edit` → `scope:edit`, `schedule:view_variance` → `sprints:view_status`, `contractors:manage_packages` → `contractors:manage`, `sessions:revoke_device` → `users:revoke_device`, `retention:manage_defects` → `defects:manage`, `inspections:manage_findings` → `findings:manage` (rename: R4 added no findings key), `reports:approve_completion` → **`visits:review`** (new name; R4 added no review key), `field:submit_report` + `inspections:submit` → `visits:submit` (merge), `reports:view_all` + `inspections:view` → `visits:view` (merge); removed `field:raise_incident`, `reports:respond_query`.
- **Deviation from 5.3:** `reports:raise_query` → new key **`incidents:view`**, not merged into the review key. Its only remaining use was the incident list and incident alerts; merging it into `visits:review` would have let the UBEC Independent M&E (holds raise_query, not approve) approve visit submissions. With the rename no role gains or loses anything.
- **Kept keys:** `projects:manage_standards_docs` (standards reference files survive), `incidents:view_confidential` (incidents survive on mobile).
- **Not built:** `closure:sign_file` (D-R7.10) and the CoC signatory change (D-R7.9): both tie to the deferred Procurement role; listed in the role migration plan.
- **Migration** `20261225090000_r7a_permission_catalogue`: hand-written data section with `pg_temp.r7_move_permission` (rename keeps the row id when the new key is absent; otherwise grants move with `ON CONFLICT DO NOTHING` and the old row is deleted) and `pg_temp.r7_rewrite_key` (columns `approval_steps.requiredPermissionKey`, `web_notifications.targetPermissionKey`, `document_types.signOffPermissionKey`, `project_contract_milestones.requiresSignOffPermissionKey`; JSON of `workflow_templates.configJson`, `project_types.configJson`, `Project.projectTypeSnapshotJson`, `completion_certificates.slotsJson`, as quoted strings), then the enum change with a `CASE` mapping old categories (final categories come from the sync). No hand-written index or CHECK touched. Applied to the dev DB (migrated, not reseeded): row ids kept, `scope:view` 13 grants, `visits:view` 13 roles (union of the three merged keys), 18 approval steps now `visits:review`.
- **`syncPermissionCatalog`** (`server/src/modules/rbac/permissionCatalog.ts`): upsert by key, writes only changed rows, never deletes. Called at server start before `registerAllJobs` (`server/src/index.ts` now starts in an async `start()`), in the seed (which no longer deletes `permissions`) and in `createTenantWithDefaults`.
- **Call sites** renamed in server, web (incl. `RolesPermissionsTab` `CATEGORY_ORDER`, nav gates) and mobile (`utils/defects.ts`); duplicates from merges removed (`DEFAULT_TENANT_ROLES` and `tailorUbecRoles` also de-duplicate); dead `assurance:review_credentials` check dropped from `serializers.ts`. Prisma `WebNotification.targetPermissionKey` default is `visits:view`.
- **Tests:** `permissions.r7a.test.ts` (categories, no legacy key, rename targets exist, no stale wording, default roles only catalogue keys without duplicates, every key checked in server/web/mobile code is in the catalogue, chains refuse a legacy key); `routes.r7a.test.ts` (database keys = catalogue after seed and sync is a no-op; a seeded M&E officer holds the new keys; migration replay on legacy rows: rename keeps the id and the custom role's grant, merge moves the grant, removal deletes, stored keys rewritten in an approval step, a document type and a type config).

### 12.3 Verification

| Gate | Result |
| :--- | :--- |
| Baseline | Not re-measured: the working tree carried uncommitted web work (forms rebrand) before R7 started; the full gate below covers both. |
| R7a unit (`permissions.r7a`, `rbac.phase1`) | 13 / 13 pass |
| R7a route (`routes.r7a`) | 3 / 3 pass |
| Full gate after the owner decisions (2026-11-25: liability-period close gate, lessons KPI on the closeout report) | typecheck clean; lint 0 errors / 45 warnings; web build passes; server 186 unit + 327 route pass; mobile 147 pass; seed twice OK |
| Full gate after the second pass (2026-11-25: findings rename, public pages, template, demo pack, seed registers, PRG-106) | typecheck clean; lint 0 errors / 45 warnings; web build passes; server 186 unit + 327 route pass (incl. `routes.demo.test.ts`); mobile 147 pass; seed twice OK; `demo:pack` OK |
| Full gate after R7a + R7b (2026-11-25) | typecheck clean; lint 0 errors / 45 warnings; web build passes; server 183 unit + 318 route pass; mobile 147 pass; `npm run prisma:seed` twice in a row succeeds |

### 12.4 Left open

- R7c seed (see `next_steps/seed_replacement_plan.md`) and the role parts of R7b (see `next_steps/role_catalogue_migration_plan.md`).
- ~~R7d: demo script rewrite, public pages, project context header, docs audit~~: done in the second R7 pass (section 12.5).
- ~~`InspectionFinding` → `Finding` rename~~: done in the second R7 pass (section 12.5).

### 12.5 Second pass (2026-11-25, owner: "go ahead with the remaining open items")

- **Findings:** migration `20261225090001_r7_findings_rename`: model `Finding`, table `findings`, enums `FindingSeverity` / `FindingStatus`, back-relations `Project.findings` and `ProjectContractor.findings`; column `inspectionId` and CHECK `inspection_findings_source_check` dropped; `visitSubmissionId` NOT NULL (both creation paths set it). Hand-written ALTER/RENAME (data kept); `prisma migrate diff` empty afterwards. Shared DTO names, service function names, audit actions `INSPECTION_FINDING_*` and the audit payload key are unchanged (the ledger is hash-chained). PostgreSQL 18 not-null constraint names keep the old prefix (Prisma does not compare them).
- **Public pages (D-R7.15):** `HomePage`, `AboutPage` and `CitationRef` were already gone; `MobileAppPage` and `PublicLayout` deleted; `/`, `/about`, `/mobile-app` redirect to `/login` (signed in: `/app`); the user-menu "Mobile app" link removed.
- **Docs audit:** `project_context_current.md`, `process_flow_gap_analysis.md` and decisions B, D, K, N, O of `saas_implementation_plan.md` marked historical; `CLAUDE.md` description and product-background pointer rewritten. Web wording sweep: "lender" → "funder" in Organisations and Workspace settings; the audit ledger no longer infers actor kinds from role-code substrings (uses `actorType`). Left on purpose: code comments, field identifiers (`lenderOrganizationId`), "evaluation" false positives for "valuation", the kick-off "Briefing pack", and the live closure setting "Show contractor ratings to the contractor" (contractor-side branches, to remove with the seed replacement).
- **UI:** `Loader` is centred with top padding by default (`inline` opt-out, used in 12 already-centred wrappers); the document register offers "Sign off" only when the type needs a sign-off, the caller may sign and has not, and the document is not archived (`components/documents/documentSignOff.ts`). The server's `canSign` now also requires `requiresSignOff`.
- **Needs assessment template:** user-facing name for the workbook ("UBEC needs assessment template.xlsx", "<code> needs assessment.xlsx"); UBEC styling (title band, header row 3, banded rows, borders, number and date formats, locked Amount formula); the parser finds the header row in the top 10 rows, so pre-R7 files still import. Sheet names, headers and `SCOPE_WORKBOOK_VERSION` unchanged.
- **Demo (R7d):** `demo_script_programme_delivery.md` rewritten as a story (one school, PRG-110 live, then PRG-104 and PRG-106); `saas_updates/demo_pack/` (`npm run demo:pack`): needs assessment with dates relative to the run day and 13 specimen PDFs; `routes.demo.test.ts` walks the whole demo through the API; seed: specimen PDFs for every seeded document, coherent registers per stage, PRG-106 closure twin.
- **Found in the dry run and fixed:** closure rules required "Lessons learned published", but the project page has no lessons panel (the closeout report carries lessons for UBEC): item removed from both types' seeded rules. The beneficiary's signed paper copy sat at "Awaiting sign-off" (filed as a Certificate of Completion document): the recording officer's attestation now signs it off (`registerUploadedDocumentTx` `signOff`). Form label "Workmanship acceptable on all 1 toilet" → "Workmanship acceptable ({count} {facility})".
- **Owner decisions on the dry-run findings (2026-11-25):** (1) closing waits for the end of the defects liability period: `checkTransition` refuses `COMPLETED_CLOSED` while today (project zone) is before `retentionEndDate`, checked first, not overridable; the seed ends PRG-241's and PRG-242's periods yesterday just before closing them (seed-only shortcut, commented; PRG-106 has a real 12-month history); tests: `routes.phase15` (refused 30 days before, then the closure items), `routes.demo` 6b. (2) The Overview stage moving to Construction once the contractor is confirmed on site is accepted as is. (3) KPI `lessons_documented` counts closed projects with the closeout report filed (the report carries the lessons); the published-lessons fact stays loaded but unused. Still open: the kick-off minutes milestone is completed by hand.
