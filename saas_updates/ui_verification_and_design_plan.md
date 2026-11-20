# UI Verification and Design Cleanup Plan

| | |
| :--- | :--- |
| **Status** | Phase 1 not started |
| **Covers** | Browser click-through (web) and emulator run (mobile) of everything built in SaaS Phases 1 to 10, then a design cleanup |
| **Read first** | `CLAUDE.md`, then [master plan](saas_implementation_plan.md) section 6, then this file |

The SaaS programme is implemented and covered by automated tests, but its web and mobile screens have only been checked by typecheck, build, lint and unit tests. This plan verifies them by hand through tools, records what is wrong, fixes it, then cleans up the design without breaking anything.

| Phase | What | Runs as | Output |
| :--- | :--- | :--- | :--- |
| 1 | Click-through: **1a web** (Playwright MCP) and **1b mobile** (Maestro MCP), in parallel | One coordinating session + two agents | Findings, screenshots, saved re-runnable flows, checklist results |
| 2 | Fix what Phase 1 found | Normal sessions, grouped by area | A clean functional baseline |
| 3 | Design cleanup with Impeccable | Dedicated sessions | `PRODUCT.md`, `DESIGN.md`, consistent UI |
| 4 | Regression | One session | Saved flows re-run green, before/after screenshots, checklists closed |

**Never mix phases.** Phase 1 records and does not fix code. Phase 3 changes appearance only and does not change behaviour. A bug found in Phase 3 or 4 goes to the findings file, not into the design change.

---

## Shared conventions

### Environment (already running in the owner's terminals; do not start, stop or restart them)

