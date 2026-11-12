import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CertifyIpcValuationRequest,
  CreateMonitorQueryRequest,
  LenderTrancheDecisionRequest,
  RespondMonitorQueryRequest,
  SubmitIpcClaimRequest,
} from '@insite/shared';
import {
  certifyIpcValuation,
  createMonitorQuery,
  decideTrancheRelease,
  reconcileIpc,
  respondMonitorQuery,
  submitIpcClaim,
} from '../../api/reconciliation/reconciliationApi';

export const useSubmitIpcMutation = (projectId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: SubmitIpcClaimRequest) =>
      submitIpcClaim({ projectId, body }),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['ipcs', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['audit-trail', projectId] });
      toast.success(
        `IPC claim #${data.ipcNumber} submitted. AI reconciliation initiated.`
      );
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to submit IPC claim.');
    },
  });
};

export const useReconcileIpcMutation = (projectId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (ipcId: string) => reconcileIpc({ projectId, ipcId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ipcs', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['audit-trail', projectId] });
      toast.success('AI reconciliation completed against field evidence.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to run AI reconciliation.');
    },
  });
};

export const useCreateMonitorQueryMutation = (projectId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: { ipcId: string; body: CreateMonitorQueryRequest }) =>
      createMonitorQuery({ projectId, ...payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ipcs', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['audit-trail', projectId] });
      toast.warning('Formal dispute query issued to Main Contractor.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to issue dispute query.');
    },
  });
};

export const useRespondMonitorQueryMutation = (projectId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      ipcId: string;
      queryId: string;
      body: RespondMonitorQueryRequest;
    }) => respondMonitorQuery({ projectId, ...payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ipcs', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['audit-trail', projectId] });
      toast.info('Contractor response recorded on dispute query.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to record contractor response.');
    },
  });
};

export const useCertifyValuationMutation = (projectId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      ipcId: string;
      body: CertifyIpcValuationRequest;
    }) => certifyIpcValuation({ projectId, ...payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ipcs', projectId] });
      queryClient.invalidateQueries({ queryKey: ['boq', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['audit-trail', projectId] });
      toast.success(
        'Disbursement Valuation Report certified and signed by Independent Monitor.'
      );
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to certify valuation report.');
    },
  });
};

export const useDecideTrancheMutation = (projectId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: {
      trancheId: string;
      body: LenderTrancheDecisionRequest;
    }) => decideTrancheRelease({ projectId, ...payload }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ipcs', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['audit-trail', projectId] });
      toast.success('Lender Tranche Release decision committed to ledger.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to record tranche decision.');
    },
  });
};

