import type { WebNotificationDto } from "@insite/shared";
import { api } from "../../config/apiConfig";
import type { ApiEnvelope } from "../types";

export const getWebNotifications = async (
  projectId: string,
): Promise<WebNotificationDto[]> => {
  const { data } = await api.get<ApiEnvelope<WebNotificationDto[]>>(
    `/projects/${projectId}/web-notifications`,
  );
  return data.data;
};

export const markWebNotificationAsRead = async (
  projectId: string,
  notificationId: string,
): Promise<WebNotificationDto> => {
  const { data } = await api.patch<ApiEnvelope<WebNotificationDto>>(
    `/projects/${projectId}/web-notifications/${notificationId}/read`,
  );
  return data.data;
};

export const markAllWebNotificationsAsRead = async (
  projectId: string,
): Promise<{ count: number }> => {
  const { data } = await api.post<ApiEnvelope<{ count: number }>>(
    `/projects/${projectId}/web-notifications/read-all`,
  );
  return data.data;
};
