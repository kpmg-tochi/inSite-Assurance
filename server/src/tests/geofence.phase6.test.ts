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
import { parseBoqNumber, previewBoqSpreadsheet } from '../modules/boq/boqParser';

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

describe('Phase 6 tolerance for radial and linear modes', () => {
  const radial: ProjectGeofence = { mode: 'RADIAL', center: { latitude: 9.0, longitude: 7.0 }, radiusMeters: 300 };
  const linear: ProjectGeofence = ProjectGeofenceSchema.parse({
    mode: 'LINEAR_CORRIDOR',
    centerlineCoordinates: [
      [3.5, 6.45],
      [3.6, 6.45],
    ],
    corridorHalfWidthMeters: 100,
    startChainageKm: 0,
  });

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

  it('linear: offset beyond the half-width, chainage kept', () => {
    const at = (m: number) => ({ latitude: 6.45 + m / M_PER_DEG_LAT, longitude: 3.55 });
    const r = verifyPointAgainstGeofence(at(150), linear, 100);
    assert.equal(r.status, 'WITHIN_TOLERANCE');
    assert.ok(r.chainageKm !== null);
    assert.equal(verifyPointAgainstGeofence(at(250), linear, 100).status, 'OUTSIDE');
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
    for (const g of [radial, linear, SQUARE]) {
      const c = geofenceCentroid(g);
      const b = geofenceBounds(g);
      assert.ok(b.south < c.latitude && c.latitude < b.north, g.mode);
      assert.ok(b.west < c.longitude && c.longitude < b.east, g.mode);
    }
  });
});

describe('Phase 6 BOQ parser', () => {
  it('reads thousands separators and currency symbols', () => {
    assert.equal(parseBoqNumber('12,500'), 12500);
    assert.equal(parseBoqNumber('₦8,500,000.50'), 8500000.5);
    assert.equal(parseBoqNumber('(1,000)'), -1000);
    assert.equal(parseBoqNumber(''), null);
    assert.ok(Number.isNaN(parseBoqNumber('abc') as number));
  });

  it('uses "Item No" as the WBS code, not the description, and reports per-row issues', async () => {
    const csv = [
      'Item No,Description,Unit,Qty,Rate,Amount',
      '1.1,Excavation to formation level,m3,"12,500","4,500",',
      '1.2,Ab,m3,10,100,',
      '1.3,Blinding concrete,m3,,2000,',
      ',Formwork to columns,m2,50,3000,160000',
    ].join('\n');
    const preview = await previewBoqSpreadsheet(Buffer.from(csv).toString('base64'));
    assert.equal(preview.detectedColumns.wbsCode, 'Item No');
    assert.equal(preview.detectedColumns.description, 'Description');
    const [r1, r2, r3, r4] = preview.rows;
    assert.equal(r1.item?.wbsCode, '1.1');
    assert.equal(r1.item?.totalQuantity, 12500);
    assert.equal(r1.item?.budgetedCostNgn, 12500 * 4500);
    assert.equal(r2.item, null);
    assert.match(r2.errors.join(' '), /Description/);
    assert.equal(r3.item, null);
    assert.match(r3.errors.join(' '), /Quantity is empty/);
    assert.match(r4.warnings.join(' '), /No WBS code/);
    assert.match(r4.warnings.join(' '), /differs from quantity/);
    assert.equal(preview.validCount, 2);
    assert.equal(preview.errorCount, 2);
  });
});
