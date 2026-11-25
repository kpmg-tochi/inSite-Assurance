import { daysBetween } from './calendar';
import {
  PROJECT_ALERT_KEYS,
  PROJECT_ALERT_META,
  ProjectAlertKeyEnum,
  type ProjectAlertKey,
  type ProjectAlertsConfig,
} from '../schemas/projectAlert.schema';

/**
 * UBEC IRL early-warning alert rules (pure). Dates are YYYY-MM-DD in the project zone; day counts are
 * calendar days. Only ACTIVE projects are evaluated; each rule names the construction phases it
 * applies in. See `ProjectAlertsConfigSchema` for the thresholds.
 */

export interface ProjectAlertFacts {
  /** Today in the project zone. */
  today: string;
  status: string;
  constructionPhase: string;
  /** Stored schedule badge (`Project.scheduleStatus`). */
  scheduleStatus: string | null;
  /** Activation day in the project zone (creation day when the project has no activation time). */
  activatedDate: string | null;
  /** Start of sprint 1, when the project has sprints. */
  firstSprintStartDate: string | null;
  /** True when the project has facility units (progress is reported per unit through visits). */
  hasUnits: boolean;
  /** Visit date of the latest accepted visit that raised the progress of at least one unit. */
  lastProgressIncreaseDate: string | null;
  /** Visit date of the latest accepted visit submission. */
  lastAcceptedVisitDate: string | null;
  /** Project % complete (0–100). */
  progressPct: number;
  contractSumNgn: number | null;
  /** Net paid to date (`Project.disbursedToDateNgn`). */
  netPaidNgn: number;
  /** Recorded payments that are not voided. */
  paymentCount: number;
}

export interface ProjectAlertEvaluation {
  key: ProjectAlertKey;
  active: boolean;
  /** Days since the reference date (STALLED, SITE_UPDATE_OVERDUE). */
  days?: number;
  /** The threshold that applied (days or percentage points). */
  limit?: number;
  /** SPEND_AHEAD_OF_PROGRESS: paid as % of the contract sum, % complete and the gap, 1 decimal. */
  spendPct?: number;
  progressPct?: number;
  gapPoints?: number;
}

const DELIVERY_PHASES = new Set(['ACTIVE_CONSTRUCTION', 'HANDOVER_IN_PROGRESS']);

