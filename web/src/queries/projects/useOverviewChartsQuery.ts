import { useQuery } from '@tanstack/react-query';
import { getProjectOverviewCharts } from '../../api/overviewCharts';

/**
 * Under the Overview's key (['projects', id, 'overview', …]), so every write that refreshes the
 * Overview or ['projects'] refreshes the charts too. Live projects only (drafts have no charts).
 */
export const projectOverviewChartsKey = (projectId: string | null | undefined) => ['projects', projectId, 'overview', 'charts'] as const;

export const useOverviewChartsQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: projectOverviewChartsKey(projectId),
    queryFn: () => getProjectOverviewCharts(projectId!),
    enabled: Boolean(projectId) && enabled,
    staleTime: 30 * 1000,
  });
