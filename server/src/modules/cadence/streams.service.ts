import { Prisma } from '@prisma/client';
import {
  getReportingPeriod,
  INSPECTION_REPORTER_SCOPE,
  InspectionVisitType,
  ProjectReportingStreamsDto,
  ProjectTypeReportingStream,
  ReportingCadence,
  ReportingStreamDto,
  SaveReportingStreamsRequest,
  zonedCalendarDate,
  addDays,
  nextPeriodStart,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import {
  CADENCE_PROJECT_SELECT,
  CadenceProjectRow,
  cadenceSettingsForDate,
  cadenceSettingsOf,
  loadCadenceProject,
  PeriodKey,
  ReportingPersona,
  serializeCadenceSettings,
} from './cadence.service';

/**
 * Reporting streams (Phase 14). A project with no stream rows runs one implicit stream from its own
 * cadence fields, exactly as in Phase 8. With streams, each stream owes its own obligations:
 * - ITEM_REPORTS: per BOQ item per period (Phase 8 obligations, tagged with the stream), owed by the
 *   personas of the stream's roles and limited to one package when the stream names one;
 * - INSPECTION: one site inspection of the stream's visit type per period (boqItemId null).
 *
 * All period maths reuses the project helpers: a stream is turned into a project-shaped cadence row
 * (`streamCadenceRow`) with the project's working hours and time zone.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export const STREAM_SELECT = {
  id: true,
  projectId: true,
  key: true,
  label: true,
  kind: true,
  roleIds: true,
  projectContractorId: true,
  reportingCadence: true,
  workWeekDays: true,
  periodStartDayOfWeek: true,
  customIntervalDays: true,
  quarterAnchorMonth: true,
  reportDueTime: true,
  reportGraceMinutes: true,
  cadenceAnchorDate: true,
  visitType: true,
  submissionDeadlineDays: true,
  isActive: true,
  sortOrder: true,
  pendingCadenceJson: true,
  pendingCadenceEffectiveFrom: true,
} satisfies Prisma.ProjectReportingStreamSelect;

export type StreamRow = Prisma.ProjectReportingStreamGetPayload<{ select: typeof STREAM_SELECT }>;

/** Stream cadence fields, as stored on the stream and in its pending change. */
const STREAM_CADENCE_FIELDS = [
  'reportingCadence',
  'workWeekDays',
  'periodStartDayOfWeek',
  'customIntervalDays',
  'quarterAnchorMonth',
  'reportDueTime',
  'reportGraceMinutes',
  'cadenceAnchorDate',
] as const;
/** Fields that change the shape of a stream's periods. */
const STREAM_SHAPE_FIELDS = ['reportingCadence', 'workWeekDays', 'periodStartDayOfWeek', 'customIntervalDays', 'quarterAnchorMonth', 'cadenceAnchorDate'] as const;

type StreamCadence = Pick<StreamRow, (typeof STREAM_CADENCE_FIELDS)[number]>;

function streamCadenceOf(stream: StreamCadence): Record<string, unknown> {
  return {
    reportingCadence: stream.reportingCadence,
    workWeekDays: stream.workWeekDays,
    periodStartDayOfWeek: stream.periodStartDayOfWeek,
    customIntervalDays: stream.customIntervalDays,
    cadenceQuarterAnchorMonth: stream.quarterAnchorMonth ?? 1,
    reportDueTime: stream.reportDueTime,
    reportGraceMinutes: stream.reportGraceMinutes,
    cadenceAnchorDate: stream.cadenceAnchorDate,
  };
}

/**
 * A project-shaped cadence row for a stream: the stream's period settings with the project's
 * working hours and zone. Its pending change (stream field names) is mapped to project names so
 * `cadenceSettingsForDate` honours it per stream.
 */
export function streamCadenceRow(project: CadenceProjectRow, stream: StreamRow): CadenceProjectRow {
  const pendingRaw = stream.pendingCadenceJson;
  const pending =
    pendingRaw && typeof pendingRaw === 'object' && !Array.isArray(pendingRaw)
      ? streamCadenceOf({ ...(stream as StreamCadence), ...(pendingRaw as Partial<StreamCadence>) })
      : null;
  return {
    ...project,
    ...(streamCadenceOf(stream) as Partial<CadenceProjectRow>),
    pendingCadenceJson: pending as Prisma.JsonValue,
    pendingCadenceEffectiveFrom: pending ? stream.pendingCadenceEffectiveFrom : null,
  } as CadenceProjectRow;
}

export async function loadActiveStreams(db: Db, projectId: string): Promise<StreamRow[]> {
  return db.projectReportingStream.findMany({
    where: { projectId, isActive: true },
    select: STREAM_SELECT,
    orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
  });
}

export async function projectHasStreams(db: Db, projectId: string): Promise<boolean> {
  return (await db.projectReportingStream.count({ where: { projectId, isActive: true } })) > 0;
}

/** Moves a stream's pending cadence change into it once its effective date has come. */
export async function applyDuePendingStreamCadence(stream: StreamRow, today: string): Promise<boolean> {
  const raw = stream.pendingCadenceJson;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !stream.pendingCadenceEffectiveFrom) return false;
  if (today < stream.pendingCadenceEffectiveFrom) return false;
  const data: Record<string, unknown> = {};
  for (const key of STREAM_CADENCE_FIELDS) if (key in raw) data[key] = (raw as Record<string, unknown>)[key];
  const applied = await prisma.projectReportingStream.updateMany({
    where: { id: stream.id, pendingCadenceEffectiveFrom: stream.pendingCadenceEffectiveFrom },
    data: { ...(data as Prisma.ProjectReportingStreamUpdateManyMutationInput), pendingCadenceJson: Prisma.DbNull, pendingCadenceEffectiveFrom: null },
  });
  return applied.count > 0;
}

