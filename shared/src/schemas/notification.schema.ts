import { z } from 'zod';
import { ProjectAlertKeyEnum } from './projectAlert.schema';

export const MobileNotificationTypeEnum = z.enum([
  // Phase 10
  'DEFECT_UPDATE',
  // Redesign R4
  'VISIT_ASSIGNED',
  'VISIT_CHANGED',
  'VISIT_REMINDER',
  'VISIT_RETURNED',
  'VISIT_APPROVED',
  // UBEC IRL: early-warning alerts (metadata.alertKey says which)
  'PROJECT_ALERT',
]);
export type MobileNotificationType = z.infer<typeof MobileNotificationTypeEnum>;

export const NotificationActionTypeEnum = z.enum([
  'NONE',
  // Phase 10
  'OPEN_DEFECTS',
  // Redesign R4
  'OPEN_VISIT',
  // Push only: the account was given a project (the app refreshes its project list).
  'OPEN_PROJECT',
]);
export type NotificationActionType = z.infer<typeof NotificationActionTypeEnum>;

export const MobileNotificationMetadataSchema = z
  .object({
    /** Phase 10: the defect ticket a DEFECT_UPDATE is about. */
    defectTicketId: z.string().uuid().optional(),
    /** Redesign R4: the visit a VISIT_* notification is about (action OPEN_VISIT). */
    visitId: z.string().uuid().optional(),
    visitSubmissionId: z.string().uuid().optional(),
    /**
     * UBEC IRL: an early-warning alert on the project (STALLED, SITE_UPDATE_OVERDUE). Stored as a
     * broadcast with action NONE; the app shows it as an alert and opens the project.
     */
    alertKey: ProjectAlertKeyEnum.optional(),
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
  'CONTRACTOR_ONBOARDING',
  // Phase 9 (redesign R2d: sprints decide it)
  'SCHEDULE_BEHIND',
  // Phase 10
  'HANDOVER_RECORDED',
  'DEFECT_TICKET',
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
  // Redesign R4
  'VISIT_RESCHEDULED',
  'VISIT_DATE_PROPOSED',
  'VISIT_DECLINED',
  'VISIT_PENDING_APPROVAL',
  'VISIT_MISSED',
  'FINDING_ESCALATED',
  'SPRINT_VERIFICATION_DUE',
  // UBEC IRL early-warning alerts (DELAYED keeps SCHEDULE_BEHIND)
  'PROJECT_STALLED',
  'SITE_UPDATE_OVERDUE',
  'SPEND_AHEAD_OF_PROGRESS',
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
