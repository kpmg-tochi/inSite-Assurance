/** Runs in Node. Redesign R5a: the visit form on the phone (screens, slots, issues, requests, re-mapping, Ad hoc). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonicalVisitFormSnapshot, SubmitVisitRequestSchema, VisitFieldPackDtoSchema, type VisitFormAnswerInput, type VisitFormSnapshot } from '@insite/shared';
import {
  addAnswerCapture,
  adHocAvailable,
  adHocFacilityChoices,
  answerCaptureIds,
  answerFor,
  answersFromReturnedSubmission,
  buildAdHocForm,
  buildQueuedSubmission,
  captureUnitForSlot,
  checkDraft,
  cleanAnswers,
  fieldsByPath,
  finaliseSubmissionBody,
  formChangeKind,
  formProgress,
  formScreens,
  hashVisitFormSnapshot,
  photoFieldModel,
  photoStatus,
  remapAnswers,
  remapDraftOntoSnapshot,
  removeAnswerCapture,
  REVIEW_SCREEN_KEY,
  setAnswerComment,
  setAnswerValue,
  suggestedOverallFinding,
  toValidationFacts,
  triggeredRules,
  type PhoneCaptureFact,
} from './visitForm';
import type { VisitDraft } from './visitModel';
import { fieldPack, IDS, snapshotFor, uuid } from './__fixtures__/visitFixtures';

const routine = snapshotFor('ROUTINE');
const ok = (id: string): PhoneCaptureFact => ({ clientCaptureId: id, hasFix: true, isMocked: false, geofenceStatus: 'INSIDE' });
const C = { site: uuid(501), u1: uuid(502), u2: uuid(503), outside: uuid(504), nofix: uuid(505), mocked: uuid(506), quality: uuid(507) };

function field(snapshot: VisitFormSnapshot, path: string) {
  const ref = fieldsByPath(snapshot).get(path);
  assert.ok(ref, `no field ${path}`);
  return ref.field;
}

function draftOf(answers: VisitFormAnswerInput[], extra: Partial<VisitDraft> = {}): VisitDraft {
  return {
    id: uuid(900),
    visitId: uuid(100),
    projectId: IDS.project,
    formSnapshotId: uuid(300),
    formHash: 'a'.repeat(64),
    answers,
    overallFinding: 'SATISFACTORY',
    summaryText: 'Works progressing.',
    siteLogEntryIds: [],
    checkInId: null,
    correctsSubmissionId: null,
    startedAt: '2026-11-26T08:00:00.000Z',
    updatedAt: '2026-11-26T08:00:00.000Z',
    remap: null,
    ...extra,
  };
}

/** A complete, valid set of answers for the routine form. */
function fullAnswers(): VisitFormAnswerInput[] {
  let a: VisitFormAnswerInput[] = [];
  a = setAnswerValue(a, 's:GENERAL/contractor_on_site', 'YES');
  a = setAnswerValue(a, 's:GENERAL/overall', 'satisfactory');
  a = addAnswerCapture(a, 's:GENERAL/site_photos', { clientCaptureId: C.site, kind: 'PHOTO' });
  a = setAnswerValue(a, `f:CLASSROOM/progress@${IDS.u1}`, 40);
  a = setAnswerValue(a, `f:CLASSROOM/progress@${IDS.u2}`, 25);
  a = addAnswerCapture(a, 'f:CLASSROOM/unit_photos', { clientCaptureId: C.u1, unitId: IDS.u1, kind: 'PHOTO' });
  a = addAnswerCapture(a, 'f:CLASSROOM/unit_photos', { clientCaptureId: C.u2, unitId: IDS.u2, kind: 'PHOTO' });
  a = setAnswerValue(a, 'f:CLASSROOM/quality', 'YES');
  return a;
}
const fullFacts = [ok(C.site), ok(C.u1), ok(C.u2)];

