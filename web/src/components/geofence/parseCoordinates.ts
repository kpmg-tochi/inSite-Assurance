import type { LonLat } from './geofenceGeometry';

export type ParseCoordinatesResult = { ok: true; points: LonLat[] } | { ok: false; error: string };

const inRange = (lat: number, lon: number) => lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;

/**
 * Parses typed or pasted coordinates. Two formats, never guessed between per line:
 * - text starting with "[": a JSON array of [longitude, latitude] pairs (GeoJSON order), or a
 *   single [longitude, latitude] pair;
 * - anything else: one "latitude, longitude" pair per line (comma, semicolon, tab or space separated).
 * Returns points in [longitude, latitude] order.
 */
export function parseCoordinates(text: string): ParseCoordinatesResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, error: 'Enter at least one coordinate.' };

  if (trimmed.startsWith('[')) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return { ok: false, error: 'This is not valid JSON. Expected [[longitude, latitude], ...].' };
    }
    const list = Array.isArray(parsed) && parsed.length === 2 && parsed.every((n) => typeof n === 'number') ? [parsed] : parsed;
    if (!Array.isArray(list)) return { ok: false, error: 'Expected a JSON array of [longitude, latitude] pairs.' };
    const points: LonLat[] = [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (!Array.isArray(p) || p.length < 2 || typeof p[0] !== 'number' || typeof p[1] !== 'number') {
        return { ok: false, error: `Item ${i + 1} is not a [longitude, latitude] pair.` };
      }
      const [lon, lat] = p as [number, number];
      if (!inRange(lat, lon)) {
        return {
          ok: false,
          error: `Item ${i + 1}: latitude must be between -90 and 90 and longitude between -180 and 180. JSON pairs are [longitude, latitude].`,
        };
      }
      points.push([lon, lat]);
    }
    return { ok: true, points };
  }

  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const points: LonLat[] = [];
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(/[\s,;]+/).filter(Boolean);
    const nums = parts.map(Number);
    if (parts.length !== 2 || nums.some((n) => !Number.isFinite(n))) {
      return { ok: false, error: `Line ${i + 1}: expected "latitude, longitude", for example "9.0579, 7.4951".` };
    }
    const [lat, lon] = nums;
    if (!inRange(lat, lon)) {
      return {
        ok: false,
        error: `Line ${i + 1}: latitude must be between -90 and 90 and longitude between -180 and 180. Lines are "latitude, longitude".`,
      };
    }
    points.push([lon, lat]);
  }
  return { ok: true, points };
}

/** Formats points as "latitude, longitude" lines for the text box. */
export function formatCoordinateLines(points: LonLat[]): string {
  return points.map(([lon, lat]) => `${lat.toFixed(6)}, ${lon.toFixed(6)}`).join('\n');
}
