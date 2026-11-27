import { DEFAULT_DI_NEEDS_PIPELINE, DEFAULT_FACILITIES, DEFAULT_MG_NEEDS_PIPELINE, NeedsPipelineConfigSchema, type NeedsStage, type NeedsTemplateFieldKey } from '@insite/shared';
import type { NeedsWorkbookBuildData, NeedsWorkbookFacility, NeedsWorkbookParseContext } from '../../../modules/needs/workbook/needsWorkbook';
import { DI_PROGRAMME, FIXTURE_COSTING_STANDARD_VERSION, FIXTURE_STANDARD, FIXTURE_YEAR, MG_PROGRAMME, type NeedsFixtureSpec } from './needsFixtureSpecs';

/**
 * Needs pipeline wave 2 (Track A): the seeded context as plain data (no database), for building the
 * fixtures and for the parser's unit tests: the 50 default facilities (fake ids), costing standard
 * version 1, intervention year 2027, and the default pipelines' minimum fields.
 */

export const FIXTURE_FACILITIES: NeedsWorkbookFacility[] = DEFAULT_FACILITIES.map((f, i) => ({
  id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`,
  code: f.code,
  name: f.name,
  isRetired: false,
}));

export const DI_CONFIG = NeedsPipelineConfigSchema.parse(DEFAULT_DI_NEEDS_PIPELINE);
export const MG_CONFIG = NeedsPipelineConfigSchema.parse(DEFAULT_MG_NEEDS_PIPELINE);

/** The minimum fields of a stage (`minimumFieldsFor`), as the service passes them. */
export function requiredFieldsFor(programme: 'DI' | 'MG', stage: NeedsStage): NeedsTemplateFieldKey[] {
  const config = programme === 'DI' ? DI_CONFIG : MG_CONFIG;
  return config.minimumFields[stage] ?? [];
}

export function fixtureBuildData(programme: 'DI' | 'MG', overrides: Partial<NeedsWorkbookBuildData> = {}): NeedsWorkbookBuildData {
  return {
    tenantShortName: 'UBEC',
    programmeName: programme === 'DI' ? DI_PROGRAMME : MG_PROGRAMME,
    interventionYear: FIXTURE_YEAR,
    stateCode: programme === 'MG' ? 'KN' : null,
    costingStandard: { version: FIXTURE_COSTING_STANDARD_VERSION, standard: FIXTURE_STANDARD },
    facilities: FIXTURE_FACILITIES,
    prefill: null,
    proposalReference: null,
    ...overrides,
  };
}

export function fixtureParseContext(programme: 'DI' | 'MG', stage: NeedsStage = 'IDENTIFICATION', overrides: Partial<NeedsWorkbookParseContext> = {}): NeedsWorkbookParseContext {
  return {
    facilities: FIXTURE_FACILITIES,
    interventionYear: FIXTURE_YEAR,
    cycleStateCode: programme === 'MG' ? 'KN' : null,
    requiredFields: requiredFieldsFor(programme, stage),
    costingStandard: { version: FIXTURE_COSTING_STANDARD_VERSION, standard: FIXTURE_STANDARD },
    ...overrides,
  };
}

/** The stage a fixture is uploaded at (design versions at Design). */
export function fixtureStage(spec: Pick<NeedsFixtureSpec, 'name'>): NeedsStage {
  return spec.name === 'di-design-valid' ? 'DESIGN' : 'IDENTIFICATION';
}