/** Personas of a stream's roles that report on BOQ items (web-only roles have none). */
export async function streamPersonas(db: Db, stream: Pick<StreamRow, 'roleIds'>): Promise<ReportingPersona[]> {
  if (stream.roleIds.length === 0) return [];
  const roles = await db.role.findMany({ where: { id: { in: stream.roleIds } }, select: { fieldPersonaType: true } });
  const out: ReportingPersona[] = [];
  if (roles.some((r) => r.fieldPersonaType === 'INDEPENDENT_VERIFIER')) out.push('INDEPENDENT_VERIFIER');
  if (roles.some((r) => r.fieldPersonaType === 'CONTRACTOR_EXECUTOR')) out.push('CONTRACTOR_EXECUTOR');
  return out;
}

function owes(stream: Pick<StreamRow, 'roleIds' | 'projectContractorId'>, reporter: { roleId: string | null; projectContractorId: string | null }) {
  if (!reporter.roleId || !stream.roleIds.includes(reporter.roleId)) return false;
  return !stream.projectContractorId || stream.projectContractorId === reporter.projectContractorId;
}

/** The ITEM_REPORTS stream a reporter owes, or null (no streams, or the role owes none). */
export async function itemStreamForReporter(
  db: Db,
  projectId: string,
  reporter: { roleId: string | null; projectContractorId: string | null }
): Promise<StreamRow | null> {
  const streams = await loadActiveStreams(db, projectId);
  return streams.find((s) => s.kind === 'ITEM_REPORTS' && owes(s, reporter)) ?? null;
}

/** The INSPECTION stream an inspection answers: same visit type, owed by the reporter's role first. */
export async function inspectionStreamFor(
  db: Db,
  projectId: string,
  params: { visitType: InspectionVisitType; roleId: string | null; projectContractorId: string | null }
): Promise<StreamRow | null> {
  const candidates = (await loadActiveStreams(db, projectId)).filter((s) => s.kind === 'INSPECTION' && s.visitType === params.visitType);
  return candidates.find((s) => owes(s, params)) ?? candidates[0] ?? null;
}

/** The streams a field principal owes (mobile period cards and the inspection flow). */
export async function streamsOwedBy(
  db: Db,
  projectId: string,
  reporter: { roleId: string | null; projectContractorId: string | null }
): Promise<StreamRow[]> {
  return (await loadActiveStreams(db, projectId)).filter((s) => owes(s, reporter));
}

/** Obligation key of an INSPECTION stream period: late after the due time + grace + upload deadline. */
export function inspectionPeriodKey(stream: Pick<StreamRow, 'submissionDeadlineDays'>, key: PeriodKey): PeriodKey {
  const extraMs = Math.max(0, stream.submissionDeadlineDays ?? 0) * 86_400_000;
  return { ...key, lateAfter: new Date(key.lateAfter.getTime() + extraMs) };
}

