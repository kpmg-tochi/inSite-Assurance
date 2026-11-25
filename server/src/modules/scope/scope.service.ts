import { Prisma } from '@prisma/client';
import {
  CreateFacilityUnitRequest,
  CreateScopeLineRequest,
  addDays,
  deriveSprintStatus,
  FacilityArchetype,
  FacilityUnitDto,
  lineAmount,
  nextUnitCode,
  normalizeUnitOfMeasure,
  ProjectScopeDto,
  ProjectSprintDto,
  SaveSprintsRequest,
  ScopeLineDto,
  sprintDateOrder,
  unitNeedsQuantity,
  unitsActiveInSprint,
  UpdateFacilityUnitRequest,
  UpdateScopeLineRequest,
  validateSprints,
  validateUnits,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { refreshProjectProgress } from '../progress/progress.service';
import { proposeVisitsFromType, realignProposedVisitSprints } from '../visits/visitPlan.service';
import { monitoringConfigOf, webVisitActor } from '../visits/visitCore';
import { markStepSaved } from '../projects/projectSetup.service';
import { loadBoqItemInProject, loadFacilityUnitInProject, loadSprintInProject } from '../../utils/ownership';

/**
 * Redesign R2b: project scope (facility units, scope lines, sprints).
 * - Scope lines are BoqItem rows with `facilityUnitId` (D-R2.1); the amount is rate × quantity.
 * - Every write runs in one transaction with an audit event, then re-derives each line's planned
 *   window from its unit's sprints (D-R2.5) and, on a live project, refreshes progress.
 * - A unit or line with captures, reports, defects or findings cannot be removed (D-R2.10).
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

function actorName(webUser: WebJwtPayload) {
  return `${webUser.fullName} (${webUser.roleName})`;
}

const money = (n: number) => `NGN ${n.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

type LineRow = Prisma.BoqItemGetPayload<object>;

const UNIT_INCLUDE = {
  facility: { select: { id: true, code: true, name: true, archetype: true, isRetired: true, sortOrder: true } },
  startSprint: { select: { id: true, number: true, startDate: true, endDate: true } },
  endSprint: { select: { id: true, number: true, startDate: true, endDate: true } },
} satisfies Prisma.FacilityUnitInclude;
type UnitRow = Prisma.FacilityUnitGetPayload<{ include: typeof UNIT_INCLUDE }>;

/** Items named on a defect ticket (tickets keep a plain item id). */
export async function defectItemIds(db: Db, projectId: string): Promise<Set<string>> {
  const rows = await db.retentionDefectTicket.findMany({
    where: { projectId, boqItemId: { not: null } },
    select: { boqItemId: true },
  });
  return new Set(rows.map((r) => r.boqItemId!));
}

/** A line with progress or a defect cannot be removed (R5f: captures and reports no longer name a line). */
export function lineHasEvidence(line: LineRow, defects: Set<string>): boolean {
  return Number(line.cumulativeCertifiedPct) > 0 || defects.has(line.id);
}

function serializeLine(line: LineRow, defects: Set<string>): ScopeLineDto {
  return {
    id: line.id,
    facilityUnitId: line.facilityUnitId,
    wbsCode: line.wbsCode,
    section: line.section,
    description: line.description,
    unit: line.unit,
    totalQuantity: Number(line.totalQuantity),
    rateNgn: Number(line.rateNgn),
    budgetedCostNgn: Number(line.budgetedCostNgn),
    plannedStartDate: line.plannedStartDate,
    plannedEndDate: line.plannedEndDate,
    cumulativeCertifiedPct: Number(line.cumulativeCertifiedPct),
    hasEvidence: lineHasEvidence(line, defects),
  };
}

function facilitySummary(u: UnitRow) {
  return {
    id: u.facility.id,
    code: u.facility.code,
    name: u.facility.name,
    archetype: u.facility.archetype as FacilityArchetype,
    isRetired: u.facility.isRetired,
  };
}

/**
 * Needs-assessment import is for drafts (D-R2.10) and, UBEC IRL, for a live project created by the
 * register import that has no scope yet (no facility units and no lines): its first scope comes from
 * the needs assessment, and the computed progress then replaces the imported %.
 */
export function scopeImportAllowed(project: { status: string; importedAt: Date | null }, unitCount: number, lineCount: number): boolean {
  if (project.status === 'DRAFT') return true;
  return project.status === 'ACTIVE' && project.importedAt !== null && unitCount === 0 && lineCount === 0;
}

export async function getProjectScope(projectId: string): Promise<ProjectScopeDto> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, status: true, timezone: true, totalBudgetNgn: true, projectTypeSnapshotJson: true, importedAt: true },
  });
  if (!project) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  const verificationDays = monitoringConfigOf(project.projectTypeSnapshotJson).sprintVerificationDays;
  const [sprints, units, lines, defects] = await Promise.all([
    prisma.projectSprint.findMany({ where: { projectId }, orderBy: { number: 'asc' } }),
    prisma.facilityUnit.findMany({
      where: { projectId },
      include: UNIT_INCLUDE,
      orderBy: [{ facility: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { code: 'asc' }],
    }),
    prisma.boqItem.findMany({ where: { projectId }, orderBy: { wbsCode: 'asc' } }),
    defectItemIds(prisma, projectId),
  ]);
  const today = zonedCalendarDate(new Date(), project.timezone);
  const serializedLines = lines.map((l) => serializeLine(l, defects));
  const linesByUnit = new Map<string, ScopeLineDto[]>();
  for (const l of serializedLines) {
    if (!l.facilityUnitId) continue;
    linesByUnit.set(l.facilityUnitId, [...(linesByUnit.get(l.facilityUnitId) ?? []), l]);
  }
  const unitDtos: FacilityUnitDto[] = units.map((u) => {
    const own = linesByUnit.get(u.id) ?? [];
    return {
      id: u.id,
      code: u.code,
      label: u.label,
      facility: facilitySummary(u),
      plannedQuantity: u.plannedQuantity === null ? null : Number(u.plannedQuantity),
      quantityUnit: u.quantityUnit,
      startSprintId: u.startSprintId,
      endSprintId: u.endSprintId,
      startSprintNumber: u.startSprint?.number ?? null,
      endSprintNumber: u.endSprint?.number ?? null,
      sortOrder: u.sortOrder,
      lineCount: own.length,
      amountNgn: own.reduce((s, l) => s + l.budgetedCostNgn, 0),
      hasEvidence: own.some((l) => l.hasEvidence),
    };
  });
  const sprintDtos: ProjectSprintDto[] = sprints.map((s) => ({
    id: s.id,
    number: s.number,
    name: s.name,
    startDate: s.startDate,
    endDate: s.endDate,
    deliverables: s.deliverables,
    status: deriveSprintStatus(s, today, verificationDays),
    verificationOutcome: s.verificationOutcome,
    verifiedAt: s.verifiedAt?.toISOString() ?? null,
    verificationDueDate: addDays(s.endDate, verificationDays),
    unitCount: unitsActiveInSprint(unitDtos, s.number).length,
    referencedByUnits: units.some((u) => u.startSprintId === s.id || u.endSprintId === s.id),
  }));
  const groups = new Map<string, ProjectScopeDto['facilityGroups'][number]>();
  for (const u of unitDtos) {
    const g = groups.get(u.facility.id) ?? { facility: u.facility, unitIds: [], amountNgn: 0 };
    g.unitIds.push(u.id);
    g.amountNgn += u.amountNgn;
    groups.set(u.facility.id, g);
  }
  const amountNgn = serializedLines.reduce((s, l) => s + l.budgetedCostNgn, 0);
  const budget = project.totalBudgetNgn === null ? null : Number(project.totalBudgetNgn);
  return {
    projectId,
    projectStatus: project.status,
    today,
    budgetNgn: budget,
    sprints: sprintDtos,
    units: unitDtos,
    facilityGroups: [...groups.values()],
    lines: serializedLines,
    totals: {
      lineCount: serializedLines.length,
      unitCount: unitDtos.length,
      sprintCount: sprintDtos.length,
      amountNgn: Math.round(amountNgn * 100) / 100,
      unassignedLineCount: serializedLines.filter((l) => !l.facilityUnitId).length,
    },
    budgetWarning: scopeBudgetWarning(amountNgn, budget),
    importAllowed: scopeImportAllowed(project, units.length, lines.length),
  };
}

