import { CreateIncidentReportRequest } from '@insite/shared';
import { createIncidentReport } from '../api/incidents/incidentsApi';
import { getDatabase } from '../storage/sqliteDatabase';

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
    const data = await createIncidentReport(projectId, input, sessionToken);
    return { success: true, incidentId: data?.id };
  } catch (error: any) {
    console.warn('Network offline or error submitting incident, queueing locally:', error);
    const localId = `inc-${Date.now()}`;
    const createdAt = new Date().toISOString();
    memIncidents.push({ ...input, id: localId, status: 'QUEUED_OFFLINE' });

    const db = await getDatabase();
    if (db) {
      try {
        await db.runAsync(
          `INSERT OR REPLACE INTO incident_reports
           (id, category, severity, title, description, is_confidential_whistleblower, photos_json, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            localId,
            input.category,
            input.severity,
            input.title,
            input.description,
            input.isConfidentialWhistleblower ? 1 : 0,
            JSON.stringify(input.photoEvidenceUrls ?? []),
            'QUEUED_OFFLINE',
            createdAt,
          ]
        );
      } catch (dbErr) {
        console.warn('SQLite error queueing offline incident:', dbErr);
      }
    }

    return {
      success: true,
      incidentId: localId,
      error: 'Stored in offline emergency outbox. Will auto-sync when online.',
    };
  }
}

