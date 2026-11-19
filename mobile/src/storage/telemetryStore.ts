import type { SQLiteDatabase } from 'expo-sqlite';
import { canonicalPingString, type TelemetryPingInput, type TelemetryPingSource } from '@insite/shared';
import { signWithDeviceKey } from '../security/deviceKey';
import type { LocationFix } from '../services/locationService';
import { getDb, newId, nowIso } from './db/database';
import { enqueue } from './outbox/outboxStore';

/**
 * Presence pings (D-4.3): recorded only while the app is open, plus one with each capture and
 * report. Each ping is signed, stored, and queued; the outbox sends them in batches.
 */

/** Inserts a signed ping and its outbox row using `db` (pass a transaction to join one). */
export async function insertPing(
  db: SQLiteDatabase,
  params: { projectId: string; wbsItemId?: string | null; fix: LocationFix; source: TelemetryPingSource }
): Promise<string> {
  const id = newId();
  const signature = await signWithDeviceKey(
    canonicalPingString({
      clientPingId: id,
      projectId: params.projectId,
      latitude: params.fix.latitude,
      longitude: params.fix.longitude,
      accuracyMeters: params.fix.accuracyMeters,
      isMocked: params.fix.isMocked,
      capturedAt: params.fix.capturedAt,
    })
  );
  await db.runAsync(
    `INSERT INTO telemetry_pings (id, project_id, wbs_item_id, latitude, longitude, accuracy_meters,
       altitude_meters, is_mocked, ping_source, captured_at, signature, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      params.projectId,
      params.wbsItemId ?? null,
      params.fix.latitude,
      params.fix.longitude,
      params.fix.accuracyMeters,
      params.fix.altitudeMeters,
      params.fix.isMocked ? 1 : 0,
      params.source,
      params.fix.capturedAt,
      signature,
      nowIso(),
    ]
  );
  await enqueue(db, { projectId: params.projectId, kind: 'TELEMETRY', entityId: id });
  return id;
}

export async function recordPresencePing(params: {
  projectId: string;
  wbsItemId?: string | null;
  fix: LocationFix;
  source: TelemetryPingSource;
}): Promise<string> {
  const db = await getDb();
  let id = '';
  await db.withTransactionAsync(async () => {
    id = await insertPing(db, params);
  });
  return id;
}

export async function getLastPingTime(projectId: string, source: TelemetryPingSource): Promise<number | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ captured_at: string }>(
    `SELECT captured_at FROM telemetry_pings WHERE project_id = ? AND ping_source = ?
     ORDER BY captured_at DESC LIMIT 1`,
    [projectId, source]
  );
  return row ? new Date(row.captured_at).getTime() : null;
}

/** Request bodies for the given ping IDs (used by the outbox batch handler). */
export async function loadPingInputs(ids: string[]): Promise<Map<string, TelemetryPingInput>> {
  const out = new Map<string, TelemetryPingInput>();
  if (ids.length === 0) return out;
  const db = await getDb();
  const rows = await db.getAllAsync<{
    id: string;
    wbs_item_id: string | null;
    latitude: number;
    longitude: number;
    accuracy_meters: number | null;
    altitude_meters: number | null;
    is_mocked: number;
    ping_source: string;
    captured_at: string;
    signature: string | null;
  }>(`SELECT * FROM telemetry_pings WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  for (const r of rows) {
    out.set(r.id, {
      clientPingId: r.id,
      wbsItemId: r.wbs_item_id,
      latitude: r.latitude,
      longitude: r.longitude,
      accuracyMeters: r.accuracy_meters,
      altitudeMeters: r.altitude_meters,
      isMocked: Boolean(r.is_mocked),
      pingSource: r.ping_source as TelemetryPingSource,
      capturedAt: r.captured_at,
      signature: r.signature,
    });
  }
  return out;
}
