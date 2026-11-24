import type { MobileBaselinePack } from '@insite/shared';
import { getActiveProjectId } from '../config/authRegistry';
import { getDb, nowIso } from './db/database';
import { emitVisitDataChanged } from './visitEvents';
import { normaliseBaselinePack } from '../utils/baselinePack';

/**
 * Project baseline packs (geofence, time zone, sprints, units, open findings), one per project, persisted in SQLite so
 * geofence checks work after a restart and offline (Phase 4). Phase 5: there is no single global
 * pack any more; packs are loaded per project and kept in a small in-memory map.
 */

const loaded = new Map<string, MobileBaselinePack>();

export async function persistBaselinePack(raw: MobileBaselinePack): Promise<void> {
  const pack = normaliseBaselinePack(raw);
  loaded.set(pack.projectId, pack);
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO project_baseline (project_id, json, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at`,
    [pack.projectId, JSON.stringify(pack), nowIso()]
  );
  emitVisitDataChanged('packs');
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
  // Redesign R5a: packs stored before R5 get the v2 fields with empty values.
  const pack = normaliseBaselinePack(JSON.parse(row.json) as MobileBaselinePack);
  loaded.set(projectId, pack);
  return pack;
}

/** The pack already in memory for a project (the active project by default). */
export function getLoadedBaselinePack(projectId: string | null = getActiveProjectId()): MobileBaselinePack | null {
  return projectId ? loaded.get(projectId) ?? null : null;
}

/** Removes the given projects' packs (sign-out) or all of them (reset). */
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

/** Redesign R5a: the stored packs of several projects (Home's project cards); projects without one are absent. */
export async function loadBaselinePacks(projectIds: string[]): Promise<Map<string, MobileBaselinePack>> {
  const out = new Map<string, MobileBaselinePack>();
  for (const id of projectIds) {
    const pack = await hydrateBaselinePack(id).catch(() => null);
    if (pack) out.set(id, pack);
  }
  return out;
}
