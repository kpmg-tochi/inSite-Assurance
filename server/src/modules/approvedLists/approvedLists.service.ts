import { Prisma } from '@prisma/client';
import {
  APPROVED_LIST_KIND_LABELS,
  ApprovedListDetailDto,
  ApprovedListKind,
  ApprovedListLinkedProject,
  ApprovedListRowDto,
  ApprovedListsOverviewDto,
  ApprovedListSummaryDto,
  ApprovedListYearRowsDto,
  DEFAULT_BUDGET_MISMATCH_TOLERANCE_PCT,
  ProjectApprovedListLinkDto,
  budgetMismatch,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, type WebJwtPayload } from '../../middleware/auth.middleware';
import { buildProjectVisibilityWhere } from '../../utils/accessControl';
import { recordAuditEvent } from '../audit/audit.service';

/**
 * Client demo updates E3 (wave 3, read-only lists): the annual approved lists, their rows, the
 * projects linked to each row and the budget-mismatch red flag (`budgetMismatch`, tenant tolerance
 * `Tenant.budgetMismatchTolerancePct`). Lists are seeded in wave 3 and uploaded from the template in
 * wave 4 (`approvedListImport.service.ts`; summaries carry the last upload's file, time and uploader).
 *
 * Visibility: list summaries, row match statuses and counts cover every link in the tenant (the
 * programme-level truth); the projects named on a row and in the red-flag list are only those the
 * caller can see (directory visibility, drafts by the draft rule).
 */

export const LINKED_PROJECT_SELECT = {
  id: true,
  codePrefix: true,
  name: true,
  interventionYear: true,
  totalBudgetNgn: true,
} satisfies Prisma.ProjectSelect;

export type LinkedProjectRow = Prisma.ProjectGetPayload<{ select: typeof LINKED_PROJECT_SELECT }>;

const LIST_INCLUDE = {
  rows: {
    orderBy: [{ sortOrder: 'asc' }, { rowRef: 'asc' }],
    include: { projects: { select: LINKED_PROJECT_SELECT, orderBy: { codePrefix: 'asc' } } },
  },
} satisfies Prisma.ApprovedListInclude;

type ListWithRows = Prisma.ApprovedListGetPayload<{ include: typeof LIST_INCLUDE }>;
type RowWithProjects = ListWithRows['rows'][number];

export const num = (v: Prisma.Decimal | null): number | null => (v === null ? null : Number(v));

export async function tenantTolerancePct(tenantId: string): Promise<number> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { budgetMismatchTolerancePct: true } });
  return tenant?.budgetMismatchTolerancePct ?? DEFAULT_BUDGET_MISMATCH_TOLERANCE_PCT;
}

export function kindOf(kind: string): ApprovedListKind {
  return kind === 'MG_BEAP' ? 'MG_BEAP' : 'DI_SCHEDULE';
}

/** NOT_LINKED, LINKED, MISMATCH (the one linked project is outside the tolerance), MULTIPLE. */
export function matchStatusOf(all: ApprovedListLinkedProject[]): ApprovedListRowDto['matchStatus'] {
  return all.length === 0 ? 'NOT_LINKED' : all.length > 1 ? 'MULTIPLE' : all[0].mismatch?.flagged ? 'MISMATCH' : 'LINKED';
}

export function linkedProject(p: LinkedProjectRow, estimate: number, tolerancePct: number, kind: ApprovedListKind): ApprovedListLinkedProject {
  const budget = num(p.totalBudgetNgn);
  return {
    id: p.id,
    codePrefix: p.codePrefix,
    name: p.name,
    interventionYear: p.interventionYear,
    totalBudgetNgn: budget,
    mismatch: budgetMismatch(budget, estimate, tolerancePct, kind),
  };
}

function schoolNames(json: Prisma.JsonValue): string[] {
  return Array.isArray(json) ? json.filter((s): s is string => typeof s === 'string') : [];
}

