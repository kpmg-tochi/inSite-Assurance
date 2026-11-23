import {
  defaultKpiPeriod,
  KPI_CATALOGUE,
  KpiDashboardDto,
  KpiDashboardKpi,
  KpiDefinition,
  KpiKey,
  KpiPeriod,
  KpiProjectCell,
  KpiProjectRow,
  KpiQuery,
  KpiStatus,
  kpiStatus,
  KpiTypeBreakdown,
  kpiValue,
  KpiValueDto,
  ProjectKpisDto,
  ProjectTypeConfigSchema,
  resolveKpiTargets,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { AppError } from '../../middleware/error.middleware';
import { buildProjectVisibilityWhere } from '../../utils/accessControl';
import { deliveryModelFilterWhere } from '../projects/projects.service';
import { computeProjectKpis, KpiCount, sumCounts } from './kpiEngine';
import { KPI_PROJECT_SELECT, loadKpiFacts, monthEnd, recentMonthStarts } from './kpiFacts';

/**
 * Programme KPIs (Phase 16): the dashboard over the projects a user can see, one project's KPIs,
 * and the daily snapshots behind the trend lines.
 *
 * Targets and visibility come from the project's current project type (`kpiTargets`), not from
 * the project's type snapshot: targets are reporting settings, so a changed target applies to
 * every project of the type at once. Projects without a type use the catalogue defaults.
 */

/** Used only when a tenant has no valid time zone. */
export const FALLBACK_KPI_ZONE = 'Africa/Lagos';

/** A zone name the runtime accepts, or the fallback. */
export function safeZone(zone: string | null | undefined): string {
  if (!zone) return FALLBACK_KPI_ZONE;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: zone });
    return zone;
  } catch {
    return FALLBACK_KPI_ZONE;
  }
}

/** The tenant time zone KPI periods are read in (`Tenant.timezone`). */
export async function tenantKpiZone(tenantId: string): Promise<string> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
  return safeZone(tenant?.timezone);
}
const TREND_MONTHS = 6;

type Targets = ReturnType<typeof resolveKpiTargets>;

/** The period of a query in the tenant's zone: the default is the tenant's current month to date. */
export function resolvePeriod(query: Pick<KpiQuery, 'from' | 'to'>, zone: string, now: Date = new Date()): KpiPeriod {
  const today = zonedCalendarDate(now, zone);
  const fallback = defaultKpiPeriod(today);
  const from = query.from ?? (query.to ? `${query.to.slice(0, 7)}-01` : fallback.from);
  const to = query.to ?? (from > today ? monthEnd(`${from.slice(0, 7)}-01`) : today);
  if (from > to) throw new AppError('The period must start before it ends', 400, 'INVALID_KPI_PERIOD');
  return { from, to };
}

async function targetsByType(tenantIds: string[]): Promise<Map<string, Targets>> {
  const types = await prisma.projectType.findMany({ where: { tenantId: { in: tenantIds } }, select: { id: true, configJson: true } });
  const out = new Map<string, Targets>();
  for (const t of types) {
    const parsed = ProjectTypeConfigSchema.safeParse(t.configJson ?? {});
    out.set(t.id, resolveKpiTargets(parsed.success ? parsed.data.kpiTargets : null));
  }
  return out;
}

const DEFAULT_TARGETS = resolveKpiTargets(null);

