/** Runs in Node. Needs pipeline wave 5 (N8): the field verification model on the phone. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assembleNeedsVerificationForm,
  BundleSectionSchema,
  DEFAULT_FORM_LIBRARY,
  NEEDS_VERIFICATION_SECTION_CODES,
  type NeedsVerificationDto,
  type NeedsVerificationForm,
  type NeedsVerificationSubmissionDto,
} from '@insite/shared';
import {
  buildVerificationSubmission,
  checkVerificationDraft,
  correctionFromReturned,
  dayListCountText,
  dayListTitle,
  dtoAfterSubmission,
  feedRemovals,
  formatDistance,
  formsToDownload,
  groupVerificationsByDay,
  hashNeedsVerificationForm,
  mergeVerificationDots,
  remapVerificationDraft,
  siteBlockKey,
  siteLocationFromFix,
  siteLocationView,
  storedLocationText,
  upsertSiteLocation,
  verificationBadges,
  verificationCaptureIds,
  verificationFormAccess,
  verificationFormButton,
  locatedSitesText,
  verificationIdOfScope,
  verificationLabel,
  verificationScope,
  verificationScopeText,
  verificationsNeedingAttention,
  verificationSnapshot,
  verificationView,
  EMPTY_VERIFICATION_LOCAL_STATE,
  parseVerificationLocalState,
  type NeedsVerificationDraft,
  type StoredNeedsVerification,
  type StoredNeedsVerificationDraft,
} from './needsVerification';
import { formScreens, type PhoneCaptureFact } from './visitForm';

const ROW_A = '11111111-1111-4111-8111-111111111111';
const ROW_B = '22222222-2222-4222-8222-222222222222';
const VERIFICATION_ID = '33333333-3333-4333-8333-333333333333';

function section(code: string, id: string) {
  const def = DEFAULT_FORM_LIBRARY.sections.find((s) => s.code === code)!;
  return BundleSectionSchema.parse({ id, code, version: 1, title: def.title, description: def.description ?? null, fields: def.fields });
}

function buildForm(overrides: { siteLat?: number | null } = {}): NeedsVerificationForm {
  return assembleNeedsVerificationForm({
    cycleId: '44444444-4444-4444-8444-444444444444',
    proposalId: '55555555-5555-4555-8555-555555555555',
    reference: '2027-DI-004',
    title: 'Gwale Primary School renovation',
    purpose: 'VALIDATION',
    versionNumber: 2,
    siteSection: section(NEEDS_VERIFICATION_SECTION_CODES.SITE, '66666666-6666-4666-8666-666666666666'),
    facilitySection: section(NEEDS_VERIFICATION_SECTION_CODES.FACILITY, '77777777-7777-4777-8777-777777777777'),
    sites: [
      { siteNumber: 2, schoolName: 'Dala JSS', lgaCode: 'KN-DALA', address: null, latitude: null, longitude: null },
      { siteNumber: 1, schoolName: 'Gwale Primary', lgaCode: 'KN-GWALE', address: 'Gwale Road', latitude: overrides.siteLat === undefined ? 12.0 : overrides.siteLat, longitude: 8.5 },
    ],
    rows: [
      { rowId: ROW_A, unitId: 'CL-1', siteNumber: 1, facilityCode: 'CLASSROOM', facilityName: 'Classroom', interventionAction: 'RENOVATE', existingQuantity: 3, existingCondition: 'DILAPIDATED', proposedQuantity: 3, unitOfMeasure: 'No.' },
      { rowId: ROW_B, unitId: 'TL-1', siteNumber: 2, facilityCode: 'TOILET', facilityName: 'Toilet', interventionAction: 'NEW', existingQuantity: 0, existingCondition: 'ABSENT', proposedQuantity: 2, unitOfMeasure: 'No.' },
    ],
    builtAt: '2026-11-27T08:00:00.000Z',
  });
}

function dto(overrides: Partial<NeedsVerificationDto> = {}): NeedsVerificationDto {
  const form = buildForm();
  return {
    id: VERIFICATION_ID,
    cycleId: form.context.cycleId,
    proposalId: form.context.proposalId,
    reference: '2027-DI-004',
    title: 'Gwale Primary School renovation',
    programmeName: 'Direct Intervention',
    stateCode: 'KN',
    lgaCodes: [],
    purpose: 'VALIDATION',
    status: 'ASSIGNED',
    statusLabel: 'Assigned',
    officer: { userId: '88888888-8888-4888-8888-888888888888', name: 'Kabiru Sule' },
    assignedBy: { userId: '99999999-9999-4999-8999-999999999999', name: 'Validator' },
    assignedAt: '2026-11-26T08:00:00.000Z',
    dueDate: '2026-11-30',
    overdue: false,
    instructions: null,
    versionNumber: 2,
    sites: form.sites,
    rowCount: form.rows.length,
    formHash: hashNeedsVerificationForm(form),
    cancelledAt: null,
    cancelReason: null,
    submission: null,
    captures: [],
    siteVerificationDraft: null,
    allowedActions: [],
    ...overrides,
  };
}

function stored(d: Partial<NeedsVerificationDto> = {}, local: Partial<StoredNeedsVerification['local']> = {}): StoredNeedsVerification {
  return { id: VERIFICATION_ID, dto: dto(d), local: { ...EMPTY_VERIFICATION_LOCAL_STATE, ...local }, syncedAt: null };
}

function draft(overrides: Partial<NeedsVerificationDraft> = {}): NeedsVerificationDraft {
  const form = buildForm();
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    verificationId: VERIFICATION_ID,
    formHash: hashNeedsVerificationForm(form),
    answers: [],
    siteLocations: [],
    notes: '',
    correctsSubmissionId: null,
    startedAt: '2026-11-27T08:00:00.000Z',
    updatedAt: '2026-11-27T08:00:00.000Z',
    remap: null,
    ...overrides,
  };
}

const storedDraft = (status: StoredNeedsVerificationDraft['status'], d: Partial<NeedsVerificationDraft> = {}, lastError: string | null = null): StoredNeedsVerificationDraft => ({
  draft: draft(d),
  status,
  serverId: null,
  lastError,
  updatedAt: '2026-11-27T09:00:00.000Z',
});

const fix = (lat: number, lng: number, accuracy: number | null = 8, mocked = false) => ({ latitude: lat, longitude: lng, accuracyMeters: accuracy, isMocked: mocked, capturedAt: '2026-11-27T10:00:00.000Z' });
const photoFact = (id: string, hasFix = true): PhoneCaptureFact => ({ clientCaptureId: id, hasFix, isMocked: false, geofenceStatus: null });

/** A complete set of answers for buildForm(), with photos c1..c4. */
function completeAnswers() {
  return [
    { path: 'n:site:1/school-found', value: 'YES', comment: null, captures: [] },
    { path: 'n:site:1/site-photos', value: null, comment: null, captures: [{ clientCaptureId: 'c1', unitId: null, kind: 'PHOTO' as const }, { clientCaptureId: 'c2', unitId: null, kind: 'PHOTO' as const }] },
    { path: 'n:site:2/school-found', value: 'YES', comment: null, captures: [] },
    { path: 'n:site:2/site-photos', value: null, comment: null, captures: [{ clientCaptureId: 'c3', unitId: null, kind: 'PHOTO' as const }, { clientCaptureId: 'c4', unitId: null, kind: 'PHOTO' as const }] },
    { path: `n:row:${ROW_A}/existing-quantity`, value: 3, comment: null, captures: [] },
    { path: `n:row:${ROW_A}/existing-condition`, value: 'dilapidated', comment: null, captures: [] },
    { path: `n:row:${ROW_A}/matches-assessment`, value: 'YES', comment: null, captures: [] },
    { path: `n:row:${ROW_A}/facility-photo`, value: null, comment: null, captures: [{ clientCaptureId: 'c5', unitId: null, kind: 'PHOTO' as const }] },
    { path: `n:row:${ROW_B}/existing-quantity`, value: 0, comment: null, captures: [] },
    { path: `n:row:${ROW_B}/existing-condition`, value: 'absent', comment: null, captures: [] },
    { path: `n:row:${ROW_B}/matches-assessment`, value: 'YES', comment: null, captures: [] },
    { path: `n:row:${ROW_B}/facility-photo`, value: null, comment: null, captures: [{ clientCaptureId: 'c6', unitId: null, kind: 'PHOTO' as const }] },
  ];
}
const allFacts = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6'].map((id) => photoFact(id));
const bothLocations = () => [siteLocationFromFix(1, fix(12.0, 8.5)), siteLocationFromFix(2, fix(12.1, 8.6))];

