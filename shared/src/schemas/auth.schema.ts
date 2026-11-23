import { z } from "zod";
import { JOIN_CODE_EXAMPLE, JOIN_CODE_REGEX } from "../joinCodes";
import {
  ConstructionPhaseEnum,
  ContractorAssuranceStatusEnum,
  FieldPersonaTypeEnum,
  FieldSessionOriginEnum,
  GeofenceModeEnum,
  OrganizationCategoryEnum,
  ReportingCadenceEnum,
} from "../enums";
import { CredentialRequirementEnum, RegistrationBodyOptionSchema } from "./credentials.schema";
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
  /** Phase 12: a code from the tenant's registration bodies (checked by the server). */
  professionalRegistrationBodyCode: z.string().trim().max(16).nullable().optional(),
  professionalRegistrationNumber: z.string().trim().max(64).optional(),
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
  professionalRegistrationBodyCode: z.string().nullable(),
  professionalRegistrationNumber: z.string().nullable(),
  /** Phase 12: the tenant-level certifier policy (a project type may override it per project). */
  certifierRegistrationRequirement: CredentialRequirementEnum.default('REQUIRED'),
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

/**
 * Mobile Field Agent Onboarding via Role-Specific Project Join Code
 */
export const JoinProjectMobileRequestSchema = z.object({
  joinCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(JOIN_CODE_REGEX, `Join code must look like ${JOIN_CODE_EXAMPLE}`),
  agentFullName: z.string().min(2, "Full name is required").max(120),
  agentPhoneNumber: z
    .string()
    .min(10, "Enter a valid Nigerian or international phone number")
    .max(20),
  agentPin: z
    .string()
    .regex(/^\d{4,6}$/, "PIN must be 4 to 6 digits")
    .optional(),
  deviceId: z.string().min(4).max(128),
  deviceModel: z.string().max(128).optional(),
  deviceOs: z.string().max(64).optional(),
  /** Base64 raw Ed25519 public key (32 bytes) of the per-install signing key. */
  devicePublicKey: z.string().min(40).max(64).optional(),
  devicePublicKeyAlg: z.literal("ED25519").optional(),

  // Assurance onboarding fields (driven by Role.requiresIdentityAssurance). Identity images
  // arrive only through POST /auth/assurance-verification.
  // Phase 12: registration follows the project's fieldAssurance policy (enforced by the server).
  registrationNumber: z.string().trim().max(50).optional(),
  registrationBodyCode: z.string().trim().max(16).optional(),
  /** @deprecated Phase 12: old name of `registrationNumber`, accepted for one release. */
  corenLicenseNumber: z.string().max(50).optional(),
  idDocumentType: z.string().max(120).optional(),
  experienceSummary: z.string().max(1000).optional(),
});

/**
 * POST /auth/device-key
 * Registers the per-install signing key for a session that has none yet (one-time).
 */
export const RegisterDeviceKeyRequestSchema = z.object({
  devicePublicKey: z.string().min(40).max(64),
  devicePublicKeyAlg: z.literal("ED25519"),
});
export type RegisterDeviceKeyRequest = z.infer<typeof RegisterDeviceKeyRequestSchema>;

/**
 * D-4.2: the identity check is a guided three-pose selfie set plus an ID photo, reviewed by a
 * person. The app does not detect liveness and sends no liveness result; only the capture times.
 */
export const GuidedSelfieSetSchema = z.object({
  captureMethod: z.literal("GUIDED_SELFIE"),
  frontCapturedAt: z.string().datetime(),
  leftCapturedAt: z.string().datetime(),
  rightCapturedAt: z.string().datetime(),
});
export type GuidedSelfieSet = z.infer<typeof GuidedSelfieSetSchema>;

export const SubmitAssuranceVerificationRequestSchema = z.object({
  projectId: z.string().uuid(),
  idDocumentType: z.string().min(2).max(120),
  idDocumentUrl: z.string().min(3).max(500),
  selfieFrontUrl: z.string().min(3).max(500),
  selfieLeftUrl: z.string().min(3).max(500),
  selfieRightUrl: z.string().min(3).max(500),
  selfieSet: GuidedSelfieSetSchema,
  /**
   * Phase 12: optional here; the server requires a number only when the project's fieldAssurance
   * policy is REQUIRED, and ignores it when HIDDEN.
   */
  registrationNumber: z.string().trim().min(2).max(50).optional(),
  registrationBodyCode: z.string().trim().max(16).optional(),
  /** @deprecated Phase 12: old name of `registrationNumber`, accepted for one release. */
  corenLicenseNumber: z.string().trim().min(2).max(50).optional(),
  experienceSummary: z.string().min(5).max(1000),
});
export type SubmitAssuranceVerificationRequest = z.infer<
  typeof SubmitAssuranceVerificationRequestSchema
