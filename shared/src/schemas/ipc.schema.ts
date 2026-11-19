import { z } from 'zod';
import {
  ConditionPrecedentStatusEnum,
  EvidenceStrengthRatingEnum,
  FieldPersonaTypeEnum,
  IpcClaimStatusEnum,
  LenderDecisionTypeEnum,
  MediaTypeEnum,
  MonitorRecommendationEnum,
  ProfessionalLicenseTypeEnum,
  QueryStatusEnum,
} from '../enums';

// ============================================================================
// Requests
// ============================================================================

/**
 * Supporting Document Attachment for an IPC Claim (Waybills, Mill Certs, Cube Tests)
 */
export const IpcSupportingDocumentInputSchema = z.object({
  title: z.string().min(2).max(160), // e.g., "28-Day Concrete Cube Crushing Test Report - Culvert Ch 14+200"
  mediaType: MediaTypeEnum,
  objectKey: z.string().min(3),
  fileUrl: z.string().url().optional(),
  boqItemId: z.string().uuid().nullable().optional(),
});
export type IpcSupportingDocumentInput = z.infer<typeof IpcSupportingDocumentInputSchema>;

/**
 * Contractor Line-Item Progress Claim inside an Interim Payment Certificate (IPC).
 * The server checks the percentage against the BOQ item's certified percentage and computes
 * the amount; no amount is accepted from the client.
 */
export const IpcLineItemClaimInputSchema = z.object({
  boqItemId: z.string().uuid(),
  claimedCumulativePct: z.number().min(0).max(100),
  claimedQuantityToDate: z.number().nonnegative().optional(),
  contractorRemarks: z.string().max(600).optional(),
});
export type IpcLineItemClaimInput = z.infer<typeof IpcLineItemClaimInputSchema>;

/**
 * Contractor IPC submission. The IPC number is assigned by the server.
 */
export const SubmitIpcClaimRequestSchema = z
  .object({
    trancheId: z.string().uuid(),
    periodStart: z.string().datetime(),
    periodEnd: z.string().datetime(),
    contractorCoverNote: z.string().max(1500).optional(),
    lineItems: z.array(IpcLineItemClaimInputSchema).min(1).max(500),
    supportingDocuments: z.array(IpcSupportingDocumentInputSchema).max(50).default([]),
  })
  .superRefine((v, ctx) => {
    if (new Date(v.periodEnd).getTime() <= new Date(v.periodStart).getTime()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['periodEnd'],
        message: 'Period end must be after period start',
      });
    }
    const seen = new Set<string>();
    v.lineItems.forEach((line, i) => {
      if (seen.has(line.boqItemId)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['lineItems', i, 'boqItemId'],
          message: 'Each BOQ item may appear only once in a claim',
        });
      }
      seen.add(line.boqItemId);
    });
  });
export type SubmitIpcClaimRequest = z.infer<typeof SubmitIpcClaimRequestSchema>;

export const WithdrawIpcClaimRequestSchema = z.object({
  reason: z.string().trim().min(5).max(1000),
});
export type WithdrawIpcClaimRequest = z.infer<typeof WithdrawIpcClaimRequestSchema>;

/**
 * Monitor Line-Item Query, Contractor Response and Monitor Resolution
 */
export const CreateMonitorQueryRequestSchema = z.object({
  ipcLineItemId: z.string().uuid(),
  queryReason: z.string().min(5).max(1000), // e.g., "Claimed 80% on box culvert but Hold-Point pre-pour reinforcement photo is missing."
  requestedProofTypes: z.array(MediaTypeEnum).default([]),
});
export type CreateMonitorQueryRequest = z.infer<typeof CreateMonitorQueryRequestSchema>;

export const RespondMonitorQueryRequestSchema = z.object({
  contractorResponseText: z.string().min(4).max(1500),
  revisedClaimedCumulativePct: z.number().min(0).max(100).optional(),
  attachedDocuments: z.array(IpcSupportingDocumentInputSchema).max(20).default([]),
});
export type RespondMonitorQueryRequest = z.infer<typeof RespondMonitorQueryRequestSchema>;

export const ResolveMonitorQueryRequestSchema = z.object({
  resolutionNote: z.string().trim().min(3).max(1000),
});
export type ResolveMonitorQueryRequest = z.infer<typeof ResolveMonitorQueryRequestSchema>;

/**
 * Conditions Precedent (D-3.2)
 */
