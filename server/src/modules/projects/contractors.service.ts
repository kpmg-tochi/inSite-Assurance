import { Prisma } from '@prisma/client';
import {
  ContractorExecutionMode,
  ProjectContractorDto,
  ProjectContractorInput,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { resolveOrganization } from '../organizations/organizations.service';

/**
 * Project contractors (Phase 6, decision D). A project has one or more `ProjectContractor` rows;
 * the contractor model decides which BOQ items a contractor owns.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

export const CONTRACTOR_INCLUDE = {
  organization: { select: { id: true, name: true } },
  _count: { select: { boqItems: true, fieldSessions: true } },
} satisfies Prisma.ProjectContractorInclude;

export type ContractorRow = Prisma.ProjectContractorGetPayload<{ include: typeof CONTRACTOR_INCLUDE }>;

const isoDate = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

export function serializeContractor(c: ContractorRow): ProjectContractorDto {
  return {
    id: c.id,
    projectId: c.projectId,
    organizationId: c.organizationId,
    organizationName: c.organization.name,
    tradeCategory: c.tradeCategory,
    tradeCode: c.tradeCode,
    isMainContractor: c.isMainContractor,
    allocatedBudgetNgn: c.allocatedBudgetNgn === null ? null : Number(c.allocatedBudgetNgn),
    allowFieldReporting: c.allowFieldReporting,
    plannedMobilizationDate: isoDate(c.plannedMobilizationDate),
    plannedCompletionDate: isoDate(c.plannedCompletionDate),
    boqItemCount: c._count.boqItems,
    hasActivity: c._count.fieldSessions > 0,
    contractStatus: c.contractStatus,
    terminatedAt: c.terminatedAt?.toISOString() ?? null,
    replacesProjectContractorId: c.replacesProjectContractorId,
  };
}

/** All contractors of a project, main contractor first. */
export async function getProjectContractors(db: Db, projectId: string): Promise<ContractorRow[]> {
  return db.projectContractor.findMany({
    where: { projectId },
    include: CONTRACTOR_INCLUDE,
    orderBy: [{ isMainContractor: 'desc' }, { createdAt: 'asc' }],
  });
}

/**
 * The contractor shown where one name fits: the main contractor, or the first one. `extraCount` is
 * how many others there are, for "+N" labels.
 */
export function contractorHeadline(
  contractors: Array<{ isMainContractor: boolean; organization: { name: string } }>
): { name: string; extraCount: number; total: number } {
  if (contractors.length === 0) return { name: '', extraCount: 0, total: 0 };
  const main = contractors.find((c) => c.isMainContractor) ?? contractors[0];
  return { name: main.organization.name, extraCount: contractors.length - 1, total: contractors.length };
}

export function contractorHeadlineLabel(contractors: Array<{ isMainContractor: boolean; organization: { name: string } }>) {
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

/** Model rules checked whenever the contractor list or model changes. Returns issue messages. */
export function contractorModelIssues(
  mode: ContractorExecutionMode | null,
  allContractors: Array<{ isMainContractor: boolean; contractStatus?: string }>
): Array<{ code: string; message: string }> {
  // Phase 13: a terminated contractor stays for the record but does not count for the model.
  const contractors = allContractors.filter((c) => c.contractStatus !== 'TERMINATED');
  const issues: Array<{ code: string; message: string }> = [];
  if (!mode) issues.push({ code: 'CONTRACTOR_MODEL_REQUIRED', message: 'Choose the contractor model.' });
  if (contractors.length === 0) {
    issues.push({ code: 'CONTRACTOR_REQUIRED', message: 'Add at least one contractor.' });
    return issues;
  }
  const mains = contractors.filter((c) => c.isMainContractor).length;
  if (mode === 'SINGLE_CONTRACTOR' && contractors.length > 1) {
    issues.push({
      code: 'SINGLE_CONTRACTOR_ONLY',
      message: 'The single-contractor model allows one contractor. Remove the others or choose another model.',
    });
  }
  if (mode === 'MAIN_PLUS_SUBS_UNIFIED_IPC' && mains !== 1) {
    issues.push({
      code: 'ONE_MAIN_CONTRACTOR_REQUIRED',
      message: 'Mark exactly one contractor as the main contractor.',
    });
  }
  if (mode === 'MULTI_PRIME_SEPARATE_IPC' && mains > 1) {
    issues.push({ code: 'AT_MOST_ONE_MAIN_CONTRACTOR', message: 'At most one contractor can be marked as main.' });
  }
  return issues;
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
 * removes rows not listed. Refuses to remove a contractor that has sessions or IPC claims, and
 * refuses duplicate organisations or trade codes. Runs inside the caller's transaction.
 */
export async function syncProjectContractors(
  tx: Tx,
  params: {
    projectId: string;
    tenantId: string;
    mode: ContractorExecutionMode | null;
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
      if (c._count.fieldSessions > 0) {
        throw new AppError(
          `${c.organization.name} has field sessions or IPC claims on this project and cannot be removed.`,
          409,
          'CONTRACTOR_HAS_ACTIVITY'
        );
      }
      await tx.projectJoinCode.deleteMany({ where: { projectContractorId: c.id, fieldSessions: { none: {} } } });
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

  const singleMode = params.mode === 'SINGLE_CONTRACTOR';
  for (const r of resolved) {
    const data = {
      organizationId: r.organizationId,
      tradeCategory: r.input.tradeCategory.trim(),
      tradeCode: r.input.tradeCode.toUpperCase(),
      // The only contractor of a single-contractor project is its main contractor.
      isMainContractor: singleMode ? true : r.input.isMainContractor,
      allocatedBudgetNgn: r.input.allocatedBudgetNgn ?? null,
      allowFieldReporting: r.input.allowFieldReporting,
      plannedMobilizationDate: toDate(r.input.plannedMobilizationDate),
      plannedCompletionDate: toDate(r.input.plannedCompletionDate),
    };
    if (r.input.id) {
      const before = byId.get(r.input.id)!;
      if (before.organizationId !== r.organizationId && before._count.fieldSessions > 0) {
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
