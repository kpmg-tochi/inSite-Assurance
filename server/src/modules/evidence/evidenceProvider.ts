import { GeofenceStatus, Prisma, PrismaClient } from '@prisma/client';
import {
  FieldPersonaType,
  MediaType,
  ProvidedEvidenceItem,
  ProvidedEvidenceMedia,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { getProcessConfig } from '../process/processConfig.service';

/**
 * The single source of evidence for reconciliation (the Phase 3 / Phase 4 seam).
 *
 * Evidence is a CONFIRMED workday report, taking only the latest revision of each chain, together
 * with every capture linked to any revision of that chain. A capture with no confirmed report is
 * not evidence. Phase 7 adds "approved" as a further condition when report approval is enabled.
 */

type Db = Prisma.TransactionClient | PrismaClient;

const REPORT_INCLUDE = {
  reporterSession: { select: { agentFullName: true, roleNameSnapshot: true, fieldPersonaType: true, assuranceWeight: true } },
  boqItem: { select: { description: true } },
  captures: { include: { mediaAttachments: true } },
} satisfies Prisma.WorkdayReportInclude;

type ReportRow = Prisma.WorkdayReportGetPayload<{ include: typeof REPORT_INCLUDE }>;
type CaptureRow = ReportRow['captures'][number];

type StoredGeotag = {
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number | null;
  isMocked?: boolean;
  isWithinGeofence?: boolean | null;
  geofenceStatus?: GeofenceStatus | null;
  distanceOutsideMeters?: number | null;
  chainageLabel?: string | null;
};

const STATUS_RANK: Record<GeofenceStatus, number> = { INSIDE: 0, WITHIN_TOLERANCE: 1, OUTSIDE: 2 };

/** Worst evaluated status across the inputs; null when none was evaluated. */
function worstGeofenceStatus(values: Array<GeofenceStatus | null | undefined>): GeofenceStatus | null {
  const known = values.filter((v): v is GeofenceStatus => Boolean(v));
  if (known.length === 0) return null;
  return known.reduce((a, b) => (STATUS_RANK[b] > STATUS_RANK[a] ? b : a));
}

function asStringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.filter((v): v is string => typeof v === 'string' && v.trim() !== '') : [];
}

function toMedia(c: CaptureRow): ProvidedEvidenceMedia | null {
  const m = c.mediaAttachments[0];
  if (!m) return null;
  return {
    id: c.id,
    mediaType: m.mediaType as MediaType,
    objectKey: m.objectKey,
    mimeType: m.mimeType,
    durationSeconds: m.durationSeconds,
    capturedAt: c.capturedAtDevice.toISOString(),
    locationAvailable: c.locationAvailable,
    isWithinGeofence: c.isWithinGeofence,
    geofenceStatus: (c.geofenceStatus as GeofenceStatus | null) ?? null,
    distanceOutsideMeters: c.distanceOutsideMeters,
    signatureVerified: c.signatureVerified,
    integrityPassed: c.integrityPassed,
    integrityFlags: asStringArray(c.integrityFlags),
  };
}

/**
 * Geofence verdict over the report position and every located capture: false if anything was
 * outside, true if something was inside and nothing outside, null if nothing could be evaluated.
 */
function combineGeofence(values: Array<boolean | null | undefined>): boolean | null {
  if (values.some((v) => v === false)) return false;
  if (values.some((v) => v === true)) return true;
  return null;
}

