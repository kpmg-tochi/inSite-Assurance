# Demo and test accounts

**Checked against the seed source on 2026-11-25** (`server/src/db/seed*.ts`, `seedUbecRoster.ts`, `seedFieldAccounts.ts`). Where `CLAUDE.md` or `web/src/config/demoAccounts.ts` say something different, the code wins; see "Discrepancies found" at the end.

**Who this is for:** whoever runs or rehearses the UBEC demo, and anyone testing the seeded app.

## Basics

| Item | Value |
| :--- | :--- |
| What these are | Seeded development and demo credentials. They are not real accounts. UBEC logins use the reserved `.test` TLD, so a demo server with an email provider can never reach a real address. The legacy test tenant uses `@insite.ng`. |
| Password | `Password123!` for **every** seeded account. No exceptions: `lagos.me@` copies the Lagos admin's hash and `resident.supervisor@` copies the UBEC admin's hash. Both hashes are the seed's single `Password123!` hash. |
| Reset | `npm run prisma:seed` (from the repo root or `server/`). It deletes and recreates every account, project and record. The dev database is disposable. |
| Web | `http://localhost:5173` (Vite dev server; `/api` is proxied to the API on `:4000`). Sign in with email and password; no workspace slug is needed. With `VITE_DEMO_MODE=true` (set in `web/.env`), the login page shows a quick-pick of the four logins in `web/src/config/demoAccounts.ts`. |
| Field app | Expo app (`mobile/`). Sign in with the same email and password. The first sign-in registers the device. Dev builds find the API on the LAN; release builds need `EXPO_PUBLIC_API_BASE_URL` set to an `https://` URL. The phone lists only **ACTIVE** projects the account can see, so archived PRG-242 never appears there. |
| Web sign-in rule (R7) | A user whose main role has surface `MOBILE` is refused on the web: 403 `WEB_ACCESS_NOT_ALLOWED`, "This account is for the field app. Sign in on the mobile app instead." Roles with surface `BOTH` use the same credentials on the web and in the field app. Platform super admins are never refused. |
| Handover rule (R7) | The person who recorded a handover response cannot review it: 409 `SAME_PERSON_REVIEW`. In the demo, one person records and a different person reviews (see PRG-104 below). |

---

## UBEC demo tenant

**Tenant:** slug `programme-authority`, display name "Universal Basic Education Commission (UBEC)". The tenant has 6 roles (tailored by `tailorUbecRoles`); its default `LENDER` and `MONITOR_INSPECTOR` roles are deleted.

| Login (email) | Password | Person (seed) | Role (name · code) | Organisation | Surface | Project visibility | Use it in the demo for |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `admin@ubec.test` | `Password123!` | Hauwa Bello | UBEC Administrator · `TENANT_SUPER_ADMIN` | Universal Basic Education Commission (UBEC) | Web only (role surface `WEB`; no field-app access) | Every project in the tenant (holds all 56 permissions, incl. `projects:view_all_tenant`; also sees drafts) | Settings, users, forms and facilities, project types. Portfolio and KPIs. Records payments (PRG-105). Director Legal review of the PRG-221 default case. Audit sign-off (PRG-241). Records the beneficiary's paper copy on a CoC and can review the PRG-104 handover. **Acts for** the Director Legal, the Executive Secretary, Procurement, Finance & Accounts, the Audit Department and ICT Support, none of whom has a login. |
| `kano.admin@ubec.test` | `Password123!` | Aisha Musa | SUBEB Administrator · `ORGANIZATION_ADMIN` | Kano State Universal Basic Education Board (SUBEB) | Web only | Kano SUBEB's organisation subtree: **PRG-211 only** (Kano Direct Intervention projects are owned by UBEC HQ, so they are hidden). No drafts (no `projects:create`). | Visibility contrast: a SUBEB sees only its own projects. Gets the PRG-211 finding escalation. **Acts for** the Kano SUBEB Executive Chairman. |
| `lagos.admin@ubec.test` | `Password123!` | Chidi Okeke | SUBEB Administrator · `ORGANIZATION_ADMIN` | Lagos State Universal Basic Education Board (SUBEB) | Web only | Lagos SUBEB subtree: PRG-221, PRG-241, PRG-242 (archived). Not PRG-104, which UBEC HQ owns. Not the draft PRG-201. | Decides the PRG-221 default case at the "SUBEB Executive Chairman decision" step. Signs Matching Grants CoCs (Head of Physical Planning slot). **Acts for** the Lagos SUBEB Executive Chairman. |
| `me.officer@ubec.test` | `Password123!` | Ngozi Eze | UBEC M&E Officer · `UBEC_ME_OFFICER` | Universal Basic Education Commission (UBEC) | Both (web and field app) | Assigned only: PRG-102, PRG-103, PRG-104, PRG-105, PRG-211, PRG-221 | Visit planner and review, findings, sprint verification (PRG-105). Over the Matching Grants supervisor site limit (supervision workload). Second UBEC CoC signature (Head of M&E slot on PRG-104). Records or reviews the PRG-104 handover. On the phone: a routine visit on PRG-105 in 2 working days. |
| `lagos.me@ubec.test` | `Password123!` | Bisi Adeyemi | SUBEB M&E Officer · `SUBEB_ME_OFFICER` | Lagos State Universal Basic Education Board (SUBEB) | Both | Assigned only: PRG-221, PRG-241, PRG-242 (the phone shows PRG-221 and PRG-241) | Matching Grants visits and evaluations. PRG-241 post-closure evaluation. Second Lagos SUBEB CoC signatory (Head of M&E slot). On the phone: a mobilisation check on PRG-221 in 2 working days. |
| `independent.me@ubec.test` | `Password123!` | Engr. Emeka Obi | Independent M&E (COREN-certified firm) · `MONITOR` | Independent M&E Consultants (COREN-certified) | Both | Assigned only: PRG-102, PRG-105, PRG-211 | Independent monitoring: on the phone, an ad hoc visit on one PRG-105 facility in 4 working days. On the web: read-only views (visits, scope, documents, KPIs) and document upload. Cannot review visits, manage findings or close defects. |
| `resident.supervisor@ubec.test` | `Password123!` | Musa Danladi | Resident Supervisor · `INDEPENDENT_RESIDENT` | Universal Basic Education Commission (UBEC) | **Field app only.** Web sign-in refused (403 `WEB_ACCESS_NOT_ALLOWED`) | Assigned: PRG-102, PRG-104, PRG-105, PRG-211, PRG-242 (the phone shows the four ACTIVE ones, not archived PRG-242). Default visit officer on PRG-102 and PRG-105. | The field-app story: calendar, PRG-105 routine visit tomorrow, a pending date proposal and a decline on PRG-105, the PRG-102 mobilisation check, PRG-211 visit history, site log, defects. |

