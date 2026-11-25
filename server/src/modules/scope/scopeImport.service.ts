import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import {
  FacilityArchetype,
  GeofenceMode,
  RadialGeofenceSchema,
  SCOPE_WORKBOOK_MAX_BYTES,
  SCOPE_WORKBOOK_PROJECT_FIELDS,
  SCOPE_WORKBOOK_SHEETS,
  ScopeImportConfirmRequest,
  ScopeImportPreviewRequest,
  ScopeImportResultDto,
  ScopeWorkbookIssue,
  ScopeWorkbookPreviewDto,
  ScopeWorkbookProjectChange,
  ScopeWorkbookProjectFieldKey,
  FundingSourceSchema,
  InterventionYearSchema,
  parseSheetNumber,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { applyProjectTypeToProject } from '../projectTypes/projectTypes.service';
import { ensureFacilities } from '../facilities/facilities.service';
import { defectItemIds, getProjectScope, lineHasEvidence, runScopeWrite, scopeImportAllowed } from './scope.service';
import { proposeVisitsFromType } from '../visits/visitPlan.service';
import { webVisitActor } from '../visits/visitCore';
import { buildScopeWorkbook, parseScopeWorkbook, ParsedScopeWorkbook, WorkbookFacility } from './workbook/scopeWorkbook';

/**
 * Redesign R2c: the needs-assessment workbook for a project (D-R2.8 to D-R2.11).
 * - Download: pre-filled from the project when it has data, so a draft can round-trip.
 * - Preview: parses and validates; nothing is written.
 * - Confirm: re-parses the same bytes (sha256 must match the preview), refuses errors, then replaces
 *   the draft's sprints, units and lines in one transaction and fills empty project fields.
 * Live projects refuse import (changes go through the scope page, audited).
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const money = (n: number) => `NGN ${n.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;

const PROJECT_SELECT = {
  id: true,
  tenantId: true,
  name: true,
  codePrefix: true,
  status: true,
  setupState: true,
  lgaLocation: true,
  totalBudgetNgn: true,
  siteAddress: true,
  strategicJustification: true,
  assumptions: true,
  interventionYear: true,
  fundingSource: true,
  importedAt: true,
  geofenceGeoJson: true,
  projectTypeId: true,
  owningOrganizationId: true,
  lenderOrganizationId: true,
  regionId: true,
  region: { select: { name: true } },
  projectType: { select: { name: true } },
  beneficiaries: { where: { isPrimary: true }, select: { name: true }, take: 1 },
  tenant: { select: { name: true, enabledGeofenceModes: true, defaultGeofenceRadiusMeters: true } },
} satisfies Prisma.ProjectSelect;
type ProjectRow = Prisma.ProjectGetPayload<{ select: typeof PROJECT_SELECT }>;

async function loadProject(db: Db, projectId: string): Promise<ProjectRow> {
  const p = await db.project.findUnique({ where: { id: projectId }, select: PROJECT_SELECT });
  if (!p) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  return p;
}

async function tenantFacilities(db: Db, tenantId: string): Promise<WorkbookFacility[]> {
  await ensureFacilities(db, tenantId);
  const rows = await db.facility.findMany({ where: { tenantId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }] });
  return rows.map((f) => ({ id: f.id, code: f.code, name: f.name, archetype: f.archetype as FacilityArchetype, isRetired: f.isRetired }));
}

function radialCenter(geofence: unknown): { latitude: number; longitude: number } | null {
  const g = RadialGeofenceSchema.safeParse(geofence);
  return g.success ? g.data.center : null;
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/**
 * Short workspace name for the title bands and the template's file name: the acronym in brackets
 * ("Universal Basic Education Commission (UBEC)" → "UBEC"), else a short name, else none.
 */
export function workspaceShortName(name: string | null | undefined): string | null {
  const t = (name ?? '').trim();
  const acronym = /\(([A-Za-z0-9&.-]{2,12})\)\s*$/.exec(t)?.[1];
  if (acronym) return acronym;
  return t && t.length <= 24 ? t : null;
}

/** "UBEC needs assessment template.xlsx"; "Needs assessment template.xlsx" when the name is long. */
export function templateFileName(tenantName: string | null | undefined): string {
  const short = workspaceShortName(tenantName);
  return short ? `${short} needs assessment template.xlsx` : 'Needs assessment template.xlsx';
}

/** "PRG-101 needs assessment.xlsx". */
export const projectNeedsAssessmentFileName = (codePrefix: string) => `${codePrefix} needs assessment.xlsx`;

/**
 * The blank "Needs assessment template" with the workspace's live lists (Forms & facilities, and
 * the Needs Assessment module later). It imports into any draft like a project's own download.
 */
export async function buildTenantScopeWorkbook(tenantId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const [tenant, facilities, regions, types] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } }),
    tenantFacilities(prisma, tenantId),
    prisma.region.findMany({ where: { tenantId, isArchived: false }, orderBy: { name: 'asc' }, select: { name: true } }),
    prisma.projectType.findMany({ where: { tenantId, isActive: true }, orderBy: { name: 'asc' }, select: { name: true } }),
  ]);
  const buffer = await buildScopeWorkbook({
    generatedAt: new Date(),
    title: null,
    brandName: workspaceShortName(tenant.name),
    project: {},
    facilities: facilities.filter((f) => !f.isRetired),
    regions: regions.map((r) => r.name),
    deliveryModels: types.map((t) => t.name),
    sprints: [],
    units: [],
    lines: [],
  });
  return { buffer, fileName: templateFileName(tenant.name) };
}