/** Combines the latest revision with the captures of its whole chain. */
function toEvidenceItem(report: ReportRow, chainCaptures: CaptureRow[]): ProvidedEvidenceItem {
  const geotag = (report.submissionGeotag ?? null) as StoredGeotag | null;
  const integrityFlags = new Set<string>();
  for (const c of chainCaptures) {
    for (const f of asStringArray(c.integrityFlags)) integrityFlags.add(f);
  }
  for (const f of asStringArray(report.integrityFlags)) integrityFlags.add(f);
  if (geotag?.isMocked) integrityFlags.add('MOCK_GPS_LOCATION_DETECTED');
  if (report.signatureVerified === false) integrityFlags.add('REPORT_SIGNATURE_INVALID');

  const criticalCapture = chainCaptures.some((c) => !c.integrityPassed);
  const integrityPassed =
    !criticalCapture && !geotag?.isMocked && report.signatureVerified !== false;

  const located = chainCaptures.find((c) => c.locationAvailable && c.latitude !== null);
  const latitude = geotag?.latitude ?? located?.latitude ?? null;
  const longitude = geotag?.longitude ?? located?.longitude ?? null;
  const accuracy = geotag ? geotag.accuracyMeters ?? null : located?.gpsAccuracyMeters ?? null;

  const capturedTimes = chainCaptures.map((c) => c.capturedAtDevice.getTime());
  const capturedAt = new Date(
    capturedTimes.length > 0 ? Math.min(...capturedTimes) : (report.humanConfirmedAt ?? report.createdAt).getTime()
  );

  const signatures = [report.signatureVerified, ...chainCaptures.map((c) => c.signatureVerified)];
  const signatureVerified = signatures.some((s) => s === false)
    ? false
    : signatures.every((s) => s === true)
      ? true
      : null;

  return {
    id: report.id,
    source: 'WORKDAY_REPORT',
    boqItemId: report.wbsItemId,
    reporterName: report.reporterSession.agentFullName,
    reporterRoleName: report.reporterSession.roleNameSnapshot,
    fieldPersonaType: report.reporterSession.fieldPersonaType as FieldPersonaType,
    assuranceWeight: report.reporterSession.assuranceWeight,
    isWithinGeofence: combineGeofence([
      geotag?.isWithinGeofence,
      ...chainCaptures.filter((c) => c.locationAvailable).map((c) => c.isWithinGeofence),
    ]),
    geofenceStatus: worstGeofenceStatus([
      geotag?.geofenceStatus,
      ...chainCaptures.filter((c) => c.locationAvailable).map((c) => c.geofenceStatus as GeofenceStatus | null),
    ]),
    chainageLabel: geotag?.chainageLabel ?? located?.chainageLabel ?? null,
    latitude,
    longitude,
    gpsAccuracyMeters: accuracy,
    workdayDate: report.workdayDate,
    revisionNumber: report.revisionNumber,
    summary: report.summaryText,
    quantities: [
      {
        materialOrWork: report.boqItem.description,
        quantity: Number(report.reportedQuantity),
        unit: report.unitOfMeasure,
      },
    ],
    blockers: report.delaysOrBlockers ? [report.delaysOrBlockers] : [],
    isHoldPointClaimed: report.isHoldPointClaimed,
    capturedAt: capturedAt.toISOString(),
    confirmedAt: report.humanConfirmedAt ? report.humanConfirmedAt.toISOString() : null,
    integrityPassed,
    integrityFlags: [...integrityFlags],
    signatureVerified,
    media: chainCaptures.map(toMedia).filter((m): m is ProvidedEvidenceMedia => m !== null),
  };
}

/**
 * Report statuses that count as evidence (Phase 7).
 * - Report approval off: CONFIRMED.
 * - Report approval on: APPROVED_COMPLETED. CONFIRMED reports on such a project were accepted before
 *   approval was switched on and finished under those rules (config changes apply to new items
 *   only), so they keep counting; no new CONFIRMED report is created while approval is on.
 * Either way PENDING_APPROVAL, RETURNED_FOR_REVISION and STAGED_UNVERIFIED never count.
 */
export function countedReportStatuses(requireReportApproval: boolean): Array<'CONFIRMED' | 'APPROVED_COMPLETED'> {
  return requireReportApproval ? ['APPROVED_COMPLETED', 'CONFIRMED'] : ['CONFIRMED', 'APPROVED_COMPLETED'];
}

/**
 * Evidence for the given BOQ items confirmed at or before `upTo`, newest first.
 * Items from other projects are never returned, whatever IDs are passed.
 */
