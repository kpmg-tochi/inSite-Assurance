import crypto from 'crypto';
import { Prisma, PrismaClient } from '@prisma/client';
import {
  FieldPersonaType,
  IssueJoinCodeRequest,
  JOIN_CODE_RANDOM_ALPHABET,
  JOIN_CODE_RANDOM_LENGTH,
  RoleOnboardingMode,
  RotateJoinCodeRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';

type Db = Prisma.TransactionClient | PrismaClient;

export function randomJoinCodeSegment(): string {
  let out = '';
  for (let i = 0; i < JOIN_CODE_RANDOM_LENGTH; i++) {
    out += JOIN_CODE_RANDOM_ALPHABET[crypto.randomInt(JOIN_CODE_RANDOM_ALPHABET.length)];
  }
  return out;
}

/** The role's join-code suffix, or a 3-character fallback derived from its code. */
export function joinCodeSuffixForRole(role: { codeSuffix: string | null; code: string }): string {
  const fromCode = role.code.replace(/[^A-Z0-9]/g, '').slice(0, 3);
  return (role.codeSuffix || fromCode || 'FLD').toUpperCase();
}

/**
 * Creates a join code for a role on a project. `code` is globally unique, so a random-segment
 * collision is retried.
 */
export async function createJoinCode(
  db: Db,
  params: {
    projectId: string;
    codePrefix: string;
    role: { id: string; code: string; codeSuffix: string | null };
    expiresAt?: Date | null;
    maxUses?: number | null;
    rotatedFromId?: string | null;
  }
) {
  const suffix = joinCodeSuffixForRole(params.role);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `${params.codePrefix}-${suffix}-${randomJoinCodeSegment()}`;
    const clash = await db.projectJoinCode.findUnique({ where: { code }, select: { id: true } });
    if (clash) continue;
    return db.projectJoinCode.create({
      data: {
        projectId: params.projectId,
        roleId: params.role.id,
        code,
        isActive: true,
        expiresAt: params.expiresAt ?? null,
        maxUses: params.maxUses ?? null,
        rotatedFromId: params.rotatedFromId ?? null,
      },
      include: { role: true },
    });
  }
  throw new AppError('Could not allocate a unique join code; try again', 503, 'JOIN_CODE_ALLOCATION_FAILED');
}

type JoinCodeRow = Prisma.ProjectJoinCodeGetPayload<{ include: { role: true } }>;

export function serializeJoinCode(jc: JoinCodeRow) {
  return {
    id: jc.id,
    projectId: jc.projectId,
    code: jc.code,
    roleId: jc.role.id,
    roleCode: jc.role.code,
    roleName: jc.role.name,
    fieldPersonaType: jc.role.fieldPersonaType as FieldPersonaType,
    assuranceWeight: jc.role.assuranceWeight,
    requiresIdentityAssurance: jc.role.requiresIdentityAssurance,
    roleOnboardingMode: jc.role.onboardingMode as RoleOnboardingMode,
    isActive: jc.isActive,
    expiresAt: jc.expiresAt ? jc.expiresAt.toISOString() : null,
    maxUses: jc.maxUses,
    useCount: jc.useCount,
    rotatedFromId: jc.rotatedFromId,
    createdAt: jc.createdAt.toISOString(),
  };
}

/**
 * Users who cannot edit the baseline (e.g. a main contractor holding mobilization:manage_roster)
 * may only see and manage codes for contractor-executor roles.
 */
function canManageAllPersonas(webUser: WebJwtPayload) {
  return hasWebPermission(webUser, 'projects:edit_baseline');
}

function assertMayManageRole(webUser: WebJwtPayload, fieldPersonaType: string) {
  if (!canManageAllPersonas(webUser) && fieldPersonaType !== 'CONTRACTOR_EXECUTOR') {
    throw new AppError(
      'You can only manage join codes for contractor field roles',
      403,
      'FORBIDDEN_PERMISSION'
    );
  }
}

/** Pre-provisioned roles sign in with an account and never get join codes (Phase 5). */
function assertRoleUsesJoinCodes(role: { name: string; onboardingMode: string }) {
  if (role.onboardingMode === 'PROVISIONED_ACCOUNT') {
    throw new AppError(
      `"${role.name}" is a pre-provisioned role: people in it sign in with their account, not a join code`,
      409,
      'ROLE_IS_PROVISIONED'
    );
  }
}

