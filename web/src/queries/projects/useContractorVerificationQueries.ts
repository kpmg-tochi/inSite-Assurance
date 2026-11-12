import { useQuery } from '@tanstack/react-query';
import {
  getPortfolioExecutiveSummary,
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

export const usePortfolioExecutiveQuery = (enabled = true) => {
  return useQuery({
    queryKey: ['portfolio-executive-summary'],
    queryFn: getPortfolioExecutiveSummary,
    enabled,
    refetchInterval: 30000,
  });
};

