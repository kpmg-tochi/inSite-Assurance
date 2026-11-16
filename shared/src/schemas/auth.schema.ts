import { z } from "zod";
import {
  ContractorAssuranceStatusEnum,
  IndependenceTierEnum,
  ProfessionalLicenseTypeEnum,
  UserRoleEnum,
} from "../enums";

/**
 * Web Portal Authentication (Monitor, Lender, Contractor)
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
  role: UserRoleEnum,
  organizationName: z.string().min(2).max(160),
  professionalLicenseType: ProfessionalLicenseTypeEnum.nullable().optional(), // e.g., 'QSRBN' or 'COREN'
  professionalLicenseNumber: z.string().max(64).optional(), // e.g., '3842' or 'R.49201'
});
export type WebRegisterRequest = z.infer<typeof WebRegisterRequestSchema>;

export const WebUserProfileSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  email: z.string().email(),
  role: UserRoleEnum,
  organizationId: z.string().uuid(),
  organizationName: z.string(),
  professionalLicenseType: ProfessionalLicenseTypeEnum.nullable(),
  professionalLicenseNumber: z.string().nullable(),
});
export type WebUserProfile = z.infer<typeof WebUserProfileSchema>;

export const WebAuthResponseSchema = z.object({
  accessToken: z.string(),
  user: WebUserProfileSchema,
});
export type WebAuthResponse = z.infer<typeof WebAuthResponseSchema>;

/**
 * Mobile Field Agent Onboarding via Role-Specific Project Join Code
 * Example codes: "LKK-402-INS" (Monitor Inspector), "LKK-402-COW" (Clerk of Works), "LKK-402-CON" (Contractor Engineer)
 * Also supports compact 6-char codes (e.g., "LKK402") when bound in the database.
 */
export const JoinProjectMobileRequestSchema = z.object({
  joinCode: z
    .string()
    .trim()
    .toUpperCase()
    .min(6, "Project Join Code must be at least 6 characters")
    .max(16),
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
  devicePublicKeyOrSecretHash: z.string().max(256).optional(),

  // Contractor Assurance Onboarding Fields (Optional for Monitor/Clerk, Required for Contractor)
  corenLicenseNumber: z.string().max(50).optional(),
  idDocumentType: z.string().max(120).optional(),
  idDocumentUrl: z.string().max(500).optional(),
  selfieImageUrl: z.string().max(500).optional(),
  livenessPassed: z.boolean().optional(),
  experienceSummary: z.string().max(1000).optional(),
});

export const LivenessPoseFrameSchema = z.object({
  yawDeg: z.number(),
  eyeOpenProb: z.number().min(0).max(1).optional(),
  capturedAt: z.string().datetime(),
});

export const LivenessVerificationSchema = z.object({
  isLive: z.boolean(),
  detectorEngine: z.enum(['MLKIT_ON_DEVICE', 'GUIDED_CAPTURE']).default('MLKIT_ON_DEVICE'),
  poses: z.object({
    front: LivenessPoseFrameSchema,
    left: LivenessPoseFrameSchema,
    right: LivenessPoseFrameSchema,
  }),
  sha256BundleHash: z.string().min(16).max(256),
});
export type LivenessVerification = z.infer<typeof LivenessVerificationSchema>;

export const SubmitAssuranceVerificationRequestSchema = z.object({
  projectId: z.string().uuid(),
  idDocumentType: z.string().min(2).max(120),
  idDocumentUrl: z.string().min(3).max(500),
  selfieFrontUrl: z.string().min(3).max(500),
  selfieLeftUrl: z.string().min(3).max(500),
  selfieRightUrl: z.string().min(3).max(500),
  livenessVerification: LivenessVerificationSchema,
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
  projectId: z.string().uuid(),
  projectName: z.string(),
  projectCodePrefix: z.string(),
  joinCodeUsed: z.string(),
  independenceTier: IndependenceTierEnum,
  agentFullName: z.string(),
  agentPhoneNumber: z.string(),
  deviceId: z.string(),
  assuranceStatus: ContractorAssuranceStatusEnum.optional(),
  corenLicenseNumber: z.string().optional(),
  livenessPassed: z.boolean().optional(),
});
export type FieldAgentSessionProfile = z.infer<
  typeof FieldAgentSessionProfileSchema
>;

/**
 * Contractor Assurance Review Request Schema
 */
export const ReviewContractorVerificationRequestSchema = z.object({
  decision: z.enum(['APPROVE', 'REJECT']),
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
  agentFullName: z.string(),
  agentPhoneNumber: z.string(),
  joinCodeUsed: z.string(),
  corenLicenseNumber: z.string().nullable().optional(),
  idDocumentType: z.string().nullable().optional(),
  idDocumentUrl: z.string().nullable().optional(),
  selfieImageUrl: z.string().nullable().optional(),
  livenessPassed: z.boolean(),
  livenessScore: z.number().nullable().optional(),
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
  independenceTier: IndependenceTierEnum,
});

export const DemoProjectWorkspaceSchema = z.object({
  id: z.string().uuid(),
  codePrefix: z.string(),
  name: z.string(),
  stateLocation: z.string(),
  lgaLocation: z.string().nullable().optional(),
  geofenceMode: z.enum(['RADIAL', 'LINEAR_CORRIDOR']),
  portfolioHealth: z.string(),
  joinCodes: z.array(DemoProjectJoinCodeSchema),
});
export type DemoProjectWorkspaceDto = z.infer<typeof DemoProjectWorkspaceSchema>;

export const DemoSkipVerificationRequestSchema = z.object({
  joinCode: z
    .string()
    .trim()
    .toUpperCase()
    .min(6, "Project Join Code must be at least 6 characters")
    .max(16),
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
