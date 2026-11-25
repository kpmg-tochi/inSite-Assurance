# Next step: full role catalogue migration

**Raised:** 2026-11-25 (owner). **Status:** deferred until the client's full role list is known after the demo. Nothing here is implemented.

**Read with:** `saas_updates/redesign_r7_implementation_plan.md` (sections 4–7; many decisions are reused here), `seed_replacement_plan.md` (this work runs in the same pass), `saas_updates/demo_accounts.md` (today's logins).

---

## 1. Why it is deferred

Owner decisions on 2026-11-25:

| Decision | Effect |
| :--- | :--- |
| R7 runs **only R7a** | Done or in progress: the permission catalogue is renamed (`boq:*` → `scope:*`, `schedule:view_variance` → `sprints:view_status`, `contractors:manage_packages` → `contractors:manage`, `sessions:revoke_device` → `users:revoke_device`, `retention:manage_defects` → `defects:manage`, `inspections:manage_findings` → `findings:manage`, `reports:approve_completion` → `visits:review`, `reports:raise_query` → `incidents:view`, `field:submit_report` + `inspections:submit` → `visits:submit`, `reports:view_all` + `inspections:view` → `visits:view`; `field:raise_incident` and `reports:respond_query` removed). Categories are regrouped into 8. Code owns the permission rows through `syncPermissionCatalog` at start-up (migration `20261225090000_r7a_permission_catalogue`). |
| Two server rules added with R7a | (a) A user whose main role has surface `MOBILE` is refused web sign-in (403 `WEB_ACCESS_NOT_ALLOWED`, `server/src/modules/auth/webAccess.ts`). (b) The person who recorded a handover response cannot review it (409 `SAME_PERSON_REVIEW`, `handover.service.ts`). |
| The demo uses the **6 current UBEC roles** | Exactly as `tailorUbecRoles` (`server/src/db/seedUbecRoster.ts`) sets them. Role codes stay as they are. |
| R7's 12-role catalogue is **not built now** | D-R7.4, sections 5.2, 5.4 and 7.2, and one login per role are not built. After the demo the client may name more roles. Once every role is known, one migration does the whole role change, together with the seed replacement, which deletes the `kpmg-nigeria` tenant. |

Building the 12 roles now would mean guessing the client's structure. Doing it twice (once now and again after the demo) would rewrite every role code in stored JSON twice and churn every route test twice.

---

## 2. Today (after R7a)

### 2.1 UBEC tenant roles (`programme-authority`)

Built by `provisionDefaultRoles`, then `tailorUbecRoles`. That function renames 4 default roles, deletes `LENDER` and `MONITOR_INSPECTOR`, and adds 2 custom roles. `shared/src/defaultRoles.ts` is not changed.

| Role (name · code) | Kind | Surface · persona · weight | Holder (seed) | Permissions after R7a |
| :--- | :--- | :--- | :--- | :--- |
| UBEC Administrator · `TENANT_SUPER_ADMIN` | default, renamed | WEB · NONE · 1.0 | `admin@ubec.test` | Every catalogue key (56) |
| SUBEB Administrator · `ORGANIZATION_ADMIN` | default, renamed; permissions = default | WEB · NONE · 1.0 | `kano.admin@`, `lagos.admin@` | `projects:view_assigned`, `projects:view_organization_tree`, `projects:view_portfolio`, `scope:view`, `sprints:view_status`, `visits:view`, `payments:view`, `audit:view_ledger`, `findings:receive_escalations`, `documents:view`, `documents:upload`, `milestones:manage`, `milestones:waive`, `kickoff:manage`, `contracts:raise_default`, `contracts:decide_default`, `completion:draft_certificate`, `completion:sign_certificate`, `completion:revoke_certificate`, `closure:manage_checklist`, `closure:export_pack`, `contractors:rate_performance`, `lessons:manage`, `lessons:view`, `kpis:view` (25) |
| UBEC M&E Officer · `UBEC_ME_OFFICER` | custom (`isSystemDefault: false`) | BOTH · INDEPENDENT_VERIFIER · 1.0 | `me.officer@` | `projects:view_assigned`, `scope:view`, `sprints:view_status`, `visits:view`, `visits:review`, `visits:plan`, `visits:submit`, `incidents:view`, `findings:manage`, `findings:receive_escalations`, `sprints:verify`, `documents:view`, `documents:upload`, `handover:record_response`, `handover:review_feedback`, `defects:manage`, `milestones:manage`, `completion:sign_certificate`, `contractors:rate_performance`, `lessons:view`, `lessons:manage`, `kpis:view` (22) |
| SUBEB M&E Officer · `SUBEB_ME_OFFICER` | custom | BOTH · INDEPENDENT_VERIFIER · 1.0 | `lagos.me@` | Same 22 as the UBEC M&E Officer (same constant, `ME_OFFICER_PERMISSIONS`) |
| Independent M&E (COREN-certified firm) · `MONITOR` | default, renamed; permissions replaced | BOTH · INDEPENDENT_VERIFIER · 1.0 | `independent.me@` | `projects:view_assigned`, `scope:view`, `sprints:view_status`, `visits:view`, `visits:submit`, `incidents:view`, `documents:view`, `documents:upload`, `lessons:view`, `kpis:view` (10) |
| Resident Supervisor · `INDEPENDENT_RESIDENT` | default, renamed; permissions = default | MOBILE · INDEPENDENT_VERIFIER · 0.85 | `resident.supervisor@` | `scope:view`, `visits:view`, `visits:submit`, `defects:manage`, `findings:manage` (5) |

### 2.2 Default roles every new tenant gets (`shared/src/defaultRoles.ts`)

| Code | Name | Surface | Permissions (summary) |
| :--- | :--- | :--- | :--- |
| `TENANT_SUPER_ADMIN` | Tenant Super Admin | WEB | every key |
| `MONITOR` | Independent Monitor | WEB | the M&E lead: tenant-wide view, project setup and activation, forms and facilities, scope edit, visits (plan, review, submit), findings, defects, handover record **and** review, documents, kick-off, default raise, CoC draft (no sign), closure checklist and pack, ratings, lessons, payments view, audit ledger, KPIs |
| `LENDER` | Funder / Finance Officer | WEB | tenant-wide view, `payments:record`, `closure:audit_signoff`, `handover:review_feedback`, closure pack, read-only elsewhere |
| `ORGANIZATION_ADMIN` | Organisation Administrator | WEB | as SUBEB Administrator above |
| `MONITOR_INSPECTOR` | Monitor Inspector (Visiting QS / COREN) | MOBILE | `scope:view`, `visits:view`, `visits:submit`, `defects:manage`, `findings:manage` |
| `INDEPENDENT_RESIDENT` | Independent Resident Clerk of Works | MOBILE | same as `MONITOR_INSPECTOR` |

These still carry lender-era names and an M&E role coded `MONITOR`. A new tenant made by `createTenantWithDefaults` gets these 6 roles, not the UBEC set.

### 2.3 First-tenant custom roles (`kpmg-nigeria`)

| Code | Holder | Permissions | Fate |
| :--- | :--- | :--- | :--- |
| `LENDER_TECHNICAL_OFFICER` | `lto@insite.ng` | `LENDER` plus `incidents:view` | Deleted with the tenant (seed replacement S6) |

No seed creates a `LEGAL_OFFICER` role any more (R7 plan 5.4 is stale on this).

### 2.4 Gaps in today's UBEC set

| Gap | Effect | Guard today |
| :--- | :--- | :--- |
| The admin acts for the Director Legal, the Executive Secretary, Procurement, Finance & Accounts, Audit and ICT Support | One person records payments **and** signs the closure audit. The audit ledger shows the admin's name for the Legal review and the ES decision. | None. Accepted for the demo |
| Both M&E roles (and the admin) hold `handover:record_response` and `handover:review_feedback` | One person could record and accept the same handover | Server rule (b): 409 `SAME_PERSON_REVIEW` |
| `completion:sign_certificate` is held by the admin, both SUBEB admins and both M&E roles. The default slots (`DEFAULT_COC_SIGNATORIES`: "Head of Physical Planning", "Head of M&E", scope `PROJECT_OWNER`, no `roleCode`) do not name a role | Any holder in the owning organisation can sign either slot. The labels describe a function the platform does not check. | One slot per person |
| Kano SUBEB has one signer (`kano.admin@`) and no M&E officer | A Kano Matching Grants CoC (e.g. PRG-211 later) can never complete: two different people are needed | None. Not on today's demo path |
| `completion:draft_certificate` is held only by the admin and the SUBEB admins | M&E officers cannot record the beneficiary's paper copy | n/a |
| The Resident Supervisor holds 5 keys; the M&E officers hold 22 | R7's D-R7.5 (Resident Supervisor = M&E Officer permissions) is not true for UBEC | n/a |
| Independent M&E has code `MONITOR` | (1) `"MONITOR"` is also an organisation-scope value (CoC slots, milestone `responsibleScope`, kick-off stakeholder groups). (2) `AuditLedgerPage` infers actor kind from `"MONITOR"`/`"LENDER"` substrings. (3) Any backfill migration that grants a permission "to `MONITOR`" now reaches the Independent M&E. (4) Demo self-registration defaults to `roleCode: "MONITOR"` | Grep before every permission backfill |
| No Procurement function | `closure:sign_file` (D-R7.10) not built; Procurement does not sign the CoC (D-R7.9) | n/a |
| `assuranceWeight` still on roles (0.85 for the Resident Supervisor) | Lender-era corroboration weight, shown in the role editor | n/a |

---

## 3. What the full migration does

Reuse the R7 plan where it still holds. Decision IDs refer to `redesign_r7_implementation_plan.md` section 4.

### 3.1 Still valid: build these

| # | Work | Source |
| :--- | :--- | :--- |
| 1 | **Final role set into `DEFAULT_TENANT_ROLES`.** Every role the client names becomes a default role in `shared/src/defaultRoles.ts`, built from named permission constants (e.g. `FIELD_OFFICER_PERMISSIONS`), so it can be read as a matrix. Delete `tailorUbecRoles` and `UNUSED_DEFAULT_ROLE_CODES`. The UBEC tenant then gets its roles from the same definition as any new tenant. | D-R7.4 (shape only; the 12 codes are replaced by the client's list), 5.2 |
| 2 | **Role-code renames by migration.** `UPDATE roles SET code, name, description` on system-default roles. Custom roles (`UBEC_ME_OFFICER`, `SUBEB_ME_OFFICER`) are adopted if their code becomes a default code (`isSystemDefault = true`, permissions kept). Raise on any other clash; never rename silently. | D-R7.11e, 5.4 |
| 3 | **Role codes in stored JSON rewritten by path only**, never by text replace, because `"MONITOR"` is also an organisation-scope value. Paths today: closure config CoC slot `roleCode` (`project_types.configJson`, `projects.projectTypeSnapshotJson`, `completion_certificates.slotsJson`); milestone template `responsibleRoleCode` (contract milestones config); `defaultCases.legalRoleCode`; `supervision.supervisorRoleCodes`. The R4 visit plan stores officers by user id (`defaultVisitOfficerIds`), not by role code: verify again at the time. `approval_steps.requiredRoleId` is an id and survives a code rename. | D-R7.19, section 6 |
| 4 | **`ensureDefaultRoles(db, tenantId)`** replaces `provisionDefaultRoles`. It creates missing default roles only and never edits an existing one. It runs at server start for every tenant (after `syncPermissionCatalog`), in `createTenantWithDefaults` and in the seed. SQL never inserts default roles. | D-R7.11f |
| 5 | **"Reset to default permissions"**: `POST /api/v1/rbac/roles/:id/reset-defaults` (`roles:create_edit`, escalation guard `assertCallerHoldsAll`), audit action `ROLE_RESET_TO_DEFAULT` in the shared enum and the Prisma `AuditActionType`, button on system-default roles in `RolesPermissionsTab.tsx`. The migration does **not** reset roles; tenants' edits survive. | 5.4 |
| 6 | **Remove `assuranceWeight`** from `DefaultRoleDefinition`, the role editor and the role DTOs. Drop the column and the session snapshot (`FieldAgentSession.assuranceWeight`) if nothing reads them; grep `evidence.service.ts` and `mobileAccess.ts` (`roleSummary`) first. | D-R7.16 |
| 7 | **CoC signatories.** Replace "Head of Physical Planning / Head of M&E" in `DEFAULT_COC_SIGNATORIES` and the seeded type configs with slots that name a role (`roleCode`) and a scope, per the client's answer (section 4). Rewrite existing slots by path (item 3). | D-R7.9 |
| 8 | **`closure:sign_file`** if the client confirms that Procurement signs the closure file: a new catalogue key, granted by the migration's idempotent backfill, used as the permission of a manual closure-checklist item. | D-R7.10 |
| 9 | **Self-registration default role** (demo mode only): `WebRegisterRequestSchema.roleCode` default and the `registerWebUser` fallback move from `"MONITOR"` to the lowest-risk web role in the final set. Still refused for any role holding a tenant-admin permission. | D-R7.17 |
| 10 | **`AuditLedgerPage`** stops inferring actor kind from `"MONITOR"`/`"LENDER"` substrings and uses `actorType` (CLAUDE.md: never infer roles from names or codes). Label the organisation tag `FINANCIER_LENDER` "Funder" (value kept). | R7b checklist (web) |
| 11 | **Separation-of-duty checks as unit tests** over `DEFAULT_TENANT_ROLES`, per the client's answers. Example rules: no role except the tenant admin holds both `handover:record_response` and `handover:review_feedback`; only Finance holds `payments:record`; only Audit holds `closure:audit_signoff`; the Legal review role and the decision role differ. Keep the server rule `SAME_PERSON_REVIEW` regardless. | D-R7.8 |
| 12 | **One demo login per role that gets a login**, on `@ubec.test`, named after the role (e.g. `legal@ubec.test`, `finance@ubec.test`, `auditor@ubec.test`, `procurement@ubec.test`, `es@ubec.test`). Existing roster logins keep their emails. `demoAccounts.ts` lists the web logins in demo order; the seed prints the full table; `saas_updates/demo_accounts.md` is updated. | D-R7.14, rewritten |
| 13 | Tenant admin role rename (`TENANT_SUPER_ADMIN` → `TENANT_ADMIN`) only if the owner still wants it. It touches `createTenantWithDefaults`, `assertTenantKeepsRoleAdmin`, tests and the demo accounts. The admin keeps every permission. | D-R7.6 (confirm again) |
| 14 | Visibility through the organisation tree, not separate HQ and SUBEB roles: one role serves both delivery models when its holders sit in different organisations. | D-R7.7 (principle kept) |

### 3.2 Obsolete: do not build

| R7 item | Why |
| :--- | :--- |
| D-R7.1–D-R7.3, 5.1, 5.3, section 6 key rewrites, R7a checklist | Done in R7a |
| D-R7.4 (the 12 codes `TENANT_ADMIN` … `AUDITOR`) and the 5.2 matrix as written | Replaced by the client's role list; use 5.2 only as a starting matrix for the questions in section 4 |
| D-R7.5 (Resident Supervisor = M&E Officer) | UBEC gave them different scopes; decide again from the client's answer |
| 5.4 role-code map (`MONITOR` → `ME_MANAGER`, `LENDER` → `FINANCE_OFFICER`, `ORGANIZATION_ADMIN` → `PROGRAMME_MANAGER`, …) | Written for the generic default roles. In UBEC, `MONITOR` is the Independent M&E and `ORGANIZATION_ADMIN` is the SUBEB admin. Build a new map from the final list. `LENDER` and `MONITOR_INSPECTOR` no longer exist in UBEC |
| 5.4 "custom `LEGAL_OFFICER` (seeded)" | No seed creates it |
| D-R7.12 (keep `kpmg-nigeria` as a test fixture) | Superseded by `seed_replacement_plan.md` (delete the tenant) |
| D-R7.13 (programme seed rewritten under `server/src/db/programme/`) | Superseded by seed replacement S4 (one deterministic UBEC generator) |
| 7.2 login table (`programme.admin@insite.ng`, `executive@`, `north.manager@`, `south.executive@`, …) | Wrong domain and names; the UBEC roster on `@ubec.test` replaced it |
| D-R7.14 rename list (`flagship.admin@` → …, `programme.funder@` → …) | Those logins no longer exist |
| D-R7.15 (public pages) | Not part of the role migration; track separately if still wanted |
| D-R7.18 migration name `20261225090001_r7b_role_catalogue` | Use a timestamp at the time of the work |

---

## 4. Questions for the client after the demo

| # | Question | Drives |
| :--- | :--- | :--- |
| Q1 | Which functions need their own login: Director Legal, Executive Secretary, Finance & Accounts, Procurement, Audit Department, ICT Support, Director Physical Planning, State/Zonal Office coordinators? | Role list, logins (3.1 items 1, 12) |
| Q2 | Who signs the Certificate of Completion, per delivery model: which positions, from which organisation (UBEC HQ, the SUBEB, the State/Zonal Office), and does Procurement sign in every state or only at HQ? | CoC slots (item 7) |
| Q3 | Who records the beneficiary's handover response, and who reviews it? Is the reviewer always from a different organisation? | Separation of duties (item 11) |
| Q4 | Who reviews and who decides a contractor default case: the Director Legal and the Executive Secretary / SUBEB Executive Chairman, or others? Does the decision need a second approver above a contract value? | Default case chain, `legalRoleCode` |
| Q5 | Who records payments, and who may only view them? Is the closure audit always signed by the Audit Department, never by Finance? | `payments:record`, `closure:audit_signoff` |
| Q6 | Does every SUBEB have its own M&E officer, and does a UBEC State/Zonal Office officer also monitor Matching Grants projects? | Kano gap, assignments |
| Q7 | Should Resident Supervisors raise and resolve findings and close defects, or only report? Should they ever see the web portal? | Field role permissions, surface |
| Q8 | What may the Independent M&E (COREN firm) do beyond ad hoc visits: review visits, raise findings, sign anything? | Independent role |
| Q9 | Who maintains forms, facilities, project types and visit plans (HQ M&E or ICT)? | Admin-type permissions |
| Q10 | Are there read-only stakeholders (Executive Secretary dashboard, Board, Ministry, development partners) who need portfolio and KPI views only? | Executive or viewer role |

---

## 5. Order of work

Do the role migration **in the same pass as seed replacement S4–S6, or immediately before S4**. Both rewrite the seed and the route tests' logins, so doing them together touches each test file once.

| Step | Work | Gate |
| :--- | :--- | :--- |
| 0 | Client answers recorded (section 4); final role matrix agreed with the owner and written into this file | Owner sign-off |
| 1 | Shared: `DEFAULT_TENANT_ROLES` = the final set; named permission constants; `DEFAULT_COC_SIGNATORIES`; `closure:sign_file` if confirmed; register default role; separation-of-duty unit tests | `npm run build:shared`, typecheck, unit tests |
| 2 | Prisma: audit action `ROLE_RESET_TO_DEFAULT` (both enums); migration with a hand-written data section (role-code map, adopted custom roles, JSON rewrites by path, permission backfill if a key is added) that keeps every hand-written index and CHECK listed in `CLAUDE.md` | `migrate deploy` on a copy of a pre-migration database; check the diff for dropped indexes |
| 3 | Server: `ensureDefaultRoles` at start-up and in `createTenantWithDefaults`; reset-defaults endpoint; `registerWebUser` fallback; `assuranceWeight` removal | Affected route files |
| 4 | Web: role editor (no weight control, reset button, categories), `AuditLedgerPage`, `demoAccounts.ts` | Typecheck, lint, web build |
| 5 | Seed (= seed replacement S4/S5): the UBEC generator uses the default roles directly (no `tailorUbecRoles`), creates one login per role that has one, and prints the table. Re-point tests to the new codes and logins | Full gate in the background |
| 6 | Seed replacement S6: delete the first tenant and its seed files | Full gate, `npm run prisma:seed` twice, demo rehearsal |

### Tests to add

| Test | Kind |
| :--- | :--- |
| Every default role's keys are in the catalogue; codes unique; the tenant admin holds every key | unit (extend `rbac.phase1.test.ts`) |
| Separation-of-duty rules from section 4 answers (item 11) | unit |
| `webSignInAllowed` still refuses every `MOBILE` default role | unit (exists; extend to the new roles) |
| A tenant migrated from today's UBEC set: role codes renamed, custom M&E roles adopted, permissions kept, missing defaults created at start-up, edited roles untouched | route |
| Stored role codes rewritten by path: CoC slot `roleCode`, `supervisorRoleCodes`, `legalRoleCode`, `responsibleRoleCode`; an organisation-scope `"MONITOR"` left unchanged | route |
| Reset-defaults: escalation guard, audit row, `LAST_TENANT_ADMIN` still enforced | route |
| Every demo login signs in on its surface (web or field app) and lands where the demo script says | route |

### Docs to update

`CLAUDE.md` (seed paragraph and logins, roles and permissions paragraph, "No contractor login" with the mobile-only rule), `saas_updates/demo_accounts.md`, `saas_updates/configuration_reference.md` (role matrix), `saas_updates/demo_script_programme_delivery.md` (logins per step), `web_testing_checklist.md` and `physical_testing_checklist.md` (logins), and this file's status line.

---

## 6. Risks

| Risk | Why | Mitigation |
| :--- | :--- | :--- |
| Text-replacing a role code in JSON | `"MONITOR"` is both a role code and an organisation scope | Rewrite by JSON path only (D-R7.19); test that a scope value survives |
| Permission backfills land on the wrong role | Earlier migrations grant permissions "to the default roles that hold them" by role code; in UBEC `MONITOR` is the Independent M&E | Grep migrations for role codes before writing the new one; from now on grant by the final codes only |
| Losing tenant edits | Resetting roles to the matrix in the migration would undo admins' changes | Migration renames only; "Reset to default permissions" is an explicit admin action |
| Locking out the last admin | Renaming the admin role code or changing its permissions | Keep `assertTenantKeepsRoleAdmin`; test after the rename |
| Field accounts lose web or mobile access | Surface changes on a renamed role; rule (a) refuses web for `MOBILE` main roles | Test each demo login on both surfaces (step 5) |
| Test churn twice | Doing roles and the seed replacement separately rewrites the same test files twice | Same pass (section 5) |
| Client answers arrive piecemeal | Starting before the list is complete repeats the migration | Step 0 gate: owner signs off the final matrix first |
| Approval chains in flight | Steps reference `requiredRoleId` and permission keys; items in flight keep their chain version | Ids survive code renames; permission keys are unchanged by this work unless `closure:sign_file` is added (new key, nothing in flight uses it) |
