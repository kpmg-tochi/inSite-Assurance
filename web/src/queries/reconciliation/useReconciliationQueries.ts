import { useQuery } from '@tanstack/react-query';
import {
  getDirectMilestoneSuggestion,
  getIpcDetails,
  getProjectIpcs,
  listDirectMilestoneValuations,
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


/** Phase 7: direct milestone valuations (direct-release projects). */
export const useDirectValuationsQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: ['direct-valuations', projectId],
    queryFn: () => listDirectMilestoneValuations(projectId!),
    enabled: Boolean(projectId) && enabled,
  });

/** Evidence-derived suggestion for verifying a tranche directly. */
export const useDirectMilestoneSuggestionQuery = (
  projectId: string | null | undefined,
  trancheId: string | null | undefined
) =>
  useQuery({
    queryKey: ['direct-milestone-suggestion', projectId, trancheId],
    queryFn: () => getDirectMilestoneSuggestion(projectId!, trancheId!),
    enabled: Boolean(projectId && trancheId),
  });