describe('screens and answers', () => {
  it('one screen per block, in order; re-checks last', () => {
    assert.deepEqual(formScreens(routine).map((s) => s.key), ['s:GENERAL', 'f:CLASSROOM']);
    const withRechecks = snapshotFor('ROUTINE', { withRechecks: true });
    assert.deepEqual(formScreens(withRechecks).map((s) => s.key), ['s:GENERAL', 'f:CLASSROOM', 'r']);
    const classroom = formScreens(routine)[1];
    assert.deepEqual(classroom.units.map((u) => u.id), [IDS.u1, IDS.u2], 'sprint 1 units only');
    assert.ok(classroom.fields.some((f) => f.path === `f:CLASSROOM/progress@${IDS.u1}`), 'per-unit questions repeat per unit');
  });

  it('answer helpers are immutable and keyed by path', () => {
    const empty: VisitFormAnswerInput[] = [];
    const a = setAnswerValue(empty, 's:GENERAL/notes', 'Hello');
    assert.equal(empty.length, 0);
    assert.equal(answerFor(a, 's:GENERAL/notes')!.value, 'Hello');
    const b = setAnswerComment(a, 's:GENERAL/notes', 'why');
    assert.equal(answerFor(b, 's:GENERAL/notes')!.comment, 'why');
    const c = addAnswerCapture(addAnswerCapture(b, 's:GENERAL/site_photos', { clientCaptureId: C.site, kind: 'PHOTO' }), 's:GENERAL/site_photos', { clientCaptureId: C.site, kind: 'PHOTO' });
    assert.equal(answerFor(c, 's:GENERAL/site_photos')!.captures!.length, 1, 'a capture is added once');
    assert.deepEqual(answerCaptureIds(c), [C.site]);
    assert.equal(answerFor(removeAnswerCapture(c, 's:GENERAL/site_photos', C.site), 's:GENERAL/site_photos')!.captures!.length, 0);
  });

  it('cleanAnswers drops unknown paths and empty answers and trims text', () => {
    const cleaned = cleanAnswers(routine, [
      { path: 's:GENERAL/notes', value: '  some notes ', comment: '  ', captures: [] },
      { path: 's:GENERAL/overall', value: null, comment: null, captures: [] },
      { path: 's:GONE/x', value: 'x' },
    ]);
    assert.deepEqual(cleaned, [{ path: 's:GENERAL/notes', value: 'some notes', comment: null, captures: [] }]);
  });
});

