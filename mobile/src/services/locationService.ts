import * as Location from 'expo-location';
import { verifyPointAgainstGeofence } from '@insite/shared';
import { getCachedBaselinePack } from '../config/apiConfig';

/**
 * GPS acquisition (Phase 4). Returns a real fix or null. Never invents coordinates or chainage.
 *
 * The geofence result here is only a local preview for the person holding the phone; the server
 * evaluates the geofence again and its result is the one that counts.
 */

/** Give up on a fresh fix after this long and fall back to a recent one. */
export const GPS_TIMEOUT_MS = 15_000;
/** A last-known position older than this is not used. */
export const GPS_MAX_AGE_MS = 2 * 60_000;
/** A fix less accurate than this is reported but marked as poor. */
export const GPS_POOR_ACCURACY_METERS = 50;
/** A last-known position less accurate than this is not used at all. */
export const GPS_FALLBACK_MAX_ACCURACY_METERS = 150;

/** One GPS reading as the hardware reported it. */
export interface LocationFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  altitudeMeters: number | null;
  isMocked: boolean;
  capturedAt: string;
}

/** Local preview of the geofence for a fix. `null` means it could not be evaluated. */
export interface GeofencePreview {
  isWithinGeofence: boolean | null;
  chainageLabel: string | null;
  distanceFromSiteMeters: number | null;
}

/** @deprecated name kept for older screens; a geotag is a fix plus a local geofence preview. */
export type SiteGeotag = LocationFix & GeofencePreview;

export interface LocationPermissionState {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
}

export async function requestLocationPermission(): Promise<LocationPermissionState> {
  try {
    const existing = await Location.getForegroundPermissionsAsync();
    if (existing.granted) {
      return { granted: true, canAskAgain: existing.canAskAgain, status: existing.status };
    }
    const requested = await Location.requestForegroundPermissionsAsync();
    return { granted: requested.granted, canAskAgain: requested.canAskAgain, status: requested.status };
  } catch (err) {
    console.warn('Location permission request failed:', err);
    return { granted: false, canAskAgain: false, status: 'undetermined' };
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise
      .then((v) => {
        clearTimeout(timer);
        resolve(v);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

function toFix(position: Location.LocationObject): LocationFix {
  return {
    latitude: position.coords.latitude,
    longitude: position.coords.longitude,
    accuracyMeters: position.coords.accuracy ?? null,
    altitudeMeters: position.coords.altitude ?? null,
    isMocked: Boolean(position.mocked),
    capturedAt: new Date(position.timestamp || Date.now()).toISOString(),
  };
}

/** A fresh fix within GPS_TIMEOUT_MS, else a recent accurate last-known one, else null. */
export async function acquireFix(): Promise<LocationFix | null> {
  const perm = await requestLocationPermission();
  if (!perm.granted) return null;

  const fresh = await withTimeout(
    Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
    GPS_TIMEOUT_MS
  );
  if (fresh) return toFix(fresh);

  const last = await Location.getLastKnownPositionAsync({
    maxAge: GPS_MAX_AGE_MS,
    requiredAccuracy: GPS_FALLBACK_MAX_ACCURACY_METERS,
  }).catch(() => null);
  return last ? toFix(last) : null;
}

/** Local preview using the shared geofence code and the persisted baseline pack. */
export function previewGeofence(fix: Pick<LocationFix, 'latitude' | 'longitude'>): GeofencePreview {
  const pack = getCachedBaselinePack();
  if (!pack?.geofence) {
    return { isWithinGeofence: null, chainageLabel: null, distanceFromSiteMeters: null };
  }
  try {
    const result = verifyPointAgainstGeofence(fix, pack.geofence);
    return {
      isWithinGeofence: result.isWithinGeofence,
      chainageLabel: result.chainageFormatted,
      distanceFromSiteMeters: result.distanceFromCenterOrLineMeters,
    };
  } catch {
    return { isWithinGeofence: null, chainageLabel: null, distanceFromSiteMeters: null };
  }
}

/** A fix plus its local geofence preview, or null when there is no fix. */
export async function captureCurrentGeotag(_contextTag = 'GENERAL'): Promise<SiteGeotag | null> {
  const fix = await acquireFix();
  return fix ? { ...fix, ...previewGeofence(fix) } : null;
}
