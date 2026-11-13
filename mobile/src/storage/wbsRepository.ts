import { getDatabase } from './sqliteDatabase';

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
  unreadCount: number;
  lastMessageText: string;
  lastMessageTimestamp: string;
}

export interface WbsChatMessageRecord {
  id: string;
  wbsItemId: string;
  senderName: string;
  senderRole: string; // 'SYSTEM_BRIEF' | 'ENGINEER' | 'INSPECTOR' | 'MONITOR'
  messageType: 'MORNING_BRIEF' | 'PHOTO' | 'TEXT_COMMENT' | 'VOICE_NOTE' | 'EOD_PROMPT' | 'AI_CONFIRMATION';
  textContent?: string;
  mediaUri?: string;
  caption?: string;
  latitude?: number;
  longitude?: number;
  chainageLabel?: string;
  timestamp: string;
  isDelivered: boolean;
}

// In-memory fallback dataset for seamless multi-platform execution
let memWbsItems: WbsItemRecord[] = [
  {
    id: 'wbs-01',
    projectId: 'proj-lkk-402',
    wbsCode: '02.03.1',
    description: 'Box Culvert 2.0m x 1.5m at Chainage 14+200',
    unit: 'm3',
    rateNgn: 185000,
    totalQuantity: 42.5,
    cumulativeCertifiedPct: 40,
    isHoldPoint: true,
    isScheduledToday: true,
    unreadCount: 1,
    lastMessageText: 'Site photo captured · Rebar placement inspected at Ch 14+200',
    lastMessageTimestamp: '14:22 WAT',
  },
  {
    id: 'wbs-02',
    projectId: 'proj-lkk-402',
    wbsCode: '01.02.4',
    description: 'Sub-base Compaction & Field Dry Density Test',
    unit: 'm2',
    rateNgn: 4200,
    totalQuantity: 12500,
    cumulativeCertifiedPct: 65,
    isHoldPoint: false,
    isScheduledToday: true,
    unreadCount: 0,
    lastMessageText: 'Morning brief acknowledged · Nuclear density gauge calibrated',
    lastMessageTimestamp: '08:15 WAT',
  },
  {
    id: 'wbs-03',
    projectId: 'proj-lkk-402',
    wbsCode: '03.01.2',
    description: 'Precast Concrete Lined Trapezoidal Drainage Channel',
    unit: 'm',
    rateNgn: 34500,
    totalQuantity: 3400,
    cumulativeCertifiedPct: 20,
    isHoldPoint: true,
    isScheduledToday: false,
    unreadCount: 2,
    lastMessageText: 'Monitor Query: Clarify invert level alignment at Ch 12+800',
    lastMessageTimestamp: 'Yesterday',
  },
];

let memChatMessages: Record<string, WbsChatMessageRecord[]> = {
  'wbs-01': [
    {
      id: 'msg-01',
      wbsItemId: 'wbs-01',
      senderName: 'InSite Morning Brief',
      senderRole: 'SYSTEM_BRIEF',
      messageType: 'MORNING_BRIEF',
      textContent:
        'Deliverable: Complete rebar tying and invert slab formwork for Box Culvert at Ch 14+200. Target volume: 12.0 m3 C25/30 ready-mix pour.',
      timestamp: '08:00 WAT',
      isDelivered: true,
    },
    {
      id: 'msg-02',
      wbsItemId: 'wbs-01',
      senderName: 'Engr. Chukwuma Okeke',
      senderRole: 'ENGINEER',
      messageType: 'PHOTO',
      mediaUri: 'https://images.unsplash.com/photo-1541888946425-d0fbb1861564?auto=format&fit=crop&w=600&q=80',
      caption: 'Invert slab rebar tied according to approved structural bar schedule. 16mm main bars @ 150mm c/c.',
      latitude: 6.4698,
      longitude: 3.5852,
      chainageLabel: 'Ch 14+200',
      timestamp: '11:45 WAT',
      isDelivered: true,
    },
    {
      id: 'msg-03',
      wbsItemId: 'wbs-01',
      senderName: 'Engr. Chukwuma Okeke',
      senderRole: 'ENGINEER',
      messageType: 'TEXT_COMMENT',
      textContent:
        'Ready-mix concrete transit mixer delayed by 45 mins due to expressway checkpoint traffic. Pour now scheduled for 13:30 WAT.',
      timestamp: '12:15 WAT',
      isDelivered: true,
    },
    {
      id: 'msg-04',
      wbsItemId: 'wbs-01',
      senderName: 'InSite Workday End',
      senderRole: 'SYSTEM_BRIEF',
      messageType: 'EOD_PROMPT',
      textContent:
        'Workday complete! Record your daily summary and total placed volume for Box Culvert (WBS 02.03.1).',
      timestamp: '17:00 WAT',
      isDelivered: true,
    },
  ],
};

/**
 * Retrieve all actionable WBS threads for the current project.
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
          unreadCount: r.unread_count,
          lastMessageText: r.last_message_text || '',
          lastMessageTimestamp: r.last_message_timestamp || '',
        }));
      }
    } catch (e) {
      console.warn('SQLite error loading WBS threads, using memory store:', e);
    }
  }
  return [...memWbsItems];
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
        'SELECT * FROM wbs_chat_messages WHERE wbs_item_id = ? ORDER BY timestamp ASC',
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
          caption: r.caption,
          latitude: r.latitude,
          longitude: r.longitude,
          chainageLabel: r.chainage_label,
          timestamp: r.timestamp,
          isDelivered: Boolean(r.is_delivered),
        }));
      }
    } catch (e) {
      console.warn('SQLite error loading messages, using memory store:', e);
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

  // 1. Update memory
  if (!memChatMessages[message.wbsItemId]) {
    memChatMessages[message.wbsItemId] = [];
  }
  memChatMessages[message.wbsItemId].push(newMsg);

  // Update last message preview on parent WBS
  const parent = memWbsItems.find((w) => w.id === message.wbsItemId);
  if (parent) {
    parent.lastMessageText =
      message.caption || message.textContent || 'New attachment captured';
    parent.lastMessageTimestamp = message.timestamp;
  }

  // 2. Persist to SQLite if available
  const db = await getDatabase();
  if (db) {
    try {
      await db.runAsync(
        `INSERT INTO wbs_chat_messages 
         (id, wbs_item_id, sender_name, sender_role, message_type, text_content, media_uri, caption, latitude, longitude, chainage_label, timestamp, is_delivered)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          newMsg.id,
          newMsg.wbsItemId,
          newMsg.senderName,
          newMsg.senderRole,
          newMsg.messageType,
          newMsg.textContent ?? null,
          newMsg.mediaUri ?? null,
          newMsg.caption ?? null,
          newMsg.latitude ?? null,
          newMsg.longitude ?? null,
          newMsg.chainageLabel ?? null,
          newMsg.timestamp,
          1,
        ]
      );
    } catch (e) {
      console.warn('SQLite error inserting chat message:', e);
    }
  }

  return newMsg;
}

