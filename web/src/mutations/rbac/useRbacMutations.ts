import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type {
  AssignUserProjectsRequest,
  CreateRoleRequest,
  CreateTenantRequest,
  CreateTenantUserRequest,
  UpdateEvidenceRatingLabelsRequest,
  UpdateFieldSessionStatusRequest,
  UpdateRoleRequest,
  UpdateTenantBrandingRequest,
} from '@insite/shared';
import {
  assignUserProjects,
  createTenant,
  createTenantRole,
  createTenantUser,
  deleteTenantRole,
  updateEvidenceRatingLabels,
  updateProjectFieldSessionStatus,
  updateTenantBranding,
  updateTenantRole,
} from '../../api/rbac/rbacApi';
import { useAuth } from '../../lib/auth-context';

export const useCreateRoleMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateRoleRequest) => createTenantRole(payload),
    onSuccess: (role) => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'roles'] });
      toast.success(`Role "${role.name}" created with ${role.permissions.length} permission(s).`);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to create custom role.');
    },
  });
};

export const useUpdateRoleMutation = () => {
  const queryClient = useQueryClient();
  const { user, refreshUser } = useAuth();
  return useMutation({
    mutationFn: ({ roleId, payload }: { roleId: string; payload: UpdateRoleRequest }) =>
      updateTenantRole(roleId, payload),
    onSuccess: (role) => {
      if (user && role.id === user.roleId) {
        // The caller's own permissions changed; reload them so navigation matches the server.
        void refreshUser();
      }
      queryClient.invalidateQueries({ queryKey: ['rbac', 'roles'] });
      queryClient.invalidateQueries({ queryKey: ['rbac', 'users'] });
      toast.success(`Updated role "${role.name}" and permission assignments.`);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to update role.');
    },
  });
};

export const useDeleteRoleMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (roleId: string) => deleteTenantRole(roleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'roles'] });
      toast.success('Custom role deleted.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to delete role.');
    },
  });
};

export const useCreateTenantUserMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateTenantUserRequest) => createTenantUser(payload),
    onSuccess: (user) => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['rbac', 'roles'] });
      toast.success(`Added user ${user.fullName} as ${user.roleName}.`);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to create user.');
    },
  });
};

export const useAssignUserProjectsMutation = () => {
  const queryClient = useQueryClient();
  const { user: currentUser, refreshUser } = useAuth();
  return useMutation({
    mutationFn: ({
      userId,
      payload,
    }: {
      userId: string;
      payload: AssignUserProjectsRequest;
    }) => assignUserProjects(userId, payload),
    onSuccess: (user, variables) => {
      if (currentUser && variables.userId === currentUser.id) {
        void refreshUser();
        queryClient.invalidateQueries({ queryKey: ['projects'] });
      }
      queryClient.invalidateQueries({ queryKey: ['rbac', 'users'] });
      queryClient.invalidateQueries({ queryKey: ['rbac', 'roles'] });
      toast.success(`Updated role & project visibility for ${user.fullName}.`);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to update user project assignments.');
    },
  });
};

export const useUpdateTenantBrandingMutation = () => {
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  return useMutation({
    mutationFn: (payload: UpdateTenantBrandingRequest) =>
      updateTenantBranding(payload),
    onSuccess: () => {
      // Branding is part of the signed-in profile; reload it so the shell re-themes.
      void refreshUser();
      queryClient.invalidateQueries({ queryKey: ['rbac', 'tenant'] });
      toast.success('Tenant white-label branding saved.');
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to update tenant branding.');
    },
  });
};

export const useUpdateEvidenceRatingLabelsMutation = () => {
  const queryClient = useQueryClient();
  const { refreshUser } = useAuth();
  return useMutation({
    mutationFn: (payload: UpdateEvidenceRatingLabelsRequest) => updateEvidenceRatingLabels(payload),
    onSuccess: () => {
      // Labels are part of the signed-in profile; reload it so every badge updates.
      void refreshUser();
      queryClient.invalidateQueries({ queryKey: ['rbac', 'rating-labels'] });
      toast.success('Evidence rating labels saved.');
    },
    onError: (err: unknown) => {
      toast.error((err as { message?: string })?.message || 'Failed to save rating labels.');
    },
  });
};

export const useCreateTenantMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateTenantRequest) => createTenant(payload),
    onSuccess: (tenant) => {
      queryClient.invalidateQueries({ queryKey: ['rbac', 'tenants'] });
      toast.success(`Provisioned new client tenant "${tenant.name}".`);
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to create tenant.');
    },
  });
};

export const useUpdateFieldSessionStatusMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      sessionId,
      payload,
    }: {
      sessionId: string;
      payload: UpdateFieldSessionStatusRequest;
    }) => updateProjectFieldSessionStatus(projectId, sessionId, payload),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ['field-sessions', projectId] });
      queryClient.invalidateQueries({ queryKey: ['audit-trail', projectId] });
      toast.success(
        res.isActive
          ? 'Restored mobile device session access.'
          : 'Revoked mobile device session access.'
      );
    },
    onError: (err: any) => {
      toast.error(err?.message || 'Failed to update device session status.');
    },
  });
};