export function scopeBudgetWarning(amountNgn: number, budgetNgn: number | null): string | null {
  if (budgetNgn === null || amountNgn <= budgetNgn + 0.005) return null;
  return `The scope total (${money(amountNgn)}) is above the project budget (${money(budgetNgn)}).`;
}

// ---------------------------------------------------------------------------
// Shared write path
// ---------------------------------------------------------------------------

interface ScopeWriteContext {
  tx: Tx;
  project: { id: string; tenantId: string; status: string; name: string; codePrefix: string };
  webUser: WebJwtPayload;
}

/**
 * Runs a scope write: project row locked, then the change, the date derivation (D-R2.5), progress
 * on a live project, and the setup step marked saved on a draft.
 */
export async function runScopeWrite<T>(
  projectId: string,
  webUser: WebJwtPayload,
  fn: (ctx: ScopeWriteContext) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUnique({
      where: { id: projectId },
      select: { id: true, tenantId: true, status: true, name: true, codePrefix: true },
    });
    if (!project) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
    if (project.status === 'ARCHIVED') throw new AppError('This project is archived and read-only', 409, 'PROJECT_ARCHIVED');
    const result = await fn({ tx, project, webUser });
    await deriveLineDatesFromSprints(tx, projectId);
    if (project.status === 'ACTIVE') await refreshProjectProgress(tx, projectId);
    if (project.status === 'DRAFT') await markStepSaved(tx, projectId, 'scope', webUser.userId);
    return result;
  });
}

