/**
 * Canonical strings a field device signs with its per-install Ed25519 key (Phase 4).
 *
 * The device signs these exact strings; the server rebuilds them from the request body and verifies.
 * Each canonical form is a JSON array of primitives, so field boundaries are unambiguous and
 * number formatting is the ECMAScript `Number#toString` used by both Hermes and Node.
 * Bump the version tag whenever a field is added, removed or reordered.
 */

export const DEVICE_SIGNATURE_ALGORITHM = 'ED25519' as const;
export type DeviceSignatureAlgorithm = typeof DEVICE_SIGNATURE_ALGORITHM;

type Primitive = string | number | boolean | null;

function canonical(tag: string, fields: Primitive[]): string {
  return JSON.stringify([tag, ...fields]);
}

function num(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export interface CaptureSignatureFields {
  clientCaptureId: string;
  projectId: string;
  mediaType: string;
  sha256: string;
  byteSize: number;
  capturedAt: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  isMockLocation: boolean;
}

export function canonicalCaptureString(f: CaptureSignatureFields): string {
  return canonical('insite.capture.v1', [
    f.clientCaptureId,
    f.projectId,
    f.mediaType,
    f.sha256.toLowerCase(),
    f.byteSize,
    f.capturedAt,
    num(f.latitude),
    num(f.longitude),
    num(f.accuracyMeters),
    f.isMockLocation,
  ]);
}
