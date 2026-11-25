import { Directory, File, Paths } from 'expo-file-system';
import { canonicalCaptureString, type CaptureDto, type CaptureMediaType, type HeadingReading } from '@insite/shared';
import { signWithDeviceKey } from '../security/deviceKey';
import type { LocationFix } from '../services/locationService';
import { getDb, newId, nowIso } from './db/database';
import { enqueue } from './outbox/outboxStore';
import { kickOutbox } from './outbox/outboxProcessor';

/**
 * Captures (Phase 4): one photo, voice note or document.
 *
 * Saving a capture moves the file into app storage, hashes it, signs the hardware metadata with
 * the device key and stores everything in SQLite with its outbox row, in one transaction, before
 * anything is sent. The outbox then uploads (presign + PUT) and registers it.
 */

export type CaptureUploadStatus = 'LOCAL' | 'UPLOADED' | 'REGISTERED';

export interface CaptureRecord {
  id: string;
  projectId: string;
  mediaType: CaptureMediaType;
  mimeType: string;
  localPath: string;
  byteSize: number;
  sha256: string;
  durationSeconds: number | null;
  caption: string | null;
  fix: LocationFix | null;
  /** UBEC IRL: compass heading at the shutter (photos); null when none was recorded. */
  heading: HeadingReading | null;
  capturedAt: string;
  signature: string | null;
  objectKey: string | null;
  uploadStatus: CaptureUploadStatus;
  server: CaptureDto | null;
  registeredAt: string | null;
  localDeletedAt: string | null;
  /** Original clientCaptureId when this re-submits a capture from an ended session. */
  resubmittedFrom: string | null;
}

type Row = {
  id: string;
  project_id: string;
  media_type: string;
  mime_type: string;
  local_path: string;
  byte_size: number;
  sha256: string;
  duration_seconds: number | null;
  caption: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_meters: number | null;
  altitude_meters: number | null;
  is_mocked: number;
  location_available: number;
  heading_degrees?: number | null;
  heading_reference?: string | null;
  heading_accuracy_level?: number | null;
  captured_at: string;
  signature: string | null;
  object_key: string | null;
  upload_status: string;
  server_json: string | null;
  registered_at: string | null;
  local_deleted_at: string | null;
  resubmitted_from: string | null;
};

function map(r: Row): CaptureRecord {
  return {
    id: r.id,
    projectId: r.project_id,
    mediaType: r.media_type as CaptureMediaType,
    mimeType: r.mime_type,
    localPath: r.local_path,
    byteSize: r.byte_size,
    sha256: r.sha256,
    durationSeconds: r.duration_seconds,
    caption: r.caption,
    fix:
      r.location_available && r.latitude !== null && r.longitude !== null
        ? {
            latitude: r.latitude,
            longitude: r.longitude,
            accuracyMeters: r.accuracy_meters,
            altitudeMeters: r.altitude_meters,
            isMocked: Boolean(r.is_mocked),
            capturedAt: r.captured_at,
          }
        : null,
    heading:
      r.heading_degrees !== null && r.heading_degrees !== undefined
        ? {
            degrees: r.heading_degrees,
            reference: r.heading_reference === 'TRUE' ? 'TRUE' : 'MAGNETIC',
            accuracyLevel: r.heading_accuracy_level ?? null,
          }
        : null,
    capturedAt: r.captured_at,
    signature: r.signature,
    objectKey: r.object_key,
    uploadStatus: r.upload_status as CaptureUploadStatus,
    server: r.server_json ? (JSON.parse(r.server_json) as CaptureDto) : null,
    registeredAt: r.registered_at,
    localDeletedAt: r.local_deleted_at,
    resubmittedFrom: r.resubmitted_from ?? null,
  };
}

