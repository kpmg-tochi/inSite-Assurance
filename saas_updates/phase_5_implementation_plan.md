# Phase 5: Provisioned Mobile Users and Multi-Project Mobile

| | |
| :--- | :--- |
| **Status** | Implemented (2026-11-19); web click-through and on-device testing pending |
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
- [x] `RoleOnboardingModeEnum`; add `onboardingMode` to role DTO and create/update schemas, with a refinement that `PROVISIONED_ACCOUNT` implies `requiresIdentityAssurance === false` and surface is not `WEB`.
- [x] `MobileLoginRequestSchema` (email, password, device ID, model, OS, public key), `MobileLoginResponseSchema` (token, user profile, mobile role summary, project list).
- [x] `MobileProjectSummarySchema` (id, code, name, location, role name, persona, weight, geofence mode, pending-outbox hint not included; that is local).
- [x] Add `mobileRoleId` to tenant-user create and update schemas and DTOs.
- [x] One exported mapper type for "session profile" so the app stops hand-mapping.

### Step 2: Server authentication
- [x] `POST /auth/mobile/login`: same credential checks, lockout and tenant-status checks as web login. Refuse with a clear code if the user has no provisioned mobile role (`NO_MOBILE_ACCESS`). Upsert `MobileDevice`; refuse a revoked device. Issue a token `{ tokenType: 'MOBILE_USER', userId, tenantId, deviceRowId, tokenVersion }`.
- [x] Extend the Phase 2 auth loader: for `MOBILE_USER` tokens on a project-scoped route, resolve the user's effective mobile role, check project visibility, then find or create the `FieldAgentSession` for `(userId, projectId, deviceId)` with `origin = PROVISIONED_ACCOUNT`, `assuranceStatus = APPROVED`, and role snapshots. Populate `req.fieldAgent` exactly as for join-code sessions, so no downstream service changes.
- [x] Session creation is lazy (first request per project) and idempotent under concurrency (unique constraint plus retry).
- [x] `GET /auth/mobile/projects`: visible active projects for the user with the effective mobile role per project.
- [x] `GET /auth/mobile/projects/:projectId/baseline`: the baseline pack (geofence, BOQ items, hold points, cadence) that join currently returns.
- [x] `/auth/me` supports `MOBILE_USER`.
- [x] Revocation: revoking a `MobileDevice` or deactivating the user blocks all their sessions through the loader. The existing per-session revoke still works for a single project.
- [x] Web tokens are refused on mobile-only routes and the reverse.

### Step 3: Server role and user management
- [x] `updateRoleForTenant`: handle `onboardingMode` changes. Switching to provisioned deactivates the role's active join codes in a transaction and writes `ROLE_ONBOARDING_MODE_CHANGED`. Switching back issues codes for active projects (reuse the Phase 2 issue endpoint logic).
- [x] Project activation and join-code generation skip provisioned roles.
- [x] `createUserInTenant` and `assignUserProjectsAndRole`: accept and validate `mobileRoleId` (same tenant, right surface and mode).
- [x] When a user gains a project assignment and has mobile access, send a push "You've been added to {project}" to their registered devices.
- [x] Roster endpoint (`listProjectFieldSessions`): include `origin`, linked user, and device; add a tenant-level "mobile users and devices" list.

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
- [x] Seed: mark "Monitor Inspector" as provisioned for the demo tenant; give `monitor@insite.ng` that mobile role and assignments to both demo projects; keep Clerk of Works and Contractor Site Engineer on join codes.
- [x] Server tests: mobile login success and each refusal; lazy session creation is idempotent under 10 parallel first requests; visibility follows assignments; unassigning removes access on the next request; switching a role to provisioned deactivates its codes; provisioned sessions skip the assurance gate; device revoke blocks all projects.
- [ ] Manual script: one account, two projects, capture offline on project A, switch to B, capture, go online; each item lands on its own project.

---

### Step 8: Added from Phase 4 (owner, 2026-11-19)

**Unsent items after a session ends and the person rejoins.** Today, captures and notes queued under a revoked session are sent under the new session, but a report that links captures registered by the old session is refused (`CAPTURE_NOT_OWNED`) and lands in "Could not be sent". Owner direction:
- [ ] On rejoin, mark every unsent chat item (photo, voice note, note, report) from the ended session with a small exclamation icon in the WBS thread. Hold these items out of the outbox until the person decides.
- [ ] Tapping the icon explains that the item was captured under a session that has ended and will not be included as evidence as it is.
- [ ] Two actions: **Remove** it from the thread (deletes the local file and the outbox row), or **Update** it for the current session. Update re-validates it as a new capture: a new client ID, a fresh signature with the current key and session, and the original capture time and GPS fix kept as provenance. The server records it as re-submitted under the new session, with a link to the original capture ID. A report must be re-confirmed by the person.
- [x] Server: a capture re-submitted this way is flagged (for example `RESUBMITTED_AFTER_SESSION_END`) so reviewers can see it, and it is never silently merged into the old session's evidence.
- [x] Tests: revoke, rejoin, remove, update; the updated item is accepted once and the removed one never reaches the server.

**Project-wide notifications that need an action.** Read state is per field session since Phase 4 (`MobileNotificationRead`). Today the only project-wide notification that requires action is the monitor's IPC-line clarification request (`reconciliation.service.ts`, `REPORT_QUERY` with `monitorQueryId`, sent to everyone on the project). Personal notifications (report queries, identity approved or returned, query resolved) are unaffected. Owner direction:
- [x] Add `actionedAt` and `actionedBySessionId` / `actionedByUserId` to `MobileNotification`. When anyone completes the required action (responds to or resolves the monitor query, or submits the revision it asked for), set `actionedAt`. The notification then shows as done for everyone, with "Answered by {name}", and stops counting as unread or action-required.
- [x] Map each action-required type to the event that completes it, in one place: monitor query responded or resolved, report query resubmitted or resolved, identity resubmitted.
- [ ] Mobile notification centre: actioned items move out of the "needs action" group.
- [x] Tests: two sessions on one project; one acts; the other sees it actioned, not unread.

