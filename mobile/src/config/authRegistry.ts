/**
 * Which token to send for which project (Phase 5).
 *
 * A device can hold one provisioned account (one token for every assigned project) and any number
 * of join-code sessions (one token per project). The profile context keeps this registry in step
 * with the persisted state; the API layer, the outbox and the session-ended logic read it.
 */

export type SessionScope = 'account' | `project:${string}`;

interface Registry {
  accountToken: string | null;
  joinTokens: Map<string, string>;
  joinSessionIds: Map<string, string | null>;
  activeProjectId: string | null;
}

let registry: Registry = {
  accountToken: null,
  joinTokens: new Map(),
  joinSessionIds: new Map(),
  activeProjectId: null,
};

export function setAuthRegistry(next: {
  accountToken: string | null;
  joinTokens: Array<{ projectId: string; token: string; sessionId?: string | null }>;
  activeProjectId: string | null;
}): void {
  registry = {
    accountToken: next.accountToken,
    joinTokens: new Map(next.joinTokens.map((j) => [j.projectId, j.token])),
    joinSessionIds: new Map(next.joinTokens.map((j) => [j.projectId, j.sessionId ?? null])),
    activeProjectId: next.activeProjectId,
  };
}

/**
 * Which session an item queued now for this project belongs to (Phase 5 Step 8): the join
 * session's id, or the signed-in account. Recorded on each outbox row so that, after a rejoin,
 * items from the ended session can be held instead of being sent under the new one.
 */
export function sessionKeyForProject(projectId: string): string | null {
  if (registry.joinTokens.has(projectId)) {
    const sessionId = registry.joinSessionIds.get(projectId);
    return sessionId ? `join:${sessionId}` : null;
  }
  return registry.accountToken ? 'account' : null;
}

/** The current join session on a project, when it was joined with a code. */
export function currentJoinSessionId(projectId: string): string | null {
  return registry.joinSessionIds.get(projectId) ?? null;
}

export function getActiveProjectId(): string | null {
  return registry.activeProjectId;
}

export function getAccountToken(): string | null {
  return registry.accountToken;
}

/** True when the project was joined with a code on this device (it has its own token). */
export function isJoinCodeProject(projectId: string): boolean {
  return registry.joinTokens.has(projectId);
}

/** The token for a project: its join-session token, otherwise the account token. */
export function tokenForProject(projectId: string | null | undefined): string | null {
  if (projectId && registry.joinTokens.has(projectId)) return registry.joinTokens.get(projectId)!;
  return registry.accountToken;
}

/** The token for the active project, used by routes that carry no project in the path. */
export function tokenForActiveProject(): string | null {
  return tokenForProject(registry.activeProjectId);
}

const PROJECT_PATH = /\/projects\/([0-9a-f-]{36})(?:\/|$|\?)/i;

/** The project a request path is about (`/projects/:id/...` or `/auth/mobile/projects/:id/...`). */
export function projectIdFromPath(path: string): string | null {
  return PROJECT_PATH.exec(path)?.[1] ?? null;
}

export function scopeForProject(projectId: string): SessionScope {
  return isJoinCodeProject(projectId) ? `project:${projectId}` : 'account';
}
