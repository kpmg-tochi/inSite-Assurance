/**
 * Redesign R2 unit tests (no database): the facility catalogue defaults and the shared scope rules.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FACILITIES,
  DEFAULT_TENANT_ROLES,
  deriveSprintStatus,
  FACILITY_CODE_REGEX,
  FacilityArchetype,
  lineAmount,
  nextUnitCode,
  normalizeUnitOfMeasure,
  unitsActiveInSprint,
  validateSprints,
  validateUnits,
} from '@insite/shared';

describe('Redesign R2a: default facility catalogue', () => {
  it('has the 50 facilities of spec 6.2 with unique, well-formed codes', () => {
    assert.equal(DEFAULT_FACILITIES.length, 50);
    const codes = DEFAULT_FACILITIES.map((f) => f.code);
    assert.equal(new Set(codes).size, 50);
    for (const c of codes) assert.match(c, FACILITY_CODE_REGEX);
  });

  it('splits 19 building, 22 supply, 4 utilities, 5 external', () => {
    const count = (a: FacilityArchetype) => DEFAULT_FACILITIES.filter((f) => f.archetype === a).length;
    assert.equal(count('BUILDING_WORKS'), 19);
    assert.equal(count('SUPPLY_INSTALLATION'), 22);
    assert.equal(count('UTILITIES'), 4);
    assert.equal(count('EXTERNAL_WORKS'), 5);
  });

  it('gives facilities:manage to the tenant super admin and the monitor only', () => {
    const holders = DEFAULT_TENANT_ROLES.filter((r) => r.permissionKeys.includes('facilities:manage')).map((r) => r.code);
    assert.deepEqual(holders.sort(), ['MONITOR', 'TENANT_SUPER_ADMIN']);
  });
});

describe('Redesign R2b: shared scope rules', () => {
  it('validateSprints: real dates, end after start, no overlaps, gaps allowed', () => {
    assert.deepEqual(
      validateSprints([
        { name: 'One', startDate: '2027-01-01', endDate: '2027-01-31' },
        { name: 'Two', startDate: '2027-02-10', endDate: '2027-03-31' },
      ]),
      []
    );
    const codes = (list: Parameters<typeof validateSprints>[0]) => validateSprints(list).map((i) => i.code);
    assert.deepEqual(codes([{ name: 'X', startDate: '2027-02-30', endDate: '2027-03-01' }]), ['SPRINT_DATE_INVALID']);
    assert.deepEqual(codes([{ name: 'X', startDate: '2027-03-02', endDate: '2027-03-01' }]), ['SPRINT_END_BEFORE_START']);
    assert.deepEqual(
      codes([
        { name: 'B', startDate: '2027-01-31', endDate: '2027-02-28' },
        { name: 'A', startDate: '2027-01-01', endDate: '2027-01-31' },
      ]),
      ['SPRINT_OVERLAP']
    );
    assert.deepEqual(codes([{ name: ' ', startDate: '2027-01-01', endDate: '2027-01-02' }]), ['SPRINT_NAME_REQUIRED']);
  });

  it('validateUnits: duplicate IDs, sprint order, supply quantity, sprints for activation', () => {
    const base = { label: 'L', archetype: 'BUILDING_WORKS' as const, plannedQuantity: null, startSprintNumber: 1, endSprintNumber: 2 };
    assert.deepEqual(validateUnits([{ ...base, code: 'U01' }]), []);
    const codes = (units: Parameters<typeof validateUnits>[0], requireSprints = false) => validateUnits(units, { requireSprints }).map((i) => i.code);
    assert.deepEqual(codes([{ ...base, code: 'U01' }, { ...base, code: 'u01' }]), ['UNIT_CODE_DUPLICATE']);
    assert.deepEqual(codes([{ ...base, code: 'U01', startSprintNumber: 3 }]), ['UNIT_SPRINT_ORDER']);
    assert.deepEqual(codes([{ ...base, code: 'U01', archetype: 'SUPPLY_INSTALLATION' }]), ['UNIT_QUANTITY_REQUIRED']);
    assert.deepEqual(codes([{ ...base, code: 'U01', archetype: 'SUPPLY_INSTALLATION', plannedQuantity: 120 }]), []);
    assert.deepEqual(codes([{ ...base, code: 'U01', endSprintNumber: null }]), []);
    assert.deepEqual(codes([{ ...base, code: 'U01', endSprintNumber: null }], true), ['UNIT_SPRINTS_REQUIRED']);
  });

  it('derives sprint status and the units active in a sprint', () => {
    const s = { startDate: '2027-01-01', endDate: '2027-01-31' };
    assert.equal(deriveSprintStatus(s, '2026-12-31'), 'UPCOMING');
    assert.equal(deriveSprintStatus(s, '2027-01-01'), 'ACTIVE');
    assert.equal(deriveSprintStatus(s, '2027-01-31'), 'ACTIVE');
    assert.equal(deriveSprintStatus(s, '2027-02-01'), 'ENDED');
    const units = [
      { id: 'a', startSprintNumber: 1, endSprintNumber: 3 },
      { id: 'b', startSprintNumber: 2, endSprintNumber: 2 },
      { id: 'c', startSprintNumber: null, endSprintNumber: null },
    ];
    assert.deepEqual(unitsActiveInSprint(units, 2).map((u) => u.id), ['a', 'b']);
    assert.deepEqual(unitsActiveInSprint(units, 3).map((u) => u.id), ['a']);
  });

  it('amounts, unit codes and units of measure', () => {
    assert.equal(lineAmount(120.5, 8000), 964000);
    assert.equal(lineAmount(3, 0.335), 1.01);
    assert.equal(nextUnitCode([]), 'U01');
    assert.equal(nextUnitCode(['U01', 'u02', 'U04']), 'U03');
    assert.equal(normalizeUnitOfMeasure('M2'), 'm2');
    assert.equal(normalizeUnitOfMeasure('lump sum'), 'LS');
    assert.equal(normalizeUnitOfMeasure('bags'), null);
  });
});
