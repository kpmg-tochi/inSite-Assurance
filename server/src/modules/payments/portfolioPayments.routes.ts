import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import { PortfolioPaymentsBreakdownQuerySchema, PortfolioPaymentsQuerySchema } from '@insite/shared';
import { requirePermission } from '../../middleware/auth.middleware';
import { sendXlsx } from '../../utils/exportSheet';
import {
  buildPortfolioPaymentsExport,
  getPortfolioPaymentsBreakdown,
  getPortfolioPaymentsSummary,
  listPortfolioPayments,
} from './portfolioPayments.service';

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

/** Wave 4 (G.1/G.2): totals grouped by zone, State, LGA, contractor, project, month or quarter. */
router.get(
  '/breakdown',
  requirePermission('payments:view'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await getPortfolioPaymentsBreakdown(req.webUser!, PortfolioPaymentsBreakdownQuerySchema.parse(req.query)) });
  })
);

/** Sheets Summary, Breakdown (`by`, default State) and Payments. */
router.get(
  '/export.xlsx',
  requirePermission('payments:view'),
  wrap(async (req, res) => {
    const { buffer, fileName } = await buildPortfolioPaymentsExport(req.webUser!, PortfolioPaymentsBreakdownQuerySchema.parse(req.query));
    sendXlsx(res, fileName, buffer);
  })
);

export const portfolioPaymentsRoutes = router;