export async function buildProjectScopeWorkbook(projectId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const project = await loadProject(prisma, projectId);
  const [facilities, regions, types, sprints, units, lines] = await Promise.all([
    tenantFacilities(prisma, project.tenantId),
    prisma.region.findMany({ where: { tenantId: project.tenantId, isArchived: false }, orderBy: { name: 'asc' }, select: { name: true } }),
    prisma.projectType.findMany({ where: { tenantId: project.tenantId, isActive: true }, orderBy: { name: 'asc' }, select: { name: true } }),
    prisma.projectSprint.findMany({ where: { projectId }, orderBy: { number: 'asc' } }),
    prisma.facilityUnit.findMany({
      where: { projectId },
      include: { facility: true, startSprint: { select: { number: true } }, endSprint: { select: { number: true } } },
      orderBy: [{ facility: { sortOrder: 'asc' } }, { sortOrder: 'asc' }, { code: 'asc' }],
    }),
    prisma.boqItem.findMany({
      where: { projectId, facilityUnitId: { not: null } },
      include: { facilityUnit: { select: { code: true } } },
      orderBy: { wbsCode: 'asc' },
    }),
  ]);
  const center = radialCenter(project.geofenceGeoJson);
  const buffer = await buildScopeWorkbook({
    generatedAt: new Date(),
    title: `${project.codePrefix} · ${project.name}`,
    brandName: workspaceShortName(project.tenant.name),
    project: {
      name: project.name,
      school: project.beneficiaries[0]?.name ?? null,
      region: project.region?.name ?? null,
      lga: project.lgaLocation,
      siteAddress: project.siteAddress,
      latitude: center?.latitude ?? null,
      longitude: center?.longitude ?? null,
      deliveryModel: project.projectType?.name ?? null,
      budget: project.totalBudgetNgn === null ? null : Number(project.totalBudgetNgn),
      interventionYear: project.interventionYear,
      fundingSource: project.fundingSource,
      strategicJustification: project.strategicJustification,
      assumptions: project.assumptions,
    },
    facilities: facilities.filter((f) => !f.isRetired),
    regions: regions.map((r) => r.name),
    deliveryModels: types.map((t) => t.name),
    sprints: sprints.map((s) => ({ number: s.number, name: s.name, startDate: s.startDate, endDate: s.endDate, deliverables: s.deliverables })),
    units: units.map((u) => ({
      code: u.code,
      facilityName: u.facility.name,
      label: u.label,
      plannedQuantity: u.plannedQuantity === null ? null : Number(u.plannedQuantity),
      quantityUnit: u.quantityUnit,
      startSprint: u.startSprint?.number ?? null,
      endSprint: u.endSprint?.number ?? null,
    })),
    lines: lines.map((l) => ({
      wbsCode: l.wbsCode,
      unitCode: l.facilityUnit!.code,
      description: l.description,
      unit: l.unit,
      totalQuantity: Number(l.totalQuantity),
      rateNgn: Number(l.rateNgn),
    })),
  });
  return { buffer, fileName: projectNeedsAssessmentFileName(project.codePrefix) };
}

