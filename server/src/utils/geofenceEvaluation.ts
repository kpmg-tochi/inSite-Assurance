import { ProjectGeofenceSchema, verifyPointAgainstGeofence } from '@insite/shared';

/**
 * The one geofence evaluation used by captures, telemetry and workday reports (Phase 4).
 *
 * The result is always the server's own computation. When there is no fix, the stored geofence is
 * invalid, or evaluation throws, `isWithinGeofence` is null and a flag says why. The client's claim
 * is never kept.
 */
export interface GeofenceEvaluation {
  isWithinGeofence: boolean | null;
  chainageKm: number | null;
  chainageLabel: string | null;
  corridorOffsetMeters: number | null;
  distanceFromSiteMeters: number | null;
  flag: 'LOCATION_UNAVAILABLE' | 'GEOFENCE_UNAVAILABLE' | 'OUTSIDE_PROJECT_GEOFENCE' | null;
}

const UNKNOWN = {
  isWithinGeofence: null,
  chainageKm: null,
  chainageLabel: null,
  corridorOffsetMeters: null,
  distanceFromSiteMeters: null,
} as const;

export function evaluateGeofence(
  geofenceGeoJson: unknown,
  point: { latitude: number; longitude: number } | null | undefined
): GeofenceEvaluation {
  if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
    return { ...UNKNOWN, flag: 'LOCATION_UNAVAILABLE' };
  }
  const parsed = ProjectGeofenceSchema.safeParse(geofenceGeoJson);
  if (!parsed.success) {
    return { ...UNKNOWN, flag: 'GEOFENCE_UNAVAILABLE' };
  }
  try {
    const result = verifyPointAgainstGeofence(point, parsed.data);
    return {
      isWithinGeofence: result.isWithinGeofence,
      chainageKm: result.chainageKm,
      chainageLabel: result.chainageFormatted,
      corridorOffsetMeters: result.corridorOffsetMeters,
      distanceFromSiteMeters: result.distanceFromCenterOrLineMeters,
      flag: result.isWithinGeofence ? null : 'OUTSIDE_PROJECT_GEOFENCE',
    };
  } catch {
    return { ...UNKNOWN, flag: 'GEOFENCE_UNAVAILABLE' };
  }
}
