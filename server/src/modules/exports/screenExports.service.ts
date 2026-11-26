import { Prisma } from '@prisma/client';
import {
  FindingsExportQuery,
  KPI_BY_KEY,
  KPI_STAGE_META,
  KpiKey,
  KpiQuery,
  KpiStatus,
  PAYMENT_EXCEPTION_LABELS,
  PAYMENT_KIND_LABELS,
  PaymentDto,
  PaymentsExportQuery,
  PlannerVisitsExportQuery,
  ProjectVisitsExportQuery,
  VISIT_CONFIRMATION_LABELS,
  VISIT_KIND_META,
  VISIT_OVERALL_FINDING_LABELS,
  VISIT_STATUS_LABELS,
  VISIT_SUBMISSION_STATUS_LABELS,
  VisitKind,
  VisitStatus,
  zonedCalendarDate,
  formatProjectCodeWithYear,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import type { WebJwtPayload } from '../../middleware/auth.middleware';
import { buildExportWorkbook, dateCell, dateTimeCell, ExportColumn, generatedLine } from '../../utils/exportSheet';
import { workspaceShortName } from '../scope/scopeImport.service';
import { visitWhere } from '../visits/visits.service';
import { plannerVisitWhere } from '../visits/visitResponses.service';
import { FINDING_INCLUDE, FindingRow, loadNames } from '../findings/findings.service';
import { filterPayments, getProjectPayments } from '../payments/payments.service';
import { getKpiDashboard, safeZone } from '../kpis/kpis.service';

/**
 * UBEC IRL: Excel exports of the visits (project and planner), findings, payments and KPI screens.
 * Each one reads with the screen's own filter and visibility code (the routes apply the screen's
 * permission), so the file holds the rows the user sees; the look comes from `utils/exportSheet.ts`.
 */

export interface XlsxFile {
  buffer: Buffer;
  fileName: string;
}

/** Plenty for a report; the screens themselves page through fewer. */
const MAX_ROWS = 5000;

const JOIN = ' · ';

async function workspaceBrand(tenantId: string): Promise<{ brand: string | null; zone: string }> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, timezone: true } });
  return { brand: workspaceShortName(tenant?.name), zone: safeZone(tenant?.timezone) };
}

const titleOf = (brand: string | null, ...parts: string[]) => [...(brand ? [brand] : []), ...parts].join(JOIN);
const hintOf = (...parts: Array<string | null | undefined | false>) => parts.filter(Boolean).join('  |  ');

async function loadProjectHeader(projectId: string) {
  return prisma.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { codePrefix: true, name: true, timezone: true, tenantId: true, tenant: { select: { name: true } } },
  });
}

// ---------------------------------------------------------------------------
// Visits
// ---------------------------------------------------------------------------

const EXPORT_VISIT_INCLUDE = {
  project: { select: { codePrefix: true, name: true, timezone: true } },
  sprint: { select: { number: true, name: true } },
  assignees: { include: { user: { select: { fullName: true } } }, orderBy: [{ isLead: 'desc' }, { createdAt: 'asc' }] },
  submissions: {
    orderBy: { revisionNumber: 'desc' },
    take: 1,
    select: { id: true, status: true, confirmedAt: true, receivedAt: true, isLate: true, overallFinding: true, approvedAt: true, returnedAt: true },
  },
} satisfies Prisma.VisitInclude;
type ExportVisitRow = Prisma.VisitGetPayload<{ include: typeof EXPORT_VISIT_INCLUDE }>;

interface VisitLine {
  v: ExportVisitRow;
  reviewedAt: Date | null;
  reviewedBy: string | null;
  findings: number;
}

const CHECK_IN_LABELS: Record<string, string> = {
  INSIDE: 'Inside boundary',
  WITHIN_TOLERANCE: 'Within tolerance',
  OUTSIDE: 'Outside boundary',
};

