/**
 * UBEC IRL (2026-11-25): the shared compass-heading helpers (shared/src/utils/heading.ts).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  betterHeading,
  compassPoint,
  formatHeading,
  headingFromDeviceReading,
  headingGeotagFields,
  normaliseHeadingDegrees,
} from '@insite/shared';

describe('heading formatter', () => {
  it('names the nearest of eight compass points', () => {
    assert.equal(formatHeading(0), 'Facing N (0°)');
    assert.equal(formatHeading(47), 'Facing NE (47°)');
    assert.equal(formatHeading(359), 'Facing N (359°)');
    assert.equal(formatHeading(90), 'Facing E (90°)');
    assert.equal(formatHeading(202.4), 'Facing S (202°)');
    assert.equal(formatHeading(292.4), 'Facing W (292°)');
    assert.equal(formatHeading(292.6), 'Facing NW (293°)');
    assert.equal(formatHeading(337.6), 'Facing N (338°)');
    assert.equal(formatHeading(359.96), 'Facing N (0°)');
  });

  it('says when there is no heading', () => {
    assert.equal(formatHeading(null), 'Heading not recorded');
    assert.equal(formatHeading(undefined), 'Heading not recorded');
    assert.equal(formatHeading(Number.NaN), 'Heading not recorded');
    assert.equal(compassPoint(null), null);
  });

  it('wraps degrees into 0-360 and rounds to 0.1', () => {
    assert.equal(normaliseHeadingDegrees(360), 0);
    assert.equal(normaliseHeadingDegrees(-10), 350);
    assert.equal(normaliseHeadingDegrees(725.04), 5);
    assert.equal(normaliseHeadingDegrees(47.25), 47.3);
    assert.equal(normaliseHeadingDegrees(Infinity), null);
  });
});

describe('device heading readings', () => {
  it('prefers true north, falls back to magnetic, drops an unreliable reading', () => {
    assert.deepEqual(headingFromDeviceReading({ trueHeading: 12.34, magHeading: 10, accuracy: 3 }), { degrees: 12.3, reference: 'TRUE', accuracyLevel: 3 });
    assert.deepEqual(headingFromDeviceReading({ trueHeading: -1, magHeading: 200, accuracy: 2 }), { degrees: 200, reference: 'MAGNETIC', accuracyLevel: 2 });
    assert.deepEqual(headingFromDeviceReading({ trueHeading: -1, magHeading: 200 }), { degrees: 200, reference: 'MAGNETIC', accuracyLevel: null });
    assert.equal(headingFromDeviceReading({ trueHeading: 50, magHeading: 48, accuracy: 0 }), null);
    assert.equal(headingFromDeviceReading({ trueHeading: -1, magHeading: -1, accuracy: 3 }), null);
    assert.equal(headingFromDeviceReading(null), null);
  });

  it('keeps the better calibrated reading, else true north, else the newer one', () => {
    const low = { degrees: 10, reference: 'TRUE' as const, accuracyLevel: 1 };
    const high = { degrees: 20, reference: 'MAGNETIC' as const, accuracyLevel: 3 };
    const trueTwo = { degrees: 30, reference: 'TRUE' as const, accuracyLevel: 2 };
    const magTwo = { degrees: 31, reference: 'MAGNETIC' as const, accuracyLevel: 2 };
    assert.equal(betterHeading(low, high), high);
    assert.equal(betterHeading(high, low), high);
    assert.equal(betterHeading(magTwo, trueTwo), trueTwo);
    assert.equal(betterHeading(null, low), low);
    const newer = { ...trueTwo, degrees: 33 };
    assert.equal(betterHeading(trueTwo, newer), newer);
  });

  it('flattens a reading into geotag fields', () => {
    assert.deepEqual(headingGeotagFields({ degrees: 5, reference: 'TRUE', accuracyLevel: 2 }), { headingDegrees: 5, headingReference: 'TRUE', headingAccuracyLevel: 2 });
    assert.deepEqual(headingGeotagFields(null), { headingDegrees: null, headingReference: null, headingAccuracyLevel: null });
  });
});
