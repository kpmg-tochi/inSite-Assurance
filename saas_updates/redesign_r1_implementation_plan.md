# Redesign R1: Delete What the Client Does Not Use

**Spec:** [client_flow_redesign.md](client_flow_redesign.md) sections 3.3, 9, 12 and 14 (R1).
**Branch:** `UBEC` (client-specific; decision P).
**Baseline before R1 (2026-11-23):** typecheck clean, lint 0 errors, server tests 246 unit + 318 route, all passing.

Each slice must leave typecheck, lint (0 errors) and the server suite green before the next one starts.

---

## Slices

| Slice | Contents | Status |
| :--- | :--- | :--- |
| R1a | Remove AI: Azure OpenAI service and callers, env vars, needs-assessment AI summaries, text extraction, AI wording in web and mobile. Whisper stays. | Done |
| R1b (+R1c) | Delete the lender product: IPC claims, reconciliation, evidence ratings, valuations, facility tranches, conditions precedent, disbursement chain, milestone payments, segregated permissions. Retention moved onto a new payment record (manual entry, ERP-ready fields). R1c was folded in because retention was built on the disbursement chain. | Done (see below) |
| R1c | Defects staff-only (contractor side removed) | Done in R1d |
| R1d (+R1c) | Delete professional registrations; contractor access (join codes, field sessions for contractors, identity assurance, public handover link); multi-contractor modes | Done (see below) |
| R1e | Delete briefs, telemetry, attendance roster and alerts, executive risk matrix | Done (see below) |

---

## R1a: Remove AI (done 2026-11-23)

| Item | Change |
| :--- | :--- |
| `server/src/integrations/azure-openai.service.ts` | Deleted. Every caller now uses the deterministic rules it already had as a fallback. |
| Workday report checks | `aiOmissionCheck.ts` runs the omission rules (`workday-reports/reportRules.ts: evaluateOmissionsByRules`) and the standards rules only. |
| Summary suggestion (`POST .../workday-reports/suggest`) | Transcribes voice notes (Whisper), then restates transcripts and notes (`extractFieldNoteByRules`). Engine is always `RULES` (or `SIMULATED_DEMO` for demo transcripts). |
| Morning briefs | `buildBrief` (was `fallbackBrief`); model prompts deleted. `generatedByAi` is always false. |
| BOQ | Hygiene / hold-point / tranche hints from `analyzeBoqByRules` in `boq.service.ts`; contractor packages from the section-and-keyword rules only. |
| Reconciliation | Default model rater declines (`async () => null`), so the rules engine rates. Deleted with the module in R1b. |
| Needs-assessment documents | AI summary removed end to end: `requestAiSummary`, `extractedSummaryText`, `keyFindings`, `summaryStatus`, `summaryEngine`, the `/summarise` route, `textExtractor.ts`, and the `unpdf` and `mammoth` packages. Migration `20261130090000_r1a_remove_ai` drops the four columns. |
| Env | `AZURE_OPENAI_*` and `AzureOpenAI__*` removed from `env.ts`, `.env.example` and the test helper. The `openai` package stays (Whisper uses it). Local `.env` files were not touched; remove the `AZURE_OPENAI_*` lines by hand (they are now ignored). |
| Shared | `AZURE_OPENAI` removed from `SuggestionEngineEnum` and `ContractorSuggestionResponse.engine`. `RatingEngineEnum` goes with IPCs in R1b. |
| Web / mobile | AI wording removed from briefs, standards status, report panel, inspections, BOQ suggestion, notifications, roles tab, audit ledger, BOQ page, mobile notification card. Needs-assessment upload has no summary option or polling. |
| Tests | Model-override tests and the text-extraction test deleted; the verifier-brief and needs-assessment tests rewritten for rules only. 246 unit + 316 route, all passing. |

### Found during implementation

