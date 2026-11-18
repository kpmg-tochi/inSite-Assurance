/**
 * Session-ended state (Phase 2 Step 10). Set when the API reports that the field session is no
 * longer valid (revoked device, suspended workspace, expired or unknown token). While set, sync
 * stops and the app prompts the user; queued data stays on the device.
 */
export type SessionEndReason = 'SESSION_REVOKED' | 'TENANT_SUSPENDED' | 'UNAUTHORIZED';

export interface SessionEndedState {
  reason: SessionEndReason;
  message: string;
  at: string;
}

let current: SessionEndedState | null = null;
const listeners = new Set<(state: SessionEndedState | null) => void>();

export function markSessionEnded(reason: SessionEndReason, message: string): void {
  if (current) return;
  current = { reason, message, at: new Date().toISOString() };
  listeners.forEach((l) => l(current));
}

export function clearSessionEnded(): void {
  current = null;
  listeners.forEach((l) => l(null));
}

export function getSessionEnded(): SessionEndedState | null {
  return current;
}

export function subscribeSessionEnded(
  listener: (state: SessionEndedState | null) => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