/**
 * D-R2.5: each line of a unit gets its planned window from the unit's start sprint start and end
 * sprint end (null while either is missing). Lines without a unit keep their dates (legacy).
 * R2d: the project's planned start and end follow the first and last sprint (the on-time KPI reads
 * them); the original planned end is fixed while the project is a draft, and kept once it is live.
 */
export async function deriveLineDatesFromSprints(tx: Tx, projectId: string): Promise<void> {
  const units = await tx.facilityUnit.findMany({
    where: { projectId },
    select: {
      id: true,
      startSprint: { select: { startDate: true } },
      endSprint: { select: { endDate: true } },
    },
  });
  for (const u of units) {
    const start = u.startSprint && u.endSprint ? u.startSprint.startDate : null;
    const end = u.startSprint && u.endSprint ? u.endSprint.endDate : null;
    await tx.boqItem.updateMany({
      where: { projectId, facilityUnitId: u.id, OR: [{ plannedStartDate: { not: start } }, { plannedEndDate: { not: end } }, { plannedStartDate: null }, { plannedEndDate: null }] },
      data: { plannedStartDate: start, plannedEndDate: end },
    });
  }
  const sprints = await tx.projectSprint.findMany({ where: { projectId }, orderBy: { number: 'asc' }, select: { startDate: true, endDate: true } });
  if (sprints.length === 0) return;
  const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { status: true, originalPlannedEndDate: true } });
  const plannedEndDate = sprints[sprints.length - 1].endDate;
  await tx.project.update({
    where: { id: projectId },
    data: {
      plannedStartDate: sprints[0].startDate,
      plannedEndDate,
      ...(project.status === 'DRAFT' || !project.originalPlannedEndDate ? { originalPlannedEndDate: plannedEndDate } : {}),
    },
  });
}

async function audit(ctx: ScopeWriteContext, action: 'SCOPE_UPDATED' | 'SPRINTS_SAVED', summaryText: string, payload: Record<string, unknown>) {
  await recordAuditEvent(ctx.tx, {
    projectId: ctx.project.id,
    actorType: 'WEB_USER',
    actorId: ctx.webUser.userId,
    actorDisplayName: actorName(ctx.webUser),
    action,
    summaryText,
    payload: { projectStatus: ctx.project.status, ...payload },
  });
}

