import {
  sprintForDate,
  type HeadingReading,
  type MyVisitsFeedDto,
  type ProjectGeofence,
  type SubmissionGeotagInput,
  type VisitCheckInRequestInput,
  type VisitDetailDto,
  type VisitDto,
  type VisitFieldPackDto,
  type VisitFormDto,
  type VisitFormSnapshot,
  type VisitSubmissionDto,
} from '@insite/shared';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb, newId, nowIso } from './db/database';
import { deleteStoppedRows, enqueue, latestRowFor, openRowLookup } from './outbox/outboxStore';
import { kickOutbox } from './outbox/outboxProcessor';
import { checkInDependsOn, visitSubmissionDependsOn, type OutboxStatus } from './outbox/outboxPolicy';
import { getCaptures } from './captureStore';
import { hydrateBaselinePack } from './baselineStore';
import { emitVisitDataChanged } from './visitEvents';
import { previewGeofence, type GeofencePreview, type LocationFix } from '../services/locationService';
import { geotagFromFix } from '../utils/headingReadings';
import {
  EMPTY_VISIT_LOCAL_STATE,
  localSnapshotId,
  localUnscheduledVisitDto,
  parseLocalState,
  type MoveWindow,
  type StoredVisit,
  type StoredVisitDraft,
  type VisitDraft,
  type VisitDraftStatus,
  type VisitLocalState,
} from '../utils/visitModel';
import { buildRespondRequest, responseProblem, type ResponseInput } from '../utils/visitResponses';
import {
  answerCaptureIds,
  answersFromReturnedSubmission,
  buildAdHocForm,
  buildQueuedSubmission,
  checkDraft,
  formChangeKind,
  remapDraftOntoSnapshot,
  type DroppedAnswer,
  type PhoneCaptureFact,
  type QueuedVisitSubmission,
} from '../utils/visitForm';

/**
 * Redesign R5a: visits, their frozen forms, the Ad hoc field packs and visit drafts on the phone
 * (D-R5.4, D-R5.8, D-R5.9). Visit data is downloaded, not computed: the feed is stored as received
 * and the phone only layers what it has not sent yet (`VisitLocalState`). Every write that must reach
 * the server is a row in the one outbox, queued in the same transaction as the local change.
 * Every write emits a `visitEvents` topic so screens re-read.
 */

// ---------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------

type VisitRow = {
  id: string;
  server_id: string | null;
  project_id: string;
  planned_date: string;
  status: string;
  summary_json: string;
  form_snapshot_id: string | null;
  form_hash: string | null;
  server_updated_at: string | null;
  local_state_json: string;
  is_local: number;
  synced_at: string | null;
  created_at: string;
};

function mapVisit(r: VisitRow): StoredVisit {
  const summary = JSON.parse(r.summary_json) as { visit: VisitDto; moveWindow: MoveWindow | null };
  return {
    id: r.id,
    serverId: r.server_id,
    projectId: r.project_id,
    visit: summary.visit,
    moveWindow: summary.moveWindow ?? null,
    local: parseLocalState(r.local_state_json),
    isLocal: Boolean(r.is_local),
    syncedAt: r.synced_at,
  };
}

/** Visits on the phone, by date. Filters: a date range (planned date) and/or one project. */
export async function listVisits(filter: { from?: string; to?: string; projectId?: string } = {}): Promise<StoredVisit[]> {
  const db = await getDb();
  const where: string[] = [];
  const args: string[] = [];
  if (filter.from) {
    where.push('planned_date >= ?');
    args.push(filter.from);
  }
  if (filter.to) {
    where.push('planned_date <= ?');
    args.push(filter.to);
  }
  if (filter.projectId) {
    where.push('project_id = ?');
    args.push(filter.projectId);
  }
  const rows = await db.getAllAsync<VisitRow>(
    `SELECT * FROM visits ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY planned_date ASC, created_at ASC`,
    args
  );
  return rows.map(mapVisit);
}

/** A visit by its local key or its server id. */
export async function getVisit(id: string): Promise<StoredVisit | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<VisitRow>('SELECT * FROM visits WHERE id = ? OR server_id = ? LIMIT 1', [id, id]);
  return row ? mapVisit(row) : null;
}

async function getVisitRow(db: SQLiteDatabase, id: string): Promise<VisitRow | null> {
  return db.getFirstAsync<VisitRow>('SELECT * FROM visits WHERE id = ? OR server_id = ? LIMIT 1', [id, id]);
}

async function updateLocalState(db: SQLiteDatabase, id: string, fn: (s: VisitLocalState) => VisitLocalState): Promise<void> {
  const row = await getVisitRow(db, id);
  if (!row) return;
  const next = fn(parseLocalState(row.local_state_json));
  await db.runAsync('UPDATE visits SET local_state_json = ? WHERE id = ?', [JSON.stringify(next), row.id]);
}

/** The server would return a move window only while PLANNED and not checked in. */
function windowFor(dto: VisitDto, window: MoveWindow | null): MoveWindow | null {
  return dto.status === 'PLANNED' && !dto.checkInAt ? window : null;
}

const OPEN_STATUSES = ['PLANNED', 'IN_PROGRESS', 'RETURNED', 'MISSED'];

