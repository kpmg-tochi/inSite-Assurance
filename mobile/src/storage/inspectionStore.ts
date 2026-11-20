import type { SubmitSiteInspectionRequestInput } from '@insite/shared';
import { getDb, newId, nowIso } from './db/database';
import { enqueue, findOpenRowId } from './outbox/outboxStore';
import { kickOutbox } from './outbox/outboxProcessor';
import {
  findingResolutionBody,
  inspectionDependsOn,
  type FindingResolutionPayload,
  type InspectionDraft,
} from '../utils/inspections';

/**
 * Phase 14: site inspection drafts and their queueing. A draft is saved on every change so it
 * survives an app restart; confirming turns it into one SITE_INSPECTION outbox row that waits for
 * every photo still being sent. Finding resolutions are FINDING_RESOLUTION rows behind their photos.
 */

type Row = { id: string; project_id: string; status: string; draft_json: string; request_json: string | null; server_id: string | null; last_error: string | null };

export async function saveInspectionDraft(draft: InspectionDraft): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO inspection_drafts (id, project_id, status, draft_json, updated_at) VALUES (?, ?, 'DRAFT', ?, ?)
     ON CONFLICT(id) DO UPDATE SET draft_json = excluded.draft_json, updated_at = excluded.updated_at WHERE status = 'DRAFT'`,
    [draft.id, draft.projectId, JSON.stringify(draft), nowIso()]
  );
}

/** The project's open draft (the latest), or null. */
export async function loadOpenInspectionDraft(projectId: string): Promise<InspectionDraft | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>(
    `SELECT * FROM inspection_drafts WHERE project_id = ? AND status = 'DRAFT' ORDER BY updated_at DESC LIMIT 1`,
    [projectId]
  );
  return row ? (JSON.parse(row.draft_json) as InspectionDraft) : null;
}

export async function discardInspectionDraft(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`DELETE FROM inspection_drafts WHERE id = ? AND status = 'DRAFT'`, [id]);
}

/** Confirms a draft: stores the request and queues it behind its photos, in one transaction. */
export async function queueInspection(draft: InspectionDraft, request: SubmitSiteInspectionRequestInput): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const captureIds = request.answers.flatMap((a) => a.clientCaptureIds ?? []);
    const open = new Map<string, string | null>();
    for (const id of captureIds) open.set(id, await findOpenRowId(db, 'CAPTURE', id));
    await db.runAsync(
      `UPDATE inspection_drafts SET status = 'QUEUED', draft_json = ?, request_json = ?, updated_at = ? WHERE id = ?`,
      [JSON.stringify(draft), JSON.stringify(request), nowIso(), draft.id]
    );
    await enqueue(db, {
      projectId: draft.projectId,
      kind: 'SITE_INSPECTION',
      entityId: draft.id,
      dependsOn: inspectionDependsOn(captureIds, (id) => open.get(id) ?? null),
    });
  });
  kickOutbox();
}

export async function getQueuedInspection(id: string): Promise<{ projectId: string; status: string; request: SubmitSiteInspectionRequestInput | null } | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<Row>(`SELECT * FROM inspection_drafts WHERE id = ?`, [id]);
  if (!row) return null;
  return { projectId: row.project_id, status: row.status, request: row.request_json ? JSON.parse(row.request_json) : null };
}

export async function markInspectionSent(id: string, serverId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE inspection_drafts SET status = 'SENT', server_id = ?, last_error = NULL, updated_at = ? WHERE id = ?`, [serverId, nowIso(), id]);
}

/** Inspections confirmed on this device for a project, newest first (status only). */
export async function listDeviceInspections(projectId: string): Promise<Array<{ id: string; status: string; visitType: string; visitDate: string }>> {
  const db = await getDb();
  const rows = await db.getAllAsync<Row>(
    `SELECT * FROM inspection_drafts WHERE project_id = ? AND status != 'DRAFT' ORDER BY updated_at DESC LIMIT 20`,
    [projectId]
  );
  return rows.map((r) => {
    const d = JSON.parse(r.draft_json) as InspectionDraft;
    return { id: r.id, status: r.status, visitType: d.visitType, visitDate: d.visitDate };
  });
}

/** A finding resolution, queued behind its photos (the action lives in the outbox payload). */
export async function queueFindingResolution(projectId: string, payload: FindingResolutionPayload): Promise<string> {
  findingResolutionBody(payload);
  const db = await getDb();
  const entityId = newId();
  await db.withTransactionAsync(async () => {
    const dependsOn: string[] = [];
    for (const id of payload.captureIds) {
      const open = await findOpenRowId(db, 'CAPTURE', id);
      if (open) dependsOn.push(open);
    }
    await enqueue(db, { projectId, kind: 'FINDING_RESOLUTION', entityId, payload: payload as unknown as Record<string, unknown>, dependsOn });
  });
  kickOutbox();
  return entityId;
}
