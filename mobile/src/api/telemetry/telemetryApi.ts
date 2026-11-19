import type { CheckInStatusDto, TelemetryPingInput } from '@insite/shared';
import { mobileRequest } from '../../config/apiConfig';

/** Idempotent on clientPingId; the server reports how many pings were new. */
export const uploadTelemetryPings = async (
  projectId: string,
  pings: TelemetryPingInput[]
): Promise<{ received: number; created: number; duplicates: number }> => {
  return mobileRequest(`/projects/${projectId}/telemetry`, {
    method: 'POST',
    body: JSON.stringify({ pings }),
  });
};

/** Phase 8: the caller's check-in for the project's current day (server-evaluated geofence). */
export const getTodayCheckIn = async (projectId: string): Promise<CheckInStatusDto> => {
  return mobileRequest<CheckInStatusDto>(`/projects/${projectId}/check-in/today`);
};
