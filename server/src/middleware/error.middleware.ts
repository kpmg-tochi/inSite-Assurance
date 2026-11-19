import { Request, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { ZodError } from 'zod';
import { IpcTransitionError } from '@insite/shared';

export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  /** Safe, structured detail for the client (for example which IDs were missing). */
  public readonly details?: Record<string, unknown>;

  constructor(message: string, statusCode = 400, code = 'BAD_REQUEST', details?: Record<string, unknown>) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

function send(res: Response, status: number, code: string, message: string, extra?: object) {
  res.status(status).json({ success: false, error: { code, message, ...extra } });
}

/**
 * Maps known error types to safe responses. Unhandled errors are logged in full but only a
 * generic message is returned in production, so stack details and SQL never reach clients.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    send(res, err.statusCode, err.code, err.message, err.details ? { details: err.details } : undefined);
    return;
  }

  if (err instanceof IpcTransitionError) {
    send(res, 409, err.code, err.message, { from: err.from, action: err.action });
    return;
  }

  if (err instanceof ZodError) {
    send(res, 400, 'VALIDATION_ERROR', 'Invalid request payload', {
      issues: err.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
    });
    return;
  }

  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      send(res, 409, 'CONFLICT', 'A record with these details already exists');
      return;
    }
    if (err.code === 'P2025' || err.code === 'P2023') {
      send(res, 404, 'NOT_FOUND', 'Record not found');
      return;
    }
  }

  // body-parser errors (malformed JSON, payload too large)
  const httpErr = err as { type?: string; status?: number };
  if (httpErr?.type === 'entity.parse.failed') {
    send(res, 400, 'MALFORMED_JSON', 'Request body is not valid JSON');
    return;
  }
  if (httpErr?.type === 'entity.too.large') {
    send(res, 413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    return;
  }

  console.error(`[Unhandled API Error] ${req.method} ${req.originalUrl}:`, err);
  const message =
    process.env.NODE_ENV === 'production'
      ? 'An unexpected server error occurred'
      : err instanceof Error
        ? err.message
        : 'An unexpected server error occurred';

  send(res, 500, 'INTERNAL_SERVER_ERROR', message);
}