// ---------------------------------------------------------------------------
// Sprints
// ---------------------------------------------------------------------------

/**
 * Replaces the sprint list. Numbers follow date order. A sprint left out is removed: on a draft the
 * units that used it lose it; on a live project that is refused. Units must still start no later
 * than they end after the renumbering.
 */
export async function saveSprints(projectId: string, webUser: WebJwtPayload, input: SaveSprintsRequest): Promise<ProjectScopeDto> {
  const issues = validateSprints(input.sprints);
  if (issues.length) throw new AppError(issues[0].message, 422, 'SPRINTS_INVALID', { issues });
  await runScopeWrite(projectId, webUser, async (ctx) => {
    const { tx } = ctx;
    const existing = await tx.projectSprint.findMany({ where: { projectId }, orderBy: { number: 'asc' } });
    const byId = new Map(existing.map((s) => [s.id, s]));
    for (const s of input.sprints) {
      if (s.id && !byId.has(s.id)) throw new AppError('Sprint not found', 404, 'SPRINT_NOT_FOUND');
    }
    const keptIds = new Set(input.sprints.map((s) => s.id).filter(Boolean) as string[]);
    const removed = existing.filter((s) => !keptIds.has(s.id));
    if (removed.length && ctx.project.status !== 'DRAFT') {
      const used = await tx.facilityUnit.findFirst({
        where: { projectId, OR: [{ startSprintId: { in: removed.map((s) => s.id) } }, { endSprintId: { in: removed.map((s) => s.id) } }] },
        include: { startSprint: true, endSprint: true },
      });
      if (used) {
        throw new AppError(
          `Unit ${used.code} (${used.label}) starts or ends in a sprint you removed. Move the unit first.`,
          409,
          'SPRINT_IN_USE'
        );
      }
    }
    if (removed.length) {
      // Redesign R6d (D-R6.23): a sprint a payment names (voided ones included) is kept.
      const paid = await tx.projectPayment.findFirst({
        where: { projectId, sprintId: { in: removed.map((s) => s.id) } },
        include: { sprint: { select: { number: true, name: true } } },
      });
      if (paid) {
        throw new AppError(
          `Payment ${paid.reference} is recorded against sprint ${paid.sprint!.number} (${paid.sprint!.name}). A sprint a payment names cannot be removed.`,
          409,
          'SPRINT_IN_USE'
        );
      }
    }
    if (removed.length) await tx.projectSprint.deleteMany({ where: { id: { in: removed.map((s) => s.id) } } });
    // Free the numbers first so renumbering cannot collide on (projectId, number).
    const kept = existing.filter((s) => keptIds.has(s.id));
    for (const [i, s] of kept.entries()) await tx.projectSprint.update({ where: { id: s.id }, data: { number: -(i + 1) } });

    const ordered = sprintDateOrder(input.sprints);
    const changes: Array<Record<string, unknown>> = [];
    let added = 0;
    for (const [i, s] of ordered.entries()) {
      const prior = s.id ? byId.get(s.id) : undefined;
      const data = { number: i + 1, name: s.name, startDate: s.startDate, endDate: s.endDate, deliverables: s.deliverables ?? prior?.deliverables ?? '' };
      if (s.id) {
        const before = byId.get(s.id)!;
        await tx.projectSprint.update({ where: { id: s.id }, data });
        const fields = (['number', 'name', 'startDate', 'endDate', 'deliverables'] as const).filter((k) => before[k] !== data[k]);
        if (fields.length) {
          changes.push({
            sprintId: s.id,
            fields,
            before: Object.fromEntries(fields.map((k) => [k, before[k]])),
            after: Object.fromEntries(fields.map((k) => [k, data[k]])),
          });
        }
      } else {
        await tx.projectSprint.create({ data: { projectId, ...data } });
        added += 1;
      }
    }

    // Renumbering by date can put a unit's end sprint before its start sprint.
    const units = await tx.facilityUnit.findMany({
      where: { projectId },
      include: { facility: { select: { archetype: true } }, startSprint: { select: { number: true } }, endSprint: { select: { number: true } } },
    });
    const orderIssues = validateUnits(
      units.map((u) => ({
        code: u.code,
        label: u.label,
        archetype: u.facility.archetype as FacilityArchetype,
        plannedQuantity: u.plannedQuantity === null ? null : Number(u.plannedQuantity),
        startSprintNumber: u.startSprint?.number ?? null,
        endSprintNumber: u.endSprint?.number ?? null,
      }))
    ).filter((i) => i.code === 'UNIT_SPRINT_ORDER');
    if (orderIssues.length) throw new AppError(orderIssues[0].message, 422, 'UNIT_SPRINT_ORDER', { issues: orderIssues });

    const parts = [added && `${added} added`, changes.length && `${changes.length} changed`, removed.length && `${removed.length} removed`].filter(Boolean);
    await audit(ctx, 'SPRINTS_SAVED', `Saved ${ordered.length} sprint(s)${parts.length ? ` (${parts.join(', ')})` : ' (no changes)'}.`, {
      sprintCount: ordered.length,
      added,
      changed: changes,
      removed: removed.map((s) => ({ id: s.id, number: s.number, name: s.name, startDate: s.startDate, endDate: s.endDate })),
    });
    // Redesign R4 (D-R4.12): sprint-driven visit plan rules follow the new sprints (proposed visits only).
    if (ctx.project.status === 'ACTIVE') {
      await realignProposedVisitSprints(tx, projectId);
      await proposeVisitsFromType(tx, projectId, { trigger: 'SPRINTS_SAVED', actor: webVisitActor(webUser) });
    }
  });
  return getProjectScope(projectId);
}

