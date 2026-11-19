import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import {
  calendarDateInTimeZone,
  canonicalReportString,
  isValidTimeZone,
  REPORT_LOW_GPS_ACCURACY_METERS,
  RevalidateWorkdayReportRequest,
  SubmissionGeotag,
  SubmissionGeotagInput,
  SubmitWorkdayReportRequest,
  SuggestWorkdaySummaryRequest,
  SuggestWorkdaySummaryResponse,
  WorkdayReportCaptureSummary,
  WorkdayReportDto,
  WorkdayTextNote,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { env } from '../../config/env';
import { AppError } from '../../middleware/error.middleware';
import { FieldAgentJwtPayload } from '../../middleware/auth.middleware';
import { azureOpenAiService } from '../../integrations/azure-openai.service';
import { whisperService } from '../../integrations/whisper.service';
import { storageService } from '../../integrations/storage.service';
import { recordAuditEvent } from '../audit/audit.service';
import { createWebNotification } from '../notifications/notifications.service';
import { serializeReportQuery } from '../wbs-chat/wbsChat.service';
import { loadBoqItemInProject, loadReportQueryInProject } from '../../utils/ownership';
import { evaluateGeofence } from '../../utils/geofenceEvaluation';
import { verifyDeviceSignature } from '../../utils/deviceSignature';
import { serializeCapture } from '../../utils/serializers';
import { scheduleAiOmissionCheck } from './aiOmissionCheck';

type Tx = Prisma.TransactionClient;

const REPORT_INCLUDE = {
  boqItem: { select: { wbsCode: true, description: true } },
  reporterSession: { select: { agentFullName: true, roleNameSnapshot: true } },
  captures: { include: { mediaAttachments: true }, orderBy: { capturedAtDevice: 'asc' } },
} satisfies Prisma.WorkdayReportInclude;

const REPORT_INCLUDE_WITH_QUERIES = {
  ...REPORT_INCLUDE,
  queries: {
    include: { raisedByUser: { select: { fullName: true } } },
    orderBy: { createdAt: 'desc' },
  },
} satisfies Prisma.WorkdayReportInclude;

type ReportRow = Prisma.WorkdayReportGetPayload<{ include: typeof REPORT_INCLUDE }> & {
  queries?: Array<Parameters<typeof serializeReportQuery>[0]>;
};

function asTextNotes(raw: unknown): WorkdayTextNote[] {
  return Array.isArray(raw) ? (raw as WorkdayTextNote[]) : [];
}

function toCaptureSummary(c: ReportRow['captures'][number]): WorkdayReportCaptureSummary {
  const full = serializeCapture(c);
  return {
    id: full.id,
    clientCaptureId: full.clientCaptureId,
    mediaType: full.mediaType,
    objectKey: full.objectKey,
    mimeType: full.mimeType,
    caption: full.caption,
    capturedAt: full.capturedAt,
    locationAvailable: full.locationAvailable,
    latitude: full.latitude,
    longitude: full.longitude,
    gpsAccuracyMeters: full.gpsAccuracyMeters,
    isMockLocation: full.isMockLocation,
    isWithinGeofence: full.isWithinGeofence,
    chainageLabel: full.chainageLabel,
    signatureVerified: full.signatureVerified,
    integrityPassed: full.integrityPassed,
    integrityFlags: full.integrityFlags,
    transcriptionStatus: full.transcriptionStatus,
    transcript: full.transcript,
    durationSeconds: full.durationSeconds,
  };
}

export function serializeWorkdayReport(r: ReportRow, extra: { idempotentReplay?: boolean } = {}): WorkdayReportDto {
  return {
    id: r.id,
    clientReportId: r.clientReportId,
    projectId: r.projectId,
    reporterSessionId: r.reporterSessionId,
    reporterName: r.reporterSession.agentFullName,
    reporterTier: r.reporterSession.roleNameSnapshot,
    wbsItemId: r.wbsItemId,
    wbsCode: r.boqItem.wbsCode,
    wbsDescription: r.boqItem.description,
    workdayDate: r.workdayDate,
    reporterTimezone: r.reporterTimezone,
    status: r.status,
    revisionNumber: r.revisionNumber,
    parentReportId: r.parentReportId,
    resolvedQueryId: r.resolvedQueryId,
    summaryText: r.summaryText,
    reportedQuantity: Number(r.reportedQuantity),
    unitOfMeasure: r.unitOfMeasure,
    isHoldPointClaimed: r.isHoldPointClaimed,
    delaysOrBlockers: r.delaysOrBlockers,
    textNotes: asTextNotes(r.textNotes),
    captures: r.captures.map(toCaptureSummary),
    submissionGeotag: (r.submissionGeotag as SubmissionGeotag | null) ?? null,
    integrityFlags: Array.isArray(r.integrityFlags) ? (r.integrityFlags as string[]) : [],
    signatureVerified: r.signatureVerified,
    aiCheckStatus: r.aiCheckStatus,
    aiCheckEngine: r.aiCheckEngine,
    aiReasoning: r.aiReasoning,
    humanConfirmedAt: r.humanConfirmedAt?.toISOString() ?? null,
    releasedAt: r.releasedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
    queries: r.queries ? r.queries.map(serializeReportQuery) : [],
    ...(extra.idempotentReplay ? { idempotentReplay: true } : {}),
  };
}

export type SubmitResult = { report: WorkdayReportDto; created: boolean };

/** Returns the earlier report for this clientReportId, or null. Another session's ID is a conflict. */
async function findReportForReplay(clientReportId: string, sessionId: string): Promise<WorkdayReportDto | null> {
  const existing = await prisma.workdayReport.findUnique({
    where: { clientReportId },
    include: REPORT_INCLUDE_WITH_QUERIES,
  });
  if (!existing) return null;
  if (existing.reporterSessionId !== sessionId) {
    throw new AppError('This report ID is already in use', 409, 'REPORT_ID_CONFLICT');
  }
  return serializeWorkdayReport(existing, { idempotentReplay: true });
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function evaluateGeotag(input: SubmissionGeotagInput | null | undefined, geofenceGeoJson: unknown): SubmissionGeotag | null {
  if (!input) return null;
  const evaluation = evaluateGeofence(geofenceGeoJson, input);
  return {
    latitude: input.latitude,
    longitude: input.longitude,
    accuracyMeters: input.accuracyMeters ?? null,
    altitudeMeters: input.altitudeMeters ?? null,
    isMocked: input.isMocked,
    capturedAt: input.capturedAt,
    isWithinGeofence: evaluation.isWithinGeofence,
    chainageLabel: evaluation.chainageLabel,
    distanceFromSiteMeters: evaluation.distanceFromSiteMeters,
  };
}

/**
 * Loads the captures the report references. Every one must be registered by this reporter in this
 * project, unlinked, and either untagged or tagged to the same WBS item. Missing captures are a
 * retryable 409: the device sends captures before the report that references them.
 */
async function loadLinkableCaptures(params: {
  projectId: string;
  sessionId: string;
  wbsItemId: string;
  clientCaptureIds: string[];
}) {
  const ids = [...new Set(params.clientCaptureIds)];
  if (ids.length === 0) return [];
  const captures = await prisma.fieldEvidenceLog.findMany({
    where: { clientCaptureId: { in: ids } },
    select: { id: true, clientCaptureId: true, projectId: true, fieldSessionId: true, boqItemId: true, workdayReportId: true },
  });
  const found = new Map(captures.map((c) => [c.clientCaptureId, c]));
  const missing = ids.filter((id) => !found.has(id));
  if (missing.length > 0) {
    throw new AppError('Some captures are not registered yet', 409, 'CAPTURES_NOT_REGISTERED', {
      missingClientCaptureIds: missing,
    });
  }
  for (const c of captures) {
    if (c.projectId !== params.projectId || c.fieldSessionId !== params.sessionId) {
      throw new AppError('A capture does not belong to this reporter', 403, 'CAPTURE_NOT_OWNED');
    }
    if (c.workdayReportId) {
      throw new AppError('A capture is already linked to another report', 409, 'CAPTURE_ALREADY_LINKED', {
        clientCaptureId: c.clientCaptureId,
      });
    }
    if (c.boqItemId && c.boqItemId !== params.wbsItemId) {
      throw new AppError('A capture was taken for a different WBS item', 400, 'CAPTURE_WBS_MISMATCH', {
        clientCaptureId: c.clientCaptureId,
      });
    }
  }
  return captures;
}

async function linkCaptures(tx: Tx, reportId: string, wbsItemId: string, captureIds: string[]) {
  if (captureIds.length === 0) return;
  const linked = await tx.fieldEvidenceLog.updateMany({
    where: { id: { in: captureIds }, workdayReportId: null },
    data: { workdayReportId: reportId, boqItemId: wbsItemId },
  });
  if (linked.count !== captureIds.length) {
    throw new AppError('A capture is already linked to another report', 409, 'CAPTURE_ALREADY_LINKED');
  }
}

async function recordReportPing(
  tx: Tx,
  params: { projectId: string; sessionId: string; wbsItemId: string; geotag: SubmissionGeotag | null }
) {
  if (!params.geotag) return;
  await tx.siteTelemetryPing.create({
    data: {
      clientPingId: crypto.randomUUID(),
      projectId: params.projectId,
      fieldSessionId: params.sessionId,
      wbsItemId: params.wbsItemId,
      latitude: params.geotag.latitude,
      longitude: params.geotag.longitude,
      accuracyMeters: params.geotag.accuracyMeters ?? null,
      altitudeMeters: params.geotag.altitudeMeters ?? null,
      isMocked: params.geotag.isMocked,
      isWithinGeofence: params.geotag.isWithinGeofence,
      chainageLabel: params.geotag.chainageLabel,
      distanceMeters: params.geotag.distanceFromSiteMeters,
      pingSource: 'REPORT_SUBMISSION',
      capturedAtDevice: new Date(params.geotag.capturedAt),
    },
  });
}

/** Badges for the report itself: location quality and the device signature result. */
function reportFlags(geotag: SubmissionGeotag, signatureFlag: string | null): string[] {
  const flags: string[] = [];
  if (geotag.isMocked) flags.push('MOCK_GPS_LOCATION_DETECTED');
  if (geotag.isWithinGeofence === false) flags.push('OUTSIDE_PROJECT_GEOFENCE');
  if (geotag.isWithinGeofence === null) flags.push('GEOFENCE_UNAVAILABLE');
  if (geotag.accuracyMeters == null) flags.push('GPS_ACCURACY_UNKNOWN');
  else if (geotag.accuracyMeters > REPORT_LOW_GPS_ACCURACY_METERS) flags.push('LOW_GPS_ACCURACY');
  if (signatureFlag) flags.push(signatureFlag);
  return flags;
}

const MAX_FUTURE_CONFIRMATION_MS = 15 * 60 * 1000;

/**
 * Safeguard on the reporting day: it must be the date of `confirmedAt` in the project's time zone,
 * so the one-report-per-day rule means the same day for every reporter on the project.
 */
function assertReportingDay(input: { workdayDate: string; confirmedAt: string }, projectTimezone: string) {
  const confirmed = new Date(input.confirmedAt);
  if (confirmed.getTime() - Date.now() > MAX_FUTURE_CONFIRMATION_MS) {
    throw new AppError('The report is dated in the future. Check the phone clock.', 400, 'CONFIRMED_AT_IN_FUTURE');
  }
  const expected = calendarDateInTimeZone(confirmed, projectTimezone);
  if (input.workdayDate !== expected) {
    throw new AppError(
      `The reporting day must be ${expected} (project time zone ${projectTimezone}).`,
      400,
      'WORKDAY_DATE_MISMATCH',
      { expectedWorkdayDate: expected, projectTimezone }
    );
  }
}

async function loadSessionForReport(sessionId: string) {
  return prisma.fieldAgentSession.findUniqueOrThrow({
    where: { id: sessionId },
    select: {
      assuranceStatus: true,
      agentFullName: true,
      devicePublicKey: true,
      devicePublicKeyAlg: true,
    },
  });
}

function assertTimezone(tz: string) {
  if (!isValidTimeZone(tz)) {
    throw new AppError('reporterTimezone must be an IANA time zone, e.g. Africa/Lagos', 400, 'INVALID_TIMEZONE');
  }
}

/**
 * POST /projects/:projectId/workday-reports
 *
 * Idempotent on clientReportId. The assurance gate is enforced here: a reporter whose identity is
 * not approved gets STAGED_UNVERIFIED and no AI call; the server releases the report on approval.
 * The omission check runs after the response.
 */
export async function submitWorkdayReport(params: {
  projectId: string;
  fieldAgent: FieldAgentJwtPayload;
  input: SubmitWorkdayReportRequest;
}): Promise<SubmitResult> {
  const { projectId, fieldAgent, input } = params;

  const replay = await findReportForReplay(input.clientReportId, fieldAgent.sessionId);
  if (replay) return { report: replay, created: false };

  assertTimezone(input.reporterTimezone);
  const [project, boqItem, session] = await Promise.all([
    prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { geofenceGeoJson: true, timezone: true } }),
    loadBoqItemInProject(prisma, projectId, input.wbsItemId),
    loadSessionForReport(fieldAgent.sessionId),
  ]);
  if (input.isHoldPointClaimed && !boqItem.isHoldPoint) {
    throw new AppError('This WBS item is not a hold point', 400, 'HOLD_POINT_NOT_APPLICABLE');
  }
  assertReportingDay(input, project.timezone);
  await assertNoReportForPeriod({
    projectId,
    sessionId: fieldAgent.sessionId,
    wbsItemId: input.wbsItemId,
    workdayDate: input.workdayDate,
  });

  const captures = await loadLinkableCaptures({
    projectId,
    sessionId: fieldAgent.sessionId,
    wbsItemId: input.wbsItemId,
    clientCaptureIds: input.clientCaptureIds,
  });
  const geotag = evaluateGeotag(input.submissionGeotag, project.geofenceGeoJson);
  const signature = verifyDeviceSignature({
    publicKey: session.devicePublicKey,
    alg: session.devicePublicKeyAlg,
    signature: input.signature,
    message: canonicalReportString({
      clientReportId: input.clientReportId,
      projectId,
      wbsItemId: input.wbsItemId,
      workdayDate: input.workdayDate,
      summaryText: input.summaryText,
      reportedQuantity: input.reportedQuantity,
      unitOfMeasure: input.unitOfMeasure,
      isHoldPointClaimed: input.isHoldPointClaimed,
      clientCaptureIds: input.clientCaptureIds,
      confirmedAt: input.confirmedAt,
    }),
  });

  const approved = session.assuranceStatus === 'APPROVED';
  const flags = reportFlags(geotag!, signature.flag);

  let created: ReportRow;
  try {
    created = await prisma.$transaction(async (tx) => {
      const report = await tx.workdayReport.create({
        data: {
          clientReportId: input.clientReportId,
          projectId,
          reporterSessionId: fieldAgent.sessionId,
          wbsItemId: input.wbsItemId,
          workdayDate: input.workdayDate,
          reporterTimezone: input.reporterTimezone,
          status: approved ? 'CONFIRMED' : 'STAGED_UNVERIFIED',
          revisionNumber: 1,
          summaryText: input.summaryText,
          reportedQuantity: input.reportedQuantity,
          unitOfMeasure: input.unitOfMeasure,
          isHoldPointClaimed: input.isHoldPointClaimed,
          delaysOrBlockers: input.delaysOrBlockers ?? null,
          textNotes: input.textNotes as unknown as Prisma.InputJsonValue,
          submissionGeotag: geotag as unknown as Prisma.InputJsonValue,
          deviceSignature: input.signature ?? null,
          signatureVerified: signature.verified,
          integrityFlags: flags as unknown as Prisma.InputJsonValue,
          aiCheckStatus: approved ? 'PENDING' : 'SKIPPED',
          humanConfirmedAt: new Date(input.confirmedAt),
        },
      });
      await linkCaptures(tx, report.id, input.wbsItemId, captures.map((c) => c.id));
      await recordReportPing(tx, { projectId, sessionId: fieldAgent.sessionId, wbsItemId: input.wbsItemId, geotag });

      await recordAuditEvent(tx, {
        projectId,
        actorType: 'FIELD_AGENT',
        actorId: fieldAgent.sessionId,
        actorDisplayName: `${fieldAgent.agentFullName} (${fieldAgent.roleName})`,
        action: 'WORKDAY_REPORT_SUBMITTED',
        summaryText: approved
          ? `Submitted WBS ${boqItem.wbsCode} report for ${input.workdayDate} (${input.reportedQuantity} ${input.unitOfMeasure}, ${captures.length} capture(s)).`
          : `Staged WBS ${boqItem.wbsCode} report for ${input.workdayDate}; reporter identity not yet approved.`,
        payload: {
          workdayReportId: report.id,
          clientReportId: input.clientReportId,
          wbsCode: boqItem.wbsCode,
          status: report.status,
          captureCount: captures.length,
          flags,
          signatureVerified: signature.verified,
        },
      });

      return tx.workdayReport.findUniqueOrThrow({ where: { id: report.id }, include: REPORT_INCLUDE });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const again = await findReportForReplay(input.clientReportId, fieldAgent.sessionId);
      if (again) return { report: again, created: false };
      // A concurrent submission for the same period won the race (partial unique index).
      await assertNoReportForPeriod({
        projectId,
        sessionId: fieldAgent.sessionId,
        wbsItemId: input.wbsItemId,
        workdayDate: input.workdayDate,
      });
    }
    throw error;
  }

  if (created.aiCheckStatus === 'PENDING') scheduleAiOmissionCheck(created.id);
  return { report: serializeWorkdayReport(created), created: true };
}

/**
 * One report per reporter, WBS item and period (owner rule, 2026-11-19). Evidence is added to the
 * WBS thread during the period; the report is submitted once at the end. A change after that is a
 * revision answering a query, never a second report.
 */
async function assertNoReportForPeriod(params: {
  projectId: string;
  sessionId: string;
  wbsItemId: string;
  workdayDate: string;
}) {
  const existing = await prisma.workdayReport.findFirst({
    where: {
      projectId: params.projectId,
      reporterSessionId: params.sessionId,
      wbsItemId: params.wbsItemId,
      workdayDate: params.workdayDate,
      parentReportId: null,
    },
    select: { id: true },
  });
  if (existing) {
    throw new AppError(
      'You have already submitted your report for this WBS item and period. It can be revised only to answer a query.',
      409,
      'REPORT_ALREADY_SUBMITTED',
      { workdayReportId: existing.id }
    );
  }
}

/** IDs of a report and all its ancestors (the revision chain up to the original). */
async function revisionChainIds(reportId: string): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = reportId;
  while (cursor && !ids.includes(cursor)) {
    ids.push(cursor);
    const row: { parentReportId: string | null } | null = await prisma.workdayReport.findUnique({
      where: { id: cursor },
      select: { parentReportId: true },
    });
    cursor = row?.parentReportId ?? null;
  }
  return ids;
}

