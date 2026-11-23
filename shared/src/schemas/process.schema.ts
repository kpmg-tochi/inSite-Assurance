import { z } from 'zod';
import {
  ApprovalChainTypeEnum,
  ApprovalDecisionEnum,
  ApprovalOrganizationScopeEnum,
  DisbursementMechanism,
  DisbursementMechanismEnum,
  MonitorRecommendationEnum,
  NeedsAssessmentModeEnum,
  StandardsSpecificationModeEnum,
  SYSTEM_PERMISSIONS_CATALOG,
  type ApprovalChainType,
} from '../enums';
import { TrancheCompletionRuleEnum, TranchePaymentBasisEnum } from './milestonePayment.schema';

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
  disbursementMechanism: DisbursementMechanismEnum,
  enableTranchesAndCps: z.boolean(),
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
  disbursementMechanism: 'IPC_CLAIM_REQUIRED',
  enableTranchesAndCps: true,
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
  Exclude<keyof ProjectProcessConfig, 'needsAssessmentMode' | 'standardsSpecificationMode' | 'disbursementMechanism'>,
  { label: string; description: string }
> = {
  enableTranchesAndCps: {
    label: 'Tranches and conditions precedent',
    description: 'Off: the project is one implicit tranche and conditions precedent are not checked.',
  },
  enableHoldPoints: {
    label: 'Hold points',
    description: 'Off: hold-point flags are ignored by reconciliation and hidden.',
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
    description: 'Withhold a percentage of every release, track defects in the liability period and release retention when they clear.',
  },
};

// ---------------------------------------------------------------------------
// Approval chains
// ---------------------------------------------------------------------------

export const CERTIFICATION_PERMISSION_KEYS = ['ipc:certify_valuation', 'milestone:verify_direct_release'] as const;
export const RELEASE_PERMISSION_KEY = 'tranche:approve_disbursement';
export const REPORT_APPROVAL_PERMISSION_KEY = 'reports:approve_completion';
/** Phase 13: the last step of the contract default chain. */
export const DEFAULT_DECISION_PERMISSION_KEY = 'contracts:decide_default';
export const DEFAULT_REVIEW_PERMISSION_KEY = 'contracts:raise_default';
export const MAX_APPROVAL_STEPS = 8;