describe('photo slots (D-R5.14)', () => {
  it('a photo counts only with a real fix inside the boundary or its tolerance', () => {
    assert.equal(photoStatus(ok(C.site), true), 'OK');
    assert.equal(photoStatus({ ...ok(C.site), geofenceStatus: 'WITHIN_TOLERANCE' }, true), 'OK');
    assert.equal(photoStatus({ ...ok(C.site), geofenceStatus: null }, true), 'OK', 'no boundary: the location is enough');
    assert.equal(photoStatus({ ...ok(C.site), geofenceStatus: 'OUTSIDE' }, true), 'OUTSIDE_BOUNDARY');
    assert.equal(photoStatus({ clientCaptureId: C.nofix, hasFix: false, isMocked: false, geofenceStatus: null }, true), 'NO_LOCATION');
    assert.equal(photoStatus({ ...ok(C.mocked), isMocked: true }, true), 'MOCKED');
    assert.equal(photoStatus({ clientCaptureId: C.nofix, hasFix: false, isMocked: false, geofenceStatus: null }, false), 'OK', 'location not required');
    assert.equal(photoStatus(undefined, true), 'MISSING');
    assert.deepEqual(toValidationFacts([{ ...ok(C.mocked), isMocked: true }]), [{ clientCaptureId: C.mocked, geotagged: false, insideBoundary: true }]);
  });

  it('ONE_PER_UNIT: a labelled required slot per unit', () => {
    const f = field(routine, 'f:CLASSROOM/unit_photos');
    const a = answerFor(fullAnswers(), f.path);
    const m = photoFieldModel(f, a, new Map(fullFacts.map((x) => [x.clientCaptureId, x])))!;
    assert.equal(m.mode, 'ONE_PER_UNIT');
    assert.deepEqual(m.slots.map((s) => [s.label, s.required, s.satisfied]), [['Block A', true, true], ['Block B', true, true]]);
    const missing = photoFieldModel(f, null, new Map())!;
    assert.equal(missing.satisfied, false);
    assert.equal(captureUnitForSlot(f, missing.slots[1]), IDS.u2);
    const outside = photoFieldModel(f, a, new Map([[C.u1, ok(C.u1)], [C.u2, { ...ok(C.u2), geofenceStatus: 'OUTSIDE' }]]))!;
    assert.equal(outside.slots[1].satisfied, false);
    assert.equal(outside.slots[1].captures[0].status, 'OUTSIDE_BOUNDARY');
    assert.equal(outside.slots[0].canAdd, true, 'maxCount 2 per slot');
  });

  it('PER_UNIT_OPTIONAL: labelled slots, none required', () => {
    const adhoc = snapshotFor('AD_HOC', { pickedFacilityIds: [IDS.facFurniture] });
    const f = field(adhoc, 'f:FURNITURE/extra_photos');
    const m = photoFieldModel(f, null, new Map())!;
    assert.equal(m.mode, 'PER_UNIT_OPTIONAL');
    assert.deepEqual(m.slots.map((s) => [s.label, s.required, s.satisfied]), [['Desks', false, true]]);
  });

  it('AT_LEAST_N: one slot with min and max', () => {
    const f = field(routine, 's:GENERAL/site_photos');
    const facts = new Map([C.site, C.u1, C.u2].map((id) => [id, ok(id)]));
    let a: VisitFormAnswerInput[] = [];
    assert.equal(photoFieldModel(f, null, facts)!.satisfied, false);
    for (const id of [C.site, C.u1, C.u2]) a = addAnswerCapture(a, f.path, { clientCaptureId: id, kind: 'PHOTO' });
    const m = photoFieldModel(f, answerFor(a, f.path), facts)!;
    assert.equal(m.satisfied, true);
    assert.equal(m.slots[0].canAdd, false, 'maxCount 3');
    assert.equal(captureUnitForSlot(f, m.slots[0]), null);
  });

  it('a rule can ask for a photo on another question', () => {
    const f = field(routine, 'f:CLASSROOM/quality');
    assert.equal(photoFieldModel(f, { path: f.path, value: 'YES' }, new Map()), null);
    const needs = photoFieldModel(f, { path: f.path, value: 'NO' }, new Map())!;
    assert.equal(needs.slots[0].required, true);
    assert.equal(needs.satisfied, false);
    assert.deepEqual(triggeredRules(f, { path: f.path, value: 'NO' }), { requirePhoto: true, requireComment: false, findingSeverity: null, quantityAbovePlanned: false });
    const contractor = field(routine, 's:GENERAL/contractor_on_site');
    assert.deepEqual(triggeredRules(contractor, { path: contractor.path, value: 'NO' }), { requirePhoto: false, requireComment: true, findingSeverity: 'MAJOR', quantityAbovePlanned: false });
  });
});

