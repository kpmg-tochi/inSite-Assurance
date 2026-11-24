import type { PortfolioOverviewDto, ProjectListFilters } from '@insite/shared';
import { api } from '../../config/apiConfig';
import type {
  ApiEnvelope,
  BoqItemRecordDto,
  ProjectSummaryDto,
} from '../types';

export const getProjects = async () => {
  const { data } = await api.get<ApiEnvelope<ProjectSummaryDto[]>>('/projects');
  return data.data;
};

export const getProjectBaseline = async (projectId: string) => {
  const { data } = await api.get<
    ApiEnvelope<ProjectSummaryDto & { boqItems: BoqItemRecordDto[] }>
  >(`/projects/${projectId}/baseline`);
  return data.data;
};

/** Portfolio dashboard: a map point per visible live project plus KPIs (projects:view_portfolio). */
export const getPortfolioOverview = async (filters: ProjectListFilters = {}) => {
  const { data } = await api.get<ApiEnvelope<PortfolioOverviewDto>>('/projects/portfolio/overview', { params: filters });
  return data.data;
};
