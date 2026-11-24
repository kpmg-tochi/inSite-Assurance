# Seed replacement plan: one UBEC tenant, realistic data

**Status:** plan only (owner decision 7, 2026-11-24). Nothing here is implemented.
**Goal:** delete the first tenant (`kpmg-nigeria`, the `@insite.ng` logins, LKK-402, ABJ-108 and the other lender-era projects) and replace the whole seed, and the tests that rely on it, with data that matches what will really flow through the system: the UBEC tenant only, Direct Intervention and Matching Grants projects across zones and states, the UBEC roster, and visits, findings, payments and documents at realistic volumes and dates, driven by the demo script's stories.

---

## 1. Facts: what depends on the first tenant today

Collected with `grep` over `server/src/tests` for `@insite.ng`, `kpmg-nigeria`, and the first tenant's project codes (LKK-402, ABJ-108, EDO-410, OGN-501, KWR-502, ENU-501, KAN-210, OGN-305). Counts are matching lines.

### 1.1 Seed files of the first tenant

| File | What it seeds for `kpmg-nigeria` |
| :--- | :--- |
| `server/src/db/seedDatabase.ts` | The tenant, default roles, organisations, users `admin@`, `monitor@`, `lender@`, `lto@`, `verifier@`; LKK-402 (road, perimeter geofence, captures, a recorded payment) and ABJ-108; the reset list for every table; calls every other seed. Also the console summary. |
| `server/src/db/seedFieldAccounts.ts` | Mobile accounts `resident.cow@`, `field.officer@` (LKK-402), `resident.abj@` (ABJ-108) with devices and sessions. |
| `server/src/db/seedPhase6.ts` | Drafts and wizard data: ENU-501, KAN-210, OGN-305. |
| `server/src/db/seedPhase7.ts` | EDO-410 (process config, templates, standards documents). |
| `server/src/db/seedPhase10.ts` | OGN-501 (handover in progress), KWR-502 (liability period, retention on a recorded payment, two defect tickets). |
| `server/src/db/seedPayments.ts` | Recorded-payment helper (used by LKK-402 and KWR-502). |
| `seedR2.ts`, `seedR3.ts` | Facilities and form library for every tenant; sprints and units on LKK-402 and ABJ-108 (seedR2). |

### 1.2 Route and unit tests

"Main" = lines naming the first tenant; "UBEC" = lines naming the UBEC tenant (PRG-*, `ubec.test`). Every route test file calls `resetTestDatabase()`, which clones a seeded template database (`helpers/testDb.ts`).

