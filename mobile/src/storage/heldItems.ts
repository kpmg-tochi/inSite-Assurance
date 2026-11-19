import { Directory, File, Paths } from 'expo-file-system';
import { canonicalCaptureString } from '@insite/shared';
import { signWithDeviceKey } from '../security/deviceKey';
import { currentJoinSessionId, sessionKeyForProject } from '../config/authRegistry';
import { getDb, newId, nowIso } from './db/database';
import { enqueue } from './outbox/outboxStore';
import { kickOutbox } from './outbox/outboxProcessor';
import { shouldHoldOnNewSession, type OutboxKind, type OutboxStatus } from './outbox/outboxPolicy';
import { getCapture } from './captureStore';

/**
 * Phase 5 Step 8: items queued under a session that has ended.
 *
 * When the person rejoins a project, every unsent photo, voice note, note and report queued under
 * an earlier session is HELD: it stays on the device and is never sent until the person decides.
 * - Remove deletes it (local file and outbox row); it never reaches the server.
 * - Update re-validates it for the current session: a capture gets a new client ID and a fresh
 *   signature, keeps its original capture time and GPS fix, and is linked to the original on the
 *   server (flag RESUBMITTED_AFTER_SESSION_END). A report is never re-sent as it was: it is
 *   unlinked so the person confirms it again.
 */

export const HELD_EXPLANATION =
  'This was captured under a project session that has since ended, so it will not be included as evidence as it is. ' +
  'Remove it, or update it to send it under your current session. An updated item keeps its original time and location and is marked as re-submitted for reviewers.';

/** Holds every unsent evidence row of the project that belongs to another session. Returns how many. */
export async function holdItemsFromEndedSessions(projectId: string, currentSessionKey: string): Promise<number> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; kind: string; status: string; session_key: string | null }>(
    `SELECT id, kind, status, session_key FROM outbox WHERE project_id = ? AND status != 'DONE'`,
    [projectId]
  );
  const toHold = rows.filter((r) =>
    shouldHoldOnNewSession(
      { kind: r.kind as OutboxKind, status: r.status as OutboxStatus, sessionKey: r.session_key },
      currentSessionKey
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

export interface HeldState {
  captureIds: Set<string>;
  messageIds: Set<string>;
  reportIds: Set<string>;
}

export async function getHeldState(projectId?: string): Promise<HeldState> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ kind: string; entity_id: string }>(
    `SELECT kind, entity_id FROM outbox WHERE status = 'HELD'${projectId ? ' AND project_id = ?' : ''}`,
    projectId ? [projectId] : []
  );
  const state: HeldState = { captureIds: new Set(), messageIds: new Set(), reportIds: new Set() };
  for (const r of rows) {
    if (r.kind === 'CAPTURE') state.captureIds.add(r.entity_id);
    else if (r.kind === 'CHAT_MESSAGE') state.messageIds.add(r.entity_id);
    else if (r.kind === 'REPORT' || r.kind === 'REVALIDATION') state.reportIds.add(r.entity_id);
  }
  return state;
}

export interface HeldReport {
  id: string;
  projectId: string;
  wbsItemId: string;
  workdayDate: string;
  summaryText: string;
}

export async function listHeldReports(projectId: string, wbsItemId?: string): Promise<HeldReport[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    project_id: string;
    wbs_item_id: string;
    workday_date: string;
    summary_text: string;
  }>(
    `SELECT r.id, r.project_id, r.wbs_item_id, r.workday_date, r.summary_text FROM workday_reports r
     WHERE r.project_id = ?${wbsItemId ? ' AND r.wbs_item_id = ?' : ''}
       AND r.id IN (SELECT entity_id FROM outbox WHERE status = 'HELD' AND kind IN ('REPORT', 'REVALIDATION'))
     ORDER BY r.created_at ASC`,
    wbsItemId ? [projectId, wbsItemId] : [projectId]
  );
  return rows.map((r) => ({
    id: r.id,
    projectId: r.project_id,
    wbsItemId: r.wbs_item_id,
    workdayDate: r.workday_date,
    summaryText: r.summary_text,
  }));
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
      `INSERT INTO captures (id, project_id, wbs_item_id, media_type, mime_type, local_path, byte_size,
         sha256, duration_seconds, caption, latitude, longitude, accuracy_meters, altitude_meters,
         is_mocked, location_available, captured_at, signature, upload_status, resubmitted_from, created_at)
       SELECT ?, project_id, wbs_item_id, media_type, mime_type, ?, byte_size, sha256, duration_seconds,
         caption, latitude, longitude, accuracy_meters, altitude_meters, is_mocked, location_available,
         captured_at, ?, 'LOCAL', id, ?
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

async function loadMessage(clientMessageId: string) {
  const db = await getDb();
  return db.getFirstAsync<{ id: string; project_id: string; capture_id: string | null }>(
    'SELECT id, project_id, capture_id FROM chat_messages WHERE client_message_id = ?',
    [clientMessageId]
  );
}

/** Remove: the message, its unsent capture and their outbox rows are deleted from this device. */
export async function removeHeldMessage(clientMessageId: string): Promise<void> {
  const msg = await loadMessage(clientMessageId);
  if (!msg) return;
  const db = await getDb();
  const capture = msg.capture_id ? await getCapture(msg.capture_id) : null;
  const dropCapture = capture && capture.uploadStatus !== 'REGISTERED';
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM outbox WHERE kind = 'CHAT_MESSAGE' AND entity_id = ?`, [clientMessageId]);
    if (dropCapture) {
      await db.runAsync(`DELETE FROM outbox WHERE kind = 'CAPTURE' AND entity_id = ?`, [capture!.id]);
      await db.runAsync('DELETE FROM captures WHERE id = ?', [capture!.id]);
    }
    await db.runAsync('DELETE FROM chat_messages WHERE client_message_id = ?', [clientMessageId]);
  });
  if (dropCapture) deleteLocalFile(capture!.localPath);
}

