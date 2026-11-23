import { z } from 'zod';
import {
  ApprovalChainTypeEnum,
  ApprovalDecisionEnum,
  ApprovalOrganizationScopeEnum,
  NeedsAssessmentModeEnum,
  StandardsSpecificationModeEnum,
  SYSTEM_PERMISSIONS_CATALOG,
  type ApprovalChainType,
} from '../enums';

/**
 * Process engine (Phase 7): per-project process configuration, workflow templates and approval
 * chains. Chains are stored as rows (master decision H); a template keeps its copy as validated
 * JSON because applying a template copies it into the project's own rows.
 */

// ---------------------------------------------------------------------------
// Process configuration
// ---------------------------------------------------------------------------

export const ProjectProcessConfigSchema = z.object({
  needsAssessmentMode: NeedsAssessmentModeEnum,
  standardsSpecificationMode: StandardsSpecificationModeEnum,
  enableHoldPoints: z.boolean(),
  allowContractorFieldReporting: z.boolean(),
  enableContractorIdentityAssurance: z.boolean(),
  enableAiOmissionCheck: z.boolean(),
  enableAiStandardsCheck: z.boolean(),
  requireReportApproval: z.boolean(),
  enableHandoverModule: z.boolean(),
  enableRetentionModule: z.boolean(),
});
export type ProjectProcessConfig = z.infer<typeof ProjectProcessConfigSchema>;

/** What a project gets when no template is applied: the Phase 3 / Phase 4 behaviour. */
export const DEFAULT_PROJECT_PROCESS_CONFIG: ProjectProcessConfig = {
  needsAssessmentMode: 'OPTIONAL_AT_CREATION',
  standardsSpecificationMode: 'OPTIONAL_AT_CREATION',
  enableHoldPoints: true,
  allowContractorFieldReporting: true,
  enableContractorIdentityAssurance: true,
  enableAiOmissionCheck: true,
  enableAiStandardsCheck: true,
  requireReportApproval: false,
  enableHandoverModule: false,
  enableRetentionModule: false,
};

export const PROCESS_TOGGLE_META: Record<
  Exclude<keyof ProjectProcessConfig, 'needsAssessmentMode' | 'standardsSpecificationMode'>,
  { label: string; description: string }
> = {
  enableHoldPoints: {
    label: 'Hold points',
    description: 'Off: hold-point flags are ignored and hidden.',
  },
  allowContractorFieldReporting: {
    label: 'Contractor field reporting',
    description: 'Off: no contractor join codes, and every brief is written for an independent verifier.',
  },
  enableContractorIdentityAssurance: {
    label: 'Contractor identity check',
    description: 'Off: the guided selfie and ID review is skipped on this project, whatever the role says.',
  },
  enableAiOmissionCheck: {
    label: 'Omission check on reports',
    description: 'Checks submitted reports for missing hold-point and checklist proof.',
  },
  enableAiStandardsCheck: {
    label: 'Standards check on reports',
    description: 'Checks submitted reports against the project standards that apply to the item.',
  },
  requireReportApproval: {
    label: 'Report approval',
    description: 'Reports count as evidence only after every step of the report approval chain approves them.',
  },
  enableHandoverModule: {
    label: 'Stakeholder handover',
    description: 'Send stakeholders a secure link to accept the works, accept with snags or reject. Off: hidden and refused.',
  },
  enableRetentionModule: {
    label: 'Retention and defects',
    description: 'Hold a percentage of every recorded payment, track defects in the liability period and record the retention release when they clear.',
  },
};

// ---------------------------------------------------------------------------
// Approval chains
// ---------------------------------------------------------------------------

export const REPORT_APPROVAL_PERMISSION_KEY = 'reports:approve_completion';
/** Phase 13: the last step of the contract default chain. */
export const DEFAULT_DECISION_PERMISSION_KEY = 'contracts:decide_default';
export const DEFAULT_REVIEW_PERMISSION_KEY = 'contracts:raise_default';
export const MAX_APPROVAL_STEPS = 8;

const KNOWN_PERMISSION_KEYS = new Set(SYSTEM_PERMISSIONS_CATALOG.map((p) => p.key));

