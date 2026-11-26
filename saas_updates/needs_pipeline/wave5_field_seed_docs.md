# Needs Pipeline · Wave 5: Field verification, seed, demo, docs (N8 + N9)

Parent plan: `saas_updates/needs_pipeline_implementation_plan.md`. **Contract names: parent plan section 17.**

**Starts when:** wave 4 exit criteria are met. **Outcome:** verification visits from the field app; a seed and demo that tell the whole story from need to live project; docs and owed checks complete.

## 0. Start of wave (main thread)

1. Read wave 4 "Found during implementation".
2. Main: migration `<ts>_needs_verification` (`NeedsVerification`: proposal, site, assigned officer, due date, status, form snapshot id/hash, submission JSON, captures) and the form library template kind `NEEDS_VERIFICATION` (default template in `defaultFormLibrary.ts`: per site GPS and photos; per breakdown row existing quantity, condition, photo).
3. Main: server endpoints (assign from the Validation tab or the BEAP review; `GET /api/v1/needs-verifications/mine`; form with ETag; submit idempotent on a client UUID; captures linked; acceptance fills the validation record and corrects site coordinates). Mobile accounts get access by assignment, not by project session (`accessControl.ts` change, reviewed).

## 1. Tracks

### Track A (agent): mobile (N8)

Owns: `mobile/src/**` for verification only (new store, sync, screens reuse `VisitForm`/`VisitReview`), SQLite migration v12, mobile unit tests (added to the explicit list in `mobile/package.json`).

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| A1 | SQLite v12: `needs_verifications`, drafts; feed sync with the visit feed | | TODO |
| A2 | Home: verifications in the calendar and day list; verification screen (sites, map, form) | | TODO |
| A3 | Outbox kind `NEEDS_VERIFICATION_SUBMISSION` (waits on its captures); offline end to end | | TODO |
| A4 | Pure utils tested in Node; device checks added to `physical_testing_checklist.md` (`PT-N8-*`) | | TODO |

### Track B (agent): docs

Owns: `CLAUDE.md` (a "Needs pipeline" architecture section; update "Client demo updates" where D1 is described), `saas_updates/configuration_reference.md` (`needsPipeline`, costing standards), the demo script (`client_demo_updates/demo_script.md`: new opening act from need to project), `web_testing_checklist.md` (collect every `WT-N*`), `demo_accounts.md` (new logins).

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| B1 | CLAUDE.md section | review by main | TODO |
| B2 | Configuration reference | | TODO |
| B3 | Demo script and accounts | rehearsal (owed) | TODO |
| B4 | Owed checklists complete | | TODO |

### Main thread: seed and demo pack (N9)

Owns: `server/src/db/seedNeedsPipeline.ts` (runs after `seedAlerts.ts`), `seedDemoOverlay.ts` changes, `server/src/scripts/buildDemoPack.ts`.

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| M1 | Normal seed: 2027 DI cycle with about 12 proposals across every stage and status (a duplicate, an essential gap, a rate variance, a returned one, one below the line, one excluded at approval), committee with scores and one divergence; Kano 2027 MG cycle with a BEAP in UBEC review; one out-of-cycle request waiting for the ES. **No new projects** (earlier route tests assert project lists) | | TODO |
| M2 | Existing seeded projects get origin and a converted proposal in a closed 2026 cycle (history only) | | TODO |
| M3 | Demo overlay: its projects get proposals in closed cycles; one 2027 proposal ready to be appropriated live in the demo | | TODO |
| M4 | Demo pack: template v2 files (single, batch of five with one invalid), appropriated schedule file | | TODO |
| M5 | `routes.demo.test.ts` updated for the new opening act | | TODO |

## 2. Scenario steps turned green

FIELD-01. Both suites fully green.

## 3. End of wave (final)

Final full gate (normal and `ubec-demo` seed); `/code-review high` on mobile access by assignment and the seed; parent plan section 15 completed; status line at the top of the parent plan set to "done".

## 4. Verification

| Gate | Typecheck | Lint | Web build | Server unit | Server routes | Mobile | Seed (normal / demo) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Final | | | | | | | |

## 5. Found during implementation

## 6. Exit criteria

Every row VERIFIED or BUILT with owed `WT-*` / `PT-*` checks; `routes.needs.scenarios.test.ts` has no `todo`; final gate recorded.
