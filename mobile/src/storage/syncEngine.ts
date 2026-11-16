import * as Network from 'expo-network';
import { AppState, type AppStateStatus } from 'react-native';
import { submitAssuranceVerification } from '../api/auth/authApi';
import {
  presignEvidenceUpload,
  uploadBinaryToPresignedUrl,
} from '../api/evidence/evidenceApi';
import { createIncidentReport } from '../api/incidents/incidentsApi';
import { submitWorkdayReport } from '../api/workday/workdayApi';
import { getDatabase } from './sqliteDatabase';
import { loadLocalProfile } from './secureProfileStore';
import { flushTelemetryQueue } from '../services/telemetryService';
import { getUnsyncedTelemetryPings } from './telemetryRepository';
import {
  getPendingAssuranceSubmissions,
  markAssuranceSubmissionSynced,
} from './assuranceRepository';

export interface SyncStatusSnapshot {
  isOnline: boolean;
  isSyncing: boolean;
  pendingTelemetryCount: number;
  pendingReportCount: number;
  pendingIncidentCount: number;
  pendingAssuranceCount: number;
  totalPendingCount: number;
  lastSyncedAt: string | null;
  lastError: string | null;
}

type SyncStatusListener = (snapshot: SyncStatusSnapshot) => void;

let isSyncInProgress = false;
let currentSnapshot: SyncStatusSnapshot = {
  isOnline: true,
  isSyncing: false,
  pendingTelemetryCount: 0,
  pendingReportCount: 0,
  pendingIncidentCount: 0,
  pendingAssuranceCount: 0,
  totalPendingCount: 0,
  lastSyncedAt: null,
  lastError: null,
};

const listeners = new Set<SyncStatusListener>();

function notifyListeners() {
  for (const listener of listeners) {
    listener({ ...currentSnapshot });
  }
}

export function subscribeToSyncStatus(
  listener: SyncStatusListener
): () => void {
  listeners.add(listener);
  listener({ ...currentSnapshot });
  return () => {
    listeners.delete(listener);
  };
}

export function getSyncStatusSnapshot(): SyncStatusSnapshot {
  return { ...currentSnapshot };
}

/**
 * Counts unsynced items across SQLite tables so UI badges stay accurate.
 */
export async function refreshPendingCounts(projectId?: string): Promise<void> {
  const activeProjectId =
    projectId || (await loadLocalProfile())?.activeProjectId || 'proj-lkk-402';

  let pendingTelemetryCount = 0;
  let pendingReportCount = 0;
  let pendingIncidentCount = 0;
  let pendingAssuranceCount = 0;

  try {
    const unsyncedPings = await getUnsyncedTelemetryPings(activeProjectId);
    pendingTelemetryCount = unsyncedPings.length;
  } catch {
    pendingTelemetryCount = 0;
  }

  try {
    const pendingAssurance = await getPendingAssuranceSubmissions(activeProjectId);
    pendingAssuranceCount = pendingAssurance.length;
  } catch {
    pendingAssuranceCount = 0;
  }

  const db = await getDatabase();
  if (db) {
    try {
      const reportRow = await db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM staged_workday_reports WHERE status IN ('QUEUED_OFFLINE', 'STAGED_UNVERIFIED')`
      );
      pendingReportCount = reportRow?.count ?? 0;

      const incidentRow = await db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) as count FROM incident_reports WHERE status = 'QUEUED_OFFLINE'`
      );
      pendingIncidentCount = incidentRow?.count ?? 0;
    } catch (err) {
      console.warn('SyncEngine: error counting pending SQLite rows:', err);
    }
  }

  currentSnapshot = {
    ...currentSnapshot,
    pendingTelemetryCount,
    pendingReportCount,
    pendingIncidentCount,
    pendingAssuranceCount,
    totalPendingCount:
      pendingTelemetryCount +
      pendingReportCount +
      pendingIncidentCount +
      pendingAssuranceCount,
  };
  notifyListeners();
}

