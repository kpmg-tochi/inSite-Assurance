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
| R1c | Defects staff-only (contractor side removed) | Moves to R1d with the rest of contractor access |
| R1d | Delete professional registrations; contractor access (join codes, field sessions for contractors, identity assurance, public handover link); multi-contractor modes | – |
| R1e | Delete briefs, telemetry, attendance roster and alerts, executive risk matrix | – |

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
