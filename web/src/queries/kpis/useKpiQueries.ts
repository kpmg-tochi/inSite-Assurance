import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { KpiQuery } from '@insite/shared';
import { getKpiDashboard, getProjectKpis } from '../../api/kpis/kpisApi';

/** Phase 16 query keys. */
export const kpiDashboardKey = (query: Partial<KpiQuery>) => ['kpi-dashboard', query] as const;
export const projectKpisKey = (projectId: string | null | undefined) => ['project-kpis', projectId] as const;

export const useKpiDashboardQuery = (query: Partial<KpiQuery>) =>
  useQuery({ queryKey: kpiDashboardKey(query), queryFn: () => getKpiDashboard(query), placeholderData: keepPreviousData });

export const useProjectKpisQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({ queryKey: projectKpisKey(projectId), queryFn: () => getProjectKpis(projectId!), enabled: Boolean(projectId) && enabled });
