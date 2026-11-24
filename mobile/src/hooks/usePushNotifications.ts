import { useEffect, useMemo, useRef } from 'react';
import * as Notifications from 'expo-notifications';
import { registerPushIfPermitted, type PushIdentity } from '../services/pushNotificationService';
import { rootNavigationRef } from '../components/common/SessionEndedOverlay';
import { useProfile } from '../context/ProfileContext';

type PushData = {
  actionType?: string;
  /** Set by the server on every project notification (Phase 5). */
  projectId?: string;
  /** Redesign R4: OPEN_VISIT pushes name the visit. */
  visitId?: string;
};

/**
 * Opens the screen a notification points at (`actionType` matches NotificationActionType): a visit,
 * the project's defects or the project. Any other action (including those of the pre-R5 app the
 * server may still send) opens the notification centre.
 */
function routeFor(data: PushData, projectId: string | null): void {
  if (!rootNavigationRef.isReady()) return;
  switch (data.actionType) {
    case 'OPEN_PROJECT':
      if (projectId) rootNavigationRef.navigate('Project', { projectId });
      else rootNavigationRef.navigate('Home');
      return;
    case 'OPEN_VISIT':
      if (data.visitId) rootNavigationRef.navigate('Visit', { visitId: data.visitId });
      else rootNavigationRef.navigate('NotificationsModal');
      return;
    case 'OPEN_DEFECTS':
      rootNavigationRef.navigate('Defects', projectId ? { projectId } : undefined);
      return;
    default:
      rootNavigationRef.navigate('NotificationsModal');
  }
}

/**
 * Registers the push token for the signed-in account when permission was already granted
 * (no prompt at launch), and routes taps by `actionType`. The notification's project becomes the
 * last opened project (the default for screens opened without a project).
 */
export function usePushNotifications(identities: PushIdentity[]): void {
  const { activeProjectId, projects, switchProject, refreshProjects } = useProfile();
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
      if (data.actionType === 'OPEN_PROJECT') void latest.current.refreshProjects().catch(() => undefined);
    });
    const tapped = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = (response.notification.request.content.data ?? {}) as PushData;
      void (async () => {
        const current = latest.current;
        if (data.actionType === 'OPEN_PROJECT') await current.refreshProjects().catch(() => undefined);
        let projectId = current.activeProjectId || null;
        const known = latest.current.projects.some((p) => p.projectId === data.projectId);
        if (data.projectId && known) {
          if (data.projectId !== projectId) await current.switchProject(data.projectId);
          projectId = data.projectId;
        }
        routeFor(data, projectId);
      })();
    });
    return () => {
      received.remove();
      tapped.remove();
    };
  }, []);
}
