import type { MorningDeliverableBriefDto, PlanningTier } from '@insite/shared';
import { getDatabase } from './sqliteDatabase';
import { fetchMorningBriefs, fetchProjectBoqItems } from '../api/boq/boqApi';
import { submitWorkdayReport } from '../api/workday/workdayApi';
import type { SiteGeotag } from '../services/locationService';
import { recordTelemetryPing } from './telemetryRepository';
import { flushTelemetryQueue } from '../services/telemetryService';

export interface WbsItemRecord {
  id: string;
  projectId: string;
  wbsCode: string;
  description: string;
  unit: string;
  rateNgn: number;
  totalQuantity: number;
  cumulativeCertifiedPct: number;
  isHoldPoint: boolean;
  isScheduledToday: boolean;
  planningTier: PlanningTier;
  isReportedToday: boolean;
  unreadCount: number;
  lastMessageText: string;
  lastMessageTimestamp: string;
}

export interface WbsChatMessageRecord {
  id: string;
  wbsItemId: string;
  senderName: string;
  senderRole: string; // 'SYSTEM_BRIEF' | 'ENGINEER' | 'INSPECTOR' | 'MONITOR'
  messageType:
    | 'MORNING_BRIEF'
    | 'PHOTO'
    | 'TEXT_COMMENT'
    | 'VOICE_NOTE'
    | 'EOD_PROMPT'
    | 'AI_CONFIRMATION';
  textContent?: string;
  mediaUri?: string;
  mediaUris?: string[];
  caption?: string;
  durationMs?: number;
  waveform?: number[];
  latitude?: number;
  longitude?: number;
  chainageLabel?: string;
  timestamp: string;
  isDelivered: boolean;
}

export interface StagedWorkdayReportRecord {
  id: string;
  wbsItemId: string;
  wbsCode?: string;
  wbsDescription?: string;
  workdayDate: string;
  summaryText: string;
  reportedQuantity: number;
  unit: string;
  status: string;
  createdAt: string;
}

// Local memory cache (populated from SQLite / API; zero hardcoded demo fixtures)
let memWbsItems: WbsItemRecord[] = [];
let memChatMessages: Record<string, WbsChatMessageRecord[]> = {};
let memStagedReports: StagedWorkdayReportRecord[] = [];

/**
 * Retrieve all actionable WBS threads for the current project from SQLite cache.
 */
export async function getWbsThreads(projectId: string): Promise<WbsItemRecord[]> {
  const db = await getDatabase();
  if (db) {
    try {
      const rows = await db.getAllAsync<any>(
        'SELECT * FROM wbs_items WHERE project_id = ? ORDER BY is_scheduled_today DESC, is_hold_point DESC, wbs_code ASC',
        [projectId]
      );
      if (rows && rows.length > 0) {
        return rows.map((r) => ({
          id: r.id,
          projectId: r.project_id,
          wbsCode: r.wbs_code,
          description: r.description,
          unit: r.unit,
          rateNgn: r.rate_ngn,
          totalQuantity: r.total_quantity,
          cumulativeCertifiedPct: r.cumulative_certified_pct,
          isHoldPoint: Boolean(r.is_hold_point),
          isScheduledToday: Boolean(r.is_scheduled_today),
          planningTier: (r.planning_tier ||
            (r.is_scheduled_today ? 'PLAN_A' : 'UNBLOCKED_POOL')) as PlanningTier,
          isReportedToday: Boolean(r.is_reported_today),
          unreadCount: r.unread_count,
          lastMessageText: r.last_message_text || '',
          lastMessageTimestamp: r.last_message_timestamp || '',
        }));
      }
    } catch (e) {
      console.warn('SQLite error loading WBS threads:', e);
    }
  }
  return memWbsItems.filter((w) => w.projectId === projectId);
}

/**
 * Hydrates WBS threads and today's Morning Deliverable Briefs from the backend API
 * into local SQLite storage.
 */
