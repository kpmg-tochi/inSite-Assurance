import { z } from 'zod';

export const TelemetryPingSourceEnum = z.enum([
  'HOURLY_TELEMETRY',
  'REPORT_SUBMISSION',
  'MANUAL_CHECKIN',
]);
export type TelemetryPingSource = z.infer<typeof TelemetryPingSourceEnum>;

export const TelemetryPingInputSchema = z.object({
  id: z.string().min(4).max(128).optional(),
  wbsItemId: z.string().uuid().nullable().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyMeters: z.number().nonnegative().nullable().optional(),
  altitudeMeters: z.number().nullable().optional(),
  isMocked: z.boolean().default(false),
  isWithinGeofence: z.boolean().nullable().optional(),
  chainageLabel: z.string().max(120).nullable().optional(),
  distanceMeters: z.number().nonnegative().nullable().optional(),
  pingSource: TelemetryPingSourceEnum.default('HOURLY_TELEMETRY'),
  deviceSignatureHash: z.string().min(16).max(256),
  capturedAt: z.string().datetime(),
});
export type TelemetryPingInput = z.infer<typeof TelemetryPingInputSchema>;

export const CreateTelemetryBatchSchema = z.object({
  pings: z.array(TelemetryPingInputSchema).min(1).max(100),
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
  chainageLabel: z.string().nullable(),
  distanceMeters: z.number().nullable(),
  pingSource: TelemetryPingSourceEnum,
  deviceSignatureHash: z.string(),
  capturedAtDevice: z.string().datetime(),
  syncedAtServer: z.string().datetime(),
});
export type SiteTelemetryPingDto = z.infer<typeof SiteTelemetryPingDtoSchema>;

