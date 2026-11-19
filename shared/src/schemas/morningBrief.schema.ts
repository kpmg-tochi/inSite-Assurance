import { z } from 'zod';
import { BriefPersonaEnum } from '../enums';
import { AppliedStandardSchema } from './standards.schema';

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
  /**
   * Web callers may ask for either persona (Phase 7). Field callers always get their own session's
   * persona; a request for the other one is ignored.
   */
  targetPersona: BriefPersonaEnum.optional(),
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
  /** Who the brief is written for (Phase 7): an inspector never gets execution instructions. */
  targetPersona: BriefPersonaEnum,
  /** Project standards that apply to this item, passed to the model as reference data. */
  appliedStandards: z.array(AppliedStandardSchema),
  createdAt: z.string().datetime(),
});
export type MorningDeliverableBriefDto = z.infer<
  typeof MorningDeliverableBriefDtoSchema
>;