/**
 * POST /projects/:projectId/workday-reports/:reportId/revalidate
 *
 * A new revision answering a query, with the same idempotency, ownership and assurance rules as a
 * submission. Omitted fields keep the previous revision's values; the reporter confirms them, the
 * model does not rewrite them. Marks the targeted query RESUBMITTED.
 */
export async function revalidateWorkdayReport(params: {
  projectId: string;
  reportId: string;
  fieldAgent: FieldAgentJwtPayload;
  input: RevalidateWorkdayReportRequest;
}): Promise<SubmitResult> {
  const { projectId, fieldAgent, input } = params;

  const replay = await findReportForReplay(input.clientReportId, fieldAgent.sessionId);
  if (replay) return { report: replay, created: false };

  assertTimezone(input.reporterTimezone);
  const prev = await prisma.workdayReport.findFirst({
    where: { id: params.reportId, projectId },
    include: {
      boqItem: { select: { wbsCode: true, isHoldPoint: true } },
      project: { select: { geofenceGeoJson: true } },
    },
  });
  if (!prev || prev.reporterSessionId !== fieldAgent.sessionId) {
    throw new AppError('Original workday report not found for this project', 404, 'WORKDAY_REPORT_NOT_FOUND');
  }
  const newer = await prisma.workdayReport.findFirst({
    where: { parentReportId: prev.id },
    select: { id: true },
  });
  if (newer) {
    throw new AppError('Revise the latest revision of this report', 409, 'REPORT_SUPERSEDED', {
      workdayReportId: newer.id,
    });
  }

  // A revision is accepted only to answer an OPEN query on this report (any revision of it).
  const chain = await revisionChainIds(prev.id);
  let targetQueryId: string;
  if (input.reportQueryId) {
    const query = await loadReportQueryInProject(prisma, projectId, input.reportQueryId);
    if (
      query.boqItemId !== prev.wbsItemId ||
      (query.workdayReportId !== null && !chain.includes(query.workdayReportId))
    ) {
      throw new AppError('Report query not found', 404, 'REPORT_QUERY_NOT_FOUND');
    }
    if (query.status !== 'OPEN') {
      throw new AppError('This query has already been answered', 409, 'NO_OPEN_QUERY');
    }
    targetQueryId = query.id;
  } else {
    const open = await prisma.reportQuery.findFirst({
      where: { projectId, workdayReportId: { in: chain }, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    if (!open) {
      throw new AppError(
        'This report has no open query. A submitted report can be revised only to answer a query.',
        409,
        'NO_OPEN_QUERY'
      );
    }
    targetQueryId = open.id;
  }

  const isHoldPointClaimed = input.isHoldPointClaimed ?? prev.isHoldPointClaimed;
  if (isHoldPointClaimed && !prev.boqItem.isHoldPoint) {
    throw new AppError('This WBS item is not a hold point', 400, 'HOLD_POINT_NOT_APPLICABLE');
  }
  const summaryText = input.summaryText ?? prev.summaryText;
  const reportedQuantity = input.reportedQuantity ?? Number(prev.reportedQuantity);
  const unitOfMeasure = input.unitOfMeasure ?? prev.unitOfMeasure;

  const [session, captures] = await Promise.all([
    loadSessionForReport(fieldAgent.sessionId),
    loadLinkableCaptures({
      projectId,
      sessionId: fieldAgent.sessionId,
      wbsItemId: prev.wbsItemId,
      clientCaptureIds: input.clientCaptureIds,
    }),
  ]);
  const geotag = evaluateGeotag(input.submissionGeotag, prev.project.geofenceGeoJson);
  const signature = verifyDeviceSignature({
    publicKey: session.devicePublicKey,
    alg: session.devicePublicKeyAlg,
    signature: input.signature,
    message: canonicalReportString({
      clientReportId: input.clientReportId,
      projectId,
      wbsItemId: prev.wbsItemId,
      workdayDate: prev.workdayDate,
      summaryText,
      reportedQuantity,
      unitOfMeasure,
      isHoldPointClaimed,
      clientCaptureIds: input.clientCaptureIds,
      confirmedAt: input.confirmedAt,
    }),
  });
  const approved = session.assuranceStatus === 'APPROVED';
  const flags = reportFlags(geotag!, signature.flag);
  if (new Date(input.confirmedAt).getTime() - Date.now() > MAX_FUTURE_CONFIRMATION_MS) {
    throw new AppError('The report is dated in the future. Check the phone clock.', 400, 'CONFIRMED_AT_IN_FUTURE');
  }

  let created: ReportRow;
  try {
    created = await prisma.$transaction(async (tx) => {
      const maxRev = await tx.workdayReport.aggregate({
        where: { projectId, wbsItemId: prev.wbsItemId, workdayDate: prev.workdayDate, reporterSessionId: fieldAgent.sessionId },
        _max: { revisionNumber: true },
      });
      const revisionNumber = (maxRev._max.revisionNumber ?? prev.revisionNumber) + 1;

      const report = await tx.workdayReport.create({
        data: {
          clientReportId: input.clientReportId,
          projectId,
          reporterSessionId: fieldAgent.sessionId,
          wbsItemId: prev.wbsItemId,
          workdayDate: prev.workdayDate,
          reporterTimezone: input.reporterTimezone,
          status: approved ? 'CONFIRMED' : 'STAGED_UNVERIFIED',
          revisionNumber,
          parentReportId: prev.id,
          resolvedQueryId: targetQueryId,
          summaryText,
          reportedQuantity,
          unitOfMeasure,
          isHoldPointClaimed,
          delaysOrBlockers: input.delaysOrBlockers ?? prev.delaysOrBlockers,
          textNotes: input.textNotes as unknown as Prisma.InputJsonValue,
          submissionGeotag: geotag as unknown as Prisma.InputJsonValue,
          deviceSignature: input.signature ?? null,
          signatureVerified: signature.verified,
          integrityFlags: flags as unknown as Prisma.InputJsonValue,
          aiCheckStatus: approved ? 'PENDING' : 'SKIPPED',
          humanConfirmedAt: new Date(input.confirmedAt),
        },
      });
      await linkCaptures(tx, report.id, prev.wbsItemId, captures.map((c) => c.id));
      await recordReportPing(tx, { projectId, sessionId: fieldAgent.sessionId, wbsItemId: prev.wbsItemId, geotag });

      await tx.wbsChatMessage.create({
        data: {
          projectId,
          boqItemId: prev.wbsItemId,
          workdayReportId: report.id,
          reportQueryId: targetQueryId,
          fieldSessionId: fieldAgent.sessionId,
          senderSessionId: fieldAgent.sessionId,
          senderName: fieldAgent.agentFullName,
          senderRole: 'ENGINEER',
          messageType: 'QUERY_RESPONSE',
          textContent: `Re-submitted report (Rev #${revisionNumber}): ${summaryText}`,
        },
      });

      await tx.reportQuery.update({
        where: { id: targetQueryId },
        data: { status: 'RESUBMITTED', respondedAt: new Date() },
      });
      await tx.mobileNotification.updateMany({
        where: {
          projectId,
          fieldSessionId: fieldAgent.sessionId,
          type: 'REPORT_QUERY',
          isRead: false,
          metadata: { path: ['reportQueryId'], equals: targetQueryId },
        },
        data: { isRead: true, readAt: new Date() },
      });

      await createWebNotification(tx, {
        projectId,
        targetPermissionKey: 'reports:view_all',
        category: 'REPORT_RESUBMITTED',
        title: `Report Resubmitted · WBS ${prev.boqItem.wbsCode} (Rev #${revisionNumber})`,
        description: `${fieldAgent.agentFullName} resubmitted WBS ${prev.boqItem.wbsCode} (${reportedQuantity} ${unitOfMeasure}) with ${captures.length} new capture(s).`,
        actionUrl: `/app/projects/${projectId}/audit?tab=presence&wbsItemId=${prev.wbsItemId}&reportId=${report.id}`,
        metadata: {
          wbsItemId: prev.wbsItemId,
          wbsCode: prev.boqItem.wbsCode,
          workdayReportId: report.id,
          parentReportId: prev.id,
          revisionNumber,
          reportQueryId: targetQueryId,
        },
      });

      await recordAuditEvent(tx, {
        projectId,
        actorType: 'FIELD_AGENT',
        actorId: fieldAgent.sessionId,
        actorDisplayName: `${fieldAgent.agentFullName} (${fieldAgent.roleName})`,
        action: 'CONTRACTOR_QUERY_RESPONDED',
        summaryText: `Re-submitted WBS ${prev.boqItem.wbsCode} report (Rev #${revisionNumber}) with ${captures.length} new capture(s).`,
        payload: {
          workdayReportId: report.id,
          parentReportId: prev.id,
          revisionNumber,
          resolvedQueryId: targetQueryId,
          signatureVerified: signature.verified,
          flags,
        },
      });

      return tx.workdayReport.findUniqueOrThrow({ where: { id: report.id }, include: REPORT_INCLUDE });
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      const again = await findReportForReplay(input.clientReportId, fieldAgent.sessionId);
      if (again) return { report: again, created: false };
    }
    throw error;
  }

  if (created.aiCheckStatus === 'PENDING') scheduleAiOmissionCheck(created.id);
  return { report: serializeWorkdayReport(created), created: true };
}

/**
 * Releases a session's staged reports when its identity assurance is approved. Called inside the
 * approval transaction; returns the released IDs so the caller can schedule their checks.
 */
export async function releaseStagedReportsForSession(
  tx: Tx,
  params: { projectId: string; sessionId: string }
): Promise<string[]> {
  const staged = await tx.workdayReport.findMany({
    where: { projectId: params.projectId, reporterSessionId: params.sessionId, status: 'STAGED_UNVERIFIED' },
    select: { id: true },
  });
  if (staged.length === 0) return [];
  const ids = staged.map((r) => r.id);
  await tx.workdayReport.updateMany({
    where: { id: { in: ids } },
    data: { status: 'CONFIRMED', releasedAt: new Date(), aiCheckStatus: 'PENDING' },
  });
  return ids;
}

export async function listProjectWorkdayReports(params: {
  projectId: string;
  workdayDate?: string;
  reporterSessionId?: string;
}): Promise<WorkdayReportDto[]> {
  const where: Prisma.WorkdayReportWhereInput = { projectId: params.projectId };
  if (params.reporterSessionId) where.reporterSessionId = params.reporterSessionId;
  if (params.workdayDate) where.workdayDate = params.workdayDate;

  const rows = await prisma.workdayReport.findMany({
    where,
    include: REPORT_INCLUDE_WITH_QUERIES,
    orderBy: [{ createdAt: 'desc' }, { revisionNumber: 'desc' }],
    take: 150,
  });
  return rows.map((r) => serializeWorkdayReport(r));
}

/**
 * POST /projects/:projectId/workday-reports/suggest
 *
 * Optional assist for the summary sheet. Transcribes the reporter's own voice captures if a speech
 * provider is configured, then suggests a summary and quantity. Never stored as evidence. With no
 * provider, transcripts stay PENDING and no text is invented.
 */
export async function suggestWorkdaySummary(params: {
  projectId: string;
  fieldAgent: FieldAgentJwtPayload;
  input: SuggestWorkdaySummaryRequest;
}): Promise<SuggestWorkdaySummaryResponse> {
  const { projectId, fieldAgent, input } = params;
  const boqItem = await loadBoqItemInProject(prisma, projectId, input.wbsItemId);

  const captures = input.clientCaptureIds.length
    ? await prisma.fieldEvidenceLog.findMany({
        where: {
          clientCaptureId: { in: input.clientCaptureIds },
          projectId,
          fieldSessionId: fieldAgent.sessionId,
        },
        include: { mediaAttachments: true },
      })
    : [];

  const transcripts: SuggestWorkdaySummaryResponse['transcripts'] = [];
  for (const c of captures) {
    const media = c.mediaAttachments[0];
    if (!media || media.mediaType !== 'VOICE_NOTE') continue;
    if (c.transcriptionStatus === 'DONE') {
      transcripts.push({
        clientCaptureId: c.clientCaptureId,
        transcriptionStatus: 'DONE',
        transcript: c.transcript,
        engine: c.transcriptionEngine,
      });
      continue;
    }
    const bytes = whisperService.isConfigured() ? await storageService.getObjectBuffer(media.objectKey) : null;
    const result = await whisperService.transcribeAudio({ audioBuffer: bytes, mimeType: media.mimeType });
    const status = result.status === 'UNAVAILABLE' ? 'PENDING' : result.status;
    // A simulated demo transcript is shown to the reporter but never stored on the capture.
    if (result.engine !== 'SIMULATED_DEMO') {
      await prisma.fieldEvidenceLog.update({
        where: { id: c.id },
        data: { transcriptionStatus: status, transcript: result.transcript, transcriptionEngine: result.engine },
      });
    }
    transcripts.push({
      clientCaptureId: c.clientCaptureId,
      transcriptionStatus: status,
      transcript: result.transcript,
      engine: result.engine,
    });
  }

  const text = [
    ...transcripts.map((t) => t.transcript).filter((t): t is string => Boolean(t)),
    ...input.textNotes.filter((t) => t.trim().length > 0),
  ].join('\n');
  if (!text.trim()) {
    const waitingOnSpeech = transcripts.some((t) => t.transcriptionStatus === 'PENDING');
    return {
      transcripts,
      suggestion: null,
      unavailableReason: waitingOnSpeech
        ? 'Voice notes cannot be transcribed right now. Type the summary yourself.'
        : 'Nothing to summarise yet. Add a note or type the summary yourself.',
    };
  }

  const { extraction, engine } = await azureOpenAiService.extractFieldNoteFromTranscript({
    rawTranscriptOrNote: text,
    projectBoqItems: [{ wbsCode: boqItem.wbsCode, description: boqItem.description, unit: boqItem.unit }],
  });
  const usedSimulated = transcripts.some((t) => t.engine === 'SIMULATED_DEMO');
  return {
    transcripts,
    suggestion: {
      summary: extraction.normalizedSummary,
      quantities: extraction.extractedQuantities,
      blockers: extraction.siteBlockers,
      engine: usedSimulated && env.DEMO_MODE ? 'SIMULATED_DEMO' : engine,
    },
    unavailableReason: null,
  };
}
