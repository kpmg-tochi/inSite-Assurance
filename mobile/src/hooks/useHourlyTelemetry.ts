import { useEffect } from 'react';
import { startHourlyTelemetryScheduler } from '../services/telemetryService';

interface UseHourlyTelemetryOptions {
  activeProjectCode?: string | null;
  activeProjectId?: string | null;
  workdayStartHour?: number;
  workdayEndHour?: number;
}

/**
 * Schedules hourly site-presence GPS telemetry pings during active workdays
 * whenever the user is checked into a project.
 */
export function useHourlyTelemetry({
  activeProjectCode,
  activeProjectId,
  workdayStartHour = 7,
  workdayEndHour = 19,
}: UseHourlyTelemetryOptions): void {
  useEffect(() => {
    if (!activeProjectCode || !activeProjectId) return;

    const stopScheduler = startHourlyTelemetryScheduler({
      projectId: activeProjectId,
      workdayStartHour,
      workdayEndHour,
    });

    return stopScheduler;
  }, [activeProjectCode, activeProjectId, workdayStartHour, workdayEndHour]);
}

