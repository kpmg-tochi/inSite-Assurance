import type { TelemetryPingInput } from '@insite/shared';
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