async function hasOpenWork(db: SQLiteDatabase, localId: string): Promise<boolean> {
  const draft = await db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM visit_drafts WHERE visit_id = ? AND status IN ('DRAFT', 'QUEUED')`, [localId]);
  return (draft?.n ?? 0) > 0;
}

/**
 * Stores a feed (R4 `GET /visits/mine`). A visit is overwritten when the server copy is at least as
 * new as the stored one (`updatedAt`). With `range`, visits the server no longer returns are removed
 * (in the range, or still open before it), except ones with an open draft: those are kept and marked
 * `removedFromFeedAt`. Unsent unscheduled visits are never removed.
 */
export async function upsertVisitFeed(feed: Pick<MyVisitsFeedDto, 'items'>, range: { from: string; to: string } | null): Promise<{ changed: number; removed: number }> {
  const db = await getDb();
  const now = nowIso();
  let changed = 0;
  let removed = 0;
  await db.withTransactionAsync(async () => {
    const seen = new Set<string>();
    for (const item of feed.items) {
      const dto = item.visit;
      seen.add(dto.id);
      const summary = JSON.stringify({ visit: dto, moveWindow: windowFor(dto, item.moveWindow) });
      const existing = await db.getFirstAsync<VisitRow>('SELECT * FROM visits WHERE server_id = ? OR id = ? LIMIT 1', [dto.id, dto.id]);
      if (!existing) {
        await db.runAsync(
          `INSERT INTO visits (id, server_id, project_id, planned_date, status, summary_json, form_snapshot_id, form_hash,
             server_updated_at, local_state_json, is_local, synced_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
          [dto.id, dto.id, dto.projectId, dto.plannedDate, dto.status, summary, dto.formSnapshotId, dto.formHash, dto.updatedAt, JSON.stringify(EMPTY_VISIT_LOCAL_STATE), now, now]
        );
        changed++;
        continue;
      }
      if (!existing.server_updated_at || dto.updatedAt >= existing.server_updated_at) {
        const local = parseLocalState(existing.local_state_json);
        await db.runAsync(
          `UPDATE visits SET project_id = ?, planned_date = ?, status = ?, summary_json = ?, form_snapshot_id = ?, form_hash = ?,
             server_updated_at = ?, local_state_json = ?, synced_at = ? WHERE id = ?`,
          [dto.projectId, dto.plannedDate, dto.status, summary, dto.formSnapshotId, dto.formHash, dto.updatedAt, JSON.stringify({ ...local, removedFromFeedAt: null }), now, existing.id]
        );
        changed++;
      } else {
        await db.runAsync('UPDATE visits SET synced_at = ? WHERE id = ?', [now, existing.id]);
      }
    }
    if (range) {
      const candidates = await db.getAllAsync<VisitRow>(
        `SELECT * FROM visits WHERE server_id IS NOT NULL AND ((planned_date >= ? AND planned_date <= ?) OR (planned_date < ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})))`,
        [range.from, range.to, range.from, ...OPEN_STATUSES]
      );
      for (const r of candidates) {
        if (seen.has(r.server_id!)) continue;
        if (await hasOpenWork(db, r.id)) {
          const local = parseLocalState(r.local_state_json);
          if (!local.removedFromFeedAt) {
            await db.runAsync('UPDATE visits SET local_state_json = ? WHERE id = ?', [JSON.stringify({ ...local, removedFromFeedAt: now }), r.id]);
          }
          continue;
        }
        await db.runAsync('DELETE FROM visits WHERE id = ?', [r.id]);
        removed++;
      }
    }
  });
  if (changed || removed) emitVisitDataChanged('visits');
  return { changed, removed };
}

/** Stores a visit the server returned after a response or check-in (or a later read). */
export async function applyServerVisit(localOrServerId: string, dto: VisitDto): Promise<void> {
  const db = await getDb();
  const row = await getVisitRow(db, localOrServerId);
  if (!row) return;
  const current = JSON.parse(row.summary_json) as { moveWindow: MoveWindow | null };
  if (row.server_updated_at && dto.updatedAt < row.server_updated_at) return;
  await db.runAsync(
    `UPDATE visits SET planned_date = ?, status = ?, summary_json = ?, form_snapshot_id = ?, form_hash = ?, server_updated_at = ?, synced_at = ? WHERE id = ?`,
    [dto.plannedDate, dto.status, JSON.stringify({ visit: dto, moveWindow: windowFor(dto, current.moveWindow ?? null) }), dto.formSnapshotId, dto.formHash, dto.updatedAt, nowIso(), row.id]
  );
  emitVisitDataChanged('visits');
}

// ---------------------------------------------------------------------------
// Responses (D-R5.11)
// ---------------------------------------------------------------------------

/**
 * Queues Confirm / Move / Propose / Decline (VISIT_RESPONSE) and shows it as "Waiting to send".
 * Throws an Error with the person-facing problem when the response is not valid now.
 */
export async function queueVisitResponse(
  visitId: string,
  input: ResponseInput,
  ctx: { today: string; canSubmit: boolean; workWeekDays?: number[] | null }
): Promise<string> {
  const v = await getVisit(visitId);
  if (!v) throw new Error('This monitoring visit is no longer on the phone. Refresh your monitoring visits.');
  const problem = responseProblem(v, input, ctx);
  if (problem) throw new Error(problem);
  const clientActionId = newId();
  const body = buildRespondRequest(clientActionId, input);
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await updateLocalState(db, v.id, (s) => ({
      ...s,
      responseError: null,
      pendingResponse: { clientActionId, action: body.action, date: body.date ?? null, comment: body.comment ?? null, queuedAt: nowIso() },
    }));
    await enqueue(db, { projectId: v.projectId, kind: 'VISIT_RESPONSE', entityId: clientActionId, payload: { visitId: v.id, body } });
  });
  emitVisitDataChanged('visits');
  kickOutbox();
  return clientActionId;
}

/** Handler: the server accepted the response. */
export async function completeVisitResponse(visitId: string, clientActionId: string, dto: VisitDto): Promise<void> {
  const db = await getDb();
  await updateLocalState(db, visitId, (s) => (s.pendingResponse?.clientActionId === clientActionId ? { ...s, pendingResponse: null, responseError: null } : s));
  await applyServerVisit(visitId, dto);
  emitVisitDataChanged('visits');
}

/** Handler: the server refused the response for good; the overlay goes and the message stays. */
export async function failVisitResponse(visitId: string, clientActionId: string, message: string): Promise<void> {
  const db = await getDb();
  await updateLocalState(db, visitId, (s) => {
    if (s.pendingResponse?.clientActionId !== clientActionId) return s;
    return { ...s, pendingResponse: null, responseError: { clientActionId, action: s.pendingResponse.action, message, at: nowIso() } };
  });
  emitVisitDataChanged('visits');
}

