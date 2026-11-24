import Constants from 'expo-constants';
import { NativeModules, Platform } from 'react-native';
import { formatMobileErrorMessage } from '../utils/errorFormatter';
import { markSessionEnded, type SessionEndReason } from './sessionState';
import { getAccountToken, getActiveProjectId, projectIdFromPath, type SessionScope } from './authRegistry';

function extractLanHost(uriOrUrl?: string | null): string | null {
  if (!uriOrUrl) return null;
  const cleaned = uriOrUrl.replace(/^https?:\/\//i, '').split('/')[0];
  const host = cleaned.split(':')[0]?.trim();
  if (!host) return null;
  // Remote Expo tunnel hosts only forward port 8081, not port 4000
  if (
    host.endsWith('.exp.direct') ||
    host.endsWith('.ngrok.io') ||
    host.endsWith('.ngrok-free.app')
  ) {
    return null;
  }
  return host;
}

function resolveMobileApiBaseUrl(): string {
  const envUrl = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();

  // Release builds must be pointed at an explicit HTTPS API. LAN auto-discovery below is for
  // development only.
  if (!__DEV__) {
    if (!envUrl || !/^https:\/\//i.test(envUrl)) {
      throw new Error(
        'EXPO_PUBLIC_API_BASE_URL must be set to an https:// URL for release builds.'
      );
    }
    return envUrl.replace(/\/+$/, '');
  }

  if (envUrl) {
    return envUrl.replace(/\/+$/, '');
  }

  // In Expo Go / Dev Client, hostUri contains the dev machine's LAN IP (e.g. "192.168.1.15:8081")
  const expoHostUri =
    Constants.expoConfig?.hostUri ??
    (Constants as any).manifest2?.extra?.expoGo?.debuggerHost ??
    (Constants as any).manifest?.debuggerHost ??
    null;

  const hostFromExpo = extractLanHost(expoHostUri);
  const hostFromScript = extractLanHost(NativeModules?.SourceCode?.scriptURL);
  const resolvedHost = hostFromExpo || hostFromScript;

  if (
    resolvedHost &&
    resolvedHost !== 'localhost' &&
    resolvedHost !== '127.0.0.1'
  ) {
    return `http://${resolvedHost}:4000/api/v1`;
  }

  if (Platform.OS === 'android') {
    // Android Emulator alias for the host machine's localhost
    return 'http://10.0.2.2:4000/api/v1';
  }

  return 'http://localhost:4000/api/v1';
}

export const MOBILE_API_BASE_URL = resolveMobileApiBaseUrl();
export const API_BASE_URL = MOBILE_API_BASE_URL;

/** The offline baseline for one project; persisted per project in SQLite (see baselineStore). */
export type { MobileBaselinePack } from '@insite/shared';

/**
 * Error from the API layer. `kind` lets callers tell "offline / server unreachable" apart from
 * "this session is no longer allowed", which must never be retried as if it were offline.
 */
export class MobileApiError extends Error {
  constructor(
    message: string,
    public readonly kind: 'network' | 'auth' | 'http',
    public readonly status?: number,
    public readonly code?: string
  ) {
    super(message);
    this.name = 'MobileApiError';
  }
}

export interface MobileRequestOptions extends RequestInit {
  /**
   * `false` sends no token (sign-in). A string sends that token (an account token not yet in the
   * registry, e.g. right after a password change). Default: the signed-in account's token.
   */
  auth?: false | string;
  /** Scope to end if `auth` is an explicit token and the server refuses it. */
  authScope?: SessionScope;
  /**
   * `false`: a refused token does not end the session on this phone (sign-out: the person is
   * leaving anyway, so "Your session has ended" must not appear over the landing screen).
   */
  reportSessionEnd?: boolean;
}

/** Maps a refusal to the session scope it ends, or null when it does not end a session. */
function endedScopeFor(
  status: number,
  code: string | undefined,
  requestScope: SessionScope,
  projectId: string | null
): { scope: SessionScope; reason: SessionEndReason } | null {
  if (status === 401) return { scope: requestScope, reason: 'UNAUTHORIZED' };
  if (status !== 403 || !code) return null;
  switch (code) {
    case 'TENANT_SUSPENDED':
      return { scope: requestScope, reason: 'TENANT_SUSPENDED' };
    case 'SESSION_REVOKED':
      // An account token is refused for one project only when that project's session is revoked.
      return {
        scope: requestScope === 'account' && projectId ? `project:${projectId}` : requestScope,
        reason: 'SESSION_REVOKED',
      };
    case 'DEVICE_REVOKED':
      return { scope: 'account', reason: 'DEVICE_REVOKED' };
    case 'NO_MOBILE_ACCESS':
      return { scope: 'account', reason: 'NO_MOBILE_ACCESS' };
    case 'FORBIDDEN_PROJECT_ASSIGNMENT':
      return requestScope === 'account' && projectId
        ? { scope: `project:${projectId}`, reason: 'PROJECT_ACCESS_REMOVED' }
        : null;
    default:
      return null;
  }
}

export async function mobileRequest<T>(
  path: string,
  options: MobileRequestOptions = {}
): Promise<T> {
  const { auth, authScope, reportSessionEnd = true, ...init } = options;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(init.headers as Record<string, string>),
  };

  // The project the request is about decides which scope a refusal ends.
  const targetProjectId = projectIdFromPath(path) ?? getActiveProjectId();
  let token: string | null = null;
  let requestScope: SessionScope = 'account';
  if (typeof auth === 'string') {
    token = auth;
    requestScope = authScope ?? 'account';
  } else if (auth !== false) {
    token = getAccountToken();
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 12_000);

  let response: Response;
  try {
    response = await fetch(`${MOBILE_API_BASE_URL}${path}`, {
      ...init,
      headers,
      signal: init.signal ?? controller.signal,
    });
  } catch (err) {
    throw new MobileApiError(formatMobileErrorMessage(err), 'network');
  } finally {
    clearTimeout(timeoutId);
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok || !payload?.success) {
    const code: string | undefined = payload?.error?.code;
    const message = formatMobileErrorMessage(payload?.error?.message, response.status);
    const endedScope = token && reportSessionEnd ? endedScopeFor(response.status, code, requestScope, targetProjectId) : null;
    if (endedScope) {
      markSessionEnded(endedScope.scope, endedScope.reason, payload?.error?.message ?? message);
      throw new MobileApiError(message, 'auth', response.status, code);
    }
    throw new MobileApiError(message, 'http', response.status, code);
  }

  return payload.data as T;
}
