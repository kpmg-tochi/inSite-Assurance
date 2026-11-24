import { NextFunction, Request, Response, Router } from 'express';
import { ConstructionPhase, Prisma, ProjectStatus } from '@prisma/client';
import { prisma } from '../config/prisma';
import { AppError } from '../middleware/error.middleware';
import {
  authenticateAny,
  FieldAgentJwtPayload,
  hasWebPermission,
  WebJwtPayload,
} from '../middleware/auth.middleware';
import { ownedByOrganizationTreeWhere } from '../modules/organizations/hierarchy';

/** Users who may see and work on draft projects they did not create (Phase 6). */
export function canManageDrafts(webUser: WebJwtPayload): boolean {
  return hasWebPermission(webUser, 'projects:create', 'projects:edit_baseline');
}

/**
 * The project-level access rule for a web user of the project's tenant (Phase 11), shared by the
 * list filter and the project guard so the two cannot drift. A user sees a project if any of:
 * - they hold `projects:view_all_tenant` (returns null: no restriction);
 * - they are assigned to it;
 * - they hold `projects:view_organization_tree` and the project is owned by their organisation or an
 *   organisation below it.
 */
export function projectAccessBranch(webUser: WebJwtPayload): Prisma.ProjectWhereInput | null {
  if (webUser.isPlatformSuperAdmin || hasWebPermission(webUser, 'projects:view_all_tenant')) return null;
  const assigned: Prisma.ProjectWhereInput = { userAssignments: { some: { userId: webUser.userId } } };
  if (!webUser.permissions.includes('projects:view_organization_tree')) return assigned;
  return { OR: [assigned, ownedByOrganizationTreeWhere(webUser.organizationId)] };
}

/**
 * Builds a Prisma ProjectWhereInput enforcing:
 * 1. Tenant isolation (unless Platform Super Admin, optionally filtered by targetTenantId)
 * 2. Project-level visibility: users without `projects:view_all_tenant` only see explicitly assigned projects.
 * 3. Lifecycle (Phase 6): only ACTIVE projects unless `statuses` asks for more. This is the one place
 *    drafts are excluded; draft-aware callers (directory, wizard) ask for them explicitly. A draft
 *    is visible to its creator and to users with `projects:create` or `projects:edit_baseline`.
 */