- Internal names still say "ai" (`aiCheckStatus`, `aiCheckEngine`, `aiReasoning`, `aiFlagsJson`, `AI_OMISSION_CHECK`, `enableAiOmissionCheck`, `AiOmissionPayload`, `ConfirmAiSummarySheet`, `actorType: 'AI_SYSTEM'`). They belong to workday reports, inspections and the process config, which R2–R5 replace, so they are renamed or deleted there, not twice.
- The public marketing pages (`web/src/pages/public/HomePage.tsx`, `AboutPage.tsx`, `CitationRef.tsx`) describe the lender product and its AI. They are rewritten as a whole in R6, not edited line by line.
- `ReconciliationWorkbenchPage.tsx` and `useReconciliationMutations.ts` still mention the AI provider; deleted with the module in R1b.

---

## R1b: Delete the lender product, add the payment record (2026-11-23)

### Removed

| Layer | What |
| :--- | :--- |
| Prisma | Models `IpcClaim`, `IpcLineItem`, `IpcSupportingDocument`, `MonitorQuery`, `ValuationReport`, `MilestoneVerification`, `TrancheDecision`, `FacilityTranche`, `ConditionPrecedent`, `RetentionReleaseRequest`; enums `EvidenceStrengthRating`, `IpcClaimStatus`, `MonitorRecommendation`, `LenderDecisionType`, `ConditionPrecedentStatus`, `ValuationSource`, `DisbursementMechanism`, `RetentionReleaseStage`, `RetentionReleaseRequestStatus`, `PortfolioHealth`, `TranchePaymentBasis`, `TrancheCompletionRule`; fields `Project.portfolioHealth`, `BoqItem.trancheId/aiSuggestedTrancheId/trancheMappingConfirmedByMonitor`, `ProjectProcessConfig.disbursementMechanism/enableTranchesAndCps`, `ProjectContractor.retentionHeldNgn/ReleasedNgn`, `ReportQuery.ipcLineItemId`, `ProjectDocument.linkedConditionPrecedentId`, `Tenant.evidenceRatingLabels`; enum values `ApprovalChainType.DISBURSEMENT`, `ApprovalSubjectType.VALUATION_REPORT`, `MediaType.VALUATION_REPORT_PDF`, lender audit actions; `PermissionCategory.FINANCIAL_IPC` renamed `PAYMENTS`. |
| Shared | `ipcStateMachine.ts`, `ratingLabels.ts`, `ipc.schema.ts`, `reconciliation.schema.ts` (audit DTO moved to `audit.schema.ts`), `milestonePayment.schema.ts`; disbursement chain and direct-milestone schemas in `process.schema.ts`; tranche/CP inputs; portfolio health and conflict counts in portfolio DTOs; `terminationBlockedBy`; terminology keys `tranche`, `conditionPrecedent`, `ipc`, `valuation` (funder default label now "Funder"); KPI `payment_turnaround_days`; notification categories `CONFLICT_FLAG`, `TRANCHE_DISBURSEMENT`, `DISBURSEMENT_PENDING_APPROVAL`, `RETENTION_RELEASE`; permissions `ipc:*`, `tranche:approve_disbursement`, `milestone:verify_direct_release`, `valuation:export_pdf`, `retention:release_escrow`; `SEGREGATED_DISBURSEMENT_PERMISSIONS` (the platform super admin now passes every permission check). |
| Server | `modules/reconciliation/*` (IPC, reconciliation engine, direct milestone release, disbursement chain), `integrations/pdf-report.service.ts` (valuation PDFs), ownership loaders and serializers for the removed models, rating-label settings routes, retention release requests/certification/lender decision, tranche logic in project setup, BOQ, auth, KPIs, closure pack and default cases (termination is no longer blocked by unpaid claims). |
| Web | `pages/reconciliation/**`, `api|queries|mutations/reconciliation`, `EvidenceOverlayDrawer`, `EvidenceBadge` (reporter-role helpers kept in `components/reporterRole.ts`), `PaymentTermsBox`, `EvidenceRatingsCard`, `PortfolioExecutivePage` (route `/app/executive` now redirects to the portfolio), tranche UI in the setup steps, BOQ page and dashboards, disbursement chain editor. `ModalShell` moved to `components/common/ModalShell.tsx`; media helpers to `api/evidence/mediaApi.ts`. |

### Added

