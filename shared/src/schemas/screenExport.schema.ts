import { z } from 'zod';
import { VisitKindEnum } from './form.schema';
import { VisitStatusEnum } from './visit.schema';
import { InspectionFindingStatusEnum } from './inspection.schema';
import { PaymentKindEnum } from './payment.schema';

/**
 * UBEC IRL: Excel exports of the visits, findings and payments screens (and the KPI page, which
 * reuses `KpiQuerySchema`). Each query mirrors the filters its screen offers, so the file holds the
 * rows the user sees. Query strings only: empty values are left out by the client.
 */

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** A comma-separated list of visit statuses (the screen's "Open visits" sends every open status). */
const VisitStatusList = z
  .string()
  .max(200)
  .refine((s) => s.split(',').every((x) => VisitStatusEnum.safeParse(x).success), { message: 'Unknown monitoring visit status' });

/** GET /projects/:id/visits/export.xlsx (the project's Visits tab). */
export const ProjectVisitsExportQuerySchema = z
  .object({
    from: IsoDate.optional(),
    to: IsoDate.optional(),
    status: VisitStatusList.optional(),
    visitKind: VisitKindEnum.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'The period must start before it ends', path: ['to'] });
export type ProjectVisitsExportQuery = z.infer<typeof ProjectVisitsExportQuerySchema>;

/** GET /visits/export.xlsx (the planner: its period and filters; cancelled visits left out as on screen). */
export const PlannerVisitsExportQuerySchema = z
  .object({
    from: IsoDate.optional(),
    to: IsoDate.optional(),
    regionId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    officerId: z.string().uuid().optional(),
    visitKind: VisitKindEnum.optional(),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, { message: 'The period must start before it ends', path: ['to'] });
export type PlannerVisitsExportQuery = z.infer<typeof PlannerVisitsExportQuerySchema>;

/** GET /projects/:id/findings/export.xlsx (the Findings tab; status as the list endpoint takes it). */
export const FindingsExportQuerySchema = z.object({
  status: InspectionFindingStatusEnum.optional(),
});
export type FindingsExportQuery = z.infer<typeof FindingsExportQuerySchema>;

/** GET /projects/:id/payments/export.xlsx (the payment record's search and filters). */
export const PaymentsExportQuerySchema = z.object({
  /** Matches the reference or the description, case-insensitive. */
  search: z.string().max(200).optional(),
  kind: PaymentKindEnum.optional(),
  /** A sprint id, or "none" for payments that name no sprint. */
  sprint: z.union([z.literal('none'), z.string().uuid()]).optional(),
  /** "true": live payments with at least one exception. */
  exceptionsOnly: z.enum(['true', 'false']).optional(),
  /** Client demo updates G.1: paid on or after / on or before (inclusive, YYYY-MM-DD). */
  from: IsoDate.optional(),
  to: IsoDate.optional(),
});
export type PaymentsExportQuery = z.infer<typeof PaymentsExportQuerySchema>;

/** GET /projects/:id/payments (G.1: the list filters move to the server; every key optional, as before). */
export const ProjectPaymentsQuerySchema = PaymentsExportQuerySchema;
export type ProjectPaymentsQuery = PaymentsExportQuery;
