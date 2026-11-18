import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CertifyIpcValuationRequest,
  CreateMonitorQueryRequest,
  LenderTrancheDecisionRequest,
  ResolveMonitorQueryRequest,
  RespondMonitorQueryRequest,
  ReverseTrancheDecisionRequest,
  SubmitIpcClaimRequest,
  UpdateConditionPrecedentStatusRequest,
  WaiveConditionPrecedentRequest,
  WithdrawIpcClaimRequest,
} from '@insite/shared';
import {
  certifyIpcValuation,
  createMonitorQuery,
  decideTrancheRelease,
  downloadValuationReportPdf,
  reconcileIpc,
  resolveMonitorQuery,
  respondMonitorQuery,
  reverseTrancheDecision,
  submitIpcClaim,
  updateConditionStatus,
  waiveCondition,
  withdrawIpc,
} from '../../api/reconciliation/reconciliationApi';

/** Mutation hooks own their toasts; pages must not toast again. */
const errorMessage = (err: unknown, fallback: string) =>
  (err as { message?: string })?.message || fallback;

function invalidateReconciliation(queryClient: QueryClient, projectId: string) {
  queryClient.invalidateQueries({ queryKey: ['ipcs', projectId] });
  queryClient.invalidateQueries({ queryKey: ['ipc-details', projectId] });
  queryClient.invalidateQueries({ queryKey: ['projects'] });
  queryClient.invalidateQueries({ queryKey: ['audit-trail', projectId] });
}

export const useSubmitIpcMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SubmitIpcClaimRequest) => submitIpcClaim({ projectId, body }),
    onSuccess: (data) => {
      invalidateReconciliation(queryClient, projectId);
      if (data.reconciliationPending) {
        toast.warning(
          `IPC #${data.ipcNumber} saved. Evidence reconciliation could not run yet; the monitor can re-run it.`
        );
      } else {
        toast.success(`IPC #${data.ipcNumber} submitted and reconciled against field evidence.`);
      }
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to submit IPC claim.')),
  });
};

export const useReconcileIpcMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ipcId: string) => reconcileIpc({ projectId, ipcId }),
    onSuccess: (data) => {
      invalidateReconciliation(queryClient, projectId);
      toast.success(
        data.ratingEngine === 'RULES_ENGINE'
          ? 'Reconciliation completed with the rules engine (AI provider unavailable).'
          : 'Reconciliation completed against field evidence.'
      );
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to run reconciliation.')),
  });
};

export const useWithdrawIpcMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { ipcId: string; body: WithdrawIpcClaimRequest }) =>
      withdrawIpc({ projectId, ...payload }),
    onSuccess: (data) => {
      invalidateReconciliation(queryClient, projectId);
      toast.success(`IPC #${data.ipcNumber} withdrawn.`);
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to withdraw the claim.')),
  });
};

export const useCreateMonitorQueryMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { ipcId: string; body: CreateMonitorQueryRequest }) =>
      createMonitorQuery({ projectId, ...payload }),
    onSuccess: () => {
      invalidateReconciliation(queryClient, projectId);
      toast.success('Query issued to the contractor.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to issue the query.')),
  });
};

export const useRespondMonitorQueryMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { ipcId: string; queryId: string; body: RespondMonitorQueryRequest }) =>
      respondMonitorQuery({ projectId, ...payload }),
    onSuccess: () => {
      invalidateReconciliation(queryClient, projectId);
      toast.success('Response recorded.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to record the response.')),
  });
};

export const useResolveMonitorQueryMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { ipcId: string; queryId: string; body: ResolveMonitorQueryRequest }) =>
      resolveMonitorQuery({ projectId, ...payload }),
    onSuccess: (data) => {
      invalidateReconciliation(queryClient, projectId);
      if (data.outstandingQueries > 0) {
        toast.success(`Query resolved. ${data.outstandingQueries} query(ies) still outstanding.`);
      } else if (data.reconciliationPending) {
        toast.warning('All queries resolved. Reconciliation could not re-run; run it again.');
      } else {
        toast.success('All queries resolved. Reconciliation re-ran on the revised claim.');
      }
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to resolve the query.')),
  });
};

/** Dry run: no toast on success, the modal shows the figures. */
export const useCertificationPreviewMutation = (projectId: string) =>
  useMutation({
    mutationFn: (payload: { ipcId: string; body: CertifyIpcValuationRequest }) =>
      certifyIpcValuation({ projectId, ...payload, dryRun: true }),
  });

export const useCertifyValuationMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { ipcId: string; body: CertifyIpcValuationRequest }) =>
      certifyIpcValuation({ projectId, ...payload }),
    onSuccess: (data) => {
      invalidateReconciliation(queryClient, projectId);
      queryClient.invalidateQueries({ queryKey: ['boq', projectId] });
      toast.success(
        `Valuation certified (revision ${data.valuationReport?.revisionNumber ?? data.computation.revisionNumber}).`
      );
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to certify the valuation.')),
  });
};

export const useDecideTrancheMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { trancheId: string; body: LenderTrancheDecisionRequest }) =>
      decideTrancheRelease({ projectId, ...payload }),
    onSuccess: () => {
      invalidateReconciliation(queryClient, projectId);
      toast.success('Tranche decision recorded.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to record the decision.')),
  });
};

export const useReverseDecisionMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: { decisionId: string; body: ReverseTrancheDecisionRequest }) =>
      reverseTrancheDecision({ projectId, ...payload }),
    onSuccess: () => {
      invalidateReconciliation(queryClient, projectId);
      toast.success('Decision reversed. A corrected decision can now be recorded.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to reverse the decision.')),
  });
};

export const useUpdateConditionStatusMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      trancheId: string;
      conditionId: string;
      body: UpdateConditionPrecedentStatusRequest;
    }) => updateConditionStatus({ projectId, ...payload }),
    onSuccess: () => {
      invalidateReconciliation(queryClient, projectId);
      toast.success('Condition precedent updated.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to update the condition.')),
  });
};

export const useWaiveConditionMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: {
      trancheId: string;
      conditionId: string;
      body: WaiveConditionPrecedentRequest;
    }) => waiveCondition({ projectId, ...payload }),
    onSuccess: () => {
      invalidateReconciliation(queryClient, projectId);
      toast.success('Condition precedent waived and recorded in the ledger.');
    },
    onError: (err) => toast.error(errorMessage(err, 'Failed to waive the condition.')),
  });
};

export const useDownloadValuationPdfMutation = (projectId: string | undefined) =>
  useMutation({
    mutationFn: (ipcId: string) => downloadValuationReportPdf(projectId!, ipcId),
    onError: (err) => toast.error(errorMessage(err, 'Could not export the valuation PDF.')),
  });