/** One row with every link evaluated; `visible` limits the projects named. */
function serializeRow(
  row: RowWithProjects,
  kind: ApprovedListKind,
  tolerancePct: number,
  visible: Set<string>
): { dto: ApprovedListRowDto; all: ApprovedListLinkedProject[] } {
  const estimate = Number(row.costEstimateNgn);
  const all = row.projects.map((p) => linkedProject(p, estimate, tolerancePct, kind));
  const matchStatus = matchStatusOf(all);
  return {
    all,
    dto: {
      id: row.id,
      listId: row.listId,
      rowRef: row.rowRef,
      projectTitle: row.projectTitle,
      schoolNames: schoolNames(row.schoolNamesJson),
      stateCode: row.stateCode,
      lgaCodes: row.lgaCodes,
      facilityScope: row.facilityScope,
      costEstimateNgn: estimate,
      lotTitle: row.lotTitle,
      linkedProjects: all.filter((p) => visible.has(p.id)),
      matchStatus,
    },
  };
}

/** Wave 4: who uploaded each list last (one query). */
async function importerNames(lists: ListWithRows[]): Promise<Map<string, string>> {
  const ids = [...new Set(lists.map((l) => l.importedById).filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } });
  return new Map(users.map((u) => [u.id, u.fullName]));
}

function summarize(
  list: ListWithRows,
  rows: { dto: ApprovedListRowDto; all: ApprovedListLinkedProject[] }[],
  importers: Map<string, string>
): ApprovedListSummaryDto {
  return {
    id: list.id,
    interventionYear: list.interventionYear,
    kind: kindOf(list.kind),
    stateCode: list.stateCode,
    title: list.title,
    approvedBy: list.approvedBy,
    approvedOn: list.approvedOn,
    rowCount: rows.length,
    totalEstimateNgn: rows.reduce((sum, r) => sum + r.dto.costEstimateNgn, 0),
    linkedRowCount: rows.filter((r) => r.all.length > 0).length,
    mismatchCount: rows.reduce((n, r) => n + r.all.filter((p) => p.mismatch?.flagged).length, 0),
    sourceFileName: list.sourceFileName,
    importedAt: list.importedAt ? list.importedAt.toISOString() : null,
    importedByName: list.importedById ? (importers.get(list.importedById) ?? null) : null,
  };
}

/** Ids, among `projectIds`, the caller may see (directory visibility, plus drafts by the draft rule). */
export async function visibleProjectIds(webUser: WebJwtPayload, projectIds: string[]): Promise<Set<string>> {
  if (projectIds.length === 0) return new Set();
  const rows = await prisma.project.findMany({
    where: {
      AND: [
        buildProjectVisibilityWhere(webUser, undefined, { statuses: ['DRAFT', 'ACTIVE', 'ARCHIVED'] }),
        { id: { in: projectIds } },
      ],
    },
    select: { id: true },
  });
  return new Set(rows.map((r) => r.id));
}

function linkedIdsOf(lists: ListWithRows[]): string[] {
  return lists.flatMap((l) => l.rows.flatMap((r) => r.projects.map((p) => p.id)));
}

const sortLists = (a: ListWithRows, b: ListWithRows) =>
  a.kind.localeCompare(b.kind) || (a.stateCode ?? '').localeCompare(b.stateCode ?? '') || a.title.localeCompare(b.title);

