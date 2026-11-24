import type { ProjectListFilters } from '@insite/shared';
import { useQuery } from '@tanstack/react-query';
import {
  getProjectBaseline,
  getProjects,
  getPortfolioOverview,
} from '../../api/projects/projectsApi';

export const useProjectsQuery = (enabled = true) => {
  return useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
    enabled,
  });
};

export const useProjectBaselineQuery = (projectId: string | null) => {
  return useQuery({
    queryKey: ['project-baseline', projectId],
    queryFn: () => getProjectBaseline(projectId!),
    enabled: Boolean(projectId),
  });
};


export const usePortfolioOverviewQuery = (filters: ProjectListFilters = {}, enabled = true) =>
  useQuery({
    queryKey: ['portfolio-overview', filters],
    queryFn: () => getPortfolioOverview(filters),
    enabled,
    refetchInterval: 60_000,
  });
