import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import {
  APPROVED_LIST_KIND_LABELS,
  APPROVED_LIST_MAX_BYTES,
  APPROVED_LIST_SHEETS,
  ApprovedListImportConfirmRequest,
  ApprovedListImportPreviewDto,
  ApprovedListImportPreviewRequest,
  ApprovedListImportPreviewRow,
  ApprovedListImportResultDto,
  ApprovedListIssue,
  ApprovedListKind,
  ApprovedListLinkedProject,
  budgetMismatch,
  formatProjectCode,
  parseLotBatchCode,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { workspaceShortName } from '../scope/scopeImport.service';
import {
  getApprovedListDetail,
  LINKED_PROJECT_SELECT,
  linkedProject,
  matchStatusOf,
  num,
  tenantTolerancePct,
  visibleProjectIds,
  type LinkedProjectRow,
} from './approvedLists.service';
import {
  approvedListTemplateFileName,
  buildApprovedListWorkbook,
  parseApprovedListWorkbook,
  rowRefKey,
  type ParsedApprovedListHeader,
  type ParsedApprovedListRow,
} from './approvedListWorkbook';

/**
 * Client demo updates E3 (wave 4, decisions W4.2/W4.3): upload of an annual approved list from the
 * template, modelled on the project register import.
 * - Template: Instructions (version stamp), List (header fields), Rows, hidden Lists.
 * - Preview: parses the file, finds the list it replaces (same tenant, intervention year, kind and
 *   State; DI: no State), matches rows by row ref (NEW / UPDATED / UNCHANGED), resolves the Project ID
 *   column and shows every row's links, match status and budget mismatch as they will be; nothing is
 *   written.
 * - Confirm: same bytes (sha256) or 409; one transaction under a per-tenant advisory lock; the file is
 *   analysed again inside it and any error refuses the whole file (422). Kept rows keep their id (so
 *   their links survive), rows missing from the file are deleted after their projects are unlinked,
 *   Project ID links are applied. Every link change is audited APPROVED_LIST_ROW_LINKED on the
 *   project's ledger; the upload is audited APPROVED_LIST_IMPORTED on the tenant ledger.
 *
 * Project ID: the project's stored code ("2026-LOT-5-BATCH-7"), its code as shown ("LOT 5 BATCH 7";
 * when that names projects of several years, the one of the list's year), or its client project ID;
 * case and spaces ignored. Only projects the uploader can see are found. A Project ID adds the project
 * to the row's links (moving it from any other row); the row's other links stay.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const S = APPROVED_LIST_SHEETS;
const ADVISORY_KEY = (tenantId: string) => `approved-lists:${tenantId}`;

const EXISTING_ROW_SELECT = {
  id: true,
  rowRef: true,
  projectTitle: true,
  schoolNamesJson: true,
  stateCode: true,
  lgaCodes: true,
  facilityScope: true,
  costEstimateNgn: true,
  lotTitle: true,
  sortOrder: true,
  projects: { select: { ...LINKED_PROJECT_SELECT, status: true }, orderBy: { codePrefix: 'asc' } },
} satisfies Prisma.ApprovedListRowSelect;
type ExistingRow = Prisma.ApprovedListRowGetPayload<{ select: typeof EXISTING_ROW_SELECT }>;

const REF_PROJECT_SELECT = {
  ...LINKED_PROJECT_SELECT,
  status: true,
  externalReference: true,
  approvedListRowId: true,
  approvedListRow: { select: { id: true, rowRef: true, listId: true, list: { select: { title: true } } } },
} satisfies Prisma.ProjectSelect;
type RefProject = Prisma.ProjectGetPayload<{ select: typeof REF_PROJECT_SELECT }>;

interface PlannedRow {
  parsed: ParsedApprovedListRow;
  existing: ExistingRow | null;
  /** The project the Project ID column names (resolved), or null. */
  project: RefProject | null;
  sortOrder: number;
  /** Every project linked once imported (visible or not). */
  after: LinkedProjectRow[];
  preview: ApprovedListImportPreviewRow;
}

