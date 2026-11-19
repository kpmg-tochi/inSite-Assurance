import { AppState, type AppStateStatus } from 'react-native';
import { getLastPingTime, recordPresencePing } from '../storage/telemetryStore';
import { acquireFix } from './locationService';

/**
 * Presence while the app is open (D-4.3). No background location: a ping is taken when the app
 * comes to the foreground and then at most every `intervalMs` while it stays open. Captures and
 * reports add their own pings. Pings are stored and sent by the outbox (no separate flush loop).
 */

const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;

export interface PresenceScheduleConfig {
  projectId: string;
  intervalMs?: number;
}

let inFlight = false;

export async function recordPresenceIfDue(config: PresenceScheduleConfig): Promise<boolean> {
  if (!config.projectId || inFlight || AppState.currentState !== 'active') return false;
  inFlight = true;
  try {
    const interval = config.intervalMs ?? DEFAULT_INTERVAL_MS;
    const last = await getLastPingTime(config.projectId, 'FOREGROUND_PRESENCE');
    if (last !== null && Date.now() - last < interval) return false;
    const fix = await acquireFix();
    if (!fix) return false;
    await recordPresencePing({ projectId: config.projectId, fix, source: 'FOREGROUND_PRESENCE' });
    return true;
  } catch (err) {
    console.warn('[presence] ping skipped:', err);
    return false;
  } finally {
    inFlight = false;
  }
}

export function startPresenceScheduler(config: PresenceScheduleConfig): () => void {
  const interval = config.intervalMs ?? DEFAULT_INTERVAL_MS;
  void recordPresenceIfDue(config);
  const timer = setInterval(() => void recordPresenceIfDue(config), Math.min(interval, 5 * 60_000));
  const sub = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'active') void recordPresenceIfDue(config);
  });
  return () => {
    clearInterval(timer);
    sub.remove();
  };
}
