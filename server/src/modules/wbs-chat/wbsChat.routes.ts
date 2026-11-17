import { Router, Request, Response, NextFunction } from 'express';
import {
  CreateWbsChatMessageRequestSchema,
  CreateWorkdayReportQueryRequestSchema,
} from '@insite/shared';
import {
  requireAnyAuth,
  requireRole,
} from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  createWorkdayReportQuery,
  listBoqChatMessages,
  postWbsChatMessage,
} from './wbsChat.service';

const router = Router();

/**
 * POST /api/v1/projects/:projectId/workday-reports/:reportId/queries
 * Monitor raises a clarification query from the Workday Report Summary Drawer in the Web App.
 */
router.post(
  '/:projectId/workday-reports/:reportId/queries',
  requireRole('MONITOR'),
  validateBody(CreateWorkdayReportQueryRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await createWorkdayReportQuery({
        projectId: String(req.params.projectId),
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
 * GET /api/v1/projects/:projectId/boq/:boqItemId/messages
 * Fetches persisted WBS chat messages & active/historical queries for Mobile sync.
 */
router.get(
  '/:projectId/boq/:boqItemId/messages',
  requireAnyAuth,
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
 * Appends a new WBS chat message (e.g., field evidence photo, voice log, or clarification note).
 */
router.post(
  '/:projectId/boq/:boqItemId/messages',
  requireAnyAuth,
  validateBody(CreateWbsChatMessageRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      let senderName = req.webUser?.fullName || 'Field Engineer';
      let senderRole = req.webUser?.role || 'ENGINEER';

      if (req.fieldAgent) {
        senderName = req.fieldAgent.agentFullName || 'Field Engineer';
        senderRole =
          req.fieldAgent.independenceTier === 'CONTRACTOR_ENGINEER'
            ? 'ENGINEER'
            : 'INSPECTOR';
      }

      const created = await postWbsChatMessage({
        projectId: String(req.params.projectId),
        boqItemId: String(req.params.boqItemId),
        fieldSessionId: req.fieldAgent?.sessionId,
        senderName,
        senderRole,
        input: req.body,
      });
      res.status(201).json({ success: true, data: created });
    } catch (error) {
      next(error);
    }
  }
);

export const wbsChatRoutes = router;
