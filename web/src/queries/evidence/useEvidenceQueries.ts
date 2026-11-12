import { useQuery } from '@tanstack/react-query';
import { getProjectEvidence } from '../../api/evidence/evidenceApi';

export const useProjectEvidenceQuery = (
  projectId: string | null | undefined,
  enabled = true
) => {
  return useQuery({
    queryKey: ['evidence', projectId],
    queryFn: () => getProjectEvidence(projectId!),
    enabled: Boolean(projectId) && enabled,
  });
};

