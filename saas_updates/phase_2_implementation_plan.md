# Phase 2: Security Hardening, Tenant Isolation and Deploy Baseline

| | |
| :--- | :--- |
| **Status** | Implemented 2026-11-18, with carry-overs listed in section 7 |
| **Depends on** | Phase 1 (implemented) |
| **Unblocks** | Every later phase |
| **Read first** | [Master plan](saas_implementation_plan.md) sections 2, 3 and 6 |

---

## 1. Overview

**Objective:** make the platform safe to run with more than one tenant. After this phase, no caller can read or change data outside their tenant and project scope, access changes take effect immediately, and the schema can be deployed from migrations.

**In scope:** authentication and session lifetime, a single project-access guard, ownership checks on IDs, response hygiene, join-code hardening, RBAC integrity and tenant-level audit, demo-mode containment, storage access, the minimum web and mobile changes needed to match, route-level tests, and tooling.

**Out of scope:** disbursement business rules (Phase 3), the evidence pipeline and mobile sync (Phase 4), any new feature.

---

## 2. Context for the implementing agent

**How auth works today**
- [auth.middleware.ts](../server/src/middleware/auth.middleware.ts) verifies a JWT and trusts everything inside it: `permissions[]`, `roleName`, `tenantId`, and for field agents `projectId`, `fieldPersonaType`, `assuranceWeight`. Web tokens last 7 days, field tokens 30 days. Nothing is re-read from the database, so role edits, user deactivation, tenant suspension and session revocation have no effect until expiry.
- `requireAnyAuth` treats any token that is not `WEB_USER` as a field agent.
- [accessControl.ts](../server/src/utils/accessControl.ts) has `assertCallerProjectAccess` and `buildProjectVisibilityWhere`. They are correct for web users, but `assertCallerProjectAccess` returns successfully if neither a web user nor a field agent is passed, and it is called per handler, so it is easy to forget.

**Routes with no project or tenant check today** (any valid token works against any project ID):
- [workdayReports.routes.ts](../server/src/modules/workday-reports/workdayReports.routes.ts): all three routes.
- [morningBrief.routes.ts](../server/src/modules/morning-briefs/morningBrief.routes.ts): all three, including dispatch, which spends AI tokens, and `expectedDeliverableOverride`, which lets any caller overwrite a brief.
- [telemetry.routes.ts](../server/src/modules/telemetry/telemetry.routes.ts): both.
- [wbsChat.routes.ts](../server/src/modules/wbs-chat/wbsChat.routes.ts): GET and POST messages.
- [notifications.routes.ts](../server/src/modules/notifications/notifications.routes.ts): mobile list, read, resolve; web read.
- [evidence.routes.ts](../server/src/modules/evidence/evidence.routes.ts): presign.

**Services that trust IDs from the body** in [reconciliation.service.ts](../server/src/modules/reconciliation/reconciliation.service.ts): `createMonitorLineQuery` (line item, IPC), `respondToMonitorLineQuery` (query), `certifyIpcValuationByMonitor` (IPC, line items), `recordLenderTrancheDecision` (valuation report, tranche), `submitContractorIpcClaim` (tranche). Also `confirmEvidenceLogByAgent` (BOQ item) and `createUserInTenant` (project IDs) elsewhere.

**Data leaks in responses**
- `getProjectBaselineDetails` in [projects.service.ts](../server/src/modules/projects/projects.service.ts) spreads the Prisma project, including full `fieldSessions` rows (PIN hash, device secret hash, ID and selfie URLs, phone numbers), to every caller including field agents.
- `getIpcReconciliationDetails` includes `fieldSession: true` on evidence logs and spreads `boqItem`.
- `GET /:projectId/contractor-verifications` has no permission check.
- Confidential whistleblower reports: [incident.service.ts](../server/src/modules/incidents/incident.service.ts) writes the reporter's name into the audit summary and returns it from the list endpoint; any `INDEPENDENT_VERIFIER` field agent can list them.

