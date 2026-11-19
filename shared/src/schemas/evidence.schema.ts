import { z } from 'zod';
import {
  CaptureMediaTypeEnum,
  EvidenceLogStatusEnum,
  FieldPersonaTypeEnum,
  MediaTypeEnum,
  TranscriptionStatusEnum,
} from '../enums';

/**
 * Extracted material / work quantity (used by the optional summary assist).
 * e.g. { materialOrWork: "bags of cement", quantity: 40, unit: "bags" }
 */
export const ExtractedQuantityItemSchema = z.object({
  materialOrWork: z.string().min(1).max(160),
  quantity: z.number().nonnegative(),
  unit: z.string().min(1).max(32),
  boqWbsCodeHint: z.string().nullable().optional(),
});
export type ExtractedQuantityItem = z.infer<typeof ExtractedQuantityItemSchema>;

/** Structured output of the AI extraction model (summary assist only; never stored as evidence). */
export const AiFieldNoteExtractionSchema = z.object({
  normalizedSummary: z.string(),
  extractedQuantities: z.array(ExtractedQuantityItemSchema),
  siteBlockers: z.array(z.string()),
  matchedBoqWbsCodes: z.array(z.string()),
  visionObservationSummary: z.string().nullable(),
});
export type AiFieldNoteExtraction = z.infer<typeof AiFieldNoteExtractionSchema>;

const Sha256HexSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, 'sha256 must be 64 hex characters');

/** Base64 Ed25519 signature over the canonical string (see utils/deviceSignature). */
export const DeviceSignatureSchema = z.string().min(64).max(200);

/** GPS fix at the moment of capture. `null` on the request means the device had no fix. */
export const CaptureLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().nonnegative().nullable(),
  altitudeMeters: z.number().nullable().optional(),
});
export type CaptureLocation = z.infer<typeof CaptureLocationSchema>;

/**
 * POST /projects/:projectId/captures
 * Registers one uploaded photo, voice note or document. Idempotent on `clientCaptureId`.
 */
export const RegisterCaptureRequestSchema = z.object({
  clientCaptureId: z.string().uuid(),
  wbsItemId: z.string().uuid().nullable().optional(),
  mediaType: CaptureMediaTypeEnum,
  objectKey: z.string().min(3).max(512),
  mimeType: z.string().min(3).max(80),
  byteSize: z.number().int().positive(),
  /** Device-computed hash of the file bytes. The server recomputes it and flags a mismatch. */
  sha256: Sha256HexSchema,
  durationSeconds: z.number().nonnegative().nullable().optional(),
  capturedAt: z.string().datetime(),
  location: CaptureLocationSchema.nullable(),
  isMockLocation: z.boolean().default(false),
  caption: z.string().max(500).nullable().optional(),
  devicePitchDeg: z.number().nullable().optional(),
  deviceRollDeg: z.number().nullable().optional(),
  deviceAzimuthDeg: z.number().nullable().optional(),
  signature: DeviceSignatureSchema.nullable().optional(),
});
export type RegisterCaptureRequest = z.infer<typeof RegisterCaptureRequestSchema>;

/** One capture as returned to field devices and the web portal. */
export const CaptureDtoSchema = z.object({
  id: z.string().uuid(),
  clientCaptureId: z.string().uuid(),
  projectId: z.string().uuid(),
  wbsItemId: z.string().uuid().nullable(),
  workdayReportId: z.string().uuid().nullable(),
  fieldSessionId: z.string().uuid(),
  status: EvidenceLogStatusEnum,
  mediaType: MediaTypeEnum,
  objectKey: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int(),
  durationSeconds: z.number().nullable(),
  caption: z.string().nullable(),
  capturedAt: z.string().datetime(),
  registeredAt: z.string().datetime(),
  locationAvailable: z.boolean(),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
  gpsAccuracyMeters: z.number().nullable(),
  isMockLocation: z.boolean(),
  /** null when there was no fix or the geofence could not be evaluated. */
  isWithinGeofence: z.boolean().nullable(),
  chainageLabel: z.string().nullable(),
  distanceFromSiteMeters: z.number().nullable(),
  /** true = valid device signature, false = invalid, null = unsigned or no key registered. */
  signatureVerified: z.boolean().nullable(),
  serverSha256: z.string().nullable(),
  perceptualHash: z.string().nullable(),
  integrityPassed: z.boolean(),
  integrityFlags: z.array(z.string()),
  transcriptionStatus: TranscriptionStatusEnum,
  transcript: z.string().nullable(),
  reporterRoleName: z.string(),
  fieldPersonaType: FieldPersonaTypeEnum,
});
export type CaptureDto = z.infer<typeof CaptureDtoSchema>;

/** A report position less accurate than this gets the LOW_GPS_ACCURACY badge (not a failure). */
export const REPORT_LOW_GPS_ACCURACY_METERS = 50;

/** Integrity flags that make a capture unusable as evidence. */
export const CRITICAL_CAPTURE_FLAGS = [
  'MOCK_GPS_LOCATION_DETECTED',
  'DUPLICATE_PHOTO_SHA256_MATCH',
  'RECYCLED_PHOTO_PHASH_SIMILARITY',
  'SIGNATURE_INVALID',
  'CLIENT_HASH_MISMATCH',
] as const;

/** GET /projects/:projectId/evidence — captures with their WBS item and reporter. */
export const CaptureListItemDtoSchema = CaptureDtoSchema.extend({
  wbsCode: z.string().nullable(),
  wbsDescription: z.string().nullable(),
  reporterName: z.string(),
});
export type CaptureListItemDto = z.infer<typeof CaptureListItemDtoSchema>;
