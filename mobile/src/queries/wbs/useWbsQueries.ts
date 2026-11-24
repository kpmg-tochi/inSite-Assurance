import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  sendWbsChatMessage,
  syncWbsChatMessagesFromServer,
  syncWbsInboxFromServer,
  type SendChatMessageInput,
} from '../../storage/wbsRepository';
import {
  confirmReport,
  currentPeriod,
  getItemReportStatus,
  listPendingOrStagedReports,
  refreshReportStatuses,
  type ConfirmReportInput,
} from '../../storage/reportStore';
import { listDeadRows } from '../../storage/outbox/outboxStore';
import {
  getSyncStatusSnapshot,
  retryOutboxItem,
  subscribeToSyncStatus,
  type SyncStatusSnapshot,
} from '../../storage/outbox/outboxProcessor';
import { notificationQueryKeys } from '../notifications/useNotificationQueries';

export const wbsQueryKeys = {
  inbox: (projectId?: string | null) => ['wbs-inbox', projectId] as const,
  messages: (wbsItemId?: string | null) => ['wbs-messages', wbsItemId] as const,
  pendingReports: (projectId?: string | null) => ['pending-reports', projectId] as const,
  itemReport: (projectId: string | null | undefined, wbsItemId: string) =>
    ['item-report', projectId, wbsItemId] as const,
  deadLetters: ['outbox-dead-letters'] as const,
};

export function useWbsInboxQuery(projectId?: string | null) {
  return useQuery({
    queryKey: wbsQueryKeys.inbox(projectId),
    queryFn: () => syncWbsInboxFromServer(projectId!),
    enabled: Boolean(projectId),
  });
}

export function useWbsChatMessagesQuery(wbsItemId?: string | null, projectId?: string | null) {
  return useQuery({
    queryKey: wbsQueryKeys.messages(wbsItemId),
    queryFn: () => syncWbsChatMessagesFromServer(projectId, wbsItemId!),
    enabled: Boolean(wbsItemId),
  });
}

export function useSendWbsMessageMutation(wbsItemId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: SendChatMessageInput) => sendWbsChatMessage(input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: wbsQueryKeys.messages(wbsItemId) });
    },
  });
}

/** Reports still on the device, waiting on the report approval chain or returned. Read-only. */
export function usePendingReportsQuery(projectId?: string | null) {
  return useQuery({
    queryKey: wbsQueryKeys.pendingReports(projectId),
    queryFn: async () => {
      await refreshReportStatuses(projectId!).catch(() => undefined);
      return listPendingOrStagedReports(projectId!);
    },
    enabled: Boolean(projectId),
  });
}

/**
 * The status of this period's report for one WBS item, refreshed from the server when online.
 * Includes reports from another device of the same account. Null when there is none.
 */
export function useItemReportStatusQuery(projectId: string | null | undefined, wbsItemId: string) {
  return useQuery({
    queryKey: wbsQueryKeys.itemReport(projectId, wbsItemId),
    queryFn: async () => {
      await refreshReportStatuses(projectId!).catch(() => undefined);
      return getItemReportStatus(projectId!, wbsItemId, currentPeriod(new Date(), projectId));
    },
    enabled: Boolean(projectId),
  });
}

export function useDeadLettersQuery() {
  return useQuery({ queryKey: wbsQueryKeys.deadLetters, queryFn: listDeadRows });
}

export function useRetryOutboxItemMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => retryOutboxItem(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: wbsQueryKeys.deadLetters }),
  });
}

/** Live outbox status (pending count, last error, paused reason, storage encryption). */
export function useSyncStatus(): SyncStatusSnapshot {
  const [status, setStatus] = useState<SyncStatusSnapshot>(getSyncStatusSnapshot());
  useEffect(() => subscribeToSyncStatus(setStatus), []);
  return status;
}

export function useSubmitWorkdayReportMutation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ConfirmReportInput) => confirmReport(input),
    onSuccess: (_result, variables) => {
      queryClient.invalidateQueries({ queryKey: wbsQueryKeys.pendingReports(projectId) });
      queryClient.invalidateQueries({ queryKey: wbsQueryKeys.inbox(projectId) });
      queryClient.invalidateQueries({ queryKey: wbsQueryKeys.messages(variables.wbsItemId) });
      queryClient.invalidateQueries({ queryKey: wbsQueryKeys.itemReport(projectId, variables.wbsItemId) });
      queryClient.invalidateQueries({ queryKey: notificationQueryKeys.list(projectId) });
    },
  });
}
