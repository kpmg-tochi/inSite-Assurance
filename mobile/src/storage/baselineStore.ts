import { getCachedBaselinePack, saveBaselinePack, type MobileBaselinePack } from '../config/apiConfig';
import { getDb, nowIso } from './db/database';

/**
 * The project baseline (geofence and BOQ pack) persisted in SQLite, so geofence checks still work
 * after an app restart or offline. The in-memory copy in apiConfig is a cache of this table.
 */

export async function persistBaselinePack(pack: MobileBaselinePack): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO project_baseline (project_id, json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    [pack.projectId, JSON.stringify(pack), nowIso()]
  );
}

/** Loads the stored pack into the in-memory cache. Returns null if none is stored. */
export async function hydrateBaselinePack(projectId: string): Promise<MobileBaselinePack | null> {
  const cached = getCachedBaselinePack();
  if (cached?.projectId === projectId) return cached;
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>(
    'SELECT json FROM project_baseline WHERE project_id = ?',
    [projectId]
  );
  if (!row) return null;
  const pack = JSON.parse(row.json) as MobileBaselinePack;
  saveBaselinePack(pack);
  return pack;
}
