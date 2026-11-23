import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { BriefPersona } from '@insite/shared';
import { generateMorningBrief } from '../../api/briefs/briefsApi';
import { morningBriefsKey } from '../../queries/briefs/useBriefQueries';

export const useGenerateMorningBriefMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (args: { boqItemId: string; persona: BriefPersona }) =>
      generateMorningBrief(projectId, args.boqItemId, args.persona),
    onSuccess: (brief) => {
      queryClient.invalidateQueries({ queryKey: morningBriefsKey(projectId, brief.targetPersona) });
    },
    onError: (err) => toast.error((err as { message?: string })?.message || 'Could not prepare the brief.'),
  });
};
