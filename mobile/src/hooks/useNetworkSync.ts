import { useEffect } from 'react';
import { registerOutboxHandlers } from '../storage/outbox/handlers';
import { startOutbox } from '../storage/outbox/outboxProcessor';
import { purgeRegisteredCaptureFiles } from '../storage/captureStore';
import { startVisitSync } from '../services/visitSync';

/**
 * Starts the one outbox processor (startup, network restored, foreground, every minute) and, since
 * redesign R5a, the visit download (startup, network restored, foreground, every 15 minutes).
 */
export function useNetworkSync(): void {
  useEffect(() => {
    registerOutboxHandlers();
    const stopOutbox = startOutbox();
    const stopVisits = startVisitSync();
    void purgeRegisteredCaptureFiles().catch(() => undefined);
    return () => {
      stopOutbox();
      stopVisits();
    };
  }, []);
}
