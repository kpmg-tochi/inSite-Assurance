import { RetentionSettingsSchema } from './retention.schema';
import { z } from 'zod';
import {
  GeofenceModeEnum,
  OrganizationCategoryEnum,
  ProjectStatusEnum,
} from '../enums';
import { isValidTimeZone } from '../utils/time';
import { GeofenceToleranceMetersSchema, ProjectGeofenceSchema } from './geofence.schema';
import { OrganizationRefSchema } from './organization.schema';
import { ProjectProcessSettingsDtoSchema, ProjectProcessStepSchema, ProjectStandardsStepSchema } from './process.schema';
import {
  ProjectBeneficiaryDtoSchema,
  ProjectBeneficiaryListSchema,
  ProjectTypeSummarySchema,
  RegionSummarySchema,
} from './deliveryModel.schema';
import { ContractStatusEnum, ProjectContractDetailsDtoSchema, ProjectContractStepSchema } from './contract.schema';

/**
 * Staged project creation (Phase 6, decision C; redesign R6a, D-R6.2). A project is created as a
 * DRAFT from the basics section and saved one section at a time. Each section has:
 * - a save schema (shape only: a draft may be incomplete), and
 * - completeness rules, checked by the server and reported as issues per section.
 * Activation re-checks every required section.
 *
 * Two levels: **sections** are what the server saves, validates and audits
 * (`PUT /projects/:id/setup/:sectionId`, `setupState`, audit payloads keep the section id);
 * five **wizard steps** group them for people (1 Project, 2 Contract, 3 Scope & sprints,
 * 4 Team & visits, 5 Review), plus the optional "Advanced" entry listed under a divider.
 */

export const PROJECT_CODE_PREFIX_REGEX = /^[A-Z0-9]{3}-[0-9]{3}$/;

export const ProjectSetupSectionIdEnum = z.enum([
  'basics',
  'parties',
  'site',
  'contractor',
  'contract',
  'facility',
  'scope',
  'standards',
  'team',
  'visits',
  'process',
]);
export type ProjectSetupSectionId = z.infer<typeof ProjectSetupSectionIdEnum>;

export const ProjectSetupWizardStepIdEnum = z.enum(['project', 'contract', 'scope', 'team', 'review', 'advanced']);
export type ProjectSetupWizardStepId = z.infer<typeof ProjectSetupWizardStepIdEnum>;

export interface ProjectSetupSectionDefinition {
  id: ProjectSetupSectionId;
  title: string;
  /** The wizard step that shows this section. */
  stepId: ProjectSetupWizardStepId;
  /** Required to activate (the server may decide per project: contract, standards). */
  required: boolean;
  /** Order on its step page and in the section list. */
  order: number;
  description: string;
}

export const PROJECT_SETUP_SECTIONS: ProjectSetupSectionDefinition[] = [
  { id: 'basics', title: 'Project details', stepId: 'project', required: true, order: 10, description: 'Delivery model, name, code, location and budget' },
  { id: 'parties', title: 'School and organisations', stepId: 'project', required: true, order: 20, description: 'Beneficiaries, owner, monitor and funder' },
  { id: 'site', title: 'Location', stepId: 'project', required: true, order: 30, description: 'Site boundary, tolerance and time zone' },
  // Redesign R6a (D-R6.4): split from the parties section.
  { id: 'contractor', title: 'Contractor', stepId: 'contract', required: true, order: 40, description: 'The contractor and its planned completion' },
  // Phase 13. Required (server-computed) when the project type has contract milestones or documents needed before activation.
  { id: 'contract', title: 'Contract and kick-off', stepId: 'contract', required: false, order: 50, description: 'Contract dates, sum and planned kick-off' },
  // Redesign R1b: the section keeps the retention settings (id "facility" kept: setupState uses it).
  { id: 'facility', title: 'Retention and defects liability', stepId: 'contract', required: false, order: 60, description: 'Retention percentage and defects liability period' },
  // Redesign R2b: facility units, scope lines and sprints (replaces the BOQ step).
  { id: 'scope', title: 'Scope & sprints', stepId: 'scope', required: true, order: 70, description: 'Sprints, facility units and BoQ lines' },
  // Phase 7: required when the process configuration sets standards or needs assessments to
  // REQUIRED_AT_CREATION, hidden when both are off (server-computed).
  { id: 'standards', title: 'Needs assessment and standards', stepId: 'scope', required: false, order: 80, description: 'Needs-assessment documents and project standards' },
  // Team before visits: saving visit officers adds them to the team.
  { id: 'team', title: 'Team', stepId: 'team', required: false, order: 90, description: 'Web users and mobile users' },
  // Redesign R4 (D-R4.39): the visit officers, working days and a preview of the visit plan.
  { id: 'visits', title: 'Visits', stepId: 'team', required: false, order: 100, description: 'Visit officers, working days and the visit plan' },
  // D-R6.9: optional, filled from the type's workflow template on apply.
  { id: 'process', title: 'Workflow and process', stepId: 'advanced', required: false, order: 200, description: 'Template, process switches and approval chains' },
];

