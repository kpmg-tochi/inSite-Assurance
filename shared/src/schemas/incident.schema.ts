import { z } from 'zod';
import { IncidentCategoryEnum, IncidentSeverityEnum, IncidentStatusEnum } from '../enums';

export const CreateIncidentReportRequestSchema = z.object({
  projectId: z.string().uuid(),
  wbsItemId: z.string().uuid().nullable().optional(),
  category: IncidentCategoryEnum,
  severity: IncidentSeverityEnum.default('HIGH'),
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(2000),
  isConfidentialWhistleblower: z.boolean().default(false),
  photoEvidenceUrls: z.array(z.string()).default([]),
  voiceNoteUrl: z.string().nullable().optional(),
  deviceGpsCoordinates: z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracyMeters: z.number().optional(),
  }).optional(),
});
export type CreateIncidentReportRequest = z.infer<typeof CreateIncidentReportRequestSchema>;

export const IncidentReportDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  reporterSessionId: z.string().uuid(),
  reporterName: z.string(),
  reporterTier: z.string(),
  wbsItemId: z.string().uuid().nullable(),
  category: IncidentCategoryEnum,
  severity: IncidentSeverityEnum,
  title: z.string(),
  description: z.string(),
  isConfidentialWhistleblower: z.boolean(),
  status: IncidentStatusEnum,
  photoEvidenceUrls: z.array(z.string()),
  voiceNoteUrl: z.string().nullable(),
  deviceGpsCoordinates: z.any().nullable(),
  createdAt: z.string().datetime(),
  resolvedAt: z.string().datetime().nullable(),
});
export type IncidentReportDto = z.infer<typeof IncidentReportDtoSchema>;

