import { Prisma } from '@prisma/client';
import {
  ActivateProjectResponse,
  addCalendarMonths,
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
  partyRulesFor,
  ProjectBeneficiaryInput,
  ReportingCadence,
  resolveProjectTypeConfig,
  SetupIssue,
  SetupStepStatus,
  addDays,
  nextPeriodStart,
  zonedCalendarDate,
  ProjectContractStep,
  CONTRACT_MILESTONE_ANCHOR_META,
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
import { cadenceSettingsOf, serializeCadenceSettings } from '../cadence/cadence.service';
import {
  applyProcessSettings,
  getProjectProcessSettings,
  initialiseProjectProcess,
} from '../process/processConfig.service';
import { countStandardsDocs } from '../standards/standards.service';
import {
  applyProjectTypeToProject,
  PROJECT_TYPE_SUMMARY_SELECT,
  projectTypeSummary,
  tenantHasActiveProjectTypes,
} from '../projectTypes/projectTypes.service';
import { assertRegionUsable, REGION_SUMMARY_SELECT, regionSummary } from '../regions/regions.service';
import type { ProjectProcessStep } from '@insite/shared';
import { recomputeAndAudit, requiredAnchorsFor, syncContractMilestones, webActor } from '../contracts/milestones.service';
import { archiveBlockedReason, freezeMetAutomaticItems } from '../completion/closure.service';

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
  // Phase 11
  owningOrganization: { select: { id: true, name: true } },
  projectType: { select: PROJECT_TYPE_SUMMARY_SELECT },
  region: { select: REGION_SUMMARY_SELECT },
  beneficiaries: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
  userAssignments: { select: { userId: true } },
} satisfies Prisma.ProjectInclude;

type SetupProjectRow = Prisma.ProjectGetPayload<{ include: typeof SETUP_INCLUDE }>;