export async function getEvidenceForBoqItems(
  projectId: string,
  boqItemIds: string[],
  upTo: Date,
  db: Db = prisma
): Promise<ProvidedEvidenceItem[]> {
  if (boqItemIds.length === 0) return [];
  const config = await getProcessConfig(projectId, db === prisma ? prisma : (db as Prisma.TransactionClient));

  const reports = await db.workdayReport.findMany({
    where: {
      projectId,
      wbsItemId: { in: boqItemIds },
      status: { in: countedReportStatuses(config.requireReportApproval) },
      humanConfirmedAt: { lte: upTo },
    },
    orderBy: [{ humanConfirmedAt: 'desc' }, { revisionNumber: 'desc' }],
    include: REPORT_INCLUDE,
  });

  // Captures of earlier revisions count with the latest counted revision, whatever the earlier
  // revision's own status (e.g. RETURNED_FOR_REVISION): load the ancestors separately.
  const byId = new Map(reports.map((r) => [r.id, r]));
  let missing = reports.map((r) => r.parentReportId).filter((id): id is string => Boolean(id) && !byId.has(id!));
  while (missing.length > 0) {
    const ancestors = await db.workdayReport.findMany({
      where: { id: { in: missing }, projectId },
      include: REPORT_INCLUDE,
    });
    for (const a of ancestors) byId.set(a.id, a);
    missing = ancestors.map((a) => a.parentReportId).filter((id): id is string => Boolean(id) && !byId.has(id!));
  }
  // Superseded: a counted report whose newer revision also counts (within the same window). A newer
  // revision still pending approval leaves the earlier counted one in place.
  const hasNewerRevision = new Set(
    reports.map((r) => r.parentReportId).filter((id): id is string => Boolean(id))
  );

  const items: ProvidedEvidenceItem[] = [];
  for (const report of reports) {
    if (hasNewerRevision.has(report.id)) continue;
    const chainCaptures: CaptureRow[] = [];
    const seen = new Set<string>();
    let cursor: ReportRow | undefined = report;
    while (cursor && !seen.has(cursor.id)) {
      seen.add(cursor.id);
      chainCaptures.push(...cursor.captures);
      cursor = cursor.parentReportId ? byId.get(cursor.parentReportId) : undefined;
    }
    items.push(toEvidenceItem(report, chainCaptures));
  }
  return items;
}

/**
 * Reported (verified but not yet certified) progress per BOQ item, percent of the item's total
 * quantity (Phase 9). Uses the same counted statuses and supersession as reconciliation: a counted
 * report whose newer revision also counts is replaced by it. Report quantities are per period, so
 * they are summed; contractor and verifier reports describe the same work, so each persona is
 * summed separately and the larger total is used. Capped at 100.
 */
export async function getReportedProgressByItem(
  projectId: string,
  items: Array<{ id: string; totalQuantity: number }>,
  db: Db = prisma
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (items.length === 0) return out;
  const config = await getProcessConfig(projectId, db === prisma ? prisma : (db as Prisma.TransactionClient));
  const reports = await db.workdayReport.findMany({
    where: { projectId, wbsItemId: { in: items.map((i) => i.id) }, status: { in: countedReportStatuses(config.requireReportApproval) } },
    select: { id: true, parentReportId: true, wbsItemId: true, reporterPersonaType: true, reportedQuantity: true },
  });
  const superseded = new Set(reports.map((r) => r.parentReportId).filter((id): id is string => Boolean(id)));
  const sums = new Map<string, Map<string, number>>();
  for (const r of reports) {
    if (superseded.has(r.id)) continue;
    const byPersona = sums.get(r.wbsItemId) ?? new Map<string, number>();
    byPersona.set(r.reporterPersonaType, (byPersona.get(r.reporterPersonaType) ?? 0) + Number(r.reportedQuantity));
    sums.set(r.wbsItemId, byPersona);
  }
  for (const item of items) {
    const byPersona = sums.get(item.id);
    const qty = byPersona ? Math.max(...byPersona.values()) : 0;
    out.set(item.id, item.totalQuantity > 0 ? Math.min(100, Math.max(0, (qty / item.totalQuantity) * 100)) : 0);
  }
  return out;
}
