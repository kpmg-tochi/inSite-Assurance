import { GeofenceStatus, ProjectGeofenceSchema, verifyPointAgainstGeofence } from '@insite/shared';

/**
 * The one geofence evaluation used by captures, visit check-ins and submissions (Phase 4), with the
 * project's tolerance band (Phase 6).
 *
 * The result is always the server's own computation. When there is no fix, the stored geofence is
 * invalid, or evaluation throws, `isWithinGeofence` and `geofenceStatus` are null and a flag says
 * why. The client's claim is never kept.
 *
 * `isWithinGeofence` is true for INSIDE and WITHIN_TOLERANCE so readers written before Phase 6
 * treat a position within tolerance as valid.
 */
export interface GeofenceEvaluation {
  isWithinGeofence: boolean | null;
  geofenceStatus: GeofenceStatus | null;
  /** Metres outside the boundary (0 when inside); null when not evaluated. */
  distanceOutsideMeters: number | null;
  distanceFromSiteMeters: number | null;
  flag:
    | 'LOCATION_UNAVAILABLE'
    | 'GEOFENCE_UNAVAILABLE'
    | 'OUTSIDE_PROJECT_GEOFENCE'
    | 'WITHIN_GEOFENCE_TOLERANCE'
    | null;
}

const UNKNOWN = {
  isWithinGeofence: null,
  geofenceStatus: null,
  distanceOutsideMeters: null,
  distanceFromSiteMeters: null,
} as const;

/** The project's override, or the tenant default. */
export function effectiveToleranceMeters(
  project: { geofenceToleranceMeters: number | null },
  tenant: { defaultGeofenceToleranceMeters: number }
): number {
  return project.geofenceToleranceMeters ?? tenant.defaultGeofenceToleranceMeters;
}

/** Prisma select fragment for what evaluateGeofence needs from a project. */
export const GEOFENCE_CONTEXT_SELECT = {
  geofenceGeoJson: true,
  geofenceToleranceMeters: true,
  tenant: { select: { defaultGeofenceToleranceMeters: true } },
} as const;

export function evaluateGeofence(
  geofenceGeoJson: unknown,
  point: { latitude: number; longitude: number } | null | undefined,
  toleranceMeters = 0
): GeofenceEvaluation {
  if (!point || !Number.isFinite(point.latitude) || !Number.isFinite(point.longitude)) {
    return { ...UNKNOWN, flag: 'LOCATION_UNAVAILABLE' };
  }
  const parsed = ProjectGeofenceSchema.safeParse(geofenceGeoJson);
  if (!parsed.success) {
    return { ...UNKNOWN, flag: 'GEOFENCE_UNAVAILABLE' };
  }
  try {
    const result = verifyPointAgainstGeofence(point, parsed.data, toleranceMeters);
    return {
      isWithinGeofence: result.status !== 'OUTSIDE',
      geofenceStatus: result.status,
      distanceOutsideMeters: result.distanceOutsideMeters,
      distanceFromSiteMeters: result.distanceFromCenterOrLineMeters,
      flag:
        result.status === 'OUTSIDE'
          ? 'OUTSIDE_PROJECT_GEOFENCE'
          : result.status === 'WITHIN_TOLERANCE'
            ? 'WITHIN_GEOFENCE_TOLERANCE'
            : null,
    };
  } catch {
    return { ...UNKNOWN, flag: 'GEOFENCE_UNAVAILABLE' };
  }
}

/** Evaluates against a project row loaded with GEOFENCE_CONTEXT_SELECT. */
export function evaluateProjectGeofence(
  project: {
    geofenceGeoJson: unknown;
    geofenceToleranceMeters: number | null;
    tenant: { defaultGeofenceToleranceMeters: number };
  },
  point: { latitude: number; longitude: number } | null | undefined
): GeofenceEvaluation {
  return evaluateGeofence(project.geofenceGeoJson, point, effectiveToleranceMeters(project, project.tenant));
}
