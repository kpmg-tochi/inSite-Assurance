import { z } from 'zod';
import {
  TranscriptionStatusEnum,
  WorkdayAiCheckStatusEnum,
  WorkdayReportStatusEnum,
} from '../enums';
import { CaptureDtoSchema, DeviceSignatureSchema, ExtractedQuantityItemSchema } from './evidence.schema';
import { CALENDAR_DATE_REGEX } from '../utils/time';
import { ReportQueryDtoSchema } from './wbsChat.schema';

/** A text-only note typed into the WBS thread and included in the report. */
export const WorkdayTextNoteSchema = z.object({
  id: z.string().uuid(),
  text: z.string().min(1).max(2000),
  capturedAt: z.string().datetime(),
});
export type WorkdayTextNote = z.infer<typeof WorkdayTextNoteSchema>;

/** Device position when the reporter confirmed the report. The server evaluates the geofence. */
export const SubmissionGeotagInputSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().nonnegative().nullable().optional(),
  altitudeMeters: z.number().nullable().optional(),
  isMocked: z.boolean().default(false),
  capturedAt: z.string().datetime(),
});
export type SubmissionGeotagInput = z.infer<typeof SubmissionGeotagInputSchema>;

/** Stored and returned geotag: input plus the server's geofence result. */
export const SubmissionGeotagSchema = SubmissionGeotagInputSchema.extend({
  isWithinGeofence: z.boolean().nullable(),
  chainageLabel: z.string().nullable(),
  distanceFromSiteMeters: z.number().nonnegative().nullable(),
});
export type SubmissionGeotag = z.infer<typeof SubmissionGeotagSchema>;

const ReportBodyFields = {
  /** Client UUID; the server treats a repeat as the same report (idempotent). */
  clientReportId: z.string().uuid(),
  reporterTimezone: z.string().min(1).max(64),
  delaysOrBlockers: z.string().max(2000).nullable().optional(),
  clientCaptureIds: z.array(z.string().uuid()).max(50).default([]),
  textNotes: z.array(WorkdayTextNoteSchema).max(50).default([]),
  /** Required: every report carries the device position when it was confirmed. */
  submissionGeotag: SubmissionGeotagInputSchema,
  /** When the reporter tapped confirm on the device. */
  confirmedAt: z.string().datetime(),
  /**
   * The reporter confirmed this is their full report for the period. A report is submitted once per
   * reporter, WBS item and period; after that only a revision answering an open query is accepted.
   */
  confirmedAsFinal: z.literal(true, {
    errorMap: () => ({ message: 'Confirm that this is your full report for the period' }),
  }),
  signature: DeviceSignatureSchema.nullable().optional(),
};

/**
 * POST /projects/:projectId/workday-reports
 * The human-confirmed end-of-day statement for one WBS item, linking registered captures.
 */
export const SubmitWorkdayReportRequestSchema = z.object({
  ...ReportBodyFields,
  wbsItemId: z.string().uuid(),
  workdayDate: z.string().regex(CALENDAR_DATE_REGEX, 'workdayDate must be YYYY-MM-DD'),
  summaryText: z.string().trim().min(5).max(3000),
  reportedQuantity: z.number().nonnegative(),
  unitOfMeasure: z.string().trim().min(1).max(32),
  isHoldPointClaimed: z.boolean().default(false),
});
export type SubmitWorkdayReportRequest = z.infer<typeof SubmitWorkdayReportRequestSchema>;

/**
 * POST /projects/:projectId/workday-reports/:reportId/revalidate
 * A new revision answering a query. Omitted fields keep the previous revision's values.
 */
export const RevalidateWorkdayReportRequestSchema = z.object({
  ...ReportBodyFields,
  reportQueryId: z.string().uuid().optional(),
  summaryText: z.string().trim().min(5).max(3000).optional(),
  reportedQuantity: z.number().nonnegative().optional(),
  unitOfMeasure: z.string().trim().min(1).max(32).optional(),
  isHoldPointClaimed: z.boolean().optional(),
});
export type RevalidateWorkdayReportRequest = z.infer<typeof RevalidateWorkdayReportRequestSchema>;