## 6. Definition of done

- A monitor created in web admin signs in on mobile and sees both projects without a code or an assurance step.
- A contractor still joins with a code and goes through assurance when their role requires it.
- No screen or store in the app assumes a single project.
- Master plan status updated.

## 7. Found during implementation

_Add items here rather than expanding scope._

**Verification state (2026-11-19).** Server: `npm run test` passes (81 unit, 111 route incl. 21 Phase 5). Root typecheck, web build and mobile unit tests (26) pass. Steps 4 to 6 compile and are written but have not been clicked through in a browser or run on a device, so they stay unticked; so does the manual two-project offline script in Step 7.

**Step 8 part 1 (unsent items after a session ends and the person rejoins), as built.**
- Device: local DB migration v2 adds `outbox.session_key` (the session an item was queued under: `join:<sessionId>` or `account`), `captures.resubmitted_from` and `captures.superseded_by`. New outbox status `HELD`: never sent; rows that depend on a held row wait. On rejoin (`addJoinSession` with a new session id), every unsent capture, chat message, report and revision of the project from another session, or queued before session keys existed, is held (`storage/heldItems.ts`; rule in `outboxPolicy.shouldHoldOnNewSession`, unit tested).
- Thread: held messages show an amber warning row; tapping explains and offers Remove or Update. A held report shows as a banner with Remove or Re-confirm.
- Remove deletes the message, its unsent capture, the local file and the outbox rows. Update copies the file under a new client ID, signs it again with the current key, keeps the original capture time and fix, marks the original superseded and queues the new one under the current session. Re-confirm re-submits every capture the report linked (including any the ended session already registered, which the new session may not link), deletes the held report and opens the confirm sheet so the person confirms again.
- New reports never pick up superseded or held captures, or held notes.
- Server: `RegisterCaptureRequest.resubmittedFromClientCaptureId`. If the original reached the server it must be on the same project, under another session that has ended, from the same device; otherwise 422 `INVALID_RESUBMISSION`. The capture is recorded under the caller's session with flag `RESUBMITTED_AFTER_SESSION_END` (non-critical), links (`resubmittedFromClientCaptureId`, `resubmittedFromEvidenceLogId`), and duplicate screening ignores the original itself (otherwise the identical bytes would be flagged as reuse). The original keeps its session. The web capture list shows a "Re-submitted after session ended" badge.
- Tests: server (revoke, rejoin, update accepted once with flag and link, original unchanged; original never sent; invalid link refused) and device policy. "The removed one never reaches the server" is enforced on the device (row and file deleted) and needs the on-device check.
- Telemetry pings and incidents are not held: they are not chat evidence, and whistleblowing must still go out.

**Gaps in the plan, resolved as follows:**
1. A `MOBILE_USER` token carries no project. The project comes from the URL `:projectId` (the project guard passes it explicitly). Routes without a project: `/auth/device-key` and `/auth/assurance-verification` refuse provisioned accounts (key registered at sign-in; no assurance), `/auth/push-token` registers against the account, `/auth/me` returns account and projects.
2. Added `GET /auth/mobile/projects/:projectId/session` so the app learns its own session id (chat "mine" detection) and the server role and weight. Also creates the session on first use.
3. Auth cache: `invalidateUserAuthCache` now also clears mobile-account and provisioned-session entries, so unassigning, removing the mobile role, deactivating and device revoke take effect on the next request (single instance; the Phase 2 multi-instance lag of up to 30 s still applies).
4. A new key on a known device (reinstall) replaces the key on the `MobileDevice` row and its sessions at password sign-in; audited (`keyReplaced`).
5. Switching a role back to join codes removes mobile access for users whose mobile role it is: the effective role is checked on every request (`NO_MOBILE_ACCESS`).
6. Forced password change on mobile: `POST /auth/mobile/change-password` returns a fresh mobile token; other web and mobile tokens are revoked.
7. `PushToken.deviceToken` was globally unique, but one phone holds an account and several join sessions. Now unique per `(deviceToken, ownerKey)`; pushes to a provisioned session reach the account's non-revoked mobile devices; `MobileDevice` revoke deletes that device's tokens.
8. `FieldAgentSession.agentPhoneNumber` is required; provisioned sessions use `User.phoneNumber` or `''`.
9. "Only ACTIVE projects": no project status exists until Phase 6, so no filter yet (comment in `mobileAccess.ts`).
10. Chat sender role on the server was a persona bucket (`ENGINEER`/`INSPECTOR`); it is now the role name.
11. Sign-in is audited as `MOBILE_USER_SIGNED_IN` with actor type `WEB_USER` (the account), since `AuditActorType` has no account-on-mobile value.
12. The roster's `joinCodeUsed` is now nullable; `ContractorVerificationRecordDto.joinCodeUsed` stays a string (`''` for provisioned sessions, which never need verification).

**Migrations.** Phase 5 landed as five migrations (`…180000_phase5_provisioned_mobile`, `…181000_phase5_push_token_device`, `…182000_phase5_push_token_owner`, `…184000_phase5_notification_actioned`, `…186000_phase5_capture_resubmission`) because resetting the dev database was not allowed in the session. They can be squashed into one before deploy (decision A).

**Mobile store migration.** The v2 single-project profile is migrated on first launch into the v3 device state (persona plus one join session); the old key is deleted.