/** The certification step's permission for a disbursement mechanism. */
export function certificationPermissionFor(mechanism: DisbursementMechanism): string {
  return mechanism === 'MILESTONE_DIRECT_DISBURSEMENT' ? 'milestone:verify_direct_release' : 'ipc:certify_valuation';
}

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
  /** Disbursement only: the step is skipped when the recommended release is below this amount. */
  minAmountThresholdNgn: z.number().nonnegative().nullable().optional(),
  /** Certification and release steps. Tenants cannot remove them. */
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
 * - Report chain: no system steps, no amount thresholds.
 * - Disbursement chain: the first step is the certification step and the last is the release step
 *   (`tranche:approve_disbursement`); both are system steps and appear once. Tenants add review
 *   steps between them; thresholds go on those added steps only.
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
  });

  if (chainType === 'REPORT') {
    steps.forEach((s, i) => {
      if (s.isSystemStep) {
        issues.push({ code: 'SYSTEM_STEP_NOT_ALLOWED', message: 'The report chain has no system steps.', stepIndex: i });
      }
      if (s.minAmountThresholdNgn != null) {
        issues.push({ code: 'THRESHOLD_NOT_ALLOWED', message: 'Amount thresholds apply to disbursement steps only.', stepIndex: i });
      }
    });
    return issues;
  }

  if (chainType === 'CONTRACT_DEFAULT') {
    // Phase 13: review steps, then the decision step (system step, contracts:decide_default).
    const lastIndex = steps.length - 1;
    steps.forEach((s, i) => {
      if (s.minAmountThresholdNgn != null) {
        issues.push({ code: 'THRESHOLD_NOT_ALLOWED', message: 'Amount thresholds apply to disbursement steps only.', stepIndex: i });
      }
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

  const first = steps[0];
  const last = steps[steps.length - 1];
  if (steps.length < 2) {
    issues.push({ code: 'DISBURSEMENT_CHAIN_TOO_SHORT', message: 'The disbursement chain needs a certification step and a release step.' });
  }
  if (!first.isSystemStep || !(CERTIFICATION_PERMISSION_KEYS as readonly string[]).includes(first.requiredPermissionKey)) {
    issues.push({
      code: 'CERTIFICATION_STEP_REQUIRED',
      message: 'The first step must be the certification step (certify valuation or verify milestone).',
      stepIndex: 0,
    });
  }
  if (!last.isSystemStep || last.requiredPermissionKey !== RELEASE_PERMISSION_KEY) {
    issues.push({
      code: 'RELEASE_STEP_REQUIRED',
      message: 'The last step must be the release step (approve disbursement).',
      stepIndex: steps.length - 1,
    });
  }
  steps.forEach((s, i) => {
    const isEnd = i === 0 || i === steps.length - 1;
    if (!isEnd && s.isSystemStep) {
      issues.push({ code: 'SYSTEM_STEP_POSITION', message: 'Only the first and last steps are system steps.', stepIndex: i });
    }
    if (!isEnd && s.requiredPermissionKey === RELEASE_PERMISSION_KEY) {
      issues.push({ code: 'RELEASE_STEP_POSITION', message: 'Release can only be the last step.', stepIndex: i });
    }
    if (isEnd && s.minAmountThresholdNgn != null) {
      issues.push({ code: 'THRESHOLD_ON_SYSTEM_STEP', message: 'Certification and release always run; thresholds go on added steps.', stepIndex: i });
    }
  });
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
export const DisbursementApprovalChainSchema = chainSchema('DISBURSEMENT');
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

export function defaultDisbursementChain(mechanism: DisbursementMechanism): ApprovalStepConfig[] {
  return [
    {
      label: mechanism === 'MILESTONE_DIRECT_DISBURSEMENT' ? 'Milestone verification' : 'Valuation certification',
      requiredPermissionKey: certificationPermissionFor(mechanism),
      requiredRoleId: null,
      minAmountThresholdNgn: null,
      isSystemStep: true,
      organizationScope: 'ANY',
    },
    {
      label: 'Disbursement approval',
      requiredPermissionKey: RELEASE_PERMISSION_KEY,
      requiredRoleId: null,
      minAmountThresholdNgn: null,
      isSystemStep: true,
      organizationScope: 'ANY',
    },
  ];
}

// ---------------------------------------------------------------------------
// Workflow templates
// ---------------------------------------------------------------------------

export const WorkflowTemplateConfigSchema = z
  .object({
    process: ProjectProcessConfigSchema,
    reportChain: ReportApprovalChainSchema,
    disbursementChain: DisbursementApprovalChainSchema,
  })
  .superRefine((v, ctx) => {
    const cert = v.disbursementChain[0];
    if (cert && cert.requiredPermissionKey !== certificationPermissionFor(v.process.disbursementMechanism)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['disbursementChain', 0, 'requiredPermissionKey'],
        message:
          v.process.disbursementMechanism === 'MILESTONE_DIRECT_DISBURSEMENT'
            ? 'With direct milestone release, the first step is milestone verification.'
            : 'With IPC claims, the first step is valuation certification.',
      });
    }
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
  disbursementChain: ApprovalChainDtoSchema,
  /** Phase 13: the contractor default chain (edited through PUT .../process/chains/CONTRACT_DEFAULT). */
  contractDefaultChain: ApprovalChainDtoSchema,
  /** Active contractor-executor join codes (shown when turning contractor reporting off). */
  activeContractorJoinCodeCount: z.number().int(),
  /** The disbursement mechanism cannot change once a valuation or IPC exists. */
  disbursementMechanismLocked: z.boolean(),
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
  disbursementChain: DisbursementApprovalChainSchema,
  confirmDeactivateContractorCodes: z.boolean().optional(),
});
export type ProjectProcessStep = z.infer<typeof ProjectProcessStepSchema>;

/** Wizard step "standards": the data is managed through its own endpoints; saving marks it reviewed. */
export const ProjectStandardsStepSchema = z.object({}).passthrough();
export type ProjectStandardsStep = z.infer<typeof ProjectStandardsStepSchema>;

// ---------------------------------------------------------------------------
// Approval progress (reports and valuations)
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
  /** DONE: approved; CURRENT: waiting on it; SKIPPED: below its amount threshold; PENDING: later. */
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

/** POST /valuations/:valuationId/review: an added disbursement step between certification and release. */
export const ReviewValuationRequestSchema = z
  .object({
    decision: z.enum(['APPROVE', 'RETURN']),
    notes: z.string().trim().max(1500).nullable().optional(),
  })
  .refine((v) => v.decision !== 'RETURN' || (v.notes ?? '').length >= 5, {
    message: 'Say why the valuation is returned (at least 5 characters)',
    path: ['notes'],
  });
export type ReviewValuationRequest = z.infer<typeof ReviewValuationRequestSchema>;

// ---------------------------------------------------------------------------
// Direct milestone release
// ---------------------------------------------------------------------------

/**
 * POST /projects/:projectId/milestones/direct-verify. No totals are accepted from the client
 * (Phase 3 rules): the server builds the system claim from evidence and computes every amount.
 */
export const VerifyDirectMilestoneRequestSchema = z
  .object({
    trancheId: z.string().uuid(),
    verificationSummary: z.string().trim().min(10).max(5000),
    lineVerifications: z
      .array(
        z.object({
          boqItemId: z.string().uuid(),
          verifiedCumulativePct: z.number().min(0).max(100),
          remarks: z.string().trim().max(1000).nullable().optional(),
        })
      )
      .min(1)
      .max(1000),
    trancheRecommendation: MonitorRecommendationEnum,
    /** SUPPORT_WITH_HOLDBACK only: the amount to release now, bounded by the total verified. */
    holdbackReleaseAmountNgn: z.number().nonnegative().optional(),
    /** Phase 12: why part of a fixed payment milestone is held back (required by the server for the fixed basis). */
    holdbackReason: z.string().trim().max(1500).nullable().optional(),
    certifierDigitalSignatureAck: z.literal(true),
    /** Compute and return the amounts without saving. */
    dryRun: z.boolean().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.trancheRecommendation === 'SUPPORT_WITH_HOLDBACK' && v.holdbackReleaseAmountNgn === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['holdbackReleaseAmountNgn'], message: 'Enter the amount to release now' });
    }
    if (v.trancheRecommendation !== 'SUPPORT_WITH_HOLDBACK' && v.holdbackReleaseAmountNgn !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['holdbackReleaseAmountNgn'],
        message: 'The release amount is computed by the server for this recommendation',
      });
    }
    const ids = v.lineVerifications.map((l) => l.boqItemId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['lineVerifications'], message: 'Each item may be verified only once' });
    }
  });