export const UpdateConditionPrecedentStatusRequestSchema = z.object({
  // WAIVED has its own endpoint because it needs a reason and a narrower permission.
  status: z.enum(['PENDING', 'SATISFIED', 'BREACHED']),
  note: z.string().trim().max(1000).optional(),
});
export type UpdateConditionPrecedentStatusRequest = z.infer<
  typeof UpdateConditionPrecedentStatusRequestSchema
>;

export const WaiveConditionPrecedentRequestSchema = z.object({
  reason: z.string().trim().min(10).max(1000),
});
export type WaiveConditionPrecedentRequest = z.infer<typeof WaiveConditionPrecedentRequestSchema>;

// ============================================================================
// Response DTOs
// ============================================================================

/** One piece of evidence as returned by the evidence provider (the seam with Phase 4). */
export const ProvidedEvidenceQuantitySchema = z.object({
  materialOrWork: z.string(),
  quantity: z.number(),
  unit: z.string(),
});
export type ProvidedEvidenceQuantity = z.infer<typeof ProvidedEvidenceQuantitySchema>;

export const ProvidedEvidenceMediaSchema = z.object({
  /** Capture ID. */
  id: z.string(),
  mediaType: MediaTypeEnum,
  objectKey: z.string(),
  mimeType: z.string(),
  durationSeconds: z.number().nullable(),
  capturedAt: z.string().datetime(),
  locationAvailable: z.boolean(),
  isWithinGeofence: z.boolean().nullable(),
  signatureVerified: z.boolean().nullable(),
  integrityPassed: z.boolean(),
  integrityFlags: z.array(z.string()),
});
export type ProvidedEvidenceMedia = z.infer<typeof ProvidedEvidenceMediaSchema>;

/**
 * One piece of evidence: a confirmed workday report (latest revision) with the captures that
 * support it across its revision chain. A capture with no confirmed report is not evidence.
 */
export const ProvidedEvidenceItemSchema = z.object({
  /** Workday report ID (latest revision). */
  id: z.string(),
  source: z.literal('WORKDAY_REPORT'),
  boqItemId: z.string(),
  reporterName: z.string().nullable(),
  reporterRoleName: z.string(),
  fieldPersonaType: FieldPersonaTypeEnum,
  assuranceWeight: z.number(),
  /**
   * true when the report position or any located capture is inside the geofence and none is
   * outside; false when something is outside; null when nothing could be evaluated.
   */
  isWithinGeofence: z.boolean().nullable(),
  chainageLabel: z.string().nullable(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  gpsAccuracyMeters: z.number().nullable(),
  workdayDate: z.string(),
  revisionNumber: z.number().int(),
  summary: z.string().nullable(),
  quantities: z.array(ProvidedEvidenceQuantitySchema),
  blockers: z.array(z.string()),
  isHoldPointClaimed: z.boolean(),
  capturedAt: z.string().datetime(),
  confirmedAt: z.string().datetime().nullable(),
  /** False when any capture or the report position failed an integrity check. */
  integrityPassed: z.boolean(),
  integrityFlags: z.array(z.string()),
  signatureVerified: z.boolean().nullable(),
  media: z.array(ProvidedEvidenceMediaSchema),
});
export type ProvidedEvidenceItem = z.infer<typeof ProvidedEvidenceItemSchema>;

export const ConditionPrecedentDtoSchema = z.object({
  id: z.string().uuid(),
  referenceCode: z.string(),
  description: z.string(),
  isMandatoryForRelease: z.boolean(),
  status: ConditionPrecedentStatusEnum,
  verifiedAt: z.string().datetime().nullable(),
  statusChangedAt: z.string().datetime().nullable(),
  waivedByUserId: z.string().uuid().nullable(),
  waiverReason: z.string().nullable(),
});
export type ConditionPrecedentDto = z.infer<typeof ConditionPrecedentDtoSchema>;

export const TrancheDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  trancheNumber: z.number().int(),
  name: z.string(),
  allocatedAmountNgn: z.number(),
  releasedAmountNgn: z.number(),
  targetCompletionPct: z.number(),
  isReleased: z.boolean(),
  conditionsPrecedent: z.array(ConditionPrecedentDtoSchema).optional(),
});
export type TrancheDto = z.infer<typeof TrancheDtoSchema>;

