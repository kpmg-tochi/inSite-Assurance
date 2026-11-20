import type {
  ProjectTypeDto,
  RegionDto,
  SaveProjectTypeRequestInput,
  SaveRegionRequest,
  TerminologySettingsDto,
  UpdateTerminologyRequest,
} from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope } from '../types';

/** Phase 11: project types, regions and tenant terminology. */

export const listProjectTypes = async (includeInactive = false) => {
  const { data } = await api.get<ApiEnvelope<ProjectTypeDto[]>>('/project-types', {
    params: includeInactive ? { includeInactive: 'true' } : {},
  });
  return data.data;
};

export const createProjectType = async (payload: SaveProjectTypeRequestInput) => {
  const { data } = await api.post<ApiEnvelope<ProjectTypeDto>>('/project-types', payload);
  return data.data;
};

export const updateProjectType = async (projectTypeId: string, payload: SaveProjectTypeRequestInput) => {
  const { data } = await api.put<ApiEnvelope<ProjectTypeDto>>(`/project-types/${projectTypeId}`, payload);
  return data.data;
};

export const archiveProjectType = async (projectTypeId: string) => {
  const { data } = await api.post<ApiEnvelope<ProjectTypeDto>>(`/project-types/${projectTypeId}/archive`);
  return data.data;
};

export const listRegions = async (includeArchived = false) => {
  const { data } = await api.get<ApiEnvelope<RegionDto[]>>('/regions', {
    params: includeArchived ? { includeArchived: 'true' } : {},
  });
  return data.data;
};

export const createRegion = async (payload: SaveRegionRequest) => {
  const { data } = await api.post<ApiEnvelope<RegionDto>>('/regions', payload);
  return data.data;
};

export const updateRegion = async (regionId: string, payload: SaveRegionRequest) => {
  const { data } = await api.put<ApiEnvelope<RegionDto>>(`/regions/${regionId}`, payload);
  return data.data;
};

export const getTerminology = async () => {
  const { data } = await api.get<ApiEnvelope<TerminologySettingsDto>>('/rbac/tenant/settings/terminology');
  return data.data;
};

export const updateTerminology = async (payload: UpdateTerminologyRequest) => {
  const { data } = await api.put<ApiEnvelope<TerminologySettingsDto>>('/rbac/tenant/settings/terminology', payload);
  return data.data;
};
