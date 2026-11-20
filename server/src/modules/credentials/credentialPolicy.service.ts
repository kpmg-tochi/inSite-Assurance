import { Prisma } from '@prisma/client';
import {
  CredentialRequirement,
  CredentialSettingsDto,
  formatRegistrationShort,
  parseTenantCredentialPolicy,
  ProjectCredentialPolicyDto,
  registrationProfileFieldVisible,
  resolveCredentialPolicy,
  resolveCredentialPolicyWithSource,
  ResolvedCredentialPolicy,
  UpdateCredentialPolicyRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { getRequestMemo, setRequestMemo } from '../../utils/requestContext';
import { listRegistrationBodies, registrationBodyOptions } from './registrationBodies.service';

/**
 * Professional registration policy (Phase 12, decision N). Resolution: project type override →
 * tenant setting → platform default REQUIRED. This module is the only place the server decides
 * whether a registration is needed, what is snapshotted and what a "cannot act" reason says.
 * Permissions and segregation of duties are checked by the callers and never depend on it.
 */

type Db = Prisma.TransactionClient | typeof prisma;

type ResolvedWithSource = ReturnType<typeof resolveCredentialPolicyWithSource>;

/** The project's policy with the source of each subject. Memoised per request. */
export async function credentialPolicyWithSourceForProject(projectId: string, db: Db = prisma): Promise<ResolvedWithSource> {
  const key = `credentialPolicy:project:${projectId}`;
  if (db === prisma) {
    const cached = getRequestMemo<ResolvedWithSource>(key);
    if (cached) return cached;
  }
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { projectTypeSnapshotJson: true, tenant: { select: { credentialPolicyJson: true } } },
  });
  if (!project) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  const resolved = resolveCredentialPolicyWithSource(project.tenant.credentialPolicyJson, project.projectTypeSnapshotJson);
  if (db === prisma) setRequestMemo(key, resolved);
  return resolved;
}

export async function credentialPolicyForProject(projectId: string, db: Db = prisma): Promise<ResolvedCredentialPolicy> {
  const r = await credentialPolicyWithSourceForProject(projectId, db);
  return { certifier: r.certifier.requirement, fieldAssurance: r.fieldAssurance.requirement };
}

/** The tenant-level policy (no project type). */
export async function credentialPolicyForTenant(tenantId: string, db: Db = prisma): Promise<ResolvedCredentialPolicy> {
  const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { credentialPolicyJson: true } });
  return resolveCredentialPolicy(tenant?.credentialPolicyJson ?? {});
}

/** GET /projects/:projectId/credential-policy */
export async function getProjectCredentialPolicy(projectId: string): Promise<ProjectCredentialPolicyDto> {
  const resolved = await credentialPolicyWithSourceForProject(projectId);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { tenantId: true } });
  return {
    projectId,
    certifier: resolved.certifier,
    fieldAssurance: resolved.fieldAssurance,
    registrationBodies: await registrationBodyOptions(project.tenantId),
  };
}

export async function getCredentialSettings(tenantId: string): Promise<CredentialSettingsDto> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { credentialPolicyJson: true } });
  if (!tenant) throw new AppError('Tenant not found', 404, 'TENANT_NOT_FOUND');
  const types = await prisma.projectType.findMany({ where: { tenantId, isActive: true }, select: { configJson: true } });
  return {
    policy: parseTenantCredentialPolicy(tenant.credentialPolicyJson),
    resolved: resolveCredentialPolicy(tenant.credentialPolicyJson),
    profileFieldVisible: registrationProfileFieldVisible(
      tenant.credentialPolicyJson,
      types.map((t) => t.configJson)
    ),
    registrationBodies: await listRegistrationBodies(tenantId, true),
  };
}

/** PUT /credentials/policy (tenant:manage_settings). null clears a subject (platform default). */
export async function updateCredentialPolicy(webUser: WebJwtPayload, input: UpdateCredentialPolicyRequest): Promise<CredentialSettingsDto> {
  const tenantId = webUser.tenantId;
  const next = parseTenantCredentialPolicy({
    ...(input.certifier ? { certifier: input.certifier } : {}),
    ...(input.fieldAssurance ? { fieldAssurance: input.fieldAssurance } : {}),
  });
  await prisma.$transaction(async (tx) => {
    const before = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { credentialPolicyJson: true } });
    const previous = parseTenantCredentialPolicy(before.credentialPolicyJson);
    await tx.tenant.update({ where: { id: tenantId }, data: { credentialPolicyJson: next as unknown as Prisma.InputJsonValue } });
    const describe = (p: typeof next) =>
      `certifiers ${p.certifier ?? 'default (REQUIRED)'}, field assurance ${p.fieldAssurance ?? 'default (REQUIRED)'}`;
    await recordAuditEvent(tx, {
      tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'CREDENTIAL_POLICY_UPDATED',
      summaryText: `Set the professional registration policy: ${describe(next)} (was ${describe(previous)}).`,
      payload: { previous, next },
    });
  });
  return getCredentialSettings(tenantId);
}

// ---------------------------------------------------------------------------
// Certifier checks and snapshots
// ---------------------------------------------------------------------------

/** Copied onto a ValuationReport at certification; never taken from the request. */
export interface CertifierRegistrationSnapshot {
  certifierLicenseType: string | null;
  certifierLicenseNumber: string | null;
  certifierRegistrationBodyName: string | null;
  certifierRegistrationPrefix: string | null;
}

export const EMPTY_REGISTRATION_SNAPSHOT: CertifierRegistrationSnapshot = {
  certifierLicenseType: null,
  certifierLicenseNumber: null,
  certifierRegistrationBodyName: null,
  certifierRegistrationPrefix: null,
};

