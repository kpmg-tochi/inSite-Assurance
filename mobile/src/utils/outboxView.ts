import { dependencyState, type OutboxKind, type OutboxStatus } from '../storage/outbox/outboxPolicy';
import type { VisitDraftStatus } from './visitModel';

/**
 * Redesign R5e: the Outbox screen's model (pure, Node-tested). One row per open outbox row (not
 * DONE): what it is, its state in words, and which actions are safe. The screen never decides
 * retry or removal rules itself.
 */

/** An open outbox row with the few local facts the screen needs. */
export interface OutboxItem {
  id: string;
  projectId: string;
  kind: OutboxKind;
  entityId: string;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  createdAt: string;
  dependsOn: string[];
  /** CAPTURE: the capture's media type (photo or voice note); null otherwise or when not on the phone. */
  mediaType: string | null;
  /** VISIT_SUBMISSION: the draft's status; null otherwise or when not on the phone. */
  draftStatus: VisitDraftStatus | null;
  /** VISIT_RESPONSE: the visit the response is for (local key). */
  visitId: string | null;
}

export const OUTBOX_KIND_LABELS: Record<OutboxKind, string> = {
  VISIT_SUBMISSION: 'Monitoring report',
  VISIT_CHECK_IN: 'Check-in',
  VISIT_RESPONSE: 'Visit response',
  UNSCHEDULED_VISIT: 'Unscheduled visit',
  SITE_LOG_ENTRY: 'Site log entry',
  CAPTURE: 'Photo',
  DEFECT_ACTION: 'Defect update',
  INCIDENT: 'Incident',
};

export function outboxItemLabel(item: Pick<OutboxItem, 'kind' | 'mediaType'>): string {
  if (item.kind === 'CAPTURE' && item.mediaType === 'VOICE_NOTE') return 'Voice note';
  return OUTBOX_KIND_LABELS[item.kind] ?? 'Item';
}

export type OutboxItemState =
  /** Queued, nothing failed yet. */
  | 'WAITING'
  /** Queued behind items it depends on (photos, check-in, ...). */
  | 'WAITING_FOR_OTHERS'
  /** Failed at least once; tried again automatically. */
  | 'RETRYING'
  /** Stopped: needs Retry (or Remove where safe). */
  | 'FAILED'
  /** A visit report the server refused for good (D-R5.19, D-R5.20). */
  | 'REFUSED'
  /** Queued under a session that has ended (Phase 5 Step 8); never sent as it is. */
  | 'HELD';

export const OUTBOX_STATE_TEXT: Record<OutboxItemState, string> = {
  WAITING: 'Waiting to send',
  WAITING_FOR_OTHERS: 'Waiting for the items it needs',
  RETRYING: 'Trying again',
  FAILED: 'Failed',
  REFUSED: 'Not accepted',
  HELD: 'On hold',
};

/** `statusById`: every open row's status (rows missing from it were sent and purged). */
export function outboxItemState(item: OutboxItem, statusById: Map<string, OutboxStatus>): OutboxItemState {
  if (item.status === 'HELD') return 'HELD';
  if (item.status === 'DEAD') return item.kind === 'VISIT_SUBMISSION' && item.draftStatus === 'REFUSED' ? 'REFUSED' : 'FAILED';
  if (item.dependsOn.length > 0 && dependencyState(item.dependsOn, statusById) !== 'READY') return 'WAITING_FOR_OTHERS';
  return item.attempts > 0 ? 'RETRYING' : 'WAITING';
}

/**
 * How a row can be removed from the phone. Only where nothing else depends on it and the local
 * record is cleaned up with it:
 * - a refused visit report (the draft is deleted, as on the Visit screen);
 * - a failed visit response (the "Waiting to send" overlay goes; the visit keeps its server state);
 * - a failed or held defect update and a failed incident (nothing waits for them);
 * - a held photo or voice note (its file goes if the server never had it).
 * Failed photos, voice notes, check-ins, unscheduled visits and site log entries can only be retried:
 * a visit report may still need them.
 */
export type OutboxRemoveAction =
  | 'DELETE_REFUSED_REPORT'
  | 'DISCARD_RESPONSE'
  | 'DISCARD_DEFECT_UPDATE'
  | 'DISCARD_INCIDENT'
  | 'REMOVE_HELD_CAPTURE';

export interface OutboxItemActions {
  /** Move a failed row back to the queue (`retryOutboxItem`). */
  retry: boolean;
  /** A held photo or voice note: send a re-signed copy under the current session. */
  resendHeld: boolean;
  remove: OutboxRemoveAction | null;
}

