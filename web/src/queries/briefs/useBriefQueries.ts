import { useQuery } from '@tanstack/react-query';
import type { BriefPersona } from '@insite/shared';
import { listMorningBriefs } from '../../api/briefs/briefsApi';

export const morningBriefsKey = (projectId: string | null | undefined, persona: BriefPersona) =>
  ['morning-briefs', projectId, persona] as const;

export const useMorningBriefsQuery = (projectId: string | null | undefined, persona: BriefPersona, enabled = true) =>
  useQuery({
    queryKey: morningBriefsKey(projectId, persona),
    queryFn: () => listMorningBriefs(projectId!, persona),
    enabled: Boolean(projectId) && enabled,
    staleTime: 60 * 1000,
  });
