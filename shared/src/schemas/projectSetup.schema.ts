import { RetentionSettingsSchema } from './retention.schema';
import { z } from 'zod';
import {
  ContractorExecutionModeEnum,
  GeofenceModeEnum,
  OrganizationCategoryEnum,
  ProjectStatusEnum,
  ReportingCadenceEnum,
} from '../enums';
import { TRADE_CODE_REGEX } from '../joinCodes';
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
  { id: 'boq', title: 'Bill of quantities', route: 'boq', required: true, order: 50, description: 'BOQ items, hold points and packages' },
  { id: 'reporting', title: 'Reporting', route: 'reporting', required: true, order: 60, description: 'Cadence and working day' },
  // Phase 9. After Reporting, which sets the work-week the schedule counts in; optional for activation.
  // Dates and dependencies are saved through the schedule endpoints.
  { id: 'schedule', title: 'Schedule', route: 'schedule', required: false, order: 61, description: 'Project and item dates, dependencies' },
  // Phase 7. Valid defaults, so not required; the standards step becomes required when the process
  // configuration sets standards or needs assessments to REQUIRED_AT_CREATION (server-computed).
  { id: 'process', title: 'Workflow and process', route: 'process', required: false, order: 62, description: 'Template, process switches and approval chains' },
  { id: 'standards', title: 'Standards and needs assessment', route: 'standards', required: false, order: 64, description: 'Project standards and needs-assessment documents' },
  { id: 'team', title: 'Team', route: 'team', required: false, order: 70, description: 'Web users, mobile users and join codes' },
  { id: 'review', title: 'Review', route: 'review', required: false, order: 1000, description: 'Check and set the project active' },
];

export const ProjectSetupStepIdEnum = z.enum(['basics', 'parties', 'contract', 'site', 'facility', 'boq', 'reporting', 'schedule', 'process', 'standards', 'team']);
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
  isMainContractor: z.boolean().default(false),
  allocatedBudgetNgn: z.number().nonnegative().nullable().optional(),
  allowFieldReporting: z.boolean().default(true),
  plannedMobilizationDate: IsoDate.nullable().optional(),
  plannedCompletionDate: IsoDate.nullable().optional(),
});
export type ProjectContractorInput = z.infer<typeof ProjectContractorInputSchema>;

