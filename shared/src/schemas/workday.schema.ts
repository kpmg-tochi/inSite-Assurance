import { z } from 'zod';
import { WorkdayReportStatusEnum } from '../enums';

export const WorkdayEvidenceItemSchema = z.object({
  id: z.string().uuid(),
  type: z.enum(['PHOTO', 'VOICE_NOTE', 'TEXT_NOTE']),
  mediaUrl: z.string().optional(),
  caption: z.string().optional(),
  gpsCoordinates: z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracyMeters: z.number().optional(),
  }).optional(),
  capturedAt: z.string().datetime(),
});
export type WorkdayEvidenceItem = z.infer<typeof WorkdayEvidenceItemSchema>;

export const SubmitWorkdayReportBundleSchema = z.object({
  localReportId: z.string(),
  projectId: z.string().uuid(),
  wbsItemId: z.string().uuid(),
  workdayDate: z.string(), // YYYY-MM-DD
  summaryText: z.string().min(5).max(3000),
  voiceNoteUrl: z.string().nullable().optional(),
  evidenceItems: z.array(WorkdayEvidenceItemSchema).default([]),
  reportedQuantity: z.number().nonnegative(),
  unitOfMeasure: z.string(),
  weatherConditions: z.string().optional(),
  workforceCount: z.number().int().nonnegative().optional(),
  delaysOrBlockers: z.string().optional(),
  isHoldPointClaimed: z.boolean().default(false),
});
export type SubmitWorkdayReportBundle = z.infer<typeof SubmitWorkdayReportBundleSchema>;

export const WorkdayReportDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  reporterSessionId: z.string().uuid(),
  wbsItemId: z.string().uuid(),
  workdayDate: z.string(),
  status: WorkdayReportStatusEnum,
  summaryText: z.string(),
  reportedQuantity: z.number(),
  unitOfMeasure: z.string(),
  isHoldPointClaimed: z.boolean(),
  evidenceItems: z.array(WorkdayEvidenceItemSchema),
  aiParsedConfidence: z.number().nullable().optional(),
  aiReasoning: z.string().nullable().optional(),
  humanConfirmedAt: z.string().datetime().nullable().optional(),
  createdAt: z.string().datetime(),
});
export type WorkdayReportDto = z.infer<typeof WorkdayReportDtoSchema>;