/**
 * Issues one active join code per active project for a role switched back to join codes, skipping
 * projects that already have an active code for it. Runs inside the caller's transaction.
 */
export async function issueJoinCodesForRoleOnAllProjects(
  tx: Prisma.TransactionClient,
  role: { id: string; code: string; codeSuffix: string | null; tenantId: string }
) {
  // Phase 6 adds project status; until then every project in the tenant is active.
  const projects = await tx.project.findMany({
    where: { tenantId: role.tenantId, joinCodes: { none: { roleId: role.id, isActive: true } } },
    select: { id: true, codePrefix: true },
  });
  const issued = [];
  for (const project of projects) {
    issued.push(await createJoinCode(tx, { projectId: project.id, codePrefix: project.codePrefix, role }));
  }
  return issued;
}

function actorName(webUser: WebJwtPayload) {
  return `${webUser.fullName} (${webUser.roleName})`;
}

export async function listProjectJoinCodes(projectId: string, webUser: WebJwtPayload) {
  const rows = await prisma.projectJoinCode.findMany({
    where: {
      projectId,
      ...(canManageAllPersonas(webUser) ? {} : { role: { fieldPersonaType: 'CONTRACTOR_EXECUTOR' } }),
    },
    include: { role: true },
    orderBy: [{ isActive: 'desc' }, { createdAt: 'desc' }],
  });
  return rows.map(serializeJoinCode);
}

export async function issueProjectJoinCode(
  projectId: string,
  webUser: WebJwtPayload,
  input: IssueJoinCodeRequest
) {
  const project = await prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { id: true, tenantId: true, codePrefix: true },
  });
  const role = await prisma.role.findFirst({
    where: { id: input.roleId, tenantId: project.tenantId, surface: { in: ['MOBILE', 'BOTH'] } },
  });
  if (!role) {
    throw new AppError('Mobile role not found in this tenant', 404, 'ROLE_NOT_FOUND');
  }
  assertRoleUsesJoinCodes(role);
  assertMayManageRole(webUser, role.fieldPersonaType);

  const created = await prisma.$transaction(async (tx) => {
    const jc = await createJoinCode(tx, {
      projectId,
      codePrefix: project.codePrefix,
      role,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      maxUses: input.maxUses ?? null,
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'JOIN_CODE_ISSUED',
      summaryText: `Issued join code ${jc.code} for role "${role.name}".`,
      payload: {
        joinCodeId: jc.id,
        code: jc.code,
        roleId: role.id,
        expiresAt: jc.expiresAt?.toISOString() ?? null,
        maxUses: jc.maxUses,
      },
    });
    return jc;
  });
  return serializeJoinCode(created);
}

/** Deactivates a code and issues a replacement for the same role. Existing sessions are unaffected. */
export async function rotateProjectJoinCode(
  projectId: string,
  joinCodeId: string,
  webUser: WebJwtPayload,
  input: RotateJoinCodeRequest
) {
  const existing = await prisma.projectJoinCode.findFirst({
    where: { id: joinCodeId, projectId },
    include: { role: true, project: { select: { codePrefix: true } } },
  });
  if (!existing) {
    throw new AppError('Join code not found', 404, 'JOIN_CODE_NOT_FOUND');
  }
  assertRoleUsesJoinCodes(existing.role);
  assertMayManageRole(webUser, existing.role.fieldPersonaType);

  const created = await prisma.$transaction(async (tx) => {
    await tx.projectJoinCode.update({ where: { id: existing.id }, data: { isActive: false } });
    const jc = await createJoinCode(tx, {
      projectId,
      codePrefix: existing.project.codePrefix,
      role: existing.role,
      expiresAt:
        input.expiresAt !== undefined
          ? input.expiresAt
            ? new Date(input.expiresAt)
            : null
          : existing.expiresAt,
      maxUses: input.maxUses !== undefined ? input.maxUses : existing.maxUses,
      rotatedFromId: existing.id,
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'JOIN_CODE_ROTATED',
      summaryText: `Rotated join code for role "${existing.role.name}": ${existing.code} deactivated, ${jc.code} issued.`,
      payload: {
        previousJoinCodeId: existing.id,
        previousCode: existing.code,
        joinCodeId: jc.id,
        code: jc.code,
        roleId: existing.role.id,
      },
    });
    return jc;
  });
  return serializeJoinCode(created);
}