**Other facts you will need**
- Public `POST /auth/register` ([auth.routes.ts](../server/src/modules/auth/auth.routes.ts), `registerWebUser`) accepts `tenantSlug` and free-text `roleCode`.
- Join codes are `{codePrefix}-{suffix}` built in `createProjectBaseline`; suffixes are `INS`, `COW`, `CON` by default. There is no rate limiting anywhere.
- `AuditLog.projectId` is required, so tenant-level events cannot be recorded. `recordAuditEvent` in [audit.service.ts](../server/src/modules/audit/audit.service.ts) finds the previous entry by `createdAt desc, id desc` with no lock, so concurrent writes fork the chain and same-millisecond entries can be mis-ordered.
- Default roles are defined twice and differ: [seedDatabase.ts](../server/src/db/seedDatabase.ts) and `createTenantWithDefaults` in [rbac.service.ts](../server/src/modules/rbac/rbac.service.ts).
- Demo endpoints: `/projects/demo`, `/projects/demo/reset` (wipes and reseeds the whole database), `/auth/demo/skip-verification`. All unauthenticated when `DEMO_MODE` is on. `mobile/.env` and `web/.env` currently enable demo mode. [auth-context.tsx](../web/src/lib/auth-context.tsx) compiles demo accounts and `Password123!` into every bundle.
- [storage.service.ts](../server/src/integrations/storage.service.ts) stores read URLs (public or 1-hour presigned) in the database; presigned ones are dead after an hour. [whisper.service.ts](../server/src/integrations/whisper.service.ts) fetches a client-supplied URL server-side.
- `npm audit --omit=dev` reports 30 advisories; `xlsx` has a high-severity one with no fix on npm.
- There is no lint config and no CI config in the repo.

---

## 3. Decisions

**Needs owner input**

| ID | Question | Default being built |
| :--- | :--- | :--- |
| D-2.1 | Remove public self-registration? | Yes. Users are created by a tenant admin (`users:invite_manage`) or at tenant provisioning. The endpoint stays only when `DEMO_MODE` is on. |

**Made here (best practice, no input needed)**
- Tokens carry identity only. Roles, permissions and status are loaded per request with a short in-process cache.
- Email stays globally unique (one user belongs to one tenant). Project code prefix becomes unique per tenant.
- Join codes gain a random component and are rate limited. They remain valid for join-code roles; provisioned roles arrive in Phase 5.
- Passwords for admin-created users are temporary and must be changed at first sign-in. There is no email infrastructure yet.

---

## 4. Schema changes

Reset the database and replace the migration history (decision A in the master plan).

- `User`: add `mustChangePassword Boolean @default(false)`, `tokenVersion Int @default(0)`, `lastLoginAt DateTime?`.
- `FieldAgentSession`: add `revokedAt DateTime?`, `revokedByUserId String?`, `revokeReason String?`. Keep `isActive`.
- `Project`: replace `codePrefix @unique` with `@@unique([tenantId, codePrefix])`.
- `Role`: add `@@unique([tenantId, codeSuffix])` (nulls allowed).
- `ProjectJoinCode`: add `maxUses Int?`, `useCount Int @default(0)`, `rotatedFromId String?`. `code` stays globally unique.
- `Organization`: add a unique index on `(tenantId, lower(name))` (raw SQL in the migration).
- `AuditLog`: add `tenantId` (required), make `projectId` nullable, add `seq BigInt` assigned per chain scope, add `@@unique([tenantId, projectId, seq])`. A chain scope is one project, or the tenant when `projectId` is null.
- `AuditActionType`: add `USER_CREATED`, `USER_UPDATED`, `USER_DEACTIVATED`, `JOIN_CODE_ROTATED`, `LOGIN_FAILED_LOCKOUT`.
- `WebNotification`: move read state to a `WebNotificationRead (notificationId, userId, readAt)` table so one user reading does not mark it read for everyone.
- `Permission` catalog: add `incidents:view_confidential`, `tenant:manage_settings`.