describe('issues (shared validateVisitAnswers + the phone rules)', () => {
  it('an empty draft lists every missing answer per screen, plus the review fields', () => {
    const check = checkDraft(routine, draftOf([], { overallFinding: null, summaryText: '' }), []);
    assert.equal(check.canSubmit, false);
    const codes = check.issues.map((i) => `${i.screenKey}|${i.code}`);
    assert.ok(codes.includes('s:GENERAL|REQUIRED'));
    assert.ok(codes.includes('s:GENERAL|PHOTO_MISSING'));
    assert.ok(codes.includes('f:CLASSROOM|UNIT_PHOTO_MISSING'));
    assert.ok(codes.includes(`${REVIEW_SCREEN_KEY}|OVERALL_FINDING_REQUIRED`));
    assert.ok(codes.includes(`${REVIEW_SCREEN_KEY}|SUMMARY_REQUIRED`));
    const unitGap = check.issues.find((i) => i.code === 'UNIT_PHOTO_MISSING' && i.unitId === IDS.u2)!;
    assert.equal(unitGap.message, 'Take a photo of Block B');
    assert.equal(formProgress(routine, check).done, 0);
  });

  it('a complete draft can be submitted', () => {
    const check = checkDraft(routine, draftOf(fullAnswers()), fullFacts);
    assert.deepEqual(check.issues, []);
    assert.equal(check.canSubmit, true);
    assert.deepEqual(formProgress(routine, check), { done: 2, total: 2 });
  });

  it('a photo outside the boundary, without location or no longer on the phone blocks', () => {
    const outside = checkDraft(routine, draftOf(fullAnswers()), [ok(C.site), ok(C.u1), { ...ok(C.u2), geofenceStatus: 'OUTSIDE' }]);
    assert.equal(outside.canSubmit, false);
    assert.equal(outside.issues[0].code, 'PHOTO_OUTSIDE_BOUNDARY');
    assert.match(outside.issues[0].message, /Outside the site boundary/);
    const mocked = checkDraft(routine, draftOf(fullAnswers()), [ok(C.site), ok(C.u1), { ...ok(C.u2), isMocked: true }]);
    assert.match(mocked.issues[0].message, /simulated/);
    const gone = checkDraft(routine, draftOf(fullAnswers()), [ok(C.site), ok(C.u1)]);
    assert.ok(gone.issues.some((i) => i.code === 'CAPTURE_MISSING'));
  });

  it('a rule-triggered comment blocks; the finding it raises is listed', () => {
    let a = setAnswerValue(fullAnswers(), 's:GENERAL/contractor_on_site', 'NO');
    let check = checkDraft(routine, draftOf(a), fullFacts);
    assert.deepEqual(check.issues.map((i) => i.code), ['COMMENT_REQUIRED']);
    a = setAnswerComment(a, 's:GENERAL/contractor_on_site', 'Site closed today');
    check = checkDraft(routine, draftOf(a), fullFacts);
    assert.equal(check.canSubmit, true);
    assert.deepEqual(check.findingsToRaise.map((f) => [f.path, f.severity]), [['s:GENERAL/contractor_on_site', 'MAJOR']]);
  });

  it('the overall finding is suggested from an OVERALL_FINDING question', () => {
    assert.equal(suggestedOverallFinding(routine, setAnswerValue(fullAnswers(), 's:GENERAL/overall', 'major_issues')), 'MAJOR_ISSUES');
    assert.equal(suggestedOverallFinding(routine, []), null);
  });
});

