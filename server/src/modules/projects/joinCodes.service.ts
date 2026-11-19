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
import { getProcessConfig } from '../process/processConfig.service';

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

export const JOIN_CODE_INCLUDE = {
  role: true,
  projectContractor: { include: { organization: { select: { name: true } } } },
} satisfies Prisma.ProjectJoinCodeInclude;

/**
 * Creates a join code for a role on a project. `code` is globally unique, so a random-segment
 * collision is retried.
 *
 * With a contractor, the code binds sessions to that `ProjectContractor` (Phase 6). The trade code
 * is part of the code (`{prefix}-{suffix}-{tradeCode}-{random}`) when the project has more than one
 * contractor, so people can tell the codes apart.
 */
export async function createJoinCode(
  db: Db,
  params: {
    projectId: string;
    codePrefix: string;
    role: { id: string; code: string; codeSuffix: string | null };
    contractor?: { id: string; tradeCode: string } | null;
    includeTradeCode?: boolean;
    expiresAt?: Date | null;
    maxUses?: number | null;
    rotatedFromId?: string | null;
  }
) {
  const suffix = joinCodeSuffixForRole(params.role);
  const trade = params.contractor && params.includeTradeCode ? `${params.contractor.tradeCode}-` : '';
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = `${params.codePrefix}-${suffix}-${trade}${randomJoinCodeSegment()}`;
    const clash = await db.projectJoinCode.findUnique({ where: { code }, select: { id: true } });
    if (clash) continue;
    return db.projectJoinCode.create({
      data: {
        projectId: params.projectId,
        roleId: params.role.id,
        projectContractorId: params.contractor?.id ?? null,
        code,
        isActive: true,
        expiresAt: params.expiresAt ?? null,
        maxUses: params.maxUses ?? null,
        rotatedFromId: params.rotatedFromId ?? null,
      },
      include: JOIN_CODE_INCLUDE,
    });
  }
  throw new AppError('Could not allocate a unique join code; try again', 503, 'JOIN_CODE_ALLOCATION_FAILED');
}

type JoinCodeRow = Prisma.ProjectJoinCodeGetPayload<{ include: typeof JOIN_CODE_INCLUDE }>;

type JoinCodeRole = { id: string; code: string; codeSuffix: string | null; fieldPersonaType: string };
type FieldContractor = { id: string; tradeCode: string; allowFieldReporting: boolean };

/**
 * The codes a role needs on a project: one per field-reporting contractor for a contractor-executor
 * role when the project has contractors, otherwise one project-wide code.
 */
export function joinCodeTargetsForRole(
  role: JoinCodeRole,
  contractors: FieldContractor[]
): Array<{ contractor: { id: string; tradeCode: string } | null; includeTradeCode: boolean }> {
  if (role.fieldPersonaType !== 'CONTRACTOR_EXECUTOR' || contractors.length === 0) {
    return [{ contractor: null, includeTradeCode: false }];
  }
  const includeTradeCode = contractors.length > 1;
  return contractors
    .filter((c) => c.allowFieldReporting)
    .map((c) => ({ contractor: { id: c.id, tradeCode: c.tradeCode }, includeTradeCode }));
}

/**
 * Issues the missing active codes for the given roles on one project, skipping any
 * (role, contractor) that already has an active code. Runs inside the caller's transaction.
 */
export async function issueMissingJoinCodes(
  tx: Prisma.TransactionClient,
  project: { id: string; codePrefix: string },
  inputRoles: JoinCodeRole[]
) {
  let roles = inputRoles;
  // Phase 7: with contractor field reporting off for the project, no contractor-executor codes.
  if (!(await getProcessConfig(project.id, tx)).allowContractorFieldReporting) {
    roles = roles.filter((r) => r.fieldPersonaType !== 'CONTRACTOR_EXECUTOR');
  }
  const contractors = await tx.projectContractor.findMany({
    where: { projectId: project.id },
    select: { id: true, tradeCode: true, allowFieldReporting: true },
    orderBy: [{ isMainContractor: 'desc' }, { createdAt: 'asc' }],
  });
  const active = await tx.projectJoinCode.findMany({
    where: { projectId: project.id, isActive: true },
    select: { roleId: true, projectContractorId: true },
  });
  const has = new Set(active.map((a) => `${a.roleId}:${a.projectContractorId ?? ''}`));
  const issued = [];
  for (const role of roles) {
    for (const target of joinCodeTargetsForRole(role, contractors)) {
      if (has.has(`${role.id}:${target.contractor?.id ?? ''}`)) continue;
      issued.push(
        await createJoinCode(tx, {
          projectId: project.id,
          codePrefix: project.codePrefix,
          role,
          contractor: target.contractor,
          includeTradeCode: target.includeTradeCode,
        })
      );
    }
  }
  return issued;
}

/**
 * Keeps contractor codes in step with the contractor list on a live project: deactivates codes of
 * contractors whose field reporting is off and issues codes for new field-reporting contractors
 * (for contractor roles already issued on the project).
 */
export async function reconcileContractorJoinCodes(
  tx: Prisma.TransactionClient,
  project: { id: string; tenantId: string; codePrefix: string }
) {
  await tx.projectJoinCode.updateMany({
    where: { projectId: project.id, isActive: true, projectContractor: { allowFieldReporting: false } },
    data: { isActive: false },
  });
  const roles = await tx.role.findMany({
    where: {
      tenantId: project.tenantId,
      surface: { in: ['MOBILE', 'BOTH'] },
      onboardingMode: 'JOIN_CODE',
      fieldPersonaType: 'CONTRACTOR_EXECUTOR',
      joinCodes: { some: { projectId: project.id } },
    },
  });
  return issueMissingJoinCodes(tx, project, roles);
}

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
    projectContractorId: jc.projectContractorId,
    contractorName: jc.projectContractor?.organization.name ?? null,
    tradeCode: jc.projectContractor?.tradeCode ?? null,
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
 * Issues the missing active codes for a role switched back to join codes on every active project.
 * Runs inside the caller's transaction.
 */