---

## 5. Implementation checklist

### Step 0: Deploy baseline and Phase 1 close-out
- [x] Delete `server/prisma/migrations/20261110100216_init_insite_schema` and create one baseline migration from the current schema plus section 4 (`prisma migrate dev --name baseline_multitenant`).
- [x] Confirm [render.yaml](../render.yaml) start command (`prisma migrate deploy`) works against an empty database.
- [x] Run the seed; confirm tenants, permissions, roles, role permissions, users, assignments and demo projects exist.
- [x] Complete Phase 1 items 7.3: super admin sees role and branding tabs; creating and renaming a role persists and is reflected; `projects:view_all_tenant` versus assignment scoping behaves as specified.

### Step 1: Authentication and live authorization context
- [x] Slim the JWT payloads to identity: web `{ tokenType, userId, tenantId, tokenVersion }`; field `{ tokenType, sessionId }`. Shorten web tokens to hours and add a refresh endpoint, or keep 7 days with the per-request check below. Pick refresh if time allows. *Kept 7 days with the per-request check; no refresh endpoint.*
- [x] Add an auth-context loader used by all guards: for web, load user, role, permissions and tenant status; reject if the user is inactive, `tokenVersion` differs, or the tenant is `SUSPENDED`. For field, load the session with role and project; reject if `isActive` is false (`403 SESSION_REVOKED`) or the tenant is suspended. Cache for at most 30 seconds, keyed by user or session, and clear the entry on role, user or session mutation.
- [x] `req.webUser` and `req.fieldAgent` keep their current shape, filled from the loader, so services do not change.
- [x] `requireAnyAuth`: reject unknown `tokenType` explicitly.
- [x] Bump `tokenVersion` on password change, deactivation and role reassignment.
- [x] Registration (D-2.1): return 404 unless `DEMO_MODE`; delete `useRegisterMutation` in web. Remove the hardcoded `kpmg-nigeria` default slug.
- [x] Add `express-rate-limit` to login, join-project, demo and presign routes. Add a failed-login lockout per account.
- [x] First sign-in password change: `POST /auth/change-password`; enforce `mustChangePassword` in the loader for everything except that route.
- [x] Startup checks in [env.ts](../server/src/config/env.ts): in production, refuse to start with the default `JWT_SECRET`, with `CORS_ORIGIN=*`, or with `DEMO_MODE` on.
- [x] `/auth/me` returns 401 for a missing or inactive user instead of `user: null`.

### Step 2: One project-access guard
- [x] Add `requireProjectAccess` and register it with `router.param('projectId', ...)` on every project-scoped router, after authentication. Web users: tenant match, then `projects:view_all_tenant` or an assignment. Field agents: session project must equal the URL project. Fail closed when there is no authenticated principal.
- [x] Remove the per-handler `assertCallerProjectAccess` calls once the guard is in place. Keep the function for the `projectId === 'all'` listing paths, which must go through `buildProjectVisibilityWhere`.
- [x] Add view permissions to read routes: `boq:view` (BOQ), `ipc:view` (both IPC reads), `reports:view_all` (workday reports for web), `presence:view_telemetry` (telemetry for web), `assurance:review_credentials` (contractor verifications), `audit:view_ledger` (already present).
- [x] Morning briefs: field agents may read and generate for their own project; `dispatch` and `expectedDeliverableOverride` require a web user with `projects:edit_baseline`.
- [x] Mobile notifications: a field agent may only read or resolve notifications addressed to their session or broadcast to their project. Web notification read uses the new per-user table.
- [x] Field write routes (workday reports, telemetry, chat, incidents, evidence): take the project from the session, and reject a mismatched URL.

