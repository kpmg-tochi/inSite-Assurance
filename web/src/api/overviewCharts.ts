import type { ProjectOverviewChartsDto } from '@insite/shared';
import { api } from '../config/apiConfig';
import type { ApiEnvelope } from './types';

/**
 * Design round 2026-11-26: the Overview dashboard's charts (GET /projects/:id/overview/charts).
 * A section the caller may not see comes back null; a section with nothing yet is an empty list.
 */
export const getProjectOverviewCharts = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<ProjectOverviewChartsDto>>(`/projects/${projectId}/overview/charts`);
  return data.data;
};
