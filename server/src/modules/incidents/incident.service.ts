import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { CreateIncidentReportRequest } from '@insite/shared';
import { recordAuditEvent } from '../audit/audit.service';

export async function createIncidentReport(
  projectId: string,
  reporterSessionId: string,
  reporterDisplayName: string,
  reporterTier: string,
  input: CreateIncidentReportRequest
) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) {
    throw new AppError('Project not found', 404, 'PROJECT_NOT_FOUND');
  }

  const incident = await prisma.$transaction(async (tx) => {
    const created = await tx.incidentReport.create({
      data: {
        projectId,
        reporterSessionId,
        wbsItemId: input.wbsItemId ?? null,
        category: input.category,
        severity: input.severity,
        title: input.title,
        description: input.description,
        isConfidentialWhistleblower: input.isConfidentialWhistleblower,
        photoEvidenceUrls: input.photoEvidenceUrls,
        voiceNoteUrl: input.voiceNoteUrl ?? null,
        deviceGpsCoordinates: input.deviceGpsCoordinates ?? undefined,
        status: 'OPEN',
      },
    });

    await recordAuditEvent(tx, {
      projectId,
      actorType: 'FIELD_AGENT',
      actorId: reporterSessionId,
      actorDisplayName: reporterDisplayName,
      action: 'INCIDENT_REPORT_SUBMITTED',
      summaryText: input.isConfidentialWhistleblower
        ? `[CONFIDENTIAL SHIELD] Whistleblowing escalation logged by ${reporterDisplayName} under protected disclosure.`
        : `Special Incident reported by ${reporterDisplayName}: ${input.title} (${input.category} · ${input.severity}).`,
      payload: {
        incidentId: created.id,
        category: input.category,
        severity: input.severity,
        isConfidentialWhistleblower: input.isConfidentialWhistleblower,
        hasPhotos: input.photoEvidenceUrls.length > 0,
      },
    });

    return created;
  });

  return incident;
}

export async function listProjectIncidents(
  projectId: string,
  callerRole?: string
) {
  const isContractor = callerRole === 'CONTRACTOR';

  const incidents = await prisma.incidentReport.findMany({
    where: {
      projectId,
      ...(isContractor ? { isConfidentialWhistleblower: false } : {}),
    },
    include: {
      reporterSession: {
        select: {
          agentFullName: true,
          independenceTier: true,
        },
      },
      boqItem: {
        select: {
          wbsCode: true,
          description: true,
        },
      },
    },
    orderBy: { createdAt: 'desc' },
  });

  return incidents.map((inc) => ({
    id: inc.id,
    projectId: inc.projectId,
    reporterSessionId: inc.reporterSessionId,
    reporterName: inc.reporterSession.agentFullName,
    reporterTier: inc.reporterSession.independenceTier,
    wbsItemId: inc.wbsItemId,
    wbsCode: inc.boqItem?.wbsCode ?? null,
    wbsDescription: inc.boqItem?.description ?? null,
    category: inc.category,
    severity: inc.severity,
    title: inc.title,
    description: inc.description,
    isConfidentialWhistleblower: inc.isConfidentialWhistleblower,
    status: inc.status,
    photoEvidenceUrls: inc.photoEvidenceUrls,
    voiceNoteUrl: inc.voiceNoteUrl,
    deviceGpsCoordinates: inc.deviceGpsCoordinates,
    createdAt: inc.createdAt.toISOString(),
    resolvedAt: inc.resolvedAt ? inc.resolvedAt.toISOString() : null,
  }));
}

export async function resolveIncidentReport(
  incidentId: string,
  status: string,
  resolverName: string
) {
  const incident = await prisma.incidentReport.update({
    where: { id: incidentId },
    data: {
      status,
      resolvedAt: new Date(),
    },
  });

  return incident;
}

