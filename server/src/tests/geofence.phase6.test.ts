/**
 * Phase 6 unit tests: perimeter geofence, tolerance for every mode, map helpers, and the server
 * BOQ parser. Pure functions only (no database).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  geofenceBounds,
  geofenceCentroid,
  isRingSelfIntersecting,
  PerimeterGeofenceSchema,
  ProjectGeofenceSchema,
  verifyPointAgainstGeofence,
  type PerimeterGeofence,
  type ProjectGeofence,
} from '@insite/shared';
import { evaluateGeofence } from '../utils/geofenceEvaluation';

// Roughly 1.1 km x 1.1 km square near Abeokuta.
const SQUARE: PerimeterGeofence = PerimeterGeofenceSchema.parse({
  mode: 'PERIMETER',
  perimeterCoordinates: [
    [3.39, 6.95],
    [3.4, 6.95],
    [3.4, 6.96],
    [3.39, 6.96],
  ],
});

// A "U" shape: the notch between the arms is outside.
const CONCAVE: PerimeterGeofence = PerimeterGeofenceSchema.parse({
  mode: 'PERIMETER',
  perimeterCoordinates: [
    [3.39, 6.95],
    [3.42, 6.95],
    [3.42, 6.98],
    [3.41, 6.98],
    [3.41, 6.96],
    [3.4, 6.96],
    [3.4, 6.98],
    [3.39, 6.98],
  ],
});

const M_PER_DEG_LAT = 111_320;

describe('Phase 6 perimeter geofence', () => {
  it('closes an open ring and stores it closed', () => {
    const ring = SQUARE.perimeterCoordinates;
    assert.equal(ring.length, 5);
    assert.deepEqual(ring[0], ring[ring.length - 1]);
  });

  it('rejects fewer than three points and self-intersecting rings', () => {
    assert.equal(
      PerimeterGeofenceSchema.safeParse({ mode: 'PERIMETER', perimeterCoordinates: [[3.39, 6.95], [3.4, 6.95]] }).success,
      false
    );
    const bowtie = [
      [3.39, 6.95],
      [3.4, 6.96],
      [3.4, 6.95],
      [3.39, 6.96],
    ] as [number, number][];
    assert.equal(isRingSelfIntersecting(bowtie), true);
    const parsed = PerimeterGeofenceSchema.safeParse({ mode: 'PERIMETER', perimeterCoordinates: bowtie });
    assert.equal(parsed.success, false);
    assert.match(JSON.stringify(parsed.error?.issues), /crosses itself/);
  });

  it('is part of the project geofence union', () => {
    assert.equal(ProjectGeofenceSchema.safeParse(SQUARE).success, true);
  });

  it('classifies inside, outside and on-edge within tolerance', () => {
    const inside = verifyPointAgainstGeofence({ latitude: 6.955, longitude: 3.395 }, SQUARE, 100);
    assert.equal(inside.status, 'INSIDE');
    assert.equal(inside.distanceOutsideMeters, 0);
    assert.equal(inside.isWithinGeofence, true);

    // About 55 m north of the top edge.
    const near = verifyPointAgainstGeofence({ latitude: 6.96 + 55 / M_PER_DEG_LAT, longitude: 3.395 }, SQUARE, 100);
    assert.equal(near.status, 'WITHIN_TOLERANCE');
    assert.ok(near.distanceOutsideMeters > 45 && near.distanceOutsideMeters < 65, String(near.distanceOutsideMeters));
    assert.equal(near.isWithinGeofence, true);
    assert.match(near.verificationBadgeText, /Within tolerance/);

    const far = verifyPointAgainstGeofence({ latitude: 6.96 + 300 / M_PER_DEG_LAT, longitude: 3.395 }, SQUARE, 100);
    assert.equal(far.status, 'OUTSIDE');
    assert.equal(far.isWithinGeofence, false);

    // Exactly on the edge counts as inside.
    const edge = verifyPointAgainstGeofence({ latitude: 6.95, longitude: 3.395 }, SQUARE, 0);
    assert.equal(edge.status, 'INSIDE');
  });

  it('handles a concave polygon (the notch is outside)', () => {
    assert.equal(verifyPointAgainstGeofence({ latitude: 6.975, longitude: 3.395 }, CONCAVE, 0).status, 'INSIDE');
    assert.equal(verifyPointAgainstGeofence({ latitude: 6.975, longitude: 3.415 }, CONCAVE, 0).status, 'INSIDE');
    // Centre of the notch, about 550 m from the nearest edge.
    const notch = verifyPointAgainstGeofence({ latitude: 6.975, longitude: 3.405 }, CONCAVE, 100);
    assert.equal(notch.status, 'OUTSIDE');
  });

  it('documents that rings crossing the antimeridian are not supported', () => {
    // A ring spanning 179.9..-179.9 is read as spanning the whole globe the other way round, so a
    // point near 180 is not reported inside. Projects there must not use perimeter mode.
    const wrap = PerimeterGeofenceSchema.parse({
      mode: 'PERIMETER',
      perimeterCoordinates: [
        [179.9, -16.9],
        [-179.9, -16.9],
        [-179.9, -16.8],
        [179.9, -16.8],
      ],
    });
    const result = verifyPointAgainstGeofence({ latitude: -16.85, longitude: 179.99 }, wrap, 0);
    assert.notEqual(result.status, 'INSIDE');
  });
});

describe('Phase 6 tolerance for radial geofences', () => {
  const radial: ProjectGeofence = { mode: 'RADIAL', center: { latitude: 9.0, longitude: 7.0 }, radiusMeters: 300 };

  it('radial: distance beyond the radius', () => {
    const at = (m: number) => ({ latitude: 9.0 + m / M_PER_DEG_LAT, longitude: 7.0 });
    assert.equal(verifyPointAgainstGeofence(at(250), radial, 100).status, 'INSIDE');
    const r = verifyPointAgainstGeofence(at(363), radial, 100);
    assert.equal(r.status, 'WITHIN_TOLERANCE');
    assert.ok(Math.abs(r.distanceOutsideMeters - 63) < 3, String(r.distanceOutsideMeters));
    assert.equal(verifyPointAgainstGeofence(at(450), radial, 100).status, 'OUTSIDE');
    // No tolerance: the old behaviour.
    assert.equal(verifyPointAgainstGeofence(at(363), radial).status, 'OUTSIDE');
  });

  it('linear corridors are no longer a geofence mode (redesign)', () => {
    const res = ProjectGeofenceSchema.safeParse({ mode: 'LINEAR_CORRIDOR', centerlineCoordinates: [[3.5, 6.45], [3.6, 6.45]], corridorHalfWidthMeters: 100 });
    assert.equal(res.success, false);
  });

  it('server evaluation flags within-tolerance positions and keeps isWithinGeofence true', () => {
    const e = evaluateGeofence(radial, { latitude: 9.0 + 363 / M_PER_DEG_LAT, longitude: 7.0 }, 100);
    assert.equal(e.geofenceStatus, 'WITHIN_TOLERANCE');
    assert.equal(e.isWithinGeofence, true);
    assert.equal(e.flag, 'WITHIN_GEOFENCE_TOLERANCE');
    const none = evaluateGeofence(radial, null, 100);
    assert.equal(none.geofenceStatus, null);
    assert.equal(none.flag, 'LOCATION_UNAVAILABLE');
  });

  it('centroid and bounds cover every mode', () => {
    for (const g of [radial, SQUARE]) {
      const c = geofenceCentroid(g);
      const b = geofenceBounds(g);
      assert.ok(b.south < c.latitude && c.latitude < b.north, g.mode);
      assert.ok(b.west < c.longitude && c.longitude < b.east, g.mode);
    }
  });
});
