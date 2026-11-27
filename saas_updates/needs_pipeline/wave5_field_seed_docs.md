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
| A1 | SQLite v12: `needs_verifications`, drafts; feed sync with the visit feed | `mobile/src/storage/db/migrations.test.ts` (v12), `utils/needsVerification.test.ts`; mobile 205/205 | BUILT (owed PT-N8-01 … -10) |
| A2 | Home: verifications in the calendar and day list; verification screen (sites, map, form) | typecheck, lint; no map component exists, sites are a list (5.4 A-8) | BUILT (owed PT-N8-*) |
| A3 | Outbox kind `NEEDS_VERIFICATION_SUBMISSION` (waits on its captures); offline end to end | `outboxPolicy.test.ts`, `outboxView.test.ts`, `needsVerification.test.ts` (dependsOn, error classes); server side `routes.needs.n8.test.ts` | BUILT (owed PT-N8-*) |
| A4 | Pure utils tested in Node; device checks added to `physical_testing_checklist.md` (`PT-N8-*`) | mobile 169 → 205 tests; `physical_testing_checklist.md` 4.13 PT-N8-01 … -10 | DONE |

### Track B (agent): docs

Owns: `CLAUDE.md` (a "Needs pipeline" architecture section; update "Client demo updates" where D1 is described), `saas_updates/configuration_reference.md` (`needsPipeline`, costing standards), the demo script (`client_demo_updates/demo_script.md`: new opening act from need to project), `web_testing_checklist.md` (collect every `WT-N*`), `demo_accounts.md` (new logins).

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| B1 | CLAUDE.md section | review by main (wave 5 paragraph, SQL list, seed, mobile, D1 note) | DONE |
| B2 | Configuration reference | `configuration_reference.md` 2.5, 2.6, 3.9 checked against `NeedsPipelineConfigSchema` | DONE |
| B3 | Demo script and accounts | `demo_script.md` act 0 "From need to project", `demo_accounts.md`; rehearsal owed (WT-N5-17, PT-N8-10) | BUILT (owed rehearsal) |
| B4 | Owed checklists complete | `web_testing_checklist.md` 6k WT-N5-01 … -18 and known open items; every WT-N* id cited in the wave files exists | DONE |

### Track C (agent): web (added by the owner, 5.1 decision 3)

Owns: `web/src/api/needsVerifications.ts`, `queries/needs/useVerificationQueries.ts`, `mutations/needs/useVerificationMutations.ts`, `components/needs/verification/*`, the Validation tab, BEAP review and Forms page edits, `web_testing_checklist.md` 6k.

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| C1 | Validation tab "Field verification" card: assign, cancel, list | web typecheck, lint (0 errors), build | BUILT (owed WT-N5-01 … -05) |
| C2 | Review drawer: sites (recorded vs stored location, will move), rows (counted vs recorded), photos, accept / return | web typecheck, lint, build | BUILT (owed WT-N5-06 … -10) |
| C3 | Validation record pre-filled from the accepted verification (FIELD_APP) | web typecheck, lint, build; server rule in `routes.needs.n8.test.ts` | BUILT (owed WT-N5-11) |
| C4 | BEAP review: site visit per item | web typecheck, lint, build | BUILT (owed WT-N5-12, -13) |
| C5 | Forms page: reserved sections noted, not archivable, not offered to visit templates (server rule after the review) | web build; `formLibrary` server tests | BUILT (owed WT-N5-14) |

### Main thread: seed and demo pack (N9)

Owns: `server/src/db/seedNeedsPipeline.ts` (runs after `seedAlerts.ts`), `seedDemoOverlay.ts` changes, `server/src/scripts/buildDemoPack.ts`.

