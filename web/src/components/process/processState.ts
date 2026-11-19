import {
  certificationPermissionFor,
  defaultDisbursementChain,
  defaultReportChain,
  DEFAULT_PROJECT_PROCESS_CONFIG,
  validateApprovalChain,
  type ApprovalChainDto,
  type ApprovalStepConfig,
  type ChainIssue,
  type DisbursementMechanism,
  type ProjectProcessConfig,
  type WorkflowTemplateConfig,
} from '@insite/shared';

/** The editable shape shared by the wizard step, project settings and workflow templates. */
export interface ProcessDraft {
  config: ProjectProcessConfig;
  reportChain: ApprovalStepConfig[];
  disbursementChain: ApprovalStepConfig[];
}

export function defaultProcessDraft(): ProcessDraft {
  const config = { ...DEFAULT_PROJECT_PROCESS_CONFIG };
  return {
    config,
    reportChain: defaultReportChain(),
    disbursementChain: defaultDisbursementChain(config.disbursementMechanism),
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
      minAmountThresholdNgn: s.minAmountThresholdNgn,
      isSystemStep: s.isSystemStep,
    }));
}

export function draftFromTemplate(config: WorkflowTemplateConfig): ProcessDraft {
  return {
    config: { ...config.process },
    reportChain: config.reportChain.map(normaliseStep),
    disbursementChain: config.disbursementChain.map(normaliseStep),
  };
}

function normaliseStep(s: ApprovalStepConfig): ApprovalStepConfig {
  return {
    label: s.label,
    requiredPermissionKey: s.requiredPermissionKey,
    requiredRoleId: s.requiredRoleId ?? null,
    minAmountThresholdNgn: s.minAmountThresholdNgn ?? null,
    isSystemStep: s.isSystemStep,
  };
}

/** Keeps the certification step in line with the disbursement mechanism. */
export function withMechanism(draft: ProcessDraft, mechanism: DisbursementMechanism): ProcessDraft {
  const chain = [...draft.disbursementChain];
  if (chain.length > 0 && chain[0].isSystemStep) {
    const fresh = defaultDisbursementChain(mechanism)[0];
    const wasDefaultLabel = defaultDisbursementChain(draft.config.disbursementMechanism)[0].label === chain[0].label;
    chain[0] = {
      ...chain[0],
      requiredPermissionKey: certificationPermissionFor(mechanism),
      label: wasDefaultLabel ? fresh.label : chain[0].label,
    };
  }
  return { ...draft, config: { ...draft.config, disbursementMechanism: mechanism }, disbursementChain: chain };
}

export interface ProcessIssues {
  report: ChainIssue[];
  disbursement: ChainIssue[];
  count: number;
}

/** Client-side check with the same validator the server uses. */
export function validateProcessDraft(draft: ProcessDraft): ProcessIssues {
  const report = validateApprovalChain('REPORT', draft.reportChain);
  const disbursement = validateApprovalChain('DISBURSEMENT', draft.disbursementChain);
  const cert = draft.disbursementChain[0];
  if (cert && cert.isSystemStep && cert.requiredPermissionKey !== certificationPermissionFor(draft.config.disbursementMechanism)) {
    disbursement.push({
      code: 'CERTIFICATION_PERMISSION_MISMATCH',
      message: 'The certification step does not match the disbursement mechanism.',
      stepIndex: 0,
    });
  }
  draft.reportChain.forEach((s, i) => {
    if (s.label.trim().length < 2) report.push({ code: 'LABEL', message: 'Name every step.', stepIndex: i });
  });
  draft.disbursementChain.forEach((s, i) => {
    if (s.label.trim().length < 2) disbursement.push({ code: 'LABEL', message: 'Name every step.', stepIndex: i });
  });
  return { report, disbursement, count: report.length + disbursement.length };
}

export const sameDraft = (a: ProcessDraft, b: ProcessDraft) => JSON.stringify(a) === JSON.stringify(b);
