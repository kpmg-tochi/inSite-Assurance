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
  isHoldPoint: z.boolean().default(false),
  holdPointInstruction: z.string().max(400).nullable().optional(), // e.g., "Photograph reinforcement & blinding prior to concrete pour"
});
export type BoqItemInput = z.infer<typeof BoqItemInputSchema>;

export const BoqItemDtoSchema = BoqItemInputSchema.extend({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  isOpaqueLumpSum: z.boolean(),
  opacityWarningReason: z.string().nullable(),
  /** Progress from counted reports (legacy name; redesign R1b, modules/progress). */
  cumulativeCertifiedPct: z.number().min(0).max(100),
  /** Contractor package (Phase 6). */
  projectContractorId: z.string().uuid().nullable().optional(),
  lastRevisionId: z.string().uuid().nullable().optional(),
  /** Manual brief override (Phase 9): PLAN_A | FALLBACK_BACKLOG | UNBLOCKED_POOL. */
  planningTier: z.string().optional(),
  /** Phase 9: planned window (YYYY-MM-DD, project zone); null until scheduled. */
  plannedStartDate: z.string().nullable().optional(),
  plannedEndDate: z.string().nullable().optional(),
  actualStartDate: z.string().nullable().optional(),
  actualCompletionDate: z.string().nullable().optional(),
});
export type BoqItemDto = z.infer<typeof BoqItemDtoSchema>;

/**
 * Monitor hold-point confirmation request
 */
export const UpdateBoqMappingsRequestSchema = z.object({
  updates: z
    .array(
      z.object({
        boqItemId: z.string().uuid(),
        isHoldPoint: z.boolean(),
        holdPointInstruction: z.string().max(400).nullable().optional(),
      })
    )
    .min(1),
});
export type UpdateBoqMappingsRequest = z.infer<typeof UpdateBoqMappingsRequestSchema>;

