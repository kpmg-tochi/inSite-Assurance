import { getDatabase } from './sqliteDatabase';
import type { LivenessVerification } from '@insite/shared';

export interface QueuedAssuranceSubmission {
  id: string;
  projectId: string;
  idType: string;
  idPhotoUri: string;
  selfieFrontUri: string;
  selfieLeftUri: string;
  selfieRightUri: string;
  livenessVerification: LivenessVerification;
  regulatoryBody: string;
  licenseNumber: string;
  experienceSummary: string;
  status: 'QUEUED_OFFLINE' | 'SYNCED';
  createdAt: string;
  syncedAt: string | null;
}

let memSubmissions: QueuedAssuranceSubmission[] = [];

export async function saveQueuedAssuranceSubmission(
  input: Omit<QueuedAssuranceSubmission, 'id' | 'status' | 'createdAt' | 'syncedAt'>
): Promise<QueuedAssuranceSubmission> {
  const record: QueuedAssuranceSubmission = {
    ...input,
    id: `asv-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    status: 'QUEUED_OFFLINE',
    createdAt: new Date().toISOString(),
    syncedAt: null,
  };

  memSubmissions = [record, ...memSubmissions];

  const db = await getDatabase();
  if (db) {
    try {
      await db.runAsync(
        `INSERT INTO assurance_submissions
         (id, project_id, id_type, id_photo_uri, selfie_front_uri, selfie_left_uri,
          selfie_right_uri, liveness_json, regulatory_body, license_number,
          experience_summary, status, created_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.projectId,
          record.idType,
          record.idPhotoUri,
          record.selfieFrontUri,
          record.selfieLeftUri,
          record.selfieRightUri,
          JSON.stringify(record.livenessVerification),
          record.regulatoryBody,
          record.licenseNumber,
          record.experienceSummary,
          record.status,
          record.createdAt,
          null,
        ]
      );
    } catch (err) {
      console.warn('SQLite error saving assurance submission:', err);
    }
  }

  return record;
}

export async function getPendingAssuranceSubmissions(
  projectId?: string
): Promise<QueuedAssuranceSubmission[]> {
  const db = await getDatabase();
  if (db) {
    try {
      const rows = projectId
        ? await db.getAllAsync<any>(
            `SELECT * FROM assurance_submissions WHERE status = 'QUEUED_OFFLINE' AND project_id = ? ORDER BY created_at ASC`,
            [projectId]
          )
        : await db.getAllAsync<any>(
            `SELECT * FROM assurance_submissions WHERE status = 'QUEUED_OFFLINE' ORDER BY created_at ASC`
          );

      return rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        idType: r.id_type,
        idPhotoUri: r.id_photo_uri,
        selfieFrontUri: r.selfie_front_uri,
        selfieLeftUri: r.selfie_left_uri,
        selfieRightUri: r.selfie_right_uri,
        livenessVerification: JSON.parse(r.liveness_json),
        regulatoryBody: r.regulatory_body,
        licenseNumber: r.license_number,
        experienceSummary: r.experience_summary,
        status: r.status,
        createdAt: r.created_at,
        syncedAt: r.synced_at,
      }));
    } catch (err) {
      console.warn('SQLite error loading queued assurance submissions:', err);
    }
  }

  return memSubmissions.filter(
    (s) => s.status === 'QUEUED_OFFLINE' && (!projectId || s.projectId === projectId)
  );
}

export async function markAssuranceSubmissionSynced(id: string): Promise<void> {
  const syncedAt = new Date().toISOString();
  memSubmissions = memSubmissions.map((s) =>
    s.id === id ? { ...s, status: 'SYNCED', syncedAt } : s
  );

  const db = await getDatabase();
  if (db) {
    try {
      await db.runAsync(
        `UPDATE assurance_submissions SET status = 'SYNCED', synced_at = ? WHERE id = ?`,
        [syncedAt, id]
      );
    } catch (err) {
      console.warn('SQLite error marking assurance submission synced:', err);
    }
  }
}

