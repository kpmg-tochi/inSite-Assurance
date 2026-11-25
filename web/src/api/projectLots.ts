import type { ProjectLotListDto } from '@insite/shared';
import { api } from '../config/apiConfig';
import type { ApiEnvelope } from './types';

/**
 * Client demo updates C3: the tenant's project lots per allowed intervention year, with the next
 * lot and batch numbers (the code preview on the new-project form). `interventionYear` adds that
 * year to the allowed ones (a draft saved with an older year).
 */
export const listProjectLots = async (interventionYear?: number | null) => {
  const { data } = await api.get<ApiEnvelope<ProjectLotListDto>>('/project-lots', {
    params: interventionYear ? { interventionYear } : {},
  });
  return data.data;
};
