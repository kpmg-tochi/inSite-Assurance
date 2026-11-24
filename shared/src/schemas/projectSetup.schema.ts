import { RetentionSettingsSchema } from './retention.schema';
import { z } from 'zod';
import {
  GeofenceModeEnum,
  OrganizationCategoryEnum,
  ProjectStatusEnum,
  ReportingCadenceEnum,
} from '../enums';
import { isValidTimeZone } from '../utils/time';
import { GeofenceToleranceMetersSchema, ProjectGeofenceSchema } from './geofence.schema';
import { OrganizationRefSchema } from './organization.schema';
import { ProjectProcessSettingsDtoSchema, ProjectProcessStepSchema, ProjectStandardsStepSchema } from './process.schema';
import { ProjectCadenceFieldsSchema, ProjectCadenceSettingsDtoSchema } from './cadence.schema';
import {
  ProjectBeneficiaryDtoSchema,
  ProjectBeneficiaryListSchema,
  ProjectTypeSummarySchema,
  RegionSummarySchema,
} from './deliveryModel.schema';
import { ContractStatusEnum, ProjectContractDetailsDtoSchema, ProjectContractStepSchema } from './contract.schema';

/**
 * Staged project creation (Phase 6, decision C). A project is created as a DRAFT from the basics
 * step and saved one step at a time. Each step has:
 * - a save schema (shape only: a draft may be incomplete), and
 * - completeness rules, checked by the server and reported as issues per step.
 * Activation re-checks every required step.
 *
 * Steps are a registry so later phases can add steps without touching the wizard shell.
 */

export const PROJECT_CODE_PREFIX_REGEX = /^[A-Z0-9]{3}-[0-9]{3}$/;

export interface ProjectSetupStepDefinition {
  id: string;
  title: string;
  /** Route segment under /app/projects/:id/setup/ and /settings/. */
  route: string;
  /** Required to activate. */
  required: boolean;
  /** Sort order; gaps leave room for later phases (Phase 7 adds steps between 60 and 70). */
  order: number;
  description: string;
}

export const PROJECT_SETUP_STEPS: ProjectSetupStepDefinition[] = [
  { id: 'basics', title: 'Basics', route: 'basics', required: true, order: 10, description: 'Name, code, location and budget' },
  { id: 'parties', title: 'Parties', route: 'parties', required: true, order: 20, description: 'Monitor, funder and contractor' },
  // Phase 13. Required (server-computed) when the project type has contract milestones or documents needed before activation.
  { id: 'contract', title: 'Contract and kick-off', route: 'contract', required: false, order: 25, description: 'Contract dates, sum and planned kick-off' },
  { id: 'site', title: 'Site', route: 'site', required: true, order: 30, description: 'Geofence, tolerance and time zone' },
  // Redesign R1b: tranches and conditions precedent are gone; the step keeps the retention settings.
  { id: 'facility', title: 'Retention', route: 'facility', required: false, order: 40, description: 'Retention percentage and defects liability period' },
  // Redesign R2b: facility units, scope lines and sprints (replaces the BOQ step).
  { id: 'scope', title: 'Scope & sprints', route: 'scope', required: true, order: 50, description: 'Sprints, facility units and BoQ lines' },
  // Phase 7. Valid defaults, so not required; the standards step becomes required when the process
  // configuration sets standards or needs assessments to REQUIRED_AT_CREATION (server-computed).
  { id: 'process', title: 'Workflow and process', route: 'process', required: false, order: 62, description: 'Template, process switches and approval chains' },
  { id: 'standards', title: 'Standards and needs assessment', route: 'standards', required: false, order: 64, description: 'Project standards and needs-assessment documents' },
  // Redesign R4 (D-R4.39): the visit officers, working days and a preview of the visit plan.
  { id: 'visits', title: 'Visits', route: 'visits', required: false, order: 66, description: 'Visit officers, working days and the visit plan' },
  { id: 'team', title: 'Team', route: 'team', required: false, order: 70, description: 'Web users and mobile users' },
  { id: 'review', title: 'Review', route: 'review', required: false, order: 1000, description: 'Check and set the project active' },
];

export const ProjectSetupStepIdEnum = z.enum(['basics', 'parties', 'contract', 'site', 'facility', 'scope', 'process', 'standards', 'visits', 'team']);
export type ProjectSetupStepId = z.infer<typeof ProjectSetupStepIdEnum>;

const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Use 24-hour HH:MM');
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
  /** The contractor (at most one): a row not listed is removed (refused if it has activity). */
  contractors: z.array(ProjectContractorInputSchema).max(1, 'A project has one contractor').default([]),
  /** Phase 11: the full beneficiary list; omitted keeps the current list. */
  beneficiaries: ProjectBeneficiaryListSchema.optional(),
});
export type ProjectPartiesStep = z.infer<typeof ProjectPartiesStepSchema>;

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
// Step 6: reporting
// ---------------------------------------------------------------------------

export const ProjectReportingStepSchema = z
  .object({
    reportingCadence: ReportingCadenceEnum,
    workdayStartTime: TimeOfDay,
    workdayEndTime: TimeOfDay,
    // Phase 8: omitted fields keep their stored values.
    ...ProjectCadenceFieldsSchema.partial().shape,
  })
  .refine((v) => v.workdayStartTime < v.workdayEndTime, {
    message: 'The working day must end after it starts',
    path: ['workdayEndTime'],
  })
  .refine((v) => v.reportingCadence !== 'CUSTOM_INTERVAL' || (v.customIntervalDays ?? 0) >= 1, {
    message: 'Set how many days a custom period lasts',
    path: ['customIntervalDays'],
  });
export type ProjectReportingStep = z.infer<typeof ProjectReportingStepSchema>;

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

/** Save schemas by step id. */
export const PROJECT_STEP_SAVE_SCHEMAS = {
  basics: ProjectBasicsStepSchema,
  parties: ProjectPartiesStepSchema,
  contract: ProjectContractStepSchema,
  site: ProjectSiteStepSchema,
  facility: ProjectFacilityStepSchema,
  scope: ProjectScopeStepSchema,
  process: ProjectProcessStepSchema,
  standards: ProjectStandardsStepSchema,
  visits: ProjectVisitsStepSchema,
  team: ProjectTeamStepSchema,
} as const;

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

export const SetupStepStatusSchema = z.object({
  stepId: z.string(),
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
    holdPointCount: z.number().int(),
    totalBudgetedCostNgn: z.number(),
  }),
  /** Phase 13 */
  contract: ProjectContractDetailsDtoSchema,
  reporting: ProjectCadenceSettingsDtoSchema.extend({
    /** Project-level mobilization reminder schedule (days before the planned date). */
    reminderOffsetsDays: z.array(z.number().int()),
  }),
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
  steps: z.array(SetupStepStatusSchema),
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
