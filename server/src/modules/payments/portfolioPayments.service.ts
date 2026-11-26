import { Prisma } from '@prisma/client';
import {
  buildPaymentsBreakdown,
  formatProjectCode,
  fundingSourceLabel,
  PAYMENTS_BREAKDOWN_BY_LABELS,
  type BreakdownPayment,
  type BreakdownProject,
  type PaymentsBreakdownDto,
  type PaymentsBreakdownRowDto,
  type PortfolioPaymentsBreakdownQuery,
  lgaByCode,
  PAYMENT_EXCEPTION_LABELS,
  PAYMENT_KIND_LABELS,
  PaymentException,
  PaymentExceptionEnum,
  PortfolioPaymentRowDto,
  PortfolioPaymentsListDto,
  PortfolioPaymentsQuery,
  PortfolioPaymentsSummaryDto,
  ProjectListFilters,
  stateByCode,
  statesOfZone,
  zonedCalendarDate,
  zoneName,
  zoneOfState,
  DEFAULT_FISCAL_YEAR_START_MONTH,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import type { WebJwtPayload } from '../../middleware/auth.middleware';
import { buildProjectVisibilityWhere } from '../../utils/accessControl';
import { buildExportWorkbook, dateCell, ExportColumn, generatedLine } from '../../utils/exportSheet';
import { deliveryModelFilterWhere } from '../projects/projects.service';
import { workspaceShortName } from '../scope/scopeImport.service';
import { safeZone } from '../kpis/kpis.service';
import { assertPeriod } from './payments.service';

/**
 * Client demo updates G.2: payments across the programme (`/api/v1/payments`). Projects follow the
 * directory's visibility rule (a SUBEB sees its own projects), ACTIVE and ARCHIVED; the project
 * filters are the register's, the payment filters the period (inclusive on `paidOn`), kind,
 * exceptions only, voided (list only) and search. Totals never count voided payments.
 */

const DEFAULT_PAGE_SIZE = 50;
/** Plenty for a report (as the screen exports). */
const MAX_EXPORT_ROWS = 5000;

const round2 = (n: number) => Math.round(n * 100) / 100;
const round1 = (n: number) => Math.round(n * 10) / 10;

/** The register filters that `deliveryModelFilterWhere` (projects module) applies. */
const REGISTER_KEYS = ['projectTypeId', 'regionId', 'owningOrganizationId', 'lga', 'contractorOrganizationId', 'interventionYear', 'fundingSource'] as const;

/** Visible ACTIVE and ARCHIVED projects matching the project filters (not the period). */
export function portfolioProjectWhere(webUser: WebJwtPayload, q: PortfolioPaymentsQuery): Prisma.ProjectWhereInput {
  const register: ProjectListFilters = {};
  for (const k of REGISTER_KEYS) if (q[k] !== undefined) (register as Record<string, unknown>)[k] = q[k];
  const and: Prisma.ProjectWhereInput[] = [
    buildProjectVisibilityWhere(webUser, undefined, { statuses: ['ACTIVE', 'ARCHIVED'] }),
    ...deliveryModelFilterWhere(register),
  ];
  // C1/C4 codes (applied here so the payments screen does not depend on the register's version).
  if (q.zone) and.push({ stateCode: { in: statesOfZone(q.zone).map((s) => s.code) } });
  if (q.stateCode) and.push({ stateCode: q.stateCode });
  // G.2: an LGA matches projects with a site there (C2), or whose own LGA it is (projects without sites).
  if (q.lgaCode) and.push({ OR: [{ lgaCode: q.lgaCode }, { sites: { some: { lgaCode: q.lgaCode } } }] });
  if (q.fundingSourceCode) and.push({ fundingSourceCode: q.fundingSourceCode });
  if (q.projectId) and.push({ id: q.projectId });
  return { AND: and };
}

const HAS_EXCEPTIONS: Prisma.ProjectPaymentWhereInput = { voidedAt: null, NOT: { exceptionsJson: { equals: [] } } };

function paymentWhere(projectWhere: Prisma.ProjectWhereInput, q: PortfolioPaymentsQuery, includeVoided: boolean): Prisma.ProjectPaymentWhereInput {
  const and: Prisma.ProjectPaymentWhereInput[] = [{ project: projectWhere }];
  if (q.from || q.to) and.push({ paidOn: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } });
  if (q.kind) and.push({ kind: q.kind });
  if (!includeVoided) and.push({ voidedAt: null });
  if (q.exceptionsOnly === 'true') and.push(HAS_EXCEPTIONS);
  const t = q.search?.trim();
  if (t) {
    const has = { contains: t, mode: 'insensitive' as const };
    and.push({
      OR: [
        { reference: has },
        { description: has },
        { project: { name: has } },
        { project: { codePrefix: has } },
        { project: { externalReference: has } },
      ],
    });
  }
  return { AND: and };
}

