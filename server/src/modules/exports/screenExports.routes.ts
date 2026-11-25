import { NextFunction, Request, RequestHandler, Response, Router } from 'express';
import {
  FindingsExportQuerySchema,
  KpiQuerySchema,
  PaymentsExportQuerySchema,
  PlannerVisitsExportQuerySchema,
  ProjectVisitsExportQuerySchema,
} from '@insite/shared';
import { guardProjectRoutes } from '../../utils/accessControl';
import { requirePermission } from '../../middleware/auth.middleware';
import { sendXlsx } from '../../utils/exportSheet';
import {
  buildKpiExport,
  buildPlannerVisitsExport,
  buildProjectFindingsExport,
  buildProjectPaymentsExport,
  buildProjectVisitsExport,
  XlsxFile,
} from './screenExports.service';

/**
 * UBEC IRL: Excel exports of the visits, findings, payments and KPI screens. Each route takes the
 * permission of the screen it comes from; project routes sit behind the project guard (visibility,
 * lifecycle), tenant routes use the directory's visibility through the screen's own query.
 * Web users only (field principals have no such screens).
 */

const wrap =
  (fn: (req: Request) => Promise<XlsxFile>): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req))
      .then(({ buffer, fileName }) => sendXlsx(res, fileName, buffer), next);
  };
const p = (req: Request) => String(req.params.projectId);

/** Mounted at /api/v1/projects before the visits router (its /visits/:visitId would take the path). */
const projectRouter = guardProjectRoutes(Router());

projectRouter.get(
  '/:projectId/visits/export.xlsx',
  requirePermission('visits:view'),
  wrap((req) => buildProjectVisitsExport(p(req), req.webUser!, ProjectVisitsExportQuerySchema.parse(req.query)))
);

projectRouter.get(
  '/:projectId/findings/export.xlsx',
  requirePermission('visits:view', 'findings:manage'),
  wrap((req) => buildProjectFindingsExport(p(req), req.webUser!, FindingsExportQuerySchema.parse(req.query)))
);

projectRouter.get(
  '/:projectId/payments/export.xlsx',
  requirePermission('payments:view', 'payments:record'),
  wrap((req) => buildProjectPaymentsExport(p(req), req.webUser!, PaymentsExportQuerySchema.parse(req.query)))
);

/** Mounted at /api/v1: the planner's and the KPI page's exports. */
const tenantRouter = Router();

tenantRouter.get(
  '/visits/export.xlsx',
  requirePermission('visits:view'),
  wrap((req) => buildPlannerVisitsExport(req.webUser!, PlannerVisitsExportQuerySchema.parse(req.query)))
);

tenantRouter.get(
  '/kpis/export.xlsx',
  requirePermission('kpis:view'),
  wrap((req) => buildKpiExport(req.webUser!, KpiQuerySchema.parse(req.query)))
);

export { projectRouter as projectExportRoutes, tenantRouter as tenantExportRoutes };