async function loadVisitLines(where: Prisma.VisitWhereInput): Promise<VisitLine[]> {
  const rows = await prisma.visit.findMany({
    where,
    include: EXPORT_VISIT_INCLUDE,
    orderBy: [{ plannedDate: 'asc' }, { createdAt: 'asc' }],
    take: MAX_ROWS,
  });
  const submissionIds = rows.flatMap((r) => r.submissions.map((s) => s.id));
  const [actions, findingCounts] = await Promise.all([
    submissionIds.length
      ? prisma.approvalAction.findMany({
          where: { subjectType: 'VISIT_SUBMISSION', subjectId: { in: submissionIds } },
          orderBy: { createdAt: 'asc' },
          select: { subjectId: true, decision: true, createdAt: true, actor: { select: { fullName: true } } },
        })
      : [],
    rows.length
      ? prisma.finding.groupBy({ by: ['visitId'], where: { visitId: { in: rows.map((r) => r.id) } }, _count: { _all: true } })
      : [],
  ]);
  const count = new Map(findingCounts.map((f) => [f.visitId, f._count._all]));
  return rows.map((v) => {
    const s = v.submissions[0];
    let reviewedAt: Date | null = null;
    let reviewedBy: string | null = null;
    if (s && (s.status === 'APPROVED' || s.status === 'RETURNED')) {
      // The decision that settled it: the last approval (accepted) or the last return (returned).
      const decision = s.status === 'APPROVED' ? 'APPROVE' : 'RETURN';
      const last = actions.filter((a) => a.subjectId === s.id && a.decision === decision).at(-1);
      if (last) {
        reviewedAt = last.createdAt;
        reviewedBy = last.actor.fullName;
      } else if (s.status === 'APPROVED') {
        reviewedAt = s.approvedAt;
        reviewedBy = 'Accepted on submission (no approval step)';
      } else {
        reviewedAt = s.returnedAt;
      }
    }
    return { v, reviewedAt, reviewedBy, findings: count.get(v.id) ?? 0 };
  });
}

function visitColumns(withProject: boolean): ExportColumn<VisitLine>[] {
  const zone = (l: VisitLine) => l.v.project.timezone;
  const project: ExportColumn<VisitLine>[] = withProject
    ? [
        { header: 'Project code', width: 22, value: (l) => formatProjectCodeWithYear(l.v.project.codePrefix) },
        { header: 'Project', width: 30, wrap: true, value: (l) => l.v.project.name },
      ]
    : [];
  return [
    ...project,
    { header: 'Planned date', width: 14, format: 'date', value: (l) => dateCell(l.v.plannedDate) },
    { header: 'Original date', width: 14, format: 'date', value: (l) => dateCell(l.v.originalPlannedDate) },
    { header: 'Monitoring visit kind', width: 22, value: (l) => VISIT_KIND_META[l.v.visitKind as VisitKind]?.label ?? l.v.visitKind },
    { header: 'Work phase', width: 20, value: (l) => (l.v.sprint ? `Work phase ${l.v.sprint.number}${JOIN}${l.v.sprint.name}` : null) },
    { header: 'Status', width: 17, value: (l) => VISIT_STATUS_LABELS[l.v.status as VisitStatus] ?? l.v.status },
    { header: 'Confirmation', width: 15, value: (l) => VISIT_CONFIRMATION_LABELS[l.v.confirmation] },
    { header: 'Lead officer', width: 22, value: (l) => l.v.assignees.find((a) => a.isLead)?.user.fullName ?? l.v.assignees[0]?.user.fullName ?? null },
    {
      header: 'Other officers',
      width: 24,
      wrap: true,
      value: (l) => {
        const lead = l.v.assignees.find((a) => a.isLead) ?? l.v.assignees[0];
        return l.v.assignees.filter((a) => a !== lead).map((a) => a.user.fullName).join(', ') || null;
      },
    },
    { header: 'Checked in at', width: 18, format: 'datetime', value: (l) => dateTimeCell(l.v.checkInAt, zone(l)) },
    {
      header: 'Check-in location',
      width: 18,
      value: (l) => (l.v.checkInAt ? (l.v.checkInGeofenceStatus ? CHECK_IN_LABELS[l.v.checkInGeofenceStatus] : 'No location') : null),
    },
    { header: 'Report due', width: 14, format: 'date', value: (l) => dateCell(l.v.submissionDeadline) },
    { header: 'Report submitted at', width: 18, format: 'datetime', value: (l) => dateTimeCell(l.v.submissions[0]?.confirmedAt, zone(l)) },
    { header: 'Submitted late', width: 11, value: (l) => (l.v.submissions[0] ? (l.v.submissions[0].isLate ? 'Yes' : 'No') : null) },
    { header: 'Review', width: 17, value: (l) => (l.v.submissions[0] ? VISIT_SUBMISSION_STATUS_LABELS[l.v.submissions[0].status] : null) },
    { header: 'Reviewed at', width: 18, format: 'datetime', value: (l) => dateTimeCell(l.reviewedAt, zone(l)) },
    { header: 'Reviewed by', width: 22, wrap: true, value: (l) => l.reviewedBy },
    { header: 'Outcome', width: 14, value: (l) => (l.v.submissions[0] ? VISIT_OVERALL_FINDING_LABELS[l.v.submissions[0].overallFinding] : null) },
    { header: 'Findings raised', width: 11, format: 'integer', value: (l) => l.findings },
  ];
}

