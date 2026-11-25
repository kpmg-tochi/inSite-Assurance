import { NextFunction, Request, Response, Router } from 'express';
import { ProjectLotsQuerySchema } from '@insite/shared';
import { requireWebAuth } from '../../middleware/auth.middleware';
import { listProjectLots } from './projectLots.service';

/**
 * Client demo updates C3: GET /api/v1/project-lots (ProjectLotListDto) for the project creation form:
 * today in the workspace zone, the allowed intervention years, and each year's lots with the next
 * lot and batch numbers. Any web user of the workspace; codes are assigned on draft creation.
 */
export const projectLotsRoutes = Router();

projectLotsRoutes.get('/', requireWebAuth, (req: Request, res: Response, next: NextFunction) => {
  Promise.resolve()
    .then(() => listProjectLots(req.webUser!.tenantId, ProjectLotsQuerySchema.parse(req.query).interventionYear))
    .then((data) => res.json({ success: true, data }))
    .catch(next);
});
