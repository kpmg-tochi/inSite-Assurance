import type {
  ContractorFlagDto,
  ContractorFlagListQuery,
  DecideContractorFlagActionRequest,
  LiftContractorFlagActionRequest,
} from '@insite/shared';
import { api } from '../config/apiConfig';
import type { ApiEnvelope } from './types';

/**
 * Client demo updates F.4 (wave 3): contractor performance flags (`/api/v1/contractor-flags`) and a
 * project's own flags (`/api/v1/projects/:projectId/contractor-flags`). Deciding and lifting answer
 * with the updated flag.
 */

export const listContractorFlags = async (query: ContractorFlagListQuery = {}) => {
  const params = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== ''));
  const { data } = await api.get<ApiEnvelope<ContractorFlagDto[]>>('/contractor-flags', { params });
  return data.data;
};

export const getContractorFlag = async (flagId: string) => {
  const { data } = await api.get<ApiEnvelope<ContractorFlagDto>>(`/contractor-flags/${flagId}`);
  return data.data;
};

export const listProjectContractorFlags = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<ContractorFlagDto[]>>(`/projects/${projectId}/contractor-flags`);
  return data.data;
};

export const decideContractorFlagAction = async (flagId: string, payload: DecideContractorFlagActionRequest) => {
  const { data } = await api.post<ApiEnvelope<ContractorFlagDto>>(`/contractor-flags/${flagId}/actions`, payload);
  return data.data;
};

export const liftContractorFlagAction = async (flagId: string, actionId: string, payload: LiftContractorFlagActionRequest) => {
  const { data } = await api.post<ApiEnvelope<ContractorFlagDto>>(`/contractor-flags/${flagId}/actions/${actionId}/lift`, payload);
  return data.data;
};
