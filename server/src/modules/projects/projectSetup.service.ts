import { Prisma } from '@prisma/client';
import {
  ActivateProjectResponse,
  ContractorExecutionMode,
  CreateProjectDraftRequest,
  GeofenceMode,
  PROJECT_SETUP_STEPS,
  PROJECT_STEP_SAVE_SCHEMAS,
  ProjectActivationSchema,
  ProjectBasicsStepSchema,
  ProjectBoqStep,
  ProjectDraftSummary,
  ProjectFacilityStep,
  ProjectGeofence,
  ProjectGeofenceSchema,
  ProjectPartiesStep,
  ProjectReportingStep,
  ProjectSetupDto,
  ProjectSetupStepId,
  ProjectSiteStep,
  ProjectTeamStep,
  ReportingCadence,
  SetupIssue,
  SetupStepStatus,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import {
  hasWebPermission,
  invalidateUserAuthCache,
  WebJwtPayload,
} from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { resolveOrganization } from '../organizations/organizations.service';
import {
  auditContractorChanges,
  contractorModelIssues,
  getProjectContractors,
  serializeContractor,
  syncProjectContractors,
} from './contractors.service';
import { issueMissingJoinCodes, reconcileContractorJoinCodes } from './joinCodes.service';

/**
 * Staged project creation (Phase 6, decision C). A project starts as a DRAFT from the basics step,
 * is saved one step at a time, and goes live only through `activateProject`. After activation the
 * same steps serve as project settings, with changes that would invalidate live data refused.
 */

type Tx = Prisma.TransactionClient;

const ALL_GEOFENCE_MODES: GeofenceMode[] = ['RADIAL', 'LINEAR_CORRIDOR', 'PERIMETER'];

function actorName(webUser: WebJwtPayload) {
  return `${webUser.fullName} (${webUser.roleName})`;
}

// ---------------------------------------------------------------------------
// setupState JSON
// ---------------------------------------------------------------------------

interface StepState {
  savedAt: string;
  savedByUserId: string;
  /** Set when the step had no issues after its last save. */
  completedAt: string | null;
  completedByUserId: string | null;
}

interface SetupState {
  steps: Partial<Record<string, StepState>>;
  team: { joinCodeRoleIds: string[] | null };
}

function parseSetupState(raw: unknown): SetupState {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const steps = obj.steps && typeof obj.steps === 'object' ? (obj.steps as SetupState['steps']) : {};
  const team = obj.team && typeof obj.team === 'object' ? (obj.team as Record<string, unknown>) : {};
  const ids = Array.isArray(team.joinCodeRoleIds)
    ? (team.joinCodeRoleIds as unknown[]).filter((v): v is string => typeof v === 'string')
    : null;
  return { steps, team: { joinCodeRoleIds: ids } };
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const SETUP_INCLUDE = {
  tenant: {
    select: {
      timezone: true,
      enabledGeofenceModes: true,
      defaultGeofenceToleranceMeters: true,
      organizationInputMode: true,
    },
  },
  monitorOrganization: { select: { id: true, name: true } },
  lenderOrganization: { select: { id: true, name: true } },
  tranches: { orderBy: { trancheNumber: 'asc' }, include: { conditionsPrecedent: { orderBy: { referenceCode: 'asc' } } } },
  userAssignments: { select: { userId: true } },
} satisfies Prisma.ProjectInclude;

type SetupProjectRow = Prisma.ProjectGetPayload<{ include: typeof SETUP_INCLUDE }>;

async function loadSetupProject(db: Tx | typeof prisma, projectId: string) {
  const project = await db.project.findUnique({ where: { id: projectId }, include: SETUP_INCLUDE });
  if (!project) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  const [contractors, itemCount, unmappedCount, unassignedContractorCount, holdPointCount, budgetSum] =
    await Promise.all([
      getProjectContractors(db, projectId),
      db.boqItem.count({ where: { projectId } }),
      db.boqItem.count({ where: { projectId, trancheId: null } }),
      db.boqItem.count({ where: { projectId, projectContractorId: null } }),
      db.boqItem.count({ where: { projectId, isHoldPoint: true } }),
      db.boqItem.aggregate({ where: { projectId }, _sum: { budgetedCostNgn: true } }),
    ]);
  return {
    project,
    contractors,
    boq: {
      itemCount,
      unmappedCount,
      unassignedContractorCount,
      holdPointCount,
      totalBudgetedCostNgn: Number(budgetSum._sum.budgetedCostNgn ?? 0),
    },
  };
}

type LoadedSetup = Awaited<ReturnType<typeof loadSetupProject>>;

// ---------------------------------------------------------------------------
// Validity
// ---------------------------------------------------------------------------

function zodIssues(error: { issues: Array<{ path: (string | number)[]; message: string }> }, prefix?: string): SetupIssue[] {
  return error.issues.map((i) => ({
    code: 'INVALID_FIELD',
    message: i.message,
    field: [prefix, ...i.path].filter((p) => p !== undefined && p !== '').join('.'),
  }));
}

function enabledModes(project: SetupProjectRow): GeofenceMode[] {
  const modes = (project.tenant.enabledGeofenceModes as GeofenceMode[] | null) ?? [];
  return modes.length ? modes : ALL_GEOFENCE_MODES;
}

/** Issues per step, from the saved data. Required steps must have no issues to activate. */
function computeStepIssues(loaded: LoadedSetup): Record<string, { issues: SetupIssue[]; warnings: SetupIssue[] }> {
  const { project, contractors, boq } = loaded;
  const out: Record<string, { issues: SetupIssue[]; warnings: SetupIssue[] }> = {};
  const budget = project.totalBudgetNgn === null ? null : Number(project.totalBudgetNgn);

  // Basics
  const basics = ProjectBasicsStepSchema.safeParse({
    name: project.name,
    codePrefix: project.codePrefix,
    stateLocation: project.stateLocation ?? '',
    lgaLocation: project.lgaLocation,
    description: project.description,
    totalBudgetNgn: budget ?? undefined,
  });
  out.basics = { issues: basics.success ? [] : zodIssues(basics.error), warnings: [] };

  // Parties
  const parties: SetupIssue[] = [];
  if (!project.monitorOrganizationId) {
    parties.push({ code: 'MONITOR_REQUIRED', message: 'Choose the monitor organisation.', field: 'monitorOrganization' });
  }
  if (!project.lenderOrganizationId) {
    parties.push({ code: 'LENDER_REQUIRED', message: 'Choose the lender organisation.', field: 'lenderOrganization' });
  }
  for (const i of contractorModelIssues(
    project.contractorExecutionMode as ContractorExecutionMode | null,
    contractors
  )) {
    parties.push({ ...i, field: i.code === 'CONTRACTOR_MODEL_REQUIRED' ? 'contractorExecutionMode' : 'contractors' });
  }
  const partyWarnings: SetupIssue[] = [];
  const allocated = contractors.reduce((s, c) => s + Number(c.allocatedBudgetNgn ?? 0), 0);
  if (budget !== null && allocated > budget) {
    partyWarnings.push({
      code: 'CONTRACTOR_BUDGETS_EXCEED_PROJECT',
      message: 'Contractor package budgets add up to more than the project budget.',
      field: 'contractors',
    });
  }
  out.parties = { issues: parties, warnings: partyWarnings };

  // Site
  const site: SetupIssue[] = [];
  if (!project.geofenceGeoJson) {
    site.push({ code: 'GEOFENCE_REQUIRED', message: 'Draw the site geofence.', field: 'geofence' });
  } else {
    const g = ProjectGeofenceSchema.safeParse(project.geofenceGeoJson);
    if (!g.success) site.push(...zodIssues(g.error, 'geofence'));
  }
  out.site = { issues: site, warnings: [] };

  // Facility
  const facility: SetupIssue[] = [];
  const facilityWarnings: SetupIssue[] = [];
  if (project.tranches.length === 0) {
    facility.push({ code: 'TRANCHE_REQUIRED', message: 'Add at least one tranche.', field: 'tranches' });
  } else if (budget !== null) {
    const sum = project.tranches.reduce((s, t) => s + Number(t.allocatedAmountNgn), 0);
    if (sum > budget + 0.005) {
      facility.push({
        code: 'TRANCHES_EXCEED_BUDGET',
        message: 'Tranche allocations add up to more than the project budget.',
        field: 'tranches',
      });
    } else if (sum < budget - 0.005) {
      facilityWarnings.push({
        code: 'TRANCHES_BELOW_BUDGET',
        message: 'Tranche allocations add up to less than the project budget.',
        field: 'tranches',
      });
    }
  }
  out.facility = { issues: facility, warnings: facilityWarnings };

  // BOQ
  const boqIssues: SetupIssue[] = [];
  if (boq.itemCount === 0) {
    boqIssues.push({ code: 'BOQ_REQUIRED', message: 'Upload the bill of quantities.', field: 'items' });
  } else {
    if (boq.unmappedCount > 0) {
      boqIssues.push({
        code: 'BOQ_ITEMS_UNMAPPED',
        message: `${boq.unmappedCount} BOQ item(s) are not mapped to a tranche.`,
        field: 'items',
      });
    }
    if (project.contractorExecutionMode === 'MULTI_PRIME_SEPARATE_IPC' && boq.unassignedContractorCount > 0) {
      boqIssues.push({
        code: 'BOQ_ITEMS_UNASSIGNED',
        message: `${boq.unassignedContractorCount} BOQ item(s) have no contractor. In the multi-prime model every item needs one.`,
        field: 'items',
      });
    }
  }
  out.boq = { issues: boqIssues, warnings: [] };

  // Reporting: always has valid defaults; the step must still be reviewed (saved) once.
  out.reporting = { issues: [], warnings: [] };
  out.team = { issues: [], warnings: [] };
  return out;
}

function buildStepStatuses(loaded: LoadedSetup): SetupStepStatus[] {
  const state = parseSetupState(loaded.project.setupState);
  const computed = computeStepIssues(loaded);
  const isLive = loaded.project.status !== 'DRAFT';
  return PROJECT_SETUP_STEPS.filter((s) => s.id !== 'review').map((step) => {
    const saved = state.steps[step.id];
    const issues = [...(computed[step.id]?.issues ?? [])];
    // A draft's steps must each be opened and saved; live projects were activated already.
    if (!saved && !isLive && step.required && step.id !== 'basics') {
      issues.unshift({ code: 'STEP_NOT_SAVED', message: `Open "${step.title}" and save it.` });
    }
    return {
      stepId: step.id,
      title: step.title,
      required: step.required,
      saved: Boolean(saved) || step.id === 'basics' || isLive,
      savedAt: saved?.savedAt ?? null,
      complete: issues.length === 0,
      issues,
      warnings: computed[step.id]?.warnings ?? [],
    } as SetupStepStatus;
  });
}

function serializeSetup(loaded: LoadedSetup): ProjectSetupDto {
  const { project, contractors, boq } = loaded;
  const state = parseSetupState(project.setupState);
  const steps = buildStepStatuses(loaded);
  const geofence = project.geofenceGeoJson
    ? (ProjectGeofenceSchema.safeParse(project.geofenceGeoJson).data ?? null)
    : null;
  return {
    projectId: project.id,
    status: project.status,
    createdByUserId: project.createdByUserId,
    activatedAt: project.activatedAt?.toISOString() ?? null,
    basics: {
      name: project.name,
      codePrefix: project.codePrefix,
      stateLocation: project.stateLocation,
      lgaLocation: project.lgaLocation,
      description: project.description,
      totalBudgetNgn: project.totalBudgetNgn === null ? null : Number(project.totalBudgetNgn),
    },
    parties: {
      monitorOrganization: project.monitorOrganization,
      lenderOrganization: project.lenderOrganization,
      contractorExecutionMode: project.contractorExecutionMode as ContractorExecutionMode | null,
      contractors: contractors.map(serializeContractor),
    },
    site: {
      geofenceMode: project.geofenceMode as GeofenceMode | null,
      geofence: geofence as ProjectGeofence | null,
      geofenceToleranceMeters: project.geofenceToleranceMeters,
      effectiveToleranceMeters: project.geofenceToleranceMeters ?? project.tenant.defaultGeofenceToleranceMeters,
      tenantDefaultToleranceMeters: project.tenant.defaultGeofenceToleranceMeters,
      timezone: project.timezone,
      enabledGeofenceModes: enabledModes(project),
    },
    facility: {
      tranches: project.tranches.map((t) => ({
        id: t.id,
        trancheNumber: t.trancheNumber,
        name: t.name,
        allocatedAmountNgn: Number(t.allocatedAmountNgn),
        targetCompletionPct: Number(t.targetCompletionPct),
        isReleased: t.isReleased,
        conditionsPrecedent: t.conditionsPrecedent.map((cp) => ({
          id: cp.id,
          referenceCode: cp.referenceCode,
          description: cp.description,
          isMandatoryForRelease: cp.isMandatoryForRelease,
          status: cp.status,
        })),
      })),
    },
    boq,
    reporting: {
      reportingCadence: project.reportingCadence as ReportingCadence,
      workdayStartTime: project.workdayStartTime,
      workdayEndTime: project.workdayEndTime,
    },
    team: {
      userIds: project.userAssignments.map((a) => a.userId),
      joinCodeRoleIds: state.team.joinCodeRoleIds,
    },
    steps,
    canActivate: project.status === 'DRAFT' && steps.every((s) => !s.required || s.complete),
  };
}

export async function getProjectSetup(projectId: string): Promise<ProjectSetupDto> {
  return serializeSetup(await loadSetupProject(prisma, projectId));
}

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/** Drafts: creators and baseline editors. Live projects: `projects:edit_baseline` only. */
function assertMayEditSetup(webUser: WebJwtPayload, project: { status: string; createdByUserId: string | null }) {
  if (project.status === 'ARCHIVED') {
    throw new AppError('This project is archived and read-only', 409, 'PROJECT_ARCHIVED');
  }
  if (project.status === 'ACTIVE') {
    if (!hasWebPermission(webUser, 'projects:edit_baseline')) {
      throw new AppError('Editing project settings requires projects:edit_baseline', 403, 'FORBIDDEN_PERMISSION');
    }
    return;
  }
  if (!hasWebPermission(webUser, 'projects:create', 'projects:edit_baseline')) {
    throw new AppError('Editing a draft requires projects:create or projects:edit_baseline', 403, 'FORBIDDEN_PERMISSION');
  }
}

// ---------------------------------------------------------------------------
// Create draft
// ---------------------------------------------------------------------------

export async function createProjectDraft(webUser: WebJwtPayload, input: CreateProjectDraftRequest) {
  const tenantId = webUser.tenantId;
  const existing = await prisma.project.findUnique({
    where: { tenantId_codePrefix: { tenantId, codePrefix: input.codePrefix } },
    select: { id: true },
  });
  if (existing) {
    throw new AppError(`A project with code prefix "${input.codePrefix}" already exists`, 409, 'DUPLICATE_PROJECT_PREFIX');
  }

  const projectId = await prisma.$transaction(async (tx) => {
    const [tenant, creatorOrg] = await Promise.all([
      tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true } }),
      tx.organization.findUnique({ where: { id: webUser.organizationId }, select: { id: true, categories: true } }),
    ]);
    const now = new Date().toISOString();
    const state: SetupState = {
      steps: {
        basics: { savedAt: now, savedByUserId: webUser.userId, completedAt: now, completedByUserId: webUser.userId },
      },
      team: { joinCodeRoleIds: null },
    };
    const project = await tx.project.create({
      data: {
        tenantId,
        status: 'DRAFT',
        createdByUserId: webUser.userId,
        timezone: tenant.timezone,
        name: input.name,
        codePrefix: input.codePrefix,
        stateLocation: input.stateLocation,
        lgaLocation: input.lgaLocation ?? null,
        description: input.description ?? null,
        totalBudgetNgn: input.totalBudgetNgn,
        // Pre-fill the monitor only when the creator's organisation is a monitor.
        monitorOrganizationId: (creatorOrg?.categories as string[] | undefined)?.includes('ADVISORY_MONITOR')
          ? creatorOrg!.id
          : null,
        setupState: state as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.userProjectAssignment.create({ data: { userId: webUser.userId, projectId: project.id } });
    await recordAuditEvent(tx, {
      projectId: project.id,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'PROJECT_DRAFT_CREATED',
      summaryText: `Started draft project "${project.name}" (${project.codePrefix}).`,
      payload: { codePrefix: project.codePrefix, name: project.name, totalBudgetNgn: input.totalBudgetNgn },
    });
    return project.id;
  });
  invalidateUserAuthCache(webUser.userId);
  return getProjectSetup(projectId);
}

// ---------------------------------------------------------------------------
// Save one step
// ---------------------------------------------------------------------------

type StepSaver = (ctx: {
  tx: Tx;
  project: SetupProjectRow;
  webUser: WebJwtPayload;
  input: unknown;
}) => Promise<{ changedFields: string[]; payload?: Record<string, unknown>; affectedUserIds?: string[] }>;

function diffFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
}

const saveBasics: StepSaver = async ({ tx, project, input }) => {
  const data = input as CreateProjectDraftRequest;
  if (data.codePrefix !== project.codePrefix) {
    if (project.status !== 'DRAFT') {
      throw new AppError(
        'The project code cannot change once the project is active: join codes, IPC references and reports use it.',
        409,
        'CODE_PREFIX_LOCKED'
      );
    }
    const clash = await tx.project.findUnique({
      where: { tenantId_codePrefix: { tenantId: project.tenantId, codePrefix: data.codePrefix } },
      select: { id: true },
    });
    if (clash && clash.id !== project.id) {
      throw new AppError(`A project with code prefix "${data.codePrefix}" already exists`, 409, 'DUPLICATE_PROJECT_PREFIX');
    }
  }
  const before = {
    name: project.name,
    codePrefix: project.codePrefix,
    stateLocation: project.stateLocation,
    lgaLocation: project.lgaLocation,
    description: project.description,
    totalBudgetNgn: project.totalBudgetNgn === null ? null : Number(project.totalBudgetNgn),
  };
  const after = {
    name: data.name,
    codePrefix: data.codePrefix,
    stateLocation: data.stateLocation,
    lgaLocation: data.lgaLocation ?? null,
    description: data.description ?? null,
    totalBudgetNgn: data.totalBudgetNgn,
  };
  if (project.status !== 'DRAFT' && after.totalBudgetNgn < Number(project.disbursedToDateNgn)) {
    throw new AppError('The budget cannot be below the amount already disbursed', 409, 'BUDGET_BELOW_DISBURSED');
  }
  await tx.project.update({ where: { id: project.id }, data: after });
  return { changedFields: diffFields(before, after) };
};

const saveParties: StepSaver = async ({ tx, project, webUser, input }) => {
  const data = input as ProjectPartiesStep;
  const actor = { actorId: webUser.userId, actorDisplayName: actorName(webUser) };
  const nextMode = (data.contractorExecutionMode ?? null) as ContractorExecutionMode | null;

  if (nextMode !== project.contractorExecutionMode && project.status !== 'DRAFT') {
    const ipcCount = await tx.ipcClaim.count({ where: { projectId: project.id } });
    if (ipcCount > 0) {
      throw new AppError(
        'The contractor model cannot change after an IPC has been submitted on this project.',
        409,
        'CONTRACTOR_MODEL_LOCKED'
      );
    }
  }

  const monitor = data.monitorOrganization
    ? (
        await resolveOrganization(tx, project.tenantId, data.monitorOrganization, 'ADVISORY_MONITOR', {
          allowArchivedId: project.monitorOrganizationId,
          actor,
        })
      ).organization
    : null;
  const lender = data.lenderOrganization
    ? (
        await resolveOrganization(tx, project.tenantId, data.lenderOrganization, 'FINANCIER_LENDER', {
          allowArchivedId: project.lenderOrganizationId,
          actor,
        })
      ).organization
    : null;

  const sync = await syncProjectContractors(tx, {
    projectId: project.id,
    tenantId: project.tenantId,
    mode: nextMode,
    inputs: data.contractors,
    webUser,
  });

  // A live project's model rules must hold after every save (drafts may be incomplete).
  if (project.status !== 'DRAFT') {
    const after = await getProjectContractors(tx, project.id);
    const problems = contractorModelIssues(nextMode, after);
    if (problems.length > 0) {
      throw new AppError(problems[0].message, 422, problems[0].code);
    }
  }

  await tx.project.update({
    where: { id: project.id },
    data: {
      monitorOrganizationId: monitor?.id ?? null,
      lenderOrganizationId: lender?.id ?? null,
      contractorExecutionMode: nextMode,
    },
  });
  if (project.status === 'ACTIVE') {
    await reconcileContractorJoinCodes(tx, project);
  }
  await auditContractorChanges(tx, { projectId: project.id, webUser, result: sync });

  const changedFields = diffFields(
    {
      monitorOrganizationId: project.monitorOrganizationId,
      lenderOrganizationId: project.lenderOrganizationId,
      contractorExecutionMode: project.contractorExecutionMode,
    },
    {
      monitorOrganizationId: monitor?.id ?? null,
      lenderOrganizationId: lender?.id ?? null,
      contractorExecutionMode: nextMode,
    }
  );
  if (sync.added.length || sync.removed.length || sync.updated.length) changedFields.push('contractors');
  return {
    changedFields,
    payload: {
      contractorsAdded: sync.added.map((a) => a.tradeCode),
      contractorsRemoved: sync.removed.map((r) => r.tradeCode),
    },
  };
};

const saveSite: StepSaver = async ({ tx, project, input }) => {
  const data = input as ProjectSiteStep;
  const geofence = data.geofence ?? null;
  if (geofence && geofence.mode !== project.geofenceMode && !enabledModes(project).includes(geofence.mode)) {
    // A project keeps a mode the tenant later disables, but cannot switch to a disabled one.
    throw new AppError(
      `The ${geofence.mode.replace('_', ' ').toLowerCase()} geofence mode is not enabled for this workspace.`,
      422,
      'GEOFENCE_MODE_DISABLED'
    );
  }
  if (!geofence && project.status !== 'DRAFT') {
    throw new AppError('An active project must keep a geofence', 422, 'GEOFENCE_REQUIRED');
  }
  const before = {
    geofence: project.geofenceGeoJson,
    geofenceToleranceMeters: project.geofenceToleranceMeters,
    timezone: project.timezone,
  };
  const after = {
    geofence: geofence as unknown,
    geofenceToleranceMeters: data.geofenceToleranceMeters ?? null,
    timezone: data.timezone ?? project.timezone,
  };
  await tx.project.update({
    where: { id: project.id },
    data: {
      geofenceMode: geofence?.mode ?? null,
      geofenceGeoJson: geofence ? (geofence as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
      geofenceToleranceMeters: after.geofenceToleranceMeters,
      timezone: after.timezone,
    },
  });
  return { changedFields: diffFields(before, after) };
};

const saveFacility: StepSaver = async ({ tx, project, input }) => {
  const data = input as ProjectFacilityStep;
  const budget = project.totalBudgetNgn === null ? null : Number(project.totalBudgetNgn);
  const sum = data.tranches.reduce((s, t) => s + t.allocatedAmountNgn, 0);
  if (budget !== null && sum > budget + 0.005) {
    throw new AppError('Tranche allocations add up to more than the project budget.', 422, 'TRANCHES_EXCEED_BUDGET');
  }
  const numbers = data.tranches.map((t) => t.trancheNumber);
  if (new Set(numbers).size !== numbers.length) {
    throw new AppError('Each tranche needs its own number.', 422, 'DUPLICATE_TRANCHE_NUMBER');
  }

  const existing = await tx.facilityTranche.findMany({
    where: { projectId: project.id },
    include: { conditionsPrecedent: true, _count: { select: { ipcClaims: true } } },
  });
  const byId = new Map(existing.map((t) => [t.id, t]));
  const keep = new Set(data.tranches.map((t) => t.id).filter((v): v is string => Boolean(v)));
  for (const t of data.tranches) {
    if (t.id && !byId.has(t.id)) throw new AppError('Tranche not found on this project', 404, 'TRANCHE_NOT_FOUND');
  }

  for (const t of existing) {
    if (keep.has(t.id)) continue;
    if (t._count.ipcClaims > 0 || t.isReleased || Number(t.releasedAmountNgn) > 0) {
      throw new AppError(`${t.name} has IPC claims or releases and cannot be removed.`, 409, 'TRANCHE_IN_USE');
    }
    await tx.facilityTranche.delete({ where: { id: t.id } });
  }
  // Free tranche numbers before renumbering kept tranches.
  for (const t of existing) {
    if (keep.has(t.id)) {
      await tx.facilityTranche.update({ where: { id: t.id }, data: { trancheNumber: -1 * (1 + existing.indexOf(t)) } });
    }
  }

  for (const t of data.tranches) {
    const base = {
      trancheNumber: t.trancheNumber,
      name: t.name,
      allocatedAmountNgn: t.allocatedAmountNgn,
      targetCompletionPct: t.targetCompletionPct,
    };
    if (t.id) {
      const before = byId.get(t.id)!;
      if (t.allocatedAmountNgn < Number(before.releasedAmountNgn)) {
        throw new AppError(`${t.name}: the allocation cannot be below the amount already released.`, 409, 'TRANCHE_BELOW_RELEASED');
      }
      await tx.facilityTranche.update({ where: { id: t.id }, data: base });
      const cpById = new Map(before.conditionsPrecedent.map((c) => [c.id, c]));
      const keepCp = new Set(t.conditionsPrecedent.map((c) => c.id).filter((v): v is string => Boolean(v)));
      for (const cp of before.conditionsPrecedent) {
        if (!keepCp.has(cp.id)) await tx.conditionPrecedent.delete({ where: { id: cp.id } });
      }
      for (const cp of t.conditionsPrecedent) {
        if (cp.id && cpById.has(cp.id)) {
          // Status is managed through the CP actions (Phase 3), never through setup.
          await tx.conditionPrecedent.update({
            where: { id: cp.id },
            data: {
              referenceCode: cp.referenceCode,
              description: cp.description,
              isMandatoryForRelease: cp.isMandatoryForRelease,
            },
          });
        } else {
          await tx.conditionPrecedent.create({
            data: {
              trancheId: t.id,
              referenceCode: cp.referenceCode,
              description: cp.description,
              isMandatoryForRelease: cp.isMandatoryForRelease,
              status: 'PENDING',
            },
          });
        }
      }
    } else {
      await tx.facilityTranche.create({
        data: {
          projectId: project.id,
          ...base,
          conditionsPrecedent: {
            create: t.conditionsPrecedent.map((cp) => ({
              referenceCode: cp.referenceCode,
              description: cp.description,
              isMandatoryForRelease: cp.isMandatoryForRelease,
              status: 'PENDING' as const,
            })),
          },
        },
      });
    }
  }
  return {
    changedFields: ['tranches'],
    payload: { trancheCount: data.tranches.length, allocatedTotalNgn: sum },
  };
};

const saveBoq: StepSaver = async ({ tx, project, input }) => {
  const data = input as ProjectBoqStep;
  if (data.items.length === 0) return { changedFields: [] };
  const [tranches, contractors, items] = await Promise.all([
    tx.facilityTranche.findMany({ where: { projectId: project.id }, select: { id: true } }),
    tx.projectContractor.findMany({ where: { projectId: project.id }, select: { id: true } }),
    tx.boqItem.findMany({
      where: { projectId: project.id, id: { in: data.items.map((i) => i.boqItemId) } },
      select: { id: true, projectContractorId: true, _count: { select: { ipcLineItems: true } } },
    }),
  ]);
  const trancheIds = new Set(tranches.map((t) => t.id));
  const contractorIds = new Set(contractors.map((c) => c.id));
  const itemById = new Map(items.map((i) => [i.id, i]));
  for (const u of data.items) {
    const item = itemById.get(u.boqItemId);
    if (!item) throw new AppError('BOQ item not found', 404, 'BOQ_ITEM_NOT_FOUND');
    if (u.trancheId && !trancheIds.has(u.trancheId)) throw new AppError('Tranche not found', 404, 'TRANCHE_NOT_FOUND');
    if (u.projectContractorId && !contractorIds.has(u.projectContractorId)) {
      throw new AppError('Contractor not found on this project', 404, 'CONTRACTOR_NOT_FOUND');
    }
    if (
      u.projectContractorId !== undefined &&
      (u.projectContractorId ?? null) !== item.projectContractorId &&
      item._count.ipcLineItems > 0 &&
      project.contractorExecutionMode === 'MULTI_PRIME_SEPARATE_IPC'
    ) {
      throw new AppError('An item that has been claimed cannot move to another contractor.', 409, 'BOQ_ITEM_CLAIMED');
    }
    await tx.boqItem.update({
      where: { id: u.boqItemId },
      data: {
        trancheId: u.trancheId,
        trancheMappingConfirmedByMonitor: u.trancheId !== null,
        isHoldPoint: u.isHoldPoint,
        ...(u.holdPointInstruction !== undefined ? { holdPointInstruction: u.holdPointInstruction } : {}),
        ...(u.isOpaqueLumpSum !== undefined ? { isOpaqueLumpSum: u.isOpaqueLumpSum } : {}),
        ...(u.projectContractorId !== undefined ? { projectContractorId: u.projectContractorId } : {}),
      },
    });
  }
  return { changedFields: ['items'], payload: { updatedItemCount: data.items.length } };
};

const saveReporting: StepSaver = async ({ tx, project, input }) => {
  const data = input as ProjectReportingStep;
  const before = {
    reportingCadence: project.reportingCadence,
    workdayStartTime: project.workdayStartTime,
    workdayEndTime: project.workdayEndTime,
  };
  await tx.project.update({ where: { id: project.id }, data });
  return { changedFields: diffFields(before, data) };
};

const saveTeam: StepSaver = async ({ tx, project, webUser, input }) => {
  const data = input as ProjectTeamStep;
  const wanted = new Set(data.userIds);
  // The creator keeps access to their own draft.
  if (project.status === 'DRAFT' && project.createdByUserId) wanted.add(project.createdByUserId);

  const users = await tx.user.findMany({
    where: { id: { in: [...wanted] }, tenantId: project.tenantId },
    select: { id: true },
  });
  if (users.length !== wanted.size) {
    throw new AppError('One or more users were not found in this workspace', 404, 'USER_NOT_FOUND');
  }
  if (data.joinCodeRoleIds) {
    const roles = await tx.role.findMany({
      where: {
        id: { in: data.joinCodeRoleIds },
        tenantId: project.tenantId,
        surface: { in: ['MOBILE', 'BOTH'] },
        onboardingMode: 'JOIN_CODE',
      },
      select: { id: true },
    });
    if (roles.length !== new Set(data.joinCodeRoleIds).size) {
      throw new AppError('Join codes can only be issued for join-code mobile roles of this workspace', 422, 'INVALID_JOIN_CODE_ROLE');
    }
  }

  const current = new Set(project.userAssignments.map((a) => a.userId));
  const added = [...wanted].filter((id) => !current.has(id));
  const removed = [...current].filter((id) => !wanted.has(id));
  if (added.length) {
    await tx.userProjectAssignment.createMany({
      data: added.map((userId) => ({ userId, projectId: project.id })),
      skipDuplicates: true,
    });
  }
  if (removed.length) {
    await tx.userProjectAssignment.deleteMany({ where: { projectId: project.id, userId: { in: removed } } });
  }
  const state = parseSetupState(project.setupState);
  const beforeRoles = state.team.joinCodeRoleIds;
  state.team.joinCodeRoleIds = data.joinCodeRoleIds ?? null;
  await tx.project.update({
    where: { id: project.id },
    data: { setupState: state as unknown as Prisma.InputJsonValue },
  });
  const changedFields: string[] = [];
  if (added.length || removed.length) changedFields.push('userIds');
  if (JSON.stringify(beforeRoles) !== JSON.stringify(state.team.joinCodeRoleIds)) changedFields.push('joinCodeRoleIds');
  void webUser;
  return { changedFields, payload: { usersAdded: added, usersRemoved: removed }, affectedUserIds: [...added, ...removed] };
};

const STEP_SAVERS: Record<ProjectSetupStepId, StepSaver> = {
  basics: saveBasics,
  parties: saveParties,
  site: saveSite,
  facility: saveFacility,
  boq: saveBoq,
  reporting: saveReporting,
  team: saveTeam,
};

/**
 * Marks a step saved in setupState (and complete if it now has no issues). Used by the step save
 * and by the BOQ upload, which feeds the BOQ step from its own endpoint.
 */
export async function markStepSaved(tx: Tx, projectId: string, stepId: string, userId: string) {
  const loaded = await loadSetupProject(tx, projectId);
  const issues = computeStepIssues(loaded)[stepId]?.issues ?? [];
  const state = parseSetupState(loaded.project.setupState);
  const now = new Date().toISOString();
  state.steps[stepId] = {
    savedAt: now,
    savedByUserId: userId,
    completedAt: issues.length === 0 ? now : null,
    completedByUserId: issues.length === 0 ? userId : null,
  };
  await tx.project.update({ where: { id: projectId }, data: { setupState: state as unknown as Prisma.InputJsonValue } });
}

export async function saveProjectSetupStep(
  projectId: string,
  stepId: string,
  webUser: WebJwtPayload,
  body: unknown
): Promise<ProjectSetupDto> {
  if (!(stepId in STEP_SAVERS)) {
    throw new AppError(`Unknown setup step "${stepId}"`, 404, 'SETUP_STEP_NOT_FOUND');
  }
  const id = stepId as ProjectSetupStepId;
  // Shape validation: a ZodError becomes a 400 with field paths.
  const input = PROJECT_STEP_SAVE_SCHEMAS[id].parse(body);

  let affectedUserIds: string[] = [];
  await prisma.$transaction(async (tx) => {
    // Serialise saves and activation on this project.
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, include: SETUP_INCLUDE });
    assertMayEditSetup(webUser, project);
    const result = await STEP_SAVERS[id]({ tx, project, webUser, input });
    affectedUserIds = result.affectedUserIds ?? [];
    await markStepSaved(tx, projectId, id, webUser.userId);
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'PROJECT_SETUP_STEP_SAVED',
      summaryText: `${project.status === 'DRAFT' ? 'Saved setup' : 'Changed settings'} step "${id}"${
        result.changedFields.length ? ` (${result.changedFields.join(', ')})` : ' (no changes)'
      }.`,
      payload: { stepId: id, projectStatus: project.status, changedFields: result.changedFields, ...(result.payload ?? {}) },
    });
  });
  for (const userId of affectedUserIds) invalidateUserAuthCache(userId);
  return getProjectSetup(projectId);
}