describe('needs verification: local model', () => {
  it('outbox scopes are told apart from project ids', () => {
    assert.equal(verificationScope('abc'), 'needs-verification:abc');
    assert.equal(verificationIdOfScope('needs-verification:abc'), 'abc');
    assert.equal(verificationIdOfScope('p1'), null);
    assert.equal(verificationIdOfScope(null), null);
  });

  it('local state parses with defaults and survives bad JSON', () => {
    assert.deepEqual(parseVerificationLocalState('{"queuedDraftId":"d1"}'), { queuedDraftId: 'd1', removedFromFeedAt: null });
    assert.deepEqual(parseVerificationLocalState('not json'), EMPTY_VERIFICATION_LOCAL_STATE);
    assert.deepEqual(parseVerificationLocalState(null), EMPTY_VERIFICATION_LOCAL_STATE);
  });

  it('the form hash ignores builtAt and changes with the content', () => {
    const a = buildForm();
    assert.equal(hashNeedsVerificationForm(a), hashNeedsVerificationForm({ ...a, builtAt: '2030-01-01T00:00:00.000Z' }));
    assert.notEqual(hashNeedsVerificationForm(a), hashNeedsVerificationForm(buildForm({ siteLat: 12.5 })));
    assert.match(hashNeedsVerificationForm(a), /^[0-9a-f]{64}$/);
  });

  it('the form renders as visit form screens: per site, then its rows', () => {
    const screens = formScreens(verificationSnapshot(buildForm()));
    assert.deepEqual(
      screens.map((s) => s.key),
      ['n:site:1', `n:row:${ROW_A}`, 'n:site:2', `n:row:${ROW_B}`]
    );
    assert.equal(siteBlockKey(2), 'n:site:2');
  });
});

