/** Runs in Node. UBEC IRL (2026-11-25): photo compression maths and compass headings on geotags. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SubmissionGeotagInputSchema, formatHeading } from '@insite/shared';
import { estimateJpegBytes, PHOTO_COMPRESSION, planPhotoResize, shouldRecompress } from './photoCompression';
import { geotagFromFix, HeadingTracker, isSettledHeading } from './headingReadings';

describe('photo compression maths', () => {
  it('resizes so the long edge is 1600 px, keeping the aspect ratio', () => {
    assert.deepEqual(planPhotoResize(4000, 3000), { width: 1600, height: 1200 });
    assert.deepEqual(planPhotoResize(3000, 4000), { width: 1200, height: 1600 });
    assert.deepEqual(planPhotoResize(4032, 2268), { width: 1600, height: 900 });
    assert.deepEqual(planPhotoResize(3200, 3200), { width: 1600, height: 1600 });
  });

  it('never enlarges and ignores unknown sizes', () => {
    assert.equal(planPhotoResize(1600, 1200), null);
    assert.equal(planPhotoResize(1280, 720), null);
    assert.equal(planPhotoResize(0, 3000), null);
    assert.equal(planPhotoResize(Number.NaN, 3000), null);
  });

  it('honours a custom long edge', () => {
    assert.deepEqual(planPhotoResize(4000, 3000, 1000), { width: 1000, height: 750 });
  });

  it('encodes once more only when the first encode is above 500 KB', () => {
    assert.equal(PHOTO_COMPRESSION.maxLongEdgePx, 1600);
    assert.equal(PHOTO_COMPRESSION.jpegQuality, 0.7);
    assert.equal(shouldRecompress(300 * 1024, 0.7), false);
    assert.equal(shouldRecompress(500 * 1024, 0.7), false);
    assert.equal(shouldRecompress(500 * 1024 + 1, 0.7), true);
    // Already at the retry quality: keep it (the server limit is 15 MB).
    assert.equal(shouldRecompress(900 * 1024, PHOTO_COMPRESSION.retryJpegQuality), false);
  });

  it('a 1600 x 1200 photo is expected around 200-400 KB', () => {
    const typical = estimateJpegBytes(1600, 1200);
    assert.ok(typical > 200 * 1024 && typical < 400 * 1024, String(typical));
    assert.ok(estimateJpegBytes(1600, 1200, 1.0) >= 200 * 1024 * 0.9);
    assert.ok(estimateJpegBytes(1600, 1200, 1.6) <= 400 * 1024);
    assert.equal(estimateJpegBytes(0, 1200), 0);
  });
});

describe('compass readings', () => {
  it('keeps the newest usable reading; current at any age unless a maximum age is given', () => {
    const t = new HeadingTracker();
    assert.equal(t.push({ trueHeading: -1, magHeading: 40, accuracy: 0 }, 1000), null, 'uncalibrated reading dropped');
    assert.equal(t.latest(1000), null);
    t.push({ trueHeading: 47, magHeading: 45, accuracy: 3 }, 2000);
    // A phone held still sends no new reading: the last one stays current.
    assert.deepEqual(t.latest(60_000), { degrees: 47, reference: 'TRUE', accuracyLevel: 3 });
    assert.equal(t.latest(3001, 1000), null, 'older than the given maximum');
    t.record({ degrees: 90, reference: 'MAGNETIC', accuracyLevel: 1 }, 3000);
    assert.equal(t.latest(3000)?.degrees, 90);
    assert.equal(t.best()?.degrees, 47, 'best stays the better calibrated one');
  });

  it('best() keeps the best calibrated reading of a short wait', () => {
    const t = new HeadingTracker();
    t.push({ trueHeading: -1, magHeading: 100, accuracy: 1 }, 0);
    t.push({ trueHeading: -1, magHeading: 110, accuracy: 2 }, 100);
    t.push({ trueHeading: -1, magHeading: 120, accuracy: 1 }, 200);
    assert.deepEqual(t.best(), { degrees: 110, reference: 'MAGNETIC', accuracyLevel: 2 });
    assert.equal(t.latest(200)?.degrees, 120);
  });

  it('stops waiting at medium calibration or when none is reported', () => {
    assert.equal(isSettledHeading({ degrees: 1, reference: 'TRUE', accuracyLevel: 1 }), false);
    assert.equal(isSettledHeading({ degrees: 1, reference: 'TRUE', accuracyLevel: 2 }), true);
    assert.equal(isSettledHeading({ degrees: 1, reference: 'MAGNETIC', accuracyLevel: null }), true);
    assert.equal(isSettledHeading(null), false);
  });
});

describe('geotags with a heading', () => {
  const fix = { latitude: 9.05, longitude: 7.49, accuracyMeters: 6, altitudeMeters: 480, isMocked: false, capturedAt: '2026-11-25T09:00:00.000Z' };

  it('adds the heading fields when there is a reading, and the request parses', () => {
    const g = geotagFromFix(fix, { degrees: 47, reference: 'TRUE', accuracyLevel: 3 });
    assert.deepEqual(g, { ...fix, headingDegrees: 47, headingReference: 'TRUE', headingAccuracyLevel: 3 });
    assert.equal(SubmissionGeotagInputSchema.parse(g).headingDegrees, 47);
    assert.equal(formatHeading(g!.headingDegrees), 'Facing NE (47°)');
  });

  it('leaves heading fields out without a reading (same request as older clients)', () => {
    const g = geotagFromFix(fix, null);
    assert.deepEqual(g, fix);
    assert.equal('headingDegrees' in g!, false);
    assert.ok(SubmissionGeotagInputSchema.safeParse(g).success);
  });

  it('no fix, no geotag (a heading alone is not sent)', () => {
    assert.equal(geotagFromFix(null, { degrees: 10, reference: 'MAGNETIC', accuracyLevel: 2 }), null);
  });

  it('omits altitude when the fix has none (stored check-ins)', () => {
    const { altitudeMeters: _a, ...noAltitude } = fix;
    const g = geotagFromFix(noAltitude, null);
    assert.equal('altitudeMeters' in g!, false);
  });
});
