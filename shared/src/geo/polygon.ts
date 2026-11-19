/**
 * Planar polygon helpers on [longitude, latitude] rings. Site perimeters are small (a few km at
 * most), so treating lon/lat as planar for containment and self-intersection is accurate enough.
 * Rings that cross the antimeridian (±180°) are not supported.
 */

export type LonLat = [number, number];

/** True if the ring's first and last vertices are the same point. */
export function isRingClosed(ring: LonLat[]): boolean {
  if (ring.length < 2) return false;
  const a = ring[0];
  const b = ring[ring.length - 1];
  return a[0] === b[0] && a[1] === b[1];
}

/** Returns a closed copy of the ring (first vertex repeated at the end). */
export function closeRing(ring: LonLat[]): LonLat[] {
  if (ring.length === 0 || isRingClosed(ring)) return ring.map((p) => [p[0], p[1]] as LonLat);
  return [...ring.map((p) => [p[0], p[1]] as LonLat), [ring[0][0], ring[0][1]]];
}

/** Distinct vertices of a ring (closing vertex dropped). */
export function openRing(ring: LonLat[]): LonLat[] {
  return isRingClosed(ring) ? ring.slice(0, -1) : ring.slice();
}

function orientation(p: LonLat, q: LonLat, r: LonLat): number {
  const v = (q[1] - p[1]) * (r[0] - q[0]) - (q[0] - p[0]) * (r[1] - q[1]);
  if (Math.abs(v) < 1e-15) return 0;
  return v > 0 ? 1 : 2;
}

function onSegment(p: LonLat, q: LonLat, r: LonLat): boolean {
  return (
    q[0] <= Math.max(p[0], r[0]) &&
    q[0] >= Math.min(p[0], r[0]) &&
    q[1] <= Math.max(p[1], r[1]) &&
    q[1] >= Math.min(p[1], r[1])
  );
}

function segmentsIntersect(p1: LonLat, q1: LonLat, p2: LonLat, q2: LonLat): boolean {
  const o1 = orientation(p1, q1, p2);
  const o2 = orientation(p1, q1, q2);
  const o3 = orientation(p2, q2, p1);
  const o4 = orientation(p2, q2, q1);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(p1, p2, q1)) return true;
  if (o2 === 0 && onSegment(p1, q2, q1)) return true;
  if (o3 === 0 && onSegment(p2, p1, q2)) return true;
  if (o4 === 0 && onSegment(p2, q1, q2)) return true;
  return false;
}

/**
 * True if any two non-adjacent edges of the ring cross or touch, or a vertex repeats. Accepts an
 * open or closed ring.
 */
export function isRingSelfIntersecting(ring: LonLat[]): boolean {
  const pts = openRing(ring);
  const n = pts.length;
  if (n < 3) return false;
  const seen = new Set<string>();
  for (const p of pts) {
    const key = `${p[0]},${p[1]}`;
    if (seen.has(key)) return true;
    seen.add(key);
  }
  for (let i = 0; i < n; i++) {
    const a1 = pts[i];
    const a2 = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      // Skip edges that share a vertex with edge i.
      if (j === i || (j + 1) % n === i || (i + 1) % n === j) continue;
      const b1 = pts[j];
      const b2 = pts[(j + 1) % n];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

/**
 * Ray-casting point-in-polygon test. A point exactly on an edge may fall either side; callers
 * that need edge cases settled use the distance to the boundary as well.
 */
export function isPointInRing(point: LonLat, ring: LonLat[]): boolean {
  const pts = openRing(ring);
  let inside = false;
  const [x, y] = point;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

/** Area-weighted centroid of a simple ring; falls back to the vertex average for degenerate rings. */
export function ringCentroid(ring: LonLat[]): LonLat {
  const pts = openRing(ring);
  let area2 = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const cross = pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
    area2 += cross;
    cx += (pts[j][0] + pts[i][0]) * cross;
    cy += (pts[j][1] + pts[i][1]) * cross;
  }
  if (Math.abs(area2) < 1e-18) {
    const n = pts.length || 1;
    return [pts.reduce((s, p) => s + p[0], 0) / n, pts.reduce((s, p) => s + p[1], 0) / n];
  }
  return [cx / (3 * area2), cy / (3 * area2)];
}