export const ApprovalStepConfigSchema = z.object({
  /** 1-based; optional on input (array order is used), checked for contiguity when present. */
  stepOrder: z.number().int().positive().optional(),
  label: z.string().trim().min(2, 'Name the step').max(120),
  requiredPermissionKey: z
    .string()
    .refine((k) => KNOWN_PERMISSION_KEYS.has(k), 'Choose a permission from the catalogue'),
  /** Optionally also require one specific role. */
  requiredRoleId: z.string().uuid().nullable().optional(),
  /** Legacy column; no chain accepts an amount threshold any more. */
  minAmountThresholdNgn: z.number().nonnegative().nullable().optional(),
  /** Steps the platform requires (e.g. the default-case decision). Tenants cannot remove them. */
  isSystemStep: z.boolean().default(false),
  /**
   * Phase 11: which organisation the actor must belong to, relative to the project's owner or
   * funder. Allowed on any step, system steps included. ANY is the Phase 7 behaviour.
   */
  organizationScope: ApprovalOrganizationScopeEnum.default('ANY'),
});
export type ApprovalStepConfig = z.infer<typeof ApprovalStepConfigSchema>;
export type ApprovalStepConfigInput = z.input<typeof ApprovalStepConfigSchema>;

export interface ChainIssue {
  code: string;
  message: string;
  stepIndex?: number;
}

/**
 * The one chain validator (server, web and templates).
 * - Every chain: 1 to 8 steps, contiguous step orders, known permissions.
 * - No chain accepts amount thresholds.
 * - Report chain: no system steps.
 * - Contract default chain: review steps, then the decision step (system step).
 */
export function validateApprovalChain(
  chainType: ApprovalChainType,
  steps: ReadonlyArray<ApprovalStepConfigInput>
): ChainIssue[] {
  const issues: ChainIssue[] = [];
  if (steps.length === 0) {
    issues.push({ code: 'CHAIN_EMPTY', message: 'A chain needs at least one step.' });
    return issues;
  }
  if (steps.length > MAX_APPROVAL_STEPS) {
    issues.push({ code: 'CHAIN_TOO_LONG', message: `A chain can have at most ${MAX_APPROVAL_STEPS} steps.` });
  }
  steps.forEach((s, i) => {
    if (s.stepOrder !== undefined && s.stepOrder !== i + 1) {
      issues.push({ code: 'STEPS_NOT_CONTIGUOUS', message: 'Step numbers must run 1, 2, 3 … with no gaps.', stepIndex: i });
    }
    if (!KNOWN_PERMISSION_KEYS.has(s.requiredPermissionKey)) {
      issues.push({ code: 'UNKNOWN_PERMISSION', message: `Unknown permission "${s.requiredPermissionKey}".`, stepIndex: i });
    }
    if (s.minAmountThresholdNgn != null) {
      issues.push({ code: 'THRESHOLD_NOT_ALLOWED', message: 'Approval steps do not take amount thresholds.', stepIndex: i });
    }
  });

  if (chainType === 'REPORT') {
    steps.forEach((s, i) => {
      if (s.isSystemStep) {
        issues.push({ code: 'SYSTEM_STEP_NOT_ALLOWED', message: 'The report chain has no system steps.', stepIndex: i });
      }
    });
    return issues;
  }

  // CONTRACT_DEFAULT (Phase 13): review steps, then the decision step (system step, contracts:decide_default).
  const lastIndex = steps.length - 1;
  steps.forEach((s, i) => {
    if (i !== lastIndex && s.isSystemStep) {
      issues.push({ code: 'SYSTEM_STEP_POSITION', message: 'Only the last step (the decision) is a system step.', stepIndex: i });
    }
    if (i !== lastIndex && s.requiredPermissionKey === DEFAULT_DECISION_PERMISSION_KEY) {
      issues.push({ code: 'DECISION_STEP_POSITION', message: 'The decision can only be the last step.', stepIndex: i });
    }
  });
  const last = steps[lastIndex];
  if (!last.isSystemStep || last.requiredPermissionKey !== DEFAULT_DECISION_PERMISSION_KEY) {
    issues.push({
      code: 'DECISION_STEP_REQUIRED',
      message: 'The last step must be the decision step (decide default cases).',
      stepIndex: lastIndex,
    });
  }
  return issues;
}

