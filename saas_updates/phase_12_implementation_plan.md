# Phase 12: Configurable Professional Credentials and Milestone Payments

| | |
| :--- | :--- |
| **Status** | Implemented; migrated and route-tested; web click-through and on-device run pending (see section 7) |
| **Depends on** | Phase 11 (project types, terminology) |
| **Unblocks** | Phase 13 (milestone-linked payments), Phase 15 (final payment gate) |
| **Read first** | [Master plan](saas_implementation_plan.md) sections 2, 3 and 6; [Phase 11](phase_11_implementation_plan.md) section 3 |

---

## 1. Overview

**Objective:** two client answers turned into configuration.

1. **Professional registration is configurable everywhere** (answer Q7). Whether a certifier or a field reporter must hold a registration (QSRBN, COREN, …), may give one, or never sees the field is set per tenant and per project type. Forms, validation, "why can't I act" messages, PDFs and audit text all follow that setting. The list of registration bodies is tenant data, not a Nigerian enum.
2. **Milestone payments** (answer Q1). A payment milestone (a tranche, relabelled in Phase 11) can pay either **measured** value (today: verified % × item budget) or a **fixed amount once its completion criteria are verified**.

**In scope:** registration bodies table, credential policy and its resolver, every place that reads or asks for a licence, payment basis and completion rules on tranches, project type defaults for both.

**Out of scope:** advance payments and their recovery (section 3, open), co-funding splits, contractor-side milestone claims with fixed basis.

---

## 2. Context for the implementing agent

Licence today (all must follow the policy after this phase):

| Place | What it does |
| :--- | :--- |
| `shared/src/enums.ts` `ProfessionalLicenseTypeEnum` + `PROFESSIONAL_LICENSE_META` | Six fixed Nigerian bodies |
| Prisma `ProfessionalLicenseType` enum on `User.professionalLicenseType`, `ValuationReport.certifierLicenseType` (non-null), milestone verification snapshots | Storage |
| `reconciliation.service.ts` (~line 243 `hasLicence`, ~336 cannot-act reason, ~1111 certification check, ~1199 snapshot) | IPC certification requires a licence |
| `directMilestone.service.ts` (~158–294) | Direct verification requires a licence |
| `retention.service.ts` (~534–589) | Retention certification requires a licence |
| `pdf-report.service.ts` | Signature block prints the licence |
| `auth.schema.ts`: join `corenLicenseNumber` optional; `SubmitAssuranceVerificationRequestSchema.corenLicenseNumber` **required** (min 2) | Mobile identity assurance |
| `mobile/src/components/assurance/AssuranceCredentialsStep.tsx` | Always asks for a number, refuses empty |
| `rbac.schema.ts` user create/update, `RolesPermissionsTab.tsx`, `SettingsPage.tsx` (profile), `ContractorVerificationQueue.tsx`, `CertifyValuationModal.tsx`, `DirectMilestonePanel.tsx`, `RetentionDefectsPage.tsx`, `ReconciliationWorkbenchPage.tsx` | Web forms and displays |

Payments today: with tranches on, each `FacilityTranche` has `allocatedAmountNgn`, `targetCompletionPct` and CPs; BOQ items map to tranches. Direct milestone verification (`VerifyDirectMilestoneRequestSchema`) certifies per-item cumulative % and the server computes verified amount = % × item budget, bounded by the system claim. Retention and the disbursement chain apply after. With tranches off there is one implicit tranche.

---

## 3. Decisions

