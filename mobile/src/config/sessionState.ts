import { isJoinCodeProject, type SessionScope } from './authRegistry';

/**
 * Session-ended state (Phase 2 Step 10, scoped in Phase 5). Set when the API reports that a
 * session is no longer valid. A scope is either the signed-in account (every provisioned project)
 * or one project (a join-code session, or one revoked provisioned session). While a scope is ended,
 * the outbox holds that scope's items and the app tells the user; queued data stays on the device.
 */
export type SessionEndReason =
  | 'SESSION_REVOKED'
  | 'TENANT_SUSPENDED'
  | 'UNAUTHORIZED'
  | 'DEVICE_REVOKED'
  | 'NO_MOBILE_ACCESS'
  | 'PROJECT_ACCESS_REMOVED';

export interface SessionEndedState {
  scope: SessionScope;
  /** The project for a project scope; null for the account. */
  projectId: string | null;
  reason: SessionEndReason;
  message: string;
  at: string;
}

const ended = new Map<SessionScope, SessionEndedState>();
const listeners = new Set<(states: SessionEndedState[]) => void>();

function emit() {
  const all = [...ended.values()];
  listeners.forEach((l) => l(all));
}

export function markSessionEnded(scope: SessionScope, reason: SessionEndReason, message: string): void {
  if (ended.has(scope)) return;
  ended.set(scope, {
    scope,
    projectId: scope === 'account' ? null : scope.slice('project:'.length),
    reason,
    message,
    at: new Date().toISOString(),
  });
  emit();
}

/** Clears one scope, or every scope when none is given (sign-out, reset). */
export function clearSessionEnded(scope?: SessionScope): void {
  if (scope === undefined) ended.clear();
  else ended.delete(scope);
  emit();
}

export function listSessionEnded(): SessionEndedState[] {
  return [...ended.values()];
}

/**
 * Why sending for this project is paused, if it is: its own scope (join session, or a revoked
 * provisioned session), or the account scope for a provisioned project.
 */
export function sessionEndedFor(projectId: string | null | undefined): SessionEndedState | null {
  if (!projectId) return ended.get('account') ?? null;
  const own = ended.get(`project:${projectId}`);
  if (own) return own;
  return isJoinCodeProject(projectId) ? null : ended.get('account') ?? null;
}

export function subscribeSessionEnded(listener: (states: SessionEndedState[]) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
