import { z } from "zod";
import {
  ConstructionPhaseEnum,
  FieldPersonaTypeEnum,
  GeofenceModeEnum,
  OrganizationCategoryEnum,
  ReportingCadenceEnum,
} from "../enums";
import { ProjectGeofenceSchema } from "./geofence.schema";
import { ProjectCadenceSettingsDtoSchema } from "./cadence.schema";
import { MobileInspectionPackSchema } from "./inspection.schema";
import { TenantDtoSchema } from "./rbac.schema";
import { ResolvedTerminologySchema } from "../terminology";

/**
 * Web Portal Authentication (Dynamic Multi-Tenant RBAC)
 */
export const WebLoginRequestSchema = z.object({
  email: z.string().email("Please provide a valid corporate email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});
export type WebLoginRequest = z.infer<typeof WebLoginRequestSchema>;

export const WebRegisterRequestSchema = z.object({
  fullName: z.string().min(2).max(120),
  email: z.string().email(),
  password: z.string().min(8),
  tenantSlug: z.string().min(2).max(80),
  roleId: z.string().uuid().optional(),
  roleCode: z.string().min(2).max(40).default("MONITOR").optional(),
  organizationName: z.string().min(2).max(160),
  organizationCategory: OrganizationCategoryEnum.default("OTHER").optional(),
});
export type WebRegisterRequest = z.infer<typeof WebRegisterRequestSchema>;

export const ChangePasswordRequestSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password"),
    newPassword: z
      .string()
      .min(10, "Password must be at least 10 characters")
      .max(128)
      .regex(/[A-Za-z]/, "Password must contain a letter")
      .regex(/[0-9]/, "Password must contain a number"),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: "New password must differ from the current one",
    path: ["newPassword"],
  });
export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const WebUserProfileSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  email: z.string().email(),
  isPlatformSuperAdmin: z.boolean().default(false),
  tenantId: z.string().uuid(),
  tenant: TenantDtoSchema,
  roleId: z.string().uuid(),
  roleCode: z.string(),
  roleName: z.string(),
  permissions: z.array(z.string()),
  organizationId: z.string().uuid(),
  organizationName: z.string(),
  organizationCategory: OrganizationCategoryEnum.default("OTHER"),
  mustChangePassword: z.boolean().default(false),
  /** Phase 11: tenant wording for domain terms (Lender, Tranche, IPC …), resolved against the defaults. */
  terminology: ResolvedTerminologySchema,
});
export type WebUserProfile = z.infer<typeof WebUserProfileSchema>;

export const WebAuthResponseSchema = z.object({
  accessToken: z.string(),
  user: WebUserProfileSchema,
});
export type WebAuthResponse = z.infer<typeof WebAuthResponseSchema>;

/** Tenant branding the mobile app applies once the tenant is known (Phase 6). */
export const MobileTenantBrandingSchema = z.object({
  tenantName: z.string(),
  logoUrl: z.string().nullable(),
  primaryColorHex: z.string(),
  currency: z.string(),
  /** Phase 11: tenant wording for domain terms; older payloads omit it (defaults apply). */
  terminology: ResolvedTerminologySchema.optional(),
});
export type MobileTenantBranding = z.infer<typeof MobileTenantBrandingSchema>;

// ---------------------------------------------------------------------------
// Phase 5: provisioned mobile accounts and multi-project mobile
// ---------------------------------------------------------------------------

const DevicePublicKeyFields = {
  deviceId: z.string().min(4).max(128),
  deviceModel: z.string().max(128).optional(),
  deviceOs: z.string().max(64).optional(),
  /** Base64 raw Ed25519 public key (32 bytes) of the per-install signing key. */
  devicePublicKey: z.string().min(40).max(64),
  devicePublicKeyAlg: z.literal("ED25519"),
};

/** POST /auth/mobile/login. Same credentials as the web portal. */
export const MobileLoginRequestSchema = z.object({
  email: z.string().email("Enter the email address of your account"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  ...DevicePublicKeyFields,
});
export type MobileLoginRequest = z.infer<typeof MobileLoginRequestSchema>;

/** The pre-provisioned role a signed-in user works under in the field. */
export const MobileRoleSummarySchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  fieldPersonaType: FieldPersonaTypeEnum,
  assuranceWeight: z.number(),
  permissions: z.array(z.string()),
});
export type MobileRoleSummary = z.infer<typeof MobileRoleSummarySchema>;

export const MobileAccountProfileSchema = z.object({
  userId: z.string().uuid(),
  tenantId: z.string().uuid(),
  fullName: z.string(),
  email: z.string().email(),
  phoneNumber: z.string().nullable(),
  organizationName: z.string(),
  mustChangePassword: z.boolean(),
  /** The MobileDevice row this token is bound to. */
  mobileDeviceId: z.string().uuid(),
  mobileRole: MobileRoleSummarySchema,
  tenantBranding: MobileTenantBrandingSchema.optional(),
});
export type MobileAccountProfile = z.infer<typeof MobileAccountProfileSchema>;

