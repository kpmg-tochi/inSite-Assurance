import type {
  CaptureMediaType,
  GeofenceStatus,
  MorningDeliverableBriefDto,
  PlanningTier,
  ReportQueryDto,
  WbsChatMessageDto,
} from '@insite/shared';
import { fetchMorningBriefs, fetchProjectBoqItems } from '../api/boq/boqApi';
import { fetchBoqChatMessages } from '../api/wbs/wbsChatApi';
import { getDb, newId, nowIso } from './db/database';
import { enqueue, findOpenRowId } from './outbox/outboxStore';
import { kickOutbox } from './outbox/outboxProcessor';
import { captureDisplayUri, getCaptures, type CaptureRecord } from './captureStore';
import { getHeldState } from './heldItems';
import { currentPeriod, reportedWbsItemIds } from './reportStore';
import { personaCopy } from '../utils/personaCopy';
import { briefMetaJson, parseBriefMeta, type BriefMeta } from './briefMeta';

export type { BriefMeta } from './briefMeta';

/**
 * WBS threads and their chat (Phase 4). All persistence is SQLite; there is no in-memory copy
 * that could diverge from it. Messages the user writes are saved first, then queued; server
 * messages are merged by clientMessageId so nothing appears twice.
 */

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
  holdPointInstruction: string | null;
  isScheduledToday: boolean;
  planningTier: PlanningTier;
  /** A report for this item exists for the current period (on this device or on the server). */
  isReportedToday: boolean;
  unreadCount: number;
  lastMessageText: string;
  /** ISO time of the last message, or '' if none. Format at render. */
  lastMessageTimestamp: string;
}

export type ChatMessageType =
  | 'MORNING_BRIEF'
  | 'PHOTO'
  | 'TEXT_COMMENT'
  | 'VOICE_NOTE'
  | 'EOD_PROMPT'
  | 'AI_QUERY'
  | 'MONITOR_QUERY'
  | 'QUERY_RESPONSE';

export type ChatSyncStatus = 'QUEUED' | 'SENT' | 'SERVER';

export interface ChatCaptureView {
  id: string;
  mediaType: CaptureMediaType | string;
  /** Local file, or null when only the server copy remains. */
  localUri: string | null;
  objectKey: string | null;
  durationSeconds: number | null;
  /** null when not known on this device (a capture sent from another device). */
  locationAvailable: boolean | null;
  isMocked: boolean;
  /** Server result once registered; otherwise null (not yet known). */
  isWithinGeofence: boolean | null;
  /** Server status once registered (Phase 6): INSIDE, WITHIN_TOLERANCE or OUTSIDE; null when not known. */
  geofenceStatus: GeofenceStatus | null;
  /** Metres outside the boundary as the server measured it; null when not known. */
  distanceOutsideMeters: number | null;
  chainageLabel: string | null;
  uploadState: 'PENDING_UPLOAD' | 'UPLOADED' | 'SERVER_ONLY';
  integrityPassed: boolean | null;
}

export interface WbsChatMessageRecord {
  id: string;
  wbsItemId: string;
  senderName: string;
  senderRole: string;
  senderSessionId: string | null;
  messageType: ChatMessageType;
  textContent?: string;
  capture?: ChatCaptureView;
  workdayReportId?: string | null;
  reportQueryId?: string | null;
  queryDetails?: ReportQueryDto | null;
  /** For morning briefs: the day the brief is for. */
  briefDate?: string | null;
  /** For morning briefs synced since Phase 7; null for older cached briefs. */
  brief?: BriefMeta | null;
  /** ISO timestamp. Format at render. */
  createdAt: string;
  syncStatus: ChatSyncStatus;
  /** Queued under a session that has ended; waiting for the person to remove or update it (Step 8). */
  heldAfterSessionEnd?: boolean;
}

type ItemRow = {
  id: string;
  project_id: string;
  wbs_code: string;
  description: string;
  unit: string;
  rate_ngn: number;
  total_quantity: number;
  cumulative_certified_pct: number;
  is_hold_point: number;
  hold_point_instruction: string | null;
  is_scheduled_today: number;
  planning_tier: string;
  last_message_text: string | null;
  last_message_at: string | null;
};

type MessageRow = {
  id: string;
  client_message_id: string | null;
  server_id: string | null;
  project_id: string;
  wbs_item_id: string;
  sender_session_id: string | null;
  sender_name: string;
  sender_role: string;
  message_type: string;
  text_content: string | null;
  capture_id: string | null;
  capture_json: string | null;
  workday_report_id: string | null;
  report_query_id: string | null;
  query_json: string | null;
  brief_date: string | null;
  brief_json: string | null;
  created_at: string;
  sync_status: string;
};

