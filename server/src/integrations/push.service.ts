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

/**
 * Mobile push tokens of a provisioned account, excluding devices that have been revoked. Web
 * tokens (platform WEB) are never used for mobile notifications.
 */
function mobileTokensOfUserWhere(userId: string) {
  return {
    userId,
    devicePlatform: { not: 'WEB' },
    OR: [{ mobileDeviceId: null }, { mobileDevice: { revokedAt: null } }],
  };
}

/**
 * Sends to the devices of one field session. A provisioned session (Phase 5) has no tokens of its
 * own: its user's mobile tokens are used, and the app routes the tap by `projectId`.
 */
export async function sendPushToFieldSession(sessionId: string, message: PushMessage): Promise<number> {
  if (env.PUSH_PROVIDER !== 'expo') return 0;
  const session = await prisma.fieldAgentSession.findUnique({
    where: { id: sessionId },
    select: { userId: true, projectId: true },
  });
  if (!session) return 0;
  const tokens = await prisma.pushToken.findMany({
    where: session.userId
      ? { OR: [{ sessionId }, mobileTokensOfUserWhere(session.userId)] }
      : { sessionId },
    select: { deviceToken: true },
  });
  return deliver(
    tokens.map((t) => t.deviceToken),
    { ...message, data: { projectId: session.projectId, ...message.data } }
  );
}

/** Sends to every registered mobile device of a provisioned account (not tied to one project). */
export async function sendPushToMobileUser(userId: string, message: PushMessage): Promise<number> {
  if (env.PUSH_PROVIDER !== 'expo') return 0;
  const tokens = await prisma.pushToken.findMany({
    where: mobileTokensOfUserWhere(userId),
    select: { deviceToken: true },
  });
  return deliver(tokens.map((t) => t.deviceToken), message);
}

async function deliver(deviceTokens: string[], message: PushMessage): Promise<number> {
  const to = [...new Set(deviceTokens)].filter(isExpoToken);
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