// ---------------------------------------------------------------------------
// Analysis shared by preview and confirm
// ---------------------------------------------------------------------------

interface ProjectFill {
  changes: ScopeWorkbookProjectChange[];
  warnings: ScopeWorkbookIssue[];
  /** What confirm writes (only FILL rows). */
  apply: {
    data: Prisma.ProjectUncheckedUpdateInput;
    schoolName: string | null;
    projectTypeId: string | null;
    budget: number | null;
  };
}

const sameText = (a: string | null | undefined, b: string | null | undefined) =>
  (a ?? '').trim().toLowerCase() === (b ?? '').trim().toLowerCase();

async function projectFill(db: Db, project: ProjectRow, wb: Partial<Record<ScopeWorkbookProjectFieldKey, string>>): Promise<ProjectFill> {
  const changes: ScopeWorkbookProjectChange[] = [];
  const warnings: ScopeWorkbookIssue[] = [];
  const apply: ProjectFill['apply'] = { data: {}, schoolName: null, projectTypeId: null, budget: null };
  const label = (key: ScopeWorkbookProjectFieldKey) => SCOPE_WORKBOOK_PROJECT_FIELDS.find((f) => f.key === key)!.label;
  const warn = (column: string, code: string, message: string) =>
    warnings.push({ sheet: SCOPE_WORKBOOK_SHEETS.project, row: null, column, code, message });
  const compare = (field: string, fieldLabel: string, workbookValue: string, currentValue: string | null, equal: boolean) => {
    const action: ScopeWorkbookProjectChange['action'] = currentValue === null || currentValue === '' ? 'FILL' : equal ? 'SAME' : 'KEEP';
    changes.push({ field, label: fieldLabel, workbookValue, currentValue, action });
    if (action === 'KEEP') {
      warn(fieldLabel, 'PROJECT_FIELD_DIFFERS', `${fieldLabel}: the needs assessment says "${workbookValue}" but the project has "${currentValue}". The project value is kept.`);
    }
    return action === 'FILL';
  };

  if (wb.name) compare('name', label('name'), wb.name, project.name, sameText(wb.name, project.name));
  for (const [key, column] of [
    ['lga', 'lgaLocation'],
    ['siteAddress', 'siteAddress'],
    ['strategicJustification', 'strategicJustification'],
    ['assumptions', 'assumptions'],
  ] as const) {
    const v = wb[key];
    if (!v) continue;
    const current = project[column] ?? null;
    if (compare(column, label(key), v, current, sameText(v, current))) apply.data[column] = v;
  }
  // UBEC IRL register fields.
  if (wb.fundingSource) {
    const f = FundingSourceSchema.safeParse(wb.fundingSource);
    if (!f.success) warn(label('fundingSource'), 'INVALID_VALUE', `Funding source "${wb.fundingSource}": ${f.error.issues[0]?.message ?? 'invalid'}; ignored.`);
    else if (compare('fundingSource', label('fundingSource'), f.data, project.fundingSource, sameText(f.data, project.fundingSource))) apply.data.fundingSource = f.data;
  }
  if (wb.interventionYear) {
    const y = InterventionYearSchema.safeParse(parseSheetNumber(wb.interventionYear));
    if (!y.success) warn(label('interventionYear'), 'INVALID_YEAR', `Intervention year "${wb.interventionYear}" is not a year from 2000 to 2100; ignored.`);
    else {
      const current = project.interventionYear === null ? null : String(project.interventionYear);
      if (compare('interventionYear', label('interventionYear'), String(y.data), current, project.interventionYear === y.data)) apply.data.interventionYear = y.data;
    }
  }
  if (wb.school) {
    const current = project.beneficiaries[0]?.name ?? null;
    if (compare('school', label('school'), wb.school, current, sameText(wb.school, current))) apply.schoolName = wb.school;
  }
  if (wb.budget) {
    const n = Number(String(wb.budget).replace(/[^\d.-]/g, ''));
    if (!Number.isFinite(n) || n <= 0) {
      warn(label('budget'), 'INVALID_NUMBER', `Budget "${wb.budget}" is not a number; ignored.`);
    } else {
      const current = project.totalBudgetNgn === null ? null : Number(project.totalBudgetNgn);
      if (compare('totalBudgetNgn', label('budget'), money(n), current === null ? null : money(current), current !== null && Math.abs(current - n) < 0.005)) {
        apply.data.totalBudgetNgn = n;
        apply.budget = n;
      }
    }
  }
  if (wb.region) {
    const region = await db.region.findFirst({
      where: { tenantId: project.tenantId, isArchived: false, OR: [{ name: { equals: wb.region, mode: 'insensitive' } }, { code: { equals: wb.region, mode: 'insensitive' } }] },
      select: { id: true, name: true },
    });
    if (!region) warn(label('region'), 'UNKNOWN_REGION', `Zone or state "${wb.region}" is not on the list; ignored.`);
    else if (compare('regionId', label('region'), region.name, project.region?.name ?? null, region.id === project.regionId)) apply.data.regionId = region.id;
  }
  if (wb.deliveryModel) {
    const type = await db.projectType.findFirst({
      where: { tenantId: project.tenantId, isActive: true, OR: [{ name: { equals: wb.deliveryModel, mode: 'insensitive' } }, { code: { equals: wb.deliveryModel, mode: 'insensitive' } }] },
      select: { id: true, name: true },
    });
    if (!type) warn(label('deliveryModel'), 'UNKNOWN_DELIVERY_MODEL', `Delivery model "${wb.deliveryModel}" is not on the list; ignored.`);
    else if (compare('projectTypeId', label('deliveryModel'), type.name, project.projectType?.name ?? null, type.id === project.projectTypeId)) {
      if (project.status === 'DRAFT') apply.projectTypeId = type.id;
      else {
        // A live project's type is fixed at activation (PROJECT_TYPE_LOCKED).
        changes[changes.length - 1].action = 'KEEP';
        warn(label('deliveryModel'), 'PROJECT_TYPE_LOCKED', 'The delivery model of a live project cannot change; ignored.');
      }
    }
  }
  if (wb.latitude || wb.longitude) {
    const lat = Number(wb.latitude);
    const lng = Number(wb.longitude);
    if (!wb.latitude || !wb.longitude || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
      warn('Latitude', 'INVALID_GPS', 'Enter both latitude and longitude in decimal degrees; the GPS point is ignored.');
    } else {
      const center = radialCenter(project.geofenceGeoJson);
      const current = project.geofenceGeoJson ? (center ? `${center.latitude}, ${center.longitude}` : 'a drawn site boundary') : null;
      const equal = Boolean(center && Math.abs(center.latitude - lat) < 1e-6 && Math.abs(center.longitude - lng) < 1e-6);
      const modes = (project.tenant.enabledGeofenceModes as GeofenceMode[]) ?? [];
      if (!project.geofenceGeoJson && modes.length > 0 && !modes.includes('RADIAL')) {
        warn('Latitude', 'GEOFENCE_MODE_DISABLED', 'Radial site boundaries are turned off for this workspace; draw the site on the Site step.');
      } else if (compare('geofence', 'GPS (site boundary)', `${lat}, ${lng} (${project.tenant.defaultGeofenceRadiusMeters} m radius)`, current, equal)) {
        apply.data.geofenceMode = 'RADIAL';
        apply.data.geofenceGeoJson = RadialGeofenceSchema.parse({
          mode: 'RADIAL',
          center: { latitude: lat, longitude: lng },
          radiusMeters: project.tenant.defaultGeofenceRadiusMeters,
          siteLabel: (wb.school || project.name).slice(0, 120),
        }) as unknown as Prisma.InputJsonValue;
      }
    }
  }
  return { changes, warnings, apply };
}

