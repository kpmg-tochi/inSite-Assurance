import { betterHeading, headingFromDeviceReading, headingGeotagFields, type HeadingReading, type SubmissionGeotagInput } from '@insite/shared';

/**
 * Compass readings on the phone (UBEC IRL, 2026-11-25). Pure: the native subscription is in
 * `services/headingService.ts`. Capture never waits on the compass for long: without a usable
 * reading within HEADING_WAIT_MS the heading is stored as null.
 */

/** Longest wait for a settled reading. */
export const HEADING_WAIT_MS = 1000;

export type RawHeading = { trueHeading?: number | null; magHeading?: number | null; accuracy?: number | null };

/** A reading the app can stop waiting for: calibration medium or better, or not reported. */
export function isSettledHeading(r: HeadingReading | null): boolean {
  return Boolean(r) && (r!.accuracyLevel === null || r!.accuracyLevel >= 2);
}

/** Keeps the readings of one subscription (or one short wait) with their times. */
export class HeadingTracker {
  private last: { reading: HeadingReading; atMs: number } | null = null;
  private bestSoFar: HeadingReading | null = null;

  /** Adds a raw OS reading; returns the parsed one (null when unusable). */
  push(raw: RawHeading | null | undefined, atMs: number): HeadingReading | null {
    const reading = headingFromDeviceReading(raw);
    if (!reading) return null;
    this.record(reading, atMs);
    return reading;
  }

  /** Adds a reading that was already parsed (for example one shared from another tracker). */
  record(reading: HeadingReading, atMs: number): void {
    this.last = { reading, atMs };
    this.bestSoFar = betterHeading(this.bestSoFar, reading);
  }

  /**
   * The newest usable reading if it is at most `maxAgeMs` old, else null. While a subscription is
   * open its newest reading is current at any age: the OS only reports a change (Android: about 2
   * degrees), so a phone held still sends nothing new.
   */
  latest(nowMs: number, maxAgeMs: number = Number.POSITIVE_INFINITY): HeadingReading | null {
    if (!this.last || nowMs - this.last.atMs > maxAgeMs) return null;
    return this.last.reading;
  }

  /** The best calibrated reading seen (used when a short wait ends without a settled one). */
  best(): HeadingReading | null {
    return this.bestSoFar;
  }
}

/** The position fields a geotag needs, plus the heading when there is one. */
export interface GeotagFix {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  altitudeMeters?: number | null;
  isMocked: boolean;
  capturedAt: string;
}

/**
 * A check-in or submission geotag from a GPS fix and an optional compass reading. Heading fields are
 * left out entirely when there is no reading, so the request matches what older clients sent.
 */
export function geotagFromFix(fix: GeotagFix | null, heading: HeadingReading | null | undefined): SubmissionGeotagInput | null {
  if (!fix) return null;
  return {
    latitude: fix.latitude,
    longitude: fix.longitude,
    accuracyMeters: fix.accuracyMeters,
    ...(fix.altitudeMeters !== undefined ? { altitudeMeters: fix.altitudeMeters } : {}),
    isMocked: fix.isMocked,
    capturedAt: fix.capturedAt,
    ...(heading ? headingGeotagFields(heading) : {}),
  };
}