// ---------------------------------------------------------------------------
// Facility units
// ---------------------------------------------------------------------------

async function loadUsableFacility(tx: Tx, tenantId: string, facilityId: string, allowRetiredId?: string) {
  const facility = await tx.facility.findFirst({ where: { id: facilityId, tenantId } });
  if (!facility) throw new AppError('Facility not found', 404, 'FACILITY_NOT_FOUND');
  if (facility.isRetired && facility.id !== allowRetiredId) {
    throw new AppError(`"${facility.name}" is retired and cannot be added to scope.`, 409, 'FACILITY_RETIRED');
  }
  return facility;
}

async function sprintNumber(tx: Tx, projectId: string, sprintId: string | null | undefined): Promise<number | null> {
  if (!sprintId) return null;
  return (await loadSprintInProject(tx, projectId, sprintId)).number;
}

function quantityFields(archetype: FacilityArchetype, plannedQuantity: number | null | undefined, quantityUnit: string | null | undefined) {
  if (!unitNeedsQuantity(archetype)) return { plannedQuantity: null, quantityUnit: null };
  if (!(typeof plannedQuantity === 'number' && plannedQuantity > 0)) {
    throw new AppError('A supply item needs its planned quantity.', 422, 'UNIT_QUANTITY_REQUIRED');
  }
  return { plannedQuantity, quantityUnit: quantityUnit ?? 'nr' };
}

function assertSprintOrder(start: number | null, end: number | null) {
  if (start !== null && end !== null && start > end) {
    throw new AppError(`The unit cannot end (sprint ${end}) before it starts (sprint ${start}).`, 422, 'UNIT_SPRINT_ORDER');
  }
}

function uniqueCodeError(error: unknown, code: string): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new AppError(`Unit ID ${code} is already used on this project.`, 409, 'UNIT_CODE_EXISTS');
  }
  throw error;
}

function unitSnapshot(u: { code: string; label: string; facilityId: string; plannedQuantity: unknown; quantityUnit: string | null; startSprintId: string | null; endSprintId: string | null }) {
  return {
    code: u.code,
    label: u.label,
    facilityId: u.facilityId,
    plannedQuantity: u.plannedQuantity === null || u.plannedQuantity === undefined ? null : Number(u.plannedQuantity),
    quantityUnit: u.quantityUnit,
    startSprintId: u.startSprintId,
    endSprintId: u.endSprintId,
  };
}