// ---------------------------------------------------------------------------
// Activation, archive, delete
// ---------------------------------------------------------------------------

export async function activateProject(projectId: string, webUser: WebJwtPayload): Promise<ActivateProjectResponse> {
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
    const loaded = await loadSetupProject(tx, projectId);
    const { project } = loaded;
    if (project.status !== 'DRAFT') {
      throw new AppError(
        project.status === 'ACTIVE' ? 'This project is already active' : 'An archived project cannot be activated',
        409,
        project.status === 'ACTIVE' ? 'PROJECT_ALREADY_ACTIVE' : 'PROJECT_ARCHIVED'
      );
    }

    // Re-validate everything: the composed schema for the row, plus the per-step checks.
    const issues: Array<SetupIssue & { stepId: string }> = [];
    for (const step of buildStepStatuses(loaded)) {
      if (step.required) issues.push(...step.issues.map((i) => ({ ...i, stepId: step.stepId })));
    }
    const composed = ProjectActivationSchema.safeParse({
      basics: {
        name: project.name,
        codePrefix: project.codePrefix,
        stateLocation: project.stateLocation ?? '',
        lgaLocation: project.lgaLocation,
        description: project.description,
        totalBudgetNgn: project.totalBudgetNgn === null ? undefined : Number(project.totalBudgetNgn),
      },
      parties: {
        monitorOrganizationId: project.monitorOrganizationId ?? undefined,
        lenderOrganizationId: project.lenderOrganizationId ?? undefined,
        contractorExecutionMode: project.contractorExecutionMode ?? undefined,
      },
      site: { geofence: project.geofenceGeoJson ?? undefined, timezone: project.timezone },
      reporting: {
        reportingCadence: project.reportingCadence,
        workdayStartTime: project.workdayStartTime,
        workdayEndTime: project.workdayEndTime,
      },
    });
    if (!composed.success) {
      for (const i of composed.error.issues) {
        const stepId = String(i.path[0]);
        const field = i.path.slice(1).join('.');
        if (!issues.some((x) => x.stepId === stepId && x.field === field)) {
          issues.push({ code: 'INVALID_FIELD', message: i.message, field, stepId });
        }
      }
    }
    if (issues.length > 0) {
      throw new AppError('The project cannot be activated yet', 422, 'PROJECT_INCOMPLETE', { issues });
    }

    // Join codes for the chosen roles (all join-code mobile roles when none were chosen).
    const state = parseSetupState(project.setupState);
    const roles = await tx.role.findMany({
      where: {
        tenantId: project.tenantId,
        surface: { in: ['MOBILE', 'BOTH'] },
        onboardingMode: 'JOIN_CODE',
        ...(state.team.joinCodeRoleIds ? { id: { in: state.team.joinCodeRoleIds } } : {}),
      },
      orderBy: { assuranceWeight: 'desc' },
    });
    const issued = await issueMissingJoinCodes(tx, project, roles);

    const activatedAt = new Date();
    await tx.project.update({
      where: { id: projectId },
      data: { status: 'ACTIVE', activatedAt, activatedByUserId: webUser.userId },
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'PROJECT_ACTIVATED',
      summaryText: `Set project "${project.name}" (${project.codePrefix}) active and issued ${issued.length} join code(s).`,
      payload: {
        codePrefix: project.codePrefix,
        geofenceMode: project.geofenceMode,
        contractorExecutionMode: project.contractorExecutionMode,
        contractorCount: loaded.contractors.length,
        trancheCount: project.tranches.length,
        boqItemCount: loaded.boq.itemCount,
        issuedJoinCodes: issued.map((jc) => jc.code),
      },
    });
    return {
      projectId,
      status: 'ACTIVE' as const,
      activatedAt: activatedAt.toISOString(),
      issuedJoinCodes: issued.map((jc) => jc.code),
      userIds: project.userAssignments.map((a) => a.userId),
    };
  });
  // Assigned users' mobile project lists change now.
  for (const userId of result.userIds) invalidateUserAuthCache(userId);
  const { userIds: _ignored, ...response } = result;
  return response;
}

