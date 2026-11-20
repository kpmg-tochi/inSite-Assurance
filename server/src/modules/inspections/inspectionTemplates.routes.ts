import { Router, Request, Response, NextFunction } from 'express';
import { SaveChecklistTemplateRequestSchema } from '@insite/shared';
import { requirePermission } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  listChecklistTemplates,
  listTemplateVersions,
  saveChecklistTemplate,
  setChecklistTemplateArchived,
} from './checklistTemplates.service';
import { getSupervisorWorkloads } from './supervision.service';

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res).catch(next);

/**
 * Phase 14 tenant routes. Checklist templates: /api/v1/inspection-templates (tenant-level,
 * versioned by code). Supervisors view: /api/v1/supervision.
 */
const templates = Router();

templates.get(
  '/',
  requirePermission('inspections:manage_templates', 'inspections:view', 'inspections:submit'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await listChecklistTemplates(req.webUser!.tenantId, req.query.includeArchived === 'true') });
  })
);

templates.get(
  '/:code/versions',
  requirePermission('inspections:manage_templates', 'inspections:view'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await listTemplateVersions(req.webUser!.tenantId, String(req.params.code).toUpperCase()) });
  })
);

templates.post(
  '/',
  requirePermission('inspections:manage_templates'),
  validateBody(SaveChecklistTemplateRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await saveChecklistTemplate(req.webUser!, req.body, null) });
  })
);

/** Saves the next state of a template: in place while unused, else as a new version. */
templates.put(
  '/:code',
  requirePermission('inspections:manage_templates'),
  validateBody(SaveChecklistTemplateRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await saveChecklistTemplate(req.webUser!, req.body, String(req.params.code).toUpperCase()) });
  })
);

templates.post(
  '/:code/archive',
  requirePermission('inspections:manage_templates'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await setChecklistTemplateArchived(req.webUser!, String(req.params.code).toUpperCase(), true) });
  })
);

templates.post(
  '/:code/restore',
  requirePermission('inspections:manage_templates'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await setChecklistTemplateArchived(req.webUser!, String(req.params.code).toUpperCase(), false) });
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
