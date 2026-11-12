import { useQuery } from '@tanstack/react-query';
import { getProjectBoq } from '../../api/boq/boqApi';

export const useProjectBoqQuery = (
  projectId: string | null | undefined,
  enabled = true
) => {
  return useQuery({
    queryKey: ['boq', projectId],
    queryFn: () => getProjectBoq(projectId!),
    enabled: Boolean(projectId) && enabled,
  });
};