export const WorkdayReportCaptureSummarySchema = CaptureDtoSchema.pick({
  id: true,
  clientCaptureId: true,
  mediaType: true,
  objectKey: true,
  mimeType: true,
  caption: true,
  capturedAt: true,
  locationAvailable: true,
  latitude: true,
  longitude: true,
  gpsAccuracyMeters: true,
  isMockLocation: true,
  isWithinGeofence: true,
  chainageLabel: true,
  signatureVerified: true,
  integrityPassed: true,
  integrityFlags: true,
  transcriptionStatus: true,
  transcript: true,
  durationSeconds: true,
});
export type WorkdayReportCaptureSummary = z.infer<typeof WorkdayReportCaptureSummarySchema>;

export const WorkdayReportDtoSchema = z.object({
  id: z.string().uuid(),
  clientReportId: z.string().uuid(),
  projectId: z.string().uuid(),
  reporterSessionId: z.string().uuid(),
  reporterName: z.string(),
  reporterTier: z.string(),
  wbsItemId: z.string().uuid(),
  wbsCode: z.string(),
  wbsDescription: z.string(),
  workdayDate: z.string(),
  reporterTimezone: z.string(),
  status: WorkdayReportStatusEnum,
  revisionNumber: z.number().int(),
  parentReportId: z.string().uuid().nullable(),
  resolvedQueryId: z.string().uuid().nullable(),
  summaryText: z.string(),
  reportedQuantity: z.number(),
  unitOfMeasure: z.string(),
  isHoldPointClaimed: z.boolean(),
  delaysOrBlockers: z.string().nullable(),
  textNotes: z.array(WorkdayTextNoteSchema),
  captures: z.array(WorkdayReportCaptureSummarySchema),
  submissionGeotag: SubmissionGeotagSchema.nullable(),
  /**
   * Location and integrity notes on the report itself, e.g. LOW_GPS_ACCURACY,
   * OUTSIDE_PROJECT_GEOFENCE, MOCK_GPS_LOCATION_DETECTED, UNSIGNED. Shown as badges.
   */
  integrityFlags: z.array(z.string()),
  signatureVerified: z.boolean().nullable(),
  aiCheckStatus: WorkdayAiCheckStatusEnum,
  aiCheckEngine: z.string().nullable(),
  aiReasoning: z.string().nullable(),
  humanConfirmedAt: z.string().datetime().nullable(),
  releasedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  queries: z.array(ReportQueryDtoSchema).default([]),
  /** True when this response is a replay of an earlier identical submission. */
  idempotentReplay: z.boolean().optional(),
});
export type WorkdayReportDto = z.infer<typeof WorkdayReportDtoSchema>;

/**
 * POST /projects/:projectId/workday-reports/suggest
 * Optional assist for the summary sheet: transcripts of voice captures plus a suggested quantity.
 * Never stored as evidence; the reporter confirms or edits before submitting.
 */
export const SuggestWorkdaySummaryRequestSchema = z.object({
  wbsItemId: z.string().uuid(),
  clientCaptureIds: z.array(z.string().uuid()).max(50).default([]),
  textNotes: z.array(z.string().max(2000)).max(50).default([]),
});
export type SuggestWorkdaySummaryRequest = z.infer<typeof SuggestWorkdaySummaryRequestSchema>;

export const SuggestionEngineEnum = z.enum(['AZURE_OPENAI', 'RULES', 'SIMULATED_DEMO']);
export type SuggestionEngine = z.infer<typeof SuggestionEngineEnum>;

export const SuggestWorkdaySummaryResponseSchema = z.object({
  transcripts: z.array(
    z.object({
      clientCaptureId: z.string().uuid(),
      transcriptionStatus: TranscriptionStatusEnum,
      transcript: z.string().nullable(),
      engine: z.string().nullable(),
    })
  ),
  suggestion: z
    .object({
      summary: z.string(),
      quantities: z.array(ExtractedQuantityItemSchema),
      blockers: z.array(z.string()),
      engine: SuggestionEngineEnum,
    })
    .nullable(),
  /** Why no suggestion was produced, when `suggestion` is null. */
  unavailableReason: z.string().nullable(),
});
export type SuggestWorkdaySummaryResponse = z.infer<typeof SuggestWorkdaySummaryResponseSchema>;
