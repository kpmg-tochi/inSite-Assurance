import { NextFunction, Request, Response, Router } from 'express';
import {
  ChangeContractorStatusRequestSchema,
  ContractorListQuerySchema,
  CreateContractorRequestSchema,
  UpdateContractorRequestSchema,
} from '@insite/shared';
import { z } from 'zod';
import { prisma } from '../../config/prisma';
import { requirePermission } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import {
  changeContractorStatus,
  createContractor,
  findContractorDuplicates,
  getContractorDetail,
  listContractors,
  refreshContractorRatingSnapshots,
  updateContractor,
} from './contractors.service';

/**
 * Client demo updates F.1–F.3 (wave 2): /api/v1/contractors, the contractor register.
 * - Read the list and the duplicate check: `contractors:view_register`, or `contractors:manage`
 *   (the contractor picker in project setup needs them to name and add a contractor).
 * - Detail and "Refresh ratings": `contractors:view_register`.
 * - Create, edit and status changes: `contractors:manage` (audited on the tenant ledger).
 */
export const contractorsRoutes = Router();

type Handler = (req: Request) => Promise<unknown>;
const send =
  (fn: Handler, status = 200) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve()
      .then(() => fn(req))
      .then((data) => res.status(status).json({ success: true, data }))
      .catch(next);
  };

const DuplicatesQuerySchema = z.object({
  name: z.string().trim().max(200).optional(),
  rc: z.string().trim().max(40).optional(),
});

contractorsRoutes.get(
  '/',
  requirePermission('contractors:view_register', 'contractors:manage'),
  send((req) => listContractors(req.webUser!.tenantId, ContractorListQuerySchema.parse(req.query)))
);

contractorsRoutes.get(
  '/duplicates',
  requirePermission('contractors:view_register', 'contractors:manage'),
  send((req) => {
    const q = DuplicatesQuerySchema.parse(req.query);
    return findContractorDuplicates(prisma, req.webUser!.tenantId, { name: q.name ?? null, registrationNumber: q.rc ?? null });
  })
);

contractorsRoutes.post(
  '/refresh-ratings',
  requirePermission('contractors:view_register'),
  send(async (req) => {
    const now = new Date();
    const count = await refreshContractorRatingSnapshots(req.webUser!.tenantId, now);
    return { count, computedAt: now.toISOString() };
  })
);

contractorsRoutes.post(
  '/',
  requirePermission('contractors:manage'),
  validateBody(CreateContractorRequestSchema),
  send((req) => createContractor(req.webUser!, req.body), 201)
);

contractorsRoutes.get(
  '/:contractorId',
  requirePermission('contractors:view_register'),
  send((req) => getContractorDetail(req.webUser!, String(req.params.contractorId)))
);

contractorsRoutes.put(
  '/:contractorId',
  requirePermission('contractors:manage'),
  validateBody(UpdateContractorRequestSchema),
  send((req) => updateContractor(req.webUser!, String(req.params.contractorId), req.body))
);

contractorsRoutes.post(
  '/:contractorId/status',
  requirePermission('contractors:manage'),
  validateBody(ChangeContractorStatusRequestSchema),
  send((req) => changeContractorStatus(req.webUser!, String(req.params.contractorId), req.body))
);