interface Analysis {
  preview: ApprovedListImportPreviewDto;
  header: ParsedApprovedListHeader;
  existingList: { id: string; title: string } | null;
  plan: PlannedRow[];
  /** Existing rows not in the file, with the projects that end up unlinked. */
  removed: Array<{ row: ExistingRow; unlinked: ExistingRow['projects'] }>;
  tolerancePct: number;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

export async function buildApprovedListTemplate(tenantId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
  const shortName = workspaceShortName(tenant.name);
  const buffer = await buildApprovedListWorkbook({ generatedAt: new Date(), brandName: shortName });
  return { buffer, fileName: approvedListTemplateFileName(shortName) };
}

// ---------------------------------------------------------------------------
// Analysis (shared by preview and confirm)
// ---------------------------------------------------------------------------

function decode(fileBase64: string): Buffer {
  const buffer = Buffer.from(fileBase64, 'base64');
  if (buffer.length > APPROVED_LIST_MAX_BYTES) throw new AppError('The approved list file is larger than 10 MB', 413, 'FILE_TOO_LARGE');
  if (buffer.length === 0) throw new AppError('The file is empty', 400, 'EMPTY_FILE');
  return buffer;
}

const sha256Of = (buffer: Buffer) => crypto.createHash('sha256').update(buffer).digest('hex');
const refKey = (s: string) => s.replace(/\s+/g, '').toUpperCase();

function schoolNamesOf(json: Prisma.JsonValue): string[] {
  return Array.isArray(json) ? json.filter((s): s is string => typeof s === 'string') : [];
}

/** Did any value of a kept row change? (Links are not values: they show separately.) */
function rowChanged(existing: ExistingRow, row: ParsedApprovedListRow): boolean {
  return (
    existing.rowRef !== row.rowRef ||
    existing.projectTitle !== row.projectTitle ||
    JSON.stringify(schoolNamesOf(existing.schoolNamesJson)) !== JSON.stringify(row.schoolNames) ||
    existing.stateCode !== row.stateCode ||
    existing.lgaCodes.join('|') !== row.lgaCodes.join('|') ||
    (existing.facilityScope ?? null) !== (row.facilityScope ?? null) ||
    Number(existing.costEstimateNgn) !== row.costEstimateNgn ||
    (existing.lotTitle ?? null) !== (row.lotTitle ?? null)
  );
}

/** The list a file replaces: same tenant, year, kind and State (DI: none). No unique key: the oldest wins. */
async function findExistingList(db: Db, tenantId: string, header: ParsedApprovedListHeader) {
  if (header.interventionYear === null || !header.kind) return null;
  if (header.kind === 'MG_BEAP' && !header.stateCode) return null;
  return db.approvedList.findFirst({
    where: {
      tenantId,
      interventionYear: header.interventionYear,
      kind: header.kind,
      stateCode: header.kind === 'MG_BEAP' ? header.stateCode : null,
    },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      title: true,
      importedAt: true,
      rows: { select: EXISTING_ROW_SELECT, orderBy: [{ sortOrder: 'asc' }, { rowRef: 'asc' }] },
    },
  });
}

/** Resolves Project ID texts to the tenant's projects (null = not found; a string = ambiguous). */
async function resolveProjectRefs(
  db: Db,
  webUser: WebJwtPayload,
  refs: string[],
  listYear: number | null
): Promise<Map<string, RefProject | null | 'AMBIGUOUS'>> {
  const out = new Map<string, RefProject | null | 'AMBIGUOUS'>();
  if (refs.length === 0) return out;
  const projects = await db.project.findMany({ where: { tenantId: webUser.tenantId }, select: REF_PROJECT_SELECT });
  const visible = await visibleProjectIds(
    webUser,
    projects.map((p) => p.id)
  );
  const seen = projects.filter((p) => visible.has(p.id));
  for (const ref of refs) {
    const key = refKey(ref);
    const exact = seen.filter((p) => refKey(p.codePrefix) === key);
    if (exact.length === 1) {
      out.set(ref, exact[0]);
      continue;
    }
    let shown = seen.filter((p) => refKey(formatProjectCode(p.codePrefix)) === key);
    if (shown.length > 1 && listYear !== null) {
      // "LOT 1 BATCH 1" exists in every year: take the list's year.
      shown = shown.filter((p) => (p.interventionYear ?? parseLotBatchCode(p.codePrefix)?.year ?? null) === listYear);
    }
    if (shown.length === 1) {
      out.set(ref, shown[0]);
      continue;
    }
    if (shown.length > 1) {
      out.set(ref, 'AMBIGUOUS');
      continue;
    }
    const lower = ref.trim().toLowerCase();
    const byExternal = seen.filter((p) => p.externalReference && p.externalReference.trim().toLowerCase() === lower);
    out.set(ref, byExternal.length === 1 ? byExternal[0] : byExternal.length > 1 ? 'AMBIGUOUS' : null);
  }
  return out;
}