/** Creates the one obligation of an INSPECTION stream period (idempotent on the partial unique index). */
export async function createInspectionObligation(stream: StreamRow, key: PeriodKey): Promise<number> {
  if (!key.hasObligations) return 0;
  const k = inspectionPeriodKey(stream, key);
  const result = await prisma.reportingObligation.createMany({
    data: [
      {
        projectId: stream.projectId,
        streamId: stream.id,
        boqItemId: null,
        reporterScope: INSPECTION_REPORTER_SCOPE,
        periodStart: k.periodStart,
        periodEnd: k.periodEnd,
        dueAt: k.dueAt,
        lateAfter: k.lateAfter,
      },
    ],
    skipDuplicates: true,
  });
  return result.count;
}

/**
 * Marks the inspection obligation of a period as met. A MISSED obligation is met too: LATE when the
 * report was late, SUBMITTED otherwise (the upload deadline counts, not the period end).
 */
export async function fulfilInspectionObligation(
  tx: Prisma.TransactionClient,
  params: { streamId: string; periodStart: string; inspectionId: string; isLate: boolean }
): Promise<string | null> {
  const target = await tx.reportingObligation.findFirst({
    where: { streamId: params.streamId, periodStart: params.periodStart, boqItemId: null, status: { in: ['PENDING', 'MISSED'] } },
    select: { id: true },
  });
  if (!target) return null;
  await tx.reportingObligation.update({
    where: { id: target.id },
    data: { status: params.isLate ? 'LATE' : 'SUBMITTED', siteInspectionReportId: params.inspectionId },
  });
  return target.id;
}

// ---------------------------------------------------------------------------
// Read model and editor
// ---------------------------------------------------------------------------

function serializeStream(
  project: CadenceProjectRow,
  stream: StreamRow,
  names: { roles: Map<string, string>; contractors: Map<string, string> },
  now: Date
): ReportingStreamDto {
  const row = streamCadenceRow(project, stream);
  const today = zonedCalendarDate(now, project.timezone);
  const settings = cadenceSettingsForDate(row, today);
  return {
    id: stream.id,
    key: stream.key,
    label: stream.label,
    kind: stream.kind,
    roleIds: stream.roleIds,
    roleNames: stream.roleIds.map((id) => names.roles.get(id) ?? 'Unknown role'),
    projectContractorId: stream.projectContractorId,
    projectContractorName: stream.projectContractorId ? names.contractors.get(stream.projectContractorId) ?? null : null,
    reportingCadence: stream.reportingCadence as ReportingCadence,
    workWeekDays: stream.workWeekDays,
    periodStartDayOfWeek: stream.periodStartDayOfWeek,
    customIntervalDays: stream.customIntervalDays,
    quarterAnchorMonth: stream.quarterAnchorMonth,
    reportDueTime: stream.reportDueTime,
    reportGraceMinutes: stream.reportGraceMinutes,
    cadenceAnchorDate: stream.cadenceAnchorDate,
    visitType: stream.visitType,
    submissionDeadlineDays: stream.submissionDeadlineDays,
    isActive: stream.isActive,
    sortOrder: stream.sortOrder,
    pendingChange: stream.pendingCadenceEffectiveFrom ? { effectiveFrom: stream.pendingCadenceEffectiveFrom } : null,
    settings: {
      ...settings,
      customIntervalDays: settings.customIntervalDays ?? null,
      reportDueTime: settings.reportDueTime ?? null,
      cadenceAnchorDate: settings.cadenceAnchorDate ?? null,
      cadenceQuarterAnchorMonth: settings.cadenceQuarterAnchorMonth ?? null,
    },
    currentPeriod: getReportingPeriod(settings, now),
  };
}

async function nameMaps(db: Db, projectId: string, roleIds: string[]) {
  const [roles, contractors] = await Promise.all([
    db.role.findMany({ where: { id: { in: [...new Set(roleIds)] } }, select: { id: true, name: true } }),
    db.projectContractor.findMany({ where: { projectId }, select: { id: true, organization: { select: { name: true } } } }),
  ]);
  return {
    roles: new Map(roles.map((r) => [r.id, r.name])),
    contractors: new Map(contractors.map((c) => [c.id, c.organization.name])),
  };
}

