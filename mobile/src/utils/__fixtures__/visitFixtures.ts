/**
 * Test fixtures for the R5 visit utils (Node tests only): a small field pack (R4 `VisitFieldPackDto`)
 * built through the shared schemas so every default is filled, and helpers to assemble forms from it
 * and to fake stored visits.
 */
import {
  assembleVisitForm,
  assemblyInputFromBundle,
  VisitFieldPackDtoSchema,
  type VisitDto,
  type VisitFieldPackDto,
  type VisitFormSnapshot,
  type VisitKind,
} from '@insite/shared';
import { EMPTY_VISIT_LOCAL_STATE, type StoredVisit, type VisitLocalState } from '../visitModel';

export const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export const IDS = {
  project: uuid(1),
  templateAdHoc: uuid(2),
  templateRoutine: uuid(3),
  sectionGeneral: uuid(4),
  subBuilding: uuid(5),
  subSupply: uuid(6),
  facClassroom: uuid(7),
  facFurniture: uuid(8),
  u1: uuid(11),
  u2: uuid(12),
  u3: uuid(13),
  sprint1: uuid(21),
  sprint2: uuid(22),
  findingClassroom: uuid(31),
  findingProject: uuid(32),
  findingFurniture: uuid(33),
};

export function fieldPack(overrides: { generalFields?: unknown[] } = {}): VisitFieldPackDto {
  return VisitFieldPackDtoSchema.parse({
    projectId: IDS.project,
    generatedAt: '2026-11-24T08:00:00.000Z',
    geofence: null,
    rechecks: [
      { id: IDS.findingClassroom, kind: 'FINDING', title: 'Cracked lintel', severity: 'MAJOR', raisedDate: '2026-11-10', facilityId: IDS.facClassroom, unitId: IDS.u1 },
      { id: IDS.findingProject, kind: 'FINDING', title: 'No site signboard', severity: 'MINOR', raisedDate: '2026-11-12', facilityId: null, unitId: null },
      { id: IDS.findingFurniture, kind: 'FINDING', title: 'Desks damaged', severity: 'MINOR', raisedDate: '2026-11-13', facilityId: IDS.facFurniture, unitId: IDS.u3 },
    ],
    bundle: {
      projectId: IDS.project,
      templates: [
        { id: IDS.templateAdHoc, code: 'AD_HOC', version: 1, name: 'Ad hoc', visitKind: 'AD_HOC', blocks: [{ type: 'SECTION', sectionCode: 'GENERAL' }, { type: 'FACILITIES' }] },
        { id: IDS.templateRoutine, code: 'ROUTINE', version: 1, name: 'Routine', visitKind: 'ROUTINE', blocks: [{ type: 'SECTION', sectionCode: 'GENERAL' }, { type: 'FACILITIES' }] },
      ],
      sections: [
        {
          id: IDS.sectionGeneral,
          code: 'GENERAL',
          version: 1,
          title: 'General',
          description: null,
          fields: overrides.generalFields ?? [
            {
              key: 'contractor_on_site',
              type: 'YES_NO',
              label: 'Is the contractor on site?',
              signal: { kind: 'CONTRACTOR_ON_SITE', when: { equals: 'YES' } },
              rules: [
                { when: { equals: 'NO' }, then: 'RAISE_FINDING', severity: 'MAJOR' },
                { when: { equals: 'NO' }, then: 'REQUIRE_COMMENT' },
              ],
            },
            {
              key: 'overall',
              type: 'SINGLE_CHOICE',
              label: 'Overall finding',
              options: [
                { key: 'satisfactory', label: 'Satisfactory' },
                { key: 'minor_issues', label: 'Minor issues' },
                { key: 'major_issues', label: 'Major issues' },
              ],
              signal: { kind: 'OVERALL_FINDING' },
            },
            { key: 'site_photos', type: 'PHOTO', label: 'Site photos', photo: { mode: 'AT_LEAST_N', minCount: 1, maxCount: 3 } },
            { key: 'notes', type: 'LONG_TEXT', label: 'Notes', required: false },
          ],
        },
      ],
      subForms: [
        {
          id: IDS.subBuilding,
          subjectKey: 'ARCHETYPE:BUILDING_WORKS',
          version: 1,
          fields: [
            { key: 'progress', type: 'PERCENTAGE', label: 'Progress of {facility}', scope: 'PER_UNIT', signal: { kind: 'PERCENT_COMPLETE' } },
            { key: 'unit_photos', type: 'PHOTO', label: 'Photo of each unit', photo: { mode: 'ONE_PER_UNIT', maxCount: 2 } },
            { key: 'quality', type: 'YES_NO', label: 'Workmanship acceptable?', rules: [{ when: { equals: 'NO' }, then: 'REQUIRE_PHOTO' }] },
          ],
        },
        {
          id: IDS.subSupply,
          subjectKey: 'ARCHETYPE:SUPPLY_INSTALLATION',
          version: 1,
          fields: [
            { key: 'delivered', type: 'NUMBER', label: 'Quantity delivered', boundedByPlannedQuantity: true, signal: { kind: 'QUANTITY_DELIVERED' } },
            { key: 'extra_photos', type: 'PHOTO', label: 'Delivery photos', photo: { mode: 'PER_UNIT_OPTIONAL', minCount: 0, maxCount: 2 } },
            { key: 'grade', type: 'SINGLE_CHOICE', label: 'Grade', required: false, options: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }] },
          ],
        },
      ],
      facilities: [
        { id: IDS.facClassroom, code: 'CLASSROOM', name: 'Classroom block', pluralName: null, archetype: 'BUILDING_WORKS', sortOrder: 1, subFormId: IDS.subBuilding },
        { id: IDS.facFurniture, code: 'FURNITURE', name: "Pupils' furniture", pluralName: null, archetype: 'SUPPLY_INSTALLATION', sortOrder: 2, subFormId: IDS.subSupply },
      ],
      units: [
        { id: IDS.u1, code: 'U01', label: 'Block A', facilityId: IDS.facClassroom, plannedQuantity: null, quantityUnit: null, startSprintNumber: 1, endSprintNumber: 1, sortOrder: 1 },
        { id: IDS.u2, code: 'U02', label: 'Block B', facilityId: IDS.facClassroom, plannedQuantity: null, quantityUnit: null, startSprintNumber: 1, endSprintNumber: 2, sortOrder: 2 },
        { id: IDS.u3, code: 'U03', label: 'Desks', facilityId: IDS.facFurniture, plannedQuantity: 120, quantityUnit: 'nr', startSprintNumber: 2, endSprintNumber: 2, sortOrder: 3 },
      ],
      sprints: [
        { id: IDS.sprint1, number: 1, name: 'Substructure', startDate: '2026-11-01', endDate: '2026-12-15', deliverables: 'Foundations' },
        { id: IDS.sprint2, number: 2, name: 'Superstructure', startDate: '2026-12-16', endDate: '2027-02-28', deliverables: 'Walls and roof' },
      ],
      completedUnitIds: [],
    },
  });
}