| Test file | Main / UBEC | What it covers | First-tenant dependency | How it is re-pointed |
| :--- | ---: | :--- | :--- | :--- |
| `routes.phase2.test.ts` (29 tests) | 68 / 0 | Route security: auth, tenant isolation, demo registration, token types | `admin@`, `monitor@`, `lender@`; LKK-402, ABJ-108; registration into `kpmg-nigeria` | Rewrite on the UBEC roster. Tenant isolation needs a **second tenant**: create a minimal one inside the test (a fixture helper), not in the seed |
| `routes.phase4.test.ts` (14) | 51 / 0 | Capture registration, integrity screening, device signatures, notifications, transcription fallbacks, incidents | LKK-402, ABJ-108 and their field sessions | PRG-105 and PRG-211 with `resident.supervisor@ubec.test`; fixtures created in the test |
| `routes.phase5.test.ts` (20) | 95 / 0 | Provisioned mobile accounts: sign-in and refusals, sessions, visibility, onboarding switches, device and session revocation | `monitor@`, `admin@`, `inactive.inspector@`, `lender@`; eight first-tenant projects | Roster plus test-created accounts; projects PRG-102, PRG-105, PRG-211, PRG-221 |
| `routes.phase6.test.ts` (16) | 54 / 0 | Organisations, project wizard and lifecycle, draft exclusion, one contractor, geofence settings | `admin@`, `lender@`, `monitor@`; ENU-501, KAN-210, OGN-305, LKK-402 | Drafts created in the test on the UBEC tenant (Direct Intervention type) |
| `process.phase7.test.ts` (7) | 28 / 0 | Process config, templates, chains, standards documents | `kpmg-nigeria`; EDO-410, LKK-402; `verifier@` | A test-created UBEC project, or PRG-102; chains written in the test |
| `routes.phase8.test.ts` (2) | 4 / 0 | Job runner single-run guarantees | EDO-410, `monitor@` | Any live UBEC project |
| `routes.phase9.test.ts` (11) | 12 / 0 | Actual completion dates, planned windows from sprints, the schedule badge | LKK-402 (behind), ABJ-108 (on track), EDO-410 (legacy, unscheduled) | PRG-105 (behind, seedR4); a second Direct Intervention project on track; the "legacy, no units" case built in the test (no legacy data in the new seed) |
| `routes.phase10.test.ts` (10) | 15 / 0 | Phases, handover responses, defects, retention switches | OGN-501 (handover), KWR-502 (liability period, defects), ABJ-108 | PRG-104 (handover), PRG-103 (liability period, defects) |
| `routes.phase11.test.ts` | 6 / 60 | Hierarchy, org-tree visibility, scopes, types, regions, terminology | `ensureAssignedOnlyUser` (first tenant, LKK-402 and ABJ-108); LKK-402 has no type; `admin@insite.ng` for the "main tenant terminology" check | Assigned-only user created on the UBEC tenant (the Independent M&E already is one); the untyped-project and second-tenant terminology checks use a test-created tenant |
| `routes.phase13.test.ts` (12) | 45 / 3 | Contract anchors, document register, milestones, kick-off, default cases | `kpmg-nigeria`, EDO-410 geofence, `monitor@`, `contractor@` org, test users `p13.exec@` | Its own project already: move it to the UBEC tenant (roles by the UBEC codes) |
| `routes.phase15.test.ts` (16) | 59 / 0 | CoC, gates, closure checklist, ratings, lessons, closure pack | `kpmg-nigeria`, `monitor@`, `lender@`, `contractor@`, test users `*.me@`, `*.planning@`, `*.other@` | Same: its own project and users, recreated on the UBEC tenant |
| `routes.r1b.test.ts` (10) | 13 / 0 | Payment record, retention, exceptions, progress | LKK-402, `lender@`, `monitor@` | PRG-105 with `admin@ubec.test` (records payments) |
| `routes.r5f.test.ts` (3) | 12 / 0 | Removed endpoints answer 404 | LKK-402, ABJ-108, `monitor@` | Any UBEC project |
| `routes.r2.test.ts` | 3 / 6 | Facilities, scope and sprints, workbook | `admin@`, `lender@`, `monitor@` for permission checks | Roster logins |
| `routes.r3.test.ts` (17) | 13 / 6 | Form library, previews | `monitor@` (forms:manage), `lender@`, `lto@`; LKK-402 (carry-over), EDO-410 (no units) | PRG-105 sprint carry-over and a test-created unit-less project |
| `routes.r4.test.ts` | 1 / 15 | Visits | `monitor@insite.ng` as "another tenant" | A test-created second tenant |
| `routes.r5.test.ts` | 2 / 8 | Mobile baseline pack | LKK-402 pack | PRG-211 or PRG-221 |
| `routes.r6c.test.ts` | 5 / 42 | Overview and stage | LKK-402 legacy stage (not tracked), cross-tenant refusal | Drop the legacy case (the real data has none) or build it in the test; second tenant from the fixture helper |
| `routes.phase14/16`, `r6a`, `r6d` | 2 / … | Supervision, KPIs, setup, payments | Only incidental first-tenant lines | Already on the UBEC tenant |
| `rbac.phase1.test.ts` (unit) | 2 / 0 | Tokens and tenant provisioning shapes | Literal `admin@insite.ng` and slug in a fixture, no database | Rename the literals |

Other places that name the first tenant: `CLAUDE.md` (seed paragraph and logins), `saas_updates/web_testing_checklist.md` and `physical_testing_checklist.md` (main-workspace rows), the demo script (optional `resident.abj@` single-project home), and one web file, `web/src/pages/projects/setup/sections/BasicsSection.tsx` (the code-format hint "e.g. LKK-402"). Mobile tests use their own fixtures and name no seeded login.

### 1.3 Behaviours only the first tenant exercises today

These need a deliberate replacement, or the coverage is lost:

1. **Tenant isolation** (phase2, phase11, r4, r6c): needs a second tenant. Proposal: `helpers/secondTenant.ts` creates a minimal tenant with `createTenantWithDefaults` inside the test database, so the seed stays single-tenant.
2. **Legacy, untyped, unit-less projects** (phase9 EDO-410 "unscheduled", phase11 LKK-402 "no type", r3 EDO-410 "no units", r6c LKK-402 "not tracked"): the real system will not have them. Either drop those assertions (the branches stay in code until R7 deletes them) or build such a project inside the test.
3. **Linear-site geofence history** (LKK-402 is a perimeter along a road): the UBEC sites are schools; keep one perimeter-geofenced UBEC project so perimeter checks keep real data.
4. **Platform super admin** (`admin@insite.ng` is also platform super admin): the UBEC seed needs a separate platform operator account (for example `platform@ubec.test`, not in the demo list), because `admin@ubec.test` must stay a tenant administrator.
5. **Single-project mobile home** (`resident.abj@`): a second Resident Supervisor with one project.

---

## 2. Target data (UBEC only)

