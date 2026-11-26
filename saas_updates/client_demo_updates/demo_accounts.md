# Demo accounts: client demo (overlay, waves 1–4)

**Written:** 2026-11-25; names and codes checked against the overlay seed's output. **Updated:** 2026-11-26 for waves 2–3 (permissions and Demo 2 figures checked against `server/src/db/seedDemoOverlay.ts`) and wave 4 (approved list upload, payments Breakdown, visit calendar); pre-demo round (phone quick sign-in, story 12 in Delta, Demo 2 figures re-checked against the overlay). **For:** whoever presents or rehearses the client demo. The walkthrough is [demo_script.md](demo_script.md) (30 minutes). The accounts of the normal seed (no overlay) are in [../demo_accounts.md](../demo_accounts.md).

## Basics

| Item | Value |
| :--- | :--- |
| Password | `Password123!` for every account |
| Emails | Reserved `.test` TLD: no email can reach a real person |
| Tenant | UBEC (slug `programme-authority`) |
| Web | `http://localhost:5173` (API on `:4000`) |
| Field app | Same email and password; the Resident Supervisor signs in **only** on the phone (field-only role: the web answers 403 `WEB_ACCESS_NOT_ALLOWED`). Demo builds have a one-tap **Demo accounts** sign-in (see [Phone quick sign-in](#phone-quick-sign-in)) |
| Laptop | Keep it awake during the demo (no sleep, lid open). The API no longer hangs after sleep (job ticks now run one at a time), but if any screen hangs or spins, restart the API (`npm run dev` in `server/`) |

## Logins

Names are the seed's; the overlay prints this list at the end of the seed run.

| Role | Login | Person | Web / field | In the demo it shows |
| :--- | :--- | :--- | :--- | :--- |
| System Administrator | `admin@ubec.test` | Hauwa Bello | Web | Not in the walkthrough. Keeps every permission and covers the Legal and Audit steps off-screen; settings, users, project types |
| **Executive Secretary** | `es@ubec.test` | Aminu Yusuf | Web | Scene 1: portfolio map across six zones, register with LOT/BATCH codes and Intervention year, zone/State/LGA filters, alerts. Waves 2–3: site pins and register sub-rows, contractor register (sees flags, cannot decide them), Needs assessment page with the budget mismatch, default decision |
| **Director, Physical Planning** | `dpp@ubec.test` | Ifeoma Nwosu | Web | Scene 2: new project (State and LGA dropdowns, lot picker with preview, intervention year, funding source). Waves 2–3: new project from the needs assessment, sites, contractor picker and "New contractor", contractor register, kick-off, contractor flag decision (Additional visits, Payment hold), approved list row link. Wave 4: uploads the 2027 approved list |
| **Finance Officer** | `finance@ubec.test` | Babatunde Adewale | Web | Scene 3: project payments by quarter; portfolio Payments tab for the fiscal year with totals and export; payment exceptions. Wave 3: payment hold banner on Demo 2, a payment recorded during the hold flagged "Paid during hold". Wave 4: Payments Breakdown (zone → State → LGA → project), Group by quarter, export with the Breakdown sheet |
| **M&E Officer** (UBEC) | `me.officer@ubec.test` | Ngozi Eze | Both | Scene 4: publishes the visit on Demo 1, approves the monitoring report, findings |
| M&E Officer (SUBEB variant) | `lagos.me@ubec.test` | Bisi Adeyemi | Both | Not in the walkthrough. Assigned to the Matching Grants projects in Sokoto, Enugu and Rivers (the login keeps its old name) |
| **Resident Supervisor** | `resident.supervisor@ubec.test` | Musa Danladi | Field only | Scene 4 on the phone: LOT codes on project cards, check-in, form, camera hint, submit |
| Independent M&E (COREN-certified firm) | `independent.me@ubec.test` | Engr. Emeka Obi | Both | Not in the walkthrough. Independent visits on assigned projects |
| SUBEB Executive Chairman | `sokoto.admin@ubec.test`, `kano.admin@ubec.test`, `lagos.admin@ubec.test` | Abubakar Shehu, Aisha Musa, Chidi Okeke | Web | Not in the walkthrough. Each sees only its SUBEB's projects. `sokoto.admin@` decides the mobilisation default case on Background 8 (Sokoto, LOT 4 BATCH 2, 2026); `lagos.admin@` has no Matching Grants project after the overlay |

Bold = the demo cast. The 14-role catalogue (6 more roles) is a slide, not logins: [slides_outline.md](slides_outline.md) slide 3.

## Permissions added in waves 2–3

| Screen or action | Permission | Who has it in the demo | Who does not |
| :--- | :--- | :--- | :--- |
| Contractors page (register, detail, ratings, flags shown) | `contractors:view_register` | Executive Secretary, Director Physical Planning, System Administrator | Finance Officer, M&E officers, SUBEB Executive Chairmen |
| "New contractor", edit, status; **decide and lift flag actions** | `contractors:manage` | Director Physical Planning (and the System Administrator, off-screen). The `CONTRACTOR_FLAGGED` notification goes to these holders | Executive Secretary (sees the flag, cannot decide) |
| **Needs assessment** page (approved lists, budget mismatch) | `approved_lists:view` | Executive Secretary, Director Physical Planning, System Administrator, SUBEB Executive Chairman (names only its own projects; counts are programme-wide) | Finance Officer, M&E officers |
| Link a project to an approved list row | `projects:create` or `projects:edit_baseline` | Director Physical Planning, System Administrator | – |
| Payment hold banner; override reason when recording a payment during a hold | `payments:view` / `payments:record` (no new permission) | Finance Officer sees the banner and records with a reason; the payment is flagged "Paid during hold" | – |

## Permissions added in wave 4

| Screen or action | Permission | Who has it in the demo | Who does not |
| :--- | :--- | :--- | :--- |
| **Upload approved list** on the Needs assessment page (template, check, confirm) | `approved_lists:manage` (new) | System Administrator, Director Physical Planning | Executive Secretary and SUBEB Executive Chairmen (see the lists, not the button); Finance Officer and M&E officers (no Needs assessment page) |
| Portfolio → Payments → Breakdown, Group by month / quarter, export Breakdown sheet | `payments:view` (no new permission) | Finance Officer, Executive Secretary, Director Physical Planning, System Administrator, SUBEB Executive Chairmen (their SUBEB's projects only) | M&E officers |
| Monitoring → Calendar (project) and the planner's Calendar | `visits:view` (no new permission) | Everyone who sees the visit plan or the planner | – |

**Demo pack file (wave 4):** `saas_updates/demo_pack/15 Approved list upload.xlsx` (`npm run demo:pack` in `server/`): the 2027 Approved Projects & Implementation Schedule, 6 rows, ₦248,550,000, Project ID blank. Typing `2027-LOT-1-BATCH-1` in row 1's Project ID links draft #11.

**Uploading changes the demo database.** Confirming the upload creates the 2027 list (and links draft #11 if the Project ID was typed). Restore the snapshot (below) after every rehearsal, or the next run finds the 2027 list already there and the check step shows its rows as unchanged.

## Demo 2 in figures (waves 2–3, re-checked in the pre-demo round)

Demo 2 = `2026-LOT-4-BATCH-1` (Kano, Matching Grants, owner Kano SUBEB).

| Item | Value |
| :--- | :--- |
| Stage | Execution: kick-off held two weeks before its first monitoring visit, award a month before it |
| Sites | 6 schools in Dala, Gwale and Kano Municipal; the classroom blocks at sites 1 and 3 are Behind |
| Budget | ₦84.0m |
| Contract sum | ₦82.33m (from the BoQ lines); the register's "Contract sum" column shows it |
| Payments | Interim 1 ₦28.8m (35%, 40 days ago), interim 2 ₦24.7m (30%, 15 days ago), gross |
| Approved list | Kano approved BEAP row: estimate ₦71.5m → "Budget ₦84.0m vs approved BEAP ₦71.5m (+17%)", the budget-mismatch red flag (tolerance 10%) |
| Contractor | Sahel Build & Civil Works Ltd (also on #8, Sokoto): rating about 2.4 stars, **flagged** on Demo 2 by 5 accepted reports rating workmanship 3 or less within 60 days (rule: 3 reports ≤ 3 in 60 days). No action decided in the seed: the Director Physical Planning decides it live |

Every other 2025–2026 project is linked to its approved list row within ±5% of its budget (no red flag); the 2027 draft has no list. Contractor #17 (Olumo Works & Services Ltd, Ogun) is Inactive: no signed contract on file.

## User switcher

| Item | Detail |
| :--- | :--- |
| Where | User menu → **Switch user**: the demo cast, one line each; one click signs in as that person |
| Needs | A demo web build: `VITE_DEMO_MODE=true` in `web/.env`, then restart the web dev server. Without it the menu entry, the account list and the shared password are left out of the bundle |
| Production | Never build the web with `VITE_DEMO_MODE`. (The server separately refuses to start in production with `DEMO_MODE` on.) |
| Audit | Each switch is a normal password sign-in, treated exactly like one (it updates the user's last sign-in; web sign-ins have no ledger entry) |
| Resident Supervisor | Signs in on the phone, not through the web switcher (field-only role) |

## Phone quick sign-in

| Item | Detail |
| :--- | :--- |
| Where | Field app sign-in screen → **Demo accounts**: one tap signs in |
| Accounts | Musa Danladi (Resident Supervisor), Ngozi Eze (M&E Officer), Bisi Adeyemi (M&E Officer (SUBEB)), Engr. Emeka Obi (Independent M&E (COREN-certified firm)) |
| Needs | A demo build of the field app: `EXPO_PUBLIC_DEMO_MODE=true` in `mobile/.env`, then restart Metro. Without it the list, the emails and the shared password are left out of the bundle |
| Production | Never build the app with `EXPO_PUBLIC_DEMO_MODE=true` |
| Audit | Each tap is a normal password sign-in through the usual sign-in path |
| Fallback | No **Demo accounts** on the sign-in screen: type `resident.supervisor@ubec.test` / `Password123!` |

## Reseed the demo database

The demo data is the normal seed plus the overlay (`server/src/db/seedDemoOverlay.ts`): 18 UBEC projects across six zones (North 9 / South 9; story 12, the live South South project, is in Delta: Oshimili South, 4 sites, Asaba area), LOT/BATCH codes, the roles above (part 1); the client's 50 facility names, 51 sites, 10 contractors with ratings, Demo 1's monitoring reports (part 2); Demo 2's contractor flag and the 2025–2026 approved lists (part 3; wave 4 adds no data, only the `approved_lists:manage` grants). It deletes and recreates every record.

```bash
# Git Bash
cd server && SEED_PROFILE=ubec-demo npm run prisma:seed
```

```powershell
# PowerShell
cd server; $env:SEED_PROFILE = 'ubec-demo'; npm run prisma:seed; Remove-Item Env:SEED_PROFILE
```

Without `SEED_PROFILE=ubec-demo` you get the normal seed (`PRG-…` codes, the test data). Tests always use the normal seed.

## Snapshot and restore for rehearsals

Take a snapshot right after the reseed; restore it after every rehearsal instead of reseeding. Use the connection string from `DATABASE_URL` in `server/.env` **without** its `?schema=public` suffix (`pg_dump` refuses Prisma's `schema` parameter). Do not paste the string into shared notes: it holds the password.

| Placeholder | Meaning |
| :--- | :--- |
| `<URL>` | `postgresql://<user>:<password>@<host>:<port>/<db>` from `DATABASE_URL`, query string removed |
| `<SERVER_URL>` | The same with the database name replaced by `postgres` |
| `<db>` | The database name |

```bash
# Snapshot (PostgreSQL 18 client tools are in C:\Program Files\PostgreSQL\18\bin)
pg_dump --format=custom --no-owner --file=ubec_demo_snapshot.dump "<URL>"

# Restore: stop the API first (its jobs hold connections), then
psql "<SERVER_URL>" -c "DROP DATABASE <db> WITH (FORCE);" -c "CREATE DATABASE <db>;"
pg_restore --no-owner --dbname="<URL>" ubec_demo_snapshot.dump
```

Keep the `.dump` file outside the repository. Dates in the seed are relative to the day it ran: a snapshot older than a few days shows stale "today" visits and due dates, so reseed and re-snapshot on the day before the demo.
