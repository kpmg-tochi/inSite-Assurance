import { Router, Request, Response, NextFunction } from 'express';
import { guardProjectRoutes, projectIdForFieldWrite } from '../../utils/accessControl';
import {
  RevalidateWorkdayReportRequestSchema,
  SubmitWorkdayReportBundleSchema,
} from '@insite/shared';
import {
  requireAnyAuthWithWebPermission,
  requireFieldSession,
} from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  listProjectWorkdayReports,
  revalidateWorkdayReport,
  submitWorkdayReportBundle,
} from './workdayReports.service';

const router = guardProjectRoutes(Router());

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
        projectId: projectIdForFieldWrite(req),
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
 * POST /api/v1/projects/:projectId/workday-reports/:reportId/revalidate
 * Re-submits a queried WBS daily report for AI chat re-parsing and notifies the Monitor.
 */
router.post(
  '/:projectId/workday-reports/:reportId/revalidate',
  requireFieldSession,
  validateBody(RevalidateWorkdayReportRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const report = await revalidateWorkdayReport({
        projectId: projectIdForFieldWrite(req),
        reportId: String(req.params.reportId),
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
  requireAnyAuthWithWebPermission('reports:view_all'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const reports = await listProjectWorkdayReports({
        projectId: String(req.params.projectId),
        workdayDate: req.query.workdayDate
          ? String(req.query.workdayDate)
          : undefined,
        // Field agents only ever see their own reports.
        reporterSessionId: req.fieldAgent?.sessionId,
      });
      res.json({ success: true, data: reports });
    } catch (error) {
      next(error);
    }
  }
);

export const workdayReportsRoutes = router;

