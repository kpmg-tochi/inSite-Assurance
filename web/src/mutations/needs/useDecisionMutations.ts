import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CYCLE_DOCUMENT_KIND_META,
  NEEDS_SEPARATION_ERROR_MESSAGES,
  NeedsSeparationErrorCodeEnum,
  type NeedsDecisionResultDto,
  type ProposalBatchAction,
  type ProposalBatchActionRequestInput,
  type RecordValidationRequestInput,
  type ResolveProposalFlagsRequestInput,
  type SeparationOverrideRequest,
  type StageDecisionRequestInput,
} from '@insite/shared';
import {
  decideSeparationOverride,
  recordStageDecision,
  recordValidation,
  regenerateNeedsReport,
  requestSeparationOverride,
  resolveProposalFlags,
  runProposalBatchAction,
  type RegenerableReportKind,
  type SeparationOverrideDecisionInput,
} from '../../api/needsDecisions';
import { apiErrorCode } from '../../api/needsPipeline';
import { needsCycleKey, needsCyclesKey, needsProposalKey, needsProposalsKey } from '../../queries/needs/useNeedsQueries';
import { needsTasksRootKey } from '../../queries/needs/useDecisionQueries';
import { batchProblemsOf } from '../../components/needs/decisions/decisionUi';
import { errorMessage } from './useNeedsMutations';

/**
 * Needs pipeline wave 3 (N4): stage work. The hooks own the toasts and refresh what an action
 * changes (the cycle and its list, the proposals named, the task queue and its count).
 */

function refreshNeedsWork(qc: QueryClient, cycleId: string, proposalIds: readonly string[]) {
  qc.invalidateQueries({ queryKey: needsProposalsKey(cycleId) });
  qc.invalidateQueries({ queryKey: needsCycleKey(cycleId) });
  qc.invalidateQueries({ queryKey: needsCyclesKey });
  qc.invalidateQueries({ queryKey: needsTasksRootKey });
  for (const id of proposalIds) qc.invalidateQueries({ queryKey: needsProposalKey(id) });
}

/** The toast for a failed write: a separation of duties message, a refused batch, or the server's message. */
function failureText(err: unknown, fallback: string): string {
  const code = apiErrorCode(err);
  const separation = NeedsSeparationErrorCodeEnum.safeParse(code);
  if (separation.success) return NEEDS_SEPARATION_ERROR_MESSAGES[separation.data];
  const problems = batchProblemsOf(err);
  if (problems.length) {
    return `Nothing was changed: ${problems.length === 1 ? `${problems[0].reference} cannot move` : `${problems.length} proposed projects cannot move`}. See the list.`;
  }
  if (code === 'NEEDS_CYCLE_NOT_OPEN') return 'The cycle is closed: nothing was changed.';
  if (code === 'NEEDS_CYCLE_FORBIDDEN') return 'Only the organisation that runs this cycle can change it.';
  return errorMessage(err, fallback);
}

const count = (n: number) => `${n} proposed project${n === 1 ? '' : 's'}`;

const BATCH_DONE: Record<ProposalBatchAction, string> = { SUBMIT: 'submitted', RESUBMIT: 'resubmitted', WITHDRAW: 'withdrawn' };

/** Submit, resubmit or withdraw a selection (all or nothing). */
export const useProposalBatchActionMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ProposalBatchActionRequestInput) => runProposalBatchAction(cycleId, body),
    onSuccess: (result, body) => {
      refreshNeedsWork(qc, cycleId, body.proposalIds);
      toast.success(`${count(result.items.length)} ${BATCH_DONE[body.action]}.`);
    },
    onError: (err) => toast.error(failureText(err, 'Could not save the action.')),
  });
};

function decisionToast(result: NeedsDecisionResultDto) {
  const reports = result.generatedDocuments.filter((d) => d.generated);
  const kinds = [...new Set(reports.map((d) => CYCLE_DOCUMENT_KIND_META[d.kind].label))];
  toast.success(`Decision recorded for ${count(result.items.length)}.${kinds.length ? ` ${kinds.join(' and ')} generated.` : ''}`);
}

/** A stage decision on a selection, with an outcome and reason per proposal (all or nothing). */
export const useStageDecisionMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: StageDecisionRequestInput) => recordStageDecision(cycleId, body),
    onSuccess: (result, body) => {
      refreshNeedsWork(qc, cycleId, body.items.map((i) => i.proposalId));
      decisionToast(result);
    },
    onError: (err) => toast.error(failureText(err, 'Could not record the decision.')),
  });
};

/** The validator's record on the current version (desk review, site verification, flag resolutions). */
export const useRecordValidationMutation = (cycleId: string, proposalId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: RecordValidationRequestInput) => recordValidation(proposalId, body),
    onSuccess: () => {
      refreshNeedsWork(qc, cycleId, [proposalId]);
      toast.success('Validation record saved.');
    },
    onError: (err) => toast.error(failureText(err, 'Could not save the validation record.')),
  });
};

/** Resolves flags with reasons (e.g. the quantity surveyor acknowledges a rate variance). */
export const useResolveProposalFlagsMutation = (cycleId: string, proposalId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: ResolveProposalFlagsRequestInput) => resolveProposalFlags(proposalId, body),
    onSuccess: (flags) => {
      refreshNeedsWork(qc, cycleId, [proposalId]);
      toast.success(flags.length === 1 ? `${flags[0].label}: acknowledged.` : `${flags.length} flags resolved.`);
    },
    onError: (err) => toast.error(failureText(err, 'Could not resolve the flag.')),
  });
};

/** The blocked person asks for a separation of duties override (another person authorises it). */
export const useRequestSeparationOverrideMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SeparationOverrideRequest) => requestSeparationOverride(cycleId, body),
    onSuccess: (_flag, body) => {
      refreshNeedsWork(qc, cycleId, [body.proposalId]);
      toast.success('Override requested. Another authorised person must decide it before you can go ahead.');
    },
    onError: (err) => toast.error(failureText(err, 'Could not ask for the override.')),
  });
};

/** Another holder of `needs:override_separation` authorises or refuses a request. */
export const useDecideSeparationOverrideMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (p: { flagId: string; proposalId: string; body: SeparationOverrideDecisionInput }) => decideSeparationOverride(cycleId, p.flagId, p.body),
    onSuccess: (_flag, p) => {
      refreshNeedsWork(qc, cycleId, [p.proposalId]);
      toast.success(p.body.decision === 'AUTHORISED' ? 'Override authorised.' : 'Override refused.');
    },
    onError: (err) => toast.error(failureText(err, 'Could not record the decision on the override.')),
  });
};

/** Builds a cycle report again (xlsx and PDF) from the current records. */
export const useRegenerateNeedsReportMutation = (cycleId: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (kind: RegenerableReportKind) => regenerateNeedsReport(cycleId, kind),
    onSuccess: (_docs, kind) => {
      qc.invalidateQueries({ queryKey: needsCycleKey(cycleId) });
      toast.success(`${CYCLE_DOCUMENT_KIND_META[kind].label} generated.`);
    },
    onError: (err) => toast.error(failureText(err, 'Could not generate the report.')),
  });
};