function cellFor(def: KpiDefinition, count: KpiCount, target: number | null): KpiProjectCell {
  const value = kpiValue(def, count.numerator, count.denominator);
  return { status: kpiStatus(def, true, value, target), value, numerator: round4(count.numerator), denominator: round4(count.denominator), target };
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000;

/** One target if every project agrees on it; null (and varies) otherwise. */
function commonTarget(targets: Array<number | null>): { target: number | null; varies: boolean } {
  const distinct = [...new Set(targets)];
  if (distinct.length === 1) return { target: distinct[0], varies: false };
  return { target: null, varies: distinct.length > 1 };
}

function aggregateValue(def: KpiDefinition, counts: Array<KpiCount | null>, targets: Array<number | null>): KpiValueDto {
  const sum = sumCounts(counts);
  const { target, varies } = commonTarget(targets);
  const value = kpiValue(def, sum.numerator, sum.denominator);
  // With differing targets there is no single status; the per-type breakdown carries them.
  const status: KpiStatus = kpiStatus(def, sum.tracked > 0, value, target);
  return {
    key: def.key,
    status,
    value,
    numerator: round4(sum.numerator),
    denominator: round4(sum.denominator),
    target,
    targetVaries: varies,
    trackedProjectCount: sum.tracked,
  };
}

const PROJECT_ROW_SELECT = {
  ...KPI_PROJECT_SELECT,
  tenantId: true,
  codePrefix: true,
  name: true,
  projectTypeId: true,
  projectType: { select: { name: true } },
  region: { select: { name: true } },
  owningOrganization: { select: { id: true, name: true } },
} as const;

/**
 * GET /kpis: every catalogue KPI over the live and archived projects the user can see (the
 * directory's visibility rule), filtered by type, region and owner.
 */
export async function getKpiDashboard(webUser: WebJwtPayload, query: KpiQuery, now: Date = new Date()): Promise<KpiDashboardDto> {
  // The viewer's tenant zone (a platform super admin reads in the zone of their own tenant).
  const zone = await tenantKpiZone(webUser.tenantId);
  const period = resolvePeriod(query, zone, now);
  const projects = await prisma.project.findMany({
    where: {
      AND: [buildProjectVisibilityWhere(webUser, undefined, { statuses: ['ACTIVE', 'ARCHIVED'] }), ...deliveryModelFilterWhere(query)],
    },
    orderBy: { codePrefix: 'asc' },
    select: PROJECT_ROW_SELECT,
  });
  const facts = await loadKpiFacts(projects, period, zone, now);
  const typeTargets = await targetsByType([...new Set(projects.map((p) => p.tenantId))]);
  const targetsOf = (p: (typeof projects)[number]) => (p.projectTypeId ? typeTargets.get(p.projectTypeId) : null) ?? DEFAULT_TARGETS;
  const counts = facts.map((f) => computeProjectKpis(f, period));

  const rows: KpiProjectRow[] = projects.map((p, i) => {
    const targets = targetsOf(p);
    const values: Record<string, KpiProjectCell> = {};
    for (const def of KPI_CATALOGUE) {
      const c = counts[i][def.key];
      if (c && targets[def.key].shown) values[def.key] = cellFor(def, c, targets[def.key].target);
    }
    return {
      projectId: p.id,
      codePrefix: p.codePrefix,
      name: p.name,
      status: p.status,
      constructionPhase: p.constructionPhase,
      projectTypeId: p.projectTypeId,
      projectTypeName: p.projectType?.name ?? null,
      regionName: p.region?.name ?? null,
      owningOrganizationId: p.owningOrganization?.id ?? null,
      owningOrganizationName: p.owningOrganization?.name ?? null,
      values,
    };
  });

  const trend = await trendPoints(projects.map((p) => p.id), zone, now, (projectId, key) => {
    const p = projects.find((x) => x.id === projectId);
    return p ? targetsOf(p)[key].shown : false;
  });

  const kpis: KpiDashboardKpi[] = [];
  for (const def of KPI_CATALOGUE) {
    const showing = projects.map((p, i) => ({ p, i, t: targetsOf(p)[def.key] })).filter((x) => x.t.shown);
    if (projects.length > 0 && showing.length === 0) continue; // hidden on every type in view
    const tracked = showing.filter((x) => counts[x.i][def.key]);
    const targetPool = (tracked.length ? tracked : showing).map((x) => x.t.target);
    const overall = aggregateValue(
      def,
      showing.map((x) => counts[x.i][def.key]),
      projects.length ? targetPool : [DEFAULT_TARGETS[def.key].target]
    );
    const byType = new Map<string, typeof showing>();
    for (const x of showing) {
      const k = x.p.projectTypeId ?? '';
      byType.set(k, [...(byType.get(k) ?? []), x]);
    }
    const byProjectType: KpiTypeBreakdown[] = [...byType.entries()].map(([typeId, list]) => {
      const v = aggregateValue(
        def,
        list.map((x) => counts[x.i][def.key]),
        list.map((x) => x.t.target)
      );
      return {
        projectTypeId: typeId || null,
        projectTypeName: list[0].p.projectType?.name ?? 'No project type',
        status: v.status,
        value: v.value,
        numerator: v.numerator,
        denominator: v.denominator,
        target: v.target,
        trackedProjectCount: v.trackedProjectCount,
      };
    });
    kpis.push({ ...overall, trend: trend.get(def.key) ?? [], byProjectType });
  }

  return { period, timeZone: zone, generatedAt: now.toISOString(), projectCount: projects.length, kpis, projects: rows };
}

/** GET /projects/:id/kpis: the KPIs the project's type shows (tracked or not). */
export async function getProjectKpis(projectId: string, query: KpiQuery, now: Date = new Date()): Promise<ProjectKpisDto> {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: PROJECT_ROW_SELECT });
  // The project's tenant zone, so the card and the Programme KPIs page agree on the period.
  const zone = await tenantKpiZone(project.tenantId);
  const period = resolvePeriod(query, zone, now);
  const [facts] = await loadKpiFacts([project], period, zone, now);
  const targets = project.projectTypeId ? (await targetsByType([project.tenantId])).get(project.projectTypeId) ?? DEFAULT_TARGETS : DEFAULT_TARGETS;
  const counts = computeProjectKpis(facts, period);
  const kpis = KPI_CATALOGUE.filter((def) => targets[def.key].shown).map((def) =>
    aggregateValue(def, [counts[def.key]], [targets[def.key].target])
  );
  return { projectId, period, timeZone: zone, generatedAt: now.toISOString(), kpis };
}