/**
 * Redesign R5e (Outbox screen): removes a response that stopped sending. Its stopped outbox row goes,
 * and so do the "Waiting to send" overlay and the error it left; the visit keeps the server's state.
 */
export async function discardFailedResponse(visitId: string, clientActionId: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await deleteStoppedRows(db, 'VISIT_RESPONSE', clientActionId);
    await updateLocalState(db, visitId, (s) => ({
      ...s,
      pendingResponse: s.pendingResponse?.clientActionId === clientActionId ? null : s.pendingResponse,
      responseError: s.responseError?.clientActionId === clientActionId ? null : s.responseError,
    }));
  });
  emitVisitDataChanged('visits');
}

/** Clears a shown response error (the person dismissed it). */
export async function dismissResponseError(visitId: string): Promise<void> {
  const db = await getDb();
  await updateLocalState(db, visitId, (s) => ({ ...s, responseError: null }));
  emitVisitDataChanged('visits');
}

// ---------------------------------------------------------------------------
// Check-in (D-R5.18)
// ---------------------------------------------------------------------------

/**
 * Checks in on this phone (VISIT_CHECK_IN, behind the unscheduled visit when there is one). The fix
 * may be null (no location): the server flags it, never refuses. Returns the clientCheckInId; a second
 * call returns the first check-in's id.
 */
export async function queueCheckIn(
  visitId: string,
  input: { fix: LocationFix | null; heading?: HeadingReading | null; preview?: GeofencePreview | null; checkedInAt?: string }
): Promise<string> {
  const v = await getVisit(visitId);
  if (!v) throw new Error('This monitoring visit is no longer on the phone. Refresh your monitoring visits.');
  if (v.local.checkIn) return v.local.checkIn.clientCheckInId;
  const clientCheckInId = newId();
  const checkedInAt = input.checkedInAt ?? nowIso();
  const fix = input.fix;
  const preview = input.preview ?? (fix ? previewGeofence(fix, v.projectId) : null);
  const body: VisitCheckInRequestInput = {
    clientCheckInId,
    checkedInAt,
    geotag: geotagFromFix(fix, input.heading ?? null),
  };
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const lookup = await openRowLookup(db, [['UNSCHEDULED_VISIT', v.isLocal ? v.id : null]]);
    await updateLocalState(db, v.id, (s) => ({
      ...s,
      checkIn: {
        clientCheckInId,
        checkedInAt,
        latitude: fix?.latitude ?? null,
        longitude: fix?.longitude ?? null,
        accuracyMeters: fix?.accuracyMeters ?? null,
        isMocked: fix?.isMocked ?? false,
        heading: fix ? (input.heading ?? null) : null,
        geofenceStatus: preview?.status ?? null,
        distanceOutsideMeters: preview?.distanceOutsideMeters ?? null,
        sent: false,
      },
    }));
    await enqueue(db, {
      projectId: v.projectId,
      kind: 'VISIT_CHECK_IN',
      entityId: clientCheckInId,
      payload: { visitId: v.id, body },
      dependsOn: checkInDependsOn({ unscheduledVisitId: v.isLocal ? v.id : null }, lookup),
    });
  });
  emitVisitDataChanged('visits');
  kickOutbox();
  return clientCheckInId;
}

/** The check-in request a submission carries along (the server records it only when the visit has none). */
export function checkInRequestFor(v: StoredVisit): VisitCheckInRequestInput | null {
  const c = v.local.checkIn;
  if (!c) return null;
  return {
    clientCheckInId: c.clientCheckInId,
    checkedInAt: c.checkedInAt,
    geotag:
      c.latitude !== null && c.longitude !== null
        ? geotagFromFix({ latitude: c.latitude, longitude: c.longitude, accuracyMeters: c.accuracyMeters, isMocked: c.isMocked, capturedAt: c.checkedInAt }, c.heading ?? null)
        : null,
  };
}

/** Handler: the server has the check-in. */
export async function markCheckInSent(visitId: string, clientCheckInId: string, dto: VisitDto): Promise<void> {
  const db = await getDb();
  await updateLocalState(db, visitId, (s) => (s.checkIn?.clientCheckInId === clientCheckInId ? { ...s, checkIn: { ...s.checkIn, sent: true } } : s));
  await applyServerVisit(visitId, dto);
}

// ---------------------------------------------------------------------------
// Forms and field packs
// ---------------------------------------------------------------------------

/** A frozen form as kept on the phone (server forms: the VisitFormDto; phone-built Ad hoc: the same shape). */
export interface CachedVisitForm {
  /** The server snapshot id, or `local:<clientVisitId>` for an Ad hoc form the server has not stored yet. */
  formSnapshotId: string;
  formHash: string;
  snapshot: VisitFormSnapshot;
  geofence: ProjectGeofence | null;
  geofenceToleranceMeters: number | null;
}

export function cachedFormFromDto(dto: VisitFormDto): CachedVisitForm {
  return { formSnapshotId: dto.formSnapshotId, formHash: dto.formHash, snapshot: dto.snapshot, geofence: dto.geofence, geofenceToleranceMeters: dto.geofenceToleranceMeters };
}

export async function saveVisitForm(projectId: string, visitId: string | null, form: CachedVisitForm, db?: SQLiteDatabase): Promise<void> {
  const conn = db ?? (await getDb());
  await conn.runAsync(
    `INSERT INTO visit_forms (snapshot_id, form_hash, project_id, visit_id, json, downloaded_at) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(snapshot_id, form_hash) DO UPDATE SET visit_id = COALESCE(excluded.visit_id, visit_forms.visit_id), json = excluded.json, downloaded_at = excluded.downloaded_at`,
    [form.formSnapshotId, form.formHash, projectId, visitId, JSON.stringify(form), nowIso()]
  );
  if (!db) emitVisitDataChanged('forms');
}