export function buildProjectVisibilityWhere(
  webUser: WebJwtPayload,
  targetTenantId?: string,
  options: { statuses?: ProjectStatus[] } = {}
): Prisma.ProjectWhereInput {
  const where: Prisma.ProjectWhereInput = {};

  if (webUser.isPlatformSuperAdmin) {
    if (targetTenantId) {
      where.tenantId = targetTenantId;
    }
  } else {
    where.tenantId = webUser.tenantId;
  }

  // Phase 11: assignment, or the organisation tree (see projectAccessBranch).
  const branch = projectAccessBranch(webUser);
  if (branch) where.AND = [branch];

  const statuses = options.statuses ?? ['ACTIVE'];
  const live = statuses.filter((s) => s !== 'DRAFT');
  const clauses: Prisma.ProjectWhereInput[] = [];
  if (live.length > 0) clauses.push({ status: { in: live } });
  if (statuses.includes('DRAFT')) {
    clauses.push(
      canManageDrafts(webUser) || webUser.isPlatformSuperAdmin
        ? { status: 'DRAFT' }
        : { status: 'DRAFT', createdByUserId: webUser.userId }
    );
  }
  where.OR = clauses.length > 0 ? clauses : [{ id: '00000000-0000-0000-0000-000000000000' }];

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
}): Promise<{ id: string; tenantId: string; status: ProjectStatus; constructionPhase: ConstructionPhase }> {
  if (!params.webUser && !params.fieldAgent) {
    throw new AppError('Authentication required', 401, 'UNAUTHORIZED');
  }
  if (!UUID_RE.test(params.projectId)) {
    throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  }

  const row = await prisma.project.findUnique({
    where: { id: params.projectId },
    select: { id: true, tenantId: true, status: true, createdByUserId: true, constructionPhase: true },
  });

  if (!row) {
    throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  }
  const project = { id: row.id, tenantId: row.tenantId, status: row.status, constructionPhase: row.constructionPhase };

  if (params.fieldAgent) {
    if (params.fieldAgent.projectId !== params.projectId) {
      throw new AppError(
        'Field Agent session is bound to a different project',
        403,
        'PROJECT_MISMATCH'
      );
    }
    // Drafts and archived projects are not live on mobile (Phase 6).
    if (row.status !== 'ACTIVE') {
      throw new AppError('This project is not active', 403, 'PROJECT_NOT_ACTIVE');
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

  // A draft exists only for its creator and for users who can create or edit project baselines.
  if (row.status === 'DRAFT' && row.createdByUserId !== webUser.userId && !canManageDrafts(webUser)) {
    throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  }

  const branch = projectAccessBranch(webUser);
  if (branch) {
    const visible = await prisma.project.count({ where: { AND: [{ id: params.projectId }, branch] } });
    if (visible === 0) {
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
 * Project-access guard for `:projectId` routes. Authenticates the caller (web, join-code session or
 * provisioned account), then checks tenant and assignment (web) or session binding (field). A
 * provisioned account's session for this project is resolved here (Phase 5). Route-level guards
 * still apply their own surface and permission checks afterwards.
 *
 * `projectId === 'all'` is allowed through for web users only; those handlers must scope with
 * buildProjectVisibilityWhere.
 */
const ALL_PROJECTS_WRITE_RE = /^\/api\/v1\/projects\/all\/web-notifications\/(?:read-all|[0-9a-f-]{36}\/read)$/i;

export function requireProjectAccess(
  req: Request,
  res: Response,
  next: NextFunction,
  projectId: string
): void {
  const target = projectId === ALL_PROJECTS_SENTINEL ? undefined : projectId;
  authenticateAny(req, target).then(() => {
    if (projectId === ALL_PROJECTS_SENTINEL) {
      const path = (req.originalUrl || '').split('?')[0];
      // Writes on 'all' are limited to marking cross-project web notifications read (the service
      // scopes them with buildProjectVisibilityWhere).
      const allowedWrite = req.method !== 'GET' && ALL_PROJECTS_WRITE_RE.test(path);
      if (!req.webUser || (req.method !== 'GET' && !allowedWrite)) {
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
    }).then((project) => {
      const refusal = req.webUser
        ? lifecycleRefusal(project.status, req)
        : fieldPhaseRefusal(project.constructionPhase, req);
      next(refusal ?? undefined);
    }, next);
  }, next);
}

/** Routes under /projects/:projectId that work on a draft (the wizard and its data). */
const DRAFT_ROUTE_RE = /^\/api\/v1\/projects\/[^/]+(?:\/(?:setup|activate|contractors|boq|scope|baseline|process|standards|needs-assessments|evidence\/presign|media|supervision|documents|milestones|visit-form|visit-plan|visit-officers)(?:\/|$)|\/?$)/;

/** Writes an archived project still serves (Phase 15: the closure pack export). */
const ARCHIVED_WRITE_RE = /^\/api\/v1\/projects\/[^/]+\/closure-pack\/?$/;

/**
 * Lifecycle rules for web requests (Phase 6): a draft only serves the setup wizard and its data;
 * an archived project is read-only.
 */
function lifecycleRefusal(status: ProjectStatus, req: Request): AppError | null {
  const path = (req.originalUrl || '').split('?')[0];
  if (status === 'DRAFT' && !DRAFT_ROUTE_RE.test(path)) {
    return new AppError('This project is a draft. Finish setup and set it active first.', 409, 'PROJECT_IS_DRAFT');
  }
  // Phase 15: the closure pack can still be exported from an archived project (for audit).
  if (status === 'ARCHIVED' && req.method !== 'GET' && !ARCHIVED_WRITE_RE.test(path)) {
    return new AppError('This project is archived and read-only', 409, 'PROJECT_ARCHIVED');
  }
  return null;
}

/**
 * Phase 10: once construction has ended (defects liability period, or closed), field sessions may
 * still read, but may only write for defect work: defect actions, the captures that evidence them
 * (presign, register, and the capture's location ping) and notification reads. Redesign R4 (D-R4.40):
 * visits continue after construction (final evaluation, post-closure evaluation), with their site
 * log (R5f: findings are resolved on the web only).
 */
const FIELD_DEFECT_WORK_RE =
  /^\/api\/v1\/projects\/[^/]+\/(?:defects|captures|evidence\/presign|notifications|visits|site-log)(?:\/|$)/;

function fieldPhaseRefusal(phase: ConstructionPhase, req: Request): AppError | null {
  if (phase !== 'RETENTION_PERIOD' && phase !== 'COMPLETED_CLOSED') return null;
  if (req.method === 'GET' || req.method === 'HEAD') return null;
  const path = (req.originalUrl || '').split('?')[0];
  if (FIELD_DEFECT_WORK_RE.test(path)) return null;
  return new AppError(
    'Construction on this project has ended. Only defect work can be recorded now.',
    409,
    'PROJECT_CONSTRUCTION_ENDED'
  );
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
