import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { FieldPersonaType } from '@insite/shared';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { AppError } from './error.middleware';

// ---------------------------------------------------------------------------
// Token payloads carry identity only. Everything else is loaded per request.
// ---------------------------------------------------------------------------

export interface WebTokenClaims {
  tokenType: 'WEB_USER';
  userId: string;
  tenantId: string;
  tokenVersion: number;
}

export interface FieldTokenClaims {
  tokenType: 'FIELD_AGENT';
  sessionId: string;
}

type TokenClaims = WebTokenClaims | FieldTokenClaims;

/** Live authorization context for a web user (shape kept from Phase 1 so services do not change). */
export interface WebJwtPayload {
  tokenType: 'WEB_USER';
  userId: string;
  email: string;
  fullName: string;
  tenantId: string;
  isPlatformSuperAdmin: boolean;
  roleId: string;
  roleCode: string;
  roleName: string;
  permissions: string[];
  organizationId: string;
  mustChangePassword: boolean;
}

/** Live authorization context for a mobile field session. */
export interface FieldAgentJwtPayload {
  tokenType: 'FIELD_AGENT';
  sessionId: string;
  tenantId: string;
  projectId: string;
  roleId: string;
  roleCode: string;
  roleName: string;
  fieldPersonaType: FieldPersonaType;
  assuranceWeight: number;
  requiresIdentityAssurance: boolean;
  permissions: string[];
  agentFullName: string;
  deviceId: string;
}

declare global {
  namespace Express {
    interface Request {
      webUser?: WebJwtPayload;
      fieldAgent?: FieldAgentJwtPayload;
    }
  }
}

export function signWebUserToken(claims: Omit<WebTokenClaims, 'tokenType'>): string {
  const payload: WebTokenClaims = {
    tokenType: 'WEB_USER',
    userId: claims.userId,
    tenantId: claims.tenantId,
    tokenVersion: claims.tokenVersion,
  };
  return jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

export function signFieldAgentToken(claims: Omit<FieldTokenClaims, 'tokenType'>): string {
  const payload: FieldTokenClaims = { tokenType: 'FIELD_AGENT', sessionId: claims.sessionId };
  // Long-lived for offline-first field work; revocation is enforced per request.
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '30d' });
}

export function hasWebPermission(
  webUser: WebJwtPayload | undefined,
  ...requiredPermissions: string[]
): boolean {
  if (!webUser) return false;
  if (webUser.isPlatformSuperAdmin) return true;
  if (requiredPermissions.length === 0) return true;
  return requiredPermissions.some((perm) => webUser.permissions.includes(perm));
}

// ---------------------------------------------------------------------------
// Auth-context cache. In-process, max 30 s, cleared on mutation.
// With more than one API instance a revocation can lag by up to the TTL on
// the other instances; see Phase 2 section 7.
// ---------------------------------------------------------------------------

const AUTH_CACHE_TTL_MS = 30_000;

interface WebContextRecord {
  principal: WebJwtPayload;
  isActive: boolean;
  tokenVersion: number;
  tenantStatus: string;
}

interface FieldContextRecord {
  principal: FieldAgentJwtPayload;
  isActive: boolean;
  tenantStatus: string;
}

const webCache = new Map<string, { value: WebContextRecord | null; expiresAt: number }>();
const fieldCache = new Map<string, { value: FieldContextRecord | null; expiresAt: number }>();

export function invalidateUserAuthCache(userId: string): void {
  webCache.delete(userId);
}

export function invalidateSessionAuthCache(sessionId: string): void {
  fieldCache.delete(sessionId);
}

/** Use after role or tenant mutations, which can affect many principals. */
export function clearAuthCache(): void {
  webCache.clear();
  fieldCache.clear();
}

async function loadWebContext(userId: string): Promise<WebContextRecord | null> {
  const cached = webCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      tenant: { select: { status: true } },
      role: {
        include: { rolePermissions: { include: { permission: { select: { key: true } } } } },
      },
    },
  });

  const value: WebContextRecord | null = user
    ? {
        isActive: user.isActive,
        tokenVersion: user.tokenVersion,
        tenantStatus: user.tenant.status,
        principal: {
          tokenType: 'WEB_USER',
          userId: user.id,
          email: user.email,
          fullName: user.fullName,
          tenantId: user.tenantId,
          isPlatformSuperAdmin: user.isPlatformSuperAdmin,
          roleId: user.roleId,
          roleCode: user.role.code,
          roleName: user.role.name,
          permissions: user.role.rolePermissions.map((rp) => rp.permission.key),
          organizationId: user.organizationId,
          mustChangePassword: user.mustChangePassword,
        },
      }
    : null;

  webCache.set(userId, { value, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
  return value;
}

async function loadFieldContext(sessionId: string): Promise<FieldContextRecord | null> {
  const cached = fieldCache.get(sessionId);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const session = await prisma.fieldAgentSession.findUnique({
    where: { id: sessionId },
    include: {
      project: { select: { tenantId: true, tenant: { select: { status: true } } } },
      role: {
        include: { rolePermissions: { include: { permission: { select: { key: true } } } } },
      },
    },
  });

  const value: FieldContextRecord | null = session
    ? {
        isActive: session.isActive,
        tenantStatus: session.project.tenant.status,
        principal: {
          tokenType: 'FIELD_AGENT',
          sessionId: session.id,
          tenantId: session.project.tenantId,
          projectId: session.projectId,
          roleId: session.roleId,
          roleCode: session.role.code,
          roleName: session.role.name,
          fieldPersonaType: session.fieldPersonaType as FieldPersonaType,
          assuranceWeight: session.assuranceWeight,
          requiresIdentityAssurance: session.role.requiresIdentityAssurance,
          permissions: session.role.rolePermissions.map((rp) => rp.permission.key),
          agentFullName: session.agentFullName,
          deviceId: session.deviceId,
        },
      }
    : null;

  fieldCache.set(sessionId, { value, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
  return value;
}

// Routes a user with `mustChangePassword` may still call.
const PASSWORD_CHANGE_ALLOWLIST = new Set([
  '/api/v1/auth/me',
  '/api/v1/auth/change-password',
]);

function extractBearerToken(req: Request): string {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    throw new AppError('Missing or invalid Authorization header', 401, 'UNAUTHORIZED');
  }
  return authHeader.slice(7).trim();
}

function verifyClaims(req: Request): TokenClaims {
  const token = extractBearerToken(req);
  let decoded: unknown;
  try {
    decoded = jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw new AppError('Invalid or expired authentication token', 401, 'UNAUTHORIZED');
  }
  const claims = decoded as Partial<TokenClaims>;
  if (claims?.tokenType === 'WEB_USER' && typeof (claims as WebTokenClaims).userId === 'string') {
    return claims as WebTokenClaims;
  }
  if (
    claims?.tokenType === 'FIELD_AGENT' &&
    typeof (claims as FieldTokenClaims).sessionId === 'string'
  ) {
    return claims as FieldTokenClaims;
  }
  throw new AppError('Unrecognised authentication token', 401, 'UNAUTHORIZED');
}

async function resolveWebPrincipal(req: Request, claims: WebTokenClaims): Promise<WebJwtPayload> {
  const ctx = await loadWebContext(claims.userId);
  if (!ctx || !ctx.isActive) {
    throw new AppError('Account is inactive or no longer exists', 401, 'ACCOUNT_INACTIVE');
  }
  if (ctx.tokenVersion !== claims.tokenVersion) {
    throw new AppError('Session has been revoked. Please sign in again.', 401, 'TOKEN_REVOKED');
  }
  if (ctx.tenantStatus === 'SUSPENDED' && !ctx.principal.isPlatformSuperAdmin) {
    throw new AppError('This workspace has been suspended', 403, 'TENANT_SUSPENDED');
  }
  if (
    ctx.principal.mustChangePassword &&
    !PASSWORD_CHANGE_ALLOWLIST.has(req.originalUrl.split('?')[0].replace(/\/$/, ''))
  ) {
    throw new AppError(
      'You must change your temporary password before continuing',
      403,
      'PASSWORD_CHANGE_REQUIRED'
    );
  }
  return ctx.principal;
}

async function resolveFieldPrincipal(claims: FieldTokenClaims): Promise<FieldAgentJwtPayload> {
  const ctx = await loadFieldContext(claims.sessionId);
  if (!ctx) {
    throw new AppError('Field session no longer exists', 401, 'UNAUTHORIZED');
  }
  if (!ctx.isActive) {
    throw new AppError('This device session has been revoked', 403, 'SESSION_REVOKED');
  }
  if (ctx.tenantStatus === 'SUSPENDED') {
    throw new AppError('This workspace has been suspended', 403, 'TENANT_SUSPENDED');
  }
  return ctx.principal;
}

type AsyncGuard = (req: Request) => Promise<void>;

function guard(fn: AsyncGuard) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    fn(req).then(() => next(), next);
  };
}

async function authenticateWeb(req: Request): Promise<void> {
  const claims = verifyClaims(req);
  if (claims.tokenType !== 'WEB_USER') {
    throw new AppError('Endpoint requires a Web Portal session', 403, 'FORBIDDEN');
  }
  req.webUser = await resolveWebPrincipal(req, claims);
}

async function authenticateField(req: Request): Promise<void> {
  const claims = verifyClaims(req);
  if (claims.tokenType !== 'FIELD_AGENT') {
    throw new AppError('Endpoint requires an active Mobile Field Agent session', 403, 'FORBIDDEN');
  }
  req.fieldAgent = await resolveFieldPrincipal(claims);
}

export const requireWebAuth = guard(authenticateWeb);

/**
 * Succeeds if the web user is a Platform Super Admin or holds at least one of the listed permissions.
 */
export function requirePermission(...requiredPermissions: string[]) {
  return guard(async (req) => {
    await authenticateWeb(req);
    if (!hasWebPermission(req.webUser, ...requiredPermissions)) {
      throw new AppError(
        `Access requires permission(s): ${requiredPermissions.join(' or ')}`,
        403,
        'FORBIDDEN_PERMISSION'
      );
    }
  });
}

export const requirePlatformSuperAdmin = guard(async (req) => {
  await authenticateWeb(req);
  if (!req.webUser?.isPlatformSuperAdmin) {
    throw new AppError(
      'Endpoint restricted to Platform Super Administrators',
      403,
      'FORBIDDEN_SUPER_ADMIN'
    );
  }
});

export const requireFieldSession = guard(authenticateField);

/** Allows either an authenticated web user or an active mobile field session. */
export const requireAnyAuth = guard(async (req) => {
  const claims = verifyClaims(req);
  if (claims.tokenType === 'WEB_USER') {
    req.webUser = await resolveWebPrincipal(req, claims);
  } else {
    req.fieldAgent = await resolveFieldPrincipal(claims);
  }
});

/**
 * For read routes shared by web and mobile: web users need one of `webPermissions`;
 * field agents are allowed (their project binding is enforced by the project guard).
 */
export function requireAnyAuthWithWebPermission(...webPermissions: string[]) {
  return guard(async (req) => {
    const claims = verifyClaims(req);
    if (claims.tokenType === 'WEB_USER') {
      req.webUser = await resolveWebPrincipal(req, claims);
      if (!hasWebPermission(req.webUser, ...webPermissions)) {
        throw new AppError(
          `Access requires permission(s): ${webPermissions.join(' or ')}`,
          403,
          'FORBIDDEN_PERMISSION'
        );
      }
    } else {
      req.fieldAgent = await resolveFieldPrincipal(claims);
    }
  });
}

/**
 * Optional authentication: attaches a principal when a valid token is present and ignores
 * a missing or invalid one. Used only by demo routes.
 */
export const optionalAuth = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.headers.authorization) {
    next();
    return;
  }
  (async () => {
    try {
      const claims = verifyClaims(req);
      if (claims.tokenType === 'WEB_USER') {
        req.webUser = await resolveWebPrincipal(req, claims);
      } else {
        req.fieldAgent = await resolveFieldPrincipal(claims);
      }
    } catch {
      // ignore
    }
  })().then(() => next(), next);
};