async function uploadAssuranceImageOrFallback(
  projectId: string,
  localUri: string,
  fileName: string
): Promise<string> {
  try {
    const presigned = await presignEvidenceUpload({
      projectId,
      mediaType: 'SITE_PHOTO',
      fileName,
      mimeType: 'image/jpeg',
    });

    await uploadBinaryToPresignedUrl(presigned.uploadUrl, localUri, 'image/jpeg');
    return presigned.publicUrl || presigned.objectKey;
  } catch {
    return localUri;
  }
}

/**
 * Syncs queued contractor assurance verification packages (ID photo + 3-pose liveness selfies + credentials).
 */
async function flushQueuedAssuranceVerifications(
  projectId: string
): Promise<number> {
  const pending = await getPendingAssuranceSubmissions(projectId);
  if (pending.length === 0) return 0;

  let syncedCount = 0;
  for (const item of pending) {
    try {
      const [idDocumentUrl, selfieFrontUrl, selfieLeftUrl, selfieRightUrl] =
        await Promise.all([
          uploadAssuranceImageOrFallback(
            item.projectId,
            item.idPhotoUri,
            `id-${item.id}.jpg`
          ),
          uploadAssuranceImageOrFallback(
            item.projectId,
            item.selfieFrontUri,
            `selfie-front-${item.id}.jpg`
          ),
          uploadAssuranceImageOrFallback(
            item.projectId,
            item.selfieLeftUri,
            `selfie-left-${item.id}.jpg`
          ),
          uploadAssuranceImageOrFallback(
            item.projectId,
            item.selfieRightUri,
            `selfie-right-${item.id}.jpg`
          ),
        ]);

      await submitAssuranceVerification({
        projectId: item.projectId,
        idDocumentType: item.idType,
        idDocumentUrl,
        selfieFrontUrl,
        selfieLeftUrl,
        selfieRightUrl,
        livenessVerification: item.livenessVerification,
        corenLicenseNumber: `${item.regulatoryBody} ${item.licenseNumber}`.trim(),
        experienceSummary: item.experienceSummary,
      });

      await markAssuranceSubmissionSynced(item.id);
      syncedCount += 1;
    } catch (err) {
      console.warn('SyncEngine: assurance verification sync paused:', err);
    }
  }

  return syncedCount;
}

/**
 * Syncs queued SQLite workday reports (only when contractor is APPROVED,
 * preserving zero-AI-cost gating for STAGED_UNVERIFIED reports).
 */
async function flushQueuedWorkdayReports(
  projectId: string,
  isApproved: boolean
): Promise<number> {
  if (!isApproved) return 0;

  const db = await getDatabase();
  if (!db) return 0;

  let syncedCount = 0;
  try {
    const rows = await db.getAllAsync<any>(
      `SELECT * FROM staged_workday_reports WHERE status = 'QUEUED_OFFLINE' ORDER BY created_at ASC`
    );

    for (const row of rows) {
      const payload = {
        localReportId: row.id,
        projectId,
        wbsItemId: row.wbs_item_id,
        workdayDate: row.workday_date,
        summaryText: row.summary_text,
        voiceNoteUrl: row.voice_note_uri ?? null,
        evidenceItems: row.evidence_json ? JSON.parse(row.evidence_json) : [],
        reportedQuantity: row.reported_quantity,
        unitOfMeasure: row.unit,
        submissionGeotag: row.submission_geotag_json
          ? JSON.parse(row.submission_geotag_json)
          : undefined,
      };

      await submitWorkdayReport(projectId, payload);

      await db.runAsync(
        `UPDATE staged_workday_reports SET status = 'SYNCED' WHERE id = ?`,
        [row.id]
      );
      syncedCount += 1;
    }
  } catch (err) {
    console.warn('SyncEngine: workday report sync paused:', err);
  }

  return syncedCount;
}

/**
 * Syncs queued offline emergency/incident reports from SQLite.
 */
