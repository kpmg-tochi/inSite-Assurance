import { z } from 'zod';
import { PROFESSIONAL_LICENSE_META } from '../enums';

/**
 * Professional registration policy (Phase 12, decision N).
 *
 * Two subjects: `certifier` (IPC certification, direct milestone verification, retention
 * certification) and `fieldAssurance` (mobile identity assurance). Each resolves to REQUIRED (must
 * be on the profile / in the submission; blocks the action), OPTIONAL (shown, never blocks) or
 * HIDDEN (not shown, not sent, not printed).
 *
 * Resolution order: project type override → tenant setting → platform default REQUIRED (today's
 * behaviour, so tenants that never set a policy are unchanged). Turning registration off never
 * weakens permission checks or segregation of duties.
 */

export const CredentialRequirementEnum = z.enum(['REQUIRED', 'OPTIONAL', 'HIDDEN']);
export type CredentialRequirement = z.infer<typeof CredentialRequirementEnum>;

export const CredentialSubjectEnum = z.enum(['certifier', 'fieldAssurance']);
export type CredentialSubject = z.infer<typeof CredentialSubjectEnum>;

export const PLATFORM_DEFAULT_CREDENTIAL_REQUIREMENT: CredentialRequirement = 'REQUIRED';

export const CREDENTIAL_REQUIREMENT_META: Record<CredentialRequirement, { label: string; description: string }> = {
  REQUIRED: { label: 'Required', description: 'Must be given. Without it the person cannot act.' },
  OPTIONAL: { label: 'Optional', description: 'The field is shown and printed when given, but never blocks.' },
  HIDDEN: { label: 'Hidden', description: 'Not asked for, not sent and not printed.' },
};

export const CREDENTIAL_SUBJECT_META: Record<CredentialSubject, { label: string; description: string }> = {
  certifier: {
    label: 'Certifiers',
    description:
      'People who certify valuations, verify payment milestones or certify retention releases. Read from their user profile.',
  },
  fieldAssurance: {
    label: 'Field identity assurance',
    description: 'Field staff who complete identity assurance in the mobile app after joining with a code.',
  },
};

/** Stored on `Tenant.credentialPolicyJson`. An omitted subject falls back to the platform default. */
export const TenantCredentialPolicySchema = z.object({
  certifier: CredentialRequirementEnum.optional(),
  fieldAssurance: CredentialRequirementEnum.optional(),
});
export type TenantCredentialPolicy = z.infer<typeof TenantCredentialPolicySchema>;

/** `ProjectTypeConfig.credentials`: an omitted (or null) subject uses the tenant setting. */
export const ProjectTypeCredentialsConfigSchema = z.object({
  certifier: CredentialRequirementEnum.nullable().optional(),
  fieldAssurance: CredentialRequirementEnum.nullable().optional(),
});
export type ProjectTypeCredentialsConfig = z.infer<typeof ProjectTypeCredentialsConfigSchema>;

export const ResolvedCredentialPolicySchema = z.object({
  certifier: CredentialRequirementEnum,
  fieldAssurance: CredentialRequirementEnum,
});
export type ResolvedCredentialPolicy = z.infer<typeof ResolvedCredentialPolicySchema>;

export const CredentialPolicySourceEnum = z.enum(['PROJECT_TYPE', 'TENANT', 'PLATFORM_DEFAULT']);
export type CredentialPolicySource = z.infer<typeof CredentialPolicySourceEnum>;

/** Reads a stored tenant policy; anything unparseable counts as unset (platform default). */
export function parseTenantCredentialPolicy(raw: unknown): TenantCredentialPolicy {
  const parsed = TenantCredentialPolicySchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : {};
}

function projectTypeCredentials(projectTypeSnapshot: unknown): ProjectTypeCredentialsConfig {
  if (!projectTypeSnapshot || typeof projectTypeSnapshot !== 'object') return {};
  const config = (projectTypeSnapshot as Record<string, unknown>).config;
  if (!config || typeof config !== 'object') return {};
  const parsed = ProjectTypeCredentialsConfigSchema.safeParse((config as Record<string, unknown>).credentials ?? {});
  return parsed.success ? parsed.data : {};
}