### Step 3: Ownership checks on IDs
- [x] Add loaders that take `(projectId, id)` and throw 404 otherwise: `loadIpcInProject`, `loadLineItemInIpc`, `loadQueryInIpc`, `loadValuationReportInProject`, `loadTrancheInProject`, `loadBoqItemInProject`, `loadWorkdayReportInProject`.
- [x] Use them in every reconciliation service function listed in section 2, in `confirmEvidenceLogByAgent`, in WBS chat (`workdayReportId`, `reportQueryId`), and in `revalidateWorkdayReport` (the reporter must own the original report).
- [x] `recordLenderTrancheDecision`: the tranche in the URL must be the IPC's tranche.
- [x] `createUserInTenant`: filter `projectIds` to the caller's tenant, as `assignUserProjectsAndRole` already does.

### Step 4: Response hygiene
- [x] Replace every spread of a Prisma row in a response with a serializer. Start with `getProjectBaselineDetails`, `getIpcReconciliationDetails`, `listProjectIpcClaims`, `listProjectEvidenceTimeline`, `listContractorVerifications`.
- [x] Field-session data in any response is limited to id, name, role name, persona and weight, unless the caller holds `assurance:review_credentials` or `sessions:revoke_device`.
- [x] Contractor-facing IPC responses must not include other parties' evidence detail beyond what the contractor needs to answer a query.
- [x] Error handler: in production return a generic message for unhandled errors; map Prisma `P2002` to 409 and `P2025` to 404; log the original.
- [x] Health endpoint: stop reporting `demoMode` and integration modes to unauthenticated callers in production.

### Step 5: Whistleblower confidentiality
- [x] Confidential incidents: audit summary and payload carry no reporter name or session ID; `actorDisplayName` is "Protected disclosure".
- [x] List and detail endpoints return reporter identity only to callers with `incidents:view_confidential`. Field agents see only their own confidential reports.
- [x] Grant `incidents:view_confidential` to no role by default except Tenant Super Admin; make it visible in the role builder.

### Step 6: RBAC integrity and tenant-level audit
- [x] `recordAuditEvent`: accept `tenantId` and optional `projectId`; take `pg_advisory_xact_lock` on the chain scope; assign `seq`; order and verify by `seq`. Update `getAndVerifyProjectAuditTrail` and add a tenant-scope trail endpoint guarded by `audit:view_ledger`.
- [x] Write audit events for role create, update, delete; user create, update, deactivate, assignment change; tenant branding update; join-code rotation.
- [x] One default-role definition: move the default role list (names, codes, suffixes, personas, weights, permission keys) to `shared` and use it from both the seed and `createTenantWithDefaults`.
- [x] Guard rails in role and user management: a caller cannot grant a permission they do not hold; cannot assign a role that holds permissions they do not hold; cannot remove `roles:create_edit` from, deactivate, or reassign the last active holder in a tenant. Platform super admin is exempt.
- [x] Fix `createRoleForTenant`: normalise the code before the duplicate check; validate `codeSuffix` uniqueness with a friendly 409.
- [x] `isPlatformSuperAdmin` cannot be set through any tenant endpoint.

### Step 7: Join codes
- [x] Code format becomes `{codePrefix}-{suffix}-{6 random base32 chars}`. Update `JoinProjectMobileRequestSchema` and the mobile input mask (`EnterProjectCodeScreen.tsx` currently forces `XXX-XXX-XXX`).
- [x] Enforce `expiresAt`, `maxUses` and `useCount` in `joinProjectMobile`.
- [x] Endpoints under `mobilization:manage_roster`: list, rotate (deactivates the old code, issues a new one), issue codes for roles created after the project. Web: surface these in the existing join-code panel.
- [x] Join-code visibility uses `mobilization:manage_roster`, not `projects:edit_baseline`.
- [x] `joinProjectMobile` ignores client-supplied `livenessPassed`, `idDocumentUrl` and `selfieImageUrl`; those arrive only through the assurance endpoint.

