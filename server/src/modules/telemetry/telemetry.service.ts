import { Prisma } from '@prisma/client';
import {
  calendarDateInTimeZone,
  canonicalPingString,
  CreateTelemetryBatch,
  SiteTelemetryPingDto,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { evaluateProjectGeofence } from '../../utils/geofenceEvaluation';
import { verifyDeviceSignature } from '../../utils/deviceSignature';

const CHUNK_SIZE = 200;

type AnomalyType = 'MOCK_LOCATION' | 'OUTSIDE_GEOFENCE';

/**
 * Records a batch of presence pings. Idempotent on clientPingId (repeats are skipped), geofence
 * computed by the server, written in chunks. Anomalies are summarised as one row and one audit
 * entry per session, day and anomaly type, instead of one audit entry per ping.
 */
export async function recordTelemetryBatch(params: {
  projectId: string;
  fieldSessionId: string;
  actorDisplayName: string;
  input: CreateTelemetryBatch;
}): Promise<{ received: number; created: number; duplicates: number }> {
  const [project, session] = await Promise.all([
    prisma.project.findUnique({
      where: { id: params.projectId },
      select: {
        id: true,
        geofenceGeoJson: true,
        geofenceToleranceMeters: true,
        timezone: true,
        tenant: { select: { timezone: true, defaultGeofenceToleranceMeters: true } },
      },
    }),
    prisma.fieldAgentSession.findUniqueOrThrow({
      where: { id: params.fieldSessionId },
      select: { devicePublicKey: true, devicePublicKeyAlg: true },
    }),
  ]);
  if (!project) throw new AppError('Project not found', 404);

  const rows: Prisma.SiteTelemetryPingCreateManyInput[] = params.input.pings.map((ping) => {
    const evaluation = evaluateProjectGeofence(project, ping);
    const signature = verifyDeviceSignature({
      publicKey: session.devicePublicKey,
      alg: session.devicePublicKeyAlg,
      signature: ping.signature,
      message: canonicalPingString({
        clientPingId: ping.clientPingId,
        projectId: params.projectId,
        latitude: ping.latitude,
        longitude: ping.longitude,
        accuracyMeters: ping.accuracyMeters ?? null,
        isMocked: ping.isMocked,
        capturedAt: ping.capturedAt,
      }),
    });
    const capturedAt = new Date(ping.capturedAt);
    return {
      clientPingId: ping.clientPingId,
      projectId: params.projectId,
      fieldSessionId: params.fieldSessionId,
      wbsItemId: ping.wbsItemId ?? null,
      latitude: ping.latitude,
      longitude: ping.longitude,
      accuracyMeters: ping.accuracyMeters ?? null,
      altitudeMeters: ping.altitudeMeters ?? null,
      isMocked: ping.isMocked,
      isWithinGeofence: evaluation.isWithinGeofence,
      geofenceStatus: evaluation.geofenceStatus,
      distanceOutsideMeters: evaluation.distanceOutsideMeters,
      chainageLabel: evaluation.chainageLabel,
      distanceMeters: evaluation.distanceFromSiteMeters,
      pingSource: ping.pingSource,
      deviceSignature: ping.signature ?? null,
      signatureVerified: signature.verified,
      capturedAtDevice: capturedAt,
    };
  });

  // Dedupe within the batch, then skip IDs already stored.
  const unique = [...new Map(rows.map((r) => [r.clientPingId, r])).values()];
  const existing = await prisma.siteTelemetryPing.findMany({
    where: { clientPingId: { in: unique.map((r) => r.clientPingId) } },
    select: { clientPingId: true, fieldSessionId: true },
  });
  if (existing.some((e) => e.fieldSessionId !== params.fieldSessionId)) {
    throw new AppError('A ping ID is already in use', 409, 'PING_ID_CONFLICT');
  }
  const existingIds = new Set(existing.map((e) => e.clientPingId));
  const fresh = unique.filter((r) => !existingIds.has(r.clientPingId));

  let created = 0;
  for (let i = 0; i < fresh.length; i += CHUNK_SIZE) {
    const result = await prisma.siteTelemetryPing.createMany({
      data: fresh.slice(i, i + CHUNK_SIZE),
      skipDuplicates: true,
    });
    created += result.count;
  }

  // Anomalies are counted only for pings stored by this call, so a retried batch is not double counted.
  if (created > 0) {
    const freshAnomalies = new Map<string, { type: AnomalyType; day: string; count: number; first: Date; last: Date }>();
    for (const row of fresh) {
      const capturedAt = new Date(row.capturedAtDevice);
      const day = calendarDateInTimeZone(capturedAt, project.tenant.timezone);
      const types: AnomalyType[] = [];
      if (row.isMocked) types.push('MOCK_LOCATION');
      if (row.isWithinGeofence === false) types.push('OUTSIDE_GEOFENCE');
      for (const type of types) {
        const key = `${day}|${type}`;
        const a = freshAnomalies.get(key) ?? { type, day, count: 0, first: capturedAt, last: capturedAt };
        a.count += 1;
        if (capturedAt < a.first) a.first = capturedAt;
        if (capturedAt > a.last) a.last = capturedAt;
        freshAnomalies.set(key, a);
      }
    }
    for (const a of freshAnomalies.values()) {
      await recordAnomalySummary({ ...params, anomaly: a });
    }
  }

  return { received: params.input.pings.length, created, duplicates: params.input.pings.length - created };
}

async function recordAnomalySummary(params: {
  projectId: string;
  fieldSessionId: string;
  actorDisplayName: string;
  anomaly: { type: AnomalyType; day: string; count: number; first: Date; last: Date };
}) {
  const { anomaly } = params;
  await prisma.$transaction(async (tx) => {
    const key = {
      fieldSessionId_day_anomalyType: {
        fieldSessionId: params.fieldSessionId,
        day: anomaly.day,
        anomalyType: anomaly.type,
      },
    };
    const before = await tx.telemetryAnomalyDaily.findUnique({ where: key, select: { id: true } });
    await tx.telemetryAnomalyDaily.upsert({
      where: key,
      create: {
        projectId: params.projectId,
        fieldSessionId: params.fieldSessionId,
        day: anomaly.day,
        anomalyType: anomaly.type,
        pingCount: anomaly.count,
        firstSeenAt: anomaly.first,
        lastSeenAt: anomaly.last,
      },
      update: { pingCount: { increment: anomaly.count }, lastSeenAt: anomaly.last },
    });
    if (!before) {
      await recordAuditEvent(tx, {
        projectId: params.projectId,
        actorType: 'FIELD_AGENT',
        actorId: params.fieldSessionId,
        actorDisplayName: params.actorDisplayName,
        action: 'TELEMETRY_ANOMALY_SUMMARY',
        summaryText:
          anomaly.type === 'MOCK_LOCATION'
            ? `Presence pings on ${anomaly.day} reported a mock location.`
            : `Presence pings on ${anomaly.day} were outside the project geofence.`,
        payload: { day: anomaly.day, anomalyType: anomaly.type, firstSeenAt: anomaly.first.toISOString() },
      });
    }
  });
}

export async function listProjectTelemetryPings(params: {
  projectId: string;
  date?: string;
  fieldSessionId?: string;
  limit?: number;
}): Promise<SiteTelemetryPingDto[]> {
  const where: Prisma.SiteTelemetryPingWhereInput = { projectId: params.projectId };
  if (params.fieldSessionId) where.fieldSessionId = params.fieldSessionId;
  if (params.date) {
    where.capturedAtDevice = {
      gte: new Date(`${params.date}T00:00:00.000Z`),
      lte: new Date(`${params.date}T23:59:59.999Z`),
    };
  }

  const rows = await prisma.siteTelemetryPing.findMany({
    where,
    include: { fieldSession: { select: { agentFullName: true, roleNameSnapshot: true } } },
    orderBy: { capturedAtDevice: 'desc' },
    take: Math.min(params.limit ?? 200, 500),
  });

  return rows.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    fieldSessionId: r.fieldSessionId,
    agentName: r.fieldSession.agentFullName,
    agentTier: r.fieldSession.roleNameSnapshot,
    wbsItemId: r.wbsItemId,
    latitude: r.latitude,
    longitude: r.longitude,
    accuracyMeters: r.accuracyMeters,
    altitudeMeters: r.altitudeMeters,
    isMocked: r.isMocked,
    isWithinGeofence: r.isWithinGeofence,
    geofenceStatus: r.geofenceStatus ?? null,
    distanceOutsideMeters: r.distanceOutsideMeters ?? null,
    chainageLabel: r.chainageLabel,
    distanceMeters: r.distanceMeters,
    pingSource: r.pingSource as SiteTelemetryPingDto['pingSource'],
    signatureVerified: r.signatureVerified,
    capturedAtDevice: r.capturedAtDevice.toISOString(),
    syncedAtServer: r.syncedAtServer.toISOString(),
  }));
}
