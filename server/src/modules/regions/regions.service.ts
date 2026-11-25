import { Prisma } from '@prisma/client';
import { RegionDto, RegionSummary, SaveRegionRequest } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';

/** Tenant regions (Phase 11): two levels, region → area. Optional on a project unless its type requires one. */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const REGION_INCLUDE = {
  parentRegion: { select: { name: true } },
  _count: { select: { projects: true } },
} satisfies Prisma.RegionInclude;

type RegionRow = Prisma.RegionGetPayload<{ include: typeof REGION_INCLUDE }>;

function serializeRegion(r: RegionRow): RegionDto {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    parentRegionId: r.parentRegionId,
    parentRegionName: r.parentRegion?.name ?? null,
    isArchived: r.isArchived,
    projectCount: r._count.projects,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export function regionSummary(r: { id: string; name: string; code: string; parentRegion?: { name: string } | null } | null): RegionSummary | null {
  if (!r) return null;
  return { id: r.id, name: r.name, code: r.code, path: r.parentRegion ? `${r.parentRegion.name} › ${r.name}` : r.name };
}

/** Select for a project's region summary. */
export const REGION_SUMMARY_SELECT = {
  id: true,
  name: true,
  code: true,
  parentRegion: { select: { name: true } },
} satisfies Prisma.RegionSelect;

export async function listRegions(tenantId: string, includeArchived: boolean): Promise<RegionDto[]> {
  const rows = await prisma.region.findMany({
    where: { tenantId, ...(includeArchived ? {} : { isArchived: false }) },
    orderBy: [{ name: 'asc' }],
    include: REGION_INCLUDE,
  });
  return rows.map(serializeRegion);
}

async function assertValidParent(tx: Tx, tenantId: string, regionId: string | null, parentRegionId: string | null) {
  if (!parentRegionId) return;
  if (parentRegionId === regionId) throw new AppError('A zone or state cannot be inside itself', 422, 'REGION_PARENT_SELF');
  const parent = await tx.region.findFirst({ where: { id: parentRegionId, tenantId }, select: { parentRegionId: true } });
  if (!parent) throw new AppError('Parent zone not found', 404, 'REGION_NOT_FOUND');
  if (parent.parentRegionId) {
    throw new AppError('There are two levels: a state can only sit inside a zone.', 422, 'REGION_TOO_DEEP');
  }
  if (regionId && (await tx.region.count({ where: { parentRegionId: regionId } })) > 0) {
    throw new AppError('This zone has states, so it cannot become a state itself.', 422, 'REGION_TOO_DEEP');
  }
}

async function saveRegion(webUser: WebJwtPayload, input: SaveRegionRequest, regionId: string | null): Promise<RegionDto> {
  const tenantId = webUser.tenantId;
  try {
    const id = await prisma.$transaction(async (tx) => {
      const before = regionId ? await tx.region.findFirst({ where: { id: regionId, tenantId } }) : null;
      if (regionId && !before) throw new AppError('Zone or state not found', 404, 'REGION_NOT_FOUND');
      const parentRegionId = input.parentRegionId === undefined ? before?.parentRegionId ?? null : input.parentRegionId;
      await assertValidParent(tx, tenantId, regionId, parentRegionId);
      const data = {
        name: input.name,
        code: input.code,
        parentRegionId,
        ...(input.isArchived !== undefined ? { isArchived: input.isArchived } : {}),
      };
      const saved = before
        ? await tx.region.update({ where: { id: before.id }, data })
        : await tx.region.create({ data: { tenantId, ...data } });
      await recordAuditEvent(tx, {
        tenantId,
        projectId: null,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
        action: 'TENANT_SETTINGS_UPDATED',
        summaryText: `${before ? 'Updated' : 'Added'} ${saved.parentRegionId ? 'area' : 'region'} "${saved.name}" (${saved.code})${
          saved.isArchived && !before?.isArchived ? ', archived' : ''
        }.`,
        payload: { setting: 'regions', regionId: saved.id, previous: before, next: saved },
      });
      return saved.id;
    });
    const row = await prisma.region.findUniqueOrThrow({ where: { id }, include: REGION_INCLUDE });
    return serializeRegion(row);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      throw new AppError(`A zone or state with code "${input.code}" already exists`, 409, 'REGION_CODE_EXISTS');
    }
    throw error;
  }
}

export const createRegion = (webUser: WebJwtPayload, input: SaveRegionRequest) => saveRegion(webUser, input, null);
export const updateRegion = (webUser: WebJwtPayload, regionId: string, input: SaveRegionRequest) =>
  saveRegion(webUser, input, regionId);

/** A region chosen for a project: must be in the tenant; archived only if the project already had it. */
export async function assertRegionUsable(db: Db, tenantId: string, regionId: string, currentRegionId: string | null) {
  const region = await db.region.findFirst({ where: { id: regionId, tenantId }, select: { id: true, isArchived: true, name: true } });
  if (!region) throw new AppError('Zone or state not found in this workspace', 404, 'REGION_NOT_FOUND');
  if (region.isArchived && region.id !== currentRegionId) {
    throw new AppError(`"${region.name}" is archived and cannot be chosen`, 409, 'REGION_ARCHIVED');
  }
}