function visitFilterText(q: { status?: string; visitKind?: string }): string | null {
  const parts: string[] = [];
  if (q.status) parts.push(`Status: ${q.status.split(',').map((s) => VISIT_STATUS_LABELS[s as VisitStatus] ?? s).join(', ')}`);
  if (q.visitKind) parts.push(`Kind: ${VISIT_KIND_META[q.visitKind as VisitKind]?.label ?? q.visitKind}`);
  return parts.length ? parts.join('; ') : null;
}

/** GET /projects/:id/visits/export.xlsx: the Monitoring visits tab with its filters. */
export async function buildProjectVisitsExport(projectId: string, webUser: WebJwtPayload, q: ProjectVisitsExportQuery, now = new Date()): Promise<XlsxFile> {
  const project = await loadProjectHeader(projectId);
  const brand = workspaceShortName(project.tenant.name);
  const lines = await loadVisitLines(visitWhere(projectId, q));
  const zone = safeZone(project.timezone);
  const period = q.from || q.to ? `Planned ${q.from ?? '…'} to ${q.to ?? '…'}` : null;
  const buffer = await buildExportWorkbook({
    brandName: brand,
    title: `Monitoring visits${JOIN}${formatProjectCodeWithYear(project.codePrefix)}`,
    generatedAt: now,
    sheets: [
      {
        name: 'Monitoring visits',
        title: titleOf(brand, 'Monitoring visits', formatProjectCodeWithYear(project.codePrefix)),
        hint: hintOf(project.name, period, visitFilterText(q) ?? 'All monitoring visits', `${lines.length} monitoring visit(s)`, `Times in ${zone}`, generatedLine(now, zone, webUser.fullName)),
        columns: visitColumns(false),
        rows: lines,
        emptyText: 'No monitoring visits match these filters.',
      },
    ],
  });
  return { buffer, fileName: `${project.codePrefix} monitoring visits ${zonedCalendarDate(now, zone)}.xlsx` };
}

