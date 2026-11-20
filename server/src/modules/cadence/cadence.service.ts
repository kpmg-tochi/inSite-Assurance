import { Prisma } from '@prisma/client';
import {
  BriefPersona,
  CadenceSettings,
  cadenceHasPeriods,
  CONTRACTOR_PROJECT_WIDE_SCOPE,
  CONTRACTOR_REPORTER_SCOPE_PREFIX,
  FieldPersonaType,
  INSPECTION_REPORTER_SCOPE,
  getReportingPeriod,
  getReportingPeriodForDate,
  ProjectCadenceOverviewDto,
  ProjectCadenceSettingsDto,
  ReportingCadence,
  ReportingObligationDto,
  ReportingObligationStatus,
  VERIFIER_REPORTER_SCOPE,
  zonedDateTimeToInstant,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';

type Db = Prisma.TransactionClient | typeof prisma;

/**
 * Reporting cadence (Phase 8 Step 3). All period maths is in the shared module; this file maps
 * projects onto it and owns reporting obligations.
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

/** The key that reports and briefs are stored under. */
export interface PeriodKey {
  periodStart: string;
  periodEnd: string;
  dueAt: Date;
  lateAfter: Date;
  /** False for INSPECTION_ONLY: the "period" is just the day, nothing is owed and nothing is late. */
  hasObligations: boolean;
}

/**
 * The reporting period containing a calendar date. INSPECTION_ONLY has no periods, so reports and
 * briefs are keyed by the day itself and are never late.
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

// ---------------------------------------------------------------------------
// Reporter scopes
// ---------------------------------------------------------------------------

export function reporterScopeFor(persona: FieldPersonaType | BriefPersona, projectContractorId: string | null): string {
  if (persona === 'CONTRACTOR_EXECUTOR') {
    return projectContractorId ? `${CONTRACTOR_REPORTER_SCOPE_PREFIX}${projectContractorId}` : CONTRACTOR_PROJECT_WIDE_SCOPE;
  }
  return VERIFIER_REPORTER_SCOPE;
}

function contractorIdOfScope(scope: string): string | null {
  if (!scope.startsWith(CONTRACTOR_REPORTER_SCOPE_PREFIX) || scope === CONTRACTOR_PROJECT_WIDE_SCOPE) return null;
  return scope.slice(CONTRACTOR_REPORTER_SCOPE_PREFIX.length);
}

/**
 * Which contractor scope owes the report for an item: its own package when that package reports
 * from site, else the main contractor, else the project-wide contractor scope.
 */
function contractorScopeForItem(
  item: { projectContractorId: string | null },
  contractors: Array<{ id: string; isMainContractor: boolean; allowFieldReporting: boolean }>
): string | null {
  if (contractors.length === 0) return CONTRACTOR_PROJECT_WIDE_SCOPE;
  const own = contractors.find((c) => c.id === item.projectContractorId);
  if (own) return own.allowFieldReporting ? `${CONTRACTOR_REPORTER_SCOPE_PREFIX}${own.id}` : null;
  const main = contractors.find((c) => c.isMainContractor && c.allowFieldReporting);
  return main ? `${CONTRACTOR_REPORTER_SCOPE_PREFIX}${main.id}` : CONTRACTOR_PROJECT_WIDE_SCOPE;
}

// ---------------------------------------------------------------------------
// Obligations
// ---------------------------------------------------------------------------

/**
 * Creates obligations for the scheduled (Plan A) items of a period, one per item and reporter
 * scope that owes a report. Idempotent (skipDuplicates on the unique key). Fallback items carry no
 * obligation: they are optional work.
 */
export async function createObligationsForPeriod(params: {
  projectId: string;
  key: PeriodKey;
  personas: BriefPersona[];
  items: Array<{ id: string; projectContractorId: string | null; isScheduled: boolean }>;
  /** Phase 14: the ITEM_REPORTS stream the obligations belong to (null/absent = implicit stream). */
  stream?: { id: string; projectContractorId: string | null } | null;
}): Promise<number> {
  if (!params.key.hasObligations) return 0;
  const contractors = await prisma.projectContractor.findMany({
    where: { projectId: params.projectId },
    select: { id: true, isMainContractor: true, allowFieldReporting: true },
  });
  const rows: Prisma.ReportingObligationCreateManyInput[] = [];
  for (const item of params.items.filter((i) => i.isScheduled)) {
    for (const persona of params.personas) {
      const scope = persona === 'INDEPENDENT_VERIFIER' ? VERIFIER_REPORTER_SCOPE : contractorScopeForItem(item, contractors);
      if (!scope) continue;
      // Phase 14: a stream limited to one package owes only that package's contractor reports.
      const limitTo = params.stream?.projectContractorId;
      if (limitTo && scope !== VERIFIER_REPORTER_SCOPE && scope !== `${CONTRACTOR_REPORTER_SCOPE_PREFIX}${limitTo}`) continue;
      rows.push({
        projectId: params.projectId,
        streamId: params.stream?.id ?? null,
        boqItemId: item.id,
        reporterScope: scope,
        periodStart: params.key.periodStart,
        periodEnd: params.key.periodEnd,
        dueAt: params.key.dueAt,
        lateAfter: params.key.lateAfter,
      });
    }
  }
  if (rows.length === 0) return 0;
  const result = await prisma.reportingObligation.createMany({ data: rows, skipDuplicates: true });
  return result.count;
}

/**
 * Marks the obligation a new report answers. A contractor report on an item whose obligation sits
 * with another contractor scope (e.g. the main contractor reporting for a sub) still fulfils it.
 * A MISSED obligation becomes LATE when its report arrives.
 */
export async function fulfilObligation(
  tx: Prisma.TransactionClient,
  params: {
    projectId: string;
    boqItemId: string;
    scope: string;
    periodStart: string;
    reportId: string;
    isLate: boolean;
    /** Phase 14: the reporter's ITEM_REPORTS stream (null = implicit stream). */
    streamId?: string | null;
  }
): Promise<string | null> {
  const open: ReportingObligationStatus[] = ['PENDING', 'MISSED'];
  const streamId = params.streamId ?? null;
  let target = await tx.reportingObligation.findFirst({
    where: {
      projectId: params.projectId,
      streamId,
      boqItemId: params.boqItemId,
      periodStart: params.periodStart,
      reporterScope: params.scope,
      status: { in: open },
    },
    select: { id: true },
  });
  if (!target && params.scope.startsWith(CONTRACTOR_REPORTER_SCOPE_PREFIX)) {
    target = await tx.reportingObligation.findFirst({
      where: {
        projectId: params.projectId,
        streamId,
        boqItemId: params.boqItemId,
        periodStart: params.periodStart,
        reporterScope: { startsWith: CONTRACTOR_REPORTER_SCOPE_PREFIX },
        status: { in: open },
      },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
  }
  if (!target) return null;
  await tx.reportingObligation.update({
    where: { id: target.id },
    data: { status: params.isLate ? 'LATE' : 'SUBMITTED', workdayReportId: params.reportId },
  });
  return target.id;
}

// ---------------------------------------------------------------------------
// Read model
// ---------------------------------------------------------------------------

const OBLIGATION_INCLUDE = {
  boqItem: { select: { wbsCode: true, description: true } },
  stream: { select: { label: true, kind: true } },
} satisfies Prisma.ReportingObligationInclude;

type ObligationRow = Prisma.ReportingObligationGetPayload<{ include: typeof OBLIGATION_INCLUDE }>;

function serializeObligation(row: ObligationRow, contractorNames: Map<string, string>): ReportingObligationDto {
  const contractorId = contractorIdOfScope(row.reporterScope);
  const label =
    row.reporterScope === INSPECTION_REPORTER_SCOPE
      ? row.stream?.label ?? 'Site inspection'
      : row.reporterScope === VERIFIER_REPORTER_SCOPE
      ? 'Independent verifier'
      : contractorId
        ? contractorNames.get(contractorId) ?? 'Contractor'
        : 'Contractor';
  return {
    id: row.id,
    projectId: row.projectId,
    boqItemId: row.boqItemId,
    wbsCode: row.boqItem?.wbsCode ?? null,
    wbsDescription: row.boqItem?.description ?? null,
    streamId: row.streamId,
    streamLabel: row.stream?.label ?? null,
    siteInspectionReportId: row.siteInspectionReportId,
    reporterScope: row.reporterScope,
    reporterScopeLabel: label,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    dueAt: row.dueAt.toISOString(),
    lateAfter: row.lateAfter.toISOString(),
    status: row.status,
    workdayReportId: row.workdayReportId,
    alertedAt: row.alertedAt?.toISOString() ?? null,
    excusedNote: row.excusedNote,
  };
}

async function contractorNameMap(projectId: string): Promise<Map<string, string>> {
  const rows = await prisma.projectContractor.findMany({
    where: { projectId },
    select: { id: true, organization: { select: { name: true } } },
  });
  return new Map(rows.map((r) => [r.id, r.organization.name]));
}

export async function listObligations(params: {
  projectId: string;
  periodStart?: string;
  status?: ReportingObligationStatus[];
  /** Restrict to obligations that are overdue or due (PENDING, LATE, MISSED). */
  dueAndOverdue?: boolean;
  limit?: number;
}): Promise<ReportingObligationDto[]> {
  const where: Prisma.ReportingObligationWhereInput = { projectId: params.projectId };
  if (params.periodStart) where.periodStart = params.periodStart;
  if (params.status?.length) where.status = { in: params.status };
  if (params.dueAndOverdue) where.status = { in: ['PENDING', 'MISSED', 'LATE'] };
  const [rows, names] = await Promise.all([
    prisma.reportingObligation.findMany({
      where,
      include: OBLIGATION_INCLUDE,
      orderBy: [{ dueAt: 'desc' }, { boqItem: { wbsCode: 'asc' } }],
      take: Math.min(params.limit ?? 300, 1000),
    }),
    contractorNameMap(params.projectId),
  ]);
  return rows.map((r) => serializeObligation(r, names));
}

export async function getCadenceOverview(projectId: string, now = new Date()): Promise<ProjectCadenceOverviewDto> {
  const project = await loadCadenceProject(prisma, projectId);
  const settings = cadenceSettingsForDate(project, zonedCalendarDate(now, project.timezone));
  const current = getReportingPeriod(settings, now);
  const obligations = current ? await listObligations({ projectId, periodStart: current.periodStart }) : [];
  const count = (s: ReportingObligationStatus) => obligations.filter((o) => o.status === s).length;
  const openAttendanceAlerts = await prisma.siteAttendanceAlert.count({ where: { projectId, status: 'OPEN' } });
  return {
    settings: { ...serializeCadenceSettings(project), ...settings, customIntervalDays: settings.customIntervalDays ?? null, reportDueTime: settings.reportDueTime ?? null, cadenceAnchorDate: settings.cadenceAnchorDate ?? null },
    pendingChange: project.pendingCadenceEffectiveFrom ? { effectiveFrom: project.pendingCadenceEffectiveFrom } : null,
    currentPeriod: current,
    obligations,
    counts: {
      pending: count('PENDING'),
      submitted: count('SUBMITTED'),
      late: count('LATE'),
      missed: count('MISSED'),
      excused: count('EXCUSED'),
      openAttendanceAlerts,
    },
  };
}

/** Excusing a missed (or pending) report requires a note and is audited. */
export async function excuseObligation(params: {
  projectId: string;
  obligationId: string;
  notes: string;
  webUser: WebJwtPayload;
}): Promise<ReportingObligationDto> {
  const row = await prisma.reportingObligation.findFirst({
    where: { id: params.obligationId, projectId: params.projectId },
    include: OBLIGATION_INCLUDE,
  });
  if (!row) throw new AppError('Reporting obligation not found', 404, 'OBLIGATION_NOT_FOUND');
  if (!['PENDING', 'MISSED'].includes(row.status)) {
    throw new AppError('Only a pending or missed report can be excused', 409, 'OBLIGATION_NOT_EXCUSABLE');
  }
  await prisma.$transaction(async (tx) => {
    const updated = await tx.reportingObligation.updateMany({
      where: { id: row.id, status: { in: ['PENDING', 'MISSED'] } },
      data: { status: 'EXCUSED', excusedNote: params.notes, excusedByUserId: params.webUser.userId },
    });
    if (updated.count === 0) throw new AppError('The report status changed; reload and try again', 409, 'OBLIGATION_CHANGED');
    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'WEB_USER',
      actorId: params.webUser.userId,
      actorDisplayName: `${params.webUser.fullName} (${params.webUser.roleName})`,
      action: 'REPORTING_OBLIGATION_EXCUSED',
      summaryText: row.boqItem
        ? `Excused the ${row.reporterScope === VERIFIER_REPORTER_SCOPE ? 'verifier' : 'contractor'} report on WBS ${row.boqItem.wbsCode} for ${row.periodStart} to ${row.periodEnd}: ${params.notes}`
        : `Excused the ${row.stream?.label ?? 'site inspection'} for ${row.periodStart} to ${row.periodEnd}: ${params.notes}`,
      payload: { obligationId: row.id, previousStatus: row.status, notes: params.notes },
    });
  });
  const fresh = await prisma.reportingObligation.findUniqueOrThrow({ where: { id: row.id }, include: OBLIGATION_INCLUDE });
  return serializeObligation(fresh, await contractorNameMap(params.projectId));
}

/** Field sessions that report for a scope (used to notify them). */
export async function sessionsForScope(projectId: string, scope: string): Promise<Array<{ id: string }>> {
  if (scope === VERIFIER_REPORTER_SCOPE) {
    return prisma.fieldAgentSession.findMany({
      where: { projectId, isActive: true, fieldPersonaType: 'INDEPENDENT_VERIFIER' },
      select: { id: true },
    });
  }
  const contractorId = contractorIdOfScope(scope);
  return prisma.fieldAgentSession.findMany({
    where: {
      projectId,
      isActive: true,
      fieldPersonaType: 'CONTRACTOR_EXECUTOR',
      ...(contractorId ? { projectContractorId: contractorId } : {}),
    },
    select: { id: true },
  });
}

export { cadenceHasPeriods };
