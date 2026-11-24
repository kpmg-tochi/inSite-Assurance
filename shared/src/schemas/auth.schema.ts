import { z } from "zod";
import {
  ConstructionPhaseEnum,
  FieldPersonaTypeEnum,
  GeofenceModeEnum,
  OrganizationCategoryEnum,
  ProjectStatusEnum,
} from "../enums";
import { ProjectGeofenceSchema } from "./geofence.schema";
import { FacilityArchetypeEnum } from "./facility.schema";
import { SprintStatusEnum } from "./scope.schema";
import { ProjectStageSummarySchema } from "./projectOverview.schema";
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

// ---------------------------------------------------------------------------
// Redesign R5 (D-R5.3): baseline pack v2 for the visit app. Every assigned project is prepared, so
// the home screen can show project cards and geofence previews offline. Forms come from the R4
// field pack (`/visits/field-pack`), not from here. Permissions come from the session.
// ---------------------------------------------------------------------------

export const MOBILE_BASELINE_PACK_VERSION = 2;

export const BaselineSprintSchema = z.object({
  id: z.string().uuid(),
  number: z.number().int(),
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  deliverables: z.string(),
  /** Derived on the server for its "today" in the project zone (`deriveSprintStatus`). */
  status: SprintStatusEnum,
  verificationOutcome: z.enum(["MET", "PARTLY_MET", "NOT_MET"]).nullable(),
});
export type BaselineSprint = z.infer<typeof BaselineSprintSchema>;

export const BaselineFacilityUnitSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  label: z.string(),
  facilityId: z.string().uuid(),
  facilityCode: z.string(),
  facilityName: z.string(),
  archetype: FacilityArchetypeEnum,
  plannedQuantity: z.number().nullable(),
  quantityUnit: z.string().nullable(),
  startSprintNumber: z.number().int().nullable(),
  endSprintNumber: z.number().int().nullable(),
  /** Progress observed by the latest accepted visit (R4d); null before any. */
  progressPct: z.number().nullable(),
  sortOrder: z.number().int(),
});
export type BaselineFacilityUnit = z.infer<typeof BaselineFacilityUnitSchema>;

export const BaselineOpenFindingSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string(),
  severity: z.enum(["MINOR", "MAJOR", "CRITICAL"]),
  facilityId: z.string().uuid().nullable(),
  facilityName: z.string().nullable(),
  unitId: z.string().uuid().nullable(),
  unitLabel: z.string().nullable(),
  /** YYYY-MM-DD in the project zone. */
  raisedDate: z.string(),
  /** Raised date + the type's `findingEscalationDays`: when it is escalated if still open. */
  escalatesOn: z.string(),
  recheckCount: z.number().int(),
});
export type BaselineOpenFinding = z.infer<typeof BaselineOpenFindingSchema>;

/** The open contractor-on-site milestone (spec: mobilisation day N of M). Null once done or absent. */
export const BaselineMobilisationSchema = z.object({
  milestoneId: z.string().uuid(),
  label: z.string(),
  /** Day 1: the kick-off held date (else the activation date), project zone. */
  startedOn: z.string().nullable(),
  /** The milestone due date; null when its anchor is not set yet. */
  deadline: z.string().nullable(),
  /** Derived for the server's today: PENDING, DUE or OVERDUE. */
  status: z.enum(["PENDING", "DUE", "OVERDUE"]),
});
export type BaselineMobilisation = z.infer<typeof BaselineMobilisationSchema>;

/** The offline baseline a device needs per project (v2, redesign R5; R5e removed the pre-R5 app's fields). */
export const MobileBaselinePackSchema = z.object({
  projectId: z.string().uuid(),
  name: z.string(),
  codePrefix: z.string(),
  stateLocation: z.string(),
  /** Redesign R5: 2 for packs with the fields below. Absent in older stored packs. */
  packVersion: z.number().int().optional(),
  /** ISO time the server built the pack. */
  generatedAt: z.string().optional(),
  projectStatus: ProjectStatusEnum,
  /** The project stage bar value (R6c); null for drafts. */
  stage: ProjectStageSummarySchema.nullable(),
  /** The primary beneficiary (the school), when set. */
  school: z.string().nullable(),
  /** The site address, when set. */
  address: z.string().nullable(),
  lgaLocation: z.string().nullable(),
  /** The project's contractor organisation (one per project, decision T); null before award. */
  contractorName: z.string().nullable(),
  /** ISO weekdays (1 = Monday) the project works; the phone skips the others when offering moves. */
  workWeekDays: z.array(z.number().int().min(1).max(7)),
  sprints: z.array(BaselineSprintSchema),
  facilityUnits: z.array(BaselineFacilityUnitSchema),
  openFindings: z.array(BaselineOpenFindingSchema),
  openDefectCount: z.number().int(),
  mobilisation: BaselineMobilisationSchema.nullable(),
  /** IANA zone of the project ("today", visit days). Absent in packs saved before Phase 4. */
  timezone: z.string().optional(),
  geofenceMode: GeofenceModeEnum,
  geofence: ProjectGeofenceSchema,
  /** Effective tolerance band outside the boundary (Phase 6). Absent in older packs: treat as 0. */
  geofenceToleranceMeters: z.number().int().optional(),
  /** Phase 10. Absent in older packs: treat as ACTIVE_CONSTRUCTION. */
  constructionPhase: ConstructionPhaseEnum.optional(),
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
