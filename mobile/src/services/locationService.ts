import * as Crypto from 'expo-crypto';
import * as Location from 'expo-location';
import {
  verifyLinearCorridorGeofence,
  verifyRadialGeofence,
} from '@insite/shared';
import { getCachedBaselinePack } from '../config/apiConfig';

export interface SiteGeotag {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  altitudeMeters: number | null;
  isMocked: boolean;
  isWithinGeofence: boolean | null;
  chainageLabel: string | null;
  distanceFromSiteMeters: number | null;
  capturedAt: string;
  deviceSignatureHash: string;
}

export interface LocationPermissionState {
  granted: boolean;
  canAskAgain: boolean;
  status: string;
}

/**
 * Request foreground GPS permission for site geotagging and telemetry.
 */
export async function requestLocationPermission(): Promise<LocationPermissionState> {
  try {
    const existing = await Location.getForegroundPermissionsAsync();
    if (existing.granted) {
      return {
        granted: true,
        canAskAgain: existing.canAskAgain,
        status: existing.status,
      };
    }

    const requested = await Location.requestForegroundPermissionsAsync();
    return {
      granted: requested.granted,
      canAskAgain: requested.canAskAgain,
      status: requested.status,
    };
  } catch (err) {
    console.warn('Location permission request failed:', err);
    return { granted: false, canAskAgain: false, status: 'undetermined' };
  }
}

/**
 * Evaluates a GPS coordinate against the locally cached project geofence, if available.
 */
function evaluateGeofence(latitude: number, longitude: number): {
  isWithinGeofence: boolean | null;
  chainageLabel: string | null;
  distanceFromSiteMeters: number | null;
} {
  const pack = getCachedBaselinePack();
  if (!pack?.geofence) {
    return {
      isWithinGeofence: null,
      chainageLabel: null,
      distanceFromSiteMeters: null,
    };
  }

  try {
    const result =
      pack.geofence.mode === 'LINEAR_CORRIDOR'
        ? verifyLinearCorridorGeofence({ latitude, longitude }, pack.geofence)
        : verifyRadialGeofence({ latitude, longitude }, pack.geofence);

    return {
      isWithinGeofence: result.isWithinGeofence,
      chainageLabel: result.chainageFormatted ?? null,
      distanceFromSiteMeters: result.distanceFromCenterOrLineMeters ?? null,
    };
  } catch (err) {
    console.warn('Geofence evaluation failed:', err);
    return {
      isWithinGeofence: null,
      chainageLabel: null,
      distanceFromSiteMeters: null,
    };
  }
}

/**
 * Captures a high-accuracy GPS geotag with fallback to last known position,
 * evaluates project geofence status if cached, and signs the coordinates with SHA-256.
 */
export async function captureCurrentGeotag(
  contextTag = 'GENERAL'
): Promise<SiteGeotag | null> {
  const perm = await requestLocationPermission();
  if (!perm.granted) {
    return null;
  }

  let position: Location.LocationObject | null = null;

  try {
    position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });
  } catch (err) {
    console.warn('High-accuracy GPS timed out, trying last known position:', err);
    try {
      position = await Location.getLastKnownPositionAsync({
        maxAge: 5 * 60 * 1000,
        requiredAccuracy: 150,
      });
    } catch {
      position = null;
    }
  }

  if (!position) {
    return null;
  }

  const { latitude, longitude, accuracy, altitude } = position.coords;
  const capturedAt = new Date(position.timestamp || Date.now()).toISOString();
  const isMocked = Boolean((position as any).mocked);
  const geofence = evaluateGeofence(latitude, longitude);

  const signaturePayload = `${contextTag}:${latitude.toFixed(6)}:${longitude.toFixed(
    6
  )}:${capturedAt}:${isMocked ? '1' : '0'}`;
  const deviceSignatureHash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    signaturePayload
  );

  return {
    latitude,
    longitude,
    accuracyMeters: accuracy ?? null,
    altitudeMeters: altitude ?? null,
    isMocked,
    isWithinGeofence: geofence.isWithinGeofence,
    chainageLabel: geofence.chainageLabel,
    distanceFromSiteMeters: geofence.distanceFromSiteMeters,
    capturedAt,
    deviceSignatureHash,
  };
}