export const MonitorQueryDtoSchema = z.object({
  id: z.string().uuid(),
  ipcLineItemId: z.string().uuid(),
  status: QueryStatusEnum,
  queryReason: z.string(),
  requestedProofTypes: z.array(z.string()),
  contractorResponseText: z.string().nullable(),
  revisedClaimedCumulativePct: z.number().nullable(),
  attachedDocuments: z.array(z.unknown()),
  resolutionNote: z.string().nullable(),
  raisedByUserId: z.string().uuid().nullable(),
  respondedByUserId: z.string().uuid().nullable(),
  resolvedByUserId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(),
  respondedAt: z.string().datetime().nullable(),
  resolvedAt: z.string().datetime().nullable(),
});
export type MonitorQueryDto = z.infer<typeof MonitorQueryDtoSchema>;

export const CpSnapshotEntrySchema = z.object({
  id: z.string(),
  referenceCode: z.string(),
  isMandatoryForRelease: z.boolean(),
  status: ConditionPrecedentStatusEnum,
});
export type CpSnapshotEntry = z.infer<typeof CpSnapshotEntrySchema>;

export const TrancheDecisionDtoSchema = z.object({
  id: z.string().uuid(),
  valuationReportId: z.string().uuid(),
  decision: LenderDecisionTypeEnum,
  approvedDisbursementAmountNgn: z.number(),
  heldBackAmountNgn: z.number(),
  creditCommitteeReference: z.string().nullable(),
  approverNotes: z.string().nullable(),
  decidedByUserId: z.string().uuid(),
  /** Set on a reversal record. Reversal amounts are negative. */
  reversesDecisionId: z.string().uuid().nullable(),
  /** True when a later reversal record cancels this decision. */
  isReversed: z.boolean(),
  cpSnapshot: z.array(CpSnapshotEntrySchema),
  decidedAt: z.string().datetime(),
});
export type TrancheDecisionDto = z.infer<typeof TrancheDecisionDtoSchema>;

export const ValuationReportDtoSchema = z.object({
  id: z.string().uuid(),
  ipcClaimId: z.string().uuid(),
  revisionNumber: z.number().int(),
  trancheRecommendation: MonitorRecommendationEnum,
  totalClaimedNgn: z.number(),
  totalCertifiedNgn: z.number(),
  recommendedReleaseAmountNgn: z.number(),
  recommendedHoldbackAmountNgn: z.number(),
  executiveCertificationSummary: z.string(),
  certifiedByUserId: z.string().uuid(),
  certifierFullName: z.string(),
  certifierLicenseType: ProfessionalLicenseTypeEnum,
  certifierLicenseNumber: z.string(),
  certifiedAt: z.string().datetime(),
  supersededAt: z.string().datetime().nullable(),
  decisions: z.array(TrancheDecisionDtoSchema),
});
export type ValuationReportDto = z.infer<typeof ValuationReportDtoSchema>;

export const IpcBoqItemSummarySchema = z.object({
  id: z.string().uuid(),
  trancheId: z.string().uuid().nullable(),
  wbsCode: z.string(),
  section: z.string(),
  description: z.string(),
  unit: z.string(),
  totalQuantity: z.number(),
  rateNgn: z.number(),
  budgetedCostNgn: z.number(),
  isHoldPoint: z.boolean(),
  holdPointInstruction: z.string().nullable(),
  isOpaqueLumpSum: z.boolean(),
  opacityWarningReason: z.string().nullable(),
  cumulativeCertifiedPct: z.number(),
});
export type IpcBoqItemSummary = z.infer<typeof IpcBoqItemSummarySchema>;

export const RatingEngineEnum = z.enum(['AZURE_OPENAI', 'RULES_ENGINE']);
export type RatingEngine = z.infer<typeof RatingEngineEnum>;

/** Rule caps enforced in code after the rating engine returns (Phase 3 Step 6). */
export const RuleCapCodeEnum = z.enum([
  'NO_EVIDENCE',
  'CONTRACTOR_ONLY_EVIDENCE',
  'HOLD_POINT_WITHOUT_INDEPENDENT_EVIDENCE',
  'COVERAGE_BELOW_50_PCT',
  'INTEGRITY_FLAGGED_EVIDENCE_EXCLUDED',
]);
export type RuleCapCode = z.infer<typeof RuleCapCodeEnum>;

