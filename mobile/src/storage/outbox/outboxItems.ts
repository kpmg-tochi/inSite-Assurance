import { getDb } from '../db/database';
import { deleteStoppedRows, listOpenRows } from './outboxStore';
import { refreshOutboxCounts } from './outboxProcessor';
import { outboxItemActions, type OutboxItem } from '../../utils/outboxView';
import type { VisitDraftStatus } from '../../utils/visitModel';
import { deleteDraft, discardFailedResponse } from '../visitStore';
import { discardIncident } from '../incidentStore';
import { removeHeldCapture, resendHeldCapture } from '../heldItems';
import { deleteVerificationDraft, verificationDraftStatuses } from '../needsVerificationStore';

/**
 * Redesign R5e: the Outbox screen's reads and its removals. What may be removed is decided by the
 * pure `outboxItemActions`; this file only carries it out with the store that owns the record.
 */

function placeholders(n: number): string {
  return new Array(n).fill('?').join(',');
}

/** Every open row (waiting, failed, held) with the local facts the screen shows. */
export async function listOutboxItems(): Promise<OutboxItem[]> {
  const rows = await listOpenRows();
  const db = await getDb();
  const captureIds = rows.filter((r) => r.kind === 'CAPTURE').map((r) => r.entityId);
  const draftIds = rows.filter((r) => r.kind === 'VISIT_SUBMISSION').map((r) => r.entityId);
  const mediaTypes = new Map<string, string>();
  if (captureIds.length) {
    const found = await db.getAllAsync<{ id: string; media_type: string }>(
      `SELECT id, media_type FROM captures WHERE id IN (${placeholders(captureIds.length)})`,
      captureIds
    );
    for (const c of found) mediaTypes.set(c.id, c.media_type);
  }
  const draftStatuses = new Map<string, VisitDraftStatus>();
  if (draftIds.length) {
    const found = await db.getAllAsync<{ id: string; status: string }>(
      `SELECT id, status FROM visit_drafts WHERE id IN (${placeholders(draftIds.length)})`,
      draftIds
    );
    for (const d of found) draftStatuses.set(d.id, d.status as VisitDraftStatus);
  }
  // Needs pipeline wave 5: verification drafts have the same statuses.
  const verificationDraftIds = rows.filter((r) => r.kind === 'NEEDS_VERIFICATION_SUBMISSION').map((r) => r.entityId);
  for (const [id, status] of await verificationDraftStatuses(verificationDraftIds)) draftStatuses.set(id, status);
  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    kind: r.kind,
    entityId: r.entityId,
    status: r.status,
    attempts: r.attempts,
    lastError: r.lastError,
    createdAt: r.createdAt,
    dependsOn: r.dependsOn,
    mediaType: r.kind === 'CAPTURE' ? mediaTypes.get(r.entityId) ?? null : null,
    draftStatus: r.kind === 'VISIT_SUBMISSION' || r.kind === 'NEEDS_VERIFICATION_SUBMISSION' ? draftStatuses.get(r.entityId) ?? null : null,
    visitId: r.kind === 'VISIT_RESPONSE' && typeof r.payload.visitId === 'string' ? r.payload.visitId : null,
  }));
}

/** Removes a row the rules allow to be removed (no-op otherwise). */
export async function removeOutboxItem(item: OutboxItem): Promise<void> {
  const action = outboxItemActions(item).remove;
  switch (action) {
    case 'DELETE_REFUSED_REPORT':
      await deleteDraft(item.entityId);
      break;
    case 'DELETE_REFUSED_VERIFICATION':
      await deleteVerificationDraft(item.entityId);
      break;
    case 'DISCARD_RESPONSE':
      if (item.visitId) await discardFailedResponse(item.visitId, item.entityId);
      break;
    case 'DISCARD_DEFECT_UPDATE': {
      const db = await getDb();
      await deleteStoppedRows(db, 'DEFECT_ACTION', item.entityId);
      break;
    }
    case 'DISCARD_INCIDENT':
      await discardIncident(item.entityId);
      break;
    case 'REMOVE_HELD_CAPTURE':
      await removeHeldCapture(item.entityId);
      break;
    default:
      return;
  }
  await refreshOutboxCounts();
}

/** A held photo or voice note: re-validated for the current session and queued again. */
export async function resendHeldItem(item: OutboxItem): Promise<void> {
  if (!outboxItemActions(item).resendHeld) return;
  await resendHeldCapture(item.entityId);
  await refreshOutboxCounts();
}
