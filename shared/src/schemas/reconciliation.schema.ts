import { z } from "zod";
import {
  AuditActionTypeEnum,
  AuditActorTypeEnum,
  EvidenceStrengthRatingEnum,
  LenderDecisionTypeEnum,
  MonitorRecommendationEnum,
} from "../enums";

/**
 * 1. Structured output requested from the AI rater for each IPC line. The model proposes a rating;
 * the server computes the facts beforehand and enforces the rule caps afterwards, so nothing
 * here is stored unchecked.
 */
export const AiLineItemReconciliationResultSchema = z.object({
  boqItemId: z.string(),
  evidenceStrengthRating: EvidenceStrengthRatingEnum,
  aiRationale: z.string(),
  visitPlannerFlag: z.boolean(),
  visitPlannerReason: z.string().nullable(),
  corroboratingEvidenceLogIds: z.array(z.string()),
});
export type AiLineItemReconciliationResult = z.infer<
  typeof AiLineItemReconciliationResultSchema
>;

export const AiIpcBatchReconciliationOutputSchema = z.object({
  lineEvaluations: z.array(AiLineItemReconciliationResultSchema),
  executiveSummaryNote: z.string(),
});
export type AiIpcBatchReconciliationOutput = z.infer<
  typeof AiIpcBatchReconciliationOutputSchema
>;

/**
 * 2. Monitor Valuation Certification (Section 4.A Role 1).
 * The certifier is the authenticated user; licence details come from their profile. Amounts are
 * computed by the server from the certified percentages. The only amount the monitor may enter
 * is the recommended release under SUPPORT_WITH_HOLDBACK, bounded by the total certified.
 */
export const MonitorLineItemValuationInputSchema = z.object({
  ipcLineItemId: z.string().uuid(),
  monitorCertifiedCumulativePct: z.number().min(0).max(100),
  monitorRemarks: z.string().max(800).optional(),
});
export type MonitorLineItemValuationInput = z.infer<
  typeof MonitorLineItemValuationInputSchema
>;

export const CertifyIpcValuationRequestSchema = z
  .object({
    lineValuations: z.array(MonitorLineItemValuationInputSchema).min(1),
    trancheRecommendation: MonitorRecommendationEnum,
    recommendedReleaseAmountNgn: z.number().nonnegative().optional(),
    executiveCertificationSummary: z.string().min(10).max(3000),
    certifierDigitalSignatureAck: z.literal(true),
  })
  .superRefine((v, ctx) => {
    if (v.trancheRecommendation === "SUPPORT_WITH_HOLDBACK") {
      if (v.recommendedReleaseAmountNgn === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["recommendedReleaseAmountNgn"],
          message: "Enter the recommended release amount for a release with holdback",
        });
      }
    } else if (v.recommendedReleaseAmountNgn !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["recommendedReleaseAmountNgn"],
        message: "The release amount is computed by the server for this recommendation",
      });
    }
  });
export type CertifyIpcValuationRequest = z.infer<
  typeof CertifyIpcValuationRequestSchema
>;

/** Server-computed certification figures, returned by a dry run and on certification. */
export const CertificationComputationSchema = z.object({
  lines: z.array(
    z.object({
      ipcLineItemId: z.string().uuid(),
      previousCertifiedPct: z.number(),
      contractorClaimedPct: z.number(),
      monitorCertifiedPct: z.number(),
      monitorCertifiedNgn: z.number(),
    })
  ),
  totalClaimedNgn: z.number(),
  totalCertifiedNgn: z.number(),
  recommendedReleaseAmountNgn: z.number(),
  recommendedHoldbackAmountNgn: z.number(),
  certifierFullName: z.string(),
  /** Phase 12: registration snapshot from the profile, following the credential policy (null when absent or HIDDEN). */
  certifierLicenseType: z.string().nullable(),
  certifierLicenseNumber: z.string().nullable(),
  certifierRegistrationBodyName: z.string().nullable(),
  certifierRegistrationPrefix: z.string().nullable(),
  revisionNumber: z.number().int(),
});
export type CertificationComputation = z.infer<typeof CertificationComputationSchema>;

/**
 * 3. Lender / Guarantor Tranche Disbursement Decision (Section 4.A Role 2).
 * APPROVE_FULL releases exactly the monitor's recommended release; HOLD releases nothing.
 * Only APPROVE_WITH_HOLDBACK carries an amount, bounded by the recommended release and the
 * tranche's unreleased allocation.
 */
export const LenderTrancheDecisionRequestSchema = z
  .object({
    valuationReportId: z.string().uuid(),
    decision: LenderDecisionTypeEnum,
    approvedDisbursementAmountNgn: z.number().positive().optional(),
    creditCommitteeReference: z.string().max(120).optional(),
    approverNotes: z.string().max(1500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision === "APPROVE_WITH_HOLDBACK" && v.approvedDisbursementAmountNgn === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approvedDisbursementAmountNgn"],
        message: "Enter the amount to release",
      });
    }
    if (v.decision !== "APPROVE_WITH_HOLDBACK" && v.approvedDisbursementAmountNgn !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["approvedDisbursementAmountNgn"],
        message: "The amount is fixed for this decision and must not be sent",
      });
    }
  });
export type LenderTrancheDecisionRequest = z.infer<
  typeof LenderTrancheDecisionRequestSchema
>;

export const ReverseTrancheDecisionRequestSchema = z.object({
  reason: z.string().trim().min(10).max(1500),
});
export type ReverseTrancheDecisionRequest = z.infer<
  typeof ReverseTrancheDecisionRequestSchema
>;

/**
 * 4. Immutable Hash-Chained Audit Ledger Entry DTO (Section 4.A Role 2)
 */
export const AuditLogEntryDtoSchema = z.object({
  id: z.string().uuid(),
  tenantId: z.string().uuid(),
  projectId: z.string().uuid().nullable(),
  seq: z.number().int().positive(),
  actorType: AuditActorTypeEnum,
  actorId: z.string(),
  actorDisplayName: z.string(),
  action: AuditActionTypeEnum,
  summaryText: z.string(),
  payload: z.record(z.unknown()),
  previousHash: z.string(),
  entryHash: z.string(),
  createdAt: z.string().datetime(),
});
export type AuditLogEntryDto = z.infer<typeof AuditLogEntryDtoSchema>;
