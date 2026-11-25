/**
 * Client demo updates, wave 1 (no database): project codes (C3), fiscal periods and the intervention
 * year rule (D5, G.1), the funding source list (C4) and the widened code validation.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  allowedInterventionYears,
  buildLotBatchCode,
  describePeriod,
  fiscalQuarterOf,
  fiscalYearOf,
  fiscalYearRange,
  formatProjectCode,
  FUNDING_SOURCES,
  fundingSourceCodeFromText,
  fundingSourceText,
  LotChoiceSchema,
  parseLotBatchCode,
  periodRange,
  PROJECT_CODE_PREFIX_REGEX,
  ProjectBasicsStepSchema,
  ProjectListFiltersSchema,
  PortfolioPaymentsQuerySchema,
  splitProjectCode,
} from '@insite/shared';

describe('project codes (C3)', () => {
  it('builds, parses and formats lot/batch codes', () => {
    const code = buildLotBatchCode(2026, 5, 7);
    assert.equal(code, '2026-LOT-5-BATCH-7');
    assert.deepEqual(parseLotBatchCode(code), { year: 2026, lot: 5, batch: 7 });
    assert.deepEqual(parseLotBatchCode('2026-lot-12-batch-3'), { year: 2026, lot: 12, batch: 3 });
    assert.equal(parseLotBatchCode('PRG-102'), null);
    assert.equal(formatProjectCode(code), 'LOT 5 BATCH 7');
    assert.equal(formatProjectCode('PRG-102'), 'PRG-102');
    assert.equal(formatProjectCode(null), '');
  });

  it('accepts both code forms and keeps series numbering on the older one', () => {
    assert.ok(PROJECT_CODE_PREFIX_REGEX.test('PRG-102'));
    assert.ok(PROJECT_CODE_PREFIX_REGEX.test('2026-LOT-5-BATCH-7'));
    assert.ok(!PROJECT_CODE_PREFIX_REGEX.test('LOT-5-BATCH-7'));
    assert.ok(!PROJECT_CODE_PREFIX_REGEX.test('2026-LOT-5'));
    assert.equal(splitProjectCode('2026-LOT-5-BATCH-7'), null);
    assert.deepEqual(splitProjectCode('PRG-102'), { prefix: 'PRG', number: 102 });
  });

  it('basics may omit the code (lot choice) and validate state, LGA and lot', () => {
    const base = { name: 'Renovation of schools', totalBudgetNgn: 1_000_000 };
    assert.ok(ProjectBasicsStepSchema.safeParse({ ...base, stateCode: 'kn', interventionYear: 2026, lotChoice: { newLotTitle: 'Renovation of Public Schools' } }).success);
    assert.ok(!ProjectBasicsStepSchema.safeParse({ ...base, stateCode: 'XX' }).success);
    assert.ok(ProjectBasicsStepSchema.safeParse({ ...base, codePrefix: '2026-LOT-1-BATCH-2' }).success);
    assert.ok(!LotChoiceSchema.safeParse({ lotId: 'x' }).success);
    assert.ok(!LotChoiceSchema.safeParse({}).success);
    assert.ok(ProjectListFiltersSchema.safeParse({ zone: 'NW', stateCode: 'kn', lgaCode: 'KN-DALA' }).success);
    assert.ok(!ProjectListFiltersSchema.safeParse({ zone: 'XX' }).success);
    assert.ok(PortfolioPaymentsQuerySchema.safeParse({ from: '2026-01-01', to: '2026-12-31', zone: 'NC', page: '2' }).success);
  });
});

describe('fiscal periods (G.1) and intervention years (D5)', () => {
  it('January start: fiscal year = calendar year, quarters by calendar', () => {
    assert.equal(fiscalYearOf('2026-11-25'), 2026);
    assert.equal(fiscalQuarterOf('2026-11-25'), 4);
    assert.deepEqual(fiscalYearRange(2026), { from: '2026-01-01', to: '2026-12-31' });
    assert.deepEqual(periodRange({ preset: 'THIS_QUARTER' }, '2026-11-25'), { from: '2026-10-01', to: '2026-12-31' });
    assert.deepEqual(periodRange({ preset: 'LAST_QUARTER' }, '2026-02-10'), { from: '2025-10-01', to: '2025-12-31' });
    assert.deepEqual(periodRange({ preset: 'THIS_MONTH' }, '2026-02-10'), { from: '2026-02-01', to: '2026-02-28' });
    assert.deepEqual(periodRange({ preset: 'LAST_MONTH' }, '2026-01-10'), { from: '2025-12-01', to: '2025-12-31' });
    assert.deepEqual(periodRange({ preset: 'QUARTER', fiscalYear: 2025, quarter: 2 }, '2026-11-25'), { from: '2025-04-01', to: '2025-06-30' });
    assert.deepEqual(periodRange({ preset: 'ALL' }, '2026-11-25'), { from: null, to: null });
    assert.deepEqual(periodRange({ preset: 'CUSTOM', from: '2026-03-01', to: '' }, '2026-11-25'), { from: '2026-03-01', to: null });
    assert.equal(describePeriod({ preset: 'THIS_FISCAL_YEAR' }, '2026-11-25'), 'FY2026');
  });

  it('April start: the fiscal year is named by the year it starts in', () => {
    assert.equal(fiscalYearOf('2027-02-01', 4), 2026);
    assert.deepEqual(fiscalYearRange(2026, 4), { from: '2026-04-01', to: '2027-03-31' });
    assert.equal(fiscalQuarterOf('2027-02-01', 4), 4);
    assert.deepEqual(periodRange({ preset: 'THIS_QUARTER' }, '2027-02-01', 4), { from: '2027-01-01', to: '2027-03-31' });
  });

  it('new projects take the current or the next fiscal year', () => {
    assert.deepEqual(allowedInterventionYears('2026-11-25'), [2026, 2027]);
    assert.deepEqual(allowedInterventionYears('2027-01-01'), [2027, 2028]);
    assert.deepEqual(allowedInterventionYears('2027-02-01', 4), [2026, 2027]);
  });
});

describe('funding sources (C4)', () => {
  it('maps labels and older text onto codes', () => {
    assert.equal(FUNDING_SOURCES.length, 9);
    assert.equal(fundingSourceCodeFromText('Matching Grant'), 'MATCHING_GRANT');
    assert.equal(fundingSourceCodeFromText('Matching grant (SUBEB counterpart)'), 'MATCHING_GRANT');
    assert.equal(fundingSourceCodeFromText('UBEC Intervention Fund'), 'DIRECT_INTERVENTION');
    assert.equal(fundingSourceCodeFromText('Development partner: BESDA-AF'), 'DEVELOPMENT_PARTNER');
    assert.equal(fundingSourceCodeFromText('ZIP'), 'ZONAL_INTERVENTION');
    assert.equal(fundingSourceCodeFromText('Lottery'), null);
    assert.equal(fundingSourceText('DEVELOPMENT_PARTNER', 'BESDA-AF'), 'Development partner: BESDA-AF');
    assert.equal(fundingSourceText('MATCHING_GRANT', 'ignored'), 'Matching Grant');
  });
});
