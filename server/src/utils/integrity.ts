import sharp from 'sharp';
import { Prisma, PrismaClient } from '@prisma/client';
import { CRITICAL_CAPTURE_FLAGS } from '@insite/shared';

/**
 * Capture integrity screening (Phase 4). Every input here is computed by the server from stored
 * bytes or server-side evaluation; nothing the client asserts about hashes is trusted.
 */

type Db = Prisma.TransactionClient | PrismaClient;

/** Hamming distance at or below which two difference hashes count as the same picture. */
export const PHASH_NEAR_DUPLICATE_MAX_DISTANCE = 6;
/** A near-duplicate of the same reporter's own capture within this window is a burst, not reuse. */
export const OWN_BURST_WINDOW_MS = 6 * 60 * 60 * 1000;
export const LOW_GPS_ACCURACY_METERS = 150;
export const MAX_FUTURE_CLOCK_DRIFT_MS = 15 * 60 * 1000;

/** Hamming distance between two 16-hex-character (64-bit) hashes. */
export function computeHexHammingDistance(hashA: string, hashB: string): number {
  if (hashA.length !== hashB.length) return 64;
  let distance = 0;
  for (let i = 0; i < hashA.length; i++) {
    let xor = parseInt(hashA[i], 16) ^ parseInt(hashB[i], 16);
    while (xor) {
      distance += xor & 1;
      xor >>= 1;
    }
  }
  return distance;
}

/**
 * 64-bit difference hash (dHash) of an image: orient by EXIF, greyscale, shrink to 9x8 and record
 * whether each pixel is brighter than its right neighbour. Robust to resizing and recompression.
 * Returns null when the bytes cannot be decoded as an image.
 */
