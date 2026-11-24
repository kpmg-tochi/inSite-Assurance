/** Runs in Node. Redesign R5a (D-R5.11, D-R5.18): officer responses, check-in and starting the form. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RespondToVisitRequestSchema } from '@insite/shared';
import {
  allowedResponses,
  buildRespondRequest,
  checkInAllowed,
  commentRequired,
  formStartable,
  isValidMoveDate,
  moveDates,
  proposeDateProblem,
  responseProblem,
} from './visitResponses';
import { storedVisit, uuid } from './__fixtures__/visitFixtures';

const TODAY = '2026-11-24';
const WEEK = [1, 2, 3, 4, 5]; // Monday to Friday
const ctx = { today: TODAY, canSubmit: true, workWeekDays: WEEK };
const checkIn = {
  clientCheckInId: uuid(6),
  checkedInAt: '2026-11-26T08:00:00.000Z',
  latitude: 9,
  longitude: 7,
  accuracyMeters: 5,
  isMocked: false,
  geofenceStatus: 'INSIDE' as const,
  distanceOutsideMeters: 0,
  sent: false,
};

describe('allowed actions', () => {
  it('an unconfirmed planned visit offers all four', () => {
    assert.deepEqual(allowedResponses(storedVisit(), { canSubmit: true, workWeekDays: WEEK }), ['CONFIRM', 'MOVE', 'PROPOSE', 'DECLINE']);
  });

  it('confirmed hides Confirm, declined hides Decline', () => {
    assert.deepEqual(allowedResponses(storedVisit({ visit: { confirmation: 'CONFIRMED' } }), { canSubmit: true }), ['MOVE', 'PROPOSE', 'DECLINE']);
    assert.deepEqual(allowedResponses(storedVisit({ visit: { confirmation: 'DECLINED' } }), { canSubmit: true }), ['CONFIRM', 'MOVE', 'PROPOSE']);
  });

  it('no window (or only the current date in it) means no Move', () => {
    assert.ok(!allowedResponses(storedVisit({ moveWindow: null }), { canSubmit: true }).includes('MOVE'));
    assert.ok(!allowedResponses(storedVisit({ moveWindow: { from: '2026-11-26', to: '2026-11-26' } }), { canSubmit: true }).includes('MOVE'));
  });

  it('nothing without visits:submit, after check-in, while a response waits, or when not PLANNED', () => {
    assert.deepEqual(allowedResponses(storedVisit(), { canSubmit: false }), []);
    assert.deepEqual(allowedResponses(storedVisit({ visit: { checkInAt: '2026-11-26T08:00:00.000Z' } }), { canSubmit: true }), []);
    assert.deepEqual(allowedResponses(storedVisit({ local: { checkIn } }), { canSubmit: true }), []);
    assert.deepEqual(
      allowedResponses(storedVisit({ local: { pendingResponse: { clientActionId: uuid(1), action: 'CONFIRM', date: null, comment: null, queuedAt: '' } } }), { canSubmit: true }),
      []
    );
    for (const status of ['IN_PROGRESS', 'SUBMITTED', 'MISSED', 'CANCELLED', 'RETURNED'] as const) {
      assert.deepEqual(allowedResponses(storedVisit({ visit: { status } }), { canSubmit: true }), [], status);
    }
    assert.deepEqual(allowedResponses(storedVisit({ visit: { origin: 'UNSCHEDULED' } }), { canSubmit: true }), []);
  });
});

describe('dates', () => {
  const window = { from: '2026-11-24', to: '2026-11-30' };

  it('Move offers the window minus the current date and non-working days', () => {
    // 2026-11-28/29 are Saturday/Sunday.
    assert.deepEqual(moveDates('2026-11-26', window, WEEK), ['2026-11-24', '2026-11-25', '2026-11-27', '2026-11-30']);
    assert.equal(moveDates('2026-11-26', window).length, 6, 'without a work week every day of the window counts');
    assert.equal(isValidMoveDate('2026-11-26', window, '2026-11-28', WEEK), false);
    assert.equal(isValidMoveDate('2026-11-26', window, '2026-12-01', WEEK), false);
    assert.equal(isValidMoveDate('2026-11-26', window, '2026-11-27', WEEK), true);
  });

  it('Propose takes today or later, outside the window', () => {
    assert.equal(proposeDateProblem('2026-11-26', window, '2026-12-08', TODAY), null);
    assert.match(proposeDateProblem('2026-11-26', window, '2026-11-27', TODAY)!, /Move instead/);
    assert.match(proposeDateProblem('2026-11-26', window, '2026-11-20', TODAY)!, /today or a later/);
    assert.match(proposeDateProblem('2026-11-26', null, '2026-11-26', TODAY)!, /already on that date/);
    assert.equal(proposeDateProblem('2026-11-26', null, '2026-11-27', TODAY), null, 'without a window any later date is a proposal');
  });
});

describe('comments and requests', () => {
  it('Confirm takes an optional comment; the others need 3 characters', () => {
    assert.equal(commentRequired('CONFIRM'), false);
    const v = storedVisit();
    assert.equal(responseProblem(v, { action: 'CONFIRM' }, ctx), null);
    assert.match(responseProblem(v, { action: 'DECLINE', comment: ' a ' }, ctx)!, /at least 3/);
    assert.equal(responseProblem(v, { action: 'DECLINE', comment: 'On leave' }, ctx), null);
    assert.match(responseProblem(v, { action: 'MOVE', comment: 'Rain expected' }, ctx)!, /new date/);
    assert.match(responseProblem(v, { action: 'MOVE', date: '2026-12-10', comment: 'Rain expected' }, ctx)!, /inside the window/);
    assert.equal(responseProblem(v, { action: 'MOVE', date: '2026-11-27', comment: 'Rain expected' }, ctx), null);
    assert.equal(responseProblem(v, { action: 'PROPOSE', date: '2026-12-10', comment: 'Exams week' }, ctx), null);
    assert.match(responseProblem(storedVisit({ visit: { confirmation: 'CONFIRMED' } }), { action: 'CONFIRM' }, ctx)!, /not available/);
  });

  it('request bodies match the server schema: a date only for Move and Propose, empty comments null', () => {
    const id = uuid(77);
    const confirm = buildRespondRequest(id, { action: 'CONFIRM', date: '2026-11-27', comment: '  ' });
    assert.deepEqual(confirm, { clientActionId: id, action: 'CONFIRM', date: null, comment: null });
    assert.ok(RespondToVisitRequestSchema.safeParse(confirm).success);
    const move = buildRespondRequest(id, { action: 'MOVE', date: '2026-11-27', comment: ' Rain expected ' });
    assert.deepEqual(move, { clientActionId: id, action: 'MOVE', date: '2026-11-27', comment: 'Rain expected' });
    assert.ok(RespondToVisitRequestSchema.safeParse(move).success);
    assert.ok(RespondToVisitRequestSchema.safeParse(buildRespondRequest(id, { action: 'DECLINE', comment: 'Away' })).success);
  });
});

describe('check-in and the form', () => {
  it('check in on a planned or missed visit, once', () => {
    assert.equal(checkInAllowed(storedVisit(), true), true);
    assert.equal(checkInAllowed(storedVisit({ visit: { status: 'MISSED' } }), true), true);
    assert.equal(checkInAllowed(storedVisit(), false), false);
    assert.equal(checkInAllowed(storedVisit({ local: { checkIn } }), true), false);
    assert.equal(checkInAllowed(storedVisit({ visit: { status: 'IN_PROGRESS', checkInAt: '2026-11-26T08:00:00.000Z' } }), true), false);
    assert.equal(checkInAllowed(storedVisit({ visit: { status: 'SUBMITTED' } }), true), false);
  });

  it('the form opens after a check-in (this phone, or the server for a returned visit)', () => {
    assert.equal(formStartable(storedVisit(), true), false);
    assert.equal(formStartable(storedVisit({ local: { checkIn } }), true), true);
    assert.equal(formStartable(storedVisit({ visit: { status: 'RETURNED', checkInAt: '2026-11-26T08:00:00.000Z' } }), true), true);
    assert.equal(formStartable(storedVisit({ local: { checkIn, queuedSubmissionId: uuid(8) } }), true), false);
    assert.equal(formStartable(storedVisit({ visit: { status: 'APPROVED', checkInAt: '2026-11-26T08:00:00.000Z' } }), true), false);
  });
});
