import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * Per-request memo (Phase 7). Values cached here live only for one HTTP request, so a setting read
 * by several services during a request is loaded once and a change is seen by the next request.
 * Outside a request (jobs, tests calling services directly) nothing is cached.
 */
const storage = new AsyncLocalStorage<Map<string, unknown>>();

const REQUEST_ORIGIN_KEY = 'requestOrigin';
/** A host as browsers send it: name or IPv4, or a bracketed IPv6 address, with an optional port. */
const HOST_RE = /^(?:[A-Za-z0-9.-]+|\[[0-9A-Fa-f:.]+\])(?::\d{1,5})?$/;

/**
 * The origin (protocol and host) the caller used to reach the API, or null when it cannot be read.
 * `req.protocol` follows X-Forwarded-Proto only when `trust proxy` is set; X-Forwarded-Host is read
 * under the same rule (the API sets no `trust proxy`, so today both come from the connection).
 */
export function originOfRequest(req: Request): string | null {
  const trust = req.app?.get('trust proxy fn') as ((addr: string | undefined, hop: number) => boolean) | undefined;
  const forwardedHost = trust?.(req.socket?.remoteAddress, 0) ? req.get('x-forwarded-host')?.split(',')[0]?.trim() : undefined;
  const host = forwardedHost || req.get('host');
  if (!host || !HOST_RE.test(host)) return null;
  const protocol = req.protocol === 'https' ? 'https' : 'http';
  return `${protocol}://${host}`;
}

export function requestContextMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const memo = new Map<string, unknown>();
  const origin = originOfRequest(req);
  if (origin) memo.set(REQUEST_ORIGIN_KEY, origin);
  storage.run(memo, () => next());
}

/**
 * The current request's origin (see `originOfRequest`), or null outside a request (jobs, emails).
 * Local-dev storage links use it so the web on localhost gets localhost links and a phone on the LAN
 * address gets LAN links.
 */
export function getRequestOrigin(): string | null {
  return (storage.getStore()?.get(REQUEST_ORIGIN_KEY) as string | undefined) ?? null;
}

export function getRequestMemo<T>(key: string): T | undefined {
  return storage.getStore()?.get(key) as T | undefined;
}

export function setRequestMemo<T>(key: string, value: T): void {
  storage.getStore()?.set(key, value);
}

export function clearRequestMemo(key: string): void {
  storage.getStore()?.delete(key);
}
