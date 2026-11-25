import { z } from 'zod';
import { IncidentCategoryEnum, IncidentSeverityEnum, IncidentStatusEnum } from '../enums';
import { HeadingDegreesSchema } from './evidence.schema';

export const CreateIncidentReportRequestSchema = z.object({
  /** Client UUID; a repeat returns the existing incident (idempotent). */
  clientIncidentId: z.string().uuid(),
  // Ignored by the server: the project comes from the field session. Kept for client compatibility.
  projectId: z.string().uuid().optional(),
  category: IncidentCategoryEnum,
  severity: IncidentSeverityEnum.default('HIGH'),
  title: z.string().min(3).max(200),
  description: z.string().min(10).max(2000),
  isConfidentialWhistleblower: z.boolean().default(false),
  /** Object keys issued by presign for this project. URLs, file paths and data URIs are rejected. */
  photoEvidenceUrls: z.array(z.string()).max(10).default([]),
  voiceNoteUrl: z.string().nullable().optional(),
  deviceGpsCoordinates: z.object({
    latitude: z.number(),
    longitude: z.number(),
    accuracyMeters: z.number().optional(),
    /** UBEC IRL: compass heading of the incident photo (optional; stored with the coordinates). */
    headingDegrees: HeadingDegreesSchema.optional(),
  }).optional(),
});
export type CreateIncidentReportRequest = z.infer<typeof CreateIncidentReportRequestSchema>;

export const IncidentReportDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  // Null on confidential disclosures unless the viewer holds incidents:view_confidential.
  reporterSessionId: z.string().uuid().nullable(),
  reporterName: z.string(),
  reporterRoleName: z.string().nullable(),
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

export const UpdateIncidentStatusRequestSchema = z.object({
  status: IncidentStatusEnum,
});
export type UpdateIncidentStatusRequest = z.infer<
  typeof UpdateIncidentStatusRequestSchema
>;

