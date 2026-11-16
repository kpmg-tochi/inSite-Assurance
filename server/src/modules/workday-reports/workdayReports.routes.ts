import { Router, Request, Response, NextFunction } from 'express';
import { SubmitWorkdayReportBundleSchema } from '@insite/shared';
import {
  requireAnyAuth,
  requireFieldSession,
} from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  listProjectWorkdayReports,
  submitWorkdayReportBundle,
} from './workdayReports.service';

const router = Router();

/**
 * POST /api/v1/projects/:projectId/workday-reports
 * Submits a signed End-of-Day workday report with submission geotag provenance.
 */
router.post(
  '/:projectId/workday-reports',
  requireFieldSession,
  validateBody(SubmitWorkdayReportBundleSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const report = await submitWorkdayReportBundle({
        projectId: String(req.params.projectId),
        reporterSessionId: req.fieldAgent!.sessionId,
        input: req.body,
      });
      res.status(201).json({ success: true, data: report });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/workday-reports
 * Lists daily workday reports for the Web Portal and mobile sync.
 */
router.get(
  '/:projectId/workday-reports',
  requireAnyAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const reports = await listProjectWorkdayReports({
        projectId: String(req.params.projectId),
        workdayDate: req.query.workdayDate
          ? String(req.query.workdayDate)
          : undefined,
      });
      res.json({ success: true, data: reports });
    } catch (error) {
      next(error);
    }
  }
);

export const workdayReportsRoutes = router;

