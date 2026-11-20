import type { ProjectListFilters } from '@insite/shared';
import { useQuery } from '@tanstack/react-query';
import {
  getPortfolioExecutiveSummary,
  getPortfolioOverview,
  getProjectContractorVerifications,
} from '../../api/projects/contractorVerificationApi';

export const useContractorVerificationsQuery = (
  projectId: string | null | undefined,
  enabled = true
) => {
  return useQuery({
    queryKey: ['contractor-verifications', projectId],
    queryFn: () => getProjectContractorVerifications(projectId!),
    enabled: Boolean(projectId) && enabled,
  });
};

export const usePortfolioExecutiveQuery = (filters: ProjectListFilters = {}, enabled = true) => {
  return useQuery({
    queryKey: ['portfolio-executive-summary', filters],
    queryFn: () => getPortfolioExecutiveSummary(filters),
    enabled,
    refetchInterval: 30000,
  });
};


export const usePortfolioOverviewQuery = (filters: ProjectListFilters = {}, enabled = true) =>
  useQuery({
    queryKey: ['portfolio-overview', filters],
    queryFn: () => getPortfolioOverview(filters),
    enabled,
    refetchInterval: 60_000,
  });
