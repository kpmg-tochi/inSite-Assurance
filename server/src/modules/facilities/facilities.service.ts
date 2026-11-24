import { Prisma } from '@prisma/client';
import {
  CreateFacilityRequest,
  DEFAULT_FACILITIES,
  FacilityArchetype,
  FacilityDto,
  UpdateFacilityRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { effectiveSubForms } from '../forms/formLibrary.service';
import { ensureFormLibrary } from '../forms/formLibraryProvisioning';

/**
 * Redesign R2a: the tenant facility catalogue. Every tenant starts with DEFAULT_FACILITIES. Admins
 * add, rename, re-archetype and retire entries; a retired facility stays on the projects that use
 * it and is hidden from pickers and the workbook. A code is locked once any facility unit uses it.
 */

type Db = Prisma.TransactionClient | typeof prisma;

export async function provisionDefaultFacilities(db: Db, tenantId: string): Promise<void> {
  await db.facility.createMany({
    data: DEFAULT_FACILITIES.map((f, i) => ({ tenantId, ...f, sortOrder: (i + 1) * 10 })),
    skipDuplicates: true,
  });
}

/** Tenants created before R2 (or by an older seed) get the defaults on first use. */
export async function ensureFacilities(db: Db, tenantId: string): Promise<void> {
  if ((await db.facility.count({ where: { tenantId } })) === 0) await provisionDefaultFacilities(db, tenantId);
}

const WITH_COUNT = { _count: { select: { units: true } } } satisfies Prisma.FacilityInclude;
type FacilityRow = Prisma.FacilityGetPayload<{ include: typeof WITH_COUNT }>;

export function serializeFacility(f: FacilityRow, subForm: FacilityDto['subForm'] = null): FacilityDto {
  return {
    id: f.id,
    code: f.code,
    name: f.name,
    pluralName: f.pluralName,
    category: f.category,
    archetype: f.archetype as FacilityArchetype,
    isRetired: f.isRetired,
    sortOrder: f.sortOrder,
    unitCount: f._count.units,
    subForm,
  };
}

/** Serializes facilities with the sub-form each uses (R3: own when customised, else the archetype default). */
async function serializeWithSubForms(tenantId: string, rows: FacilityRow[]): Promise<FacilityDto[]> {
  await ensureFormLibrary(prisma, tenantId);
  const effective = await effectiveSubForms(prisma, tenantId, rows);
  return rows.map((f) => {
    const e = effective.get(f.id);
    return serializeFacility(f, e ? { source: e.source, version: e.version } : null);
  });
}

export async function listFacilities(tenantId: string, includeRetired = false): Promise<FacilityDto[]> {
  await ensureFacilities(prisma, tenantId);
  const rows = await prisma.facility.findMany({
    where: { tenantId, ...(includeRetired ? {} : { isRetired: false }) },
    orderBy: [{ isRetired: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    include: WITH_COUNT,
  });
  return serializeWithSubForms(tenantId, rows);
}

function actorName(webUser: WebJwtPayload) {
  return `${webUser.fullName} (${webUser.roleName})`;
}

async function audit(tx: Prisma.TransactionClient, webUser: WebJwtPayload, summaryText: string, payload: Record<string, unknown>) {
  await recordAuditEvent(tx, {
    tenantId: webUser.tenantId,
    projectId: null,
    actorType: 'WEB_USER',
    actorId: webUser.userId,
    actorDisplayName: actorName(webUser),
    action: 'FACILITY_SAVED',
    summaryText,
    payload,
  });
}

function codeTaken(error: unknown, code: string | undefined): never {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    throw new AppError(`A facility with code "${code}" already exists`, 409, 'FACILITY_CODE_EXISTS');
  }
  throw error;
}

export async function createFacility(webUser: WebJwtPayload, input: CreateFacilityRequest): Promise<FacilityDto> {
  try {
    const id = await prisma.$transaction(async (tx) => {
      await ensureFacilities(tx, webUser.tenantId);
      const last = await tx.facility.aggregate({ where: { tenantId: webUser.tenantId }, _max: { sortOrder: true } });
      const saved = await tx.facility.create({
        data: {
          tenantId: webUser.tenantId,
          code: input.code,
          name: input.name,
          pluralName: input.pluralName ?? null,
          category: input.category ?? null,
          archetype: input.archetype,
          sortOrder: input.sortOrder ?? (last._max.sortOrder ?? 0) + 10,
        },
      });
      await audit(tx, webUser, `Added facility "${saved.name}" (${saved.code}).`, {
        facilityId: saved.id,
        code: saved.code,
        name: saved.name,
        archetype: saved.archetype,
        category: saved.category,
      });
      return saved.id;
    });
    return (await serializeWithSubForms(webUser.tenantId, [await prisma.facility.findUniqueOrThrow({ where: { id }, include: WITH_COUNT })]))[0];
  } catch (error) {
    codeTaken(error, input.code);
  }
}

export async function updateFacility(webUser: WebJwtPayload, facilityId: string, input: UpdateFacilityRequest): Promise<FacilityDto> {
  try {
    await prisma.$transaction(async (tx) => {
      const before = await tx.facility.findFirst({ where: { id: facilityId, tenantId: webUser.tenantId }, include: WITH_COUNT });
      if (!before) throw new AppError('Facility not found', 404, 'FACILITY_NOT_FOUND');
      const usedBy = before._count.units;
      if (input.code !== undefined && input.code !== before.code && usedBy > 0) {
        throw new AppError(
          `The code of "${before.name}" cannot change: ${usedBy} facility unit(s) use it.`,
          409,
          'FACILITY_CODE_LOCKED'
        );
      }
      const data = {
        ...(input.code !== undefined ? { code: input.code } : {}),
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.pluralName !== undefined ? { pluralName: input.pluralName } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.archetype !== undefined ? { archetype: input.archetype } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isRetired !== undefined ? { isRetired: input.isRetired } : {}),
      };
      const changed = Object.keys(data).filter((k) => (before as Record<string, unknown>)[k] !== (data as Record<string, unknown>)[k]);
      if (changed.length === 0) return;
      const saved = await tx.facility.update({ where: { id: before.id }, data });
      const verb =
        input.isRetired === true && !before.isRetired
          ? 'Retired'
          : input.isRetired === false && before.isRetired
            ? 'Restored'
            : 'Updated';
      await audit(tx, webUser, `${verb} facility "${saved.name}" (${saved.code}): ${changed.join(', ')}.`, {
        facilityId: saved.id,
        changedFields: changed,
        before: Object.fromEntries(changed.map((k) => [k, (before as Record<string, unknown>)[k]])),
        after: Object.fromEntries(changed.map((k) => [k, (saved as Record<string, unknown>)[k]])),
      });
    });
    return (await serializeWithSubForms(webUser.tenantId, [await prisma.facility.findUniqueOrThrow({ where: { id: facilityId }, include: WITH_COUNT })]))[0];
  } catch (error) {
    codeTaken(error, input.code);
  }
}
