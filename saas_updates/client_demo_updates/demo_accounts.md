# Demo accounts: client demo (wave 1 overlay)

**Written:** 2026-11-25; names and codes checked against the overlay seed's output. **For:** whoever presents or rehearses the client demo. The accounts of the normal seed (no overlay) are in [../demo_accounts.md](../demo_accounts.md).

## Basics

| Item | Value |
| :--- | :--- |
| Password | `Password123!` for every account |
| Emails | Reserved `.test` TLD: no email can reach a real person |
| Tenant | UBEC (slug `programme-authority`) |
| Web | `http://localhost:5173` (API on `:4000`) |
| Field app | Same email and password; the Resident Supervisor signs in **only** on the phone (field-only role: the web answers 403 `WEB_ACCESS_NOT_ALLOWED`) |

## Logins

Names are the seed's; the overlay prints this list at the end of the seed run.

| Role | Login | Person | Web / field | In the demo it shows |
| :--- | :--- | :--- | :--- | :--- |
| System Administrator | `admin@ubec.test` | Hauwa Bello | Web | Not in the walkthrough. Keeps every permission and covers the Legal and Audit steps off-screen; settings, users, project types |
| **Executive Secretary** | `es@ubec.test` | Aminu Yusuf | Web | Scene 1: portfolio map across six zones, register with LOT/BATCH codes and Intervention year, zone/State/LGA filters, alerts. Later waves: contractor register, default decision |
| **Director, Physical Planning** | `dpp@ubec.test` | Ifeoma Nwosu | Web | Scene 2: new project (State and LGA dropdowns, lot picker with preview, intervention year, funding source). Later waves: contractor, kick-off, contractor flag decision |
| **Finance Officer** | `finance@ubec.test` | Babatunde Adewale | Web | Scene 3: project payments by quarter; portfolio Payments tab for the fiscal year with totals and export; payment exceptions |
| **M&E Officer** (UBEC) | `me.officer@ubec.test` | Ngozi Eze | Both | Scene 4: publishes the visit on Demo 1, approves the monitoring report, findings |
| M&E Officer (SUBEB variant) | `lagos.me@ubec.test` | Bisi Adeyemi | Both | Not in the walkthrough. Assigned to the Matching Grants projects in Sokoto, Enugu and Rivers (the login keeps its old name) |
| **Resident Supervisor** | `resident.supervisor@ubec.test` | Musa Danladi | Field only | Scene 4 on the phone: LOT codes on project cards, check-in, form, camera hint, submit |
| Independent M&E (COREN-certified firm) | `independent.me@ubec.test` | Engr. Emeka Obi | Both | Not in the walkthrough. Independent visits on assigned projects |
| SUBEB Executive Chairman | `sokoto.admin@ubec.test`, `kano.admin@ubec.test`, `lagos.admin@ubec.test` | Abubakar Shehu, Aisha Musa, Chidi Okeke | Web | Not in the walkthrough. Each sees only its SUBEB's projects. `sokoto.admin@` decides the mobilisation default case on Background 8 (Sokoto, LOT 4 BATCH 2, 2026); `lagos.admin@` has no Matching Grants project after the overlay |

Bold = the demo cast. The 14-role catalogue (6 more roles) is a slide, not logins: [slides_outline.md](slides_outline.md) slide 3.

## User switcher

| Item | Detail |
| :--- | :--- |
| Where | User menu → **Switch user**: the demo cast, one line each; one click signs in as that person |
| Needs | A demo web build: `VITE_DEMO_MODE=true` in `web/.env`, then restart the web dev server. Without it the menu entry, the account list and the shared password are left out of the bundle |
| Production | Never build the web with `VITE_DEMO_MODE`. (The server separately refuses to start in production with `DEMO_MODE` on.) |
| Audit | Each switch is a normal password sign-in, treated exactly like one (it updates the user's last sign-in; web sign-ins have no ledger entry) |
| Resident Supervisor | Signs in on the phone, not through the web switcher (field-only role) |

## Reseed the demo database

The demo data is the normal seed plus the overlay (`server/src/db/seedDemoOverlay.ts`): 18 UBEC projects across six zones, LOT/BATCH codes, the roles above. It deletes and recreates every record.

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