| # | Item | Verified by | State |
| :--- | :--- | :--- | :--- |
| M1 | Normal seed: 2027 DI cycle with about 12 proposals across every stage and status (a duplicate, an essential gap, a rate variance, a returned one, one below the line, one excluded at approval), committee with scores and one divergence; Kano 2027 MG cycle with a BEAP in UBEC review; one out-of-cycle request waiting for the ES. **No new projects** (earlier route tests assert project lists) | seed normal ✓ (twice) on `insite_needs_w1`; `routes.demo.test.ts` opening act reads the seeded FUNDING proposals; needs route suites green with `clearSeededNeedsPipeline` | VERIFIED |
| M2 | Existing seeded projects get origin and a converted proposal in a closed 2026 cycle (history only) | seed normal ✓: 11 converted proposals in 7 closed cycles (each project's intervention year, 5.6 M-3); no new projects (earlier project-list tests green) | VERIFIED |
| M3 | Demo overlay: its projects get proposals in closed cycles; one 2027 proposal ready to be appropriated live in the demo | seed overlay ✓ (twice): 16 proposals in 8 closed cycles; #11 out-of-cycle 2027-DI-014; 2027-DI-001 appropriated live (5.6 M-5, M-6) | VERIFIED |
| M4 | Demo pack: template v2 files (single, batch of five with one invalid), appropriated schedule file | `npm run demo:pack` (reads every file back; batch 4 must fail with row errors); files 15 (2024), 16, 17, 18 Batch 1–5 | VERIFIED |
| M5 | `routes.demo.test.ts` updated for the new opening act | `routes.demo.test.ts` 10/10 in the final gate | VERIFIED |

## 2. Scenario steps turned green

FIELD-01 (`helpers/needsScenarioSteps.n8.ts` `stepFIELD01`). Both suites fully green: `routes.needs.scenarios.test.ts` has no `todo` left (the unused helper is removed).

## 3. End of wave (final)

Final full gate (normal and `ubec-demo` seed); `/code-review high` on mobile access by assignment and the seed; parent plan section 15 completed; status line at the top of the parent plan set to "done".

## 4. Verification

| Gate | Typecheck | Lint | Web build | Server unit | Server routes | Mobile | Seed (normal / demo) |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| Baseline (wave 4 record, end of wave; tree clean at `b4d4f17`) | ✓ | 0 errors (52 warnings) | ✓ | 329/329 | 653/653 pass, 1 todo | 169/169 | normal ✓, overlay ✓ |
| Gate 1, 2026-11-27 (all tracks in) | ✓ | 0 errors (52 warnings) | ✓ | 329/329 | 672/673 (n8 assign read the seed's ledger entry; fixed, file rerun 18/18) | 205/205 | normal ✓, overlay ✓ (scratch `insite_needs_w1`); schema diff empty |
| **Final, 2026-11-27 (after the review fixes, 5.7)** | ✓ | 0 errors (52 warnings) | ✓ | **329/329** | **679/679 pass, 0 todo** | **205/205** | normal ✓, overlay ✓ (scratch `insite_needs_w1`, migrations `20270101090000`, `…090001`) |

- Typecheck, lint, web build and mobile were rerun by the review-fix agent after its changes (all green); server unit, routes and both seeds rerun by the main thread after them. Nothing was edited while a gate ran, apart from a read-only check script under `server/src/scripts` created and deleted during gate 1. The demo database `insite_assurance` was not touched: the wave 2–5 migrations are owed there (`npx prisma migrate deploy` from `server/`, then a reseed with `SEED_PROFILE=ubec-demo`), on the owner's word.

## 5. Found during implementation

Wave 5 ran on 2026-11-27 on the owner's instruction. One clarification round (four questions, all answered with the recommended option; section 5.1). Main thread: contracts, migration, test reset helper, coordination, verification seed, gates. Agents: server (verification routes, FIELD-01), mobile (Track A), web (Track C, added by the owner), seed and demo pack (M1–M5); docs (Track B) after them. Server agents use their own test databases (`insite_w5srv_test`, `insite_w5seed_test`); migrations and seeds run on the scratch database `insite_needs_w1` only. The demo database `insite_assurance` is not touched (waves 2–5 migrations owed there).

### 5.1 Owner decisions (clarification round, 2026-11-27)

| # | Question | Decision |
| :--- | :--- | :--- |
| 1 | The plan's "form library template kind NEEDS_VERIFICATION" would add a value to `VisitKind` (Prisma and shared), which 13 web files list | **Reserved sections, no new VisitKind.** Two fixed sections in the form library, `NEEDS_VERIFICATION_SITE` and `NEEDS_VERIFICATION_FACILITY` (default content in `defaultFormLibrary.ts`, editable on the Forms page, not offered to visit templates). The form is frozen as JSON + SHA-256 on each verification at assignment, in the visit snapshot block shape, so `validateVisitAnswers` and the phone's form screens are reused |
| 2 | What acceptance does (a validation record is the validator's judgement) | **Pre-fill.** A reviewer accepts or returns. Acceptance corrects the site coordinates, files the photos as PHOTO documents of the proposal, and exposes a pre-filled site verification (method FIELD_APP, `verificationId`); the validator still writes the desk review and decides |
| 3 | The wave had no web track, but assignment and review are web actions | **Web track added** (Track C): assign, cancel and review on the proposal's Validation tab, the pre-filled record, assign in the BEAP review; owed checks `WT-N5-*` |
| 4 | kano.dpp@ (SUBEB Physical Planning) has a web-only role | **kano.dpp@ on the phone**: the seed gives it a separate mobile role (`User.mobileRoleId`, surface BOTH); no new person |

### 5.2 Main thread

| # | Topic | Decision |
| :--- | :--- | :--- |
| 1 | Migration `20270101090000_needs_w5_verification` | Additive: `NeedsVerification` (proposal, cycle, version at assignment, purpose VALIDATION / BEAP_REVIEW, status ASSIGNED / SUBMITTED / ACCEPTED / RETURNED / CANCELLED, officer, assigner, due date, site numbers, `formJson` + `formHash`, cancellation), `NeedsVerificationSubmission` (one per phone submission, idempotent on `clientSubmissionId`; answers, site locations, review, `siteCorrectionsJson`, `evidenceDocumentIds`), `NeedsVerificationCapture` (photo / voice note registered on the verification, idempotent on `clientCaptureId`; `FieldEvidenceLog` needs a project and a field session, which a proposal does not have); audit values `NEEDS_VERIFICATION_ASSIGNED`, `_CANCELLED`, `_SUBMITTED`, `_REVIEWED`, `NEEDS_SITE_COORDINATES_CORRECTED` (unused in the migration, so one migration). "Form snapshot id" in the wave text = the verification's own row (the `VisitFormSnapshot` table requires a project and a template) |
| 2 | Hand-written SQL (keep when regenerating) | Partial unique index `needs_verification_submissions_one_live_per_verification` (`("verificationId") WHERE "status" IN ('SUBMITTED','ACCEPTED')`) |
| 3 | Contracts | `shared/src/schemas/needsVerification.schema.ts` (enums, frozen form, requests, DTOs, constants) and `shared/src/utils/needsVerificationForm.ts` (`assembleNeedsVerificationForm`, `canonicalNeedsVerificationForm`, `validateNeedsVerificationAnswers` = visit answer rules + one location per site, `needsVerificationFacts`, `siteCoordinateCorrections`); `canonicalJsonString` exported from `utils/visitForm.ts`; `SiteVerificationSchema.verificationId` (required for FIELD_APP). Answer paths `n:site:<n>/<key>`, `n:row:<rowId>/<key>`; RAISE_FINDING rules are dropped from the verification form (no project yet) |
| 4 | Coordinate correction thresholds (assumption) | A site moves when the recorded location is more than 25 m from the stored one or none is stored; locations reported worse than 100 m accuracy, or mocked, are not used (`NEEDS_VERIFICATION_COORDINATE_TOLERANCE_METERS`, `NEEDS_VERIFICATION_MAX_ACCURACY_METERS`) |
| 5 | Seeded cycles vs the needs tests | The normal seed now holds 2027 cycles, which every needs route test also opens (cycles are unique per tenant, programme, year and scope). `server/src/tests/helpers/needsSeedReset.ts` `clearSeededNeedsPipeline(prisma)` is called in `before()` of `routes.needs.n1`–`n7`, `scenarios`, `needs.conversion.n7a` and `needs.closurePack.n7e`: they start from the wave 4 state (rules and costing standard kept) |
| 6 | Access by assignment | Field routes live at `/api/v1/needs-verifications` behind `requireAnyAuth` (like `GET /visits/mine`), not under `/projects`: `guardProjectRoutes` and field sessions are not involved; the officer check is a helper in `accessControl.ts` |
| 7 | Test expectations changed by the contracts | `routes.r3.test.ts` and `forms.r3.test.ts`: 12 default form sections (two reserved); scenario DI-04 counts `NEEDS_PROPOSAL_SUBMITTED` in its own cycle only (the seeded cycles write ledger entries; the tenant ledger is hash-chained, so the helper does not delete them); the unused `todo` helper removed from the scenarios file |

### 5.3 Server (verification routes, FIELD-01)

Routes: web `/api/v1/needs` `GET /proposals/:id/verifications`, `GET /proposals/:id/verification-officers?purpose=`, `POST /proposals/:id/verifications` (assign), `GET /cycles/:id/verifications`, `GET /verifications/:id`, `POST /verifications/:id/cancel`, `POST /verifications/:id/review`; field `/api/v1/needs-verifications` `GET /mine`, `GET /:id/form` (ETag quoted; `If-None-Match` quoted, unquoted, weak or a list → 304), `POST /:id/captures/presign`, `POST /:id/captures`, `POST /:id/submissions` (answers the submission DTO, which the phone's outbox reads). Module `server/src/modules/needs/verifications/` (`needsVerificationSupport.ts`, `needsVerifications.service.ts`, `needsVerificationField.service.ts`, `needsVerifications.routes.ts`, `siteCorrections.ts`). Additive migration `20270101090001_needs_w5_capture_signature` (`NeedsVerificationCapture.signatureVerified`).

| # | Decision |
| :--- | :--- |
| S-1 | Access by assignment: the caller must be the officer in the same tenant, else 404 NEEDS_VERIFICATION_NOT_FOUND (404 means only that); a mobile account without a mobile role 403 NO_MOBILE_ACCESS. Helper `assertVerificationOfficer` in `accessControl.ts` |
| S-2 | The officer may review their own submission (in Direct Intervention the M&E officer verifies and validates); only the VALIDATE separation applies (uploaders may not accept without a second person's authorisation) |
| S-3 | Accepting needs the proposal still open, the verification's version still the proposal's current one and, for a validation verification, the proposal IN_PROGRESS at Validation (else 409 NEEDS_VERIFICATION_STALE; changed by the review, R5); returning is allowed while a submission waits |
| S-4 | Coordinates are corrected on current sites matched by site number and normalised school name; from / distance read from the stored row at review time |
| S-5 | Corrections survive later versions: after a new version rewrites the sites, accepted corrections are re-applied only while the file still carries the old point (none, or within 25 m of the corrected-from point); a file with a genuinely new point wins. Conversion takes coordinates from the current site rows |
| S-6 | After a correction every flag of the proposal is re-run on the current version with the corrected sites |
| S-7 | Section versions frozen into a verification form count as used (`sectionUsage`): the next save makes a new version |
| S-8 | The reserved sections are provisioned lazily at v1 under the form library lock; archived → 422 NEEDS_VERIFICATION_FORM_MISSING |
| S-9 | A due date in the past (tenant zone) → 422 NEEDS_VERIFICATION_DUE_DATE_INVALID |
| S-10 | Assigning emails the officer `NEEDS_TASK_NOTICE` after commit; a failed send never fails the request |
| S-11 | Capture signatures are checked against `canonicalCaptureString` with the verification id as project id (media type SITE_PHOTO / VOICE_NOTE) and the device key; stored true / false / null (unsigned or no key); an invalid signature is recorded, not refused |
| S-12 | Photos of a returned submission may be named again; one object key = one capture |
| S-13 | Accepted photos are filed as PHOTO documents uploaded by the officer with the capture's object key; duty history reads versions only, so this does not make the officer an uploader |
| S-14 | The draft site verification: `verifiedOn` = the device submission time in the tenant zone, officer = submitter, notes = summary of what differs, evidence capped at 50 |
| S-15 | `openVerifications` in the officer list counts ASSIGNED and RETURNED |
| S-16 | Not covered end to end: the BEAP_REVIEW success path (refusals tested: organisation not above the owner, proposal not on a BEAP in review, permission). The per-proposal pre-filled template still takes sites from the version file |

### 5.4 Mobile (Track A)

SQLite v12: `needs_verifications` (feed DTO + local state), `needs_verification_forms` (by id and hash), `needs_verification_drafts` (id = clientSubmissionId; one open draft per verification), `captures.verification_id`. Store `storage/needsVerificationStore.ts`, sync `services/needsVerificationSync.ts`, handlers `storage/outbox/needsVerificationHandlers.ts`, pure rules `utils/needsVerification.ts` (28 tests), screens `screens/needsVerification/*`, shared form pieces `components/form/FormSections.tsx`.

| # | Decision |
| :--- | :--- |
| A-1 | Verification photos and voice notes reuse the CAPTURE kind (marked by `captures.verification_id`, handler branch to the verification endpoints); outbox rows and captures carry the scope `needs-verification:<id>` in the project id column |
| A-2 | Outbox kind `NEEDS_VERIFICATION_SUBMISSION` waits only on the captures its answers name; 409 CAPTURES_NOT_REGISTERED retried; FORM_STALE, NOT_OPEN, 422 INVALID and 404 permanent (draft REFUSED) |
| A-3 | Verifications are fetched at the end of every visit sync and never fail it; a verification dropped from the feed is deleted with its sent drafts, unsent ones kept as "No longer assigned" |
| A-4 | Forms downloaded only for open verifications, `If-None-Match` with the cached hash; stored only when SHA-256 of `canonicalNeedsVerificationForm` equals `formHash` |
| A-5 | Photos count when they have a real (not simulated) fix; no boundary check (no geofence before a project exists) |
| A-6 | Submit blocked on answer errors, a missing site location, photo gaps and photos no longer on the phone |
| A-7 | A returned verification's correction draft is rebuilt offline from `dto.submission` (answers, locations, notes kept; photos retaken, as for visits); a refused draft can be copied onto the current form or deleted |
| A-8 | No map component exists in the app: sites are a list with "Record location here" (existing `acquireFix`), distance from the stored point against the 25 m tolerance, warnings above 100 m accuracy or for simulated locations |
| A-9 | The visit screens were not made to branch: shared render pieces plus a draft editor hook for both draft types; verification screens are their own routes |
| A-10 | A `/needs-verifications` refusal does not end the last project's field session (`apiConfig.ts`); sign-out keeps verifications with unsent work |
| A-11 | kano.dpp@ added to the demo quick sign-in |

### 5.5 Web (Track C)

Files `web/src/api/needsVerifications.ts`, `queries/needs/useVerificationQueries.ts`, `mutations/needs/useVerificationMutations.ts`, `components/needs/verification/*`; edited `ProposalValidationTab.tsx`, `BeapReviewPanel.tsx`, `BeapWorkspace.tsx`, `FormSectionsCard.tsx`, `VisitFormTemplatesCard.tsx`.

| # | Decision |
| :--- | :--- |
| C-1 | All sites ticked sends `siteNumbers: []` (every site of the current version) |
| C-2 | Due date defaults to today + 7 days (tenant zone); past dates refused in the form |
| C-3 | Assign disabled while a VALIDATION verification is open (the server's 409 stays the rule) |
| C-4 | The "will move" preview uses the frozen sites; after acceptance the drawer shows the applied `siteCorrections` and stays open; after a return it closes |
| C-5 | Photos grouped by answer path (site, row, other); the drawer refetches on open so signed links are fresh |
| C-6 | SAME_PERSON_VALIDATION on review shows a review-specific message; no "ask for an override" button (whether review is an overridable stage action is not settled: follow-up) |
| C-7 | "Use the field verification" takes the newest accepted VALIDATION verification; FIELD_APP is offered only when one exists |
| C-8 | The reserved sections cannot be archived from the web (editing stays allowed) and are not offered to visit templates |
| C-9 | Dialogs inside the BEAP review form stop their submit events (React portals bubble through the tree) |

### 5.6 Seed and demo pack (M1–M5)

Files: `server/src/db/seedNeedsPipeline.ts` (story table in its header), `server/src/db/needsSeedSpecs.ts` (pure specs), `server/src/modules/needs/workbook/fillNeedsWorkbook.ts` (the filler moved out of the tests; the fixtures re-export it, content unchanged), `server/src/scripts/demoNeeds.ts`, `seedDemoOverlay.ts`, `seedUbecRoster.ts`, `buildDemoPack.ts`, `saas_updates/demo_pack/README.md`. Normal seed: 2027 DI cycle with 2027-DI-001 … -012 (001–003 at Funding after an approved portfolio; 004 excluded at approval; 005 below the line; 006 essential gap open; 007 possible duplicate of 006; 008 returned; 009 Design; 010 Costing, rate variance open; 011 draft; 012 not validated; one committee divergence on 003), out-of-cycle 2027-DI-013 waiting for es@, Kano 2027 MG cycle (MG-KN-001/-002 on a BEAP in UBEC review, -003 at Validation), two ASSIGNED field verifications; every PRG project converted from a proposal in a closed cycle (11 proposals, 7 cycles). Needs seed 13–16 s.

| # | Decision |
| :--- | :--- |
| M-1 | Open-cycle year = run-day year + 1 (`needsOpenYear`), shared by the seed, the pack and the demo test, so references are deterministic per day |
| M-2 | Open cycles go through the real services (flags, decisions, reports, ledger); the closed history is written directly (no ledger, flags or decisions; the version file built from the project's own sites, units and BoQ; approved = funded = budget) |
| M-3 | History cycles follow each project's intervention year (DI 2024–2026 national, MG 2023–2026 Lagos and Kano), not "2026 for most" |
| M-4 | Closed MG cycles carry an approved BEAP with counterpart evidence, so MG drafts pass the activation gate |
| M-5 | The overlay rewrites the history from its own projects (16 proposals, 8 cycles); story #11 (2027 DI draft) becomes the approved out-of-cycle 2027-DI-014 (CARRY_OVER_APPROPRIATED, origin OUT_OF_CYCLE: a draft of the open year cannot come from the annual cycle before appropriation); #13 REGISTER_IMPORT |
| M-6 | The proposal appropriated live is 2027-DI-001 (Dawakin Tofa WASH, the demo project's sites, units and lines), with -002 and -003 |
| M-7 | Demo pack file 15 is the 2024 approved list (manual uploads are for past years, D-N.12; the funding gate owns the open year's list); 16 Appropriated schedule 2027 (-003 funded at 90 % to show PARTLY_FUNDED); 17 single needs assessment (Gombe, two schools); 18 Batch 1–5 (batch 4 with 3 row errors; the script fails unless it has errors and the others read cleanly); facilities written "Name (CODE)" so the files parse on the overlay's renamed catalogue |
| M-8 | The seed deletes the `NEEDS_TASK_NOTICE` emails it queued (daily recipient caps on the demo day and in tests) |
| M-9 | kano.dpp@ `mobileRoleId` = SUBEB_ME_OFFICER (surface BOTH): signs in on the phone, sees no projects there (main role has no project permissions); verifications come by assignment |
| M-10 | 2027-DI-001's cost ceiling flags acknowledged by qs@ (the demo BoQ is above the per-unit ceilings); its water gap at school 1 justified at validation |
| M-11 | `clearSeededNeedsPipeline` also sets the seeded projects back to LEGACY, unlocks the costing standard and returns `ledgerFloor`; `routes.needs.n3` / `n4` count ledger entries above it (10 assertions) |
| M-12 | `routes.demo.approvedLists` "refuses the link…" uses me.officer@ instead of kano.admin@ (broken by `b4d4f17`, which gave the SUBEB Administrator `projects:edit_baseline`, not by the seed) |
| M-13 | `routes.demo.test.ts` opening act: procurement@ uploads files 17–18 (5 created, batch 4 refused), finance@ confirms file 16 (3 drafts, origin NEEDS_PIPELINE; Dawakin with 3 sites, units T1/BH1/SP1, 8 BoQ lines), procurement@ assigns a lot; the walk then runs on the converted draft (basics keep the lot code and funded budget; the project boundary drawn on school 1, which conversion leaves empty; a primary beneficiary added) |
| M-14 | Main thread: two ASSIGNED verifications through `assignVerification` (me.officer@ on 2027-DI-006 due in 3 days; kano.dpp@ on 2027-MG-KN-003 due in 5 days); `needs.n1.test.ts` counts 29 pipeline audit actions |
| M-15 | Known: the demo PDFs still print "PRG-110" in their text |

### 5.7 Review (`/code-review high` on the wave diff, 2026-11-27; focus: mobile access by assignment, the seed)

Nine findings (five important, four nits), all fixed before the end-of-wave gate. New error codes: `FORM_SECTION_RESERVED` (409 archive, 422 in a visit template), `FORM_SECTION_RESERVED_KEYS` (422), `NEEDS_VERIFICATION_STALE_VERSION` (422), `NEEDS_VERIFICATION_STALE` (409).

| # | Finding (severity) | Fix | Verified by |
| :--- | :--- | :--- | :--- |
| R1 | The reserved sections were protected only in the web: the API could archive them, put them in a visit template, or drop their fixed keys, so verifications could not be assigned or acceptance read nothing (important) | `formLibrary.service.ts`: archive 409, visit template 422, `assertReservedSectionFields` (fixed keys keep their default types; the condition question keeps exactly the option keys of `NEEDS_VERIFICATION_CONDITION_BY_OPTION`, labels may change) | `routes.needs.n8.test.ts` "N8 review fixes" (reserved sections) |
| R2 | A FIELD_APP record could cite an accepted verification of an earlier version (sites added since never visited) (important) | `recordValidation` 422 `NEEDS_VERIFICATION_STALE_VERSION`; `siteVerificationDraft` null when the verification's version is not current | n8 "review fixes" (draft null after a new version; record refused) |
| R3 | A new version's flags used the file's coordinates while the site rows kept the accepted corrections (important) | `writeVersionInTx` computes flags on `overlayCurrentSiteCoordinates` after `replaceCurrentTables` | n8 "review fixes" (corrected site raises DUPLICATE and keeps it on a new version; fails with the fix reverted) |
| R4 | A site answered "school not found" was moved to where the officer stood (important) | Shared `sitesNotFound(form, answers)` and `siteCoordinateCorrections(…, { skipSiteNumbers })`; server acceptance and the web preview use both | n8 "review fixes" (site 300 m away answered NO is not moved) |
| R5 | A late acceptance rewrote sites and re-ran flags on a proposal past Validation or on a newer version (important) | ACCEPT 409 `NEEDS_VERIFICATION_STALE` unless the version is current and, for VALIDATION, the proposal is IN_PROGRESS at Validation; RETURN still allowed (S-3) | n8 "review fixes" (returned proposal and new version refused; return 200) |
| R6 | A SUBMITTED verification left the phone feed after 30 days while still waiting (nit) | SUBMITTED in the open branch of `/mine` | n8 "review fixes" (40-day-old SUBMITTED kept, ACCEPTED dropped) |
| R7 | Two registrations of one upload under different capture ids could both succeed (nit) | Object-key check and insert under the verification row lock | n8 "review fixes" (one 201, one 409) |
| R8 | The pre-filled record kept 50 evidence documents silently (nit) | Notes end with "N more photos are filed on the proposal's Documents tab." | n8 "review fixes" (53 photos) |
| R9 | `needsVerificationSectionUsage` expanded every tenant's verification forms (nit) | Tenant filter before the JSON expansion; `sectionUsage(prisma, tenantId, ids)` | n8 assign test (another tenant counts no use) |

## 6. Exit criteria

**State on 2026-11-27: met.** M1–M5 VERIFIED; A1–A3 BUILT with owed PT-N8-01 … -10 (A4 done); C1–C5 BUILT with owed WT-N5-01 … -14; B1, B2, B4 done, B3 BUILT with the rehearsal owed (WT-N5-17, PT-N8-10). FIELD-01 passes; `routes.needs.scenarios.test.ts` has no `todo`. Review findings fixed (5.7). Final gate recorded (section 4). Still owed: the web click-through (6g–6k), the device run (4.13), the demo rehearsal, the migrations on `insite_assurance`; follow-ups: an override path for a review refused by separation (C-6), the BEAP_REVIEW success path end to end (S-16), the demo PDFs printing "PRG-110", `procurement@` in the web Switch user cast.

Every row VERIFIED or BUILT with owed `WT-*` / `PT-*` checks; `routes.needs.scenarios.test.ts` has no `todo`; final gate recorded.
