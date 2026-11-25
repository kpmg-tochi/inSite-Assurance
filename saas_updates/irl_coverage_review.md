# UBEC IRL coverage review

> **Update, 2026-11-25 (after the review):** built before the demo, per the owner: register fields (intervention year, funding source, UBEC project ID), LGA / contractor / year / funding filters, "last update" column, register export (Excel and PDF), **bulk project register import** (drafts and live projects already under way); Excel exports of visits, findings, payments and KPIs; **early-warning alerts** (delayed, stalled, site update overdue, spend ahead of progress) on the web and the phone; photo compression and compass heading. Deferred: sign-in policy (MFA, short-lived sessions, password reset) and SMTP email, plus the gaps in section 3 not listed here (`next_steps/irl_follow_ups.md`). Owner: the stack, hosting package and project code convention are out of scope for now. The tables below describe the state **before** these changes.

**Date:** 2026-11-25. **Source:** `Project Context/UBEC_IRL.xlsx` (sheets IRL, System requirements, Phone specification, What the portal provides; the hidden Server costing sheet read for context). **Platform reviewed:** branch `UBEC` after redesign R7 (uncommitted working tree). Evidence was gathered by reading the code; nothing was run on a device or a server.

## Summary

| Area | Present | Partly | Missing |
| :--- | :-: | :-: | :-: |
| What the portal provides (9 outputs) | 1 | 5 | 3 |
| IRL items that imply product features (9) | 2 | 7 | 0 |

**Three things in the IRL workbook are wrong about the platform and should be corrected before it goes to UBEC:**

1. **The stack.** The System requirements and Server costing sheets assume a **.NET 10 API on Windows Server / IIS with Microsoft SQL Server**. The platform is **Node.js 24 + Express with PostgreSQL** (Prisma 7), S3-compatible object storage, and a React/Vite web app. Nothing runs on IIS or SQL Server. Rows 1 (application servers), 3 (database), 7 (firewall ports), 10–11 and 14 (monitoring "IIS, SQL Server") and the whole costing sheet (Windows App Service, Azure SQL, RDS SQL Server) need rewriting for Linux (or Windows) hosts running Node, a managed or self-hosted PostgreSQL 13+, and S3-compatible storage.
2. **Photo size.** Fixed 2026-11-25: every in-app photo is now resized to a 1600 px long edge and saved as JPEG quality 0.7 (0.55 if still above 500 KB) before it is stored and hashed; expect about 200–400 KB per photo (estimate; to be measured on a phone, `physical_testing_checklist.md`). The sheet's "about 200 KB" is the low end: size storage at 0.3–0.4 MB per photo. (Before: full-resolution JPEGs at quality 0.82, several MB each.)
3. **Photo direction.** Fixed 2026-11-25: each geotagged photo, the visit check-in and the submission position record the compass heading (true north when the phone can compute it, else magnetic; null when the phone has no compass or no reading within a second). The portal shows it next to the photo's GPS details, e.g. "Facing NE (47°)". (Before: GPS position, accuracy, altitude and mock flag only.)

## 1. What the portal provides

| # | Output | Verdict | What exists | Gap | Size of fix |
| :- | :--- | :- | :--- | :--- | :- |
| 1 | True status register | Partly | Portfolio / dashboard register: project, contractor, type, state · LGA, stage, contract sum, progress %, schedule badge, open findings; filters by project type, region and owner; status buttons (Ongoing, Behind, Completed, Archived, Drafts) | No **condition** per project; no **date of last update** column (data exists as last capture, but counts unapproved captures); no **LGA** or **contractor** filter (free-text search only); status filtering is browser-side | M |
| 2 | Trusted site evidence, offline | **Present** | Agreed questionnaire from the form library; in-app camera only (no gallery); GPS, accuracy and device time stored with each photo; mock-location flag; offline SQLite (encrypted) with one outbox | GPS/time are metadata, not burned onto the image; GPS can fall back to the last known fix; device testing still owed | S (optional overlay) |
| 3 | QA verification | Partly | Each visit submission is approved or returned with notes, on a configurable approval chain; comments on visits; progress, findings and milestones change only on approval | No terminal **Reject** (only Return for rework); approval can be switched off per workflow template (on for UBEC); "last update" and the quiet-site count use unapproved captures | S |
| 4 | Executive dashboard | Partly | Portfolio map (OpenStreetMap), commitment, weighted progress, ongoing/behind counts; 20 programme KPIs incl. financial utilisation and verified on time, by region, type and owner | **Beneficiary reach** not captured (no pupils/enrolment field); total disbursed not shown on the admin portfolio; no **QA compliance** KPI; no state × status drill-down | M |
| 5 | Early-warning alerts | Partly | Behind-schedule alert; missed visits; overdue milestones (and automatic default cases for missed mobilisation); escalated findings; payment above contract sum | No **stalled** rule; no **overdue site update** alert (the "no visit for N weeks" check only warns in the planner); no **spend ahead of progress** rule; alerts are in-app only, never emailed | M |
| 6 | Money against progress, ERP-fed | **Missing** | Payments recorded by hand per project (interim, final, retention release), with retention and exceptions; schema already has `source = ERP` and a unique external reference | No **ERP/F&A integration** (no API or scheduled file import); no "spent" figure separate from paid; no paid vs % complete view per project or state | L (needs IRL 3) |
| 7 | Reports and export | **Missing** | KPI CSV; needs assessment .xlsx; CoC and handover certificate PDFs; closure pack ZIP (index PDF, visit summaries, payment CSV, audit ledger CSV) | No **report templates** (management, Board, Ministry/FEC), no scheduled or emailed reports, no PDF/Excel export of the register, visits, findings or payments | L (needs IRL 11) |
| 8 | Audit trail and role-based access | Partly | Hash-chained audit ledger per project and tenant; editable roles over a 56-permission catalogue; assignment / organisation-tree visibility; lockout after 5 failures; 10-character passwords on change | No **MFA**; no idle/session timeout (7-day token); no **password reset** flow; lockout and password rules not configurable; first password only 8 characters; successful sign-ins not logged | M |
| 9 | Secure platform on UBEC's hosting | **Missing** (as a package) | Health check; production refuses to start without S3, explicit CORS and an https web URL | No **Docker image**, install guide, backup/restore scripts or runbook; only a stale `render.yaml` (still lists Azure OpenAI variables); no `trust proxy` (behind a proxy every user shares one login rate limit); outside services still called: Whisper (voice notes), Expo push, Resend, OpenStreetMap tiles | L |