export async function computeDifferenceHash(bytes: Buffer): Promise<string | null> {
  try {
    const { data } = await sharp(bytes, { failOn: 'none' })
      .rotate()
      .greyscale()
      .resize(9, 8, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    let hex = '';
    for (let row = 0; row < 8; row++) {
      let nibbleHigh = 0;
      let nibbleLow = 0;
      for (let col = 0; col < 8; col++) {
        const bit = data[row * 9 + col] > data[row * 9 + col + 1] ? 1 : 0;
        if (col < 4) nibbleHigh = (nibbleHigh << 1) | bit;
        else nibbleLow = (nibbleLow << 1) | bit;
      }
      hex += nibbleHigh.toString(16) + nibbleLow.toString(16);
    }
    return hex;
  } catch {
    return null;
  }
}

export interface DuplicateMatch {
  evidenceLogId: string;
  projectId: string;
  fieldSessionId: string;
  capturedAtDevice: Date;
  distance: number;
}

/** Exact byte matches (server SHA-256) within the tenant. Indexed on (tenantId, sha256FileHash). */
export async function findExactDuplicates(
  db: Db,
  params: { tenantId: string; sha256: string; excludeEvidenceLogId?: string }
): Promise<DuplicateMatch[]> {
  const rows = await db.evidenceMedia.findMany({
    where: {
      tenantId: params.tenantId,
      sha256FileHash: params.sha256,
      ...(params.excludeEvidenceLogId ? { NOT: { evidenceLogId: params.excludeEvidenceLogId } } : {}),
    },
    select: {
      evidenceLogId: true,
      projectId: true,
      evidenceLog: { select: { fieldSessionId: true, capturedAtDevice: true } },
    },
    take: 5,
  });
  return rows.map((r) => ({
    evidenceLogId: r.evidenceLogId,
    projectId: r.projectId,
    fieldSessionId: r.evidenceLog.fieldSessionId,
    capturedAtDevice: r.evidenceLog.capturedAtDevice,
    distance: 0,
  }));
}

/**
 * Visually similar site photos within the tenant: Hamming distance computed in Postgres with
 * bit_count over the 64-bit hashes, filtered by the (tenantId, mediaType) index. No row window.
 */
export async function findSimilarPhotos(
  db: Db,
  params: { tenantId: string; perceptualHash: string; excludeEvidenceLogId?: string }
): Promise<DuplicateMatch[]> {
  if (!/^[0-9a-f]{16}$/.test(params.perceptualHash)) return [];
  const exclude = params.excludeEvidenceLogId ?? '00000000-0000-0000-0000-000000000000';
  const rows = await db.$queryRaw<
    Array<{ evidenceLogId: string; projectId: string; fieldSessionId: string; capturedAtDevice: Date; distance: number }>
  >`
    SELECT m."evidenceLogId", m."projectId", l."fieldSessionId", l."capturedAtDevice",
           bit_count(('x' || m."perceptualHash")::bit(64) # ('x' || ${params.perceptualHash})::bit(64))::int AS distance
    FROM "EvidenceMedia" m
    JOIN "FieldEvidenceLog" l ON l.id = m."evidenceLogId"
    WHERE m."tenantId" = ${params.tenantId}::uuid
      AND m."mediaType" = 'SITE_PHOTO'
      AND m."perceptualHash" IS NOT NULL
      AND m."evidenceLogId" <> ${exclude}::uuid
      AND bit_count(('x' || m."perceptualHash")::bit(64) # ('x' || ${params.perceptualHash})::bit(64)) <= ${PHASH_NEAR_DUPLICATE_MAX_DISTANCE}
    ORDER BY distance ASC
    LIMIT 5
  `;
  return rows;
}

export interface CaptureScreeningInput {
  tenantId: string;
  fieldSessionId: string;
  mediaType: string;
  serverSha256: string;
  clientSha256: string;
  perceptualHash: string | null;
  capturedAt: Date;
  locationAvailable: boolean;
  isMockLocation: boolean;
  gpsAccuracyMeters: number | null;
  geofenceFlag: string | null;
  signatureFlag: string | null;
  /**
   * Captures this one may legitimately duplicate: the original of a re-submission (Phase 5
   * Step 8). Matches against them are not reuse.
   */
  allowedDuplicateOf?: string[];
}

export interface CaptureScreeningResult {
  integrityPassed: boolean;
  integrityFlags: string[];
  duplicateOf: DuplicateMatch[];
}

export async function screenCapture(
  db: Db,
  input: CaptureScreeningInput
): Promise<CaptureScreeningResult> {
  const flags: string[] = [];
  const duplicateOf: DuplicateMatch[] = [];

  if (input.isMockLocation) flags.push('MOCK_GPS_LOCATION_DETECTED');
  if (!input.locationAvailable) flags.push('LOCATION_UNAVAILABLE');
  if (input.gpsAccuracyMeters !== null && input.gpsAccuracyMeters > LOW_GPS_ACCURACY_METERS) {
    flags.push('LOW_GPS_ACCURACY');
  }
  if (input.geofenceFlag && input.geofenceFlag !== 'LOCATION_UNAVAILABLE') flags.push(input.geofenceFlag);
  if (input.capturedAt.getTime() - Date.now() > MAX_FUTURE_CLOCK_DRIFT_MS) {
    flags.push('DEVICE_CLOCK_FUTURE_DRIFT');
  }
  if (input.signatureFlag) flags.push(input.signatureFlag);
  if (input.clientSha256.toLowerCase() !== input.serverSha256) flags.push('CLIENT_HASH_MISMATCH');

  const allowed = new Set(input.allowedDuplicateOf ?? []);
  const exact = (await findExactDuplicates(db, { tenantId: input.tenantId, sha256: input.serverSha256 })).filter(
    (m) => !allowed.has(m.evidenceLogId)
  );
  if (exact.length > 0) {
    flags.push('DUPLICATE_PHOTO_SHA256_MATCH');
    duplicateOf.push(...exact);
  } else if (input.mediaType === 'SITE_PHOTO' && input.perceptualHash) {
    const similar = (
      await findSimilarPhotos(db, {
        tenantId: input.tenantId,
        perceptualHash: input.perceptualHash,
      })
    ).filter((m) => !allowed.has(m.evidenceLogId));
    const reused = similar.filter(
      (m) =>
        m.fieldSessionId !== input.fieldSessionId ||
        Math.abs(m.capturedAtDevice.getTime() - input.capturedAt.getTime()) > OWN_BURST_WINDOW_MS
    );
    if (reused.length > 0) {
      flags.push('RECYCLED_PHOTO_PHASH_SIMILARITY');
      duplicateOf.push(...reused);
    } else if (similar.length > 0) {
      flags.push('SIMILAR_TO_RECENT_OWN_CAPTURE');
    }
  }

  const critical = flags.some((f) => (CRITICAL_CAPTURE_FLAGS as readonly string[]).includes(f));
  return { integrityPassed: !critical, integrityFlags: flags, duplicateOf };
}
