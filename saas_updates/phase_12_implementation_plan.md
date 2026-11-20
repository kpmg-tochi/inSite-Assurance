# Phase 12: Configurable Professional Credentials and Milestone Payments

| | |
| :--- | :--- |
| **Status** | Not started |
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
- [ ] CRUD under tenant settings (`tenant:manage_settings`); archive instead of delete when referenced.
- [ ] Seed the six bodies for every tenant (tenant provisioning creates them too).
- [ ] All selects that list licence types read the tenant list.

### Step 2: Credential policy and resolver
- [ ] Shared `CredentialPolicySchema`, `resolveCredentialPolicy(tenantPolicy, projectTypeSnapshot)`, and `credentialFieldRules(policy)` → `{ visible, required, label, helpText }` used by every form (web and mobile) so display and validation cannot drift.
- [ ] Server `assertCertifierCredentials(user, policy)` used by all three certification paths and by the viewer `canAct` reason; returns the snapshot fields (possibly null).
- [ ] `GET /projects/:id/credential-policy`; tenant settings DTO carries the tenant policy; the mobile baseline pack carries the project's resolved `fieldAssurance` policy.
- [ ] Tenant settings UI: two selects with explanatory copy; project type editor: "Credentials" tab with "use tenant setting" as the first option.

### Step 3: Apply the policy everywhere
- [ ] Server: IPC certification, direct milestone verification, retention certification, assurance submission (server rejects a missing number only when `REQUIRED`).
- [ ] PDF and audit `actorDisplayName`: print "Reg. No." only when present; with `HIDDEN`, print nothing about registration.
- [ ] Web: profile, user create/edit, certify modal, direct milestone panel, retention certify, workbench cannot-act banner, contractor verification queue (show the number only if present).
- [ ] Mobile: `AssuranceCredentialsStep` uses `credentialFieldRules`: hidden, optional (no blocking alert) or required; body picker from the pack.
- [ ] Grep check in section 7: no remaining unconditional licence requirement (`professionalLicense`, `corenLicense`, `hasLicence`).

### Step 4: Fixed-amount payment milestones
- [ ] Shared: basis and rule enums, Facility step schema fields, `DirectMilestoneSuggestionDto` gains `paymentBasis`, `completionRule`, `completionMet`, `unmetReasons[]`, `fixedReleaseAmountNgn`, `alreadyReleasedNgn`.
- [ ] Server direct verification: for fixed basis, compute completion from the verified lines; refuse `SUPPORT_FULL_RELEASE` when not met (422 `MILESTONE_COMPLETION_NOT_MET` with reasons); compute amounts server-side; CPs, chain, segregation and retention unchanged. `dryRun` returns the same computation.
- [ ] Facility step UI: per payment milestone basis, rule, fixed amount (defaults to allocated), required % per item for `ALL_ITEMS_COMPLETE`.
- [ ] Direct milestone panel: shows criteria and progress against them; release amount is read-only for fixed basis.
- [ ] Lender decision window and PDF show basis and criteria met.
- [ ] Config validation: fixed basis + IPC mechanism refused.

### Step 5: Seed and tests
- [ ] Seeded programme tenant: policy `OPTIONAL`/`OPTIONAL`; one certifier without a registration; Central project with three fixed payment milestones (e.g. 30% substructure, 40% superstructure, 30% finishes and WASH).
- [ ] Existing tenants: policy unset → `REQUIRED`, existing tests pass unchanged.
- [ ] Route tests: each certification path with each policy value; PDF/DTO fields null when absent; assurance with `HIDDEN` sends nothing and is accepted; fixed milestone refused when incomplete, released at the fixed amount when complete, holdback with reason, retention withheld; fixed + IPC refused.
- [ ] Mobile unit test for `credentialFieldRules`.

---

## 6. Definition of done

- On the programme tenant a certifier with no registration can certify and the PDF shows no registration line; on other tenants nothing changes.
- The mobile assurance step hides, offers or requires the registration number according to the project.
- A fixed payment milestone releases exactly its amount (net of retention) only when its completion rule is met.
- Master plan status updated; CLAUDE.md notes the credential resolver and payment basis.

## 7. Found during implementation

*(empty)*
