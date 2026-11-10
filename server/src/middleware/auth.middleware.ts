import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { IndependenceTier, UserRole } from '@insite/shared';
import { env } from '../config/env';
import { AppError } from './error.middleware';

export interface WebJwtPayload {
  tokenType: 'WEB_USER';
  userId: string;
  email: string;
  fullName: string;
  role: UserRole;
  organizationId: string;
}

export interface FieldAgentJwtPayload {
  tokenType: 'FIELD_AGENT';
  sessionId: string;
  projectId: string;
  independenceTier: IndependenceTier;
  agentFullName: string;
  deviceId: string;
}

export type AppJwtPayload = WebJwtPayload | FieldAgentJwtPayload;

declare global {
  namespace Express {
    interface Request {
      webUser?: WebJwtPayload;
      fieldAgent?: FieldAgentJwtPayload;
    }
  }
}

function extractBearerToken(req: Request): string {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError('Missing or invalid Authorization header', 401, 'UNAUTHORIZED');
  }
  return authHeader.slice(7).trim();
}

export function signWebUserToken(payload: Omit<WebJwtPayload, 'tokenType'>): string {
  const fullPayload: WebJwtPayload = { ...payload, tokenType: 'WEB_USER' };
  return jwt.sign(fullPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function signFieldAgentToken(
  payload: Omit<FieldAgentJwtPayload, 'tokenType'>
): string {
  const fullPayload: FieldAgentJwtPayload = { ...payload, tokenType: 'FIELD_AGENT' };
  return jwt.sign(fullPayload, env.JWT_SECRET, {
    expiresIn: '30d', // Long-lived token for offline-first field work
  });
}

export function requireWebAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    const token = extractBearerToken(req);
    const decoded = jwt.verify(token, env.JWT_SECRET) as AppJwtPayload;
    if (decoded.tokenType !== 'WEB_USER') {
      throw new AppError('Endpoint requires a Web Portal session', 403, 'FORBIDDEN');
    }
    req.webUser = decoded;
    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    next(new AppError('Invalid or expired authentication token', 401, 'UNAUTHORIZED'));
  }
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    requireWebAuth(req, res, (err?: unknown) => {
      if (err) {
        next(err);
        return;
      }
      if (!req.webUser || !allowedRoles.includes(req.webUser.role)) {
        next(
          new AppError(
            `Access restricted to roles: ${allowedRoles.join(', ')}`,
            403,
            'FORBIDDEN_ROLE'
          )
        );
        return;
      }
      next();
    });
  };
}

export function requireFieldSession(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    const token = extractBearerToken(req);
    const decoded = jwt.verify(token, env.JWT_SECRET) as AppJwtPayload;
    if (decoded.tokenType !== 'FIELD_AGENT') {
      throw new AppError(
        'Endpoint requires an active Mobile Field Agent session',
        403,
        'FORBIDDEN'
      );
    }
    req.fieldAgent = decoded;
    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    next(new AppError('Invalid or expired field agent session', 401, 'UNAUTHORIZED'));
  }
}

/**
 * Allows either an authenticated Web User OR a bound Mobile Field Agent
 */
export function requireAnyAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  try {
    const token = extractBearerToken(req);
    const decoded = jwt.verify(token, env.JWT_SECRET) as AppJwtPayload;
    if (decoded.tokenType === 'WEB_USER') {
      req.webUser = decoded;
    } else {
      req.fieldAgent = decoded;
    }
    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    next(new AppError('Invalid or expired authentication token', 401, 'UNAUTHORIZED'));
  }
}

