import type { NeedsVerificationFeedDto, NeedsVerificationForm, NeedsVerificationSiteLocation, NeedsVerificationSubmissionDto } from '@insite/shared';
import type { SQLiteDatabase } from 'expo-sqlite';
import { getDb, newId, nowIso } from './db/database';
import { deleteStoppedRows, enqueue, latestRowFor, openRowLookup } from './outbox/outboxStore';
import { kickOutbox } from './outbox/outboxProcessor';
import { needsVerificationSubmissionDependsOn, type OutboxStatus } from './outbox/outboxPolicy';
import { getCaptures } from './captureStore';
import { emitVisitDataChanged } from './visitEvents';
import type { PhoneCaptureFact } from '../utils/visitForm';
import {
  buildVerificationSubmission,
  checkVerificationDraft,
  correctionFromReturned,
  dtoAfterSubmission,
  EMPTY_VERIFICATION_LOCAL_STATE,
  feedRemovals,
  parseVerificationLocalState,
  remapVerificationDraft,
  upsertSiteLocation,
  verificationCaptureIds,
  verificationFormAccess,
  verificationScope,
  type CachedNeedsVerificationForm,
  type NeedsVerificationDraft,
  type NeedsVerificationDraftStatus,
  type StoredNeedsVerification,
  type StoredNeedsVerificationDraft,
  type VerificationLocalState,
} from '../utils/needsVerification';

/**
 * Needs pipeline wave 5 (N8): field verifications on the phone, their frozen forms and drafts. Like
 * the visit store: the feed is stored as received, the phone layers only what it has not sent
 * (`VerificationLocalState`), every write that must reach the server is a row in the one outbox
 * queued in the same transaction, and every write emits the `verifications` topic.
 */

// ---------------------------------------------------------------------------
// Verifications
// ---------------------------------------------------------------------------

type VerificationRow = {
  id: string;
  due_date: string;
  status: string;
  form_hash: string;
  dto_json: string;
  local_state_json: string;
  synced_at: string | null;
  created_at: string;
};

function mapVerification(r: VerificationRow): StoredNeedsVerification {
  return { id: r.id, dto: JSON.parse(r.dto_json), local: parseVerificationLocalState(r.local_state_json), syncedAt: r.synced_at };
}

const UNSENT_DRAFT_STATUSES = "('DRAFT', 'QUEUED', 'REFUSED')";

/** Verifications on the phone, by due date. */
export async function listNeedsVerifications(): Promise<StoredNeedsVerification[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<VerificationRow>('SELECT * FROM needs_verifications ORDER BY due_date ASC, created_at ASC');
  return rows.map(mapVerification);
}

export async function getNeedsVerification(id: string): Promise<StoredNeedsVerification | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<VerificationRow>('SELECT * FROM needs_verifications WHERE id = ?', [id]);
  return row ? mapVerification(row) : null;
}

async function updateLocalState(db: SQLiteDatabase, id: string, fn: (s: VerificationLocalState) => VerificationLocalState): Promise<void> {
  const row = await db.getFirstAsync<{ local_state_json: string }>('SELECT local_state_json FROM needs_verifications WHERE id = ?', [id]);
  if (!row) return;
  await db.runAsync('UPDATE needs_verifications SET local_state_json = ? WHERE id = ?', [JSON.stringify(fn(parseVerificationLocalState(row.local_state_json))), id]);
}

/**
 * Stores the feed. Every item overwrites the server copy (the phone's overlays are kept). Rows the feed
 * no longer returns are removed with their sent drafts, unless an unsent draft (being filled, queued or
 * refused) keeps them: those are marked "no longer assigned".
 */
