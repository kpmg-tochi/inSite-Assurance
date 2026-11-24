/** Runs in Node. Redesign R5a: calendar model, download window and what a visit shows (D-R5.4, D-R5.5). */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  addMonths,
  dotsByDay,
  groupVisitsByDay,
  monthGrid,
  monthRange,
  projectToday,
  rangeInWindow,
  syncWindow,
  visitsNeedingAttention,
  visitView,
  weekDates,
} from './visitCalendar';
import { storedVisit, uuid } from './__fixtures__/visitFixtures';

const TODAY = '2026-11-24'; // a Tuesday

describe('dates', () => {
  it('weeks start on Monday', () => {
    const w = weekDates(TODAY);
    assert.equal(w.length, 7);
    assert.equal(w[0], '2026-11-23');
    assert.equal(w[6], '2026-11-29');
    assert.deepEqual(weekDates('2026-11-29'), w, 'Sunday belongs to the week before');
  });

  it('month grids are whole Monday-first weeks covering the month', () => {
    const grid = monthGrid('2026-11');
    assert.equal(grid[0][0].date, '2026-10-26');
    assert.equal(grid[0][0].inMonth, false);
    assert.equal(grid[0][6].date, '2026-11-01');
    assert.equal(grid[grid.length - 1][6].date, '2026-12-06');
    assert.equal(grid.flat().filter((d) => d.inMonth).length, 30);
    assert.ok(grid.every((w) => w.length === 7));
    // February 2027 starts on a Monday and has 4 weeks exactly.
    assert.equal(monthGrid('2027-02').length, 4);
  });

  it('months move across years', () => {
    assert.equal(addMonths('2026-11', 2), '2027-01');
    assert.equal(addMonths('2027-01', -1), '2026-12');
    assert.deepEqual(monthRange('2028-02'), { from: '2028-02-01', to: '2028-02-29' });
  });

  it('today is the project zone date', () => {
    const now = new Date('2026-11-24T23:30:00.000Z');
    assert.equal(projectToday('Africa/Lagos', now), '2026-11-25');
    assert.equal(projectToday('UTC', now), '2026-11-24');
    assert.equal(projectToday(null, now), '2026-11-24');
  });

  it('the download window is today − 30 … today + 14', () => {
    const w = syncWindow(TODAY);
    assert.deepEqual(w, { from: '2026-10-25', to: '2026-12-08' });
    assert.equal(rangeInWindow({ from: '2026-11-01', to: '2026-11-30' }, w), true);
    assert.equal(rangeInWindow({ from: '2026-12-01', to: '2026-12-31' }, w), false);
    assert.equal(rangeInWindow({ from: '2026-11-01', to: '2026-11-30' }, null), false);
  });
});

