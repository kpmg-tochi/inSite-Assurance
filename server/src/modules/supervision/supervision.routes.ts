import { Router, Request, Response, NextFunction } from 'express';
import { guardProjectRoutes } from '../../utils/accessControl';
import { requirePermission } from '../../middleware/auth.middleware';
import { getSupervisorWorkloads } from './supervision.service';

/**
 * Supervision workload (Phase 14, kept in redesign R5f when the inspections runtime was deleted).
 * Tenant view: /api/v1/supervision. Team step: /api/v1/projects/:projectId/supervision/workload.
 */

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

const supervision = Router();

/** GET /api/v1/supervision: every supervisor of the tenant with projects, spread and last visits. */
supervision.get(
  '/',
  requirePermission('inspections:view'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await getSupervisorWorkloads({ tenantId: req.webUser!.tenantId }) });
  })
);

export const supervisionRoutes = supervision;

const project = guardProjectRoutes(Router());

/** GET /projects/:id/supervision/workload?userIds=a,b: workloads as if these users joined this project. */
project.get(
  '/:projectId/supervision/workload',
  requirePermission('projects:edit_baseline', 'inspections:view'),
  wrap(async (req, res) => {
    const raw = typeof req.query.userIds === 'string' ? req.query.userIds : '';
    const userIds = raw
      .split(',')
      .map((s) => s.trim())
      .filter((s) => /^[0-9a-f-]{36}$/i.test(s))
      .slice(0, 200);
    const data = await getSupervisorWorkloads({ tenantId: req.webUser!.tenantId, userIds, forProjectId: String(req.params.projectId) });
    res.json({ success: true, data });
  })
);

export const projectSupervisionRoutes = project;
