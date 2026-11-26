import { useQuery } from '@tanstack/react-query';
import type { ContractorListQuery } from '@insite/shared';
import { getContractor, listContractors } from '../api/contractors';

export const contractorsKey = ['contractors'] as const;

/** Client demo updates F.1: the contractor register (also the picker's list). */
export const useContractorsQuery = (query: ContractorListQuery = {}, enabled = true) =>
  useQuery({
    queryKey: [...contractorsKey, 'list', query],
    queryFn: () => listContractors(query),
    enabled,
    staleTime: 30 * 1000,
  });

export const useContractorQuery = (contractorId: string | undefined) =>
  useQuery({
    queryKey: [...contractorsKey, 'detail', contractorId],
    queryFn: () => getContractor(contractorId!),
    enabled: Boolean(contractorId),
  });
