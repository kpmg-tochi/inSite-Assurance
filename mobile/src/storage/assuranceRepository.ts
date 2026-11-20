import { Directory, File, Paths } from 'expo-file-system';
import type { GuidedSelfieSet } from '@insite/shared';
import { getDb, newId, nowIso } from './db/database';
import { enqueue } from './outbox/outboxStore';
import { kickOutbox } from './outbox/outboxProcessor';

/**
 * Identity assurance dossier (ID photo, three selfies, credentials). Saved locally and sent by the
 * outbox. It counts as sent only when every image uploaded and the server accepted the keys.
 */

export interface QueuedAssuranceSubmission {
  projectId: string;
  idType: string;
  idPhotoUri: string;
  selfieFrontUri: string;
  selfieLeftUri: string;
  selfieRightUri: string;
  selfieSet: GuidedSelfieSet;
  /** Phase 12: null when the project hides registration or none was given. */
  registrationNumber: string | null;
  registrationBodyCode: string | null;
  experienceSummary: string;
  /** @deprecated Rows queued before Phase 12 hold these instead. */
  regulatoryBody?: string;
  licenseNumber?: string;
}

export type AssuranceImageSlot = 'idDocument' | 'selfieFront' | 'selfieLeft' | 'selfieRight';

/** Moves a camera file out of the cache (which the OS may clear) into app storage. */
function keepFile(dir: Directory, uri: string, name: string): string {
  const dest = new File(dir, name);
  const src = new File(uri);
  try {
    src.move(dest);
  } catch {
    src.copy(dest);
  }
  return dest.uri;
}

export async function saveQueuedAssuranceSubmission(submission: QueuedAssuranceSubmission): Promise<string> {
  const id = newId();
  const dir = new Directory(Paths.document, 'identity');
  dir.create({ idempotent: true, intermediates: true });
  const input: QueuedAssuranceSubmission = {
    ...submission,
    idPhotoUri: keepFile(dir, submission.idPhotoUri, `${id}-id.jpg`),
    selfieFrontUri: keepFile(dir, submission.selfieFrontUri, `${id}-front.jpg`),
    selfieLeftUri: keepFile(dir, submission.selfieLeftUri, `${id}-left.jpg`),
    selfieRightUri: keepFile(dir, submission.selfieRightUri, `${id}-right.jpg`),
  };
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      'INSERT INTO assurance_submissions (id, project_id, payload_json, created_at) VALUES (?, ?, ?, ?)',
      [id, input.projectId, JSON.stringify(input), nowIso()]
    );
    await enqueue(db, { projectId: input.projectId, kind: 'ASSURANCE', entityId: id });
  });
  kickOutbox();
  return id;
}

export async function loadAssuranceSubmission(id: string): Promise<{
  payload: QueuedAssuranceSubmission;
  uploadedKeys: Partial<Record<AssuranceImageSlot, string>>;
} | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ payload_json: string; uploaded_keys_json: string }>(
    'SELECT payload_json, uploaded_keys_json FROM assurance_submissions WHERE id = ?',
    [id]
  );
  return row
    ? { payload: JSON.parse(row.payload_json), uploadedKeys: JSON.parse(row.uploaded_keys_json || '{}') }
    : null;
}

/** Remembers one uploaded image so a retry does not upload it again. */
export async function recordAssuranceUpload(id: string, slot: AssuranceImageSlot, objectKey: string): Promise<void> {
  const current = await loadAssuranceSubmission(id);
  if (!current) return;
  const keys = { ...current.uploadedKeys, [slot]: objectKey };
  const db = await getDb();
  await db.runAsync('UPDATE assurance_submissions SET uploaded_keys_json = ? WHERE id = ?', [JSON.stringify(keys), id]);
}

export async function markAssuranceSubmissionSynced(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE assurance_submissions SET synced_at = ? WHERE id = ?', [nowIso(), id]);
}

/**
 * Phase 12: the registration fields to send. Rows queued before Phase 12 kept the body and number
 * separately as well, so they map onto the new fields (never a combined display string).
 */
export function registrationFieldsOf(payload: QueuedAssuranceSubmission): { registrationNumber?: string; registrationBodyCode?: string } {
  const number = (payload.registrationNumber ?? payload.licenseNumber ?? '').trim();
  if (!number) return {};
  const code = (payload.registrationBodyCode ?? payload.regulatoryBody ?? '').trim();
  return { registrationNumber: number, ...(code ? { registrationBodyCode: code } : {}) };
}
