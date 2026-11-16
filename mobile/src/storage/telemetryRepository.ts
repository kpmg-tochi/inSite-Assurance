import { getDatabase } from './sqliteDatabase';
import type { SiteGeotag } from '../services/locationService';

export type TelemetryPingSource =
  | 'HOURLY_TELEMETRY'
  | 'REPORT_SUBMISSION'
  | 'MANUAL_CHECKIN';

export interface SiteTelemetryPingRecord {
  id: string;
  projectId: string;
  wbsItemId?: string | null;
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  altitudeMeters: number | null;
  isMocked: boolean;
  isWithinGeofence: boolean | null;
  chainageLabel: string | null;
  distanceMeters: number | null;
  pingSource: TelemetryPingSource;
  deviceSignatureHash: string;
  capturedAt: string;
  syncedAt: string | null;
}

let memTelemetryPings: SiteTelemetryPingRecord[] = [];

export async function recordTelemetryPing(params: {
  projectId: string;
  wbsItemId?: string | null;
  geotag: SiteGeotag;
  pingSource: TelemetryPingSource;
}): Promise<SiteTelemetryPingRecord> {
  const record: SiteTelemetryPingRecord = {
    id: `ping-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    projectId: params.projectId,
    wbsItemId: params.wbsItemId ?? null,
    latitude: params.geotag.latitude,
    longitude: params.geotag.longitude,
    accuracyMeters: params.geotag.accuracyMeters,
    altitudeMeters: params.geotag.altitudeMeters,
    isMocked: params.geotag.isMocked,
    isWithinGeofence: params.geotag.isWithinGeofence,
    chainageLabel: params.geotag.chainageLabel,
    distanceMeters: params.geotag.distanceFromSiteMeters,
    pingSource: params.pingSource,
    deviceSignatureHash: params.geotag.deviceSignatureHash,
    capturedAt: params.geotag.capturedAt,
    syncedAt: null,
  };

  memTelemetryPings = [record, ...memTelemetryPings];

  const db = await getDatabase();
  if (db) {
    try {
      await db.runAsync(
        `INSERT INTO site_telemetry_pings
         (id, project_id, wbs_item_id, latitude, longitude, accuracy_meters, altitude_meters,
          is_mocked, is_within_geofence, chainage_label, distance_meters, ping_source,
          device_signature_hash, captured_at, synced_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          record.id,
          record.projectId,
          record.wbsItemId ?? null,
          record.latitude,
          record.longitude,
          record.accuracyMeters ?? null,
          record.altitudeMeters ?? null,
          record.isMocked ? 1 : 0,
          record.isWithinGeofence === null ? null : record.isWithinGeofence ? 1 : 0,
          record.chainageLabel ?? null,
          record.distanceMeters ?? null,
          record.pingSource,
          record.deviceSignatureHash,
          record.capturedAt,
          null,
        ]
      );
    } catch (err) {
      console.warn('SQLite error inserting telemetry ping:', err);
    }
  }

  return record;
}

export async function getLastHourlyPingTimestamp(
  projectId: string
): Promise<number | null> {
  const db = await getDatabase();
  if (db) {
    try {
      const row = await db.getFirstAsync<{ captured_at: string }>(
        `SELECT captured_at FROM site_telemetry_pings
         WHERE project_id = ? AND ping_source = 'HOURLY_TELEMETRY'
         ORDER BY captured_at DESC LIMIT 1`,
        [projectId]
      );
      if (row?.captured_at) {
        return new Date(row.captured_at).getTime();
      }
    } catch (err) {
      console.warn('SQLite error reading last telemetry ping:', err);
    }
  }

  const memMatch = memTelemetryPings.find(
    (p) => p.projectId === projectId && p.pingSource === 'HOURLY_TELEMETRY'
  );
  return memMatch ? new Date(memMatch.capturedAt).getTime() : null;
}

export async function getUnsyncedTelemetryPings(
  projectId: string
): Promise<SiteTelemetryPingRecord[]> {
  const db = await getDatabase();
  if (db) {
    try {
      const rows = await db.getAllAsync<any>(
        `SELECT * FROM site_telemetry_pings
         WHERE project_id = ? AND synced_at IS NULL
         ORDER BY captured_at ASC`,
        [projectId]
      );
      return rows.map((r) => ({
        id: r.id,
        projectId: r.project_id,
        wbsItemId: r.wbs_item_id,
        latitude: r.latitude,
        longitude: r.longitude,
        accuracyMeters: r.accuracy_meters,
        altitudeMeters: r.altitude_meters,
        isMocked: Boolean(r.is_mocked),
        isWithinGeofence:
          r.is_within_geofence === null ? null : Boolean(r.is_within_geofence),
        chainageLabel: r.chainage_label,
        distanceMeters: r.distance_meters,
        pingSource: r.ping_source,
        deviceSignatureHash: r.device_signature_hash,
        capturedAt: r.captured_at,
        syncedAt: r.synced_at,
      }));
    } catch (err) {
      console.warn('SQLite error loading unsynced telemetry pings:', err);
    }
  }

  return memTelemetryPings.filter(
    (p) => p.projectId === projectId && !p.syncedAt
  );
}

export async function markTelemetryPingsSynced(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const syncedAt = new Date().toISOString();

  memTelemetryPings = memTelemetryPings.map((p) =>
    ids.includes(p.id) ? { ...p, syncedAt } : p
  );

  const db = await getDatabase();
  if (db) {
    try {
      const placeholders = ids.map(() => '?').join(', ');
      await db.runAsync(
        `UPDATE site_telemetry_pings SET synced_at = ? WHERE id IN (${placeholders})`,
        [syncedAt, ...ids]
      );
    } catch (err) {
      console.warn('SQLite error marking telemetry pings synced:', err);
    }
  }
}