export async function getProjectReportingStreams(projectId: string, now = new Date()): Promise<ProjectReportingStreamsDto> {
  const project = await loadCadenceProject(prisma, projectId);
  const tenant = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { tenantId: true } });
  const roleOptions = await prisma.role.findMany({
    where: { tenantId: tenant.tenantId },
    orderBy: { name: 'asc' },
    select: { id: true, name: true, code: true, fieldPersonaType: true },
  });
  const streams = await prisma.projectReportingStream.findMany({
    where: { projectId },
    select: STREAM_SELECT,
    orderBy: [{ isActive: 'desc' }, { sortOrder: 'asc' }, { key: 'asc' }],
  });
  const names = await nameMaps(prisma, projectId, streams.flatMap((s) => s.roleIds));
  return {
    usesImplicitDefault: !streams.some((s) => s.isActive),
    defaultStream: { label: 'Default', settings: serializeCadenceSettings(project) },
    streams: streams.map((s) => serializeStream(project, s, names, now)),
    roleOptions,
  };
}

/** The settings a mobile pack carries for a stream (in force today). */
export function streamSettingsForPack(project: CadenceProjectRow, stream: StreamRow, now = new Date()) {
  const settings = cadenceSettingsForDate(streamCadenceRow(project, stream), zonedCalendarDate(now, project.timezone));
  return {
    ...settings,
    customIntervalDays: settings.customIntervalDays ?? null,
    reportDueTime: settings.reportDueTime ?? null,
    cadenceAnchorDate: settings.cadenceAnchorDate ?? null,
    cadenceQuarterAnchorMonth: settings.cadenceQuarterAnchorMonth ?? null,
  };
}

/**
 * Saves the project's streams (PUT, the whole list). While DRAFT streams are replaced freely. On a
 * live project: new streams start at once; a change to a stream's period shape waits for its next
 * period (same rule as project cadence changes); a stream left out is deactivated, never deleted,
 * so its obligations and inspections keep their history.
 */
export async function saveProjectReportingStreams(
  projectId: string,
  webUser: WebJwtPayload,
  input: SaveReportingStreamsRequest,
  now = new Date()
): Promise<ProjectReportingStreamsDto> {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { ...CADENCE_PROJECT_SELECT, tenantId: true, status: true },
  });
  if (project.status === 'ARCHIVED') throw new AppError('This project is archived and read-only', 409, 'PROJECT_ARCHIVED');
  const roleIds = [...new Set(input.streams.flatMap((s) => s.roleIds))];
  const roles = await prisma.role.count({ where: { id: { in: roleIds }, tenantId: project.tenantId } });
  if (roles !== roleIds.length) throw new AppError('A stream names a role that is not in this workspace', 422, 'INVALID_STREAM_ROLE');
  const contractorIds = [...new Set(input.streams.map((s) => s.projectContractorId).filter((v): v is string => Boolean(v)))];
  if (contractorIds.length) {
    const found = await prisma.projectContractor.count({ where: { id: { in: contractorIds }, projectId } });
    if (found !== contractorIds.length) throw new AppError('A stream names a contractor that is not on this project', 422, 'INVALID_STREAM_CONTRACTOR');
  }
  const live = project.status === 'ACTIVE';

  await prisma.$transaction(async (tx) => {
    const existing = await tx.projectReportingStream.findMany({ where: { projectId }, select: STREAM_SELECT });
    const byId = new Map(existing.map((s) => [s.id, s]));
    const byKey = new Map(existing.map((s) => [s.key, s]));
    const kept = new Set<string>();
    const changes: string[] = [];

    for (const s of input.streams) {
      const current = (s.id ? byId.get(s.id) : undefined) ?? byKey.get(s.key);
      if (s.id && !byId.has(s.id)) throw new AppError('Reporting stream not found', 404, 'STREAM_NOT_FOUND');
      const cadence: StreamCadence = {
        reportingCadence: s.reportingCadence,
        workWeekDays: s.workWeekDays,
        periodStartDayOfWeek: s.periodStartDayOfWeek,
        customIntervalDays: s.customIntervalDays,
        quarterAnchorMonth: s.quarterAnchorMonth,
        reportDueTime: s.reportDueTime,
        reportGraceMinutes: s.reportGraceMinutes,
        cadenceAnchorDate: s.cadenceAnchorDate,
      };
      const base = {
        key: s.key,
        label: s.label,
        kind: s.kind,
        roleIds: s.roleIds,
        projectContractorId: s.projectContractorId,
        visitType: s.kind === 'INSPECTION' ? s.visitType : null,
        submissionDeadlineDays: s.submissionDeadlineDays,
        isActive: s.isActive,
        sortOrder: s.sortOrder,
      };
      if (!current) {
        const created = await tx.projectReportingStream.create({ data: { projectId, ...base, ...cadence }, select: { id: true } });
        kept.add(created.id);
        changes.push(`added "${s.label}"`);
        continue;
      }
      kept.add(current.id);
      if (live && current.kind !== s.kind) {
        throw new AppError('A live stream cannot change kind; add a new stream instead', 409, 'STREAM_KIND_LOCKED');
      }
      const shapeChanged = STREAM_SHAPE_FIELDS.some((k) => JSON.stringify(cadence[k] ?? null) !== JSON.stringify(current[k] ?? null));
      if (live && current.isActive && shapeChanged) {
        const settings = cadenceSettingsOf(streamCadenceRow(project, current));
        const today = zonedCalendarDate(now, project.timezone);
        const effectiveFrom = nextPeriodStart(settings, now) ?? addDays(today, 1);
        await tx.projectReportingStream.update({
          where: { id: current.id },
          data: {
            ...base,
            // Times and grace apply at once; the period shape waits.
            reportDueTime: cadence.reportDueTime,
            reportGraceMinutes: cadence.reportGraceMinutes,
            pendingCadenceJson: cadence as unknown as Prisma.InputJsonValue,
            pendingCadenceEffectiveFrom: effectiveFrom,
          },
        });
        changes.push(`changed "${s.label}" (new periods from ${effectiveFrom})`);
      } else {
        await tx.projectReportingStream.update({
          where: { id: current.id },
          data: { ...base, ...cadence, pendingCadenceJson: Prisma.DbNull, pendingCadenceEffectiveFrom: null },
        });
        changes.push(`saved "${s.label}"`);
      }
    }

    const dropped = existing.filter((s) => !kept.has(s.id));
    if (dropped.length) {
      if (project.status === 'DRAFT') {
        await tx.projectReportingStream.deleteMany({ where: { id: { in: dropped.map((s) => s.id) } } });
        changes.push(`removed ${dropped.map((s) => `"${s.label}"`).join(', ')}`);
      } else {
        await tx.projectReportingStream.updateMany({ where: { id: { in: dropped.map((s) => s.id) } }, data: { isActive: false } });
        changes.push(`deactivated ${dropped.map((s) => `"${s.label}"`).join(', ')}`);
      }
    }

    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'REPORTING_STREAMS_SAVED',
      summaryText: input.streams.length
        ? `Reporting streams: ${changes.join('; ')}.`
        : 'Removed all reporting streams; the project reports on its default cadence.',
      payload: { streams: input.streams, changes },
    });
  });
  return getProjectReportingStreams(projectId, now);
}