export interface ProjectSetupStepDefinition {
  id: ProjectSetupWizardStepId;
  title: string;
  /** Route segment under /app/projects/:id/setup/ and /settings/. */
  route: string;
  /** Sort order. */
  order: number;
  /** Sections shown on this step, in order. */
  sectionIds: ProjectSetupSectionId[];
  /** Not a numbered step: listed under a divider (Advanced). Reachable from drafts and live projects. */
  settingsOnly: boolean;
  description: string;
}

const sectionsOf = (stepId: ProjectSetupWizardStepId) =>
  PROJECT_SETUP_SECTIONS.filter((s) => s.stepId === stepId)
    .sort((a, b) => a.order - b.order)
    .map((s) => s.id);

/** The wizard (D-R6.2). */
export const PROJECT_SETUP_STEPS: ProjectSetupStepDefinition[] = [
  { id: 'project', title: 'Project', route: 'project', order: 1, sectionIds: sectionsOf('project'), settingsOnly: false, description: 'What, where and for whom' },
  { id: 'contract', title: 'Contract', route: 'contract', order: 2, sectionIds: sectionsOf('contract'), settingsOnly: false, description: 'Contractor, contract dates and retention' },
  { id: 'scope', title: 'Scope & sprints', route: 'scope', order: 3, sectionIds: sectionsOf('scope'), settingsOnly: false, description: 'Sprints, facility units, BoQ and needs assessment' },
  { id: 'team', title: 'Team & visits', route: 'team', order: 4, sectionIds: sectionsOf('team'), settingsOnly: false, description: 'People with access and the visit plan' },
  { id: 'review', title: 'Review', route: 'review', order: 5, sectionIds: [], settingsOnly: false, description: 'Check and set the project active' },
  { id: 'advanced', title: 'Advanced', route: 'advanced', order: 100, sectionIds: sectionsOf('advanced'), settingsOnly: true, description: 'Workflow template, process switches and approval chains' },
];

/** The wizard step that shows a section. */
export function wizardStepFor(sectionId: string): ProjectSetupStepDefinition | undefined {
  const section = PROJECT_SETUP_SECTIONS.find((s) => s.id === sectionId);
  return section ? PROJECT_SETUP_STEPS.find((s) => s.id === section.stepId) : undefined;
}

/** "step 2 "Contract"" for numbered steps, ""Advanced"" otherwise (used in issue messages). */
export function wizardStepLabel(step: ProjectSetupStepDefinition): string {
  return step.settingsOnly ? `"${step.title}"` : `step ${step.order} "${step.title}"`;
}

/**
 * Resolves a setup URL segment (D-R6.10). A wizard step route resolves to itself; an old step URL
 * (a section id such as `basics`, `facility` or `visits`) resolves to the step that now holds the
 * section, with `sectionId` set so the page can scroll to `#section-<id>`. Unknown: null.
 */
