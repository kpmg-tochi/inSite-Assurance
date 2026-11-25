import { z } from 'zod';
import {
  CaptureMediaTypeEnum,
  EvidenceLogStatusEnum,
  FieldPersonaTypeEnum,
  MediaTypeEnum,
  TranscriptionStatusEnum,
  GeofenceStatusEnum,
} from '../enums';

const Sha256HexSchema = z
  .string()
  .regex(/^[0-9a-fA-F]{64}$/, 'sha256 must be 64 hex characters');

/** Compass heading in degrees clockwise from north (UBEC IRL); 360 is accepted and stored as 0. */
export const HeadingDegreesSchema = z.number().min(0).max(360);
export const HeadingReferenceEnum = z.enum(['TRUE', 'MAGNETIC']);

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
  /**
   * UBEC IRL: compass heading of the camera at the shutter, degrees clockwise from north (true north
   * when the phone could compute it, else magnetic). Optional: older clients and phones without a
   * compass send nothing. Not part of the signed canonical string (insite.capture.v1).
   */
  headingDegrees: HeadingDegreesSchema.nullable().optional(),
  signature: DeviceSignatureSchema.nullable().optional(),
  /**
   * Phase 5 Step 8: the clientCaptureId of the same capture queued under a session that has since
   * ended. The capture time and GPS fix are the original's; the server flags the capture
   * RESUBMITTED_AFTER_SESSION_END and links it to the original.
   */
  resubmittedFromClientCaptureId: z.string().uuid().nullable().optional(),
});
export type RegisterCaptureRequest = z.infer<typeof RegisterCaptureRequestSchema>;

/** One capture as returned to field devices and the web portal. */
export const CaptureDtoSchema = z.object({
  id: z.string().uuid(),
  clientCaptureId: z.string().uuid(),
  projectId: z.string().uuid(),
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
  /** Compass heading at the shutter (0-360); null when not recorded. Optional for older readers. */
  headingDegrees: z.number().nullable().optional(),
  isMockLocation: z.boolean(),
  /** null when there was no fix or the geofence could not be evaluated. */
  isWithinGeofence: z.boolean().nullable(),
  /** INSIDE, WITHIN_TOLERANCE or OUTSIDE (Phase 6); null when not evaluated. */
  geofenceStatus: GeofenceStatusEnum.nullable().optional(),
  /** Metres outside the boundary; 0 inside. */
  distanceOutsideMeters: z.number().nullable().optional(),
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
  /** Set when this capture re-submits one queued under an ended session (flag RESUBMITTED_AFTER_SESSION_END). */
  resubmittedFromClientCaptureId: z.string().uuid().nullable().optional(),
});
export type CaptureDto = z.infer<typeof CaptureDtoSchema>;

/** Non-critical flag on a capture re-submitted after the session that captured it ended. */
export const RESUBMITTED_AFTER_SESSION_END_FLAG = 'RESUBMITTED_AFTER_SESSION_END';

/** Integrity flags that make a capture unusable as evidence. */
export const CRITICAL_CAPTURE_FLAGS = [
  'MOCK_GPS_LOCATION_DETECTED',
  'DUPLICATE_PHOTO_SHA256_MATCH',
  'RECYCLED_PHOTO_PHASH_SIMILARITY',
  'SIGNATURE_INVALID',
  'CLIENT_HASH_MISMATCH',
] as const;

/** GET /projects/:projectId/evidence — captures with their reporter. */
export const CaptureListItemDtoSchema = CaptureDtoSchema.extend({
  reporterName: z.string(),
});
export type CaptureListItemDto = z.infer<typeof CaptureListItemDtoSchema>;

/** Device position when the officer confirmed a submission or checked in. The server evaluates the geofence. */
export const SubmissionGeotagInputSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().nonnegative().nullable().optional(),
  altitudeMeters: z.number().nullable().optional(),
  isMocked: z.boolean().default(false),
  capturedAt: z.string().datetime(),
  /** UBEC IRL: compass heading when the position was taken (optional; older clients send none). */
  headingDegrees: HeadingDegreesSchema.nullable().optional(),
  /** TRUE when the phone gave true north, MAGNETIC otherwise. */
  headingReference: HeadingReferenceEnum.nullable().optional(),
  /** OS compass calibration 0-3 (3 = high); null when the OS reports none. */
  headingAccuracyLevel: z.number().int().min(0).max(3).nullable().optional(),
});
export type SubmissionGeotagInput = z.infer<typeof SubmissionGeotagInputSchema>;

/** Stored and returned geotag: input plus the server's geofence result. */
export const SubmissionGeotagSchema = SubmissionGeotagInputSchema.extend({
  isWithinGeofence: z.boolean().nullable(),
  /** INSIDE, WITHIN_TOLERANCE or OUTSIDE (Phase 6); null when not evaluated. */
  geofenceStatus: GeofenceStatusEnum.nullable().optional(),
  /** Metres outside the boundary; 0 inside. */
  distanceOutsideMeters: z.number().nullable().optional(),
  distanceFromSiteMeters: z.number().nonnegative().nullable(),
});
export type SubmissionGeotag = z.infer<typeof SubmissionGeotagSchema>;

/** A capture as shown inside a visit submission, a finding or a site log entry. */
export const CaptureSummarySchema = CaptureDtoSchema.pick({
  id: true,
  clientCaptureId: true,
  mediaType: true,
  objectKey: true,
  mimeType: true,
  caption: true,
  capturedAt: true,
  locationAvailable: true,
  latitude: true,
  longitude: true,
  gpsAccuracyMeters: true,
  headingDegrees: true,
  isMockLocation: true,
  isWithinGeofence: true,
  signatureVerified: true,
  integrityPassed: true,
  integrityFlags: true,
  transcriptionStatus: true,
  transcript: true,
  durationSeconds: true,
  resubmittedFromClientCaptureId: true,
});
export type CaptureSummary = z.infer<typeof CaptureSummarySchema>;
