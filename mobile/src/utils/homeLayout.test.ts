/** Runs in Node. Redesign R5a (D-R5.3, D-R5.7): single-project rule, project cards, pack v2 normalising. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { MobileBaselinePack } from '@insite/shared';
import { homeMode, mobilisationProgress, projectCardModel, unitsByFacility } from './homeLayout';
import { isCurrentPack, normaliseBaselinePack } from './baselinePack';
import { visitView } from './visitCalendar';
import { IDS, storedVisit, uuid } from './__fixtures__/visitFixtures';

const TODAY = '2026-11-24';

function pack(overrides: Partial<MobileBaselinePack> = {}): MobileBaselinePack {
  return normaliseBaselinePack({
    projectId: IDS.project,
    name: 'Model school',
    codePrefix: 'PRG-105',
    stateLocation: 'Kaduna',
    packVersion: 2,
    projectStatus: 'ACTIVE',
    stage: { current: 'CONSTRUCTION', currentLabel: 'Construction', subLabel: null, contractTerminated: false },
    school: 'Government Primary School, Zaria',
    contractorName: 'Buildwell Ltd',
    geofenceMode: 'RADIAL',
    geofence: { mode: 'RADIAL', center: { latitude: 9, longitude: 7 }, radiusMeters: 150 } as unknown as MobileBaselinePack['geofence'],
    sprints: [
      { id: IDS.sprint1, number: 1, name: 'Substructure', startDate: '2026-11-01', endDate: '2026-12-15', deliverables: 'Foundations', status: 'ACTIVE', verificationOutcome: null },
      { id: IDS.sprint2, number: 2, name: 'Superstructure', startDate: '2026-12-16', endDate: '2027-02-28', deliverables: 'Walls', status: 'UPCOMING', verificationOutcome: null },
    ],
    facilityUnits: [
      { id: IDS.u1, code: 'U01', label: 'Block A', facilityId: IDS.facClassroom, facilityCode: 'CLASSROOM', facilityName: 'Classroom block', archetype: 'BUILDING_WORKS', plannedQuantity: null, quantityUnit: null, startSprintNumber: 1, endSprintNumber: 1, progressPct: 40, sortOrder: 1 },
      { id: IDS.u2, code: 'U02', label: 'Block B', facilityId: IDS.facClassroom, facilityCode: 'CLASSROOM', facilityName: 'Classroom block', archetype: 'BUILDING_WORKS', plannedQuantity: null, quantityUnit: null, startSprintNumber: 1, endSprintNumber: 2, progressPct: null, sortOrder: 2 },
      { id: IDS.u3, code: 'U03', label: 'Desks', facilityId: IDS.facFurniture, facilityCode: 'FURNITURE', facilityName: "Pupils' furniture", archetype: 'SUPPLY_INSTALLATION', plannedQuantity: 120, quantityUnit: 'nr', startSprintNumber: 2, endSprintNumber: 2, progressPct: null, sortOrder: 3 },
    ],
    openFindings: [
      { id: IDS.findingClassroom, title: 'Cracked lintel', description: 'Cracked lintel', severity: 'MAJOR', facilityId: IDS.facClassroom, facilityName: 'Classroom block', unitId: IDS.u1, unitLabel: 'Block A', raisedDate: '2026-11-10', escalatesOn: '2026-11-24', recheckCount: 0 },
    ],
    openDefectCount: 2,
    ...overrides,
  } as MobileBaselinePack);
}

describe('homeMode (D-R5.7)', () => {
  it('exactly one ACTIVE project opens its card fully', () => {
    assert.deepEqual(homeMode([{ projectId: 'a', projectStatus: 'ACTIVE' }]), { mode: 'SINGLE', projectId: 'a' });
    assert.deepEqual(homeMode([{ projectId: 'a', projectStatus: 'ACTIVE' }, { projectId: 'b', projectStatus: 'ARCHIVED' }]), { mode: 'SINGLE', projectId: 'a' });
  });
  it('several active projects, none, or packs not downloaded: the list', () => {
    assert.deepEqual(homeMode([{ projectId: 'a', projectStatus: 'ACTIVE' }, { projectId: 'b', projectStatus: 'ACTIVE' }]), { mode: 'LIST' });
    assert.deepEqual(homeMode([]), { mode: 'LIST' });
    assert.deepEqual(homeMode([{ projectId: 'a', projectStatus: undefined }]), { mode: 'LIST' });
  });
});

describe('project card', () => {
  it('current sprint, units in it, findings, defects and the next visit', () => {
    const views = [
      visitView(storedVisit({ visit: { id: uuid(101), plannedDate: '2026-11-20' } }), TODAY),
      visitView(storedVisit({ visit: { id: uuid(102), plannedDate: '2026-12-02' } }), TODAY),
      visitView(storedVisit({ visit: { id: uuid(103), plannedDate: '2026-11-26' } }), TODAY),
      visitView(storedVisit({ visit: { id: uuid(104), plannedDate: '2026-11-25', status: 'SUBMITTED' } }), TODAY),
    ];
    const card = projectCardModel({ projectId: IDS.project, code: 'X', name: 'Y' }, pack(), views, TODAY);
    assert.equal(card.code, 'PRG-105');
    assert.equal(card.school, 'Government Primary School, Zaria');
    assert.equal(card.stageLabel, 'Construction');
    assert.equal(card.sprintText, 'Sprint 1 of 2');
    assert.deepEqual(card.unitsInSprint.map((u) => u.code), ['U01', 'U02']);
    assert.equal(card.openFindingCount, 1);
    assert.equal(card.openDefectCount, 2);
    assert.deepEqual(card.nextVisit, { visitId: uuid(103), date: '2026-11-26', kindLabel: 'Routine', datePending: false });
    assert.equal(card.attentionCount, 1);
    assert.equal(card.mobilisation, null);
    assert.equal(card.packMissing, false);
  });

  it('before sprint 1 says when it starts; without a pack only the name is known', () => {
    const early = projectCardModel({ projectId: IDS.project, code: 'X', name: 'Y' }, pack(), [], '2026-10-20');
    assert.equal(early.sprintText, 'Sprint 1 starts 2026-11-01');
    assert.deepEqual(early.unitsInSprint, []);
    const none = projectCardModel({ projectId: IDS.project, code: 'PRG-102', name: 'Other school' }, null, [], TODAY);
    assert.equal(none.packMissing, true);
    assert.equal(none.code, 'PRG-102');
    assert.equal(none.sprintText, null);
  });

  it('closure stages show their sub-label', () => {
    const card = projectCardModel({ projectId: IDS.project, code: 'X', name: 'Y' }, pack({ stage: { current: 'CLOSURE', currentLabel: 'Closure', subLabel: 'Defects liability period', contractTerminated: false } }), [], TODAY);
    assert.equal(card.stageLabel, 'Closure · Defects liability period');
  });

  it('units grouped by facility in pack order', () => {
    assert.deepEqual(unitsByFacility(pack().facilityUnits).map((g) => [g.facilityName, g.units.length]), [['Classroom block', 2], ["Pupils' furniture", 1]]);
  });
});

describe('mobilisation day N of M', () => {
  const m = { milestoneId: uuid(1), label: 'Contractor on site', startedOn: '2026-11-08', deadline: '2026-11-29', status: 'PENDING' as const };
  it('counts from the kick-off', () => {
    assert.deepEqual(mobilisationProgress(m, TODAY), { label: 'Contractor on site', dayText: 'Day 17 of 22', dayNumber: 17, totalDays: 22, deadline: '2026-11-29', overdue: false });
  });
  it('says how late it is once the deadline passed', () => {
    assert.equal(mobilisationProgress(m, '2026-12-02')!.dayText, '3 days overdue');
    assert.equal(mobilisationProgress(m, '2026-12-02')!.overdue, true);
  });
  it('without dates: the label only', () => {
    assert.equal(mobilisationProgress({ ...m, startedOn: null }, TODAY)!.dayText, null);
    assert.equal(mobilisationProgress(null, TODAY), null);
  });
});

describe('stored packs from before R5', () => {
  it('get empty v2 fields and are recognised as old', () => {
    const old = normaliseBaselinePack({ projectId: IDS.project, name: 'Old', codePrefix: 'OLD-1', stateLocation: 'Lagos' } as MobileBaselinePack);
    assert.deepEqual(old.sprints, []);
    assert.deepEqual(old.facilityUnits, []);
    assert.equal(old.openDefectCount, 0);
    assert.equal(old.projectStatus, 'ACTIVE');
    assert.deepEqual(old.workWeekDays, [1, 2, 3, 4, 5, 6]);
    assert.equal(isCurrentPack(old), false);
    assert.equal(isCurrentPack(pack()), true);
  });
});