export async function createFacilityUnit(projectId: string, webUser: WebJwtPayload, input: CreateFacilityUnitRequest): Promise<ProjectScopeDto> {
  let code = input.code ?? '';
  try {
    await runScopeWrite(projectId, webUser, async (ctx) => {
      const { tx } = ctx;
      const facility = await loadUsableFacility(tx, ctx.project.tenantId, input.facilityId);
      const start = await sprintNumber(tx, projectId, input.startSprintId);
      const end = await sprintNumber(tx, projectId, input.endSprintId);
      assertSprintOrder(start, end);
      const q = quantityFields(facility.archetype as FacilityArchetype, input.plannedQuantity, input.quantityUnit);
      const existing = await tx.facilityUnit.findMany({ where: { projectId }, select: { code: true, sortOrder: true } });
      code = input.code ?? nextUnitCode(existing.map((u) => u.code));
      const unit = await tx.facilityUnit.create({
        data: {
          projectId,
          facilityId: facility.id,
          code,
          label: input.label,
          ...q,
          startSprintId: input.startSprintId ?? null,
          endSprintId: input.endSprintId ?? null,
          sortOrder: input.sortOrder ?? Math.max(0, ...existing.map((u) => u.sortOrder)) + 10,
        },
      });
      await audit(ctx, 'SCOPE_UPDATED', `Added facility unit ${unit.code} "${unit.label}" (${facility.name}).`, {
        entity: 'FACILITY_UNIT',
        operation: 'CREATE',
        unitId: unit.id,
        after: unitSnapshot(unit),
      });
    });
  } catch (error) {
    uniqueCodeError(error, code);
  }
  return getProjectScope(projectId);
}

export async function updateFacilityUnit(
  projectId: string,
  unitId: string,
  webUser: WebJwtPayload,
  input: UpdateFacilityUnitRequest
): Promise<ProjectScopeDto> {
  try {
    await runScopeWrite(projectId, webUser, async (ctx) => {
      const { tx } = ctx;
      const before = await loadFacilityUnitInProject(tx, projectId, unitId);
      const facilityId = input.facilityId ?? before.facilityId;
      const facility = await loadUsableFacility(tx, ctx.project.tenantId, facilityId, before.facilityId);
      const startSprintId = input.startSprintId === undefined ? before.startSprintId : input.startSprintId;
      const endSprintId = input.endSprintId === undefined ? before.endSprintId : input.endSprintId;
      assertSprintOrder(await sprintNumber(tx, projectId, startSprintId), await sprintNumber(tx, projectId, endSprintId));
      const q = quantityFields(
        facility.archetype as FacilityArchetype,
        input.plannedQuantity === undefined ? (before.plannedQuantity === null ? null : Number(before.plannedQuantity)) : input.plannedQuantity,
        input.quantityUnit === undefined ? before.quantityUnit : input.quantityUnit
      );
      const after = await tx.facilityUnit.update({
        where: { id: before.id },
        data: {
          facilityId,
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...q,
          startSprintId,
          endSprintId,
        },
      });
      // Lines show the facility name as their section.
      if (facilityId !== before.facilityId) {
        await tx.boqItem.updateMany({ where: { facilityUnitId: before.id }, data: { section: facility.name } });
      }
      const b = unitSnapshot(before);
      const a = unitSnapshot(after);
      const fields = (Object.keys(a) as Array<keyof typeof a>).filter((k) => b[k] !== a[k]);
      await audit(
        ctx,
        'SCOPE_UPDATED',
        `Changed facility unit ${after.code} "${after.label}"${fields.length ? ` (${fields.join(', ')})` : ' (no changes)'}.`,
        {
          entity: 'FACILITY_UNIT',
          operation: 'UPDATE',
          unitId: after.id,
          before: Object.fromEntries(fields.map((k) => [k, b[k]])),
          after: Object.fromEntries(fields.map((k) => [k, a[k]])),
        }
      );
    });
  } catch (error) {
    uniqueCodeError(error, input.code ?? '');
  }
  return getProjectScope(projectId);
}

