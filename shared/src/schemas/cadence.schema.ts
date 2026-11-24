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
