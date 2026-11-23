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

export async function loadWorkdayReportInProject(db: Db, projectId: string, reportId: string) {
  assertUuid(reportId, 'Workday report', 'WORKDAY_REPORT_NOT_FOUND');
  const report = await db.workdayReport.findFirst({ where: { id: reportId, projectId } });
  if (!report) throw notFound('Workday report', 'WORKDAY_REPORT_NOT_FOUND');
  return report;
}

export async function loadReportQueryInProject(db: Db, projectId: string, queryId: string) {
  assertUuid(queryId, 'Report query', 'REPORT_QUERY_NOT_FOUND');
  const query = await db.reportQuery.findFirst({ where: { id: queryId, projectId } });
  if (!query) throw notFound('Report query', 'REPORT_QUERY_NOT_FOUND');
  return query;
}
