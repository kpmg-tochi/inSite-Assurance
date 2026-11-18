# Phase 5: Provisioned Mobile Users and Multi-Project Mobile

| | |
| :--- | :--- |
| **Status** | Not started |
| **Depends on** | Phase 2 (live auth context, join-code hardening), Phase 4 (project-scoped outbox, persisted baseline) |
| **Unblocks** | Phase 8 |
| **Read first** | [Master plan](saas_implementation_plan.md) sections 2, 3 and 6 |

---

## 1. Overview

**Objective:** let tenant super admins mark roles as pre-provisioned. People in those roles sign in to the mobile app with their account, see every project they are assigned to straight away, need no join code, and skip identity assurance. Join codes remain for roles that are not pre-provisioned.

**Why it matters beyond convenience:** today the highest-trust field tier (independent inspectors, assurance weight 1.0) is the least authenticated. Anyone with a join code becomes one. Provisioned accounts close that.

**In scope:** role onboarding mode, mobile sign-in, a user's mobile role, sessions per user per project per device, the project list and switcher on mobile, admin UI, removal of single-project assumptions in the app.

**Out of scope:** pre-registering expected participants with mobilization dates and reminders (Phase 8), email invitations (no email provider yet; see D-8.1).

---

## 2. Context for the implementing agent

**Server today**
- Mobile identity is a `FieldAgentSession` created by `joinProjectMobile` in [auth.service.ts](../server/src/modules/auth/auth.service.ts) from a `ProjectJoinCode`. `joinCodeId` is required. The session snapshots role name, persona and weight.
- Evidence, reports, telemetry, incidents, chat and notifications all reference `FieldAgentSession`. Keep that: a session remains the unit of field provenance.
- After Phase 2, the field token carries only `sessionId` and the auth loader fills `req.fieldAgent` from the database.
- `User` has one `roleId`. `UserProjectAssignment.roleId` exists and is never read. Web roles (surface `WEB`) have persona `NONE`; the seeded "Independent Monitor" is a web role and "Monitor Inspector" is a separate mobile role.
- `Role.requiresIdentityAssurance` drives the assurance gate on the server.

**Mobile today: strictly one project, one session, one token**
- No sign-in screen or account concept. Navigation is Landing, Onboarding (locally typed name and phone), Enter Code, gated on `activeProjectCode` in [RootNavigator.tsx](../mobile/src/navigation/RootNavigator.tsx).
- [secureProfileStore.ts](../mobile/src/storage/secureProfileStore.ts) holds single `active*` fields. `updateLocalProfile` cannot clear a field (`??` and `||` ignore explicit null).
- [apiConfig.ts](../mobile/src/config/apiConfig.ts) holds one global token and one baseline pack.
- "Add new project" destroys the current session. Project switching exists only in demo mode and works by calling the skip-verification endpoint.
- The app forces assurance when `fieldPersonaType === "CONTRACTOR_EXECUTOR"` even if the role flag is false (`EnterProjectCodeScreen.tsx`, `RootNavigator.tsx`). Phase 4 removes this; confirm it is gone.
- `activePermissions`, `activeAssuranceWeight` and `activeRoleId` are stored but never read. The profile header shows the user-typed `roleTitle`.
- The session-to-profile mapping is copied in three screens.
- Push token registration and telemetry scheduling assume one session.

---

## 3. Decisions

**No owner input required.** Assumptions, stated so they can be corrected:

| Assumption | Detail |
| :--- | :--- |
| Same account for web and mobile | A provisioned user signs in on mobile with the same email and password as the web. |
| A user can hold a separate mobile role | `User.mobileRoleId` is optional and must point to a role with surface `MOBILE` or `BOTH` and onboarding mode `PROVISIONED_ACCOUNT`. This lets one person be "Independent Monitor" on web and "Monitor Inspector" in the field. If their main role already has surface `BOTH` and is provisioned, no separate mobile role is needed. |
| Project visibility on mobile equals web | Assigned projects, or all tenant projects with `projects:view_all_tenant`. Only `ACTIVE` projects (once Phase 6 adds drafts). |
| Provisioned roles never require identity assurance | Setting a role to provisioned forces `requiresIdentityAssurance = false` and hides the toggle. The account itself is the identity. |
| Provisioned roles get no join codes | Existing codes for a role are deactivated when it is switched to provisioned, after a confirmation that lists affected projects. Existing join-code sessions for that role keep working until revoked. |
| Accounts are created by an admin with a temporary password | First sign-in forces a change (Phase 2). Email invitations come with the provider chosen in D-8.1. |