interface Analysis {
  project: ProjectRow;
  parsed: ParsedScopeWorkbook;
  fill: ProjectFill;
  preview: ScopeWorkbookPreviewDto;
}

function decode(fileBase64: string): Buffer {
  const buffer = Buffer.from(fileBase64, 'base64');
  if (buffer.length > SCOPE_WORKBOOK_MAX_BYTES) throw new AppError('The needs assessment file is larger than 10 MB', 413, 'FILE_TOO_LARGE');
  if (buffer.length === 0) throw new AppError('The file is empty', 400, 'EMPTY_FILE');
  return buffer;
}

/**
 * Drafts, and (UBEC IRL) live projects created by the register import that have no scope yet
 * (`scopeImportAllowed`). Other live projects change their scope on the Scope & sprints page.
 */
async function assertImportable(db: Db, project: { id: string; status: string; importedAt: Date | null }) {
  if (project.status === 'DRAFT') return;
  const [unitCount, lineCount] = await Promise.all([
    db.facilityUnit.count({ where: { projectId: project.id } }),
    db.boqItem.count({ where: { projectId: project.id } }),
  ]);
  if (!scopeImportAllowed(project, unitCount, lineCount)) {
    throw new AppError(
      'Needs assessment import is for draft projects (and imported projects without scope). On a live project, change the scope on the BoQ & work phases page (every change is audited).',
      409,
      'SCOPE_IMPORT_LIVE_PROJECT'
    );
  }
}