function capturesDir(): Directory {
  const dir = new Directory(Paths.document, 'captures');
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

export interface NewCaptureInput {
  projectId: string;
  mediaType: CaptureMediaType;
  /** Temporary file from the camera or recorder; it is moved into app storage. */
  sourceUri: string;
  mimeType: string;
  fileExtension: string;
  caption?: string | null;
  durationSeconds?: number | null;
  /** The GPS fix taken at the shutter, or null when there was none. Never a substitute value. */
  fix: LocationFix | null;
  /** UBEC IRL: the compass heading at the shutter, or null/absent when there was none. */
  heading?: HeadingReading | null;
  capturedAt: string;
}

export async function saveCapture(input: NewCaptureInput): Promise<CaptureRecord> {
  const id = newId();
  const source = new File(input.sourceUri);
  const dest = new File(capturesDir(), `${id}.${input.fileExtension.replace(/^\./, '')}`);
  try {
    source.move(dest);
  } catch {
    source.copy(dest);
  }
  const sha256 = (await dest.digest('SHA-256')).toLowerCase();
  const byteSize = dest.size;
  if (!byteSize) {
    throw new Error('The captured file is empty. Please capture it again.');
  }

  const signature = await signWithDeviceKey(
    canonicalCaptureString({
      clientCaptureId: id,
      projectId: input.projectId,
      mediaType: input.mediaType,
      sha256,
      byteSize,
      capturedAt: input.capturedAt,
      latitude: input.fix?.latitude ?? null,
      longitude: input.fix?.longitude ?? null,
      accuracyMeters: input.fix?.accuracyMeters ?? null,
      isMockLocation: input.fix?.isMocked ?? false,
    })
  );

  const db = await getDb();
  const now = nowIso();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO captures (id, project_id, media_type, mime_type, local_path, byte_size,
         sha256, duration_seconds, caption, latitude, longitude, accuracy_meters, altitude_meters,
         is_mocked, location_available, captured_at, signature, upload_status, created_at,
         heading_degrees, heading_reference, heading_accuracy_level)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'LOCAL', ?, ?, ?, ?)`,
      [
        id,
        input.projectId,
        input.mediaType,
        input.mimeType,
        dest.uri,
        byteSize,
        sha256,
        input.durationSeconds ?? null,
        input.caption ?? null,
        input.fix?.latitude ?? null,
        input.fix?.longitude ?? null,
        input.fix?.accuracyMeters ?? null,
        input.fix?.altitudeMeters ?? null,
        input.fix?.isMocked ? 1 : 0,
        input.fix ? 1 : 0,
        input.capturedAt,
        signature,
        now,
        input.heading?.degrees ?? null,
        input.heading?.reference ?? null,
        input.heading?.accuracyLevel ?? null,
      ]
    );
    await enqueue(db, { projectId: input.projectId, kind: 'CAPTURE', entityId: id });
  });
  kickOutbox();
  const saved = await getCapture(id);
  if (!saved) throw new Error('Capture was not saved');
  return saved;
}

export async function getCapture(id: string): Promise<CaptureRecord | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>('SELECT * FROM captures WHERE id = ?', [id]);
  return row ? map(row) : null;
}

export async function getCaptures(ids: string[]): Promise<CaptureRecord[]> {
  if (ids.length === 0) return [];
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM captures WHERE id IN (${ids.map(() => '?').join(',')})`,
    ids
  );
  return rows.map(map);
}

export async function updateCaptureUpload(
  id: string,
  patch: { objectKey?: string | null; uploadStatus: CaptureUploadStatus; server?: CaptureDto }
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE captures SET
       object_key = COALESCE(?, object_key),
       upload_status = ?,
       server_json = COALESCE(?, server_json),
       registered_at = CASE WHEN ? = 'REGISTERED' THEN COALESCE(registered_at, ?) ELSE registered_at END
     WHERE id = ?`,
    [
      patch.objectKey ?? null,
      patch.uploadStatus,
      patch.server ? JSON.stringify(patch.server) : null,
      patch.uploadStatus,
      nowIso(),
      id,
    ]
  );
}

/**
 * Redesign R5a (D-R5.13): voice notes the server registered whose transcript is still pending, per
 * project with the earliest registration time (the `since` for `GET /captures/mine`).
 */
export async function listPendingTranscripts(): Promise<Array<{ projectId: string; since: string; ids: string[] }>> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM captures WHERE media_type = 'VOICE_NOTE' AND upload_status = 'REGISTERED' AND server_json IS NOT NULL`
  );
  const out = new Map<string, { projectId: string; since: string; ids: string[] }>();
  for (const r of rows.map(map)) {
    if (r.server?.transcriptionStatus !== 'PENDING') continue;
    const at = r.server.registeredAt || r.registeredAt || r.capturedAt;
    const entry = out.get(r.projectId) ?? { projectId: r.projectId, since: at, ids: [] };
    if (at < entry.since) entry.since = at;
    entry.ids.push(r.id);
    out.set(r.projectId, entry);
  }
  return [...out.values()];
}

/** Stores the server's latest copy of registered captures (transcript, geofence result). Returns how many changed. */
export async function refreshCaptureServerCopies(dtos: CaptureDto[]): Promise<number> {
  const db = await getDb();
  let changed = 0;
  for (const dto of dtos) {
    const r = await db.runAsync(
      `UPDATE captures SET server_json = ? WHERE id = ? AND upload_status = 'REGISTERED' AND (server_json IS NULL OR server_json != ?)`,
      [JSON.stringify(dto), dto.clientCaptureId, JSON.stringify(dto)]
    );
    changed += r.changes;
  }
  return changed;
}

/** Local file to show, or null once it was removed after upload (show it from the server then). */
export function captureDisplayUri(c: Pick<CaptureRecord, 'localPath' | 'localDeletedAt'>): string | null {
  return c.localDeletedAt ? null : c.localPath;
}

/** Days a registered capture's file is kept on the device before it is deleted. */
export const LOCAL_FILE_RETENTION_DAYS = 14;

/** Deletes local files of captures the server registered more than the retention period ago. */
export async function purgeRegisteredCaptureFiles(retentionDays = LOCAL_FILE_RETENTION_DAYS): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - retentionDays * 86_400_000).toISOString();
  const rows = await db.getAllAsync<{ id: string; local_path: string }>(
    `SELECT id, local_path FROM captures
     WHERE upload_status = 'REGISTERED' AND local_deleted_at IS NULL AND registered_at < ?`,
    [cutoff]
  );
  for (const r of rows) {
    try {
      const f = new File(r.local_path);
      if (f.exists) f.delete();
      await db.runAsync('UPDATE captures SET local_deleted_at = ? WHERE id = ?', [nowIso(), r.id]);
    } catch (err) {
      console.warn('[captures] could not delete local file', r.id, err);
    }
  }
  return rows.length;
}
