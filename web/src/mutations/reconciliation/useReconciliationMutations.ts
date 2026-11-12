import { useMutation, useQueryClient } from '@tanstack/react-query';
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ipcs', projectId] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['audit-trail', projectId] });
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
    },
  });
};

