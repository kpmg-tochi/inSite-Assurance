import type { CreateIncidentReportRequest } from '@insite/shared';
import { mobileRequest } from '../../config/apiConfig';

export const createIncidentReport = async (
  projectId: string,
  payload: CreateIncidentReportRequest,
  sessionTokenOverride?: string
): Promise<{ id?: string }> => {
  return mobileRequest<{ id?: string }>(`/projects/${projectId}/incidents`, {
    method: 'POST',
    headers: sessionTokenOverride
      ? { Authorization: `Bearer ${sessionTokenOverride}` }
      : undefined,
    body: JSON.stringify(payload),
  });
};

