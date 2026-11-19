import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { CreateIncidentReportRequest, IncidentStatus } from '@insite/shared';
import {
  FieldAgentJwtPayload,
  hasWebPermission,
  WebJwtPayload,
} from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { loadBoqItemInProject } from '../../utils/ownership';
import { assertProjectObjectKey } from '../../integrations/storage.service';

/** Display name used wherever a confidential reporter's identity would otherwise appear. */
export const PROTECTED_DISCLOSURE_LABEL = 'Protected disclosure';
const PROTECTED_DISCLOSURE_ACTOR_ID = 'PROTECTED_DISCLOSURE';

type IncidentRow = Prisma.IncidentReportGetPayload<{
  include: {
    reporterSession: { select: { agentFullName: true; roleNameSnapshot: true } };
    boqItem: { select: { wbsCode: true; description: true } };
  };
}>;

/**
 * Reporter identity on a confidential disclosure is shown only to holders of
 * `incidents:view_confidential`, and to the field agent who filed it.
 */
function serializeIncident(
  inc: IncidentRow,
  viewer: { webUser?: WebJwtPayload; fieldAgent?: FieldAgentJwtPayload }
) {
  const isOwnReport = viewer.fieldAgent?.sessionId === inc.reporterSessionId;
  const revealIdentity =
    !inc.isConfidentialWhistleblower ||
    isOwnReport ||
    hasWebPermission(viewer.webUser, 'incidents:view_confidential');

  return {
    id: inc.id,
    projectId: inc.projectId,
    reporterSessionId: revealIdentity ? inc.reporterSessionId : null,
    reporterName: revealIdentity ? inc.reporterSession.agentFullName : PROTECTED_DISCLOSURE_LABEL,
    reporterRoleName: revealIdentity ? inc.reporterSession.roleNameSnapshot : null,
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
    // Device location can identify a reporter; it follows the same rule as identity.
    deviceGpsCoordinates: revealIdentity ? inc.deviceGpsCoordinates : null,
    createdAt: inc.createdAt.toISOString(),
    resolvedAt: inc.resolvedAt ? inc.resolvedAt.toISOString() : null,
  };
}

const INCIDENT_INCLUDE = {
  reporterSession: { select: { agentFullName: true, roleNameSnapshot: true } },
  boqItem: { select: { wbsCode: true, description: true } },
} satisfies Prisma.IncidentReportInclude;

export async function createIncidentReport(
  fieldAgent: FieldAgentJwtPayload,
  input: CreateIncidentReportRequest
) {
  const projectId = fieldAgent.projectId;

  // Idempotent on clientIncidentId: a retried submission returns the original incident.
  const existing = await prisma.incidentReport.findUnique({
    where: { clientIncidentId: input.clientIncidentId },
    include: INCIDENT_INCLUDE,
  });
  if (existing) {
    if (existing.reporterSessionId !== fieldAgent.sessionId) {
      throw new AppError('This incident ID is already in use', 409, 'INCIDENT_ID_CONFLICT');
    }
    return { incident: serializeIncident(existing, { fieldAgent }), created: false };
  }

  // Photos and voice notes are object keys issued for this project; never URLs, paths or data URIs.
  for (const key of input.photoEvidenceUrls) {
    assertProjectObjectKey(key, fieldAgent.tenantId, projectId);
  }
  if (input.voiceNoteUrl) {
    assertProjectObjectKey(input.voiceNoteUrl, fieldAgent.tenantId, projectId);
  }
  if (input.wbsItemId) {
    await loadBoqItemInProject(prisma, projectId, input.wbsItemId);
  }

  const confidential = input.isConfidentialWhistleblower;
  const reporterDisplayName = `${fieldAgent.agentFullName} (${fieldAgent.roleName})`;

  const incident = await prisma.$transaction(async (tx) => {
    const created = await tx.incidentReport.create({
      data: {
        clientIncidentId: input.clientIncidentId,
        projectId,
        reporterSessionId: fieldAgent.sessionId,
        wbsItemId: input.wbsItemId ?? null,
        category: input.category,
        severity: input.severity,
        title: input.title,
        description: input.description,
        isConfidentialWhistleblower: confidential,
        photoEvidenceUrls: input.photoEvidenceUrls,
        voiceNoteUrl: input.voiceNoteUrl ?? null,
        deviceGpsCoordinates: input.deviceGpsCoordinates ?? undefined,
        status: 'OPEN',
      },
      include: INCIDENT_INCLUDE,
    });

    // The audit chain is visible to every holder of audit:view_ledger, so a confidential
    // disclosure records no reporter name, session ID or location.
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'FIELD_AGENT',
      actorId: confidential ? PROTECTED_DISCLOSURE_ACTOR_ID : fieldAgent.sessionId,
      actorDisplayName: confidential ? PROTECTED_DISCLOSURE_LABEL : reporterDisplayName,
      action: 'INCIDENT_REPORT_SUBMITTED',
      summaryText: confidential
        ? `[CONFIDENTIAL SHIELD] Whistleblowing escalation logged under protected disclosure (${input.category} · ${input.severity}).`
        : `Special Incident reported by ${reporterDisplayName}: ${input.title} (${input.category} · ${input.severity}).`,
      payload: {
        incidentId: created.id,
        category: input.category,
        severity: input.severity,
        isConfidentialWhistleblower: confidential,
        hasPhotos: input.photoEvidenceUrls.length > 0,
      },
    });

    return created;
  }).catch(async (error) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const replay = await prisma.incidentReport.findUnique({
        where: { clientIncidentId: input.clientIncidentId },
        include: INCIDENT_INCLUDE,
      });
      if (replay && replay.reporterSessionId === fieldAgent.sessionId) return replay;
    }
    throw error;
  });

  return { incident: serializeIncident(incident, { fieldAgent }), created: true };
}