async function loadSetupProject(db: Tx | typeof prisma, projectId: string) {
  const project = await db.project.findUnique({ where: { id: projectId }, include: SETUP_INCLUDE });
  if (!project) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  const typeConfigForLoad = resolveProjectTypeConfig(project.projectTypeSnapshotJson);
  const beforeActivationCodes = typeConfigForLoad?.documentRequirements.beforeActivation ?? [];
  const [contractors, itemCount, unassignedContractorCount, holdPointCount, budgetSum, process, standards, tenantHasTypes, presentDocTypes] =
    await Promise.all([
      getProjectContractors(db, projectId),
      db.boqItem.count({ where: { projectId } }),
      db.boqItem.count({ where: { projectId, projectContractorId: null } }),
      db.boqItem.count({ where: { projectId, isHoldPoint: true } }),
      db.boqItem.aggregate({ where: { projectId }, _sum: { budgetedCostNgn: true } }),
      getProjectProcessSettings(projectId, db),
      countStandardsDocs(db, projectId),
      tenantHasActiveProjectTypes(db, project.tenantId),
      // Phase 13: document types already in the register (for the activation gate).
      beforeActivationCodes.length
        ? db.projectDocument.findMany({
            where: { projectId, isArchived: false, documentType: { code: { in: beforeActivationCodes } } },
            select: { documentType: { select: { code: true, name: true } } },
          })
        : Promise.resolve([] as Array<{ documentType: { code: string; name: string } }>),
    ]);
  return {
    project,
    contractors,
    process,
    standards,
    tenantHasTypes,
    /** Phase 11: the project type's rules (from the snapshot), or today's rules without a type. */
    typeConfig: typeConfigForLoad,
    /** Phase 13 */
    contract: {
      requiredAnchors: requiredAnchorsFor(project.projectTypeSnapshotJson),
      milestoneTemplateCount: typeConfigForLoad?.contractMilestones.length ?? 0,
      beforeActivationCodes,
      presentDocTypeCodes: new Set(presentDocTypes.map((d) => d.documentType.code)),
    },
    boq: {
      itemCount,
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
  const config = loaded.process.config;
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
  const basicsIssues: SetupIssue[] = basics.success ? [] : zodIssues(basics.error);
  const rules = partyRulesFor(loaded.typeConfig);
  // Phase 11: a tenant with project types requires one; the type may require a region.
  if (loaded.tenantHasTypes && !project.projectTypeId) {
    basicsIssues.push({ code: 'PROJECT_TYPE_REQUIRED', message: 'Choose the project type.', field: 'projectTypeId' });
  }
  if (rules.regionRequired && !project.regionId) {
    basicsIssues.push({ code: 'REGION_REQUIRED', message: 'Choose the region.', field: 'regionId' });
  }
  out.basics = { issues: basicsIssues, warnings: [] };

  // Parties (Phase 11: which parties are required follows the project type)
  const parties: SetupIssue[] = [];
  if (rules.owningOrganizationRequired && !project.owningOrganizationId) {
    parties.push({ code: 'OWNER_REQUIRED', message: 'Choose the owning organisation.', field: 'owningOrganizationId' });
  }
  const allowedOwners = loaded.typeConfig?.ownership.allowedOwningOrganizationIds ?? null;
  if (project.owningOrganizationId && allowedOwners && !allowedOwners.includes(project.owningOrganizationId)) {
    parties.push({
      code: 'OWNER_NOT_ALLOWED',
      message: 'The owning organisation is not one this project type allows.',
      field: 'owningOrganizationId',
    });
  }
  if (rules.monitorRequired && !project.monitorOrganizationId) {
    parties.push({ code: 'MONITOR_REQUIRED', message: 'Choose the monitor organisation.', field: 'monitorOrganization' });
  }
  if (rules.funderRequired && !project.lenderOrganizationId) {
    parties.push({ code: 'LENDER_REQUIRED', message: 'Choose the funding organisation.', field: 'lenderOrganization' });
  }
  if (rules.beneficiaryRequired && project.beneficiaries.length === 0) {
    parties.push({ code: 'BENEFICIARY_REQUIRED', message: 'Add at least one beneficiary.', field: 'beneficiaries' });
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

  // Contract (Phase 13): the anchors the type's milestones count from, and documents needed before activation.
  const contractIssues: SetupIssue[] = [];
  const anchorField = { CONTRACT_AWARD: 'contractAwardDate', CONTRACT_SIGNED: 'contractSignedDate', KICKOFF: 'kickoffDate' } as const;
  for (const anchor of loaded.contract.requiredAnchors) {
    const field = anchorField[anchor as keyof typeof anchorField];
    if (field && !project[field]) {
      contractIssues.push({
        code: 'CONTRACT_DATE_REQUIRED',
        message: `Enter the ${CONTRACT_MILESTONE_ANCHOR_META[anchor].label.toLowerCase()} date: contract milestones count from it.`,
        field,
      });
    }
  }
  for (const code of loaded.contract.beforeActivationCodes) {
    if (!loaded.contract.presentDocTypeCodes.has(code)) {
      contractIssues.push({
        code: 'DOCUMENT_REQUIRED_BEFORE_ACTIVATION',
        message: `File the ${code.replace(/_/g, ' ').toLowerCase()} in the project documents.`,
        field: 'documents',
      });
    }
  }
  out.contract = { issues: contractIssues, warnings: [] };

  // Site
  const site: SetupIssue[] = [];
  if (!project.geofenceGeoJson) {
    site.push({ code: 'GEOFENCE_REQUIRED', message: 'Draw the site geofence.', field: 'geofence' });
  } else {
    const g = ProjectGeofenceSchema.safeParse(project.geofenceGeoJson);
    if (!g.success) site.push(...zodIssues(g.error, 'geofence'));
  }
  out.site = { issues: site, warnings: [] };

  // Retention (route "facility"): retention needs a liability period when a percentage is set.
  const facility: SetupIssue[] = [];
  if (config.enableRetentionModule && project.retentionPercentage !== null && Number(project.retentionPercentage) > 0 && !project.retentionDurationMonths) {
    facility.push({ code: 'RETENTION_DURATION_REQUIRED', message: 'Set the defects liability period for retention.', field: 'retention' });
  }
  out.facility = { issues: facility, warnings: [] };

  // BOQ
  const boqIssues: SetupIssue[] = [];
  if (boq.itemCount === 0) {
    boqIssues.push({ code: 'BOQ_REQUIRED', message: 'Upload the bill of quantities.', field: 'items' });
  } else {
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

  // Process: valid by construction (validated on save).
  out.process = { issues: [], warnings: [] };

  // Standards and needs assessment (Phase 7): requirements follow the process configuration.
  const standardsIssues: SetupIssue[] = [];
  if (config.standardsSpecificationMode === 'REQUIRED_AT_CREATION' && loaded.standards.standardCount === 0) {
    standardsIssues.push({ code: 'STANDARDS_REQUIRED', message: 'Add at least one project standard.', field: 'standards' });
  }
  if (config.needsAssessmentMode === 'REQUIRED_AT_CREATION' && loaded.standards.needsAssessmentCount === 0) {
    standardsIssues.push({
      code: 'NEEDS_ASSESSMENT_REQUIRED',
      message: 'Upload at least one needs-assessment document.',
      field: 'needsAssessments',
    });
  }
  out.standards = { issues: standardsIssues, warnings: [] };
  return out;
}

/** Whether a step is required for this project (the standards step follows the process modes). */
function stepRequired(step: { id: string; required: boolean }, loaded: LoadedSetup): boolean {
  // Phase 13: the contract step is required when the type has milestones or documents before activation.
  if (step.id === 'contract') return loaded.contract.milestoneTemplateCount > 0 || loaded.contract.beforeActivationCodes.length > 0;
  if (step.id !== 'standards') return step.required;
  const c = loaded.process.config;
  return c.standardsSpecificationMode === 'REQUIRED_AT_CREATION' || c.needsAssessmentMode === 'REQUIRED_AT_CREATION';
}

/** Hidden steps: the standards step disappears when both document modes are off. */
function stepVisible(step: { id: string }, loaded: LoadedSetup): boolean {
  if (step.id !== 'standards') return true;
  const c = loaded.process.config;
  return !(c.standardsSpecificationMode === 'DISABLED' && c.needsAssessmentMode === 'DISABLED');
}

function buildStepStatuses(loaded: LoadedSetup): SetupStepStatus[] {
  const state = parseSetupState(loaded.project.setupState);
  const computed = computeStepIssues(loaded);
  const isLive = loaded.project.status !== 'DRAFT';
  return PROJECT_SETUP_STEPS.filter((s) => s.id !== 'review' && stepVisible(s, loaded)).map((step) => {
    const saved = state.steps[step.id];
    const required = stepRequired(step, loaded);
    const issues = [...(computed[step.id]?.issues ?? [])];
    // A draft's steps must each be opened and saved; live projects were activated already.
    if (!saved && !isLive && required && step.id !== 'basics') {
      issues.unshift({ code: 'STEP_NOT_SAVED', message: `Open "${step.title}" and save it.` });
    }
    return {
      stepId: step.id,
      title: step.title,
      required,
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
      projectType: projectTypeSummary(project),
      region: regionSummary(project.region),
    },
    parties: {
      owningOrganization: project.owningOrganization,
      beneficiaries: project.beneficiaries.map((b) => ({
        id: b.id,
        name: b.name,
        beneficiaryType: b.beneficiaryType,
        contactName: b.contactName,
        contactEmail: b.contactEmail,
        contactPhone: b.contactPhone,
        address: b.address,
        isPrimary: b.isPrimary,
      })),
      rules: (() => {
        const r = partyRulesFor(loaded.typeConfig);
        return {
          owningOrganizationRequired: r.owningOrganizationRequired,
          allowedOwningOrganizationIds: loaded.typeConfig?.ownership.allowedOwningOrganizationIds ?? null,
          monitorRequired: r.monitorRequired,
          funderRequired: r.funderRequired,
          beneficiaryRequired: r.beneficiaryRequired,
          regionRequired: r.regionRequired,
        };
      })(),
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
      retention: {
        retentionPercentage: project.retentionPercentage === null ? null : Number(project.retentionPercentage),
        retentionDurationMonths: project.retentionDurationMonths,
        retentionReleaseAtCompletionPct: Number(project.retentionReleaseAtCompletionPct),
        heldNgn: Number(project.retentionHeldNgn),
      },
    },
    boq,
    contract: {
      contractReference: project.contractReference,
      contractAwardDate: project.contractAwardDate,
      contractSignedDate: project.contractSignedDate,
      contractSumNgn: project.contractSumNgn === null ? null : Number(project.contractSumNgn),
      kickoffDate: project.kickoffDate,
      kickoffHeldAt: project.kickoffHeldAt?.toISOString() ?? null,
      requiredAnchors: loaded.contract.requiredAnchors,
      milestoneTemplateCount: loaded.contract.milestoneTemplateCount,
    },
    reporting: {
      ...serializeCadenceSettings(project),
      reportingCadence: project.reportingCadence as ReportingCadence,
      reminderOffsetsDays: project.mobilizationReminderOffsetsDays,
    },
    team: {
      userIds: project.userAssignments.map((a) => a.userId),
      joinCodeRoleIds: state.team.joinCodeRoleIds,
    },
    process: loaded.process,
    standards: loaded.standards,
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
    // Phase 11: a tenant with project types must pick one first.
    if (!input.projectTypeId && (await tenantHasActiveProjectTypes(tx, tenantId))) {
      throw new AppError('Choose the project type first.', 422, 'PROJECT_TYPE_REQUIRED');
    }
    if (input.regionId) await assertRegionUsable(tx, tenantId, input.regionId, null);
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
        regionId: input.regionId ?? null,
        // Pre-fill the monitor only when the creator's organisation is a monitor.
        monitorOrganizationId: (creatorOrg?.categories as string[] | undefined)?.includes('ADVISORY_MONITOR')
          ? creatorOrg!.id
          : null,
        setupState: state as unknown as Prisma.InputJsonValue,
      },
    });
    await tx.userProjectAssignment.create({ data: { userId: webUser.userId, projectId: project.id } });
    // Phase 7: process settings and both chains, from the tenant's default template if any.
    await initialiseProjectProcess(tx, project);
    // Phase 11: a project type replaces that with its own template, snapshot and defaults.
    if (input.projectTypeId) {
      await applyProjectTypeToProject(tx, project, input.projectTypeId, webUser);
    }
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

const saveBasics: StepSaver = async ({ tx, project, webUser, input }) => {
  const data = input as CreateProjectDraftRequest;
  // Phase 11: the type (re-applied on a draft, locked once live) and the region.
  let typeChange: { changed: boolean; prefilled: string[] } = { changed: false, prefilled: [] };
  if (data.projectTypeId !== undefined) {
    typeChange = await applyProjectTypeToProject(tx, project, data.projectTypeId, webUser);
  }
  if (data.regionId) await assertRegionUsable(tx, project.tenantId, data.regionId, project.regionId);
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
  const regionId = data.regionId === undefined ? project.regionId : data.regionId;
  await tx.project.update({ where: { id: project.id }, data: { ...after, regionId } });
  const changedFields = diffFields({ ...before, regionId: project.regionId }, { ...after, regionId });
  if (typeChange.changed) changedFields.push('projectTypeId');
  return { changedFields, payload: typeChange.changed ? { prefilledFromType: typeChange.prefilled } : undefined };
};

const saveParties: StepSaver = async ({ tx, project, webUser, input }) => {
  const data = input as ProjectPartiesStep;
  const actor = { actorId: webUser.userId, actorDisplayName: actorName(webUser) };
  const nextMode = (data.contractorExecutionMode ?? null) as ContractorExecutionMode | null;

  const monitor = data.monitorOrganization
    ? (
        await resolveOrganization(tx, project.tenantId, data.monitorOrganization, 'ADVISORY_MONITOR', {
          allowArchivedId: project.monitorOrganizationId,
          actor,
        })
      ).organization
    : null;
  // Phase 11: owning organisation (directory entry; the type may limit the choice).
  const typeConfig = resolveProjectTypeConfig(project.projectTypeSnapshotJson);
  const owningOrganizationId =
    data.owningOrganizationId === undefined ? project.owningOrganizationId : data.owningOrganizationId;
  if (owningOrganizationId && owningOrganizationId !== project.owningOrganizationId) {
    const owner = await tx.organization.findFirst({
      where: { id: owningOrganizationId, tenantId: project.tenantId },
      select: { id: true, name: true, isArchived: true },
    });
    if (!owner) throw new AppError('Organisation not found in this workspace', 404, 'ORGANIZATION_NOT_FOUND');
    if (owner.isArchived) throw new AppError(`"${owner.name}" is archived and cannot be chosen`, 409, 'ORGANIZATION_ARCHIVED');
    const allowed = typeConfig?.ownership.allowedOwningOrganizationIds ?? null;
    if (allowed && !allowed.includes(owner.id)) {
      throw new AppError(`"${owner.name}" cannot own a project of this type.`, 422, 'OWNER_NOT_ALLOWED');
    }
  }
  if (!owningOrganizationId && project.owningOrganizationId && project.status !== 'DRAFT') {
    // A live project whose chain has owner-scoped steps cannot lose its owner: nobody could act.
    const scoped = await tx.approvalStep.count({
      where: { projectId: project.id, isActive: true, organizationScope: { in: ['PROJECT_OWNER', 'PROJECT_OWNER_OR_ANCESTOR'] } },
    });
    if (scoped > 0) {
      throw new AppError('Owner-scoped approval steps need an owning organisation.', 409, 'OWNER_REQUIRED_BY_CHAIN');
    }
  }
  const lenderRef =
    data.lenderOrganization ??
    // Phase 11: the type's funder default when the funder is left empty.
    (typeConfig?.parties.funderDefault === 'OWNER' && owningOrganizationId
      ? { id: owningOrganizationId }
      : typeConfig?.parties.funderDefault === 'FIXED' && typeConfig.parties.defaultFunderOrganizationId
        ? { id: typeConfig.parties.defaultFunderOrganizationId }
        : null);
  const lender = lenderRef
    ? (
        await resolveOrganization(tx, project.tenantId, lenderRef, 'FINANCIER_LENDER', {
          allowArchivedId: project.lenderOrganizationId,
          actor,
        })
      ).organization
    : null;
  const beneficiaryChange = data.beneficiaries
    ? await syncBeneficiaries(tx, project.id, data.beneficiaries)
    : { added: 0, removed: 0, updated: 0 };

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
      owningOrganizationId,
      monitorOrganizationId: monitor?.id ?? null,
      lenderOrganizationId: lender?.id ?? null,
      contractorExecutionMode: nextMode,
    },
  });
  if (project.status === 'ACTIVE') {
    await reconcileContractorJoinCodes(tx, project);
  }
  await auditContractorChanges(tx, { projectId: project.id, webUser, result: sync });
  // Phase 13: per-contractor milestones follow the contractor list.
  if (sync.added.length || sync.removed.length) await syncContractMilestones(tx, project.id);

  const changedFields = diffFields(
    {
      owningOrganizationId: project.owningOrganizationId,
      monitorOrganizationId: project.monitorOrganizationId,
      lenderOrganizationId: project.lenderOrganizationId,
      contractorExecutionMode: project.contractorExecutionMode,
    },
    {
      owningOrganizationId,
      monitorOrganizationId: monitor?.id ?? null,
      lenderOrganizationId: lender?.id ?? null,
      contractorExecutionMode: nextMode,
    }
  );
  if (sync.added.length || sync.removed.length || sync.updated.length) changedFields.push('contractors');
  if (beneficiaryChange.added || beneficiaryChange.removed || beneficiaryChange.updated) changedFields.push('beneficiaries');
  return {
    changedFields,
    payload: {
      contractorsAdded: sync.added.map((a) => a.tradeCode),
      contractorsRemoved: sync.removed.map((r) => r.tradeCode),
    },
  };
};

/** Replaces the beneficiary list (Phase 11). The schema guarantees exactly one primary. */
async function syncBeneficiaries(tx: Tx, projectId: string, inputs: ProjectBeneficiaryInput[]) {
  const existing = await tx.projectBeneficiary.findMany({ where: { projectId }, select: { id: true } });
  const known = new Set(existing.map((b) => b.id));
  for (const b of inputs) {
    if (b.id && !known.has(b.id)) throw new AppError('Beneficiary not found on this project', 404, 'BENEFICIARY_NOT_FOUND');
  }
  const keep = new Set(inputs.map((b) => b.id).filter((v): v is string => Boolean(v)));
  const removed = existing.filter((b) => !keep.has(b.id)).map((b) => b.id);
  if (removed.length) await tx.projectBeneficiary.deleteMany({ where: { projectId, id: { in: removed } } });
  let added = 0;
  let updated = 0;
  for (const b of inputs) {
    const data = {
      name: b.name,
      beneficiaryType: b.beneficiaryType,
      contactName: b.contactName ?? null,
      contactEmail: b.contactEmail ?? null,
      contactPhone: b.contactPhone ?? null,
      address: b.address ?? null,
      isPrimary: b.isPrimary,
    };
    if (b.id) {
      await tx.projectBeneficiary.update({ where: { id: b.id }, data });
      updated++;
    } else {
      await tx.projectBeneficiary.create({ data: { projectId, ...data } });
      added++;
    }
  }
  return { added, removed: removed.length, updated };
}

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
  // Phase 10: retention settings. A new percentage applies to later payments only; a new duration
  // moves the end of a liability period that has already started.
  const changedFields: string[] = [];
  let retentionPayload: Record<string, unknown> | undefined;
  if (data.retention) {
    const r = data.retention;
    const pct = r.retentionPercentage && r.retentionPercentage > 0 ? r.retentionPercentage : null;
    if (pct !== null && !r.retentionDurationMonths) {
      throw new AppError('Set the defects liability period for retention.', 422, 'RETENTION_DURATION_REQUIRED');
    }
    const current = await tx.project.findUniqueOrThrow({
      where: { id: project.id },
      select: { retentionStartDate: true },
    });
    await tx.project.update({
      where: { id: project.id },
      data: {
        retentionPercentage: pct,
        retentionDurationMonths: r.retentionDurationMonths,
        retentionReleaseAtCompletionPct: r.retentionReleaseAtCompletionPct,
        ...(current.retentionStartDate
          ? { retentionEndDate: addCalendarMonths(current.retentionStartDate, r.retentionDurationMonths ?? 0) }
          : {}),
      },
    });
    changedFields.push('retention');
    retentionPayload = { ...r, retentionPercentage: pct };
  }
  return {
    changedFields,
    payload: { retention: retentionPayload ?? null },
  };
};

