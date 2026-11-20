import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { buildProjectVisibilityWhere, guardProjectRoutes } from '../../utils/accessControl';
import {
  CreateProjectDraftRequestSchema,
  GeoCoordinateSchema,
  IssueJoinCodeRequestSchema,
  ProjectContractorInputSchema,
  ProjectListFiltersSchema,
  RotateJoinCodeRequestSchema,
  ReviewContractorVerificationRequestSchema,
  UpdateFieldSessionStatusRequestSchema,
} from '@insite/shared';
import {
  requireAnyAuth,
  requirePermission,
  requireWebAuth,
} from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  getPortfolioExecutiveSummary,
  getPortfolioOverview,
  getProjectBaselineDetails,
  listContractorVerifications,
  listDemoProjects,
  listProjectFieldSessions,
  listProjectsForUser,
  reviewContractorVerification,
  updateFieldSessionStatus,
  verifyCoordinateForProject,
} from './projects.service';
import {
  activateProject,
  archiveProject,
  createProjectDraft,
  deleteDraftProject,
  getProjectSetup,
  getTeamOptions,
  listDraftProjects,
  saveProjectSetupStep,
} from './projectSetup.service';
import {
  addProjectContractor,
  listProjectContractors,
  removeProjectContractor,
  updateProjectContractor,
} from './contractorRoutes.service';
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
 * GET /api/v1/projects/portfolio/overview?projectTypeId=&regionId=&owningOrganizationId=
 * Portfolio dashboard: a map point per visible live project and KPIs over the filtered set.
 */
router.get(
  '/portfolio/overview',
  requirePermission('projects:view_portfolio'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await getPortfolioOverview(req.webUser!, ProjectListFiltersSchema.parse(req.query)) });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects/portfolio/executive-summary
 * Multi-project portfolio executive metrics scoped to tenant & user permissions.
 */
router.get(
  '/portfolio/executive-summary',
  requirePermission('projects:view_executive_matrix'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const summary = await getPortfolioExecutiveSummary(req.webUser!, ProjectListFiltersSchema.parse(req.query));
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
      const projects = await listProjectsForUser(req.webUser!, undefined, ProjectListFiltersSchema.parse(req.query));
      res.json({ success: true, data: projects });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects/drafts
 * Drafts the caller can see: their own, or all visible drafts for users who can create or edit
 * project baselines. Never part of the main list, portfolio or mobile.
 */
router.get(
  '/drafts',
  requireWebAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const where = buildProjectVisibilityWhere(req.webUser!, undefined, { statuses: ['DRAFT'] });
      res.json({ success: true, data: await listDraftProjects(req.webUser!, where) });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects
 * Creates a DRAFT from the basics step (Phase 6). The creator is assigned to it.
 */
router.post(
  '/',
  requirePermission('projects:create'),
  validateBody(CreateProjectDraftRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await createProjectDraft(req.webUser!, req.body);
      res.status(201).json({ success: true, data: created });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/setup
 * Saved data per step and the validity report ({ stepId, complete, issues[] }).
 */
router.get(
  '/:projectId/setup',
  requireWebAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await getProjectSetup(String(req.params.projectId)) });
    } catch (error) {
      next(error);
    }
  }
);

/** GET /api/v1/projects/:projectId/setup/team-options: users and mobile roles for the team step. */
router.get(
  '/:projectId/setup/team-options',
  requirePermission('projects:create', 'projects:edit_baseline'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await getTeamOptions(String(req.params.projectId), req.webUser!.tenantId) });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PUT /api/v1/projects/:projectId/setup/:stepId
 * Validates and saves one step in a transaction and writes one PROJECT_SETUP_STEP_SAVED entry.
 * Drafts: projects:create or projects:edit_baseline. Active projects: projects:edit_baseline.
 */
router.put(
  '/:projectId/setup/:stepId',
  requirePermission('projects:create', 'projects:edit_baseline'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const saved = await saveProjectSetupStep(
        String(req.params.projectId),
        String(req.params.stepId),
        req.webUser!,
        req.body
      );
      res.json({ success: true, data: saved });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/activate
 * Re-validates every step, issues join codes and sets the project ACTIVE. 422 with the issues
 * list if anything is incomplete.
 */
router.post(
  '/:projectId/activate',
  requirePermission('projects:activate'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await activateProject(String(req.params.projectId), req.webUser!) });
    } catch (error) {
      next(error);
    }
  }
);

const ArchiveProjectBodySchema = z.object({ reason: z.string().trim().max(500).optional() });

/** POST /api/v1/projects/:projectId/archive: ACTIVE to ARCHIVED (read-only, hidden from mobile). */
router.post(
  '/:projectId/archive',
  requirePermission('projects:edit_baseline'),
  validateBody(ArchiveProjectBodySchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await archiveProject(String(req.params.projectId), req.webUser!, req.body.reason) });
    } catch (error) {
      next(error);
    }
  }
);

/** DELETE /api/v1/projects/:projectId: deletes a draft with no dependent records. */
router.delete(
  '/:projectId',
  requireWebAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await deleteDraftProject(String(req.params.projectId), req.webUser!);
      res.json({ success: true, data: { deleted: true } });
    } catch (error) {
      next(error);
    }
  }
);

// ---------------------------------------------------------------------------
// Project contractors (Phase 6)
// ---------------------------------------------------------------------------

/** GET /api/v1/projects/:projectId/contractors */
router.get(
  '/:projectId/contractors',
  requireWebAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      res.json({ success: true, data: await listProjectContractors(String(req.params.projectId)) });
    } catch (error) {
      next(error);
    }
  }
);

/** POST /api/v1/projects/:projectId/contractors */
router.post(
  '/:projectId/contractors',
  requirePermission('contractors:manage_packages'),
  validateBody(ProjectContractorInputSchema.omit({ id: true })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await addProjectContractor(String(req.params.projectId), req.webUser!, req.body);
      res.status(201).json({ success: true, data: created });
    } catch (error) {
      next(error);
    }
  }
);

/** PATCH /api/v1/projects/:projectId/contractors/:contractorId */
router.patch(
  '/:projectId/contractors/:contractorId',
  requirePermission('contractors:manage_packages'),
  validateBody(ProjectContractorInputSchema.omit({ id: true })),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await updateProjectContractor(
        String(req.params.projectId),
        String(req.params.contractorId),
        req.webUser!,
        req.body
      );
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }
);

/** DELETE /api/v1/projects/:projectId/contractors/:contractorId (refused with sessions or claims) */
router.delete(
  '/:projectId/contractors/:contractorId',
  requirePermission('contractors:manage_packages'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await removeProjectContractor(String(req.params.projectId), String(req.params.contractorId), req.webUser!);
      res.json({ success: true, data: { removed: true } });
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

// PUT /:projectId/baseline was replaced by the step endpoints (PUT /:projectId/setup/:stepId).

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
