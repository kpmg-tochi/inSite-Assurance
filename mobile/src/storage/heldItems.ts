import { Directory, File, Paths } from 'expo-file-system';
import { canonicalCaptureString } from '@insite/shared';
import { signWithDeviceKey } from '../security/deviceKey';
import { getDb, newId, nowIso } from './db/database';
import { enqueue } from './outbox/outboxStore';
import { kickOutbox, refreshOutboxCounts } from './outbox/outboxProcessor';
import { shouldHoldOnNewSession, type OutboxKind, type OutboxStatus } from './outbox/outboxPolicy';
import { getCapture } from './captureStore';

/**
 * Phase 5 Step 8: items queued under a session that has ended.
 *
 * Since R1d this happens once, on the first start after the update, for projects that were joined
 * with a code (join-code sessions no longer exist): every unsent photo, voice note and defect update
 * queued under that session is HELD: it stays on the device and is never sent until the person
 * decides on the Outbox screen (redesign R5e).
 * - Remove deletes it (local file and outbox row); it never reaches the server.
 * - Send again re-validates a photo or voice note for the current session: it gets a new client ID
 *   and a fresh signature, keeps its original capture time and GPS fix, and is linked to the
 *   original on the server (flag RESUBMITTED_AFTER_SESSION_END).
 */

export const HELD_EXPLANATION =
  'This was captured under a project session that has since ended, so it will not be included as evidence as it is. ' +
  'Remove it, or send it again under your current session. A photo or voice note sent again keeps its original time and location and is marked as re-submitted for reviewers.';

/** Holds every unsent evidence row of the project that belongs to another session. Returns how many. */
export async function holdItemsFromEndedSessions(projectId: string, keepSessionKey: string): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; kind: string; status: string; session_key: string | null }>(
    `SELECT id, kind, status, session_key FROM outbox WHERE project_id = ? AND status != 'DONE'`,
    [projectId]
  );
  const toHold = rows.filter((r) =>
    shouldHoldOnNewSession(
      { kind: r.kind as OutboxKind, status: r.status as OutboxStatus, sessionKey: r.session_key },
      keepSessionKey
    )
  );
  if (toHold.length === 0) return 0;
  const now = nowIso();
  await db.withTransactionAsync(async () => {
    for (const r of toHold) {
      await db.runAsync(`UPDATE outbox SET status = 'HELD', updated_at = ? WHERE id = ?`, [now, r.id]);
    }
  });
  return toHold.length;
}

function deleteLocalFile(uri: string | null | undefined) {
  if (!uri) return;
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // Already gone.
  }
}

/**
 * Re-validates a capture for the current session: a copy of the file under a new client ID,
 * signed again, with the original capture time and fix. The original row is kept and marked
 * superseded (it may already be server evidence of the ended session). Idempotent: a capture that
 * was already superseded returns its replacement.
 */
async function resubmitCapture(captureId: string): Promise<{ captureId: string; outboxRowId: string | null }> {
  const original = await getCapture(captureId);
  if (!original) throw new Error('The photo or voice note is no longer on this device.');
  const db = await getDb();
  const existing = await db.getFirstAsync<{ superseded_by: string | null }>(
    'SELECT superseded_by FROM captures WHERE id = ?',
    [captureId]
  );
  if (existing?.superseded_by) {
    const open = await db.getFirstAsync<{ id: string }>(
      `SELECT id FROM outbox WHERE kind = 'CAPTURE' AND entity_id = ? AND status != 'DONE'`,
      [existing.superseded_by]
    );
    return { captureId: existing.superseded_by, outboxRowId: open?.id ?? null };
  }

  const source = new File(original.localPath);
  if (original.localDeletedAt || !source.exists) {
    throw new Error('The file is no longer on this device, so it cannot be sent again. Remove it instead.');
  }
  const id = newId();
  const extension = original.localPath.split('.').pop() ?? 'bin';
  const dir = new Directory(Paths.document, 'captures');
  dir.create({ idempotent: true, intermediates: true });
  const dest = new File(dir, `${id}.${extension}`);
  source.copy(dest);

  const signature = await signWithDeviceKey(
    canonicalCaptureString({
      clientCaptureId: id,
      projectId: original.projectId,
      mediaType: original.mediaType,
      sha256: original.sha256,
      byteSize: original.byteSize,
      capturedAt: original.capturedAt,
      latitude: original.fix?.latitude ?? null,
      longitude: original.fix?.longitude ?? null,
      accuracyMeters: original.fix?.accuracyMeters ?? null,
      isMockLocation: original.fix?.isMocked ?? false,
    })
  );

  const wasRegistered = original.uploadStatus === 'REGISTERED';
  let outboxRowId: string | null = null;
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO captures (id, project_id, media_type, mime_type, local_path, byte_size,
         sha256, duration_seconds, caption, latitude, longitude, accuracy_meters, altitude_meters,
         is_mocked, location_available, captured_at, signature, upload_status, resubmitted_from, created_at,
         heading_degrees, heading_reference, heading_accuracy_level)
       SELECT ?, project_id, media_type, mime_type, ?, byte_size, sha256, duration_seconds,
         caption, latitude, longitude, accuracy_meters, altitude_meters, is_mocked, location_available,
         captured_at, ?, 'LOCAL', id, ?, heading_degrees, heading_reference, heading_accuracy_level
       FROM captures WHERE id = ?`,
      [id, dest.uri, signature, nowIso(), captureId]
    );
    await db.runAsync('UPDATE captures SET superseded_by = ? WHERE id = ?', [id, captureId]);
    // The original's own upload never goes out under the new session.
    await db.runAsync(`DELETE FROM outbox WHERE kind = 'CAPTURE' AND entity_id = ? AND status != 'DONE'`, [captureId]);
    outboxRowId = await enqueue(db, { projectId: original.projectId, kind: 'CAPTURE', entityId: id });
  });
  if (!wasRegistered) deleteLocalFile(original.localPath);
  return { captureId: id, outboxRowId };
}

/** Send again: a held photo or voice note is re-validated for the current session and queued. */
export async function resendHeldCapture(captureId: string): Promise<void> {
  await resubmitCapture(captureId);
  kickOutbox();
}

/** Remove: a held photo or voice note and its outbox row; the file goes when the server never had it. */
export async function removeHeldCapture(captureId: string): Promise<void> {
  const capture = await getCapture(captureId);
  const db = await getDb();
  const dropRecord = Boolean(capture) && capture!.uploadStatus !== 'REGISTERED';
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM outbox WHERE kind = 'CAPTURE' AND entity_id = ? AND status = 'HELD'`, [captureId]);
    if (dropRecord) await db.runAsync('DELETE FROM captures WHERE id = ?', [captureId]);
  });
  if (dropRecord) deleteLocalFile(capture!.localPath);
  await refreshOutboxCounts();
}
