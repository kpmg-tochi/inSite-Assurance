/** Runs in Node. The report builder produces bodies the shared contracts accept, signed consistently. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'crypto';
import {
  canonicalReportString,
  RevalidateWorkdayReportRequestSchema,
  SubmitWorkdayReportRequestSchema,
} from '@insite/shared';
import { buildRevalidateRequest, buildSubmitRequest, reportCanonical, type LocalReport } from './reportPayload';

const report: LocalReport = {
  id: crypto.randomUUID(),
  projectId: crypto.randomUUID(),
  wbsItemId: crypto.randomUUID(),
  workdayDate: '2026-11-19',
  reporterTimezone: 'Africa/Lagos',
  summaryText: 'Cast 12 m of culvert wall on Cell 1.',
  reportedQuantity: 12,
  unit: 'm3',
  isHoldPointClaimed: false,
  delaysOrBlockers: 'Cement arrived two days late.',
  captureIds: [crypto.randomUUID(), crypto.randomUUID()],
  textNotes: [{ id: crypto.randomUUID(), text: 'Cement arrived 2 days late', capturedAt: '2026-11-19T09:00:00.000Z' }],
  geotag: { latitude: 6.45, longitude: 3.57, accuracyMeters: 5, altitudeMeters: null, isMocked: false, capturedAt: '2026-11-19T16:00:00.000Z' },
  confirmedAt: '2026-11-19T16:00:05.000Z',
  signature: null,
  revisesServerReportId: null,
  reportQueryId: null,
};

describe('report payload builder', () => {
  it('builds a submission the server schema accepts, confirmed as final', () => {
    const body = buildSubmitRequest(report);
    const parsed = SubmitWorkdayReportRequestSchema.safeParse(body);
    assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
    assert.equal(body.confirmedAsFinal, true);
    assert.equal(body.clientReportId, report.id);
    assert.deepEqual(body.clientCaptureIds, report.captureIds);
  });

  it('builds a revision the server schema accepts with every confirmed value explicit', () => {
    const revision = { ...report, revisesServerReportId: crypto.randomUUID(), reportQueryId: crypto.randomUUID() };
    const body = buildRevalidateRequest(revision);
    const parsed = RevalidateWorkdayReportRequestSchema.safeParse(body);
    assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
    assert.equal(body.summaryText, report.summaryText);
    assert.equal(body.reportedQuantity, report.reportedQuantity);
    assert.equal(body.reportQueryId, revision.reportQueryId);
  });

  it('signs the same canonical string the server rebuilds from the request', () => {
    const body = buildSubmitRequest(report);
    const serverSide = canonicalReportString({
      clientReportId: body.clientReportId,
      projectId: report.projectId,
      wbsItemId: body.wbsItemId,
      workdayDate: body.workdayDate,
      summaryText: body.summaryText,
      reportedQuantity: body.reportedQuantity,
      unitOfMeasure: body.unitOfMeasure,
      isHoldPointClaimed: body.isHoldPointClaimed,
      clientCaptureIds: [...body.clientCaptureIds].reverse(),
      confirmedAt: body.confirmedAt,
    });
    assert.equal(reportCanonical(report), serverSide);
  });
});
