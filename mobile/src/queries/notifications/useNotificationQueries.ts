import type { MobileNotificationDto } from "@insite/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchProjectNotifications,
  markNotificationAsRead,
} from "../../api/notifications/notificationsApi";

/**
 * Redesign R5e: the notification centre lists every project of the account. The server lists
 * notifications per project (each request runs on that project's field session), so the app asks
 * every project and merges the lists; a project that fails does not hide the others.
 */
export const notificationQueryKeys = {
  all: ["notifications"] as const,
  account: (projectIds: string[]) =>
    ["notifications", "account", [...projectIds].sort().join(",")] as const,
};

export interface AccountNotifications {
  items: MobileNotificationDto[];
  /** Projects whose notifications could not be read (offline, access removed). */
  failedProjectIds: string[];
}

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

export function useAccountNotificationsQuery(
  projectIds: string[],
  enabled = true,
) {
  return useQuery({
    queryKey: notificationQueryKeys.account(projectIds),
    queryFn: async (): Promise<AccountNotifications> => {
      const results = await Promise.allSettled(
        projectIds.map((id) => fetchProjectNotifications(id)),
      );
      const items: MobileNotificationDto[] = [];
      const failedProjectIds: string[] = [];
      results.forEach((r, i) => {
        if (r.status === "fulfilled") items.push(...r.value);
        else failedProjectIds.push(projectIds[i]);
      });
      // Nothing could be read at all: show the error rather than an empty list.
      const firstFailure = results.find((r) => r.status === "rejected");
      if (projectIds.length > 0 && failedProjectIds.length === projectIds.length && firstFailure) {
        throw (firstFailure as PromiseRejectedResult).reason;
      }
      return { items: sortNotificationsByPriority(items), failedProjectIds };
    },
    enabled: projectIds.length > 0 && enabled,
  });
}

export function useMarkNotificationReadMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (n: Pick<MobileNotificationDto, "id" | "projectId">) =>
      markNotificationAsRead(n.projectId, n.id),
    onSuccess: (updated) => {
      queryClient.setQueriesData<AccountNotifications>(
        { queryKey: notificationQueryKeys.all },
        (prev) =>
          prev
            ? {
                ...prev,
                items: sortNotificationsByPriority(
                  prev.items.map((item) => (item.id === updated.id ? updated : item)),
                ),
              }
            : prev,
      );
    },
  });
}
