import * as Network from 'expo-network';
import { AppState, type AppStateStatus } from 'react-native';
import type { VisitDetailDto } from '@insite/shared';
import { getAccountToken } from '../config/authRegistry';
import { fetchMyVisits, fetchOwnCaptures, fetchVisitDetail, fetchVisitFieldPack, fetchVisitForm } from '../api/visits/visitsApi';
import {
  applyServerVisit,
  cachedFormFromDto,
  getFieldPackDownloadedAt,
  hasCachedForm,
  listVisits,
  pruneUnusedForms,
  saveFieldPack,
  saveVisitForm,
  setVisitSyncMeta,
  upsertVisitFeed,
} from '../storage/visitStore';
import { listPendingTranscripts, refreshCaptureServerCopies } from '../storage/captureStore';
import { emitVisitDataChanged } from '../storage/visitEvents';
import { syncNeedsVerifications } from './needsVerificationSync';
import { projectToday, syncWindow } from '../utils/visitCalendar';
import type { StoredVisit } from '../utils/visitModel';

/**
 * Redesign R5a: the visit download (D-R5.5). On sign-in, pull-to-refresh, app foreground, network
 * restored and every 15 minutes while active and online, it fetches the account feed for
 * today − 30 … today + 14, stores it, downloads every form in it the phone does not have (by
 * snapshot id + hash), refreshes each project's Ad hoc field pack (hourly, or on a forced sync) and
 * picks up voice-note transcripts. One run at a time; a trigger during a run schedules one more.
 * Needs pipeline wave 5: every run then downloads the account's field verifications and their forms
 * (`needsVerificationSync.ts`; its failures never fail the visit sync).
 */

export interface VisitSyncSnapshot {
  isSyncing: boolean;
  /** ISO time of the last complete feed download. */
  lastSyncedAt: string | null;
  /** The last failure (offline, server error), cleared by the next successful run. */
  lastError: string | null;
  /** The cached feed window (YYYY-MM-DD), null before the first download. */
  window: { from: string; to: string } | null;
}

let snapshot: VisitSyncSnapshot = { isSyncing: false, lastSyncedAt: null, lastError: null, window: null };
const listeners = new Set<(s: VisitSyncSnapshot) => void>();

function publish(patch: Partial<VisitSyncSnapshot>) {
  snapshot = { ...snapshot, ...patch };
  for (const l of listeners) l({ ...snapshot });
}

export function subscribeToVisitSync(listener: (s: VisitSyncSnapshot) => void): () => void {
  listeners.add(listener);
  listener({ ...snapshot });
  return () => {
    listeners.delete(listener);
  };
}

export function getVisitSyncSnapshot(): VisitSyncSnapshot {
  return { ...snapshot };
}

/** The account's projects (set by ProfileContext), so field packs are fetched for projects without visits too. */
let knownProjectIds: string[] = [];
export function setVisitSyncProjects(projectIds: string[]): void {
  knownProjectIds = [...new Set(projectIds)];
}

/** The device's zone, for the feed window (the server takes plain dates). */
function deviceZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

const FIELD_PACK_MAX_AGE_MS = 60 * 60_000;
/** Visits whose form the officer may still fill (forms of other visits are not downloaded). */
const FORM_STATUSES = ['PLANNED', 'IN_PROGRESS', 'RETURNED', 'MISSED'];

/** Downloads the forms of visits on the phone that are not cached yet. Failures are skipped per visit. */
export async function downloadMissingForms(visits?: StoredVisit[]): Promise<number> {
  const list = visits ?? (await listVisits());
  let downloaded = 0;
  for (const v of list) {
    const id = v.serverId;
    const { formSnapshotId, formHash } = v.visit;
    if (!id || !formSnapshotId || !formHash || !FORM_STATUSES.includes(v.visit.status)) continue;
    if (await hasCachedForm(formSnapshotId, formHash)) continue;
    try {
      const dto = await fetchVisitForm(v.projectId, id, null);
      if (dto) {
        await saveVisitForm(v.projectId, v.id, cachedFormFromDto(dto));
        downloaded++;
      }
    } catch {
      // Not published any more, or offline: the next run tries again.
    }
  }
  return downloaded;
}

/** Downloads a project's field pack (Ad hoc forms offline). `force` ignores the hourly age. */
export async function downloadFieldPack(projectId: string, force = false): Promise<boolean> {
  const at = await getFieldPackDownloadedAt(projectId);
  if (!force && at && Date.now() - new Date(at).getTime() < FIELD_PACK_MAX_AGE_MS) return false;
  try {
    await saveFieldPack(await fetchVisitFieldPack(projectId));
    return true;
  } catch {
    return false;
  }
}

