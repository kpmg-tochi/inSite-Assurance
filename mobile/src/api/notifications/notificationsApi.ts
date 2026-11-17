import type { MobileNotificationDto } from "@insite/shared";
import { mobileRequest } from "../../config/apiConfig";

export async function fetchProjectNotifications(
  projectId: string,
): Promise<MobileNotificationDto[]> {
  return mobileRequest<MobileNotificationDto[]>(
    `/projects/${projectId}/notifications`,
    {
      method: "GET",
    },
  );
}

export async function markNotificationAsRead(
  projectId: string,
  notificationId: string,
): Promise<MobileNotificationDto> {
  return mobileRequest<MobileNotificationDto>(
    `/projects/${projectId}/notifications/${notificationId}/read`,
    {
      method: "PATCH",
    },
  );
}

export async function resolveActionNotification(
  projectId: string,
  notificationId: string,
): Promise<MobileNotificationDto> {
  return mobileRequest<MobileNotificationDto>(
    `/projects/${projectId}/notifications/${notificationId}/resolve`,
    {
      method: "POST",
    },
  );
}
