import { Router, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import {
  DemoSkipVerificationRequestSchema,
  JoinProjectMobileRequestSchema,
  RegisterPushTokenSchema,
  SubmitAssuranceVerificationRequestSchema,
  WebLoginRequestSchema,
  WebRegisterRequestSchema,
} from "@insite/shared";
import { validateBody } from "../../middleware/validate.middleware";
import {
  FieldAgentJwtPayload,
  requireAnyAuth,
  requireFieldSession,
} from "../../middleware/auth.middleware";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { AppError } from "../../middleware/error.middleware";
import {
  demoSkipVerificationMobile,
  joinProjectMobile,
  loginWebUser,
  registerWebUser,
} from "./auth.service";
import { recordAuditEvent } from "../audit/audit.service";
import { createMobileNotification } from "../notifications/notifications.service";

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

/**
 * POST /api/v1/auth/assurance-verification
 * Persists ID photo, 3-pose liveness selfies + CV metadata, and regulatory credentials
 * onto the contractor's FieldAgentSession for Independent Monitor / Lender review.
 */
router.post(
  "/assurance-verification",
  requireFieldSession,
  validateBody(SubmitAssuranceVerificationRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const sessionId = req.fieldAgent!.sessionId;
      const body = req.body;

      const updated = await prisma.fieldAgentSession.update({
        where: { id: sessionId },
        data: {
          idDocumentType: body.idDocumentType,
          idDocumentUrl: body.idDocumentUrl,
          selfieImageUrl: body.selfieFrontUrl,
          selfieLeftUrl: body.selfieLeftUrl,
          selfieRightUrl: body.selfieRightUrl,
          livenessPassed: Boolean(body.livenessVerification?.isLive),
          livenessMetadata: body.livenessVerification as any,
          corenLicenseNumber: body.corenLicenseNumber,
          experienceSummary: body.experienceSummary,
          assuranceStatus: "PENDING_APPROVAL",
          lastSyncAt: new Date(),
        },
        select: {
          id: true,
          projectId: true,
          assuranceStatus: true,
          livenessPassed: true,
          corenLicenseNumber: true,
        },
      });

      await recordAuditEvent(prisma, {
        projectId: updated.projectId,
        actorType: "FIELD_AGENT",
        actorId: sessionId,
        actorDisplayName: req.fieldAgent!.agentFullName,
        action: "CONTRACTOR_ASSURANCE_SUBMITTED",
        summaryText: `Contractor submitted 3-pose liveness (${body.livenessVerification?.detectorEngine}) and ${body.idDocumentType} credentials.`,
        payload: {
          idDocumentType: body.idDocumentType,
          livenessPassed: updated.livenessPassed,
          detectorEngine: body.livenessVerification?.detectorEngine,
        },
      });

      await createMobileNotification(prisma, {
        projectId: updated.projectId,
        fieldSessionId: sessionId,
        type: "ASSURANCE_PENDING",
        actionType: "NONE",
        requiresAction: false,
        title: "Verification Under Review",
        message: `Your ${body.idDocumentType} dossier and ${body.corenLicenseNumber} credentials are queued for Independent Monitor review. You can continue capturing field logs offline.`,
        metadata: {
          corenLicenseNumber: body.corenLicenseNumber,
        },
      });

      res.status(200).json({ success: true, data: updated });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/auth/demo/skip-verification
 * DEMO-ONLY ENDPOINT: Links the mobile field agent directly to the project
 * matching their joinCode as APPROVED without completing ID/liveness verification.
 */
router.post(
  "/demo/skip-verification",
  validateBody(DemoSkipVerificationRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (!env.DEMO_MODE) {
        throw new AppError(
          "Demo verification bypass is disabled in this environment",
          403,
          "DEMO_DISABLED",
        );
      }

      let authenticatedSessionId: string | undefined;
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith("Bearer ")) {
        try {
          const decoded = jwt.verify(
            authHeader.slice(7).trim(),
            env.JWT_SECRET,
          ) as Partial<FieldAgentJwtPayload> & { tokenType?: string };
          if (decoded?.tokenType === "FIELD_AGENT" && decoded.sessionId) {
            authenticatedSessionId = decoded.sessionId;
          }
        } catch {
          // Ignore stale/invalid optional bearer token on demo bypass
        }
      }

      const result = await demoSkipVerificationMobile(
        req.body,
        authenticatedSessionId,
      );
      res.status(200).json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

export const authRoutes = router;
