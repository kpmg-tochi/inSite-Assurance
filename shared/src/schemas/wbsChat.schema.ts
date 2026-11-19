import { z } from 'zod';
import { StandardsViolationItemSchema } from './standards.schema';

/** Where a report query came from (Phase 7: an enum in the database, plus the standards check). */
export const ReportQuerySourceEnum = z.enum([
  'MONITOR',
  'AI_OMISSION_CHECK',
  'AI_STANDARDS_CHECK',
]);
export type ReportQuerySource = z.infer<typeof ReportQuerySourceEnum>;

export const ReportQueryStatusEnum = z.enum([
  'OPEN',
  'RESUBMITTED',
  'RESOLVED',
]);
export type ReportQueryStatus = z.infer<typeof ReportQueryStatusEnum>;

export const AiOmissionPayloadSchema = z.object({
  omittedItems: z.array(z.string()),
  expectedRequirement: z.string(),
  reasonProvidedInReport: z.boolean(),
  clarificationQuestion: z.string(),
});
export type AiOmissionPayload = z.infer<typeof AiOmissionPayloadSchema>;

export const ReportQueryDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  boqItemId: z.string().uuid(),
  workdayReportId: z.string().uuid().nullable().optional(),
  ipcLineItemId: z.string().uuid().nullable().optional(),
  source: ReportQuerySourceEnum,
  status: ReportQueryStatusEnum,
  monitorComment: z.string().nullable().optional(),
  aiOmissionPayload: AiOmissionPayloadSchema.nullable().optional(),
  /** AI_STANDARDS_CHECK queries: the standards the report did not show it met (Phase 7). */
  standardsViolations: z.array(StandardsViolationItemSchema).nullable().optional(),
  raisedByUserId: z.string().uuid().nullable().optional(),
  raisedByName: z.string().nullable().optional(),
  createdAt: z.string(),
  respondedAt: z.string().nullable().optional(),
  resolvedAt: z.string().nullable().optional(),
});
export type ReportQueryDto = z.infer<typeof ReportQueryDtoSchema>;

export const CreateWorkdayReportQueryRequestSchema = z.object({
  queryText: z.string().trim().min(5).max(1500),
});
export type CreateWorkdayReportQueryRequest = z.infer<
  typeof CreateWorkdayReportQueryRequestSchema
>;

export const WbsChatMessageTypeEnum = z.enum([
  'AI_QUERY',
  'MONITOR_QUERY',
  'QUERY_RESPONSE',
  'TEXT_COMMENT',
  'PHOTO',
  'VOICE_NOTE',
  'MORNING_BRIEF',
  'EOD_PROMPT',
]);
export type WbsChatMessageType = z.infer<typeof WbsChatMessageTypeEnum>;

export const WbsChatMessageDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  boqItemId: z.string().uuid(),
  workdayReportId: z.string().uuid().nullable().optional(),
  reportQueryId: z.string().uuid().nullable().optional(),
  fieldSessionId: z.string().uuid().nullable().optional(),
  senderName: z.string(),
  senderRole: z.string(),
  messageType: WbsChatMessageTypeEnum,
  clientMessageId: z.string().uuid().nullable().optional(),
  /** Field session that sent the message, if a field agent sent it. */
  senderSessionId: z.string().uuid().nullable().optional(),
  /** Web user that sent the message, if a web user sent it. */
  senderUserId: z.string().uuid().nullable().optional(),
  textContent: z.string().nullable().optional(),
  /** The registered capture shown in this message (photo or voice note). */
  capture: z
    .object({
      clientCaptureId: z.string().uuid(),
      mediaType: z.string(),
      objectKey: z.string(),
      mimeType: z.string(),
      durationSeconds: z.number().nullable(),
    })
    .nullable()
    .optional(),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  chainageLabel: z.string().nullable().optional(),
  queryDetails: ReportQueryDtoSchema.nullable().optional(),
  createdAt: z.string(),
});
export type WbsChatMessageDto = z.infer<typeof WbsChatMessageDtoSchema>;

export const CreateWbsChatMessageRequestSchema = z
  .object({
    /** Client UUID; a repeat returns the existing message (idempotent). Required from devices. */
    clientMessageId: z.string().uuid().optional(),
    workdayReportId: z.string().uuid().optional(),
    reportQueryId: z.string().uuid().optional(),
    messageType: WbsChatMessageTypeEnum.default('TEXT_COMMENT'),
    textContent: z.string().max(3000).optional(),
    /** Client capture ID of an already registered capture. Media is never sent inline. */
    captureId: z.string().uuid().optional(),
  })
  .strict();
export type CreateWbsChatMessageRequest = z.infer<
  typeof CreateWbsChatMessageRequestSchema
>;

/**
 * POST /projects/:projectId/report-queries/:queryId/resolve
 * A monitor closes a workday-report query (after the reporter's revision, or to withdraw it).
 * Once resolved, the report cannot be revised again unless a new query is raised.
 */
export const ResolveReportQueryRequestSchema = z.object({
  resolutionNote: z.string().trim().max(1000).optional(),
});
export type ResolveReportQueryRequest = z.infer<typeof ResolveReportQueryRequestSchema>;