const ROW_INCLUDE = {
  project: {
    select: {
      id: true,
      codePrefix: true,
      name: true,
      interventionYear: true,
      stateCode: true,
      stateLocation: true,
      contractors: { orderBy: { createdAt: 'asc' }, take: 1, select: { organization: { select: { name: true } } } },
    },
  },
} satisfies Prisma.ProjectPaymentInclude;
type PaymentRow = Prisma.ProjectPaymentGetPayload<{ include: typeof ROW_INCLUDE }>;

function serializeRow(p: PaymentRow): PortfolioPaymentRowDto {
  const exceptions = (Array.isArray(p.exceptionsJson) ? p.exceptionsJson : [])
    .map((e) => PaymentExceptionEnum.safeParse(e))
    .filter((r) => r.success)
    .map((r) => r.data as PaymentException);
  return {
    id: p.id,
    projectId: p.projectId,
    projectCode: p.project.codePrefix,
    projectName: p.project.name,
    interventionYear: p.project.interventionYear,
    stateCode: p.project.stateCode,
    stateName: stateByCode(p.project.stateCode)?.name ?? p.project.stateLocation ?? null,
    zone: zoneOfState(p.project.stateCode),
    contractorName: p.project.contractors[0]?.organization.name ?? null,
    kind: p.kind,
    paidOn: p.paidOn,
    reference: p.reference,
    grossAmountNgn: Number(p.grossAmountNgn),
    retentionHeldNgn: Number(p.retentionHeldNgn),
    netAmountNgn: Number(p.netAmountNgn),
    exceptions,
    voided: p.voidedAt !== null,
  };
}

const ORDER: Prisma.ProjectPaymentOrderByWithRelationInput[] = [{ paidOn: 'desc' }, { createdAt: 'desc' }];

/** GET /api/v1/payments: the payments, newest first, paged. */
export async function listPortfolioPayments(webUser: WebJwtPayload, q: PortfolioPaymentsQuery): Promise<PortfolioPaymentsListDto> {
  assertPeriod(q);
  const page = q.page ?? 1;
  const pageSize = q.pageSize ?? DEFAULT_PAGE_SIZE;
  const where = paymentWhere(portfolioProjectWhere(webUser, q), q, q.includeVoided === 'true');
  const [rows, total] = await Promise.all([
    prisma.projectPayment.findMany({ where, include: ROW_INCLUDE, orderBy: ORDER, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.projectPayment.count({ where }),
  ]);
  return { rows: rows.map(serializeRow), total, page, pageSize };
}

async function tenantSettings(tenantId: string, now: Date) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, timezone: true, fiscalYearStartMonth: true } });
  const zone = safeZone(tenant?.timezone);
  return {
    name: tenant?.name ?? null,
    zone,
    today: zonedCalendarDate(now, zone),
    fiscalYearStartMonth: tenant?.fiscalYearStartMonth ?? DEFAULT_FISCAL_YEAR_START_MONTH,
  };
}

