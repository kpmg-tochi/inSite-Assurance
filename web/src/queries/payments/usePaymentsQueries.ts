import { useQuery } from '@tanstack/react-query';
import { getProjectPayments } from '../../api/payments/paymentsApi';

export const projectPaymentsKey = (projectId: string | null | undefined) => ['project-payments', projectId] as const;

export const useProjectPaymentsQuery = (projectId: string | null | undefined, enabled = true) =>
  useQuery({
    queryKey: projectPaymentsKey(projectId),
    queryFn: () => getProjectPayments(projectId!),
    enabled: Boolean(projectId) && enabled,
  });