const saveBoq: StepSaver = async ({ tx, project, input }) => {
  const data = input as ProjectBoqStep;
  if (data.items.length === 0) return { changedFields: [] };
  const [contractors, items] = await Promise.all([
    tx.projectContractor.findMany({ where: { projectId: project.id }, select: { id: true } }),
    tx.boqItem.findMany({
      where: { projectId: project.id, id: { in: data.items.map((i) => i.boqItemId) } },
      select: { id: true },
    }),
  ]);
  const contractorIds = new Set(contractors.map((c) => c.id));
  const itemById = new Map(items.map((i) => [i.id, i]));
  for (const u of data.items) {
    const item = itemById.get(u.boqItemId);
    if (!item) throw new AppError('BOQ item not found', 404, 'BOQ_ITEM_NOT_FOUND');
    if (u.projectContractorId && !contractorIds.has(u.projectContractorId)) {
      throw new AppError('Contractor not found on this project', 404, 'CONTRACTOR_NOT_FOUND');
    }
    await tx.boqItem.update({
      where: { id: u.boqItemId },
      data: {
        isHoldPoint: u.isHoldPoint,
        ...(u.holdPointInstruction !== undefined ? { holdPointInstruction: u.holdPointInstruction } : {}),
        ...(u.isOpaqueLumpSum !== undefined ? { isOpaqueLumpSum: u.isOpaqueLumpSum } : {}),
        ...(u.projectContractorId !== undefined ? { projectContractorId: u.projectContractorId } : {}),
      },
    });
  }
  return { changedFields: ['items'], payload: { updatedItemCount: data.items.length } };
};