/** Monthly values per KPI from the snapshots of the given projects (oldest first). */
async function trendPoints(
  projectIds: string[],
  zone: string,
  now: Date,
  shown: (projectId: string, key: KpiKey) => boolean
): Promise<Map<KpiKey, Array<{ periodStart: string; value: number | null }>>> {
  const out = new Map<KpiKey, Array<{ periodStart: string; value: number | null }>>();
  if (projectIds.length === 0) return out;
  const months = recentMonthStarts(zonedCalendarDate(now, zone), TREND_MONTHS);
  const rows = await prisma.kpiSnapshot.findMany({
    where: { projectId: { in: projectIds }, periodStart: { in: months } },
    select: { projectId: true, kpiKey: true, periodStart: true, numerator: true, denominator: true },
  });
  const sums = new Map<string, { n: number; d: number }>();
  for (const r of rows) {
    if (!shown(r.projectId, r.kpiKey as KpiKey)) continue;
    const k = `${r.kpiKey}|${r.periodStart}`;
    const s = sums.get(k) ?? { n: 0, d: 0 };
    s.n += Number(r.numerator);
    s.d += Number(r.denominator);
    sums.set(k, s);
  }
  for (const def of KPI_CATALOGUE) {
    const points = months
      .filter((m) => sums.has(`${def.key}|${m}`))
      .map((m) => {
        const s = sums.get(`${def.key}|${m}`)!;
        return { periodStart: m, value: kpiValue(def, s.n, s.d) };
      });
    if (points.length) out.set(def.key, points);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Daily snapshots (job kpi-snapshot)
// ---------------------------------------------------------------------------

async function writeSnapshots(
  tenantId: string,
  projects: Awaited<ReturnType<typeof snapshotProjects>>,
  period: KpiPeriod,
  zone: string,
  now: Date,
  onlyPeriodBased: boolean
): Promise<number> {
  const facts = await loadKpiFacts(projects, period, zone, now);
  const defs = KPI_CATALOGUE.filter((d) => !onlyPeriodBased || d.periodBased);
  const data = facts.flatMap((f) => {
    const counts = computeProjectKpis(f, period);
    return defs
      .filter((def) => counts[def.key])
      .map((def) => {
        const c = counts[def.key]!;
        return {
          tenantId,
          projectId: f.projectId,
          kpiKey: def.key,
          periodStart: period.from,
          periodEnd: period.to,
          numerator: round4(c.numerator),
          denominator: round4(c.denominator),
          value: kpiValue(def, c.numerator, c.denominator),
          computedAt: now,
        };
      });
  });
  await prisma.$transaction(async (tx) => {
    await tx.kpiSnapshot.deleteMany({ where: { tenantId, periodStart: period.from, projectId: { in: projects.map((p) => p.id) } } });
    if (data.length) await tx.kpiSnapshot.createMany({ data });
  });
  return data.length;
}

function snapshotProjects(tenantId: string) {
  return prisma.project.findMany({ where: { tenantId, status: { in: ['ACTIVE', 'ARCHIVED'] } }, select: KPI_PROJECT_SELECT });
}

/**
 * Stores the current month's figures for every live or archived project of the tenant (replacing
 * today's earlier run), and backfills period-based KPIs once for earlier months that have no
 * snapshots yet, so trends are visible from the first day. Months are the tenant's months.
 */
export async function snapshotTenantKpis(tenantId: string, now: Date = new Date(), options: { backfillMonths?: number } = {}): Promise<string> {
  const projects = await snapshotProjects(tenantId);
  if (projects.length === 0) return 'no projects';
  const zone = await tenantKpiZone(tenantId);
  const today = zonedCalendarDate(now, zone);
  const months = recentMonthStarts(today, (options.backfillMonths ?? TREND_MONTHS - 1) + 1);
  const current = months[months.length - 1];
  const written = await writeSnapshots(tenantId, projects, { from: current, to: today }, zone, now, false);
  let backfilled = 0;
  for (const month of months.slice(0, -1)) {
    const exists = await prisma.kpiSnapshot.count({ where: { tenantId, periodStart: month } });
    if (exists > 0) continue;
    backfilled += await writeSnapshots(tenantId, projects, { from: month, to: monthEnd(month) }, zone, now, true);
  }
  return `${projects.length} projects, ${written} values${backfilled ? `, ${backfilled} backfilled` : ''}`;
}