### Who acts for the functions with no login

| Function (UBEC manual) | Acted by | How the platform knows |
| :--- | :--- | :--- |
| Director Legal (default case review) | `admin@ubec.test` | The project types' `defaultCases.legalRoleCode` = `TENANT_SUPER_ADMIN`; the chain step is labelled "Director Legal review" |
| Executive Secretary (Direct Intervention default decision) | `admin@ubec.test` | Decision step scoped to the owning organisation (UBEC HQ); the admin holds `contracts:decide_default` |
| SUBEB Executive Chairman (Matching Grants default decision) | `kano.admin@` / `lagos.admin@` for their SUBEB | Decision step scoped to the owning SUBEB |
| Finance & Accounts (record payments) | `admin@ubec.test` | Only holder of `payments:record` in this tenant |
| Audit Department (closure audit sign-off) | `admin@ubec.test` | Only holder of `closure:audit_signoff` |
| Procurement | `admin@ubec.test` | No dedicated permission or step exists yet (`closure:sign_file` was not built) |
| ICT Support (users, roles) | `admin@ubec.test` | Holds every permission |

### Demo projects these logins see

Sources: the story tables in `seedPhase16.ts` and `seedR4.ts`, plus `seedPhase13.ts` and `seedPhase15.ts`. DI = Direct Intervention (type code `CENTRAL`, owned and funded by UBEC HQ); MG = Matching Grants (`CO_FUNDED`, owned by a SUBEB).

