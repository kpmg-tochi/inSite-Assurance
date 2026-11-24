import { Router, Request, Response, NextFunction } from 'express';
import { requirePermission } from '../../middleware/auth.middleware';
import { listChecklistTemplates, listTemplateVersions } from './checklistTemplates.service';
import { getSupervisorWorkloads } from './supervision.service';

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/**
 * Phase 14 tenant routes. Checklist templates: /api/v1/inspection-templates (tenant-level,
 * versioned by code), read only since redesign R3e: authoring moved to the form library
 * (/api/v1/form-library); the mobile pack and the type editor's legacy picker still read them until
 * R4. Supervisors view: /api/v1/supervision.
 */
const templates = Router();

templates.get(
  '/',
  requirePermission('inspections:view', 'inspections:submit', 'project_types:manage'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await listChecklistTemplates(req.webUser!.tenantId, req.query.includeArchived === 'true') });
  })
);

templates.get(
  '/:code/versions',
  requirePermission('inspections:view'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await listTemplateVersions(req.webUser!.tenantId, String(req.params.code).toUpperCase()) });
  })
);

export const inspectionTemplatesRoutes = templates;

const supervision = Router();

/** GET /api/v1/supervision: every supervisor of the tenant with projects, spread and last inspections. */
supervision.get(
  '/',
  requirePermission('inspections:view'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await getSupervisorWorkloads({ tenantId: req.webUser!.tenantId }) });
  })
);

export const supervisionRoutes = supervision;
