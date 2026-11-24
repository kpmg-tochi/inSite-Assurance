import type { MobileNotificationDto } from "@insite/shared";
import { mobileRequest } from "../../config/apiConfig";

/** One project's notifications for this account (the request runs on that project's field session). */
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
