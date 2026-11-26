import { NextFunction, Request, Response, Router } from 'express';
import {
  ContractorFlagListQuerySchema,
  DecideContractorFlagActionRequestSchema,
  LiftContractorFlagActionRequestSchema,
} from '@insite/shared';
import { requirePermission } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { guardProjectRoutes } from '../../utils/accessControl';
import {
  decideContractorFlagAction,
  getContractorFlag,
  liftContractorFlagAction,
  listContractorFlags,
  listProjectContractorFlags,
} from './contractorFlags.service';

/**
 * Client demo updates F.4 (wave 3).
 * - `contractorFlagsRoutes` at /api/v1/contractor-flags: list (`contractors:view_register`, or
 *   `contractors:manage`, which decides), detail (those, or a reader of the flag's project), decide
 *   an action and lift a payment hold (`contractors:manage`; audited on the project ledger).
 * - `projectContractorFlagsRoutes` at /api/v1/projects: GET /:projectId/contractor-flags for any web
 *   reader of the project (overview contractor card, payments page), behind the project guard.
 */
export const contractorFlagsRoutes = Router();
export const projectContractorFlagsRoutes = guardProjectRoutes(Router());

type Handler = (req: Request) => Promise<unknown>;
const send =
  (fn: Handler, status = 200) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req))
      .then((data) => res.status(status).json({ success: true, data }))
      .catch(next);
  };

const READ = ['contractors:view_register', 'contractors:manage'];

contractorFlagsRoutes.get(
  '/',
  requirePermission(...READ),
  send((req) => listContractorFlags(req.webUser!, ContractorFlagListQuerySchema.parse(req.query)))
);

// Detail: the register's readers, or anyone who can see the flag's project (checked in the service).
contractorFlagsRoutes.get(
  '/:flagId',
  requirePermission(),
  send((req) => getContractorFlag(req.webUser!, String(req.params.flagId)))
);

contractorFlagsRoutes.post(
  '/:flagId/actions',
  requirePermission('contractors:manage'),
  validateBody(DecideContractorFlagActionRequestSchema),
  send((req) => decideContractorFlagAction(req.webUser!, String(req.params.flagId), req.body), 201)
);

contractorFlagsRoutes.post(
  '/:flagId/actions/:actionId/lift',
  requirePermission('contractors:manage'),
  validateBody(LiftContractorFlagActionRequestSchema),
  send((req) => liftContractorFlagAction(req.webUser!, String(req.params.flagId), String(req.params.actionId), req.body))
);

projectContractorFlagsRoutes.get(
  '/:projectId/contractor-flags',
  requirePermission(),
  send((req) => listProjectContractorFlags(String(req.params.projectId), req.webUser!))
);
