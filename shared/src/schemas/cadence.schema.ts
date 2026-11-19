import { z } from 'zod';
import { ReportingCadenceEnum } from '../enums';
import { CALENDAR_DATE_REGEX } from '../utils/time';

/**
 * Phase 8: reporting cadence, obligations, expected participants and attendance alerts.
 */

const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24-hour)');
const CalendarDate = z.string().regex(CALENDAR_DATE_REGEX, 'Use YYYY-MM-DD');
const IsoWeekday = z.number().int().min(1).max(7);

// ---------------------------------------------------------------------------
// Cadence settings (the reporting step and the period DTO)
// ---------------------------------------------------------------------------

/** Cadence fields beyond cadence and workday hours (all optional on save; defaults apply). */
export const ProjectCadenceFieldsSchema = z.object({
  /** ISO weekdays (1 = Monday ... 7 = Sunday). */
  workWeekDays: z
    .array(IsoWeekday)
    .min(1, 'Pick at least one working day')
    .max(7)
    .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  periodStartDayOfWeek: IsoWeekday,
  customIntervalDays: z.number().int().min(1).max(92).nullable(),
  /** null = the end of the working day. */
  reportDueTime: TimeOfDay.nullable(),
  reportGraceMinutes: z.number().int().min(0).max(24 * 60),
  /** First day of a bi-weekly or custom period. */
  cadenceAnchorDate: CalendarDate.nullable(),
});
export type ProjectCadenceFields = z.infer<typeof ProjectCadenceFieldsSchema>;

export const ProjectCadenceSettingsDtoSchema = z.object({
  reportingCadence: ReportingCadenceEnum,
  workdayStartTime: z.string(),
  workdayEndTime: z.string(),
  workWeekDays: z.array(z.number().int()),
  periodStartDayOfWeek: z.number().int(),
  customIntervalDays: z.number().int().nullable(),
  reportDueTime: z.string().nullable(),
  reportGraceMinutes: z.number().int(),
  cadenceAnchorDate: z.string().nullable(),
  timezone: z.string(),
});
export type ProjectCadenceSettingsDto = z.infer<typeof ProjectCadenceSettingsDtoSchema>;

export const ReportingPeriodDtoSchema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  calendarEnd: z.string(),
  firstWorkday: z.string().nullable(),
  briefAt: z.string().nullable(),
  dueAt: z.string(),
  lateAfter: z.string(),
  isWorkday: z.boolean(),
});
export type ReportingPeriodDto = z.infer<typeof ReportingPeriodDtoSchema>;

// ---------------------------------------------------------------------------
// Reporting obligations
// ---------------------------------------------------------------------------

export const ReportingObligationStatusEnum = z.enum(['PENDING', 'SUBMITTED', 'LATE', 'MISSED', 'EXCUSED']);
export type ReportingObligationStatus = z.infer<typeof ReportingObligationStatusEnum>;

/** Who owes a report: a contractor package ("contractor:<projectContractorId>"), or "verifier". */
export const VERIFIER_REPORTER_SCOPE = 'verifier';
export const CONTRACTOR_REPORTER_SCOPE_PREFIX = 'contractor:';
/** Contractor reporting on a project without contractor packages. */
export const CONTRACTOR_PROJECT_WIDE_SCOPE = 'contractor:project';

export const ReportingObligationDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  boqItemId: z.string().uuid(),
  wbsCode: z.string(),
  wbsDescription: z.string(),
  reporterScope: z.string(),
  /** Display name of the scope: contractor organisation, or "Independent verifier". */
  reporterScopeLabel: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  dueAt: z.string(),
  lateAfter: z.string(),
  status: ReportingObligationStatusEnum,
  workdayReportId: z.string().uuid().nullable(),
  alertedAt: z.string().nullable(),
  excusedNote: z.string().nullable(),
});
export type ReportingObligationDto = z.infer<typeof ReportingObligationDtoSchema>;

export const ExcuseObligationRequestSchema = z.object({
  notes: z.string().trim().min(3, 'A note is required to excuse a missed report').max(1000),
});
export type ExcuseObligationRequest = z.infer<typeof ExcuseObligationRequestSchema>;

/** GET /projects/:id/cadence: settings, the current period and its obligations. */
export const ProjectCadenceOverviewDtoSchema = z.object({
  /** Settings in force today (a pending change is not applied until its effective date). */
  settings: ProjectCadenceSettingsDtoSchema,
  /** A cadence change saved on a live project, waiting for the next period. */
  pendingChange: z.object({ effectiveFrom: z.string() }).nullable(),
  currentPeriod: ReportingPeriodDtoSchema.nullable(),
  obligations: z.array(ReportingObligationDtoSchema),
  counts: z.object({
    pending: z.number().int(),
    submitted: z.number().int(),
    late: z.number().int(),
    missed: z.number().int(),
    excused: z.number().int(),
    openAttendanceAlerts: z.number().int(),
  }),
});
export type ProjectCadenceOverviewDto = z.infer<typeof ProjectCadenceOverviewDtoSchema>;

// ---------------------------------------------------------------------------
// Expected participants (mobilization roster)
// ---------------------------------------------------------------------------

export const MobilizationStatusEnum = z.enum([
  'INVITED',
  'REGISTERED_PENDING_ASSURANCE',
  'READY_FOR_MOBILIZATION',
  'MOBILIZED_ON_SITE',
  'NO_SHOW_FLAGGED',
  'WITHDRAWN',
]);
export type MobilizationStatus = z.infer<typeof MobilizationStatusEnum>;