export const IpcLineItemDtoSchema = z.object({
  id: z.string().uuid(),
  ipcClaimId: z.string().uuid(),
  boqItemId: z.string().uuid(),
  previousCertifiedPct: z.number(),
  contractorClaimedPct: z.number(),
  contractorClaimedNgn: z.number(),
  contractorRemarks: z.string().nullable(),
  aiEvidenceRating: EvidenceStrengthRatingEnum,
  aiRationale: z.string().nullable(),
  visitPlannerFlag: z.boolean(),
  visitPlannerReason: z.string().nullable(),
  missingHoldPointFlag: z.boolean(),
  highestCorroboratingRoleName: z.string().nullable(),
  highestCorroboratingWeight: z.number().nullable(),
  corroboratingEvidenceLogIds: z.array(z.string()),
  evidenceQuantityTotal: z.number().nullable(),
  evidenceCoveragePct: z.number().nullable(),
  ratingEngine: RatingEngineEnum.nullable(),
  ruleCapsApplied: z.array(z.string()),
  monitorCertifiedPct: z.number().nullable(),
  monitorCertifiedNgn: z.number().nullable(),
  monitorRemarks: z.string().nullable(),
  boqItem: IpcBoqItemSummarySchema,
  /** Evidence the reconciliation considered (bounded by the claim period). Oversight roles only. */
  evidence: z.array(ProvidedEvidenceItemSchema),
  queries: z.array(MonitorQueryDtoSchema),
});
export type IpcLineItemDto = z.infer<typeof IpcLineItemDtoSchema>;

export const IpcActionGateSchema = z.object({
  allowed: z.boolean(),
  reason: z.string().nullable(),
});
export type IpcActionGate = z.infer<typeof IpcActionGateSchema>;

export const IpcSupportingDocumentDtoSchema = z.object({
  id: z.string().uuid(),
  boqItemId: z.string().uuid().nullable(),
  title: z.string(),
  mediaType: MediaTypeEnum,
  objectKey: z.string(),
  uploadedAt: z.string().datetime(),
});
export type IpcSupportingDocumentDto = z.infer<typeof IpcSupportingDocumentDtoSchema>;

export const VisitPlannerEntrySchema = z.object({
  ipcLineItemId: z.string().uuid(),
  wbsCode: z.string(),
  description: z.string(),
  claimedAmountNgn: z.number(),
  aiEvidenceRating: EvidenceStrengthRatingEnum,
  missingHoldPointFlag: z.boolean(),
  visitPlannerReason: z.string(),
});
export type VisitPlannerEntry = z.infer<typeof VisitPlannerEntrySchema>;

export const IpcClaimDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  trancheId: z.string().uuid(),
  ipcNumber: z.number().int(),
  periodStart: z.string().datetime(),
  periodEnd: z.string().datetime(),
  contractorCoverNote: z.string().nullable(),
  totalClaimedAmountNgn: z.number(),
  totalCertifiedNgn: z.number().nullable(),
  status: IpcClaimStatusEnum,
  aiExecutiveSummary: z.string().nullable(),
  submittedByUserId: z.string().uuid(),
  ratingEngine: RatingEngineEnum.nullable(),
  ratingEngineDetail: z.string().nullable(),
  reconciledAt: z.string().datetime().nullable(),
  /** True while the claim is saved but reconciliation has not completed (retry with /reconcile). */
  reconciliationPending: z.boolean(),
  submittedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  tranche: TrancheDtoSchema,
  supportingDocuments: z.array(IpcSupportingDocumentDtoSchema),
  /** The live (not superseded) valuation revision, if any. */
  valuationReport: ValuationReportDtoSchema.nullable(),
  valuationRevisions: z.array(ValuationReportDtoSchema),
  /** The decision on the live revision that has not been reversed, if any. */
  activeDecision: TrancheDecisionDtoSchema.nullable(),
  lineItems: z.array(IpcLineItemDtoSchema),
  smartVisitPlannerQueue: z.array(VisitPlannerEntrySchema),
  /** What the caller may do next, with the reason when not. Advisory: the server re-checks. */
  actions: z.object({
    reconcile: IpcActionGateSchema,
    raiseQuery: IpcActionGateSchema,
    respondQuery: IpcActionGateSchema,
    resolveQuery: IpcActionGateSchema,
    certify: IpcActionGateSchema,
    decide: IpcActionGateSchema,
    reverseDecision: IpcActionGateSchema,
    withdraw: IpcActionGateSchema,
  }),
});
export type IpcClaimDto = z.infer<typeof IpcClaimDtoSchema>;