export async function archiveProject(projectId: string, webUser: WebJwtPayload, reason?: string) {
  const userIds = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      select: { id: true, name: true, codePrefix: true, status: true, userAssignments: { select: { userId: true } } },
    });
    if (project.status !== 'ACTIVE') {
      throw new AppError(
        project.status === 'DRAFT' ? 'A draft is deleted, not archived' : 'This project is already archived',
        409,
        project.status === 'DRAFT' ? 'PROJECT_IS_DRAFT' : 'PROJECT_ARCHIVED'
      );
    }
    const deactivated = await tx.projectJoinCode.updateMany({
      where: { projectId, isActive: true },
      data: { isActive: false },
    });
    await tx.project.update({ where: { id: projectId }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'PROJECT_ARCHIVED',
      summaryText: `Archived project "${project.name}" (${project.codePrefix})${reason ? `: ${reason}` : ''}.`,
      payload: { reason: reason ?? null, deactivatedJoinCodes: deactivated.count },
    });
    return project.userAssignments.map((a) => a.userId);
  });
  for (const userId of userIds) invalidateUserAuthCache(userId);
  return getProjectSetup(projectId);
}

/** A draft can be deleted by its creator or a tenant administrator when nothing depends on it. */
function mayDeleteDraft(webUser: WebJwtPayload, project: { createdByUserId: string | null }) {
  return (
    project.createdByUserId === webUser.userId ||
    webUser.isPlatformSuperAdmin ||
    hasWebPermission(webUser, 'tenant:manage_settings')
  );
}

