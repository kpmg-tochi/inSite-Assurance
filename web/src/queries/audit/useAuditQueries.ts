import { useQuery } from '@tanstack/react-query';
import { getProjectAuditTrail, getTenantAuditTrail } from '../../api/audit/auditApi';

export const useProjectAuditTrailQuery = (
  projectId: string | null | undefined,
  enabled = true
) => {
  return useQuery({
    queryKey: ['audit-trail', projectId],
    queryFn: () => getProjectAuditTrail(projectId!),
    enabled: Boolean(projectId) && enabled,
  });
};

export const useTenantAuditTrailQuery = (enabled: boolean) => {
  return useQuery({
    queryKey: ['audit-trail', 'tenant'],
    queryFn: () => getTenantAuditTrail(),
    enabled,
  });
};