## 2. IRL information items: can the platform use what UBEC will send?

| IRL # | Item | Platform readiness | What's missing |
| :- | :--- | :--- | :--- |
| 1–2 | Hosting, infrastructure | Runs on any host with Node 24, PostgreSQL 13+ and S3-compatible storage | The System requirements sheet asks for the wrong stack (see summary); rewrite before sending |
| 3 | Procurement and F&A applications | Payments can be tagged as ERP-sourced | No integration built; the answer decides API vs file import |
| 4 | Current-state process maps | The MoE process design is already implemented (kick-off, mobilisation, visits, CoC, handover, closure) | – |
| 5 | Field reporting and QA rules | Configurable per project type: visit plan cadence, submission deadline, reminder days, finding escalation days, photo rules per question, reschedule tolerance | Alert thresholds for "days without update" and "% behind plan" have no setting (alerts above) |
| 6 | Project register | One project at a time from the needs assessment template | No **bulk import** of the existing active projects; no **intervention year** or **funding source** field (only the funder organisation) |
| 7 | Classification tree and ID convention | Regions (zone > state), organisations (5 levels), project types | No Programme / Year / LGA / School levels; project codes are typed and fixed to `AAA-999` (`shared/src/schemas/projectSetup.schema.ts:33`), which cannot hold a UBEC-style code |
| 8 | Project types and standard milestones with % weights | % complete is budget-weighted from BoQ lines, each taking its facility unit's verified progress | Milestones carry no weights; "Stage reached" answers (substructure, roofing…) don't map to a % |
| 9 | Status list | Fixed: draft/active/archived, construction phase, derived stage, schedule badge (on track / behind…), terminated contract | No Delayed / Stalled / Abandoned statuses and no configurable rules |
| 10 | Conditions (Good…Dilapidated) | Baseline visits rate each facility's existing condition 1–5 | Not aggregated or reported; no project-level condition; named categories need a form change |
| 11 | Report templates | – | Nothing to receive them into yet (section 1, #7) |
| 12 | Field questionnaire | **Ready**: versioned form library (11 field types, options, required, photo rules, finding rules) | No show/hide (skip) logic |
| 13 | Roles and responsibilities | **Ready** for roles, approvals and escalations as data | Approval steps have no time limit; escalation exists for findings only. The full role list is deferred until after the demo (`next_steps/role_catalogue_migration_plan.md`) |
| 14 | Email engine | Resend (HTTPS API) only; one global sender | No **SMTP** adapter (the IRL asks for port 587); no per-tenant sender |
| 15 | Field devices | Android app via Expo; camera, GPS, offline | Minimum Android is 7.0 (React Native default), far below the sheet's Android 15; photo compression and compass heading added 2026-11-25 (device check owed); push needs FCM credentials configured in EAS (not verified) |
| 16 | Branding | **Ready**: name, logo URL, colours, tagline, PDF header and footer per tenant | Logo is a URL, not an upload; the platform name is set at build time |

## 3. Recommended next steps

Ordered by impact on a UBEC go-live. Sizes: S ≈ a day, M ≈ a few days, L ≈ a week or more.

| # | Step | Size | Depends on |
| :- | :--- | :- | :--- |
| 1 | Correct the IRL workbook before sending: stack rows, costing sheet, photo size, compass, minimum Android | S | – |
| 2 | Hosting package: Dockerfile(s), compose file, install and upgrade guide, backup/restore of PostgreSQL and object storage, `trust proxy`, health and monitoring notes; list the outside services and how to replace them (self-hosted tiles, FCM, SMTP) | L | IRL 1–2 |
| 3 | Photo compression on the phone (resize to ~1600 px, about 200–300 KB) and the storage sizing updated. Compression and compass heading done 2026-11-25 (device check owed); storage sizing still to update in the workbook | S | – |
| 4 | SMTP mail adapter (port 587) and a password reset flow | S–M | IRL 14 |
| 5 | Register: LGA and contractor filters, last approved update column, intervention year and funding source fields, configurable project code format, bulk import of active projects | M | IRL 6–7 |
| 6 | Status and alerts: Stalled / Delayed rules with thresholds, "no approved update for N days" alert, spend-ahead-of-progress check, email digests of alerts | M | IRL 5, 9 |
| 7 | Reports: register, visits, findings and payments export to Excel/PDF; templates once UBEC sends them; scheduled email delivery | L | IRL 11 |
| 8 | ERP/F&A integration for payments (API or scheduled file) and a money-vs-progress view | L | IRL 3 |
| 9 | Sign-in policy: MFA for admins, idle timeout, configurable lockout and password rules | M | UBEC policy |
| 10 | Beneficiary reach (enrolment per school) and condition reporting; QA "Reject"; a QA compliance KPI | M | IRL 10 |
