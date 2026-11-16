import { AppState, type AppStateStatus } from 'react-native';
import { uploadTelemetryPings } from '../api/telemetry/telemetryApi';
import { captureCurrentGeotag } from './locationService';
import {
  getLastHourlyPingTimestamp,
  getUnsyncedTelemetryPings,
  markTelemetryPingsSynced,
  recordTelemetryPing,
} from '../storage/telemetryRepository';

const ONE_HOUR_MS = 60 * 60 * 1000;

export interface TelemetryScheduleConfig {
  projectId: string;
  workdayStartHour?: number; // 24h local time, default 7 (07:00)
  workdayEndHour?: number; // 24h local time, default 19 (19:00)
  intervalMs?: number; // default 1 hour
}

function isWithinWorkdayWindow(startHour = 7, endHour = 19): boolean {
  const hour = new Date().getHours();
  return hour >= startHour && hour < endHour;
}

/**
 * Syncs any locally queued telemetry pings to the backend when online.
 * Leaves them queued in SQLite if the network is unreachable.
 */
export async function flushTelemetryQueue(projectId: string): Promise<number> {
  const unsynced = await getUnsyncedTelemetryPings(projectId);
  if (unsynced.length === 0) return 0;

  try {
    await uploadTelemetryPings(projectId, unsynced);
    await markTelemetryPingsSynced(unsynced.map((p) => p.id));
    return unsynced.length;
  } catch {
    // Offline or endpoint not yet reachable — pings remain safely queued in SQLite
    return 0;
  }
}

/**
 * Captures an hourly telemetry ping if >= intervalMs has elapsed since the last ping
 * and the current time is within the configured workday window.
 */
export async function runHourlyTelemetryCheck(
  config: TelemetryScheduleConfig
): Promise<boolean> {
  const {
    projectId,
    workdayStartHour = 7,
    workdayEndHour = 19,
    intervalMs = ONE_HOUR_MS,
  } = config;

  if (!projectId || !isWithinWorkdayWindow(workdayStartHour, workdayEndHour)) {
    return false;
  }

  const lastPingMs = await getLastHourlyPingTimestamp(projectId);
  const nowMs = Date.now();
  if (lastPingMs !== null && nowMs - lastPingMs < intervalMs) {
    // Still attempt to flush any unsynced pings from earlier offline hours
    await flushTelemetryQueue(projectId);
    return false;
  }

  const geotag = await captureCurrentGeotag(`TELEMETRY:${projectId}`);
  if (!geotag) {
    return false;
  }

  await recordTelemetryPing({
    projectId,
    geotag,
    pingSource: 'HOURLY_TELEMETRY',
  });

  await flushTelemetryQueue(projectId);
  return true;
}

/**
 * Starts the hourly site-presence telemetry scheduler while the app is active,
 * plus AppState resume catch-up when returning from background.
 * Returns a cleanup function.
 */
export function startHourlyTelemetryScheduler(
  config: TelemetryScheduleConfig
): () => void {
  const intervalMs = config.intervalMs ?? ONE_HOUR_MS;

  // Immediate check on mount
  runHourlyTelemetryCheck(config).catch(() => {});

  const timer = setInterval(() => {
    runHourlyTelemetryCheck(config).catch(() => {});
  }, intervalMs);

  const handleAppStateChange = (nextState: AppStateStatus) => {
    if (nextState === 'active') {
      runHourlyTelemetryCheck(config).catch(() => {});
    }
  };

  const subscription = AppState.addEventListener('change', handleAppStateChange);

  return () => {
    clearInterval(timer);
    subscription.remove();
  };
}

