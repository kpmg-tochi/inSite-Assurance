import { useEffect } from 'react';
import * as Notifications from 'expo-notifications';
import { registerPushIfPermitted } from '../services/pushNotificationService';
import { rootNavigationRef } from '../components/common/SessionEndedOverlay';
import { useProfile } from '../context/ProfileContext';
import { getWbsThreads } from '../storage/wbsRepository';

type PushData = {
  actionType?: string;
  assuranceStatus?: string;
  wbsItemId?: string;
};

/** Opens the screen a notification points at (`actionType` matches NotificationActionType). */
async function routeFor(data: PushData, projectId: string | null): Promise<void> {
  if (!rootNavigationRef.isReady()) return;
  switch (data.actionType) {
    case 'OPEN_ASSURANCE_WIZARD':
      rootNavigationRef.navigate('AssuranceWizard');
      return;
    case 'OPEN_REPORT_SUMMARY':
    case 'OPEN_BACKLOG_REVIEW':
      rootNavigationRef.navigate('BacklogModal');
      return;
    case 'OPEN_WBS_CHAT': {
      if (projectId && data.wbsItemId) {
        const thread = (await getWbsThreads(projectId).catch(() => [])).find((t) => t.id === data.wbsItemId);
        if (thread) {
          rootNavigationRef.navigate('WbsThread', { wbsItem: thread });
          return;
        }
      }
      rootNavigationRef.navigate('NotificationsModal');
      return;
    }
    default:
      rootNavigationRef.navigate('NotificationsModal');
  }
}

/**
 * Registers the push token when permission was already granted (no prompt at launch), refreshes
 * assurance status when a push arrives, and routes taps by `actionType`.
 */
export function usePushNotifications(sessionToken?: string | null): void {
  const { refreshAssuranceStatus, activeProjectId } = useProfile();

  useEffect(() => {
    void registerPushIfPermitted(sessionToken);
  }, [sessionToken]);

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener((n) => {
      const data = (n.request.content.data ?? {}) as PushData;
      if (data.assuranceStatus) void refreshAssuranceStatus();
    });
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data ?? {}) as PushData;
      void (async () => {
        if (data.assuranceStatus) await refreshAssuranceStatus();
        await routeFor(data, activeProjectId || null);
      })();
    });
    return () => {
      received.remove();
      tapped.remove();
    };
  }, [refreshAssuranceStatus, activeProjectId]);
}
