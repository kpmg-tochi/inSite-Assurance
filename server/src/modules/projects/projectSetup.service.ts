import { Prisma } from '@prisma/client';
import { getProjectSites, saveProjectSites } from '../sites/sites.service';
import { getNeedsAssessmentImportState } from '../needsAssessment/needsAssessment.service';
import {
  ActivateProjectResponse,
  ActivationIssue,
  addCalendarMonths,
  CreateProjectDraftRequest,
  GeofenceMode,
  PROJECT_SETUP_SECTIONS,
  PROJECT_SETUP_STEPS,
  PROJECT_STEP_SAVE_SCHEMAS,
  ProjectActivationSchema,
  ProjectBasicsStepSchema,
  ProjectContractorSection,
  ProjectDraftSummary,
  ProjectFacilityStep,
  ProjectGeofence,
  ProjectGeofenceSchema,
  ProjectPartiesStep,
  ProjectSetupDto,
  ProjectSetupSectionId,
  ProjectSiteStep,
  ProjectTeamStep,
  ProjectVisitsStep,
  partyRulesFor,
  ProjectBeneficiaryInput,
  resolveProjectTypeConfig,
  SetupIssue,
  SetupStepStatus,
  SetupWizardStepStatus,
  wizardStepFor,
  wizardStepLabel,

  ProjectContractStep,
  CONTRACT_MILESTONE_ANCHOR_META,
  FacilityArchetype,
  validateUnits,
  FundingSourceCodeEnum,
  fundingSourceCodeFromText,
  fundingSourceText,
  findLgaByName,
  findStateByName,
  lgaByCode,
  LOT_BATCH_CODE_REGEX,
  stateByCode,
  zoneOfState,
  allowedInterventionYears,
  zonedCalendarDate,
  formatProjectCodeWithYear,
} from '@insite/shared';
import {
  assertInterventionYearAllowed,
  assignLotBatchCode,
  PROJECT_LOT_REF_SELECT,
  projectLotRef,
} from '../projectLots/projectLots.service';
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
  contractorIssues,
  getProjectContractors,
  serializeContractor,
  syncProjectContractors,
} from './contractors.service';
import {
  applyProcessSettings,
  getProjectProcessSettings,
  initialiseProjectProcess,
} from '../process/processConfig.service';
import { countStandardsDocs } from '../standards/standards.service';
import {
  applyProjectTypeToProject,
  deriveOwnerAndFunder,
  PROJECT_TYPE_SUMMARY_SELECT,
  projectTypeSummary,
  tenantHasActiveProjectTypes,
} from '../projectTypes/projectTypes.service';
import { assertRegionUsable, REGION_SUMMARY_SELECT, regionSummary } from '../regions/regions.service';
import type { ProjectProcessStep } from '@insite/shared';
import { recomputeAndAudit, requiredAnchorsFor, syncContractMilestones, webActor } from '../contracts/milestones.service';
import { proposeVisitsFromType } from '../visits/visitPlan.service';
import { webVisitActor } from '../visits/visitCore';
import { archiveBlockedReason, freezeMetAutomaticItems } from '../completion/closure.service';

/**
 * Staged project creation (Phase 6, decision C). A project starts as a DRAFT from the basics step,
 * is saved one step at a time, and goes live only through `activateProject`. After activation the
 * same steps serve as project settings, with changes that would invalidate live data refused.
 */

type Tx = Prisma.TransactionClient;

const ALL_GEOFENCE_MODES: GeofenceMode[] = ['RADIAL', 'PERIMETER'];

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
  /** Other keys (wave 2: `needsAssessment`, `derivedParties`) are kept as they are. */
  [key: string]: unknown;
}

function parseSetupState(raw: unknown): SetupState {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const steps = obj.steps && typeof obj.steps === 'object' ? (obj.steps as SetupState['steps']) : {};
  return { ...obj, steps };
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
      defaultGeofenceRadiusMeters: true,
      organizationInputMode: true,
      fiscalYearStartMonth: true,
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
  // Client demo updates C3
  lot: { select: PROJECT_LOT_REF_SELECT },
} satisfies Prisma.ProjectInclude;

type SetupProjectRow = Prisma.ProjectGetPayload<{ include: typeof SETUP_INCLUDE }>;