export async function deleteDraftProject(projectId: string, webUser: WebJwtPayload) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        id: true,
        tenantId: true,
        name: true,
        codePrefix: true,
        status: true,
        createdByUserId: true,
        _count: {
          select: {
            fieldSessions: true,
            ipcClaims: true,
            evidenceLogs: true,
            workdayReports: true,
            incidentReports: true,
            joinCodes: true,
          },
        },
      },
    });
    if (project.status !== 'DRAFT') {
      throw new AppError('Only a draft can be deleted. Archive an active project instead.', 409, 'PROJECT_NOT_DRAFT');
    }
    if (!mayDeleteDraft(webUser, project)) {
      throw new AppError('Only the person who started this draft or an administrator can delete it', 403, 'FORBIDDEN_PERMISSION');
    }
    const dependents = Object.entries(project._count).filter(([, n]) => n > 0);
    if (dependents.length > 0) {
      throw new AppError('This draft has records that depend on it and cannot be deleted', 409, 'DRAFT_HAS_DEPENDENTS', {
        dependents: Object.fromEntries(dependents),
      });
    }
    await tx.project.delete({ where: { id: projectId } });
    // Tenant scope: project-scoped entries are removed with the project.
    await recordAuditEvent(tx, {
      tenantId: project.tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'PROJECT_DRAFT_DELETED',
      summaryText: `Deleted draft project "${project.name}" (${project.codePrefix}).`,
      payload: { projectId, codePrefix: project.codePrefix, name: project.name },
    });
  });
}