async function flushQueuedIncidents(projectId: string): Promise<number> {
  const db = await getDatabase();
  if (!db) return 0;

  let syncedCount = 0;
  try {
    const rows = await db.getAllAsync<any>(
      `SELECT * FROM incident_reports WHERE status = 'QUEUED_OFFLINE' ORDER BY created_at ASC`
    );

    for (const row of rows) {
      await createIncidentReport(projectId, {
        projectId,
        category: row.category,
        severity: row.severity,
        title: row.title,
        description: row.description,
        isConfidentialWhistleblower: Boolean(row.is_confidential_whistleblower),
        photoEvidenceUrls: row.photos_json ? JSON.parse(row.photos_json) : [],
      });

      await db.runAsync(
        `UPDATE incident_reports SET status = 'SYNCED' WHERE id = ?`,
        [row.id]
      );
      syncedCount += 1;
    }
  } catch (err) {
    console.warn('SyncEngine: incident sync paused:', err);
  }

  return syncedCount;
}

/**
 * Checks connectivity and flushes all eligible locally stored SQLite queues.
 */
export async function triggerOfflineSync(
  reason = 'manual'
): Promise<SyncStatusSnapshot> {
  if (isSyncInProgress) {
    return getSyncStatusSnapshot();
  }

  const netState = await Network.getNetworkStateAsync();
  const isOnline = Boolean(
    netState.isConnected && netState.isInternetReachable !== false
  );

  currentSnapshot = {
    ...currentSnapshot,
    isOnline,
  };

  if (!isOnline) {
    await refreshPendingCounts();
    return getSyncStatusSnapshot();
  }

  const profile = await loadLocalProfile();
  const projectId = profile?.activeProjectId || 'proj-lkk-402';
  const isApproved = profile?.assuranceStatus === 'APPROVED';

  isSyncInProgress = true;
  currentSnapshot = {
    ...currentSnapshot,
    isSyncing: true,
    lastError: null,
  };
  notifyListeners();

  try {
    const [telemetrySynced, incidentsSynced, reportsSynced, assuranceSynced] =
      await Promise.all([
        flushTelemetryQueue(projectId),
        flushQueuedIncidents(projectId),
        flushQueuedWorkdayReports(projectId, isApproved),
        flushQueuedAssuranceVerifications(projectId),
      ]);

    if (telemetrySynced + incidentsSynced + reportsSynced + assuranceSynced > 0) {
      currentSnapshot = {
        ...currentSnapshot,
        lastSyncedAt: new Date().toISOString(),
      };
    }
  } catch (err: any) {
    currentSnapshot = {
      ...currentSnapshot,
      lastError: err?.message || `Sync failed (${reason})`,
    };
  } finally {
    isSyncInProgress = false;
    currentSnapshot = {
      ...currentSnapshot,
      isSyncing: false,
    };
    await refreshPendingCounts(projectId);
  }

  return getSyncStatusSnapshot();
}

/**
 * Starts the background network state listener & AppState foreground sync trigger.
 * Automatically flushes queued SQLite data whenever network becomes available.
 */
export function startNetworkSyncListener(): () => void {
  // Initial connectivity check & sync on startup
  triggerOfflineSync('startup').catch(() => {});

  const networkSubscription = Network.addNetworkStateListener((state) => {
    const online = Boolean(
      state.isConnected && state.isInternetReachable !== false
    );
    const wasOffline = !currentSnapshot.isOnline;

    currentSnapshot = {
      ...currentSnapshot,
      isOnline: online,
    };
    notifyListeners();

    if (online && wasOffline) {
      triggerOfflineSync('network_restored').catch(() => {});
    } else if (online) {
      triggerOfflineSync('network_change').catch(() => {});
    }
  });

  const appStateSubscription = AppState.addEventListener(
    'change',
    (nextState: AppStateStatus) => {
      if (nextState === 'active') {
        triggerOfflineSync('app_foreground').catch(() => {});
      }
    }
  );

  return () => {
    networkSubscription.remove();
    appStateSubscription.remove();
  };
}
