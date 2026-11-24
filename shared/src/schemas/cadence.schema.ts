import { z } from 'zod';
import { ReportingCadenceEnum } from '../enums';
import { CALENDAR_DATE_REGEX } from '../utils/time';

/**
 * Phase 8: reporting cadence and obligations (the participant roster and attendance alerts were removed in redesign R1e).
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
  /** Phase 14: month (1-12) a QUARTERLY year starts in. */
  cadenceQuarterAnchorMonth: z.number().int().min(1).max(12),
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
  /** Phase 14. Absent in packs saved before it: January. */
  cadenceQuarterAnchorMonth: z.number().int().nullable().optional(),
  timezone: z.string(),
});
export type ProjectCadenceSettingsDto = z.infer<typeof ProjectCadenceSettingsDtoSchema>;

export const ReportingPeriodDtoSchema = z.object({
  periodStart: z.string(),
  periodEnd: z.string(),
  calendarEnd: z.string(),
  firstWorkday: z.string().nullable(),
  /** When the period opens (first workday at workdayStartTime): its obligations are created then. */
  opensAt: z.string().nullable(),
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
/** Phase 14: the one obligation per period of an INSPECTION stream (boqItemId null). */
export const INSPECTION_REPORTER_SCOPE = 'inspection';

export const ReportingObligationDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  /** Phase 14: null for an INSPECTION stream obligation (one per period, not per item). */
  boqItemId: z.string().uuid().nullable(),
  wbsCode: z.string().nullable(),
  wbsDescription: z.string().nullable(),
  /** Phase 14: the reporting stream; null = the project's implicit default stream. */
  streamId: z.string().uuid().nullable(),
  streamLabel: z.string().nullable(),
  siteInspectionReportId: z.string().uuid().nullable(),
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
  }),
});
export type ProjectCadenceOverviewDto = z.infer<typeof ProjectCadenceOverviewDtoSchema>;

