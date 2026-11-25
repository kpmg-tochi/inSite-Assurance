import type { SiteLogEntryDto, SiteLogKind } from '@insite/shared';
import { getDb, newId, nowIso } from './db/database';
import { deletePendingRows, enqueue, latestRowFor, openRowLookup } from './outbox/outboxStore';
import { kickOutbox } from './outbox/outboxProcessor';
import { siteLogEntryDependsOn } from './outbox/outboxPolicy';
import { emitVisitDataChanged } from './visitEvents';
import { previewGeofence, type LocationFix } from '../services/locationService';
import { siteLogEntryProblem, type SiteLogRecord, type SiteLogStatus } from '../utils/siteLog';

/**
 * Redesign R5a (D-R5.22): the site log on the phone. Photo and voice entries take a capture saved
 * first with `saveCapture` (its own CAPTURE outbox row); the entry is a SITE_LOG_ENTRY row behind it.
 * Notes may carry the device position. Every write emits the `siteLog` topic.
 */

type Row = {
  id: string;
  project_id: string;
  kind: string;
  text: string | null;
  capture_id: string | null;
  captured_at: string;
  latitude: number | null;
  longitude: number | null;
  accuracy_meters: number | null;
  is_mocked: number;
  geofence_status: string | null;
  status: string;
  server_id: string | null;
  server_json: string | null;
  attached_submission_id: string | null;
  moved_to_draft_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function map(r: Row): SiteLogRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    kind: r.kind as SiteLogKind,
    text: r.text,
    captureId: r.capture_id,
    capturedAt: r.captured_at,
    latitude: r.latitude,
    longitude: r.longitude,
    accuracyMeters: r.accuracy_meters,
    isMocked: Boolean(r.is_mocked),
    geofenceStatus: (r.geofence_status as SiteLogRecord['geofenceStatus']) ?? null,
    status: r.status as SiteLogStatus,
    serverId: r.server_id,
    attachedSubmissionId: r.attached_submission_id,
    movedToDraftId: r.moved_to_draft_id,
    lastError: r.last_error,
    createdAt: r.created_at,
  };
}

/**
 * Writes an entry and queues it. PHOTO / VOICE: pass the clientCaptureId from `saveCapture` (and its
 * fix, for the local boundary preview). NOTE: pass the text and, when available, a fix.
 * Throws an Error with the person-facing problem when the entry is incomplete.
 */
export async function queueSiteLogEntry(input: {
  projectId: string;
  kind: SiteLogKind;
  text?: string | null;
  captureId?: string | null;
  fix?: LocationFix | null;
  capturedAt?: string;
}): Promise<SiteLogRecord> {
  const problem = siteLogEntryProblem(input);
  if (problem) throw new Error(problem);
  const id = newId();
  const now = nowIso();
  const fix = input.fix ?? null;
  const preview = fix ? previewGeofence(fix, input.projectId) : null;
  const captureId = input.kind === 'NOTE' ? null : input.captureId ?? null;
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO site_log_entries (id, project_id, kind, text, capture_id, captured_at, latitude, longitude, accuracy_meters,
         is_mocked, geofence_status, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?)`,
      [
        id,
        input.projectId,
        input.kind,
        input.text?.trim() || null,
        captureId,
        input.capturedAt ?? fix?.capturedAt ?? now,
        fix?.latitude ?? null,
        fix?.longitude ?? null,
        fix?.accuracyMeters ?? null,
        fix?.isMocked ? 1 : 0,
        preview?.status ?? null,
        now,
        now,
      ]
    );
    const lookup = await openRowLookup(db, [['CAPTURE', captureId]]);
    await enqueue(db, { projectId: input.projectId, kind: 'SITE_LOG_ENTRY', entityId: id, dependsOn: siteLogEntryDependsOn({ captureId }, lookup) });
  });
  emitVisitDataChanged('siteLog');
  kickOutbox();
  return (await getSiteLogEntry(id))!;
}

export async function getSiteLogEntry(id: string): Promise<SiteLogRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>('SELECT * FROM site_log_entries WHERE id = ?', [id]);
  return row ? map(row) : null;
}

/** A project's entries on this phone, newest first (entries whose photo moved into a form included). */
export async function listSiteLogEntries(projectId: string): Promise<SiteLogRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>('SELECT * FROM site_log_entries WHERE project_id = ? ORDER BY captured_at DESC', [projectId]);
  return rows.map(map);
}

/** Site log client ids → server ids (null while unsent), for finalising a submission. */
export async function siteLogServerIds(clientEntryIds: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (clientEntryIds.length === 0) return out;
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; server_id: string | null }>(
    `SELECT id, server_id FROM site_log_entries WHERE id IN (${clientEntryIds.map(() => '?').join(',')})`,
    clientEntryIds
  );
  for (const r of rows) out.set(r.id, r.server_id);
  return out;
}

/** Handler: the server has the entry (201 or a 200 replay). */
export async function markSiteLogSent(id: string, dto: SiteLogEntryDto): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE site_log_entries SET status = 'SENT', server_id = ?, server_json = ?, geofence_status = COALESCE(?, geofence_status),
       attached_submission_id = COALESCE(?, attached_submission_id), last_error = NULL, updated_at = ? WHERE id = ?`,
    [dto.id, JSON.stringify(dto), dto.geofenceStatus, dto.attachedSubmissionId, nowIso(), id]
  );
  emitVisitDataChanged('siteLog');
}

/**
 * "Pick from site log" into a photo field (D-R5.22): the entry is withdrawn before it is sent and its
 * capture becomes the answer's capture (the server refuses a capture already in the site log as an
 * answer). Returns the clientCaptureId; throws when the entry was already sent or is being sent.
 */
export async function takeSiteLogPhotoIntoDraft(entryId: string, draftId: string): Promise<string> {
  const db = await getDb();
  let captureId: string | null = null;
  let problem: string | null = null;
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<Row>('SELECT * FROM site_log_entries WHERE id = ?', [entryId]);
    if (!row || row.kind !== 'PHOTO' || !row.capture_id) {
      problem = 'Only a site log photo can be used here.';
      return;
    }
    if (row.status !== 'QUEUED' || row.server_id) {
      problem = 'This photo is already in the site log on the server. Attach the entry to the monitoring report instead, or take a new photo.';
      return;
    }
    const withdrawn = await deletePendingRows(db, 'SITE_LOG_ENTRY', entryId);
    const latest = await latestRowFor('SITE_LOG_ENTRY', entryId);
    if (withdrawn === 0 && latest) {
      problem = 'This photo is being sent to the site log. Attach the entry to the monitoring report instead, or take a new photo.';
      return;
    }
    await db.runAsync(`UPDATE site_log_entries SET status = 'MOVED_TO_FORM', moved_to_draft_id = ?, updated_at = ? WHERE id = ?`, [draftId, nowIso(), entryId]);
    captureId = row.capture_id;
  });
  if (problem) throw new Error(problem);
  emitVisitDataChanged('siteLog');
  return captureId!;
}

/** The outbox state of an entry, for its upload badge. */
export async function siteLogEntryOutboxState(id: string) {
  return latestRowFor('SITE_LOG_ENTRY', id);
}
