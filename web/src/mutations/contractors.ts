import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { ChangeContractorStatusRequest, CreateContractorRequest, UpdateContractorRequest } from '@insite/shared';
import { CONTRACTOR_STATUS_LABELS } from '@insite/shared';
import {
  changeContractorStatus,
  createContractor,
  duplicateCandidatesOf,
  refreshContractorRatings,
  updateContractor,
} from '../api/contractors';
import { contractorsKey } from '../queries/contractors';

/**
 * Client demo updates F.1: creating a contractor. A 409 CONTRACTOR_DUPLICATE is not toasted: the
 * form shows the candidates (`duplicateCandidatesOf`).
 */
export const useCreateContractorMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateContractorRequest) => createContractor(payload),
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: contractorsKey });
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      toast.success(`Added ${c.name}. It stays inactive until its signed contract is on file.`);
    },
    onError: (err: Error) => {
      if (duplicateCandidatesOf(err)) return;
      toast.error(err?.message || 'Could not add the contractor.');
    },
  });
};

export const useUpdateContractorMutation = (contractorId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateContractorRequest) => updateContractor(contractorId, payload),
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: contractorsKey });
      toast.success(`Saved ${c.name}.`);
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not save the contractor.'),
  });
};

export const useChangeContractorStatusMutation = (contractorId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: ChangeContractorStatusRequest) => changeContractorStatus(contractorId, payload),
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: contractorsKey });
      toast.success(`${c.name}: ${CONTRACTOR_STATUS_LABELS[c.status]}.`);
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not change the status.'),
  });
};

export const useRefreshContractorRatingsMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => refreshContractorRatings(),
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: contractorsKey });
      toast.success(`Ratings recalculated for ${r.count} contractor${r.count === 1 ? '' : 's'}.`);
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not refresh the ratings.'),
  });
};
