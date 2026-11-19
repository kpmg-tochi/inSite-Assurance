import { point, lineString } from '@turf/helpers';
import distance from '@turf/distance';
import length from '@turf/length';
import nearestPointOnLine from '@turf/nearest-point-on-line';
import type { GeofenceStatus } from '../enums';
import {
  GeoCoordinate,
  GeofenceBounds,
  GeofenceVerificationResult,
  LinearCorridorGeofence,
  PerimeterGeofence,
  ProjectGeofence,
  RadialGeofence,
} from '../schemas/geofence.schema';
import { closeRing, isPointInRing, openRing, ringCentroid, type LonLat } from './polygon';

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
    chainageKm: null,
    chainageFormatted: null,
    corridorOffsetMeters: null,
    verificationBadgeText: badge(
      status,
      `Site Verified (${siteName}${Math.round(distMeters)}m from center)`,
      distanceOutsideMeters,
      `Outside Radial Geofence (${Math.round(distMeters)}m from center; limit ${geofence.radiusMeters}m)`
    ),
  };
}

/**
 * Verifies a GPS capture coordinate against a Linear Corridor / Chainage Geofence
 * (e.g., highway, drainage channel, pipeline, transmission line).
 */
export function verifyLinearCorridorGeofence(
  captureCoord: GeoCoordinate,
  geofence: LinearCorridorGeofence,
  toleranceMeters = 0
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
  const corridorOffsetMeters = round1(offsetKm * 1000);

  // Distance along centerline from start vertex (in km) + startChainageKm
  const distanceAlongLineKm =
    typeof snapped.properties?.location === 'number'
      ? snapped.properties.location
      : 0;
  const chainageKm = Number(
    (geofence.startChainageKm + distanceAlongLineKm).toFixed(3)
  );
  const chainageFormatted = formatChainage(chainageKm);

  const distanceOutsideMeters = round1(
    Math.max(0, corridorOffsetMeters - geofence.corridorHalfWidthMeters)
  );
  const status = classify(distanceOutsideMeters, toleranceMeters);

  return {
    mode: 'LINEAR_CORRIDOR',
    status,
    isWithinGeofence: status !== 'OUTSIDE',
    toleranceMeters,
    distanceOutsideMeters,
    distanceToBoundaryMeters: round1(Math.abs(corridorOffsetMeters - geofence.corridorHalfWidthMeters)),
    distanceFromCenterOrLineMeters: corridorOffsetMeters,
    allowedThresholdMeters: geofence.corridorHalfWidthMeters,
    chainageKm,
    chainageFormatted,
    corridorOffsetMeters,
    verificationBadgeText: badge(
      status,
      `Corridor Verified (Chainage ${chainageFormatted} | ±${Math.round(corridorOffsetMeters)}m)`,
      distanceOutsideMeters,
      `Off-Corridor Capture (Chainage ${chainageFormatted} | ${Math.round(corridorOffsetMeters)}m offset > ${geofence.corridorHalfWidthMeters}m limit)`
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
    chainageKm: null,
    chainageFormatted: null,
    corridorOffsetMeters: null,
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
    case 'LINEAR_CORRIDOR':
      return verifyLinearCorridorGeofence(captureCoord, geofence, tolerance);
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
    case 'LINEAR_CORRIDOR': {
      const line = lineString(geofence.centerlineCoordinates);
      const total = length(line, { units: 'kilometers' });
      // Midpoint along the line: walk the vertices.
      let walked = 0;
      const coords = geofence.centerlineCoordinates;
      for (let i = 1; i < coords.length; i++) {
        const seg = distance(point(coords[i - 1]), point(coords[i]), { units: 'kilometers' });
        if (walked + seg >= total / 2 && seg > 0) {
          const t = (total / 2 - walked) / seg;
          return {
            longitude: coords[i - 1][0] + (coords[i][0] - coords[i - 1][0]) * t,
            latitude: coords[i - 1][1] + (coords[i][1] - coords[i - 1][1]) * t,
          };
        }
        walked += seg;
      }
      return { longitude: coords[0][0], latitude: coords[0][1] };
    }
    case 'PERIMETER': {
      const [lon, lat] = ringCentroid(geofence.perimeterCoordinates as LonLat[]);
      return { latitude: lat, longitude: lon };
    }
    default:
      return assertNever(geofence);
  }
}

const METERS_PER_DEG_LAT = 111_320;

/** Bounding box of a geofence including its buffer (radius or half-width), for fitting a map. */
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
    case 'LINEAR_CORRIDOR':
      return fromPoints(geofence.centerlineCoordinates as LonLat[], geofence.corridorHalfWidthMeters);
    case 'PERIMETER':
      return fromPoints(openRing(geofence.perimeterCoordinates as LonLat[]), 0);
    default:
      return assertNever(geofence);
  }
}

export { closeRing, isRingSelfIntersecting, isPointInRing } from './polygon';
