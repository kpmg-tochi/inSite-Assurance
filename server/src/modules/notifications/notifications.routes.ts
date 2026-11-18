import { Router, Request, Response, NextFunction } from 'express';
import { guardProjectRoutes } from '../../utils/accessControl';
import {
  requireFieldSession,
  requireWebAuth,
} from '../../middleware/auth.middleware';
import {
  listProjectNotifications,
  listWebNotifications,
  markAllWebNotificationsRead,
  markNotificationRead,
  markWebNotificationRead,
} from './notifications.service';

const router = guardProjectRoutes(Router());

/**
 * GET /api/v1/projects/:projectId/notifications
 * Lists persisted notifications for the active project / field session (unread newest first, then read newest first).
 */
router.get(
  '/:projectId/notifications',
  requireFieldSession,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const notifications = await listProjectNotifications(
        req.fieldAgent!.projectId,
        req.fieldAgent!.sessionId
      );
      res.json({ success: true, data: notifications });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/v1/projects/:projectId/notifications/:notificationId/read
 * Marks a passive notification (requiresAction = false) as read on tap.
 */
router.patch(
  '/:projectId/notifications/:notificationId/read',
  requireFieldSession,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await markNotificationRead({
        projectId: req.fieldAgent!.projectId,
        fieldSessionId: req.fieldAgent!.sessionId,
        notificationId: String(req.params.notificationId),
        resolvedByAction: false,
      });
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/notifications/:notificationId/resolve
 * Marks an action-required notification as read once the required action (e.g. evidence reply or backlog send) is completed.
 */
router.post(
  '/:projectId/notifications/:notificationId/resolve',
  requireFieldSession,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await markNotificationRead({
        projectId: req.fieldAgent!.projectId,
        fieldSessionId: req.fieldAgent!.sessionId,
        notificationId: String(req.params.notificationId),
        resolvedByAction: true,
      });
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * GET /api/v1/projects/:projectId/web-notifications
 * Lists persisted notifications matching the authenticated user's granted permissions.
 */
router.get(
  '/:projectId/web-notifications',
  requireWebAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const notifications = await listWebNotifications({
        projectId,
        webUser: req.webUser!,
      });
      res.json({ success: true, data: notifications });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * PATCH /api/v1/projects/:projectId/web-notifications/:notificationId/read
 */
router.patch(
  '/:projectId/web-notifications/:notificationId/read',
  requireWebAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await markWebNotificationRead({
        projectId: String(req.params.projectId),
        notificationId: String(req.params.notificationId),
        webUser: req.webUser!,
      });
      res.json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * POST /api/v1/projects/:projectId/web-notifications/read-all
 */
router.post(
  '/:projectId/web-notifications/read-all',
  requireWebAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const projectId = String(req.params.projectId);
      const result = await markAllWebNotificationsRead({
        projectId,
        webUser: req.webUser!,
      });
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

export const notificationsRoutes = router;