### Step 8: Demo mode and storage access
- [x] `.env.example` for web and mobile default demo mode to false. Server demo routes are not mounted at all when `DEMO_MODE` is off.
- [x] Web: demo accounts and passwords live in a module that is only imported behind the build-time flag, so they are absent from non-demo bundles. Remove prefilled `Password123!` from the add-user and add-tenant forms.
- [x] Presign requires project access, an allow-list of content types per media type, and a size cap. Object keys are namespaced `tenants/{tenantId}/projects/{projectId}/...`.
- [ ] Store object keys only. Add an authenticated media endpoint that checks project access and redirects to a short-lived signed URL. Replace stored `fileUrl`, `idDocumentUrl`, `selfie*Url`, `voiceNoteUrl` usage with keys. *Partial: media endpoint done (`GET /:projectId/media?key=`, `?format=json` for `<img>`); evidence media, IPC documents and assurance images now store validated keys only. Incident photos, workday voice notes and WBS chat media still arrive from mobile as device URIs or data URIs. See section 7, item 5.*
- [x] Whisper and any other server-side fetch read by object key from the configured bucket. No client-supplied URL is ever fetched.

### Step 9: Web
- [x] Clear the React Query cache on logout and on account switch; include the user ID in the query-key root. *Cache is cleared on every identity change (login, switch, logout); query keys were not prefixed with the user ID, as clearing gives the same isolation.*
- [x] The global 401 handler must not fire for the login request.
- [x] Route and navigation guards for the view permissions added in Step 2; a permission-denied page instead of silent redirects.
- [x] A tenant with zero projects can reach Settings, roles, users and branding ([App.tsx](../web/src/App.tsx) currently renders only an empty state).
- [x] Settings: fetch field sessions and the verification queue only when the user holds the matching permission. Password change calls the real endpoint. Remove the notification, 2FA and SSO stubs or mark them "not available yet" with no success toast.
- [x] Fix the object-as-toast bug in `useContractorVerificationMutations.ts`; add a top-level error boundary.
- [x] Audit ledger: default to "not verified" until data arrives; show `brokenAtEntryId`; add the tenant-scope ledger view.
- [x] Role and user mutations call `refreshUser()` when they affect the current user.

### Step 10: Mobile (minimum to match the server)
- [x] `mobileRequest` distinguishes 401 and 403 `SESSION_REVOKED` from network failure and raises a session-ended state that stops sync and prompts the user. Do not treat auth errors as "offline".
- [x] Require `EXPO_PUBLIC_API_BASE_URL` outside development and require HTTPS in release builds.
- [x] Demo UI (skip verification, persona switcher, project catalog, reset) is compiled out when the demo flag is off.

### Step 11: Tooling and tests
- [x] Add ESLint (TypeScript, React hooks) with a root `lint` script; fix errors, not all warnings.
- [x] Add a CI workflow: install, build shared, typecheck, lint, server tests.
- [x] Replace `xlsx` with a maintained parser (for example `exceljs`); run `npm audit` and resolve what has a fix. *`xlsx` replaced with `exceljs`. `npm audit --omit=dev` still reports 31 advisories, none with a non-breaking fix. See section 7, item 7.*
- [x] Route-level test suite with `supertest` and a disposable test database. Minimum cases:
  - registration closed; login blocked for inactive user and suspended tenant
  - a tenant A token gets 403 or 404 on every project-scoped route of tenant B (iterate the route table, do not hand-pick)
  - an unassigned user without `projects:view_all_tenant` is refused
  - a revoked field session is refused within the cache window
  - a field agent cannot use another project's ID on any field route
  - body-ID attacks from Step 3 return 404
  - role edit takes effect on the next request
  - escalation guard rails from Step 6
  - audit chain stays valid under 20 concurrent writes

---

## 6. Definition of done

