import { fetchMyNeedsVerifications, fetchNeedsVerificationForm } from '../api/needsVerifications/needsVerificationsApi';
import {
  cachedNeedsVerificationFormKeys,
  latestNeedsVerificationFormHash,
  listNeedsVerifications,
  pruneUnusedNeedsVerificationForms,
  saveNeedsVerificationForm,
  upsertNeedsVerificationFeed,
} from '../storage/needsVerificationStore';
import { formsToDownload, hashNeedsVerificationForm } from '../utils/needsVerification';

/**
 * Needs pipeline wave 5 (N8): the verification download, run by the visit sync after the visit feed
 * (same triggers: sign-in, pull-to-refresh, foreground, network restored, every 15 minutes). It stores
 * the account's verification feed and downloads each open verification's frozen form it does not have
 * under its current hash (If-None-Match with the copy on the phone; 304 keeps it). A downloaded form
 * is stored only when its SHA-256 matches the server's `formHash`. Failures never break the visit sync.
 */

export interface NeedsVerificationSyncState {
  lastSyncedAt: string | null;
  lastError: string | null;
  /** Verifications whose form could not be stored (id → reason), until the next successful download. */
  formErrors: Record<string, string>;
}

let state: NeedsVerificationSyncState = { lastSyncedAt: null, lastError: null, formErrors: {} };

export function getNeedsVerificationSyncState(): NeedsVerificationSyncState {
  return { ...state, formErrors: { ...state.formErrors } };
}

export const FORM_HASH_MISMATCH_MESSAGE = 'The form did not download correctly. Pull down on Home to try again.';

/** Downloads missing forms. Returns how many were stored. */
export async function downloadMissingVerificationForms(): Promise<number> {
  const [list, cached] = await Promise.all([listNeedsVerifications(), cachedNeedsVerificationFormKeys()]);
  let stored = 0;
  const errors: Record<string, string> = { ...state.formErrors };
  for (const want of formsToDownload(list, (id, hash) => cached.has(`${id}:${hash}`))) {
    try {
      const dto = await fetchNeedsVerificationForm(want.verificationId, await latestNeedsVerificationFormHash(want.verificationId));
      if (!dto) continue; // 304: the copy on the phone is current.
      if (hashNeedsVerificationForm(dto.form) !== dto.formHash) {
        errors[want.verificationId] = FORM_HASH_MISMATCH_MESSAGE;
        continue;
      }
      await saveNeedsVerificationForm({ verificationId: want.verificationId, formHash: dto.formHash, form: dto.form });
      delete errors[want.verificationId];
      stored++;
    } catch {
      // Cancelled, reassigned or offline: the next run tries again.
    }
  }
  state = { ...state, formErrors: errors };
  return stored;
}

/** One verification download. Never throws (the visit sync calls it last). */
export async function syncNeedsVerifications(): Promise<NeedsVerificationSyncState> {
  try {
    const feed = await fetchMyNeedsVerifications();
    await upsertNeedsVerificationFeed(feed);
    state = { ...state, lastSyncedAt: new Date().toISOString(), lastError: null };
    await downloadMissingVerificationForms();
    await pruneUnusedNeedsVerificationForms().catch(() => 0);
  } catch (error) {
    state = { ...state, lastError: (error as Error)?.message ?? 'Could not refresh site verifications.' };
  }
  return getNeedsVerificationSyncState();
}
