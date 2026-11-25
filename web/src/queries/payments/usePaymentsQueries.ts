import { keepPreviousData, useQuery } from '@tanstack/react-query';
import type { PortfolioPaymentsQuery, ProjectPaymentsQuery } from '@insite/shared';
import { getPortfolioPaymentsSummary, getProjectPayments, listPortfolioPayments } from '../../api/payments/paymentsApi';

/** The project's payments; the filters (G.1) are the key's last part, so invalidating the prefix refreshes every view. */
export const projectPaymentsKey = (projectId: string | null | undefined) => ['project-payments', projectId] as const;

export const useProjectPaymentsQuery = (projectId: string | null | undefined, enabled = true, query: ProjectPaymentsQuery = {}) =>
  useQuery({
    queryKey: [...projectPaymentsKey(projectId), query],
    queryFn: () => getProjectPayments(projectId!, query),
    enabled: Boolean(projectId) && enabled,
    placeholderData: keepPreviousData,
  });

/** Client demo updates G.2: the portfolio Payments tab. */
export const portfolioPaymentsKey = ['portfolio-payments'] as const;

export const usePortfolioPaymentsQuery = (query: Partial<PortfolioPaymentsQuery>, enabled = true) =>
  useQuery({
    queryKey: [...portfolioPaymentsKey, 'list', query],
    queryFn: () => listPortfolioPayments(query),
    enabled,
    placeholderData: keepPreviousData,
  });

export const usePortfolioPaymentsSummaryQuery = (query: Partial<PortfolioPaymentsQuery>, enabled = true) =>
  useQuery({
    queryKey: [...portfolioPaymentsKey, 'summary', query],
    queryFn: () => getPortfolioPaymentsSummary(query),
    enabled,
    placeholderData: keepPreviousData,
  });
