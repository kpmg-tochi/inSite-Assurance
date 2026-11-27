import fs from 'node:fs';
import { buildNeedsWorkbook } from '../../../modules/needs/workbook/needsWorkbook';
import { buildScopeWorkbook } from '../../../modules/scope/workbook/scopeWorkbook';
import { fillNeedsWorkbook } from './fillNeedsWorkbook';
import { fixtureBuildData } from './needsFixtureContext';
import { BATCH_SPECS, FIXTURE_SPECS, V1_SPEC, type NeedsFixtureSpec } from './needsFixtureSpecs';
import { needsFixturePath } from './needsFixtures';

/**
 * Needs pipeline wave 2 (Track A): writes the committed needs assessment fixtures. Run from `server/`:
 *   npx tsx src/tests/fixtures/needs/generateNeedsFixtures.ts
 * Each v2 file is a blank template from `buildNeedsWorkbook` (the cycle's programme, year and, for
 * Matching Grants, Kano) with the spec typed in by `fillNeedsWorkbook`. The v1 file comes from
 * `buildScopeWorkbook`.
 */

export async function buildFixtureFile(spec: NeedsFixtureSpec): Promise<Buffer> {
  const { buffer } = await buildNeedsWorkbook(fixtureBuildData(spec.programme));
  return fillNeedsWorkbook(buffer, spec);
}

export async function buildV1Fixture(): Promise<Buffer> {
  return buildScopeWorkbook({
    generatedAt: new Date('2026-11-26T00:00:00Z'),
    title: null,
    brandName: 'UBEC',
    project: {
      name: V1_SPEC.title,
      state: V1_SPEC.stateName,
      interventionYear: V1_SPEC.interventionYear,
      deliveryModel: 'Direct Intervention',
      strategicJustification: V1_SPEC.justification,
    },
    facilities: [
      { code: 'CLASSROOM', name: 'Classroom' },
      { code: 'TOILET', name: 'Toilet' },
      { code: 'BOREHOLE', name: 'Borehole' },
    ],
    regions: [],
    deliveryModels: ['Direct Intervention', 'Matching Grants'],
    sprints: [],
    units: V1_SPEC.units.map((u) => ({ ...u, plannedQuantity: null, quantityUnit: null, startSprint: null, endSprint: null, siteNumber: 1 })),
    lines: V1_SPEC.lines.map((l) => ({ ...l })),
    sites: [
      {
        siteNumber: 1,
        schoolName: V1_SPEC.site.schoolName,
        schoolLevel: 'PRIMARY',
        lga: 'Paikoro',
        address: null,
        latitude: V1_SPEC.site.latitude,
        longitude: V1_SPEC.site.longitude,
      },
    ],
  });
}

async function main() {
  for (const spec of [...FIXTURE_SPECS, ...BATCH_SPECS]) {
    fs.writeFileSync(needsFixturePath(spec.name), await buildFixtureFile(spec));
    console.log(`wrote ${spec.name}.xlsx`);
  }
  fs.writeFileSync(needsFixturePath(V1_SPEC.name), await buildV1Fixture());
  console.log(`wrote ${V1_SPEC.name}.xlsx`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