export async function upsertNeedsVerificationFeed(feed: Pick<NeedsVerificationFeedDto, 'items'>): Promise<{ changed: number; removed: number }> {
  const db = await getDb();
  const now = nowIso();
  let changed = 0;
  let removed = 0;
  await db.withTransactionAsync(async () => {
    for (const dto of feed.items) {
      const existing = await db.getFirstAsync<VerificationRow>('SELECT * FROM needs_verifications WHERE id = ?', [dto.id]);
      const json = JSON.stringify(dto);
      if (!existing) {
        await db.runAsync(
          `INSERT INTO needs_verifications (id, due_date, status, form_hash, dto_json, local_state_json, synced_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [dto.id, dto.dueDate, dto.status, dto.formHash, json, JSON.stringify(EMPTY_VERIFICATION_LOCAL_STATE), now, now]
        );
        changed++;
        continue;
      }
      const local = parseVerificationLocalState(existing.local_state_json);
      await db.runAsync(
        `UPDATE needs_verifications SET due_date = ?, status = ?, form_hash = ?, dto_json = ?, local_state_json = ?, synced_at = ? WHERE id = ?`,
        [dto.dueDate, dto.status, dto.formHash, json, JSON.stringify({ ...local, removedFromFeedAt: null }), now, dto.id]
      );
      if (existing.dto_json !== json || local.removedFromFeedAt) changed++;
    }
    const rows = await db.getAllAsync<VerificationRow>('SELECT * FROM needs_verifications');
    const unsent = new Set(
      (await db.getAllAsync<{ verification_id: string }>(`SELECT DISTINCT verification_id FROM needs_verification_drafts WHERE status IN ${UNSENT_DRAFT_STATUSES}`)).map((r) => r.verification_id)
    );
    const { remove, mark } = feedRemovals(
      rows.map((r) => ({ id: r.id, hasUnsentDraft: unsent.has(r.id), markedRemoved: Boolean(parseVerificationLocalState(r.local_state_json).removedFromFeedAt) })),
      new Set(feed.items.map((d) => d.id))
    );
    for (const id of mark) await updateLocalState(db, id, (s) => ({ ...s, removedFromFeedAt: now }));
    for (const id of remove) {
      await db.runAsync('DELETE FROM needs_verification_drafts WHERE verification_id = ?', [id]);
      await db.runAsync('DELETE FROM needs_verifications WHERE id = ?', [id]);
      removed++;
    }
    changed += mark.length;
  });
  if (changed || removed) emitVisitDataChanged('verifications');
  return { changed, removed };
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export async function saveNeedsVerificationForm(form: CachedNeedsVerificationForm): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO needs_verification_forms (verification_id, form_hash, json, downloaded_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(verification_id, form_hash) DO UPDATE SET json = excluded.json, downloaded_at = excluded.downloaded_at`,
    [form.verificationId, form.formHash, JSON.stringify(form.form), nowIso()]
  );
  emitVisitDataChanged('verifications');
}

/** (verification id, form hash) pairs on the phone, for the download decision. */
export async function cachedNeedsVerificationFormKeys(): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ verification_id: string; form_hash: string }>('SELECT verification_id, form_hash FROM needs_verification_forms');
  return new Set(rows.map((r) => `${r.verification_id}:${r.form_hash}`));
}

/** The latest form of a verification on the phone (any hash): its hash goes in If-None-Match. */
export async function latestNeedsVerificationFormHash(verificationId: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ form_hash: string }>('SELECT form_hash FROM needs_verification_forms WHERE verification_id = ? ORDER BY downloaded_at DESC LIMIT 1', [verificationId]);
  return row?.form_hash ?? null;
}

export async function getNeedsVerificationForm(verificationId: string, formHash: string): Promise<CachedNeedsVerificationForm | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ json: string }>('SELECT json FROM needs_verification_forms WHERE verification_id = ? AND form_hash = ?', [verificationId, formHash]);
  return row ? { verificationId, formHash, form: JSON.parse(row.json) as NeedsVerificationForm } : null;
}

/** The verification's current form (the feed's `formHash`), when on the phone. */
export async function getCurrentNeedsVerificationForm(verificationId: string): Promise<CachedNeedsVerificationForm | null> {
  const v = await getNeedsVerification(verificationId);
  return v ? getNeedsVerificationForm(v.id, v.dto.formHash) : null;
}

