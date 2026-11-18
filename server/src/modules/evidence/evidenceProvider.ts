import { Prisma, PrismaClient } from '@prisma/client';
import {
  ExtractedQuantityItemSchema,
  FieldPersonaType,
  MediaType,
  ProvidedEvidenceItem,
} from '@insite/shared';
import { prisma } from '../../config/prisma';

/**
 * The single source of evidence for reconciliation (Phase 3 seam with Phase 4).
 *
 * Reconciliation and the workbench read evidence only through `getEvidenceForBoqItems`. Today it
 * returns confirmed `FieldEvidenceLog` rows; Phase 4 changes where evidence comes from by
 * changing this module only, keeping the returned shape.
 */

type Db = Prisma.TransactionClient | PrismaClient;

function asStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];
}

function asQuantities(raw: unknown): ProvidedEvidenceItem['quantities'] {
  if (!Array.isArray(raw)) return [];
  const out: ProvidedEvidenceItem['quantities'] = [];
  for (const entry of raw) {
    const parsed = ExtractedQuantityItemSchema.safeParse(entry);
    if (parsed.success) {
      out.push({
        materialOrWork: parsed.data.materialOrWork,
        quantity: parsed.data.quantity,
        unit: parsed.data.unit,
      });
    }
  }
  return out;
}

/**
 * Evidence for the given BOQ items captured at or before `upTo`, newest first.
 * Items from other projects are never returned, whatever IDs are passed.
 */
export async function getEvidenceForBoqItems(
  projectId: string,
  boqItemIds: string[],
  upTo: Date,
  db: Db = prisma
): Promise<ProvidedEvidenceItem[]> {
  if (boqItemIds.length === 0) return [];

  const logs = await db.fieldEvidenceLog.findMany({
    where: {
      projectId,
      boqItemId: { in: boqItemIds },
      status: 'CONFIRMED',
      capturedAtDevice: { lte: upTo },
    },
    orderBy: { capturedAtDevice: 'desc' },
    include: {
      mediaAttachments: true,
      fieldSession: { select: { agentFullName: true } },
    },
  });

  return logs.map((log) => {
    const integrityFlags = asStringArray(log.integrityFlags);
    if (log.isMockLocation && !integrityFlags.includes('MOCK_LOCATION')) {
      integrityFlags.push('MOCK_LOCATION');
    }
    return {
      id: log.id,
      source: 'FIELD_EVIDENCE_LOG' as const,
      boqItemId: log.boqItemId as string,
      reporterName: log.fieldSession?.agentFullName ?? null,
      reporterRoleName: log.reporterRoleName,
      fieldPersonaType: log.fieldPersonaType as FieldPersonaType,
      assuranceWeight: log.assuranceWeight,
      isWithinGeofence: log.isWithinGeofence,
      chainageLabel: log.chainageLabel,
      latitude: log.latitude,
      longitude: log.longitude,
      gpsAccuracyMeters: log.gpsAccuracyMeters,
      verificationBadgeText: log.verificationBadgeText,
      summary: log.confirmedSummary,
      quantities: asQuantities(log.confirmedQuantities),
      blockers: asStringArray(log.siteBlockers),
      capturedAt: log.capturedAtDevice.toISOString(),
      confirmedAt: log.confirmedAt ? log.confirmedAt.toISOString() : null,
      integrityPassed: log.integrityPassed && !log.isMockLocation,
      integrityFlags,
      media: log.mediaAttachments.map((m) => ({
        id: m.id,
        mediaType: m.mediaType as MediaType,
        objectKey: m.objectKey,
        mimeType: m.mimeType,
        durationSeconds: m.durationSeconds,
      })),
    };
  });
}
