import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ChecklistSectionsSchema, type MobileInspectionPack } from '@insite/shared';
import { dependencyState, SESSION_BOUND_KINDS, type OutboxStatus } from '../storage/outbox/outboxPolicy';
import {
  buildInspectionRequest,
  confirmIssues,
  draftCaptureIds,
  findingResolutionBody,
  inspectionDependsOn,
  newDraft,
  sectionIssues,
  showFindingsEntry,
  streamPeriodCards,
  templateForVisit,
  visitTypesOffered,
  type InspectionDraft,
} from './inspections';

const sections = ChecklistSectionsSchema.parse([
  {
    key: 'progress',
    title: 'Progress',
    items: [
      { key: 'on-programme', label: 'Works on programme', responseType: 'RATING_1_5', photoRequiredOnFail: true },
      { key: 'site-photo', label: 'Site photo', responseType: 'PHOTO_ONLY' },
    ],
  },
  { key: 'hse', title: 'Health and safety', items: [{ key: 'ppe', label: 'Workers wear PPE', responseType: 'YES_NO' }] },
]);

const template = { id: '11111111-1111-4111-8111-111111111111', code: 'ROUTINE', name: 'Routine visit', version: 3, visitTypes: ['ROUTINE' as const], sections };
const pack: MobileInspectionPack = {
  streams: [],
  templates: [template],
  templateIdByVisitType: { ROUTINE: template.id },
  canSubmitInspections: true,
};

function draft(): InspectionDraft {
  return newDraft({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', projectId: 'p1', visitType: 'ROUTINE', template, visitDate: '2026-11-20', now: '2026-11-20T09:00:00.000Z' });
}

describe('inspections on the device', () => {
  it('offers visit types with a template, only to people who may inspect', () => {
    assert.deepEqual(visitTypesOffered(pack), ['ROUTINE']);
    assert.deepEqual(visitTypesOffered({ ...pack, canSubmitInspections: false }), []);
    assert.equal(templateForVisit(pack, 'ROUTINE')?.version, 3);
    assert.equal(templateForVisit(pack, 'BASELINE'), null);
  });

  it('a section is complete only with its answers and required photos (stricter than the server)', () => {
    let d = draft();
    assert.deepEqual(sectionIssues(d, sections, 0).map((i) => i.itemKey).sort(), ['on-programme', 'site-photo']);
    d = { ...d, answers: { ...d.answers, 'on-programme': { value: 2, comment: '', captureIds: [] } } };
    const issues = sectionIssues(d, sections, 0);
    assert.ok(issues.some((i) => i.itemKey === 'on-programme' && i.message === 'Say what is wrong'));
    assert.ok(issues.some((i) => i.itemKey === 'on-programme' && i.message === 'Take a photo'), 'a failed rating needs a photo');
    d = {
      ...d,
      answers: {
        ...d.answers,
        'on-programme': { value: 2, comment: 'Roof six weeks late', captureIds: ['c1'] },
        'site-photo': { value: null, comment: '', captureIds: ['c2'] },
      },
    };
    assert.deepEqual(sectionIssues(d, sections, 0), []);
  });

  it('cannot confirm without the overall finding and a summary; the request names the template version', () => {
    let d = draft();
    d = {
      ...d,
      answers: {
        'on-programme': { value: 4, comment: '', captureIds: [] },
        'site-photo': { value: null, comment: '', captureIds: ['c2'] },
        ppe: { value: 'YES', comment: '', captureIds: [] },
      },
    };
    assert.deepEqual(confirmIssues(d, sections), ['Choose the overall finding', 'Write a short summary (at least 10 characters)']);
    d = { ...d, overallFinding: 'SATISFACTORY', summaryText: 'All areas inspected; no issues.' };
    assert.deepEqual(confirmIssues(d, sections), []);
    const req = buildInspectionRequest(d, sections, { geotag: null, confirmedAt: '2026-11-20T10:00:00.000Z' });
    assert.equal(req.clientReportId, d.id);
    assert.equal(req.templateVersion, 3);
    assert.deepEqual(req.answers.map((a) => a.itemKey), ['on-programme', 'site-photo', 'ppe']);
    assert.equal(req.answers[1].value, null);
    assert.deepEqual(req.answers[1].clientCaptureIds, ['c2']);
    // Never a file path or display string as a record field.
    assert.ok(!JSON.stringify(req).includes('file://'));
  });

  it('the inspection waits in the outbox for its photos', () => {
    const d = { ...draft(), answers: { ...draft().answers, 'site-photo': { value: null, comment: '', captureIds: ['c1', 'c2'] }, ppe: { value: 'YES', comment: '', captureIds: ['c1'] } } };
    assert.deepEqual(draftCaptureIds(d).sort(), ['c1', 'c1', 'c2']);
    const openRows: Record<string, string | null> = { c1: 'row-c1', c2: null }; // c2 already sent
    const dependsOn = inspectionDependsOn(draftCaptureIds(d), (id) => openRows[id] ?? null);
    assert.deepEqual(dependsOn, ['row-c1']);
    const status = new Map<string, OutboxStatus>([['row-c1', 'PENDING']]);
    assert.equal(dependencyState(dependsOn, status), 'WAITING');
    status.set('row-c1', 'DONE');
    assert.equal(dependencyState(dependsOn, status), 'READY');
    status.set('row-c1', 'DEAD');
    assert.equal(dependencyState(dependsOn, status), 'BLOCKED');
    assert.equal(SESSION_BOUND_KINDS.has('SITE_INSPECTION'), true);
    assert.equal(SESSION_BOUND_KINDS.has('FINDING_RESOLUTION'), true);
  });

  it('one period card per owed stream, else the project cadence', () => {
    const projectSettings = {
      reportingCadence: 'WEEKLY' as const,
      workWeekDays: [1, 2, 3, 4, 5],
      periodStartDayOfWeek: 1,
      workdayStartTime: '08:00',
      workdayEndTime: '17:00',
      reportGraceMinutes: 0,
      timezone: 'Africa/Lagos',
    };
    assert.deepEqual(streamPeriodCards(null, projectSettings).map((c) => c.label), [null]);
    const withStreams = {
      inspections: {
        ...pack,
        streams: [
          {
            id: 's1',
            key: 'me-visit',
            label: 'M&E visit',
            kind: 'INSPECTION' as const,
            visitType: 'ROUTINE' as const,
            submissionDeadlineDays: 7,
            cadence: { ...projectSettings, reportingCadence: 'QUARTERLY' as const, customIntervalDays: null, reportDueTime: null, cadenceAnchorDate: null },
          },
        ],
      },
    } as unknown as Parameters<typeof streamPeriodCards>[0];
    const cards = streamPeriodCards(withStreams, projectSettings);
    assert.equal(cards.length, 1);
    assert.equal(cards[0].label, 'M&E visit');
    assert.equal(cards[0].settings.reportingCadence, 'QUARTERLY');
  });

  it('finding resolutions need photos or notes; the entry follows the permission', () => {
    assert.throws(() => findingResolutionBody({ findingId: 'f', notes: 'ok', captureIds: [] }));
    assert.deepEqual(findingResolutionBody({ findingId: 'f', notes: '  ', captureIds: ['c1'] }), { notes: '', clientCaptureIds: ['c1'] });
    assert.equal(showFindingsEntry(['inspections:manage_findings']), true);
    assert.equal(showFindingsEntry(['field:submit_report']), false);
  });
});