/** Each subject's requirement and where it came from. */
export function resolveCredentialPolicyWithSource(
  tenantPolicy: unknown,
  projectTypeSnapshot?: unknown
): Record<CredentialSubject, { requirement: CredentialRequirement; source: CredentialPolicySource }> {
  const tenant = parseTenantCredentialPolicy(tenantPolicy);
  const type = projectTypeCredentials(projectTypeSnapshot);
  const one = (subject: CredentialSubject) => {
    const fromType = type[subject];
    if (fromType) return { requirement: fromType, source: 'PROJECT_TYPE' as const };
    const fromTenant = tenant[subject];
    if (fromTenant) return { requirement: fromTenant, source: 'TENANT' as const };
    return { requirement: PLATFORM_DEFAULT_CREDENTIAL_REQUIREMENT, source: 'PLATFORM_DEFAULT' as const };
  };
  return { certifier: one('certifier'), fieldAssurance: one('fieldAssurance') };
}

/**
 * The policy a project runs on. `projectTypeSnapshot` is `Project.projectTypeSnapshotJson` (null for
 * a project without a type); pass nothing for the tenant-level policy.
 */
export function resolveCredentialPolicy(tenantPolicy: unknown, projectTypeSnapshot?: unknown): ResolvedCredentialPolicy {
  const r = resolveCredentialPolicyWithSource(tenantPolicy, projectTypeSnapshot);
  return { certifier: r.certifier.requirement, fieldAssurance: r.fieldAssurance.requirement };
}

export interface CredentialFieldRules {
  /** Show the registration body and number fields. */
  visible: boolean;
  /** Refuse to continue without a number (and a body where a body is asked for). */
  required: boolean;
  label: string;
  helpText: string;
}

/**
 * One rule set for every form (web and mobile) and for the server's validation, so display and
 * enforcement cannot drift.
 */
export function credentialFieldRules(requirement: CredentialRequirement, subject: CredentialSubject = 'certifier'): CredentialFieldRules {
  const label = subject === 'certifier' ? 'Professional registration' : 'Professional registration number';
  if (requirement === 'HIDDEN') {
    return { visible: false, required: false, label, helpText: '' };
  }
  if (requirement === 'OPTIONAL') {
    return {
      visible: true,
      required: false,
      label: `${label} (optional)`,
      helpText:
        subject === 'certifier'
          ? 'Printed on certificates when given. Not needed to certify.'
          : 'Add it if you hold one. You can continue without it.',
    };
  }
  return {
    visible: true,
    required: true,
    label,
    helpText:
      subject === 'certifier'
        ? 'Needed to certify: it is printed on every certificate you sign.'
        : 'Needed to complete identity assurance on this project.',
  };
}

/**
 * Whether user profile forms show the registration fields: yes unless both subjects resolve to
 * HIDDEN for the whole tenant (the tenant setting and every project type's override).
 */
export function registrationProfileFieldVisible(tenantPolicy: unknown, projectTypeConfigs: unknown[] = []): boolean {
  const tenant = resolveCredentialPolicy(tenantPolicy);
  if (tenant.certifier !== 'HIDDEN' || tenant.fieldAssurance !== 'HIDDEN') return true;
  return projectTypeConfigs.some((config) => {
    const c = projectTypeCredentials({ config });
    return (c.certifier && c.certifier !== 'HIDDEN') || (c.fieldAssurance && c.fieldAssurance !== 'HIDDEN');
  });
}

// ---------------------------------------------------------------------------
// Registration bodies (tenant list; replaces the fixed Nigerian enum)
// ---------------------------------------------------------------------------

export const REGISTRATION_BODY_CODE_REGEX = /^[A-Z][A-Z0-9_]{1,15}$/;

export const RegistrationBodyDtoSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  fullName: z.string(),
  displayPrefix: z.string(),
  exampleNumber: z.string().nullable(),
  isArchived: z.boolean(),
  sortOrder: z.number().int(),
  /** Users whose profile names this body (archived instead of deleted while referenced). */
  userCount: z.number().int(),
});
export type RegistrationBodyDto = z.infer<typeof RegistrationBodyDtoSchema>;

