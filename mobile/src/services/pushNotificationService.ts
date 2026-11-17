import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { registerPushToken } from "../api/auth/authApi";

// Configure foreground notification behavior safely (surviving Expo Go push limitations)
try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
    }),
  });
} catch (err) {
  console.warn("Notifications.setNotificationHandler warning:", err);
}

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
        const devicePlatform =
          Platform.OS === "ios"
            ? "IOS"
            : Platform.OS === "android"
            ? "ANDROID"
            : "WEB";
        await registerPushToken(
          {
            deviceToken: pushToken,
            devicePlatform,
            appVersion: "2.0.0-expo58",
          },
          sessionToken,
        );
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