export async function syncWbsInboxFromServer(projectId: string): Promise<{
  items: WbsItemRecord[];
  syncError: string | null;
}> {
  let syncError: string | null = null;

  try {
    const [boqItems, morningBriefs] = await Promise.all([
      fetchProjectBoqItems(projectId),
      fetchMorningBriefs(projectId).catch(
        () => [] as MorningDeliverableBriefDto[]
      ),
    ]);

    const briefByBoqId = new Map<string, MorningDeliverableBriefDto>();
    for (const brief of morningBriefs) {
      briefByBoqId.set(brief.boqItemId, brief);
    }

    const mapped: WbsItemRecord[] = (boqItems || []).map((b) => {
      const brief = briefByBoqId.get(b.id);
      const isScheduled = Boolean(b.isScheduledToday);
      const tier: PlanningTier =
        brief?.planningTier ||
        (b.planningTier as PlanningTier) ||
        (isScheduled ? 'PLAN_A' : 'UNBLOCKED_POOL');

      return {
        id: b.id,
        projectId,
        wbsCode: b.wbsCode,
        description: b.description,
        unit: b.unit,
        rateNgn: Number(b.rateNgn ?? 0),
        totalQuantity: Number(b.totalQuantity ?? 0),
        cumulativeCertifiedPct: Number(b.cumulativeCertifiedPct ?? 0),
        isHoldPoint: Boolean(b.isHoldPoint),
        isScheduledToday: isScheduled,
        planningTier: tier,
        isReportedToday: Number(b.cumulativeCertifiedPct ?? 0) >= 100,
        unreadCount: brief ? 1 : 0,
        lastMessageText: brief
          ? `${brief.headline} · ${brief.expectedDeliverable}`
          : b.holdPointInstruction || 'Tap to log site progress or photos',
        lastMessageTimestamp: brief ? '08:00 WAT' : '',
      };
    });

    memWbsItems = mapped;

    const db = await getDatabase();
    if (db) {
      for (const item of mapped) {
        await db.runAsync(
          `INSERT OR REPLACE INTO wbs_items
           (id, project_id, wbs_code, description, unit, rate_ngn, total_quantity,
            cumulative_certified_pct, is_hold_point, is_scheduled_today, planning_tier,
            is_reported_today, unread_count, last_message_text, last_message_timestamp)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            item.id,
            item.projectId,
            item.wbsCode,
            item.description,
            item.unit,
            item.rateNgn,
            item.totalQuantity,
            item.cumulativeCertifiedPct,
            item.isHoldPoint ? 1 : 0,
            item.isScheduledToday ? 1 : 0,
            item.planningTier,
            item.isReportedToday ? 1 : 0,
            item.unreadCount,
            item.lastMessageText,
            item.lastMessageTimestamp,
          ]
        );

        const brief = briefByBoqId.get(item.id);
        if (brief) {
          const briefMsgId = `brief-${brief.id}`;
          const checklistText =
            brief.reportingChecklist.length > 0
              ? `\n\nReport Pointers:\n${brief.reportingChecklist
                  .map((p) => `• ${p}`)
                  .join('\n')}`
              : '';
          const fullText = `${brief.headline}\n${brief.expectedDeliverable}${checklistText}`;

          await db.runAsync(
            `INSERT OR IGNORE INTO wbs_chat_messages
             (id, wbs_item_id, sender_name, sender_role, message_type, text_content, timestamp, is_delivered)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              briefMsgId,
              item.id,
              'InSite Morning Brief',
              'SYSTEM_BRIEF',
              'MORNING_BRIEF',
              fullText,
              '08:00 WAT',
              1,
            ]
          );
        }
      }
    }
  } catch (err: any) {
    syncError =
      err?.message || 'Offline or server unreachable — showing cached WBS items.';
  }

  const items = await getWbsThreads(projectId);
  return { items, syncError };
}

/**
 * Retrieve chat timeline messages for a specific WBS thread.
 */
