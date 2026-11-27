import { Prisma } from '@prisma/client';
import {
  CostingStandardSchema,
  NIGERIA_STATES,
  NeedsPipelineConfigSchema,
  ParsedNeedsAssessmentSchema,
  ProjectTypeConfigSchema,
  lgaByCode,
  stateByCode,
  zonedCalendarDate,
  type CostingStandard,
  type NeedsPipelineConfig,
  type ParsedNeedsAssessment,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { ensureFacilities } from '../facilities/facilities.service';
import { safeZone } from '../kpis/kpis.service';
import { lockCostingStandardVersionInTx } from '../standards/costingStandards.service';
import type { NeedsWorkbookFacility } from './workbook/needsWorkbook';
import type { Db } from './needsAccess';

/**
 * Needs pipeline wave 2: small readers shared by the cycle, upload and proposal services.
 *
 * Costing standards: Track B1 owns `modules/standards/costingStandards.service.ts`. These read and
 * `CostingStandardVersion` rows directly; locking (decision 6: a version is locked when a cycle opens
 * with it or a needs assessment version names it) goes through that module's advisory-locked helper.
 */

export const dec = (v: Prisma.Decimal | number | null | undefined): number | null => (v === null || v === undefined ? null : Number(v));

/** The frozen pipeline rules of a cycle. */
export function cycleConfig(cycle: { configSnapshotJson: Prisma.JsonValue }): NeedsPipelineConfig {
  return NeedsPipelineConfigSchema.parse(cycle.configSnapshotJson ?? {});
}

/** The live type's whole config (for `needsPipeline` and `ownership`). */
export function typeConfig(type: { configJson: Prisma.JsonValue }) {
  return ProjectTypeConfigSchema.parse(type.configJson ?? {});
}

export interface LoadedCostingStandard {
  id: string;
  version: number;
  standard: CostingStandard;
}

type CostingRow = Prisma.CostingStandardVersionGetPayload<object>;

export function costingStandardOf(row: CostingRow): LoadedCostingStandard {
  const standard = CostingStandardSchema.parse({
    rates: row.ratesJson ?? [],
    zoneFactors: row.zoneFactorsJson ?? {},
    supervisionMonitoringPct: Number(row.supervisionMonitoringPct),
    contingencyPct: Number(row.contingencyPct),
    ceilings: row.ceilingsJson ?? [],
  });
  return { id: row.id, version: row.version, standard };
}

/** The tenant's latest costing standard version; null when the workspace has none. */
export async function latestCostingStandardRow(tenantId: string, db: Db = prisma): Promise<CostingRow | null> {
  return db.costingStandardVersion.findFirst({ where: { tenantId }, orderBy: { version: 'desc' } });
}

export async function costingStandardById(id: string | null, db: Db = prisma): Promise<LoadedCostingStandard | null> {
  if (!id) return null;
  const row = await db.costingStandardVersion.findUnique({ where: { id } });
  return row ? costingStandardOf(row) : null;
}

/** Decision 6: a version in use can no longer be edited. */
export async function lockCostingStandardVersion(tx: Prisma.TransactionClient, id: string): Promise<void> {
  // Under the standards' per-tenant advisory lock, so a save that edits the latest version in place
  // cannot interleave with a cycle or version starting to use it (main thread, wave 2 merge).
  await lockCostingStandardVersionInTx(tx, id);
}

/** Tenant facility catalogue for the template builder and parser (retired ones included). */
export async function workbookFacilities(tenantId: string, db: Db = prisma): Promise<NeedsWorkbookFacility[]> {
  await ensureFacilities(db, tenantId);
  const rows = await db.facility.findMany({ where: { tenantId }, orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }], select: { id: true, code: true, name: true, isRetired: true } });
  return rows;
}

/** Today in the tenant's time zone (YYYY-MM-DD). */
export async function tenantToday(tenantId: string, now = new Date()): Promise<string> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
  return zonedCalendarDate(now, safeZone(tenant?.timezone));
}

/** A stored parse, or an empty one when it no longer reads. */
export function parsedOf(json: Prisma.JsonValue | null | undefined): ParsedNeedsAssessment | null {
  if (!json) return null;
  const r = ParsedNeedsAssessmentSchema.safeParse(json);
  return r.success ? r.data : null;
}

const SUBEB_RE = /SUBEB/i;

/**
 * The State a SUBEB serves: its `stateCode`, else the State named in its name ("Kano State Universal
 * Basic Education Board (SUBEB)"). Null for an organisation that is not a SUBEB.
 */
