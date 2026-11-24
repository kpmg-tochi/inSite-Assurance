import { Directory, File, Paths } from 'expo-file-system';
import type { CreateIncidentReportRequest } from '@insite/shared';
import { getDb, newId, nowIso } from './db/database';
import { enqueue } from './outbox/outboxStore';
import { kickOutbox } from './outbox/outboxProcessor';

/**
 * Incident and whistleblowing reports. Saved first with a client UUID, then sent by the outbox;
 * the server treats a repeat as the same incident.
 */

export type IncidentInput = Omit<CreateIncidentReportRequest, 'clientIncidentId' | 'projectId' | 'photoEvidenceUrls'>;

interface StoredIncident {
  request: CreateIncidentReportRequest;
  /** Photos still to upload (local files). Their object keys go into request.photoEvidenceUrls. */
  localPhotoUris: string[];
}

export async function queueIncident(
  projectId: string,
  input: IncidentInput,
  localPhotoUris: string[] = []
): Promise<string> {
  const id = newId();
  // Camera files live in the cache, which the OS may clear before an offline incident is sent.
  const dir = new Directory(Paths.document, 'incidents');
  dir.create({ idempotent: true, intermediates: true });
  const kept = localPhotoUris.map((uri, i) => {
    const dest = new File(dir, `${id}-${i}.jpg`);
    const src = new File(uri);
    try {
      src.move(dest);
    } catch {
      src.copy(dest);
    }
    return dest.uri;
  });
  const payload: StoredIncident = {
    request: { ...input, clientIncidentId: id, photoEvidenceUrls: [] },
    localPhotoUris: kept,
  };
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO incidents (id, project_id, payload_json, created_at) VALUES (?, ?, ?, ?)',
      [id, projectId, JSON.stringify(payload), nowIso()]
    );
    await enqueue(db, { projectId, kind: 'INCIDENT', entityId: id });
  });
  kickOutbox();
  return id;
}

export async function loadIncident(id: string): Promise<StoredIncident | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ payload_json: string }>('SELECT payload_json FROM incidents WHERE id = ?', [id]);
  return row ? (JSON.parse(row.payload_json) as StoredIncident) : null;
}

/** Records an uploaded photo's object key so a retry does not upload it again. */
export async function recordIncidentPhotoUploaded(id: string, localUri: string, objectKey: string): Promise<void> {
  const current = await loadIncident(id);
  if (!current) return;
  const next: StoredIncident = {
    request: { ...current.request, photoEvidenceUrls: [...current.request.photoEvidenceUrls, objectKey] },
    localPhotoUris: current.localPhotoUris.filter((u) => u !== localUri),
  };
  const db = await getDb();
  await db.runAsync('UPDATE incidents SET payload_json = ? WHERE id = ?', [JSON.stringify(next), id]);
}

export async function markIncidentSent(id: string, serverId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE incidents SET server_id = ? WHERE id = ?', [serverId, id]);
}

/**
 * Redesign R5e (Outbox screen): an incident that could not be sent is removed from the phone with
 * its outbox row and its photos still on the device. Sent incidents are never removed here.
 */
export async function discardIncident(id: string): Promise<void> {
  const current = await loadIncident(id);
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM outbox WHERE kind = 'INCIDENT' AND entity_id = ? AND status IN ('DEAD', 'HELD')`, [id]);
    await db.runAsync('DELETE FROM incidents WHERE id = ? AND server_id IS NULL', [id]);
  });
  for (const uri of current?.localPhotoUris ?? []) {
    try {
      const f = new File(uri);
      if (f.exists) f.delete();
    } catch {
      // Already gone.
    }
  }
}