/** Fields that change the shape of reporting periods (Phase 8). */
const PERIOD_SHAPE_FIELDS = ['reportingCadence', 'workWeekDays', 'periodStartDayOfWeek', 'customIntervalDays', 'cadenceAnchorDate', 'cadenceQuarterAnchorMonth'] as const;

/**
 * Saves cadence settings. On a live project a change to the period shape waits until the next
 * period starts (Phase 8: open obligations and the running period keep their shape); a change to
 * times or grace only applies at once (existing obligations keep their due time).
 */
const saveReporting: StepSaver = async ({ tx, project, input }) => {
  const data = Object.fromEntries(
    Object.entries(input as ProjectReportingStep).filter(([, v]) => v !== undefined)
  ) as ProjectReportingStep;
  const current = serializeCadenceSettings(project);
  const before: Record<string, unknown> = { ...current };
  const changedFields = diffFields(before, data);
  const shapeChanged = PERIOD_SHAPE_FIELDS.some(
    (k) => data[k] !== undefined && JSON.stringify(data[k] ?? null) !== JSON.stringify(current[k] ?? null)
  );
  if (project.status === 'ACTIVE' && shapeChanged) {
    const today = zonedCalendarDate(new Date(), project.timezone);
    const effectiveFrom = nextPeriodStart(cadenceSettingsOf(project), new Date()) ?? addDays(today, 1);
    const pending = { ...current, ...data };
    delete (pending as Record<string, unknown>).timezone;
    await tx.project.update({
      where: { id: project.id },
      data: { pendingCadenceJson: pending as unknown as Prisma.InputJsonValue, pendingCadenceEffectiveFrom: effectiveFrom },
    });
    return { changedFields, payload: { pendingCadenceEffectiveFrom: effectiveFrom } };
  }
  await tx.project.update({
    where: { id: project.id },
    data: { ...data, pendingCadenceJson: Prisma.DbNull, pendingCadenceEffectiveFrom: null },
  });
  return { changedFields };
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

/** Phase 7: template provenance, switches and both chains. Chain edits write new versions. */
const saveProcess: StepSaver = async ({ tx, project, input }) => {
  const data = input as ProjectProcessStep;
  if (data.workflowTemplateId) {
    const template = await tx.workflowTemplate.findFirst({
      where: { id: data.workflowTemplateId, tenantId: project.tenantId },
      select: { id: true },
    });
    if (!template) throw new AppError('Workflow template not found', 404, 'WORKFLOW_TEMPLATE_NOT_FOUND');
  }
  const result = await applyProcessSettings(tx, project, {
    config: data.config,
    reportChain: data.reportChain,
    workflowTemplateId: data.workflowTemplateId,
    confirmDeactivateContractorCodes: data.confirmDeactivateContractorCodes,
  });
  return {
    changedFields: result.changedFields,
    payload: { deactivatedJoinCodes: result.deactivatedJoinCodes, issuedJoinCodes: result.issuedJoinCodes },
  };
};

/**
 * Phase 13: contract details and the planned kick-off. Dates are anchors of the contract milestones:
 * a change recomputes open milestones. On a live project a date change needs milestones:manage and
 * a reason, and is audited.
 */
const saveContract: StepSaver = async ({ tx, project, webUser, input }) => {
  const data = input as ProjectContractStep;
  const before = {
    contractReference: project.contractReference,
    contractAwardDate: project.contractAwardDate,
    contractSignedDate: project.contractSignedDate,
    contractSumNgn: project.contractSumNgn === null ? null : Number(project.contractSumNgn),
    kickoffDate: project.kickoffDate,
  };
  const pick = <K extends keyof typeof before>(k: K) => (data[k] === undefined ? before[k] : (data[k] as (typeof before)[K]));
  const after = {
    contractReference: pick('contractReference'),
    contractAwardDate: pick('contractAwardDate'),
    contractSignedDate: pick('contractSignedDate'),
    contractSumNgn: pick('contractSumNgn'),
    kickoffDate: pick('kickoffDate'),
  };
  // The merged values must still be in order (the schema checks only what was sent).
  if (after.contractAwardDate && after.contractSignedDate && after.contractAwardDate > after.contractSignedDate) {
    throw new AppError('The contract cannot be signed before it is awarded', 422, 'CONTRACT_DATES_OUT_OF_ORDER');
  }
  const kickoff = after.kickoffDate;
  if (kickoff && [after.contractAwardDate, after.contractSignedDate].some((d) => d && d > kickoff)) {
    throw new AppError('The kick-off cannot be before the contract is awarded or signed', 422, 'CONTRACT_DATES_OUT_OF_ORDER');
  }
  const changedFields = diffFields(before, after);
  const anchorsChanged = changedFields.some((f) => f === 'contractAwardDate' || f === 'contractSignedDate' || f === 'kickoffDate');
  if (project.status !== 'DRAFT' && anchorsChanged) {
    if (!hasWebPermission(webUser, 'milestones:manage')) {
      throw new AppError('Moving contract dates on a live project requires milestones:manage', 403, 'FORBIDDEN_PERMISSION');
    }
    if (!data.changeReason) {
      throw new AppError('Say why the contract dates move: the milestone due dates follow them.', 409, 'CHANGE_REASON_REQUIRED');
    }
  }
  await tx.project.update({ where: { id: project.id }, data: after });
  let movedCount = 0;
  if (anchorsChanged) {
    const moved = await recomputeAndAudit(
      tx,
      project.id,
      webActor(webUser),
      data.changeReason ?? `contract dates changed (${changedFields.join(', ')}).`
    );
    movedCount = moved.length;
  }
  return { changedFields, payload: { ...after, changeReason: data.changeReason ?? null, movedMilestones: movedCount } };
};

/** Phase 7: standards and documents are saved through their own endpoints; saving marks the step reviewed. */
const saveStandards: StepSaver = async () => ({ changedFields: [] });

const STEP_SAVERS: Record<ProjectSetupStepId, StepSaver> = {
  basics: saveBasics,
  parties: saveParties,
  contract: saveContract,
  site: saveSite,
  facility: saveFacility,
  boq: saveBoq,
  reporting: saveReporting,
  process: saveProcess,
  standards: saveStandards,
  // Phase 9: dates and dependencies are saved through PUT /schedule/baseline; this marks the step reviewed.
  schedule: saveStandards,
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
        customIntervalDays: project.customIntervalDays,
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
    // Phase 13: milestones counted from activation get their dates now.
    await syncContractMilestones(tx, projectId);
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
    // Phase 15: the type's before-archiving closure items (e.g. post-closure evaluation, audit).
    const blocked = await archiveBlockedReason(tx, projectId);
    if (blocked) throw new AppError(blocked, 409, 'CLOSURE_ITEMS_PENDING');
    await freezeMetAutomaticItems(tx, projectId, 'BEFORE_ARCHIVE', webUser.userId);
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