async function analyse(db: Db, projectId: string, buffer: Buffer, fileName: string | null): Promise<Analysis> {
  const project = await loadProject(db, projectId);
  await assertImportable(db, project);
  const facilities = await tenantFacilities(db, project.tenantId);
  const used = await db.facilityUnit.findMany({ where: { projectId }, select: { facilityId: true }, distinct: ['facilityId'] });
  const parsed = await parseScopeWorkbook(buffer, { facilities, allowedRetiredFacilityIds: new Set(used.map((u) => u.facilityId)) });
  const fill = await projectFill(db, project, parsed.project);
  const issues = [...parsed.issues];
  const warnings = [...parsed.warnings, ...fill.warnings];

  // The draft's own lines: replaced on confirm, refused if any carries evidence.
  const existingLines = await db.boqItem.findMany({ where: { projectId } });
  const defects = await defectItemIds(db, projectId);
  const withEvidence = existingLines.filter((l) => lineHasEvidence(l, defects));
  if (withEvidence.length) {
    issues.push({
      sheet: SCOPE_WORKBOOK_SHEETS.boq,
      row: null,
      column: null,
      code: 'SCOPE_HAS_EVIDENCE',
      message: `${withEvidence.length} existing line(s) have field evidence or reports (e.g. ${withEvidence[0].wbsCode}); the scope cannot be replaced.`,
    });
  }

  const amountNgn = Math.round(parsed.lines.reduce((s, l) => s + l.amountNgn, 0) * 100) / 100;
  const budget = fill.apply.budget ?? (project.totalBudgetNgn === null ? null : Number(project.totalBudgetNgn));
  if (budget !== null && amountNgn > budget + 0.005) {
    warnings.push({
      sheet: SCOPE_WORKBOOK_SHEETS.boq,
      row: null,
      column: 'Amount',
      code: 'BUDGET_EXCEEDED',
      message: `The BoQ total (${money(amountNgn)}) is above the project budget (${money(budget)}).`,
    });
  }

  const linesByUnit = new Map<string, typeof parsed.lines>();
  for (const l of parsed.lines) linesByUnit.set(l.unitCode, [...(linesByUnit.get(l.unitCode) ?? []), l]);
  const sprintLabel = (s: number | null, e: number | null) =>
    s === null || e === null ? 'No work phases' : s === e ? `Work phase ${s}` : `Work phases ${s}–${e}`;
  const groups = new Map<string, ScopeWorkbookPreviewDto['groups'][number]>();
  for (const u of parsed.units) {
    const label = sprintLabel(u.startSprint, u.endSprint);
    const key = `${u.facility.code}|${label}`;
    const own = linesByUnit.get(u.code) ?? [];
    const g = groups.get(key) ?? { facilityCode: u.facility.code, facilityName: u.facility.name, sprintLabel: label, unitCodes: [], lineCount: 0, amountNgn: 0 };
    g.unitCodes.push(u.code);
    g.lineCount += own.length;
    g.amountNgn = Math.round((g.amountNgn + own.reduce((s, l) => s + l.amountNgn, 0)) * 100) / 100;
    groups.set(key, g);
  }
  const facilityOrder = new Map(facilities.map((f, i) => [f.code, i]));

  const [sprintCount, unitCount] = await Promise.all([
    db.projectSprint.count({ where: { projectId } }),
    db.facilityUnit.count({ where: { projectId } }),
  ]);
  const preview: ScopeWorkbookPreviewDto = {
    fileName,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    version: parsed.version,
    sprints: parsed.sprints,
    units: parsed.units.map((u) => {
      const own = linesByUnit.get(u.code) ?? [];
      return {
        code: u.code,
        facilityCode: u.facility.code,
        facilityName: u.facility.name,
        archetype: u.facility.archetype,
        label: u.label,
        plannedQuantity: u.plannedQuantity,
        quantityUnit: u.quantityUnit,
        startSprint: u.startSprint,
        endSprint: u.endSprint,
        lineCount: own.length,
        amountNgn: Math.round(own.reduce((s, l) => s + l.amountNgn, 0) * 100) / 100,
      };
    }),
    lines: parsed.lines.map((l) => ({
      row: l.row,
      wbsCode: l.wbsCode,
      unitCode: l.unitCode,
      description: l.description,
      unit: l.unit,
      totalQuantity: l.totalQuantity,
      rateNgn: l.rateNgn,
      amountNgn: l.amountNgn,
    })),
    groups: [...groups.values()].sort(
      (a, b) => (facilityOrder.get(a.facilityCode) ?? 0) - (facilityOrder.get(b.facilityCode) ?? 0) || a.sprintLabel.localeCompare(b.sprintLabel)
    ),
    projectChanges: fill.changes,
    issues,
    warnings,
    totals: { sprintCount: parsed.sprints.length, unitCount: parsed.units.length, lineCount: parsed.lines.length, amountNgn, budgetNgn: budget },
    replaces: { sprintCount, unitCount, lineCount: existingLines.length },
    canConfirm: issues.length === 0,
  };
  return { project, parsed, fill, preview };
}