| Code | Type | Region · owner | Stage and what is seeded | Seen by (web; the admin sees all) |
| :--- | :--- | :--- | :--- | :--- |
| PRG-101 | DI | Kano · UBEC HQ | Draft, kick-off planned | admin only (drafts need `projects:create`) |
| PRG-201 | MG | Lagos · Lagos SUBEB | Draft | admin only |
| PRG-102 | DI | Kano · UBEC HQ | Mobilising on time: kick-off held 16 days ago, minutes signed, mobilisation due in 5 days. Mobilisation checks every 2 weeks (proposed), the first published | me.officer, independent.me, resident (phone) |
| PRG-221 | MG | Lagos · Lagos SUBEB | Mobilisation overdue; default case waiting at the "SUBEB Executive Chairman decision" step; a quarterly M&E visit missed; lagos.me's mobilisation check in 2 working days | lagos.admin, me.officer, lagos.me |
| PRG-211 | MG | Kano · Kano SUBEB | Construction: baseline accepted, a routine visit uploaded late, a major finding (no PPE at height) open 20 days and escalated | kano.admin, me.officer, independent.me, resident (phone) |
| PRG-105 | DI | Kano · UBEC HQ | Construction, works about 80% done, one interim payment recorded (5% retention held). Sprint 1 verified PARTLY_MET (badge BEHIND), sprint 2 late. Next three visits published, routine visit tomorrow, a pending date proposal and a decline by the Resident Supervisor | me.officer, independent.me, resident (phone) |
| PRG-104 | DI | Lagos · UBEC HQ | Handover in progress. CoC drafted and signed once (Head of Physical Planning, by admin); the Head of M&E slot and the beneficiary's paper copy remain. Handover response not yet recorded | me.officer, resident (phone) |
| PRG-103 | DI | Kano · UBEC HQ | Liability period: CoC issued, handover accepted, handover certificate issued, defects raised from snags | me.officer |
| PRG-106 | DI | Kano · UBEC HQ | Closure twin (`seedClosureTwin.ts`), "Gwale Central Primary School": interim and final payments, CoC issued, handover accepted, liability period ended about four weeks ago, retention released, rated, as-built ticked. Left for the demo: **Close the project**, upload the closeout report, archive, export the closure pack | admin (and every tenant-wide viewer) |
| PRG-110 | DI | Kano · UBEC HQ | **Not seeded**: created live in the demo from `saas_updates/demo_pack/` (see [demo_script_programme_delivery.md](demo_script_programme_delivery.md)). Reseed after the demo to remove it | – |
| PRG-241 | MG | Lagos · Lagos SUBEB | Closed, contractor rated, two lessons published. Closeout report, post-closure evaluation and audit sign-off pending, so it cannot be archived | lagos.admin, lagos.me |
| PRG-242 | MG | Lagos · Lagos SUBEB | Closed, evaluated, closeout report filed, audited, archived, closure pack built | lagos.admin, lagos.me (web only; archived projects are not on the phone) |

**PRG-104 with the handover rule:** `me.officer@` signs the Head of M&E slot. `admin@` records the beneficiary's paper copy (only the admin and SUBEB admins hold `completion:draft_certificate`). For the handover, one of `me.officer@` and `admin@` records the response and the other reviews it. Reviewing the response with the same account returns 409 `SAME_PERSON_REVIEW`.

---

## Platform operator and legacy test tenant (not for the demo)

**Tenant:** slug `kpmg-nigeria`, display name "KPMG Nigeria Infrastructure & Capital Advisory". These accounts are lender-era test fixtures. Most route tests depend on them. Do not use them in the UBEC demo. The seed replacement plan (`saas_updates/next_steps/seed_replacement_plan.md`) removes this tenant and these logins.

| Login | Password | Person | Role (name · code) | Organisation | Surface | Purpose |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `admin@insite.ng` | `Password123!` | Adaeze Nwosu, FCA | Tenant Super Admin · `TENANT_SUPER_ADMIN`, **platform super admin** | KPMG Infrastructure & Project Monitoring Advisory | Web | Platform operator: tenant provisioning across tenants. Also the legacy tenant's admin. The only seeded platform super admin; the UBEC seed has no separate operator yet (seed replacement plan 1.3 item 4) |
| `monitor@insite.ng` | `Password123!` | QS Tunde Adebayo, FNIQS | Independent Monitor · `MONITOR`; mobile role Monitor Inspector · `MONITOR_INSPECTOR` | KPMG Infrastructure & Project Monitoring Advisory | Web, plus field app through its separate mobile role | Main route-test user. Sees every legacy project (`projects:view_all_tenant`); assigned to LKK-402, ABJ-108, KAN-210, OGN-305, ENU-501 |
| `lender@insite.ng` | `Password123!` | Chidinma Okafor, CFA | Funder / Finance Officer · `LENDER` | InfraCredit Guarantee & Project Finance Desk | Web | Funder: records payments, closure audit sign-off. Assigned to EDO-410, OGN-501, KWR-502 |
| `lto@insite.ng` | `Password123!` | Engr. Ifeoma Eze, FNSE | Lender Technical Officer · `LENDER_TECHNICAL_OFFICER` (custom: `LENDER` permissions plus `incidents:view`) | InfraCredit Guarantee & Project Finance Desk | Web | Custom-role fixture |
| `verifier@insite.ng` | `Password123!` | Engr. Osaro Igbinedion, MNSE | Independent Monitor · `MONITOR` | KPMG Infrastructure & Project Monitoring Advisory | Web | Second monitor. Assigned to EDO-410, OGN-501, KWR-502 (Phase 7 and Phase 10 fixtures) |
| `resident.cow@insite.ng` | `Password123!` | Engr. Segun Oladipo (Resident CoW) | Independent Resident Clerk of Works · `INDEPENDENT_RESIDENT` | KPMG Infrastructure & Project Monitoring Advisory | Field app only (web refused under the R7 rule) | Field account on LKK-402 (device `ANDROID-COW-88412`) |
| `field.officer@insite.ng` | `Password123!` | Chukwudi Nnamdi (M&E Officer) | Monitor Inspector · `MONITOR_INSPECTOR` | KPMG Infrastructure & Project Monitoring Advisory | Field app only (web refused) | Field account on LKK-402 (device `ANDROID-MEO-33109`) |
| `resident.abj@insite.ng` | `Password123!` | Engr. Hauwa Bello (Resident CoW) | Independent Resident Clerk of Works · `INDEPENDENT_RESIDENT` | KPMG Infrastructure & Project Monitoring Advisory | Field app only (web refused) | Field account on ABJ-108 only: the single-project mobile home |

