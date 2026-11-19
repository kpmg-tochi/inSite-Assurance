import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import Toast from 'react-native-toast-message';
import { useProfile } from '../context/ProfileContext';
import { rootNavigationRef } from '../components/common/SessionEndedOverlay';

/**
 * Keeps assurance status in step with the server and routes on changes:
 * returned (REJECTED) goes to the identity wizard with the reason; approval shows a notice.
 */
export function useAssuranceStatusSync(): void {
  const { activeContext, refreshAssuranceStatus } = useProfile();
  // Only join-code sessions have an assurance step; provisioned accounts are always approved.
  const isJoinSession = activeContext?.origin === 'JOIN_CODE';
  const projectId = activeContext?.projectId;
  const previous = useRef<{ projectId?: string; status?: string }>({
    projectId,
    status: activeContext?.assuranceStatus,
  });

  useEffect(() => {
    if (!isJoinSession) return;
    void refreshAssuranceStatus();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshAssuranceStatus();
    });
    return () => sub.remove();
  }, [isJoinSession, projectId, refreshAssuranceStatus]);

  useEffect(() => {
    const status = activeContext?.assuranceStatus;
    const before = previous.current;
    previous.current = { projectId, status };
    // Switching project is not a status change.
    if (!status || before.projectId !== projectId || status === before.status || before.status === undefined) return;
    if (status === 'REJECTED' && activeContext?.requiresIdentityAssurance && rootNavigationRef.isReady()) {
      rootNavigationRef.reset({ index: 0, routes: [{ name: 'AssuranceWizard' }] });
    }
    if (status === 'APPROVED') {
      Toast.show({
        type: 'success',
        props: {
          title: 'Identity approved',
          message: 'Your held reports have been submitted automatically.',
        },
      });
    }
  }, [projectId, activeContext?.assuranceStatus, activeContext?.requiresIdentityAssurance]);
}