interface RegistrationProfile {
  professionalRegistrationBodyCode: string | null;
  professionalRegistrationNumber: string | null;
}

function hasRegistration(user: RegistrationProfile | null | undefined): boolean {
  return Boolean(user?.professionalRegistrationBodyCode && user?.professionalRegistrationNumber?.trim());
}

/** Reason the viewer cannot certify for lack of a registration, or null. Used by `canAct` gates. */
export function certifierCannotActReason(requirement: CredentialRequirement, user: RegistrationProfile | null | undefined, verb = 'certify'): string | null {
  if (requirement !== 'REQUIRED' || hasRegistration(user)) return null;
  return `Add your professional registration (body and number) to your profile to ${verb}.`;
}

/**
 * Checks the certifier against the policy and returns what to store. REQUIRED: a body and number
 * must be on the profile (422 CERTIFIER_LICENCE_MISSING). OPTIONAL: copied when present. HIDDEN:
 * nothing is copied or printed.
 */
export async function assertCertifierCredentials(
  db: Db,
  params: { userId: string; tenantId: string; requirement: CredentialRequirement; verb?: string }
): Promise<{ fullName: string; snapshot: CertifierRegistrationSnapshot; actorDisplayName: string }> {
  const user = await db.user.findUniqueOrThrow({
    where: { id: params.userId },
    select: { fullName: true, professionalRegistrationBodyCode: true, professionalRegistrationNumber: true },
  });
  const verb = params.verb ?? 'certifying';
  if (params.requirement === 'REQUIRED' && !hasRegistration(user)) {
    throw new AppError(
      `Your profile has no professional registration. Add your registration body and number before ${verb}.`,
      422,
      'CERTIFIER_LICENCE_MISSING'
    );
  }
  const number = user.professionalRegistrationNumber?.trim() || null;
  let snapshot = EMPTY_REGISTRATION_SNAPSHOT;
  if (params.requirement !== 'HIDDEN' && number) {
    const code = user.professionalRegistrationBodyCode || null;
    const body = code
      ? await db.professionalRegistrationBody.findUnique({
          where: { tenantId_code: { tenantId: params.tenantId, code } },
          select: { fullName: true, displayPrefix: true },
        })
      : null;
    snapshot = {
      certifierLicenseType: code,
      certifierLicenseNumber: number,
      certifierRegistrationBodyName: body?.fullName ?? null,
      certifierRegistrationPrefix: body?.displayPrefix ?? (code ? `${code} Reg. No.` : null),
    };
  }
  return { fullName: user.fullName, snapshot, actorDisplayName: certifierActorDisplayName(user.fullName, snapshot) };
}

/** "Jane Doe (QSRBN #3842)", or just the name when no registration was snapshotted. */
export function certifierActorDisplayName(fullName: string, snapshot: CertifierRegistrationSnapshot): string {
  const reg = formatRegistrationShort({ bodyCode: snapshot.certifierLicenseType, number: snapshot.certifierLicenseNumber });
  return reg ? `${fullName} (${reg})` : fullName;
}

// ---------------------------------------------------------------------------
// Field identity assurance
// ---------------------------------------------------------------------------

/**
 * What an assurance submission stores for registration. REQUIRED: a number is needed (422
 * REGISTRATION_NUMBER_REQUIRED). OPTIONAL: kept when given. HIDDEN: anything sent is dropped. A
 * body code, when kept, must be one of the tenant's active bodies.
 */
export async function fieldAssuranceRegistration(
  db: Db,
  params: { tenantId: string; requirement: CredentialRequirement; registrationNumber?: string | null; registrationBodyCode?: string | null }
): Promise<{ registrationNumber: string | null; registrationBodyCode: string | null }> {
  if (params.requirement === 'HIDDEN') return { registrationNumber: null, registrationBodyCode: null };
  const number = params.registrationNumber?.trim() || null;
  if (params.requirement === 'REQUIRED' && !number) {
    throw new AppError('Enter your professional registration number.', 422, 'REGISTRATION_NUMBER_REQUIRED');
  }
  const code = number ? params.registrationBodyCode?.trim().toUpperCase() || null : null;
  if (code) await assertRegistrationBodyCode(db, params.tenantId, code);
  return { registrationNumber: number, registrationBodyCode: code };
}

/** 422 unless `code` is one of the tenant's active registration bodies. */
export async function assertRegistrationBodyCode(db: Db, tenantId: string, code: string): Promise<void> {
  const body = await db.professionalRegistrationBody.findUnique({
    where: { tenantId_code: { tenantId, code } },
    select: { isArchived: true },
  });
  if (!body || body.isArchived) {
    throw new AppError(`"${code}" is not one of this workspace's registration bodies.`, 422, 'REGISTRATION_BODY_UNKNOWN');
  }
}

/**
 * Normalises registration fields from a user form. Only a changed code is checked against the
 * active list, so a user keeps a body that was archived later.
 */
export async function normaliseProfileRegistration(
  db: Db,
  tenantId: string,
  input: { code?: string | null; number?: string | null },
  current: RegistrationProfile | null = null
): Promise<Partial<RegistrationProfile>> {
  const out: Partial<RegistrationProfile> = {};
  if (input.code !== undefined) {
    const code = input.code?.trim().toUpperCase() || null;
    if (code && code !== current?.professionalRegistrationBodyCode) await assertRegistrationBodyCode(db, tenantId, code);
    out.professionalRegistrationBodyCode = code;
  }
  if (input.number !== undefined) out.professionalRegistrationNumber = input.number?.trim() || null;
  return out;
}
