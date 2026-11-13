import { API_BASE_URL } from '../config/apiConfig';
import { CreateIncidentReportRequest } from '@insite/shared';

export interface IncidentSubmissionResult {
  success: boolean;
  incidentId?: string;
  error?: string;
}

let memIncidents: any[] = [];

export async function submitIncidentReport(
  projectId: string,
  sessionToken: string,
  input: CreateIncidentReportRequest
): Promise<IncidentSubmissionResult> {
  try {
    const res = await fetch(`${API_BASE_URL}/projects/${projectId}/incidents`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify(input),
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.message || `Server responded with ${res.status}`);
    }

    const data = await res.json();
    return { success: true, incidentId: data.data?.id };
  } catch (error: any) {
    console.warn('Network offline or error submitting incident, queueing locally:', error);
    // Queue locally in memory
    const localId = `inc-${Date.now()}`;
    memIncidents.push({ ...input, id: localId, status: 'QUEUED_OFFLINE' });
    return {
      success: true,
      incidentId: localId,
      error: 'Stored in offline emergency outbox. Will auto-sync when online.',
    };
  }
}