export function resolveSetupRoute(
  route: string | undefined | null
): { step: ProjectSetupStepDefinition; sectionId: ProjectSetupSectionId | null; legacy: boolean } | null {
  if (!route) return null;
  const step = PROJECT_SETUP_STEPS.find((s) => s.route === route);
  if (step) return { step, sectionId: null, legacy: false };
  // Retired step ids that map onto a current step.
  const retired: Record<string, ProjectSetupSectionId> = { boq: 'scope', reporting: 'team' };
  const sectionId = (ProjectSetupSectionIdEnum.options as string[]).includes(route)
    ? (route as ProjectSetupSectionId)
    : retired[route] ?? null;
  if (!sectionId) return null;
  const owner = wizardStepFor(sectionId);
  return owner ? { step: owner, sectionId, legacy: true } : null;
}

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// ---------------------------------------------------------------------------
// Step 1: basics (creates the draft)
// ---------------------------------------------------------------------------

export const ProjectBasicsStepSchema = z.object({
  name: z.string().trim().min(3, 'Enter at least 3 characters').max(200),
  codePrefix: z
    .string()
    .trim()
    .toUpperCase()
    .regex(PROJECT_CODE_PREFIX_REGEX, 'Format must be e.g. LKK-402 or ABJ-105'),
  stateLocation: z.string().trim().min(2, 'Enter the state or region').max(80),
  lgaLocation: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  totalBudgetNgn: z.number({ invalid_type_error: 'Enter the total budget' }).positive('Budget must be above zero'),
  /** Phase 11: the delivery model. Omitted keeps the current type; null removes it (drafts only). */
  projectTypeId: z.string().uuid().nullable().optional(),
  /** Phase 11: region or area from the tenant list. Omitted keeps the current value. */
  regionId: z.string().uuid().nullable().optional(),
});
export type ProjectBasicsStep = z.infer<typeof ProjectBasicsStepSchema>;

/** POST /projects: creates a DRAFT from the basics step only. */
export const CreateProjectDraftRequestSchema = ProjectBasicsStepSchema;
export type CreateProjectDraftRequest = z.infer<typeof CreateProjectDraftRequestSchema>;

// ---------------------------------------------------------------------------
// Step 2: parties
// ---------------------------------------------------------------------------

/** A contractor's trade code (2 to 6 letters or digits). */
export const TRADE_CODE_REGEX = /^[A-Z0-9]{2,6}$/;

/** The project's contractor (redesign R1d, decision T: one contractor per project, no login). */
export const ProjectContractorInputSchema = z.object({
  /** Existing ProjectContractor row; omit to add. */
  id: z.string().uuid().optional(),
  organization: OrganizationRefSchema,
  tradeCategory: z.string().trim().min(2, 'Enter the trade, e.g. Civil works').max(80),
  tradeCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(TRADE_CODE_REGEX, 'Trade code: 2 to 6 letters or digits, e.g. CIV or ELEC'),
  allocatedBudgetNgn: z.number().nonnegative().nullable().optional(),
  plannedMobilizationDate: IsoDate.nullable().optional(),
  plannedCompletionDate: IsoDate.nullable().optional(),
});
export type ProjectContractorInput = z.infer<typeof ProjectContractorInputSchema>;

export const ProjectPartiesStepSchema = z.object({
  /** Phase 11: the organisation accountable for delivery (a directory entry). Omitted keeps it. */
  owningOrganizationId: z.string().uuid().nullable().optional(),
  monitorOrganization: OrganizationRefSchema.nullable().optional(),
  lenderOrganization: OrganizationRefSchema.nullable().optional(),
  /**
   * Deprecated (redesign R6a, D-R6.4): the contractor has its own section. Omitted keeps the current
   * contractor. Still accepted for one release (seed, older clients): a row not listed is removed
   * (refused if it has activity), and the save also marks the `contractor` section saved.
   */
  contractors: z.array(ProjectContractorInputSchema).max(1, 'A project has one contractor').optional(),
  /** Phase 11: the full beneficiary list; omitted keeps the current list. */
  beneficiaries: ProjectBeneficiaryListSchema.optional(),
});
export type ProjectPartiesStep = z.infer<typeof ProjectPartiesStepSchema>;

/**
 * Redesign R6a (D-R6.4): the contractor section. The full list (at most one): a row not listed is
 * removed (refused if it has activity).
 */
