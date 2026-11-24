/** Runs in Node. Redesign R5b: display text for visits, calendar days and sprints. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { visitView } from './visitCalendar';
import { dayAccessibilityLabel, formatDay, formatLongDay, greeting, monthTitle, siteLogStateBadge, visitBadges } from './visitText';
import { storedVisit } from './__fixtures__/visitFixtures';

const TODAY = '2026-11-24'; // a Tuesday

describe('dates as text', () => {
  it('formats calendar dates without a time zone shift', () => {
    assert.equal(formatDay('2026-11-24'), 'Tue 24 Nov');
    assert.equal(formatDay('2026-11-29', true), 'Sun 29 Nov 2026');
    assert.equal(formatLongDay('2026-12-01'), 'Tuesday 1 December 2026');
    assert.equal(monthTitle('2027-01'), 'January 2027');
  });

  it('greets by the hour', () => {
    assert.equal(greeting(7), 'Good morning');
    assert.equal(greeting(13), 'Good afternoon');
    assert.equal(greeting(19), 'Good evening');
  });

  it('calendar days say today, selection and their visit states in words', () => {
    assert.equal(
      dayAccessibilityLabel(TODAY, { today: TODAY, dots: ['OVERDUE', 'PLANNED'], selected: true }),
      'Tuesday 24 November 2026, today, selected, visits: overdue, planned'
    );
    assert.equal(dayAccessibilityLabel('2026-11-25', { today: TODAY, dots: [], selected: false }), 'Wednesday 25 November 2026, no visits');
  });
});

describe('visit badges (state as text)', () => {
  const texts = (v: ReturnType<typeof visitView>) => visitBadges(v).map((b) => b.text);

  it('an unconfirmed planned visit', () => {
    assert.deepEqual(texts(visitView(storedVisit(), TODAY)), ['Not confirmed']);
  });

  it('an unsent Confirm shows confirmed and waiting to send', () => {
    const v = storedVisit({ local: { pendingResponse: { clientActionId: 'x', action: 'CONFIRM', date: null, comment: null, queuedAt: TODAY } } });
    assert.deepEqual(texts(visitView(v, TODAY)), ['Confirmed', 'Waiting to send']);
  });

  it('an unsent Move shows the new date as pending', () => {
    const v = storedVisit({ local: { pendingResponse: { clientActionId: 'x', action: 'MOVE', date: '2026-11-27', comment: 'Rain', queuedAt: TODAY } } });
    assert.deepEqual(texts(visitView(v, TODAY)), ['Confirmed', 'Moving to Fri 27 Nov', 'Waiting to send']);
  });

  it('a proposal keeps the date and says the manager decides', () => {
    const v = storedVisit({ visit: { pendingProposal: { id: 'p', toDate: '2026-12-10', comment: 'Away', byName: 'Officer' } } });
    assert.deepEqual(texts(visitView(v, TODAY)), ['Not confirmed', 'Proposed Thu 10 Dec, waiting for the manager']);
  });

  it('overdue, returned, submitted and accepted visits', () => {
    assert.equal(texts(visitView(storedVisit({ visit: { plannedDate: '2026-11-20' } }), TODAY))[0], 'Overdue');
    assert.equal(texts(visitView(storedVisit({ visit: { status: 'MISSED', plannedDate: '2026-11-20' } }), TODAY))[0], 'Missed');
    assert.equal(texts(visitView(storedVisit({ visit: { status: 'RETURNED' } }), TODAY))[0], 'Returned for correction');
    assert.equal(texts(visitView(storedVisit({ visit: { status: 'SUBMITTED' } }), TODAY))[0], 'Awaiting approval');
    assert.equal(texts(visitView(storedVisit({ visit: { status: 'APPROVED' } }), TODAY))[0], 'Accepted');
    assert.deepEqual(texts(visitView(storedVisit({ local: { queuedSubmissionId: 'd' } }), TODAY)), ['Report saved', 'Waiting to send']);
  });

  it('a checked-in visit and a cancelled one', () => {
    assert.equal(texts(visitView(storedVisit({ visit: { checkInAt: '2026-11-24T08:00:00Z', status: 'IN_PROGRESS' } }), TODAY))[0], 'Checked in');
    assert.deepEqual(texts(visitView(storedVisit({ visit: { status: 'CANCELLED' } }), TODAY)), ['Cancelled']);
  });
});

describe('site log upload state (D-R5.22)', () => {
  it('reads the entry first, then its outbox row', () => {
    assert.equal(siteLogStateBadge({ status: 'MOVED_TO_FORM', attachedSubmissionId: null }, null).text, 'Used in a visit report');
    assert.equal(siteLogStateBadge({ status: 'SENT', attachedSubmissionId: null }, { status: 'DONE', lastError: null }).text, 'Sent');
    assert.equal(siteLogStateBadge({ status: 'SENT', attachedSubmissionId: 'x' }, null).text, 'Sent, attached to a report');
    assert.equal(siteLogStateBadge({ status: 'QUEUED', attachedSubmissionId: null }, { status: 'PENDING', lastError: null }).text, 'Waiting to send');
    assert.equal(siteLogStateBadge({ status: 'QUEUED', attachedSubmissionId: null }, { status: 'DEAD', lastError: 'Too big' }).text, 'Not sent: Too big');
    assert.equal(siteLogStateBadge({ status: 'QUEUED', attachedSubmissionId: null }, { status: 'PENDING', lastError: 'offline' }).tone, 'warning');
  });
});
