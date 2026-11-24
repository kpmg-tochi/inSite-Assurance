import { z } from 'zod';

export const MobileNotificationTypeEnum = z.enum([
  'BACKLOG_REVIEW_REQUIRED',
  'REPORT_QUERY',
  'HOLD_POINT_ALERT',
  // Phase 8
  'REPORT_OVERDUE',
  // Phase 10
  'DEFECT_UPDATE',
  // Phase 14
  'INSPECTION_FINDING',
]);
export type MobileNotificationType = z.infer<typeof MobileNotificationTypeEnum>;

export const NotificationActionTypeEnum = z.enum([
  'NONE',
  'OPEN_REPORT_SUMMARY',
  'OPEN_WBS_CHAT',
  'OPEN_BACKLOG_REVIEW',
  // Phase 10
  'OPEN_DEFECTS',
  // Phase 14
  'OPEN_INSPECTION_FINDINGS',
]);
export type NotificationActionType = z.infer<typeof NotificationActionTypeEnum>;

export const MobileNotificationMetadataSchema = z
  .object({
    wbsItemId: z.string().uuid().optional(),
    wbsCode: z.string().optional(),
    workdayReportId: z.string().optional(),
    monitorQueryId: z.string().optional(),
    reportQueryId: z.string().uuid().optional(),
    querySource: z.string().optional(),
    aiOmissionPayload: z.record(z.string(), z.unknown()).optional(),
    draftSummary: z.string().optional(),
    draftQuantity: z.number().optional(),
    unit: z.string().optional(),
    requestedProofTypes: z.array(z.string()).optional(),
    /** Phase 10: the defect ticket a DEFECT_UPDATE is about. */
    defectTicketId: z.string().uuid().optional(),
    /** Phase 14: the inspection finding an INSPECTION_FINDING is about. */
    inspectionFindingId: z.string().uuid().optional(),
  })
  .passthrough();
export type MobileNotificationMetadata = z.infer<
  typeof MobileNotificationMetadataSchema
>;

export const MobileNotificationDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  fieldSessionId: z.string().uuid().nullable().optional(),
  type: MobileNotificationTypeEnum,
  actionType: NotificationActionTypeEnum,
  requiresAction: z.boolean(),
  title: z.string(),
  message: z.string(),
  metadata: MobileNotificationMetadataSchema.default({}),
  /** Read by the viewer, or completed by anyone (an actioned notification no longer counts as unread). */
  isRead: z.boolean(),
  readAt: z.string().nullable().optional(),
  /** Set when anyone on the project completed the required action (Phase 5 Step 8). */
  actionedAt: z.string().nullable().optional(),
  actionedByName: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type MobileNotificationDto = z.infer<typeof MobileNotificationDtoSchema>;

export const WebNotificationCategoryEnum = z.enum([
  'REPORT_RESUBMITTED',
  'CONTRACTOR_ONBOARDING',
  'MONITOR_QUERY',
  'AI_OMISSION_FLAG',
  // Phase 7
  'STANDARDS_VIOLATION_FLAGGED',
  'REPORT_PENDING_APPROVAL',
  // Phase 8
  'REPORT_MISSED',
  // Phase 9 (redesign R2d: sprints decide it)
  'SCHEDULE_BEHIND',
  // Phase 10
  'HANDOVER_RECORDED',
  'DEFECT_TICKET',
  // Phase 14
  'INSPECTION_PENDING_APPROVAL',
  'INSPECTION_FINDING',
  'INSPECTION_MISSED',
  // Phase 13
  'CONTRACT_MILESTONE',
  'CONTRACT_DEFAULT_CASE',
  'DOCUMENT_SIGN_OFF',
  // Phase 15
  'COMPLETION_CERTIFICATE',
  'CLOSURE',
  'LESSON_SHARED',
  // Redesign R1b: a payment recorded with an exception (e.g. final payment before the CoC)
  'PAYMENT_EXCEPTION',
]);
export type WebNotificationCategory = z.infer<typeof WebNotificationCategoryEnum>;

export const WebNotificationDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  targetPermissionKey: z.string(),
  targetRoleId: z.string().uuid().nullable().optional(),
  category: WebNotificationCategoryEnum,
  title: z.string(),
  description: z.string(),
  actionUrl: z.string().nullable().optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  isRead: z.boolean(),
  readAt: z.string().nullable().optional(),
  createdAt: z.string(),
});
export type WebNotificationDto = z.infer<typeof WebNotificationDtoSchema>;