export const ProjectContractorSectionSchema = z.object({
  contractors: z.array(ProjectContractorInputSchema).max(1, 'A project has one contractor'),
});
export type ProjectContractorSection = z.infer<typeof ProjectContractorSectionSchema>;

// ---------------------------------------------------------------------------
// Step 3: site
// ---------------------------------------------------------------------------

export const ProjectSiteStepSchema = z.object({
  geofence: ProjectGeofenceSchema.nullable().optional(),
  /** null uses the tenant default. */
  geofenceToleranceMeters: GeofenceToleranceMetersSchema.nullable().optional(),
  timezone: z.string().trim().refine(isValidTimeZone, 'Choose a valid IANA time zone').optional(),
});
export type ProjectSiteStep = z.infer<typeof ProjectSiteStepSchema>;
export type ProjectSiteStepInput = z.input<typeof ProjectSiteStepSchema>;

// ---------------------------------------------------------------------------
// Step 4: retention (route "facility")
// ---------------------------------------------------------------------------

export const ProjectFacilityStepSchema = z.object({
  /** Phase 10: retention settings; omitted = unchanged. Shown only with the retention module on. */
  retention: RetentionSettingsSchema.optional(),
});
export type ProjectFacilityStep = z.infer<typeof ProjectFacilityStepSchema>;

// ---------------------------------------------------------------------------
// Step 5: scope & sprints (redesign R2b). Data is saved through /scope endpoints (or the workbook
// import); saving the step only marks it reviewed.
// ---------------------------------------------------------------------------

export const ProjectScopeStepSchema = z.object({});
export type ProjectScopeStep = z.infer<typeof ProjectScopeStepSchema>;

// ---------------------------------------------------------------------------
// Redesign R4: visits (officers are saved through /visit-officers; the step saves the working days)
// ---------------------------------------------------------------------------

export const ProjectVisitsStepSchema = z.object({
  /** ISO weekdays (1 = Monday). Visit dates, the officers' move tolerance and deadlines count these. */
  workWeekDays: z.array(z.number().int().min(1).max(7)).min(1, 'Pick at least one working day').max(7),
});
export type ProjectVisitsStep = z.infer<typeof ProjectVisitsStepSchema>;

// ---------------------------------------------------------------------------
// Step 7: team
// ---------------------------------------------------------------------------

export const ProjectTeamStepSchema = z.object({
  /** Web users (and provisioned mobile users) assigned to the project. The creator stays assigned. */
  userIds: z.array(z.string().uuid()).max(500).default([]),
});
export type ProjectTeamStep = z.infer<typeof ProjectTeamStepSchema>;

/** Save schemas by section id (`PUT /projects/:id/setup/:sectionId`). */
export const PROJECT_STEP_SAVE_SCHEMAS = {
  basics: ProjectBasicsStepSchema,
  parties: ProjectPartiesStepSchema,
  contractor: ProjectContractorSectionSchema,
  contract: ProjectContractStepSchema,
  site: ProjectSiteStepSchema,
  facility: ProjectFacilityStepSchema,
  scope: ProjectScopeStepSchema,
  process: ProjectProcessStepSchema,
  standards: ProjectStandardsStepSchema,
  visits: ProjectVisitsStepSchema,
  team: ProjectTeamStepSchema,
} as const satisfies Record<ProjectSetupSectionId, z.ZodTypeAny>;

// ---------------------------------------------------------------------------
// Completeness (activation)
// ---------------------------------------------------------------------------

/**
 * Activation requirements for the steps whose data lives on the project row. The server adds the
 * cross-record checks (BOQ present, contractor packages).
 */
export const ProjectActivationSchema = z.object({
  basics: ProjectBasicsStepSchema,
  // Phase 11: whether the monitor and funder are required follows the project type (checked per
  // step by the server), so they are optional here.
  parties: z.object({
    monitorOrganizationId: z.string().uuid().optional(),
    lenderOrganizationId: z.string().uuid().optional(),
  }),
  site: z.object({
    geofence: ProjectGeofenceSchema,
    timezone: z.string().refine(isValidTimeZone, 'Choose a valid IANA time zone'),
  }),
});