| Thing | Value |
| :--- | :--- |
| Web app | `http://localhost:5173` |
| API | `http://localhost:4000/api/v1` (health: `/api/v1/health`) |
| Mobile app | Development build `com.kpmg.insiteassurance.mobile` on the Android emulator, connected to the Expo dev server |
| Mobile API from the emulator | `http://10.0.2.2:4000/api/v1` (the emulator's alias for the host) |
| Data | Freshly seeded. Web logins, all `Password123!`: `admin@`, `monitor@`, `lender@`, `lto@`, `contractor@`, `verifier@` `insite.ng`. Mobile join codes are listed under each project's join codes page (admin). `monitor@insite.ng` also signs in on mobile as a provisioned Monitor Inspector. |

**Precondition (owner):** `server/.env` must set `PUBLIC_API_BASE_URL` to the computer's LAN address (e.g. `http://192.168.1.156:4000`) and the API must have been restarted since. Upload and media URLs are built from it; the default `http://localhost:4000` is unreachable from the emulator, so every mobile photo or voice upload would fail. Step 1.0 checks this: a presign response's `uploadUrl` must start with the LAN address.

If something is down or misconfigured, **stop that track and tell the owner**. Do not work around it, re-seed or change `.env`.

### Artifacts (all under `qa/` at the repo root)

```
qa/
  findings/web.md          # Phase 1a writes only this findings file
  findings/mobile.md       # Phase 1b writes only this findings file
  findings.md              # merged by the coordinator at the end of Phase 1; Phase 2+ works from this
  checks.md                # Phase 1.0: the numbered check list for Phases 5 to 10 (see below)
  screenshots/web/<role>/<area>__<state>.png
  screenshots/mobile/<persona>/<area>__<state>.png
  flows/web/*.spec.ts      # Playwright tests, one per flow (Phase 1a)
  flows/mobile/*.yaml      # Maestro flows, one per flow (Phase 1b)
  playwright.config.ts
```

- `qa/screenshots/` is git-ignored (binary, local reference for Phase 3). Findings, checks and flows are committed.
- Screenshot names: lower-case, hyphenated, e.g. `screenshots/web/lender/reconciliation__decide-modal-cp-blocked.png`. Take one per screen and per meaningful state: empty, loaded, error/refusal, each permission variant you can see. These are the "before" set for Phase 3.

### Finding format

One entry per problem, numbered per track (`W-001`, `M-001`):

```markdown
### W-007 · Major · Reconciliation workbench: Review button missing for added chain step
- **Check:** P7-W-12 (qa/checks.md) / phase_7 Step 7 "Reconciliation workbench"
- **Role / project:** admin@insite.ng / EDO-410
- **Steps:** 1. … 2. … 3. …
- **Expected:** …
- **Actual:** …
- **Evidence:** screenshots/web/admin/reconciliation__review-missing.png; console error "…"; network `POST …` → 409 `VALUATION_AWAITING_APPROVAL_STEP`
- **Suspected area:** `web/src/pages/reconciliation/ReconciliationWorkbenchPage.tsx` (only if obvious; do not investigate code in Phase 1)
```

Severity: **Blocker** (stops the flow or the track), **Major** (wrong behaviour, wrong data, misleading state, security/permission issue), **Minor** (works but awkward, wrong copy, missing feedback), **Cosmetic** (visual only; also feeds Phase 3).

Each findings file ends with:
- a **Results** table: `Check ID | Result (PASS / FAIL / BLOCKED / NOT RUN) | Finding IDs | Note`;
- **Notes for CLAUDE.md**: setup facts and gotchas a future session would need (e.g. how to reach a screen, a quirk of the emulator). The coordinator merges these.

### Shared data rules (both tracks use one database)

- **Mobile track owns** LKK-402 (IPC process, contractor + resident reporting) and EDO-410 (M&E-only, direct release, report approval). The web track may read and act on them (review a report, certify, decide) but must **not change their project settings or process configuration**, rotate their join codes or archive them.
- **Web track** changes settings only on KAN-210, OGN-305, OGN-501, KWR-502 and projects it creates in this run (prefix new project codes `QAW-`).
- Cross-surface checks (mobile submits, web reviews) are encouraged: the coordinator lists them in `qa/checks.md` as paired checks and tells each agent its half.
- Never re-seed, reset or edit the database directly. Never edit `.env`.

---

## Phase 1: Click-through

### 1.0 Prepare (coordinator, before starting the agents)

1. Create the `qa/` structure above. Add `qa/screenshots/` to the root `.gitignore`.
2. Build `qa/checks.md`: from every **unticked** web or mobile item in `phase_5` … `phase_10_implementation_plan.md` (UI steps, Definition of done items), plus the Phase 7 gap-closure notes, write numbered, testable checks in the style of `physical_testing_checklist.md`: `P7-W-01` (web) / `P7-M-01` (mobile), each with role, project, steps and expected result. Group by phase, mark cross-surface pairs. Phases 1 to 4 are already in `physical_testing_checklist.md`; use those IDs as they are.
3. Web test runner: add `@playwright/test` as a root devDependency, `qa/playwright.config.ts` (baseURL `http://localhost:5173`, Chromium, screenshots on failure, no webServer block because the servers are already running), and run `npx playwright install chromium`.
4. Check the environment table above (health endpoint, web login page, `list_devices` shows the emulator with the app installed) and the `PUBLIC_API_BASE_URL` precondition. Stop and report if anything fails.
5. Start agents 1a and 1b **in parallel**, each with: this file, `CLAUDE.md`, its slice of `qa/checks.md` and `physical_testing_checklist.md`, the data rules, and its single findings file.

### 1a Web (agent, Playwright MCP)

- Scope: every web check (`P*-W-*`) in `physical_testing_checklist.md` and `qa/checks.md`, in phase order, signed in as the role each check names. Sign out between roles.
- For each check: perform it with the Playwright MCP, screenshot every screen and state, watch the browser console and failed network requests, record PASS/FAIL. On a failure, write the finding and continue with the next check unless it is a Blocker for later ones.
- Also do one **role sweep**: for each seeded role, visit every navigation entry and confirm what is shown and hidden matches its permissions (a page that loads for a role that should not see it is a Major finding).
- Save every passing flow as a Playwright test in `qa/flows/web/` (one spec per flow, names matching the check IDs, role logins in a shared helper). Run `npx playwright test -c qa/playwright.config.ts` at the end; every saved spec must pass, otherwise it records a finding.

### 1b Mobile (agent, Maestro MCP)

- Scope: every mobile check (`P*-M-*`) in `physical_testing_checklist.md` and `qa/checks.md`. Skip checks that need a second physical phone, real push delivery, or a real camera scene, and mark them **NOT RUN (needs device)** with the reason.
- Personas: a provisioned account (`monitor@insite.ng`, verifier), a join-code resident (COW code), a join-code contractor (CON code, includes the identity check). The data rules decide which projects.
- Use `inspect_screen` before targeting elements. Save each flow as YAML in `qa/flows/mobile/` and use the flow's `takeScreenshot` command so screenshots land in `qa/screenshots/mobile/<persona>/`.
- Include offline behaviour that the emulator can simulate (airplane mode / network off, submit, back online, outbox drains) and app restart persistence.
- Re-run all saved flows at the end; each must pass or have a finding.

### 1.3 Consolidate (coordinator)

1. Merge `findings/web.md` and `findings/mobile.md` into `qa/findings.md`, sorted by severity, with duplicates merged, cross-surface pairs linked, and a summary count per severity and per area.
2. Tick checklist items **only for PASS results**, in `physical_testing_checklist.md` and in the phase files (UI steps and Definition of done), each tick citing the check ID. FAIL and BLOCKED stay unticked with the finding ID beside them.
3. Merge the agents' "Notes for CLAUDE.md" into `CLAUDE.md`, adding a short **UI verification** section: where `qa/` artifacts live, how to run `qa/flows` (web and mobile), the emulator API alias and app id. Keep it short; do not repeat this file.
4. Update this file's status line and report: counts, Blockers and Majors, anything not run and why.

**Exit:** every check has a result; findings merged; flows saved and green (or failing with a finding); no code changed outside `qa/`, `.gitignore`, `package.json`/lock (Playwright), `CLAUDE.md` and checklists.

---

## Phase 2: Fix

- Work from `qa/findings.md`, Blockers and Majors first, grouped by area so each session touches one part of the code. Web and mobile fixes can run as parallel agents when they touch different workspaces.
- Each fix: a server or unit test where the bug is in logic; re-run the matching flow in `qa/flows`; tick the checklist item it unblocks; mark the finding **Fixed** (or **Won't fix**, with the owner's decision).
- Cosmetic findings are left for Phase 3.
- **Exit:** no open Blocker or Major; all saved flows green; full checks from `CLAUDE.md` pass.

## Phase 3: Design cleanup (Impeccable)

1. Install for this repo only: `npx impeccable install --providers=claude --scope=project`, then `npx impeccable telemetry off`.
2. `/impeccable init` (writes `PRODUCT.md`), then `/impeccable document` (writes `DESIGN.md` from the current styles). The owner reviews both before any change. Tenant branding is configurable (Phase 6 brand tokens): designs use the tokens, never hard-coded brand colours, and must hold for any tenant palette.
3. Audit and polish **one area at a time** (shell and navigation, project directory and wizard, BOQ, reconciliation workbench, presence/reports, settings, closeout), using the Phase 1 screenshots and the Cosmetic findings as input. Each area: change, re-run its flows, take "after" screenshots into `qa/screenshots-after/`.
4. Mobile: check whether Impeccable's rules apply to React Native. Where they do not, apply `DESIGN.md` by hand, following `Project Context/mobile_ui_design_guidelines.md`.
5. **Exit:** every area done; flows green; owner signs off on before/after.

## Phase 4: Regression

- Run every flow in `qa/flows` (web and mobile) and the full automated checks.
- Compare before/after screenshots for unintended changes.
- Close the remaining checklist items, set the Definition of done items in the phase files, and update the master plan status table.
- **Exit:** everything green, all checklists closed or explicitly deferred by the owner.
