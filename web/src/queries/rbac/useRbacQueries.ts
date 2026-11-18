import { useQuery } from '@tanstack/react-query';
import {
  getAllTenants,
  getCurrentTenant,
  getPermissionsCatalog,
  getProjectFieldSessions,
  getTenantRoles,
  getTenantUsers,
} from '../../api/rbac/rbacApi';

export const usePermissionsCatalogQuery = (enabled = true) =>
  useQuery({
    queryKey: ['rbac', 'permissions'],
    queryFn: getPermissionsCatalog,
    enabled,
    staleTime: 5 * 60 * 1000,
  });

export const useTenantRolesQuery = (enabled = true) =>
  useQuery({
    queryKey: ['rbac', 'roles'],
    queryFn: getTenantRoles,
    enabled,
    staleTime: 60 * 1000,
  });

export const useTenantUsersQuery = (enabled = true) =>
  useQuery({
    queryKey: ['rbac', 'users'],
    queryFn: getTenantUsers,
    enabled,
    staleTime: 60 * 1000,
  });

export const useCurrentTenantQuery = (enabled = true) =>
  useQuery({
    queryKey: ['rbac', 'tenant'],
    queryFn: getCurrentTenant,
    enabled,
    staleTime: 60 * 1000,
  });

export const useAllTenantsQuery = (enabled = false) =>
  useQuery({
    queryKey: ['rbac', 'tenants'],
    queryFn: getAllTenants,
    enabled,
    staleTime: 60 * 1000,
  });

export const useProjectFieldSessionsQuery = (
  projectId: string,
  enabled = true
) =>
  useQuery({
    queryKey: ['field-sessions', projectId],
    queryFn: () => getProjectFieldSessions(projectId),
    enabled: Boolean(projectId) && enabled,
    staleTime: 30 * 1000,
  });
