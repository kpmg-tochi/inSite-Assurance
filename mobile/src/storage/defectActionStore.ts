import { getDb, newId } from './db/database';
import { enqueue, findOpenRowId } from './outbox/outboxStore';
import { kickOutbox } from './outbox/outboxProcessor';
import { defectActionBody, type DefectActionPayload } from '../utils/defects';

/**
 * Phase 10: a defect verify action (close with photos, or reopen) queued in the one outbox. The action
 * lives in the outbox row's payload; it waits for every photo it links that is still being sent,
 * so the server always finds the captures by their clientCaptureId.
 */
export async function queueDefectAction(projectId: string, payload: DefectActionPayload): Promise<string> {
  // Fail fast on the device with the same rule the server applies.
  defectActionBody(payload);
  const db = await getDb();
  const entityId = newId();
  await db.withTransactionAsync(async () => {
    const dependsOn: string[] = [];
    for (const id of payload.captureIds) {
      const open = await findOpenRowId(db, 'CAPTURE', id);
      if (open) dependsOn.push(open);
    }
    await enqueue(db, {
      projectId,
      kind: 'DEFECT_ACTION',
      entityId,
      payload: payload as unknown as Record<string, unknown>,
      dependsOn,
    });
  });
  kickOutbox();
  return entityId;
}