describe('draft → submission request', () => {
  it('ids only, matching the server schema, finalised at send time', () => {
    const draft = draftOf(fullAnswers(), { siteLogEntryIds: [uuid(601)], formSnapshotId: null });
    const queued = buildQueuedSubmission(routine, draft, { confirmedAt: '2026-11-26T10:00:00.000Z', checkIn: null, submissionGeotag: null });
    assert.equal(queued.body.clientSubmissionId, draft.id);
    assert.deepEqual(queued.siteLogClientEntryIds, [uuid(601)]);
    const text = JSON.stringify(queued);
    assert.ok(!/file:\/\/|base64|Block A/.test(text), 'no paths, base64 or display strings');

    const notCreated = finaliseSubmissionBody(queued, { visitFormSnapshotId: null, siteLogServerIdByClientId: new Map() });
    assert.deepEqual(notCreated.ok ? null : notCreated.code, 'VISIT_NOT_CREATED');
    const notSent = finaliseSubmissionBody(queued, { visitFormSnapshotId: uuid(300), siteLogServerIdByClientId: new Map([[uuid(601), null]]) });
    assert.deepEqual(notSent.ok ? null : notSent.code, 'SITE_LOG_NOT_REGISTERED');
    const ready = finaliseSubmissionBody(queued, { visitFormSnapshotId: uuid(300), siteLogServerIdByClientId: new Map([[uuid(601), uuid(602)]]) });
    assert.ok(ready.ok);
    if (!ready.ok) return;
    assert.equal(ready.body.formSnapshotId, uuid(300));
    assert.deepEqual(ready.body.siteLogEntryIds, [uuid(602)]);
    const parsed = SubmitVisitRequestSchema.safeParse(ready.body);
    assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  });

  it('a draft without an overall finding or summary cannot be queued', () => {
    assert.throws(() => buildQueuedSubmission(routine, draftOf([], { overallFinding: null }), { confirmedAt: '2026-11-26T10:00:00.000Z', checkIn: null, submissionGeotag: null }));
    assert.throws(() => buildQueuedSubmission(routine, draftOf([], { summaryText: ' ' }), { confirmedAt: '2026-11-26T10:00:00.000Z', checkIn: null, submissionGeotag: null }));
  });
});

describe('rebuilt forms (D-R5.19)', () => {
  it('tells a re-check-only change from a rebuilt form', () => {
    assert.equal(formChangeKind(routine, snapshotFor('ROUTINE')), 'SAME', 'builtAt does not count');
    assert.equal(formChangeKind(routine, snapshotFor('ROUTINE', { withRechecks: true })), 'RECHECKS_ONLY');
    assert.equal(formChangeKind(routine, snapshotFor('ROUTINE', { visitDate: '2026-12-20' })), 'REBUILT');
  });

  it('re-maps by path and lists what was dropped', () => {
    const pack = fieldPack();
    const later = VisitFieldPackDtoSchema.parse({ ...pack, bundle: { ...pack.bundle, completedUnitIds: [IDS.u1] } });
    // Sprint 2, block A reported complete: the classroom keeps block B only; the desks join.
    const rebuilt = snapshotFor('ROUTINE', { visitDate: '2026-12-20', pack: later });
    assert.deepEqual(rebuilt.blocks.map((b) => b.key), ['s:GENERAL', 'f:CLASSROOM', 'f:FURNITURE']);
    const { answers, dropped } = remapAnswers(routine, rebuilt, fullAnswers());
    assert.equal(answerFor(answers, `f:CLASSROOM/progress@${IDS.u1}`), null);
    assert.equal(answerFor(answers, `f:CLASSROOM/progress@${IDS.u2}`)!.value, 25);
    assert.deepEqual(answerFor(answers, 'f:CLASSROOM/unit_photos')!.captures!.map((c) => c.clientCaptureId), [C.u2]);
    assert.deepEqual(
      dropped.map((d) => d.reason),
      ['The question is no longer on the form', 'Photos of units no longer on the form were taken off']
    );
    assert.equal(dropped[0].label, 'Progress of classroom block');
  });

  it('drops option keys no longer offered', () => {
    const pack = fieldPack();
    const general = pack.bundle.sections[0].fields.map((f) => (f.key === 'overall' ? { ...f, options: f.options.filter((o) => o.key !== 'major_issues') } : f));
    const narrowed = VisitFieldPackDtoSchema.parse({ ...pack, bundle: { ...pack.bundle, sections: [{ ...pack.bundle.sections[0], fields: general }] } });
    const rebuilt = snapshotFor('ROUTINE', { pack: narrowed });
    const { answers, dropped } = remapAnswers(routine, rebuilt, setAnswerValue(fullAnswers(), 's:GENERAL/overall', 'major_issues'));
    assert.equal(answerFor(answers, 's:GENERAL/overall')!.value, null);
    assert.equal(dropped[0].reason, 'The option chosen is no longer offered');
  });

  it('remapDraftOntoSnapshot binds the draft to the new form and records the notice', () => {
    const rebuilt = snapshotFor('ROUTINE', { visitDate: '2026-12-20' });
    const { draft } = remapDraftOntoSnapshot(draftOf(fullAnswers()), routine, { snapshot: rebuilt, formSnapshotId: uuid(301), formHash: 'b'.repeat(64) }, '2026-11-27T08:00:00.000Z');
    assert.equal(draft.formSnapshotId, uuid(301));
    assert.equal(draft.formHash, 'b'.repeat(64));
    assert.equal(draft.remap!.fromFormHash, 'a'.repeat(64));
  });

  it('a returned submission pre-fills values; its photos must be taken again', () => {
    const { answers, dropped } = answersFromReturnedSubmission(routine, [
      { path: 's:GENERAL/contractor_on_site', value: 'YES', comment: null, captures: [] },
      { path: 'f:CLASSROOM/unit_photos', value: null, comment: null, captures: [{ clientCaptureId: C.u1, unitId: IDS.u1 } as never] },
    ]);
    assert.equal(answerFor(answers, 's:GENERAL/contractor_on_site')!.value, 'YES');
    assert.deepEqual(answerFor(answers, 'f:CLASSROOM/unit_photos')!.captures, []);
    assert.match(dropped[0].reason, /taken again/);
  });
});