/** Removes a unit and its lines; refused when any line has evidence. */
export async function deleteFacilityUnit(projectId: string, unitId: string, webUser: WebJwtPayload): Promise<ProjectScopeDto> {
  await runScopeWrite(projectId, webUser, async (ctx) => {
    const { tx } = ctx;
    const unit = await loadFacilityUnitInProject(tx, projectId, unitId);
    const lines = await tx.boqItem.findMany({ where: { facilityUnitId: unit.id } });
    const defects = await defectItemIds(tx, projectId);
    const withEvidence = lines.find((l) => lineHasEvidence(l, defects));
    if (withEvidence) {
      throw new AppError(
        `Unit ${unit.code} cannot be removed: line ${withEvidence.wbsCode} has field evidence, reports or defects.`,
        409,
        'UNIT_HAS_EVIDENCE'
      );
    }
    if (lines.length) await tx.boqItem.deleteMany({ where: { id: { in: lines.map((l) => l.id) } } });
    await tx.facilityUnit.delete({ where: { id: unit.id } });
    await audit(ctx, 'SCOPE_UPDATED', `Removed facility unit ${unit.code} "${unit.label}" and its ${lines.length} line(s).`, {
      entity: 'FACILITY_UNIT',
      operation: 'DELETE',
      unitId: unit.id,
      before: unitSnapshot(unit),
      removedLines: lines.map((l) => ({ id: l.id, wbsCode: l.wbsCode, budgetedCostNgn: Number(l.budgetedCostNgn) })),
    });
  });
  return getProjectScope(projectId);
}

// ---------------------------------------------------------------------------
// Scope lines
// ---------------------------------------------------------------------------

function lineSnapshot(l: { wbsCode: string; description: string; unit: string; totalQuantity: unknown; rateNgn: unknown; budgetedCostNgn: unknown; facilityUnitId: string | null }) {
  return {
    wbsCode: l.wbsCode,
    description: l.description,
    unit: l.unit,
    totalQuantity: Number(l.totalQuantity),
    rateNgn: Number(l.rateNgn),
    budgetedCostNgn: Number(l.budgetedCostNgn),
    facilityUnitId: l.facilityUnitId,
  };
}

function duplicateWbs(error: unknown, wbsCode: string | undefined): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new AppError(`Item no. ${wbsCode} is already used on this project.`, 409, 'DUPLICATE_WBS_CODE');
  }
  throw error;
}

export async function createScopeLine(projectId: string, webUser: WebJwtPayload, input: CreateScopeLineRequest): Promise<ProjectScopeDto> {
  try {
    await runScopeWrite(projectId, webUser, async (ctx) => {
      const { tx } = ctx;
      const unit = await loadFacilityUnitInProject(tx, projectId, input.facilityUnitId);
      const facility = await tx.facility.findUniqueOrThrow({ where: { id: unit.facilityId }, select: { name: true } });
      const line = await tx.boqItem.create({
        data: {
          projectId,
          facilityUnitId: unit.id,
          wbsCode: input.wbsCode,
          section: facility.name,
          description: input.description,
          unit: input.unit,
          totalQuantity: input.totalQuantity,
          rateNgn: input.rateNgn,
          budgetedCostNgn: lineAmount(input.totalQuantity, input.rateNgn),
        },
      });
      await audit(ctx, 'SCOPE_UPDATED', `Added scope line ${line.wbsCode} to unit ${unit.code} (${money(Number(line.budgetedCostNgn))}).`, {
        entity: 'SCOPE_LINE',
        operation: 'CREATE',
        lineId: line.id,
        after: lineSnapshot(line),
      });
    });
  } catch (error) {
    duplicateWbs(error, input.wbsCode);
  }
  return getProjectScope(projectId);
}

