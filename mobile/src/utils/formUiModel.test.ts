/** Runs in Node. Redesign R5c: wording and screen state for the form filler, check-in and review. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { VisitFormSnapshotField } from '@insite/shared';
import {
  checkInView,
  commentVisible,
  createDraftSaver,
  fieldRuleNotes,
  findingsCountText,
  firstScreenWithIssues,
  formAccess,
  issuesFor,
  numberRangeText,
  parseDateText,
  parseNumberText,
  photoSlotText,
  photosLeft,
  plannedQuantityText,
  recheckMetaText,
  reviewIssueGroups,
  screenStatusText,
  sentPhotosOfDay,
  timeInZone,
  visitDayFor,
} from './formUiModel';
import { checkDraft, formScreens, photoFieldModel, REVIEW_SCREEN_KEY, setAnswerValue, type FormIssue } from './visitForm';
import type { StoredVisitDraft, VisitDraft } from './visitModel';
import type { SiteLogRecord } from './siteLog';
import { IDS, snapshotFor, storedVisit, uuid } from './__fixtures__/visitFixtures';

const routine = snapshotFor('ROUTINE', { withRechecks: true });
const field = (path: string): { field: VisitFormSnapshotField; block: (typeof routine.blocks)[number] } => {
  for (const block of routine.blocks) for (const f of block.fields) if (f.path === path) return { field: f, block };
  throw new Error(`no field ${path}`);
};
const findPath = (pred: (f: VisitFormSnapshotField) => boolean) => routine.blocks.flatMap((b) => b.fields).find(pred)!.path;

function draft(overrides: Partial<VisitDraft> = {}): VisitDraft {
  return {
    id: uuid(500),
    visitId: uuid(100),
    projectId: IDS.project,
    formSnapshotId: uuid(300),
    formHash: 'a'.repeat(64),
    answers: [],
    overallFinding: null,
    summaryText: '',
    siteLogEntryIds: [],
    checkInId: null,
    correctsSubmissionId: null,
    startedAt: '2026-11-24T08:00:00.000Z',
    updatedAt: '2026-11-24T08:00:00.000Z',
    remap: null,
    ...overrides,
  };
}
const stored = (status: StoredVisitDraft['status'], lastError: string | null = null): StoredVisitDraft => ({ draft: draft(), status, serverId: null, lastError, updatedAt: '' });

describe('inputs', () => {
  it('parses numbers with a decimal comma and refuses text', () => {
    assert.deepEqual(parseNumberText(''), { state: 'EMPTY' });
    assert.deepEqual(parseNumberText(' 4,5 '), { state: 'OK', value: 4.5 });
    assert.deepEqual(parseNumberText('-3'), { state: 'OK', value: -3 });
    assert.deepEqual(parseNumberText('12.'), { state: 'INVALID' });
    assert.deepEqual(parseNumberText('abc'), { state: 'INVALID' });
  });

  it('parses ISO and day-first dates and refuses impossible ones', () => {
    assert.equal(parseDateText('2026-11-24'), '2026-11-24');
    assert.equal(parseDateText('4/3/2026'), '2026-03-04');
    assert.equal(parseDateText('31/02/2026'), null);
    assert.equal(parseDateText('soon'), null);
  });

  it('shows "of {planned} {uom}" only on supply questions and ranges on numbers', () => {
    const sprint2 = snapshotFor('ROUTINE', { visitDate: '2027-01-10' });
    const delivered = sprint2.blocks.flatMap((b) => b.fields.map((f) => ({ f, b }))).find((x) => x.f.key === 'delivered')!;
    assert.equal(plannedQuantityText(delivered.f, delivered.b), 'of 120 nr');
    const progress = field(findPath((f) => f.key === 'progress'));
    assert.equal(plannedQuantityText(progress.field, progress.block), null);
    assert.equal(numberRangeText(progress.field), 'From 0 to 100');
  });
});

describe('inline rules', () => {
  it('notes a finding and a needed comment when the answer triggers them', () => {
    const path = findPath((f) => f.key === 'contractor_on_site');
    const { field: f } = field(path);
    const none = fieldRuleNotes(f, null);
    assert.equal(none.findingNote, null);
    assert.equal(commentVisible(none, null, false), false);
    const answers = setAnswerValue([], path, 'NO');
    const notes = fieldRuleNotes(f, answers[0]);
    assert.equal(notes.findingNote, 'This answer will raise a finding (Major)');
    assert.equal(notes.commentNeeded, true);
    assert.equal(notes.commentLabel, 'Comment (needed for this answer)');
    assert.equal(commentVisible(notes, answers[0], false), true);
  });

  it('asks why a re-check is not resolved and needs a photo when it is', () => {
    const path = findPath((f) => f.recheck !== null);
    const { field: f } = field(path);
    assert.match(recheckMetaText(f)!, /^Finding · (Major|Minor) · raised 2026-11-1\d$/);
    assert.equal(fieldRuleNotes(f, setAnswerValue([], path, 'NO')[0]).commentLabel, 'Why is it not resolved? (needed)');
    assert.equal(fieldRuleNotes(f, setAnswerValue([], path, 'YES')[0]).photoNeeded, true);
  });

  it('filters issues by question and by photo slot unit', () => {
    const issues: FormIssue[] = [
      { path: 'p', screenKey: 's', unitId: null, code: 'REQUIRED', message: 'a', label: 'p' },
      { path: 'p', screenKey: 's', unitId: IDS.u1, code: 'UNIT_PHOTO_MISSING', message: 'b', label: 'p' },
      { path: 'q', screenKey: 's', unitId: null, code: 'REQUIRED', message: 'c', label: 'q' },
    ];
    assert.equal(issuesFor(issues, 'p').length, 2);
    assert.deepEqual(issuesFor(issues, 'p', IDS.u1).map((i) => i.message), ['b']);
  });
});

describe('photo slots', () => {
  it('says what each slot needs, as text', () => {
    const path = findPath((f) => f.key === 'unit_photos');
    const model = photoFieldModel(field(path).field, null, new Map())!;
    const t = photoSlotText(model.slots[0], model);
    assert.equal(t.tone, 'NEEDED');
    assert.equal(t.status, 'Needed: take a photo');
    assert.equal(photosLeft(model.slots[0], model), 2);
    const withBad = photoFieldModel(
      field(path).field,
      { path, value: null, comment: null, captures: [{ clientCaptureId: uuid(901), unitId: model.slots[0].unitId, kind: 'PHOTO' }] },
      new Map([[uuid(901), { clientCaptureId: uuid(901), hasFix: true, isMocked: false, geofenceStatus: 'OUTSIDE' as const }]])
    )!;
    assert.equal(photoSlotText(withBad.slots[0], withBad).tone, 'RETAKE');
    const sitePhotos = findPath((f) => f.key === 'site_photos');
    const ok = photoFieldModel(
      field(sitePhotos).field,
      { path: sitePhotos, value: null, comment: null, captures: [{ clientCaptureId: uuid(902), unitId: null, kind: 'PHOTO' }] },
      new Map([[uuid(902), { clientCaptureId: uuid(902), hasFix: true, isMocked: false, geofenceStatus: 'INSIDE' as const }]])
    )!;
    assert.deepEqual(photoSlotText(ok.slots[0], ok), { title: 'Photos', status: '1 photo: done', tone: 'DONE' });
  });
});

describe('check-in view', () => {
  const fix = { accuracyMeters: 12, isMocked: false };
  it('covers no fix, mocked, no boundary, inside, tolerance and outside', () => {
    assert.equal(checkInView({ fix: null, preview: null, hasBoundary: true, locationPermissionGranted: false }).state, 'NO_FIX');
    assert.match(checkInView({ fix: null, preview: null, hasBoundary: true, locationPermissionGranted: false }).note, /Location access is off/);
    assert.equal(checkInView({ fix: { ...fix, isMocked: true }, preview: null, hasBoundary: true, locationPermissionGranted: true }).state, 'MOCKED');
    assert.equal(checkInView({ fix, preview: { status: null, distanceOutsideMeters: null, distanceFromSiteMeters: null }, hasBoundary: false, locationPermissionGranted: true }).state, 'NO_BOUNDARY');
    const inside = checkInView({ fix, preview: { status: 'INSIDE', distanceOutsideMeters: 0, distanceFromSiteMeters: 40 }, hasBoundary: true, locationPermissionGranted: true });
    assert.equal(inside.state, 'INSIDE');
    assert.equal(inside.distance, 'About 40 m from the site');
    assert.equal(inside.accuracy, 'Accuracy about 12 m');
    assert.equal(checkInView({ fix, preview: { status: 'WITHIN_TOLERANCE', distanceOutsideMeters: 8, distanceFromSiteMeters: 160 }, hasBoundary: true, locationPermissionGranted: true }).state, 'WITHIN_TOLERANCE');
    const out = checkInView({ fix: { accuracyMeters: 80, isMocked: false }, preview: { status: 'OUTSIDE', distanceOutsideMeters: 1520, distanceFromSiteMeters: 1700 }, hasBoundary: true, locationPermissionGranted: true });
    assert.equal(out.state, 'OUTSIDE');
    assert.equal(out.distance, '1.5 km outside the boundary');
    assert.equal(out.accuracy, 'Accuracy about 80 m (weak signal)');
  });
});

describe('form access', () => {
  const checkedIn = { checkIn: { clientCheckInId: uuid(700), checkedInAt: '2026-11-26T09:00:00.000Z', latitude: null, longitude: null, accuracyMeters: null, isMocked: false, geofenceStatus: null, distanceOutsideMeters: null, sent: false } };
  it('edits an open draft and shows a queued one read-only', () => {
    const v = storedVisit({ local: checkedIn });
    assert.equal(formAccess(v, { open: stored('DRAFT'), latest: stored('DRAFT') }, true).mode, 'EDIT');
    const q = formAccess(v, { open: stored('QUEUED'), latest: stored('QUEUED') }, true);
    assert.equal(q.mode, 'READ_ONLY');
    assert.equal(q.mode === 'READ_ONLY' && q.title, 'Waiting to send');
  });
  it('needs a check-in on this phone before starting (D-R5.18)', () => {
    const noCheckIn = storedVisit({ visit: { checkInAt: '2026-11-26T09:00:00.000Z' } });
    const r = formAccess(noCheckIn, { open: null, latest: null }, true);
    assert.equal(r.mode, 'BLOCKED');
    assert.equal(r.mode === 'BLOCKED' && r.title, 'Check in first');
    assert.deepEqual(formAccess(storedVisit({ local: checkedIn }), { open: null, latest: null }, true), { mode: 'START', correction: false });
  });
  it('shows a refused draft with its message and offers a copy; starts a correction on RETURNED', () => {
    const v = storedVisit({ local: checkedIn, visit: { status: 'IN_PROGRESS' } });
    const r = formAccess(v, { open: null, latest: stored('REFUSED', 'Another officer submitted first.') }, true);
    assert.equal(r.mode === 'READ_ONLY' && r.message, 'Another officer submitted first.');
    assert.equal(r.mode === 'READ_ONLY' && r.canCopy, true);
    const ret = storedVisit({ visit: { status: 'RETURNED', checkInAt: '2026-11-26T09:00:00.000Z' } });
    assert.deepEqual(formAccess(ret, { open: null, latest: stored('SENT') }, true), { mode: 'START', correction: true });
  });
  it('blocks without the permission, on closed visits and on refused unscheduled visits', () => {
    assert.equal(formAccess(storedVisit({ local: checkedIn }), { open: null, latest: null }, false).mode, 'BLOCKED');
    assert.equal(formAccess(storedVisit({ local: checkedIn, visit: { status: 'APPROVED' } }), { open: null, latest: null }, true).mode, 'BLOCKED');
    const refused = formAccess(storedVisit({ local: { ...checkedIn, createError: 'Form changed' } }), { open: null, latest: null }, true);
    assert.equal(refused.mode === 'BLOCKED' && refused.message, 'Form changed');
  });
});

describe('sections and review', () => {
  it('opens on the first section with issues and groups issues in form order, review last', () => {
    const screens = formScreens(routine);
    const check = checkDraft(routine, draft(), []);
    assert.equal(firstScreenWithIssues(screens, check), 0);
    const groups = reviewIssueGroups(screens, check);
    assert.equal(groups[groups.length - 1].screenKey, REVIEW_SCREEN_KEY);
    assert.deepEqual(
      groups.slice(0, -1).map((g) => g.screenIndex),
      [...groups.slice(0, -1).map((g) => g.screenIndex)].sort((a, b) => (a ?? 0) - (b ?? 0))
    );
    assert.match(screenStatusText(check, screens[0].key), /^\d+ to fix$/);
    assert.equal(findingsCountText(0), 'No findings will be raised.');
    assert.equal(findingsCountText(2), 'This will raise 2 findings.');
  });
});

describe('site log picking', () => {
  it('uses the check-in day in the project zone, else today', () => {
    const v = storedVisit({ local: { checkIn: { clientCheckInId: uuid(1), checkedInAt: '2026-11-25T23:30:00.000Z', latitude: null, longitude: null, accuracyMeters: null, isMocked: false, geofenceStatus: null, distanceOutsideMeters: null, sent: false } } });
    assert.equal(visitDayFor(v, 'Africa/Lagos'), '2026-11-26');
    assert.equal(visitDayFor(storedVisit(), 'Africa/Lagos', new Date('2026-11-24T10:00:00.000Z')), '2026-11-24');
  });
  it('counts the day photos that cannot be picked', () => {
    const e = (id: string, kind: SiteLogRecord['kind']): SiteLogRecord => ({
      id, projectId: IDS.project, kind, text: null, captureId: id, capturedAt: '2026-11-24T10:00:00.000Z', latitude: null, longitude: null,
      accuracyMeters: null, isMocked: false, geofenceStatus: null, status: 'SENT', serverId: 's', attachedSubmissionId: null, movedToDraftId: null, lastError: null, createdAt: '',
    });
    const day = [e('a', 'PHOTO'), e('b', 'PHOTO'), e('c', 'NOTE')];
    assert.equal(sentPhotosOfDay(day, [day[0]]), 1);
    assert.equal(timeInZone('2026-11-24T10:05:00.000Z', 'Africa/Lagos'), '11:05');
  });
});

describe('draft saver', () => {
  it('writes one at a time and only the latest waiting value', async () => {
    const written: number[] = [];
    let release: () => void = () => undefined;
    const saver = createDraftSaver<number>(async (n) => {
      if (n === 1) await new Promise<void>((r) => (release = r));
      written.push(n);
    });
    saver.push(1);
    saver.push(2);
    saver.push(3);
    release();
    await saver.flush();
    assert.deepEqual(written, [1, 3]);
  });
  it('reports a failed save on flush and recovers on the next one', async () => {
    let fail = true;
    const errors: unknown[] = [];
    const saver = createDraftSaver<number>(async () => {
      if (fail) throw new Error('disk full');
    }, (e) => errors.push(e));
    saver.push(1);
    await assert.rejects(saver.flush(), /disk full/);
    fail = false;
    saver.push(2);
    await saver.flush();
    assert.equal(errors.length, 1);
  });
});
