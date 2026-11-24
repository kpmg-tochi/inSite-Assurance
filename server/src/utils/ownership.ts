import { Prisma, PrismaClient } from '@prisma/client';
import { AppError } from '../middleware/error.middleware';

/**
 * Ownership loaders (Phase 2 Step 3). Each takes a parent scope and an ID, and throws 404 unless
 * the record exists inside that scope. Use them for every ID that arrives in a URL or body, so
 * an ID from another project or tenant is indistinguishable from a missing one.
 */

type Db = Prisma.TransactionClient | PrismaClient;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function notFound(entity: string, code: string): AppError {
  return new AppError(`${entity} not found`, 404, code);
}

function assertUuid(id: string | undefined | null, entity: string, code: string): string {
  if (!id || !UUID_RE.test(id)) throw notFound(entity, code);
  return id;
}

export async function loadBoqItemInProject(db: Db, projectId: string, boqItemId: string) {
  assertUuid(boqItemId, 'BOQ item', 'BOQ_ITEM_NOT_FOUND');
  const item = await db.boqItem.findFirst({ where: { id: boqItemId, projectId } });
  if (!item) throw notFound('BOQ item', 'BOQ_ITEM_NOT_FOUND');
  return item;
}

/** Redesign R2b: a facility unit of the project. */
export async function loadFacilityUnitInProject(db: Db, projectId: string, unitId: string) {
  assertUuid(unitId, 'Facility unit', 'FACILITY_UNIT_NOT_FOUND');
  const unit = await db.facilityUnit.findFirst({ where: { id: unitId, projectId } });
  if (!unit) throw notFound('Facility unit', 'FACILITY_UNIT_NOT_FOUND');
  return unit;
}

/** Redesign R2b: a sprint of the project. */
export async function loadSprintInProject(db: Db, projectId: string, sprintId: string) {
  assertUuid(sprintId, 'Sprint', 'SPRINT_NOT_FOUND');
  const sprint = await db.projectSprint.findFirst({ where: { id: sprintId, projectId } });
  if (!sprint) throw notFound('Sprint', 'SPRINT_NOT_FOUND');
  return sprint;
}
