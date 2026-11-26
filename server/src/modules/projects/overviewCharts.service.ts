import {
  addDays,
  daysBetween,
  deriveSprintStatus,
  roundNgn2,
  unitsActiveInSprint,
  weightedProgressPct,
  zonedCalendarDate,
  type OverviewFindingSeverityRow,
  type OverviewMoney,
  type OverviewProgressCurve,
  type OverviewProgressPoint,
  type OverviewUnitProgress,
  type OverviewVisitMonth,
  type OverviewWorkPhase,
  type ProjectOverviewChartsDto,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, type WebJwtPayload } from '../../middleware/auth.middleware';
import { monitoringConfigOf } from '../visits/visitCore';
import { OVERVIEW_FINDING_PERMISSIONS, OVERVIEW_SCOPE_PERMISSIONS, OVERVIEW_VISIT_PERMISSIONS } from './overview.service';

/**
 * Design round 2026-11-26: GET /projects/:projectId/overview/charts, the Overview dashboard's charts in
 * one read. Months are calendar months in the project zone. A fixed set of queries (skipped when the
 * caller may not see the section); a section the caller may not see is null, never zero.
 *
 * Progress curve:
 * - planned: budget-weighted linear progress over each line's planned window (set from work phases);
 *   lines without a window are left out;
 * - actual: unit progress replayed from the `VISIT_UPDATED` audit entries `acceptSubmission` writes
 *   (`payload.progressIncrease`), units weighted by their lines' amounts over every line's amount; an
 *   imported project starts from the imported %; the current month is the project's % complete;
 * - paid: cumulative gross (interim + final, not voided) over the contract sum, else the budget.
 */

/** Who reads payments (the project Payments page). */
export const OVERVIEW_PAYMENT_PERMISSIONS = ['payments:view', 'payments:record'];

const MAX_CURVE_MONTHS = 36;
const VISIT_MONTHS_BACK = 6;
const VISIT_MONTHS_AHEAD = 2;
const SEVERITIES = ['MINOR', 'MAJOR', 'CRITICAL'] as const;
const PAID_KINDS = ['INTERIM', 'FINAL'] as const;

const round1 = (n: number) => Math.round(n * 10) / 10;

// --- calendar months (YYYY-MM) -------------------------------------------------------------

function monthOf(date: string): string {
  return date.slice(0, 7);
}

function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const index = y * 12 + (m - 1) + n;
  const year = Math.floor(index / 12);
  return `${String(year).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}`;
}

function monthsFromTo(from: string, to: string): string[] {
  const out: string[] = [];
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m);
  return out;
}

function lastDayOfMonth(month: string): string {
  return addDays(`${addMonths(month, 1)}-01`, -1);
}

