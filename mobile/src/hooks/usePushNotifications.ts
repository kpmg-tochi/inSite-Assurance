import { useEffect, useMemo, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { registerPushIfPermitted, type PushIdentity } from '../services/pushNotificationService';
import { rootNavigationRef } from '../components/common/SessionEndedOverlay';
import { useProfile } from '../context/ProfileContext';
import { getWbsThreads } from '../storage/wbsRepository';

type PushData = {
  actionType?: string;
  assuranceStatus?: string;
  wbsItemId?: string;
  /** Set by the server on every project notification (Phase 5). */
  projectId?: string;
};

/** Opens the screen a notification points at (`actionType` matches NotificationActionType). */
async function routeFor(data: PushData, projectId: string | null): Promise<void> {
  if (!rootNavigationRef.isReady()) return;
  switch (data.actionType) {
    case 'OPEN_PROJECT':
      rootNavigationRef.navigate('WbsInbox');
      return;
    case 'OPEN_ASSURANCE_WIZARD':
      rootNavigationRef.navigate('AssuranceWizard');
      return;
    case 'OPEN_REPORT_SUMMARY':
    case 'OPEN_BACKLOG_REVIEW':
      rootNavigationRef.navigate('BacklogModal');
      return;
    case 'OPEN_DEFECTS':
      rootNavigationRef.navigate('Defects');
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
 * Registers the push token for every identity on the device when permission was already granted
 * (no prompt at launch), refreshes assurance status when a push arrives, and routes taps by
 * `actionType`, switching to the notification's project first when it is not the open one.
 */
export function usePushNotifications(identities: PushIdentity[]): void {
  const { refreshAssuranceStatus, activeProjectId, projects, switchProject, refreshProjects } = useProfile();
  const identityKey = useMemo(() => identities.map((i) => `${i.scope}:${i.token}`).join('|'), [identities]);
  const latest = useRef({ activeProjectId, projects, switchProject, refreshProjects });
  latest.current = { activeProjectId, projects, switchProject, refreshProjects };

  useEffect(() => {
    void registerPushIfPermitted(identities);
    // identityKey captures every change that matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identityKey]);

  useEffect(() => {
    const received = Notifications.addNotificationReceivedListener((n) => {
      const data = (n.request.content.data ?? {}) as PushData;
      if (data.assuranceStatus) void refreshAssuranceStatus();
      if (data.actionType === 'OPEN_PROJECT') void latest.current.refreshProjects().catch(() => undefined);
    });
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data ?? {}) as PushData;
      void (async () => {
        const current = latest.current;
        if (data.actionType === 'OPEN_PROJECT') await current.refreshProjects().catch(() => undefined);
        let projectId = current.activeProjectId || null;
        const known = latest.current.projects.some((p) => p.projectId === data.projectId);
        if (data.projectId && data.projectId !== projectId && known) {
          await current.switchProject(data.projectId);
          projectId = data.projectId;
        }
        if (data.assuranceStatus) await refreshAssuranceStatus();
        await routeFor(data, projectId);
      })();
    });
    return () => {
      received.remove();
      tapped.remove();
    };
  }, [refreshAssuranceStatus]);
}
