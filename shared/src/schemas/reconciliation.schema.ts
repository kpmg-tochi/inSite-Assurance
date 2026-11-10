import { z } from 'zod';
import {
  AuditActionTypeEnum,
  AuditActorTypeEnum,
  EvidenceStrengthRatingEnum,
  IndependenceTierEnum,
  LenderDecisionTypeEnum,
  MonitorRecommendationEnum,
} from '../enums';

/**
 * 1. Azure OpenAI GPT-4o Structured Output Schema for BOQ Line-Item Reconciliation
 * Evaluates field evidence logs + independence tiers + hold-point compliance against IPC claim.
 */
export const AiLineItemReconciliationResultSchema = z.object({
  boqItemId: z.string(),
  evidenceStrengthRating: EvidenceStrengthRatingEnum,
  aiRationale: z.string(), // Concise audit-ready explanation of how field proof compares to IPC claim
  visitPlannerFlag: z.boolean(),
  visitPlannerReason: z.string().nullable(), // e.g., "High-value claim (₦48M) backed exclusively by CONTRACTOR_ENGINEER self-report"
  missingHoldPointFlag: z.boolean(),
  highestCorroboratingTier: IndependenceTierEnum.nullable(),
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
 * 2. Monitor Valuation Certification & Disbursement Evidence Report Sign-Off (Section 4.A Role 1)
 * Crucially, human Monitor (QS / COREN Engineer) legally certifies the valuation.
 */
export const MonitorLineItemValuationInputSchema = z.object({
  ipcLineItemId: z.string().uuid(),
  monitorCertifiedCumulativePct: z.number().min(0).max(100),
  monitorCertifiedAmountNgn: z.number().nonnegative(),
  monitorRemarks: z.string().max(800).optional(),
});
export type MonitorLineItemValuationInput = z.infer<
  typeof MonitorLineItemValuationInputSchema
>;

export const CertifyIpcValuationRequestSchema = z.object({
  lineValuations: z.array(MonitorLineItemValuationInputSchema).min(1),
  trancheRecommendation: MonitorRecommendationEnum,
  recommendedReleaseAmountNgn: z.number().nonnegative(),
  recommendedHoldbackAmountNgn: z.number().nonnegative(),
  executiveCertificationSummary: z.string().min(10).max(3000),
  certifierFullName: z.string().min(2).max(120),
  certifierLicenseNumber: z.string().min(2).max(64), // e.g., "QSRBN Reg. No. 3842" or "COREN R.49201"
  certifierDigitalSignatureAck: z.literal(true),
});
export type CertifyIpcValuationRequest = z.infer<
  typeof CertifyIpcValuationRequestSchema
>;

/**
 * 3. Lender / Guarantor Tranche Disbursement Decision (Section 4.A Role 2)
 */
export const LenderTrancheDecisionRequestSchema = z.object({
  valuationReportId: z.string().uuid(),
  decision: LenderDecisionTypeEnum,
  approvedDisbursementAmountNgn: z.number().nonnegative(),
  heldBackAmountNgn: z.number().nonnegative(),
  creditCommitteeReference: z.string().max(120).optional(),
  approverNotes: z.string().max(1500).optional(),
});
export type LenderTrancheDecisionRequest = z.infer<
  typeof LenderTrancheDecisionRequestSchema
>;

/**
 * 4. Immutable Hash-Chained Audit Ledger Entry DTO (Section 4.A Role 2)
 */
export const AuditLogEntryDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
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

