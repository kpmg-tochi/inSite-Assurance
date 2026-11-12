import { Router, Request, Response, NextFunction } from 'express';
import {
  CreateProjectRequestSchema,
  GeoCoordinateSchema,
  ReviewContractorVerificationRequestSchema,
  UpdateProjectBaselineSchema,
} from '@insite/shared';
import {
  requireAnyAuth,
  requireRole,
  requireWebAuth,
} from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  createProjectBaseline,
  getPortfolioExecutiveSummary,
  getProjectBaselineDetails,
  listContractorVerifications,
  listProjectsForUser,
  reviewContractorVerification,
  updateProjectBaseline,
  verifyCoordinateForProject,
} from './projects.service';

const router = Router();

/**
 * GET /api/v1/projects/portfolio/executive-summary
 * Multi-project portfolio executive metrics for Lenders & Lead Monitors.
 */
router.get(
  '/portfolio/executive-summary',
  requireWebAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await getPortfolioExecutiveSummary(req.webUser!);
      res.json({ success: true, data: summary });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects
 * Lists all projects with portfolio health pins, geofence GeoJSON, and conflict metrics.
 */
router.get(
  '/',
  requireWebAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projects = await listProjectsForUser(req.webUser!);
      res.json({ success: true, data: projects });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects
 * Restricted to MONITOR role. Creates project baseline, tranches, CPs, and 3 Join Codes.
 */
router.post(
  '/',
  requireRole('MONITOR'),
  validateBody(CreateProjectRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await createProjectBaseline(req.webUser!, req.body);
      res.status(201).json({ success: true, data: created });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/baseline
 * Returns full baseline (Geofence, Tranches, CPs, BOQ items, and role-appropriate Join Codes).
 */
router.get(
  '/:projectId/baseline',
  requireAnyAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const baseline = await getProjectBaselineDetails(
        String(req.params.projectId),
        req.webUser
      );
      res.json({ success: true, data: baseline });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/v1/projects/:projectId/baseline
 * Restricted to MONITOR role. Updates baseline settings, cadence, or geofence.
 */
router.put(
  '/:projectId/baseline',
  requireRole('MONITOR'),
  validateBody(UpdateProjectBaselineSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await updateProjectBaseline(
        String(req.params.projectId),
        req.webUser!,
        req.body
      );
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/verify-geofence
 * Tests any GPS coordinate against the project's Radial or Linear Corridor Geofence.
 */
router.post(
  '/:projectId/verify-geofence',
  requireAnyAuth,
  validateBody(GeoCoordinateSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await verifyCoordinateForProject(
        String(req.params.projectId),
        req.body
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/contractor-verifications
 * Lists all contractor assurance verification submissions for Independent Monitor / Lender review.
 */
router.get(
  '/:projectId/contractor-verifications',
  requireWebAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const verifications = await listContractorVerifications(
        String(req.params.projectId)
      );
      res.json({ success: true, data: verifications });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/contractor-verifications/:sessionId/review
 * Monitor or Lender approves or rejects a contractor assurance onboarding dossier.
 */
router.post(
  '/:projectId/contractor-verifications/:sessionId/review',
  requireRole('MONITOR', 'LENDER'),
  validateBody(ReviewContractorVerificationRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await reviewContractorVerification(
        String(req.params.projectId),
        String(req.params.sessionId),
        req.webUser!,
        req.body.decision,
        req.body.remarks
      );
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }
);

export const projectsRoutes = router;

