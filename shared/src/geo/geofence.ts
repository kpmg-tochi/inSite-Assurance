import { point, lineString } from '@turf/helpers';
import distance from '@turf/distance';
import length from '@turf/length';
import nearestPointOnLine from '@turf/nearest-point-on-line';
import {
  GeoCoordinate,
  GeofenceVerificationResult,
  LinearCorridorGeofence,
  ProjectGeofence,
  RadialGeofence,
} from '../schemas/geofence.schema';

/**
 * Formats a kilometer floating-point chainage value into standard civil engineering
 * stationing / chainage format: e.g., 14.2 -> "KM 14+200", 0.045 -> "KM 0+045".
 */
export function formatChainage(chainageKm: number): string {
  const clampedKm = Math.max(0, chainageKm);
  const totalMeters = Math.round(clampedKm * 1000);
  const wholeKilometers = Math.floor(totalMeters / 1000);
  const remainderMeters = totalMeters % 1000;
  const paddedMeters = String(remainderMeters).padStart(3, '0');
  return `KM ${wholeKilometers}+${paddedMeters}`;
}

/**
 * Computes total centerline length in kilometers for a Linear Corridor geofence.
 */
export function computeLinearCorridorLengthKm(geofence: LinearCorridorGeofence): number {
  const line = lineString(geofence.centerlineCoordinates);
  return Number(length(line, { units: 'kilometers' }).toFixed(3));
}

/**
 * Verifies a GPS capture coordinate against a Radial Geofence (Point + Radius).
 */
export function verifyRadialGeofence(
  captureCoord: GeoCoordinate,
  geofence: RadialGeofence
): GeofenceVerificationResult {
  const capturePt = point([captureCoord.longitude, captureCoord.latitude]);
  const centerPt = point([geofence.center.longitude, geofence.center.latitude]);

  const distMeters = Number(
    distance(capturePt, centerPt, { units: 'meters' }).toFixed(1)
  );
  const isWithinGeofence = distMeters <= geofence.radiusMeters;

  const siteName = geofence.siteLabel ? `${geofence.siteLabel} — ` : '';
  const verificationBadgeText = isWithinGeofence
    ? `📍 Site Verified (${siteName}${Math.round(distMeters)}m from center)`
    : `⚠️ Outside Radial Geofence (${Math.round(distMeters)}m from center; limit ${geofence.radiusMeters}m)`;

  return {
    mode: 'RADIAL',
    isWithinGeofence,
    distanceFromCenterOrLineMeters: distMeters,
    allowedThresholdMeters: geofence.radiusMeters,
    chainageKm: null,
    chainageFormatted: null,
    corridorOffsetMeters: null,
    verificationBadgeText,
  };
}

/**
 * Verifies a GPS capture coordinate against a Linear Corridor / Chainage Geofence
 * (e.g., highway, drainage channel, pipeline, transmission line).
 */
export function verifyLinearCorridorGeofence(
  captureCoord: GeoCoordinate,
  geofence: LinearCorridorGeofence
): GeofenceVerificationResult {
  const capturePt = point([captureCoord.longitude, captureCoord.latitude]);
  const corridorLine = lineString(geofence.centerlineCoordinates);

  const snapped = nearestPointOnLine(corridorLine, capturePt, {
    units: 'kilometers',
  });

  // Perpendicular offset in meters from road/pipeline centerline
  const offsetKm =
    typeof snapped.properties?.dist === 'number'
      ? snapped.properties.dist
      : distance(capturePt, snapped, { units: 'kilometers' });
  const corridorOffsetMeters = Number((offsetKm * 1000).toFixed(1));

  // Distance along centerline from start vertex (in km) + startChainageKm
  const distanceAlongLineKm =
    typeof snapped.properties?.location === 'number'
      ? snapped.properties.location
      : 0;
  const chainageKm = Number(
    (geofence.startChainageKm + distanceAlongLineKm).toFixed(3)
  );
  const chainageFormatted = formatChainage(chainageKm);

  const isWithinGeofence =
    corridorOffsetMeters <= geofence.corridorHalfWidthMeters;

  const verificationBadgeText = isWithinGeofence
    ? `📍 Corridor Verified (Chainage ${chainageFormatted} | ±${Math.round(corridorOffsetMeters)}m)`
    : `⚠️ Off-Corridor Capture (Chainage ${chainageFormatted} | ${Math.round(corridorOffsetMeters)}m offset > ${geofence.corridorHalfWidthMeters}m limit)`;

  return {
    mode: 'LINEAR_CORRIDOR',
    isWithinGeofence,
    distanceFromCenterOrLineMeters: corridorOffsetMeters,
    allowedThresholdMeters: geofence.corridorHalfWidthMeters,
    chainageKm,
    chainageFormatted,
    corridorOffsetMeters,
    verificationBadgeText,
  };
}

/**
 * Unified dispatcher used by both the Mobile App (offline via Expo SQLite)
 * and the Express Backend API during capture verification.
 */
export function verifyPointAgainstGeofence(
  captureCoord: GeoCoordinate,
  geofence: ProjectGeofence
): GeofenceVerificationResult {
  if (geofence.mode === 'RADIAL') {
    return verifyRadialGeofence(captureCoord, geofence);
  }
  return verifyLinearCorridorGeofence(captureCoord, geofence);
}

