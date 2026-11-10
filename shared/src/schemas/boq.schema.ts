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
  trancheId: z.string().uuid().nullable().optional(),
});
export type BoqItemInput = z.infer<typeof BoqItemInputSchema>;

export const BoqItemDtoSchema = BoqItemInputSchema.extend({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  isOpaqueLumpSum: z.boolean(),
  opacityWarningReason: z.string().nullable(),
  aiSuggestedTrancheId: z.string().uuid().nullable(),
  trancheMappingConfirmedByMonitor: z.boolean(),
  cumulativeCertifiedPct: z.number().min(0).max(100),
});
export type BoqItemDto = z.infer<typeof BoqItemDtoSchema>;

/**
 * AI BOQ Hygiene & Tranche Mapping Output Schema (Used with Azure OpenAI GPT-4o Structured Outputs)
 */
export const AiBoqItemAnalysisSchema = z.object({
  wbsCode: z.string(),
  isOpaqueLumpSum: z.boolean(),
  opacityWarningReason: z.string().nullable(),
  recommendedIsHoldPoint: z.boolean(),
  recommendedHoldPointInstruction: z.string().nullable(),
  suggestedTrancheNumber: z.number().int().nullable(),
  mappingRationale: z.string(),
});
export type AiBoqItemAnalysis = z.infer<typeof AiBoqItemAnalysisSchema>;

export const AiBoqBatchAnalysisResponseSchema = z.object({
  items: z.array(AiBoqItemAnalysisSchema),
});
export type AiBoqBatchAnalysisResponse = z.infer<typeof AiBoqBatchAnalysisResponseSchema>;

/**
 * Monitor BOQ-to-Tranche & Hold-Point Confirmation Request
 */
export const UpdateBoqMappingsRequestSchema = z.object({
  updates: z
    .array(
      z.object({
        boqItemId: z.string().uuid(),
        trancheId: z.string().uuid().nullable(),
        isHoldPoint: z.boolean(),
        holdPointInstruction: z.string().max(400).nullable().optional(),
      })
    )
    .min(1),
});
export type UpdateBoqMappingsRequest = z.infer<typeof UpdateBoqMappingsRequestSchema>;

