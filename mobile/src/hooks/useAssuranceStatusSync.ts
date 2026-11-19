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
  const { profile, refreshAssuranceStatus } = useProfile();
  const previous = useRef(profile?.assuranceStatus);
  const hasSession = Boolean(profile?.activeSessionToken);

  useEffect(() => {
    if (!hasSession) return;
    void refreshAssuranceStatus();
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') void refreshAssuranceStatus();
    });
    return () => sub.remove();
  }, [hasSession, refreshAssuranceStatus]);

  useEffect(() => {
    const status = profile?.assuranceStatus;
    const before = previous.current;
    previous.current = status;
    if (!status || status === before || before === undefined) return;
    if (status === 'REJECTED' && profile?.activeRequiresIdentityAssurance && rootNavigationRef.isReady()) {
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
  }, [profile?.assuranceStatus, profile?.activeRequiresIdentityAssurance]);
}
