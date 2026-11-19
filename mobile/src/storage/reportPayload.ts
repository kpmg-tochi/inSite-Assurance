import {
  canonicalReportString,
  type RevalidateWorkdayReportRequest,
  type SubmissionGeotagInput,
  type SubmitWorkdayReportRequest,
  type WorkdayTextNote,
} from '@insite/shared';

/**
 * The single builder for workday report request bodies (pure; tested in Node). Replaces the three
 * copies of the payload builder the app had before Phase 4.
 */

export interface LocalReport {
  /** clientReportId */
  id: string;
  projectId: string;
  wbsItemId: string;
  workdayDate: string;
  reporterTimezone: string;
  summaryText: string;
  reportedQuantity: number;
  unit: string;
  isHoldPointClaimed: boolean;
  delaysOrBlockers: string | null;
  captureIds: string[];
  textNotes: WorkdayTextNote[];
  /** Required: every report carries the position at confirmation. */
  geotag: SubmissionGeotagInput;
  confirmedAt: string;
  signature: string | null;
  /** Set for a revision answering a query. */
  revisesServerReportId: string | null;
  reportQueryId: string | null;
}

/** The exact string the device signs when the reporter confirms. */
export function reportCanonical(r: LocalReport): string {
  return canonicalReportString({
    clientReportId: r.id,
    projectId: r.projectId,
    wbsItemId: r.wbsItemId,
    workdayDate: r.workdayDate,
    summaryText: r.summaryText,
    reportedQuantity: r.reportedQuantity,
    unitOfMeasure: r.unit,
    isHoldPointClaimed: r.isHoldPointClaimed,
    clientCaptureIds: r.captureIds,
    confirmedAt: r.confirmedAt,
  });
}

export function buildSubmitRequest(r: LocalReport): SubmitWorkdayReportRequest {
  return {
    clientReportId: r.id,
    wbsItemId: r.wbsItemId,
    workdayDate: r.workdayDate,
    reporterTimezone: r.reporterTimezone,
    summaryText: r.summaryText,
    reportedQuantity: r.reportedQuantity,
    unitOfMeasure: r.unit,
    isHoldPointClaimed: r.isHoldPointClaimed,
    delaysOrBlockers: r.delaysOrBlockers,
    clientCaptureIds: r.captureIds,
    textNotes: r.textNotes,
    submissionGeotag: r.geotag,
    confirmedAt: r.confirmedAt,
    confirmedAsFinal: true,
    signature: r.signature,
  };
}

/**
 * A revision sends every confirmed value explicitly (the reporter saw and confirmed them), so the
 * signed fields match what the server stores.
 */
export function buildRevalidateRequest(r: LocalReport): RevalidateWorkdayReportRequest {
  return {
    clientReportId: r.id,
    reportQueryId: r.reportQueryId ?? undefined,
    reporterTimezone: r.reporterTimezone,
    summaryText: r.summaryText,
    reportedQuantity: r.reportedQuantity,
    unitOfMeasure: r.unit,
    isHoldPointClaimed: r.isHoldPointClaimed,
    delaysOrBlockers: r.delaysOrBlockers,
    clientCaptureIds: r.captureIds,
    textNotes: r.textNotes,
    submissionGeotag: r.geotag,
    confirmedAt: r.confirmedAt,
    confirmedAsFinal: true,
    signature: r.signature,
  };
}