describe('needs verification: Home', () => {
  const today = '2026-11-27';

  it('labels by purpose and reference', () => {
    assert.equal(verificationLabel({ purpose: 'VALIDATION', reference: '2027-DI-004' }), 'Site verification · 2027-DI-004');
    assert.equal(verificationLabel({ purpose: 'BEAP_REVIEW', reference: '2027-MG-KN-007' }), 'BEAP site visit · 2027-MG-KN-007');
  });

  it('an assigned verification is planned on its due date; past due it is overdue', () => {
    const v = verificationView(stored(), today);
    assert.equal(v.date, '2026-11-30');
    assert.equal(v.dot, 'PLANNED');
    assert.equal(v.overdue, false);
    assert.deepEqual(verificationBadges(v).map((b) => b.text), ['Due Mon 30 Nov']);
    const late = verificationView(stored({ dueDate: '2026-11-25' }), today);
    assert.equal(late.overdue, true);
    assert.equal(late.dot, 'OVERDUE');
    assert.equal(verificationView(stored({ overdue: true, dueDate: '2026-11-27' }), today).overdue, true, 'the server flag counts');
  });

  it('returned shows as needing attention until a correction is queued', () => {
    const r = verificationView(stored({ status: 'RETURNED' }), today);
    assert.equal(r.returned, true);
    assert.equal(r.dot, 'OVERDUE');
    assert.deepEqual(verificationBadges(r).map((b) => b.text), ['Returned to you']);
    const queued = verificationView(stored({ status: 'RETURNED' }, { queuedDraftId: 'd1' }), today);
    assert.equal(queued.returned, false);
    assert.equal(queued.submitted, true);
    assert.equal(queued.dot, 'DONE');
    assert.deepEqual(verificationBadges(queued).map((b) => b.text), ['Site verification saved', 'Waiting to send']);
  });

  it('submitted, accepted and cancelled', () => {
    assert.deepEqual(verificationBadges(verificationView(stored({ status: 'SUBMITTED' }), today)).map((b) => b.text), ['Waiting for review']);
    assert.deepEqual(verificationBadges(verificationView(stored({ status: 'ACCEPTED' }), today)).map((b) => b.text), ['Accepted']);
    const c = verificationView(stored({ status: 'CANCELLED', dueDate: '2026-11-01' }), today);
    assert.equal(c.dot, null);
    assert.equal(c.overdue, false);
    assert.deepEqual(verificationBadges(c).map((b) => b.text), ['Cancelled']);
    assert.ok(verificationBadges(verificationView(stored({}, { removedFromFeedAt: 'x' }), today)).some((b) => b.text === 'No longer assigned'));
  });

  it('groups by day without cancelled ones, merges dots and lists attention oldest first', () => {
    const views = [
      verificationView(stored({ dueDate: '2026-11-30' }), today),
      { ...verificationView(stored({ status: 'RETURNED', dueDate: '2026-11-20' }), today), id: 'r', reference: '2027-DI-001' },
      { ...verificationView(stored({ status: 'CANCELLED', dueDate: '2026-11-30' }), today), id: 'c' },
    ];
    const byDay = groupVerificationsByDay(views);
    assert.equal(byDay.get('2026-11-30')?.length, 1);
    assert.equal(byDay.get('2026-11-20')?.[0].id, 'r');
    const dots = mergeVerificationDots(new Map([['2026-11-30', ['DONE']]]), views);
    assert.deepEqual(dots.get('2026-11-30'), ['PLANNED', 'DONE']);
    assert.deepEqual(dots.get('2026-11-20'), ['OVERDUE']);
    assert.deepEqual(verificationsNeedingAttention(views).map((v) => v.id), ['r']);
  });

  it('day list title and count text', () => {
    assert.equal(dayListTitle(today, today, false), "Today's monitoring visits");
    assert.equal(dayListTitle(today, today, true), "Today's visits");
    assert.equal(dayListTitle('2026-11-30', today, true), 'Visits, Mon 30 Nov 2026');
    assert.equal(dayListCountText(2, 1, 'none'), '2 monitoring visits · 1 site verification');
    assert.equal(dayListCountText(0, 2, 'none'), '2 site verifications');
    assert.equal(dayListCountText(0, 0, 'none'), 'none');
    assert.equal(verificationScopeText({ siteCount: 2, rowCount: 1 }), '2 sites · 1 facility to check');
    assert.equal(verificationScopeText({ siteCount: 1, rowCount: 0 }), '1 site');
  });
});