export const SetupIssueSchema = z.object({
  code: z.string(),
  message: z.string(),
  field: z.string().optional(),
});
export type SetupIssue = z.infer<typeof SetupIssueSchema>;

/** Status of one section (the name `steps`/`stepId` is kept for compatibility: D-R6.6). */
export const SetupStepStatusSchema = z.object({
  /** The section id. */
  stepId: z.string(),
  /** Redesign R6a: the wizard step that shows the section. */
  wizardStepId: ProjectSetupWizardStepIdEnum,
  title: z.string(),
  required: z.boolean(),
  /** Saved at least once. */
  saved: z.boolean(),
  savedAt: z.string().nullable(),
  /** No issues. */
  complete: z.boolean(),
  issues: z.array(SetupIssueSchema),
  /** Allowed, but worth a look (e.g. the BOQ total is above the budget). */
  warnings: z.array(SetupIssueSchema).default([]),
});
export type SetupStepStatus = z.infer<typeof SetupStepStatusSchema>;

/** Redesign R6a (D-R6.6): one wizard step, aggregated from its visible sections. */
export const SetupWizardStepStatusSchema = z.object({
  id: ProjectSetupWizardStepIdEnum,
  title: z.string(),
  /** Visible sections, in order. */
  sectionIds: z.array(z.string()),
  /** Any visible section is required. */
  required: z.boolean(),
  /** Every required section saved (a step without required sections: any section saved). */
  saved: z.boolean(),
  /** Every visible section has no issues. */
  complete: z.boolean(),
  issueCount: z.number().int(),
  warningCount: z.number().int(),
});
export type SetupWizardStepStatus = z.infer<typeof SetupWizardStepStatusSchema>;

/** An activation issue (422 PROJECT_INCOMPLETE `details.issues`). */
export const ActivationIssueSchema = SetupIssueSchema.extend({
  /** The section. */
  stepId: z.string(),
  /** Redesign R6a: the wizard step that shows the section. */
  wizardStepId: ProjectSetupWizardStepIdEnum.optional(),
});
export type ActivationIssue = z.infer<typeof ActivationIssueSchema>;

export const ProjectContractorDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  organizationId: z.string().uuid(),
  organizationName: z.string(),
  tradeCategory: z.string(),
  tradeCode: z.string(),
  allocatedBudgetNgn: z.number().nullable(),
  plannedMobilizationDate: z.string().nullable(),
  plannedCompletionDate: z.string().nullable(),
  /** Work is recorded against it (BOQ items, milestones, defects…); the contractor cannot be removed. */
  hasActivity: z.boolean(),
  /** Phase 13: contract state; a terminated contractor keeps its history. */
  contractStatus: ContractStatusEnum,
  terminatedAt: z.string().nullable(),
});
export type ProjectContractorDto = z.infer<typeof ProjectContractorDtoSchema>;

const OrgSummary = z.object({ id: z.string().uuid(), name: z.string() }).nullable();

