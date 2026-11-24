import { Prisma } from '@prisma/client';
import {
  ProjectContractorDto,
  ProjectContractorInput,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { resolveOrganization } from '../organizations/organizations.service';

/**
 * The project's contractor (Phase 6). Redesign R1d (decision T): one contractor per project, no
 * execution modes, no replacement. The contractor has no login (decision P2).
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export const CONTRACTOR_INCLUDE = {
  organization: { select: { id: true, name: true } },
  _count: {
    select: {
      defectTickets: true,
      documents: true,
      defaultCases: true,
      inspectionFindings: true,
      performanceRatings: true,
    },
  },
} satisfies Prisma.ProjectContractorInclude;

export type ContractorRow = Prisma.ProjectContractorGetPayload<{ include: typeof CONTRACTOR_INCLUDE }>;

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** Work is recorded against the contractor, so it cannot be removed or moved to another organisation. */
function hasActivity(c: ContractorRow): boolean {
  const n = c._count;
  return n.defectTickets + n.documents + n.defaultCases + n.inspectionFindings + n.performanceRatings > 0;
}

export function serializeContractor(c: ContractorRow): ProjectContractorDto {
  return {
    id: c.id,
    projectId: c.projectId,
    organizationId: c.organizationId,
    organizationName: c.organization.name,
    tradeCategory: c.tradeCategory,
    tradeCode: c.tradeCode,
    allocatedBudgetNgn: c.allocatedBudgetNgn === null ? null : Number(c.allocatedBudgetNgn),
    plannedMobilizationDate: isoDate(c.plannedMobilizationDate),
    plannedCompletionDate: isoDate(c.plannedCompletionDate),
    hasActivity: hasActivity(c),
    contractStatus: c.contractStatus,
    terminatedAt: c.terminatedAt?.toISOString() ?? null,
  };
}

/** The project's contractor rows (at most one since R1d; older data may hold more), oldest first. */
export async function getProjectContractors(db: Db, projectId: string): Promise<ContractorRow[]> {
  return db.projectContractor.findMany({
    where: { projectId },
    include: CONTRACTOR_INCLUDE,
    orderBy: [{ createdAt: 'asc' }],
  });
}

/**
 * The contractor shown where one name fits: the first one. `extraCount` is how many others there
 * are (only legacy data has more than one), for "+N" labels.
 */
export function contractorHeadline(
  contractors: Array<{ organization: { name: string } }>
): { name: string; extraCount: number; total: number } {
  if (contractors.length === 0) return { name: '', extraCount: 0, total: 0 };
  return { name: contractors[0].organization.name, extraCount: contractors.length - 1, total: contractors.length };
}

export function contractorHeadlineLabel(contractors: Array<{ organization: { name: string } }>) {
  const h = contractorHeadline(contractors);
  return h.extraCount > 0 ? `${h.name} +${h.extraCount}` : h.name;
}

/**
 * The ProjectContractor a web user acts for on a project: the one whose organisation is the
 * user's organisation. null when the user's organisation is not a contractor on the project.
 */
export async function contractorForWebUser(
  db: Db,
  projectId: string,
  webUser: Pick<WebJwtPayload, 'organizationId'>
) {
  return db.projectContractor.findFirst({
    where: { projectId, organizationId: webUser.organizationId },
    include: { organization: { select: { name: true } } },
  });
}

/**
 * Contractor rules checked whenever the contractor changes (R1d: one contractor, required on a live
 * project). Returns issue messages. A terminated contractor stays for the record.
 */
export function contractorIssues(contractors: Array<{ contractStatus?: string }>): Array<{ code: string; message: string }> {
  if (contractors.length === 0) return [{ code: 'CONTRACTOR_REQUIRED', message: 'Add the contractor.' }];
  if (contractors.length > 1) {
    return [{ code: 'ONE_CONTRACTOR_ONLY', message: 'A project has one contractor. Remove the others.' }];
  }
  return [];
}

function actorName(webUser: WebJwtPayload) {
  return `${webUser.fullName} (${webUser.roleName})`;
}

const toDate = (v: string | null | undefined) => (v ? new Date(`${v}T00:00:00.000Z`) : null);

export interface ContractorSyncResult {
  added: Array<{ id: string; organizationName: string; tradeCode: string }>;
  removed: Array<{ id: string; organizationName: string; tradeCode: string }>;
  updated: string[];
}

/**
 * Makes the project's contractors equal `inputs`: updates rows with an id, creates the rest, and
 * removes rows not listed. Refuses to remove a contractor with recorded work, more than one
 * contractor (decision T), and duplicate organisations or trade codes. Runs inside the caller's
 * transaction.
 */
export async function syncProjectContractors(
  tx: Tx,
  params: {
    projectId: string;
    tenantId: string;
    inputs: ProjectContractorInput[];
    webUser: WebJwtPayload;
    /** Leave rows that are not listed alone (single add or edit). */
    partial?: boolean;
  }
): Promise<ContractorSyncResult> {
  const existing = await getProjectContractors(tx, params.projectId);
  const byId = new Map(existing.map((c) => [c.id, c]));
  const result: ContractorSyncResult = { added: [], removed: [], updated: [] };

  // Resolve organisations first so duplicate checks use real ids.
  const resolved: Array<{ input: ProjectContractorInput; organizationId: string; organizationName: string }> = [];
  for (const input of params.inputs) {
    if (input.id && !byId.has(input.id)) {
      throw new AppError('Contractor not found on this project', 404, 'CONTRACTOR_NOT_FOUND');
    }
    const keepArchived = input.id ? byId.get(input.id)!.organizationId : null;
    const { organization } = await resolveOrganization(tx, params.tenantId, input.organization, 'CONTRACTOR', {
      allowArchivedId: keepArchived,
      actor: { actorId: params.webUser.userId, actorDisplayName: actorName(params.webUser) },
    });
    resolved.push({ input, organizationId: organization.id, organizationName: organization.name });
  }

  const keptIds = new Set(params.inputs.map((i) => i.id).filter((v): v is string => Boolean(v)));
  const staying = params.partial ? existing.filter((c) => !keptIds.has(c.id)) : [];
  const orgs = [...staying.map((c) => c.organizationId), ...resolved.map((r) => r.organizationId)];
  const codes = [...staying.map((c) => c.tradeCode), ...resolved.map((r) => r.input.tradeCode.toUpperCase())];
  if (orgs.length > 1) {
    throw new AppError('A project has one contractor. Remove the current one first.', 422, 'ONE_CONTRACTOR_ONLY');
  }
  const dupOrg = orgs.find((o, i) => orgs.indexOf(o) !== i);
  if (dupOrg) {
    const name = resolved.find((r) => r.organizationId === dupOrg)?.organizationName ?? 'An organisation';
    throw new AppError(`${name} is listed twice. Each organisation can be one contractor on a project.`, 422, 'DUPLICATE_CONTRACTOR');
  }
  const dupCode = codes.find((c, i) => codes.indexOf(c) !== i);
  if (dupCode) {
    throw new AppError(`Trade code ${dupCode} is used twice. Each contractor needs its own trade code.`, 422, 'DUPLICATE_TRADE_CODE');
  }

  // Removals first so unique (projectId, tradeCode) does not clash with a re-used code.
  if (!params.partial) {
    for (const c of existing) {
      if (keptIds.has(c.id)) continue;
      if (hasActivity(c)) {
        throw new AppError(
          `${c.organization.name} has recorded work on this project and cannot be removed.`,
          409,
          'CONTRACTOR_HAS_ACTIVITY'
        );
      }
      await tx.projectContractor.delete({ where: { id: c.id } });
      result.removed.push({ id: c.id, organizationName: c.organization.name, tradeCode: c.tradeCode });
    }
  }

  // Move trade codes out of the way when two kept rows swap codes.
  for (const r of resolved) {
    if (r.input.id) {
      const before = byId.get(r.input.id)!;
      if (before.tradeCode !== r.input.tradeCode.toUpperCase()) {
        await tx.projectContractor.update({ where: { id: before.id }, data: { tradeCode: `~${before.id.slice(0, 8)}` } });
      }
    }
  }

  for (const r of resolved) {
    const data = {
      organizationId: r.organizationId,
      tradeCategory: r.input.tradeCategory.trim(),
      tradeCode: r.input.tradeCode.toUpperCase(),
      allocatedBudgetNgn: r.input.allocatedBudgetNgn ?? null,
      plannedMobilizationDate: toDate(r.input.plannedMobilizationDate),
      plannedCompletionDate: toDate(r.input.plannedCompletionDate),
    };
    if (r.input.id) {
      const before = byId.get(r.input.id)!;
      if (before.organizationId !== r.organizationId && hasActivity(before)) {
        throw new AppError(
          `${before.organization.name} has activity on this project; its organisation cannot be changed.`,
          409,
          'CONTRACTOR_HAS_ACTIVITY'
        );
      }
      await tx.projectContractor.update({ where: { id: before.id }, data });
      result.updated.push(before.id);
    } else {
      const created = await tx.projectContractor.create({ data: { projectId: params.projectId, ...data } });
      result.added.push({ id: created.id, organizationName: r.organizationName, tradeCode: created.tradeCode });
    }
  }
  return result;
}

/** Records PROJECT_CONTRACTOR_ADDED / _REMOVED entries for a sync. */
export async function auditContractorChanges(
  tx: Tx,
  params: { projectId: string; webUser: WebJwtPayload; result: ContractorSyncResult }
) {
  for (const a of params.result.added) {
    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'WEB_USER',
      actorId: params.webUser.userId,
      actorDisplayName: actorName(params.webUser),
      action: 'PROJECT_CONTRACTOR_ADDED',
      summaryText: `Added contractor ${a.organizationName} (${a.tradeCode}).`,
      payload: { projectContractorId: a.id, organizationName: a.organizationName, tradeCode: a.tradeCode },
    });
  }
  for (const r of params.result.removed) {
    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'WEB_USER',
      actorId: params.webUser.userId,
      actorDisplayName: actorName(params.webUser),
      action: 'PROJECT_CONTRACTOR_REMOVED',
      summaryText: `Removed contractor ${r.organizationName} (${r.tradeCode}).`,
      payload: { projectContractorId: r.id, organizationName: r.organizationName, tradeCode: r.tradeCode },
    });
  }
}
