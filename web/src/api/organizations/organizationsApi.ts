import type {
  CreateOrganizationRequest,
  OrganizationCategory,
  OrganizationDto,
  TenantSettingsDto,
  UpdateOrganizationRequest,
  UpdateTenantSettingsRequest,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

export interface OrganizationListQuery {
  tag?: OrganizationCategory;
  search?: string;
  includeArchived?: boolean;
}

export const listOrganizations = async (query: OrganizationListQuery = {}) => {
  const { data } = await api.get<ApiEnvelope<OrganizationDto[]>>('/organizations', {
    params: {
      ...(query.tag ? { tag: query.tag } : {}),
      ...(query.search ? { search: query.search } : {}),
      ...(query.includeArchived ? { includeArchived: 'true' } : {}),
    },
  });
  return data.data;
};

export const createOrganization = async (payload: CreateOrganizationRequest) => {
  const { data } = await api.post<ApiEnvelope<OrganizationDto>>('/organizations', payload);
  return data.data;
};

export const updateOrganization = async (organizationId: string, payload: UpdateOrganizationRequest) => {
  const { data } = await api.patch<ApiEnvelope<OrganizationDto>>(`/organizations/${organizationId}`, payload);
  return data.data;
};

export const getTenantSettings = async () => {
  const { data } = await api.get<ApiEnvelope<TenantSettingsDto>>('/rbac/tenant/settings');
  return data.data;
};

export const updateTenantSettings = async (payload: UpdateTenantSettingsRequest) => {
  const { data } = await api.put<ApiEnvelope<TenantSettingsDto>>('/rbac/tenant/settings', payload);
  return data.data;
};
