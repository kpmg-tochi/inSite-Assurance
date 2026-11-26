import type { ProjectSitesDto } from '@insite/shared';
import { api } from '../config/apiConfig';
import type { ApiEnvelope } from './types';

/**
 * Client demo updates C2 (wave 2): the project's sites with their units, progress and status
 * (GET /projects/:id/sites). Saving goes through the setup section `sites`.
 */
export const getProjectSites = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<ProjectSitesDto | null>>(`/projects/${projectId}/sites`);
  return data.data;
};