async function analyse(db: Db, webUser: WebJwtPayload, buffer: Buffer, fileName: string | null): Promise<Analysis> {
  const tenantId = webUser.tenantId;
  const parsed = await parseApprovedListWorkbook(buffer);
  const { header } = parsed;
  const kind: ApprovedListKind = header.kind ?? 'DI_SCHEDULE';
  const [tolerancePct, existingList] = await Promise.all([tenantTolerancePct(tenantId), findExistingList(db, tenantId, header)]);
  const refs = [...new Set(parsed.rows.map((r) => r.projectRef).filter((r): r is string => Boolean(r)))];
  const resolved = await resolveProjectRefs(db, webUser, refs, header.interventionYear);

  const existingByKey = new Map<string, ExistingRow>();
  for (const r of existingList?.rows ?? []) {
    // Refs that differ only in case or spacing (possible on a seeded list): the first is kept, the others removed.
    const key = rowRefKey(r.rowRef);
    if (!existingByKey.has(key)) existingByKey.set(key, r);
  }

  // 1. Each row's existing row and named project.
  const namedOn = new Map<string, number>();
  const rows = parsed.rows.map((r, i) => {
    const existing = r.rowRef ? (existingByKey.get(rowRefKey(r.rowRef)) ?? null) : null;
    let project: RefProject | null = null;
    const bad = (code: string, message: string) => r.issues.push({ sheet: S.rows, row: r.row, column: 'Project ID', code, message: `Row ${r.row}: ${message}` });
    const warn = (code: string, message: string) => r.warnings.push({ sheet: S.rows, row: r.row, column: 'Project ID', code, message: `Row ${r.row}: ${message}` });
    if (r.projectRef) {
      const hit = resolved.get(r.projectRef);
      if (hit === 'AMBIGUOUS') bad('PROJECT_AMBIGUOUS', `"${r.projectRef}" matches more than one project: use the full code (e.g. 2026-LOT-5-BATCH-7) or the client project ID.`);
      else if (!hit) bad('PROJECT_NOT_FOUND', `No project "${r.projectRef}" was found (code or client project ID).`);
      else {
        const label = `${formatProjectCode(hit.codePrefix)} "${hit.name}"`;
        const first = namedOn.get(hit.id);
        const changes = !existing || hit.approvedListRowId !== existing.id;
        if (first !== undefined) bad('PROJECT_ON_TWO_ROWS', `${label} is also named on row ${first}; a project links to one row.`);
        else if (hit.interventionYear !== null && header.interventionYear !== null && hit.interventionYear !== header.interventionYear) {
          bad('APPROVED_LIST_YEAR_MISMATCH', `${label} has intervention year ${hit.interventionYear}; this list is for ${header.interventionYear}.`);
        } else if (hit.status === 'ARCHIVED' && changes) bad('PROJECT_ARCHIVED', `${label} is archived and cannot be linked to another row.`);
        else {
          project = hit;
          if (changes && hit.approvedListRow) {
            const sameList = existingList && hit.approvedListRow.listId === existingList.id;
            warn(
              'PROJECT_MOVES',
              sameList
                ? `${label} moves from row ${hit.approvedListRow.rowRef} of this list.`
                : `${label} is linked to row ${hit.approvedListRow.rowRef} of ${hit.approvedListRow.list.title}; it moves to this row.`
            );
          }
        }
        if (first === undefined) namedOn.set(hit.id, r.row);
      }
    }
    return { parsed: r, existing, project, sortOrder: (i + 1) * 10 };
  });

  // 2. Links as they will be: kept links minus projects the file moves elsewhere, plus the named project.
  const movedIds = new Set(rows.flatMap((r) => (r.project ? [r.project.id] : [])));
  const keptRowIds = new Set(rows.flatMap((r) => (r.existing ? [r.existing.id] : [])));
  const allIds = new Set<string>([...movedIds]);
  for (const r of existingList?.rows ?? []) for (const p of r.projects) allIds.add(p.id);
  const visible = await visibleProjectIds(webUser, [...allIds]);

  const plan: PlannedRow[] = rows.map((r) => {
    const kept = (r.existing?.projects ?? []).filter((p) => !movedIds.has(p.id) || p.id === r.project?.id);
    const after: LinkedProjectRow[] = [...kept];
    if (r.project && !after.some((p) => p.id === r.project!.id)) after.push(r.project);
    const estimate = r.parsed.costEstimateNgn;
    const linked: ApprovedListLinkedProject[] = estimate === null ? [] : after.map((p) => linkedProject(p, estimate, tolerancePct, kind));
    const action: ApprovedListImportPreviewRow['action'] = !r.existing ? 'NEW' : rowChanged(r.existing, r.parsed) ? 'UPDATED' : 'UNCHANGED';
    return {
      ...r,
      after,
      preview: {
        row: r.parsed.row,
        rowRef: r.parsed.rowRef,
        projectTitle: r.parsed.projectTitle,
        schoolNames: r.parsed.schoolNames,
        stateCode: r.parsed.stateCode,
        lgaCodes: r.parsed.lgaCodes,
        facilityScope: r.parsed.facilityScope,
        costEstimateNgn: estimate,
        lotTitle: r.parsed.lotTitle,
        action,
        // FROM_FILE only when the Project ID resolved: a refused one leaves the current links in place.
        linkSource: r.project ? 'FROM_FILE' : kept.length ? 'KEPT' : 'NONE',
        linkedProjects: linked.filter((p) => visible.has(p.id)),
        matchStatus: estimate === null ? (after.length ? (after.length > 1 ? 'MULTIPLE' : 'LINKED') : 'NOT_LINKED') : matchStatusOf(linked),
        issues: r.parsed.issues,
        warnings: r.parsed.warnings,
      },
    };
  });

  // 3. Rows not in the file: removed, their projects unlinked (unless the file moves them).
  const removalIssues: ApprovedListIssue[] = [];
  const removed = (existingList?.rows ?? [])
    .filter((r) => !keptRowIds.has(r.id))
    .map((row) => {
      const unlinked = row.projects.filter((p) => !movedIds.has(p.id));
      for (const p of unlinked.filter((x) => x.status === 'ARCHIVED')) {
        removalIssues.push({
          sheet: S.rows,
          row: null,
          column: 'Row ref',
          code: 'REMOVED_ROW_ARCHIVED_PROJECT',
          message: `Row ${row.rowRef} is not in the file, but archived project ${formatProjectCode(p.codePrefix)} is linked to it: keep the row.`,
        });
      }
      return { row, unlinked };
    });

  const issues = [...parsed.issues, ...removalIssues, ...plan.flatMap((p) => p.preview.issues)];
  const warnings = [...parsed.warnings, ...plan.flatMap((p) => p.preview.warnings)];
  const preview: ApprovedListImportPreviewDto = {
    fileName,
    sha256: sha256Of(buffer),
    version: parsed.version,
    list: {
      interventionYear: header.interventionYear,
      kind: header.kind,
      stateCode: header.stateCode,
      title: header.title,
      approvedBy: header.approvedBy,
      approvedOn: header.approvedOn,
    },
    replaces: existingList
      ? { listId: existingList.id, title: existingList.title, rowCount: existingList.rows.length, importedAt: existingList.importedAt?.toISOString() ?? null }
      : null,
    rows: plan.map((p) => p.preview),
    removedRows: removed.map(({ row, unlinked }) => ({
      rowRef: row.rowRef,
      projectTitle: row.projectTitle,
      linkedProjects: unlinked.filter((p) => visible.has(p.id)).map((p) => linkedProject(p, Number(row.costEstimateNgn), tolerancePct, kind)),
    })),
    issues,
    warnings,
    totals: {
      rowCount: plan.length,
      newCount: plan.filter((p) => p.preview.action === 'NEW').length,
      updatedCount: plan.filter((p) => p.preview.action === 'UPDATED').length,
      unchangedCount: plan.filter((p) => p.preview.action === 'UNCHANGED').length,
      removedCount: removed.length,
      linkedCount: plan.filter((p) => p.after.length > 0).length,
      mismatchCount: plan.reduce(
        (n, p) =>
          n + (p.parsed.costEstimateNgn === null ? 0 : p.after.filter((x) => budgetMismatch(num(x.totalBudgetNgn), p.parsed.costEstimateNgn!, tolerancePct, kind).flagged).length),
        0
      ),
      totalEstimateNgn: plan.reduce((s, p) => s + (p.parsed.costEstimateNgn ?? 0), 0),
      rowsWithErrors: plan.filter((p) => p.preview.issues.length > 0).length,
    },
    canConfirm: issues.length === 0 && plan.length > 0,
  };
  return {
    preview,
    header,
    existingList: existingList ? { id: existingList.id, title: existingList.title } : null,
    plan,
    removed,
    tolerancePct,
  };
}