function chainSchema(chainType: ApprovalChainType) {
  return z
    .array(ApprovalStepConfigSchema)
    .max(MAX_APPROVAL_STEPS)
    .superRefine((steps, ctx) => {
      for (const issue of validateApprovalChain(chainType, steps)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: issue.message,
          path: issue.stepIndex === undefined ? [] : [issue.stepIndex],
        });
      }
    });
}

export const ReportApprovalChainSchema = chainSchema('REPORT');
export const ContractDefaultApprovalChainSchema = chainSchema('CONTRACT_DEFAULT');

/**
 * Phase 13: the contractor default chain a project gets on first use. The decision step is limited
 * to the owning organisation when the project has one (e.g. the Chief Executive of the owner).
 */
export function defaultContractDefaultChain(opts: { hasOwner: boolean; legalRoleId?: string | null }): ApprovalStepConfig[] {
  return [
    {
      label: 'Legal review',
      requiredPermissionKey: DEFAULT_REVIEW_PERMISSION_KEY,
      requiredRoleId: opts.legalRoleId ?? null,
      minAmountThresholdNgn: null,
      isSystemStep: false,
      organizationScope: 'ANY',
    },
    {
      label: 'Executive decision',
      requiredPermissionKey: DEFAULT_DECISION_PERMISSION_KEY,
      requiredRoleId: null,
      minAmountThresholdNgn: null,
      isSystemStep: true,
      organizationScope: opts.hasOwner ? 'PROJECT_OWNER' : 'ANY',
    },
  ];
}

export function defaultReportChain(): ApprovalStepConfig[] {
  return [
    {
      label: 'Monitor approval',
      requiredPermissionKey: REPORT_APPROVAL_PERMISSION_KEY,
      requiredRoleId: null,
      minAmountThresholdNgn: null,
      isSystemStep: false,
      organizationScope: 'ANY',
    },
  ];
}

// ---------------------------------------------------------------------------
// Workflow templates
// ---------------------------------------------------------------------------

export const WorkflowTemplateConfigSchema = z.object({
  process: ProjectProcessConfigSchema,
  reportChain: ReportApprovalChainSchema,
});
export type WorkflowTemplateConfig = z.infer<typeof WorkflowTemplateConfigSchema>;

export const SaveWorkflowTemplateRequestSchema = z.object({
  name: z.string().trim().min(3).max(120),
  description: z.string().trim().max(1000).nullable().optional(),
  isDefault: z.boolean().default(false),
  config: WorkflowTemplateConfigSchema,
});
export type SaveWorkflowTemplateRequest = z.infer<typeof SaveWorkflowTemplateRequestSchema>;

export const WorkflowTemplateDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  isDefault: z.boolean(),
  config: WorkflowTemplateConfigSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type WorkflowTemplateDto = z.infer<typeof WorkflowTemplateDtoSchema>;

export const ApplyWorkflowTemplateRequestSchema = z.object({
  templateId: z.string().uuid(),
  /** Required when the template turns contractor reporting off on a live project with codes. */
  confirmDeactivateContractorCodes: z.boolean().optional(),
});
export type ApplyWorkflowTemplateRequest = z.infer<typeof ApplyWorkflowTemplateRequestSchema>;

// ---------------------------------------------------------------------------
// Project process settings (read and write)
// ---------------------------------------------------------------------------

export const ApprovalStepDtoSchema = z.object({
  id: z.string().uuid(),
  chainType: ApprovalChainTypeEnum,
  stepOrder: z.number().int(),
  label: z.string(),
  requiredPermissionKey: z.string(),
  requiredRoleId: z.string().uuid().nullable(),
  requiredRoleName: z.string().nullable(),
  minAmountThresholdNgn: z.number().nullable(),
  isSystemStep: z.boolean(),
  organizationScope: ApprovalOrganizationScopeEnum,
  version: z.number().int(),
});
export type ApprovalStepDto = z.infer<typeof ApprovalStepDtoSchema>;

export const ApprovalChainDtoSchema = z.object({
  chainType: ApprovalChainTypeEnum,
  version: z.number().int(),
  steps: z.array(ApprovalStepDtoSchema),
});
export type ApprovalChainDto = z.infer<typeof ApprovalChainDtoSchema>;