export function outboxItemActions(item: OutboxItem): OutboxItemActions {
  if (item.status === 'HELD') {
    if (item.kind === 'CAPTURE') return { retry: false, resendHeld: true, remove: 'REMOVE_HELD_CAPTURE' };
    if (item.kind === 'DEFECT_ACTION') return { retry: false, resendHeld: false, remove: 'DISCARD_DEFECT_UPDATE' };
    return { retry: false, resendHeld: false, remove: null };
  }
  if (item.status !== 'DEAD') return { retry: false, resendHeld: false, remove: null };
  switch (item.kind) {
    case 'VISIT_SUBMISSION':
      // A refused report can never be sent as it is: delete it (or copy it from the Visit screen).
      return item.draftStatus === 'REFUSED'
        ? { retry: false, resendHeld: false, remove: 'DELETE_REFUSED_REPORT' }
        : { retry: true, resendHeld: false, remove: null };
    case 'VISIT_RESPONSE':
      return { retry: true, resendHeld: false, remove: item.visitId ? 'DISCARD_RESPONSE' : null };
    case 'DEFECT_ACTION':
      return { retry: true, resendHeld: false, remove: 'DISCARD_DEFECT_UPDATE' };
    case 'INCIDENT':
      return { retry: true, resendHeld: false, remove: 'DISCARD_INCIDENT' };
    default:
      return { retry: true, resendHeld: false, remove: null };
  }
}

/** The confirmation shown before a removal. */
export const OUTBOX_REMOVE_TEXT: Record<OutboxRemoveAction, { button: string; title: string; message: string }> = {
  DELETE_REFUSED_REPORT: {
    button: 'Delete monitoring report',
    title: 'Delete this monitoring report?',
    message: 'The server refused it, so it can never be sent. It is removed from this phone.',
  },
  DISCARD_RESPONSE: {
    button: 'Remove',
    title: 'Remove this response?',
    message: 'It was not sent. The visit keeps the date and status the server has; you can respond again from the visit.',
  },
  DISCARD_DEFECT_UPDATE: {
    button: 'Remove',
    title: 'Remove this defect update?',
    message: 'It was not sent. Open the defects again to record it once more.',
  },
  DISCARD_INCIDENT: {
    button: 'Remove',
    title: 'Remove this incident?',
    message: 'It was not sent and is removed from this phone with its photos.',
  },
  REMOVE_HELD_CAPTURE: {
    button: 'Remove',
    title: 'Remove this item?',
    message: 'It is removed from this phone and never sent.',
  },
};

const STATE_ORDER: Record<OutboxItemState, number> = { REFUSED: 0, FAILED: 1, HELD: 2, RETRYING: 3, WAITING_FOR_OTHERS: 4, WAITING: 5 };

export interface OutboxRowView {
  item: OutboxItem;
  label: string;
  state: OutboxItemState;
  stateText: string;
  actions: OutboxItemActions;
}

export interface OutboxProjectGroup {
  projectId: string;
  projectName: string;
  rows: OutboxRowView[];
  counts: { waiting: number; failed: number; held: number };
}

/**
 * Rows grouped per project (projects by name, the account's projects first), and inside a project:
 * refused and failed first, then held, then waiting, oldest first.
 */
export function groupOutboxItems(items: OutboxItem[], projectName: (projectId: string) => string | null): OutboxProjectGroup[] {
  const statusById = new Map<string, OutboxStatus>(items.map((i) => [i.id, i.status]));
  const groups = new Map<string, OutboxProjectGroup>();
  for (const item of items) {
    const state = outboxItemState(item, statusById);
    let g = groups.get(item.projectId);
    if (!g) {
      g = { projectId: item.projectId, projectName: projectName(item.projectId) ?? 'Project no longer on this phone', rows: [], counts: { waiting: 0, failed: 0, held: 0 } };
      groups.set(item.projectId, g);
    }
    g.rows.push({ item, label: outboxItemLabel(item), state, stateText: OUTBOX_STATE_TEXT[state], actions: outboxItemActions(item) });
    if (state === 'FAILED' || state === 'REFUSED') g.counts.failed += 1;
    else if (state === 'HELD') g.counts.held += 1;
    else g.counts.waiting += 1;
  }
  for (const g of groups.values()) {
    g.rows.sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.item.createdAt.localeCompare(b.item.createdAt));
  }
  return [...groups.values()].sort((a, b) => {
    const known = Number(projectName(b.projectId) !== null) - Number(projectName(a.projectId) !== null);
    return known || a.projectName.localeCompare(b.projectName);
  });
}