>;
export type JoinProjectMobileRequest = z.infer<
  typeof JoinProjectMobileRequestSchema
>;

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

/** The contractor package a field session works for (Phase 6), when it is bound to one. */
export const SessionContractorSchema = z.object({
  projectContractorId: z.string().uuid(),
  organizationName: z.string(),
  tradeCategory: z.string(),
  tradeCode: z.string(),
  isMainContractor: z.boolean(),
});
export type SessionContractor = z.infer<typeof SessionContractorSchema>;

export const FieldAgentSessionProfileSchema = z.object({
  sessionId: z.string().uuid(),
  tenantId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectName: z.string(),
  projectCodePrefix: z.string(),
  joinCodeUsed: z.string(),
  origin: FieldSessionOriginEnum.default("JOIN_CODE"),
  roleId: z.string().uuid(),
  roleCode: z.string(),
  roleName: z.string(),
  fieldPersonaType: FieldPersonaTypeEnum,
  assuranceWeight: z.number(),
  requiresIdentityAssurance: z.boolean(),
  permissions: z.array(z.string()).default([]),
  agentFullName: z.string(),
  agentPhoneNumber: z.string(),
  deviceId: z.string(),
  assuranceStatus: ContractorAssuranceStatusEnum.optional(),
  registrationNumber: z.string().optional(),
  registrationBodyCode: z.string().optional(),
  livenessPassed: z.boolean().optional(),
  contractor: SessionContractorSchema.nullable().optional(),
  tenantBranding: MobileTenantBrandingSchema.optional(),
});
export type FieldAgentSessionProfile = z.infer<
  typeof FieldAgentSessionProfileSchema
>;

/**
 * Assurance Verification Review Request Schema
 */
export const ReviewContractorVerificationRequestSchema = z.object({
  decision: z.enum(["APPROVE", "REJECT"]),
  remarks: z.string().max(500).optional(),
});
export type ReviewContractorVerificationRequest = z.infer<
  typeof ReviewContractorVerificationRequestSchema
>;

export const ContractorVerificationRecordDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  projectCodePrefix: z.string(),
  projectName: z.string(),
  /** The session's contractor organisation (Phase 6), or the main contractor for project-wide sessions. */
  organizationName: z.string(),
  tradeCode: z.string().nullable().optional(),
  roleId: z.string().uuid(),
  roleName: z.string(),
  fieldPersonaType: FieldPersonaTypeEnum,
  agentFullName: z.string(),
  agentPhoneNumber: z.string(),
  joinCodeUsed: z.string(),
  /** Phase 12: null when none was given (policy OPTIONAL or HIDDEN). */
  registrationNumber: z.string().nullable().optional(),
  registrationBodyCode: z.string().nullable().optional(),
  registrationBodyName: z.string().nullable().optional(),
  idDocumentType: z.string().nullable().optional(),
  /** Short-lived signed URLs for the reviewer (null for missing or legacy values). */
  idDocumentUrl: z.string().nullable().optional(),
  selfieImageUrl: z.string().nullable().optional(),
  selfieLeftUrl: z.string().nullable().optional(),
  selfieRightUrl: z.string().nullable().optional(),
  /** True only if a real liveness check ran. The guided selfie set never sets it (D-4.2). */
  livenessPassed: z.boolean(),
  experienceSummary: z.string().nullable().optional(),
  assuranceStatus: ContractorAssuranceStatusEnum,
  deviceId: z.string().optional(),
  deviceModel: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  submittedAt: z.string(),
  reviewedAt: z.string().nullable().optional(),
  reviewedByUserName: z.string().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
});
export type ContractorVerificationRecordDto = z.infer<
  typeof ContractorVerificationRecordDtoSchema
>;

/**
 * Demo-only Project Catalog & Verification Bypass Schemas
 */
export const DemoProjectJoinCodeSchema = z.object({
  code: z.string(),
  roleId: z.string().uuid(),
  roleCode: z.string(),
  roleName: z.string(),
  fieldPersonaType: FieldPersonaTypeEnum,
  assuranceWeight: z.number(),
  requiresIdentityAssurance: z.boolean(),
});

export const DemoProjectWorkspaceSchema = z.object({
  id: z.string().uuid(),
  codePrefix: z.string(),
  name: z.string(),
  stateLocation: z.string(),
  lgaLocation: z.string().nullable().optional(),
  geofenceMode: GeofenceModeEnum,
  joinCodes: z.array(DemoProjectJoinCodeSchema),
});
export type DemoProjectWorkspaceDto = z.infer<typeof DemoProjectWorkspaceSchema>;