| Criterion | Status (2026-11-18) |
| :--- | :--- |
| All Step 11 tests pass in CI | 39/39 pass locally (9 unit, 30 route-level against a disposable database). The CI workflow is written but has not run yet; it runs on the first push. |
| A fresh database built only from migrations plus seed runs the web and mobile demo flows | Migrations apply to an empty database and the seed runs. The demo flows were not clicked through by hand in a browser or on a device. |
| No raw Prisma spreads in route responses | Met. Responses go through explicit serializers (`server/src/utils/serializers.ts`). |
| A non-demo web bundle contains no demo email or password strings | Met. Checked by a production build with `VITE_DEMO_MODE=false`; also enforced in CI. |
| Master plan section 4 status updated | Met. |

## 7. Found during implementation

| # | Finding | Recommendation / owner phase |
| :--- | :--- | :--- |
| 1 | The auth-context cache (30 s) and the rate limiters are in-process. With more than one API instance, a revocation or role edit can lag by up to 30 s on the other instances, and rate limits count per instance. | Move both to Redis before running more than one instance. |
| 2 | Added `User.failedLoginCount` and `User.lockedUntil` (not in section 4) for the per-account lockout: 5 failures lock the account for 15 minutes and write `LOGIN_FAILED_LOCKOUT` to the tenant chain. | None. |
| 3 | Extra guard rail beyond Step 6: a caller cannot edit or delete a role, or manage a user, that holds permissions the caller lacks (stops a lower admin from downgrading a higher one). | Confirm with owner. |
| 4 | Join-code visibility: holders of `mobilization:manage_roster` without `projects:edit_baseline` (the default Main Contractor) see and manage only contractor-executor codes, so they cannot hand out independent-verifier codes. | Confirm with owner. |
| 5 | Incident photos are sent from mobile as data URIs, and workday voice notes and WBS chat media as device-local URIs. The server stores them but never fetches them. | Phase 4: upload through presign and send keys. |
| 6 | Mobile notifications still have one shared read flag, so a broadcast read by one field agent is read for all. Web notifications now have per-user read state. | Phase 4: per-session read table, same pattern as `WebNotificationRead`. |
| 7 | `npm audit --omit=dev`: 31 advisories (25 high), all needing breaking upgrades: `zod` 3→4 (high, memory exhaustion on oversized collections; partly mitigated by the 15 MB body limit), `react-router` 6→7 (web, moderate), `picomatch`/`minimatch` in the Expo toolchain, and `uuid` inside `exceljs` (affected API not used). Note: `npm audit fix --omit=dev` prunes devDependencies from `node_modules`; do not run it. | Separate upgrade ticket; zod 4 first. |
| 8 | `exceljs` does not read legacy `.xls`; BOQ upload now accepts `.xlsx` and `.csv` only. | Tell users; convert on upload if needed. |
| 9 | Media access is authorised at project level. Any project member who has an object key can get a signed URL for it. Keys are random and only exposed to roles that see the parent record, but confidential incident media would need per-object rules. | Phase 4. |
| 10 | Tenant Super Admin still holds every permission, including `ipc:certify_valuation` and `tranche:approve_disbursement`. | Phase 3 (D-3.1). |
| 11 | The tenant-scope ledger is a tab on the project audit page, so a tenant with no projects cannot reach it. | Phase 3 or a later web pass: add it to Settings. |
| 12 | Field agents can no longer read the project evidence timeline (`GET /evidence`) and see only their own workday reports and telemetry. Mobile does not call these today. | None unless mobile needs them. |
| 13 | Demo `/auth/demo/skip-verification` still accepts a client-supplied `sessionId`. Only mounted with `DEMO_MODE`. | Acceptable for demo builds. |
| 14 | ESLint runs with 0 errors and 135 warnings (unused imports, `any`, exhaustive-deps). | Clean up opportunistically. |
| 15 | Phase 1 item 7.3 (renaming a role shows in the web header and mobile profile) is covered on the server by the route tests. It was not checked by hand in the browser or on a device. | Manual check before release. |
