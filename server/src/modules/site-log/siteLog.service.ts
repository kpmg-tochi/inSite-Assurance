import { Prisma } from '@prisma/client';
import { CreateSiteLogEntryRequest, SiteLogEntryDto } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { FieldAgentJwtPayload, WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { evaluateProjectGeofence, GEOFENCE_CONTEXT_SELECT } from '../../utils/geofenceEvaluation';
import { toCaptureSummary } from '../workday-reports/workdayReports.service';

/**
 * Redesign R4c (D-R4.27, decision X): the officer's site log on a project: photos, voice notes and
 * notes taken outside a form. Idempotent on `clientEntryId`. Entries attach to a visit submission or
 * stay on the project timeline (R6). Never deleted: an author may hide a note (audited).
 */

export const SITE_LOG_INCLUDE = { capture: { include: { mediaAttachments: true } } } satisfies Prisma.SiteLogEntryInclude;
type SiteLogRow = Prisma.SiteLogEntryGetPayload<{ include: typeof SITE_LOG_INCLUDE }>;

export function serializeSiteLogEntry(e: SiteLogRow): SiteLogEntryDto {
  return {
    id: e.id,
    clientEntryId: e.clientEntryId,
    projectId: e.projectId,
    authorUserId: e.authorUserId,
    authorName: e.authorName,
    kind: e.kind,
    text: e.text,
    capture: e.capture ? toCaptureSummary(e.capture as Parameters<typeof toCaptureSummary>[0]) : null,
    latitude: e.latitude ?? e.capture?.latitude ?? null,
    longitude: e.longitude ?? e.capture?.longitude ?? null,
    geofenceStatus: e.geofenceStatus ?? e.capture?.geofenceStatus ?? null,
    capturedAt: e.capturedAtDevice.toISOString(),
    attachedSubmissionId: e.attachedSubmissionId,
    hidden: e.hiddenAt !== null,
    createdAt: e.createdAt.toISOString(),
  };
}

function requireFieldWriter(f: FieldAgentJwtPayload) {
  if (!f.permissions.includes('visits:submit')) throw new AppError('Access requires permission(s): visits:submit', 403, 'FORBIDDEN_PERMISSION');
}

export async function createSiteLogEntry(projectId: string, f: FieldAgentJwtPayload, input: CreateSiteLogEntryRequest): Promise<{ entry: SiteLogEntryDto; created: boolean }> {
  requireFieldWriter(f);
  const replay = async () => {
    const existing = await prisma.siteLogEntry.findUnique({ where: { clientEntryId: input.clientEntryId }, include: SITE_LOG_INCLUDE });
    if (!existing) return null;
    if (existing.authorUserId !== f.userId || existing.projectId !== projectId) throw new AppError('This entry ID is already in use', 409, 'ENTRY_ID_CONFLICT');
    return serializeSiteLogEntry(existing);
  };
  const earlier = await replay();
  if (earlier) return { entry: earlier, created: false };

  let captureId: string | null = null;
  if (input.kind !== 'NOTE') {
    const capture = await prisma.fieldEvidenceLog.findUnique({
      where: { clientCaptureId: input.clientCaptureId! },
      select: { id: true, projectId: true, fieldSession: { select: { userId: true } }, workdayReportId: true, siteInspectionReportId: true, visitSubmissionId: true },
    });
    if (!capture) throw new AppError('The capture is not registered yet', 409, 'CAPTURES_NOT_REGISTERED', { missingClientCaptureIds: [input.clientCaptureId] });
    if (capture.projectId !== projectId) throw new AppError('The capture belongs to another project', 403, 'CAPTURE_OTHER_PROJECT');
    if (capture.fieldSession.userId !== f.userId) throw new AppError('The capture was taken by someone else', 403, 'CAPTURE_NOT_OWNED');
    if (capture.workdayReportId || capture.siteInspectionReportId || capture.visitSubmissionId) {
      throw new AppError('The capture is already linked to a report', 409, 'CAPTURE_ALREADY_LINKED');
    }
    captureId = capture.id;
  }
  let geo: { latitude: number; longitude: number; accuracyMeters: number | null; geofenceStatus: SiteLogEntryDto['geofenceStatus'] } | null = null;
  if (input.kind === 'NOTE' && input.geotag) {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: GEOFENCE_CONTEXT_SELECT });
    const e = evaluateProjectGeofence(project, input.geotag);
    geo = { latitude: input.geotag.latitude, longitude: input.geotag.longitude, accuracyMeters: input.geotag.accuracyMeters ?? null, geofenceStatus: e.geofenceStatus };
  }
  try {
    const id = await prisma.$transaction(async (tx) => {
      const entry = await tx.siteLogEntry.create({
        data: {
          clientEntryId: input.clientEntryId,
          projectId,
          authorUserId: f.userId,
          authorName: f.agentFullName,
          fieldSessionId: f.sessionId,
          kind: input.kind,
          captureId,
          text: input.text,
          latitude: geo?.latitude ?? null,
          longitude: geo?.longitude ?? null,
          accuracyMeters: geo?.accuracyMeters ?? null,
          geofenceStatus: geo?.geofenceStatus ?? null,
          capturedAtDevice: new Date(input.capturedAt),
        },
      });
      await recordAuditEvent(tx, {
        projectId,
        actorType: 'FIELD_AGENT',
        actorId: f.sessionId,
        actorDisplayName: `${f.agentFullName} (${f.roleName}, field)`,
        action: 'SITE_LOG_ADDED',
        summaryText: `Added a site log ${input.kind === 'NOTE' ? 'note' : input.kind === 'PHOTO' ? 'photo' : 'voice note'}.`,
        payload: { siteLogEntryId: entry.id, clientEntryId: input.clientEntryId, kind: input.kind, captureId },
      });
      return entry.id;
    });
    return { entry: serializeSiteLogEntry(await prisma.siteLogEntry.findUniqueOrThrow({ where: { id }, include: SITE_LOG_INCLUDE })), created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const again = await replay();
      if (again) return { entry: again, created: false };
      throw new AppError('The capture is already in the site log', 409, 'CAPTURE_ALREADY_LINKED');
    }
    throw error;
  }
}

