import type { GeofenceStatus } from '@insite/shared';

export type GeofenceStatusTone = 'inside' | 'tolerance' | 'outside' | 'unknown';

export interface GeofenceStatusDisplay {
  tone: GeofenceStatusTone;
  text: string;
}

/**
 * Display text for a server geofence result. Uses `geofenceStatus` (Phase 6) when present and
 * falls back to the older `isWithinGeofence` boolean for data recorded before tolerance existed.
 */
export function describeGeofenceStatus(
  status: GeofenceStatus | null | undefined,
  isWithinGeofence: boolean | null | undefined,
  distanceOutsideMeters?: number | null,
  unknownText = 'Geofence not evaluated'
): GeofenceStatusDisplay {
  if (status === 'INSIDE') return { tone: 'inside', text: 'Inside geofence' };
  if (status === 'WITHIN_TOLERANCE') {
    return {
      tone: 'tolerance',
      text:
        typeof distanceOutsideMeters === 'number' && Number.isFinite(distanceOutsideMeters)
          ? `Within tolerance (${Math.round(distanceOutsideMeters)} m outside)`
          : 'Within tolerance',
    };
  }
  if (status === 'OUTSIDE') return { tone: 'outside', text: 'Outside geofence' };
  if (isWithinGeofence === true) return { tone: 'inside', text: 'Inside geofence' };
  if (isWithinGeofence === false) return { tone: 'outside', text: 'Outside geofence' };
  return { tone: 'unknown', text: unknownText };
}

/** Pill classes per tone, matching the existing emerald / amber / rose status chips. */
export const GEOFENCE_TONE_CHIP: Record<GeofenceStatusTone, string> = {
  inside: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  tolerance: 'bg-amber-50 text-amber-800 border-amber-200',
  outside: 'bg-rose-50 text-rose-700 border-rose-200',
  unknown: 'bg-slate-50 text-slate-600 border-slate-200',
};