// ---------------------------------------------------------------------------
// Preview and confirm
// ---------------------------------------------------------------------------

export async function previewScopeImport(projectId: string, input: ScopeImportPreviewRequest): Promise<ScopeWorkbookPreviewDto> {
  return (await analyse(prisma, projectId, decode(input.fileBase64), input.fileName ?? null)).preview;
}

export async function confirmScopeImport(projectId: string, webUser: WebJwtPayload, input: ScopeImportConfirmRequest): Promise<ScopeImportResultDto> {
  const buffer = decode(input.fileBase64);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  if (sha256 !== input.sha256) {
    throw new AppError('This is not the file that was previewed. Preview it again before importing.', 409, 'SCOPE_IMPORT_FILE_CHANGED');
  }
  // Refuse a live project before taking the lock (the transaction re-checks).
  await assertImportable(prisma, await loadProject(prisma, projectId));
  let filled: string[] = [];
  await runScopeWrite(projectId, webUser, async (ctx) => {
    const { tx } = ctx;
    const { project, parsed, fill, preview } = await analyse(tx, projectId, buffer, input.fileName ?? null);
    if (preview.issues.length) {
      throw new AppError(`The needs assessment has ${preview.issues.length} error(s). Fix them and upload it again.`, 422, 'SCOPE_IMPORT_INVALID', {
        issues: preview.issues,
      });
    }

    // Replace the draft's scope.
    await tx.boqItem.deleteMany({ where: { projectId } });
    await tx.facilityUnit.deleteMany({ where: { projectId } });
    await tx.projectSprint.deleteMany({ where: { projectId } });
    const sprintIdByNumber = new Map<number, string>();
    for (const s of parsed.sprints) {
      const row = await tx.projectSprint.create({
        data: { projectId, number: s.number, name: s.name, startDate: s.startDate, endDate: s.endDate, deliverables: s.deliverables },
      });
      sprintIdByNumber.set(s.number, row.id);
    }
    const unitByCode = new Map<string, { id: string; facilityName: string }>();
    for (const [i, u] of parsed.units.entries()) {
      const row = await tx.facilityUnit.create({
        data: {
          projectId,
          facilityId: u.facility.id,
          code: u.code,
          label: u.label,
          plannedQuantity: u.plannedQuantity,
          quantityUnit: u.quantityUnit,
          startSprintId: u.startSprint === null ? null : sprintIdByNumber.get(u.startSprint)!,
          endSprintId: u.endSprint === null ? null : sprintIdByNumber.get(u.endSprint)!,
          sortOrder: (i + 1) * 10,
        },
      });
      unitByCode.set(u.code, { id: row.id, facilityName: u.facility.name });
    }
    if (parsed.lines.length) {
      await tx.boqItem.createMany({
        data: parsed.lines.map((l) => ({
          projectId,
          facilityUnitId: unitByCode.get(l.unitCode)!.id,
          wbsCode: l.wbsCode,
          section: unitByCode.get(l.unitCode)!.facilityName,
          description: l.description,
          unit: l.unit,
          totalQuantity: l.totalQuantity,
          rateNgn: l.rateNgn,
          budgetedCostNgn: l.amountNgn,
        })),
      });
    }

    // Project sheet: only empty fields are filled (D-R2.11).
    filled = fill.changes.filter((c) => c.action === 'FILL').map((c) => c.field);
    if (Object.keys(fill.apply.data).length) await tx.project.update({ where: { id: projectId }, data: fill.apply.data });
    if (fill.apply.schoolName) {
      await tx.projectBeneficiary.create({
        data: { projectId, name: fill.apply.schoolName, beneficiaryType: 'SCHOOL', isPrimary: true },
      });
    }
    if (fill.apply.projectTypeId) {
      await applyProjectTypeToProject(tx, project, fill.apply.projectTypeId, webUser);
    }
    // UBEC IRL: an imported live project's first scope brings its sprints: the type's sprint-driven
    // visits are proposed as on a live sprint save.
    if (project.status === 'ACTIVE' && parsed.sprints.length) {
      await proposeVisitsFromType(tx, projectId, { trigger: 'SPRINTS_SAVED', actor: webVisitActor(webUser) });
    }

    const t = preview.totals;
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'SCOPE_IMPORTED',
      summaryText:
        `Imported the needs assessment${input.fileName ? ` "${input.fileName}"` : ''}: ${t.sprintCount} sprint(s), ${t.unitCount} facility unit(s), ` +
        `${t.lineCount} BoQ line(s) totalling ${money(t.amountNgn)}` +
        `${preview.replaces.lineCount || preview.replaces.unitCount || preview.replaces.sprintCount ? ' (replacing the earlier scope)' : ''}` +
        `${filled.length ? `; filled project fields: ${filled.join(', ')}` : ''}.`,
      payload: {
        sha256,
        fileName: input.fileName ?? null,
        version: preview.version,
        totals: t,
        replaced: preview.replaces,
        filledProjectFields: filled,
        warnings: preview.warnings.map((w) => w.code),
      },
    });
  });
  return { scope: await getProjectScope(projectId), filledProjectFields: filled };
}