/**
 * Applying a project type to a draft (Phase 11 hook): replaces the draft's streams with the type's.
 * Role codes are resolved in the tenant; a code with no role is skipped (the stream is skipped when
 * none of its codes resolve).
 */
export async function createStreamsFromProjectType(
  tx: Prisma.TransactionClient,
  params: { projectId: string; tenantId: string; streams: ProjectTypeReportingStream[] }
): Promise<string[]> {
  await tx.projectReportingStream.deleteMany({ where: { projectId: params.projectId } });
  if (params.streams.length === 0) return [];
  const codes = [...new Set(params.streams.flatMap((s) => s.roleCodes))];
  const roles = await tx.role.findMany({ where: { tenantId: params.tenantId, code: { in: codes } }, select: { id: true, code: true } });
  const idByCode = new Map(roles.map((r) => [r.code, r.id]));
  const created: string[] = [];
  for (const [i, s] of params.streams.entries()) {
    const roleIds = s.roleCodes.map((c) => idByCode.get(c)).filter((v): v is string => Boolean(v));
    if (roleIds.length === 0) continue;
    await tx.projectReportingStream.create({
      data: {
        projectId: params.projectId,
        key: s.key,
        label: s.label,
        kind: s.kind,
        roleIds,
        reportingCadence: s.reportingCadence,
        workWeekDays: s.workWeekDays,
        periodStartDayOfWeek: s.periodStartDayOfWeek,
        customIntervalDays: s.customIntervalDays,
        quarterAnchorMonth: s.quarterAnchorMonth,
        reportDueTime: s.reportDueTime,
        reportGraceMinutes: s.reportGraceMinutes,
        visitType: s.kind === 'INSPECTION' ? s.visitType : null,
        submissionDeadlineDays: s.submissionDeadlineDays,
        sortOrder: i,
      },
    });
    created.push(s.key);
  }
  return created;
}
