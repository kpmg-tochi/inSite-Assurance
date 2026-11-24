import type { CreateFacilityRequestInput, FacilityDto, UpdateFacilityRequest } from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/** Redesign R2a: the tenant facility catalogue. */

export const listFacilities = async (includeRetired = false) => {
  const { data } = await api.get<ApiEnvelope<FacilityDto[]>>('/facilities', {
    params: includeRetired ? { includeRetired: 'true' } : {},
  });
  return data.data;
};

export const createFacility = async (body: CreateFacilityRequestInput) => {
  const { data } = await api.post<ApiEnvelope<FacilityDto>>('/facilities', body);
  return data.data;
};

export const updateFacility = async (id: string, body: UpdateFacilityRequest) => {
  const { data } = await api.patch<ApiEnvelope<FacilityDto>>(`/facilities/${id}`, body);
  return data.data;
};