---

## 4. Schema changes

- `Role`: add `onboardingMode RoleOnboardingMode @default(JOIN_CODE)` with enum `JOIN_CODE | PROVISIONED_ACCOUNT`. Only meaningful for surface `MOBILE` or `BOTH`.
- `User`: add `mobileRoleId String?` (FK to `Role`, `onDelete: SetNull`), `phoneNumber String?`.
- `UserProjectAssignment`: drop the unused `roleId`.
- `FieldAgentSession`: add `userId String?` (FK to `User`), make `joinCodeId` nullable, add `origin FieldSessionOrigin` (`JOIN_CODE | PROVISIONED_ACCOUNT`), add `@@unique([userId, projectId, deviceId])`. A check: exactly one of `userId` and `joinCodeId` is set.
- New `MobileDevice (id, userId, deviceId, deviceModel, deviceOs, publicKey, publicKeyAlg, lastSeenAt, revokedAt)`, `@@unique([userId, deviceId])`. Holds the signing key from Phase 4 for provisioned users.
- `PushToken`: allow `userId` with a mobile platform (the column exists).
- `AuditActionType`: add `MOBILE_USER_SIGNED_IN`, `MOBILE_DEVICE_REVOKED`, `ROLE_ONBOARDING_MODE_CHANGED`.
- Permission catalog: no new keys. Mobile access is governed by holding a provisioned mobile role plus `field:*` permissions on it.

---

## 5. Implementation checklist

### Step 1: Shared
- [ ] `RoleOnboardingModeEnum`; add `onboardingMode` to role DTO and create/update schemas, with a refinement that `PROVISIONED_ACCOUNT` implies `requiresIdentityAssurance === false` and surface is not `WEB`.
- [ ] `MobileLoginRequestSchema` (email, password, device ID, model, OS, public key), `MobileLoginResponseSchema` (token, user profile, mobile role summary, project list).
- [ ] `MobileProjectSummarySchema` (id, code, name, location, role name, persona, weight, geofence mode, pending-outbox hint not included; that is local).
- [ ] Add `mobileRoleId` to tenant-user create and update schemas and DTOs.
- [ ] One exported mapper type for "session profile" so the app stops hand-mapping.

### Step 2: Server authentication
- [ ] `POST /auth/mobile/login`: same credential checks, lockout and tenant-status checks as web login. Refuse with a clear code if the user has no provisioned mobile role (`NO_MOBILE_ACCESS`). Upsert `MobileDevice`; refuse a revoked device. Issue a token `{ tokenType: 'MOBILE_USER', userId, tenantId, deviceRowId, tokenVersion }`.
- [ ] Extend the Phase 2 auth loader: for `MOBILE_USER` tokens on a project-scoped route, resolve the user's effective mobile role, check project visibility, then find or create the `FieldAgentSession` for `(userId, projectId, deviceId)` with `origin = PROVISIONED_ACCOUNT`, `assuranceStatus = APPROVED`, and role snapshots. Populate `req.fieldAgent` exactly as for join-code sessions, so no downstream service changes.
- [ ] Session creation is lazy (first request per project) and idempotent under concurrency (unique constraint plus retry).
- [ ] `GET /auth/mobile/projects`: visible active projects for the user with the effective mobile role per project.
- [ ] `GET /auth/mobile/projects/:projectId/baseline`: the baseline pack (geofence, BOQ items, hold points, cadence) that join currently returns.
- [ ] `/auth/me` supports `MOBILE_USER`.
- [ ] Revocation: revoking a `MobileDevice` or deactivating the user blocks all their sessions through the loader. The existing per-session revoke still works for a single project.
- [ ] Web tokens are refused on mobile-only routes and the reverse.