export async function hasCachedForm(snapshotId: string, formHash: string): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM visit_forms WHERE snapshot_id = ? AND form_hash = ?', [snapshotId, formHash]);
  return (row?.n ?? 0) > 0;
}

export async function getCachedForm(snapshotId: string, formHash: string): Promise<CachedVisitForm | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM visit_forms WHERE snapshot_id = ? AND form_hash = ?', [snapshotId, formHash]);
  return row ? (JSON.parse(row.json) as CachedVisitForm) : null;
}

/** A form of a visit by its hash (the draft's form, which may be older than the visit's current one). */
export async function getVisitFormByHash(visitId: string, formHash: string): Promise<CachedVisitForm | null> {
  const db = await getDb();
  const v = await getVisitRow(db, visitId);
  const ids = [visitId, v?.id, v?.server_id].filter((x): x is string => Boolean(x));
  const row = await db.getFirstAsync<{ json: string }>(
    `SELECT json FROM visit_forms WHERE form_hash = ? AND (visit_id IN (${ids.map(() => '?').join(',')}) OR snapshot_id = ?) ORDER BY downloaded_at DESC LIMIT 1`,
    [formHash, ...ids, v?.form_snapshot_id ?? '']
  );
  return row ? (JSON.parse(row.json) as CachedVisitForm) : null;
}

/** The visit's current form (its `formSnapshotId` + `formHash`), when on the phone. Null while PROPOSED or not downloaded. */
export async function getVisitForm(visitId: string): Promise<CachedVisitForm | null> {
  const v = await getVisit(visitId);
  if (!v?.visit.formHash) return null;
  const snapshotId = v.visit.formSnapshotId ?? localSnapshotId(v.id);
  return (await getCachedForm(snapshotId, v.visit.formHash)) ?? getVisitFormByHash(v.id, v.visit.formHash);
}

/** Deletes forms no visit or draft refers to any more. */
export async function pruneUnusedForms(): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync(
    `DELETE FROM visit_forms WHERE
       NOT EXISTS (SELECT 1 FROM visits v WHERE v.form_hash = visit_forms.form_hash)
       AND NOT EXISTS (SELECT 1 FROM visit_drafts d WHERE d.form_hash = visit_forms.form_hash AND d.status != 'SENT')`
  );
  return r.changes;
}

export async function saveFieldPack(pack: VisitFieldPackDto): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO visit_field_packs (project_id, json, generated_at, downloaded_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET json = excluded.json, generated_at = excluded.generated_at, downloaded_at = excluded.downloaded_at`,
    [pack.projectId, JSON.stringify(pack), pack.generatedAt, nowIso()]
  );
  emitVisitDataChanged('fieldPacks');
}

export async function getFieldPack(projectId: string): Promise<VisitFieldPackDto | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM visit_field_packs WHERE project_id = ?', [projectId]);
  return row ? (JSON.parse(row.json) as VisitFieldPackDto) : null;
}

export async function getFieldPackDownloadedAt(projectId: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ downloaded_at: string }>('SELECT downloaded_at FROM visit_field_packs WHERE project_id = ?', [projectId]);
  return row?.downloaded_at ?? null;
}

// ---------------------------------------------------------------------------
// Unscheduled (Ad hoc) visits (D-R5.12)
// ---------------------------------------------------------------------------

/**
 * Creates an Ad hoc visit fully offline from the project's cached field pack: the visit row (local
 * key = clientVisitId), its phone-built form (stored as `local:<clientVisitId>`) and an
 * UNSCHEDULED_VISIT outbox row. Check in and fill it like any visit; its check-in and submission wait
 * for this row. `visitDate` is today in the project zone (the server accepts today or tomorrow).
 */
export async function createUnscheduledVisit(params: {
  projectId: string;
  pickedFacilityIds: string[];
  visitDate: string;
  user: { userId: string; fullName: string };
  recheckScope?: 'PICKED_FACILITIES' | 'ALL';
}): Promise<{ visitId: string; formHash: string; warnings: string[] }> {
  if (params.pickedFacilityIds.length === 0) throw new Error('Pick at least one facility.');
  const fieldPack = await getFieldPack(params.projectId);
  if (!fieldPack) throw new Error('The forms for this project are not on the phone yet. Connect once to download them.');
  const pack = await hydrateBaselinePack(params.projectId);
  const builtAt = nowIso();
  const form = buildAdHocForm(fieldPack, { visitDate: params.visitDate, builtAt, pickedFacilityIds: params.pickedFacilityIds, recheckScope: params.recheckScope });
  const clientVisitId = newId();
  const sprint = sprintForDate(fieldPack.bundle.sprints, params.visitDate);
  const facilityCount = form.snapshot.blocks.filter((b) => b.kind === 'FACILITY').length;
  const dto = localUnscheduledVisitDto({
    clientVisitId,
    projectId: params.projectId,
    projectCode: pack?.codePrefix ?? '',
    projectName: pack?.name ?? '',
    plannedDate: params.visitDate,
    pickedFacilityIds: params.pickedFacilityIds,
    facilityCount,
    recheckCount: form.recheckIds.length,
    userId: params.user.userId,
    userName: params.user.fullName,
    formHash: form.formHash,
    sprint: sprint ? { id: sprint.id, number: sprint.number, name: sprint.name } : null,
    now: builtAt,
  });
  const body = {
    clientVisitId,
    visitKind: 'AD_HOC' as const,
    plannedDate: params.visitDate,
    pickedFacilityIds: params.pickedFacilityIds,
    components: form.components,
    recheckIds: form.recheckIds,
    formHash: form.formHash,
  };
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO visits (id, server_id, project_id, planned_date, status, summary_json, form_snapshot_id, form_hash,
         server_updated_at, local_state_json, is_local, synced_at, created_at)
       VALUES (?, NULL, ?, ?, 'PLANNED', ?, ?, ?, NULL, ?, 1, NULL, ?)`,
      [clientVisitId, params.projectId, params.visitDate, JSON.stringify({ visit: dto, moveWindow: null }), localSnapshotId(clientVisitId), form.formHash, JSON.stringify(EMPTY_VISIT_LOCAL_STATE), builtAt]
    );
    await saveVisitForm(
      params.projectId,
      clientVisitId,
      { formSnapshotId: localSnapshotId(clientVisitId), formHash: form.formHash, snapshot: form.snapshot, geofence: fieldPack.geofence, geofenceToleranceMeters: pack?.geofenceToleranceMeters ?? null },
      db
    );
    await enqueue(db, { projectId: params.projectId, kind: 'UNSCHEDULED_VISIT', entityId: clientVisitId, payload: { visitId: clientVisitId, body } });
  });
  emitVisitDataChanged('visits');
  kickOutbox();
  return { visitId: clientVisitId, formHash: form.formHash, warnings: form.warnings.map((w) => w.message) };
}

