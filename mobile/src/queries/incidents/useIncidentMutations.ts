import { useMutation } from '@tanstack/react-query';
import type { CreateIncidentReportRequest } from '@insite/shared';
import { submitIncidentReport } from '../../services/incidentService';

export interface SubmitIncidentMutationInput {
  projectId: string;
  sessionToken: string;
  payload: CreateIncidentReportRequest;
}

export function useSubmitIncidentMutation() {
  return useMutation({
    mutationFn: ({
      projectId,
      sessionToken,
      payload,
    }: SubmitIncidentMutationInput) =>
      submitIncidentReport(projectId, sessionToken, payload),
  });
}