export async function updateScopeLine(
  projectId: string,
  lineId: string,
  webUser: WebJwtPayload,
  input: UpdateScopeLineRequest
): Promise<ProjectScopeDto> {
  try {
    await runScopeWrite(projectId, webUser, async (ctx) => {
      const { tx } = ctx;
      const before = await loadBoqItemInProject(tx, projectId, lineId);
      let unitOfMeasure = before.unit;
      if (input.unit !== undefined && input.unit !== before.unit) {
        const normalized = normalizeUnitOfMeasure(input.unit);
        if (!normalized) throw new AppError(`"${input.unit}" is not a unit of measure on the list.`, 422, 'UNIT_OF_MEASURE_UNKNOWN');
        unitOfMeasure = normalized;
      }
      const unitId = input.facilityUnitId ?? before.facilityUnitId;
      let section = before.section;
      if (input.facilityUnitId && input.facilityUnitId !== before.facilityUnitId) {
        const unit = await loadFacilityUnitInProject(tx, projectId, input.facilityUnitId);
        section = (await tx.facility.findUniqueOrThrow({ where: { id: unit.facilityId }, select: { name: true } })).name;
      }
      const quantity = input.totalQuantity ?? Number(before.totalQuantity);
      const rate = input.rateNgn ?? Number(before.rateNgn);
      // Work already done stays inside the line (as the BOQ revision rule did).
      const donePct = Number(before.cumulativeCertifiedPct);
      if (donePct > 0) {
        const doneQty = (donePct / 100) * Number(before.totalQuantity);
        if (quantity + 1e-9 < doneQty) {
          throw new AppError(
            `${before.wbsCode}: quantity ${quantity} is below the quantity already done (${doneQty.toFixed(3)}).`,
            409,
            'BOQ_BELOW_CERTIFIED'
          );
        }
      }
      const after = await tx.boqItem.update({
        where: { id: before.id },
        data: {
          ...(input.wbsCode !== undefined ? { wbsCode: input.wbsCode } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          unit: unitOfMeasure,
          facilityUnitId: unitId,
          section,
          totalQuantity: quantity,
          rateNgn: rate,
          budgetedCostNgn: lineAmount(quantity, rate),
        },
      });
      const b = lineSnapshot(before);
      const a = lineSnapshot(after);
      const fields = (Object.keys(a) as Array<keyof typeof a>).filter((k) => b[k] !== a[k]);
      await audit(ctx, 'SCOPE_UPDATED', `Changed scope line ${after.wbsCode}${fields.length ? ` (${fields.join(', ')})` : ' (no changes)'}.`, {
        entity: 'SCOPE_LINE',
        operation: 'UPDATE',
        lineId: after.id,
        before: Object.fromEntries(fields.map((k) => [k, b[k]])),
        after: Object.fromEntries(fields.map((k) => [k, a[k]])),
      });
    });
  } catch (error) {
    duplicateWbs(error, input.wbsCode);
  }
  return getProjectScope(projectId);
}

export async function deleteScopeLine(projectId: string, lineId: string, webUser: WebJwtPayload): Promise<ProjectScopeDto> {
  await runScopeWrite(projectId, webUser, async (ctx) => {
    const { tx } = ctx;
    await loadBoqItemInProject(tx, projectId, lineId);
    const line = await tx.boqItem.findUniqueOrThrow({ where: { id: lineId } });
    if (lineHasEvidence(line, await defectItemIds(tx, projectId))) {
      throw new AppError(`Line ${line.wbsCode} has field evidence, reports or defects and cannot be removed.`, 409, 'LINE_HAS_EVIDENCE');
    }
    await tx.boqItem.delete({ where: { id: line.id } });
    await audit(ctx, 'SCOPE_UPDATED', `Removed scope line ${line.wbsCode} (${money(Number(line.budgetedCostNgn))}).`, {
      entity: 'SCOPE_LINE',
      operation: 'DELETE',
      lineId: line.id,
      before: lineSnapshot(line),
    });
  });
  return getProjectScope(projectId);
}
