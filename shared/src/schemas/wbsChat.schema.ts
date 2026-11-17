import { z } from 'zod';
import {
  SubmissionGeotagSchema,
  WorkdayEvidenceItemSchema,
} from './workday.schema';

export const ReportQuerySourceEnum = z.enum([
  'MONITOR',
  'AI_OMISSION_CHECK',
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
  textContent: z.string().nullable().optional(),
  mediaUrls: z.array(z.string()).default([]),
  latitude: z.number().nullable().optional(),
  longitude: z.number().nullable().optional(),
  chainageLabel: z.string().nullable().optional(),
  queryDetails: ReportQueryDtoSchema.nullable().optional(),
  createdAt: z.string(),
});
export type WbsChatMessageDto = z.infer<typeof WbsChatMessageDtoSchema>;

export const CreateWbsChatMessageRequestSchema = z.object({
  workdayReportId: z.string().uuid().optional(),
  reportQueryId: z.string().uuid().optional(),
  messageType: WbsChatMessageTypeEnum.default('TEXT_COMMENT'),
  textContent: z.string().max(3000).optional(),
  mediaUrls: z.array(z.string()).default([]),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  chainageLabel: z.string().optional(),
});
export type CreateWbsChatMessageRequest = z.infer<
  typeof CreateWbsChatMessageRequestSchema
>;

export const RevalidateChatEntrySchema = z.object({
  senderName: z.string(),
  senderRole: z.string(),
  messageType: z.string(),
  textContent: z.string().optional(),
  caption: z.string().optional(),
  chainageLabel: z.string().optional(),
  timestamp: z.string().optional(),
});
export type RevalidateChatEntry = z.infer<typeof RevalidateChatEntrySchema>;

export const RevalidateWorkdayReportRequestSchema = z.object({
  reportQueryId: z.string().uuid().optional(),
  summaryText: z.string().max(3000).optional(),
  reportedQuantity: z.number().nonnegative().optional(),
  unitOfMeasure: z.string().optional(),
  delaysOrBlockers: z.string().optional(),
  isHoldPointClaimed: z.boolean().optional(),
  voiceNoteUrl: z.string().nullable().optional(),
  evidenceItems: z.array(WorkdayEvidenceItemSchema).default([]),
  chatMessages: z.array(RevalidateChatEntrySchema).default([]),
  submissionGeotag: SubmissionGeotagSchema.optional(),
});
export type RevalidateWorkdayReportRequest = z.infer<
  typeof RevalidateWorkdayReportRequestSchema
>;
