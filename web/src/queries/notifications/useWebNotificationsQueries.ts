import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WebNotificationDto } from "@insite/shared";
import {
  getWebNotifications,
  markAllWebNotificationsAsRead,
  markWebNotificationAsRead,
} from "../../api/notifications/notificationsApi";

export const webNotificationKeys = {
  list: (projectId: string | undefined) => ["web-notifications", projectId] as const,
};

export function useWebNotificationsQuery(
  projectId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: webNotificationKeys.list(projectId),
    queryFn: () => getWebNotifications(projectId!),
    enabled: Boolean(projectId && enabled),
    refetchInterval: 30_000,
  });
}

export function useMarkWebNotificationReadMutation(
  projectId: string | undefined,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) =>
      markWebNotificationAsRead(projectId!, notificationId),
    onSuccess: (updated) => {
      if (!projectId) return;
      queryClient.setQueryData<WebNotificationDto[]>(
        webNotificationKeys.list(projectId),
        (prev) =>
          prev ? prev.map((n) => (n.id === updated.id ? updated : n)) : [updated],
      );
    },
  });
}

export function useMarkAllWebNotificationsReadMutation(
  projectId: string | undefined,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => markAllWebNotificationsAsRead(projectId!),
    onSuccess: () => {
      if (!projectId) return;
      queryClient.setQueryData<WebNotificationDto[]>(
        webNotificationKeys.list(projectId),
        (prev) =>
          prev
            ? prev.map((n) => ({
                ...n,
                isRead: true,
                readAt: n.readAt || new Date().toISOString(),
              }))
            : [],
      );
    },
  });
}