function quarterOf(date: string): string {
  const [y, m] = date.split('-').map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

function nextQuarter(quarter: string): string {
  const [y, q] = quarter.split('-Q').map(Number);
  return q === 4 ? `${y + 1}-Q1` : `${y}-Q${q + 1}`;
}

/** Quarters compare correctly as strings (YYYY-Qn). */
function quartersFromTo(from: string, to: string): string[] {
  const out: string[] = [];
  for (let q = from; q <= to; q = nextQuarter(q)) out.push(q);
  return out;
}

// --- pure progress maths -------------------------------------------------------------------

interface WindowLine {
  amount: number;
  start: string | null;
  end: string | null;
}

/** Share of a window done at `date` (linear, both days included): 0 before the start, 1 from the end. */
function windowFraction(start: string, end: string, date: string): number {
  if (date < start) return 0;
  if (date >= end) return 1;
  return (daysBetween(start, date) + 1) / (daysBetween(start, end) + 1);
}

/** Budget-weighted planned % at `date` over the lines with a window; null when none has one. */
export function plannedPctAt(lines: WindowLine[], date: string): number | null {
  const windowed = lines.filter((l): l is WindowLine & { start: string; end: string } => !!l.start && !!l.end && l.start <= l.end);
  if (windowed.length === 0) return null;
  const total = windowed.reduce((s, l) => s + Math.max(0, l.amount), 0);
  if (total <= 0) return (windowed.reduce((s, l) => s + windowFraction(l.start, l.end, date), 0) / windowed.length) * 100;
  return (windowed.reduce((s, l) => s + Math.max(0, l.amount) * windowFraction(l.start, l.end, date), 0) / total) * 100;
}

export interface ProgressEvent {
  asOf: string;
  units: Array<{ unitId: string; to: number }>;
}

/** Reads `payload.progressIncrease` of a VISIT_UPDATED audit entry; null when it has none. */
export function progressEventOf(payload: unknown): ProgressEvent | null {
  const raw = (payload as { progressIncrease?: { asOf?: unknown; units?: unknown } } | null)?.progressIncrease;
  if (!raw || typeof raw.asOf !== 'string' || !Array.isArray(raw.units)) return null;
  const units = raw.units
    .map((u) => u as { unitId?: unknown; to?: unknown })
    .filter((u): u is { unitId: string; to: number } => typeof u.unitId === 'string' && typeof u.to === 'number' && Number.isFinite(u.to))
    .map((u) => ({ unitId: u.unitId, to: Math.max(0, Math.min(100, u.to)) }));
  return { asOf: raw.asOf, units };
}

/**
 * Actual % at each date (ascending) from the replayed unit progress: Σ unit amount × unit % over the
 * amount of every line. `hasHistory[i]` says whether any event was dated on or before `dates[i]`.
 */
export function replayActualPct(
  dates: string[],
  events: ProgressEvent[],
  unitAmounts: Map<string, number>,
  totalAmount: number
): Array<{ pct: number; hasHistory: boolean }> {
  const ordered = [...events].sort((a, b) => a.asOf.localeCompare(b.asOf));
  const unitPct = new Map<string, number>();
  let next = 0;
  return dates.map((date) => {
    while (next < ordered.length && ordered[next].asOf <= date) {
      for (const u of ordered[next].units) if (unitAmounts.has(u.unitId)) unitPct.set(u.unitId, u.to);
      next++;
    }
    let done = 0;
    if (totalAmount > 0) for (const [unitId, pct] of unitPct) done += (unitAmounts.get(unitId) ?? 0) * pct;
    return { pct: totalAmount > 0 ? done / totalAmount : 0, hasHistory: next > 0 };
  });
}

// --- the read ------------------------------------------------------------------------------

export async function getProjectOverviewCharts(projectId: string, webUser: WebJwtPayload, now: Date = new Date()): Promise<ProjectOverviewChartsDto> {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: {
      id: true,
      status: true,
      timezone: true,
      createdAt: true,
      activatedAt: true,
      importedAt: true,
      importedProgressPct: true,
      certifiedProgressPct: true,
      totalBudgetNgn: true,
      contractSumNgn: true,
      disbursedToDateNgn: true,
      retentionHeldNgn: true,
      retentionReleasedNgn: true,
      projectTypeSnapshotJson: true,
    },
  });
  if (!project) throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  if (project.status === 'DRAFT') {
    throw new AppError('This project is a draft. Finish setup and set it active first.', 409, 'PROJECT_IS_DRAFT');
  }

  const zone = project.timezone;
  const today = zonedCalendarDate(now, zone);
  const currentMonth = monthOf(today);
  const can = {
    scope: hasWebPermission(webUser, ...OVERVIEW_SCOPE_PERMISSIONS),
    visits: hasWebPermission(webUser, ...OVERVIEW_VISIT_PERMISSIONS),
    findings: hasWebPermission(webUser, ...OVERVIEW_FINDING_PERMISSIONS),
    payments: hasWebPermission(webUser, ...OVERVIEW_PAYMENT_PERMISSIONS),
  };
  const monitoring = monitoringConfigOf(project.projectTypeSnapshotJson);
  const visitFrom = `${addMonths(currentMonth, -VISIT_MONTHS_BACK)}-01`;
  const visitTo = lastDayOfMonth(addMonths(currentMonth, VISIT_MONTHS_AHEAD));

  const [sprints, units, lines, progressAudit, payments, visitGroups, findingGroups, openFindings] = await Promise.all([
    can.scope
      ? prisma.projectSprint.findMany({
          where: { projectId },
          orderBy: { number: 'asc' },
          select: { id: true, number: true, name: true, startDate: true, endDate: true, verificationOutcome: true },
        })
      : null,
    can.scope
      ? prisma.facilityUnit.findMany({
          where: { projectId },
          select: {
            id: true,
            code: true,
            progressPct: true,
            progressAsOf: true,
            startSprintId: true,
            endSprintId: true,
            facility: { select: { name: true } },
            site: { select: { siteNumber: true, schoolName: true } },
          },
        })
      : null,
    can.scope
      ? prisma.boqItem.findMany({
          where: { projectId },
          select: { facilityUnitId: true, budgetedCostNgn: true, cumulativeCertifiedPct: true, plannedStartDate: true, plannedEndDate: true },
        })
      : null,
    can.scope ? prisma.auditLog.findMany({ where: { projectId, action: 'VISIT_UPDATED' }, select: { payload: true } }) : null,
    can.payments
      ? prisma.projectPayment.findMany({
          where: { projectId, voidedAt: null },
          select: { kind: true, paidOn: true, grossAmountNgn: true },
          orderBy: { paidOn: 'asc' },
        })
      : null,
    can.visits
      ? prisma.visit.groupBy({
          by: ['plannedDate', 'status'],
          where: { projectId, status: { not: 'CANCELLED' }, plannedDate: { gte: visitFrom, lte: visitTo } },
          _count: { _all: true },
        })
      : null,
    can.findings ? prisma.finding.groupBy({ by: ['severity', 'status'], where: { projectId }, _count: { _all: true } }) : null,
    can.findings ? prisma.finding.findMany({ where: { projectId, status: 'OPEN' }, select: { severity: true, createdAt: true } }) : null,
  ]);

  // --- money ---
  const budgetNgn = project.totalBudgetNgn === null ? 0 : Number(project.totalBudgetNgn);
  const contractSumNgn = project.contractSumNgn === null ? null : Number(project.contractSumNgn);
  const paid = (payments ?? []).filter((p) => (PAID_KINDS as readonly string[]).includes(p.kind)).map((p) => ({ paidOn: p.paidOn, gross: Number(p.grossAmountNgn) }));
  let money: OverviewMoney | null = null;
  if (payments) {
    const paidGrossNgn = roundNgn2(paid.reduce((s, p) => s + p.gross, 0));
    const byQuarter: OverviewMoney['byQuarter'] = [];
    if (payments.length > 0) {
      const firstQ = quarterOf(payments[0].paidOn);
      const todayQ = quarterOf(today);
      const sums = new Map<string, number>();
      for (const p of paid) sums.set(quarterOf(p.paidOn), (sums.get(quarterOf(p.paidOn)) ?? 0) + p.gross);
      const lastPaidQ = paid.reduce((q, p) => (quarterOf(p.paidOn) > q ? quarterOf(p.paidOn) : q), todayQ);
      for (const quarter of quartersFromTo(firstQ, lastPaidQ)) {
        byQuarter.push({ quarter, paidGrossNgn: roundNgn2(sums.get(quarter) ?? 0) });
      }
    }
    money = {
      budgetNgn,
      contractSumNgn,
      paidGrossNgn,
      paidNetNgn: Number(project.disbursedToDateNgn),
      retentionHeldNgn: Number(project.retentionHeldNgn),
      retentionReleasedNgn: Number(project.retentionReleasedNgn),
      remainingNgn: roundNgn2(Math.max(0, (contractSumNgn ?? budgetNgn) - paidGrossNgn)),
      byQuarter,
    };
  }

  // --- scope: units, work phases, progress curve ---
  let progressCurve: OverviewProgressCurve | null = null;
  let unitRows: OverviewUnitProgress[] | null = null;
  let workPhases: OverviewWorkPhase[] | null = null;
  if (sprints && units && lines && progressAudit) {
    const numberById = new Map(sprints.map((s) => [s.id, s.number]));
    const endDateById = new Map(sprints.map((s) => [s.id, s.endDate]));
    const linesByUnit = new Map<string, typeof lines>();
    for (const l of lines) {
      if (!l.facilityUnitId) continue;
      linesByUnit.set(l.facilityUnitId, [...(linesByUnit.get(l.facilityUnitId) ?? []), l]);
    }
    const windowOf = (l: (typeof lines)[number]): WindowLine => ({ amount: Number(l.budgetedCostNgn), start: l.plannedStartDate, end: l.plannedEndDate });

    unitRows = units
      .map((u) => {
        const own = linesByUnit.get(u.id) ?? [];
        const progressLines = own.map((l) => ({ amountNgn: Number(l.budgetedCostNgn), progressPct: Number(l.cumulativeCertifiedPct) }));
        const progress = weightedProgressPct(progressLines) ?? (u.progressPct === null ? 0 : Number(u.progressPct));
        const planned = plannedPctAt(own.map(windowOf), today);
        const endDate = u.endSprintId ? endDateById.get(u.endSprintId) ?? null : null;
        return {
          unitId: u.id,
          unitCode: u.code,
          facilityName: u.facility.name,
          siteNumber: u.site?.siteNumber ?? null,
          siteName: u.site?.schoolName ?? null,
          progressPct: round1(progress),
          plannedPct: planned === null ? null : round1(planned),
          // The R2 behind rule (as the site status reads it): end work phase ended, a line below 100%.
          behind: endDate !== null && endDate < today && own.some((l) => Number(l.cumulativeCertifiedPct) < 100),
          amountNgn: roundNgn2(progressLines.reduce((s, l) => s + l.amountNgn, 0)),
        };
      })
      .sort(
        (a, b) =>
          (a.siteNumber ?? Number.MAX_SAFE_INTEGER) - (b.siteNumber ?? Number.MAX_SAFE_INTEGER) ||
          a.facilityName.localeCompare(b.facilityName) ||
          a.unitCode.localeCompare(b.unitCode, undefined, { numeric: true })
      );

    const unitSpans = units.map((u) => ({
      startSprintNumber: u.startSprintId ? numberById.get(u.startSprintId) ?? null : null,
      endSprintNumber: u.endSprintId ? numberById.get(u.endSprintId) ?? null : null,
    }));
    workPhases = sprints.map((s) => ({
      id: s.id,
      number: s.number,
      name: s.name || null,
      startDate: s.startDate,
      endDate: s.endDate,
      status: deriveSprintStatus(s, today, monitoring.sprintVerificationDays),
      verificationOutcome: s.verificationOutcome ?? null,
      unitCount: unitsActiveInSprint(unitSpans, s.number).length,
    }));

    // Months: from the earliest start fact to the later of this month and the last planned end.
    const importedDate = project.importedAt ? zonedCalendarDate(project.importedAt, zone) : null;
    const startCandidates = [
      project.activatedAt ? zonedCalendarDate(project.activatedAt, zone) : null,
      sprints.reduce<string | null>((min, s) => (min === null || s.startDate < min ? s.startDate : min), null),
      payments && payments.length > 0 ? payments[0].paidOn : null,
      importedDate,
    ].filter((d): d is string => !!d);
    const startDate = startCandidates.length > 0 ? startCandidates.reduce((a, b) => (a < b ? a : b)) : today;
    const lastPlannedEnd = lines.reduce<string | null>((max, l) => (l.plannedEndDate && (max === null || l.plannedEndDate > max) ? l.plannedEndDate : max), null);
    const endMonth = lastPlannedEnd && monthOf(lastPlannedEnd) > currentMonth ? monthOf(lastPlannedEnd) : currentMonth;
    const startMonth = monthOf(startDate) < endMonth ? monthOf(startDate) : endMonth;
    const months = monthsFromTo(startMonth, endMonth).slice(-MAX_CURVE_MONTHS);
    const dates = months.map((m) => (m === currentMonth ? today : lastDayOfMonth(m)));

    const windows = lines.map(windowOf);
    const currentPct = round1(Number(project.certifiedProgressPct));
    const plannedToday = plannedPctAt(windows, today);

    const unitAmounts = new Map(units.map((u) => [u.id, (linesByUnit.get(u.id) ?? []).reduce((s, l) => s + Number(l.budgetedCostNgn), 0)]));
    const totalAmount = lines.reduce((s, l) => s + Math.max(0, Number(l.budgetedCostNgn)), 0);
    const events = progressAudit.map((a) => progressEventOf(a.payload)).filter((e): e is ProgressEvent => e !== null);
    // A unit's latest observation (progressAsOf) is history too: kept when no audited raise covers it
    // (progress written before the audit entry existed, or lowered by a later visit).
    for (const u of units) {
      if (u.progressPct === null || !u.progressAsOf) continue;
      const covered = events.some((e) => e.asOf >= u.progressAsOf! && e.units.some((x) => x.unitId === u.id));
      if (!covered) events.push({ asOf: u.progressAsOf, units: [{ unitId: u.id, to: Number(u.progressPct) }] });
    }
    const replayed = replayActualPct(dates, events, unitAmounts, totalAmount);
    const importedPct = project.importedAt && project.importedProgressPct !== null ? Number(project.importedProgressPct) : null;
    const importMonth = importedDate ? monthOf(importedDate) : null;

    const paidBasis: OverviewProgressCurve['paidBasis'] = !payments
      ? null
      : contractSumNgn !== null && contractSumNgn > 0
        ? 'CONTRACT_SUM'
        : budgetNgn > 0
          ? 'BUDGET'
          : null;
    const basisAmount = paidBasis === 'CONTRACT_SUM' ? contractSumNgn! : budgetNgn;

    const points: OverviewProgressPoint[] = months.map((month, i) => {
      const date = dates[i];
      const future = month > currentMonth;
      let actual: number | null = null;
      if (month === currentMonth) actual = currentPct;
      else if (!future) {
        if (importedPct !== null && importMonth !== null) {
          // Imported projects: no record before the import; the imported % until visits add history.
          if (month >= importMonth) actual = replayed[i].hasHistory ? replayed[i].pct : importedPct;
        } else actual = replayed[i].pct;
      }
      const planned = plannedPctAt(windows, date);
      const paidPct =
        paidBasis === null || future ? null : (paid.filter((p) => p.paidOn <= date).reduce((s, p) => s + p.gross, 0) / basisAmount) * 100;
      return {
        month,
        date,
        plannedPct: planned === null ? null : round1(planned),
        actualPct: actual === null ? null : round1(actual),
        paidPct: paidPct === null ? null : round1(paidPct),
      };
    });

    progressCurve = {
      points,
      paidBasis,
      currentPct,
      plannedTodayPct: plannedToday === null ? null : round1(plannedToday),
    };
  }

  // --- monitoring visits by planned month ---
  let visitsByMonth: OverviewVisitMonth[] | null = null;
  if (visitGroups) {
    const rows = new Map<string, OverviewVisitMonth>();
    for (const month of monthsFromTo(addMonths(currentMonth, -VISIT_MONTHS_BACK), addMonths(currentMonth, VISIT_MONTHS_AHEAD))) {
      rows.set(month, { month, accepted: 0, awaitingReview: 0, returned: 0, missed: 0, upcoming: 0 });
    }
    for (const g of visitGroups) {
      const row = rows.get(monthOf(g.plannedDate));
      if (!row) continue;
      const n = g._count._all;
      if (g.status === 'APPROVED') row.accepted += n;
      else if (g.status === 'SUBMITTED') row.awaitingReview += n;
      else if (g.status === 'RETURNED') row.returned += n;
      else if (g.status === 'MISSED') row.missed += n;
      else if (g.status === 'PROPOSED' || g.status === 'PLANNED' || g.status === 'IN_PROGRESS') row.upcoming += n;
    }
    visitsByMonth = [...rows.values()];
  }

  // --- findings by severity ---
  let findingsBySeverity: OverviewFindingSeverityRow[] | null = null;
  if (findingGroups && openFindings) {
    const count = (severity: string, status: string) =>
      findingGroups.find((g) => g.severity === severity && g.status === status)?._count._all ?? 0;
    // As the finding-escalations job counts: whole days since it was raised, in the project zone.
    const overdue = (severity: string) =>
      openFindings.filter((f) => f.severity === severity && daysBetween(zonedCalendarDate(f.createdAt, zone), today) >= monitoring.findingEscalationDays)
        .length;
    findingsBySeverity = SEVERITIES.map((severity) => ({
      severity,
      open: count(severity, 'OPEN'),
      openOverdue: overdue(severity),
      resolved: count(severity, 'RESOLVED'),
      dismissed: count(severity, 'DISMISSED'),
    }));
  }

  return {
    projectId: project.id,
    today,
    progressCurve,
    units: unitRows,
    workPhases,
    visitsByMonth,
    findingsBySeverity,
    money,
  };
}
