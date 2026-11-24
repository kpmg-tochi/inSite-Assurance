import { z } from 'zod';

/**
 * Bill of Quantities (BOQ) Work Item Schema (Section 4.A Role 1)
 */
export const BoqItemInputSchema = z.object({
  wbsCode: z.string().min(1).max(32),     // e.g., "02.03.1"
  section: z.string().min(1).max(160),    // e.g., "BILL NO. 2 — DRAINAGE & CULVERTS"
  description: z.string().min(3).max(600),// e.g., "Provide and cast Grade 25 concrete in 900mmx900mm box culvert"
  unit: z.string().min(1).max(32),        // e.g., "m3", "m", "tons", "bags", "item", "LS"
  totalQuantity: z.number().positive(),
  rateNgn: z.number().nonnegative(),
  budgetedCostNgn: z.number().nonnegative(),
});
export type BoqItemInput = z.infer<typeof BoqItemInputSchema>;

export const BoqItemDtoSchema = BoqItemInputSchema.extend({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  isOpaqueLumpSum: z.boolean(),
  opacityWarningReason: z.string().nullable(),
  /** Line progress (legacy name): from its unit's accepted visits; lines without unit progress keep the stored value (R5f). */
  cumulativeCertifiedPct: z.number().min(0).max(100),
  lastRevisionId: z.string().uuid().nullable().optional(),
  /** Phase 9: planned window (YYYY-MM-DD, project zone); null until scheduled. */
  plannedStartDate: z.string().nullable().optional(),
  plannedEndDate: z.string().nullable().optional(),
  actualStartDate: z.string().nullable().optional(),
  actualCompletionDate: z.string().nullable().optional(),
});
export type BoqItemDto = z.infer<typeof BoqItemDtoSchema>;
