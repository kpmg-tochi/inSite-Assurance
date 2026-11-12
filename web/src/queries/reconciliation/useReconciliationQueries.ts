import { useQuery } from '@tanstack/react-query';
import {
  getIpcDetails,
  getProjectIpcs,
} from '../../api/reconciliation/reconciliationApi';

export const useProjectIpcsQuery = (
  projectId: string | null | undefined,
  enabled = true
) => {
  return useQuery({
    queryKey: ['ipcs', projectId],
    queryFn: () => getProjectIpcs(projectId!),
    enabled: Boolean(projectId) && enabled,
  });
};

export const useIpcDetailsQuery = (
  projectId: string | null | undefined,
  ipcId: string | null | undefined
) => {
  return useQuery({
    queryKey: ['ipc-details', projectId, ipcId],
    queryFn: () => getIpcDetails(projectId!, ipcId!),
    enabled: Boolean(projectId && ipcId),
  });
};