/** Handler: the server created the unscheduled visit (`dto.id` is its server id). */
export async function markUnscheduledVisitCreated(localId: string, dto: VisitDto): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    // A sync may have stored the server copy already: the phone's row wins (drafts point at it).
    await db.runAsync('DELETE FROM visits WHERE (server_id = ? OR id = ?) AND id != ?', [dto.id, dto.id, localId]);
    await db.runAsync(
      `UPDATE visits SET server_id = ?, planned_date = ?, status = ?, summary_json = ?, form_snapshot_id = ?, form_hash = ?, server_updated_at = ?, synced_at = ? WHERE id = ?`,
      [dto.id, dto.plannedDate, dto.status, JSON.stringify({ visit: dto, moveWindow: null }), dto.formSnapshotId, dto.formHash, dto.updatedAt, nowIso(), localId]
    );
    const local = await db.getFirstAsync<{ json: string; project_id: string }>('SELECT json, project_id FROM visit_forms WHERE snapshot_id = ?', [localSnapshotId(localId)]);
    if (local && dto.formSnapshotId && dto.formHash) {
      const form = JSON.parse(local.json) as CachedVisitForm;
      if (form.formHash === dto.formHash) {
        await saveVisitForm(local.project_id, localId, { ...form, formSnapshotId: dto.formSnapshotId }, db);
        await db.runAsync(
          `UPDATE visit_drafts SET form_snapshot_id = ? WHERE visit_id = ? AND form_snapshot_id IS NULL AND form_hash = ?`,
          [dto.formSnapshotId, localId, dto.formHash]
        );
      }
    }
  });
  emitVisitDataChanged('visits');
}

/** Handler: the server refused to create the unscheduled visit for good; its drafts cannot be sent. */
export async function markUnscheduledVisitRefused(localId: string, message: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await updateLocalState(db, localId, (s) => ({ ...s, createError: message, queuedSubmissionId: null }));
    await db.runAsync(`UPDATE visit_drafts SET status = 'REFUSED', last_error = ?, updated_at = ? WHERE visit_id = ? AND status IN ('DRAFT', 'QUEUED')`, [message, nowIso(), localId]);
  });
  emitVisitDataChanged('visits');
  emitVisitDataChanged('drafts');
}

// ---------------------------------------------------------------------------
// Drafts (D-R5.8, D-R5.19, D-R5.20)
// ---------------------------------------------------------------------------

type DraftRow = {
  id: string;
  visit_id: string;
  project_id: string;
  status: string;
  form_snapshot_id: string | null;
  form_hash: string;
  draft_json: string;
  request_json: string | null;
  server_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function mapDraft(r: DraftRow): StoredVisitDraft {
  const draft = JSON.parse(r.draft_json) as VisitDraft;
  return {
    draft: { ...draft, formSnapshotId: r.form_snapshot_id, formHash: r.form_hash },
    status: r.status as VisitDraftStatus,
    serverId: r.server_id,
    lastError: r.last_error,
    updatedAt: r.updated_at,
  };
}

export async function getDraft(id: string): Promise<StoredVisitDraft | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<DraftRow>('SELECT * FROM visit_drafts WHERE id = ?', [id]);
  return row ? mapDraft(row) : null;
}

/** The visit's draft being filled or waiting to send (at most one). */
export async function getOpenDraft(visitId: string): Promise<StoredVisitDraft | null> {
  const db = await getDb();
  const v = await getVisitRow(db, visitId);
  const row = await db.getFirstAsync<DraftRow>(`SELECT * FROM visit_drafts WHERE visit_id = ? AND status IN ('DRAFT', 'QUEUED') LIMIT 1`, [v?.id ?? visitId]);
  return row ? mapDraft(row) : null;
}

/** Every draft of a visit, newest first (sent and refused ones too). */
export async function listVisitDrafts(visitId: string): Promise<StoredVisitDraft[]> {
  const db = await getDb();
  const v = await getVisitRow(db, visitId);
  const rows = await db.getAllAsync<DraftRow>('SELECT * FROM visit_drafts WHERE visit_id = ? ORDER BY updated_at DESC', [v?.id ?? visitId]);
  return rows.map(mapDraft);
}

/** Drafts of a project still open or refused (for the outbox / project screens). */
export async function listUnsentDrafts(projectId?: string): Promise<StoredVisitDraft[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<DraftRow>(
    `SELECT * FROM visit_drafts WHERE status IN ('DRAFT', 'QUEUED', 'REFUSED') ${projectId ? 'AND project_id = ?' : ''} ORDER BY updated_at DESC`,
    projectId ? [projectId] : []
  );
  return rows.map(mapDraft);
}