export async function issueJoinCodesForRoleOnAllProjects(
  tx: Prisma.TransactionClient,
  role: { id: string; code: string; codeSuffix: string | null; tenantId: string; fieldPersonaType: string }
) {
  // Live projects only: drafts get codes at activation, archived projects get none.
  const projects = await tx.project.findMany({
    where: { tenantId: role.tenantId, status: 'ACTIVE' },
    select: { id: true, codePrefix: true },
  });
  const issued = [];
  for (const project of projects) {
    issued.push(...(await issueMissingJoinCodes(tx, project, [role])));
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
    include: JOIN_CODE_INCLUDE,
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
    select: { id: true, tenantId: true, codePrefix: true, status: true },
  });
  if (project.status !== 'ACTIVE') {
    throw new AppError('Join codes are issued when the project is set active', 409, 'PROJECT_NOT_ACTIVE');
  }
  const role = await prisma.role.findFirst({
    where: { id: input.roleId, tenantId: project.tenantId, surface: { in: ['MOBILE', 'BOTH'] } },
  });
  if (!role) {
    throw new AppError('Mobile role not found in this tenant', 404, 'ROLE_NOT_FOUND');
  }
  assertRoleUsesJoinCodes(role);
  assertMayManageRole(webUser, role.fieldPersonaType);
  if (role.fieldPersonaType === 'CONTRACTOR_EXECUTOR' && !(await getProcessConfig(projectId)).allowContractorFieldReporting) {
    throw new AppError('Contractor field reporting is off for this project', 409, 'CONTRACTOR_FIELD_REPORTING_DISABLED');
  }

  // Contractor-executor codes bind to one contractor when the project has contractors.
  const contractors = await prisma.projectContractor.findMany({
    where: { projectId },
    select: { id: true, tradeCode: true, allowFieldReporting: true, organization: { select: { name: true } } },
  });
  let contractor: (typeof contractors)[number] | null = null;
  if (role.fieldPersonaType === 'CONTRACTOR_EXECUTOR' && contractors.length > 0) {
    if (input.projectContractorId) {
      contractor = contractors.find((c) => c.id === input.projectContractorId) ?? null;
      if (!contractor) throw new AppError('Contractor not found on this project', 404, 'CONTRACTOR_NOT_FOUND');
    } else if (contractors.length === 1) {
      contractor = contractors[0];
    } else {
      throw new AppError('Choose which contractor this code is for', 422, 'CONTRACTOR_REQUIRED');
    }
    if (!contractor.allowFieldReporting) {
      throw new AppError(
        `Field reporting is off for ${contractor.organization.name}. Turn it on in the project's parties settings first.`,
        409,
        'CONTRACTOR_FIELD_REPORTING_OFF'
      );
    }
  } else if (input.projectContractorId) {
    throw new AppError('Only contractor field roles take a contractor', 422, 'CONTRACTOR_NOT_APPLICABLE');
  }

  const existingActive = await prisma.projectJoinCode.findFirst({
    where: { projectId, roleId: role.id, projectContractorId: contractor?.id ?? null, isActive: true },
    select: { code: true },
  });
  if (existingActive) {
    throw new AppError(
      `An active code already exists for this role${contractor ? ` and ${contractor.organization.name}` : ''} (${existingActive.code}). Rotate it instead.`,
      409,
      'ACTIVE_JOIN_CODE_EXISTS'
    );
  }

  const created = await prisma.$transaction(async (tx) => {
    const jc = await createJoinCode(tx, {
      projectId,
      codePrefix: project.codePrefix,
      role,
      contractor: contractor ? { id: contractor.id, tradeCode: contractor.tradeCode } : null,
      includeTradeCode: contractors.length > 1,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
      maxUses: input.maxUses ?? null,
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'JOIN_CODE_ISSUED',
      summaryText: `Issued join code ${jc.code} for role "${role.name}"${contractor ? ` (${contractor.organization.name})` : ''}.`,
      payload: {
        joinCodeId: jc.id,
        code: jc.code,
        roleId: role.id,
        projectContractorId: jc.projectContractorId,
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
    include: {
      role: true,
      projectContractor: { select: { id: true, tradeCode: true } },
      project: { select: { codePrefix: true, status: true, _count: { select: { contractors: true } } } },
    },
  });
  if (!existing) {
    throw new AppError('Join code not found', 404, 'JOIN_CODE_NOT_FOUND');
  }
  if (existing.project.status !== 'ACTIVE') {
    throw new AppError('Join codes can only be rotated on an active project', 409, 'PROJECT_NOT_ACTIVE');
  }
  assertRoleUsesJoinCodes(existing.role);
  assertMayManageRole(webUser, existing.role.fieldPersonaType);

  const created = await prisma.$transaction(async (tx) => {
    await tx.projectJoinCode.update({ where: { id: existing.id }, data: { isActive: false } });
    const jc = await createJoinCode(tx, {
      projectId,
      codePrefix: existing.project.codePrefix,
      role: existing.role,
      contractor: existing.projectContractor,
      includeTradeCode: existing.project._count.contractors > 1,
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
        projectContractorId: jc.projectContractorId,
      },
    });
    return jc;
  });
  return serializeJoinCode(created);
}