Legacy projects: LKK-402, ABJ-108, KAN-210, OGN-305, ENU-501 (draft), EDO-410, OGN-501 (handover), KWR-502 (liability period).

Not seeded: `inactive.inspector@insite.ng` exists only inside `routes.phase5.test.ts`, which creates it. `monitoring@insite.ng` is an organisation contact email, not a login.

---

## Login-page quick-pick (`web/src/config/demoAccounts.ts`)

It lists 4 UBEC web logins in demo order: `admin@ubec.test` (pre-filled), `kano.admin@`, `lagos.admin@`, `me.officer@`. It has no lender-era accounts. The names, organisations and role codes match the seed. It does not list `lagos.me@` or `independent.me@`, which can also sign in on the web (surface `BOTH`), or `resident.supervisor@`, which is correctly left out because it is refused on the web.

---

## Discrepancies found

| # | Where | Says | Code says |
| :--- | :--- | :--- | :--- |
| 1 | `CLAUDE.md` seed paragraph (`seedPhase14`) | Assigns `me.officer@` "to every live site" | Only PRG-102 (seedPhase12), PRG-103, PRG-211 and PRG-221 (seedPhase14), plus PRG-104 and PRG-105 (seedPhase16). Live PRG-241 and PRG-242 are not assigned. The roster sentence later in `CLAUDE.md` gives the correct list |
| 2 | `CLAUDE.md` seed paragraph (`seedR4`) | `resident.supervisor@` is the default visit officer on PRG-102 and PRG-105 (no other projects named) | Also assigned to PRG-104 and PRG-242 (seedPhase16 `liveProject`) and PRG-211 (seedR4 `fieldAgentFor`) |
| 3 | What `admin@ubec.test` acts for | `CLAUDE.md`: Director Legal, Executive Secretary, Finance, Audit. `demoAccounts.ts`: Legal, the ES, Audit. seedPhase16 console: Legal, ES, Finance, Audit | Role description: Director Legal, Executive Secretary, Procurement, Finance & Accounts, Audit Department. `seedUbecRoster.ts` header also adds ICT Support. The admin is the only `payments:record` holder, so Finance belongs on every list |
| 4 | `seedDatabase.ts` final console summary | Lists four UBEC logins and omits `verifier@insite.ng` | seedPhase16 prints all seven UBEC logins. `verifier@` is seeded (seedPhase7) |
| 5 | `demoAccounts.ts`, Kano admin credential | "Sees Kano SUBEB's projects only" | True, but that is one project (PRG-211). Every Kano Direct Intervention project is owned by UBEC HQ |
| 6 | `next_steps/resident_supervisor_web_login.md` | "Status: not started"; `loginWebUser` "never looks at the role's surface" | Implemented: `server/src/modules/auth/webAccess.ts` (`assertWebSignInAllowed`, 403 `WEB_ACCESS_NOT_ALLOWED`). The status line is stale |
| 7 | `CLAUDE.md` "No contractor login" paragraph | Does not state that mobile-only roles have no web sign-in | Rule enforced at token issue and on every web request |
| 8 | `redesign_r7_implementation_plan.md` 7.2, D-R7.14 | Logins `programme.admin@`, `flagship.admin@`, `north.admin@`, `south.admin@`, `programme.monitor@`, `programme.funder@` on `@insite.ng` | None of these exist. The UBEC roster on `@ubec.test` replaced them |
| 9 | `redesign_r7_implementation_plan.md` 5.4 | A seeded custom `LEGAL_OFFICER` role exists | No seed creates it. `CLAUDE.md` is correct that the UBEC tenant has no `LEGAL_OFFICER` |
| 10 | `shared/src/schemas/auth.schema.ts` `WebRegisterRequestSchema.roleCode` | Defaults to `"MONITOR"` | In the UBEC tenant, `MONITOR` is the Independent M&E (COREN firm), so demo self-registration into UBEC would create Independent M&E users |
