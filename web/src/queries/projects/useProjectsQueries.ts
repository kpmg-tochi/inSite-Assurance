import type { ProjectListFilters } from '@insite/shared';
import { useQuery } from '@tanstack/react-query';
import {
  getProjects,
  getPortfolioOverview,
  getProjectOverview,
} from '../../api/projects/projectsApi';

export const useProjectsQuery = (enabled = true) => {
  return useQuery({
    queryKey: ['projects'],
    queryFn: getProjects,
    enabled,
  });
};

export const usePortfolioOverviewQuery = (filters: ProjectListFilters = {}, enabled = true) =>
  useQuery({
    queryKey: ['portfolio-overview', filters],
    queryFn: () => getPortfolioOverview(filters),
    enabled,
    refetchInterval: 60_000,
  });

/** Under ['projects', …] so phase changes and other project writes that invalidate ['projects'] refresh it. */
export const projectOverviewKey = (projectId: string | null | undefined) => ['projects', projectId, 'overview'] as const;

export const useProjectOverviewQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: projectOverviewKey(projectId),
    queryFn: () => getProjectOverview(projectId!),
    enabled: Boolean(projectId) && enabled,
    staleTime: 30 * 1000,
  });
