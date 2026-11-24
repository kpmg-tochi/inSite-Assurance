/**
 * The token and sessions the API layer uses (Phase 5, provisioned accounts only since R1d).
 *
 * The device holds one provisioned account: one token for every assigned project. The server
 * resolves that token to the account's provisioned session on each project. The profile context
 * keeps this registry in step with the persisted state; the API layer, the outbox and the
 * session-ended logic read it.
 */

/** The signed-in account, or one project of it (a revoked session or removed assignment). */
export type SessionScope = 'account' | `project:${string}`;

interface Registry {
  accountToken: string | null;
  sessionIds: Map<string, string | null>;
  activeProjectId: string | null;
}

let registry: Registry = {
  accountToken: null,
  sessionIds: new Map(),
  activeProjectId: null,
};

export function setAuthRegistry(next: {
  accountToken: string | null;
  /** The account's provisioned session per project, once the server has told us its id. */
  projectSessions: Array<{ projectId: string; sessionId: string | null }>;
  activeProjectId: string | null;
}): void {
  registry = {
    accountToken: next.accountToken,
    sessionIds: new Map(next.projectSessions.map((p) => [p.projectId, p.sessionId])),
    activeProjectId: next.activeProjectId,
  };
}

/**
 * The session an item queued now belongs to (Phase 5 Step 8): the signed-in account, or null when
 * nobody is signed in. Recorded on each outbox row so items queued under another identity (for
 * example a join-code session from before R1d) are held instead of being sent under the account.
 */
export function currentSessionKey(): string | null {
  return registry.accountToken ? 'account' : null;
}

/** The account's provisioned session id on a project, when known. */
export function currentSessionId(projectId: string): string | null {
  return registry.sessionIds.get(projectId) ?? null;
}

export function getActiveProjectId(): string | null {
  return registry.activeProjectId;
}

export function getAccountToken(): string | null {
  return registry.accountToken;
}

const PROJECT_PATH = /\/projects\/([0-9a-f-]{36})(?:\/|$|\?)/i;

/** The project a request path is about (`/projects/:id/...` or `/auth/mobile/projects/:id/...`). */
export function projectIdFromPath(path: string): string | null {
  return PROJECT_PATH.exec(path)?.[1] ?? null;
}
