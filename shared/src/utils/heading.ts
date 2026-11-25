/**
 * Compass heading of the phone when a photo was taken or a position was recorded (UBEC IRL,
 * 2026-11-25). Degrees clockwise from north, 0 <= d < 360.
 *
 * The phone reports true north when the OS can compute it (it needs a location fix for the magnetic
 * declination), else magnetic north; the reading says which. Calibration is the OS level 0-3
 * (3 high: under ~20 degrees uncertainty, 2 under ~35, 1 under ~50, 0 unreliable). An unreliable
 * reading is dropped: a wrong direction shown to a reviewer is worse than none.
 */

export type HeadingReference = 'TRUE' | 'MAGNETIC';

export interface HeadingReading {
  degrees: number;
  reference: HeadingReference;
  /** OS calibration level 0-3, or null when the OS does not report one. */
  accuracyLevel: number | null;
}

export const COMPASS_POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type CompassPoint = (typeof COMPASS_POINTS)[number];

export const HEADING_REFERENCE_LABELS: Record<HeadingReference, string> = {
  TRUE: 'true north',
  MAGNETIC: 'magnetic north',
};

/** Degrees in [0, 360) rounded to 0.1, or null for anything that is not a finite number. */
export function normaliseHeadingDegrees(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const wrapped = ((value % 360) + 360) % 360;
  const rounded = Math.round(wrapped * 10) / 10;
  return rounded >= 360 ? 0 : rounded;
}

/** The nearest of the eight compass points, or null when there is no heading. */
export function compassPoint(value: number | null | undefined): CompassPoint | null {
  const d = normaliseHeadingDegrees(value);
  if (d === null) return null;
  return COMPASS_POINTS[Math.round(d / 45) % 8];
}

/** "Facing NE (47°)", or "Heading not recorded". */
export function formatHeading(value: number | null | undefined): string {
  const d = normaliseHeadingDegrees(value);
  if (d === null) return 'Heading not recorded';
  const whole = Math.round(d) % 360;
  return `Facing ${compassPoint(d)} (${whole}°)`;
}

function calibrationLevel(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const level = Math.round(value);
  return level >= 0 && level <= 3 ? level : null;
}

/**
 * A reading from the phone's compass (expo-location `LocationHeadingObject`: `trueHeading` is -1
 * when unavailable). True north is preferred; an unreliable (level 0) reading gives null.
 */
export function headingFromDeviceReading(
  raw: { trueHeading?: number | null; magHeading?: number | null; accuracy?: number | null } | null | undefined
): HeadingReading | null {
  if (!raw) return null;
  const accuracyLevel = calibrationLevel(raw.accuracy);
  if (accuracyLevel === 0) return null;
  const trueDeg = typeof raw.trueHeading === 'number' && raw.trueHeading >= 0 ? normaliseHeadingDegrees(raw.trueHeading) : null;
  if (trueDeg !== null) return { degrees: trueDeg, reference: 'TRUE', accuracyLevel };
  const magDeg = typeof raw.magHeading === 'number' && raw.magHeading >= 0 ? normaliseHeadingDegrees(raw.magHeading) : null;
  if (magDeg !== null) return { degrees: magDeg, reference: 'MAGNETIC', accuracyLevel };
  return null;
}

/**
 * Which of two readings to keep: the better calibrated one (an unknown level counts as 1), and on a
 * tie the newer one (`b`); true north wins over magnetic at the same level.
 */
export function betterHeading(a: HeadingReading | null, b: HeadingReading | null): HeadingReading | null {
  if (!a) return b;
  if (!b) return a;
  const la = a.accuracyLevel ?? 1;
  const lb = b.accuracyLevel ?? 1;
  if (la !== lb) return la > lb ? a : b;
  if (a.reference !== b.reference) return a.reference === 'TRUE' ? a : b;
  return b;
}

/** Flat geotag fields for a reading (all null when there is none). */
export function headingGeotagFields(reading: HeadingReading | null | undefined): {
  headingDegrees: number | null;
  headingReference: HeadingReference | null;
  headingAccuracyLevel: number | null;
} {
  return {
    headingDegrees: reading ? reading.degrees : null,
    headingReference: reading ? reading.reference : null,
    headingAccuracyLevel: reading ? reading.accuracyLevel : null,
  };
}
