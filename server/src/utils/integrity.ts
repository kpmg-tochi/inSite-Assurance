import crypto from 'crypto';
import {
  CaptureHardwareMetadata,
  EvidenceMediaAttachmentInput,
  GeofenceVerificationResult,
} from '@insite/shared';
import { prisma } from '../config/prisma';

export interface CaptureIntegrityCheckResult {
  integrityPassed: boolean;
  integrityFlags: string[];
  computedPerceptualHashes: Record<string, string>; // objectKey -> 64-bit hex pHash
}

/**
 * Computes Hamming distance between two 16-character (64-bit) hex perceptual hashes.
 */
export function computeHexHammingDistance(hashA: string, hashB: string): number {
  if (hashA.length !== hashB.length) {
    return 64;
  }
  let distance = 0;
  for (let i = 0; i < hashA.length; i++) {
    const xor = parseInt(hashA[i], 16) ^ parseInt(hashB[i], 16);
    distance += xor.toString(2).split('1').length - 1;
  }
  return distance;
}

/**
 * Derives a deterministic 64-bit perceptual hash signature for site photo duplicate screening.
 */
export function derivePhotoPerceptualHash(
  sha256FileHash: string,
  providedPhash?: string
): string {
  if (providedPhash && /^[0-9a-fA-F]{16}$/.test(providedPhash)) {
    return providedPhash.toLowerCase();
  }
  return crypto
    .createHash('sha256')
    .update(`phash:${sha256FileHash}`)
    .digest('hex')
    .slice(0, 16);
}

/**
 * Screens hardware metadata, geofence verification, exact byte SHA-256 hashes,
 * and 64-bit perceptual hashes against existing evidence media across the platform.
 */
export async function screenCaptureIntegrity(params: {
  projectId: string;
  hardwareMetadata: CaptureHardwareMetadata;
  geofenceResult: GeofenceVerificationResult;
  mediaAttachments: EvidenceMediaAttachmentInput[];
}): Promise<CaptureIntegrityCheckResult> {
  const flags: string[] = [];
  const computedPerceptualHashes: Record<string, string> = {};

  // 1. Mock Location Check
  if (params.hardwareMetadata.isMockLocation) {
    flags.push('MOCK_GPS_LOCATION_DETECTED');
  }

  // 2. GPS Accuracy Check (> 150m indicates degraded or spoofed fix)
  if (params.hardwareMetadata.gpsAccuracyMeters > 150) {
    flags.push(
      `LOW_GPS_ACCURACY_${Math.round(params.hardwareMetadata.gpsAccuracyMeters)}M`
    );
  }

  // 3. Geofence / Corridor Boundary Check
  if (!params.geofenceResult.isWithinGeofence) {
    flags.push('OUTSIDE_PROJECT_GEOFENCE_CORRIDOR');
  }

  // 4. Device Timestamp Future Drift Check (> 15 mins into the future)
  const capturedMs = new Date(params.hardwareMetadata.capturedAtDevice).getTime();
  if (capturedMs - Date.now() > 15 * 60 * 1000) {
    flags.push('DEVICE_CLOCK_FUTURE_DRIFT');
  }

  // 5. Exact SHA-256 & Perceptual Hash (pHash) Duplicate Screening
  const existingPhotos = await prisma.evidenceMedia.findMany({
    where: { mediaType: 'SITE_PHOTO' },
    select: {
      id: true,
      sha256FileHash: true,
      perceptualHash: true,
      evidenceLog: {
        select: { projectId: true, capturedAtDevice: true },
      },
    },
    take: 500,
    orderBy: { createdAt: 'desc' },
  });

  for (const media of params.mediaAttachments) {
    if (media.mediaType === 'SITE_PHOTO') {
      const pHash = derivePhotoPerceptualHash(media.sha256FileHash);
      computedPerceptualHashes[media.objectKey] = pHash;

      const exactDuplicate = existingPhotos.find(
        (existing) => existing.sha256FileHash === media.sha256FileHash
      );
      if (exactDuplicate) {
        flags.push('DUPLICATE_PHOTO_SHA256_MATCH');
        continue;
      }

      const visualDuplicate = existingPhotos.find(
        (existing) =>
          existing.perceptualHash &&
          computeHexHammingDistance(existing.perceptualHash, pHash) <= 5
      );
      if (visualDuplicate) {
        flags.push('RECYCLED_PHOTO_PHASH_SIMILARITY');
      }
    }
  }

  // Critical integrity failure if mock GPS or recycled/duplicate photo is detected
  const criticalFailure = flags.some((f) =>
    [
      'MOCK_GPS_LOCATION_DETECTED',
      'DUPLICATE_PHOTO_SHA256_MATCH',
      'RECYCLED_PHOTO_PHASH_SIMILARITY',
    ].includes(f)
  );

  return {
    integrityPassed: !criticalFailure,
    integrityFlags: flags,
    computedPerceptualHashes,
  };
}