/** Deletes forms no verification row or unsent draft refers to any more. */
export async function pruneUnusedNeedsVerificationForms(): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync(
    `DELETE FROM needs_verification_forms WHERE
       NOT EXISTS (SELECT 1 FROM needs_verifications v WHERE v.id = needs_verification_forms.verification_id AND v.form_hash = needs_verification_forms.form_hash)
       AND NOT EXISTS (SELECT 1 FROM needs_verification_drafts d WHERE d.verification_id = needs_verification_forms.verification_id
                       AND d.form_hash = needs_verification_forms.form_hash AND d.status != 'SENT')`
  );
  return r.changes;
}

// ---------------------------------------------------------------------------
// Drafts
// ---------------------------------------------------------------------------

type DraftRow = {
  id: string;
  verification_id: string;
  status: string;
  form_hash: string;
  draft_json: string;
  request_json: string | null;
  server_id: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

function mapDraft(r: DraftRow): StoredNeedsVerificationDraft {
  const draft = JSON.parse(r.draft_json) as NeedsVerificationDraft;
  return { draft: { ...draft, formHash: r.form_hash }, status: r.status as NeedsVerificationDraftStatus, serverId: r.server_id, lastError: r.last_error, updatedAt: r.updated_at };
}

export async function getVerificationDraft(id: string): Promise<StoredNeedsVerificationDraft | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<DraftRow>('SELECT * FROM needs_verification_drafts WHERE id = ?', [id]);
  return row ? mapDraft(row) : null;
}

/** The draft being filled or waiting to send (at most one). */
export async function getOpenVerificationDraft(verificationId: string): Promise<StoredNeedsVerificationDraft | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<DraftRow>(`SELECT * FROM needs_verification_drafts WHERE verification_id = ? AND status IN ('DRAFT', 'QUEUED') LIMIT 1`, [verificationId]);
  return row ? mapDraft(row) : null;
}

/** Every draft of a verification, newest first. */
export async function listVerificationDrafts(verificationId: string): Promise<StoredNeedsVerificationDraft[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<DraftRow>('SELECT * FROM needs_verification_drafts WHERE verification_id = ? ORDER BY updated_at DESC', [verificationId]);
  return rows.map(mapDraft);
}

/** Draft status by id (the Outbox screen). */
export async function verificationDraftStatuses(ids: string[]): Promise<Map<string, NeedsVerificationDraftStatus>> {
  const out = new Map<string, NeedsVerificationDraftStatus>();
  if (ids.length === 0) return out;
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string; status: string }>(`SELECT id, status FROM needs_verification_drafts WHERE id IN (${ids.map(() => '?').join(',')})`, ids);
  for (const r of rows) out.set(r.id, r.status as NeedsVerificationDraftStatus);
  return out;
}

/**
 * The verification's open draft, or a new one on its current form (the form must be on the phone).
 * `opts` pre-fill a correction or a copy of a refused draft.
 */
