import { NextFunction, Request, Response, Router } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../middleware/error.middleware';
import {
  FieldAgentJwtPayload,
  hasWebPermission,
  requireAnyAuth,
  WebJwtPayload,
} from '../middleware/auth.middleware';

/**
 * Builds a Prisma ProjectWhereInput enforcing:
 * 1. Tenant isolation (unless Platform Super Admin, optionally filtered by targetTenantId)
 * 2. Project-level visibility: users without `projects:view_all_tenant` only see explicitly assigned projects.
 */
export function buildProjectVisibilityWhere(
  webUser: WebJwtPayload,
  targetTenantId?: string
): Prisma.ProjectWhereInput {
  const where: Prisma.ProjectWhereInput = {};

  if (webUser.isPlatformSuperAdmin) {
    if (targetTenantId) {
      where.tenantId = targetTenantId;
    }
  } else {
    where.tenantId = webUser.tenantId;
  }

  if (
    !webUser.isPlatformSuperAdmin &&
    !hasWebPermission(webUser, 'projects:view_all_tenant')
  ) {
    where.userAssignments = {
      some: {
        userId: webUser.userId,
      },
    };
  }

  return where;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Tenant-wide listing paths use `projectId === 'all'` and must go through buildProjectVisibilityWhere. */
export const ALL_PROJECTS_SENTINEL = 'all';

/**
 * Verifies that the caller (web user or field agent) may access `projectId`.
 * Fails closed: with no authenticated principal, access is refused.
 */
export async function assertCallerProjectAccess(params: {
  projectId: string;
  webUser?: WebJwtPayload;
  fieldAgent?: FieldAgentJwtPayload;
}): Promise<{ id: string; tenantId: string }> {
  if (!params.webUser && !params.fieldAgent) {
    throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
  }
  if (!UUID_RE.test(params.projectId)) {
    throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  }

  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
    select: { id: true, tenantId: true },
  });

  if (!project) {
    throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  }

  if (params.fieldAgent) {
    if (params.fieldAgent.projectId !== params.projectId) {
      throw new AppError(
        'Field Agent session is bound to a different project',
        403,
        'PROJECT_MISMATCH'
      );
    }
    return project;
  }

  const webUser = params.webUser!;
  if (webUser.isPlatformSuperAdmin) {
    return project;
  }

  if (project.tenantId !== webUser.tenantId) {
    // Do not reveal that the project exists in another tenant.
    throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  }

  if (!hasWebPermission(webUser, 'projects:view_all_tenant')) {
    const assignment = await prisma.userProjectAssignment.findUnique({
      where: {
        userId_projectId: {
          userId: webUser.userId,
          projectId: params.projectId,
        },
      },
      select: { id: true },
    });

    if (!assignment) {
      throw new AppError(
        'Access denied: user is not assigned to this project',
        403,
        'FORBIDDEN_PROJECT_ASSIGNMENT'
      );
    }
  }

  return project;
}

/**
 * Project-access guard for `:projectId` routes. Authenticates the caller (web or field), then
 * checks tenant and assignment (web) or session binding (field). Route-level guards still apply
 * their own surface and permission checks afterwards.
 *
 * `projectId === 'all'` is allowed through for web users only; those handlers must scope with
 * buildProjectVisibilityWhere.
 */
export function requireProjectAccess(
  req: Request,
  res: Response,
  next: NextFunction,
  projectId: string
): void {
  requireAnyAuth(req, res, (authErr?: unknown) => {
    if (authErr) {
      next(authErr);
      return;
    }
    if (projectId === ALL_PROJECTS_SENTINEL) {
      if (!req.webUser || req.method !== 'GET') {
        next(new AppError('Project not found', 404, 'PROJECT_NOT_FOUND'));
        return;
      }
      next();
      return;
    }
    assertCallerProjectAccess({
      projectId,
      webUser: req.webUser,
      fieldAgent: req.fieldAgent,
    }).then(() => next(), next);
  });
}

/** Registers the project-access guard on every `:projectId` route of a router. */
export function guardProjectRoutes(router: Router): Router {
  router.param('projectId', requireProjectAccess);
  return router;
}

/**
 * For field write routes: the project comes from the session. A URL project that differs from
 * the session project is rejected (the param guard already enforces this; this is defence in
 * depth for services that take the project from the body).
 */
export function projectIdForFieldWrite(req: Request): string {
  const fieldAgent = req.fieldAgent;
  if (!fieldAgent) {
    throw new AppError('Endpoint requires an active Mobile Field Agent session', 403, 'FORBIDDEN');
  }
  const urlProjectId = req.params.projectId;
  if (urlProjectId && urlProjectId !== fieldAgent.projectId) {
    throw new AppError('Field Agent session is bound to a different project', 403, 'PROJECT_MISMATCH');
  }
  return fieldAgent.projectId;
}
