import { useMutation } from '@tanstack/react-query';
import { queueIncident, type IncidentInput } from '../../storage/incidentStore';

export interface SubmitIncidentMutationInput {
  projectId: string;
  payload: IncidentInput;
  /** Local photo files; the outbox uploads them and sends their object keys. */
  localPhotoUris?: string[];
}

/** Saves the incident on the device and queues it; resolves once it is safely stored. */
export function useSubmitIncidentMutation() {
  return useMutation({
    mutationFn: ({ projectId, payload, localPhotoUris }: SubmitIncidentMutationInput) =>
      queueIncident(projectId, payload, localPhotoUris ?? []),
  });
}
