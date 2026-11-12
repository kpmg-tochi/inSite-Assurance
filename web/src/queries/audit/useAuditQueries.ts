import { useQuery } from '@tanstack/react-query';
import { getProjectAuditTrail } from '../../api/audit/auditApi';

export const useProjectAuditTrailQuery = (
  projectId: string | null | undefined
) => {
  return useQuery({
    queryKey: ['audit-trail', projectId],
    queryFn: () => getProjectAuditTrail(projectId!),
    enabled: Boolean(projectId),
  });
};

