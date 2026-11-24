# Next step: refuse web sign-in for mobile-only roles

**Raised:** 2026-11-24 (owner, UBEC rebrand). **Status:** not started; deliberately left for later.

## The rule

Resident Supervisors use the field app only. They must not be able to sign in to the web portal at all. The same holds for any role whose `surface` is `MOBILE`.

## Today

- `loginWebUser` (`server/src/modules/auth/auth.service.ts`) checks the password and issues a `WEB_USER` token for every active user. It never looks at the role's `surface`.
- A Resident Supervisor (`resident.supervisor@ubec.test`, role `INDEPENDENT_RESIDENT`, surface `MOBILE`) therefore signs in to the web. They see an empty portal, because their role has no web permissions; the API refuses their calls with 403.
- `server/src/tests/routes.r4.test.ts` signs the resident in on the web on purpose, to check that the web API refuses them (around line 335).

## Change

1. **Server.** In `loginWebUser`, after the password check, refuse a user whose main role's `surface` is `MOBILE`:
   - status 403, error code `WEB_ACCESS_NOT_ALLOWED`;
   - message: "This account is for the field app. Sign in on the mobile app instead."
   - A role with surface `BOTH` keeps web access. The M&E roles are `BOTH`.
   - Platform super admins are never refused.
2. **Existing tokens.** Make the web auth middleware refuse the same users. A token issued before the change must stop working too.
3. **Web.** The sign-in page shows the server's message, with a link to `/mobile-app`.
4. **Tests.**
   - Replace the r4 check with one that expects 403 `WEB_ACCESS_NOT_ALLOWED` at sign-in.
   - Add a unit test for the surface rule: `MOBILE` refused, `BOTH` allowed, `WEB` allowed, platform admin allowed.
5. **Docs.** CLAUDE.md, under "No contractor login": state that mobile-only roles have no web sign-in.

## Applies to every tenant

The change is not specific to UBEC. Check the first tenant's mobile roles (`resident.cow@`, `field.officer@`, `resident.abj@`). They should already be mobile-only, so they are refused too. Confirm with the owner that nobody relies on web access for them.