/** Site log entry id → the open draft that attaches it (attachableEntries / pickablePhotosForField). */
export async function siteLogAttachmentsByDraft(): Promise<Map<string, string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<DraftRow>(`SELECT * FROM visit_drafts WHERE status IN ('DRAFT', 'QUEUED')`);
  const out = new Map<string, string>();
  for (const r of rows) for (const id of (JSON.parse(r.draft_json) as VisitDraft).siteLogEntryIds ?? []) out.set(id, r.id);
  return out;
}

async function insertDraft(db: SQLiteDatabase, draft: VisitDraft): Promise<void> {
  await db.runAsync(
    `INSERT INTO visit_drafts (id, visit_id, project_id, status, form_snapshot_id, form_hash, draft_json, created_at, updated_at)
     VALUES (?, ?, ?, 'DRAFT', ?, ?, ?, ?, ?)`,
    [draft.id, draft.visitId, draft.projectId, draft.formSnapshotId, draft.formHash, JSON.stringify(draft), draft.startedAt, draft.updatedAt]
  );
}

/**
 * The visit's open draft, or a new one bound to the visit's current form (the form must be on the
 * phone). The draft rides on the phone's check-in when there is one.
 */
export async function startDraft(
  visitId: string,
  opts: { answers?: VisitDraft['answers']; correctsSubmissionId?: string | null; overallFinding?: VisitDraft['overallFinding']; summaryText?: string; remap?: VisitDraft['remap'] } = {}
): Promise<StoredVisitDraft> {
  const existing = await getOpenDraft(visitId);
  if (existing) return existing;
  const v = await getVisit(visitId);
  if (!v) throw new Error('This monitoring visit is no longer on the phone. Refresh your monitoring visits.');
  const form = await getVisitForm(v.id);
  if (!form) throw new Error('The form for this monitoring visit is not on the phone yet. Connect once to download it.');
  const now = nowIso();
  const draft: VisitDraft = {
    id: newId(),
    visitId: v.id,
    projectId: v.projectId,
    formSnapshotId: form.formSnapshotId.startsWith('local:') ? null : form.formSnapshotId,
    formHash: form.formHash,
    answers: opts.answers ?? [],
    overallFinding: opts.overallFinding ?? null,
    summaryText: opts.summaryText ?? '',
    siteLogEntryIds: [],
    checkInId: v.local.checkIn?.clientCheckInId ?? null,
    correctsSubmissionId: opts.correctsSubmissionId ?? null,
    startedAt: now,
    updatedAt: now,
    remap: opts.remap ?? null,
  };
  const db = await getDb();
  await insertDraft(db, draft);
  emitVisitDataChanged('drafts');
  return { draft, status: 'DRAFT', serverId: null, lastError: null, updatedAt: now };
}

/** Saves the draft (call on every change). Only a draft still being filled can change. */
export async function saveDraft(draft: VisitDraft): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  const next = { ...draft, updatedAt: now };
  const r = await db.runAsync(
    `UPDATE visit_drafts SET draft_json = ?, form_snapshot_id = ?, form_hash = ?, updated_at = ? WHERE id = ? AND status = 'DRAFT'`,
    [JSON.stringify(next), next.formSnapshotId, next.formHash, now, draft.id]
  );
  if (r.changes === 0) throw new Error('This monitoring report was already submitted and can no longer change.');
  emitVisitDataChanged('drafts');
}

/** What the phone knows about captures, for photo slots and the D-R5.14 rule (server result first). */
export async function captureFactsFor(captureIds: string[], projectId: string): Promise<PhoneCaptureFact[]> {
  const captures = await getCaptures(captureIds);
  return captures.map((c) => ({
    clientCaptureId: c.id,
    hasFix: Boolean(c.fix),
    isMocked: c.fix?.isMocked ?? false,
    geofenceStatus: c.server?.geofenceStatus ?? (c.fix ? previewGeofence(c.fix, projectId).status : null),
  }));
}

/**
 * Submits the draft: checks it with the shared rules and the phone's capture facts (errors and photo
 * gaps block), stores the request (ids only) and queues VISIT_SUBMISSION behind its captures, its
 * check-in, its unscheduled visit and the site log entries it attaches. Throws the first problem.
 */
export async function queueVisitSubmission(
  draftId: string,
  opts: { confirmedAt?: string; submissionGeotag?: SubmissionGeotagInput | null } = {}
): Promise<void> {
  const stored = await getDraft(draftId);
  if (!stored) throw new Error('This monitoring report is no longer on the phone.');
  if (stored.status !== 'DRAFT') return;
  const draft = stored.draft;
  const v = await getVisit(draft.visitId);
  if (!v) throw new Error('This monitoring visit is no longer on the phone. Refresh your monitoring visits.');
  if (v.local.createError) throw new Error(v.local.createError);
  const form = await getVisitFormByHash(v.id, draft.formHash);
  if (!form) throw new Error('The form of this monitoring report is not on the phone any more. Refresh and start again.');
  const captureIds = answerCaptureIds(draft.answers);
  const facts = await captureFactsFor(captureIds, v.projectId);
  const check = checkDraft(form.snapshot, draft, facts);
  if (!check.canSubmit) throw new Error(check.issues[0]?.message ?? 'Some answers are missing.');
  const queued = buildQueuedSubmission(form.snapshot, draft, {
    confirmedAt: opts.confirmedAt ?? nowIso(),
    checkIn: checkInRequestFor(v),
    submissionGeotag: opts.submissionGeotag ?? null,
  });
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const lookup = await openRowLookup(db, [
      ['UNSCHEDULED_VISIT', v.isLocal ? v.id : null],
      ['VISIT_CHECK_IN', v.local.checkIn?.clientCheckInId],
      ...captureIds.map((id) => ['CAPTURE', id] as ['CAPTURE', string]),
      ...draft.siteLogEntryIds.map((id) => ['SITE_LOG_ENTRY', id] as ['SITE_LOG_ENTRY', string]),
    ]);
    const r = await db.runAsync(
      `UPDATE visit_drafts SET status = 'QUEUED', request_json = ?, last_error = NULL, updated_at = ? WHERE id = ? AND status = 'DRAFT'`,
      [JSON.stringify(queued), nowIso(), draft.id]
    );
    if (r.changes === 0) return;
    await updateLocalState(db, v.id, (s) => ({ ...s, queuedSubmissionId: draft.id }));
    await enqueue(db, {
      projectId: v.projectId,
      kind: 'VISIT_SUBMISSION',
      entityId: draft.id,
      payload: { visitId: v.id },
      dependsOn: visitSubmissionDependsOn(
        { captureIds, checkInId: v.local.checkIn?.clientCheckInId ?? null, unscheduledVisitId: v.isLocal ? v.id : null, siteLogEntryIds: draft.siteLogEntryIds },
        lookup
      ),
    });
  });
  emitVisitDataChanged('drafts');
  emitVisitDataChanged('visits');
  kickOutbox();
}

