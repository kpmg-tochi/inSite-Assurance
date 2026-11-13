import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { API_BASE_URL } from "../config/apiConfig";

// Configure foreground notification behavior
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export interface InAppNotificationItem {
  id: string;
  type:
    | "ASSURANCE_APPROVED"
    | "ASSURANCE_REJECTED"
    | "MONITOR_QUERY"
    | "HOLD_POINT_ALERT";
  title: string;
  message: string;
  actionPayload?: Record<string, any>;
  isRead: boolean;
  createdAt: string;
}

let memNotifications: InAppNotificationItem[] = [
  {
    id: "notif-01",
    type: "ASSURANCE_APPROVED",
    title: "Identity Assurance Approved",
    message:
      "Independent Monitor verified your NIN & COREN registration. 3 queued field reports are ready for review and confirmation.",
    actionPayload: { openBacklogModal: true },
    isRead: false,
    createdAt: "10 mins ago",
  },
  {
    id: "notif-02",
    type: "MONITOR_QUERY",
    title: "Monitor Query Raised",
    message:
      "QS Monitor requested clarifying photo for WBS 03.01.2 invert levels at Ch 12+800.",
    actionPayload: { targetWbsItemId: "wbs-03" },
    isRead: false,
    createdAt: "2 hours ago",
  },
];

/**
 * Register for Push Notifications and transmit the Expo push token to InSite server.
 */
export async function registerForPushNotifications(
  sessionToken?: string,
): Promise<string | null> {
  if (Platform.OS === "web") {
    return "EXPO-PUSH-TOKEN-WEB-SIMULATION";
  }

  try {
    const permissions = await Notifications.getPermissionsAsync();
    let isGranted = Boolean(
      (permissions as any).granted || (permissions as any).status === "granted",
    );

    if (!isGranted) {
      const requested = await Notifications.requestPermissionsAsync();
      isGranted = Boolean(
        (requested as any).granted || (requested as any).status === "granted",
      );
    }

    if (!isGranted) {
      console.warn("Push notification permission denied by user.");
      return null;
    }

    const tokenData = await Notifications.getExpoPushTokenAsync();
    const pushToken = tokenData.data;

    // Transmit push token to backend API if session is authenticated
    if (sessionToken && pushToken) {
      try {
        await fetch(`${API_BASE_URL}/auth/push-token`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${sessionToken}`,
          },
          body: JSON.stringify({
            deviceToken: pushToken,
            devicePlatform: Platform.OS.toUpperCase(),
            appVersion: "2.0.0-expo58",
          }),
        });
      } catch (err) {
        console.warn("Failed to sync push token with backend:", err);
      }
    }

    return pushToken;
  } catch (error) {
    console.warn("Error obtaining push token:", error);
    return null;
  }
}

export function getInAppNotifications(): InAppNotificationItem[] {
  return [...memNotifications];
}

export function markNotificationAsRead(id: string): void {
  const notif = memNotifications.find((n) => n.id === id);
  if (notif) {
    notif.isRead = true;
  }
}

export function getUnreadNotificationCount(): number {
  return memNotifications.filter((n) => !n.isRead).length;
}
