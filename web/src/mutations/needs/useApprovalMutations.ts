import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  NEEDS_SEPARATION_ERROR_MESSAGES,
  NeedsSeparationErrorCodeEnum,
  type NeedsApprovalActionRequestInput,
  type NeedsSubmissionDto,
  type OutOfCycleRequestInput,
  type ProposalDocumentKind,
  type SubmitPortfolioRequestInput,
  type UpdateOutOfCycleRequest,
} from '@insite/shared';
import {
  actOnOutOfCycleRequest,
  actOnPortfolio,
  confirmOutOfCycleNeedsAssessment,
  createOutOfCycleRequest,
  previewOutOfCycleNeedsAssessment,
  submitOutOfCycleRequest,
  submitPortfolio,
  updateOutOfCycleRequest,
  uploadApprovalMemo,
  uploadOutOfCycleDocument,
  withdrawOutOfCycleRequest,
} from '../../api/needsApproval';
import { apiErrorCode } from '../../api/needsPipeline';
import { needsCycleKey, needsCyclesKey, needsProposalsKey } from '../../queries/needs/useNeedsQueries';
import { needsTasksRootKey } from '../../queries/needs/useDecisionQueries';
import { needsSubmissionsRootKey, outOfCycleRootKey } from '../../queries/needs/useApprovalQueries';
import { errorMessage } from './useNeedsMutations';

/**
 * Needs pipeline wave 4 (N6): portfolio / State approval and out-of-cycle requests. The hooks own the
 * toasts and refresh what an action changes (submissions, the cycle and its proposals, the task
 * queue, out-of-cycle requests, the portfolio's Pipeline tab).
 */

const CODE_MESSAGES: Record<string, string> = {
  NOT_STEP_APPROVER: 'You do not hold the permission this step needs.',
  NOT_STEP_ORGANIZATION: 'This step is decided by another organisation.',
  NEEDS_APPROVAL_MEMO_REQUIRED: 'Upload or choose the signed approval memo before the final approval.',
  NEEDS_BELOW_LINE_INCLUDED: 'A proposed project below the funding line cannot be included.',
  NEEDS_PORTFOLIO_ITEMS_MISMATCH: 'The list of proposed projects at Approval has changed. Reload the page and submit again.',
  NEEDS_RANKING_NOT_FINALISED: 'The committee has not finalised the ranking yet.',
  NEEDS_PORTFOLIO_EXISTS: 'The portfolio has already been submitted.',
  NEEDS_CYCLE_NOT_OPEN: 'The cycle is closed: nothing was changed.',
  NEEDS_CYCLE_FORBIDDEN: 'Only the organisation that runs this cycle can do this.',
  NEEDS_FILE_CHANGED: 'The file changed since it was checked. Check it again.',
};

/** The toast for a failed write: separation of duties, a known code, or the server's message. */
export function approvalFailureText(err: unknown, fallback: string): string {
  const code = apiErrorCode(err);
  const separation = NeedsSeparationErrorCodeEnum.safeParse(code);
  if (separation.success) return NEEDS_SEPARATION_ERROR_MESSAGES[separation.data];
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];
  return errorMessage(err, fallback);
}

function refreshApprovals(qc: QueryClient, cycleId: string | null) {
  qc.invalidateQueries({ queryKey: needsSubmissionsRootKey });
  qc.invalidateQueries({ queryKey: outOfCycleRootKey });
  qc.invalidateQueries({ queryKey: needsTasksRootKey });
  qc.invalidateQueries({ queryKey: needsCyclesKey });
  qc.invalidateQueries({ queryKey: ['needs', 'proposal'] });
  qc.invalidateQueries({ queryKey: ['needs', 'pipeline'] });
  if (cycleId) {
    qc.invalidateQueries({ queryKey: needsCycleKey(cycleId) });
    qc.invalidateQueries({ queryKey: needsProposalsKey(cycleId) });
  }
}

const decidedText = (s: NeedsSubmissionDto, decision: 'APPROVE' | 'RETURN') => {
  if (decision === 'RETURN') return 'Returned for revision.';
  if (s.status === 'APPROVED') return `Approved: ${s.includedCount} proposed project${s.includedCount === 1 ? '' : 's'} move on to funding.`;
  return 'Approved at this step. It goes to the next step.';
};

// ---------------------------------------------------------------------------
// Portfolio / State approval
// ---------------------------------------------------------------------------

