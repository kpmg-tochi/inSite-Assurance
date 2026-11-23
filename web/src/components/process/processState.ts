import {
  defaultReportChain,
  DEFAULT_PROJECT_PROCESS_CONFIG,
  validateApprovalChain,
  type ApprovalChainDto,
  type ApprovalStepConfig,
  type ChainIssue,
  type ProjectProcessConfig,
  type WorkflowTemplateConfig,
} from '@insite/shared';

/** The editable shape shared by the wizard step, project settings and workflow templates. */
export interface ProcessDraft {
  config: ProjectProcessConfig;
  reportChain: ApprovalStepConfig[];
}

export function defaultProcessDraft(): ProcessDraft {
  return {
    config: { ...DEFAULT_PROJECT_PROCESS_CONFIG },
    reportChain: defaultReportChain(),
  };
}

/** Strips server-only fields (ids, version, role names) from a stored chain. */
export function chainFromDto(chain: ApprovalChainDto): ApprovalStepConfig[] {
  return [...chain.steps]
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map((s) => ({
      label: s.label,
      requiredPermissionKey: s.requiredPermissionKey,
      requiredRoleId: s.requiredRoleId,
      minAmountThresholdNgn: null,
      isSystemStep: s.isSystemStep,
      organizationScope: s.organizationScope ?? "ANY",
    }));
}

export function draftFromTemplate(config: WorkflowTemplateConfig): ProcessDraft {
  return {
    config: { ...config.process },
    reportChain: config.reportChain.map(normaliseStep),
  };
}

function normaliseStep(s: ApprovalStepConfig): ApprovalStepConfig {
  return {
    label: s.label,
    requiredPermissionKey: s.requiredPermissionKey,
    requiredRoleId: s.requiredRoleId ?? null,
    minAmountThresholdNgn: null,
    isSystemStep: s.isSystemStep,
    organizationScope: s.organizationScope ?? "ANY",
  };
}

export interface ProcessIssues {
  report: ChainIssue[];
  count: number;
}

/** Client-side check with the same validator the server uses. */
export function validateProcessDraft(draft: ProcessDraft): ProcessIssues {
  const report = validateApprovalChain('REPORT', draft.reportChain);
  draft.reportChain.forEach((s, i) => {
    if (s.label.trim().length < 2) report.push({ code: 'LABEL', message: 'Name every step.', stepIndex: i });
  });
  return { report, count: report.length };
}

export const sameDraft = (a: ProcessDraft, b: ProcessDraft) => JSON.stringify(a) === JSON.stringify(b);