| Topic | Decision |
| :--- | :--- |
| Policy values | `REQUIRED` (must be on the profile; blocks the action), `OPTIONAL` (field shown, never blocks), `HIDDEN` (field not shown, not sent, not printed). |
| Policy subjects | `certifier` (IPC certification, direct milestone verification, retention certification, CoC signature in Phase 15 if it asks for it) and `fieldAssurance` (mobile identity assurance). User profile forms show the field unless **both** resolve to `HIDDEN` for the whole tenant. |
| Resolution order | Project type override → tenant setting → platform default `REQUIRED` (today's behaviour; existing tenants unchanged). |
| Registration bodies | Tenant table seeded with the six current bodies. Stored codes are strings validated against the tenant list; certifier snapshots also copy the body's display name and prefix so old PDFs stay correct after a body is renamed or archived. |
| Segregation | Turning registration off never weakens segregation of duties or permission checks. |
| Payment basis | Per tranche: `MEASURED` (default, today) or `FIXED_ON_COMPLETION`. Project type sets the default for new tranches. |
| Completion rule (fixed basis) | `ALL_ITEMS_COMPLETE` (every mapped item verified at ≥ its required %, default 100) or `WEIGHTED_PROGRESS_REACHED` (budget-weighted verified progress of mapped items ≥ `targetCompletionPct`). Phase 13 adds `CONTRACT_MILESTONE_DONE`. |
| Fixed release amount | Server-computed: `allocatedAmountNgn − already released on the tranche`. Recommendation `SUPPORT_FULL_RELEASE` releases it; `HOLD` releases nothing; `SUPPORT_WITH_HOLDBACK` allowed with an amount below it and a mandatory reason. Retention applies as today. |
| Mechanism compatibility | Fixed basis is supported with `MILESTONE_DIRECT_DISBURSEMENT`. With `IPC_CLAIM_REQUIRED` it is refused at configuration (409) in this phase; record in section 7 if the client needs it. |
| Seeded types | Both seeded project types: mechanism `MILESTONE_DIRECT_DISBURSEMENT`, tranches on (as payment milestones), basis `FIXED_ON_COMPLETION`, retention on (answer Q3), certifier registration `OPTIONAL`, field assurance registration `OPTIONAL`. |
| Advance payments | **Open, default: not built.** Many public works contracts pay a mobilisation advance recovered from later certificates. If confirmed, a later phase adds an "advance" tranche completed by a contract milestone and a recovery % on later releases. |

---

## 4. Schema changes

- New `ProfessionalRegistrationBody (id, tenantId, code, fullName, displayPrefix, exampleNumber?, isArchived, sortOrder)`, unique `(tenantId, code)`.
- Replace the Prisma enum `ProfessionalLicenseType` with `String?` codes: `User.professionalLicenseType` → `professionalRegistrationBodyCode`, `professionalLicenseNumber` → `professionalRegistrationNumber`. `ValuationReport.certifierLicenseType` / `certifierLicenseNumber` become nullable and gain `certifierRegistrationBodyName String?`, `certifierRegistrationPrefix String?`. Same on milestone verification and retention snapshots. (Decision A: rewrite the migration; no backfill.)
- `Tenant.credentialPolicyJson Json @default("{}")` → `{ certifier, fieldAssurance }`.
- `FacilityTranche`: `paymentBasis TranchePaymentBasis @default(MEASURED)`, `completionRule TrancheCompletionRule?`, `fixedReleaseAmountNgn Decimal?` (defaults to `allocatedAmountNgn` when null).
- `ProjectTypeConfigSchema.credentials = { certifier?: Policy, fieldAssurance?: Policy }`, `.payments = { defaultBasis, defaultCompletionRule, mechanism? }`.
- Shared: drop `ProfessionalLicenseTypeEnum` from request schemas in favour of `z.string()` + server validation; keep `PROFESSIONAL_LICENSE_META` only as seed data.
- Rename `corenLicenseNumber` → `registrationNumber` and add `registrationBodyCode` on mobile join and assurance schemas (both optional in the shared schema; the server enforces the policy). Mobile and server ship together, so no compatibility shim beyond accepting the old name for one release.
- Audit actions: `CREDENTIAL_POLICY_UPDATED`, `REGISTRATION_BODY_SAVED`.

---

## 5. Implementation checklist

### Step 1: Registration bodies
- [x] CRUD under tenant settings (`tenant:manage_settings`); archive instead of delete when referenced. *(route test passes)*
- [x] Seed the six bodies for every tenant (tenant provisioning creates them too). *(route test passes)*
- [ ] All selects that list licence types read the tenant list. *(web user forms and the mobile picker read the tenant list; typecheck/build only, click-through pending)*

### Step 2: Credential policy and resolver
- [x] Shared `CredentialPolicySchema`, `resolveCredentialPolicy(tenantPolicy, projectTypeSnapshot)`, and `credentialFieldRules(policy)` → `{ visible, required, label, helpText }` used by every form (web and mobile) so display and validation cannot drift. *(unit-tested: `server/src/tests/credentials.phase12.test.ts`, `mobile/src/utils/assuranceRegistration.test.ts`)*
- [x] Server `assertCertifierCredentials(user, policy)` used by all three certification paths and by the viewer `canAct` reason; returns the snapshot fields (possibly null). *(route test passes)*
- [x] `GET /projects/:id/credential-policy`; tenant settings DTO carries the tenant policy; the mobile baseline pack carries the project's resolved `fieldAssurance` policy. *(route test passes)* (tenant policy is served by `GET /credentials/settings`, see section 7)
- [ ] Tenant settings UI: two selects with explanatory copy; project type editor: "Credentials" tab with "use tenant setting" as the first option. *(built; web click-through pending)*

### Step 3: Apply the policy everywhere
- [x] Server: IPC certification, direct milestone verification, retention certification, assurance submission (server rejects a missing number only when `REQUIRED`). *(route test passes)*
- [x] PDF and audit `actorDisplayName`: print "Reg. No." only when present; with `HIDDEN`, print nothing about registration. *(route test passes)* (the test checks the audit name and that the PDF renders, not the PDF text)
- [ ] Web: profile, user create/edit, certify modal, direct milestone panel, retention certify, workbench cannot-act banner, contractor verification queue (show the number only if present). *(built; typecheck and vite build pass; click-through pending)*
- [ ] Mobile: `AssuranceCredentialsStep` uses `credentialFieldRules`: hidden, optional (no blocking alert) or required; body picker from the pack. *(rules unit-tested; on-device run pending)*
- [x] Grep check in section 7: no remaining unconditional licence requirement (`professionalLicense`, `corenLicense`, `hasLicence`).

### Step 4: Fixed-amount payment milestones
- [x] Shared: basis and rule enums, Facility step schema fields, `DirectMilestoneSuggestionDto` gains `paymentBasis`, `completionRule`, `completionMet`, `unmetReasons[]`, `fixedReleaseAmountNgn`, `alreadyReleasedNgn`. *(completion and amount maths unit-tested)*
- [x] Server direct verification: for fixed basis, compute completion from the verified lines; refuse `SUPPORT_FULL_RELEASE` when not met (422 `MILESTONE_COMPLETION_NOT_MET` with reasons); compute amounts server-side; CPs, chain, segregation and retention unchanged. `dryRun` returns the same computation. *(route test passes)*
- [ ] Facility step UI: per payment milestone basis, rule, fixed amount (defaults to allocated), required % per item for `ALL_ITEMS_COMPLETE`. *(built with one required % per milestone, see section 7; click-through pending)*
- [ ] Direct milestone panel: shows criteria and progress against them; release amount is read-only for fixed basis. *(built; click-through pending)*
- [ ] Lender decision window and PDF show basis and criteria met. *(built; click-through pending; PDF rendering route-tested only for status)*
- [x] Config validation: fixed basis + IPC mechanism refused. *(project type schema refusal unit-tested; facility, process and type routes: route test passes)*

### Step 5: Seed and tests
- [x] Seeded programme tenant: policy `OPTIONAL`/`OPTIONAL`; one certifier without a registration; Central project with three fixed payment milestones (e.g. 30% substructure, 40% superstructure, 30% finishes and WASH). *(`server/src/db/seedPhase12.ts` runs on the migrated dev DB)*
- [x] Existing tenants: policy unset → `REQUIRED`, existing tests pass unchanged. *(default unit-tested; all earlier route suites pass unchanged)*
- [x] Route tests: each certification path with each policy value; PDF/DTO fields null when absent; assurance with `HIDDEN` sends nothing and is accepted; fixed milestone refused when incomplete, released at the fixed amount when complete, holdback with reason, retention withheld; fixed + IPC refused. *(written: `server/src/tests/routes.phase12.test.ts`, in `test:routes`; passing)*
- [x] Mobile unit test for `credentialFieldRules`. *(`mobile/src/utils/assuranceRegistration.test.ts`)*

---

## 6. Definition of done

- On the programme tenant a certifier with no registration can certify and the PDF shows no registration line; on other tenants nothing changes.
- The mobile assurance step hides, offers or requires the registration number according to the project.
- A fixed payment milestone releases exactly its amount (net of retention) only when its completion rule is met.
- Master plan status updated; CLAUDE.md notes the credential resolver and payment basis.

## 7. Found during implementation

### Migration requirements (for the coordinator; no migration folder was created)

The schema was edited live and `prisma generate` run; the database was not migrated. Decision A applies (rewrite, no backfill), so dropping and adding columns is acceptable; renaming is not needed because no data is kept. What the migration must contain:

| Object | Change |
| :--- | :--- |
| enum `ProfessionalLicenseType` | **Drop** (after the columns below stop using it). |
| `User.professionalLicenseType` (enum) | **Drop** the column; **add** `professionalRegistrationBodyCode TEXT NULL`. |
| `User.professionalLicenseNumber` | **Drop**; **add** `professionalRegistrationNumber TEXT NULL`. (A `RENAME COLUMN` is equally fine for this one; there is no data to keep.) |
| `ValuationReport.certifierLicenseType` | Change type from the enum to `TEXT` and make it **nullable** (drop + add is fine). Same column name. |
| `ValuationReport.certifierLicenseNumber` | **Drop NOT NULL** (stays `TEXT`). Same column name. |
| `ValuationReport` | **Add** `certifierRegistrationBodyName TEXT NULL`, `certifierRegistrationPrefix TEXT NULL`. |
| `FieldAgentSession.corenLicenseNumber` | **Drop**; **add** `registrationNumber TEXT NULL`, `registrationBodyCode TEXT NULL`. |
| `Tenant` (`tenants`) | **Add** `credentialPolicyJson JSONB NOT NULL DEFAULT '{}'`. |
| new enums | `TranchePaymentBasis` (`MEASURED`, `FIXED_ON_COMPLETION`), `TrancheCompletionRule` (`ALL_ITEMS_COMPLETE`, `WEIGHTED_PROGRESS_REACHED`). |
| `FacilityTranche` | **Add** `paymentBasis "TranchePaymentBasis" NOT NULL DEFAULT 'MEASURED'`, `completionRule "TrancheCompletionRule" NULL`, `fixedReleaseAmountNgn DECIMAL(18,2) NULL`, `completionRequiredItemPct DECIMAL(5,2) NOT NULL DEFAULT 100`. |
| `MilestoneVerification` (`milestone_verifications`) | **Add** `paymentTermsJson JSONB NULL`. |
| new table `professional_registration_bodies` (model `ProfessionalRegistrationBody`) | `id UUID PK`, `tenantId UUID NOT NULL` FK → `tenants(id)` ON DELETE CASCADE, `code TEXT`, `fullName TEXT`, `displayPrefix TEXT`, `exampleNumber TEXT NULL`, `isArchived BOOLEAN DEFAULT false`, `sortOrder INT DEFAULT 0`, `createdAt`, `updatedAt`; **unique** `(tenantId, code)`, index `(tenantId)`. |
| enum `AuditActionType` | **Add** `CREDENTIAL_POLICY_UPDATED`, `REGISTRATION_BODY_SAVED`. |

No hand-written SQL is needed for Phase 12 (no partial indexes or CHECKs); the existing hand-written objects listed in CLAUDE.md must survive the regeneration as usual. `prisma migrate diff` will produce the enum → text change as drop + add of `certifierLicenseType`; that is acceptable under decision A. The seed reset list in `runSeed` now clears `professionalRegistrationBody` before `tenant`.

### Decisions and deviations

1. **Snapshot columns keep their names.** `ValuationReport.certifierLicenseType` / `certifierLicenseNumber` were kept (now nullable text) and the DTO fields keep those names; `certifierLicenseType` holds the body **code**. Milestone verification and retention certification write the same `ValuationReport` snapshot, so there are no separate snapshot columns to change.
2. **Field sessions store the body separately.** The plan only renamed the request field; the column `FieldAgentSession.corenLicenseNumber` was replaced by `registrationNumber` + `registrationBodyCode` (the app used to send "COREN R.123" as one display string). DTOs: `registrationNumber`, `registrationBodyCode` (+ `registrationBodyName` on the verification queue). The old request field `corenLicenseNumber` is still accepted on join and assurance for one release.
3. **Tenant policy endpoint.** The tenant policy and the body list are served by `GET /api/v1/credentials/settings` (and changed with `PUT /credentials/policy`, `POST|PUT|DELETE /credentials/registration-bodies`) instead of being added to `TenantSettingsDto`, so the existing workspace settings form is untouched. `WebUserProfile` carries `certifierRegistrationRequirement` (tenant level) for the profile page.
4. **One required % per payment milestone, not per item.** `ALL_ITEMS_COMPLETE` uses `FacilityTranche.completionRequiredItemPct` (default 100) for every mapped item. Per-item percentages would need the BOQ items in the Facility step, which comes before the BOQ step; add a per-item override on the BOQ step if the client needs it.
5. **Fixed basis amounts.** Server computes `due = (fixedReleaseAmountNgn ?? allocatedAmountNgn) − releasedAmountNgn`. On the valuation: `totalClaimedNgn = due`, `totalCertifiedNgn = due` when the rule is met (else 0). Any recommendation other than `HOLD` is refused while incomplete (`MILESTONE_COMPLETION_NOT_MET`, checked before `NOTHING_VERIFIED` so the verifier sees why). `SUPPORT_WITH_HOLDBACK` needs an amount strictly below `due` (`HOLDBACK_NOT_BELOW_FIXED_AMOUNT`) and a reason of 5+ characters (`HOLDBACK_REASON_REQUIRED`); the reason is appended to the valuation summary and stored in the computation and audit payload. A complete fixed milestone can be put forward again without new progress (e.g. after a hold). A fixed tranche counts as fully released (`isReleased`) at its fixed amount, not its allocation.
6. **Payment terms are snapshotted** on `MilestoneVerification.paymentTermsJson` and returned as `DirectMilestoneValuationDto.paymentTerms` (lender modal, PDF, valuation card), so later edits to the tranche do not rewrite what was verified.
7. **Fixed + IPC refusals.** Facility step save and process settings change (to IPC with fixed tranches) answer 409 `FIXED_BASIS_WITH_IPC`; IPC submission on a fixed tranche is also refused (409). A project type whose template uses IPC claims with `payments.defaultBasis = FIXED_ON_COMPLETION` answers **422** `TEMPLATE_CONFLICTS_WITH_PROJECT_TYPE` (the existing Phase 11 hook), and the type schema itself refuses `mechanism: IPC_CLAIM_REQUIRED` with the fixed basis (400). The facility step also reports an activation issue `FIXED_BASIS_WITH_IPC`.
8. **Payment basis lock.** A tranche's basis cannot change once money was released on it (409 `TRANCHE_BASIS_LOCKED`); the fixed amount cannot exceed the allocation (422) or drop below what was released (409).
9. **Seed writes type configs in place.** `seedPhase12` adds `credentials` and `payments` to both programme types without bumping their version (Phase 11 tests assert version 1) and copies the config into the projects' snapshots. New logins: `programme.monitor@insite.ng` (Monitor, no registration) and `programme.funder@insite.ng` (Lender role in the flagship, for the funder-scoped release step), both on PRG-102.
10. **"Verified Credential" placeholder removed.** The web formatter used to print "Verified Credential" when a user had no licence; it now prints nothing (profile shows "None on file"). The PDF heading "Licensed Independent Monitor Certification Sign-Off" became "Independent Monitor Certification Sign-Off", and the statement mentions professional standards only when a registration is printed.
11. **Not changed (out of scope):** the Azure OpenAI system prompt still calls the monitor "QSRBN-licensed" (AI prompts keep canonical wording); public marketing pages mention licensed monitors; the default role description of Independent Monitor still says "Licensed Quantity Surveyor or COREN Engineer".
12. **Possible issue, not verified:** retention allocation for a fixed milestone in a multi-prime project weights contractors by the verification lines' `verifiedAmountNgn`, which can be 0 when a complete milestone is put forward without new progress. `allocateRetention` falls back to the main contractor, so nothing is lost, but the split would not follow the items. Single-contractor projects (the seeded Central project) are unaffected.
13. **Workbench banner.** The IPC workbench shows the server's cannot-act reason (now policy-driven) in the certify button tooltip and in the certify modal; no separate banner was added.

### Grep check (Step 3)

`grep -rn "professionalLicense\|corenLicense\|hasLicence" shared/src server/src web/src mobile/src` finds only the deprecated `corenLicenseNumber` request alias (two schema fields, two server fallbacks reading it as `registrationNumber`) and tests that send it. No code requires a licence unconditionally; every check goes through `assertCertifierCredentials` / `certifierCannotActReason` / `fieldAssuranceRegistration` (`server/src/modules/credentials/credentialPolicy.service.ts`).

### Verification run (this session)

- `npm run typecheck`: shared and server pass. Web fails only in `Notifications.tsx` and `ReportingStep.tsx` (Phase 14 work in progress by another agent); mobile fails only in `NotificationCard.tsx` (same). No errors in Phase 12 files.
- `npm run lint`: 0 errors (75 pre-existing warnings).
- `npm --workspace=@insite/server run test:unit`: 213/213 pass (includes `credentials.phase12.test.ts`).
- `npm --workspace=@insite/mobile run test`: 70/70 pass (includes `assuranceRegistration.test.ts`).
- Web: `vite build` succeeds; `npm --workspace=@insite/web run build` stops at the Phase 14 typecheck errors above.
- Route tests (`routes.phase12.test.ts` and all earlier suites): not run, the database is not migrated.

**Integration (after both phases):** one combined migration `20261126090000_phase12_14_credentials_payments_streams_inspections` (licence columns dropped and re-added as text, decision A). Full server suite passes: unit 213/213, routes 275/275 (Phase 12 route test: fixed a wrong expected sort order). Mobile 76/76, lint 0 errors, web build OK. Still unverified: the possible retention split issue on a multi-contractor project when a completed fixed milestone is released again with no new progress (see above).
