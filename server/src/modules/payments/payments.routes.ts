import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { RecordPaymentRequestSchema, VoidPaymentRequestSchema } from '@insite/shared';
import { guardProjectRoutes } from '../../utils/accessControl';
import { requirePermission } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { getProjectPayments, recordPayment, voidPayment } from './payments.service';

/** Payment record (redesign R1b). Mounted at /api/v1/projects behind the project guard. */
const router = guardProjectRoutes(Router());

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
const p = (req: Request, name: string) => String(req.params[name]);

router.get(
  '/:projectId/payments',
  requirePermission('payments:view', 'payments:record'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await getProjectPayments(p(req, 'projectId'), req.webUser!) });
  })
);

router.post(
  '/:projectId/payments',
  requirePermission('payments:record'),
  validateBody(RecordPaymentRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await recordPayment(p(req, 'projectId'), req.webUser!, req.body) });
  })
);

router.post(
  '/:projectId/payments/:paymentId/void',
  requirePermission('payments:record'),
  validateBody(VoidPaymentRequestSchema),
  wrap(async (req, res) => {
    res.json({
      success: true,
      data: await voidPayment(p(req, 'projectId'), p(req, 'paymentId'), req.webUser!, req.body),
    });
  })
);

export const paymentsRoutes = router;