export async function listProjectIncidents(params: {
  projectId: string;
  webUser?: WebJwtPayload;
  fieldAgent?: FieldAgentJwtPayload;
}) {
  let confidentialFilter: Prisma.IncidentReportWhereInput = {};
  if (params.fieldAgent) {
    // Field agents see non-confidential reports and their own confidential ones.
    confidentialFilter = {
      OR: [
        { isConfidentialWhistleblower: false },
        { reporterSessionId: params.fieldAgent.sessionId },
      ],
    };
  } else if (
    !hasWebPermission(
      params.webUser,
      'incidents:view_confidential',
      'audit:view_ledger',
      'reports:raise_query'
    )
  ) {
    // Web users without governance oversight do not see confidential reports at all.
    confidentialFilter = { isConfidentialWhistleblower: false };
  }

  const incidents = await prisma.incidentReport.findMany({
    where: { projectId: params.projectId, ...confidentialFilter },
    include: INCIDENT_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  return incidents.map((inc) =>
    serializeIncident(inc, { webUser: params.webUser, fieldAgent: params.fieldAgent })
  );
}

export async function resolveIncidentReport(params: {
  projectId: string;
  incidentId: string;
  status: IncidentStatus;
  webUser: WebJwtPayload;
}) {
  const existing = await prisma.incidentReport.findFirst({
    where: { id: params.incidentId, projectId: params.projectId },
  });

  if (!existing) {
    throw new AppError('Incident report not found for this project', 404, 'INCIDENT_NOT_FOUND');
  }

  const incident = await prisma.$transaction(async (tx) => {
    const updated = await tx.incidentReport.update({
      where: { id: existing.id },
      data: {
        status: params.status,
        resolvedAt:
          params.status === 'ACTION_TAKEN' || params.status === 'DISMISSED'
            ? new Date()
            : null,
      },
      include: INCIDENT_INCLUDE,
    });

    await recordAuditEvent(tx, {
      projectId: params.projectId,
      actorType: 'WEB_USER',
      actorId: params.webUser.userId,
      actorDisplayName: `${params.webUser.fullName} (${params.webUser.roleName})`,
      action: 'INCIDENT_STATUS_UPDATED',
      summaryText: `Updated incident "${existing.title}" status from ${existing.status} to ${params.status}.`,
      payload: {
        incidentId: existing.id,
        previousStatus: existing.status,
        nextStatus: params.status,
      },
    });

    return updated;
  });

  return serializeIncident(incident, { webUser: params.webUser });
}