/**
 * A project the signed-in user can work on. The pending-sync count is local to the device and is
 * not part of this contract.
 */
export const MobileProjectSummarySchema = z.object({
  id: z.string().uuid(),
  codePrefix: z.string(),
  name: z.string(),
  stateLocation: z.string(),
  lgaLocation: z.string().nullable(),
  timezone: z.string(),
  geofenceMode: GeofenceModeEnum,
  roleId: z.string().uuid(),
  roleName: z.string(),
  fieldPersonaType: FieldPersonaTypeEnum,
  assuranceWeight: z.number(),
});
export type MobileProjectSummary = z.infer<typeof MobileProjectSummarySchema>;

export const MobileLoginResponseSchema = z.object({
  accessToken: z.string(),
  account: MobileAccountProfileSchema,
  projects: z.array(MobileProjectSummarySchema),
});
export type MobileLoginResponse = z.infer<typeof MobileLoginResponseSchema>;

/** GET /auth/mobile/projects/:projectId/session: the caller's field session on one project. */
export const FieldSessionSummarySchema = z.object({
  sessionId: z.string().uuid(),
  projectId: z.string().uuid(),
  roleId: z.string().uuid(),
  roleCode: z.string(),
  roleName: z.string(),
  fieldPersonaType: FieldPersonaTypeEnum,
  assuranceWeight: z.number(),
  permissions: z.array(z.string()),
});
export type FieldSessionSummary = z.infer<typeof FieldSessionSummarySchema>;

/** POST /auth/mobile/change-password returns a fresh token (other tokens are revoked). */
export const MobileChangePasswordResponseSchema = z.object({
  accessToken: z.string(),
  account: MobileAccountProfileSchema,
});
export type MobileChangePasswordResponse = z.infer<typeof MobileChangePasswordResponseSchema>;

const BaselineBoqItemSchema = z.object({
  id: z.string().uuid(),
  wbsCode: z.string(),
  section: z.string(),
  description: z.string(),
  unit: z.string(),
  totalQuantity: z.number(),
  budgetedCostNgn: z.number(),
  isHoldPoint: z.boolean(),
  holdPointInstruction: z.string().nullable(),
  cumulativeCertifiedPct: z.number(),
});

/** The offline baseline a device needs per project: geofence, BOQ, hold points and cadence. */
export const MobileBaselinePackSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string(),
  codePrefix: z.string(),
  stateLocation: z.string(),
  reportingCadence: ReportingCadenceEnum,
  /** IANA zone that defines the project's reporting day. Absent in packs saved before Phase 4. */
  timezone: z.string().optional(),
  /**
   * Phase 8: everything the app needs to compute the current period with the shared module.
   * Absent in packs saved before Phase 8: treat the cadence as daily with a Mon-Sat week.
   */
  cadence: ProjectCadenceSettingsDtoSchema.optional(),
  geofenceMode: GeofenceModeEnum,
  geofence: ProjectGeofenceSchema,
  /** Effective tolerance band outside the boundary (Phase 6). Absent in older packs: treat as 0. */
  geofenceToleranceMeters: z.number().int().optional(),
  /** BOQ items of the project. */
  boqItems: z.array(BaselineBoqItemSchema),
  holdPoints: z.array(BaselineBoqItemSchema),
  /** Phase 10. Absent in older packs: treat as ACTIVE_CONSTRUCTION. */
  constructionPhase: ConstructionPhaseEnum.optional(),
  /** Phase 14: streams this person owes and their checklist templates. Absent in older packs. */
  inspections: MobileInspectionPackSchema.optional(),
});
export type MobileBaselinePack = z.infer<typeof MobileBaselinePackSchema>;

/**
 * The one local shape the app keeps per project. The app maps server responses through
 * `fieldContextFromProvisionedProject` instead of hand-mapping fields in screens. Redesign R1d: a
 * provisioned account is the only way onto a project (no join codes, no identity check).
 */
export const FieldProjectContextSchema = z.object({
  projectId: z.string().uuid(),
  projectName: z.string(),
  projectCodePrefix: z.string(),
  /** Set once the server has created the session (on first use of the project). */
  sessionId: z.string().uuid().nullable(),
  roleId: z.string().uuid(),
  roleCode: z.string().nullable(),
  roleName: z.string(),
  fieldPersonaType: FieldPersonaTypeEnum,
  assuranceWeight: z.number(),
  permissions: z.array(z.string()),
});
export type FieldProjectContext = z.infer<typeof FieldProjectContextSchema>;

export function fieldContextFromProvisionedProject(
  project: MobileProjectSummary,
  role: MobileRoleSummary
): FieldProjectContext {
  return {
    projectId: project.id,
    projectName: project.name,
    projectCodePrefix: project.codePrefix,
    sessionId: null,
    roleId: project.roleId,
    roleCode: role.id === project.roleId ? role.code : null,
    roleName: project.roleName,
    fieldPersonaType: project.fieldPersonaType,
    assuranceWeight: project.assuranceWeight,
    permissions: role.permissions,
  };
}
