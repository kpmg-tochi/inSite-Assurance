import { Router, Request, Response, NextFunction } from "express";
import {
  JoinProjectMobileRequestSchema,
  RegisterPushTokenSchema,
  WebLoginRequestSchema,
  WebRegisterRequestSchema,
} from "@insite/shared";
import { validateBody } from "../../middleware/validate.middleware";
import { requireAnyAuth } from "../../middleware/auth.middleware";
import { prisma } from "../../config/prisma";
import {
  joinProjectMobile,
  loginWebUser,
  registerWebUser,
} from "./auth.service";

const router = Router();

router.post(
  "/register",
  validateBody(WebRegisterRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await registerWebUser(req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/login",
  validateBody(WebLoginRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await loginWebUser(req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/join-project",
  validateBody(JoinProjectMobileRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await joinProjectMobile(req.body);
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/me",
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
            actorType: "WEB_USER",
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
        const liveSession = await prisma.fieldAgentSession.findUnique({
          where: { id: req.fieldAgent.sessionId },
          include: {
            project: {
              select: {
                id: true,
                name: true,
                codePrefix: true,
                stateLocation: true,
                reportingCadence: true,
                workdayStartTime: true,
                workdayEndTime: true,
                geofenceMode: true,
                geofenceGeoJson: true,
              },
            },
          },
        });

        res.json({
          success: true,
          data: {
            actorType: "FIELD_AGENT",
            fieldSession: liveSession
              ? {
                  sessionId: liveSession.id,
                  projectId: liveSession.projectId,
                  independenceTier: liveSession.independenceTier,
                  agentFullName: liveSession.agentFullName,
                  agentPhoneNumber: liveSession.agentPhoneNumber,
                  deviceId: liveSession.deviceId,
                  assuranceStatus: liveSession.assuranceStatus,
                  rejectionReason: liveSession.rejectionReason,
                  reviewedAt: liveSession.reviewedAt,
                  project: liveSession.project,
                }
              : req.fieldAgent,
          },
        });
        return;
      }
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/push-token",
  requireAnyAuth,
  validateBody(RegisterPushTokenSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { deviceToken, devicePlatform, appVersion } = req.body;
      const sessionId = req.fieldAgent?.sessionId ?? null;
      const userId = req.webUser?.userId ?? null;

      const pushToken = await prisma.pushToken.upsert({
        where: { deviceToken },
        create: {
          deviceToken,
          devicePlatform,
          appVersion: appVersion ?? null,
          sessionId,
          userId,
        },
        update: {
          devicePlatform,
          appVersion: appVersion ?? null,
          sessionId,
          userId,
          updatedAt: new Date(),
        },
      });

      res.status(200).json({ success: true, data: pushToken });
    } catch (error) {
      next(error);
    }
  },
);

export const authRoutes = router;
