import crypto from 'crypto';
import ExcelJS from 'exceljs';
import { ContractMilestoneStatus, MilestoneCompletionMode, Prisma } from '@prisma/client';
import {
  assignRegisterCodes,
  GeofenceMode,
  partyRulesFor,
  PROJECT_REGISTER_COLUMNS,
  PROJECT_REGISTER_IMPORT_STATUS_LABELS,
  PROJECT_REGISTER_MAX_BYTES,
  PROJECT_REGISTER_MAX_ROWS,
  PROJECT_REGISTER_SHEETS,
  PROJECT_REGISTER_TEMPLATE_VERSION,
  ProjectRegisterColumnKey,
  ProjectRegisterImportConfirmRequest,
  ProjectRegisterImportPreviewDto,
  ProjectRegisterImportPreviewRequest,
  ProjectRegisterImportResultDto,
  ProjectRegisterIssue,
  ProjectRegisterPreviewRow,
  RadialGeofenceSchema,
  RegisterRowRaw,
  RegisterRowValues,
  resolveProjectTypeConfig,
  resolveTerminology,
  validateRegisterRow,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { invalidateUserAuthCache, type WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { findSheet, labelledValue, loadWorkbook, normHeader, readTable, type SheetIssue } from '../../utils/sheetReader';
import { initialiseProjectProcess } from '../process/processConfig.service';
import { applyProjectTypeToProject } from '../projectTypes/projectTypes.service';
import { syncProjectContractors } from '../projects/contractors.service';
import { markStepSaved } from '../projects/projectSetup.service';
import { syncContractMilestones } from '../contracts/milestones.service';
import { proposeVisitsFromType } from '../visits/visitPlan.service';
import { webVisitActor } from '../visits/visitCore';
import { workspaceShortName } from '../scope/scopeImport.service';
import { buildRegisterWorkbook, registerTemplateFileName } from './registerWorkbook';

/**
 * UBEC IRL (owner decisions 2026-11-25): bulk import of the project register, modelled on the needs
 * assessment import.
 * - Template: Instructions (version stamp), Projects (one row per project), hidden Lists.
 * - Preview: parses and validates every row against the workspace (types, regions, organisations,
 *   codes and client project IDs in use); nothing is written.
 * - Confirm: same bytes (sha256) or 409; any error refuses the whole file (422); otherwise every row
 *   is created in one transaction and audited (PROJECT_REGISTER_IMPORTED).
 *
 * Rows "Not started" (or blank) become drafts that are set up and activated as today. Rows "Ongoing"
 * or "Completed" become live imported projects: ACTIVE at import time, the type applied, the
 * contractor on the project, a radial site boundary from the GPS point, `importedAt`,
 * `importedStatus` and `importedProgressPct` set. They skip the setup gates (no scope needed). To
 * avoid a flood of overdue work: contract milestones are synced, then every pre-construction one
 * (kick-off, mobilisation, programme accepted) and every one already due before the import date is
 * waived with a reason; later ones stay open. Visit plan proposals (PROPOSED, for a manager to
 * publish) are made for ongoing projects only, after mobilisation is waived, so no mobilisation
 * checks are proposed; a completed project gets none (the completion notice proposes its own).
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const S = PROJECT_REGISTER_SHEETS;

/** Steps a project under way has already passed: waived on a live import. */
const PRE_CONSTRUCTION_MODES: MilestoneCompletionMode[] = [
  'AUTO_KICKOFF_NOTICE_SENT',
  'AUTO_KICKOFF_QUORUM',
  'AUTO_CONTRACTOR_ON_SITE',
  'AUTO_SCHEDULE_BASELINE_SET',
];
const OPEN_STATUSES: ContractMilestoneStatus[] = ['PENDING', 'DUE', 'OVERDUE'];
const IMPORT_WAIVE_REASON = 'Project imported already under way (project register import): this step was before the platform took it on.';
/** The contractor's trade on an imported project (as the setup's contractor section). */
const DEFAULT_TRADE = { tradeCategory: 'Main contract', tradeCode: 'MAIN' };

const money = (n: number) => `NGN ${n.toLocaleString('en-NG', { maximumFractionDigits: 2 })}`;
const lower = (s: string) => s.trim().toLowerCase();

// ---------------------------------------------------------------------------
// Workspace context
// ---------------------------------------------------------------------------

async function loadContext(db: Db, tenantId: string) {
  const [tenant, regions, types, orgs, projects] = await Promise.all([
    db.tenant.findUniqueOrThrow({
      where: { id: tenantId },
      select: {
        name: true,
        timezone: true,
        enabledGeofenceModes: true,
        defaultGeofenceRadiusMeters: true,
        organizationInputMode: true,
        terminologyLabels: true,
      },
    }),
    db.region.findMany({ where: { tenantId, isArchived: false }, select: { id: true, name: true, code: true, parentRegionId: true }, orderBy: { name: 'asc' } }),
    db.projectType.findMany({ where: { tenantId, isActive: true }, select: { id: true, name: true, code: true, configJson: true }, orderBy: { name: 'asc' } }),
    db.organization.findMany({ where: { tenantId }, select: { id: true, name: true, isArchived: true, categories: true }, orderBy: { name: 'asc' } }),
    db.project.findMany({ where: { tenantId }, select: { codePrefix: true, externalReference: true } }),
  ]);
  const modes = (tenant.enabledGeofenceModes as GeofenceMode[] | null) ?? [];
  return {
    tenant,
    /** States are the areas when the workspace has areas, else the regions. */
    states: regions.some((r) => r.parentRegionId) ? regions.filter((r) => r.parentRegionId) : regions,
    regions,
    types,
    orgs,
    existingCodes: projects.map((p) => p.codePrefix),
    existingRefs: new Map(projects.filter((p) => p.externalReference).map((p) => [lower(p.externalReference!), p.codePrefix])),
    radialAllowed: modes.length === 0 || modes.includes('RADIAL'),
    term: resolveTerminology(tenant.terminologyLabels).externalReference.singular,
  };
}
type Context = Awaited<ReturnType<typeof loadContext>>;

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------



export async function buildRegisterTemplate(tenantId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const ctx = await loadContext(prisma, tenantId);
  const buffer = await buildRegisterWorkbook({
    generatedAt: new Date(),
    brandName: workspaceShortName(ctx.tenant.name),
    term: ctx.term,
    states: ctx.states.map((s) => s.name),
    projectTypes: ctx.types.map((t) => t.name),
    owners: ctx.orgs.filter((o) => !o.isArchived).map((o) => o.name),
    contractors: ctx.orgs.filter((o) => !o.isArchived && (o.categories as string[]).includes('CONTRACTOR')).map((o) => o.name),
  });
  return { buffer, fileName: registerTemplateFileName(workspaceShortName(ctx.tenant.name)) };
}


// ---------------------------------------------------------------------------
// Parsing and analysis (shared by preview and confirm)
// ---------------------------------------------------------------------------

interface PlannedRow {
  row: number;
  values: RegisterRowValues;
  code: string | null;
  regionId: string | null;
  stateLocation: string;
  type: Context['types'][number] | null;
  ownerId: string | null;
  contractor: { id: string | null; name: string } | null;
  preview: ProjectRegisterPreviewRow;
}

interface Analysis {
  preview: ProjectRegisterImportPreviewDto;
  plan: PlannedRow[];
  ctx: Context;
}

function decode(fileBase64: string): Buffer {
  const buffer = Buffer.from(fileBase64, 'base64');
  if (buffer.length > PROJECT_REGISTER_MAX_BYTES) throw new AppError('The project register file is larger than 10 MB', 413, 'FILE_TOO_LARGE');
  if (buffer.length === 0) throw new AppError('The file is empty', 400, 'EMPTY_FILE');
  return buffer;
}

async function readRows(buffer: Buffer, ctx: Context, issues: SheetIssue[]): Promise<{ version: string | null; rows: Array<{ row: number; raw: RegisterRowRaw }> }> {
  const wb = new ExcelJS.Workbook();
  if (!(await loadWorkbook(wb, buffer))) {
    issues.push({ sheet: '', row: null, column: null, code: 'WORKBOOK_UNREADABLE', message: 'This is not an .xlsx file. Download the project register template and fill it in.' });
    return { version: null, rows: [] };
  }
  const version = labelledValue(findSheet(wb, S.instructions), 'Version');
  if (version !== PROJECT_REGISTER_TEMPLATE_VERSION) {
    issues.push({
      sheet: S.instructions,
      row: null,
      column: 'Version',
      code: 'WORKBOOK_VERSION_MISMATCH',
      message: version
        ? `This project register file is version "${version}"; this platform reads "${PROJECT_REGISTER_TEMPLATE_VERSION}". Download a new template.`
        : 'This is not a project register file (no version stamp). Download the project register template and fill it in.',
    });
    return { version, rows: [] };
  }
  const ws = findSheet(wb, S.projects);
  if (!ws) {
    issues.push({ sheet: S.projects, row: null, column: null, code: 'WORKBOOK_SHEET_MISSING', message: `The "${S.projects}" sheet is missing.` });
    return { version, rows: [] };
  }
  const required = PROJECT_REGISTER_COLUMNS.filter((c) => c.required).map((c) => c.header);
  const table = readTable(ws, S.projects, required, issues);
  if (!table) return { version, rows: [] };
  // Each column by its header, an alias, or (client project ID) the workspace term.
  const columnHeader = new Map<ProjectRegisterColumnKey, string | null>();
  for (const c of PROJECT_REGISTER_COLUMNS) {
    const names = [c.header, ...(c.aliases ?? []), ...(c.key === 'externalReference' ? [ctx.term] : [])];
    columnHeader.set(c.key, names.find((n) => table.columns.has(normHeader(n))) ?? null);
  }
  const rows = table.rows.map((r) => {
    const raw: RegisterRowRaw = {};
    for (const [key, h] of columnHeader) if (h) raw[key] = r.get(h);
    return { row: r.row, raw };
  });
  if (rows.length > PROJECT_REGISTER_MAX_ROWS) {
    issues.push({
      sheet: S.projects,
      row: null,
      column: null,
      code: 'TOO_MANY_ROWS',
      message: `The file has ${rows.length} projects; import at most ${PROJECT_REGISTER_MAX_ROWS} at a time.`,
    });
  }
  if (rows.length === 0) {
    issues.push({ sheet: S.projects, row: null, column: null, code: 'NO_ROWS', message: 'The Projects sheet has no projects.' });
  }
  return { version, rows };
}

async function analyse(db: Db, tenantId: string, buffer: Buffer, fileName: string | null): Promise<Analysis> {
  const ctx = await loadContext(db, tenantId);
  const sheetIssues: SheetIssue[] = [];
  const { version, rows } = await readRows(buffer, ctx, sheetIssues);
  const sheet = S.projects;

  const byName = <T extends { name: string; code?: string }>(list: T[], text: string) =>
    list.find((x) => lower(x.name) === lower(text)) ?? list.find((x) => x.code && lower(x.code) === lower(text)) ?? null;
  const refsInFile = new Map<string, number>();
  const newContractors = new Set<string>();

  const validated = rows.map((r) => ({ ...r, ...validateRegisterRow(r.raw) }));
  const codes = assignRegisterCodes(validated.map((v) => ({ code: v.values.code })), ctx.existingCodes);

  const plan: PlannedRow[] = validated.map((v, i) => {
    const issues: ProjectRegisterIssue[] = v.issues.map((x) => ({ sheet, row: v.row, column: x.column === 'Client project ID' ? ctx.term : x.column, code: x.code, message: `Row ${v.row}: ${x.message}` }));
    const warnings: ProjectRegisterIssue[] = v.warnings.map((x) => ({ sheet, row: v.row, column: x.column, code: x.code, message: `Row ${v.row}: ${x.message}` }));
    const bad = (column: string, code: string, message: string) => issues.push({ sheet, row: v.row, column, code, message: `Row ${v.row}: ${message}` });
    const warn = (column: string, code: string, message: string) => warnings.push({ sheet, row: v.row, column, code, message: `Row ${v.row}: ${message}` });
    const x = v.values;
    const live = x.status !== 'NOT_STARTED';

    // Code
    const assigned = codes[i];
    if (!assigned.code) bad('Code', 'CODE_SERIES_FULL', assigned.note ?? 'No free project code is left in the series.');
    else if (assigned.note) warn('Code', 'CODE_REASSIGNED', assigned.note);

    // Client project ID: unique in the workspace and in the file.
    if (x.externalReference) {
      const key = lower(x.externalReference);
      const usedBy = ctx.existingRefs.get(key);
      if (usedBy) bad(ctx.term, 'EXTERNAL_REFERENCE_TAKEN', `${ctx.term} "${x.externalReference}" is already used by ${usedBy}.`);
      else if (refsInFile.has(key)) bad(ctx.term, 'DUPLICATE_EXTERNAL_REFERENCE', `${ctx.term} "${x.externalReference}" also appears on row ${refsInFile.get(key)}.`);
      else refsInFile.set(key, v.row);
    }

    // State (region)
    let regionId: string | null = null;
    let stateLocation = x.state ?? '';
    if (x.state && ctx.regions.length) {
      const region = byName(ctx.states, x.state) ?? byName(ctx.regions, x.state);
      if (!region) bad('State', 'UNKNOWN_STATE', `"${x.state}" is not a state on the list.`);
      else {
        regionId = region.id;
        stateLocation = region.name;
      }
    }

    // Project type
    let type: PlannedRow['type'] = null;
    if (x.projectType) {
      type = byName(ctx.types, x.projectType);
      if (!type) bad('Project type', 'UNKNOWN_PROJECT_TYPE', `"${x.projectType}" is not a project type on the list.`);
    } else if (ctx.types.length) {
      bad('Project type', 'PROJECT_TYPE_REQUIRED', 'Choose the project type.');
    }
    const typeConfig = type ? resolveProjectTypeConfig({ config: type.configJson }) : null;

    // Owner
    let ownerId: string | null = null;
    if (x.owner) {
      const owner = ctx.orgs.find((o) => lower(o.name) === lower(x.owner!));
      if (!owner) bad('Owning organisation', 'UNKNOWN_OWNER', `"${x.owner}" is not an organisation on the list.`);
      else if (owner.isArchived) bad('Owning organisation', 'ORGANIZATION_ARCHIVED', `"${owner.name}" is archived.`);
      else {
        const allowed = typeConfig?.ownership.allowedOwningOrganizationIds ?? null;
        if (allowed && !allowed.includes(owner.id)) bad('Owning organisation', 'OWNER_NOT_ALLOWED', `"${owner.name}" cannot own a project of this type.`);
        ownerId = owner.id;
      }
    } else if (live && partyRulesFor(typeConfig).owningOrganizationRequired && !typeConfig?.ownership.defaultOwningOrganizationId) {
      bad('Owning organisation', 'OWNER_REQUIRED', 'This project type needs an owning organisation.');
    }

    // Contractor
    let contractor: PlannedRow['contractor'] = null;
    let contractorIsNew = false;
    if (x.contractor) {
      const org = ctx.orgs.find((o) => lower(o.name) === lower(x.contractor!));
      if (org?.isArchived) bad('Contractor', 'ORGANIZATION_ARCHIVED', `"${org.name}" is archived and cannot be chosen.`);
      else if (org) contractor = { id: org.id, name: org.name };
      else if (ctx.tenant.organizationInputMode === 'DIRECTORY') {
        bad('Contractor', 'ORGANIZATION_NOT_IN_DIRECTORY', `"${x.contractor}" is not in the organisation directory. Ask an administrator to add it.`);
      } else {
        contractor = { id: null, name: x.contractor };
        contractorIsNew = true;
        newContractors.add(lower(x.contractor));
      }
    }

    // Site boundary
    if (x.latitude !== null && x.longitude !== null && !ctx.radialAllowed) {
      if (live) bad('Latitude', 'GEOFENCE_MODE_DISABLED', 'Radial site boundaries are turned off for this workspace: a live project cannot be imported.');
      else warn('Latitude', 'GEOFENCE_MODE_DISABLED', 'Radial site boundaries are turned off for this workspace: draw the site on the Location step.');
    }

    return {
      row: v.row,
      values: x,
      code: assigned.code,
      regionId,
      stateLocation,
      type,
      ownerId,
      contractor,
      preview: {
        row: v.row,
        code: assigned.code,
        codeAssigned: assigned.assigned,
        externalReference: x.externalReference,
        name: x.name,
        school: x.school,
        regionName: x.state ? stateLocation : null,
        lga: x.lga,
        projectTypeName: type?.name ?? x.projectType,
        ownerName: x.owner,
        contractorName: contractor?.name ?? x.contractor,
        contractorIsNew,
        contractSumNgn: x.contractSumNgn,
        budgetNgn: x.budgetNgn,
        interventionYear: x.interventionYear,
        fundingSource: x.fundingSource,
        status: x.status,
        mode: live ? 'LIVE' : 'DRAFT',
        percentComplete: x.percentComplete,
        issues,
        warnings,
      },
    };
  });

  const issues = [...sheetIssues, ...plan.flatMap((p) => p.preview.issues)];
  const warnings = plan.flatMap((p) => p.preview.warnings);
  const preview: ProjectRegisterImportPreviewDto = {
    fileName,
    sha256: crypto.createHash('sha256').update(buffer).digest('hex'),
    version,
    rows: plan.map((p) => p.preview),
    issues,
    warnings,
    totals: {
      rowCount: plan.length,
      draftCount: plan.filter((p) => p.preview.mode === 'DRAFT').length,
      liveCount: plan.filter((p) => p.preview.mode === 'LIVE').length,
      newContractorCount: newContractors.size,
      rowsWithErrors: plan.filter((p) => p.preview.issues.length > 0).length,
    },
    canConfirm: issues.length === 0 && plan.length > 0,
  };
  return { preview, plan, ctx };
}

export async function previewRegisterImport(webUser: WebJwtPayload, input: ProjectRegisterImportPreviewRequest): Promise<ProjectRegisterImportPreviewDto> {
  return (await analyse(prisma, webUser.tenantId, decode(input.fileBase64), input.fileName ?? null)).preview;
}

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

export async function confirmRegisterImport(webUser: WebJwtPayload, input: ProjectRegisterImportConfirmRequest): Promise<ProjectRegisterImportResultDto> {
  const buffer = decode(input.fileBase64);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  if (sha256 !== input.sha256) {
    throw new AppError('This is not the file that was previewed. Preview it again before importing.', 409, 'PROJECT_REGISTER_FILE_CHANGED');
  }
  const tenantId = webUser.tenantId;
  const created = await prisma.$transaction(
    async (tx) => {
      // One import at a time per workspace: codes and client project IDs are checked against the database.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`project-register:${tenantId}`}))`;
      const { preview, plan, ctx } = await analyse(tx, tenantId, buffer, input.fileName ?? null);
      if (!preview.canConfirm) {
        throw new AppError(
          preview.issues.length
            ? `The project register has ${preview.issues.length} error(s). Fix them and upload it again.`
            : 'The project register has no projects to import.',
          422,
          'PROJECT_REGISTER_IMPORT_INVALID',
          { issues: preview.issues }
        );
      }
      const now = new Date();
      const creatorOrg = await tx.organization.findUnique({ where: { id: webUser.organizationId }, select: { id: true, categories: true } });
      const monitorId = (creatorOrg?.categories as string[] | undefined)?.includes('ADVISORY_MONITOR') ? creatorOrg!.id : null;
      const out: ProjectRegisterImportResultDto['created'] = [];
      for (const p of plan) {
        out.push(await createImportedProject(tx, { plan: p, ctx, webUser, now, monitorId, sha256, fileName: input.fileName ?? null }));
      }
      await recordAuditEvent(tx, {
        tenantId,
        projectId: null,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
        action: 'PROJECT_REGISTER_IMPORTED',
        summaryText:
          `Imported ${out.length} project(s) from the project register${input.fileName ? ` "${input.fileName}"` : ''}: ` +
          `${preview.totals.draftCount} draft(s), ${preview.totals.liveCount} live (${out.map((c) => c.code).join(', ')}).`,
        payload: { sha256, fileName: input.fileName ?? null, version: preview.version, totals: preview.totals, codes: out.map((c) => c.code) },
      });
      return out;
    },
    { timeout: 300_000, maxWait: 15_000 }
  );
  invalidateUserAuthCache(webUser.userId);
  return {
    created,
    draftCount: created.filter((c) => c.mode === 'DRAFT').length,
    liveCount: created.filter((c) => c.mode === 'LIVE').length,
  };
}

async function createImportedProject(
  tx: Tx,
  args: { plan: PlannedRow; ctx: Context; webUser: WebJwtPayload; now: Date; monitorId: string | null; sha256: string; fileName: string | null }
): Promise<ProjectRegisterImportResultDto['created'][number]> {
  const { plan: p, ctx, webUser, now } = args;
  const x = p.values;
  const live = x.status !== 'NOT_STARTED';
  const nowIso = now.toISOString();
  const geofence =
    x.latitude !== null && x.longitude !== null && ctx.radialAllowed
      ? RadialGeofenceSchema.parse({
          mode: 'RADIAL',
          center: { latitude: x.latitude, longitude: x.longitude },
          radiusMeters: ctx.tenant.defaultGeofenceRadiusMeters,
          siteLabel: (x.school || x.name).slice(0, 120),
        })
      : null;

  const project = await tx.project.create({
    data: {
      tenantId: webUser.tenantId,
      status: 'DRAFT',
      createdByUserId: webUser.userId,
      timezone: ctx.tenant.timezone,
      name: x.name,
      codePrefix: p.code!,
      stateLocation: p.stateLocation,
      lgaLocation: x.lga,
      totalBudgetNgn: x.budgetNgn,
      regionId: p.regionId,
      siteAddress: x.siteAddress,
      owningOrganizationId: p.ownerId,
      monitorOrganizationId: args.monitorId,
      interventionYear: x.interventionYear,
      fundingSource: x.fundingSource,
      externalReference: x.externalReference,
      contractSumNgn: x.contractSumNgn,
      contractAwardDate: x.contractAwardDate,
      contractSignedDate: x.contractSignedDate,
      plannedStartDate: x.plannedStartDate,
      plannedEndDate: x.plannedCompletionDate,
      originalPlannedEndDate: x.plannedCompletionDate,
      ...(geofence ? { geofenceMode: 'RADIAL' as const, geofenceGeoJson: geofence as unknown as Prisma.InputJsonValue } : {}),
      importedAt: now,
      importedStatus: x.status,
      importedProgressPct: live ? x.percentComplete : null,
      setupState: {
        steps: { basics: { savedAt: nowIso, savedByUserId: webUser.userId, completedAt: nowIso, completedByUserId: webUser.userId } },
      } as unknown as Prisma.InputJsonValue,
    },
  });
  await tx.userProjectAssignment.create({ data: { userId: webUser.userId, projectId: project.id } });
  await initialiseProjectProcess(tx, project);
  if (p.type) await applyProjectTypeToProject(tx, project, p.type.id, webUser);
  if (x.school) {
    await tx.projectBeneficiary.create({ data: { projectId: project.id, name: x.school, beneficiaryType: 'SCHOOL', isPrimary: true } });
  }
  if (p.contractor) {
    await syncProjectContractors(tx, {
      projectId: project.id,
      tenantId: project.tenantId,
      webUser,
      inputs: [
        {
          organization: p.contractor.id ? { id: p.contractor.id } : { name: p.contractor.name },
          ...DEFAULT_TRADE,
          allocatedBudgetNgn: x.contractSumNgn,
          plannedMobilizationDate: x.plannedStartDate,
          plannedCompletionDate: x.plannedCompletionDate,
        },
      ],
    });
  }

  let waived = 0;
  let proposedVisits = 0;
  if (!live) {
    // A draft: the sections the file filled count as saved (setup reports what is still missing).
    const filled: string[] = [];
    if (x.owner || x.school) filled.push('parties');
    if (geofence) filled.push('site');
    if (p.contractor) filled.push('contractor');
    if (x.contractAwardDate || x.contractSignedDate || x.contractSumNgn !== null) filled.push('contract');
    for (const s of filled) await markStepSaved(tx, project.id, s, webUser.userId);
    await syncContractMilestones(tx, project.id);
  } else {
    await tx.project.update({
      where: { id: project.id },
      data: { status: 'ACTIVE', activatedAt: now, activatedByUserId: webUser.userId, certifiedProgressPct: x.percentComplete ?? 0 },
    });
    await syncContractMilestones(tx, project.id);
    const today = zonedCalendarDate(now, ctx.tenant.timezone);
    const result = await tx.projectContractMilestone.updateMany({
      where: {
        projectId: project.id,
        status: { in: OPEN_STATUSES },
        OR: [{ completionMode: { in: PRE_CONSTRUCTION_MODES } }, { dueDate: { lt: today } }],
      },
      data: { status: 'WAIVED', waivedReason: IMPORT_WAIVE_REASON, completedAt: now, completedByUserId: webUser.userId },
    });
    waived = result.count;
    if (x.status === 'ONGOING') {
      const proposed = await proposeVisitsFromType(tx, project.id, { trigger: 'ACTIVATION', actor: webVisitActor(webUser), now });
      proposedVisits = proposed.createdIds.length;
    }
  }

  const statusLabel = PROJECT_REGISTER_IMPORT_STATUS_LABELS[x.status].toLowerCase();
  await recordAuditEvent(tx, {
    projectId: project.id,
    actorType: 'WEB_USER',
    actorId: webUser.userId,
    actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
    action: 'PROJECT_REGISTER_IMPORTED',
    summaryText: live
      ? `Imported "${project.name}" (${project.codePrefix}) from the project register as a live project (reported ${statusLabel}, ${x.percentComplete}% complete)` +
        `${waived ? `; ${waived} contract milestone(s) before the import waived` : ''}${proposedVisits ? `; ${proposedVisits} visit(s) proposed` : ''}.`
      : `Imported "${project.name}" (${project.codePrefix}) from the project register as a draft.`,
    payload: {
      sha256: args.sha256,
      fileName: args.fileName,
      row: p.row,
      mode: live ? 'LIVE' : 'DRAFT',
      status: x.status,
      percentComplete: x.percentComplete,
      externalReference: x.externalReference,
      budgetNgn: x.budgetNgn,
      budget: x.budgetNgn === null ? null : money(x.budgetNgn),
      contractor: p.contractor?.name ?? null,
      waivedMilestones: waived,
      proposedVisits,
    },
  });
  return { id: project.id, code: project.codePrefix, name: project.name, mode: live ? 'LIVE' : 'DRAFT' };
}
