import type {
  AssignUserProjectsRequest,
  CreateRoleRequest,
  CreateTenantRequest,
  CreateTenantUserRequest,
  FieldSessionRosterDto,
  PermissionDto,
  RoleDto,
  TenantDto,
  TenantUserDto,
  UpdateFieldSessionStatusRequest,
  UpdateRoleRequest,
  UpdateTenantBrandingRequest,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

export const getPermissionsCatalog = async () => {
  const { data } = await api.get<ApiEnvelope<PermissionDto[]>>('/rbac/permissions');
  return data.data;
};

export const getTenantRoles = async () => {
  const { data } = await api.get<ApiEnvelope<RoleDto[]>>('/rbac/roles');
  return data.data;
};

export const createTenantRole = async (payload: CreateRoleRequest) => {
  const { data } = await api.post<ApiEnvelope<RoleDto>>('/rbac/roles', payload);
  return data.data;
};

export const updateTenantRole = async (
  roleId: string,
  payload: UpdateRoleRequest
) => {
  const { data } = await api.put<ApiEnvelope<RoleDto>>(
    `/rbac/roles/${roleId}`,
    payload
  );
  return data.data;
};

export const deleteTenantRole = async (roleId: string) => {
  const { data } = await api.delete<ApiEnvelope<{ deletedId: string }>>(
    `/rbac/roles/${roleId}`
  );
  return data.data;
};

export const getTenantUsers = async () => {
  const { data } = await api.get<ApiEnvelope<TenantUserDto[]>>('/rbac/users');
  return data.data;
};

export const createTenantUser = async (payload: CreateTenantUserRequest) => {
  const { data } = await api.post<ApiEnvelope<TenantUserDto>>(
    '/rbac/users',
    payload
  );
  return data.data;
};

export const assignUserProjects = async (
  userId: string,
  payload: AssignUserProjectsRequest
) => {
  const { data } = await api.put<ApiEnvelope<TenantUserDto>>(
    `/rbac/users/${userId}/assignments`,
    payload
  );
  return data.data;
};

export const getCurrentTenant = async () => {
  const { data } = await api.get<ApiEnvelope<TenantDto>>('/rbac/tenant');
  return data.data;
};

export const updateTenantBranding = async (
  payload: UpdateTenantBrandingRequest
) => {
  const { data } = await api.put<ApiEnvelope<TenantDto>>(
    '/rbac/tenant/branding',
    payload
  );
  return data.data;
};

export const getAllTenants = async () => {
  const { data } = await api.get<
    ApiEnvelope<
      Array<
        TenantDto & {
          projectCount: number;
          userCount: number;
          roleCount: number;
        }
      >
    >
  >('/rbac/tenants');
  return data.data;
};

export const createTenant = async (payload: CreateTenantRequest) => {
  const { data } = await api.post<ApiEnvelope<TenantDto>>(
    '/rbac/tenants',
    payload
  );
  return data.data;
};

export const getProjectFieldSessions = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<FieldSessionRosterDto[]>>(
    `/projects/${projectId}/field-sessions`
  );
  return data.data;
};

export const updateProjectFieldSessionStatus = async (
  projectId: string,
  sessionId: string,
  payload: UpdateFieldSessionStatusRequest
) => {
  const { data } = await api.patch<ApiEnvelope<{ id: string; isActive: boolean }>>(
    `/projects/${projectId}/field-sessions/${sessionId}/status`,
    payload
  );
  return data.data;
};
