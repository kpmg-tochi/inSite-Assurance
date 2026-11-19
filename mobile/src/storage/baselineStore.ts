import type { MobileBaselinePack } from '@insite/shared';
import { getActiveProjectId } from '../config/authRegistry';
import { getDb, nowIso } from './db/database';

/**
 * Project baselines (geofence, BOQ pack, time zone), one per project, persisted in SQLite so
 * geofence checks work after a restart and offline (Phase 4). Phase 5: there is no single global
 * pack any more; packs are loaded per project and kept in a small in-memory map.
 */

const loaded = new Map<string, MobileBaselinePack>();

export async function persistBaselinePack(pack: MobileBaselinePack): Promise<void> {
  loaded.set(pack.projectId, pack);
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO project_baseline (project_id, json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    [pack.projectId, JSON.stringify(pack), nowIso()]
  );
}

/** Loads a project's stored pack into memory. Returns null if none is stored yet. */
export async function hydrateBaselinePack(projectId: string): Promise<MobileBaselinePack | null> {
  const cached = loaded.get(projectId);
  if (cached) return cached;
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>(
    'SELECT json FROM project_baseline WHERE project_id = ?',
    [projectId]
  );
  if (!row) return null;
  const pack = JSON.parse(row.json) as MobileBaselinePack;
  loaded.set(projectId, pack);
  return pack;
}

/** The pack already in memory for a project (the active project by default). */
export function getLoadedBaselinePack(projectId: string | null = getActiveProjectId()): MobileBaselinePack | null {
  return projectId ? loaded.get(projectId) ?? null : null;
}

/** Removes one project's pack (leaving a join-code project) or all of them (sign-out, reset). */
export async function deleteBaselinePacks(projectIds?: string[]): Promise<void> {
  const db = await getDb();
  if (!projectIds) {
    loaded.clear();
    await db.runAsync('DELETE FROM project_baseline');
    return;
  }
  for (const id of projectIds) {
    loaded.delete(id);
    await db.runAsync('DELETE FROM project_baseline WHERE project_id = ?', [id]);
  }
}
