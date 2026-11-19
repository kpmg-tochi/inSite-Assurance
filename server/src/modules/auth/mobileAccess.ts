import { Prisma } from '@prisma/client';
import {
  DEVICE_SIGNATURE_ALGORITHM,
  FieldPersonaType,
  GeofenceMode,
  MobileProjectSummary,
  MobileRoleSummary,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { syncParticipantForSession } from '../mobilization/participants.service';

/**
 * Phase 5: provisioned mobile accounts. A signed-in user works in the field under one
 * pre-provisioned role and gets one FieldAgentSession per (user, project, device), created lazily on
 * the first project-scoped request. The session stays the unit of field provenance, so evidence,
 * reports, chat and telemetry services do not change.
 *
 * This module must not import the auth middleware (the middleware imports it).
 */

const ROLE_WITH_PERMISSIONS = {
  include: { rolePermissions: { include: { permission: { select: { key: true } } } } },
} as const;

export const MOBILE_USER_INCLUDE = {
  tenant: {
    select: { status: true, evidenceRatingLabels: true, name: true, brandingConfig: true, defaultCurrency: true },
  },
  organization: { select: { name: true } },
  role: ROLE_WITH_PERMISSIONS,
  mobileRole: ROLE_WITH_PERMISSIONS,
} satisfies Prisma.UserInclude;

export type MobileUserRow = Prisma.UserGetPayload<{ include: typeof MOBILE_USER_INCLUDE }>;
type RoleRow = MobileUserRow['role'];

function isProvisionedMobileRole(role: {
  surface: string;
  onboardingMode: string;
} | null | undefined): boolean {
  return Boolean(role && role.surface !== 'WEB' && role.onboardingMode === 'PROVISIONED_ACCOUNT');
}

/**
 * The role a user works under on mobile: the separate mobile role if set and still provisioned,
 * otherwise the main role if it is itself a provisioned mobile role. The mode is checked on every
 * call, so switching a role back to join codes removes mobile access straight away.
 */
export function effectiveMobileRole(user: { role: RoleRow; mobileRole: RoleRow | null }): RoleRow | null {
  if (user.mobileRole && isProvisionedMobileRole(user.mobileRole)) return user.mobileRole;
  if (isProvisionedMobileRole(user.role)) return user.role;
  return null;
}

export function roleSummary(role: RoleRow): MobileRoleSummary {
  return {
    id: role.id,
    code: role.code,
    name: role.name,
    fieldPersonaType: role.fieldPersonaType as FieldPersonaType,
    assuranceWeight: role.assuranceWeight,
    permissions: role.rolePermissions.map((rp) => rp.permission.key),
  };
}

/**
 * Projects visible on mobile equal those visible on the web: assigned projects, or every tenant
 * project when the main role holds `projects:view_all_tenant`. Always limited to the user's own
 * tenant (a platform super admin gets no cross-tenant field access).
 * Only ACTIVE projects: drafts and archived projects are never live on mobile (Phase 6).
 */
export function mobileProjectVisibilityWhere(user: MobileUserRow): Prisma.ProjectWhereInput {
  const mainPermissions = user.role.rolePermissions.map((rp) => rp.permission.key);
  // Phase 7: a contractor-executor account does not see projects that switched contractor field
  // reporting off (no row means the default, which allows it).
  const contractorGate: Prisma.ProjectWhereInput =
    effectiveMobileRole(user)?.fieldPersonaType === 'CONTRACTOR_EXECUTOR'
      ? { NOT: { processConfig: { allowContractorFieldReporting: false } } }
      : {};
  if (mainPermissions.includes('projects:view_all_tenant')) {
    return { tenantId: user.tenantId, status: 'ACTIVE', ...contractorGate };
  }
  return { tenantId: user.tenantId, status: 'ACTIVE', userAssignments: { some: { userId: user.id } }, ...contractorGate };
}

export async function listMobileProjects(user: MobileUserRow): Promise<MobileProjectSummary[]> {
  const role = effectiveMobileRole(user);
  if (!role) return [];
  const projects = await prisma.project.findMany({
    where: mobileProjectVisibilityWhere(user),
    orderBy: { name: 'asc' },
    select: {
      id: true,
      codePrefix: true,
      name: true,
      stateLocation: true,
      lgaLocation: true,
      timezone: true,
      geofenceMode: true,
    },
  });
  return projects.map((p) => ({
    id: p.id,
    codePrefix: p.codePrefix,
    name: p.name,
    stateLocation: p.stateLocation ?? '',
    lgaLocation: p.lgaLocation,
    timezone: p.timezone,
    geofenceMode: p.geofenceMode as GeofenceMode,
    roleId: role.id,
    roleName: role.name,
    fieldPersonaType: role.fieldPersonaType as FieldPersonaType,
    assuranceWeight: role.assuranceWeight,
  }));
}

export async function isProjectVisibleOnMobile(user: MobileUserRow, projectId: string): Promise<boolean> {
  const found = await prisma.project.findFirst({
    where: { AND: [{ id: projectId }, mobileProjectVisibilityWhere(user)] },
    select: { id: true },
  });
  return Boolean(found);
}

export interface MobileDeviceRow {
  id: string;
  deviceId: string;
  deviceModel: string | null;
  deviceOs: string | null;
  publicKey: string;
  publicKeyAlg: string;
  publicKeyId: string;
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Finds or creates the provisioned session for (user, project, device). Idempotent under
 * concurrency: the unique constraint decides the winner and the losers read its row.
 * If the user's mobile role changed since the session was created, the session follows it (each
 * capture and report keeps its own role snapshot, so earlier provenance is unchanged).
 */
export async function findOrCreateProvisionedSession(params: {
  user: MobileUserRow;
  role: RoleRow;
  device: MobileDeviceRow;
  projectId: string;
}) {
  const { user, role, device, projectId } = params;
  const where = {
    userId_projectId_deviceId: { userId: user.id, projectId, deviceId: device.deviceId },
  };

  let session = await prisma.fieldAgentSession.findUnique({ where });
  if (!session) {
    // A contractor-side account works for its organisation's contractor package (Phase 6).
    const contractor =
      role.fieldPersonaType === 'CONTRACTOR_EXECUTOR'
        ? await prisma.projectContractor.findFirst({
            where: { projectId, organizationId: user.organizationId },
            select: { id: true },
          })
        : null;
    try {
      session = await prisma.$transaction(async (tx) => {
        const created = await tx.fieldAgentSession.create({
          data: {
            projectId,
            origin: 'PROVISIONED_ACCOUNT',
            userId: user.id,
            mobileDeviceId: device.id,
            projectContractorId: contractor?.id ?? null,
            roleId: role.id,
            roleNameSnapshot: role.name,
            fieldPersonaType: role.fieldPersonaType,
            assuranceWeight: role.assuranceWeight,
            agentFullName: user.fullName,
            agentPhoneNumber: user.phoneNumber ?? '',
            deviceId: device.deviceId,
            deviceModel: device.deviceModel,
            deviceOs: device.deviceOs,
            devicePublicKey: device.publicKey,
            devicePublicKeyAlg: device.publicKeyAlg || DEVICE_SIGNATURE_ALGORITHM,
            devicePublicKeyId: device.publicKeyId,
            devicePublicKeyAddedAt: new Date(),
            // Decision G: the account is the identity, so no assurance step.
            assuranceStatus: 'APPROVED',
            lastSyncAt: new Date(),
          },
        });
        await recordAuditEvent(tx, {
          projectId,
          actorType: 'FIELD_AGENT',
          actorId: created.id,
          actorDisplayName: `${user.fullName} (${role.name})`,
          action: 'FIELD_AGENT_JOINED',
          summaryText: `${user.fullName} started work on this project from a signed-in account as ${role.name}.`,
          payload: {
            origin: 'PROVISIONED_ACCOUNT',
            userId: user.id,
            roleId: role.id,
            roleName: role.name,
            mobileDeviceId: device.id,
            deviceId: device.deviceId,
          },
        });
        // Phase 8: the expected participant for this account is now registered and ready.
        await syncParticipantForSession(tx, created.id);
        return created;
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      session = await prisma.fieldAgentSession.findUnique({ where });
      if (!session) throw error;
    }
  }

  if (session.roleId !== role.id) {
    session = await prisma.fieldAgentSession.update({
      where: { id: session.id },
      data: {
        roleId: role.id,
        roleNameSnapshot: role.name,
        fieldPersonaType: role.fieldPersonaType,
        assuranceWeight: role.assuranceWeight,
      },
    });
  }
  return session;
}

/** Refuses with NO_MOBILE_ACCESS when the user has no pre-provisioned mobile role. */
export function requireEffectiveMobileRole(user: MobileUserRow): RoleRow {
  const role = effectiveMobileRole(user);
  if (!role) {
    throw new AppError(
      'Your account does not have mobile access. Ask your administrator to give you a mobile role, or join with a project code.',
      403,
      'NO_MOBILE_ACCESS'
    );
  }
  return role;
}