export async function listSiteLog(
  projectId: string,
  principal: { webUser?: WebJwtPayload; fieldAgent?: FieldAgentJwtPayload },
  q: { mine?: boolean; since?: string; includeAttached?: boolean; includeHidden?: boolean }
): Promise<SiteLogEntryDto[]> {
  const where: Prisma.SiteLogEntryWhereInput = { projectId };
  if (principal.fieldAgent) where.authorUserId = principal.fieldAgent.userId;
  else if (!principal.webUser!.isPlatformSuperAdmin && !principal.webUser!.permissions.includes('visits:view')) {
    throw new AppError('Access requires permission(s): visits:view', 403, 'FORBIDDEN_PERMISSION');
  }
  if (q.mine && principal.webUser) where.authorUserId = principal.webUser.userId;
  if (!q.includeAttached && !principal.fieldAgent) where.attachedSubmissionId = null;
  if (!q.includeHidden && !principal.fieldAgent) where.hiddenAt = null;
  if (q.since) {
    const since = new Date(q.since);
    if (!Number.isNaN(since.getTime())) where.createdAt = { gte: since };
  }
  const rows = await prisma.siteLogEntry.findMany({ where, include: SITE_LOG_INCLUDE, orderBy: { capturedAtDevice: 'desc' }, take: 300 });
  return rows.map(serializeSiteLogEntry);
}

export async function hideSiteLogEntry(projectId: string, entryId: string, f: FieldAgentJwtPayload): Promise<SiteLogEntryDto> {
  const entry = await prisma.siteLogEntry.findFirst({ where: { id: entryId, projectId } });
  if (!entry) throw new AppError('Site log entry not found', 404, 'SITE_LOG_NOT_FOUND');
  if (entry.authorUserId !== f.userId) throw new AppError('Only the author can hide this entry', 403, 'SITE_LOG_NOT_OWNED');
  if (entry.kind !== 'NOTE') throw new AppError('Only notes can be hidden; photos and voice notes are evidence', 422, 'SITE_LOG_NOT_HIDEABLE');
  if (!entry.hiddenAt) {
    await prisma.$transaction(async (tx) => {
      await tx.siteLogEntry.update({ where: { id: entryId }, data: { hiddenAt: new Date() } });
      await recordAuditEvent(tx, {
        projectId,
        actorType: 'FIELD_AGENT',
        actorId: f.sessionId,
        actorDisplayName: `${f.agentFullName} (${f.roleName}, field)`,
        action: 'SITE_LOG_HIDDEN',
        summaryText: 'Hid a site log note.',
        payload: { siteLogEntryId: entryId },
      });
    });
  }
  return serializeSiteLogEntry(await prisma.siteLogEntry.findUniqueOrThrow({ where: { id: entryId }, include: SITE_LOG_INCLUDE }));
}
