import { useEffect } from 'react';
import { startPresenceScheduler } from '../services/telemetryService';

/** Records presence while the app is open (D-4.3) for the active project. No background tracking. */
export function usePresenceTelemetry(activeProjectId?: string | null): void {
  useEffect(() => {
    if (!activeProjectId) return;
    return startPresenceScheduler({ projectId: activeProjectId });
  }, [activeProjectId]);
}
