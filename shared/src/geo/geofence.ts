import { point, lineString } from '@turf/helpers';
import distance from '@turf/distance';
import nearestPointOnLine from '@turf/nearest-point-on-line';
import type { GeofenceStatus } from '../enums';
import {
  GeoCoordinate,
  GeofenceBounds,
  GeofenceVerificationResult,
  PerimeterGeofence,
  ProjectGeofence,
  RadialGeofence,
} from '../schemas/geofence.schema';
import { closeRing, isPointInRing, openRing, ringCentroid, type LonLat } from './polygon';

const round1 = (n: number) => Number(n.toFixed(1));

/** Classifies a distance outside the boundary against the tolerance band. */
function classify(distanceOutsideMeters: number, toleranceMeters: number): GeofenceStatus {
  if (distanceOutsideMeters <= 0) return 'INSIDE';
  if (distanceOutsideMeters <= toleranceMeters) return 'WITHIN_TOLERANCE';
  return 'OUTSIDE';
}

/** Short human note for a status, e.g. "63 m outside the boundary, within tolerance". */
export function geofenceStatusNote(status: GeofenceStatus, distanceOutsideMeters: number): string {
  const m = Math.round(distanceOutsideMeters);
  if (status === 'INSIDE') return 'Inside the site boundary';
  if (status === 'WITHIN_TOLERANCE') return `${m} m outside the boundary, within tolerance`;
  return `${m} m outside the boundary`;
}

function badge(status: GeofenceStatus, inside: string, distanceOutsideMeters: number, outside: string) {
  if (status === 'INSIDE') return `📍 ${inside}`;
  if (status === 'WITHIN_TOLERANCE') {
    return `📍 Within tolerance (${Math.round(distanceOutsideMeters)} m outside)`;
  }
  return `⚠️ ${outside}`;
}

/**
 * Verifies a GPS capture coordinate against a Radial Geofence (Point + Radius).
 */
export function verifyRadialGeofence(
  captureCoord: GeoCoordinate,
  geofence: RadialGeofence,
  toleranceMeters = 0
): GeofenceVerificationResult {
  const capturePt = point([captureCoord.longitude, captureCoord.latitude]);
  const centerPt = point([geofence.center.longitude, geofence.center.latitude]);

  const distMeters = round1(distance(capturePt, centerPt, { units: 'meters' }));
  const distanceOutsideMeters = round1(Math.max(0, distMeters - geofence.radiusMeters));
  const status = classify(distanceOutsideMeters, toleranceMeters);
  const siteName = geofence.siteLabel ? `${geofence.siteLabel} — ` : '';

  return {
    mode: 'RADIAL',
    status,
    isWithinGeofence: status !== 'OUTSIDE',
    toleranceMeters,
    distanceOutsideMeters,
    distanceToBoundaryMeters: round1(Math.abs(distMeters - geofence.radiusMeters)),
    distanceFromCenterOrLineMeters: distMeters,
    allowedThresholdMeters: geofence.radiusMeters,
    verificationBadgeText: badge(
      status,
      `Site Verified (${siteName}${Math.round(distMeters)}m from center)`,
      distanceOutsideMeters,
      `Outside Radial Geofence (${Math.round(distMeters)}m from center; limit ${geofence.radiusMeters}m)`
    ),
  };
}

/** Distance in metres from a point to the nearest edge of a ring. */
function distanceToRingMeters(captureCoord: GeoCoordinate, ring: LonLat[]): number {
  const closed = closeRing(ring);
  const snapped = nearestPointOnLine(lineString(closed), point([captureCoord.longitude, captureCoord.latitude]), {
    units: 'kilometers',
  });
  const km =
    typeof snapped.properties?.dist === 'number'
      ? snapped.properties.dist
      : distance(point([captureCoord.longitude, captureCoord.latitude]), snapped, { units: 'kilometers' });
  return km * 1000;
}

/**
 * Verifies a GPS coordinate against a Perimeter (polygon) Geofence. Inside the polygon is INSIDE;
 * outside, the distance to the nearest edge is compared with the tolerance.
 * Rings crossing the antimeridian are not supported.
 */
