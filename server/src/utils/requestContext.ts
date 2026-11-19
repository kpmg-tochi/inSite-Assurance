import { AsyncLocalStorage } from 'async_hooks';
import type { NextFunction, Request, Response } from 'express';

/**
 * Per-request memo (Phase 7). Values cached here live only for one HTTP request, so a setting read
 * by several services during a request is loaded once and a change is seen by the next request.
 * Outside a request (jobs, tests calling services directly) nothing is cached.
 */
const storage = new AsyncLocalStorage<Map<string, unknown>>();

export function requestContextMiddleware(_req: Request, _res: Response, next: NextFunction): void {
  storage.run(new Map(), () => next());
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
