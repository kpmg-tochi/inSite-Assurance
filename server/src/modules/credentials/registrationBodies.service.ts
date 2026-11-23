import { Prisma } from '@prisma/client';
import {
  DEFAULT_REGISTRATION_BODIES,
  RegistrationBodyDto,
  RegistrationBodyOption,
  SaveRegistrationBodyRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';

/**
 * Professional registration bodies (Phase 12): a tenant list replacing the fixed Nigerian enum.
 * Codes are stored as strings on users and on certifier snapshots (with the body's name and prefix,
 * so old certificates print as they were). A body some user still names is archived, not deleted.
 */

type Db = Prisma.TransactionClient | typeof prisma;

type BodyRow = Prisma.ProfessionalRegistrationBodyGetPayload<object>;

async function userCounts(db: Db, tenantId: string, codes: string[]): Promise<Map<string, number>> {
  if (codes.length === 0) return new Map();
  const rows = await db.user.groupBy({
    by: ['professionalRegistrationBodyCode'],
    where: { tenantId, professionalRegistrationBodyCode: { in: codes } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.professionalRegistrationBodyCode ?? '', r._count._all]));
}

function serialize(b: BodyRow, userCount: number): RegistrationBodyDto {
  return {
    id: b.id,
    code: b.code,
    fullName: b.fullName,
    displayPrefix: b.displayPrefix,
    exampleNumber: b.exampleNumber,
    isArchived: b.isArchived,
    sortOrder: b.sortOrder,
    userCount,
  };
}

export async function listRegistrationBodies(tenantId: string, includeArchived: boolean, db: Db = prisma): Promise<RegistrationBodyDto[]> {
  const rows = await db.professionalRegistrationBody.findMany({
    where: { tenantId, ...(includeArchived ? {} : { isArchived: false }) },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
  });
  const counts = await userCounts(db, tenantId, rows.map((r) => r.code));
  return rows.map((r) => serialize(r, counts.get(r.code) ?? 0));
}

/** Active bodies for pickers (web forms, mobile baseline pack). */
export async function registrationBodyOptions(tenantId: string, db: Db = prisma): Promise<RegistrationBodyOption[]> {
  const rows = await db.professionalRegistrationBody.findMany({
    where: { tenantId, isArchived: false },
    orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    select: { code: true, fullName: true, displayPrefix: true, exampleNumber: true },
  });
  return rows;
}

/** Creates the six default bodies for a tenant that has none of them yet (provisioning and seed). */
export async function provisionDefaultRegistrationBodies(db: Db, tenantId: string): Promise<void> {
  await db.professionalRegistrationBody.createMany({
    data: DEFAULT_REGISTRATION_BODIES.map((b) => ({ tenantId, ...b })),
    skipDuplicates: true,
  });
}

async function save(webUser: WebJwtPayload, input: SaveRegistrationBodyRequest, bodyId: string | null): Promise<RegistrationBodyDto> {
  const tenantId = webUser.tenantId;
  try {
    const id = await prisma.$transaction(async (tx) => {
      const before = bodyId ? await tx.professionalRegistrationBody.findFirst({ where: { id: bodyId, tenantId } }) : null;
      if (bodyId && !before) throw new AppError('Registration body not found', 404, 'REGISTRATION_BODY_NOT_FOUND');
      if (before && before.code !== input.code) {
        // Codes are stored on profiles and certificates; a referenced code cannot change.
        const used = await tx.user.count({ where: { tenantId, professionalRegistrationBodyCode: before.code } });
        if (used > 0) {
          throw new AppError(
            `${used} user(s) name ${before.code}, so its code cannot change. Archive it and add a new body instead.`,
            409,
            'REGISTRATION_BODY_CODE_IN_USE'
          );
        }
      }
      const data = {
        code: input.code,
        fullName: input.fullName,
        displayPrefix: input.displayPrefix,
        exampleNumber: input.exampleNumber ?? null,
        ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
      };
      const saved = before
        ? await tx.professionalRegistrationBody.update({ where: { id: before.id }, data })
        : await tx.professionalRegistrationBody.create({ data: { tenantId, ...data } });
      const verb = !before ? 'Added' : before.isArchived !== saved.isArchived ? (saved.isArchived ? 'Archived' : 'Restored') : 'Updated';
      await recordAuditEvent(tx, {
        tenantId,
        projectId: null,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
        action: 'REGISTRATION_BODY_SAVED',
        summaryText: `${verb} registration body ${saved.code} (${saved.fullName}).`,
        payload: {
          registrationBodyId: saved.id,
          previous: before ? { code: before.code, fullName: before.fullName, displayPrefix: before.displayPrefix, isArchived: before.isArchived } : null,
          next: { code: saved.code, fullName: saved.fullName, displayPrefix: saved.displayPrefix, isArchived: saved.isArchived },
        },
      });
      return saved.id;
    });
    const all = await listRegistrationBodies(tenantId, true);
    return all.find((b) => b.id === id)!;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(`A registration body with code ${input.code} already exists`, 409, 'REGISTRATION_BODY_CODE_TAKEN');
    }
    throw error;
  }
}

export const createRegistrationBody = (webUser: WebJwtPayload, input: SaveRegistrationBodyRequest) => save(webUser, input, null);
export const updateRegistrationBody = (webUser: WebJwtPayload, bodyId: string, input: SaveRegistrationBodyRequest) =>
  save(webUser, input, bodyId);

/**
 * DELETE: removes a body nobody names; a body still on a profile is archived instead (it stays
 * readable on that profile and on old certificates, but cannot be chosen again).
 */
export async function deleteRegistrationBody(webUser: WebJwtPayload, bodyId: string): Promise<{ deleted: boolean; archived: boolean }> {
  const tenantId = webUser.tenantId;
  return prisma.$transaction(async (tx) => {
    const body = await tx.professionalRegistrationBody.findFirst({ where: { id: bodyId, tenantId } });
    if (!body) throw new AppError('Registration body not found', 404, 'REGISTRATION_BODY_NOT_FOUND');
    const used = await tx.user.count({ where: { tenantId, professionalRegistrationBodyCode: body.code } });
    const referenced = used > 0;
    if (referenced) await tx.professionalRegistrationBody.update({ where: { id: body.id }, data: { isArchived: true } });
    else await tx.professionalRegistrationBody.delete({ where: { id: body.id } });
    await recordAuditEvent(tx, {
      tenantId,
      projectId: null,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'REGISTRATION_BODY_SAVED',
      summaryText: referenced
        ? `Archived registration body ${body.code} (still named by ${used} user(s) or certificates).`
        : `Deleted registration body ${body.code} (${body.fullName}).`,
      payload: { registrationBodyId: body.id, code: body.code, deleted: !referenced, archived: referenced },
    });
    return { deleted: !referenced, archived: referenced };
  });
}
