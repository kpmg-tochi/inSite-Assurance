import type {
  ChangeContractorStatusRequest,
  ContractorDetailDto,
  ContractorDuplicateCandidate,
  ContractorListQuery,
  ContractorSummaryDto,
  CreateContractorRequest,
  UpdateContractorRequest,
} from '@insite/shared';
import { api } from '../config/apiConfig';
import type { ApiEnvelope } from './types';

/**
 * Client demo updates F.1–F.3 (wave 2): the contractor register (`/api/v1/contractors`).
 * POST answers 409 CONTRACTOR_DUPLICATE with `error.details.candidates` (see `duplicateCandidatesOf`).
 */

export const listContractors = async (query: ContractorListQuery = {}) => {
  const params = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined && v !== ''));
  const { data } = await api.get<ApiEnvelope<ContractorSummaryDto[]>>('/contractors', { params });
  return data.data;
};

export const getContractor = async (contractorId: string) => {
  const { data } = await api.get<ApiEnvelope<ContractorDetailDto>>(`/contractors/${contractorId}`);
  return data.data;
};

export const findContractorDuplicates = async (args: { name?: string; rc?: string }) => {
  const { data } = await api.get<ApiEnvelope<ContractorDuplicateCandidate[]>>('/contractors/duplicates', { params: args });
  return data.data;
};

export const createContractor = async (payload: CreateContractorRequest) => {
  const { data } = await api.post<ApiEnvelope<ContractorDetailDto>>('/contractors', payload);
  return data.data;
};

export const updateContractor = async (contractorId: string, payload: UpdateContractorRequest) => {
  const { data } = await api.put<ApiEnvelope<ContractorDetailDto>>(`/contractors/${contractorId}`, payload);
  return data.data;
};

export const changeContractorStatus = async (contractorId: string, payload: ChangeContractorStatusRequest) => {
  const { data } = await api.post<ApiEnvelope<ContractorDetailDto>>(`/contractors/${contractorId}/status`, payload);
  return data.data;
};

export const refreshContractorRatings = async () => {
  const { data } = await api.post<ApiEnvelope<{ count: number; computedAt: string }>>('/contractors/refresh-ratings');
  return data.data;
};

/** The candidates of a 409 CONTRACTOR_DUPLICATE, or null for any other error. */
export function duplicateCandidatesOf(error: unknown): ContractorDuplicateCandidate[] | null {
  const body = (error as { response?: { status?: number; data?: { error?: { code?: string; details?: { candidates?: ContractorDuplicateCandidate[] } } } } })?.response;
  if (body?.status !== 409 || body.data?.error?.code !== 'CONTRACTOR_DUPLICATE') return null;
  return body.data.error.details?.candidates ?? [];
}
