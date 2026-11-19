import { Router, Request, Response, NextFunction } from "express";
import {
  ChangePasswordRequestSchema,
  DemoSkipVerificationRequestSchema,
  JoinProjectMobileRequestSchema,
  MobileLoginRequestSchema,
  RegisterDeviceKeyRequestSchema,
  RegisterPushTokenSchema,
  resolveRatingLabels,
  SubmitAssuranceVerificationRequestSchema,
  WebLoginRequestSchema,
  WebRegisterRequestSchema,
} from "@insite/shared";
import { validateBody } from "../../middleware/validate.middleware";
import {
  optionalAuth,
  requireAnyAuth,
  requireFieldSession,
  requireMobileUser,
  requireWebAuth,
} from "../../middleware/auth.middleware";
import {
  demoRateLimit,
  joinProjectRateLimit,
  loginRateLimit,
} from "../../middleware/rateLimit.middleware";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { AppError } from "../../middleware/error.middleware";
import {
  changeMobileUserPassword,
  changeWebUserPassword,
  demoSkipVerificationMobile,
  getMobileAccountAndProjects,
  getProjectBaselinePack,
  serializeSessionContractor,
  mobileTenantBranding,
  getWebUserProfileById,
  joinProjectMobile,
  loginMobileUser,
  loginWebUser,
  logoutMobileUser,
  registerDeviceKey,
  registerWebUser,
} from "./auth.service";
import { recordAuditEvent } from "../audit/audit.service";
import { createMobileNotification } from "../notifications/notifications.service";
import { markNotificationsActioned } from "../notifications/notificationActions";
import { assertProjectObjectKey } from "../../integrations/storage.service";

const router = Router();