export const ProjectSetupDtoSchema = z.object({
  projectId: z.string().uuid(),
  status: ProjectStatusEnum,
  createdByUserId: z.string().uuid().nullable(),
  activatedAt: z.string().nullable(),
  basics: z.object({
    name: z.string(),
    codePrefix: z.string(),
    stateLocation: z.string().nullable(),
    lgaLocation: z.string().nullable(),
    description: z.string().nullable(),
    totalBudgetNgn: z.number().nullable(),
    /** Phase 11 */
    projectType: ProjectTypeSummarySchema.nullable(),
    region: RegionSummarySchema.nullable(),
    /** Redesign R2c: needs-assessment details from the workbook (read-only for now). */
    siteAddress: z.string().nullable(),
    strategicJustification: z.string().nullable(),
    assumptions: z.string().nullable(),
  }),
  parties: z.object({
    /** Phase 11 */
    owningOrganization: OrgSummary,
    beneficiaries: z.array(ProjectBeneficiaryDtoSchema),
    /** Phase 11: what the project type requires (today's rules without a type). */
    rules: z.object({
      owningOrganizationRequired: z.boolean(),
      allowedOwningOrganizationIds: z.array(z.string().uuid()).nullable(),
      monitorRequired: z.boolean(),
      funderRequired: z.boolean(),
      beneficiaryRequired: z.boolean(),
      regionRequired: z.boolean(),
    }),
    monitorOrganization: OrgSummary,
    lenderOrganization: OrgSummary,
    contractors: z.array(ProjectContractorDtoSchema),
  }),
  site: z.object({
    geofenceMode: GeofenceModeEnum.nullable(),
    geofence: ProjectGeofenceSchema.nullable(),
    geofenceToleranceMeters: z.number().int().nullable(),
    effectiveToleranceMeters: z.number().int(),
    tenantDefaultToleranceMeters: z.number().int(),
    /** Workspace default radius for a new radial boundary (the project sets its own). */
    tenantDefaultRadiusMeters: z.number().int(),
    timezone: z.string(),
    enabledGeofenceModes: z.array(GeofenceModeEnum),
  }),
  facility: z.object({
    retention: z.object({
      retentionPercentage: z.number().nullable(),
      retentionDurationMonths: z.number().int().nullable(),
      retentionReleaseAtCompletionPct: z.number(),
      /** Retention already held; the percentage applies to later payments only. */
      heldNgn: z.number(),
    }),
  }),
  /** Redesign R2b */
  scope: z.object({
    sprintCount: z.number().int(),
    unitCount: z.number().int(),
    lineCount: z.number().int(),
    /** Lines with no facility unit (legacy projects). */
    unassignedLineCount: z.number().int(),
    totalBudgetedCostNgn: z.number(),
  }),
  /** Phase 13 */
  contract: ProjectContractDetailsDtoSchema,
  team: z.object({
    userIds: z.array(z.string().uuid()),
  }),
  /** Redesign R4 */
  visits: z.object({
    workWeekDays: z.array(z.number().int()),
    defaultOfficerIds: z.array(z.string().uuid()),
  }),
  /** Phase 7 */
  process: ProjectProcessSettingsDtoSchema,
  standards: z.object({
    standardCount: z.number().int(),
    needsAssessmentCount: z.number().int(),
  }),
  /** Section statuses (D-R6.6: name kept). */
  steps: z.array(SetupStepStatusSchema),
  /** Redesign R6a: wizard steps with sections (Review excluded), in order. */
  wizardSteps: z.array(SetupWizardStepStatusSchema),
  canActivate: z.boolean(),
});
export type ProjectSetupDto = z.infer<typeof ProjectSetupDtoSchema>;

export const ActivateProjectResponseSchema = z.object({
  projectId: z.string().uuid(),
  status: ProjectStatusEnum,
  activatedAt: z.string(),
});
export type ActivateProjectResponse = z.infer<typeof ActivateProjectResponseSchema>;

// ---------------------------------------------------------------------------
// BOQ revisions (legacy, read-only: redesign R2d removed the BOQ upload)
// ---------------------------------------------------------------------------

export const BoqRevisionDtoSchema = z.object({
  id: z.string().uuid(),
  revisionNumber: z.number().int(),
  reason: z.string(),
  itemCount: z.number().int(),
  uploadedByUserId: z.string().uuid(),
  uploadedByName: z.string().nullable(),
  createdAt: z.string(),
});
export type BoqRevisionDto = z.infer<typeof BoqRevisionDtoSchema>;

/** Directory row for a draft (Drafts tab). */
export const ProjectDraftSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  codePrefix: z.string(),
  createdByUserId: z.string().uuid().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  /** Redesign R6a: required wizard steps (not sections) that are complete. */
  completedRequiredSteps: z.number().int(),
  totalRequiredSteps: z.number().int(),
  canDelete: z.boolean(),
});
export type ProjectDraftSummary = z.infer<typeof ProjectDraftSummarySchema>;

/** Tag hint per party input, used to filter the organisation dropdown. */
export const PARTY_ORGANIZATION_TAG = {
  owner: 'CLIENT_OWNER',
  monitor: 'ADVISORY_MONITOR',
  lender: 'FINANCIER_LENDER',
  contractor: 'CONTRACTOR',
} as const satisfies Record<string, z.infer<typeof OrganizationCategoryEnum>>;
