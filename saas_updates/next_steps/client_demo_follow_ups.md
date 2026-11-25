# Next step: client demo follow-ups

**Raised:** 2026-11-25 (owner). **Status:** not started. Work agreed in `saas_updates/client_demo_updates/implementation_plan.md` that the demo build (`working_plan.md`, waves 1–4) did **not** fully build. Items a wave did not reach move here too. Section letters point into the implementation plan, which holds the design. Update this file after the demo with the client's answers (`demo_questions.md`).

## 1. Replace the demo shortcuts

| Shortcut taken for the demo | Proper work | Plan ref |
| :--- | :--- | :--- |
| Terminology renamed in labels only | In-depth rename: tables, columns, enums, permission keys, routes, type config keys, KPI keys, mobile SQLite, workbook headers; one migration (the database is re-seeded, so no compatibility layer) | A.3, A.4 |
| Seed overlay on top of the old seed (`SEED_PROFILE=ubec-demo`) | Full seed replacement: one UBEC generator, delete the first tenant, re-point route tests | C5, `seed_replacement_plan.md` |
| 8 minimal roles created by the overlay (the 14-role breakdown is a slide); `admin@` keeps every key and covers Legal and Audit off-screen | Role catalogue migration to the client's confirmed list: default roles, renames by JSON path, CoC slots by role code, separation-of-duty tests, System Administrator without sign-off keys | B, `role_catalogue_migration_plan.md` |
| Regions, `stateLocation`, `lgaLocation`, `parties` kept but unused | Remove the Regions module and `regionId`; drop the old text columns; retire `parties` from the wizard for good | C1, D2 |
| Sites in their light form: data, setup, register, map, per-site progress; visits and check-in stay per project | Per-site visit scheduling and officers, check-in against the site boundary, per-site handover, site-aware field app | C2 |
| Heavy contractor actions recorded as "Sent to Legal review" | Run them through the default-case chain (Legal review → ES / Executive Chairman) with their effects: deduction lines, stop-work, suspension | F.4 |
| Approved lists seeded and read-only (wave 3) | Upload from a template, more red-flag rules, disposition workflow | E3 |

## 2. Not built yet

| Item | Plan ref |
| :--- | :--- |
| Signed paper documents: QR forms, comparison with the original, verification gates (slide only in the demo) | E4 |
| Site-level KPIs | C2 |
| Project code override with reason; legacy `DI-2CLR` / `REN` codes on import | C3 |
| "Historical record" switch on drafts | D5 |
| AI fallback for needs assessment parsing (after UBEC's NDPA answer); rewrite decision Z in `CLAUDE.md` when built | D1, D1.1 |
| Address geocoding (if not done overnight); boundary from the baseline check-in GPS | D3 |
| Visit calendar: click to add, drag to move (and the read-only calendar if cut) | D4 |
| Annual list upload (if cut); red-flag rules beyond budget mismatch (double funding, photo reuse, contractor capacity, late submission); disposition workflow | E3 |
| Contractor replacement with sequential engagements (changes decision T); contractor performance report | F.4, F.5 |
| Payments breakdown table (if cut) | G |
| Security: MFA, sessions, column encryption, certificate pinning | E1, `irl_follow_ups.md` |
| Tamper evidence: record seals, signed ledger, external anchors, DB grants and pgAudit, file re-hashing, Integrity page | E2 |
| NDPA privacy notice and retention settings | C6 |

### Left over from wave 1 (2026-11-25; details in `working_plan.md` "Wave 1: found during implementation")

| Item | Plan ref |
| :--- | :--- |
| Settings control for `Tenant.fiscalYearStartMonth` (the column exists, default January) | D5 |
| Payments: "group by month / quarter" subtotals, and the Breakdown table and sheet (by zone, state, LGA, contractor, project, month) | G.1, G.2 |
| Funding source: the register import keeps unknown funding text with no code instead of refusing it; decide once UBEC confirms the list (Q7) | C4 |
| `GET /projects/register/options`: add the zones and states present | C1 |
| Needs assessment import: set `stateCode` / `lgaCode` and apply the intervention year rule (folds into D1, wave 2) | C1, D5 |
| Demo seed: Demo 1's approved monitoring reports with photos and a finding rectified on a follow-up check; #16 with a CoC (Oyo SUBEB signatories) (SEED part 2, wave 2) | C5 |
| Workbook sheet and header names ("Sprints", "Start sprint", "End sprint", "Region") with the in-depth rename and a new version stamp | A.3 |
| Tenant region picker labelled "Programme zone (workspace list)" still on the basics form and KPI filters; remove with the regions module | C1 |
| `routes.irl.register.test.ts` and the year rule: dates now relative to today; review other tests for literal years before 2028 | D5 |

## 3. Tests owed by the overnight build

Route tests for the new modules (sites, contractors and flags, approved lists, needs-assessment-first creation), and the owed click-throughs added to `web_testing_checklist.md` and `physical_testing_checklist.md`. Wave 1 wrote route tests for lots and codes (`routes.demo.lots.test.ts`) and portfolio payments (`routes.demo.payments.test.ts`). The demo role switcher needs none: it reuses the existing password sign-in (decision W1.9), so there is no server endpoint to refuse.
