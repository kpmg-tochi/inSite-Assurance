import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getStagedBacklogReports,
  getWbsChatMessages,
  promoteAndSyncBacklogReports,
  sendWbsChatMessage,
  submitConfirmedWorkdayReport,
  syncWbsInboxFromServer,
  type SubmitConfirmedWorkdayInput,
} from '../../storage/wbsRepository';

export const wbsQueryKeys = {
  inbox: (projectId?: string | null) => ['wbs-inbox', projectId] as const,
  messages: (wbsItemId?: string | null) => ['wbs-messages', wbsItemId] as const,
  stagedBacklog: ['staged-backlog'] as const,
};

export function useWbsInboxQuery(projectId?: string | null) {
  return useQuery({
    queryKey: wbsQueryKeys.inbox(projectId),
    queryFn: () => syncWbsInboxFromServer(projectId!),
    enabled: Boolean(projectId),
  });
}

export function useWbsChatMessagesQuery(wbsItemId?: string | null) {
  return useQuery({
    queryKey: wbsQueryKeys.messages(wbsItemId),
    queryFn: () => getWbsChatMessages(wbsItemId!),
    enabled: Boolean(wbsItemId),
  });
}

export function useSendWbsMessageMutation(wbsItemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: Parameters<typeof sendWbsChatMessage>[0]) =>
      sendWbsChatMessage(input),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: wbsQueryKeys.messages(wbsItemId),
      });
    },
  });
}

export function useStagedBacklogQuery() {
  return useQuery({
    queryKey: wbsQueryKeys.stagedBacklog,
    queryFn: getStagedBacklogReports,
  });
}

export function usePromoteBacklogMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reportIds: string[]) =>
      promoteAndSyncBacklogReports(reportIds, projectId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wbsQueryKeys.stagedBacklog });
      queryClient.invalidateQueries({ queryKey: wbsQueryKeys.inbox(projectId) });
    },
  });
}

export function useSubmitWorkdayReportMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SubmitConfirmedWorkdayInput) =>
      submitConfirmedWorkdayReport(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wbsQueryKeys.stagedBacklog });
      queryClient.invalidateQueries({ queryKey: wbsQueryKeys.inbox(projectId) });
    },
  });
}