/** Update: re-validates the message (and its capture) for the current session and sends it. */
export async function updateHeldMessage(clientMessageId: string): Promise<void> {
  const msg = await loadMessage(clientMessageId);
  if (!msg) return;
  const db = await getDb();
  const held = await getHeldState(msg.project_id);
  const dependsOn: string[] = [];
  if (msg.capture_id && (held.captureIds.has(msg.capture_id) || held.messageIds.has(clientMessageId))) {
    const fresh = await resubmitCapture(msg.capture_id);
    if (fresh.outboxRowId) dependsOn.push(fresh.outboxRowId);
    await db.runAsync('UPDATE chat_messages SET capture_id = ? WHERE client_message_id = ?', [
      fresh.captureId,
      clientMessageId,
    ]);
  }
  if (held.messageIds.has(clientMessageId)) {
    const now = nowIso();
    await db.runAsync(
      `UPDATE outbox SET status = 'PENDING', attempts = 0, last_error = NULL, next_attempt_at = ?, updated_at = ?,
         depends_on_json = ?, session_key = ?
       WHERE kind = 'CHAT_MESSAGE' AND entity_id = ? AND status = 'HELD'`,
      [now, now, JSON.stringify(dependsOn), sessionKeyForProject(msg.project_id), clientMessageId]
    );
  }
  kickOutbox();
}

/** Remove a held report: deleted from the device; its photos and notes stay as their own items. */
export async function removeHeldReport(reportId: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM outbox WHERE kind IN ('REPORT', 'REVALIDATION') AND entity_id = ?`, [reportId]);
    await db.runAsync('UPDATE captures SET report_id = NULL WHERE report_id = ?', [reportId]);
    await db.runAsync('UPDATE chat_messages SET report_id = NULL WHERE report_id = ?', [reportId]);
    await db.runAsync('DELETE FROM workday_reports WHERE id = ?', [reportId]);
  });
}

/**
 * Update a held report: its captures are re-validated for the current session (including any the
 * ended session already registered, which the new session may not link), then the report is
 * unlinked so the person confirms it again. Returns the report's WBS item for the confirm sheet.
 */
export async function prepareHeldReportForReconfirm(reportId: string): Promise<{ wbsItemId: string } | null> {
  const db = await getDb();
  const report = await db.getFirstAsync<{ project_id: string; wbs_item_id: string; capture_ids_json: string }>(
    'SELECT project_id, wbs_item_id, capture_ids_json FROM workday_reports WHERE id = ?',
    [reportId]
  );
  if (!report) return null;
  const currentSession = currentJoinSessionId(report.project_id);
  const held = await getHeldState(report.project_id);
  for (const captureId of JSON.parse(report.capture_ids_json || '[]') as string[]) {
    const c = await getCapture(captureId);
    if (!c) continue;
    const registeredByOtherSession =
      c.uploadStatus === 'REGISTERED' && Boolean(c.server) && c.server!.fieldSessionId !== currentSession;
    if (held.captureIds.has(captureId) || registeredByOtherSession) {
      const fresh = await resubmitCapture(captureId);
      // Photo messages showing this capture now show the re-submitted one.
      await db.runAsync('UPDATE chat_messages SET capture_id = ? WHERE capture_id = ?', [fresh.captureId, captureId]);
    }
  }
  await removeHeldReport(reportId);
  kickOutbox();
  return { wbsItemId: report.wbs_item_id };
}