### Step 3: Server role and user management
- [ ] `updateRoleForTenant`: handle `onboardingMode` changes. Switching to provisioned deactivates the role's active join codes in a transaction and writes `ROLE_ONBOARDING_MODE_CHANGED`. Switching back issues codes for active projects (reuse the Phase 2 issue endpoint logic).
- [ ] Project activation and join-code generation skip provisioned roles.
- [ ] `createUserInTenant` and `assignUserProjectsAndRole`: accept and validate `mobileRoleId` (same tenant, right surface and mode).
- [ ] When a user gains a project assignment and has mobile access, send a push "You've been added to {project}" to their registered devices.
- [ ] Roster endpoint (`listProjectFieldSessions`): include `origin`, linked user, and device; add a tenant-level "mobile users and devices" list.

### Step 4: Web admin
- [ ] Role builder ([RolesPermissionsTab.tsx](../web/src/components/rbac/RolesPermissionsTab.tsx)): for mobile-capable roles, an "Onboarding" control with two options, "Join code" and "Pre-provisioned account", with one-line explanations. Choosing provisioned disables and unchecks the identity-assurance toggle. Changing mode on a role with active codes shows the confirmation described in section 3.
- [ ] Users tab ([UsersVisibilityTab.tsx](../web/src/components/rbac/UsersVisibilityTab.tsx)): "Mobile access" field listing provisioned mobile roles plus "None"; a badge in the table; phone number field.
- [ ] Settings roster: distinguish join-code sessions from provisioned users; show devices with revoke.
- [ ] Join-code panels hide provisioned roles and explain why.

### Step 5: Mobile account and navigation
- [ ] Landing offers two paths: "Sign in" and "Join with a project code". Remove the locally typed role title from onboarding for signed-in users; name and phone come from the account.
- [ ] Sign-in screen; forced password-change screen when the server says so.
- [ ] Replace the single-profile store with: `account` (user, token, device row, mobile role), `joinSessions[]` (one per join-code project, each with its own token), `projects[]` cache, `activeProjectId`. Fix the "cannot clear a field" bug by writing whole objects.
- [ ] `apiConfig`: choose the token per request from the active project (account token, or that project's join-session token). Remove the global baseline pack; read the persisted one from Phase 4.
- [ ] Projects screen: list all projects from `/auth/mobile/projects` plus any join-code projects, with pending-sync counts from the outbox; pull to refresh; tap to switch. Switching never discards queued work.
- [ ] "Join another project with a code" is additive.
- [ ] Sign out: stop the outbox, warn if items are pending, clear account data, keep nothing in the clear.
- [ ] Navigation gate: signed-in provisioned users go to Projects, then the inbox. Assurance wizard appears only when the active session's role requires it.
- [ ] One mapper from server profile to local state; delete the three copies.

### Step 6: Mobile per-project behaviour
- [ ] Inbox, threads, telemetry and notifications key off `activeProjectId`. Telemetry pings the active project only.
- [ ] Register the push token against the account (and against each join session), and route taps to the right project, switching if needed.
- [ ] Show the server role name and assurance weight in the profile header. Remove the demo persona switcher's local role rewrite, or keep it strictly under the demo flag with a visible banner.
- [ ] Chat sender labels use the role name from the server.

### Step 7: Seed and tests
- [ ] Seed: mark "Monitor Inspector" as provisioned for the demo tenant; give `monitor@insite.ng` that mobile role and assignments to both demo projects; keep Clerk of Works and Contractor Site Engineer on join codes.
- [ ] Server tests: mobile login success and each refusal; lazy session creation is idempotent under 10 parallel first requests; visibility follows assignments; unassigning removes access on the next request; switching a role to provisioned deactivates its codes; provisioned sessions skip the assurance gate; device revoke blocks all projects.
- [ ] Manual script: one account, two projects, capture offline on project A, switch to B, capture, go online; each item lands on its own project.

---

## 6. Definition of done

- A monitor created in web admin signs in on mobile and sees both projects without a code or an assurance step.
- A contractor still joins with a code and goes through assurance when their role requires it.
- No screen or store in the app assumes a single project.
- Master plan status updated.

## 7. Found during implementation

_Add items here rather than expanding scope._