/** Threads for a project from SQLite, with "reported" computed from reports for this period. */
export async function getWbsThreads(projectId: string): Promise<WbsItemRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ItemRow>(
    `SELECT * FROM wbs_items WHERE project_id = ?
     ORDER BY is_scheduled_today DESC, is_hold_point DESC, wbs_code ASC`,
    [projectId]
  );
  const reported = await reportedWbsItemIds(projectId, currentPeriod(new Date(), projectId)).catch(() => new Set<string>());
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
    holdPointInstruction: r.hold_point_instruction,
    isScheduledToday: Boolean(r.is_scheduled_today),
    planningTier: (r.planning_tier || 'UNBLOCKED_POOL') as PlanningTier,
    isReportedToday: reported.has(r.id),
    unreadCount: 0,
    lastMessageText: r.last_message_text ?? '',
    lastMessageTimestamp: r.last_message_at ?? '',
  }));
}

/** Brief body as stored. The pointers heading follows the persona the server wrote the brief for. */
function briefText(brief: MorningDeliverableBriefDto): string {
  const heading = personaCopy(brief.targetPersona).pointersHeading;
  const checklist =
    brief.reportingChecklist.length > 0
      ? `\n\n${heading}\n${brief.reportingChecklist.map((p) => `• ${p}`).join('\n')}`
      : '';
  return `${brief.headline}\n${brief.expectedDeliverable}${checklist}`;
}

/**
 * Pulls BOQ items and morning briefs into SQLite. Briefs are upserted, so a regenerated brief
 * replaces the old one (TD-P2-5). On failure the cached threads are returned with the error.
 */
export async function syncWbsInboxFromServer(projectId: string): Promise<{
  items: WbsItemRecord[];
  syncError: string | null;
}> {
  let syncError: string | null = null;
  try {
    const [boqItems, morningBriefs] = await Promise.all([
      fetchProjectBoqItems(projectId),
      fetchMorningBriefs(projectId).catch(() => [] as MorningDeliverableBriefDto[]),
    ]);
    const briefByBoqId = new Map(morningBriefs.map((b) => [b.boqItemId, b]));
    const db = await getDb();
    await db.withTransactionAsync(async () => {
      for (const b of boqItems ?? []) {
        const brief = briefByBoqId.get(b.id);
        const tier: PlanningTier =
          brief?.planningTier || (b.planningTier as PlanningTier) || (b.isScheduledToday ? 'PLAN_A' : 'UNBLOCKED_POOL');
        await db.runAsync(
          `INSERT INTO wbs_items (id, project_id, wbs_code, description, unit, rate_ngn, total_quantity,
             cumulative_certified_pct, is_hold_point, hold_point_instruction, is_scheduled_today, planning_tier)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             wbs_code = excluded.wbs_code, description = excluded.description, unit = excluded.unit,
             rate_ngn = excluded.rate_ngn, total_quantity = excluded.total_quantity,
             cumulative_certified_pct = excluded.cumulative_certified_pct,
             is_hold_point = excluded.is_hold_point, hold_point_instruction = excluded.hold_point_instruction,
             is_scheduled_today = excluded.is_scheduled_today, planning_tier = excluded.planning_tier`,
          [
            b.id,
            projectId,
            b.wbsCode,
            b.description,
            b.unit,
            Number(b.rateNgn ?? 0),
            Number(b.totalQuantity ?? 0),
            Number(b.cumulativeCertifiedPct ?? 0),
            b.isHoldPoint ? 1 : 0,
            b.holdPointInstruction ?? null,
            b.isScheduledToday ? 1 : 0,
            tier,
          ]
        );
        if (brief) {
          // One brief message per WBS item, replaced when the brief changes.
          await db.runAsync(
            `INSERT INTO chat_messages (id, project_id, wbs_item_id, sender_name, sender_role, message_type,
               text_content, brief_date, brief_json, created_at, sync_status)
             VALUES (?, ?, ?, 'InSite Morning Brief', 'SYSTEM_BRIEF', 'MORNING_BRIEF', ?, ?, ?, ?, 'SERVER')
             ON CONFLICT(id) DO UPDATE SET text_content = excluded.text_content,
               brief_date = excluded.brief_date, brief_json = excluded.brief_json, created_at = excluded.created_at`,
            [
              `brief-${b.id}`,
              projectId,
              b.id,
              briefText(brief),
              brief.workdayDate,
              briefMetaJson(brief),
              brief.createdAt,
            ]
          );
        }
      }
    });
    await refreshLastMessages(projectId);
  } catch (err) {
    syncError = (err as Error)?.message || 'Offline or server unreachable. Showing saved WBS items.';
  }
  return { items: await getWbsThreads(projectId), syncError };
}

