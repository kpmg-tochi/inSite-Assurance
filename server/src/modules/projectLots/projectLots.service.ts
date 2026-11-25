import { Prisma } from '@prisma/client';
import {
  allowedInterventionYears,
  buildLotBatchCode,
  DEFAULT_FISCAL_YEAR_START_MONTH,
  LotChoice,
  ProjectLotDto,
  ProjectLotListDto,
  ProjectLotRef,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { recordAuditEvent } from '../audit/audit.service';

/**
 * Client demo updates C3: project lots and lot/batch codes. A lot is a category of project within an
 * intervention year, numbered in order per year (1, 2, …); the projects of a lot are its batches. The
 * code `{year}-LOT-{lot}-BATCH-{batch}` is assigned by the server, inside a per-tenant transaction
 * advisory lock, so two drafts created at once never get the same batch or lot number.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export const PROJECT_LOT_REF_SELECT = { id: true, number: true, title: true, interventionYear: true } satisfies Prisma.ProjectLotSelect;

export function projectLotRef(lot: { id: string; number: number; title: string; interventionYear: number } | null | undefined): ProjectLotRef | null {
  return lot ? { id: lot.id, number: lot.number, title: lot.title, interventionYear: lot.interventionYear } : null;
}

/** Serialises lot assignment per tenant (held until the transaction ends). */
export async function lockProjectLots(tx: Tx, tenantId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'project-lots:' + tenantId}))`;
}

/** Today in the tenant zone and the intervention years a new project may take. */
export async function tenantInterventionYears(db: Db, tenantId: string, now = new Date()) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { timezone: true, fiscalYearStartMonth: true } });
  const today = zonedCalendarDate(now, tenant.timezone || 'Africa/Lagos');
  const fiscalYearStartMonth = tenant.fiscalYearStartMonth ?? DEFAULT_FISCAL_YEAR_START_MONTH;
  return { today, fiscalYearStartMonth, allowed: allowedInterventionYears(today, fiscalYearStartMonth) };
}

/** 422 INTERVENTION_YEAR_NOT_ALLOWED unless the year is one a new project may take. */
export async function assertInterventionYearAllowed(db: Db, tenantId: string, year: number): Promise<void> {
  const { allowed } = await tenantInterventionYears(db, tenantId);
  if (!allowed.includes(year)) {
    throw new AppError(
      `The intervention year must be ${allowed.join(' or ')}. Earlier years come in through the project register import.`,
      422,
      'INTERVENTION_YEAR_NOT_ALLOWED',
      { allowedInterventionYears: allowed }
    );
  }
}

/** GET /api/v1/project-lots: the lots of every allowed year (plus the requested one). */
export async function listProjectLots(tenantId: string, interventionYear?: number): Promise<ProjectLotListDto> {
  const { today, fiscalYearStartMonth, allowed } = await tenantInterventionYears(prisma, tenantId);
  const years = [...new Set([...allowed, ...(interventionYear ? [interventionYear] : [])])].sort((a, b) => a - b);
  const lots = await prisma.projectLot.findMany({
    where: { tenantId, interventionYear: { in: years } },
    orderBy: [{ interventionYear: 'asc' }, { number: 'asc' }],
    select: {
      ...PROJECT_LOT_REF_SELECT,
      _count: { select: { projects: true } },
      projects: { select: { batchNumber: true }, orderBy: { batchNumber: 'desc' }, take: 1, where: { batchNumber: { not: null } } },
    },
  });
  return {
    today,
    fiscalYearStartMonth,
    allowedInterventionYears: allowed,
    years: years.map((year) => {
      const ofYear = lots.filter((l) => l.interventionYear === year);
      const dtos: ProjectLotDto[] = ofYear.map((l) => ({
        id: l.id,
        interventionYear: l.interventionYear,
        number: l.number,
        title: l.title,
        projectCount: l._count.projects,
        nextBatchNumber: (l.projects[0]?.batchNumber ?? 0) + 1,
      }));
      return {
        interventionYear: year,
        nextLotNumber: ofYear.reduce((m, l) => Math.max(m, l.number), 0) + 1,
        lots: dtos,
      };
    }),
  };
}

async function nextBatchNumber(tx: Tx, lotId: string): Promise<number> {
  const max = await tx.project.aggregate({ where: { lotId }, _max: { batchNumber: true } });
  return (max._max.batchNumber ?? 0) + 1;
}

async function nextLotNumber(tx: Tx, tenantId: string, interventionYear: number): Promise<number> {
  const max = await tx.projectLot.aggregate({ where: { tenantId, interventionYear }, _max: { number: true } });
  return (max._max.number ?? 0) + 1;
}

interface LotActor {
  userId: string;
  displayName: string;
}

/** Creates a lot (numbered by the caller) and audits it on the tenant ledger. Caller holds the lot lock. */
async function createLot(tx: Tx, args: { tenantId: string; interventionYear: number; number: number; title: string; actor: LotActor }) {
  const lot = await tx.projectLot.create({
    data: {
      tenantId: args.tenantId,
      interventionYear: args.interventionYear,
      number: args.number,
      title: args.title.trim(),
      createdByUserId: args.actor.userId,
    },
    select: PROJECT_LOT_REF_SELECT,
  });
  await recordAuditEvent(tx, {
    tenantId: args.tenantId,
    projectId: null,
    actorType: 'WEB_USER',
    actorId: args.actor.userId,
    actorDisplayName: args.actor.displayName,
    action: 'PROJECT_LOT_CREATED',
    summaryText: `Created lot ${lot.number} of ${lot.interventionYear}: "${lot.title}".`,
    payload: { lotId: lot.id, interventionYear: lot.interventionYear, number: lot.number, title: lot.title },
  });
  return lot;
}

/**
 * Assigns a lot and the next batch for a project being created or re-coded: an existing lot of the
 * tenant and year (else 422 LOT_NOT_FOUND) takes its next batch; a new lot takes the next number of
 * the year and batch 1. Takes the per-tenant lot lock; the caller writes `lotId`, `batchNumber` and
 * `codePrefix` in the same transaction.
 */
export async function assignLotBatchCode(
  tx: Tx,
  args: { tenantId: string; interventionYear: number; lotChoice: LotChoice; userId: string; actorDisplayName?: string }
): Promise<{ lotId: string; batchNumber: number; codePrefix: string; lot: ProjectLotRef }> {
  await lockProjectLots(tx, args.tenantId);
  let lot: ProjectLotRef;
  if ('lotId' in args.lotChoice) {
    const found = await tx.projectLot.findFirst({
      where: { id: args.lotChoice.lotId, tenantId: args.tenantId, interventionYear: args.interventionYear },
      select: PROJECT_LOT_REF_SELECT,
    });
    if (!found) {
      throw new AppError(`That lot is not one of this workspace's lots for ${args.interventionYear}.`, 422, 'LOT_NOT_FOUND');
    }
    lot = found;
  } else {
    lot = await createLot(tx, {
      tenantId: args.tenantId,
      interventionYear: args.interventionYear,
      number: await nextLotNumber(tx, args.tenantId, args.interventionYear),
      title: args.lotChoice.newLotTitle,
      actor: { userId: args.userId, displayName: args.actorDisplayName ?? 'Web user' },
    });
  }
  const batchNumber = await nextBatchNumber(tx, lot.id);
  return { lotId: lot.id, batchNumber, codePrefix: buildLotBatchCode(lot.interventionYear, lot.number, batchNumber), lot };
}

/**
 * Register import: the lot a lot/batch code in the file names (year + number), created with
 * `titleIfNew` when the workspace has no such lot yet. Caller holds the lot lock.
 */
export async function findOrCreateLotByNumber(
  tx: Tx,
  args: { tenantId: string; interventionYear: number; number: number; titleIfNew: string; actor: LotActor }
): Promise<ProjectLotRef> {
  const found = await tx.projectLot.findUnique({
    where: { tenantId_interventionYear_number: { tenantId: args.tenantId, interventionYear: args.interventionYear, number: args.number } },
    select: PROJECT_LOT_REF_SELECT,
  });
  if (found) return found;
  return createLot(tx, { ...args, title: args.titleIfNew });
}
