import {
  SubmitWorkdayReportBundle,
  verifyLinearCorridorGeofence,
  verifyRadialGeofence,
  type ProjectGeofence,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { recordAuditEvent } from '../audit/audit.service';

export async function submitWorkdayReportBundle(params: {
  projectId: string;
  reporterSessionId: string;
  input: SubmitWorkdayReportBundle;
}) {
  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
    select: { id: true, geofenceMode: true, geofenceGeoJson: true },
  });

  if (!project) {
    throw new AppError('Project not found', 404);
  }

  let verifiedGeotag = params.input.submissionGeotag ?? null;

  if (verifiedGeotag && project.geofenceGeoJson) {
    const geofence = project.geofenceGeoJson as unknown as ProjectGeofence;
    try {
      const evalResult =
        geofence.mode === 'LINEAR_CORRIDOR'
          ? verifyLinearCorridorGeofence(
              {
                latitude: verifiedGeotag.latitude,
                longitude: verifiedGeotag.longitude,
              },
              geofence
            )
          : verifyRadialGeofence(
              {
                latitude: verifiedGeotag.latitude,
                longitude: verifiedGeotag.longitude,
              },
              geofence
            );

      verifiedGeotag = {
        ...verifiedGeotag,
        isWithinGeofence: evalResult.isWithinGeofence,
        chainageLabel:
          evalResult.chainageFormatted ?? verifiedGeotag.chainageLabel ?? null,
        distanceFromSiteMeters:
          evalResult.distanceFromCenterOrLineMeters ??
          verifiedGeotag.distanceFromSiteMeters ??
          null,
      };
    } catch {
      // Keep client-supplied geotag fields if geofence evaluation fails
    }
  }

  const report = await prisma.workdayReport.create({
    data: {
      projectId: params.projectId,
      reporterSessionId: params.reporterSessionId,
      wbsItemId: params.input.wbsItemId,
      workdayDate: params.input.workdayDate,
      status: 'CONFIRMED',
      summaryText: params.input.summaryText,
      reportedQuantity: params.input.reportedQuantity,
      unitOfMeasure: params.input.unitOfMeasure,
      isHoldPointClaimed: params.input.isHoldPointClaimed,
      evidenceItems: params.input.evidenceItems as any,
      voiceNoteUrl: params.input.voiceNoteUrl ?? null,
      submissionGeotag: verifiedGeotag ? (verifiedGeotag as any) : undefined,
      humanConfirmedAt: new Date(),
    },
    include: {
      boqItem: { select: { wbsCode: true, description: true } },
      reporterSession: { select: { agentFullName: true, independenceTier: true } },
    },
  });

  if (verifiedGeotag) {
    await prisma.siteTelemetryPing.create({
      data: {
        projectId: params.projectId,
        fieldSessionId: params.reporterSessionId,
        wbsItemId: params.input.wbsItemId,
        latitude: verifiedGeotag.latitude,
        longitude: verifiedGeotag.longitude,
        accuracyMeters: verifiedGeotag.accuracyMeters ?? null,
        altitudeMeters: verifiedGeotag.altitudeMeters ?? null,
        isMocked: verifiedGeotag.isMocked,
        isWithinGeofence: verifiedGeotag.isWithinGeofence ?? null,
        chainageLabel: verifiedGeotag.chainageLabel ?? null,
        distanceMeters: verifiedGeotag.distanceFromSiteMeters ?? null,
        pingSource: 'REPORT_SUBMISSION',
        deviceSignatureHash:
          verifiedGeotag.deviceSignatureHash || `eod-${report.id}`,
        capturedAtDevice: new Date(verifiedGeotag.capturedAt),
      },
    });

    if (verifiedGeotag.isMocked || verifiedGeotag.isWithinGeofence === false) {
      await recordAuditEvent(prisma, {
        projectId: params.projectId,
        actorType: 'FIELD_AGENT',
        actorId: params.reporterSessionId,
        actorDisplayName: report.reporterSession.agentFullName,
        action: 'EVIDENCE_FLAGGED_INTEGRITY',
        summaryText: verifiedGeotag.isMocked
          ? `EOD report for WBS ${report.boqItem.wbsCode} flagged for mock GPS.`
          : `EOD report for WBS ${report.boqItem.wbsCode} submitted outside project geofence.`,
        payload: {
          workdayReportId: report.id,
          wbsCode: report.boqItem.wbsCode,
          latitude: verifiedGeotag.latitude,
          longitude: verifiedGeotag.longitude,
          distanceFromSiteMeters: verifiedGeotag.distanceFromSiteMeters,
        },
      });
    }
  }

  return {
    id: report.id,
    projectId: report.projectId,
    reporterSessionId: report.reporterSessionId,
    reporterName: report.reporterSession.agentFullName,
    reporterTier: report.reporterSession.independenceTier,
    wbsItemId: report.wbsItemId,
    wbsCode: report.boqItem.wbsCode,
    wbsDescription: report.boqItem.description,
    workdayDate: report.workdayDate,
    status: report.status,
    summaryText: report.summaryText,
    reportedQuantity: Number(report.reportedQuantity),
    unitOfMeasure: report.unitOfMeasure,
    isHoldPointClaimed: report.isHoldPointClaimed,
    evidenceItems: report.evidenceItems,
    voiceNoteUrl: report.voiceNoteUrl,
    submissionGeotag: report.submissionGeotag,
    humanConfirmedAt: report.humanConfirmedAt?.toISOString() ?? null,
    createdAt: report.createdAt.toISOString(),
  };
}

export async function listProjectWorkdayReports(params: {
  projectId: string;
  workdayDate?: string;
}) {
  const where: any = { projectId: params.projectId };
  if (params.workdayDate) {
    where.workdayDate = params.workdayDate;
  }

  const rows = await prisma.workdayReport.findMany({
    where,
    include: {
      boqItem: { select: { wbsCode: true, description: true } },
      reporterSession: { select: { agentFullName: true, independenceTier: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });

  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    reporterSessionId: r.reporterSessionId,
    reporterName: r.reporterSession.agentFullName,
    reporterTier: r.reporterSession.independenceTier,
    wbsItemId: r.wbsItemId,
    wbsCode: r.boqItem.wbsCode,
    wbsDescription: r.boqItem.description,
    workdayDate: r.workdayDate,
    status: r.status,
    summaryText: r.summaryText,
    reportedQuantity: Number(r.reportedQuantity),
    unitOfMeasure: r.unitOfMeasure,
    isHoldPointClaimed: r.isHoldPointClaimed,
    evidenceItems: r.evidenceItems,
    voiceNoteUrl: r.voiceNoteUrl,
    submissionGeotag: r.submissionGeotag,
    aiParsedConfidence: r.aiParsedConfidence,
    aiReasoning: r.aiReasoning,
    humanConfirmedAt: r.humanConfirmedAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  }));
}
