import { Router, Request, Response, NextFunction } from 'express';
import {
  JoinProjectMobileRequestSchema,
  WebLoginRequestSchema,
  WebRegisterRequestSchema,
} from '@insite/shared';
import { validateBody } from '../../middleware/validate.middleware';
import { requireAnyAuth } from '../../middleware/auth.middleware';
import { prisma } from '../../config/prisma';
import {
  joinProjectMobile,
  loginWebUser,
  registerWebUser,
} from './auth.service';

const router = Router();

router.post(
  '/register',
  validateBody(WebRegisterRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await registerWebUser(req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/login',
  validateBody(WebLoginRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await loginWebUser(req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/join-project',
  validateBody(JoinProjectMobileRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await joinProjectMobile(req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/me',
  requireAnyAuth,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.webUser) {
        const user = await prisma.user.findUnique({
          where: { id: req.webUser.userId },
          include: { organization: true },
        });
        res.json({
          success: true,
          data: {
            actorType: 'WEB_USER',
            user: user
              ? {
                  id: user.id,
                  fullName: user.fullName,
                  email: user.email,
                  role: user.role,
                  organizationId: user.organizationId,
                  organizationName: user.organization.name,
                  professionalLicenseType: user.professionalLicenseType,
                  professionalLicenseNumber: user.professionalLicenseNumber,
                }
              : null,
          },
        });
        return;
      }

      if (req.fieldAgent) {
        res.json({
          success: true,
          data: {
            actorType: 'FIELD_AGENT',
            fieldSession: req.fieldAgent,
          },
        });
        return;
      }
    } catch (error) {
      next(error);
    }
  }
);

export const authRoutes = router;

