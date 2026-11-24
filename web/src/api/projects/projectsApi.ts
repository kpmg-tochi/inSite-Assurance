import type { PortfolioOverviewDto, ProjectListFilters, ProjectOverviewDto } from '@insite/shared';
import { api } from '../../config/apiConfig';
import type { ApiEnvelope, ProjectSummaryDto } from '../types';

export const getProjects = async () => {
  const { data } = await api.get<ApiEnvelope<ProjectSummaryDto[]>>('/projects');
  return data.data;
};

/** Portfolio dashboard: a map point per visible live project plus KPIs (projects:view_portfolio). */
export const getPortfolioOverview = async (filters: ProjectListFilters = {}) => {
  const { data } = await api.get<ApiEnvelope<PortfolioOverviewDto>>('/projects/portfolio/overview', { params: filters });
  return data.data;
};

/** Redesign R6c (D-R6.18): the project Overview (stage bar, current sprint, next visit, next deadline, counts). */
export const getProjectOverview = async (projectId: string) => {
  const { data } = await api.get<ApiEnvelope<ProjectOverviewDto>>(`/projects/${projectId}/overview`);
  return data.data;
};