export function subebStateCode(org: { name: string; stateCode: string | null }): string | null {
  if (!SUBEB_RE.test(org.name)) return null;
  if (org.stateCode && stateByCode(org.stateCode)) return org.stateCode.toUpperCase();
  const name = org.name.toLowerCase();
  const match = NIGERIA_STATES.find((s) => new RegExp(`\\b${s.name.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(name));
  return match?.code ?? null;
}

/**
 * Wave 2 decision 2: the organisation that owns a cycle.
 * - NATIONAL: the type's default owning organisation; else the workspace's root owner organisation.
 * - STATE: the State's SUBEB (an organisation named "…SUBEB…" whose `stateCode` is the State, or,
 *   when no organisation carries the code, whose name names the State; the same lookup as project
 *   parties, D2).
 * Null when none can be found.
 */
export async function deriveCycleOwnerId(
  db: Db,
  tenantId: string,
  type: { configJson: Prisma.JsonValue },
  scope: 'NATIONAL' | 'STATE',
  stateCode: string | null
): Promise<string | null> {
  if (scope === 'STATE') {
    if (!stateCode) return null;
    const orgs = await db.organization.findMany({
      where: { tenantId, isArchived: false, name: { contains: 'SUBEB', mode: 'insensitive' } },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, stateCode: true },
    });
    const code = stateCode.toUpperCase();
    return orgs.find((o) => o.stateCode?.toUpperCase() === code)?.id ?? orgs.find((o) => !o.stateCode && subebStateCode(o) === code)?.id ?? null;
  }
  const config = typeConfig(type);
  const fixed = config.ownership.defaultOwningOrganizationId;
  if (fixed) {
    const org = await db.organization.findFirst({ where: { id: fixed, tenantId, isArchived: false }, select: { id: true } });
    if (org) return org.id;
  }
  const root = await db.organization.findFirst({
    where: { tenantId, parentOrganizationId: null, isArchived: false, categories: { has: 'CLIENT_OWNER' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  return root?.id ?? null;
}

/** A proposal's State: the file's, else the State of its first site's LGA. */
export function stateOfParsed(parsed: ParsedNeedsAssessment): string | null {
  if (parsed.project.stateCode) return parsed.project.stateCode;
  for (const site of parsed.sites) {
    const lga = lgaByCode(site.lgaCode);
    if (lga) return lga.stateCode;
  }
  return null;
}

export const distinctLgas = (parsed: ParsedNeedsAssessment): string[] => [...new Set(parsed.sites.map((s) => s.lgaCode))];

const qty = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** "Classroom ×6, Toilet ×2": proposed quantities by facility, in first-seen order. */
export function facilitiesSummary(
  rows: ReadonlyArray<{ facilityCode: string; proposedQuantity: number }>,
  names: ReadonlyMap<string, string>
): string {
  const totals = new Map<string, number>();
  for (const r of rows) {
    if (!(r.proposedQuantity > 0)) continue;
    const code = r.facilityCode.toUpperCase();
    totals.set(code, (totals.get(code) ?? 0) + r.proposedQuantity);
  }
  return [...totals.entries()].map(([code, n]) => `${names.get(code) ?? code} ×${qty(n)}`).join(', ');
}

export async function facilityNames(tenantId: string, db: Db = prisma): Promise<Map<string, string>> {
  const rows = await db.facility.findMany({ where: { tenantId }, select: { code: true, name: true } });
  return new Map(rows.map((r) => [r.code.toUpperCase(), r.name]));
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The amounts a version carries: preliminary cost = the breakdown rows' costs (BoQ-derived by the
 * parser where a unit has lines), else the BoQ subtotal; costed total = the costing summary's total.
 */
export function versionAmounts(parsed: ParsedNeedsAssessment): { preliminaryCostNgn: number | null; costedTotalNgn: number | null } {
  const rowCosts = parsed.breakdownRows.filter((r) => r.proposedQuantity > 0 && r.preliminaryCostNgn !== null);
  let preliminary: number | null = rowCosts.length ? round2(rowCosts.reduce((s, r) => s + (r.preliminaryCostNgn ?? 0), 0)) : null;
  if (preliminary === null && parsed.boqLines.length) preliminary = round2(parsed.boqLines.reduce((s, l) => s + l.amountNgn, 0));
  if (preliminary === null && parsed.costingSummary) preliminary = parsed.costingSummary.subtotalNgn;
  return { preliminaryCostNgn: preliminary, costedTotalNgn: parsed.costingSummary?.totalNgn ?? null };
}

export const notFound = (what: string, code: string) => new AppError(`${what} not found`, 404, code);
