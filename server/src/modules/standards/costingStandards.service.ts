import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import {
  COSTING_STANDARD_FILE_MAX_BYTES,
  CostingStandardSchema,
  type CostingStandard,
  type CostingStandardChanges,
  type CostingStandardImportConfirmRequest,
  type CostingStandardImportPreviewDto,
  type CostingStandardImportPreviewRequest,
  type CostingStandardSaveResultDto,
  type CostingStandardVersionDto,
  type CostingStandardVersionSummaryDto,
  type NeedsFileIssue,
  type SaveCostingStandardRequest,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { ensureFacilities } from '../facilities/facilities.service';
import { workspaceShortName } from '../scope/scopeImport.service';
import { buildCostingStandardWorkbook, costingStandardFileName, parseCostingStandardWorkbook } from './costingStandardWorkbook';

/**
 * Needs pipeline wave 2 (N2, D-N.8): costing standards, a versioned rate library per tenant.
 *
 * Save rule (wave 2 decision 6): no version yet → v1; the latest version unlocked → edited in place;
 * the latest locked → latest + 1. A version is locked when a cycle opens with it or a needs assessment
 * version names it (`lockCostingStandardVersionInTx`, called by the needs module in that transaction).
 * Saves and locks take the same per-tenant advisory lock, so a version cannot be edited in place
 * while it is being locked. Every save is audited COSTING_STANDARD_SAVED on the tenant ledger.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const lockKey = (tenantId: string) => `costing-standards:${tenantId}`;

async function lockTenantStandards(tx: Tx, tenantId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey(tenantId)}))`;
}

type VersionRow = Prisma.CostingStandardVersionGetPayload<object>;

/** The stored content of a version as a `CostingStandard`. */
export function standardOf(row: VersionRow): CostingStandard {
  return CostingStandardSchema.parse({
    rates: row.ratesJson,
    zoneFactors: row.zoneFactorsJson,
    supervisionMonitoringPct: Number(row.supervisionMonitoringPct),
    contingencyPct: Number(row.contingencyPct),
    ceilings: row.ceilingsJson,
  });
}

function serializeVersion(row: VersionRow, latestVersion: number): CostingStandardVersionDto {
  return {
    id: row.id,
    version: row.version,
    standard: standardOf(row),
    designStandardDocumentIds: row.designStandardDocumentIds,
    note: row.note,
    isLocked: row.isLocked,
    isLatest: row.version === latestVersion,
    savedByName: row.savedByName,
    savedAt: row.savedAt.toISOString(),
  };
}

function summaryOf(row: VersionRow, latestVersion: number, cycleCount: number): CostingStandardVersionSummaryDto {
  const rates = Array.isArray(row.ratesJson) ? row.ratesJson.length : 0;
  const ceilings = Array.isArray(row.ceilingsJson) ? row.ceilingsJson.length : 0;
  return {
    id: row.id,
    version: row.version,
    rateCount: rates,
    ceilingCount: ceilings,
    supervisionMonitoringPct: Number(row.supervisionMonitoringPct),
    contingencyPct: Number(row.contingencyPct),
    note: row.note,
    isLocked: row.isLocked,
    isLatest: row.version === latestVersion,
    cycleCount,
    savedByName: row.savedByName,
    savedAt: row.savedAt.toISOString(),
  };
}

async function latestRow(db: Db, tenantId: string): Promise<VersionRow | null> {
  return db.costingStandardVersion.findFirst({ where: { tenantId }, orderBy: { version: 'desc' } });
}

// ---------------------------------------------------------------------------
// Helpers for other modules (needs pipeline cycles and versions)
// ---------------------------------------------------------------------------

/** The latest version of the tenant's costing standard, or null before the first save. */
export async function getLatestCostingStandard(
  tenantId: string,
  db: Db = prisma
): Promise<{ id: string; version: number; standard: CostingStandard } | null> {
  const row = await latestRow(db, tenantId);
  return row ? { id: row.id, version: row.version, standard: standardOf(row) } : null;
}

/**
 * Locks a version (a cycle opened with it or a needs assessment version names it), inside the caller's
 * transaction and under the tenant's costing standard lock. 404 COSTING_STANDARD_NOT_FOUND when the
 * version does not exist. Idempotent.
 */
export async function lockCostingStandardVersionInTx(tx: Tx, versionId: string): Promise<void> {
  const row = await tx.costingStandardVersion.findUnique({ where: { id: versionId }, select: { tenantId: true, isLocked: true } });
  if (!row) throw new AppError('Costing standard version not found', 404, 'COSTING_STANDARD_NOT_FOUND');
  if (row.isLocked) return;
  await lockTenantStandards(tx, row.tenantId);
  await tx.costingStandardVersion.update({ where: { id: versionId }, data: { isLocked: true } });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listCostingStandardVersions(tenantId: string): Promise<CostingStandardVersionSummaryDto[]> {
  const rows = await prisma.costingStandardVersion.findMany({ where: { tenantId }, orderBy: { version: 'desc' } });
  if (rows.length === 0) return [];
  const counts = await prisma.needsCycle.groupBy({
    by: ['costingStandardVersionId'],
    where: { tenantId, costingStandardVersionId: { in: rows.map((r) => r.id) } },
    _count: { _all: true },
  });
  const countOf = new Map(counts.map((c) => [c.costingStandardVersionId, c._count._all]));
  const latest = rows[0].version;
  return rows.map((r) => summaryOf(r, latest, countOf.get(r.id) ?? 0));
}

export async function getCurrentCostingStandard(tenantId: string): Promise<CostingStandardVersionDto | null> {
  const row = await latestRow(prisma, tenantId);
  return row ? serializeVersion(row, row.version) : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function versionOfTenant(db: Db, tenantId: string, versionId: string): Promise<VersionRow> {
  const row = UUID_RE.test(versionId) ? await db.costingStandardVersion.findFirst({ where: { id: versionId, tenantId } }) : null;
  if (!row) throw new AppError('Costing standard version not found', 404, 'COSTING_STANDARD_NOT_FOUND');
  return row;
}

export async function getCostingStandardVersion(tenantId: string, versionId: string): Promise<CostingStandardVersionDto> {
  const row = await versionOfTenant(prisma, tenantId, versionId);
  const latest = await latestRow(prisma, tenantId);
  return serializeVersion(row, latest?.version ?? row.version);
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

/** The tenant's facility codes: unretired first, in catalogue order. */
async function tenantFacilityCodes(db: Db, tenantId: string): Promise<string[]> {
  await ensureFacilities(db, tenantId);
  const rows = await db.facility.findMany({
    where: { tenantId },
    orderBy: [{ isRetired: 'asc' }, { sortOrder: 'asc' }, { code: 'asc' }],
    select: { code: true },
  });
  return rows.map((r) => r.code);
}

export async function buildCostingStandardTemplate(tenantId: string): Promise<{ buffer: Buffer; fileName: string }> {
  const [tenant, latest] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } }),
    latestRow(prisma, tenantId),
  ]);
  const shortName = workspaceShortName(tenant.name);
  const facilityCodes = await tenantFacilityCodes(prisma, tenantId);
  const buffer = await buildCostingStandardWorkbook({
    generatedAt: new Date(),
    brandName: shortName,
    version: latest?.version ?? null,
    standard: latest ? standardOf(latest) : null,
    facilityCodes,
  });
  return { buffer, fileName: costingStandardFileName(shortName, latest?.version ?? null) };
}

