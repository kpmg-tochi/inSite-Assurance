import { AppState, type AppStateStatus } from 'react-native';
import { getLastPingTime, recordPresencePing } from '../storage/telemetryStore';
import { acquireFix } from './locationService';
import { getLoadedBaselinePack } from '../storage/baselineStore';
import { projectTimeZone } from '../storage/reportStore';
import { kickOutbox } from '../storage/outbox/outboxProcessor';
import { cadenceSettingsFromPack, presenceWindowOpen } from '../utils/projectCadence';

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
    // Phase 8: only inside the project's working hours on its working days; never for inspection-only.
    const settings = cadenceSettingsFromPack(getLoadedBaselinePack(config.projectId), projectTimeZone(config.projectId));
    if (!presenceWindowOpen(settings)) return false;
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

/**
 * "Check in on site" (Phase 8): a signed MANUAL_CHECKIN ping through the same path as every other
 * ping. The server decides whether it is inside the geofence; the app only reports what it sent.
 */
export async function recordManualCheckIn(projectId: string): Promise<{ recorded: boolean; reason?: string }> {
  const fix = await acquireFix();
  if (!fix) return { recorded: false, reason: 'No GPS fix. Move into the open and try again.' };
  await recordPresencePing({ projectId, fix, source: 'MANUAL_CHECKIN' });
  kickOutbox();
  return { recorded: true };
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