export async function startVerificationDraft(
  verificationId: string,
  opts: Partial<Pick<NeedsVerificationDraft, 'answers' | 'siteLocations' | 'notes' | 'correctsSubmissionId' | 'remap'>> & { formHash?: string } = {}
): Promise<StoredNeedsVerificationDraft> {
  const existing = await getOpenVerificationDraft(verificationId);
  if (existing) return existing;
  const v = await getNeedsVerification(verificationId);
  if (!v) throw new Error('This site verification is no longer on the phone. Refresh Home.');
  const formHash = opts.formHash ?? v.dto.formHash;
  const form = await getNeedsVerificationForm(v.id, formHash);
  if (!form) throw new Error('The form for this site verification is not on the phone yet. Connect once to download it.');
  const now = nowIso();
  const draft: NeedsVerificationDraft = {
    id: newId(),
    verificationId: v.id,
    formHash,
    answers: opts.answers ?? [],
    siteLocations: opts.siteLocations ?? [],
    notes: opts.notes ?? '',
    correctsSubmissionId: opts.correctsSubmissionId ?? null,
    startedAt: now,
    updatedAt: now,
    remap: opts.remap ?? null,
  };
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO needs_verification_drafts (id, verification_id, status, form_hash, draft_json, created_at, updated_at) VALUES (?, ?, 'DRAFT', ?, ?, ?, ?)`,
    [draft.id, draft.verificationId, draft.formHash, JSON.stringify(draft), now, now]
  );
  emitVisitDataChanged('verifications');
  return { draft, status: 'DRAFT', serverId: null, lastError: null, updatedAt: now };
}

/**
 * Returned to the officer: a new draft pre-filled from the returned submission the feed carries
 * (answers, locations, notes; photos are taken again and listed in `remap.dropped`). Offline.
 */
export async function startVerificationCorrectionDraft(verificationId: string): Promise<StoredNeedsVerificationDraft> {
  const existing = await getOpenVerificationDraft(verificationId);
  if (existing) return existing;
  const v = await getNeedsVerification(verificationId);
  if (!v) throw new Error('This site verification is no longer on the phone. Refresh Home.');
  const returned = v.dto.submission?.status === 'RETURNED' ? v.dto.submission : null;
  if (!returned) return startVerificationDraft(verificationId);
  const form = await getNeedsVerificationForm(v.id, v.dto.formHash);
  if (!form) throw new Error('The form for this site verification is not on the phone yet. Connect once to download it.');
  const c = correctionFromReturned(form.form, returned);
  return startVerificationDraft(verificationId, {
    answers: c.answers,
    siteLocations: c.siteLocations,
    notes: c.notes,
    correctsSubmissionId: returned.id,
    remap: c.dropped.length ? { at: nowIso(), fromFormHash: returned.formHash, dropped: c.dropped } : null,
  });
}

/** Saves the draft (call on every change). Only a draft still being filled can change. */
export async function saveVerificationDraft(draft: NeedsVerificationDraft): Promise<void> {
  const db = await getDb();
  const now = nowIso();
  const next = { ...draft, updatedAt: now };
  const r = await db.runAsync(
    `UPDATE needs_verification_drafts SET draft_json = ?, form_hash = ?, updated_at = ? WHERE id = ? AND status = 'DRAFT'`,
    [JSON.stringify(next), next.formHash, now, draft.id]
  );
  if (r.changes === 0) throw new Error('This site verification was already submitted and can no longer change.');
  emitVisitDataChanged('verifications');
}

/** What the phone knows about a verification's captures (no site boundary: the location is what counts). */
export async function verificationCaptureFacts(captureIds: string[]): Promise<PhoneCaptureFact[]> {
  const captures = await getCaptures(captureIds);
  return captures.map((c) => ({ clientCaptureId: c.id, hasFix: Boolean(c.fix), isMocked: c.fix?.isMocked ?? false, geofenceStatus: null }));
}

/**
 * Submits the draft: checks it with the shared rules and the phone's capture facts (errors, missing
 * locations and photo gaps block), stores the request (ids only) and queues
 * NEEDS_VERIFICATION_SUBMISSION behind its captures. Works offline. Throws the first problem.
 */
export async function queueVerificationSubmission(draftId: string, opts: { submittedAtDevice?: string } = {}): Promise<void> {
  const stored = await getVerificationDraft(draftId);
  if (!stored) throw new Error('This site verification is no longer on the phone.');
  if (stored.status !== 'DRAFT') return;
  const draft = stored.draft;
  const v = await getNeedsVerification(draft.verificationId);
  if (!v) throw new Error('This site verification is no longer on the phone. Refresh Home.');
  const form = await getNeedsVerificationForm(v.id, draft.formHash);
  if (!form) throw new Error('The form of this site verification is not on the phone any more. Refresh and start again.');
  const captureIds = verificationCaptureIds(draft.answers);
  const check = checkVerificationDraft(form.form, draft, await verificationCaptureFacts(captureIds));
  if (!check.canSubmit) throw new Error(check.issues[0]?.message ?? 'Some answers are missing.');
  const request = buildVerificationSubmission(form.form, draft, opts.submittedAtDevice ?? nowIso());
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const lookup = await openRowLookup(db, captureIds.map((id) => ['CAPTURE', id] as ['CAPTURE', string]));
    const r = await db.runAsync(
      `UPDATE needs_verification_drafts SET status = 'QUEUED', request_json = ?, last_error = NULL, updated_at = ? WHERE id = ? AND status = 'DRAFT'`,
      [JSON.stringify(request), nowIso(), draft.id]
    );
    if (r.changes === 0) return;
    await updateLocalState(db, v.id, (s) => ({ ...s, queuedDraftId: draft.id }));
    await enqueue(db, {
      projectId: verificationScope(v.id),
      kind: 'NEEDS_VERIFICATION_SUBMISSION',
      entityId: draft.id,
      payload: { verificationId: v.id },
      dependsOn: needsVerificationSubmissionDependsOn({ captureIds }, lookup),
    });
  });
  emitVisitDataChanged('verifications');
  kickOutbox();
}

/** Handler: the queued request of a draft. */
export async function getQueuedVerificationSubmission(
  draftId: string
): Promise<{ verificationId: string; status: NeedsVerificationDraftStatus; lastError: string | null; request: ReturnType<typeof buildVerificationSubmission> | null } | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<DraftRow>('SELECT * FROM needs_verification_drafts WHERE id = ?', [draftId]);
  if (!row) return null;
  return { verificationId: row.verification_id, status: row.status as NeedsVerificationDraftStatus, lastError: row.last_error, request: row.request_json ? JSON.parse(row.request_json) : null };
}

/** Handler: the server accepted the submission (201 or a 200 replay). */
export async function markVerificationDraftSent(draftId: string, submission: NeedsVerificationSubmissionDto): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<DraftRow>('SELECT * FROM needs_verification_drafts WHERE id = ?', [draftId]);
    if (!row) return;
    await db.runAsync(`UPDATE needs_verification_drafts SET status = 'SENT', server_id = ?, last_error = NULL, updated_at = ? WHERE id = ?`, [submission.id, nowIso(), draftId]);
    await updateLocalState(db, row.verification_id, (s) => (s.queuedDraftId === draftId ? { ...s, queuedDraftId: null } : s));
    const v = await db.getFirstAsync<VerificationRow>('SELECT * FROM needs_verifications WHERE id = ?', [row.verification_id]);
    if (v) {
      const next = dtoAfterSubmission(JSON.parse(v.dto_json), submission);
      await db.runAsync('UPDATE needs_verifications SET status = ?, dto_json = ? WHERE id = ?', [next.status, JSON.stringify(next), v.id]);
    }
  });
  emitVisitDataChanged('verifications');
}

/** Handler: refused for good (stale form, not open, invalid, not assigned). The draft stays on the phone. */
export async function markVerificationDraftRefused(draftId: string, message: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    const row = await db.getFirstAsync<DraftRow>('SELECT * FROM needs_verification_drafts WHERE id = ?', [draftId]);
    if (!row) return;
    await db.runAsync(`UPDATE needs_verification_drafts SET status = 'REFUSED', last_error = ?, updated_at = ? WHERE id = ?`, [message, nowIso(), draftId]);
    await updateLocalState(db, row.verification_id, (s) => (s.queuedDraftId === draftId ? { ...s, queuedDraftId: null } : s));
  });
  emitVisitDataChanged('verifications');
}

/** Records a send failure on a queued draft (the outbox row keeps retrying or is dead-lettered). */
export async function noteVerificationDraftError(draftId: string, message: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(`UPDATE needs_verification_drafts SET last_error = ?, updated_at = ? WHERE id = ? AND status = 'QUEUED'`, [message, nowIso(), draftId]);
  emitVisitDataChanged('verifications');
}

/** Deletes a draft being filled or refused (with its stopped outbox rows). Queued and sent drafts stay. */
export async function deleteVerificationDraft(draftId: string): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await deleteStoppedRows(db, 'NEEDS_VERIFICATION_SUBMISSION', draftId);
    await db.runAsync(`DELETE FROM needs_verification_drafts WHERE id = ? AND status IN ('DRAFT', 'REFUSED')`, [draftId]);
  });
  emitVisitDataChanged('verifications');
}

/**
 * A refused draft as a new draft (new clientSubmissionId) on the verification's current form, answers
 * moved by path. The refused draft stays until deleted.
 */
export async function copyRefusedVerificationDraft(draftId: string): Promise<StoredNeedsVerificationDraft> {
  const refused = await getVerificationDraft(draftId);
  if (!refused || refused.status !== 'REFUSED') throw new Error('Only a refused site verification can be copied.');
  const v = await getNeedsVerification(refused.draft.verificationId);
  if (!v) throw new Error('This site verification is no longer on the phone. Refresh Home.');
  const [oldForm, current] = await Promise.all([getNeedsVerificationForm(v.id, refused.draft.formHash), getNeedsVerificationForm(v.id, v.dto.formHash)]);
  if (!current) throw new Error('The form for this site verification is not on the phone yet. Connect once to download it.');
  const moved = remapVerificationDraft(refused.draft, oldForm?.form ?? null, { form: current.form, formHash: current.formHash });
  return startVerificationDraft(v.id, {
    answers: moved.answers,
    siteLocations: moved.siteLocations,
    notes: refused.draft.notes,
    correctsSubmissionId: refused.draft.correctsSubmissionId,
    remap: moved.dropped.length || refused.draft.formHash !== current.formHash ? { at: nowIso(), fromFormHash: refused.draft.formHash, dropped: moved.dropped } : null,
  });
}

/**
 * The draft the officer may change now: the open one, or a new one when the form can be started (a
 * correction after a return). Throws the reason when the verification takes no answers now.
 */
export async function ensureEditableVerificationDraft(verificationId: string): Promise<StoredNeedsVerificationDraft> {
  const v = await getNeedsVerification(verificationId);
  if (!v) throw new Error('This site verification is no longer on the phone. Refresh Home.');
  const drafts = await listVerificationDrafts(v.id);
  const open = drafts.find((d) => d.status === 'DRAFT' || d.status === 'QUEUED') ?? null;
  const access = verificationFormAccess(v, { open, latest: drafts[0] ?? null });
  if (access.mode === 'EDIT') return access.draft;
  if (access.mode === 'START') return access.correction ? startVerificationCorrectionDraft(v.id) : startVerificationDraft(v.id);
  throw new Error(access.message);
}

/** Records where the officer stands at one site on the draft (replacing an earlier location of that site). */
export async function recordVerificationSiteLocation(verificationId: string, location: NeedsVerificationSiteLocation): Promise<void> {
  const d = await ensureEditableVerificationDraft(verificationId);
  await saveVerificationDraft({ ...d.draft, siteLocations: upsertSiteLocation(d.draft.siteLocations, location) });
}

/** The outbox state of a queued draft, for the verification screen. */
export async function verificationDraftOutboxState(draftId: string): Promise<{ status: OutboxStatus; lastError: string | null; attempts: number } | null> {
  const row = await latestRowFor('NEEDS_VERIFICATION_SUBMISSION', draftId);
  return row ? { status: row.status, lastError: row.lastError, attempts: row.attempts } : null;
}

// ---------------------------------------------------------------------------
// Sign-out
// ---------------------------------------------------------------------------

/** Sign-out: removes verifications without unsent work and forms no draft needs. Unsent drafts stay, like the outbox. */
export async function clearNeedsVerificationCache(): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(`DELETE FROM needs_verification_drafts WHERE status = 'SENT'`);
    await db.runAsync(
      `DELETE FROM needs_verifications WHERE NOT EXISTS (SELECT 1 FROM needs_verification_drafts d WHERE d.verification_id = needs_verifications.id AND d.status IN ${UNSENT_DRAFT_STATUSES})`
    );
  });
  await pruneUnusedNeedsVerificationForms().catch(() => 0);
  emitVisitDataChanged('verifications');
}
