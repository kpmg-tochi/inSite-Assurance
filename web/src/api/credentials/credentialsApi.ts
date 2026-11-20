import type {
  CredentialSettingsDto,
  ProjectCredentialPolicyDto,
  RegistrationBodyDto,
  SaveRegistrationBodyRequest,
  UpdateCredentialPolicyRequest,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/** Phase 12: professional registration policy and the tenant's registration bodies. */

export const getCredentialSettings = async () => {
  const { data } = await api.get<ApiEnvelope<CredentialSettingsDto>>('/credentials/settings');
  return data.data;
};

export const updateCredentialPolicy = async (payload: UpdateCredentialPolicyRequest) => {
  const { data } = await api.put<ApiEnvelope<CredentialSettingsDto>>('/credentials/policy', payload);
  return data.data;
};

export const createRegistrationBody = async (payload: SaveRegistrationBodyRequest) => {
  const { data } = await api.post<ApiEnvelope<RegistrationBodyDto>>('/credentials/registration-bodies', payload);
  return data.data;
};

export const updateRegistrationBody = async (bodyId: string, payload: SaveRegistrationBodyRequest) => {
  const { data } = await api.put<ApiEnvelope<RegistrationBodyDto>>(`/credentials/registration-bodies/${bodyId}`, payload);
  return data.data;
};

export const deleteRegistrationBody = async (bodyId: string) => {
  const { data } = await api.delete<ApiEnvelope<{ deleted: boolean; archived: boolean }>>(
    `/credentials/registration-bodies/${bodyId}`
  );
  return data.data;
};

export const getProjectCredentialPolicy = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<ProjectCredentialPolicyDto>>(`/projects/${projectId}/credential-policy`);
  return data.data;
};
