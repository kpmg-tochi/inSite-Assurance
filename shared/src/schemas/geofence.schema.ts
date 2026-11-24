import { z } from 'zod';
import { GeofenceModeEnum, GeofenceStatusEnum } from '../enums';
import { closeRing, isRingSelfIntersecting, openRing } from '../geo/polygon';

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

export const PERIMETER_MAX_VERTICES = 500;

/**
 * Perimeter ring: at least 3 distinct vertices, at most 500, no self-intersection. Stored closed
 * (first vertex repeated at the end); an open ring is closed on parse.
 */
export const PerimeterRingSchema = z
  .array(LonLatTupleSchema)
  .transform((ring) => closeRing(ring as [number, number][]) as [number, number][])
  .superRefine((ring, ctx) => {
    const distinct = openRing(ring);
    if (distinct.length < 3) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'A perimeter needs at least 3 points' });
      return;
    }
    if (distinct.length > PERIMETER_MAX_VERTICES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `A perimeter can have at most ${PERIMETER_MAX_VERTICES} points`,
      });
      return;
    }
    if (isRingSelfIntersecting(ring)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'The perimeter crosses itself. Move the points so the edges do not cross.',
      });
    }
  });

/**
 * 2. Perimeter (polygon) Geofence (Phase 6)
 * Used for irregular sites: estates, campuses, farms, dams. Coordinates are [longitude, latitude].
 * Tolerance is not part of the shape: it is the project's general geofence tolerance.
 */
export const PerimeterGeofenceSchema = z.object({
  mode: z.literal('PERIMETER'),
  perimeterCoordinates: PerimeterRingSchema,
  siteLabel: z.string().min(1).max(120).optional(),
});
export type PerimeterGeofence = z.infer<typeof PerimeterGeofenceSchema>;

/**
 * Discriminated Union for Project Geofence JSONB Column
 */
export const ProjectGeofenceSchema = z.discriminatedUnion('mode', [
  RadialGeofenceSchema,
  PerimeterGeofenceSchema,
]);
export type ProjectGeofence = z.infer<typeof ProjectGeofenceSchema>;
/** The shape as typed by a client, before the ring is closed. */
export type ProjectGeofenceInput = z.input<typeof ProjectGeofenceSchema>;

/** Tenant default and project override for the tolerance band outside every boundary. */
export const GeofenceToleranceMetersSchema = z.number().int().min(0).max(1000);
export const DEFAULT_GEOFENCE_TOLERANCE_METERS = 100;

/**
 * Workspace default radius of a radial site boundary: it pre-fills a new radial boundary and the one
 * created from the needs-assessment workbook's GPS point. Each project sets its own radius on the
 * Site step.
 */
export const GeofenceRadiusMetersSchema = z.number().int().min(20).max(50000);
export const DEFAULT_GEOFENCE_RADIUS_METERS = 150;

/**
 * Output of On-Device (Mobile) & Backend (Server) geofence verification.
 *
 * `status` is the canonical result. `isWithinGeofence` is kept for older readers and is true for
 * INSIDE and WITHIN_TOLERANCE.
 */
export const GeofenceVerificationResultSchema = z.object({
  mode: GeofenceModeEnum,
  status: GeofenceStatusEnum,
  isWithinGeofence: z.boolean(),
  /** Tolerance band applied, in metres. */
  toleranceMeters: z.number(),
  /** 0 when inside the boundary; otherwise how far outside it the point is. */
  distanceOutsideMeters: z.number(),
  /** Distance to the nearest point of the boundary, inside or outside. */
  distanceToBoundaryMeters: z.number(),
  /** Radial: distance from the centre. Perimeter: same as distanceToBoundaryMeters. */
  distanceFromCenterOrLineMeters: z.number(),
  allowedThresholdMeters: z.number(),
  verificationBadgeText: z.string(),
});
export type GeofenceVerificationResult = z.infer<typeof GeofenceVerificationResultSchema>;

/** Lat/lng bounding box for fitting a map. */
export interface GeofenceBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}