export const useSubmitPortfolioMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SubmitPortfolioRequestInput) => submitPortfolio(cycleId, body),
    onSuccess: (s) => {
      refreshApprovals(qc, cycleId);
      toast.success(`Submitted for approval: ${s.includedCount} proposed project${s.includedCount === 1 ? '' : 's'} included.`);
    },
    onError: (err) => toast.error(approvalFailureText(err, 'Could not submit the list.')),
  });
};

export const usePortfolioActionMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NeedsApprovalActionRequestInput) => actOnPortfolio(cycleId, body),
    onSuccess: (s, body) => {
      refreshApprovals(qc, cycleId);
      toast.success(decidedText(s, body.decision));
    },
    onError: (err) => toast.error(approvalFailureText(err, 'Could not record the decision.')),
  });
};

export const useUploadApprovalMemoMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { file: File; title: string }) => uploadApprovalMemo(cycleId, p),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: needsCycleKey(cycleId) });
      toast.success('Approval memo uploaded.');
    },
    onError: (err) => toast.error(approvalFailureText(err, 'Could not upload the memo.')),
  });
};

// ---------------------------------------------------------------------------
// Out-of-cycle requests
// ---------------------------------------------------------------------------

export const useCreateOutOfCycleMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: OutOfCycleRequestInput) => createOutOfCycleRequest(body),
    onSuccess: (r) => {
      refreshApprovals(qc, r.cycleId);
      toast.success(`Request ${r.reference} created. Add the authorising document, then submit it.`);
    },
    onError: (err) => toast.error(approvalFailureText(err, 'Could not create the request.')),
  });
};

export const useUpdateOutOfCycleMutation = (proposalId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: UpdateOutOfCycleRequest) => updateOutOfCycleRequest(proposalId, body),
    onSuccess: (r) => {
      refreshApprovals(qc, r.cycleId);
      toast.success('Request saved.');
    },
    onError: (err) => toast.error(approvalFailureText(err, 'Could not save the request.')),
  });
};

export const useUploadOutOfCycleDocumentMutation = (proposalId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { file: File; kind: ProposalDocumentKind; title: string }) => uploadOutOfCycleDocument(proposalId, p),
    onSuccess: (doc) => {
      qc.invalidateQueries({ queryKey: outOfCycleRootKey });
      toast.success(`${doc.title} uploaded.`);
    },
    onError: (err) => toast.error(approvalFailureText(err, 'Could not upload the document.')),
  });
};

/** Checks a needs assessment file (nothing saved); the result is shown in place, so no success toast. */
export const usePreviewOutOfCycleNeedsAssessmentMutation = (proposalId: string) =>
  useMutation({
    mutationFn: (body: { fileName: string; fileBase64: string }) => previewOutOfCycleNeedsAssessment(proposalId, body),
    onError: (err) => toast.error(approvalFailureText(err, 'Could not check the file.')),
  });

export const useConfirmOutOfCycleNeedsAssessmentMutation = (proposalId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { fileName: string; fileBase64: string; sha256: string }) => confirmOutOfCycleNeedsAssessment(proposalId, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: outOfCycleRootKey });
      qc.invalidateQueries({ queryKey: ['needs', 'proposal'] });
      toast.success('Needs assessment saved to the request.');
    },
    onError: (err) => toast.error(approvalFailureText(err, 'Could not save the needs assessment.')),
  });
};

export const useSubmitOutOfCycleMutation = (proposalId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => submitOutOfCycleRequest(proposalId),
    onSuccess: (r) => {
      refreshApprovals(qc, r.cycleId);
      toast.success(`${r.reference} submitted for approval.`);
    },
    onError: (err) => toast.error(approvalFailureText(err, 'Could not submit the request.')),
  });
};

export const useOutOfCycleActionMutation = (proposalId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NeedsApprovalActionRequestInput) => actOnOutOfCycleRequest(proposalId, body),
    onSuccess: (r, body) => {
      refreshApprovals(qc, r.cycleId);
      if (body.decision === 'RETURN') toast.success(`${r.reference} returned to the requester.`);
      else if (r.projectId) toast.success(`${r.reference} approved: draft project ${r.projectCode ? `${r.projectCode} ` : ''}created.`);
      else toast.success(decidedText(r.submission, 'APPROVE'));
    },
    onError: (err) => toast.error(approvalFailureText(err, 'Could not record the decision.')),
  });
};

export const useWithdrawOutOfCycleMutation = (proposalId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reason: string) => withdrawOutOfCycleRequest(proposalId, reason),
    onSuccess: (r) => {
      refreshApprovals(qc, r.cycleId);
      toast.success(`${r.reference} withdrawn.`);
    },
    onError: (err) => toast.error(approvalFailureText(err, 'Could not withdraw the request.')),
  });
};
