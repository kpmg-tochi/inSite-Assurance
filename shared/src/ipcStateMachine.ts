import type { IpcClaimStatus } from './enums';

/**
 * IPC lifecycle (Phase 3 Step 1). The one definition of which action may run in which state.
 * The server calls `assertIpcTransition` inside the transaction, after locking the IPC row;
 * the web uses `canIpcTransition` only to decide which buttons to show.
 *
 *   SUBMITTED ──reconcile──▶ AI_RECONCILED ──certify──▶ MONITOR_CERTIFIED ──decide──▶ LENDER_DECIDED
 *                               │    ▲                       │       ▲                    │
 *                     raise_query    reconcile (all queries   raise_query (reopen)        reverse_decision
 *                               ▼    │  resolved)            ▼       │ certify            │
 *                           QUERIED_BY_MONITOR ─────────────certify──┘◀───────────────────┘
 *
 *   SUBMITTED, AI_RECONCILED, QUERIED_BY_MONITOR ──withdraw──▶ REJECTED_WITHDRAWN
 *
 * Preconditions that depend on more than the status (no open queries before certifying, the
 * certifier cannot decide, and so on) are enforced by the service, not here.
 */
export const IPC_ACTIONS = [
  'reconcile',
  'raise_query',
  'respond_query',
  'resolve_query',
  'certify',
  'decide',
  'reverse_decision',
  'withdraw',
] as const;
export type IpcAction = (typeof IPC_ACTIONS)[number];

const TRANSITIONS: Record<IpcAction, Partial<Record<IpcClaimStatus, IpcClaimStatus>>> = {
  // Re-running on AI_RECONCILED refreshes ratings. From QUERIED_BY_MONITOR only once every
  // query is resolved (service precondition); that is the "all queries resolved" path.
  reconcile: {
    SUBMITTED: 'AI_RECONCILED',
    AI_RECONCILED: 'AI_RECONCILED',
    QUERIED_BY_MONITOR: 'AI_RECONCILED',
  },
  // Raising a query on a certified IPC reopens it before the lender decides.
  raise_query: {
    AI_RECONCILED: 'QUERIED_BY_MONITOR',
    QUERIED_BY_MONITOR: 'QUERIED_BY_MONITOR',
    MONITOR_CERTIFIED: 'QUERIED_BY_MONITOR',
  },
  respond_query: {
    QUERIED_BY_MONITOR: 'QUERIED_BY_MONITOR',
  },
  resolve_query: {
    QUERIED_BY_MONITOR: 'QUERIED_BY_MONITOR',
  },
  // Certifying an already certified IPC creates a new revision (before any decision).
  certify: {
    AI_RECONCILED: 'MONITOR_CERTIFIED',
    QUERIED_BY_MONITOR: 'MONITOR_CERTIFIED',
    MONITOR_CERTIFIED: 'MONITOR_CERTIFIED',
  },
  decide: {
    MONITOR_CERTIFIED: 'LENDER_DECIDED',
  },
  // LENDER_DECIDED is terminal for every action except an explicit, audited reversal, which
  // returns the IPC to MONITOR_CERTIFIED so a corrected decision can be recorded.
  reverse_decision: {
    LENDER_DECIDED: 'MONITOR_CERTIFIED',
  },
  withdraw: {
    SUBMITTED: 'REJECTED_WITHDRAWN',
    AI_RECONCILED: 'REJECTED_WITHDRAWN',
    QUERIED_BY_MONITOR: 'REJECTED_WITHDRAWN',
  },
};

/** IPC statuses that still occupy their tranche (one open IPC per tranche). */
export const OPEN_IPC_STATUSES: IpcClaimStatus[] = [
  'SUBMITTED',
  'AI_RECONCILED',
  'QUERIED_BY_MONITOR',
  'MONITOR_CERTIFIED',
];

export class IpcTransitionError extends Error {
  readonly code = 'ILLEGAL_IPC_TRANSITION';
  constructor(
    readonly from: IpcClaimStatus,
    readonly action: IpcAction
  ) {
    super(`Cannot ${action.replace(/_/g, ' ')} an IPC in status ${from}`);
    this.name = 'IpcTransitionError';
  }
}

export function nextIpcStatus(from: IpcClaimStatus, action: IpcAction): IpcClaimStatus | null {
  return TRANSITIONS[action][from] ?? null;
}

export function canIpcTransition(from: IpcClaimStatus, action: IpcAction): boolean {
  return nextIpcStatus(from, action) !== null;
}

/** Returns the status after `action`, or throws `IpcTransitionError`. */
export function assertIpcTransition(from: IpcClaimStatus, action: IpcAction): IpcClaimStatus {
  const next = nextIpcStatus(from, action);
  if (!next) throw new IpcTransitionError(from, action);
  return next;
}