describe('offline Ad hoc (D-R5.12)', () => {
  const pack = fieldPack();

  it('lists facilities with units and builds the form the server will build', () => {
    assert.equal(adHocAvailable(pack), true);
    assert.equal(adHocAvailable(null), false);
    assert.deepEqual(adHocFacilityChoices(pack).map((f) => [f.code, f.unitCount]), [['CLASSROOM', 2], ['FURNITURE', 1]]);
    const form = buildAdHocForm(pack, { visitDate: '2026-11-24', builtAt: '2026-11-24T09:00:00.000Z', pickedFacilityIds: [IDS.facFurniture] });
    assert.deepEqual(form.snapshot.blocks.map((b) => b.key), ['s:GENERAL', 'f:FURNITURE', 'r']);
    assert.equal(form.formHash, createHash('sha256').update(canonicalVisitFormSnapshot(form.snapshot), 'utf8').digest('hex'));
    assert.equal(form.formHash, hashVisitFormSnapshot(form.snapshot));
    assert.deepEqual(form.components, { templateId: IDS.templateAdHoc, sectionIds: [IDS.sectionGeneral], subFormIds: [IDS.subSupply] });
  });

  it('re-checks the picked facilities and project-wide findings by default; ALL takes every one', () => {
    const picked = buildAdHocForm(pack, { visitDate: '2026-11-24', builtAt: '2026-11-24T09:00:00.000Z', pickedFacilityIds: [IDS.facFurniture] });
    assert.deepEqual(picked.recheckIds, [IDS.findingProject, IDS.findingFurniture]);
    const all = buildAdHocForm(pack, { visitDate: '2026-11-24', builtAt: '2026-11-24T09:00:00.000Z', pickedFacilityIds: [IDS.facFurniture], recheckScope: 'ALL' });
    assert.deepEqual(all.recheckIds, [IDS.findingClassroom, IDS.findingProject, IDS.findingFurniture]);
  });

  it('the hash ignores when the form was built', () => {
    const a = buildAdHocForm(pack, { visitDate: '2026-11-24', builtAt: '2026-11-24T09:00:00.000Z', pickedFacilityIds: [IDS.facClassroom] });
    const b = buildAdHocForm(pack, { visitDate: '2026-11-24', builtAt: '2026-11-24T17:00:00.000Z', pickedFacilityIds: [IDS.facClassroom] });
    assert.equal(a.formHash, b.formHash);
  });
});