/** Handler: the queued request of a draft. */
export async function getQueuedSubmission(draftId: string): Promise<{ status: VisitDraftStatus; lastError: string | null; request: QueuedVisitSubmission | null; projectId: string } | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<DraftRow>('SELECT * FROM visit_drafts WHERE id = ?', [draftId]);
  if (!row) return null;
  return { status: row.status as VisitDraftStatus, lastError: row.last_error, request: row.request_json ? (JSON.parse(row.request_json) as QueuedVisitSubmission) : null, projectId: row.project_id };
}

/** Handler: the server accepted the submission (201 or a 200 replay). */
export async function markDraftSent(draftId: string, submission: VisitSubmissionDto): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<DraftRow>('SELECT * FROM visit_drafts WHERE id = ?', [draftId]);
    if (!row) return;
    await db.runAsync(`UPDATE visit_drafts SET status = 'SENT', server_id = ?, last_error = NULL, updated_at = ? WHERE id = ?`, [submission.id, nowIso(), draftId]);
    await updateLocalState(db, row.visit_id, (s) => (s.queuedSubmissionId === draftId ? { ...s, queuedSubmissionId: null } : s));
    const v = await getVisitRow(db, row.visit_id);
    if (v) {
      const summary = JSON.parse(v.summary_json) as { visit: VisitDto; moveWindow: MoveWindow | null };
      // What the server did with this request (status SUBMITTED, live submission); the next sync confirms.
      const visit: VisitDto = { ...summary.visit, status: 'SUBMITTED', liveSubmissionId: submission.id };
      await db.runAsync('UPDATE visits SET status = ?, summary_json = ? WHERE id = ?', ['SUBMITTED', JSON.stringify({ visit, moveWindow: null }), v.id]);
    }
    const draft = JSON.parse(row.draft_json) as VisitDraft;
    for (const entryId of draft.siteLogEntryIds ?? []) {
      await db.runAsync('UPDATE site_log_entries SET attached_submission_id = ?, updated_at = ? WHERE id = ?', [submission.id, nowIso(), entryId]);
    }
  });
  emitVisitDataChanged('drafts');
  emitVisitDataChanged('visits');
  emitVisitDataChanged('siteLog');
}

/** Handler: refused for good (FORM_SNAPSHOT_STALE, VISIT_ALREADY_SUBMITTED, ...). The draft stays on the phone. */
export async function markDraftRefused(draftId: string, message: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<DraftRow>('SELECT * FROM visit_drafts WHERE id = ?', [draftId]);
    if (!row) return;
    await db.runAsync(`UPDATE visit_drafts SET status = 'REFUSED', last_error = ?, updated_at = ? WHERE id = ?`, [message, nowIso(), draftId]);
    await updateLocalState(db, row.visit_id, (s) => (s.queuedSubmissionId === draftId ? { ...s, queuedSubmissionId: null } : s));
  });
  emitVisitDataChanged('drafts');
  emitVisitDataChanged('visits');
}