export const ProjectPartiesStepSchema = z.object({
  /** Phase 11: the organisation accountable for delivery (a directory entry). Omitted keeps it. */
  owningOrganizationId: z.string().uuid().nullable().optional(),
  monitorOrganization: OrganizationRefSchema.nullable().optional(),
  lenderOrganization: OrganizationRefSchema.nullable().optional(),
  contractorExecutionMode: ContractorExecutionModeEnum.nullable().optional(),
  /** The full contractor list: rows not listed are removed (refused if they have activity). */
  contractors: z.array(ProjectContractorInputSchema).max(50).default([]),
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
// Step 5: BOQ (items arrive through the BOQ preview and commit endpoints; this saves mappings)
// ---------------------------------------------------------------------------

export const ProjectBoqItemMappingSchema = z.object({
  boqItemId: z.string().uuid(),
  isHoldPoint: z.boolean(),
  holdPointInstruction: z.string().max(400).nullable().optional(),
  isOpaqueLumpSum: z.boolean().optional(),
  /** Contractor package; required for every item in multi-prime before activation. */
  projectContractorId: z.string().uuid().nullable().optional(),
});
export type ProjectBoqItemMapping = z.infer<typeof ProjectBoqItemMappingSchema>;

export const ProjectBoqStepSchema = z.object({
  items: z.array(ProjectBoqItemMappingSchema).max(5000).default([]),
});
export type ProjectBoqStep = z.infer<typeof ProjectBoqStepSchema>;

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
// Step 7: team
// ---------------------------------------------------------------------------

export const ProjectTeamStepSchema = z.object({
  /** Web users (and provisioned mobile users) assigned to the project. The creator stays assigned. */
  userIds: z.array(z.string().uuid()).max(500).default([]),
  /** Join-code roles to issue codes for at activation. null issues every join-code mobile role. */
  joinCodeRoleIds: z.array(z.string().uuid()).max(50).nullable().default(null),
});
export type ProjectTeamStep = z.infer<typeof ProjectTeamStepSchema>;

/** Save schemas by step id. */
export const PROJECT_STEP_SAVE_SCHEMAS = {
  basics: ProjectBasicsStepSchema,
  parties: ProjectPartiesStepSchema,
  contract: ProjectContractStepSchema,
  site: ProjectSiteStepSchema,
  facility: ProjectFacilityStepSchema,
  boq: ProjectBoqStepSchema,
  reporting: ProjectReportingStepSchema,
  process: ProjectProcessStepSchema,
  standards: ProjectStandardsStepSchema,
  schedule: ProjectStandardsStepSchema,
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
    contractorExecutionMode: ContractorExecutionModeEnum,
  }),
  site: z.object({
    geofence: ProjectGeofenceSchema,
    timezone: z.string().refine(isValidTimeZone, 'Choose a valid IANA time zone'),
  }),
  reporting: ProjectReportingStepSchema,
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
  isMainContractor: z.boolean(),
  allocatedBudgetNgn: z.number().nullable(),
  allowFieldReporting: z.boolean(),
  plannedMobilizationDate: z.string().nullable(),
  plannedCompletionDate: z.string().nullable(),
  boqItemCount: z.number().int(),
  /** Sessions or IPC claims exist; the contractor cannot be removed. */
  hasActivity: z.boolean(),
  /** Phase 13: contract state; a terminated contractor keeps its history. */
  contractStatus: ContractStatusEnum,
  terminatedAt: z.string().nullable(),
  replacesProjectContractorId: z.string().uuid().nullable(),
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
    contractorExecutionMode: ContractorExecutionModeEnum.nullable(),
    contractors: z.array(ProjectContractorDtoSchema),
  }),
  site: z.object({
    geofenceMode: GeofenceModeEnum.nullable(),
    geofence: ProjectGeofenceSchema.nullable(),
    geofenceToleranceMeters: z.number().int().nullable(),
    effectiveToleranceMeters: z.number().int(),
    tenantDefaultToleranceMeters: z.number().int(),
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
  boq: z.object({
    itemCount: z.number().int(),
    unassignedContractorCount: z.number().int(),
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
    joinCodeRoleIds: z.array(z.string().uuid()).nullable(),
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
  issuedJoinCodes: z.array(z.string()),
});
export type ActivateProjectResponse = z.infer<typeof ActivateProjectResponseSchema>;

// ---------------------------------------------------------------------------
// BOQ preview, revisions and contractor package suggestion
// ---------------------------------------------------------------------------

export const BoqPreviewRequestSchema = z.object({
  spreadsheetBase64: z.string().min(1).max(15_000_000),
  fileName: z.string().max(200).optional(),
});
export type BoqPreviewRequest = z.infer<typeof BoqPreviewRequestSchema>;

export const BoqPreviewRowSchema = z.object({
  rowNumber: z.number().int(),
  item: z
    .object({
      wbsCode: z.string(),
      section: z.string(),
      description: z.string(),
      unit: z.string(),
      totalQuantity: z.number(),
      rateNgn: z.number(),
      budgetedCostNgn: z.number(),
      isHoldPoint: z.boolean(),
    })
    .nullable(),
  warnings: z.array(z.string()),
  errors: z.array(z.string()),
});
export type BoqPreviewRow = z.infer<typeof BoqPreviewRowSchema>;

export const BoqPreviewResponseSchema = z.object({
  fileType: z.enum(['XLSX', 'CSV']),
  detectedColumns: z.record(z.string(), z.string().nullable()),
  rows: z.array(BoqPreviewRowSchema),
  validCount: z.number().int(),
  warningCount: z.number().int(),
  errorCount: z.number().int(),
  totalBudgetedCostNgn: z.number(),
});
export type BoqPreviewResponse = z.infer<typeof BoqPreviewResponseSchema>;

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

export const ContractorPackageSuggestionSchema = z.object({
  suggestedTradeCategory: z.string(),
  tradeCode: z.string(),
  matchedWbsCodes: z.array(z.string()),
  estimatedPackageBudgetNgn: z.number(),
  rationale: z.string(),
  /** Existing ProjectContractor with the same trade code, if any. */
  existingProjectContractorId: z.string().uuid().nullable(),
});
export type ContractorPackageSuggestion = z.infer<typeof ContractorPackageSuggestionSchema>;

export const ContractorSuggestionResponseSchema = z.object({
  engine: z.enum(['RULES_ENGINE']),
  engineDetail: z.string().nullable(),
  packages: z.array(ContractorPackageSuggestionSchema),
});
export type ContractorSuggestionResponse = z.infer<typeof ContractorSuggestionResponseSchema>;

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
