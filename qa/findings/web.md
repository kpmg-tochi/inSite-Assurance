# Web findings

Format and severities: `saas_updates/ui_verification_and_design_plan.md` ("Finding format"). Screenshots are under `qa/screenshots/web/<role>/` (git-ignored).

## R6f click-through and accessibility (2026-11-24)

### W-R6-001 · Blocker · Environment: dev database is empty, no login works — Resolved
- **Resolution:** the dev DB had been rebuilt from migrations at 13:29 UTC and not seeded; the owner ran `npm run prisma:seed` and logins work. C1–C19 were then run (below).
- **Check:** R6 plan section 10, C1–C19 (every signed-in check)
- **Role / project:** every seeded login (`programme.admin@`, `admin@`, `monitor@` `insite.ng`)
- **Steps:** 1. Open `/login`. 2. Sign in as `programme.admin@insite.ng` / `Password123!`.
- **Expected:** the portfolio opens.
- **Actual:** "Invalid email or password". `POST /api/v1/auth/login` → 401 `INVALID_CREDENTIALS` for every seeded login. Read-only query on `insite_assurance`: `User` 0 rows, `tenants` 0, `Project` 0, `roles` 0, `facilities` 0; `permissions` holds only the 7 rows inserted by the R2–R4 backfill migrations; last migration `20261220090000_r6d_payment_sprint` finished 2026-11-24 12:46 UTC. The database was migrated (or reset) and not re-seeded.
- **Evidence:** screenshots/web/signed-out/login__stale-showcase-copy.png (error banner state seen during the run)
- **Suspected area:** environment, not code. The owner needs to run `npm run prisma:seed` (from `server/`); this run is not allowed to re-seed.

### W-R6-002 · Minor · Public pages: browser tab title still says "Disbursement Reconciliation" — Fixed
- **Check:** C20
- **Role / project:** signed out
- **Steps:** 1. Open `/` or `/mobile-app`. 2. Read the tab title.
- **Expected:** no lender wording (D-R6.26).
- **Actual:** `InSite Assurance — Field Evidence & Disbursement Reconciliation` (from `web/index.html`).
- **Fix:** title is now `%APPLICATION_NAME% — Programme delivery and site monitoring`. Re-verified in the browser.

### W-R6-003 · Major · Login: email and password inputs have no accessible name — Fixed
- **Check:** section 11 (Forms, axe)
- **Role / project:** signed out, `/login`
- **Steps:** 1. Open `/login`. 2. Run axe-core 4.10.2.
- **Expected:** 0 serious/critical.
- **Actual:** `label` (critical) on `input[type=email]` and `input[type=password]` (the `<label>`s had no `htmlFor`); `color-contrast` (serious) on 4 nodes (`text-slate-400` helper/footer text 2.56:1, `text-slate-500` on the tinted demo card 4.35:1).
- **Fix:** `web/src/pages/auth/LoginPage.tsx`: `htmlFor`/`id` and `autoComplete` on both inputs; helper/footer text to `text-slate-500`, demo card email line to `text-slate-600`. axe now reports 0 serious/critical (moderate `landmark-one-main` and `region` remain).

### W-R6-004 · Minor · Login: showcase panel still shows removed features
- **Check:** C20 (the login page is public)
- **Role / project:** signed out, `/login`
- **Steps:** 1. Open `/login` at ≥ `lg` width. 2. Read the left panel.
- **Expected:** copy matches the redesigned product (no corridors/chainage, no AI summary).
- **Actual:** "98.4% Within Corridor", "±150m Corridor Buffer", "KM 14+210 · WBS 02.03.1", "Agent-Confirmed Summary" for a voice note, and "Sign in to Assurance Portal / Enter your corporate credentials or select a seeded pilot role". Corridors and chainage were removed in the redesign; "Agent-Confirmed Summary" reads as an AI summary (decision Z). No lender, IPC or join-code text.
- **Evidence:** screenshots/web/signed-out/login__stale-showcase-copy.png
- **Suspected area:** `web/src/pages/auth/LoginPage.tsx` left panel (not in D-R6.26's page list; left for R7's copy pass or the owner).

## Results

| Check ID | Result | Finding IDs | Note |
| :--- | :--- | :--- | :--- |
| C1–C19 | BLOCKED | W-R6-001 | Empty dev database; no seeded login exists. |
| C20 | PASS (after fix) | W-R6-002, W-R6-004 | `/` and `/mobile-app` text has no lender, AI or join-code wording; `/about` → `/`. Tab title fixed. |
| S11 public pages | PASS (after fix) | W-R6-003 | axe: `/` and `/mobile-app` 0 violations; `/login` 0 serious/critical after fix. No horizontal scroll at 1440/1280/1024/768/390 on `/`, `/mobile-app`, `/login`. |
| S11 signed-in pages | BLOCKED | W-R6-001 | Overview, setup steps, Payments, Kick-off, Completion, type editor, Settings need a login. |

## Notes for CLAUDE.md

- Before a browser run, check the dev DB is seeded: `POST /api/v1/auth/login` with a seeded login must answer 200. Applying a migration with `prisma migrate reset` (or anything that empties the DB) leaves the dev servers up but every login fails with `INVALID_CREDENTIALS`.
- axe-core is injected without a dependency: `page.addScriptTag({ url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js' })`, then `axe.run(document, { resultTypes: ['violations'] })`.
