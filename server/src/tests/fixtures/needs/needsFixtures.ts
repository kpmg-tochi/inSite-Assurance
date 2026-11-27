import fs from 'node:fs';
import path from 'node:path';
import { BATCH_SPECS, FIXTURE_SPECS, V1_SPEC, type NeedsFixtureSpec } from './needsFixtureSpecs';

/**
 * Needs pipeline wave 2 (Track A): the committed needs assessment fixtures (template v2 and one v1
 * scope workbook) and the facts tests assert. Regenerate the files with
 * `npx tsx src/tests/fixtures/needs/generateNeedsFixtures.ts` from `server/`.
 *
 * Every file parses against the seeded programme tenant: the 50 default facilities, costing standard
 * version 1 (`DEFAULT_COSTING_STANDARD`) and intervention year 2027. Direct Intervention files are in
 * Niger State, Matching Grants files in Kano.
 *
 * | Fixture | Programme | Parses | Flags it should raise |
 * | :--- | :--- | :--- | :--- |
 * | `di-draft-valid` | DI | yes (Identification) | none |
 * | `di-design-valid` | DI | yes (Design); a new version of `di-draft-valid` | none |
 * | `mg-complete-valid` | MG (Kano) | yes | none |
 * | `mg-no-boq` | MG (Kano) | refused at MG Identification: BoQ and preliminary cost missing | – |
 * | `row-errors` | DI | refused: unknown facility, Absent with quantity, BoQ unit ID unknown, LGA not in Niger | – |
 * | `duplicate-of-di-draft` | DI | yes | DUPLICATE (against `di-draft-valid`) |
 * | `essential-gap` | DI | yes | ESSENTIAL_FACILITY_GAP (Water) |
 * | `rate-variance` | DI | yes | RATE_VARIANCE (desks 30 % above) |
 * | `missing-sm-line` | DI | yes | MISSING_SUPERVISION_LINE |
 * | `v1-scope-workbook` | DI | yes at Identification only (old template warning) | none |
 * | `batch-1` … `batch-5` | DI | all but `batch-4` | none |
 */

export type NeedsFixtureName =
  | 'di-draft-valid'
  | 'di-design-valid'
  | 'mg-complete-valid'
  | 'mg-no-boq'
  | 'row-errors'
  | 'duplicate-of-di-draft'
  | 'essential-gap'
  | 'rate-variance'
  | 'missing-sm-line'
  | 'v1-scope-workbook';

export interface NeedsFixtureFacts {
  title: string;
  stateCode: string;
  interventionYear: number;
  /** As written in the file (sites in order). */
  schoolNames: string[];
  /** One per site, in site order. */
  lgaCodes: string[];
  siteCount: number;
  breakdownRowCount: number;
  boqLineCount: number;
  /** Breakdown unit IDs (v1 file: the BoQ lines' unit IDs, distinct, in order). */
  unitIds: string[];
}

export const NEEDS_FIXTURES_DIR = __dirname;

export const needsFixturePath = (name: NeedsFixtureName | string) => path.join(NEEDS_FIXTURES_DIR, `${name}.xlsx`);

/** The committed file. */
export function needsFixture(name: NeedsFixtureName): Buffer {
  return fs.readFileSync(needsFixturePath(name));
}

export function needsFixtureBase64(name: NeedsFixtureName): string {
  return needsFixture(name).toString('base64');
}

/** The five batch files in order (`batch-4` is invalid). */
export function needsBatchFixtures(): Array<{ fileName: string; buffer: Buffer; valid: boolean }> {
  return BATCH_SPECS.map((s) => ({ fileName: `${s.name}.xlsx`, buffer: fs.readFileSync(needsFixturePath(s.name)), valid: s.valid }));
}

export function factsOfSpec(s: NeedsFixtureSpec): NeedsFixtureFacts {
  return {
    title: s.project.title,
    stateCode: s.project.stateCode,
    interventionYear: s.project.interventionYear,
    schoolNames: s.sites.map((x) => x.schoolName),
    lgaCodes: s.sites.map((x) => x.lgaCode),
    siteCount: s.sites.length,
    breakdownRowCount: s.rows.length,
    boqLineCount: s.lines.length,
    unitIds: s.rows.map((r) => r.unitId),
  };
}

const v1Facts: NeedsFixtureFacts = {
  title: V1_SPEC.title,
  stateCode: V1_SPEC.stateCode,
  interventionYear: V1_SPEC.interventionYear,
  schoolNames: [V1_SPEC.site.schoolName],
  lgaCodes: [V1_SPEC.site.lgaCode],
  siteCount: 1,
  breakdownRowCount: 0,
  boqLineCount: V1_SPEC.lines.length,
  unitIds: [...new Set(V1_SPEC.lines.map((l) => l.unitCode))],
};

export const NEEDS_FIXTURE_FACTS = {
  ...Object.fromEntries(FIXTURE_SPECS.map((s) => [s.name, factsOfSpec(s)])),
  'v1-scope-workbook': v1Facts,
} as Record<NeedsFixtureName, NeedsFixtureFacts>;

/** Facts of the batch files, by file name. */
export const NEEDS_BATCH_FACTS: Record<string, NeedsFixtureFacts & { valid: boolean }> = Object.fromEntries(
  BATCH_SPECS.map((s) => [`${s.name}.xlsx`, { ...factsOfSpec(s), valid: s.valid }])
);
