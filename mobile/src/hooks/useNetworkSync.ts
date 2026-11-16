import { useEffect } from 'react';
import { startNetworkSyncListener } from '../storage/syncEngine';

/**
 * Subscribes to network connectivity and AppState changes to automatically
 * flush queued offline SQLite records (reports, telemetry, assurance, incidents).
 */
export function useNetworkSync(): void {
  useEffect(() => {
    const stopSyncListener = startNetworkSyncListener();
    return stopSyncListener;
  }, []);
}

