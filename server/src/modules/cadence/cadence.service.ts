import { Prisma } from '@prisma/client';
import {
  CadenceSettings,
  cadenceHasPeriods,
  getReportingPeriodForDate,
  ProjectCadenceSettingsDto,
  ReportingCadence,
  zonedDateTimeToInstant,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Reporting cadence (Phase 8 Step 3). All period maths is in the shared module; this file maps
 * projects onto it. Redesign R4f removed reporting obligations, streams and reporter scopes (visits
 * replace them); what is left serves the workday reports and the old app's pack until R5 deletes them.
 */

export const CADENCE_PROJECT_SELECT = {
  id: true,
  reportingCadence: true,
  workdayStartTime: true,
  workdayEndTime: true,
  workWeekDays: true,
  periodStartDayOfWeek: true,
  customIntervalDays: true,
  reportDueTime: true,
  reportGraceMinutes: true,
  cadenceAnchorDate: true,
  cadenceQuarterAnchorMonth: true,
  timezone: true,
  pendingCadenceJson: true,
  pendingCadenceEffectiveFrom: true,
} satisfies Prisma.ProjectSelect;

export type CadenceProjectRow = Prisma.ProjectGetPayload<{ select: typeof CADENCE_PROJECT_SELECT }>;

export function cadenceSettingsOf(project: CadenceProjectRow): CadenceSettings {
  return {
    reportingCadence: project.reportingCadence as ReportingCadence,
    workWeekDays: project.workWeekDays,
    periodStartDayOfWeek: project.periodStartDayOfWeek,
    customIntervalDays: project.customIntervalDays,
    workdayStartTime: project.workdayStartTime,
    workdayEndTime: project.workdayEndTime,
    reportDueTime: project.reportDueTime,
    reportGraceMinutes: project.reportGraceMinutes,
    cadenceAnchorDate: project.cadenceAnchorDate,
    cadenceQuarterAnchorMonth: project.cadenceQuarterAnchorMonth,
    timezone: project.timezone,
  };
}

/** Fields a pending cadence change may carry (the reporting step's shape). */
const PENDING_FIELDS = [
  'reportingCadence',
  'workdayStartTime',
  'workdayEndTime',
  'workWeekDays',
  'periodStartDayOfWeek',
  'customIntervalDays',
  'reportDueTime',
  'reportGraceMinutes',
  'cadenceAnchorDate',
  'cadenceQuarterAnchorMonth',
] as const;

function pendingSettings(project: CadenceProjectRow): Partial<CadenceProjectRow> | null {
  const raw = project.pendingCadenceJson;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !project.pendingCadenceEffectiveFrom) return null;
  const out: Record<string, unknown> = {};
  for (const key of PENDING_FIELDS) if (key in raw) out[key] = (raw as Record<string, unknown>)[key];
  return out as Partial<CadenceProjectRow>;
}

/**
 * Settings in force on a calendar date: a pending change (made on a live project) applies from its
 * effective date, so the period that was running when it was saved keeps its old shape.
 */
export function cadenceSettingsForDate(project: CadenceProjectRow, date: string): CadenceSettings {
  const pending = pendingSettings(project);
  if (pending && project.pendingCadenceEffectiveFrom && date >= project.pendingCadenceEffectiveFrom) {
    return cadenceSettingsOf({ ...project, ...pending });
  }
  return cadenceSettingsOf(project);
}

/** Moves a pending cadence change into the project once its effective date has come. */
export async function applyDuePendingCadence(project: CadenceProjectRow, today: string): Promise<boolean> {
  const pending = pendingSettings(project);
  if (!pending || !project.pendingCadenceEffectiveFrom || today < project.pendingCadenceEffectiveFrom) return false;
  const applied = await prisma.project.updateMany({
    where: { id: project.id, pendingCadenceEffectiveFrom: project.pendingCadenceEffectiveFrom },
    data: { ...(pending as Prisma.ProjectUpdateManyMutationInput), pendingCadenceJson: Prisma.DbNull, pendingCadenceEffectiveFrom: null },
  });
  return applied.count > 0;
}

export function serializeCadenceSettings(project: CadenceProjectRow): ProjectCadenceSettingsDto {
  return {
    ...cadenceSettingsOf(project),
    customIntervalDays: project.customIntervalDays,
    reportDueTime: project.reportDueTime,
    cadenceAnchorDate: project.cadenceAnchorDate,
    cadenceQuarterAnchorMonth: project.cadenceQuarterAnchorMonth,
  };
}

export async function loadCadenceProject(db: Db, projectId: string): Promise<CadenceProjectRow> {
  const project = await db.project.findUnique({ where: { id: projectId }, select: CADENCE_PROJECT_SELECT });
  if (!project) throw new AppError('Project not found', 404);
  return project;
}

/** The key that reports and obligations are stored under. */
export interface PeriodKey {
  periodStart: string;
  periodEnd: string;
  dueAt: Date;
  lateAfter: Date;
  /** False for INSPECTION_ONLY: the "period" is just the day, nothing is owed and nothing is late. */
  hasObligations: boolean;
}

/**
 * The reporting period containing a calendar date. INSPECTION_ONLY has no periods, so reports are
 * keyed by the day itself and are never late.
 */
export function periodKeyForDate(settings: CadenceSettings, date: string): PeriodKey {
  const period = getReportingPeriodForDate(settings, date);
  if (!period) {
    const endOfDay = zonedDateTimeToInstant(date, '23:59', settings.timezone);
    return { periodStart: date, periodEnd: date, dueAt: endOfDay, lateAfter: endOfDay, hasObligations: false };
  }
  return {
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    dueAt: new Date(period.dueAt),
    lateAfter: new Date(period.lateAfter),
    hasObligations: true,
  };
}

export function todayInProject(settings: CadenceSettings, now = new Date()): string {
  return zonedCalendarDate(now, settings.timezone);
}

/** Lateness of a report confirmed at `confirmedAt` for a period. Never late without obligations. */
export function lateness(key: PeriodKey, confirmedAt: Date): { isLate: boolean; lateByMinutes: number | null } {
  if (!key.hasObligations || confirmedAt.getTime() <= key.lateAfter.getTime()) return { isLate: false, lateByMinutes: null };
  return { isLate: true, lateByMinutes: Math.ceil((confirmedAt.getTime() - key.dueAt.getTime()) / 60_000) };
}

export { cadenceHasPeriods };
