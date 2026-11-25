import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { PortfolioPaymentsQuerySchema } from '@insite/shared';
import { requirePermission } from '../../middleware/auth.middleware';
import { sendXlsx } from '../../utils/exportSheet';
import { buildPortfolioPaymentsExport, getPortfolioPaymentsSummary, listPortfolioPayments } from './portfolioPayments.service';

/**
 * Client demo updates G.2: payments across the programme, mounted at /api/v1/payments. Web users
 * with `payments:view`; the projects are the directory's (visibility rule, ACTIVE and ARCHIVED).
 */
const router = Router();

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };

router.get(
  '/',
  requirePermission('payments:view'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await listPortfolioPayments(req.webUser!, PortfolioPaymentsQuerySchema.parse(req.query)) });
  })
);

router.get(
  '/summary',
  requirePermission('payments:view'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await getPortfolioPaymentsSummary(req.webUser!, PortfolioPaymentsQuerySchema.parse(req.query)) });
  })
);

router.get(
  '/export.xlsx',
  requirePermission('payments:view'),
  wrap(async (req, res) => {
    const { buffer, fileName } = await buildPortfolioPaymentsExport(req.webUser!, PortfolioPaymentsQuerySchema.parse(req.query));
    sendXlsx(res, fileName, buffer);
  })
);

export const portfolioPaymentsRoutes = router;
