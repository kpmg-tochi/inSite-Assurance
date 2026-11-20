import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SaveRegistrationBodyRequest, UpdateCredentialPolicyRequest } from '@insite/shared';
import {
  createRegistrationBody,
  deleteRegistrationBody,
  updateCredentialPolicy,
  updateRegistrationBody,
} from '../../api/credentials/credentialsApi';

const invalidateAll = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: ['credential-settings'] });
  queryClient.invalidateQueries({ queryKey: ['credential-policy'] });
};

export const useUpdateCredentialPolicyMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateCredentialPolicyRequest) => updateCredentialPolicy(payload),
    onSuccess: () => {
      invalidateAll(queryClient);
      queryClient.invalidateQueries({ queryKey: ['auth'] });
      toast.success('Registration policy saved.');
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not save the registration policy.'),
  });
};

export const useSaveRegistrationBodyMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { bodyId: string | null; payload: SaveRegistrationBodyRequest }) =>
      args.bodyId ? updateRegistrationBody(args.bodyId, args.payload) : createRegistrationBody(args.payload),
    onSuccess: (body, args) => {
      invalidateAll(queryClient);
      if (!args.bodyId) toast.success(`Added ${body.code}.`);
      else if (args.payload.isArchived === true) toast.success(`Archived ${body.code}.`);
      else if (args.payload.isArchived === false) toast.success(`Restored ${body.code}.`);
      else toast.success(`Saved ${body.code}.`);
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not save the registration body.'),
  });
};

export const useDeleteRegistrationBodyMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bodyId: string) => deleteRegistrationBody(bodyId),
    onSuccess: (result) => {
      invalidateAll(queryClient);
      toast.success(result.archived ? 'Still named on a profile or certificate, so it was archived instead.' : 'Registration body deleted.');
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not remove the registration body.'),
  });
};