| Item | Detail |
| :--- | :--- |
| `ProjectPayment` (+ enums `PaymentKind`, `PaymentSource`) | Payments made outside the platform: kind INTERIM / FINAL / RETENTION_RELEASE, paid-on date, gross, retention held, net, reference, note, source MANUAL (ERP later, `externalReference` unique per project for idempotent feeds), exception codes, void fields. Audit actions `PAYMENT_RECORDED`, `PAYMENT_VOIDED`; notification category `PAYMENT_EXCEPTION`. |
| `modules/payments` | `GET /projects/:id/payments` (payments:view or payments:record), `POST /projects/:id/payments`, `POST /projects/:id/payments/:paymentId/void` (payments:record). Retention is held at the project percentage when the retention module is on; another amount needs a reason (422 `RETENTION_OVERRIDE_REASON_REQUIRED`). A release above the held balance is 422 `RELEASE_ABOVE_BALANCE`. Exceptions are recorded, never blocking: `FINAL_BEFORE_COC`, `RETENTION_RELEASE_BEFORE_COC` (both follow the type's `closure.requireCocFor` FINAL_PAYMENT gate), `RETENTION_RELEASE_BEFORE_PERIOD_END`, `RETENTION_RELEASE_WITH_OPEN_DEFECTS`, `PAID_ABOVE_CONTRACT_SUM`. Voiding reverses the totals; voiding an interim payment whose retention was already released is 409 `VOID_WOULD_UNDERFLOW_RETENTION`. Payments only on ACTIVE projects. |
| `modules/progress` | `recordCountedReport` (replaces the four `recordItemActualStart` calls in workday reports) and `refreshProjectProgress`: item progress (`BoqItem.cumulativeCertifiedPct`, legacy name) from counted reports, project progress budget-weighted, completion dates synced. BOQ revisions recompute progress. |
| Retention | `getRetentionSummary` reports balance, released total, liability period and open defects; the setup step "facility" is now **Retention** (percentage, liability period, share at completion; not required). Project types' `payments` config now holds retention defaults (`retentionPercentage`, `retentionDurationMonths`), pre-filled on type apply unless the step was saved. |
| Permissions | `payments:view` (Monitor, Org admin, Funder), `payments:record` (Funder / Finance Officer, the renamed LENDER default role; role code unchanged until R1d). |
| Web | `/app/projects/:id/payments` (`pages/payments/ProjectPaymentsPage.tsx`): summary cards, the payment table with exception flags, record and void dialogs. Sidebar "Payments" replaces "IPC reconciliation". Project dashboard: Budget / Progress / Overdue contract milestones cards, payments card. Portfolio map colours by schedule status. Type editor: retention defaults section. |

### Found during implementation

- The audit actions `MONITOR_QUERY_RAISED` and `CONTRACTOR_QUERY_RESPONDED` are also used by field-report queries; they were kept.
- Progress until R2–R4 comes from counted workday reports (decision for this slice; the visit forms replace the source later). Items with no reports stay at 0%.
- Professional registration still snapshots onto nothing now that valuations are gone; the credentials module is deleted in R1d.
- `web/src/config/demoAccounts.ts` still lists `lender@` / `lto@` demo accounts; the seeded roles are reworked in R1d.
- Public marketing pages and `PublicLayout` still describe the lender product (R6).

### Migration, seeds and tests (R1b)

- Migration `20261201090000_r1b_remove_lender_product`: drops the lender tables, enums and columns, narrows the approval, media, audit and permission-category enums, adds `project_payments`. Hand edits: a data clean-up at the top (so it applies on a database that has data) and the media-type change moved after the IPC supporting-document table is dropped. No hand-written index or CHECK from `CLAUDE.md` was lost; the two valuation CHECKs went with their table.
- Seeds: `seedPayments.ts` records payments and keeps totals in step. LKK-402, ABJ-108, KWR-502 (5% retention held, as before), OGN-501 and PRG-105 (bills 1–2 at 100%, bill 3 at 35%, one interim payment by `programme.funder@` with 5% held) have recorded payments instead of IPCs or releases. Both programme types default to 5% retention over 12 months. `npm run prisma:seed` succeeds.
- Tests: 52 lender-only tests deleted; phases 2, 4, 6, 7, 9, 11, 15 and 16 rewritten where they used lender data as setup; `routes.r1b.test.ts` (10 tests) added for payments and progress.
- Verified 2026-11-23: `npm run typecheck` clean, `npm run lint` 0 errors, web build passes, server tests **169 unit + 266 route, all passing**.
- Demo script and configuration reference updated (A4 is now "Payments": record an interim payment, then a final payment flagged before the CoC, then void it).

### Found during implementation (R1b, continued)

- Once any report on a project becomes counted, `refreshProjectProgress` replaces hand-seeded item percentages with progress from counted reports (e.g. LKK earthworks can drop below its seeded 90%). Expected under the R1b progress rule; R2–R4 replace the source.

---

## R1d (+R1c): Delete contractor access, registrations and multi-contractor modes (2026-11-23)

### Removed

| Layer | What |
| :--- | :--- |
| Prisma | Models `ProjectJoinCode`, `HandoverLink`, `ProfessionalRegistrationBody`; enums `RoleOnboardingMode`, `FieldSessionOrigin`, `ContractorAssuranceStatus`, `ContractorExecutionMode`, `HandoverLinkPurpose`; fields `Role.codeSuffix/requiresIdentityAssurance/onboardingMode`, `User.professionalRegistration*`, `Tenant.credentialPolicyJson`, `Project.contractorExecutionMode`, `ProjectContractor.isMainContractor/allowFieldReporting/replacesProjectContractorId`, `ProjectProcessConfig.allowContractorFieldReporting/enableContractorIdentityAssurance`, every identity, registration and join field on `FieldAgentSession` (`userId` is now required), `HandoverSubmission.handoverLinkId/attachmentsJson/clientIp/userAgent`, `RetentionDefectTicket.snagPhotoKeys`, `CompletionCertificateSignature.registrationText`; audit actions for join codes, identity checks, onboarding mode, handover links, registration and contractor replacement; mobile notification types `ASSURANCE_*` and action `OPEN_ASSURANCE_WIZARD`. |
| Shared | `joinCodes.ts` (`TRADE_CODE_REGEX` moved to `projectSetup.schema.ts`), `credentials.schema.ts`, the join, identity, demo and device-key auth schemas, join-code DTOs, the onboarding-impact DTO, the link, public, upload and multipart handover schemas, `ReplaceContractor*`, `RectifyDefectTicketRequest`; project type key `credentials`; closure `cocSignatureUsesCertifierPolicy`; permissions `field:join_project`, `assurance:review_credentials`; default roles `CONTRACTOR` and `CONTRACTOR_ENGINEER`. |
| Server | `modules/credentials`, `projects/joinCodes.service.ts`, `closeout/handoverPublic.*`, the field-session (join-code) token type, `/auth/join-project`, `/auth/assurance-verification`, `/auth/demo/skip-verification`, `/auth/device-key`, the join-code and contractor-verification routes, `GET /projects/demo`, `/rbac/roles/:id/onboarding-impact`, `/contractors/:id/replace`, `/defects/:id/rectify`, contractor-side defect and finding logic and notifications, handover link emails, join-code reminder text. |
| Web | Credentials components and settings, join codes panel, verification queue, onboarding-mode and identity controls in the role editor, the public handover page and link management, `ReplaceContractorDialog`, contractor-side defect actions, the execution-mode picker. |
| Mobile | Join-code entry, onboarding profile, identity wizard and under-review screens, guided selfie and ID overlay, assurance storage, device-key registration, the contractor "mark fixed" defect path. Signing in with an account is the only way in. |

### Changed

| Item | Detail |
| :--- | :--- |
| Auth | Two token types: web and mobile account. A mobile account token resolves to the account's `FieldAgentSession` for the URL project (`findOrCreateProvisionedSession`). Every MOBILE/BOTH role is a provisioned role. |
| Contractor persona | No default role has `CONTRACTOR_EXECUTOR`; the role editor refuses it (`AssignableFieldPersonaTypeEnum`). The enum value stays for brief and cadence code (R1e/R4 delete it). Briefs are always verifier briefs. |
| One contractor per project | Parties step capped at one (shared schema `max(1)`, server 422 `ONE_CONTRACTOR_ONLY`); activation needs no execution mode; `contractorIssues(list)` replaces the model rules. No replacement; termination only waives open milestones. Trade fields stay until packages go in R2. |
| Handover | Officers with `handover:record_response` (was `handover:manage_links`) record the beneficiary's response from the signed copy: `POST /projects/:id/handover/submissions`, attestation required, only in handover; audit `HANDOVER_RECORDED`, reviewer notification. Review and snag-to-defect conversion are unchanged; review still issues the handover certificate. |
| Defects (R1c) | Staff-only: tickets name the project's contractor, "assign" records that the ticket was passed on, closing needs the officer's site photos (field app), a ticket awaiting verification can be reopened, no rectify step. Reminders are a staff summary. |
| Findings | Staff-only (same pattern); no contractor notifications. |
| Programme of works | Staff with `schedule:propose_programme` (now on the Monitor default role) record it for the project's contractor. |
| Migration | `20261202090000_r1d_remove_contractor_access`. Hand edits: data clean-up first (join-code sessions and their captures, removed audit actions, notifications and permissions; `handover:manage_links` renamed), explicit drop of CHECK `FieldAgentSession_origin_source_check`, handover responses backfilled from their link. The hand-written index `ProjectJoinCode_active_project_role_contractor_key` goes with its table. As in R1b, deleting audit rows breaks the hash chain on a database that had them (dev DB is disposable, decision A). |
| Seeds | `seedFieldAccounts.ts` creates provisioned field accounts: `resident.cow@`, `field.officer@` (LKK-402; owns the data of the old contractor-engineer session), `resident.abj@` (ABJ-108). Removed: `contractor@`, `electrical@`, `sahel.contractor@`. KAN-210 has one contractor. OGN-501 and PRG-104 wait for a handover response; PRG-103 and PRG-242 have staff-recorded accepted responses. Registration bodies and policies are gone. |
| Tests | `server/src/tests/helpers/fieldAuth.ts` (`createFieldSession`, `fieldAuth`). Deleted `credentials.phase12.test.ts` and `routes.phase12.test.ts` (the R1b payment-defaults test moved to `projectTypeConfig.r1.test.ts`), plus the join-code, identity, public-handover, contractor-defect, replacement and multi-prime tests. Added tests for the R1d rules: retired token refused, removed endpoints 404, one contractor, contractor persona refused, handover recording, staff-only defects and findings. |
| Docs | `CLAUDE.md`, `configuration_reference.md`, `demo_script_programme_delivery.md` (the monitor records PRG-104's handover response; no contractor login). |

Verified 2026-11-23: `npm run typecheck` clean, `npm run lint` 0 errors, web build passes, server tests **164 unit + 245 route, all passing**, mobile tests 61 passing. Web and mobile are verified by typecheck, build, lint and unit tests only (no browser or device run).

### Found during implementation (R1d)

- Contractor-side branches remain in documents (`visibleToContractors`, `documentViewerFor`), ratings (`shareRatingsWithContractor`), lessons (`sharedWithContractor`) and web notifications (`targetOrganizationId`, `hideFromProjectContractors`). With no contractor logins they cannot be reached. R4 (findings email summary) decides what is shared with the contractor; they go then.
- Still in the schema for later slices: `FieldPersonaType.CONTRACTOR_EXECUTOR`, `BriefPersona.CONTRACTOR_EXECUTOR` and the contractor reporter scopes in cadence (R1e/R4); `WorkdayReportStatus.STAGED_UNVERIFIED` (never set now) and `MobilizationStatus.REGISTERED_PENDING_ASSURANCE` (R1e roster); `MediaType.IDENTITY_DOCUMENT/IDENTITY_SELFIE`; document type `CP_EVIDENCE` (R1b leftover).
- Storage multipart (`startMultipartUpload` and the local part routes) is no longer used by any route. It is generic plumbing, left for a storage clean-up.
- The `isHandoverObjectKey` guards stay: they keep files uploaded through the old public link quarantined.
- Not done here: the full role catalogue (spec section 4) and renaming the `LENDER` role code. R1b deferred them to R1d, but they depend on the R4 visit permissions, so they move to R7 with the seed rewrite. `lender@` and `lto@` stay.
- The executive summary still returns `pendingContractorCount` and `pendingContractorVerificationsCount` as 0 because the shared DTO requires them; they went with the executive matrix in R1e.
- One person can record and review the same handover response (the Monitor role holds both permissions by default), and can propose and accept a programme of works. Decide with the client whether to separate these.
- Public marketing pages (`web/src/pages/public/*`) still mention join codes (R6 rewrite).
- Mobile: saved device state moved to v4 (join-code sessions are dropped on upgrade and their unsent work is put on hold); SQLite migration v7 clears queued assurance items; the push-permission prompt now appears when a project is opened.
- The forks' private test databases (`insite_forka_test`, `insite_assurance_forkc_test` and their `_tmpl` copies) can be dropped from the local server.

---

## R1e: Delete briefs, telemetry, the attendance roster and the executive matrix (2026-11-23)

### Removed

| Layer | What |
| :--- | :--- |
| Prisma | Models `MorningDeliverableBrief`, `SiteTelemetryPing`, `TelemetryAnomalyDaily`, `ExpectedProjectParticipant`, `SiteAttendanceAlert`; enums `BriefPersona`, `MobilizationStatus` (with the R1d leftover `REGISTERED_PENDING_ASSURANCE`), `AttendanceAlertType`, `AttendanceAlertStatus`; audit actions `TELEMETRY_ANOMALY_SUMMARY`, `PARTICIPANT_PREREGISTERED`, `PARTICIPANT_REMINDER_SENT`, `ATTENDANCE_ALERT_RAISED`, `ATTENDANCE_ALERT_RESOLVED`, `MANUAL_CHECKIN_RECORDED`; mobile notification types `MORNING_DELIVERABLE_READY`, `SITE_GEOFENCE_WARNING`. |
| Shared | `morningBrief.schema.ts` (`PlanningTier` moved to `boq.schema.ts`), `telemetry.schema.ts`, `canonicalPingString`, `BriefPersonaEnum`; participant, reminder, attendance and check-in schemas in `cadence.schema.ts`; `openAttendanceAlerts` on the cadence overview; `PortfolioExecutiveSummaryDto`, `PortfolioProjectHealthItem`, `PortfolioRetentionItem`; `MobilisationComplianceRow.firstCheckInAt`; `isWithinWorkingHours`, `cadenceExpectsDailyPresence`; web notification category `ATTENDANCE_ALERT`; chat message type `MORNING_BRIEF`; permissions `projects:view_executive_matrix`, `mobilization:manage_roster`, `mobilization:configure_reminders`, `presence:view_telemetry`, `presence:manage_noshow_alerts`, `field:manual_checkin`. `ReportingPeriod.briefAt` is now `opensAt`. |
| Server | `modules/morning-briefs`, `modules/telemetry`, `modules/mobilization` (roster, attendance, check-in status); jobs `brief-dispatch`, `mobilization-reminders`, `attendance-check`; the `MOBILIZATION_REMINDER` email template; the report-submission ping; `recordContractorOnSite`; `GET /projects/portfolio/executive-summary`; `participants` and `join-codes` in `DRAFT_ROUTE_RE`, `telemetry` in `FIELD_DEFECT_WORK_RE`. |
| Web | Brief API/hooks and `BriefPreview`; telemetry API/hooks and the presence pings table and timeline; `ExpectedParticipantsPanel`; attendance alerts in `ReportingCadencePanel`; the executive summary type and query invalidation. |
| Mobile | Brief fetch, storage (`briefMeta.ts`) and chat card; presence telemetry (`usePresenceTelemetry`, `telemetryService`, `telemetryStore`, telemetry API, the `TELEMETRY` outbox kind and its batch machinery); the manual check-in (`PeriodCheckInCard`, check-in query). |

### Changed

| Item | Detail |
| :--- | :--- |
| Reporting obligations | `modules/cadence/obligationDispatch.ts` (`reportingPersonasForProject`, `scheduledItemsForPeriod`, `dispatchObligationsForProject`) keeps the obligation half of the old brief dispatch. The job is now `reporting-obligations` (same timing: when the period opens). The brief-only "fallback" items are gone; obligations were only ever owed for scheduled items, so what is owed is unchanged. Cadence and obligation routes moved to `modules/cadence/cadence.routes.ts`. |
| Excusing a missed report | Needs `reports:approve_completion` (was `presence:manage_noshow_alerts`; both were on the Monitor role only). |
| Omission check | The photo rule used the brief's checklist, which always asked for a photo. It now uses a fixed line: a report with progress needs a photo or a reason. With no brief the old code asked for no photo, so reports on items that were never briefed are now checked too. |
| Contractor on site | `AUTO_CONTRACTOR_ON_SITE` milestones are completed by staff through the manual complete endpoint (`readyToComplete` is true for them; web shows the Complete button). Mobilisation compliance `onSite` means that milestone is done. An overdue one still opens a default case ("has not mobilised"). The R4 mobilisation check visits will complete it. |
| Field reports tab (web) | `SitePresencePanel` is now `WorkdayReportsPanel` (reports, drawer, geotags, captures, query/approve/return). The audit tab is labelled "Field reports" and keeps the `?tab=presence` URL value that server notifications link to. |
| Mobile | `PeriodCard` replaces `PeriodCheckInCard` (period and due countdown, no check-in). SQLite migration v8 deletes cached brief messages and queued telemetry items, drops `telemetry_pings` and recomputes thread previews. `app.json` location text now names evidence and report geotags, not site presence. |
| Migration | `20261203090000_r1e_remove_briefs_telemetry_roster`. Hand edits: data clean-up first (removed audit actions, notifications, permissions, queued `MOBILIZATION_REMINDER` messages, `JobRun` rows of the removed jobs). No hand-written index or CHECK from `CLAUDE.md` is affected. |
| Seeds | The brief notification and the telemetry and brief rows in the reset list are gone; `npm run prisma:seed` succeeds. |
| Tests | Phase 8 rewritten (obligations instead of briefs; roster, reminder, attendance and check-in tests deleted; a test that the removed endpoints answer 404 and the removed jobs are not registered). Brief tests in phases 7 and 9 replaced by obligation tests; telemetry tests in phases 4 and 13 removed; executive summary checks in phases 6, 9 and 11 use the portfolio overview; new phase 13 test for staff confirming "contractor on site" on seeded PRG-102. |
| Docs | `CLAUDE.md`, `configuration_reference.md` (completion modes, removed permissions), `demo_script_programme_delivery.md` (the PRG-221 default case line), `redesign_r2_implementation_plan.md` (R1e is done). |

Verified 2026-11-23: `npm run typecheck` clean, `npm run lint` 0 errors, web build passes, server tests **163 unit + 234 route, all passing**, mobile tests 57 passing. Web and mobile are verified by typecheck, build, lint and unit tests only (no browser or device run).

### Found during implementation (R1e)

- `Project.mobilizationReminderOffsetsDays` stays: contract milestone reminders use it. Its only editor was the roster's reminder settings, so it is fixed at 7, 3 and 1 days until the R4 deadline settings.
- `FieldPersonaType.CONTRACTOR_EXECUTOR` and the contractor reporter scopes in cadence remain (R4 replaces cadence with the visit plan).
- `BoqItem.planningTier`, `dailyTargetQuantity` and `expectedDeliverable` were brief inputs. They stay until the BoQ rework (R2).
- Permission categories `MOBILIZATION_ASSURANCE` (now only `sessions:revoke_device`) and `FIELD_PRESENCE` stay; the catalogue is reworked with the role catalogue in R7.
- Mobile SQLite keeps the unused `chat_messages.brief_date` / `brief_json` columns (not worth a table rebuild).
- Web text left from earlier slices: `ProjectPhaseBanner` still mentions sending stakeholders a link (R1d), `ArchiveProjectDialog` still mentions IPCs (R1b).
