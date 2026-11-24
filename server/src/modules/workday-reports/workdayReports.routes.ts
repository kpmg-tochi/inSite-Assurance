import { Router, Request, Response, NextFunction } from 'express';
import { guardProjectRoutes, projectIdForFieldWrite } from '../../utils/accessControl';
import {
  RevalidateWorkdayReportRequestSchema,
  ReviewWorkdayReportRequestSchema,
  SubmitWorkdayReportRequestSchema,
  SuggestWorkdaySummaryRequestSchema,
} from '@insite/shared';
import {
  requireAnyAuthWithWebPermission,
  requireFieldSession,
  requireWebAuth,
} from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  listProjectWorkdayReports,
  revalidateWorkdayReport,
  reviewWorkdayReport,
  submitWorkdayReport,
  suggestWorkdaySummary,
} from './workdayReports.service';

const router = guardProjectRoutes(Router());

/**
 * POST /api/v1/projects/:projectId/workday-reports
 * Submits a confirmed end-of-day report. 201 when created, 200 when replaying the same clientReportId.
 */
router.post(
  '/:projectId/workday-reports',
  requireFieldSession,
  validateBody(SubmitWorkdayReportRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await submitWorkdayReport({
        projectId: projectIdForFieldWrite(req),
        fieldAgent: req.fieldAgent!,
        input: req.body,
      });
      res.status(result.created ? 201 : 200).json({ success: true, data: result.report });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/workday-reports/suggest
 * Optional assist: transcripts plus a suggested summary and quantity. Not stored as evidence.
 */
router.post(
  '/:projectId/workday-reports/suggest',
  requireFieldSession,
  validateBody(SuggestWorkdaySummaryRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const suggestion = await suggestWorkdaySummary({
        projectId: projectIdForFieldWrite(req),
        fieldAgent: req.fieldAgent!,
        input: req.body,
      });
      res.json({ success: true, data: suggestion });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/workday-reports/:reportId/revalidate
 * A new revision answering a query. Same idempotency and ownership rules as a submission.
 */
router.post(
  '/:projectId/workday-reports/:reportId/revalidate',
  requireFieldSession,
  validateBody(RevalidateWorkdayReportRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await revalidateWorkdayReport({
        projectId: projectIdForFieldWrite(req),
        reportId: String(req.params.reportId),
        fieldAgent: req.fieldAgent!,
        input: req.body,
      });
      res.status(result.created ? 201 : 200).json({ success: true, data: result.report });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/workday-reports
 * Lists workday reports for the web portal and for mobile sync (field agents see only their own).
 */
router.get(
  '/:projectId/workday-reports',
  requireAnyAuthWithWebPermission('reports:view_all'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const reports = await listProjectWorkdayReports({
        projectId: String(req.params.projectId),
        workdayDate: req.query.workdayDate ? String(req.query.workdayDate) : undefined,
        reporterSessionId: req.fieldAgent?.sessionId,
        // An account sees its reports from all its devices.
        reporterUserId: req.fieldAgent?.userId ?? null,
        viewer: req.webUser ?? null,
        status: typeof req.query.status === 'string' ? req.query.status : undefined,
        periodStart: typeof req.query.periodStart === 'string' ? req.query.periodStart : undefined,
        lateOnly: req.query.late === 'true',
      });
      res.json({ success: true, data: reports });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/workday-reports/:reportId/review (Phase 7)
 * Approve or return a report at the current step of its approval chain. The step names the
 * permission (and optionally the role) required; the service checks it.
 */
router.post(
  '/:projectId/workday-reports/:reportId/review',
  requireWebAuth,
  validateBody(ReviewWorkdayReportRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const report = await reviewWorkdayReport({
        projectId: String(req.params.projectId),
        reportId: String(req.params.reportId),
        webUser: req.webUser!,
        input: req.body,
      });
      res.json({ success: true, data: report });
    } catch (error) {
      next(error);
    }
  }
);

export const workdayReportsRoutes = router;