export const DemoSkipVerificationRequestSchema = z.object({
  joinCode: z
    .string()
    .trim()
    .toUpperCase()
    .regex(JOIN_CODE_REGEX, `Join code must look like ${JOIN_CODE_EXAMPLE}`),
  sessionId: z.string().uuid().optional(),
  agentFullName: z.string().min(2).max(120).optional(),
  agentPhoneNumber: z.string().min(6).max(24).optional(),
  deviceId: z.string().min(4).max(128).optional(),
  deviceModel: z.string().max(128).optional(),
  deviceOs: z.string().max(64).optional(),
});
export type DemoSkipVerificationRequest = z.infer<
  typeof DemoSkipVerificationRequestSchema
>;

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
  origin: FieldSessionOriginEnum,
  roleId: z.string().uuid(),
  roleCode: z.string(),
  roleName: z.string(),
  fieldPersonaType: FieldPersonaTypeEnum,
  assuranceWeight: z.number(),
  permissions: z.array(z.string()),
  contractor: SessionContractorSchema.nullable().optional(),
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
  /**
   * BOQ items this session reports on. In a multi-prime project a contractor session only gets the
   * items assigned to its contractor.
   */
  boqItems: z.array(BaselineBoqItemSchema),
  holdPoints: z.array(BaselineBoqItemSchema),
  /** Phase 10. Absent in older packs: treat as ACTIVE_CONSTRUCTION. */
  constructionPhase: ConstructionPhaseEnum.optional(),
  /** Phase 14: streams this person owes and their checklist templates. Absent in older packs. */
  inspections: MobileInspectionPackSchema.optional(),
  /**
   * Phase 12: the project's resolved registration policy for identity assurance and the tenant's
   * active registration bodies. Absent in older packs: treat as REQUIRED with no body list.
   */
  fieldAssurance: z
    .object({
      registration: CredentialRequirementEnum,
      registrationBodies: z.array(RegistrationBodyOptionSchema),
    })
    .optional(),
});
export type MobileBaselinePack = z.infer<typeof MobileBaselinePackSchema>;

/**
 * The one local shape the app keeps per project, whichever way the person got onto it. The app maps
 * server responses through `fieldContextFromJoinSession` and `fieldContextFromProvisionedProject`
 * instead of hand-mapping fields in screens.
 */
export const FieldProjectContextSchema = z.object({
  projectId: z.string().uuid(),
  projectName: z.string(),
  projectCodePrefix: z.string(),
  origin: FieldSessionOriginEnum,
  /** Join-code sessions only; a provisioned session is created by the server on first use. */
  sessionId: z.string().uuid().nullable(),
  joinCodeUsed: z.string().nullable(),
  roleId: z.string().uuid(),
  roleCode: z.string().nullable(),
  roleName: z.string(),
  fieldPersonaType: FieldPersonaTypeEnum,
  assuranceWeight: z.number(),
  requiresIdentityAssurance: z.boolean(),
  permissions: z.array(z.string()),
  assuranceStatus: z.union([ContractorAssuranceStatusEnum, z.literal("NOT_SUBMITTED")]),
  rejectionReason: z.string().nullable(),
  /** Contractor package this session works for (Phase 6); null when project-wide. */
  contractor: SessionContractorSchema.nullable().optional(),
});
export type FieldProjectContext = z.infer<typeof FieldProjectContextSchema>;

export function fieldContextFromJoinSession(profile: FieldAgentSessionProfile): FieldProjectContext {
  return {
    projectId: profile.projectId,
    projectName: profile.projectName,
    projectCodePrefix: profile.projectCodePrefix,
    origin: "JOIN_CODE",
    sessionId: profile.sessionId,
    joinCodeUsed: profile.joinCodeUsed,
    roleId: profile.roleId,
    roleCode: profile.roleCode,
    roleName: profile.roleName,
    fieldPersonaType: profile.fieldPersonaType,
    assuranceWeight: profile.assuranceWeight,
    requiresIdentityAssurance: profile.requiresIdentityAssurance,
    permissions: profile.permissions ?? [],
    assuranceStatus: profile.assuranceStatus ?? "NOT_SUBMITTED",
    rejectionReason: null,
    contractor: profile.contractor ?? null,
  };
}

export function fieldContextFromProvisionedProject(
  project: MobileProjectSummary,
  role: MobileRoleSummary
): FieldProjectContext {
  return {
    projectId: project.id,
    projectName: project.name,
    projectCodePrefix: project.codePrefix,
    origin: "PROVISIONED_ACCOUNT",
    sessionId: null,
    joinCodeUsed: null,
    roleId: project.roleId,
    roleCode: role.id === project.roleId ? role.code : null,
    roleName: project.roleName,
    fieldPersonaType: project.fieldPersonaType,
    assuranceWeight: project.assuranceWeight,
    requiresIdentityAssurance: false,
    permissions: role.permissions,
    // The account is the identity (decision G).
    assuranceStatus: "APPROVED",
    rejectionReason: null,
  };
}
