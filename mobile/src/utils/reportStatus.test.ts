import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { WorkdayReportStatusEnum } from '@insite/shared';
import { reportQueryLabel, reportStatusView } from './reportStatus';

describe('report status view', () => {
  it('shows each server status honestly', () => {
    assert.equal(reportStatusView('PENDING_APPROVAL', 'SENT').label, 'Awaiting approval');
    assert.equal(reportStatusView('APPROVED_COMPLETED', 'SENT').label, 'Approved');
    assert.equal(reportStatusView('RETURNED_FOR_REVISION', 'SENT').label, 'Returned for revision');
    assert.equal(reportStatusView('RETURNED_FOR_REVISION', 'SENT').needsAction, true);
    assert.equal(reportStatusView('CONFIRMED', 'SENT').label, 'Confirmed');
    assert.equal(reportStatusView('STAGED_UNVERIFIED', 'SENT').label, 'Held until identity approval');
  });

  it('has a specific label for every status in the shared enum', () => {
    for (const status of WorkdayReportStatusEnum.options) {
      assert.notEqual(reportStatusView(status, 'SENT').label, 'Sent', status);
    }
  });

  it('never shows an unknown or missing status as accepted', () => {
    for (const status of ['SOMETHING_NEW', '', null, undefined]) {
      const view = reportStatusView(status, 'SENT');
      assert.equal(view.label, 'Sent');
      assert.notEqual(view.variant, 'positive');
    }
    assert.equal(reportStatusView('SOMETHING_NEW', 'QUEUED').label, 'Sent');
  });

  it('a report not sent yet says so', () => {
    assert.equal(reportStatusView(null, 'QUEUED').label, 'Waiting to send');
  });

  it('a report the server refused for good says it was not sent', () => {
    const view = reportStatusView(null, 'FAILED');
    assert.equal(view.label, 'Not sent');
    assert.equal(view.variant, 'negative');
  });
});

describe('report query label', () => {
  it('keeps the three sources apart', () => {
    assert.equal(reportQueryLabel('AI_STANDARDS_CHECK', 'AI_QUERY'), 'Standards check');
    assert.equal(reportQueryLabel('AI_OMISSION_CHECK', 'AI_QUERY'), 'Missing evidence check');
    assert.equal(reportQueryLabel('MONITOR', 'MONITOR_QUERY'), 'Monitor query');
  });

  it('falls back on the message type for cached messages without details', () => {
    assert.equal(reportQueryLabel(undefined, 'AI_QUERY'), 'Missing evidence check');
    assert.equal(reportQueryLabel(null, 'MONITOR_QUERY'), 'Monitor query');
    assert.equal(reportQueryLabel(undefined, undefined), 'Query');
  });
});
