import { z } from 'zod';
import { GeofenceModeEnum } from '../enums';

/**
 * Geographic Coordinate Validation (WGS84)
 */
export const GeoCoordinateSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});
export type GeoCoordinate = z.infer<typeof GeoCoordinateSchema>;

/**
 * GeoJSON Position Tuple: [longitude, latitude]
 */
export const LonLatTupleSchema = z.tuple([
  z.number().min(-180).max(180), // longitude
  z.number().min(-90).max(90),   // latitude
]);
export type LonLatTuple = z.infer<typeof LonLatTupleSchema>;

/**
 * 1. Radial Geofence (Point Radius)
 * Used for buildings, plants, substations, or industrial sites (e.g., 300m radius).
 */
export const RadialGeofenceSchema = z.object({
  mode: z.literal('RADIAL'),
  center: GeoCoordinateSchema,
  radiusMeters: z.number().min(20).max(50000),
  siteLabel: z.string().min(1).max(120).optional(),
});
export type RadialGeofence = z.infer<typeof RadialGeofenceSchema>;

/**
 * 2. Linear Corridor / Chainage Geofence
 * Used for roads, pipelines, drainage channels, transmission lines, and mini-grids.
 * Coordinates are stored in GeoJSON [longitude, latitude] order along the centerline.
 */
export const LinearCorridorGeofenceSchema = z.object({
  mode: z.literal('LINEAR_CORRIDOR'),
  centerlineCoordinates: z.array(LonLatTupleSchema).min(2),
  corridorHalfWidthMeters: z.number().min(10).max(5000), // e.g., 100m on each side of road centerline
  startChainageKm: z.number().min(0).default(0),         // e.g., 0 for KM 0+000 or 12.5 for KM 12+500
  corridorLabel: z.string().min(1).max(120).optional(),
});
export type LinearCorridorGeofence = z.infer<typeof LinearCorridorGeofenceSchema>;

/**
 * Discriminated Union for Project Geofence JSONB Column
 */
export const ProjectGeofenceSchema = z.discriminatedUnion('mode', [
  RadialGeofenceSchema,
  LinearCorridorGeofenceSchema,
]);
export type ProjectGeofence = z.infer<typeof ProjectGeofenceSchema>;

/**
 * Output of On-Device (Mobile) & Backend (Server) Turf.js Geofence Verification
 */
export const GeofenceVerificationResultSchema = z.object({
  mode: GeofenceModeEnum,
  isWithinGeofence: z.boolean(),
  distanceFromCenterOrLineMeters: z.number(),
  allowedThresholdMeters: z.number(),
  chainageKm: z.number().nullable(),
  chainageFormatted: z.string().nullable(), // e.g. "KM 14+200"
  corridorOffsetMeters: z.number().nullable(),
  verificationBadgeText: z.string(),        // e.g. "📍 Corridor Verified (Chainage KM 14+200)"
});
export type GeofenceVerificationResult = z.infer<typeof GeofenceVerificationResultSchema>;

