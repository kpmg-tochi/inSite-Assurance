import { Router, Request, Response, NextFunction } from "express";
import {
  ChangePasswordRequestSchema,
  MobileLoginRequestSchema,
  RegisterPushTokenSchema,
  WebLoginRequestSchema,
  WebRegisterRequestSchema,
} from "@insite/shared";
import { validateBody } from "../../middleware/validate.middleware";
import {
  requireAnyAuth,
  requireFieldSession,
  requireMobileUser,
  requireWebAuth,
} from "../../middleware/auth.middleware";
import { demoRateLimit, loginRateLimit } from "../../middleware/rateLimit.middleware";
import { prisma } from "../../config/prisma";
import { env } from "../../config/env";
import { AppError } from "../../middleware/error.middleware";
import { buildMobileInspectionPack } from "../inspections/inspectionPack.service";
import {
  changeMobileUserPassword,
  changeWebUserPassword,
  getMobileAccountAndProjects,
  getProjectBaselinePack,
  getWebUserProfileById,
  loginMobileUser,
  loginWebUser,
  logoutMobileUser,
  registerWebUser,
} from "./auth.service";

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

/** The offline baseline pack for one project, for a provisioned account that can see it. */
router.get(
  "/mobile/projects/:projectId/baseline",
  requireFieldSession,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      if (req.fieldAgent!.projectId !== req.params.projectId) {
        throw new AppError("Field Agent session is bound to a different project", 403, "PROJECT_MISMATCH");
      }
      const pack = await getProjectBaselinePack(req.fieldAgent!.projectId);
      // Phase 14: streams this session owes and its checklist templates.
      pack.inspections = await buildMobileInspectionPack({
        projectId: req.fieldAgent!.projectId,
        sessionId: req.fieldAgent!.sessionId,
        permissions: req.fieldAgent!.permissions,
      });
      res.json({ success: true, data: pack });
    } catch (error) {
      next(error);
    }
  },
);

/**
 * The caller's field session on one project (created on first use).
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
      res.json({
        success: true,
        data: {
          sessionId: fa.sessionId,
          projectId: fa.projectId,
          roleId: fa.roleId,
          roleCode: fa.roleCode,
          roleName: fa.roleName,
          fieldPersonaType: fa.fieldPersonaType,
          assuranceWeight: fa.assuranceWeight,
          permissions: fa.permissions,
        },
      });
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

      throw new AppError("Unrecognised session", 401, "UNAUTHORIZED");
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

export const authRoutes = router;