export type VerifyDirectMilestoneRequest = z.infer<typeof VerifyDirectMilestoneRequestSchema>;

export const DirectMilestoneItemSuggestionSchema = z.object({
  boqItemId: z.string().uuid(),
  wbsCode: z.string(),
  description: z.string(),
  unit: z.string(),
  totalQuantity: z.number(),
  budgetedCostNgn: z.number(),
  previousCertifiedPct: z.number(),
  /** Sum of evidenced quantities in the BOQ unit (counted reports only). */
  evidenceQuantity: z.number(),
  evidenceReportCount: z.number().int(),
  /** Cumulative percentage the evidence supports, capped at 100. */
  evidenceDerivedPct: z.number(),
  /** The most that can be verified: the system claim (never below the previous certified %). */
  maxVerifiablePct: z.number(),
  isHoldPoint: z.boolean(),
});
export type DirectMilestoneItemSuggestion = z.infer<typeof DirectMilestoneItemSuggestionSchema>;

export const DirectMilestoneSuggestionDtoSchema = z.object({
  trancheId: z.string().uuid(),
  trancheName: z.string(),
  items: z.array(DirectMilestoneItemSuggestionSchema),
  /** A verification on this tranche still going through the chain blocks a new one. */
  openValuationId: z.string().uuid().nullable(),
  /** Phase 12: how the payment milestone pays and whether its completion rule is met today. */
  paymentBasis: TranchePaymentBasisEnum,
  completionRule: TrancheCompletionRuleEnum.nullable(),
  completionRequiredItemPct: z.number(),
  targetCompletionPct: z.number(),
  /** Evaluated on the most each item can be verified at now (null for the measured basis). */
  completionMet: z.boolean().nullable(),
  unmetReasons: z.array(z.string()),
  weightedProgressPct: z.number(),
  /** Fixed basis: the amount paid on completion (null for the measured basis). */
  fixedReleaseAmountNgn: z.number().nullable(),
  alreadyReleasedNgn: z.number(),
});
export type DirectMilestoneSuggestionDto = z.infer<typeof DirectMilestoneSuggestionDtoSchema>;

export const MilestoneVerificationLineSchema = z.object({
  boqItemId: z.string().uuid(),
  wbsCode: z.string(),
  description: z.string(),
  previousCertifiedPct: z.number(),
  systemClaimPct: z.number(),
  systemClaimNgn: z.number(),
  verifiedCumulativePct: z.number(),
  verifiedAmountNgn: z.number(),
  remarks: z.string().nullable(),
});
export type MilestoneVerificationLine = z.infer<typeof MilestoneVerificationLineSchema>;
