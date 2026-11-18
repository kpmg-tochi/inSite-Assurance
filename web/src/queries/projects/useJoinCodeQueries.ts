import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { IssueJoinCodeRequest, RotateJoinCodeRequest } from '@insite/shared';
import {
  getProjectJoinCodes,
  issueProjectJoinCode,
  rotateProjectJoinCode,
} from '../../api/projects/joinCodesApi';

const joinCodesKey = (projectId: string) => ['join-codes', projectId];

export const useProjectJoinCodesQuery = (projectId: string | undefined, enabled: boolean) =>
  useQuery({
    queryKey: joinCodesKey(projectId ?? ''),
    queryFn: () => getProjectJoinCodes(projectId!),
    enabled: Boolean(projectId) && enabled,
  });

export const useIssueJoinCodeMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: IssueJoinCodeRequest) => issueProjectJoinCode(projectId, payload),
    onSuccess: (code) => {
      queryClient.invalidateQueries({ queryKey: joinCodesKey(projectId) });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success(`Issued join code ${code.code} for ${code.roleName}.`);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to issue join code.');
    },
  });
};

export const useRotateJoinCodeMutation = (projectId: string) => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ joinCodeId, payload }: { joinCodeId: string; payload: RotateJoinCodeRequest }) =>
      rotateProjectJoinCode(projectId, joinCodeId, payload),
    onSuccess: (code) => {
      queryClient.invalidateQueries({ queryKey: joinCodesKey(projectId) });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      toast.success(`Rotated: new code ${code.code}. The old code no longer works.`);
    },
    onError: (err: unknown) => {
      toast.error(err instanceof Error ? err.message : 'Failed to rotate join code.');
    },
  });
};
