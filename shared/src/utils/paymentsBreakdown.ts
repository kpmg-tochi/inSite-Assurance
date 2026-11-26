import { fiscalQuarterOf, fiscalYearOf, DEFAULT_FISCAL_YEAR_START_MONTH } from './fiscalYear';
import type { PaymentsBreakdownBy, PaymentsBreakdownRowDto, PaymentsBreakdownTotals } from '../schemas/portfolioPayments.schema';
import { lgaByCode, stateByCode, zoneName, zoneOfState } from '../data/nigeriaAdminAreas';

/**
 * Client demo updates G.1/G.2 (wave 4): payments grouped by zone, State, LGA, contractor, project,
 * month or fiscal quarter, each group with the summary's totals (pure; the server loads the
 * matching payments, voided ones excluded, and their projects). Gross and retention held exclude
 * retention releases, as on the summary cards; net includes them.
 *
 * LGA: payments are recorded per project, not per site, so a project with sites in several LGAs is
 * counted in full under each of its LGAs (`sharedAcrossGroups` on those rows); the totals count it
 * once. A project with no State, LGA or contractor goes to an "Not recorded" group.
 */

export interface BreakdownPayment {
  projectId: string;
  kind: 'INTERIM' | 'FINAL' | 'RETENTION_RELEASE';
  /** YYYY-MM-DD */
  paidOn: string;
  grossAmountNgn: number;
  retentionHeldNgn: number;
  netAmountNgn: number;
  hasException: boolean;
}

export interface BreakdownProject {
  id: string;
  /** Formatted code ("LOT 5 BATCH 7"). */
  code: string;
  name: string;
  stateCode: string | null;
  /** State text of older projects without a code. */
  stateText: string | null;
  /** The project's LGAs: its sites' LGAs, else its own LGA (codes). */
  lgaCodes: string[];
  contractorId: string | null;
  contractorName: string | null;
}

export const NOT_RECORDED_KEY = '__none__';
const NOT_RECORDED = 'Not recorded';

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-03" / "Mar 2026" for a month; "2026-Q1" / "Q1 FY2026" for a fiscal quarter. */
export function paymentPeriodGroup(
  paidOn: string,
  by: 'month' | 'quarter',
  fiscalYearStartMonth: number = DEFAULT_FISCAL_YEAR_START_MONTH
): { key: string; label: string } {
  if (by === 'month') {
    const [y, m] = paidOn.split('-').map(Number);
    return { key: `${y}-${String(m).padStart(2, '0')}`, label: `${MONTH_SHORT[m - 1]} ${y}` };
  }
  const fy = fiscalYearOf(paidOn, fiscalYearStartMonth);
  const q = fiscalQuarterOf(paidOn, fiscalYearStartMonth);
  return { key: `${fy}-Q${q}`, label: `Q${q} FY${fy}` };
}

interface Group {
  key: string;
  label: string;
  context: string | null;
  gross: number;
  held: number;
  released: number;
  net: number;
  count: number;
  exceptions: number;
  projects: Set<string>;
  shared: boolean;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

function groupsOf(
  p: BreakdownPayment,
  project: BreakdownProject | undefined,
  by: PaymentsBreakdownBy,
  fyStart: number
): Array<{ key: string; label: string; context: string | null; shared: boolean }> {
  const none = [{ key: NOT_RECORDED_KEY, label: NOT_RECORDED, context: null, shared: false }];
  switch (by) {
    case 'month':
    case 'quarter':
      return [{ ...paymentPeriodGroup(p.paidOn, by, fyStart), context: null, shared: false }];
    case 'project':
      return project ? [{ key: project.id, label: `${project.code} · ${project.name}`, context: stateByCode(project.stateCode)?.name ?? project.stateText, shared: false }] : none;
    case 'contractor':
      return project?.contractorId ? [{ key: project.contractorId, label: project.contractorName ?? NOT_RECORDED, context: null, shared: false }] : none;
    case 'zone': {
      const zone = zoneOfState(project?.stateCode);
      return zone ? [{ key: zone, label: zoneName(zone) ?? zone, context: null, shared: false }] : none;
    }
    case 'state': {
      const state = stateByCode(project?.stateCode);
      if (state) return [{ key: state.code, label: state.name, context: zoneName(zoneOfState(state.code)), shared: false }];
      return project?.stateText ? [{ key: `text:${project.stateText.toLowerCase()}`, label: project.stateText, context: null, shared: false }] : none;
    }
    case 'lga': {
      const codes = [...new Set(project?.lgaCodes ?? [])];
      if (codes.length === 0) return none;
      return codes.map((c) => {
        const lga = lgaByCode(c);
        return { key: c, label: lga?.name ?? c, context: stateByCode(lga?.stateCode)?.name ?? null, shared: codes.length > 1 };
      });
    }
  }
}

function totalsOf(g: Omit<Group, 'key' | 'label' | 'context' | 'shared'>): PaymentsBreakdownTotals {
  return {
    grossPaidNgn: round2(g.gross),
    retentionHeldNgn: round2(g.held),
    retentionReleasedNgn: round2(g.released),
    netPaidNgn: round2(g.net),
    paymentCount: g.count,
    exceptionCount: g.exceptions,
    projectCount: g.projects.size,
  };
}

function add(g: Omit<Group, 'key' | 'label' | 'context' | 'shared'>, p: BreakdownPayment) {
  if (p.kind === 'RETENTION_RELEASE') {
    g.released += p.grossAmountNgn;
  } else {
    g.gross += p.grossAmountNgn;
    g.held += p.retentionHeldNgn;
  }
  g.net += p.netAmountNgn;
  g.count += 1;
  if (p.hasException) g.exceptions += 1;
  g.projects.add(p.projectId);
}

/**
 * Rows sorted by period (month, quarter) or by net paid, largest first (other groupings); the
 * "Not recorded" group last. Totals count each payment once.
 */
export function buildPaymentsBreakdown(
  payments: BreakdownPayment[],
  projects: BreakdownProject[],
  by: PaymentsBreakdownBy,
  fiscalYearStartMonth: number = DEFAULT_FISCAL_YEAR_START_MONTH
): { rows: PaymentsBreakdownRowDto[]; totals: PaymentsBreakdownTotals; hasSharedGroups: boolean } {
  const byId = new Map(projects.map((p) => [p.id, p]));
  const groups = new Map<string, Group>();
  const all = { gross: 0, held: 0, released: 0, net: 0, count: 0, exceptions: 0, projects: new Set<string>() };
  for (const p of payments) {
    add(all, p);
    for (const k of groupsOf(p, byId.get(p.projectId), by, fiscalYearStartMonth)) {
      let g = groups.get(k.key);
      if (!g) {
        g = { ...k, gross: 0, held: 0, released: 0, net: 0, count: 0, exceptions: 0, projects: new Set() };
        groups.set(k.key, g);
      }
      g.shared = g.shared || k.shared;
      add(g, p);
    }
  }
  const periodSort = by === 'month' || by === 'quarter';
  const rows = [...groups.values()]
    .sort((a, b) => {
      if (a.key === NOT_RECORDED_KEY) return 1;
      if (b.key === NOT_RECORDED_KEY) return -1;
      return periodSort ? a.key.localeCompare(b.key) : b.net - a.net || a.label.localeCompare(b.label);
    })
    .map<PaymentsBreakdownRowDto>((g) => ({ key: g.key, label: g.label, context: g.context, sharedAcrossGroups: g.shared, ...totalsOf(g) }));
  return { rows, totals: totalsOf(all), hasSharedGroups: rows.some((r) => r.sharedAcrossGroups) };
}
