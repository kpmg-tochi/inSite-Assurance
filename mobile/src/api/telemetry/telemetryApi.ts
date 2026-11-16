import { mobileRequest } from '../../config/apiConfig';

export const uploadTelemetryPings = async (
  projectId: string,
  pings: unknown[]
): Promise<unknown> => {
  return mobileRequest(`/projects/${projectId}/telemetry`, {
    method: 'POST',
    body: JSON.stringify({ pings }),
  });
};

