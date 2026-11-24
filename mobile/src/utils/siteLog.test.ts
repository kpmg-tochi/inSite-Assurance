/** Runs in Node. Redesign R5a (D-R5.22): site log entries, picking into a form and attaching to a report. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CreateSiteLogEntryRequestSchema } from '@insite/shared';
import {
  attachableEntries,
  attachEntry,
  buildSiteLogRequest,
  detachEntry,
  entriesForVisitDay,
  pickablePhotosForField,
  siteLogEntryProblem,
  type SiteLogRecord,
} from './siteLog';
import type { VisitDraft } from './visitModel';
import { IDS, uuid } from './__fixtures__/visitFixtures';

const ZONE = 'Africa/Lagos'; // UTC+1

function entry(n: number, overrides: Partial<SiteLogRecord> = {}): SiteLogRecord {
  return {
    id: uuid(700 + n),
    projectId: IDS.project,
    kind: 'PHOTO',
    text: null,
    captureId: uuid(800 + n),
    capturedAt: '2026-11-26T09:00:00.000Z',
    latitude: 9,
    longitude: 7,
    accuracyMeters: 5,
    isMocked: false,
    geofenceStatus: 'INSIDE',
    status: 'QUEUED',
    serverId: null,
    attachedSubmissionId: null,
    movedToDraftId: null,
    lastError: null,
    createdAt: '2026-11-26T09:00:00.000Z',
    ...overrides,
  };
}

const draft: VisitDraft = {
  id: uuid(900),
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
  startedAt: '',
  updatedAt: '',
  remap: null,
};

describe('new entries', () => {
  it('notes need text; photos and voice notes need their capture', () => {
    assert.match(siteLogEntryProblem({ kind: 'NOTE', text: '  ' })!, /Write the note/);
    assert.equal(siteLogEntryProblem({ kind: 'NOTE', text: 'Rain stopped work at 2pm' }), null);
    assert.match(siteLogEntryProblem({ kind: 'PHOTO' })!, /photo/);
    assert.match(siteLogEntryProblem({ kind: 'VOICE' })!, /voice note/);
    assert.equal(siteLogEntryProblem({ kind: 'VOICE', captureId: uuid(1) }), null);
  });

  it('requests match the server schema; a position is sent for notes only', () => {
    const photo = buildSiteLogRequest(entry(1));
    assert.equal(photo.clientCaptureId, uuid(801));
    assert.equal(photo.geotag, null);
    assert.ok(CreateSiteLogEntryRequestSchema.safeParse(photo).success);
    const note = buildSiteLogRequest(entry(2, { kind: 'NOTE', captureId: null, text: ' Rain stopped work ' }));
    assert.equal(note.text, 'Rain stopped work');
    assert.equal(note.clientCaptureId, null);
    assert.equal(note.geotag?.latitude, 9);
    assert.ok(CreateSiteLogEntryRequestSchema.safeParse(note).success);
  });
});

describe('picking and attaching', () => {
  const sameDayLate = entry(3, { capturedAt: '2026-11-26T23:30:00.000Z' }); // 27th in Lagos
  const otherProject = entry(4, { projectId: uuid(2) });
  const sent = entry(5, { status: 'SENT', serverId: uuid(605) });
  const note = entry(6, { kind: 'NOTE', captureId: null, text: 'Note' });
  const moved = entry(7, { status: 'MOVED_TO_FORM', movedToDraftId: uuid(901) });
  const onOtherDraft = entry(8);
  const attachedOnServer = entry(9, { status: 'SENT', serverId: uuid(609), attachedSubmissionId: uuid(610) });
  const all = [entry(1), sameDayLate, otherProject, sent, note, moved, onOtherDraft, attachedOnServer];
  const attachedToDrafts = new Map([[onOtherDraft.id, uuid(999)]]);

  it('entries of the visit day count in the project zone', () => {
    const day = entriesForVisitDay(all, { projectId: IDS.project, visitDate: '2026-11-26', timeZone: ZONE }).map((e) => e.id);
    assert.ok(day.includes(uuid(701)));
    assert.ok(!day.includes(sameDayLate.id), 'after midnight in Lagos');
    assert.ok(!day.includes(otherProject.id));
    assert.ok(!day.includes(moved.id));
    assert.ok(entriesForVisitDay(all, { projectId: IDS.project, visitDate: '2026-11-27', timeZone: ZONE }).some((e) => e.id === sameDayLate.id));
  });

  it('a photo field can take unsent photos of the day only (a sent entry cannot be an answer)', () => {
    const pickable = pickablePhotosForField(all, { projectId: IDS.project, visitDate: '2026-11-26', timeZone: ZONE, attachedToDrafts }).map((e) => e.id);
    assert.deepEqual(pickable, [uuid(701)]);
  });

  it('the review attaches any entry of the project not attached elsewhere', () => {
    const ids = attachableEntries(all, { projectId: IDS.project, draftId: draft.id, attachedToDrafts }).map((e) => e.id);
    assert.ok(ids.includes(uuid(701)) && ids.includes(sent.id) && ids.includes(note.id) && ids.includes(sameDayLate.id));
    assert.ok(!ids.includes(onOtherDraft.id) && !ids.includes(moved.id) && !ids.includes(attachedOnServer.id) && !ids.includes(otherProject.id));
    const own = attachableEntries(all, { projectId: IDS.project, draftId: uuid(999), attachedToDrafts }).map((e) => e.id);
    assert.ok(own.includes(onOtherDraft.id), 'the draft that attached it still sees it');
  });

  it('attach and detach are idempotent and keep the draft immutable', () => {
    const a = attachEntry(draft, uuid(701), 'now');
    assert.deepEqual(a.siteLogEntryIds, [uuid(701)]);
    assert.deepEqual(draft.siteLogEntryIds, []);
    assert.equal(attachEntry(a, uuid(701), 'later'), a);
    assert.deepEqual(detachEntry(a, uuid(701), 'now').siteLogEntryIds, []);
    assert.equal(detachEntry(draft, uuid(701), 'now'), draft);
  });
});