export const DEFAULT_REMINDER_OFFSETS_DAYS = [7, 3, 1];
const ReminderOffsets = z
  .array(z.number().int().min(0).max(90))
  .max(10)
  .transform((d) => [...new Set(d)].sort((a, b) => b - a));

const participantFields = {
  roleId: z.string().uuid(),
  projectContractorId: z.string().uuid().nullable().optional(),
  /** Set for provisioned roles: the participant is an existing account. */
  userId: z.string().uuid().nullable().optional(),
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().max(254).nullable().optional(),
  /** E.164-ish; matched against the phone given when joining by code. */
  phoneNumber: z
    .string()
    .trim()
    .regex(/^\+?[0-9 ()-]{7,20}$/, 'Enter a phone number')
    .nullable()
    .optional(),
  plannedMobilizationDate: CalendarDate,
  /** null = the project's workday start time. */
  expectedCheckInTime: TimeOfDay.nullable().optional(),
  checkInGraceMinutes: z.number().int().min(0).max(24 * 60).optional(),
  /** null = use the project's reminder schedule. */
  reminderOffsetsDays: ReminderOffsets.nullable().optional(),
};

export const CreateExpectedParticipantRequestSchema = z
  .object(participantFields)
  .refine((v) => Boolean(v.userId || v.email || v.phoneNumber), {
    message: 'Link an account, or give an email or phone number to send reminders to',
    path: ['email'],
  });
export type CreateExpectedParticipantRequest = z.infer<typeof CreateExpectedParticipantRequestSchema>;

export const UpdateExpectedParticipantRequestSchema = z
  .object(participantFields)
  .partial()
  .extend({ withdrawn: z.boolean().optional() });
export type UpdateExpectedParticipantRequest = z.infer<typeof UpdateExpectedParticipantRequestSchema>;

export const ExpectedParticipantDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  projectContractorId: z.string().uuid().nullable(),
  contractorName: z.string().nullable(),
  roleId: z.string().uuid(),
  roleName: z.string(),
  onboardingMode: z.enum(['JOIN_CODE', 'PROVISIONED_ACCOUNT']),
  userId: z.string().uuid().nullable(),
  fullName: z.string(),
  email: z.string().nullable(),
  phoneNumber: z.string().nullable(),
  plannedMobilizationDate: z.string(),
  expectedCheckInTime: z.string(),
  checkInGraceMinutes: z.number().int(),
  /** Effective schedule (own override or the project's). */
  reminderOffsetsDays: z.array(z.number().int()),
  usesProjectReminderSchedule: z.boolean(),
  lastReminderSentAt: z.string().nullable(),
  linkedFieldSessionId: z.string().uuid().nullable(),
  mobilizationStatus: MobilizationStatusEnum,
  createdAt: z.string(),
});
export type ExpectedParticipantDto = z.infer<typeof ExpectedParticipantDtoSchema>;

export const ProjectReminderSettingsSchema = z.object({
  reminderOffsetsDays: ReminderOffsets,
});
export type ProjectReminderSettings = z.infer<typeof ProjectReminderSettingsSchema>;

// ---------------------------------------------------------------------------
// Attendance alerts and check-in
// ---------------------------------------------------------------------------

export const AttendanceAlertTypeEnum = z.enum([
  'MOBILIZATION_NO_SHOW',
  'WORKDAY_MISSED_CHECKIN',
  'UNVERIFIED_AT_MOBILIZATION',
]);
export type AttendanceAlertType = z.infer<typeof AttendanceAlertTypeEnum>;

export const AttendanceAlertStatusEnum = z.enum(['OPEN', 'ACKNOWLEDGED', 'EXCUSED', 'RESOLVED']);
export type AttendanceAlertStatus = z.infer<typeof AttendanceAlertStatusEnum>;

export const SiteAttendanceAlertDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  participantId: z.string().uuid().nullable(),
  participantName: z.string().nullable(),
  fieldSessionId: z.string().uuid().nullable(),
  workdayDate: z.string(),
  alertType: AttendanceAlertTypeEnum,
  status: AttendanceAlertStatusEnum,
  resolvedByUserId: z.string().uuid().nullable(),
  resolvedByName: z.string().nullable(),
  resolutionNotes: z.string().nullable(),
  createdAt: z.string(),
});
export type SiteAttendanceAlertDto = z.infer<typeof SiteAttendanceAlertDtoSchema>;

export const AttendanceAlertActionEnum = z.enum(['ACKNOWLEDGE', 'EXCUSE', 'RESOLVE']);
export type AttendanceAlertAction = z.infer<typeof AttendanceAlertActionEnum>;

export const AttendanceAlertActionRequestSchema = z
  .object({
    action: AttendanceAlertActionEnum,
    notes: z.string().trim().max(1000).optional(),
  })
  .refine((v) => v.action !== 'EXCUSE' || (v.notes ?? '').length >= 3, {
    message: 'A note is required to excuse an alert',
    path: ['notes'],
  });
export type AttendanceAlertActionRequest = z.infer<typeof AttendanceAlertActionRequestSchema>;

/** GET /projects/:id/check-in/today (field): the caller's check-in for the project's current day. */
export const CheckInStatusDtoSchema = z.object({
  workdayDate: z.string(),
  isWorkday: z.boolean(),
  checkedIn: z.boolean(),
  checkedInAt: z.string().nullable(),
  source: z.string().nullable(),
  /** Most recent manual check-in today (in or outside the geofence), for feedback after tapping. */
  lastManualCheckIn: z
    .object({
      capturedAt: z.string(),
      isWithinGeofence: z.boolean().nullable(),
      geofenceStatus: z.string().nullable(),
    })
    .nullable(),
});
export type CheckInStatusDto = z.infer<typeof CheckInStatusDtoSchema>;