/** Drafts the caller can see, for the Drafts tab. */
export async function listDraftProjects(
  webUser: WebJwtPayload,
  visibilityWhere: Prisma.ProjectWhereInput
): Promise<ProjectDraftSummary[]> {
  const drafts = await prisma.project.findMany({
    where: { AND: [visibilityWhere, { status: 'DRAFT' }] },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, name: true, codePrefix: true, createdByUserId: true, createdAt: true, updatedAt: true },
  });
  if (drafts.length === 0) return [];
  const creatorIds = [...new Set(drafts.map((d) => d.createdByUserId).filter((v): v is string => Boolean(v)))];
  const creators = await prisma.user.findMany({ where: { id: { in: creatorIds } }, select: { id: true, fullName: true } });
  const nameById = new Map(creators.map((c) => [c.id, c.fullName]));
  const required = PROJECT_SETUP_STEPS.filter((s) => s.required);
  const out: ProjectDraftSummary[] = [];
  for (const d of drafts) {
    const loaded = await loadSetupProject(prisma, d.id);
    const steps = buildStepStatuses(loaded);
    out.push({
      id: d.id,
      name: d.name,
      codePrefix: d.codePrefix,
      createdByUserId: d.createdByUserId,
      createdByName: d.createdByUserId ? nameById.get(d.createdByUserId) ?? null : null,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      completedRequiredSteps: steps.filter((s) => s.required && s.complete).length,
      totalRequiredSteps: required.length,
      canDelete: mayDeleteDraft(webUser, d),
    });
  }
  return out;
}