/** One intervention year: the overview and every row of its lists (list order, then row order). */
async function loadYear(webUser: WebJwtPayload, interventionYear?: number): Promise<ApprovedListYearRowsDto> {
  const tenantId = webUser.tenantId;
  const [yearRows, tolerancePct] = await Promise.all([
    prisma.approvedList.findMany({ where: { tenantId }, distinct: ['interventionYear'], select: { interventionYear: true } }),
    tenantTolerancePct(tenantId),
  ]);
  const years = yearRows.map((y) => y.interventionYear).sort((a, b) => b - a);
  const year = interventionYear ?? years[0] ?? null;
  if (year === null) return { years, interventionYear: null, tolerancePct, lists: [], mismatches: [], rows: [] };

  const lists = (await prisma.approvedList.findMany({ where: { tenantId, interventionYear: year }, include: LIST_INCLUDE })).sort(sortLists);
  const [visible, importers] = await Promise.all([visibleProjectIds(webUser, linkedIdsOf(lists)), importerNames(lists)]);

  const mismatches: ApprovedListsOverviewDto['mismatches'] = [];
  const allRows: ApprovedListRowDto[] = [];
  const summaries = lists.map((list) => {
    const kind = kindOf(list.kind);
    const rows = list.rows.map((r) => serializeRow(r, kind, tolerancePct, visible));
    for (const r of rows) {
      allRows.push(r.dto);
      for (const p of r.dto.linkedProjects) {
        if (p.mismatch?.flagged) mismatches.push({ ...p, rowId: r.dto.id, rowRef: r.dto.rowRef, listTitle: list.title });
      }
    }
    return summarize(list, rows, importers);
  });
  // Largest gap first.
  mismatches.sort((a, b) => Math.abs(b.mismatch?.differencePct ?? 0) - Math.abs(a.mismatch?.differencePct ?? 0));
  return { years, interventionYear: year, tolerancePct, lists: summaries, mismatches, rows: allRows };
}

/** GET /api/v1/approved-lists?interventionYear= (default: the latest year with lists). */
export async function getApprovedListsOverview(webUser: WebJwtPayload, interventionYear?: number): Promise<ApprovedListsOverviewDto> {
  const year = await loadYear(webUser, interventionYear);
  return { years: year.years, interventionYear: year.interventionYear, tolerancePct: year.tolerancePct, lists: year.lists, mismatches: year.mismatches };
}

/**
 * GET /api/v1/approved-lists/rows?interventionYear= (design refinement 2026-11-26): the overview plus
 * every row of the year, for the Needs assessment table (one request instead of one per list).
 */
export async function getApprovedListYearRows(webUser: WebJwtPayload, interventionYear?: number): Promise<ApprovedListYearRowsDto> {
  return loadYear(webUser, interventionYear);
}

/** GET /api/v1/approved-lists/:listId */
export async function getApprovedListDetail(webUser: WebJwtPayload, listId: string): Promise<ApprovedListDetailDto> {
  const list = await prisma.approvedList.findFirst({ where: { id: listId, tenantId: webUser.tenantId }, include: LIST_INCLUDE });
  if (!list) throw new AppError('Approved list not found', 404, 'APPROVED_LIST_NOT_FOUND');
  const [tolerancePct, visible, importers] = await Promise.all([
    tenantTolerancePct(webUser.tenantId),
    visibleProjectIds(webUser, linkedIdsOf([list])),
    importerNames([list]),
  ]);
  const kind = kindOf(list.kind);
  const rows = list.rows.map((r) => serializeRow(r, kind, tolerancePct, visible));
  return { ...summarize(list, rows, importers), rows: rows.map((r) => r.dto) };
}

const PROJECT_LINK_SELECT = {
  id: true,
  tenantId: true,
  status: true,
  codePrefix: true,
  interventionYear: true,
  totalBudgetNgn: true,
  approvedListRowId: true,
  approvedListRow: { include: { list: true } },
} satisfies Prisma.ProjectSelect;

type ProjectWithLink = Prisma.ProjectGetPayload<{ select: typeof PROJECT_LINK_SELECT }>;

function serializeLink(project: ProjectWithLink, tolerancePct: number): ProjectApprovedListLinkDto | null {
  const row = project.approvedListRow;
  if (!row) return null;
  const kind = kindOf(row.list.kind);
  const estimate = Number(row.costEstimateNgn);
  return {
    rowId: row.id,
    rowRef: row.rowRef,
    listId: row.listId,
    listTitle: row.list.title,
    kind,
    projectTitle: row.projectTitle,
    costEstimateNgn: estimate,
    mismatch: budgetMismatch(num(project.totalBudgetNgn), estimate, tolerancePct, kind),
  };
}

