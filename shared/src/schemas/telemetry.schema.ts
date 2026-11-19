import { z } from 'zod';
import { GeofenceStatusEnum } from '../enums';

/**
 * D-4.3: presence is recorded only while the app is open, plus one ping per capture and report.
 */
export const TelemetryPingSourceEnum = z.enum([
  'FOREGROUND_PRESENCE',
  'CAPTURE',
  'REPORT_SUBMISSION',
  'MANUAL_CHECKIN',
]);
export type TelemetryPingSource = z.infer<typeof TelemetryPingSourceEnum>;

/** Geofence fields are computed by the server; the device never asserts them. */
export const TelemetryPingInputSchema = z.object({
  clientPingId: z.string().uuid(),
  wbsItemId: z.string().uuid().nullable().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().nonnegative().nullable().optional(),
  altitudeMeters: z.number().nullable().optional(),
  isMocked: z.boolean().default(false),
  pingSource: TelemetryPingSourceEnum.default('FOREGROUND_PRESENCE'),
  capturedAt: z.string().datetime(),
  signature: z.string().min(64).max(200).nullable().optional(),
});
export type TelemetryPingInput = z.infer<typeof TelemetryPingInputSchema>;

export const CreateTelemetryBatchSchema = z.object({
  // Large offline backlogs are accepted; the server writes them in chunks.
  pings: z.array(TelemetryPingInputSchema).min(1).max(2000),
});
export type CreateTelemetryBatch = z.infer<typeof CreateTelemetryBatchSchema>;

export const SiteTelemetryPingDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  fieldSessionId: z.string().uuid(),
  agentName: z.string(),
  agentTier: z.string(),
  wbsItemId: z.string().uuid().nullable(),
  latitude: z.number(),
  longitude: z.number(),
  accuracyMeters: z.number().nullable(),
  altitudeMeters: z.number().nullable(),
  isMocked: z.boolean(),
  isWithinGeofence: z.boolean().nullable(),
  /** INSIDE, WITHIN_TOLERANCE or OUTSIDE (Phase 6); null when not evaluated. */
  geofenceStatus: GeofenceStatusEnum.nullable().optional(),
  /** Metres outside the boundary; 0 inside. */
  distanceOutsideMeters: z.number().nullable().optional(),
  chainageLabel: z.string().nullable(),
  distanceMeters: z.number().nullable(),
  pingSource: TelemetryPingSourceEnum,
  signatureVerified: z.boolean().nullable(),
  capturedAtDevice: z.string().datetime(),
  syncedAtServer: z.string().datetime(),
});
export type SiteTelemetryPingDto = z.infer<typeof SiteTelemetryPingDtoSchema>;

