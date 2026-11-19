import { env } from '../config/env';
import { prisma } from '../config/prisma';

/**
 * Push delivery through the Expo push service. Called after the transaction that created the
 * in-app notification has committed; a push failure never rolls back or fails the request.
 * With PUSH_PROVIDER=none (tests, or by choice) nothing is sent.
 */

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushMessage {
  title: string;
  body: string;
  /** Routed by the app's tap handler; `actionType` matches NotificationActionType. */
  data: Record<string, unknown> & { actionType: string };
}

function isExpoToken(token: string): boolean {
  return /^(Expo|Exponent)PushToken\[.+\]$/.test(token);
}

export async function sendPushToFieldSession(sessionId: string, message: PushMessage): Promise<number> {
  if (env.PUSH_PROVIDER !== 'expo') return 0;
  const tokens = await prisma.pushToken.findMany({
    where: { sessionId },
    select: { deviceToken: true },
  });
  const to = tokens.map((t) => t.deviceToken).filter(isExpoToken);
  if (to.length === 0) return 0;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(EXPO_PUSH_URL, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        ...(env.EXPO_ACCESS_TOKEN ? { Authorization: `Bearer ${env.EXPO_ACCESS_TOKEN}` } : {}),
      },
      body: JSON.stringify(
        to.map((token) => ({
          to: token,
          title: message.title,
          body: message.body,
          data: message.data,
          sound: 'default',
          channelId: 'default',
        }))
      ),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn('[push] Expo push request failed', res.status);
      return 0;
    }
    return to.length;
  } catch (error) {
    console.warn('[push] Expo push request error', error);
    return 0;
  } finally {
    clearTimeout(timer);
  }
}
