import {
  CreateTelemetryBatch,
  SiteTelemetryPingDto,
  verifyLinearCorridorGeofence,
  verifyRadialGeofence,
  type ProjectGeofence,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { recordAuditEvent } from '../audit/audit.service';

export async function recordTelemetryBatch(params: {
  projectId: string;
  fieldSessionId: string;
  input: CreateTelemetryBatch;
}) {
  const project = await prisma.project.findUnique({
    where: { id: params.projectId },
    select: { id: true, geofenceMode: true, geofenceGeoJson: true },
  });

  if (!project) {
    throw new AppError('Project not found', 404);
  }

  const geofence = project.geofenceGeoJson as unknown as ProjectGeofence;
  const createdIds: string[] = [];

  for (const ping of params.input.pings) {
    let isWithinGeofence = ping.isWithinGeofence ?? null;
    let chainageLabel = ping.chainageLabel ?? null;
    let distanceMeters = ping.distanceMeters ?? null;

    if (geofence) {
      try {
        const evalResult =
          geofence.mode === 'LINEAR_CORRIDOR'
            ? verifyLinearCorridorGeofence(
                { latitude: ping.latitude, longitude: ping.longitude },
                geofence
              )
            : verifyRadialGeofence(
                { latitude: ping.latitude, longitude: ping.longitude },
                geofence
              );
        isWithinGeofence = evalResult.isWithinGeofence;
        chainageLabel = evalResult.chainageFormatted ?? chainageLabel;
        distanceMeters = evalResult.distanceFromCenterOrLineMeters ?? distanceMeters;
      } catch {
        // Keep client-supplied metadata if geofence evaluation fails
      }
    }

    const row = await prisma.siteTelemetryPing.create({
      data: {
        projectId: params.projectId,
        fieldSessionId: params.fieldSessionId,
        wbsItemId: ping.wbsItemId ?? null,
        latitude: ping.latitude,
        longitude: ping.longitude,
        accuracyMeters: ping.accuracyMeters ?? null,
        altitudeMeters: ping.altitudeMeters ?? null,
        isMocked: ping.isMocked,
        isWithinGeofence,
        chainageLabel,
        distanceMeters,
        pingSource: ping.pingSource,
        deviceSignatureHash: ping.deviceSignatureHash,
        capturedAtDevice: new Date(ping.capturedAt),
      },
    });
    createdIds.push(row.id);

    if (ping.isMocked || isWithinGeofence === false) {
      await recordAuditEvent(prisma, {
        projectId: params.projectId,
        actorType: 'FIELD_AGENT',
        actorId: params.fieldSessionId,
        actorDisplayName: 'Field Telemetry',
        action: 'EVIDENCE_FLAGGED_INTEGRITY',
        summaryText: ping.isMocked
          ? 'Hourly telemetry ping flagged for mock GPS.'
          : 'Hourly telemetry ping recorded outside project geofence.',
        payload: {
          telemetryPingId: row.id,
          latitude: ping.latitude,
          longitude: ping.longitude,
          distanceMeters,
          pingSource: ping.pingSource,
        },
      });
    }
  }

  return { count: createdIds.length, ids: createdIds };
}

export async function listProjectTelemetryPings(params: {
  projectId: string;
  date?: string;
  fieldSessionId?: string;
  limit?: number;
}): Promise<SiteTelemetryPingDto[]> {
  const where: any = { projectId: params.projectId };

  if (params.fieldSessionId) {
    where.fieldSessionId = params.fieldSessionId;
  }

  if (params.date) {
    const start = new Date(`${params.date}T00:00:00.000Z`);
    const end = new Date(`${params.date}T23:59:59.999Z`);
    where.capturedAtDevice = { gte: start, lte: end };
  }

  const rows = await prisma.siteTelemetryPing.findMany({
    where,
    include: {
      fieldSession: {
        select: { agentFullName: true, independenceTier: true },
      },
    },
    orderBy: { capturedAtDevice: 'desc' },
    take: Math.min(params.limit ?? 200, 500),
  });

  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    fieldSessionId: r.fieldSessionId,
    agentName: r.fieldSession.agentFullName,
    agentTier: r.fieldSession.independenceTier,
    wbsItemId: r.wbsItemId,
    latitude: r.latitude,
    longitude: r.longitude,
    accuracyMeters: r.accuracyMeters,
    altitudeMeters: r.altitudeMeters,
    isMocked: r.isMocked,
    isWithinGeofence: r.isWithinGeofence,
    chainageLabel: r.chainageLabel,
    distanceMeters: r.distanceMeters,
    pingSource: r.pingSource as SiteTelemetryPingDto['pingSource'],
    deviceSignatureHash: r.deviceSignatureHash,
    capturedAtDevice: r.capturedAtDevice.toISOString(),
    syncedAtServer: r.syncedAtServer.toISOString(),
  }));
}