async function refreshLastMessages(projectId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE wbs_items SET
       last_message_text = (SELECT COALESCE(m.text_content, m.message_type) FROM chat_messages m
                            WHERE m.wbs_item_id = wbs_items.id ORDER BY m.created_at DESC LIMIT 1),
       last_message_at = (SELECT m.created_at FROM chat_messages m
                          WHERE m.wbs_item_id = wbs_items.id ORDER BY m.created_at DESC LIMIT 1)
     WHERE project_id = ?`,
    [projectId]
  );
}

function captureView(c: CaptureRecord | undefined, server?: WbsChatMessageDto['capture']): ChatCaptureView | undefined {
  if (c) {
    return {
      id: c.id,
      mediaType: c.mediaType,
      localUri: captureDisplayUri(c),
      objectKey: c.objectKey,
      durationSeconds: c.durationSeconds,
      locationAvailable: c.fix !== null,
      isMocked: c.fix?.isMocked ?? false,
      isWithinGeofence: c.server?.isWithinGeofence ?? null,
      geofenceStatus: c.server?.geofenceStatus ?? null,
      // Metres outside the boundary (0 inside), as evaluated by the server.
      distanceOutsideMeters: c.server?.geofenceStatus ? c.server.distanceOutsideMeters ?? null : null,
      chainageLabel: c.server?.chainageLabel ?? null,
      uploadState: c.uploadStatus === 'REGISTERED' ? 'UPLOADED' : 'PENDING_UPLOAD',
      integrityPassed: c.server?.integrityPassed ?? null,
    };
  }
  if (server) {
    return {
      id: server.clientCaptureId,
      mediaType: server.mediaType,
      localUri: null,
      objectKey: server.objectKey,
      durationSeconds: server.durationSeconds,
      locationAvailable: null,
      isMocked: false,
      isWithinGeofence: null,
      geofenceStatus: null,
      distanceOutsideMeters: null,
      chainageLabel: null,
      uploadState: 'SERVER_ONLY',
      integrityPassed: null,
    };
  }
  return undefined;
}

/** Messages for a thread from SQLite, oldest first. */
export async function getWbsChatMessages(wbsItemId: string): Promise<WbsChatMessageRecord[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<MessageRow>(
    'SELECT * FROM chat_messages WHERE wbs_item_id = ? ORDER BY created_at ASC',
    [wbsItemId]
  );
  const captures = await getCaptures(rows.map((r) => r.capture_id).filter((id): id is string => Boolean(id)));
  const byId = new Map(captures.map((c) => [c.id, c]));
  const held = await getHeldState();
  return rows.map((r) => {
    const query = r.query_json ? (JSON.parse(r.query_json) as ReportQueryDto) : null;
    return {
      id: r.id,
      wbsItemId: r.wbs_item_id,
      senderName: r.sender_name,
      senderRole: r.sender_role,
      senderSessionId: r.sender_session_id,
      messageType: r.message_type as ChatMessageType,
      textContent: r.text_content ?? undefined,
      capture: r.capture_id
        ? captureView(
            byId.get(r.capture_id),
            r.capture_json ? (JSON.parse(r.capture_json) as WbsChatMessageDto['capture']) : undefined
          )
        : undefined,
      workdayReportId: r.workday_report_id,
      reportQueryId: r.report_query_id,
      queryDetails: query,
      briefDate: r.brief_date,
      brief: r.message_type === 'MORNING_BRIEF' ? parseBriefMeta(r.brief_json) : null,
      createdAt: r.created_at,
      syncStatus: r.sync_status as ChatSyncStatus,
      heldAfterSessionEnd:
        Boolean(r.client_message_id && held.messageIds.has(r.client_message_id)) ||
        Boolean(r.capture_id && r.sync_status !== 'SERVER' && held.captureIds.has(r.capture_id)),
    };
  });
}

/**
 * Merges server messages into SQLite: a message this device sent (same clientMessageId) is
 * updated in place, others are inserted once by server ID. Returns the merged thread.
 */
export async function syncWbsChatMessagesFromServer(
  projectId: string | null | undefined,
  wbsItemId: string
): Promise<WbsChatMessageRecord[]> {
  if (projectId) {
    try {
      const serverMessages = await fetchBoqChatMessages(projectId, wbsItemId);
      const db = await getDb();
      await db.withTransactionAsync(async () => {
        for (const s of serverMessages) {
          const queryJson = s.queryDetails ? JSON.stringify(s.queryDetails) : null;
          if (s.clientMessageId) {
            const updated = await db.runAsync(
              `UPDATE chat_messages SET server_id = ?, sync_status = 'SENT', query_json = COALESCE(?, query_json)
               WHERE client_message_id = ?`,
              [s.id, queryJson, s.clientMessageId]
            );
            if (updated.changes > 0) continue;
          }
          await db.runAsync(
            `INSERT INTO chat_messages (id, client_message_id, server_id, project_id, wbs_item_id,
               sender_session_id, sender_name, sender_role, message_type, text_content, capture_id,
               capture_json, workday_report_id, report_query_id, query_json, created_at, sync_status)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'SERVER')
             ON CONFLICT(id) DO UPDATE SET query_json = excluded.query_json, text_content = excluded.text_content`,
            [
              s.id,
              s.clientMessageId ?? null,
              s.id,
              projectId,
              wbsItemId,
              s.senderSessionId ?? null,
              s.senderName,
              s.senderRole,
              s.messageType,
              s.textContent ?? null,
              s.capture?.clientCaptureId ?? null,
              s.capture ? JSON.stringify(s.capture) : null,
              s.workdayReportId ?? null,
              s.reportQueryId ?? null,
              queryJson,
              s.createdAt,
            ]
          );
        }
      });
      await refreshLastMessages(projectId);
    } catch {
      // Offline: show what is stored.
    }
  }
  return getWbsChatMessages(wbsItemId);
}

export interface SendChatMessageInput {
  projectId: string;
  wbsItemId: string;
  senderName: string;
  senderSessionId: string | null;
  senderRole: string;
  messageType: 'TEXT_COMMENT' | 'PHOTO' | 'VOICE_NOTE';
  textContent?: string | null;
  /** clientCaptureId of a capture saved with captureStore.saveCapture. */
  captureId?: string | null;
  workdayReportId?: string | null;
  reportQueryId?: string | null;
}

/** Saves a message and queues it (behind its capture, if any). Returns once it is stored. */
export async function sendWbsChatMessage(input: SendChatMessageInput): Promise<WbsChatMessageRecord> {
  const db = await getDb();
  const clientMessageId = newId();
  const createdAt = nowIso();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO chat_messages (id, client_message_id, project_id, wbs_item_id, sender_session_id,
         sender_name, sender_role, message_type, text_content, capture_id, workday_report_id,
         report_query_id, created_at, sync_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED')`,
      [
        clientMessageId,
        clientMessageId,
        input.projectId,
        input.wbsItemId,
        input.senderSessionId,
        input.senderName,
        input.senderRole,
        input.messageType,
        input.textContent ?? null,
        input.captureId ?? null,
        input.workdayReportId ?? null,
        input.reportQueryId ?? null,
        createdAt,
      ]
    );
    const dependsOn: string[] = [];
    if (input.captureId) {
      const open = await findOpenRowId(db, 'CAPTURE', input.captureId);
      if (open) dependsOn.push(open);
    }
    await enqueue(db, {
      projectId: input.projectId,
      kind: 'CHAT_MESSAGE',
      entityId: clientMessageId,
      dependsOn,
    });
    await db.runAsync(
      'UPDATE wbs_items SET last_message_text = ?, last_message_at = ? WHERE id = ?',
      [input.textContent || (input.messageType === 'PHOTO' ? 'Photo' : 'Voice note'), createdAt, input.wbsItemId]
    );
  });
  kickOutbox();
  const all = await getWbsChatMessages(input.wbsItemId);
  return all.find((m) => m.id === clientMessageId)!;
}

