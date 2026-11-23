import { z } from 'zod';

/**
 * Payment record (redesign R1b). Contractor payments are made outside the platform (later fed by
 * the client's ERP). The platform records them, holds retention against them and flags exceptions;
 * it never blocks a payment it does not make. A wrong entry is voided with a reason, never deleted.
 */

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const PaymentKindEnum = z.enum(['INTERIM', 'FINAL', 'RETENTION_RELEASE']);
export type PaymentKind = z.infer<typeof PaymentKindEnum>;

export const PAYMENT_KIND_LABELS: Record<PaymentKind, string> = {
  INTERIM: 'Interim payment',
  FINAL: 'Final payment',
  RETENTION_RELEASE: 'Retention release',
};

export const PaymentSourceEnum = z.enum(['MANUAL', 'ERP']);
export type PaymentSource = z.infer<typeof PaymentSourceEnum>;

/** Recorded with the payment; shown on the payment and counted on the dashboard. */
export const PaymentExceptionEnum = z.enum([
  'FINAL_BEFORE_COC',
  'RETENTION_RELEASE_BEFORE_COC',
  'RETENTION_RELEASE_BEFORE_PERIOD_END',
  'RETENTION_RELEASE_WITH_OPEN_DEFECTS',
  'PAID_ABOVE_CONTRACT_SUM',
]);
export type PaymentException = z.infer<typeof PaymentExceptionEnum>;

export const PAYMENT_EXCEPTION_LABELS: Record<PaymentException, string> = {
  FINAL_BEFORE_COC: 'Final payment recorded before the Certificate of Completion was issued',
  RETENTION_RELEASE_BEFORE_COC: 'Retention released before the Certificate of Completion was issued',
  RETENTION_RELEASE_BEFORE_PERIOD_END: 'Retention released before the defects liability period ended',
  RETENTION_RELEASE_WITH_OPEN_DEFECTS: 'Retention released while defects were still open',
  PAID_ABOVE_CONTRACT_SUM: 'Total paid is above the contract sum',
};

export const RecordPaymentRequestSchema = z
  .object({
    kind: PaymentKindEnum,
    paidOn: IsoDate,
    grossAmountNgn: z.number().positive('Enter the amount paid').max(1e13),
    /** Omit to hold gross x the project's retention percentage. Ignored for a retention release. */
    retentionHeldNgn: z.number().nonnegative().max(1e13).nullable().optional(),
    retentionOverrideReason: z.string().trim().max(500).nullable().optional(),
    reference: z.string().trim().min(1, 'Enter the payment reference').max(120),
    description: z.string().trim().max(500).nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.retentionHeldNgn != null && v.retentionHeldNgn > v.grossAmountNgn) {
      ctx.addIssue({ code: 'custom', path: ['retentionHeldNgn'], message: 'Retention held cannot be more than the amount paid' });
    }
  });
export type RecordPaymentRequest = z.infer<typeof RecordPaymentRequestSchema>;

export const VoidPaymentRequestSchema = z.object({
  reason: z.string().trim().min(5, 'Say why this payment is being voided').max(500),
});
export type VoidPaymentRequest = z.infer<typeof VoidPaymentRequestSchema>;

export const PaymentDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  kind: PaymentKindEnum,
  paidOn: z.string(),
  grossAmountNgn: z.number(),
  retentionHeldNgn: z.number(),
  netAmountNgn: z.number(),
  retentionOverrideReason: z.string().nullable(),
  reference: z.string(),
  description: z.string().nullable(),
  source: PaymentSourceEnum,
  externalReference: z.string().nullable(),
  exceptions: z.array(PaymentExceptionEnum),
  recordedByName: z.string(),
  recordedAt: z.string(),
  voided: z.boolean(),
  voidedAt: z.string().nullable(),
  voidedByName: z.string().nullable(),
  voidReason: z.string().nullable(),
});
export type PaymentDto = z.infer<typeof PaymentDtoSchema>;

export const ProjectPaymentsSummaryDtoSchema = z.object({
  projectId: z.string().uuid(),
  contractSumNgn: z.number().nullable(),
  /** Gross of every payment that is not voided and not a retention release. */
  paidGrossNgn: z.number(),
  /** Net paid to the contractor, retention releases included. */
  paidNetNgn: z.number(),
  retentionPercentage: z.number().nullable(),
  retentionHeldNgn: z.number(),
  retentionReleasedNgn: z.number(),
  retentionBalanceNgn: z.number(),
  retentionPeriodEnd: z.string().nullable(),
  cocIssued: z.boolean(),
  openDefects: z.number().int(),
  exceptionCount: z.number().int(),
  canRecord: z.boolean(),
  payments: z.array(PaymentDtoSchema),
});
export type ProjectPaymentsSummaryDto = z.infer<typeof ProjectPaymentsSummaryDtoSchema>;

/**
 * Project type defaults for payments (the "payments" key of ProjectTypeConfig). Pre-fills the
 * retention settings of a new project; values already saved on the project are kept.
 */
export const ProjectTypePaymentsConfigSchema = z
  .object({
    retentionPercentage: z.number().min(0).max(20).nullable().default(null),
    retentionDurationMonths: z.number().int().min(0).max(60).nullable().default(null),
  })
  .default({});
export type ProjectTypePaymentsConfig = z.infer<typeof ProjectTypePaymentsConfigSchema>;
