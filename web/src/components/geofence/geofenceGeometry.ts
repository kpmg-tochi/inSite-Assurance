import type { GeofenceBounds, ProjectGeofence } from '@insite/shared';
import { geofenceBounds } from '@insite/shared';

/** GeoJSON order, as stored: [longitude, latitude]. */
export type LonLat = [number, number];
/** Leaflet order: [latitude, longitude]. */
export type LatLngTuple = [number, number];

const METERS_PER_DEG_LAT = 110_540;
const METERS_PER_DEG_LON_EQUATOR = 111_320;

/** Neutral starting view when there is no shape yet (Nigeria). Not a default location. */
export const NEUTRAL_BOUNDS: [LatLngTuple, LatLngTuple] = [
  [4.2, 2.6],
  [13.9, 14.7],
];

export const toLatLng = ([lon, lat]: LonLat): LatLngTuple => [lat, lon];

/** Drops the repeated closing vertex of a ring, if any. */
export function openRingLonLat(ring: LonLat[]): LonLat[] {
  if (ring.length > 1) {
    const a = ring[0];
    const b = ring[ring.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1);
  }
  return ring;
}

/** Local equirectangular projection to metres around a reference latitude. Fine at site scale. */
function makeProjection(points: LonLat[]) {
  const lat0 = points.reduce((s, p) => s + p[1], 0) / Math.max(1, points.length);
  const lon0 = points.reduce((s, p) => s + p[0], 0) / Math.max(1, points.length);
  const kx = METERS_PER_DEG_LON_EQUATOR * Math.cos((lat0 * Math.PI) / 180);
  const ky = METERS_PER_DEG_LAT;
  return {
    fwd: ([lon, lat]: LonLat): [number, number] => [(lon - lon0) * kx, (lat - lat0) * ky],
    inv: ([x, y]: [number, number]): LatLngTuple => [y / ky + lat0, x / kx + lon0],
  };
}

type Vec = [number, number];
const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];
const norm = (a: Vec): Vec => {
  const l = Math.hypot(a[0], a[1]);
  return l === 0 ? [0, 0] : [a[0] / l, a[1] / l];
};
/** Unit normal to the left of the direction a -> b. */
const leftNormal = (a: Vec, b: Vec): Vec => {
  const d = norm(sub(b, a));
  return [-d[1], d[0]];
};

function dedupe(points: Vec[]): Vec[] {
  return points.filter((p, i) => i === 0 || Math.hypot(p[0] - points[i - 1][0], p[1] - points[i - 1][1]) > 1e-6);
}

/** Mitred offset of a vertex given the normals of its two edges (miter clamped to 4x). */
function miter(p: Vec, n1: Vec, n2: Vec, d: number): Vec {
  const m = norm(add(n1, n2));
  const cos = dot(m, n1);
  if (m[0] === 0 && m[1] === 0) return add(p, scale(n1, d));
  const len = Math.min(Math.abs(d / Math.max(cos, 0.25)), Math.abs(d) * 4) * Math.sign(d);
  return add(p, scale(m, len));
}

/** Outward offset of a polygon ring by `distanceMeters` (mitred). Used for the tolerance band. */
export function offsetRing(ring: LonLat[], distanceMeters: number): LatLngTuple[] {
  const open = openRingLonLat(ring);
  if (open.length < 3) return [];
  const proj = makeProjection(open);
  let pts = dedupe(open.map(proj.fwd));
  if (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-6) {
    pts = pts.slice(0, -1);
  }
  if (pts.length < 3) return [];
  let area2 = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area2 += a[0] * b[1] - b[0] * a[1];
  }
  // Counter-clockwise rings have the outside on the right, so offset by -d along the left normal.
  const d = area2 > 0 ? -distanceMeters : distanceMeters;
  const out: Vec[] = [];
  for (let i = 0; i < pts.length; i++) {
    const prev = pts[(i - 1 + pts.length) % pts.length];
    const cur = pts[i];
    const next = pts[(i + 1) % pts.length];
    out.push(miter(cur, leftNormal(prev, cur), leftNormal(cur, next), d));
  }
  return out.map(proj.inv);
}

/** geofenceBounds, padded by the tolerance band so the dashed outline is in view. */
export function paddedGeofenceBounds(geofence: ProjectGeofence, toleranceMeters = 0): [LatLngTuple, LatLngTuple] {
  const b: GeofenceBounds = geofenceBounds(geofence);
  const pad = Math.max(0, toleranceMeters);
  const midLat = (b.south + b.north) / 2;
  const dLat = pad / METERS_PER_DEG_LAT;
  const dLon = pad / (METERS_PER_DEG_LON_EQUATOR * Math.max(0.01, Math.cos((midLat * Math.PI) / 180)));
  return [
    [b.south - dLat, b.west - dLon],
    [b.north + dLat, b.east + dLon],
  ];
}

/** Smallest box holding every given box; null when there is none. */
export function unionBounds(boxes: [LatLngTuple, LatLngTuple][]): [LatLngTuple, LatLngTuple] | null {
  if (boxes.length === 0) return null;
  let south = 90;
  let west = 180;
  let north = -90;
  let east = -180;
  for (const [[s, w], [n, e]] of boxes) {
    south = Math.min(south, s);
    west = Math.min(west, w);
    north = Math.max(north, n);
    east = Math.max(east, e);
  }
  return [
    [south, west],
    [north, east],
  ];
}

/** A point `meters` due east of a centre, for the radius handle. */
export function pointEastOf(center: { latitude: number; longitude: number }, meters: number): LatLngTuple {
  const kx = METERS_PER_DEG_LON_EQUATOR * Math.max(0.01, Math.cos((center.latitude * Math.PI) / 180));
  return [center.latitude, center.longitude + meters / kx];
}