/** Request body for a queued message (used by the outbox handler). */
export async function loadQueuedMessage(clientMessageId: string): Promise<{
  projectId: string;
  wbsItemId: string;
  body: {
    clientMessageId: string;
    messageType: 'TEXT_COMMENT' | 'PHOTO' | 'VOICE_NOTE';
    textContent?: string;
    captureId?: string;
    workdayReportId?: string;
    reportQueryId?: string;
  };
} | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<MessageRow>('SELECT * FROM chat_messages WHERE client_message_id = ?', [
    clientMessageId,
  ]);
  if (!r) return null;
  return {
    projectId: r.project_id,
    wbsItemId: r.wbs_item_id,
    body: {
      clientMessageId,
      messageType: r.message_type as 'TEXT_COMMENT' | 'PHOTO' | 'VOICE_NOTE',
      ...(r.text_content ? { textContent: r.text_content } : {}),
      ...(r.capture_id ? { captureId: r.capture_id } : {}),
      ...(r.workday_report_id ? { workdayReportId: r.workday_report_id } : {}),
      ...(r.report_query_id ? { reportQueryId: r.report_query_id } : {}),
    },
  };
}

export async function markMessageSent(clientMessageId: string, serverId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE chat_messages SET server_id = ?, sync_status = 'SENT' WHERE client_message_id = ?`,
    [serverId, clientMessageId]
  );
}