| Area | Target |
| :--- | :--- |
| Organisations | UBEC HQ; SUBEBs for every state that has a project (start with about six states across the six zones); the COREN-certified M&E firm; about 10 contractors with realistic names |
| Regions | Six geopolitical zones, the states that have projects under each |
| People | The roster (7 accounts), plus a second Resident Supervisor (single-project home), a second Kano SUBEB M&E officer if visits need it, and the platform operator. No first-tenant logins |
| Projects | About 30: about 18 Direct Intervention and 12 Matching Grants, spread over the zones; a few at each stage (draft, kick-off, mobilisation, construction, completion, liability period, closed, archived); budgets and contract sums in realistic ranges (N40m to N300m) |
| Scope | Facility units and BoQ lines from the needs-assessment workbook (import through `scopeImport.service`), 3 to 6 sprints per project |
| Visits | Weekly supervision by Resident Supervisors (7 to 10 sites each), quarterly M&E, mobilisation checks, final and post-closure evaluations; 6 to 12 months of history on long-running projects; late and missed visits at plausible rates (about 10%) |
| Findings | Raised by visit forms, a few open past escalation, most resolved on re-check |
| Payments | Interim payments every one to two months on projects under construction, retention at 5%, a few releases; exceptions rare |
| Documents | Contracts, kick-off minutes, letters of introduction, programme of works, CoCs, handover certificates, closeout reports, each through the document service |
| KPIs | Snapshots backfilled from the history (the job's backfill) |

Every story the demo script tells must still exist and be named in a story table at the top of the seed, as `seedPhase16` and `seedR4` do now.

**Generation approach.** One deterministic generator (fixed random seed, dates relative to the seed day) that drives the real services, as the phase seeds do today. Bulk history (visits, captures, payments) may be written directly where the services would be too slow, as `approvedFinalEvaluation` does, and must be marked so in comments. Keep the seed under about 3 minutes; the test template is built once per run, so seed time adds to every route-test run once.

---

## 3. Order of work (each slice green)

Each slice ends with typecheck, lint, the affected route files, then the full gate (unit, routes, mobile, web build, seed) in the background before the next slice that deletes anything. A slice is ticked only when that gate passes.

| Slice | Work | Gate |
| :--- | :--- | :--- |
| S1 | Test fixtures first: `helpers/secondTenant.ts` (isolation), a helper for a test-created untyped project, and the platform operator in the UBEC seed. Re-point phase2, phase11, r4 and r6c isolation checks to the fixture. First tenant still present | Full route suite unchanged in count |
| S2 | Re-point the tests that only use first-tenant logins for permission checks (r2, r3, r1b, r5f, phase8, process.phase7) to roster logins and UBEC projects | Affected files, then full suite |
| S3 | Re-point the heavier files one at a time: phase4, phase5, phase6, phase9, phase10, phase13, phase15 (move their own fixtures to the UBEC tenant) | Each file after its change; full suite at the end of the slice |
| S4 | Write the new generator alongside the old seed (behind a flag, for example `SEED_PROFILE=ubec-full`), producing the target data and every demo story | Seed runs; demo-story assertions (a new `seed.ubec.test.ts` that checks the story table) |
| S5 | Switch the test template and `npm run prisma:seed` to the new generator; fix tests that assert seed contents (project lists, counts, KPI values) | Full gate |
| S6 | Delete the first tenant's seed files (`seedDatabase` main-tenant part, `seedFieldAccounts`, `seedPhase6`, `seedPhase7`, `seedPhase10`, the first-tenant parts of `seedR2`), shrink the reset list, update `CLAUDE.md`, the demo script, the configuration reference and both testing checklists | Full gate, then a demo rehearsal on a fresh seed |

---

## 4. Risks

| Risk | Why | Mitigation |
| :--- | :--- | :--- |
| Test template database | `helpers/testDb.ts` builds `<name>_tmpl` once per run from the seed; a slower or larger seed slows every run, and a seed failure fails every route file | Keep S4 behind a flag until S5; measure seed time in S4; keep the generator deterministic |
| Seed reset list | `runSeed` deletes tables in dependency order; self-referencing tables (organisations, regions) and project types need pointers cleared first; payments before sprints (R6d) | Rewrite the list once in S6 and run the seed twice in a row as part of the gate |
| Route tests asserting seed contents | Several tests assert exact project lists, counts and KPI values (phase11 visibility lists, phase16 KPI targets and counts, portfolio totals, r6c stages) | Assert against the story table (codes named per story) rather than totals; update those assertions in S5 only |
| Lost coverage | Isolation, legacy and platform-admin behaviours exist only through the first tenant (section 1.3) | S1 adds the fixtures before anything is deleted |
| Hidden first-tenant use in code | Defaults such as demo self-registration default role `MONITOR` (`auth.service.ts`), and migrations that backfill permissions "to the default roles that hold them" by role code | Grep for role codes and slugs in S6; the UBEC tenant keeps the default codes (`TENANT_SUPER_ADMIN`, `ORGANIZATION_ADMIN`, `MONITOR`, `INDEPENDENT_RESIDENT`), so backfills still land, but a backfill that grants a permission to `MONITOR` would now reach the Independent M&E |
| Real notifications | The seed sends messages; a demo server with an email provider would mail seeded addresses | All seeded addresses on `.test` (as the UBEC roster already is); keep `JOBS_ENABLED` and the message adapter on console for seeding |
| Mobile and web docs | Checklists and the demo script name first-tenant logins and projects | Update in S6 with the docs pass |
