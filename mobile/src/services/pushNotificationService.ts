import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { registerPushToken } from '../api/auth/authApi';

/**
 * Push notifications (Phase 4 Step 6).
 *
 * - Permission is asked in context (after joining a project, after submitting identity), never at
 *   app launch. On launch the token is registered only if permission was already granted.
 * - Android uses one channel, "default", which the server targets (`channelId: 'default'`).
 * - The Expo push token needs the EAS project ID (`extra.eas.projectId`, set from EAS_PROJECT_ID).
 */

export const ANDROID_CHANNEL_ID = 'default';

try {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
} catch (err) {
  console.warn('Notifications.setNotificationHandler warning:', err);
}

function easProjectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

function appVersion(): string {
  return Constants.expoConfig?.version ?? 'unknown';
}

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL_ID, {
    name: 'Project updates',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#00338D',
  });
}

async function isGranted(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  return current.granted;
}

async function registerToken(sessionToken: string): Promise<string | null> {
  const projectId = easProjectId();
  if (!projectId) {
    console.warn('[push] EAS project ID is not configured; push is disabled in this build.');
    return null;
  }
  await ensureAndroidChannel();
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await registerPushToken(
    {
      deviceToken: token,
      devicePlatform: Platform.OS === 'ios' ? 'IOS' : 'ANDROID',
      appVersion: appVersion(),
    },
    sessionToken
  );
  return token;
}

/** Registers the token if the user already allowed notifications. Never shows a prompt. */
export async function registerPushIfPermitted(sessionToken?: string | null): Promise<string | null> {
  if (Platform.OS === 'web' || !sessionToken) return null;
  try {
    if (!(await isGranted())) return null;
    return await registerToken(sessionToken);
  } catch (err) {
    console.warn('[push] registration skipped:', err);
    return null;
  }
}

/**
 * Asks for permission at a moment where the reason is obvious (for example "we will tell you when
 * your identity is approved"), then registers the token.
 */
export async function requestPushPermissionInContext(sessionToken?: string | null): Promise<boolean> {
  if (Platform.OS === 'web' || !sessionToken) return false;
  try {
    await ensureAndroidChannel();
    let granted = await isGranted();
    if (!granted) {
      const requested = await Notifications.requestPermissionsAsync();
      granted = requested.granted;
    }
    if (granted) await registerToken(sessionToken);
    return granted;
  } catch (err) {
    console.warn('[push] permission request failed:', err);
    return false;
  }
}