export async function getWbsChatMessages(
  wbsItemId: string
): Promise<WbsChatMessageRecord[]> {
  const db = await getDatabase();
  if (db) {
    try {
      const rows = await db.getAllAsync<any>(
        'SELECT * FROM wbs_chat_messages WHERE wbs_item_id = ? ORDER BY rowid ASC',
        [wbsItemId]
      );
      if (rows && rows.length > 0) {
        return rows.map((r) => ({
          id: r.id,
          wbsItemId: r.wbs_item_id,
          senderName: r.sender_name,
          senderRole: r.sender_role,
          messageType: r.message_type,
          textContent: r.text_content,
          mediaUri: r.media_uri,
          mediaUris: r.media_uris_json ? JSON.parse(r.media_uris_json) : undefined,
          caption: r.caption,
          durationMs: r.duration_ms ?? undefined,
          waveform: r.waveform_json ? JSON.parse(r.waveform_json) : undefined,
          latitude: r.latitude,
          longitude: r.longitude,
          chainageLabel: r.chainage_label,
          timestamp: r.timestamp,
          isDelivered: Boolean(r.is_delivered),
        }));
      }
    } catch (e) {
      console.warn('SQLite error loading messages:', e);
    }
  }
  return memChatMessages[wbsItemId] ? [...memChatMessages[wbsItemId]] : [];
}

/**
 * Append a new message (photo, comment, or voice note) to a WBS chat thread.
 */
