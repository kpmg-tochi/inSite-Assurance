# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

InSite Assurance: a multi-tenant field-evidence and drawdown-reconciliation platform for construction finance. An npm-workspaces monorepo, Node 24 (`.nvmrc`), npm 11:

| Workspace | Stack | Role |
| :--- | :--- | :--- |
| `shared` (`@insite/shared`) | TypeScript, Zod, Turf | Enums, every request/DTO schema, permission catalog, default roles, IPC state machine, geofence maths, shared data (standards library). Single source of truth for contracts. |
| `server` (`@insite/server`) | Express, Prisma 7 (`pg` adapter), PostgreSQL | REST API under `/api/v1`, AI (Azure OpenAI, Whisper), S3-compatible storage (local-disk mode in dev/tests), PDF. CommonJS. |
| `web` (`@insite/web`) | React, Vite, React Query, Tailwind 3 | Portal for monitors, lenders, contractors, tenant admins. |
| `mobile` (`@insite/mobile`) | Expo / React Native, SQLite | Offline-first field app with one outbox. |

The SaaS migration is run phase by phase from `saas_updates/`. **Before working on a phase, read `saas_updates/saas_implementation_plan.md` sections 2, 3 and 6 (decisions and conventions), then the phase file.** Record findings in the phase file's "Found during implementation" section rather than widening scope. Product background: `Project Context/project_context_current.md`.

## Commands (run from the repo root unless noted)

```bash
npm run build:shared                      # required before anything that imports @insite/shared changes are visible
npm run typecheck                         # builds shared, then typechecks server, web, mobile
npm run lint                              # eslint over all four src trees (0 errors expected; warnings exist)
npm --workspace=@insite/web run build
npm --workspace=@insite/server run test   # unit + route tests
npm --workspace=@insite/mobile run test   # mobile unit tests (tsx --test; list is explicit in mobile/package.json)
```

