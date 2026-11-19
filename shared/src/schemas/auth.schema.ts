import { z } from "zod";
import { JOIN_CODE_EXAMPLE, JOIN_CODE_REGEX } from "../joinCodes";
import {
  ContractorAssuranceStatusEnum,
  FieldPersonaTypeEnum,
  OrganizationCategoryEnum,
  ProfessionalLicenseTypeEnum,
} from "../enums";
import { TenantDtoSchema } from "./rbac.schema";
import { ResolvedRatingLabelsSchema } from "../ratingLabels";

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
  professionalLicenseType: ProfessionalLicenseTypeEnum.nullable().optional(),
  professionalLicenseNumber: z.string().max(64).optional(),
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
  professionalLicenseType: ProfessionalLicenseTypeEnum.nullable(),
  professionalLicenseNumber: z.string().nullable(),
  mustChangePassword: z.boolean().default(false),
  /** Tenant display labels for evidence ratings, resolved against the defaults. */
  ratingLabels: ResolvedRatingLabelsSchema,
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
  corenLicenseNumber: z.string().min(2).max(50),
  experienceSummary: z.string().min(5).max(1000),
});
export type SubmitAssuranceVerificationRequest = z.infer<
  typeof SubmitAssuranceVerificationRequestSchema
>;
export type JoinProjectMobileRequest = z.infer<
  typeof JoinProjectMobileRequestSchema
>;

export const FieldAgentSessionProfileSchema = z.object({
  sessionId: z.string().uuid(),
  tenantId: z.string().uuid(),
  projectId: z.string().uuid(),
  projectName: z.string(),
  projectCodePrefix: z.string(),
  joinCodeUsed: z.string(),
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
  corenLicenseNumber: z.string().optional(),
  livenessPassed: z.boolean().optional(),
  ratingLabels: ResolvedRatingLabelsSchema.optional(),
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
  organizationName: z.string(),
  roleId: z.string().uuid(),
  roleName: z.string(),
  fieldPersonaType: FieldPersonaTypeEnum,
  agentFullName: z.string(),
  agentPhoneNumber: z.string(),
  joinCodeUsed: z.string(),
  corenLicenseNumber: z.string().nullable().optional(),
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
  geofenceMode: z.enum(["RADIAL", "LINEAR_CORRIDOR"]),
  portfolioHealth: z.string(),
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