// ---------------------------------------------------------------------------
// Changes and save target
// ---------------------------------------------------------------------------

/** Differences between a standard and the latest version, by item code. */
export function costingStandardChanges(from: CostingStandard, to: CostingStandard): CostingStandardChanges {
  const before = new Map(from.rates.map((r) => [r.itemCode, r]));
  const after = new Map(to.rates.map((r) => [r.itemCode, r]));
  const added = to.rates.filter((r) => !before.has(r.itemCode)).map((r) => r.itemCode);
  const removed = from.rates.filter((r) => !after.has(r.itemCode)).map((r) => r.itemCode);
  const changed: CostingStandardChanges['changed'] = [];
  for (const r of to.rates) {
    const b = before.get(r.itemCode);
    if (!b) continue;
    // A change of description, facility or unit is listed too (with the same rate on both sides).
    if (b.rateNgn !== r.rateNgn || b.description !== r.description || b.facilityCode !== r.facilityCode || b.unitOfMeasure !== r.unitOfMeasure) {
      changed.push({ itemCode: r.itemCode, fromRateNgn: b.rateNgn, toRateNgn: r.rateNgn });
    }
  }
  const ceilingKey = (c: CostingStandard['ceilings'][number]) => `${c.facilityCode}|${c.interventionAction ?? '*'}|${c.maxNgnPerUnit}`;
  const sameCeilings =
    from.ceilings.length === to.ceilings.length &&
    [...from.ceilings.map(ceilingKey)].sort().join('\n') === [...to.ceilings.map(ceilingKey)].sort().join('\n');
  const sameZones = (Object.keys(to.zoneFactors) as Array<keyof CostingStandard['zoneFactors']>).every((k) => from.zoneFactors[k] === to.zoneFactors[k]);
  const settingsChanged =
    from.supervisionMonitoringPct !== to.supervisionMonitoringPct || from.contingencyPct !== to.contingencyPct || !sameZones || !sameCeilings;
  return { added, changed, removed, settingsChanged };
}