Server tests (from `server/`):
- `npm run test:unit` / `npm run test:routes`; new test files must be added to these explicit lists in `server/package.json`.
- Single file: `npx tsx --test --test-concurrency=1 src/tests/process.phase7.test.ts`. Single test: add `--test-name-pattern "<name>"`.
- Route tests need PostgreSQL. `src/tests/helpers/testDb.ts` uses `TEST_DATABASE_URL` or `DATABASE_URL` + `_test`. Once per test run it builds a migrated and seeded template `<name>_tmpl` (keyed on the test runner's PID), and `resetTestDatabase()` gives each file a fresh clone of it, already seeded: test files must not call `seedDatabase()` themselves. Full route suite ~1 min; one file ~20 s. It also blanks AI, Whisper, S3 and push env vars, so tests never call providers; stub them via the hooks below.

Prisma (from `server/`; config in `prisma.config.ts`, reads root `.env`):
- `npx prisma generate` after schema changes.
- Migrations: `prisma migrate dev` refuses to run non-interactively. Generate SQL with `npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script -o prisma/migrations/<timestamp>_<name>/migration.sql`, review/hand-edit it, then `npx prisma migrate deploy`. Never `db push`.
- Hand-written SQL that the schema cannot express and that regenerated migrations must keep: partial unique indexes `ProjectJoinCode_active_project_role_contractor_key` and `workday_reports_one_report_per_period` (Phase 8: keyed on `reportingPeriodStart`); CHECK `FieldAgentSession_origin_source_check`; CHECKs `ValuationReport_source_ipc_check` and `ValuationReport_source_verification_check`.
- Seed: `npm run prisma:seed` (`server/src/db/seedDatabase.ts` + `seedPhase6.ts` + `seedPhase7.ts`). The dev DB is disposable (decision A); keep the seed working. Seeded report rows need period fields (`seedPeriodFields`). Seeded logins use `Password123!` (admin@, monitor@, lender@, lto@, contractor@, verifier@ `insite.ng`). Earlier route tests assert seed contents (e.g. project lists), so adding seeded projects can require updating them.

## Architecture

**Contracts first.** Every request body and DTO is a Zod schema in `shared/src/schemas`, exported from `shared/src/index.ts`. Web and mobile import types from `@insite/shared`; never hand-write duplicates. New permissions go in `SYSTEM_PERMISSIONS_CATALOG` (`shared/src/enums.ts`) and the default roles (`shared/src/defaultRoles.ts`). New audit actions go in both the shared enum and the Prisma `AuditActionType` enum. `SEGREGATED_DISBURSEMENT_PERMISSIONS` (certify, approve, verify direct milestone) must be held through a role: the platform super admin bypass in `hasWebPermission` never applies to them.

**Server request path.** `server/src/app.ts` mounts routers; most are mounted at `/api/v1/projects`. A project router is wrapped with `guardProjectRoutes` (`server/src/utils/accessControl.ts`), which authenticates any principal (web user, join-code field session, provisioned mobile account), checks tenant/assignment or session binding, and applies lifecycle rules: a DRAFT project serves only the routes in `DRAFT_ROUTE_RE`; an ARCHIVED project is read-only. Route files stay thin (permission guard, `validateBody(schema)`, call a service). Never read a resource by an ID from the body without confirming it belongs to the URL project (`server/src/utils/ownership.ts` loaders). State changes go in one `prisma.$transaction` together with `recordAuditEvent` (hash-chained ledger). Responses are built by explicit serializers, never by spreading Prisma rows. Principals: `req.webUser`, `req.fieldAgent` (`fieldPersonaType`, `origin`, `userId`), `req.mobileUser`.

**Process engine (Phase 7).** Per-project `ProjectProcessConfig` (read via `getProcessConfig`, memoised per request through `server/src/utils/requestContext.ts`; a project with no row behaves as `DEFAULT_PROJECT_PROCESS_CONFIG`). Services branch on it: disbursement mechanism (IPC claims vs direct milestone release), report approval, hold points, tranches/CPs, contractor field reporting, identity assurance, AI checks. Approval chains are versioned `ApprovalStep` rows: edits write a new version, items in flight keep theirs. Engine: `server/src/modules/process/approvalChain.ts`; disbursement chain (certification first, release last, review steps between): `server/src/modules/reconciliation/disbursementChain.ts`.

**Cadence and scheduled jobs (Phase 8).** All period maths is pure and shared: `shared/src/utils/reportingPeriod.ts` (`getReportingPeriodForDate`, `listWorkdaysInPeriod`, `nextPeriodStart`; INSPECTION_ONLY has no periods). Server mapping and obligations: `server/src/modules/cadence/cadence.service.ts` (`cadenceSettingsForDate` honours a pending cadence change, `periodKeyForDate`, `fulfilObligation`). Reports and briefs carry `reportingPeriodStart/End` and `dueAt`; one original report per reporter, item and `reportingPeriodStart` (hand-written partial unique index `workday_reports_one_report_per_period`, keep it). Jobs live in `server/src/jobs/` (`brief-dispatch`, `overdue-reports`, `mobilization-reminders`, `attendance-check`, `message-dispatch`), registered by `registerAllJobs()`; each tick holds `pg_try_advisory_xact_lock` and each unit claims a `JobRun` row via `runUnit(jobName, scopeKey, fn)`. Jobs only touch ACTIVE projects of non-suspended tenants. Tests run a tick with `runJobOnce(name, now)`. `JOBS_ENABLED=false` turns them off in a process. Outbound messages: `server/src/integrations/messaging` (`sendMessage`, adapters console/resend/push, SMS empty; tests read `consoleOutbox` or use `setMessageAdapterOverrides`). Expected participants and attendance: `server/src/modules/mobilization/`; call `syncParticipantForSession` wherever a session is created or its assurance changes. Mobile computes the period from the baseline pack's `cadence` via `mobile/src/utils/projectCadence.ts`; "reported" means a report with `workday_date` inside the period window.

**Evidence → reconciliation → disbursement.** Mobile captures register as `FieldEvidenceLog` and link to a human-confirmed `WorkdayReport`. `server/src/modules/evidence/evidenceProvider.ts` is the single source of evidence for reconciliation (counted report statuses, latest revision, captures of the whole revision chain). IPC lifecycle is defined only in `shared/src/ipcStateMachine.ts` (`assertIpcTransition` inside the transaction after row locks); its Phase 3 unit test enumerates every action, so changing the machine changes that spec. Amounts are always computed server-side; client totals are never trusted. `ValuationReport` is either an IPC certification or a direct milestone verification (`source`).

**AI.** `server/src/integrations/azure-openai.service.ts`. Every AI result records which engine produced it, and there is a deterministic rules fallback; never fabricate content when a provider is unavailable outside demo mode. Human-written text goes to models in a delimited "data only" block. Post-response checks (omission + standards) run off the request path (`server/src/modules/workday-reports/aiOmissionCheck.ts`). Test hooks: `setAiOmissionCheckScheduler`, `setReconciliationModelRater`, `azureOpenAiService.setBriefModelOverride` / `setStandardsModelOverride`.

**Web.** `web/src/api/<area>` fetchers, `web/src/queries/<area>` and `web/src/mutations/<area>` React Query hooks; mutation hooks own sonner toasts (pages do not toast again). Gate UI with `hasPermission` from `web/src/lib/auth-context.tsx`; never infer roles from permission combinations or role codes. Reuse `components/common` and `components/table/StandardTable`. Project setup is a step registry (`PROJECT_SETUP_STEPS` in shared, `web/src/pages/projects/setup/stepRegistry.ts`); the same step pages serve `/setup/:step` (draft) and `/settings/:step` (live). New `navigate()` calls must use `useGuardedNavigate` to get the unsaved-changes guard. Demo defaults belong behind the demo flag only.

**Mobile.** All persistence goes through `mobile/src/storage/*` (SQLite migrations in `storage/db/migrations.ts`); one outbox (`storage/outbox`), no ad-hoc queues; client IDs are UUIDs; never send display strings, `file://` paths or base64 as record fields; never show a verification state the app did not compute. Persona-dependent wording lives in `mobile/src/utils/personaCopy.ts`.

## Environment gotchas (Windows)

- Shell is Git Bash plus PowerShell; there is no Python. Many source files use CRLF line endings, so scripted find-and-replace must normalise `\r\n` or it silently matches nothing; prefer the Edit tool.
- Do not put template literals (backticks) or `${...}` inside inline `node -e "..."` or heredoc commands in bash: they get expanded or break parsing. Write the script or content to a scratch file first.
- The server compiles to CommonJS: ESM-only packages (e.g. `unpdf`) must be loaded with a real dynamic import (see `server/src/integrations/textExtractor.ts`).

## Verification bar

Tick a phase checklist item only when its behaviour is verified (test or click-through), not when code is written. Web and mobile UI has so far been verified only by typecheck, build, lint and unit tests; browser click-through and device runs are still outstanding for Phases 5–7.
