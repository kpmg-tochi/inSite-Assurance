import { Router, Request, Response, NextFunction } from 'express';
import {
  CreateFacilityUnitRequestSchema,
  CreateScopeLineRequestSchema,
  SaveSprintsRequestSchema,
  ScopeImportConfirmRequestSchema,
  ScopeImportPreviewRequestSchema,
  UpdateFacilityUnitRequestSchema,
  UpdateScopeLineRequestSchema,
  VerifySprintRequestSchema,
} from '@insite/shared';
import { guardProjectRoutes } from '../../utils/accessControl';
import { requireAnyAuthWithWebPermission, requirePermission, requireWebAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  createFacilityUnit,
  createScopeLine,
  deleteFacilityUnit,
  deleteScopeLine,
  getProjectScope,
  saveSprints,
  updateFacilityUnit,
  updateScopeLine,
} from './scope.service';
import { getSprintVerification, verifySprint } from './sprintVerification.service';
import { buildProjectScopeWorkbook, buildTenantScopeWorkbook, confirmScopeImport, previewScopeImport } from './scopeImport.service';

/**
 * Redesign R2b: project scope (sprints, facility units, scope lines). Mounted at /api/v1/projects.
 * Reads need `scope:view` (field principals read too); writes need `scope:edit` (renamed in R7).
 */
const router = guardProjectRoutes(Router());

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const p = (req: Request, key: string) => String(req.params[key]);

router.get(
  '/:projectId/scope',
  requireAnyAuthWithWebPermission('scope:view'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await getProjectScope(p(req, 'projectId')) });
  })
);

router.put(
  '/:projectId/scope/sprints',
  requirePermission('scope:edit'),
  validateBody(SaveSprintsRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await saveSprints(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

// Redesign R4e (D-R4.31): sprint verification.
router.get(
  '/:projectId/scope/sprints/:sprintId/verification',
  requirePermission('scope:view', 'sprints:verify'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await getSprintVerification(p(req, 'projectId'), p(req, 'sprintId'), req.webUser!) });
  })
);

router.post(
  '/:projectId/scope/sprints/:sprintId/verification',
  requirePermission('sprints:verify'),
  validateBody(VerifySprintRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await verifySprint(p(req, 'projectId'), p(req, 'sprintId'), req.webUser!, req.body) });
  })
);

router.post(
  '/:projectId/scope/units',
  requirePermission('scope:edit'),
  validateBody(CreateFacilityUnitRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await createFacilityUnit(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

router.patch(
  '/:projectId/scope/units/:unitId',
  requirePermission('scope:edit'),
  validateBody(UpdateFacilityUnitRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await updateFacilityUnit(p(req, 'projectId'), p(req, 'unitId'), req.webUser!, req.body) });
  })
);

router.delete(
  '/:projectId/scope/units/:unitId',
  requirePermission('scope:edit'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await deleteFacilityUnit(p(req, 'projectId'), p(req, 'unitId'), req.webUser!) });
  })
);

router.post(
  '/:projectId/scope/lines',
  requirePermission('scope:edit'),
  validateBody(CreateScopeLineRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await createScopeLine(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

router.patch(
  '/:projectId/scope/lines/:lineId',
  requirePermission('scope:edit'),
  validateBody(UpdateScopeLineRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await updateScopeLine(p(req, 'projectId'), p(req, 'lineId'), req.webUser!, req.body) });
  })
);

router.delete(
  '/:projectId/scope/lines/:lineId',
  requirePermission('scope:edit'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await deleteScopeLine(p(req, 'projectId'), p(req, 'lineId'), req.webUser!) });
  })
);

// ---------------------------------------------------------------------------
// R2c: the needs-assessment workbook
// ---------------------------------------------------------------------------

/** The project's "Needs assessment" .xlsx ("PRG-101 needs assessment.xlsx"), pre-filled from the project when it has data. */
router.get(
  '/:projectId/scope/workbook',
  requirePermission('scope:view'),
  wrap(async (req, res) => {
    const { buffer, fileName } = await buildProjectScopeWorkbook(p(req, 'projectId'));
    // Spaces kept in the quoted name (non-ASCII goes to filename*).
    res.attachment(fileName);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  })
);

/** Parses and validates a filled workbook; nothing is written. Drafts only. */
router.post(
  '/:projectId/scope/import/preview',
  requirePermission('scope:edit'),
  validateBody(ScopeImportPreviewRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await previewScopeImport(p(req, 'projectId'), req.body) });
  })
);

/** Re-parses the previewed file (same sha256) and replaces the draft's scope. */
router.post(
  '/:projectId/scope/import/confirm',
  requirePermission('scope:edit'),
  validateBody(ScopeImportConfirmRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await confirmScopeImport(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

export const scopeRoutes = router;

/** The blank "Needs assessment template" with the workspace's lists (mounted at /api/v1/scope-workbook). */
const tenantWorkbook = Router();
tenantWorkbook.get(
  '/',
  requireWebAuth,
  wrap(async (req, res) => {
    const { buffer, fileName } = await buildTenantScopeWorkbook(req.webUser!.tenantId);
    // Spaces kept in the quoted name (non-ASCII goes to filename*).
    res.attachment(fileName);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  })
);
export const scopeWorkbookRoutes = tenantWorkbook;