async function loadProject(projectId: string): Promise<ProjectWithLink> {
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: PROJECT_LINK_SELECT });
  if (!project) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  return project;
}

/** GET /projects/:projectId/approved-list-row */
export async function getProjectApprovedListLink(projectId: string): Promise<ProjectApprovedListLinkDto | null> {
  const project = await loadProject(projectId);
  return serializeLink(project, await tenantTolerancePct(project.tenantId));
}

/**
 * PUT /projects/:projectId/approved-list-row: link (or, with null, unlink) the project's approved
 * list row. Same editors as the setup sections (drafts: `projects:create` or `projects:edit_baseline`;
 * live: `projects:edit_baseline`; archived: read-only). The row must be the tenant's and, when the
 * project has an intervention year, on a list of that year (422 APPROVED_LIST_YEAR_MISMATCH).
 * Audited `APPROVED_LIST_ROW_LINKED` on the project ledger (also for an unlink); no change, no entry.
 */
export async function linkProjectApprovedListRow(
  projectId: string,
  webUser: WebJwtPayload,
  rowId: string | null
): Promise<ProjectApprovedListLinkDto | null> {
  const project = await loadProject(projectId);
  if (project.status === 'ARCHIVED') throw new AppError('This project is archived and read-only', 409, 'PROJECT_ARCHIVED');
  if (project.status === 'ACTIVE' && !hasWebPermission(webUser, 'projects:edit_baseline')) {
    throw new AppError('Editing project settings requires projects:edit_baseline', 403, 'FORBIDDEN_PERMISSION');
  }

  let row: { id: string; rowRef: string; listId: string; costEstimateNgn: Prisma.Decimal; list: { title: string; kind: string; interventionYear: number } } | null = null;
  if (rowId) {
    row = await prisma.approvedListRow.findFirst({
      where: { id: rowId, list: { tenantId: project.tenantId } },
      select: { id: true, rowRef: true, listId: true, costEstimateNgn: true, list: { select: { title: true, kind: true, interventionYear: true } } },
    });
    if (!row) throw new AppError('Approved list row not found', 404, 'APPROVED_LIST_ROW_NOT_FOUND');
    if (project.interventionYear !== null && row.list.interventionYear !== project.interventionYear) {
      throw new AppError(
        `This row is on the ${row.list.interventionYear} list; the project's intervention year is ${project.interventionYear}.`,
        422,
        'APPROVED_LIST_YEAR_MISMATCH'
      );
    }
  }

  const tolerancePct = await tenantTolerancePct(project.tenantId);
  if ((project.approvedListRowId ?? null) === (rowId ?? null)) return serializeLink(project, tolerancePct);

  const previous = project.approvedListRow;
  await prisma.$transaction(async (tx) => {
    await tx.project.update({ where: { id: projectId }, data: { approvedListRowId: rowId } });
    const mismatch = row
      ? budgetMismatch(num(project.totalBudgetNgn), Number(row.costEstimateNgn), tolerancePct, kindOf(row.list.kind))
      : null;
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'APPROVED_LIST_ROW_LINKED',
      summaryText: row
        ? `Linked to row ${row.rowRef} of ${row.list.title}${mismatch?.flagged ? `: ${mismatch.summary}` : ''}.`
        : `Unlinked from row ${previous?.rowRef ?? ''} of ${previous?.list.title ?? 'the approved list'}.`,
      payload: {
        projectStatus: project.status,
        rowId: row?.id ?? null,
        rowRef: row?.rowRef ?? null,
        listId: row?.listId ?? null,
        listKind: row ? kindOf(row.list.kind) : null,
        listKindLabel: row ? APPROVED_LIST_KIND_LABELS[kindOf(row.list.kind)] : null,
        previousRowId: previous?.id ?? null,
        previousRowRef: previous?.rowRef ?? null,
        budgetFlagged: mismatch?.flagged ?? false,
        differencePct: mismatch?.differencePct ?? null,
      },
    });
  });
  return serializeLink(await loadProject(projectId), tolerancePct);
}