/** GET /api/v1/payments/summary: the cards (voided payments never counted). */
export async function getPortfolioPaymentsSummary(webUser: WebJwtPayload, q: PortfolioPaymentsQuery, now = new Date()): Promise<PortfolioPaymentsSummaryDto> {
  assertPeriod(q);
  const projectWhere = portfolioProjectWhere(webUser, q);
  const where = paymentWhere(projectWhere, q, false);
  const [settings, byKind, exceptionCount, byProject, projects] = await Promise.all([
    tenantSettings(webUser.tenantId, now),
    prisma.projectPayment.groupBy({
      by: ['kind'],
      where,
      _sum: { grossAmountNgn: true, retentionHeldNgn: true, netAmountNgn: true },
      _count: { _all: true },
    }),
    prisma.projectPayment.count({ where: { AND: [where, HAS_EXCEPTIONS] } }),
    prisma.projectPayment.groupBy({ by: ['projectId'], where }),
    prisma.project.findMany({ where: projectWhere, select: { contractSumNgn: true, disbursedToDateNgn: true, certifiedProgressPct: true } }),
  ]);
  let gross = 0;
  let held = 0;
  let released = 0;
  let net = 0;
  let count = 0;
  for (const g of byKind) {
    const sGross = Number(g._sum.grossAmountNgn ?? 0);
    count += g._count._all;
    net += Number(g._sum.netAmountNgn ?? 0);
    if (g.kind === 'RETENTION_RELEASE') {
      released += sGross;
    } else {
      gross += sGross;
      held += Number(g._sum.retentionHeldNgn ?? 0);
    }
  }
  let contractSum = 0;
  let paidToDate = 0;
  let weightedProgress = 0;
  for (const p of projects) {
    paidToDate += Number(p.disbursedToDateNgn);
    const sum = p.contractSumNgn === null ? 0 : Number(p.contractSumNgn);
    if (sum > 0) {
      contractSum += sum;
      weightedProgress += sum * Number(p.certifiedProgressPct);
    }
  }
  return {
    from: q.from ?? null,
    to: q.to ?? null,
    today: settings.today,
    fiscalYearStartMonth: settings.fiscalYearStartMonth,
    grossPaidNgn: round2(gross),
    retentionHeldNgn: round2(held),
    retentionReleasedNgn: round2(released),
    netPaidNgn: round2(net),
    paymentCount: count,
    exceptionCount,
    projectCount: byProject.length,
    moneyVsProgress: {
      projectCount: projects.length,
      contractSumNgn: round2(contractSum),
      paidToDateNgn: round2(paidToDate),
      paidPct: contractSum > 0 ? round1((paidToDate / contractSum) * 100) : null,
      progressPct: contractSum > 0 ? round1(weightedProgress / contractSum) : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Breakdown (wave 4, G.1 grouping and G.2 Breakdown; decision W4.4: pure, over the matching payments)
// ---------------------------------------------------------------------------

/** Every matching payment (voided never counted); plenty at programme scale. */
const MAX_BREAKDOWN_PAYMENTS = 50_000;

/**
 * GET /api/v1/payments/breakdown?by=…: the summary's filters and visibility, grouped. Each payment
 * counted once in the totals; by LGA a project with sites in several LGAs is counted under each.
 */
export async function getPortfolioPaymentsBreakdown(
  webUser: WebJwtPayload,
  q: PortfolioPaymentsBreakdownQuery,
  now = new Date()
): Promise<PaymentsBreakdownDto> {
  assertPeriod(q);
  const where = paymentWhere(portfolioProjectWhere(webUser, q), q, false);
  const [settings, payments] = await Promise.all([
    tenantSettings(webUser.tenantId, now),
    prisma.projectPayment.findMany({
      where,
      select: { projectId: true, kind: true, paidOn: true, grossAmountNgn: true, retentionHeldNgn: true, netAmountNgn: true, exceptionsJson: true },
      orderBy: ORDER,
      take: MAX_BREAKDOWN_PAYMENTS,
    }),
  ]);
  const projectIds = [...new Set(payments.map((p) => p.projectId))];
  const projects = projectIds.length
    ? await prisma.project.findMany({
        where: { id: { in: projectIds } },
        select: {
          id: true,
          codePrefix: true,
          name: true,
          stateCode: true,
          stateLocation: true,
          lgaCode: true,
          sites: { select: { lgaCode: true }, orderBy: { siteNumber: 'asc' } },
          contractors: { orderBy: { createdAt: 'asc' }, take: 1, select: { organization: { select: { id: true, name: true } } } },
        },
      })
    : [];
  const rows: BreakdownPayment[] = payments.map((p) => ({
    projectId: p.projectId,
    kind: p.kind,
    paidOn: p.paidOn,
    grossAmountNgn: Number(p.grossAmountNgn),
    retentionHeldNgn: Number(p.retentionHeldNgn),
    netAmountNgn: Number(p.netAmountNgn),
    hasException: Array.isArray(p.exceptionsJson) && p.exceptionsJson.length > 0,
  }));
  const breakdownProjects: BreakdownProject[] = projects.map((p) => {
    const siteLgas = p.sites.map((s) => s.lgaCode).filter(Boolean);
    const contractor = p.contractors[0]?.organization ?? null;
    return {
      id: p.id,
      code: formatProjectCode(p.codePrefix),
      name: p.name,
      stateCode: p.stateCode,
      stateText: p.stateLocation,
      lgaCodes: siteLgas.length ? siteLgas : p.lgaCode ? [p.lgaCode] : [],
      contractorId: contractor?.id ?? null,
      contractorName: contractor?.name ?? null,
    };
  });
  const built = buildPaymentsBreakdown(rows, breakdownProjects, q.by, settings.fiscalYearStartMonth);
  return { by: q.by, from: q.from ?? null, to: q.to ?? null, ...built };
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export interface PaymentsXlsxFile {
  buffer: Buffer;
  fileName: string;
}

const JOIN = ' · ';

function periodText(from: string | null, to: string | null): string {
  if (from && to) return `${from} to ${to}`;
  if (from) return `from ${from}`;
  if (to) return `up to ${to}`;
  return 'all time';
}

function fileNamePeriod(from: string | null, to: string | null): string {
  if (from && to) return `${from}–${to}`;
  if (from) return `from ${from}`;
  if (to) return `up to ${to}`;
  return 'all time';
}

/** The filters in use, in words, for the sheets' hint line. */
async function filterText(webUser: WebJwtPayload, q: PortfolioPaymentsQuery): Promise<string[]> {
  const tenantId = webUser.tenantId;
  const [type, region, owner, contractor, project] = await Promise.all([
    q.projectTypeId ? prisma.projectType.findFirst({ where: { id: q.projectTypeId, tenantId }, select: { name: true } }) : null,
    q.regionId ? prisma.region.findFirst({ where: { id: q.regionId, tenantId }, select: { name: true } }) : null,
    q.owningOrganizationId ? prisma.organization.findFirst({ where: { id: q.owningOrganizationId, tenantId }, select: { name: true } }) : null,
    q.contractorOrganizationId ? prisma.organization.findFirst({ where: { id: q.contractorOrganizationId, tenantId }, select: { name: true } }) : null,
    q.projectId ? prisma.project.findFirst({ where: { id: q.projectId, tenantId }, select: { codePrefix: true } }) : null,
  ]);
  return [
    q.zone && `Zone: ${zoneName(q.zone) ?? q.zone}`,
    q.stateCode && `State: ${stateByCode(q.stateCode)?.name ?? q.stateCode}`,
    q.lgaCode && `LGA: ${lgaByCode(q.lgaCode)?.name ?? q.lgaCode}`,
    q.lga && `LGA: ${q.lga}`,
    region && `Zone: ${region.name}`,
    type && `Delivery model: ${type.name}`,
    q.interventionYear && `Intervention year: ${q.interventionYear}`,
    q.fundingSourceCode && `Funding source: ${fundingSourceLabel(q.fundingSourceCode) ?? q.fundingSourceCode}`,
    q.fundingSource && `Funding source: ${q.fundingSource}`,
    contractor && `Contractor: ${contractor.name}`,
    owner && `Owner: ${owner.name}`,
    project && `Project: ${formatProjectCode(project.codePrefix)}`,
    q.kind && `Type: ${PAYMENT_KIND_LABELS[q.kind]}`,
    q.exceptionsOnly === 'true' && 'Exceptions only',
    q.includeVoided === 'true' && 'Voided payments listed (not counted)',
    q.search?.trim() && `Search: "${q.search.trim()}"`,
  ].filter((x): x is string => Boolean(x));
}

interface SummaryLine {
  figure: string;
  amount: number | null;
  count: number | null;
  percent: number | null;
}

/**
 * GET /api/v1/payments/export.xlsx: sheets Summary, Breakdown (grouped by `by`, default State) and
 * Payments, the screen's filters.
 */
export async function buildPortfolioPaymentsExport(
  webUser: WebJwtPayload,
  q: PortfolioPaymentsQuery & Partial<Pick<PortfolioPaymentsBreakdownQuery, 'by'>>,
  now = new Date()
): Promise<PaymentsXlsxFile> {
  assertPeriod(q);
  const projectWhere = portfolioProjectWhere(webUser, q);
  const by = q.by ?? 'state';
  const [settings, summary, breakdown, rows, filters] = await Promise.all([
    tenantSettings(webUser.tenantId, now),
    getPortfolioPaymentsSummary(webUser, q, now),
    getPortfolioPaymentsBreakdown(webUser, { ...q, by }, now),
    prisma.projectPayment.findMany({ where: paymentWhere(projectWhere, q, q.includeVoided === 'true'), include: ROW_INCLUDE, orderBy: ORDER, take: MAX_EXPORT_ROWS }),
    filterText(webUser, q),
  ]);
  const brand = workspaceShortName(settings.name);
  const from = q.from ?? null;
  const to = q.to ?? null;
  const period = periodText(from, to);
  const titleOf = (...parts: string[]) => [...(brand ? [brand] : []), ...parts].join(JOIN);
  const hint = (...parts: Array<string | null>) =>
    [
      `Paid ${period}`,
      filters.length ? filters.join('; ') : 'All projects in view',
      ...parts,
      generatedLine(now, settings.zone, webUser.fullName),
    ]
      .filter(Boolean)
      .join('  |  ');

  const m = summary.moneyVsProgress;
  const lines: SummaryLine[] = [
    { figure: 'Gross paid (interim and final payments)', amount: summary.grossPaidNgn, count: null, percent: null },
    { figure: 'Retention held', amount: summary.retentionHeldNgn, count: null, percent: null },
    { figure: 'Retention released', amount: summary.retentionReleasedNgn, count: null, percent: null },
    { figure: 'Net paid to contractors (releases included)', amount: summary.netPaidNgn, count: null, percent: null },
    { figure: 'Payments', amount: null, count: summary.paymentCount, percent: null },
    { figure: 'Payments with exceptions', amount: null, count: summary.exceptionCount, percent: null },
    { figure: 'Projects with payments in the period', amount: null, count: summary.projectCount, percent: null },
    { figure: 'Projects matching the filters (to date)', amount: null, count: m.projectCount, percent: null },
    { figure: 'Contract sum of those projects', amount: m.contractSumNgn, count: null, percent: null },
    { figure: 'Paid to date, net (those projects)', amount: m.paidToDateNgn, count: null, percent: null },
    { figure: 'Paid against contract sum', amount: null, count: null, percent: m.paidPct },
    { figure: 'Work done (% complete, weighted by contract sum)', amount: null, count: null, percent: m.progressPct },
  ];
  const summaryColumns: ExportColumn<SummaryLine>[] = [
    { header: 'Figure', width: 46, value: (l) => l.figure },
    { header: 'Amount', width: 20, format: 'money', value: (l) => l.amount },
    { header: 'Count', width: 10, format: 'integer', value: (l) => l.count },
    { header: '%', width: 10, format: 'number', value: (l) => l.percent },
  ];

  // Breakdown: one row per group, the context column only where a group has a parent place.
  const contextHeader: Partial<Record<PortfolioPaymentsBreakdownQuery['by'], string>> = { state: 'Zone', lga: 'State', project: 'State' };
  const ctx = contextHeader[by];
  const breakdownColumns: ExportColumn<PaymentsBreakdownRowDto>[] = [
    { header: PAYMENTS_BREAKDOWN_BY_LABELS[by], width: by === 'project' ? 44 : 30, wrap: true, value: (r) => (r.sharedAcrossGroups ? `${r.label} *` : r.label) },
    ...(ctx ? [{ header: ctx, width: 18, value: (r: PaymentsBreakdownRowDto) => r.context } satisfies ExportColumn<PaymentsBreakdownRowDto>] : []),
    { header: 'Gross paid', width: 18, format: 'money', value: (r) => r.grossPaidNgn },
    { header: 'Retention held', width: 17, format: 'money', value: (r) => r.retentionHeldNgn },
    { header: 'Retention released', width: 17, format: 'money', value: (r) => r.retentionReleasedNgn },
    { header: 'Net paid', width: 18, format: 'money', value: (r) => r.netPaidNgn },
    { header: 'Payments', width: 11, format: 'integer', value: (r) => r.paymentCount },
    { header: 'With exceptions', width: 12, format: 'integer', value: (r) => r.exceptionCount },
    { header: 'Projects', width: 10, format: 'integer', value: (r) => r.projectCount },
  ];
  const first = ctx ? 2 : 1;
  const t = breakdown.totals;
  const breakdownTotals: Record<number, number> = {
    [first]: t.grossPaidNgn,
    [first + 1]: t.retentionHeldNgn,
    [first + 2]: t.retentionReleasedNgn,
    [first + 3]: t.netPaidNgn,
    [first + 4]: t.paymentCount,
    [first + 5]: t.exceptionCount,
    [first + 6]: t.projectCount,
  };
  const sharedNote =
    by === 'lga' && breakdown.hasSharedGroups
      ? '* Payments are recorded per project: a project with sites in several LGAs is counted in full under each, so the rows add up to more than the total'
      : null;

  const data = rows.map(serializeRow);
  const isRelease = (p: PortfolioPaymentRowDto) => p.kind === 'RETENTION_RELEASE';
  const columns: ExportColumn<PortfolioPaymentRowDto>[] = [
    { header: 'Paid on', width: 14, format: 'date', value: (p) => dateCell(p.paidOn) },
    { header: 'Project ID', width: 22, value: (p) => formatProjectCode(p.projectCode) },
    { header: 'Intervention year', width: 12, format: 'integer', value: (p) => p.interventionYear },
    { header: 'Project', width: 32, wrap: true, value: (p) => p.projectName },
    { header: 'Zone', width: 15, value: (p) => zoneName(p.zone) },
    { header: 'State', width: 15, value: (p) => p.stateName },
    { header: 'Contractor', width: 26, wrap: true, value: (p) => p.contractorName },
    { header: 'Type', width: 18, value: (p) => PAYMENT_KIND_LABELS[p.kind] },
    { header: 'Reference', width: 18, value: (p) => p.reference },
    { header: 'Gross amount', width: 17, format: 'money', value: (p) => (isRelease(p) ? null : p.grossAmountNgn) },
    { header: 'Retention held', width: 16, format: 'money', value: (p) => (isRelease(p) ? null : p.retentionHeldNgn) },
    { header: 'Retention released', width: 17, format: 'money', value: (p) => (isRelease(p) ? p.grossAmountNgn : null) },
    { header: 'Net paid', width: 17, format: 'money', value: (p) => p.netAmountNgn },
    { header: 'Exceptions', width: 40, wrap: true, value: (p) => p.exceptions.map((e) => PAYMENT_EXCEPTION_LABELS[e]).join('; ') || null },
    { header: 'Voided', width: 9, value: (p) => (p.voided ? 'Yes' : null) },
  ];
  const live = data.filter((p) => !p.voided);
  const sum = (f: (p: PortfolioPaymentRowDto) => number) => round2(live.reduce((s, p) => s + f(p), 0));

  const buffer = await buildExportWorkbook({
    brandName: brand,
    title: `Payments ${period}`,
    generatedAt: now,
    sheets: [
      {
        name: 'Summary',
        title: titleOf('Payments', period),
        hint: hint('Voided payments not counted', 'Money against progress: to date, over the projects matching the filters'),
        columns: summaryColumns,
        rows: lines,
      },
      {
        name: 'Breakdown',
        title: titleOf(`Payments by ${PAYMENTS_BREAKDOWN_BY_LABELS[by]}`, period),
        hint: hint('Voided payments not counted', 'Gross and retention held exclude retention releases; net includes them', sharedNote),
        columns: breakdownColumns,
        rows: breakdown.rows,
        emptyText: 'No payments match these filters.',
        totals: { label: 'Total (each payment once)', values: breakdownTotals },
      },
      {
        name: 'Payments',
        title: titleOf('Payments', period),
        hint: hint(`${data.length} payment(s)${data.length >= MAX_EXPORT_ROWS ? ` (first ${MAX_EXPORT_ROWS})` : ''}`),
        columns,
        rows: data,
        emptyText: 'No payments match these filters.',
        muted: (p) => p.voided,
        totals: {
          label: 'Total (voided excluded)',
          values: {
            9: sum((p) => (isRelease(p) ? 0 : p.grossAmountNgn)),
            10: sum((p) => (isRelease(p) ? 0 : p.retentionHeldNgn)),
            11: sum((p) => (isRelease(p) ? p.grossAmountNgn : 0)),
            12: sum((p) => p.netAmountNgn),
          },
        },
      },
    ],
  });
  return { buffer, fileName: `${brand ? `${brand} payments` : 'Payments'} ${fileNamePeriod(from, to)}.xlsx` };
}
