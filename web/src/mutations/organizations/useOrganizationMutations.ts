import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  CreateOrganizationRequest,
  UpdateOrganizationRequest,
  UpdateTenantSettingsRequest,
} from '@insite/shared';
import {
  createOrganization,
  updateOrganization,
  updateTenantSettings,
} from '../../api/organizations/organizationsApi';

export const useCreateOrganizationMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateOrganizationRequest) => createOrganization(payload),
    onSuccess: (org) => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      toast.success(`Added ${org.name}.`);
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not add the organisation.'),
  });
};

export const useUpdateOrganizationMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { organizationId: string; payload: UpdateOrganizationRequest }) =>
      updateOrganization(args.organizationId, args.payload),
    onSuccess: (org, args) => {
      queryClient.invalidateQueries({ queryKey: ['organizations'] });
      if (args.payload.isArchived === true) toast.success(`Archived ${org.name}.`);
      else if (args.payload.isArchived === false) toast.success(`Restored ${org.name}.`);
      else toast.success(`Saved ${org.name}.`);
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not save the organisation.'),
  });
};

export const useUpdateTenantSettingsMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: UpdateTenantSettingsRequest) => updateTenantSettings(payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tenant-settings'] });
      queryClient.invalidateQueries({ queryKey: ['rbac', 'tenant'] });
      toast.success('Workspace settings saved.');
    },
    onError: (err: Error) => toast.error(err?.message || 'Could not save the settings.'),
  });
};