describe('needs verification: site locations', () => {
  const stored1 = { latitude: 12.0, longitude: 8.5 };

  it('not recorded yet, with or without a stored point', () => {
    assert.equal(siteLocationView(stored1, null).recorded, false);
    assert.equal(siteLocationView(stored1, null).distanceText, null);
    assert.equal(siteLocationView({ latitude: null, longitude: null }, null).distanceText, 'No location stored for this site yet');
    assert.equal(storedLocationText(stored1), 'Stored location: 12.00000, 8.50000');
    assert.equal(storedLocationText({ latitude: null, longitude: null }), 'No stored location');
  });

  it('a close fix matches; a far one says the site will move; accuracy and mock warnings', () => {
    const close = siteLocationView(stored1, siteLocationFromFix(1, fix(12.0001, 8.5)));
    assert.equal(close.recorded, true);
    assert.equal(close.accuracyText, '±8 m accuracy');
    assert.match(close.distanceText!, /^11 m from the stored location \(matches\)$/);
    assert.equal(close.warning, null);
    const far = siteLocationView(stored1, siteLocationFromFix(1, fix(12.01, 8.5)));
    assert.match(far.distanceText!, /^1\.1 km from the stored location: the site will be moved here/);
    assert.match(siteLocationView(stored1, siteLocationFromFix(1, fix(12.0, 8.5, 250))).warning!, /Accuracy is poor/);
    assert.match(siteLocationView(stored1, siteLocationFromFix(1, fix(12.0, 8.5, 5, true))).warning!, /simulated/);
    assert.equal(siteLocationView(stored1, siteLocationFromFix(1, fix(12.0, 8.5, null))).accuracyText, 'Accuracy unknown');
    assert.match(siteLocationView({ latitude: null, longitude: null }, siteLocationFromFix(1, fix(12.0, 8.5))).distanceText!, /this one will be used/);
  });

  it('one location per site, in site order', () => {
    const a = upsertSiteLocation([], siteLocationFromFix(2, fix(1, 1)));
    const b = upsertSiteLocation(a, siteLocationFromFix(1, fix(2, 2)));
    const c = upsertSiteLocation(b, siteLocationFromFix(2, fix(3, 3)));
    assert.deepEqual(c.map((l) => [l.siteNumber, l.latitude]), [[1, 2], [2, 3]]);
    assert.equal(formatDistance(12.4), '12 m');
    assert.equal(formatDistance(15_400), '15 km');
  });
});

