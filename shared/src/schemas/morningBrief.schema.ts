import { z } from 'zod';

export const PlanningTierEnum = z.enum([
  'PLAN_A',
  'FALLBACK_BACKLOG',
  'UNBLOCKED_POOL',
]);
export type PlanningTier = z.infer<typeof PlanningTierEnum>;

export const GenerateMorningBriefRequestSchema = z.object({
  workdayDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dailyTargetQuantity: z.number().nonnegative().optional(),
  expectedDeliverableOverride: z.string().max(1000).optional(),
});
export type GenerateMorningBriefRequest = z.infer<
  typeof GenerateMorningBriefRequestSchema
>;

export const MorningDeliverableBriefDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  boqItemId: z.string().uuid(),
  wbsCode: z.string(),
  wbsDescription: z.string(),
  workdayDate: z.string(),
  planningTier: PlanningTierEnum,
  headline: z.string(),
  expectedDeliverable: z.string(),
  reportingChecklist: z.array(z.string()),
  dailyTargetQuantity: z.number().nullable(),
  unit: z.string(),
  isHoldPoint: z.boolean(),
  holdPointInstruction: z.string().nullable(),
  generatedByAi: z.boolean(),
  createdAt: z.string().datetime(),
});
export type MorningDeliverableBriefDto = z.infer<
  typeof MorningDeliverableBriefDtoSchema
>;