/** D-R5.13: stores transcripts the server produced since the voice notes were registered. */
export async function refreshTranscripts(): Promise<number> {
  let changed = 0;
  for (const p of await listPendingTranscripts()) {
    try {
      const since = new Date(new Date(p.since).getTime() - 60_000).toISOString();
      const dtos = await fetchOwnCaptures(p.projectId, since);
      changed += await refreshCaptureServerCopies(dtos.filter((d) => p.ids.includes(d.clientCaptureId)));
    } catch {
      // Offline or the session ended: the transcript stays "pending" on the phone.
    }
  }
  if (changed) emitVisitDataChanged('captures');
  return changed;
}

let running = false;
let rerun: { force: boolean } | null = null;

async function runOnce(force: boolean): Promise<void> {
  const today = projectToday(deviceZone());
  const window = syncWindow(today);
  publish({ isSyncing: true });
  try {
    const feed = await fetchMyVisits(window);
    await upsertVisitFeed(feed, { from: feed.from, to: feed.to });
    const syncedAt = new Date().toISOString();
    await setVisitSyncMeta('window', { from: feed.from, to: feed.to, syncedAt });
    await setVisitSyncMeta('feedProjects', feed.projects);
    publish({ lastSyncedAt: syncedAt, window: { from: feed.from, to: feed.to }, lastError: null });

    await downloadMissingForms();
    const projectIds = new Set([...knownProjectIds, ...feed.projects.map((p) => p.projectId)]);
    for (const id of projectIds) await downloadFieldPack(id, force);
    await refreshTranscripts();
    await pruneUnusedForms().catch(() => 0);
    emitVisitDataChanged('forms');
  } catch (error) {
    publish({ lastError: (error as Error)?.message ?? 'Could not refresh monitoring visits.' });
  }
  try {
    await syncNeedsVerifications();
  } finally {
    publish({ isSyncing: false });
  }
}

/**
 * Runs a sync now (pull-to-refresh: `force: true` also refreshes every field pack). Safe to call any
 * number of times; resolves with the status after the run. Does nothing while nobody is signed in.
 */
export async function syncVisits(opts: { reason?: string; force?: boolean } = {}): Promise<VisitSyncSnapshot> {
  if (!getAccountToken()) return getVisitSyncSnapshot();
  if (running) {
    rerun = { force: Boolean(opts.force) || Boolean(rerun?.force) };
    return getVisitSyncSnapshot();
  }
  running = true;
  try {
    let force = Boolean(opts.force);
    for (;;) {
      await runOnce(force);
      if (!rerun) break;
      force = rerun.force;
      rerun = null;
    }
  } finally {
    running = false;
  }
  return getVisitSyncSnapshot();
}

/**
 * Month view outside the cached window (D-R5.5): fetches that range online and stores the visits
 * (no forms are downloaded for them). Throws when offline.
 */
export async function fetchVisitRange(from: string, to: string): Promise<StoredVisit[]> {
  const feed = await fetchMyVisits({ from, to });
  await upsertVisitFeed(feed, { from: feed.from, to: feed.to });
  return listVisits({ from, to });
}

/** Online: a visit's detail (comments, submissions, returned answers); the visit copy is stored. */
export async function refreshVisitDetail(projectId: string, visitServerId: string): Promise<VisitDetailDto> {
  const detail = await fetchVisitDetail(projectId, visitServerId);
  await applyServerVisit(visitServerId, detail.visit);
  return detail;
}

const PERIODIC_MS = 15 * 60_000;

/** Starts the triggers: now, app foreground, network restored and every 15 minutes while active. */
export function startVisitSync(): () => void {
  void syncVisits({ reason: 'startup' });
  let online = true;
  const net = Network.addNetworkStateListener((state) => {
    const now = Boolean(state.isConnected && state.isInternetReachable !== false);
    if (now && !online) void syncVisits({ reason: 'online' });
    online = now;
  });
  const app = AppState.addEventListener('change', (next: AppStateStatus) => {
    if (next === 'active') void syncVisits({ reason: 'foreground' });
  });
  const timer = setInterval(() => {
    if (AppState.currentState === 'active' && online) void syncVisits({ reason: 'periodic' });
  }, PERIODIC_MS);
  return () => {
    net.remove();
    app.remove();
    clearInterval(timer);
  };
}
