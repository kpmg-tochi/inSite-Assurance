import { useEffect } from 'react';
import { registerOutboxHandlers } from '../storage/outbox/handlers';
import { startOutbox } from '../storage/outbox/outboxProcessor';
import { purgeRegisteredCaptureFiles } from '../storage/captureStore';

/** Starts the one outbox processor (startup, network restored, foreground, every minute). */
export function useNetworkSync(): void {
  useEffect(() => {
    registerOutboxHandlers();
    const stop = startOutbox();
    void purgeRegisteredCaptureFiles().catch(() => undefined);
    return stop;
  }, []);
}