describe('visitView', () => {
  it('a planned visit ahead is a planned dot', () => {
    const v = visitView(storedVisit(), TODAY);
    assert.equal(v.dot, 'PLANNED');
    assert.equal(v.overdue, false);
    assert.equal(v.waitingToSend, false);
    assert.equal(v.kindLabel, 'Routine');
  });

  it('a planned visit whose date passed is overdue even before the server says MISSED (offline)', () => {
    const v = visitView(storedVisit({ visit: { plannedDate: '2026-11-20', originalPlannedDate: '2026-11-20' } }), TODAY);
    assert.equal(v.overdue, true);
    assert.equal(v.dot, 'OVERDUE');
    const missed = visitView(storedVisit({ visit: { status: 'MISSED', plannedDate: '2026-11-20' } }), TODAY);
    assert.equal(missed.dot, 'OVERDUE');
  });

  it('submitted, approved or queued on the phone is done', () => {
    assert.equal(visitView(storedVisit({ visit: { status: 'SUBMITTED' } }), TODAY).dot, 'DONE');
    assert.equal(visitView(storedVisit({ visit: { status: 'APPROVED', plannedDate: '2026-11-01' } }), TODAY).overdue, false);
    const queued = visitView(storedVisit({ visit: { status: 'IN_PROGRESS', plannedDate: '2026-11-20' }, local: { queuedSubmissionId: uuid(9) } }), TODAY);
    assert.equal(queued.dot, 'DONE');
    assert.equal(queued.overdue, false);
    assert.equal(queued.waitingToSend, true);
  });

  it('returned for correction needs attention; cancelled has no dot', () => {
    const r = visitView(storedVisit({ visit: { status: 'RETURNED' } }), TODAY);
    assert.equal(r.returned, true);
    assert.equal(r.dot, 'OVERDUE');
    assert.equal(visitView(storedVisit({ visit: { status: 'CANCELLED' } }), TODAY).dot, null);
  });

  it('an unsent Move shows the new date, marked pending; a Propose keeps the date', () => {
    const moved = visitView(
      storedVisit({ local: { pendingResponse: { clientActionId: uuid(5), action: 'MOVE', date: '2026-11-27', comment: 'Rain', queuedAt: '' } } }),
      TODAY
    );
    assert.equal(moved.date, '2026-11-27');
    assert.equal(moved.datePending, true);
    assert.equal(moved.waitingToSend, true);
    assert.equal(moved.confirmation, 'CONFIRMED');
    const proposed = visitView(
      storedVisit({ local: { pendingResponse: { clientActionId: uuid(5), action: 'PROPOSE', date: '2026-12-10', comment: 'Exams', queuedAt: '' } } }),
      TODAY
    );
    assert.equal(proposed.date, '2026-11-26');
    assert.equal(proposed.proposedDate, '2026-12-10');
    const declined = visitView(storedVisit({ local: { pendingResponse: { clientActionId: uuid(5), action: 'DECLINE', date: null, comment: 'Away', queuedAt: '' } } }), TODAY);
    assert.equal(declined.confirmation, 'DECLINED');
    assert.equal(declined.confirmationPending, true);
  });

  it('an unsent check-in or unscheduled visit is waiting to send', () => {
    const checkIn = {
      clientCheckInId: uuid(6),
      checkedInAt: '',
      latitude: null,
      longitude: null,
      accuracyMeters: null,
      isMocked: false,
      geofenceStatus: null,
      distanceOutsideMeters: null,
      sent: false,
    };
    const v = visitView(storedVisit({ local: { checkIn } }), TODAY);
    assert.equal(v.waitingToSend, true);
    assert.equal(v.checkedIn, true);
    assert.equal(visitView(storedVisit({ local: { checkIn: { ...checkIn, sent: true } } }), TODAY).waitingToSend, false);
    assert.equal(visitView(storedVisit({ isLocal: true, serverId: null, visit: { origin: 'UNSCHEDULED' } }), TODAY).waitingToSend, true);
  });
});

describe('grouping and dots', () => {
  const a = visitView(storedVisit({ visit: { id: uuid(101), plannedDate: '2026-11-26' } }), TODAY);
  const b = visitView(storedVisit({ visit: { id: uuid(102), plannedDate: '2026-11-26', status: 'SUBMITTED' } }), TODAY);
  const c = visitView(storedVisit({ visit: { id: uuid(103), plannedDate: '2026-11-20' } }), TODAY);
  const d = visitView(storedVisit({ visit: { id: uuid(104), plannedDate: '2026-11-26', status: 'CANCELLED' } }), TODAY);

  it('groups by shown date and leaves cancelled visits out', () => {
    const g = groupVisitsByDay([a, b, c, d]);
    assert.deepEqual([...g.keys()], ['2026-11-20', '2026-11-26']);
    assert.equal(g.get('2026-11-26')!.length, 2);
  });

  it('one dot per kind per day, overdue first', () => {
    const dots = dotsByDay([a, b, c, d]);
    assert.deepEqual(dots.get('2026-11-26'), ['PLANNED', 'DONE']);
    assert.deepEqual(dots.get('2026-11-20'), ['OVERDUE']);
  });

  it('lists what needs attention, oldest first', () => {
    assert.deepEqual(visitsNeedingAttention([a, b, c]).map((v) => v.id), [uuid(103)]);
  });
});
