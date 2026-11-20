import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { SaveRegistrationBodyRequestSchema, UpdateCredentialPolicyRequestSchema } from '@insite/shared';
import { requirePermission, requireWebAuth } from '../../middleware/auth.middleware';
import { validateBody } from '../../middleware/validate.middleware';
import { AppError } from '../../middleware/error.middleware';
import { guardProjectRoutes } from '../../utils/accessControl';
import { getCredentialSettings, getProjectCredentialPolicy, updateCredentialPolicy } from './credentialPolicy.service';
import {
  createRegistrationBody,
  deleteRegistrationBody,
  listRegistrationBodies,
  updateRegistrationBody,
} from './registrationBodies.service';

type Handler = (req: Request, res: Response) => Promise<void>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const bodyIdOf = (req: Request) => {
  const parsed = z.string().uuid().safeParse(req.params.bodyId);
  if (!parsed.success) throw new AppError('Registration body not found', 404, 'REGISTRATION_BODY_NOT_FOUND');
  return parsed.data;
};

/**
 * Phase 12 tenant credentials: the registration policy and the registration body list. Readable by
 * every web user of the tenant (forms need them); changed with tenant:manage_settings.
 */
const tenantRouter = Router();

/** GET /api/v1/credentials/settings: tenant policy, resolved values and all bodies. */
tenantRouter.get(
  '/settings',
  requireWebAuth,
  wrap(async (req, res) => {
    res.json({ success: true, data: await getCredentialSettings(req.webUser!.tenantId) });
  })
);

/** PUT /api/v1/credentials/policy */
tenantRouter.put(
  '/policy',
  requirePermission('tenant:manage_settings'),
  validateBody(UpdateCredentialPolicyRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await updateCredentialPolicy(req.webUser!, req.body) });
  })
);

/** GET /api/v1/credentials/registration-bodies?includeArchived=true */
tenantRouter.get(
  '/registration-bodies',
  requireWebAuth,
  wrap(async (req, res) => {
    res.json({ success: true, data: await listRegistrationBodies(req.webUser!.tenantId, req.query.includeArchived === 'true') });
  })
);

tenantRouter.post(
  '/registration-bodies',
  requirePermission('tenant:manage_settings'),
  validateBody(SaveRegistrationBodyRequestSchema),
  wrap(async (req, res) => {
    res.status(201).json({ success: true, data: await createRegistrationBody(req.webUser!, req.body) });
  })
);

/** PUT: rename, re-prefix, archive or restore. */
tenantRouter.put(
  '/registration-bodies/:bodyId',
  requirePermission('tenant:manage_settings'),
  validateBody(SaveRegistrationBodyRequestSchema),
  wrap(async (req, res) => {
    res.json({ success: true, data: await updateRegistrationBody(req.webUser!, bodyIdOf(req), req.body) });
  })
);

/** DELETE: deletes an unused body; archives one still named by a profile or certificate. */
tenantRouter.delete(
  '/registration-bodies/:bodyId',
  requirePermission('tenant:manage_settings'),
  wrap(async (req, res) => {
    res.json({ success: true, data: await deleteRegistrationBody(req.webUser!, bodyIdOf(req)) });
  })
);

export const credentialsRoutes = tenantRouter;

/** GET /api/v1/projects/:projectId/credential-policy: the project's resolved policy (any project principal). */
const projectRouter = guardProjectRoutes(Router());

projectRouter.get(
  '/:projectId/credential-policy',
  wrap(async (req, res) => {
    res.json({ success: true, data: await getProjectCredentialPolicy(String(req.params.projectId)) });
  })
);

export const projectCredentialRoutes = projectRouter;