export async function previewApprovedListImport(webUser: WebJwtPayload, input: ApprovedListImportPreviewRequest): Promise<ApprovedListImportPreviewDto> {
  return (await analyse(prisma, webUser, decode(input.fileBase64), input.fileName ?? null)).preview;
}

// ---------------------------------------------------------------------------
// Confirm
// ---------------------------------------------------------------------------

export async function confirmApprovedListImport(webUser: WebJwtPayload, input: ApprovedListImportConfirmRequest): Promise<ApprovedListImportResultDto> {
  const buffer = decode(input.fileBase64);
  const sha256 = sha256Of(buffer);
  if (sha256 !== input.sha256) {
    throw new AppError('This is not the file that was checked. Upload it again before saving.', 409, 'APPROVED_LIST_FILE_CHANGED');
  }
  const tenantId = webUser.tenantId;
  const fileName = input.fileName ?? null;
  const actor = { actorType: 'WEB_USER' as const, actorId: webUser.userId, actorDisplayName: `${webUser.fullName} (${webUser.roleName})` };

  const result = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ADVISORY_KEY(tenantId)}))`;
      const a = await analyse(tx, webUser, buffer, fileName);
      if (!a.preview.canConfirm) {
        throw new AppError(
          a.preview.issues.length
            ? `The approved list has ${a.preview.issues.length} error(s). Fix them and upload it again.`
            : 'The approved list has no rows.',
          422,
          'APPROVED_LIST_IMPORT_INVALID',
          { issues: a.preview.issues }
        );
      }
      const h = a.header;
      const kind = h.kind!;
      const now = new Date();
      const headerData = {
        title: h.title!,
        approvedBy: h.approvedBy!,
        approvedOn: h.approvedOn!,
        sourceFileName: fileName,
        sourceSha256: sha256,
        importedAt: now,
        importedById: webUser.userId,
      };
      const list = a.existingList
        ? await tx.approvedList.update({ where: { id: a.existingList.id }, data: headerData })
        : await tx.approvedList.create({
            data: { tenantId, interventionYear: h.interventionYear!, kind, stateCode: kind === 'MG_BEAP' ? h.stateCode : null, ...headerData },
          });
      let relinked = 0;

      // Rows not in the file: unlink their projects (audited), then delete them.
      for (const { row, unlinked } of a.removed) {
        for (const p of unlinked) {
          await tx.project.update({ where: { id: p.id }, data: { approvedListRowId: null } });
          await recordAuditEvent(tx, {
            projectId: p.id,
            ...actor,
            action: 'APPROVED_LIST_ROW_LINKED',
            summaryText: `Unlinked from row ${row.rowRef} of ${list.title}: the row is not on the uploaded list${fileName ? ` "${fileName}"` : ''}.`,
            payload: {
              projectStatus: p.status,
              rowId: null,
              rowRef: null,
              listId: null,
              listKind: null,
              listKindLabel: null,
              previousRowId: row.id,
              previousRowRef: row.rowRef,
              budgetFlagged: false,
              differencePct: null,
              source: 'APPROVED_LIST_IMPORT',
              sha256,
            },
          });
          relinked++;
        }
      }
      if (a.removed.length) await tx.approvedListRow.deleteMany({ where: { id: { in: a.removed.map((r) => r.row.id) } } });

      // Rows of the file: kept rows updated in place (same id), new rows created.
      for (const p of a.plan) {
        const data = {
          rowRef: p.parsed.rowRef!,
          projectTitle: p.parsed.projectTitle!,
          schoolNamesJson: p.parsed.schoolNames,
          stateCode: p.parsed.stateCode!,
          lgaCodes: p.parsed.lgaCodes,
          facilityScope: p.parsed.facilityScope,
          costEstimateNgn: p.parsed.costEstimateNgn!,
          lotTitle: p.parsed.lotTitle,
          sortOrder: p.sortOrder,
        };
        const rowId = p.existing
          ? (await tx.approvedListRow.update({ where: { id: p.existing.id }, data, select: { id: true } })).id
          : (await tx.approvedListRow.create({ data: { listId: list.id, ...data }, select: { id: true } })).id;

        // Project ID links.
        const project = p.project;
        if (!project || project.approvedListRowId === rowId) continue;
        await tx.project.update({ where: { id: project.id }, data: { approvedListRowId: rowId } });
        const mismatch = budgetMismatch(num(project.totalBudgetNgn), p.parsed.costEstimateNgn!, a.tolerancePct, kind);
        const previous = project.approvedListRow;
        await recordAuditEvent(tx, {
          projectId: project.id,
          ...actor,
          action: 'APPROVED_LIST_ROW_LINKED',
          summaryText:
            `Linked to row ${p.parsed.rowRef} of ${list.title} by the approved list upload${fileName ? ` "${fileName}"` : ''}` +
            `${previous ? ` (was row ${previous.rowRef} of ${previous.list.title})` : ''}${mismatch.flagged ? `: ${mismatch.summary}` : ''}.`,
          payload: {
            projectStatus: project.status,
            rowId,
            rowRef: p.parsed.rowRef,
            listId: list.id,
            listKind: kind,
            listKindLabel: APPROVED_LIST_KIND_LABELS[kind],
            previousRowId: previous?.id ?? null,
            previousRowRef: previous?.rowRef ?? null,
            budgetFlagged: mismatch.flagged,
            differencePct: mismatch.differencePct,
            source: 'APPROVED_LIST_IMPORT',
            sha256,
          },
        });
        relinked++;
      }

      const t = a.preview.totals;
      await recordAuditEvent(tx, {
        tenantId,
        projectId: null,
        ...actor,
        action: 'APPROVED_LIST_IMPORTED',
        summaryText:
          `${a.existingList ? 'Replaced' : 'Uploaded'} ${list.title}${fileName ? ` from "${fileName}"` : ''}: ${t.rowCount} row(s) ` +
          `(${t.newCount} new, ${t.updatedCount} updated, ${t.unchangedCount} unchanged, ${t.removedCount} removed); ${relinked} project link(s) changed.`,
        payload: {
          listId: list.id,
          created: !a.existingList,
          interventionYear: list.interventionYear,
          kind,
          stateCode: list.stateCode,
          title: list.title,
          fileName,
          sha256,
          version: a.preview.version,
          totals: t,
          relinkedProjectCount: relinked,
          removedRowRefs: a.removed.map((r) => r.row.rowRef),
        },
      });
      return { listId: list.id, created: !a.existingList, totals: t, relinked };
    },
    { timeout: 120_000, maxWait: 15_000 }
  );

  return {
    list: await getApprovedListDetail(webUser, result.listId),
    created: result.created,
    newCount: result.totals.newCount,
    updatedCount: result.totals.updatedCount,
    removedCount: result.totals.removedCount,
    relinkedProjectCount: result.relinked,
  };
}
