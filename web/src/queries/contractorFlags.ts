import { useQuery } from '@tanstack/react-query';
import type { ContractorFlagDto, ContractorFlagListQuery } from '@insite/shared';
import { getContractorFlag, listContractorFlags, listProjectContractorFlags } from '../api/contractorFlags';

/** Client demo updates F.4: every flag query sits under this prefix, so a decision refreshes them all. */
export const contractorFlagsKey = ['contractor-flags'] as const;

export const useContractorFlagsQuery = (query: ContractorFlagListQuery = {}, enabled = true) =>
  useQuery({
    queryKey: [...contractorFlagsKey, 'list', query],
    queryFn: () => listContractorFlags(query),
    enabled,
    staleTime: 30 * 1000,
  });

export const useContractorFlagQuery = (flagId: string | null | undefined, initialData?: ContractorFlagDto) =>
  useQuery({
    queryKey: [...contractorFlagsKey, 'detail', flagId],
    queryFn: () => getContractorFlag(flagId!),
    enabled: Boolean(flagId),
    initialData: initialData && initialData.id === flagId ? initialData : undefined,
  });

/** The project's own flags (project visibility is enough). */
export const useProjectContractorFlagsQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: [...contractorFlagsKey, 'project', projectId],
    queryFn: () => listProjectContractorFlags(projectId!),
    enabled: Boolean(projectId) && enabled,
    staleTime: 30 * 1000,
  });