export const ProjectProcessSettingsDtoSchema = z.object({
  projectId: z.string().uuid(),
  config: ProjectProcessConfigSchema,
  workflowTemplateId: z.string().uuid().nullable(),
  workflowTemplateName: z.string().nullable(),
  reportChain: ApprovalChainDtoSchema,
  /** Phase 13: the contractor default chain (edited through PUT .../process/chains/CONTRACT_DEFAULT). */
  contractDefaultChain: ApprovalChainDtoSchema,
  /** Active contractor-executor join codes (shown when turning contractor reporting off). */
  activeContractorJoinCodeCount: z.number().int(),
});
export type ProjectProcessSettingsDto = z.infer<typeof ProjectProcessSettingsDtoSchema>;

export const UpdateProjectProcessConfigRequestSchema = z.object({
  config: ProjectProcessConfigSchema,
  /** Required when the change deactivates contractor join codes. */
  confirmDeactivateContractorCodes: z.boolean().optional(),
});
export type UpdateProjectProcessConfigRequest = z.infer<typeof UpdateProjectProcessConfigRequestSchema>;

export const ReplaceApprovalChainRequestSchema = z.object({
  steps: z.array(ApprovalStepConfigSchema).min(1).max(MAX_APPROVAL_STEPS),
});
export type ReplaceApprovalChainRequest = z.infer<typeof ReplaceApprovalChainRequestSchema>;

/** Wizard step "process" (PUT /projects/:id/setup/process). */
export const ProjectProcessStepSchema = z.object({
  workflowTemplateId: z.string().uuid().nullable().optional(),
  config: ProjectProcessConfigSchema,
  reportChain: ReportApprovalChainSchema,
  confirmDeactivateContractorCodes: z.boolean().optional(),
});
export type ProjectProcessStep = z.infer<typeof ProjectProcessStepSchema>;

/** Wizard step "standards": the data is managed through its own endpoints; saving marks it reviewed. */
export const ProjectStandardsStepSchema = z.object({}).passthrough();
export type ProjectStandardsStep = z.infer<typeof ProjectStandardsStepSchema>;

// ---------------------------------------------------------------------------
// Approval progress
// ---------------------------------------------------------------------------

export const ApprovalActionDtoSchema = z.object({
  id: z.string().uuid(),
  stepOrder: z.number().int(),
  stepLabel: z.string(),
  decision: ApprovalDecisionEnum,
  actorUserId: z.string().uuid(),
  actorName: z.string().nullable(),
  notes: z.string().nullable(),
  createdAt: z.string(),
});
export type ApprovalActionDto = z.infer<typeof ApprovalActionDtoSchema>;

export const ApprovalProgressStepSchema = ApprovalStepDtoSchema.extend({
  /** DONE: approved; CURRENT: waiting on it; SKIPPED: not run (legacy); PENDING: later. */
  state: z.enum(['DONE', 'CURRENT', 'SKIPPED', 'PENDING']),
});
export type ApprovalProgressStep = z.infer<typeof ApprovalProgressStepSchema>;

export const ApprovalProgressDtoSchema = z.object({
  chainType: ApprovalChainTypeEnum,
  chainVersion: z.number().int(),
  /** 0 when not started or returned; the step order being waited on; null when complete. */
  currentStepOrder: z.number().int().nullable(),
  completed: z.boolean(),
  steps: z.array(ApprovalProgressStepSchema),
  actions: z.array(ApprovalActionDtoSchema),
  /** Whether the caller may act on the current step, with the reason when not. Advisory. */
  canAct: z.boolean(),
  cannotActReason: z.string().nullable(),
});
export type ApprovalProgressDto = z.infer<typeof ApprovalProgressDtoSchema>;

/** POST /workday-reports/:reportId/review. REJECT is not accepted (reports are returned instead). */
export const ReviewWorkdayReportRequestSchema = z
  .object({
    decision: z.enum(['APPROVE', 'RETURN']),
    notes: z.string().trim().max(1500).nullable().optional(),
  })
  .refine((v) => v.decision !== 'RETURN' || (v.notes ?? '').length >= 5, {
    message: 'Say what the reporter must change (at least 5 characters)',
    path: ['notes'],
  });
export type ReviewWorkdayReportRequest = z.infer<typeof ReviewWorkdayReportRequestSchema>;