async function loadSetupProject(db: Tx | typeof prisma, projectId: string) {
  const project = await db.project.findUnique({ where: { id: projectId }, include: SETUP_INCLUDE });
  if (!project) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  const typeConfigForLoad = resolveProjectTypeConfig(project.projectTypeSnapshotJson);
  const beforeActivationCodes = typeConfigForLoad?.documentRequirements.beforeActivation ?? [];
  const [contractors, lineCount, unassignedLineCount, budgetSum, sprintCount, units, process, standards, tenantHasTypes, presentDocTypes, lastSprint, sites] =
    await Promise.all([
      getProjectContractors(db, projectId),
      db.boqItem.count({ where: { projectId } }),
      db.boqItem.count({ where: { projectId, facilityUnitId: null } }),
      db.boqItem.aggregate({ where: { projectId }, _sum: { budgetedCostNgn: true } }),
      // Redesign R2b: scope and sprints.
      db.projectSprint.count({ where: { projectId } }),
      db.facilityUnit.findMany({
        where: { projectId },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
        select: {
          code: true,
          label: true,
          plannedQuantity: true,
          facility: { select: { archetype: true } },
          startSprint: { select: { number: true } },
          endSprint: { select: { number: true } },
        },
      }),
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
      // Redesign R6a: the last sprint's end, for the planned completion warning.
      db.projectSprint.findFirst({ where: { projectId }, orderBy: { endDate: 'desc' }, select: { endDate: true } }),
      // Client demo updates C2 (wave 2): the sites, for the activation rule (each located).
      db.projectSite.findMany({
        where: { projectId },
        orderBy: { siteNumber: 'asc' },
        select: { siteNumber: true, schoolName: true, lgaCode: true, latitude: true, longitude: true },
      }),
    ]);
  return {
    project,
    contractors,
    process,
    standards,
    tenantHasTypes,
    sites,
    /**
     * Client demo updates D2 (wave 2): a typed project whose parties section no user has saved runs
     * on the derived owner and funder; the section asks only for what could not be derived.
     */
    partiesDerived: Boolean(project.projectTypeId) && !parseSetupState(project.setupState).steps.parties,
    /** Phase 11: the project type's rules (from the snapshot), or today's rules without a type. */
    typeConfig: typeConfigForLoad,
    /** Phase 13 */
    contract: {
      requiredAnchors: requiredAnchorsFor(project.projectTypeSnapshotJson),
      milestoneTemplateCount: typeConfigForLoad?.contractMilestones.length ?? 0,
      beforeActivationCodes,
      presentDocTypeCodes: new Set(presentDocTypes.map((d) => d.documentType.code)),
    },
    scope: {
      lastSprintEndDate: lastSprint?.endDate ?? null,
      summary: {
        sprintCount,
        unitCount: units.length,
        lineCount,
        unassignedLineCount,
        totalBudgetedCostNgn: Number(budgetSum._sum.budgetedCostNgn ?? 0),
      },
      units: units.map((u) => ({
        code: u.code,
        label: u.label,
        archetype: u.facility.archetype as FacilityArchetype,
        plannedQuantity: u.plannedQuantity === null ? null : Number(u.plannedQuantity),
        startSprintNumber: u.startSprint?.number ?? null,
        endSprintNumber: u.endSprint?.number ?? null,
      })),
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
  const { project, contractors, scope } = loaded;
  const config = loaded.process.config;
  const out: Record<string, { issues: SetupIssue[]; warnings: SetupIssue[] }> = {};
  const budget = project.totalBudgetNgn === null ? null : Number(project.totalBudgetNgn);

  // Basics
  const basics = ProjectBasicsStepSchema.safeParse({
    name: project.name,
    codePrefix: project.codePrefix,
    stateLocation: project.stateLocation || undefined,
    lgaLocation: project.lgaLocation,
    description: project.description,
    totalBudgetNgn: budget ?? undefined,
  });
  const basicsIssues: SetupIssue[] = basics.success ? [] : zodIssues(basics.error);
  // Client demo updates C1: the state is present when it has a code or (older projects) a name.
  if (!project.stateCode && !project.stateLocation?.trim()) {
    basicsIssues.push({ code: 'INVALID_FIELD', message: 'Choose the state.', field: 'stateCode' });
  }
  const rules = partyRulesFor(loaded.typeConfig);
  // Phase 11: a tenant with project types requires one; the type may require a region.
  if (loaded.tenantHasTypes && !project.projectTypeId) {
    basicsIssues.push({ code: 'PROJECT_TYPE_REQUIRED', message: 'Choose the project type.', field: 'projectTypeId' });
  }
  // Client demo updates C1: the State (zone derived from it) is the client's Zone/State, so a
  // State code satisfies the type's "Zone / State required" rule; the tenant region is optional.
  if (rules.regionRequired && !project.regionId && !project.stateCode) {
    basicsIssues.push({ code: 'REGION_REQUIRED', message: 'Choose the zone or state.', field: 'regionId' });
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
  // D2 (wave 2): with derived parties, the independent M&E firm is assigned when one is engaged
  // (team step) and the beneficiary schools are the sites; only a missing owner or funder is asked.
  if (rules.monitorRequired && !project.monitorOrganizationId && !loaded.partiesDerived) {
    parties.push({ code: 'MONITOR_REQUIRED', message: 'Choose the monitor organisation.', field: 'monitorOrganization' });
  }
  if (rules.funderRequired && !project.lenderOrganizationId) {
    parties.push({ code: 'LENDER_REQUIRED', message: 'Choose the funding organisation.', field: 'lenderOrganization' });
  }
  if (rules.beneficiaryRequired && project.beneficiaries.length === 0 && !loaded.partiesDerived) {
    parties.push({ code: 'BENEFICIARY_REQUIRED', message: 'Add at least one beneficiary.', field: 'beneficiaries' });
  }
  out.parties = { issues: parties, warnings: [] };

  // Sites (client demo updates C2, wave 2): optional; when a project has sites, each must be
  // located and in the project's state. A project without sites has no issues here.
  const siteIssues: SetupIssue[] = [];
  if (loaded.sites.length > 0 && !project.stateCode) {
    siteIssues.push({ code: 'STATE_REQUIRED_FOR_SITES', message: 'Choose the project state: every site is in that state.', field: 'stateCode' });
  }
  loaded.sites.forEach((s, index) => {
    if (s.latitude === null || s.longitude === null) {
      siteIssues.push({
        code: 'SITE_NOT_LOCATED',
        message: `Locate site ${s.siteNumber} (${s.schoolName}): enter its coordinates or paste a map link.`,
        field: `sites.${index}.latitude`,
      });
    }
    const lga = lgaByCode(s.lgaCode);
    if (project.stateCode && lga?.stateCode !== project.stateCode) {
      siteIssues.push({
        code: 'SITE_LGA_NOT_IN_STATE',
        message: `The LGA of site ${s.siteNumber} (${s.schoolName}) is not in ${stateByCode(project.stateCode)?.name ?? 'the project state'}.`,
        field: `sites.${index}.lgaCode`,
      });
    }
  });
  out.sites = { issues: siteIssues, warnings: [] };

  // Contractor (redesign R6a, D-R6.4: split from parties)
  const contractorSectionIssues: SetupIssue[] = contractorIssues(contractors).map((i) => ({ ...i, field: 'contractors' }));
  const contractorWarnings: SetupIssue[] = [];
  const allocated = contractors.reduce((s, c) => s + Number(c.allocatedBudgetNgn ?? 0), 0);
  if (budget !== null && allocated > budget) {
    contractorWarnings.push({
      code: 'CONTRACTOR_BUDGETS_EXCEED_PROJECT',
      message: 'The contractor budget is more than the project budget.',
      field: 'contractors',
    });
  }
  out.contractor = { issues: contractorSectionIssues, warnings: contractorWarnings };

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
  // Redesign R6a (D-R6.7): the contractor's planned completion should not be before the last sprint ends.
  const contractWarnings: SetupIssue[] = [];
  const lastSprintEnd = scope.lastSprintEndDate;
  const plannedCompletion = contractors
    .filter((c) => c.contractStatus !== 'TERMINATED' && c.plannedCompletionDate)
    .map((c) => c.plannedCompletionDate!.toISOString().slice(0, 10))[0];
  if (lastSprintEnd && plannedCompletion && plannedCompletion < lastSprintEnd) {
    contractWarnings.push({
      code: 'PLANNED_COMPLETION_BEFORE_SPRINTS_END',
      message: `The contractor's planned completion (${plannedCompletion}) is before the last work phase ends (${lastSprintEnd}).`,
      field: 'plannedCompletionDate',
    });
  }
  out.contract = { issues: contractIssues, warnings: contractWarnings };

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

  // Scope & sprints (redesign R2b, D-R2.6). Projects that went live before R2 have no units and
  // are not flagged.
  const scopeIssues: SetupIssue[] = [];
  const scopeWarnings: SetupIssue[] = [];
  const legacyLive = project.status !== 'DRAFT' && scope.units.length === 0;
  if (!legacyLive) {
    const s = scope.summary;
    if (s.sprintCount === 0) scopeIssues.push({ code: 'SPRINT_REQUIRED', message: 'Add at least one work phase.', field: 'sprints' });
    if (s.lineCount === 0) scopeIssues.push({ code: 'SCOPE_REQUIRED', message: 'Add the BoQ lines (by hand or from the needs assessment).', field: 'lines' });
    if (s.unassignedLineCount > 0) {
      scopeIssues.push({
        code: 'LINE_UNIT_REQUIRED',
        message: `${s.unassignedLineCount} BoQ line(s) have no facility unit.`,
        field: 'lines',
      });
    }
    for (const i of validateUnits(scope.units, { requireSprints: true })) {
      scopeIssues.push({ code: i.code, message: i.message, field: 'units' });
    }
    if (budget !== null && s.totalBudgetedCostNgn > budget + 0.005) {
      scopeWarnings.push({ code: 'SCOPE_ABOVE_BUDGET', message: 'The scope total is above the project budget.', field: 'lines' });
    }
  }
  out.scope = { issues: scopeIssues, warnings: scopeWarnings };

  // Reporting: always has valid defaults; the step must still be reviewed (saved) once.
  out.reporting = { issues: [], warnings: [] };
  out.team = { issues: [], warnings: [] };
  // Redesign R4: optional; warns when nobody is set to carry out the proposed visits.
  out.visits = {
    issues: [],
    warnings: project.defaultVisitOfficerIds.length
      ? []
      : [{ code: 'NO_VISIT_OFFICER', message: 'No monitoring officer is set: proposed monitoring visits need an officer before they are published.', field: 'officers' }],
  };

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

/** Section statuses, in section order (D-R6.2: `stepId` is the section id). */
function buildStepStatuses(loaded: LoadedSetup): SetupStepStatus[] {
  const state = parseSetupState(loaded.project.setupState);
  const computed = computeStepIssues(loaded);
  const isLive = loaded.project.status !== 'DRAFT';
  return [...PROJECT_SETUP_SECTIONS]
    .sort((a, b) => a.order - b.order)
    .filter((s) => stepVisible(s, loaded))
    .map((section) => {
      // Wave 2: sites written by the needs-assessment import count as saved.
      const saved = state.steps[section.id] ?? (section.id === 'sites' && loaded.sites.length > 0 ? ({} as Partial<StepState>) : undefined);
      const issues = [...(computed[section.id]?.issues ?? [])];
      // Wave 2 (C2): the sites section is required once the project has sites (each must be located).
      // D2: derived parties are required only for what could not be derived, and need no save.
      const derivedParties = section.id === 'parties' && loaded.partiesDerived;
      const required =
        section.id === 'sites' ? loaded.sites.length > 0 : derivedParties ? issues.length > 0 : stepRequired(section, loaded);
      const wizardStep = wizardStepFor(section.id)!;
      // A draft's sections must each be opened and saved; live projects were activated already.
      // D-R6.5: the message names the wizard step that shows the section.
      if (!saved && !isLive && required && section.id !== 'basics' && !derivedParties) {
        issues.unshift({ code: 'STEP_NOT_SAVED', message: `Open ${wizardStepLabel(wizardStep)} and save it.` });
      }
      return {
        stepId: section.id,
        wizardStepId: wizardStep.id,
        title: section.title,
        required,
        saved: Boolean(saved) || section.id === 'basics' || isLive,
        savedAt: saved?.savedAt ?? null,
        complete: issues.length === 0,
        issues,
        warnings: computed[section.id]?.warnings ?? [],
      } satisfies SetupStepStatus;
    });
}

/**
 * Redesign R6a (D-R6.6): wizard steps aggregated from their visible sections. Review has no
 * section and is left out; a step whose sections are all hidden is left out.
 */
function buildWizardStepStatuses(sections: SetupStepStatus[]): SetupWizardStepStatus[] {
  const out: SetupWizardStepStatus[] = [];
  for (const step of [...PROJECT_SETUP_STEPS].sort((a, b) => a.order - b.order)) {
    const own = sections.filter((s) => s.wizardStepId === step.id);
    if (own.length === 0) continue;
    const required = own.some((s) => s.required);
    out.push({
      id: step.id,
      title: step.title,
      sectionIds: own.map((s) => s.stepId),
      required,
      saved: required ? own.every((s) => !s.required || s.saved) : own.some((s) => s.saved),
      complete: own.every((s) => s.complete),
      issueCount: own.reduce((n, s) => n + s.issues.length, 0),
      warningCount: own.reduce((n, s) => n + s.warnings.length, 0),
    });
  }
  return out;
}

/** Client demo updates D5: the years the form offers (the allowed ones plus the saved one). */
function interventionYearOptions(project: SetupProjectRow): number[] {
  const today = zonedCalendarDate(new Date(), project.tenant.timezone || 'Africa/Lagos');
  const years = new Set(allowedInterventionYears(today, project.tenant.fiscalYearStartMonth));
  if (project.interventionYear) years.add(project.interventionYear);
  return [...years].sort((a, b) => a - b);
}

function serializeSetup(loaded: LoadedSetup): ProjectSetupDto {
  const { project, contractors } = loaded;
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
      siteAddress: project.siteAddress,
      strategicJustification: project.strategicJustification,
      assumptions: project.assumptions,
      interventionYear: project.interventionYear,
      fundingSource: project.fundingSource,
      externalReference: project.externalReference,
      importedAt: project.importedAt?.toISOString() ?? null,
      // Client demo updates (wave 1)
      stateCode: project.stateCode,
      lgaCode: project.lgaCode,
      zone: zoneOfState(project.stateCode),
      fundingSourceCode: FundingSourceCodeEnum.safeParse(project.fundingSourceCode).data ?? null,
      lot: projectLotRef(project.lot),
      batchNumber: project.batchNumber,
      interventionYearOptions: interventionYearOptions(project),
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
      contractors: contractors.map(serializeContractor),
    },
    site: {
      geofenceMode: project.geofenceMode as GeofenceMode | null,
      geofence: geofence as ProjectGeofence | null,
      geofenceToleranceMeters: project.geofenceToleranceMeters,
      effectiveToleranceMeters: project.geofenceToleranceMeters ?? project.tenant.defaultGeofenceToleranceMeters,
      tenantDefaultToleranceMeters: project.tenant.defaultGeofenceToleranceMeters,
      tenantDefaultRadiusMeters: project.tenant.defaultGeofenceRadiusMeters,
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
    scope: loaded.scope.summary,
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
    team: {
      userIds: project.userAssignments.map((a) => a.userId),
    },
    visits: {
      workWeekDays: project.workWeekDays,
      defaultOfficerIds: project.defaultVisitOfficerIds,
    },
    process: loaded.process,
    standards: loaded.standards,
    steps,
    wizardSteps: buildWizardStepStatuses(steps),
    canActivate: project.status === 'DRAFT' && steps.every((s) => !s.required || s.complete),
  };
}

export async function getProjectSetup(projectId: string): Promise<ProjectSetupDto> {
  const dto = serializeSetup(await loadSetupProject(prisma, projectId));
  // Client demo updates (wave 2): C2 sites (sites module) and D1 needs-assessment tags (needsAssessment module).
  const [sites, needsAssessmentImport] = await Promise.all([getProjectSites(projectId), getNeedsAssessmentImportState(projectId)]);
  return { ...dto, sites, needsAssessmentImport };
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

interface AdminAreaFields {
  stateCode: string | null;
  stateLocation: string | null;
  lgaCode: string | null;
  lgaLocation: string | null;
}

/**
 * Client demo updates C1: state and LGA from the national reference data. A code writes its name
 * into the text field older screens read; text sent without a code (older clients) is kept and
 * matched to a code when it names a state or LGA. Omitted keeps; null clears. An LGA must be in
 * the state (422 LGA_NOT_IN_STATE). `current` is null on create.
 */
export function resolveAdminArea(
  sent: { stateCode?: string | null; stateLocation?: string | null; lgaCode?: string | null; lgaLocation?: string | null },
  current: AdminAreaFields | null
): AdminAreaFields {
  let stateCode: string | null;
  let stateLocation: string | null;
  if (sent.stateCode) {
    const state = stateByCode(sent.stateCode);
    if (!state) throw new AppError(`"${sent.stateCode}" is not a state.`, 422, 'UNKNOWN_STATE');
    stateCode = state.code;
    stateLocation = state.name;
  } else if (sent.stateCode === null) {
    stateCode = null;
    stateLocation = sent.stateLocation ?? null;
  } else if (sent.stateLocation !== undefined) {
    stateLocation = sent.stateLocation;
    stateCode = findStateByName(sent.stateLocation)?.code ?? null;
  } else {
    stateCode = current?.stateCode ?? null;
    stateLocation = current?.stateLocation ?? null;
  }

  let lgaCode: string | null;
  let lgaLocation: string | null;
  if (sent.lgaCode) {
    const lga = lgaByCode(sent.lgaCode);
    if (!lga || !stateCode || lga.stateCode !== stateCode) {
      throw new AppError(
        stateCode ? `That LGA is not in ${stateByCode(stateCode)?.name ?? 'the state'}.` : 'Choose the state before the LGA.',
        422,
        'LGA_NOT_IN_STATE'
      );
    }
    lgaCode = lga.code;
    lgaLocation = lga.name;
  } else if (sent.lgaCode === null) {
    lgaCode = null;
    lgaLocation = sent.lgaLocation ?? null;
  } else if (sent.lgaLocation !== undefined) {
    lgaLocation = sent.lgaLocation;
    lgaCode = stateCode ? (findLgaByName(stateCode, sent.lgaLocation)?.code ?? null) : null;
  } else {
    // Omitted: a coded LGA stays while it is in the state; free text was cleared before C1 and still is.
    const kept = current?.lgaCode ? lgaByCode(current.lgaCode) : null;
    lgaCode = kept && kept.stateCode === stateCode ? kept.code : null;
    lgaLocation = lgaCode ? (current?.lgaLocation ?? kept!.name) : null;
  }
  return { stateCode, stateLocation, lgaCode, lgaLocation };
}

/**
 * Client demo updates C4: the funding source code and the text stored beside it. A code writes
 * `fundingSourceText(code, detail)` (the sent `fundingSource` is the detail); text sent without a
 * code (older clients) is kept and matched to a code when it names one. Omitted keeps; null clears.
 */
export function resolveFundingSource(
  sent: { fundingSourceCode?: string | null; fundingSource?: string | null },
  current: { fundingSourceCode: string | null; fundingSource: string | null } | null
): { fundingSourceCode: string | null; fundingSource: string | null } {
  if (sent.fundingSourceCode) {
    const code = FundingSourceCodeEnum.parse(sent.fundingSourceCode);
    return { fundingSourceCode: code, fundingSource: fundingSourceText(code, sent.fundingSource) };
  }
  if (sent.fundingSourceCode === null) return { fundingSourceCode: null, fundingSource: sent.fundingSource ?? null };
  if (sent.fundingSource !== undefined) {
    return { fundingSourceCode: fundingSourceCodeFromText(sent.fundingSource), fundingSource: sent.fundingSource };
  }
  return { fundingSourceCode: current?.fundingSourceCode ?? null, fundingSource: current?.fundingSource ?? null };
}

/** Lot/batch codes are numbered by the platform: typed ones are refused (choose the lot instead). */
function assertNotManualLotCode(codePrefix: string | undefined, current: string | null) {
  if (codePrefix && codePrefix !== current && LOT_BATCH_CODE_REGEX.test(codePrefix)) {
    throw new AppError('LOT … BATCH … codes are numbered by the platform: choose the lot instead of typing the code.', 422, 'LOT_CODE_NOT_MANUAL');
  }
}

export async function createProjectDraft(webUser: WebJwtPayload, input: CreateProjectDraftRequest) {
  const projectId = await prisma.$transaction((tx) => createProjectDraftInTx(tx, webUser, input));
  invalidateUserAuthCache(webUser.userId);
  return getProjectSetup(projectId);
}

/**
 * Client demo updates (wave 2, D1): the draft creation inside a caller's transaction, so the
 * needs-assessment-first flow creates the draft, its sites, work phases, units and BoQ atomically.
 * Returns the project id; the caller invalidates the creator's auth cache after commit.
 */
export async function createProjectDraftInTx(tx: Tx, webUser: WebJwtPayload, input: CreateProjectDraftRequest): Promise<string> {
  const tenantId = webUser.tenantId;
  // Client demo updates C3: a lot choice numbers the code (it wins over a typed code); without
  // either, 400 PROJECT_CODE_REQUIRED.
  const lotChoice = input.lotChoice;
  if (!input.codePrefix && !lotChoice) throw new AppError('Enter the project code or choose a lot.', 400, 'PROJECT_CODE_REQUIRED');
  if (lotChoice && !input.interventionYear) {
    throw new AppError('Choose the intervention year: the lot and batch are numbered within it.', 422, 'INTERVENTION_YEAR_REQUIRED');
  }
  if (!lotChoice) assertNotManualLotCode(input.codePrefix, null);
  // D5: a new project takes the current or the next intervention year.
  if (input.interventionYear) await assertInterventionYearAllowed(tx, tenantId, input.interventionYear);
  const area = resolveAdminArea(input, null);
  const funding = resolveFundingSource(input, null);
  if (!lotChoice) {
    const existing = await tx.project.findUnique({
      where: { tenantId_codePrefix: { tenantId, codePrefix: input.codePrefix! } },
      select: { id: true },
    });
    if (existing) {
      throw new AppError(`A project with code prefix "${input.codePrefix}" already exists`, 409, 'DUPLICATE_PROJECT_PREFIX');
    }
  }
  if (input.externalReference) await assertExternalReferenceFree(tx, tenantId, input.externalReference, null);

  {
    // C3: the lot lock is taken first and held to commit, so concurrent drafts get distinct batches.
    const assigned = lotChoice
      ? await assignLotBatchCode(tx, {
          tenantId,
          interventionYear: input.interventionYear!,
          lotChoice,
          userId: webUser.userId,
          actorDisplayName: actorName(webUser),
        })
      : null;
    const codePrefix = assigned?.codePrefix ?? input.codePrefix!;
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
    };
    const project = await tx.project.create({
      data: {
        tenantId,
        status: 'DRAFT',
        createdByUserId: webUser.userId,
        timezone: tenant.timezone,
        name: input.name,
        codePrefix,
        ...area,
        description: input.description ?? null,
        totalBudgetNgn: input.totalBudgetNgn,
        regionId: input.regionId ?? null,
        interventionYear: input.interventionYear ?? null,
        ...funding,
        externalReference: input.externalReference ?? null,
        lotId: assigned?.lotId ?? null,
        batchNumber: assigned?.batchNumber ?? null,
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
  }
}

// ---------------------------------------------------------------------------
// Save one step
// ---------------------------------------------------------------------------

type StepSaver = (ctx: {
  tx: Tx;
  project: SetupProjectRow;
  webUser: WebJwtPayload;
  input: unknown;
}) => Promise<{
  changedFields: string[];
  payload?: Record<string, unknown>;
  affectedUserIds?: string[];
  /** Other sections this save also completes (D-R6.4: parties with `contractors`). */
  alsoMarkSaved?: ProjectSetupSectionId[];
}>;

function diffFields(before: Record<string, unknown>, after: Record<string, unknown>): string[] {
  return Object.keys(after).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null));
}

/**
 * UBEC IRL: the client's project ID is unique per workspace (case ignored); 409 EXTERNAL_REFERENCE_TAKEN.
 * The database's unique index is exact; this check also catches a different case.
 */
export async function assertExternalReferenceFree(db: Tx | typeof prisma, tenantId: string, externalReference: string, projectId: string | null) {
  const clash = await db.project.findFirst({
    where: { tenantId, externalReference: { equals: externalReference.trim(), mode: 'insensitive' }, ...(projectId ? { id: { not: projectId } } : {}) },
    select: { codePrefix: true },
  });
  if (clash) {
    throw new AppError(`Project ID "${externalReference}" is already used by ${projectCodeForMessage(clash.codePrefix)}.`, 409, 'EXTERNAL_REFERENCE_TAKEN');
  }
}

/** A code as people read it, with the year of a lot/batch code ("LOT 4 BATCH 1 (2026)"); other codes as stored. */
export function projectCodeForMessage(code: string): string {
  return formatProjectCodeWithYear(code);
}

const saveBasics: StepSaver = async ({ tx, project, webUser, input }) => {
  const data = input as CreateProjectDraftRequest;
  // Omitted keeps, null clears.
  const keep = <T>(sent: T | null | undefined, current: T | null): T | null => (sent === undefined ? current : sent);
  // Phase 11: the type (re-applied on a draft, locked once live) and the region.
  let typeChange: { changed: boolean; prefilled: string[] } = { changed: false, prefilled: [] };
  if (data.projectTypeId !== undefined) {
    typeChange = await applyProjectTypeToProject(tx, project, data.projectTypeId, webUser);
  }
  if (data.regionId) await assertRegionUsable(tx, project.tenantId, data.regionId, project.regionId);

  // Client demo updates D5: a changed year on a draft (not imported) must be the current or next one.
  const interventionYear = keep(data.interventionYear, project.interventionYear);
  const isDraft = project.status === 'DRAFT';
  if (isDraft && !project.importedAt && interventionYear !== null && interventionYear !== project.interventionYear) {
    await assertInterventionYearAllowed(tx, project.tenantId, interventionYear);
  }

  // C3: an omitted code keeps the current one; a lot choice (or a new year on a lot-coded draft)
  // re-numbers a draft; a live project keeps its code.
  assertNotManualLotCode(data.codePrefix, project.codePrefix);
  let codePrefix = data.codePrefix ?? project.codePrefix;
  let lotId = project.lotId;
  let batchNumber = project.batchNumber;
  const lotChoice = data.lotChoice;
  const sameLot =
    lotChoice && 'lotId' in lotChoice && lotChoice.lotId === project.lotId && interventionYear === project.lot?.interventionYear;
  const yearMovedLot = !lotChoice && project.lot && interventionYear !== project.lot.interventionYear;
  if (isDraft && ((lotChoice && !sameLot) || yearMovedLot)) {
    if (!interventionYear) {
      throw new AppError('Choose the intervention year: the lot and batch are numbered within it.', 422, 'INTERVENTION_YEAR_REQUIRED');
    }
    // A new year without a lot choice moves the draft to the lot of that year with the same title
    // (created when the year has none).
    let choice = lotChoice;
    if (!choice) {
      const sameTitle = await tx.projectLot.findFirst({
        where: { tenantId: project.tenantId, interventionYear, title: { equals: project.lot!.title, mode: 'insensitive' } },
        select: { id: true },
      });
      choice = sameTitle ? { lotId: sameTitle.id } : { newLotTitle: project.lot!.title };
    }
    const assigned = await assignLotBatchCode(tx, {
      tenantId: project.tenantId,
      interventionYear,
      lotChoice: choice,
      userId: webUser.userId,
      actorDisplayName: actorName(webUser),
    });
    codePrefix = assigned.codePrefix;
    lotId = assigned.lotId;
    batchNumber = assigned.batchNumber;
  } else if (!isDraft && lotChoice && !sameLot) {
    throw new AppError('The project code cannot change once the project is active.', 409, 'CODE_PREFIX_LOCKED');
  } else if (isDraft && data.codePrefix && data.codePrefix !== project.codePrefix && project.lotId) {
    // A typed code replaces the lot numbering.
    lotId = null;
    batchNumber = null;
  }
  if (codePrefix !== project.codePrefix) {
    if (!isDraft) {
      throw new AppError(
        'The project code cannot change once the project is active: join codes, IPC references and reports use it.',
        409,
        'CODE_PREFIX_LOCKED'
      );
    }
    const clash = await tx.project.findUnique({
      where: { tenantId_codePrefix: { tenantId: project.tenantId, codePrefix } },
      select: { id: true },
    });
    if (clash && clash.id !== project.id) {
      throw new AppError(`A project with code prefix "${codePrefix}" already exists`, 409, 'DUPLICATE_PROJECT_PREFIX');
    }
  }
  // UBEC IRL register fields: omitted keeps, null clears; the client project ID is unique per workspace.
  const externalReference = keep(data.externalReference, project.externalReference);
  if (externalReference && externalReference !== project.externalReference) {
    await assertExternalReferenceFree(tx, project.tenantId, externalReference, project.id);
  }
  const area = resolveAdminArea(data, project);
  const funding = resolveFundingSource(data, project);
  const before = {
    name: project.name,
    codePrefix: project.codePrefix,
    stateCode: project.stateCode,
    stateLocation: project.stateLocation,
    lgaCode: project.lgaCode,
    lgaLocation: project.lgaLocation,
    description: project.description,
    totalBudgetNgn: project.totalBudgetNgn === null ? null : Number(project.totalBudgetNgn),
    interventionYear: project.interventionYear,
    fundingSourceCode: project.fundingSourceCode,
    fundingSource: project.fundingSource,
    externalReference: project.externalReference,
    lotId: project.lotId,
    batchNumber: project.batchNumber,
  };
  const after = {
    name: data.name,
    codePrefix,
    ...area,
    description: data.description ?? null,
    totalBudgetNgn: data.totalBudgetNgn,
    interventionYear,
    ...funding,
    externalReference,
    lotId,
    batchNumber,
  };
  if (project.status !== 'DRAFT' && after.totalBudgetNgn < Number(project.disbursedToDateNgn)) {
    throw new AppError('The budget cannot be below the amount already disbursed', 409, 'BUDGET_BELOW_DISBURSED');
  }
  const regionId = data.regionId === undefined ? project.regionId : data.regionId;
  await tx.project.update({ where: { id: project.id }, data: { ...after, regionId } });
  const changedFields = diffFields({ ...before, regionId: project.regionId }, { ...after, regionId });
  if (typeChange.changed) changedFields.push('projectTypeId');
  // Client demo updates D2 (wave 2): a draft's owner and funder follow its type and state (never a
  // value a user saved). The type apply above ran on the old state, so derive again after the update.
  if (isDraft && (typeChange.changed || area.stateCode !== project.stateCode)) {
    for (const field of await deriveOwnerAndFunder(tx, project.id)) {
      if (!changedFields.includes(field)) changedFields.push(field);
    }
  }
  return { changedFields, payload: typeChange.changed ? { prefilledFromType: typeChange.prefilled } : undefined };
};

const saveParties: StepSaver = async ({ tx, project, webUser, input }) => {
  const data = input as ProjectPartiesStep;
  const actor = { actorId: webUser.userId, actorDisplayName: actorName(webUser) };

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

  await tx.project.update({
    where: { id: project.id },
    data: {
      owningOrganizationId,
      monitorOrganizationId: monitor?.id ?? null,
      lenderOrganizationId: lender?.id ?? null,
    },
  });
  // Redesign R6a (D-R6.4): the contractor has its own section; omitted keeps it. Sending it here
  // is still accepted for one release (seed, older clients) and also marks that section saved.
  const contractorResult =
    data.contractors === undefined ? null : await applyContractors(tx, project, webUser, data.contractors);

  const changedFields = diffFields(
    {
      owningOrganizationId: project.owningOrganizationId,
      monitorOrganizationId: project.monitorOrganizationId,
      lenderOrganizationId: project.lenderOrganizationId,
    },
    {
      owningOrganizationId,
      monitorOrganizationId: monitor?.id ?? null,
      lenderOrganizationId: lender?.id ?? null,
    }
  );
  if (contractorResult?.changed) changedFields.push('contractors');
  if (beneficiaryChange.added || beneficiaryChange.removed || beneficiaryChange.updated) changedFields.push('beneficiaries');
  return {
    changedFields,
    payload: contractorResult ? contractorResult.payload : undefined,
    alsoMarkSaved: contractorResult ? ['contractor'] : undefined,
  };
};

/**
 * Makes the project's contractor equal `inputs` (at most one), audits the change and keeps the
 * per-contractor milestones in step. A live project must keep a contractor.
 */
async function applyContractors(
  tx: Tx,
  project: SetupProjectRow,
  webUser: WebJwtPayload,
  inputs: NonNullable<ProjectPartiesStep['contractors']>
) {
  const sync = await syncProjectContractors(tx, {
    projectId: project.id,
    tenantId: project.tenantId,
    inputs,
    webUser,
  });
  // A live project keeps its contractor after every save (drafts may be incomplete).
  if (project.status !== 'DRAFT') {
    const after = await getProjectContractors(tx, project.id);
    const problems = contractorIssues(after);
    if (problems.length > 0) {
      throw new AppError(problems[0].message, 422, problems[0].code);
    }
  }
  await auditContractorChanges(tx, { projectId: project.id, webUser, result: sync });
  // Phase 13: per-contractor milestones follow the contractor list.
  if (sync.added.length || sync.removed.length) await syncContractMilestones(tx, project.id);
  return {
    changed: Boolean(sync.added.length || sync.removed.length || sync.updated.length),
    payload: {
      contractorsAdded: sync.added.map((a) => a.tradeCode),
      contractorsRemoved: sync.removed.map((r) => r.tradeCode),
    },
  };
}

/** Redesign R6a (D-R6.4): the contractor section. */
const saveContractor: StepSaver = async ({ tx, project, webUser, input }) => {
  const data = input as ProjectContractorSection;
  const result = await applyContractors(tx, project, webUser, data.contractors);
  return { changedFields: result.changed ? ['contractors'] : [], payload: result.payload };
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

/** Redesign R2b: scope data is saved through /scope (or the workbook); saving marks the step reviewed. */
const saveScope: StepSaver = async () => ({ changedFields: [] });

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
  const changedFields: string[] = [];
  if (added.length || removed.length) changedFields.push('userIds');
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
  });
  return { changedFields: result.changedFields };
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

/** Redesign R4: the visits step saves the working days (officers have their own endpoint). */
const saveVisits: StepSaver = async ({ tx, project, input }) => {
  const data = input as ProjectVisitsStep;
  const workWeekDays = [...new Set(data.workWeekDays)].sort((a, b) => a - b);
  const changedFields = JSON.stringify(workWeekDays) === JSON.stringify(project.workWeekDays) ? [] : ['workWeekDays'];
  if (changedFields.length) await tx.project.update({ where: { id: project.id }, data: { workWeekDays } });
  return { changedFields };
};

const STEP_SAVERS: Record<ProjectSetupSectionId, StepSaver> = {
  basics: saveBasics,
  parties: saveParties,
  contractor: saveContractor,
  contract: saveContract,
  site: saveSite,
  facility: saveFacility,
  scope: saveScope,
  process: saveProcess,
  standards: saveStandards,
  visits: saveVisits,
  team: saveTeam,
  // Client demo updates C2 (wave 2): sites module (WS-B1).
  sites: ({ tx, project, webUser, input }) => saveProjectSites(tx, project.id, webUser, input),
};

/**
 * Marks a section saved in setupState (and complete if it now has no issues). Used by the section
 * save and by the scope endpoints, which feed the scope section from their own routes.
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

/** Saves one section (`stepId` is a section id: D-R6.2 keeps the endpoint and audit payloads). */
export async function saveProjectSetupStep(
  projectId: string,
  stepId: string,
  webUser: WebJwtPayload,
  body: unknown
): Promise<ProjectSetupDto> {
  if (!Object.prototype.hasOwnProperty.call(STEP_SAVERS, stepId)) {
    throw new AppError(`Unknown setup step "${stepId}"`, 404, 'SETUP_STEP_NOT_FOUND');
  }
  const id = stepId as ProjectSetupSectionId;
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
    for (const other of result.alsoMarkSaved ?? []) await markStepSaved(tx, projectId, other, webUser.userId);
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

    // Re-validate everything: the composed schema for the row, plus the per-section checks.
    // Redesign R6a: each issue names its section (`stepId`) and the wizard step that shows it.
    const issues: ActivationIssue[] = [];
    for (const step of buildStepStatuses(loaded)) {
      if (step.required) issues.push(...step.issues.map((i) => ({ ...i, stepId: step.stepId, wizardStepId: step.wizardStepId })));
    }
    const composed = ProjectActivationSchema.safeParse({
      basics: {
        name: project.name,
        codePrefix: project.codePrefix,
        // C1: the state is checked by the basics section (code or name).
        stateLocation: project.stateLocation || undefined,
        lgaLocation: project.lgaLocation,
        description: project.description,
        totalBudgetNgn: project.totalBudgetNgn === null ? undefined : Number(project.totalBudgetNgn),
      },
      parties: {
        monitorOrganizationId: project.monitorOrganizationId ?? undefined,
        lenderOrganizationId: project.lenderOrganizationId ?? undefined,
      },
      site: { geofence: project.geofenceGeoJson ?? undefined, timezone: project.timezone },
    });
    if (!composed.success) {
      for (const i of composed.error.issues) {
        const stepId = String(i.path[0]);
        const field = i.path.slice(1).join('.');
        if (!issues.some((x) => x.stepId === stepId && x.field === field)) {
          issues.push({ code: 'INVALID_FIELD', message: i.message, field, stepId, wizardStepId: wizardStepFor(stepId)?.id });
        }
      }
    }
    if (issues.length > 0) {
      throw new AppError('The project cannot be activated yet', 422, 'PROJECT_INCOMPLETE', { issues });
    }

    const activatedAt = new Date();
    await tx.project.update({
      where: { id: projectId },
      data: { status: 'ACTIVE', activatedAt, activatedByUserId: webUser.userId },
    });
    // Phase 13: milestones counted from activation get their dates now.
    await syncContractMilestones(tx, projectId);
    // Redesign R4 (D-R4.12): the type's visit plan proposes the project's visits.
    await proposeVisitsFromType(tx, projectId, { trigger: 'ACTIVATION', actor: webVisitActor(webUser), now: activatedAt });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'PROJECT_ACTIVATED',
      summaryText: `Set project "${project.name}" (${project.codePrefix}) active.`,
      payload: {
        codePrefix: project.codePrefix,
        geofenceMode: project.geofenceMode,
        contractorCount: loaded.contractors.length,
        boqItemCount: loaded.scope.summary.lineCount,
        sprintCount: loaded.scope.summary.sprintCount,
        facilityUnitCount: loaded.scope.summary.unitCount,
      },
    });
    return {
      projectId,
      status: 'ACTIVE' as const,
      activatedAt: activatedAt.toISOString(),
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
    await tx.project.update({ where: { id: projectId }, data: { status: 'ARCHIVED', archivedAt: new Date() } });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'PROJECT_ARCHIVED',
      summaryText: `Archived project "${project.name}" (${project.codePrefix})${reason ? `: ${reason}` : ''}.`,
      payload: { reason: reason ?? null },
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
            incidentReports: true,
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
  const out: ProjectDraftSummary[] = [];
  for (const d of drafts) {
    const loaded = await loadSetupProject(prisma, d.id);
    // Redesign R6a (D-R6.6): progress counts required wizard steps, not sections.
    const required = buildWizardStepStatuses(buildStepStatuses(loaded)).filter((s) => s.required);
    out.push({
      id: d.id,
      name: d.name,
      codePrefix: d.codePrefix,
      createdByUserId: d.createdByUserId,
      createdByName: d.createdByUserId ? nameById.get(d.createdByUserId) ?? null : null,
      createdAt: d.createdAt.toISOString(),
      updatedAt: d.updatedAt.toISOString(),
      completedRequiredSteps: required.filter((s) => s.complete).length,
      totalRequiredSteps: required.length,
      canDelete: mayDeleteDraft(webUser, d),
    });
  }
  return out;
}

/** Users and mobile roles the team step offers (R1d: mobile users sign in with their account). */
export async function getTeamOptions(projectId: string, tenantId: string) {
  const [users, roles] = await Promise.all([
    prisma.user.findMany({
      where: { tenantId, isActive: true },
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        fullName: true,
        email: true,
        role: { select: { name: true, surface: true } },
        mobileRole: { select: { name: true, surface: true } },
        organization: { select: { name: true } },
      },
    }),
    prisma.role.findMany({
      where: { tenantId, surface: { in: ['MOBILE', 'BOTH'] } },
      orderBy: { assuranceWeight: 'desc' },
      select: { id: true, name: true, code: true, fieldPersonaType: true },
    }),
  ]);
  const provisioned = (r: { surface: string } | null) => Boolean(r && r.surface !== 'WEB');
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
    })),
  };
}
