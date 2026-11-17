import type { MobileNotificationDto } from "@insite/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchProjectNotifications,
  markNotificationAsRead,
  resolveActionNotification,
} from "../../api/notifications/notificationsApi";

export const notificationQueryKeys = {
  all: ["notifications"] as const,
  list: (projectId?: string | null) =>
    ["notifications", projectId] as const,
};

/**
 * Sorts notifications unread-first, then newest-first by UTC createdAt timestamp.
 */
export function sortNotificationsByPriority(
  items: MobileNotificationDto[],
): MobileNotificationDto[] {
  return [...items].sort((a, b) => {
    if (a.isRead !== b.isRead) {
      return a.isRead ? 1 : -1;
    }
    const timeA = Date.parse(a.createdAt) || 0;
    const timeB = Date.parse(b.createdAt) || 0;
    return timeB - timeA;
  });
}

export function useNotificationsQuery(
  projectId?: string | null,
  enabled = true,
) {
  return useQuery({
    queryKey: notificationQueryKeys.list(projectId),
    queryFn: async () => {
      const list = await fetchProjectNotifications(projectId!);
      return sortNotificationsByPriority(list);
    },
    enabled: Boolean(projectId) && enabled,
  });
}

function updateCachedNotification(
  queryClient: ReturnType<typeof useQueryClient>,
  projectId: string,
  updated: MobileNotificationDto,
) {
  queryClient.setQueryData<MobileNotificationDto[]>(
    notificationQueryKeys.list(projectId),
    (prev) => {
      if (!prev) return [updated];
      const mapped = prev.map((item) =>
        item.id === updated.id ? updated : item,
      );
      return sortNotificationsByPriority(mapped);
    },
  );
}

export function useMarkNotificationReadMutation(projectId?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) =>
      markNotificationAsRead(projectId!, notificationId),
    onSuccess: (updated) => {
      if (!projectId) return;
      updateCachedNotification(queryClient, projectId, updated);
    },
  });
}

export function useResolveNotificationMutation(projectId?: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (notificationId: string) =>
      resolveActionNotification(projectId!, notificationId),
    onSuccess: (updated) => {
      if (!projectId) return;
      updateCachedNotification(queryClient, projectId, updated);
    },
  });
}