/** Users and join-code roles the team step offers. */
export async function getTeamOptions(projectId: string, tenantId: string) {
  const [users, roles] = await Promise.all([
    prisma.user.findMany({
      where: { tenantId, isActive: true },
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: { select: { name: true, surface: true, onboardingMode: true } },
        mobileRole: { select: { name: true, surface: true, onboardingMode: true } },
        organization: { select: { name: true } },
      },
    }),
    prisma.role.findMany({
      where: { tenantId, surface: { in: ['MOBILE', 'BOTH'] } },
      orderBy: { assuranceWeight: 'desc' },
      select: { id: true, name: true, code: true, fieldPersonaType: true, onboardingMode: true, requiresIdentityAssurance: true },
    }),
  ]);
  const provisioned = (r: { surface: string; onboardingMode: string } | null) =>
    Boolean(r && r.surface !== 'WEB' && r.onboardingMode === 'PROVISIONED_ACCOUNT');
  void projectId;
  return {
    users: users.map((u) => ({
      id: u.id,
      fullName: u.fullName,
      email: u.email,
      roleName: u.role.name,
      organizationName: u.organization.name,
      mobileRoleName: provisioned(u.mobileRole) ? u.mobileRole!.name : provisioned(u.role) ? u.role.name : null,
    })),
    roles: roles.map((r) => ({
      id: r.id,
      name: r.name,
      code: r.code,
      fieldPersonaType: r.fieldPersonaType,
      onboardingMode: r.onboardingMode,
      requiresIdentityAssurance: r.requiresIdentityAssurance,
    })),
  };
}