/** Records a send failure on a queued draft (the outbox row keeps retrying or is dead-lettered). */
export async function noteDraftError(draftId: string, message: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE visit_drafts SET last_error = ?, updated_at = ? WHERE id = ? AND status = 'QUEUED'`, [message, nowIso(), draftId]);
  emitVisitDataChanged('drafts');
}

/** Deletes a draft being filled or refused (with its stopped outbox rows). Queued and sent drafts stay. */
export async function deleteDraft(draftId: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await deleteStoppedRows(db, 'VISIT_SUBMISSION', draftId);
    await db.runAsync(`DELETE FROM visit_drafts WHERE id = ? AND status IN ('DRAFT', 'REFUSED')`, [draftId]);
  });
  emitVisitDataChanged('drafts');
}

/** The outbox state of a queued draft (WAITING / failed with its message), for the visit screen. */
export async function draftOutboxState(draftId: string): Promise<{ status: OutboxStatus; lastError: string | null; attempts: number } | null> {
  const row = await latestRowFor('VISIT_SUBMISSION', draftId);
  return row ? { status: row.status, lastError: row.lastError, attempts: row.attempts } : null;
}

export type DraftFormState =
  | { kind: 'NO_DRAFT' }
  | { kind: 'FORM_MISSING'; draft: StoredVisitDraft }
  | { kind: 'CURRENT' | 'RECHECKS_ONLY' | 'REBUILT'; draft: StoredVisitDraft; draftForm: CachedVisitForm; currentForm: CachedVisitForm };

/**
 * D-R5.19: how the open draft's form relates to the visit's current form. CURRENT or RECHECKS_ONLY:
 * keep filling (R4 accepts an older form that differs only in re-checks). REBUILT: call
 * `remapOpenDraftToCurrentForm` and show "The form was rebuilt" with the dropped answers.
 */
export async function draftFormState(visitId: string): Promise<DraftFormState> {
  const open = await getOpenDraft(visitId);
  if (!open) return { kind: 'NO_DRAFT' };
  const [draftForm, currentForm] = await Promise.all([getVisitFormByHash(open.draft.visitId, open.draft.formHash), getVisitForm(open.draft.visitId)]);
  if (!draftForm || !currentForm) return { kind: 'FORM_MISSING', draft: open };
  if (draftForm.formHash === currentForm.formHash) return { kind: 'CURRENT', draft: open, draftForm, currentForm };
  const change = formChangeKind(draftForm.snapshot, currentForm.snapshot);
  return { kind: change === 'REBUILT' ? 'REBUILT' : change === 'SAME' ? 'CURRENT' : 'RECHECKS_ONLY', draft: open, draftForm, currentForm };
}

/** Moves the open (unsent) draft onto the visit's current form and lists what was dropped. */
export async function remapOpenDraftToCurrentForm(visitId: string): Promise<DroppedAnswer[]> {
  const state = await draftFormState(visitId);
  if (state.kind !== 'REBUILT' && state.kind !== 'RECHECKS_ONLY') return [];
  if (state.draft.status !== 'DRAFT') return [];
  const { draft, dropped } = remapDraftOntoSnapshot(
    state.draft.draft,
    state.draftForm.snapshot,
    { snapshot: state.currentForm.snapshot, formSnapshotId: state.currentForm.formSnapshotId.startsWith('local:') ? null : state.currentForm.formSnapshotId, formHash: state.currentForm.formHash },
    nowIso()
  );
  await saveDraft(draft);
  return dropped;
}

/**
 * A refused draft as a new draft (new clientSubmissionId) on the visit's current form, answers moved
 * by path (D-R5.19). The refused draft stays until deleted.
 */
export async function copyRefusedDraft(draftId: string): Promise<{ draft: StoredVisitDraft; dropped: DroppedAnswer[] }> {
  const refused = await getDraft(draftId);
  if (!refused || refused.status !== 'REFUSED') throw new Error('Only a refused monitoring report can be copied.');
  const [oldForm, current] = await Promise.all([getVisitFormByHash(refused.draft.visitId, refused.draft.formHash), getVisitForm(refused.draft.visitId)]);
  if (!current) throw new Error('The form for this monitoring visit is not on the phone yet. Connect once to download it.');
  const { draft: moved, dropped } = remapDraftOntoSnapshot(
    refused.draft,
    oldForm?.snapshot ?? null,
    { snapshot: current.snapshot, formSnapshotId: current.formSnapshotId.startsWith('local:') ? null : current.formSnapshotId, formHash: current.formHash },
    nowIso()
  );
  const fresh = await startDraft(refused.draft.visitId, {
    answers: moved.answers,
    overallFinding: moved.overallFinding,
    summaryText: moved.summaryText,
    correctsSubmissionId: moved.correctsSubmissionId,
    remap: moved.remap,
  });
  return { draft: fresh, dropped };
}

/**
 * Returned for correction (R4 status RETURNED): a new draft pre-filled from the latest returned
 * submission in `detail` (online `GET .../visits/:id`). Photos and voice notes must be taken again
 * (R4 refuses captures linked to the returned submission); they are listed in `remap.dropped`.
 * The new submission is the next revision (R4 numbers revisions itself; there is no revises field).
 */
export async function startCorrectionDraft(visitId: string, detail: VisitDetailDto): Promise<{ draft: StoredVisitDraft; dropped: DroppedAnswer[] }> {
  const returned = [...detail.submissions].filter((s) => s.status === 'RETURNED').sort((a, b) => b.revisionNumber - a.revisionNumber)[0];
  if (!returned) throw new Error('This monitoring visit has no monitoring report returned for correction.');
  await applyServerVisit(visitId, detail.visit);
  const current = await getVisitForm(visitId);
  if (!current) throw new Error('The form for this monitoring visit is not on the phone yet. Connect once to download it.');
  const { answers, dropped } = answersFromReturnedSubmission(current.snapshot, returned.answers);
  const now = nowIso();
  const draft = await startDraft(visitId, {
    answers,
    overallFinding: returned.overallFinding,
    summaryText: returned.summaryText,
    correctsSubmissionId: returned.id,
    remap: dropped.length ? { at: now, fromFormHash: returned.formHash, dropped } : null,
  });
  return { draft, dropped };
}

// ---------------------------------------------------------------------------
// Sync state (visit_sync_meta)
// ---------------------------------------------------------------------------

export async function getVisitSyncMeta<T>(key: string): Promise<T | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM visit_sync_meta WHERE key = ?', [key]);
  return row ? (JSON.parse(row.value) as T) : null;
}

export async function setVisitSyncMeta(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO visit_sync_meta (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    [key, JSON.stringify(value), nowIso()]
  );
}

/** The feed's per-project summary (current sprint, open findings, next visit) from the last sync. */
export async function getFeedProjects(): Promise<MyVisitsFeedDto['projects']> {
  return (await getVisitSyncMeta<MyVisitsFeedDto['projects']>('feedProjects')) ?? [];
}

/** The feed window last stored on the phone (D-R5.5), for "outside the cached window" notices. */
export async function getCachedWindow(): Promise<{ from: string; to: string; syncedAt: string } | null> {
  return getVisitSyncMeta<{ from: string; to: string; syncedAt: string }>('window');
}

/**
 * Sign-out: removes the downloaded visit data (visits without unsent work, field packs, sync state,
 * forms no draft needs). Drafts, site log entries and queued work stay, like the outbox.
 */
export async function clearVisitCache(): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `DELETE FROM visits WHERE NOT EXISTS (SELECT 1 FROM visit_drafts d WHERE d.visit_id = visits.id AND d.status IN ('DRAFT', 'QUEUED', 'REFUSED'))
         AND NOT (is_local = 1 AND server_id IS NULL)`
    );
    await db.runAsync('DELETE FROM visit_field_packs');
    await db.runAsync('DELETE FROM visit_sync_meta');
  });
  await pruneUnusedForms().catch(() => 0);
  emitVisitDataChanged('visits');
}
