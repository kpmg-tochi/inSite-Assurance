import { useQuery } from '@tanstack/react-query';
import { getCostingStandardVersion, getStandardsOverview } from '../../api/needsStandards';

/** Needs pipeline wave 2 (N2): the Standards page. */
export const standardsKey = ['standards'] as const;
export const standardsOverviewKey = ['standards', 'overview'] as const;
export const costingStandardVersionKey = (versionId: string | null | undefined) => ['standards', 'costing', versionId] as const;

export const useStandardsOverviewQuery = () =>
  useQuery({ queryKey: standardsOverviewKey, queryFn: getStandardsOverview, staleTime: 60 * 1000, retry: 1 });

/** One costing standard version (an earlier one, picked from the versions list). */
export const useCostingStandardVersionQuery = (versionId: string | null | undefined) =>
  useQuery({
    queryKey: costingStandardVersionKey(versionId),
    queryFn: () => getCostingStandardVersion(versionId!),
    enabled: Boolean(versionId),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });
