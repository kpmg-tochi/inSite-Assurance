import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { FieldPersonaType } from '@insite/shared';
import { env } from '../config/env';
import { prisma } from '../config/prisma';
import { AppError } from './error.middleware';
import {
  effectiveMobileRole,
  findOrCreateProvisionedSession,
  isProjectVisibleOnMobile,
  MOBILE_USER_INCLUDE,
  type MobileDeviceRow,
  type MobileUserRow,
} from '../modules/auth/mobileAccess';

// ---------------------------------------------------------------------------
// Token payloads carry identity only. Everything else is loaded per request.
// ---------------------------------------------------------------------------

export interface WebTokenClaims {
  tokenType: 'WEB_USER';
  userId: string;
  tenantId: string;
  tokenVersion: number;
}

/** A provisioned account signed in on one device (Phase 5). Carries no project. */
export interface MobileUserTokenClaims {
  tokenType: 'MOBILE_USER';
  userId: string;
  tenantId: string;
  deviceRowId: string;
  tokenVersion: number;
}

type TokenClaims = WebTokenClaims | MobileUserTokenClaims;

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

/**
 * Live authorization context for a mobile field session: a provisioned account working on one
 * project from one device (redesign R1d: join-code sessions are gone).
 */
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
  permissions: string[];
  agentFullName: string;
  deviceId: string;
  /** The provisioned account the session belongs to. */
  userId: string;
}

/** Account-level context for a provisioned mobile user on routes without a project. */
export interface MobileUserPrincipal {
  tokenType: 'MOBILE_USER';
  userId: string;
  tenantId: string;
  deviceRowId: string;
  deviceId: string;
  fullName: string;
  mustChangePassword: boolean;
  /** Effective pre-provisioned mobile role id, or null when the user has lost mobile access. */
  mobileRoleId: string | null;
}

declare global {
  namespace Express {
    interface Request {
      webUser?: WebJwtPayload;
      fieldAgent?: FieldAgentJwtPayload;
      mobileUser?: MobileUserPrincipal;
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

export function signMobileUserToken(claims: Omit<MobileUserTokenClaims, 'tokenType'>): string {
  const payload: MobileUserTokenClaims = {
    tokenType: 'MOBILE_USER',
    userId: claims.userId,
    tenantId: claims.tenantId,
    deviceRowId: claims.deviceRowId,
    tokenVersion: claims.tokenVersion,
  };
  // Long-lived for offline-first field work; password change, deactivation and device revoke end it.
  return jwt.sign(payload, env.JWT_SECRET, { expiresIn: '30d' });
}

/**
 * True if the user holds at least one of `requiredPermissions`. A platform super admin passes
 * every check.
 */
export function hasWebPermission(
  webUser: WebJwtPayload | undefined,
  ...requiredPermissions: string[]
): boolean {
  if (!webUser) return false;
  if (requiredPermissions.length === 0) return true;
  return requiredPermissions.some(
    (perm) =>
      webUser.permissions.includes(perm) ||
      webUser.isPlatformSuperAdmin
  );
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

interface MobileContextRecord {
  user: MobileUserRow;
  device: (MobileDeviceRow & { revokedAt: Date | null }) | null;
}

const webCache = new Map<string, { value: WebContextRecord | null; expiresAt: number }>();
// Keyed `${userId}:${deviceRowId}`.
const mobileCache = new Map<string, { value: MobileContextRecord | null; expiresAt: number }>();
// Keyed `${userId}:${deviceRowId}:${projectId}`; holds the resolved provisioned field principal.
const provisionedFieldCache = new Map<string, { value: FieldContextRecord; expiresAt: number }>();

function deleteWhere<V>(map: Map<string, V>, predicate: (key: string, value: V) => boolean) {
  for (const [key, value] of map) {
    if (predicate(key, value)) map.delete(key);
  }
}

/** Clears everything cached for a user: web context, mobile account and provisioned sessions. */
export function invalidateUserAuthCache(userId: string): void {
  webCache.delete(userId);
  deleteWhere(mobileCache, (key) => key.startsWith(`${userId}:`));
  deleteWhere(provisionedFieldCache, (key) => key.startsWith(`${userId}:`));
}

export function invalidateSessionAuthCache(sessionId: string): void {
  deleteWhere(provisionedFieldCache, (_key, entry) => entry.value.principal.sessionId === sessionId);
}

/** Use after role or tenant mutations, which can affect many principals. */
export function clearAuthCache(): void {
  webCache.clear();
  mobileCache.clear();
  provisionedFieldCache.clear();
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

async function loadMobileContext(userId: string, deviceRowId: string): Promise<MobileContextRecord | null> {
  const key = `${userId}:${deviceRowId}`;
  const cached = mobileCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;

  const [user, device] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, include: MOBILE_USER_INCLUDE }),
    prisma.mobileDevice.findFirst({ where: { id: deviceRowId, userId } }),
  ]);
  const value: MobileContextRecord | null = user ? { user, device } : null;
  mobileCache.set(key, { value, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
  return value;
}

// Routes a user with `mustChangePassword` may still call.
const PASSWORD_CHANGE_ALLOWLIST = new Set([
  '/api/v1/auth/me',
  '/api/v1/auth/change-password',
  '/api/v1/auth/mobile/change-password',
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
    claims?.tokenType === 'MOBILE_USER' &&
    typeof (claims as MobileUserTokenClaims).userId === 'string' &&
    typeof (claims as MobileUserTokenClaims).deviceRowId === 'string'
  ) {
    return claims as MobileUserTokenClaims;
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
  if (ctx.principal.mustChangePassword && !isPasswordChangeAllowed(req)) {
    throw new AppError(
      'You must change your temporary password before continuing',
      403,
      'PASSWORD_CHANGE_REQUIRED'
    );
  }
  return ctx.principal;
}

function isPasswordChangeAllowed(req: Request): boolean {
  return PASSWORD_CHANGE_ALLOWLIST.has(req.originalUrl.split('?')[0].replace(/\/$/, ''));
}

/** Checks a provisioned account and its device. Used on every MOBILE_USER request. */
async function resolveMobileContext(
  req: Request,
  claims: MobileUserTokenClaims
): Promise<{ ctx: MobileContextRecord; principal: MobileUserPrincipal }> {
  const ctx = await loadMobileContext(claims.userId, claims.deviceRowId);
  if (!ctx || !ctx.user.isActive) {
    throw new AppError('Account is inactive or no longer exists', 401, 'ACCOUNT_INACTIVE');
  }
  if (ctx.user.tokenVersion !== claims.tokenVersion) {
    throw new AppError('Session has been revoked. Please sign in again.', 401, 'TOKEN_REVOKED');
  }
  if (!ctx.device) {
    throw new AppError('This device is not registered for your account', 401, 'UNAUTHORIZED');
  }
  if (ctx.device.revokedAt) {
    throw new AppError('This device has been revoked for your account', 403, 'DEVICE_REVOKED');
  }
  if (ctx.user.tenant.status === 'SUSPENDED') {
    throw new AppError('This workspace has been suspended', 403, 'TENANT_SUSPENDED');
  }
  if (ctx.user.mustChangePassword && !isPasswordChangeAllowed(req)) {
    throw new AppError(
      'You must change your temporary password before continuing',
      403,
      'PASSWORD_CHANGE_REQUIRED'
    );
  }
  const role = effectiveMobileRole(ctx.user);
  return {
    ctx,
    principal: {
      tokenType: 'MOBILE_USER',
      userId: ctx.user.id,
      tenantId: ctx.user.tenantId,
      deviceRowId: ctx.device.id,
      deviceId: ctx.device.deviceId,
      fullName: ctx.user.fullName,
      mustChangePassword: ctx.user.mustChangePassword,
      mobileRoleId: role?.id ?? null,
    },
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a provisioned account's field session for `projectId`: checks mobile access and project
 * visibility, then finds or creates the session.
 */
async function resolveProvisionedFieldPrincipal(
  req: Request,
  claims: MobileUserTokenClaims,
  projectId: string
): Promise<FieldAgentJwtPayload> {
  const { ctx, principal } = await resolveMobileContext(req, claims);
  req.mobileUser = principal;

  const cacheKey = `${claims.userId}:${claims.deviceRowId}:${projectId}`;
  const cached = provisionedFieldCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    if (!cached.value.isActive) {
      throw new AppError('This device session has been revoked', 403, 'SESSION_REVOKED');
    }
    return cached.value.principal;
  }

  const role = effectiveMobileRole(ctx.user);
  if (!role) {
    throw new AppError(
      'Your account does not have mobile access. Ask your administrator to give you a mobile role.',
      403,
      'NO_MOBILE_ACCESS'
    );
  }
  if (!UUID_RE.test(projectId) || !(await isProjectVisibleOnMobile(ctx.user, projectId))) {
    // Same answer for "not assigned" and "does not exist", so project ids cannot be probed.
    throw new AppError('You are not assigned to this project', 403, 'FORBIDDEN_PROJECT_ASSIGNMENT');
  }

  const session = await findOrCreateProvisionedSession({
    user: ctx.user,
    role,
    device: ctx.device!,
    projectId,
  });

  const record: FieldContextRecord = {
    isActive: session.isActive,
    tenantStatus: ctx.user.tenant.status,
    principal: {
      tokenType: 'FIELD_AGENT',
      sessionId: session.id,
      tenantId: ctx.user.tenantId,
      projectId: session.projectId,
      roleId: role.id,
      roleCode: role.code,
      roleName: role.name,
      fieldPersonaType: role.fieldPersonaType as FieldPersonaType,
      assuranceWeight: role.assuranceWeight,
      permissions: role.rolePermissions.map((rp) => rp.permission.key),
      agentFullName: session.agentFullName,
      deviceId: session.deviceId,
      userId: ctx.user.id,
    },
  };
  provisionedFieldCache.set(cacheKey, { value: record, expiresAt: Date.now() + AUTH_CACHE_TTL_MS });
  if (!session.isActive) {
    throw new AppError('This device session has been revoked', 403, 'SESSION_REVOKED');
  }
  return record.principal;
}

/** The project a request is about, from the URL. */
function routeProjectId(req: Request): string | undefined {
  const value = req.params?.projectId;
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * A field principal from a provisioned-account token. It needs a project: the URL `:projectId`, or
 * `projectId` passed by the project guard.
 */
async function resolveAnyFieldPrincipal(
  req: Request,
  claims: MobileUserTokenClaims,
  projectId?: string
): Promise<FieldAgentJwtPayload> {
  const target = projectId ?? routeProjectId(req);
  if (!target) {
    throw new AppError('This endpoint is not available to signed-in mobile accounts', 403, 'FORBIDDEN');
  }
  return resolveProvisionedFieldPrincipal(req, claims, target);
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
  if (claims.tokenType === 'WEB_USER') {
    throw new AppError('Endpoint requires an active Mobile Field Agent session', 403, 'FORBIDDEN');
  }
  req.fieldAgent = await resolveAnyFieldPrincipal(req, claims);
}

export const requireWebAuth = guard(authenticateWeb);

/** Mobile-account routes (`/auth/mobile/*` without a project): a provisioned-account token only. */
export const requireMobileUser = guard(async (req) => {
  const claims = verifyClaims(req);
  if (claims.tokenType !== 'MOBILE_USER') {
    throw new AppError('Endpoint requires a signed-in mobile account', 403, 'FORBIDDEN');
  }
  req.mobileUser = (await resolveMobileContext(req, claims)).principal;
});

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

/**
 * Authenticates web and provisioned-account callers. A provisioned account gets a field
 * principal when the request names a project (URL or `projectId`), otherwise only `req.mobileUser`.
 */
export async function authenticateAny(req: Request, projectId?: string): Promise<void> {
  const claims = verifyClaims(req);
  if (claims.tokenType === 'WEB_USER') {
    req.webUser = await resolveWebPrincipal(req, claims);
    return;
  }
  if (claims.tokenType === 'MOBILE_USER' && !(projectId ?? routeProjectId(req))) {
    req.mobileUser = (await resolveMobileContext(req, claims)).principal;
    return;
  }
  req.fieldAgent = await resolveAnyFieldPrincipal(req, claims, projectId);
}

/** Allows either an authenticated web user or an active mobile field session. */
export const requireAnyAuth = guard((req) => authenticateAny(req));

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
      req.fieldAgent = await resolveAnyFieldPrincipal(req, claims);
    }
  });
}