describe('needs verification: draft check and request', () => {
  const form = buildForm();

  it('an empty draft is blocked by answers, photos and both locations, each on its section', () => {
    const check = checkVerificationDraft(form, draft(), []);
    assert.equal(check.canSubmit, false);
    const site1 = check.byScreen.get('n:site:1') ?? [];
    assert.ok(site1.some((i) => i.code === 'SITE_LOCATION_MISSING'));
    assert.ok(site1.some((i) => i.code === 'REQUIRED'));
    assert.ok(site1.some((i) => i.code === 'PHOTO_MISSING'));
    assert.ok((check.byScreen.get(`n:row:${ROW_A}`) ?? []).length > 0);
    assert.ok((check.byScreen.get('n:site:2') ?? []).some((i) => i.code === 'SITE_LOCATION_MISSING'));
  });

  it('complete answers, photos and locations can be submitted', () => {
    const check = checkVerificationDraft(form, draft({ answers: completeAnswers(), siteLocations: bothLocations() }), allFacts);
    assert.deepEqual(check.issues, []);
    assert.equal(check.canSubmit, true);
  });

  it('an ungeotagged photo or one no longer on the phone blocks', () => {
    const noFix = allFacts.map((f) => (f.clientCaptureId === 'c1' ? photoFact('c1', false) : f));
    const check = checkVerificationDraft(form, draft({ answers: completeAnswers(), siteLocations: bothLocations() }), noFix);
    assert.ok(check.issues.some((i) => i.code === 'PHOTO_NOT_GEOTAGGED' && i.screenKey === 'n:site:1'));
    const missing = checkVerificationDraft(form, draft({ answers: completeAnswers(), siteLocations: bothLocations() }), allFacts.filter((f) => f.clientCaptureId !== 'c6'));
    assert.ok(missing.issues.some((i) => i.code === 'CAPTURE_MISSING' && i.screenKey === `n:row:${ROW_B}`));
  });

  it('"school not found" needs a comment', () => {
    const answers = completeAnswers().map((a) => (a.path === 'n:site:2/school-found' ? { ...a, value: 'NO' } : a));
    const check = checkVerificationDraft(form, draft({ answers, siteLocations: bothLocations() }), allFacts);
    assert.ok(check.issues.some((i) => i.code === 'COMMENT_REQUIRED' && i.screenKey === 'n:site:2'));
  });

  it('the request carries ids only: cleaned answers, sorted locations of form sites, trimmed notes', () => {
    const extra = [...bothLocations().reverse(), siteLocationFromFix(9, fix(1, 1))];
    const body = buildVerificationSubmission(form, draft({ answers: [...completeAnswers(), { path: 'n:site:1/site-notes', value: '  ', comment: null, captures: [] }], siteLocations: extra, notes: '  Gate locked  ' }), '2026-11-27T11:00:00.000Z');
    assert.equal(body.clientSubmissionId, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    assert.equal(body.formHash, hashNeedsVerificationForm(form));
    assert.deepEqual(body.siteLocations.map((l) => l.siteNumber), [1, 2]);
    assert.equal(body.notes, 'Gate locked');
    assert.ok(!body.answers.some((a) => a.path === 'n:site:1/site-notes'), 'empty answers are left out');
    assert.equal(buildVerificationSubmission(form, draft(), '2026-11-27T11:00:00.000Z').notes, null);
    assert.deepEqual(verificationCaptureIds(completeAnswers()), ['c1', 'c2', 'c3', 'c4', 'c5', 'c6']);
  });

  it('a returned submission pre-fills answers, locations and notes; photos are taken again', () => {
    const returned = {
      answers: completeAnswers().map((a) => ({ ...a, comment: a.comment ?? null })),
      siteLocations: [...bothLocations(), siteLocationFromFix(7, fix(1, 1))],
      notes: 'First try',
    } as unknown as Pick<NeedsVerificationSubmissionDto, 'answers' | 'siteLocations' | 'notes'>;
    const c = correctionFromReturned(form, returned);
    assert.ok(c.answers.every((a) => (a.captures ?? []).length === 0));
    assert.equal(c.answers.find((a) => a.path === `n:row:${ROW_A}/existing-quantity`)?.value, 3);
    assert.deepEqual(c.siteLocations.map((l) => l.siteNumber), [1, 2]);
    assert.equal(c.notes, 'First try');
    assert.equal(c.dropped.length, 4, 'one line per answer that had photos');
  });

  it('a refused draft moves onto a rebuilt form by path; answers of rows no longer there are dropped', () => {
    const next = assembleNeedsVerificationForm({
      ...{
        cycleId: form.context.cycleId,
        proposalId: form.context.proposalId,
        reference: form.context.reference,
        title: form.context.title,
        purpose: form.context.purpose,
        versionNumber: 3,
        siteSection: section(NEEDS_VERIFICATION_SECTION_CODES.SITE, '66666666-6666-4666-8666-666666666666'),
        facilitySection: section(NEEDS_VERIFICATION_SECTION_CODES.FACILITY, '77777777-7777-4777-8777-777777777777'),
        sites: form.sites.filter((s) => s.siteNumber === 1),
        rows: form.rows.filter((r) => r.siteNumber === 1),
        builtAt: '2026-11-28T08:00:00.000Z',
      },
    });
    const moved = remapVerificationDraft(draft({ answers: completeAnswers(), siteLocations: bothLocations() }), form, { form: next, formHash: hashNeedsVerificationForm(next) });
    assert.ok(moved.answers.every((a) => !a.path.startsWith('n:site:2') && !a.path.includes(ROW_B)));
    assert.deepEqual(moved.siteLocations.map((l) => l.siteNumber), [1]);
    assert.ok(moved.dropped.some((d) => d.reason === 'The question is no longer on the form'));
  });
});

describe('needs verification: which form opens', () => {
  it('assigned without a draft starts; an open draft is edited; a queued one is read-only', () => {
    assert.deepEqual(verificationFormAccess(stored(), { open: null, latest: null }), { mode: 'START', correction: false });
    const open = storedDraft('DRAFT');
    assert.equal(verificationFormAccess(stored(), { open, latest: open }).mode, 'EDIT');
    const queued = storedDraft('QUEUED');
    const q = verificationFormAccess(stored(), { open: queued, latest: queued });
    assert.equal(q.mode, 'READ_ONLY');
  });

  it('returned with this phone\'s submission starts a correction; a newer sent draft stays read-only', () => {
    const sent = storedDraft('SENT');
    const returnedSubmission = { status: 'RETURNED', clientSubmissionId: sent.draft.id } as NeedsVerificationSubmissionDto;
    assert.deepEqual(verificationFormAccess(stored({ status: 'RETURNED', submission: returnedSubmission }), { open: null, latest: sent }), { mode: 'START', correction: true });
    const other = { status: 'RETURNED', clientSubmissionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' } as NeedsVerificationSubmissionDto;
    assert.equal(verificationFormAccess(stored({ status: 'RETURNED', submission: other }), { open: null, latest: sent }).mode, 'READ_ONLY');
    assert.equal(verificationFormAccess(stored({ status: 'ASSIGNED' }), { open: null, latest: sent }).mode, 'READ_ONLY', 'sent, the feed has not caught up');
  });

  it('a refused draft can be copied while the verification is open; cancelled and accepted block', () => {
    const refused = storedDraft('REFUSED', {}, 'stale');
    const r = verificationFormAccess(stored(), { open: null, latest: refused });
    assert.equal(r.mode, 'READ_ONLY');
    assert.equal(r.mode === 'READ_ONLY' && r.canCopy, true);
    const notOpen = verificationFormAccess(stored({ status: 'SUBMITTED' }), { open: null, latest: refused });
    assert.equal(notOpen.mode === 'READ_ONLY' && notOpen.canCopy, false);
    assert.equal(verificationFormAccess(stored({ status: 'CANCELLED', cancelReason: 'Duplicate' }), { open: null, latest: null }).mode, 'BLOCKED');
    assert.equal(verificationFormAccess(stored({ status: 'ACCEPTED' }), { open: null, latest: null }).mode, 'BLOCKED');
    const d = storedDraft('DRAFT');
    assert.equal(verificationFormAccess(stored({ status: 'CANCELLED' }), { open: d, latest: d }).mode, 'READ_ONLY');
  });
});

describe('needs verification: sync', () => {
  it('downloads the current form of open verifications not cached under their hash', () => {
    const list = [stored(), { ...stored({ status: 'SUBMITTED' }), id: 'b' }, { ...stored({ status: 'RETURNED', formHash: 'h2' }), id: 'c' }];
    const cached = new Set([`c:h1`]);
    assert.deepEqual(
      formsToDownload(list, (id, hash) => cached.has(`${id}:${hash}`)),
      [
        { verificationId: VERIFICATION_ID, formHash: list[0].dto.formHash },
        { verificationId: 'c', formHash: 'h2' },
      ]
    );
  });

  it('a feed removes rows it no longer returns unless an unsent draft keeps them', () => {
    const r = feedRemovals(
      [
        { id: 'a', hasUnsentDraft: false, markedRemoved: false },
        { id: 'b', hasUnsentDraft: true, markedRemoved: false },
        { id: 'c', hasUnsentDraft: true, markedRemoved: true },
        { id: 'd', hasUnsentDraft: false, markedRemoved: false },
      ],
      new Set(['d'])
    );
    assert.deepEqual(r, { remove: ['a'], mark: ['b'] });
  });

  it('after a send the phone shows it waiting for review until the next sync', () => {
    const sub = { id: 's1', status: 'SUBMITTED' } as NeedsVerificationSubmissionDto;
    const next = dtoAfterSubmission(dto({ status: 'RETURNED', overdue: true }), sub);
    assert.equal(next.status, 'SUBMITTED');
    assert.equal(next.overdue, false);
    assert.equal(next.submission?.id, 's1');
  });
});

describe('needs verification: screen wording', () => {
  it('names the main button by what opening the form does', () => {
    assert.equal(verificationFormButton({ mode: 'START', correction: false }), 'Start the site verification');
    assert.equal(verificationFormButton({ mode: 'START', correction: true }), 'Correct and submit again');
    assert.equal(verificationFormButton({ mode: 'EDIT', draft: storedDraft('DRAFT') }), 'Continue the site verification');
    assert.equal(verificationFormButton({ mode: 'BLOCKED', title: 't', message: 'm' }), null);
  });

  it('counts located sites of the form only', () => {
    assert.equal(locatedSitesText(2, [{ siteNumber: 1 }, { siteNumber: 9 }], [1, 2]), '1 of 2 sites located');
    assert.equal(locatedSitesText(1, [{ siteNumber: 1 }], [1]), '1 of 1 site located');
  });
});