export async function sendWbsChatMessage(
  message: Omit<WbsChatMessageRecord, 'id' | 'isDelivered'>
): Promise<WbsChatMessageRecord> {
  const newMsg: WbsChatMessageRecord = {
    ...message,
    id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    isDelivered: true,
  };

  if (!memChatMessages[message.wbsItemId]) {
    memChatMessages[message.wbsItemId] = [];
  }
  memChatMessages[message.wbsItemId].push(newMsg);

  const previewText =
    message.caption || message.textContent || 'New attachment captured';
  const parent = memWbsItems.find((w) => w.id === message.wbsItemId);
  if (parent) {
    parent.lastMessageText = previewText;
    parent.lastMessageTimestamp = message.timestamp;
  }

  const db = await getDatabase();
  if (db) {
    try {
      await db.runAsync(
        `INSERT INTO wbs_chat_messages 
         (id, wbs_item_id, sender_name, sender_role, message_type, text_content, media_uri, media_uris_json, caption, duration_ms, waveform_json, latitude, longitude, chainage_label, timestamp, is_delivered)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newMsg.id,
          newMsg.wbsItemId,
          newMsg.senderName,
          newMsg.senderRole,
          newMsg.messageType,
          newMsg.textContent ?? null,
          newMsg.mediaUri ?? null,
          newMsg.mediaUris ? JSON.stringify(newMsg.mediaUris) : null,
          newMsg.caption ?? null,
          newMsg.durationMs ?? null,
          newMsg.waveform ? JSON.stringify(newMsg.waveform) : null,
          newMsg.latitude ?? null,
          newMsg.longitude ?? null,
          newMsg.chainageLabel ?? null,
          newMsg.timestamp,
          1,
        ]
      );

      await db.runAsync(
        `UPDATE wbs_items SET last_message_text = ?, last_message_timestamp = ? WHERE id = ?`,
        [previewText, message.timestamp, message.wbsItemId]
      );
    } catch (e) {
      console.warn('SQLite error inserting chat message:', e);
    }
  }

  return newMsg;
}

export interface SubmitConfirmedWorkdayInput {
  projectId: string;
  wbsItem: WbsItemRecord;
  senderName: string;
  reportedQuantity: number;
  unitOfMeasure: string;
  summaryText: string;
  delaysOrBlockers?: string;
  isHoldPointClaimed: boolean;
  voiceNoteUri?: string | null;
  submissionGeotag: SiteGeotag | null;
  isVerifiedAccount?: boolean;
}

export interface SubmitConfirmedWorkdayResult {
  localReportId: string;
  syncStatus: 'SYNCED' | 'QUEUED_OFFLINE' | 'STAGED_UNVERIFIED';
}

/**
 * Persists a confirmed End-of-Day workday report with its submission geotag
 * offline-first into SQLite, logs a REPORT_SUBMISSION telemetry ping, posts a
 * confirmation bubble in the WBS chat thread, and attempts backend sync (when verified).
 */
export async function submitConfirmedWorkdayReport(
  input: SubmitConfirmedWorkdayInput
): Promise<SubmitConfirmedWorkdayResult> {
  const localReportId = `eod-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const createdAt = new Date().toISOString();
  const workdayDate = createdAt.slice(0, 10);

  if (input.submissionGeotag) {
    await recordTelemetryPing({
      projectId: input.projectId,
      wbsItemId: input.wbsItem.id,
      geotag: input.submissionGeotag,
      pingSource: 'REPORT_SUBMISSION',
    });
  }

  const threadMessages = await getWbsChatMessages(input.wbsItem.id);
  const evidenceItems = threadMessages
    .filter(
      (m) =>
        m.messageType === 'PHOTO' ||
        m.messageType === 'VOICE_NOTE' ||
        m.messageType === 'TEXT_COMMENT'
    )
    .map((m) => ({
      id: m.id,
      type:
        m.messageType === 'PHOTO'
          ? ('PHOTO' as const)
          : m.messageType === 'VOICE_NOTE'
          ? ('VOICE_NOTE' as const)
          : ('TEXT_NOTE' as const),
      mediaUrl: m.mediaUri,
      caption: m.caption || m.textContent,
      gpsCoordinates:
        typeof m.latitude === 'number' && typeof m.longitude === 'number'
          ? { latitude: m.latitude, longitude: m.longitude }
          : undefined,
      capturedAt: createdAt,
    }));

  const payload = {
    localReportId,
    projectId: input.projectId,
    wbsItemId: input.wbsItem.id,
    workdayDate,
    summaryText: input.summaryText,
    voiceNoteUrl: input.voiceNoteUri ?? null,
    evidenceItems,
    reportedQuantity: input.reportedQuantity,
    unitOfMeasure: input.unitOfMeasure,
    delaysOrBlockers: input.delaysOrBlockers || undefined,
    isHoldPointClaimed: input.isHoldPointClaimed,
    submissionGeotag: input.submissionGeotag ?? undefined,
  };

  let syncStatus: 'SYNCED' | 'QUEUED_OFFLINE' | 'STAGED_UNVERIFIED' =
    input.isVerifiedAccount === false ? 'STAGED_UNVERIFIED' : 'QUEUED_OFFLINE';

  if (syncStatus !== 'STAGED_UNVERIFIED') {
    try {
      await submitWorkdayReport(input.projectId, payload);
      syncStatus = 'SYNCED';
      await flushTelemetryQueue(input.projectId);
    } catch {
      syncStatus = 'QUEUED_OFFLINE';
    }
  }

  const stagedRecord: StagedWorkdayReportRecord = {
    id: localReportId,
    wbsItemId: input.wbsItem.id,
    wbsCode: input.wbsItem.wbsCode,
    wbsDescription: input.wbsItem.description,
    workdayDate,
    summaryText: input.summaryText,
    reportedQuantity: input.reportedQuantity,
    unit: input.unitOfMeasure,
    status: syncStatus,
    createdAt,
  };
  memStagedReports = [stagedRecord, ...memStagedReports];

  const db = await getDatabase();
  if (db) {
    try {
      await db.runAsync(
        `INSERT INTO staged_workday_reports
         (id, wbs_item_id, workday_date, summary_text, reported_quantity, unit, status, evidence_json, voice_note_uri, submission_geotag_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          localReportId,
          input.wbsItem.id,
          workdayDate,
          input.summaryText,
          input.reportedQuantity,
          input.unitOfMeasure,
          syncStatus,
          JSON.stringify(evidenceItems),
          input.voiceNoteUri ?? null,
          input.submissionGeotag ? JSON.stringify(input.submissionGeotag) : null,
          createdAt,
        ]
      );

      await db.runAsync(
        `UPDATE wbs_items SET is_reported_today = 1 WHERE id = ?`,
        [input.wbsItem.id]
      );
    } catch (err) {
      console.warn('SQLite error saving workday report:', err);
    }
  }

  const gpsLabel = input.submissionGeotag
    ? `GPS ${input.submissionGeotag.latitude.toFixed(4)}, ${input.submissionGeotag.longitude.toFixed(4)}`
    : 'GPS pending';

  await sendWbsChatMessage({
    wbsItemId: input.wbsItem.id,
    senderName: input.senderName,
    senderRole: 'ENGINEER',
    messageType: 'AI_CONFIRMATION',
    textContent: `Daily Report Signed Off: ${input.reportedQuantity} ${input.unitOfMeasure} · ${input.summaryText}`,
    latitude: input.submissionGeotag?.latitude,
    longitude: input.submissionGeotag?.longitude,
    chainageLabel: input.submissionGeotag?.chainageLabel || gpsLabel,
    timestamp: 'Just now',
  });

  return { localReportId, syncStatus };
}

/**
 * Queries real staged/queued workday reports from SQLite for BacklogReviewModal.
 */
export async function getStagedBacklogReports(): Promise<
  StagedWorkdayReportRecord[]
> {
  const db = await getDatabase();
  if (db) {
    try {
      const rows = await db.getAllAsync<any>(
        `SELECT r.*, w.wbs_code, w.description as wbs_description
         FROM staged_workday_reports r
         LEFT JOIN wbs_items w ON w.id = r.wbs_item_id
         WHERE r.status IN ('STAGED_UNVERIFIED', 'QUEUED_OFFLINE')
         ORDER BY r.created_at DESC`
      );
      return rows.map((r) => ({
        id: r.id,
        wbsItemId: r.wbs_item_id,
        wbsCode: r.wbs_code ?? undefined,
        wbsDescription: r.wbs_description ?? undefined,
        workdayDate: r.workday_date,
        summaryText: r.summary_text,
        reportedQuantity: r.reported_quantity,
        unit: r.unit,
        status: r.status,
        createdAt: r.created_at,
      }));
    } catch (err) {
      console.warn('SQLite error loading staged backlog:', err);
    }
  }

  return memStagedReports.filter(
    (r) => r.status === 'STAGED_UNVERIFIED' || r.status === 'QUEUED_OFFLINE'
  );
}

/**
 * Promotes selected STAGED_UNVERIFIED reports to QUEUED_OFFLINE and attempts immediate sync.
 */
export async function promoteAndSyncBacklogReports(
  reportIds: string[],
  projectId: string
): Promise<{ syncedCount: number; queuedCount: number }> {
  if (reportIds.length === 0) return { syncedCount: 0, queuedCount: 0 };

  let syncedCount = 0;
  let queuedCount = 0;
  const db = await getDatabase();

  if (db) {
    for (const id of reportIds) {
      const row = await db.getFirstAsync<any>(
        `SELECT * FROM staged_workday_reports WHERE id = ?`,
        [id]
      );
      if (!row) continue;

      try {
        await submitWorkdayReport(projectId, {
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
        });
        await db.runAsync(
          `UPDATE staged_workday_reports SET status = 'SYNCED' WHERE id = ?`,
          [id]
        );
        syncedCount += 1;
      } catch {
        await db.runAsync(
          `UPDATE staged_workday_reports SET status = 'QUEUED_OFFLINE' WHERE id = ?`,
          [id]
        );
        queuedCount += 1;
      }
    }
  }

  return { syncedCount, queuedCount };
}
