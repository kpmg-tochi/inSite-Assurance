/**
 * Supervision workload (Phase 14, kept in redesign R5f when the legacy inspection checklist went):
 * a supervisor's live projects and the furthest distance between their geofence centres.
 */

export interface LatLng {
  latitude: number;
  longitude: number;
}

/** Great-circle distance in km (haversine, mean Earth radius). */
export function distanceKm(a: LatLng, b: LatLng): number {
  const R = 6371.0088;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Furthest distance between any two points (km); null with fewer than two points. */
export function maxPairwiseDistanceKm(points: LatLng[]): number | null {
  if (points.length < 2) return null;
  let max = 0;
  for (let i = 0; i < points.length; i++) {
    for (let j = i + 1; j < points.length; j++) max = Math.max(max, distanceKm(points[i], points[j]));
  }
  return Math.round(max * 10) / 10;
}

export interface WorkloadThresholds {
  maxSitesPerSupervisor: number | null;
  maxSpreadKm: number | null;
}

/** Warn (never block) when a supervisor covers too many sites or sites too far apart. */
export function evaluateWorkload(
  siteCount: number,
  spreadKm: number | null,
  thresholds: WorkloadThresholds
): { overSiteLimit: boolean; overSpread: boolean } {
  return {
    overSiteLimit: thresholds.maxSitesPerSupervisor !== null && siteCount > thresholds.maxSitesPerSupervisor,
    overSpread: thresholds.maxSpreadKm !== null && spreadKm !== null && spreadKm > thresholds.maxSpreadKm,
  };
}