const hasChanges = (c: CostingStandardChanges) => c.added.length + c.changed.length + c.removed.length > 0 || c.settingsChanged;

function saveTarget(latest: VersionRow | null): { targetVersion: number; editsLatestInPlace: boolean } {
  if (!latest) return { targetVersion: 1, editsLatestInPlace: false };
  if (!latest.isLocked) return { targetVersion: latest.version, editsLatestInPlace: true };
  return { targetVersion: latest.version + 1, editsLatestInPlace: false };
}

/** Facility codes the standard names that are not in the tenant's catalogue. */
function unknownFacilityIssues(standard: CostingStandard, known: ReadonlySet<string>): NeedsFileIssue[] {
  const out: NeedsFileIssue[] = [];
  standard.rates.forEach((r, i) => {
    if (r.facilityCode && !known.has(r.facilityCode)) {
      out.push({ sheet: 'Rates', row: null, column: 'Facility code', reason: `Rate ${i + 1} (${r.itemCode}): "${r.facilityCode}" is not a facility code of this workspace.` });
    }
  });
  standard.ceilings.forEach((c, i) => {
    if (!known.has(c.facilityCode)) {
      out.push({ sheet: 'Ceilings', row: null, column: 'Facility code', reason: `Ceiling ${i + 1}: "${c.facilityCode}" is not a facility code of this workspace.` });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Save (shared by the JSON save, the in-place edit and the upload confirm)
// ---------------------------------------------------------------------------

interface SaveInput {
  standard: CostingStandard;
  designStandardDocumentIds: string[] | null;
  note: string | null;
  source: 'EDITOR' | 'FILE';
  file?: { fileName: string | null; sha256: string };
  /** PUT /:versionId: only this version, and only while it is the latest and unlocked. */
  editVersionId?: string;
}

async function saveCostingStandard(webUser: WebJwtPayload, input: SaveInput): Promise<CostingStandardSaveResultDto> {
  const tenantId = webUser.tenantId;
  const actorDisplayName = `${webUser.fullName} (${webUser.roleName})`;
  const known = new Set(await tenantFacilityCodes(prisma, tenantId));
  const facilityIssues = unknownFacilityIssues(input.standard, known);
  if (facilityIssues.length) {
    throw new AppError(facilityIssues[0].reason, 422, 'UNKNOWN_FACILITY_CODE', { issues: facilityIssues });
  }

  const result = await prisma.$transaction(
    async (tx) => {
      await lockTenantStandards(tx, tenantId);
      const latest = await latestRow(tx, tenantId);
      if (input.editVersionId) {
        const target = await versionOfTenant(tx, tenantId, input.editVersionId);
        if (!latest || target.id !== latest.id) {
          throw new AppError(`Version ${target.version} is not the latest version: save a new version instead.`, 409, 'COSTING_STANDARD_LOCKED');
        }
        if (target.isLocked) {
          throw new AppError(`Version ${target.version} is in use by a cycle or a needs assessment and cannot be edited: save a new version instead.`, 409, 'COSTING_STANDARD_LOCKED');
        }
      }

      let designIds = input.designStandardDocumentIds ?? latest?.designStandardDocumentIds ?? [];
      designIds = [...new Set(designIds)];
      if (designIds.length) {
        const found = await tx.designStandardDocument.count({ where: { tenantId, id: { in: designIds } } });
        if (found !== designIds.length) throw new AppError('A design standard document was not found', 422, 'DESIGN_STANDARD_DOCUMENT_NOT_FOUND');
      }

      const s = input.standard;
      const content = {
        ratesJson: s.rates as unknown as Prisma.InputJsonValue,
        zoneFactorsJson: s.zoneFactors as unknown as Prisma.InputJsonValue,
        supervisionMonitoringPct: s.supervisionMonitoringPct,
        contingencyPct: s.contingencyPct,
        ceilingsJson: s.ceilings as unknown as Prisma.InputJsonValue,
        designStandardDocumentIds: designIds,
        note: input.note,
        savedByUserId: webUser.userId,
        savedByName: webUser.fullName,
        savedAt: new Date(),
      };
      const { editsLatestInPlace } = saveTarget(latest);
      const changes = latest ? costingStandardChanges(standardOf(latest), s) : null;
      const row =
        editsLatestInPlace && latest
          ? await tx.costingStandardVersion.update({ where: { id: latest.id }, data: content })
          : await tx.costingStandardVersion.create({ data: { tenantId, version: (latest?.version ?? 0) + 1, ...content } });
      const created = !editsLatestInPlace;
      const from = input.file ? ` from "${input.file.fileName ?? 'the uploaded file'}"` : '';
      await recordAuditEvent(tx, {
        tenantId,
        projectId: null,
        actorType: 'WEB_USER',
        actorId: webUser.userId,
        actorDisplayName,
        action: 'COSTING_STANDARD_SAVED',
        summaryText: created
          ? `Saved costing standard version ${row.version}${from}: ${s.rates.length} rate(s), ${s.ceilings.length} ceiling(s).`
          : `Edited costing standard version ${row.version}${from}: ${s.rates.length} rate(s), ${s.ceilings.length} ceiling(s).`,
        payload: {
          costingStandardVersionId: row.id,
          version: row.version,
          created,
          editedInPlace: !created,
          source: input.source,
          rateCount: s.rates.length,
          ceilingCount: s.ceilings.length,
          supervisionMonitoringPct: s.supervisionMonitoringPct,
          contingencyPct: s.contingencyPct,
          note: input.note,
          changes: changes
            ? { added: changes.added.length, changed: changes.changed.length, removed: changes.removed.length, settingsChanged: changes.settingsChanged }
            : null,
          ...(input.file ? { fileName: input.file.fileName, sha256: input.file.sha256 } : {}),
        },
      });
      return { row, latestVersion: row.version, created };
    },
    { timeout: 60_000, maxWait: 15_000 }
  );
  return { version: serializeVersion(result.row, result.latestVersion), createdNewVersion: result.created };
}

export function saveCostingStandardFromEditor(webUser: WebJwtPayload, input: SaveCostingStandardRequest): Promise<CostingStandardSaveResultDto> {
  return saveCostingStandard(webUser, {
    standard: input.standard,
    designStandardDocumentIds: input.designStandardDocumentIds,
    note: input.note,
    source: 'EDITOR',
  });
}

export function editCostingStandardVersion(webUser: WebJwtPayload, versionId: string, input: SaveCostingStandardRequest): Promise<CostingStandardSaveResultDto> {
  return saveCostingStandard(webUser, {
    standard: input.standard,
    designStandardDocumentIds: input.designStandardDocumentIds,
    note: input.note,
    source: 'EDITOR',
    editVersionId: versionId,
  });
}

// ---------------------------------------------------------------------------
// Upload: preview → confirm
// ---------------------------------------------------------------------------

function decode(fileBase64: string): Buffer {
  const buffer = Buffer.from(fileBase64, 'base64');
  if (buffer.length === 0) throw new AppError('The file is empty', 400, 'EMPTY_FILE');
  if (buffer.length > COSTING_STANDARD_FILE_MAX_BYTES) throw new AppError('The costing standard file is larger than 5 MB', 413, 'FILE_TOO_LARGE');
  return buffer;
}

const sha256Of = (buffer: Buffer) => crypto.createHash('sha256').update(buffer).digest('hex');

async function analyse(tenantId: string, buffer: Buffer): Promise<CostingStandardImportPreviewDto> {
  const known = new Set(await tenantFacilityCodes(prisma, tenantId));
  const parsed = await parseCostingStandardWorkbook(buffer, { facilityCodes: known });
  const latest = await latestRow(prisma, tenantId);
  const warnings = [...parsed.warnings];
  if (latest && parsed.builtFromVersion !== null && parsed.builtFromVersion !== latest.version) {
    warnings.push({
      sheet: 'Instructions',
      row: null,
      column: 'Built from',
      reason: `The file was built from version ${parsed.builtFromVersion}; the latest version is ${latest.version}. Changes are shown against the latest version.`,
    });
  }
  const changes = parsed.standard && latest ? costingStandardChanges(standardOf(latest), parsed.standard) : null;
  if (changes && !hasChanges(changes)) {
    warnings.push({ sheet: '', row: null, column: null, reason: `The file is the same as version ${latest!.version}: saving changes nothing but the note.` });
  }
  return {
    sha256: sha256Of(buffer),
    standard: parsed.standard,
    issues: parsed.issues,
    warnings,
    changes,
    ...saveTarget(latest),
  };
}

export async function previewCostingStandardImport(webUser: WebJwtPayload, input: CostingStandardImportPreviewRequest): Promise<CostingStandardImportPreviewDto> {
  return analyse(webUser.tenantId, decode(input.fileBase64));
}

export async function confirmCostingStandardImport(webUser: WebJwtPayload, input: CostingStandardImportConfirmRequest): Promise<CostingStandardSaveResultDto> {
  const buffer = decode(input.fileBase64);
  const sha256 = sha256Of(buffer);
  if (sha256 !== input.sha256) {
    throw new AppError('This is not the file that was checked. Upload it again before saving.', 409, 'COSTING_STANDARD_FILE_CHANGED');
  }
  const known = new Set(await tenantFacilityCodes(prisma, webUser.tenantId));
  const parsed = await parseCostingStandardWorkbook(buffer, { facilityCodes: known });
  if (!parsed.standard) {
    throw new AppError(
      `The costing standard has ${parsed.issues.length} error(s). Fix them and upload it again.`,
      422,
      'COSTING_STANDARD_IMPORT_INVALID',
      { issues: parsed.issues }
    );
  }
  return saveCostingStandard(webUser, {
    standard: parsed.standard,
    designStandardDocumentIds: null,
    note: input.note,
    source: 'FILE',
    file: { fileName: input.fileName ?? null, sha256 },
  });
}
