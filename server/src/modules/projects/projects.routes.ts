import { Router, Request, Response, NextFunction } from 'express';
import { guardProjectRoutes } from '../../utils/accessControl';
import {
  CreateProjectRequestSchema,
  GeoCoordinateSchema,
  IssueJoinCodeRequestSchema,
  RotateJoinCodeRequestSchema,
  ReviewContractorVerificationRequestSchema,
  UpdateFieldSessionStatusRequestSchema,
  UpdateProjectBaselineSchema,
} from '@insite/shared';
import {
  requireAnyAuth,
  requirePermission,
  requireWebAuth,
} from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  createProjectBaseline,
  getPortfolioExecutiveSummary,
  getProjectBaselineDetails,
  listContractorVerifications,
  listDemoProjects,
  listProjectFieldSessions,
  listProjectsForUser,
  reviewContractorVerification,
  updateFieldSessionStatus,
  updateProjectBaseline,
  verifyCoordinateForProject,
} from './projects.service';
import {
  issueProjectJoinCode,
  listProjectJoinCodes,
  rotateProjectJoinCode,
} from './joinCodes.service';
import { env } from '../../config/env';
import { seedDatabase } from '../../db/seedDatabase';
import { demoRateLimit } from '../../middleware/rateLimit.middleware';

const router = guardProjectRoutes(Router());

// Demo endpoints are mounted only when DEMO_MODE is on (Phase 2 Step 8).
if (env.DEMO_MODE) {
  /**
   * GET /api/v1/projects/demo
   * Demo-only: projects and active join codes for mobile workspace switching and autofill.
   */
  router.get(
    '/demo',
    demoRateLimit,
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        const projects = await listDemoProjects();
        res.json({ success: true, data: projects });
      } catch (error) {
        next(error);
      }
    }
  );

  /**
   * POST /api/v1/projects/demo/reset
   * Demo-only: wipes runtime data and restores the demo seed.
   */
  router.post(
    '/demo/reset',
    demoRateLimit,
    async (_req: Request, res: Response, next: NextFunction) => {
      try {
        await seedDatabase();
        res.json({
          success: true,
          data: { resetAt: new Date().toISOString() },
        });
      } catch (error) {
        next(error);
      }
    }
  );
}

/**
 * GET /api/v1/projects/portfolio/executive-summary
 * Multi-project portfolio executive metrics scoped to tenant & user permissions.
 */
router.get(
  '/portfolio/executive-summary',
  requirePermission('projects:view_executive_matrix'),
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
 * Lists projects visible to the authenticated user (tenant-isolated & assignment-scoped).
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
 * Restricted to users with `projects:create` permission.
 */
router.post(
  '/',
  requirePermission('projects:create'),
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
        req.webUser,
        req.fieldAgent
      );
      res.json({ success: true, data: baseline });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/v1/projects/:projectId/baseline
 * Restricted to users with `projects:edit_baseline` permission.
 */
router.put(
  '/:projectId/baseline',
  requirePermission('projects:edit_baseline'),
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
        req.body,
        req.webUser,
        req.fieldAgent
      );
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/join-codes
 * Lists the project's mobile join codes (active and rotated-out).
 */
router.get(
  '/:projectId/join-codes',
  requirePermission('mobilization:manage_roster'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const codes = await listProjectJoinCodes(String(req.params.projectId), req.webUser!);
      res.json({ success: true, data: codes });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/join-codes
 * Issues a join code for a mobile role, e.g. one created after the project was set up.
 */
router.post(
  '/:projectId/join-codes',
  requirePermission('mobilization:manage_roster'),
  validateBody(IssueJoinCodeRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await issueProjectJoinCode(String(req.params.projectId), req.webUser!, req.body);
      res.status(201).json({ success: true, data: created });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/join-codes/:joinCodeId/rotate
 * Deactivates a join code and issues a replacement for the same role.
 */
router.post(
  '/:projectId/join-codes/:joinCodeId/rotate',
  requirePermission('mobilization:manage_roster'),
  validateBody(RotateJoinCodeRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await rotateProjectJoinCode(
        String(req.params.projectId),
        String(req.params.joinCodeId),
        req.webUser!,
        req.body
      );
      res.status(201).json({ success: true, data: created });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/field-sessions
 * Lists active and revoked mobile field agent sessions for the project (or tenant-scoped 'all').
 */
router.get(
  '/:projectId/field-sessions',
  requirePermission('sessions:revoke_device', 'mobilization:manage_roster'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessions = await listProjectFieldSessions(
        String(req.params.projectId),
        req.webUser!
      );
      res.json({ success: true, data: sessions });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/v1/projects/:projectId/field-sessions/:sessionId/status
 * Revokes or restores a mobile field agent's device session.
 */
router.patch(
  '/:projectId/field-sessions/:sessionId/status',
  requirePermission('sessions:revoke_device'),
  validateBody(UpdateFieldSessionStatusRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await updateFieldSessionStatus({
        projectId: String(req.params.projectId),
        sessionId: String(req.params.sessionId),
        webUser: req.webUser!,
        isActive: req.body.isActive,
        reason: req.body.reason,
      });
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/contractor-verifications
 * Lists assurance verification submissions scoped to tenant/user project access.
 */
router.get(
  '/:projectId/contractor-verifications',
  requirePermission('assurance:review_credentials'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const verifications = await listContractorVerifications(
        String(req.params.projectId),
        req.webUser!
      );
      res.json({ success: true, data: verifications });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/contractor-verifications/:sessionId/review
 * Approves or rejects a field assurance onboarding dossier.
 */
router.post(
  '/:projectId/contractor-verifications/:sessionId/review',
  requirePermission('assurance:review_credentials'),
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