export function verifyPerimeterGeofence(
  captureCoord: GeoCoordinate,
  geofence: PerimeterGeofence,
  toleranceMeters = 0
): GeofenceVerificationResult {
  const ring = geofence.perimeterCoordinates as LonLat[];
  const edgeMeters = round1(distanceToRingMeters(captureCoord, ring));
  // A point within a few centimetres of an edge counts as on the boundary, so inside.
  const inside = isPointInRing([captureCoord.longitude, captureCoord.latitude], ring) || edgeMeters < 0.05;
  const distanceOutsideMeters = inside ? 0 : edgeMeters;
  const status = classify(distanceOutsideMeters, toleranceMeters);
  const siteName = geofence.siteLabel ? ` (${geofence.siteLabel})` : '';

  return {
    mode: 'PERIMETER',
    status,
    isWithinGeofence: status !== 'OUTSIDE',
    toleranceMeters,
    distanceOutsideMeters,
    distanceToBoundaryMeters: edgeMeters,
    distanceFromCenterOrLineMeters: edgeMeters,
    allowedThresholdMeters: toleranceMeters,
    verificationBadgeText: badge(
      status,
      `Inside Site Perimeter${siteName}`,
      distanceOutsideMeters,
      `Outside Site Perimeter (${Math.round(distanceOutsideMeters)}m from boundary)`
    ),
  };
}

function assertNever(value: never): never {
  throw new Error(`Unsupported geofence mode: ${JSON.stringify(value)}`);
}

/**
 * Unified dispatcher used by both the Mobile App (offline) and the Express Backend API during
 * capture verification. `toleranceMeters` is the project's effective tolerance band (Phase 6).
 */
export function verifyPointAgainstGeofence(
  captureCoord: GeoCoordinate,
  geofence: ProjectGeofence,
  toleranceMeters = 0
): GeofenceVerificationResult {
  const tolerance = Math.max(0, toleranceMeters);
  switch (geofence.mode) {
    case 'RADIAL':
      return verifyRadialGeofence(captureCoord, geofence, tolerance);
    case 'PERIMETER':
      return verifyPerimeterGeofence(captureCoord, geofence, tolerance);
    default:
      return assertNever(geofence);
  }
}

/** Centre point of a geofence, for map pins. */
export function geofenceCentroid(geofence: ProjectGeofence): GeoCoordinate {
  switch (geofence.mode) {
    case 'RADIAL':
      return { ...geofence.center };
    case 'PERIMETER': {
      const [lon, lat] = ringCentroid(geofence.perimeterCoordinates as LonLat[]);
      return { latitude: lat, longitude: lon };
    }
    default:
      return assertNever(geofence);
  }
}

/** Great-circle distance between two points, in metres (needs pipeline: duplicate sites). */
export function distanceMeters(a: GeoCoordinate, b: GeoCoordinate): number {
  return distance(point([a.longitude, a.latitude]), point([b.longitude, b.latitude]), { units: 'meters' });
}

const METERS_PER_DEG_LAT = 111_320;

/** Bounding box of a geofence including its radius, for fitting a map. */
export function geofenceBounds(geofence: ProjectGeofence): GeofenceBounds {
  const fromPoints = (pts: LonLat[], bufferMeters: number): GeofenceBounds => {
    const lats = pts.map((p) => p[1]);
    const lons = pts.map((p) => p[0]);
    const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const dLat = bufferMeters / METERS_PER_DEG_LAT;
    const dLon = bufferMeters / (METERS_PER_DEG_LAT * Math.max(0.01, Math.cos((midLat * Math.PI) / 180)));
    return {
      south: Math.min(...lats) - dLat,
      north: Math.max(...lats) + dLat,
      west: Math.min(...lons) - dLon,
      east: Math.max(...lons) + dLon,
    };
  };
  switch (geofence.mode) {
    case 'RADIAL':
      return fromPoints([[geofence.center.longitude, geofence.center.latitude]], geofence.radiusMeters);
    case 'PERIMETER':
      return fromPoints(openRing(geofence.perimeterCoordinates as LonLat[]), 0);
    default:
      return assertNever(geofence);
  }
}

export { closeRing, isRingSelfIntersecting, isPointInRing } from './polygon';