/** What forms and the mobile pack need to offer a body. */
export const RegistrationBodyOptionSchema = z.object({
  code: z.string(),
  fullName: z.string(),
  displayPrefix: z.string(),
  exampleNumber: z.string().nullable(),
});
export type RegistrationBodyOption = z.infer<typeof RegistrationBodyOptionSchema>;

export const SaveRegistrationBodyRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(REGISTRATION_BODY_CODE_REGEX, 'Code: 2 to 16 capital letters, digits or underscores, e.g. QSRBN'),
  fullName: z.string().trim().min(3, 'Enter at least 3 characters').max(200),
  displayPrefix: z.string().trim().min(2, 'Enter at least 2 characters').max(60),
  exampleNumber: z.string().trim().max(40).nullable().optional(),
  isArchived: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(1000).optional(),
});
export type SaveRegistrationBodyRequest = z.infer<typeof SaveRegistrationBodyRequestSchema>;

/** The six bodies every tenant starts with (seed and tenant provisioning). */
export const DEFAULT_REGISTRATION_BODIES: Array<{ code: string; fullName: string; displayPrefix: string; exampleNumber: string; sortOrder: number }> =
  Object.values(PROFESSIONAL_LICENSE_META).map((m, i) => ({
    code: m.code,
    fullName: m.fullName,
    displayPrefix: m.displayPrefix,
    exampleNumber: m.exampleNumber,
    sortOrder: (i + 1) * 10,
  }));

// ---------------------------------------------------------------------------
// Settings DTOs
// ---------------------------------------------------------------------------

export const CredentialSettingsDtoSchema = z.object({
  /** As stored: an omitted subject uses the platform default (REQUIRED). */
  policy: TenantCredentialPolicySchema,
  resolved: ResolvedCredentialPolicySchema,
  /** User profile forms show the registration fields (see `registrationProfileFieldVisible`). */
  profileFieldVisible: z.boolean(),
  registrationBodies: z.array(RegistrationBodyDtoSchema),
});
export type CredentialSettingsDto = z.infer<typeof CredentialSettingsDtoSchema>;

/** null clears the tenant setting (back to the platform default, REQUIRED). */
export const UpdateCredentialPolicyRequestSchema = z.object({
  certifier: CredentialRequirementEnum.nullable(),
  fieldAssurance: CredentialRequirementEnum.nullable(),
});
export type UpdateCredentialPolicyRequest = z.infer<typeof UpdateCredentialPolicyRequestSchema>;

const ResolvedSubjectSchema = z.object({ requirement: CredentialRequirementEnum, source: CredentialPolicySourceEnum });

/** GET /projects/:projectId/credential-policy */
export const ProjectCredentialPolicyDtoSchema = z.object({
  projectId: z.string().uuid(),
  certifier: ResolvedSubjectSchema,
  fieldAssurance: ResolvedSubjectSchema,
  /** Active bodies of the tenant, for pickers. */
  registrationBodies: z.array(RegistrationBodyOptionSchema),
});
export type ProjectCredentialPolicyDto = z.infer<typeof ProjectCredentialPolicyDtoSchema>;

// ---------------------------------------------------------------------------
// Display of a stored registration (snapshots and profiles)
// ---------------------------------------------------------------------------

export interface RegistrationDisplayInput {
  /** Body code (e.g. QSRBN); may be null on a snapshot taken with the policy OPTIONAL. */
  bodyCode?: string | null;
  bodyName?: string | null;
  prefix?: string | null;
  number?: string | null;
}

/**
 * "QSRBN Reg. No. 3842", or null when there is no number (nothing about registration is printed).
 * Snapshots carry their own prefix so renamed or archived bodies print as they were.
 */
export function formatRegistration(r: RegistrationDisplayInput): string | null {
  const number = r.number?.trim();
  if (!number) return null;
  const prefix = r.prefix?.trim() || (r.bodyCode ? `${r.bodyCode} Reg. No.` : 'Reg. No.');
  return `${prefix} ${number}`;
}

/** Short form for audit actor names and chips: "QSRBN #3842", or null. */
export function formatRegistrationShort(r: RegistrationDisplayInput): string | null {
  const number = r.number?.trim();
  if (!number) return null;
  return r.bodyCode ? `${r.bodyCode} #${number}` : `Reg. #${number}`;
}
