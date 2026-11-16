import { useEffect } from 'react';
import { registerForPushNotifications } from '../services/pushNotificationService';

/**
 * Registers the device for Expo push notifications and links the token
 * to the active field session when available.
 */
export function usePushNotifications(sessionToken?: string | null): void {
  useEffect(() => {
    let active = true;

    async function register() {
      try {
        if (!active) return;
        await registerForPushNotifications(sessionToken || undefined);
      } catch (err) {
        console.warn('[usePushNotifications] Registration skipped:', err);
      }
    }

    register();
    return () => {
      active = false;
    };
  }, [sessionToken]);
}

