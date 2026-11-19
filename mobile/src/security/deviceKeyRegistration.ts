import * as SecureStore from 'expo-secure-store';
import { registerDeviceKey } from '../api/auth/authApi';

/**
 * Join-code sessions created before Phase 4 joined without a signing key. Registers it once per
 * session. The server never replaces a key, so a different key on the same session is refused (409)
 * and signatures from this device are then reported as unverifiable rather than accepted.
 * Provisioned accounts register their key at sign-in and never come here.
 */
const flagKey = (sessionId: string) => `insite.deviceKeyRegistered.${sessionId}`;

export async function ensureDeviceKeyRegistered(session: {
  sessionId: string | null;
  projectId: string;
  token: string;
}): Promise<void> {
  const { sessionId } = session;
  if (!sessionId) return;
  if (await SecureStore.getItemAsync(flagKey(sessionId))) return;
  try {
    await registerDeviceKey(session.token, `project:${session.projectId}`);
    await SecureStore.setItemAsync(flagKey(sessionId), '1');
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === 'DEVICE_KEY_ALREADY_REGISTERED') {
      await SecureStore.setItemAsync(flagKey(sessionId), 'conflict');
      console.warn('[device-key] a different key is registered for this session; signatures will not verify');
    }
    // Otherwise (offline) try again next start.
  }
}