// D-2.1: public self-registration exists only in demo mode. Otherwise users are created by a
// tenant admin (users:invite_manage) or at tenant provisioning, and this route is not mounted.
if (env.DEMO_MODE) {
  router.post(
    "/register",
    demoRateLimit,
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
}

router.post(
  "/login",
  loginRateLimit,
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

/**
 * POST /api/v1/auth/change-password
 * Allowed while `mustChangePassword` is set. Revokes other sessions and returns a fresh token.
 */
router.post(
  "/change-password",
  loginRateLimit,
  requireWebAuth,
  validateBody(ChangePasswordRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await changeWebUserPassword(req.webUser!.userId, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// Provisioned mobile accounts (Phase 5). Web tokens are refused on these routes and mobile-account
// tokens are refused on web routes (each guard checks the token type).
// ---------------------------------------------------------------------------

router.post(
  "/mobile/login",
  loginRateLimit,
  validateBody(MobileLoginRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await loginMobileUser(req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/mobile/change-password",
  loginRateLimit,
  requireMobileUser,
  validateBody(ChangePasswordRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await changeMobileUserPassword(req.mobileUser!, req.body);
      res.json({ success: true, data: result });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/mobile/logout",
  requireMobileUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      await logoutMobileUser(req.mobileUser!);
      res.json({ success: true, data: { signedOut: true } });
    } catch (error) {
      next(error);
    }
  },
);

/** Visible projects with the effective mobile role. NO_MOBILE_ACCESS if the role was taken away. */
router.get(
  "/mobile/projects",
  requireMobileUser,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { projects } = await getMobileAccountAndProjects(
        req.mobileUser!.userId,
        req.mobileUser!.deviceRowId,
      );
      res.json({ success: true, data: projects });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The offline baseline pack for one project. Open to provisioned accounts that can see the project
 * and to join-code sessions bound to it (the field guard checks both).
 */
router.get(
  "/mobile/projects/:projectId/baseline",
  requireFieldSession,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.fieldAgent!.projectId !== req.params.projectId) {
        throw new AppError("Field Agent session is bound to a different project", 403, "PROJECT_MISMATCH");
      }
      const pack = await getProjectBaselinePack(req.fieldAgent!.projectId, req.fieldAgent!.sessionId);
      res.json({ success: true, data: pack });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The caller's field session on one project (created on first use for a provisioned account).
 * The app needs the id to recognise its own chat messages, and shows the server role and weight.
 */
router.get(
  "/mobile/projects/:projectId/session",
  requireFieldSession,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const fa = req.fieldAgent!;
      if (fa.projectId !== req.params.projectId) {
        throw new AppError("Field Agent session is bound to a different project", 403, "PROJECT_MISMATCH");
      }
      const row = await prisma.fieldAgentSession.findUnique({
        where: { id: fa.sessionId },
        select: {
          projectContractor: {
            select: { id: true, tradeCategory: true, tradeCode: true, isMainContractor: true, organization: { select: { name: true } } },
          },
        },
      });
      res.json({
        success: true,
        data: {
          sessionId: fa.sessionId,
          projectId: fa.projectId,
          origin: fa.origin,
          roleId: fa.roleId,
          roleCode: fa.roleCode,
          roleName: fa.roleName,
          fieldPersonaType: fa.fieldPersonaType,
          assuranceWeight: fa.assuranceWeight,
          permissions: fa.permissions,
          contractor: serializeSessionContractor(row?.projectContractor ?? null),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/join-project",
  joinProjectRateLimit,
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
        const userProfile = await getWebUserProfileById(req.webUser.userId);
        if (!userProfile) {
          throw new AppError("Account is inactive or no longer exists", 401, "ACCOUNT_INACTIVE");
        }
        res.json({
          success: true,
          data: {
            actorType: "WEB_USER",
            user: userProfile,
          },
        });
        return;
      }

      if (req.mobileUser) {
        const { account, projects } = await getMobileAccountAndProjects(
          req.mobileUser.userId,
          req.mobileUser.deviceRowId,
        );
        res.json({ success: true, data: { actorType: "MOBILE_USER", account, projects } });
        return;
      }

      if (req.fieldAgent) {
        const liveSession = await prisma.fieldAgentSession.findUnique({
          where: { id: req.fieldAgent.sessionId },
          include: {
            role: {
              include: {
                rolePermissions: {
                  include: { permission: { select: { key: true } } },
                },
              },
            },
            project: {
              select: {
                id: true,
                tenantId: true,
                name: true,
                codePrefix: true,
                stateLocation: true,
                reportingCadence: true,
                workdayStartTime: true,
                workdayEndTime: true,
                timezone: true,
                geofenceMode: true,
                geofenceGeoJson: true,
                tenant: {
                  select: { evidenceRatingLabels: true, name: true, brandingConfig: true, defaultCurrency: true },
                },
              },
            },
            projectContractor: {
              select: { id: true, tradeCategory: true, tradeCode: true, isMainContractor: true, organization: { select: { name: true } } },
            },
          },
        });

        if (!liveSession) {
          throw new AppError("Field session no longer exists", 401, "UNAUTHORIZED");
        }

        res.json({
          success: true,
          data: {
            actorType: "FIELD_AGENT",
            fieldSession: {
                  sessionId: liveSession.id,
                  tenantId: liveSession.project.tenantId,
                  projectId: liveSession.projectId,
                  roleId: liveSession.roleId,
                  roleCode: liveSession.role.code,
                  roleName: liveSession.role.name,
                  fieldPersonaType: liveSession.fieldPersonaType,
                  assuranceWeight: liveSession.assuranceWeight,
                  requiresIdentityAssurance:
                    liveSession.role.requiresIdentityAssurance,
                  permissions: liveSession.role.rolePermissions.map(
                    (rp) => rp.permission.key,
                  ),
                  agentFullName: liveSession.agentFullName,
                  agentPhoneNumber: liveSession.agentPhoneNumber,
                  deviceId: liveSession.deviceId,
                  assuranceStatus: liveSession.assuranceStatus,
                  rejectionReason: liveSession.rejectionReason,
                  devicePublicKeyId: liveSession.devicePublicKeyId,
                  reviewedAt: liveSession.reviewedAt,
                  ratingLabels: resolveRatingLabels(liveSession.project.tenant.evidenceRatingLabels),
                  contractor: serializeSessionContractor(liveSession.projectContractor),
                  tenantBranding: mobileTenantBranding(liveSession.project.tenant),
                  project: {
                    id: liveSession.project.id,
                    tenantId: liveSession.project.tenantId,
                    name: liveSession.project.name,
                    codePrefix: liveSession.project.codePrefix,
                    stateLocation: liveSession.project.stateLocation,
                    reportingCadence: liveSession.project.reportingCadence,
                    workdayStartTime: liveSession.project.workdayStartTime,
                    workdayEndTime: liveSession.project.workdayEndTime,
                    timezone: liveSession.project.timezone,
                    geofenceMode: liveSession.project.geofenceMode,
                    geofenceGeoJson: liveSession.project.geofenceGeoJson,
                  },
                },
          },
        });
        return;
      }
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/auth/device-key
 * One-time registration of the per-install Ed25519 public key for the calling field session.
 */
router.post(
  "/device-key",
  requireFieldSession,
  validateBody(RegisterDeviceKeyRequestSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await registerDeviceKey(req.fieldAgent!, req.body);
      res.status(result.alreadyRegistered ? 200 : 201).json({ success: true, data: result });
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
      // A provisioned account registers once for all its projects (Phase 5).
      const sessionId = req.fieldAgent?.sessionId ?? null;
      const userId = req.webUser?.userId ?? req.mobileUser?.userId ?? null;
      const mobileDeviceId = req.mobileUser?.deviceRowId ?? null;
      const ownerKey = sessionId
        ? `session:${sessionId}`
        : req.mobileUser
          ? `user:${req.mobileUser.userId}`
          : `web:${userId}`;

      const pushToken = await prisma.pushToken.upsert({
        where: { deviceToken_ownerKey: { deviceToken, ownerKey } },
        create: {
          deviceToken,
          ownerKey,
          devicePlatform,
          appVersion: appVersion ?? null,
          sessionId,
          userId,
          mobileDeviceId,
        },
        update: {
          devicePlatform,
          appVersion: appVersion ?? null,
          sessionId,
          userId,
          mobileDeviceId,
          updatedAt: new Date(),
        },
      });

      res.status(200).json({
        success: true,
        data: {
          id: pushToken.id,
          devicePlatform: pushToken.devicePlatform,
          appVersion: pushToken.appVersion,
          updatedAt: pushToken.updatedAt.toISOString(),
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * POST /api/v1/auth/assurance-verification
 * Stores the ID photo, the guided selfie set (3 poses) and credentials for manual review (D-4.2).
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
      const { tenantId, projectId } = req.fieldAgent!;
      for (const key of [body.idDocumentUrl, body.selfieFrontUrl, body.selfieLeftUrl, body.selfieRightUrl]) {
        assertProjectObjectKey(key, tenantId, projectId);
      }

      const updated = await prisma.fieldAgentSession.update({
        where: { id: sessionId },
        data: {
          idDocumentType: body.idDocumentType,
          idDocumentUrl: body.idDocumentUrl,
          selfieImageUrl: body.selfieFrontUrl,
          selfieLeftUrl: body.selfieLeftUrl,
          selfieRightUrl: body.selfieRightUrl,
          // D-4.2: a guided selfie set for manual review. No liveness check runs, so none is recorded.
          livenessPassed: false,
          livenessScore: null,
          livenessMetadata: body.selfieSet,
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
        summaryText: `Contractor submitted an ID photo (${body.idDocumentType}) and a guided selfie set (3 poses) for manual review.`,
        payload: {
          idDocumentType: body.idDocumentType,
          captureMethod: body.selfieSet.captureMethod,
        },
      });

      await markNotificationsActioned(
        prisma,
        updated.projectId,
        { kind: "IDENTITY_RESUBMITTED", fieldSessionId: sessionId },
        { sessionId, name: req.fieldAgent!.agentFullName },
      );

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
 * DEMO-ONLY ENDPOINT, mounted only when DEMO_MODE is on: links the mobile field agent directly
 * to the project matching their joinCode as APPROVED without ID/liveness verification.
 */
if (env.DEMO_MODE) {
  router.post(
    "/demo/skip-verification",
    demoRateLimit,
    optionalAuth,
    validateBody(DemoSkipVerificationRequestSchema),
    async (req: Request, res: Response, next: NextFunction) => {
      try {
        const result = await demoSkipVerificationMobile(
          req.body,
          req.fieldAgent?.sessionId,
        );
        res.status(200).json({ success: true, data: result });
      } catch (error) {
        next(error);
      }
    },
  );
}

export const authRoutes = router;