/** GET /visits/export.xlsx: the monitoring planner's period and filters (cancelled visits left out, as on screen). */
export async function buildPlannerVisitsExport(webUser: WebJwtPayload, q: PlannerVisitsExportQuery, now = new Date()): Promise<XlsxFile> {
  const { brand, zone } = await workspaceBrand(webUser.tenantId);
  const { from, to, where } = plannerVisitWhere(webUser, q, now);
  const [lines, region, project, officer] = await Promise.all([
    loadVisitLines(where),
    q.regionId ? prisma.region.findFirst({ where: { id: q.regionId, tenantId: webUser.tenantId }, select: { name: true } }) : null,
    q.projectId ? prisma.project.findFirst({ where: { id: q.projectId, tenantId: webUser.tenantId }, select: { codePrefix: true } }) : null,
    q.officerId ? prisma.user.findFirst({ where: { id: q.officerId, tenantId: webUser.tenantId }, select: { fullName: true } }) : null,
  ]);
  const filters = [
    region && `Zone / State: ${region.name}`,
    project && `Project: ${formatProjectCodeWithYear(project.codePrefix)}`,
    officer && `Officer: ${officer.fullName}`,
    visitFilterText({ visitKind: q.visitKind }),
  ].filter(Boolean);
  const buffer = await buildExportWorkbook({
    brandName: brand,
    title: `Monitoring visits ${from} to ${to}`,
    generatedAt: now,
    sheets: [
      {
        name: 'Monitoring visits',
        title: titleOf(brand, 'Monitoring visits', `${from} to ${to}`),
        hint: hintOf(
          `Planned ${from} to ${to}, cancelled monitoring visits left out`,
          filters.length ? filters.join('; ') : 'All projects in view',
          `${lines.length} monitoring visit(s)`,
          "Times in each project's zone",
          generatedLine(now, zone, webUser.fullName)
        ),
        columns: visitColumns(true),
        rows: lines,
        emptyText: `No monitoring visits from ${from} to ${to} match these filters.`,
      },
    ],
  });
  return { buffer, fileName: `${brand ? `${brand} monitoring visits` : 'Monitoring visits'} ${from} to ${to}.xlsx` };
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

const FINDING_STATUS_LABELS: Record<FindingRow['status'], string> = { OPEN: 'Open', RESOLVED: 'Rectified', DISMISSED: 'Dismissed' };

/** GET /projects/:id/findings/export.xlsx: the Findings tab (open, rectified and dismissed). */
export async function buildProjectFindingsExport(projectId: string, webUser: WebJwtPayload, q: FindingsExportQuery, now = new Date()): Promise<XlsxFile> {
  const project = await loadProjectHeader(projectId);
  const brand = workspaceShortName(project.tenant.name);
  const zone = safeZone(project.timezone);
  const where: Prisma.FindingWhereInput = { projectId };
  if (q.status) where.status = q.status;
  const rows = await prisma.finding.findMany({ where, include: FINDING_INCLUDE, orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: MAX_ROWS });
  const names = await loadNames(rows);
  const visitOf = (f: FindingRow) => (f.visitId ? names.visits.get(f.visitId) : undefined);
  const columns: ExportColumn<FindingRow>[] = [
    { header: 'Status', width: 12, value: (f) => FINDING_STATUS_LABELS[f.status] },
    { header: 'Severity', width: 11, value: (f) => f.severity.charAt(0) + f.severity.slice(1).toLowerCase() },
    { header: 'Facility', width: 22, value: (f) => (f.facilityId ? (names.facilities.get(f.facilityId) ?? null) : null) },
    { header: 'Unit', width: 14, value: (f) => (f.facilityUnitId ? (names.units.get(f.facilityUnitId) ?? null) : null) },
    { header: 'Question', width: 34, wrap: true, value: (f) => f.title ?? f.checklistItemKey },
    { header: 'Description', width: 40, wrap: true, value: (f) => f.description },
    { header: 'Raised on monitoring visit', width: 22, value: (f) => VISIT_KIND_META[visitOf(f)?.visitKind as VisitKind]?.label ?? (f.visitId ? 'Monitoring visit' : null) },
    { header: 'Monitoring visit date', width: 14, format: 'date', value: (f) => dateCell(visitOf(f)?.plannedDate ?? zonedCalendarDate(f.createdAt, zone)) },
    { header: 'Raised at', width: 18, format: 'datetime', value: (f) => dateTimeCell(f.createdAt, zone) },
    { header: 'Raised by', width: 22, value: (f) => f.raisedByName ?? 'Monitoring form rule' },
    { header: 'Follow-up checks', width: 10, format: 'integer', value: (f) => f.recheckCount },
    { header: 'Last follow-up check', width: 18, format: 'datetime', value: (f) => dateTimeCell(f.lastRecheckedAt, zone) },
    { header: 'Escalated at', width: 18, format: 'datetime', value: (f) => dateTimeCell(f.escalatedAt, zone) },
    { header: 'Rectified / dismissed at', width: 18, format: 'datetime', value: (f) => dateTimeCell(f.resolvedAt, zone) },
    { header: 'Rectified / dismissed by', width: 22, value: (f) => f.resolvedByName },
    { header: 'Notes', width: 40, wrap: true, value: (f) => f.resolvedNotes },
    { header: 'Contractor', width: 26, value: (f) => f.projectContractor?.organization.name ?? 'Monitoring side' },
  ];
  const buffer = await buildExportWorkbook({
    brandName: brand,
    title: `Findings${JOIN}${formatProjectCodeWithYear(project.codePrefix)}`,
    generatedAt: now,
    sheets: [
      {
        name: 'Findings',
        title: titleOf(brand, 'Findings', formatProjectCodeWithYear(project.codePrefix)),
        hint: hintOf(
          project.name,
          q.status ? `Status: ${FINDING_STATUS_LABELS[q.status]}` : 'Open, rectified and dismissed',
          `${rows.length} finding(s)`,
          `Times in ${zone}`,
          generatedLine(now, zone, webUser.fullName)
        ),
        columns,
        rows,
        emptyText: 'No findings match these filters.',
        muted: (f) => f.status === 'DISMISSED',
      },
    ],
  });
  return { buffer, fileName: `${project.codePrefix} findings ${zonedCalendarDate(now, zone)}.xlsx` };
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

/** The payment record's own filter, now in the payments service (GET /projects/:id/payments uses it too). */
export { filterPayments };

const roundNgn = (n: number) => Math.round(n * 100) / 100;

/** GET /projects/:id/payments/export.xlsx: the payment record with a totals row (voided entries excluded). */
export async function buildProjectPaymentsExport(projectId: string, webUser: WebJwtPayload, q: PaymentsExportQuery, now = new Date()): Promise<XlsxFile> {
  const [project, summary] = await Promise.all([loadProjectHeader(projectId), getProjectPayments(projectId, webUser, q)]);
  const brand = workspaceShortName(project.tenant.name);
  const zone = safeZone(project.timezone);
  // The service applies the record's filters (G.1): `payments` holds the matching rows.
  const rows = summary.payments;
  const isRelease = (p: PaymentDto) => p.kind === 'RETENTION_RELEASE';
  const columns: ExportColumn<PaymentDto>[] = [
    { header: 'Paid on', width: 14, format: 'date', value: (p) => dateCell(p.paidOn) },
    { header: 'Type', width: 18, value: (p) => PAYMENT_KIND_LABELS[p.kind] },
    { header: 'Reference', width: 18, value: (p) => p.reference },
    { header: 'Description', width: 30, wrap: true, value: (p) => p.description },
    { header: 'Work phase', width: 20, value: (p) => (p.sprint ? `Work phase ${p.sprint.number}${JOIN}${p.sprint.name}` : null) },
    { header: 'Gross amount', width: 17, format: 'money', value: (p) => (isRelease(p) ? null : p.grossAmountNgn) },
    { header: 'Retention held', width: 16, format: 'money', value: (p) => (isRelease(p) ? null : p.retentionHeldNgn) },
    { header: 'Retention released', width: 17, format: 'money', value: (p) => (isRelease(p) ? p.grossAmountNgn : null) },
    { header: 'Net paid', width: 17, format: 'money', value: (p) => p.netAmountNgn },
    { header: 'Exceptions', width: 40, wrap: true, value: (p) => p.exceptions.map((e) => PAYMENT_EXCEPTION_LABELS[e]).join('; ') || null },
    { header: 'Retention note', width: 26, wrap: true, value: (p) => p.retentionOverrideReason },
    { header: 'Source', width: 10, value: (p) => (p.source === 'ERP' ? 'ERP' : 'Manual') },
    { header: 'ERP reference', width: 16, value: (p) => p.externalReference },
    { header: 'Recorded by', width: 22, value: (p) => p.recordedByName },
    { header: 'Recorded at', width: 18, format: 'datetime', value: (p) => dateTimeCell(p.recordedAt, zone) },
    { header: 'Voided', width: 9, value: (p) => (p.voided ? 'Yes' : null) },
    { header: 'Voided at', width: 18, format: 'datetime', value: (p) => dateTimeCell(p.voidedAt, zone) },
    { header: 'Voided by', width: 22, value: (p) => p.voidedByName },
    { header: 'Void reason', width: 30, wrap: true, value: (p) => p.voidReason },
  ];
  const live = rows.filter((p) => !p.voided);
  const sum = (f: (p: PaymentDto) => number) => roundNgn(live.reduce((s, p) => s + f(p), 0));
  const totals = {
    label: 'Total (voided excluded)',
    values: {
      5: sum((p) => (isRelease(p) ? 0 : p.grossAmountNgn)),
      6: sum((p) => (isRelease(p) ? 0 : p.retentionHeldNgn)),
      7: sum((p) => (isRelease(p) ? p.grossAmountNgn : 0)),
      8: sum((p) => p.netAmountNgn),
    },
  };
  const filters = [
    q.search?.trim() && `Search: "${q.search.trim()}"`,
    q.kind && `Type: ${PAYMENT_KIND_LABELS[q.kind]}`,
    (q.from || q.to) && `Paid ${q.from ?? '…'} to ${q.to ?? '…'}`,
    q.sprint && (q.sprint === 'none' ? 'No work phase named' : `Work phase: ${summary.sprints.find((s) => s.id === q.sprint)?.number ?? '?'}`),
    q.exceptionsOnly === 'true' && 'Exceptions only',
  ].filter(Boolean);
  const money = (n: number | null) => (n === null ? 'not set' : `₦${n.toLocaleString('en-NG', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
  const buffer = await buildExportWorkbook({
    brandName: brand,
    title: `Payments${JOIN}${formatProjectCodeWithYear(project.codePrefix)}`,
    generatedAt: now,
    sheets: [
      {
        name: 'Payments',
        title: titleOf(brand, 'Payments', formatProjectCodeWithYear(project.codePrefix)),
        hint: hintOf(
          project.name,
          `Contract sum ${money(summary.contractSumNgn)}`,
          summary.retentionPercentage !== null ? `Retention ${summary.retentionPercentage}%, balance held ${money(summary.retentionBalanceNgn)}` : null,
          filters.length ? filters.join('; ') : 'All payments',
          `${rows.length} payment(s)`,
          generatedLine(now, zone, webUser.fullName)
        ),
        columns,
        rows,
        emptyText: 'No payments match these filters.',
        muted: (p) => p.voided,
        totals,
      },
    ],
  });
  return { buffer, fileName: `${project.codePrefix} payments ${zonedCalendarDate(now, zone)}.xlsx` };
}

// ---------------------------------------------------------------------------
// Programme KPIs
// ---------------------------------------------------------------------------

/** As on the KPI page (web `KPI_STATUS_META`). */
const KPI_STATUS_LABELS: Record<KpiStatus, string> = {
  MET: 'Met',
  NEAR: 'Near target',
  MISSED: 'Missed',
  NO_TARGET: 'No target',
  NO_DATA: 'No data in period',
  NOT_TRACKED: 'Not tracked',
};
const unitLabel = (key: KpiKey) => (KPI_BY_KEY[key].unit === 'PERCENT' ? '%' : 'days');

interface KpiProjectLine {
  key: KpiKey;
  codePrefix: string;
  name: string;
  projectTypeName: string | null;
  regionName: string | null;
  owningOrganizationName: string | null;
  cell: { status: KpiStatus; value: number | null; numerator: number; denominator: number; target: number | null } | null;
}

/** GET /kpis/export.xlsx: the KPI page's filters and period; the programme sheet plus one row per project and KPI. */
export async function buildKpiExport(webUser: WebJwtPayload, q: KpiQuery, now = new Date()): Promise<XlsxFile> {
  const [{ brand }, data] = await Promise.all([workspaceBrand(webUser.tenantId), getKpiDashboard(webUser, q, now)]);
  const zone = data.timeZone;
  const [type, region, owner] = await Promise.all([
    q.projectTypeId ? prisma.projectType.findFirst({ where: { id: q.projectTypeId, tenantId: webUser.tenantId }, select: { name: true } }) : null,
    q.regionId ? prisma.region.findFirst({ where: { id: q.regionId, tenantId: webUser.tenantId }, select: { name: true } }) : null,
    q.owningOrganizationId ? prisma.organization.findFirst({ where: { id: q.owningOrganizationId, tenantId: webUser.tenantId }, select: { name: true } }) : null,
  ]);
  const filters = [type && `Type: ${type.name}`, region && `Zone / State: ${region.name}`, owner && `Owner: ${owner.name}`].filter(Boolean);
  const { from, to } = data.period;
  const baseHint = (count: string) =>
    hintOf(`${from} to ${to} (${zone})`, filters.length ? filters.join('; ') : 'All projects in view', count, generatedLine(now, zone, webUser.fullName));

  const programme: ExportColumn<(typeof data.kpis)[number]>[] = [
    { header: 'Stage', width: 20, value: (k) => KPI_STAGE_META[KPI_BY_KEY[k.key].stage].label },
    { header: 'KPI', width: 44, wrap: true, value: (k) => KPI_BY_KEY[k.key].label },
    { header: 'Value', width: 10, format: 'number', value: (k) => k.value },
    { header: 'Unit', width: 7, value: (k) => unitLabel(k.key) },
    { header: 'Numerator', width: 11, format: 'number', value: (k) => k.numerator },
    { header: 'Denominator', width: 12, format: 'number', value: (k) => k.denominator },
    { header: 'Target', width: 10, format: 'number', value: (k) => (k.targetVaries ? 'Varies by type' : k.target) },
    { header: 'Status', width: 17, value: (k) => KPI_STATUS_LABELS[k.status] },
    { header: 'Projects tracking', width: 12, format: 'integer', value: (k) => k.trackedProjectCount },
  ];
  const lines: KpiProjectLine[] = data.kpis.flatMap((k) =>
    data.projects.map((p) => ({
      key: k.key,
      codePrefix: p.codePrefix,
      name: p.name,
      projectTypeName: p.projectTypeName,
      regionName: p.regionName,
      owningOrganizationName: p.owningOrganizationName,
      cell: p.values[k.key] ?? null,
    }))
  );
  const byProject: ExportColumn<KpiProjectLine>[] = [
    { header: 'Project code', width: 22, value: (l) => formatProjectCodeWithYear(l.codePrefix) },
    { header: 'Project', width: 30, wrap: true, value: (l) => l.name },
    { header: 'Project type', width: 20, value: (l) => l.projectTypeName },
    { header: 'Zone / State', width: 16, value: (l) => l.regionName },
    { header: 'Owner', width: 22, value: (l) => l.owningOrganizationName },
    { header: 'Stage', width: 20, value: (l) => KPI_STAGE_META[KPI_BY_KEY[l.key].stage].label },
    { header: 'KPI', width: 44, wrap: true, value: (l) => KPI_BY_KEY[l.key].label },
    { header: 'Value', width: 10, format: 'number', value: (l) => l.cell?.value ?? null },
    { header: 'Unit', width: 7, value: (l) => unitLabel(l.key) },
    { header: 'Numerator', width: 11, format: 'number', value: (l) => l.cell?.numerator ?? null },
    { header: 'Denominator', width: 12, format: 'number', value: (l) => l.cell?.denominator ?? null },
    { header: 'Target', width: 10, format: 'number', value: (l) => l.cell?.target ?? null },
    { header: 'Status', width: 17, value: (l) => (l.cell ? KPI_STATUS_LABELS[l.cell.status] : 'Not tracked') },
  ];
  const buffer = await buildExportWorkbook({
    brandName: brand,
    title: `Programme KPIs ${from} to ${to}`,
    generatedAt: now,
    sheets: [
      {
        name: 'Programme',
        title: titleOf(brand, 'Programme KPIs', `${from} to ${to}`),
        hint: baseHint(`${data.projectCount} project(s)`),
        columns: programme,
        rows: data.kpis,
        emptyText: 'No KPIs are shown for the projects in view.',
        muted: (k) => k.status === 'NOT_TRACKED',
      },
      {
        name: 'By project',
        title: titleOf(brand, 'Programme KPIs by project', `${from} to ${to}`),
        hint: baseHint(`${data.projectCount} project(s), one row per project and KPI`),
        columns: byProject,
        rows: lines,
        emptyText: 'No projects in view.',
        muted: (l) => l.cell === null,
      },
    ],
  });
  return { buffer, fileName: `${brand ? `${brand} KPIs` : 'Programme KPIs'} ${from} to ${to}.xlsx` };
}
