import { z } from 'zod';
import { ProjectListFiltersSchema } from './deliveryModel.schema';
import { PaymentExceptionEnum, PaymentKindEnum } from './payment.schema';
import { NigeriaZoneCodeEnum } from '../data/nigeriaAdminAreas';

/**
 * Client demo updates G: payments by period and across the programme.
 * - The period is resolved in the browser with `periodRange` (utils/fiscalYear.ts) and sent as
 *   `from` / `to` (inclusive, by `paidOn`); the server never interprets presets.
 * - `GET /api/v1/payments` (list, paged), `/payments/summary` (cards) and `/payments/export.xlsx`
 *   share `PortfolioPaymentsQuerySchema`; `payments:view`; the directory's visibility rule (a SUBEB
 *   sees its own projects); ACTIVE and ARCHIVED projects.
 */

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Period only (both screens). */
export const PaymentPeriodQuerySchema = z.object({
  from: IsoDate.optional(),
  to: IsoDate.optional(),
});
export type PaymentPeriodQuery = z.infer<typeof PaymentPeriodQuerySchema>;

export const PortfolioPaymentsQuerySchema = ProjectListFiltersSchema.merge(PaymentPeriodQuerySchema).extend({
  projectId: z.string().uuid().optional(),
  kind: PaymentKindEnum.optional(),
  /** "true": payments with at least one exception. */
  exceptionsOnly: z.enum(['true', 'false']).optional(),
  /** "true": voided payments are listed too (never counted in totals). */
  includeVoided: z.enum(['true', 'false']).optional(),
  /** Matches the reference, description, project name or code. */
  search: z.string().trim().max(200).optional(),
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
});
export type PortfolioPaymentsQuery = z.infer<typeof PortfolioPaymentsQuerySchema>;

export const PortfolioPaymentRowDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  /** Stored code; show with `formatProjectCode`. */
  projectCode: z.string(),
  projectName: z.string(),
  interventionYear: z.number().int().nullable(),
  stateCode: z.string().nullable(),
  /** State name (or the project's state text on older projects). */
  stateName: z.string().nullable(),
  zone: NigeriaZoneCodeEnum.nullable(),
  contractorName: z.string().nullable(),
  kind: PaymentKindEnum,
  paidOn: z.string(),
  reference: z.string(),
  grossAmountNgn: z.number(),
  retentionHeldNgn: z.number(),
  netAmountNgn: z.number(),
  exceptions: z.array(PaymentExceptionEnum),
  voided: z.boolean(),
});
export type PortfolioPaymentRowDto = z.infer<typeof PortfolioPaymentRowDtoSchema>;

export const PortfolioPaymentsListDtoSchema = z.object({
  rows: z.array(PortfolioPaymentRowDtoSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type PortfolioPaymentsListDto = z.infer<typeof PortfolioPaymentsListDtoSchema>;

export const PortfolioPaymentsSummaryDtoSchema = z.object({
  /** The period applied (echo of the query). */
  from: z.string().nullable(),
  to: z.string().nullable(),
  /** For the period filter: today in the tenant zone and the tenant's fiscal year start. */
  today: z.string(),
  fiscalYearStartMonth: z.number().int(),
  /** Payments in the period (voided excluded). Gross excludes retention releases, as on the project page. */
  grossPaidNgn: z.number(),
  retentionHeldNgn: z.number(),
  retentionReleasedNgn: z.number(),
  /** Net paid to contractors, retention releases included. */
  netPaidNgn: z.number(),
  paymentCount: z.number().int(),
  exceptionCount: z.number().int(),
  /** Projects with at least one payment in the period. */
  projectCount: z.number().int(),
  /**
   * Money against progress, to date, over the projects matching the project filters (not the
   * period): paid to date (net) vs contract sum, and the contract-sum-weighted % complete.
   */
  moneyVsProgress: z.object({
    projectCount: z.number().int(),
    contractSumNgn: z.number(),
    paidToDateNgn: z.number(),
    /** null when no project has a contract sum. */
    paidPct: z.number().nullable(),
    progressPct: z.number().nullable(),
  }),
});
export type PortfolioPaymentsSummaryDto = z.infer<typeof PortfolioPaymentsSummaryDtoSchema>;
