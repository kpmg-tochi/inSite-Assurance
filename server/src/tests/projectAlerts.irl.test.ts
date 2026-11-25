/**
 * UBEC IRL early-warning alerts: the pure rules (`evaluateProjectAlerts`), the config defaults and
 * the stored-state helpers. No database.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  activeProjectAlertKeys,
  DEFAULT_PROJECT_ALERTS_CONFIG,
  evaluateDelayed,
  evaluateProjectAlerts,
  evaluateSiteUpdateOverdue,
  evaluateSpendAheadOfProgress,
  evaluateStalled,
  parseProjectAlertState,
  PROJECT_ALERT_KEYS,
  PROJECT_ALERT_META,
  ProjectAlertsConfigSchema,
  ProjectTypeConfigSchema,
  WebNotificationCategoryEnum,
  type ProjectAlertFacts,
} from '@insite/shared';

const base: ProjectAlertFacts = {
  today: '2026-11-25',
  status: 'ACTIVE',
  constructionPhase: 'ACTIVE_CONSTRUCTION',
  scheduleStatus: 'ON_TRACK',
  activatedDate: '2026-09-01',
  firstSprintStartDate: '2026-09-15',
  hasUnits: true,
  lastProgressIncreaseDate: '2026-11-20',
  lastAcceptedVisitDate: '2026-11-20',
  progressPct: 40,
  contractSumNgn: 100_000_000,
  netPaidNgn: 40_000_000,
  paymentCount: 1,
};
const cfg = DEFAULT_PROJECT_ALERTS_CONFIG;
const f = (patch: Partial<ProjectAlertFacts>): ProjectAlertFacts => ({ ...base, ...patch });

describe('UBEC IRL alerts: config', () => {
  it('defaults every alert on with the IRL thresholds', () => {
    assert.deepEqual(ProjectAlertsConfigSchema.parse({}), {
      delayed: { enabled: true },
      stalled: { enabled: true, days: 30 },
      siteUpdateOverdue: { enabled: true, days: 14 },
      spendAheadOfProgress: { enabled: true, percentagePoints: 15 },
    });
  });

  it('is a defaulted key of the type monitoring config', () => {
    const parsed = ProjectTypeConfigSchema.parse({});
    assert.deepEqual(parsed.monitoring.alerts, DEFAULT_PROJECT_ALERTS_CONFIG);
    const custom = ProjectTypeConfigSchema.parse({ monitoring: { alerts: { stalled: { days: 45 } } } });
    assert.equal(custom.monitoring.alerts.stalled.days, 45);
    assert.equal(custom.monitoring.alerts.stalled.enabled, true);
    assert.equal(custom.monitoring.alerts.siteUpdateOverdue.days, 14);
  });

  it('refuses thresholds out of range', () => {
    assert.equal(ProjectAlertsConfigSchema.safeParse({ stalled: { days: 2 } }).success, false);
    assert.equal(ProjectAlertsConfigSchema.safeParse({ siteUpdateOverdue: { days: 0 } }).success, false);
    assert.equal(ProjectAlertsConfigSchema.safeParse({ spendAheadOfProgress: { percentagePoints: 0 } }).success, false);
  });

  it('maps each alert to a web notification category that exists', () => {
    for (const k of PROJECT_ALERT_KEYS) assert.ok(WebNotificationCategoryEnum.options.includes(PROJECT_ALERT_META[k].webCategory), k);
    assert.equal(PROJECT_ALERT_META.DELAYED.webCategory, 'SCHEDULE_BEHIND');
    assert.deepEqual(
      PROJECT_ALERT_KEYS.filter((k) => PROJECT_ALERT_META[k].notifiesFieldOfficers),
      ['STALLED', 'SITE_UPDATE_OVERDUE']
    );
  });
});

describe('UBEC IRL alerts: DELAYED', () => {
  it('follows the stored BEHIND badge in construction and handover', () => {
    assert.equal(evaluateDelayed(f({ scheduleStatus: 'BEHIND' }), cfg).active, true);
    assert.equal(evaluateDelayed(f({ scheduleStatus: 'BEHIND', constructionPhase: 'HANDOVER_IN_PROGRESS' }), cfg).active, true);
    assert.equal(evaluateDelayed(f({ scheduleStatus: 'BEHIND', constructionPhase: 'RETENTION_PERIOD' }), cfg).active, false);
    assert.equal(evaluateDelayed(f({ scheduleStatus: 'ON_TRACK' }), cfg).active, false);
    assert.equal(evaluateDelayed(f({ scheduleStatus: 'BEHIND', status: 'ARCHIVED' }), cfg).active, false);
  });

  it('can be switched off', () => {
    const off = ProjectAlertsConfigSchema.parse({ delayed: { enabled: false } });
    assert.equal(evaluateDelayed(f({ scheduleStatus: 'BEHIND' }), off).active, false);
  });
});

describe('UBEC IRL alerts: STALLED', () => {
  it('counts from the last visit that raised unit progress', () => {
    const r = evaluateStalled(f({ lastProgressIncreaseDate: '2026-10-26' }), cfg);
    assert.equal(r.days, 30);
    assert.equal(r.active, true, 'exactly N days is stalled');
    assert.equal(evaluateStalled(f({ lastProgressIncreaseDate: '2026-10-27' }), cfg).active, false);
  });

  it('counts from the first sprint start when nothing raised progress yet', () => {
    assert.equal(evaluateStalled(f({ lastProgressIncreaseDate: null, firstSprintStartDate: '2026-10-26' }), cfg).active, true);
    assert.equal(evaluateStalled(f({ lastProgressIncreaseDate: null, firstSprintStartDate: '2026-11-01' }), cfg).active, false);
  });

  it('ignores accepted visits that did not raise unit progress', () => {
    const r = evaluateStalled(f({ lastProgressIncreaseDate: '2026-10-01', lastAcceptedVisitDate: '2026-11-24' }), cfg);
    assert.equal(r.active, true);
    assert.equal(r.days, 55);
  });

  it('uses any accepted visit for projects without facility units', () => {
    assert.equal(evaluateStalled(f({ hasUnits: false, lastProgressIncreaseDate: null, lastAcceptedVisitDate: '2026-11-24' }), cfg).active, false);
    assert.equal(evaluateStalled(f({ hasUnits: false, lastProgressIncreaseDate: null, lastAcceptedVisitDate: null }), cfg).active, true);
  });

  it('falls back to activation without sprints; not before sprint 1 starts', () => {
    assert.equal(evaluateStalled(f({ firstSprintStartDate: null, lastProgressIncreaseDate: null, activatedDate: '2026-10-01' }), cfg).active, true);
    assert.equal(evaluateStalled(f({ firstSprintStartDate: '2026-12-01', lastProgressIncreaseDate: null }), cfg).active, false);
  });

  it('only in construction, below 100%, when enabled; threshold from the config', () => {
    const stalled = f({ lastProgressIncreaseDate: '2026-09-01' });
    assert.equal(evaluateStalled({ ...stalled, constructionPhase: 'HANDOVER_IN_PROGRESS' }, cfg).active, false);
    assert.equal(evaluateStalled({ ...stalled, progressPct: 100 }, cfg).active, false);
    assert.equal(evaluateStalled(stalled, ProjectAlertsConfigSchema.parse({ stalled: { enabled: false } })).active, false);
    const sixty = ProjectAlertsConfigSchema.parse({ stalled: { days: 60 } });
    assert.equal(evaluateStalled(f({ lastProgressIncreaseDate: '2026-10-01' }), sixty).active, false);
    assert.equal(evaluateStalled(f({ lastProgressIncreaseDate: '2026-09-26' }), sixty).active, true);
  });
});

describe('UBEC IRL alerts: SITE_UPDATE_OVERDUE', () => {
  it('counts calendar days since the last accepted visit, or activation before the first', () => {
    const r = evaluateSiteUpdateOverdue(f({ lastAcceptedVisitDate: '2026-11-11' }), cfg);
    assert.deepEqual([r.active, r.days, r.limit], [true, 14, 14]);
    assert.equal(evaluateSiteUpdateOverdue(f({ lastAcceptedVisitDate: '2026-11-12' }), cfg).active, false);
    assert.equal(evaluateSiteUpdateOverdue(f({ lastAcceptedVisitDate: null, activatedDate: '2026-11-20' }), cfg).active, false, 'grace after activation');
    assert.equal(evaluateSiteUpdateOverdue(f({ lastAcceptedVisitDate: null, activatedDate: '2026-11-01' }), cfg).active, true);
    // A visit accepted before activation (imported or reactivated projects) still counts.
    assert.equal(evaluateSiteUpdateOverdue(f({ lastAcceptedVisitDate: '2026-11-02', activatedDate: '2026-11-25' }), cfg).active, true);
  });

  it('only in mobilisation and construction (phase ACTIVE_CONSTRUCTION)', () => {
    const late = f({ lastAcceptedVisitDate: '2026-10-01' });
    assert.equal(evaluateSiteUpdateOverdue(late, cfg).active, true);
    assert.equal(evaluateSiteUpdateOverdue({ ...late, constructionPhase: 'HANDOVER_IN_PROGRESS' }, cfg).active, false);
    assert.equal(evaluateSiteUpdateOverdue({ ...late, constructionPhase: 'RETENTION_PERIOD' }, cfg).active, false);
    assert.equal(evaluateSiteUpdateOverdue(late, ProjectAlertsConfigSchema.parse({ siteUpdateOverdue: { days: 60 } })).active, false);
  });
});

describe('UBEC IRL alerts: SPEND_AHEAD_OF_PROGRESS', () => {
  it('fires when paid % exceeds % complete by more than the points', () => {
    const r = evaluateSpendAheadOfProgress(f({ netPaidNgn: 60_000_000, progressPct: 40 }), cfg);
    assert.deepEqual([r.active, r.spendPct, r.progressPct, r.gapPoints, r.limit], [true, 60, 40, 20, 15]);
    assert.equal(evaluateSpendAheadOfProgress(f({ netPaidNgn: 55_000_000, progressPct: 40 }), cfg).active, false, 'exactly 15 points is not above');
    assert.equal(evaluateSpendAheadOfProgress(f({ netPaidNgn: 55_100_000, progressPct: 40 }), cfg).active, true);
  });

  it('needs a contract sum and a recorded payment', () => {
    assert.equal(evaluateSpendAheadOfProgress(f({ netPaidNgn: 90_000_000, contractSumNgn: null }), cfg).active, false);
    assert.equal(evaluateSpendAheadOfProgress(f({ netPaidNgn: 90_000_000, contractSumNgn: 0 }), cfg).active, false);
    assert.equal(evaluateSpendAheadOfProgress(f({ netPaidNgn: 90_000_000, paymentCount: 0 }), cfg).active, false);
  });

  it('in construction and handover only, when enabled', () => {
    const ahead = f({ netPaidNgn: 90_000_000 });
    assert.equal(evaluateSpendAheadOfProgress({ ...ahead, constructionPhase: 'HANDOVER_IN_PROGRESS' }, cfg).active, true);
    assert.equal(evaluateSpendAheadOfProgress({ ...ahead, constructionPhase: 'RETENTION_PERIOD' }, cfg).active, false);
    assert.equal(evaluateSpendAheadOfProgress(ahead, ProjectAlertsConfigSchema.parse({ spendAheadOfProgress: { enabled: false } })).active, false);
    assert.equal(evaluateSpendAheadOfProgress(ahead, ProjectAlertsConfigSchema.parse({ spendAheadOfProgress: { percentagePoints: 60 } })).active, false);
  });
});

describe('UBEC IRL alerts: all rules and stored state', () => {
  it('evaluates every key in order', () => {
    assert.deepEqual(evaluateProjectAlerts(base, cfg).map((e) => e.key), [...PROJECT_ALERT_KEYS]);
    assert.deepEqual(evaluateProjectAlerts(base, cfg).filter((e) => e.active), []);
  });

  it('parses the stored state and lists the visible active keys', () => {
    const raw = { SPEND_AHEAD_OF_PROGRESS: '2026-11-01T00:00:00.000Z', STALLED: '2026-11-02T00:00:00.000Z', BOGUS: 'x', DELAYED: 5 };
    assert.deepEqual(parseProjectAlertState(raw), { SPEND_AHEAD_OF_PROGRESS: '2026-11-01T00:00:00.000Z', STALLED: '2026-11-02T00:00:00.000Z' });
    assert.deepEqual(activeProjectAlertKeys(raw), ['STALLED', 'SPEND_AHEAD_OF_PROGRESS']);
    assert.deepEqual(activeProjectAlertKeys(raw, { status: 'ARCHIVED' }), []);
    assert.deepEqual(activeProjectAlertKeys(raw, { status: 'ACTIVE', canView: (perms) => perms.includes('nothing') }), ['STALLED']);
    assert.deepEqual(activeProjectAlertKeys(null), []);
    assert.deepEqual(activeProjectAlertKeys([]), []);
  });
});