/** A frozen form as the server would build it (same shared assembly). */
export function snapshotFor(kind: VisitKind, opts: { visitDate?: string; pickedFacilityIds?: string[]; withRechecks?: boolean; pack?: VisitFieldPackDto } = {}): VisitFormSnapshot {
  const pack = opts.pack ?? fieldPack();
  return assembleVisitForm(
    assemblyInputFromBundle(pack.bundle, {
      visitKind: kind,
      visitDate: opts.visitDate ?? '2026-11-24',
      builtAt: '2026-11-24T08:00:00.000Z',
      pickedFacilityIds: opts.pickedFacilityIds,
      rechecks: opts.withRechecks ? pack.rechecks : [],
    })
  ).snapshot;
}

export function visitDto(overrides: Partial<VisitDto> = {}): VisitDto {
  return {
    id: uuid(100),
    projectId: IDS.project,
    projectCode: 'PRG-105',
    projectName: 'Model school',
    visitKind: 'ROUTINE',
    status: 'PLANNED',
    confirmation: 'UNCONFIRMED',
    origin: 'PLAN',
    generatorKey: 'routine:2026-11-26',
    originalPlannedDate: '2026-11-26',
    plannedDate: '2026-11-26',
    submissionDeadline: '2026-12-03',
    sprint: { id: IDS.sprint1, number: 1, name: 'Substructure' },
    assignees: [{ userId: uuid(200), fullName: 'Officer', isLead: true }],
    pickedFacilityIds: [],
    formSnapshotId: uuid(300),
    formHash: 'a'.repeat(64),
    formAssembledAt: '2026-11-20T08:00:00.000Z',
    facilityCount: 1,
    recheckCount: 0,
    rescheduleCount: 0,
    pendingProposal: null,
    checkInAt: null,
    checkInGeofenceStatus: null,
    isLate: false,
    missedAt: null,
    cancelledAt: null,
    cancelledReason: null,
    publishedAt: '2026-11-20T08:00:00.000Z',
    liveSubmissionId: null,
    createdAt: '2026-11-20T08:00:00.000Z',
    updatedAt: '2026-11-20T08:00:00.000Z',
    ...overrides,
  };
}

export function storedVisit(
  overrides: { visit?: Partial<VisitDto>; local?: Partial<VisitLocalState>; moveWindow?: StoredVisit['moveWindow']; isLocal?: boolean; serverId?: string | null } = {}
): StoredVisit {
  const visit = visitDto(overrides.visit);
  return {
    id: visit.id,
    serverId: overrides.serverId === undefined ? visit.id : overrides.serverId,
    projectId: visit.projectId,
    visit,
    moveWindow: overrides.moveWindow === undefined ? { from: '2026-11-24', to: '2026-11-28' } : overrides.moveWindow,
    local: { ...EMPTY_VISIT_LOCAL_STATE, ...overrides.local },
    isLocal: overrides.isLocal ?? false,
    syncedAt: null,
  };
}