function latest(...dates: Array<string | null | undefined>): string | null {
  const present = dates.filter((d): d is string => Boolean(d));
  return present.length ? present.reduce((a, b) => (a > b ? a : b)) : null;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** DELAYED: the stored schedule badge is BEHIND, in construction or handover. */
export function evaluateDelayed(f: ProjectAlertFacts, config: ProjectAlertsConfig): ProjectAlertEvaluation {
  const active = config.delayed.enabled && f.status === 'ACTIVE' && DELIVERY_PHASES.has(f.constructionPhase) && f.scheduleStatus === 'BEHIND';
  return { key: 'DELAYED', active };
}

/**
 * STALLED: in construction, below 100%, sprint 1 (else activation) has started, and for at least
 * `stalled.days` days no accepted visit raised unit progress. The count starts at the later of the
 * start and the last such visit. Projects without facility units cannot report unit progress: any
 * accepted visit counts for them.
 */
export function evaluateStalled(f: ProjectAlertFacts, config: ProjectAlertsConfig): ProjectAlertEvaluation {
  const limit = config.stalled.days;
  const start = f.firstSprintStartDate ?? f.activatedDate;
  if (!config.stalled.enabled || f.status !== 'ACTIVE' || f.constructionPhase !== 'ACTIVE_CONSTRUCTION' || !start || start > f.today || f.progressPct >= 100) {
    return { key: 'STALLED', active: false, limit };
  }
  const reference = latest(start, f.hasUnits ? f.lastProgressIncreaseDate : f.lastAcceptedVisitDate)!;
  const days = Math.max(0, daysBetween(reference, f.today));
  return { key: 'STALLED', active: days >= limit, days, limit };
}

/**
 * SITE_UPDATE_OVERDUE: in mobilisation or construction (phase ACTIVE_CONSTRUCTION), and for at least
 * `siteUpdateOverdue.days` days no visit was accepted. The count starts at the last accepted visit's
 * date, or at activation while no visit has been accepted yet.
 */
export function evaluateSiteUpdateOverdue(f: ProjectAlertFacts, config: ProjectAlertsConfig): ProjectAlertEvaluation {
  const limit = config.siteUpdateOverdue.days;
  if (!config.siteUpdateOverdue.enabled || f.status !== 'ACTIVE' || f.constructionPhase !== 'ACTIVE_CONSTRUCTION' || !f.activatedDate) {
    return { key: 'SITE_UPDATE_OVERDUE', active: false, limit };
  }
  const reference = f.lastAcceptedVisitDate ?? f.activatedDate;
  const days = Math.max(0, daysBetween(reference, f.today));
  return { key: 'SITE_UPDATE_OVERDUE', active: days >= limit, days, limit };
}

/**
 * SPEND_AHEAD_OF_PROGRESS: in construction or handover, with a contract sum and at least one
 * recorded payment, net paid as % of the contract sum exceeds % complete by more than
 * `spendAheadOfProgress.percentagePoints`.
 */
export function evaluateSpendAheadOfProgress(f: ProjectAlertFacts, config: ProjectAlertsConfig): ProjectAlertEvaluation {
  const limit = config.spendAheadOfProgress.percentagePoints;
  if (
    !config.spendAheadOfProgress.enabled ||
    f.status !== 'ACTIVE' ||
    !DELIVERY_PHASES.has(f.constructionPhase) ||
    f.contractSumNgn === null ||
    !(f.contractSumNgn > 0) ||
    f.paymentCount < 1
  ) {
    return { key: 'SPEND_AHEAD_OF_PROGRESS', active: false, limit };
  }
  const spendPct = (f.netPaidNgn / f.contractSumNgn) * 100;
  // Rounded to 0.01 points so floating-point noise never tips the comparison.
  const gap = Math.round((spendPct - f.progressPct) * 100) / 100;
  return {
    key: 'SPEND_AHEAD_OF_PROGRESS',
    active: gap > limit,
    limit,
    spendPct: round1(spendPct),
    progressPct: round1(f.progressPct),
    gapPoints: round1(gap),
  };
}

/** Every rule, in `PROJECT_ALERT_KEYS` order. */
export function evaluateProjectAlerts(f: ProjectAlertFacts, config: ProjectAlertsConfig): ProjectAlertEvaluation[] {
  return [evaluateDelayed(f, config), evaluateStalled(f, config), evaluateSiteUpdateOverdue(f, config), evaluateSpendAheadOfProgress(f, config)];
}

/** The stored state (`Project.alertStateJson`), ignoring unknown keys and malformed values. */
export function parseProjectAlertState(raw: unknown): Partial<Record<ProjectAlertKey, string>> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out: Partial<Record<ProjectAlertKey, string>> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = ProjectAlertKeyEnum.safeParse(k);
    if (key.success && typeof v === 'string') out[key.data] = v;
  }
  return out;
}

/**
 * The active alert keys to show, in `PROJECT_ALERT_KEYS` order: none unless the project is ACTIVE;
 * alerts with `viewPermissions` only when `canView` allows them (e.g. spend needs a payments permission).
 */
export function activeProjectAlertKeys(
  raw: unknown,
  opts: { status?: string; canView?: (permissions: readonly string[]) => boolean } = {}
): ProjectAlertKey[] {
  if (opts.status !== undefined && opts.status !== 'ACTIVE') return [];
  const state = parseProjectAlertState(raw);
  return PROJECT_ALERT_KEYS.filter((k) => {
    if (!state[k]) return false;
    const perms = PROJECT_ALERT_META[k].viewPermissions;
    return !perms || !opts.canView || opts.canView(perms);
  });
}
