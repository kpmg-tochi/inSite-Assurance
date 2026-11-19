import { Router, Request, Response, NextFunction } from 'express';
import { guardProjectRoutes } from '../../utils/accessControl';
import {
  CreateWbsChatMessageRequestSchema,
  CreateWorkdayReportQueryRequestSchema,
  ResolveReportQueryRequestSchema,
} from '@insite/shared';
import {
  requireAnyAuthWithWebPermission,
  requirePermission,
} from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  createWorkdayReportQuery,
  listBoqChatMessages,
  postWbsChatMessage,
  resolveReportQuery,
} from './wbsChat.service';

const router = guardProjectRoutes(Router());

/**
 * POST /api/v1/projects/:projectId/workday-reports/:reportId/queries
 * Monitor raises a clarification query from the Workday Report Summary Drawer in the Web App.
 */
router.post(
  '/:projectId/workday-reports/:reportId/queries',
  requirePermission('reports:raise_query'),
  validateBody(CreateWorkdayReportQueryRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const created = await createWorkdayReportQuery({
        projectId,
        reportId: String(req.params.reportId),
        webUser: req.webUser!,
        queryText: req.body.queryText,
      });
      res.status(201).json({ success: true, data: created });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/report-queries/:queryId/resolve
 * Monitor closes a workday-report query (answered, or withdrawn).
 */
router.post(
  '/:projectId/report-queries/:queryId/resolve',
  requirePermission('reports:raise_query'),
  validateBody(ResolveReportQueryRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const resolved = await resolveReportQuery({
        projectId: String(req.params.projectId),
        queryId: String(req.params.queryId),
        webUser: req.webUser!,
        resolutionNote: req.body.resolutionNote,
      });
      res.json({ success: true, data: resolved });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/boq/:boqItemId/messages
 * Fetches persisted WBS chat messages & active/historical queries for Mobile sync.
 */
router.get(
  '/:projectId/boq/:boqItemId/messages',
  requireAnyAuthWithWebPermission('reports:view_all'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const messages = await listBoqChatMessages({
        projectId: String(req.params.projectId),
        boqItemId: String(req.params.boqItemId),
      });
      res.json({ success: true, data: messages });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/boq/:boqItemId/messages
 * Appends a WBS chat message. Media is referenced by a registered capture (captureId).
 */
router.post(
  '/:projectId/boq/:boqItemId/messages',
  requireAnyAuthWithWebPermission('reports:raise_query', 'reports:respond_query'),
  validateBody(CreateWbsChatMessageRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      let senderName = req.webUser?.fullName || 'Field Engineer';
      let senderRole = req.webUser?.roleName || 'ENGINEER';

      if (req.fieldAgent) {
        senderName = req.fieldAgent.agentFullName || 'Field Engineer';
        senderRole =
          req.fieldAgent.fieldPersonaType === 'CONTRACTOR_EXECUTOR'
            ? 'ENGINEER'
            : 'INSPECTOR';
      }

      const result = await postWbsChatMessage({
        projectId: String(req.params.projectId),
        boqItemId: String(req.params.boqItemId),
        fieldSessionId: req.fieldAgent?.sessionId,
        senderUserId: req.webUser?.userId,
        senderName,
        senderRole,
        input: req.body,
      });
      res.status(result.created ? 201 : 200).json({ success: true, data: result.message });
    } catch (error) {
      next(error);
    }
  }
);

export const wbsChatRoutes = router;
