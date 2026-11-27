import {
  CostingStandardSchema,
  DEFAULT_COSTING_STANDARD,
  standardRateFor,
  zoneOfState,
  type ExistingCondition,
  type FacilityCriticality,
  type InterventionAction,
  type SchoolLevel,
} from '@insite/shared';

/**
 * Needs pipeline wave 2 (Track A): the content of every needs assessment fixture, as a person would
 * type it into the template v2. `generateNeedsFixtures.ts` writes the files from these specs (blank
 * template from `buildNeedsWorkbook`, rows filled with exceljs); `needsFixtures.ts` derives the facts
 * tests assert from them.
 *
 * Seeded context the files parse against: the 50 `DEFAULT_FACILITIES`, `DEFAULT_COSTING_STANDARD` as
 * version 1, intervention year 2027. Direct Intervention files are in Niger State (zone NC, factor 1,
 * no seeded project there); Matching Grants files in Kano (zone NW, factor 1). Every school name is
 * distinct, except `di-design-valid` (the same schools as `di-draft-valid`: it is uploaded as a new
 * version of that proposal) and the deliberate duplicate in `duplicate-of-di-draft`. Locations are
 * kilometres apart, so no two fixtures' sites fall within the 100 m duplicate radius.
 */

export const FIXTURE_YEAR = 2027;
export const FIXTURE_COSTING_STANDARD_VERSION = 1;
export const FIXTURE_STANDARD = CostingStandardSchema.parse(DEFAULT_COSTING_STANDARD);
export const DI_PROGRAMME = 'Direct Intervention';
export const MG_PROGRAMME = 'Matching Grants';

export interface FixtureSite {
  siteNumber: number;
  schoolName: string;
  schoolLevel: SchoolLevel;
  lgaCode: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  enrolment: number | null;
}

export interface FixtureRow {
  unitId: string;
  siteNumber: number;
  /** A facility code (written as its catalogue name) or any text (written as is). */
  facility: string;
  /** An action code (written as its label) or any text. */
  action: InterventionAction | string;
  existingQuantity: number | null;
  condition: ExistingCondition;
  requiredQuantity: number;
  proposedQuantity: number | null;
  unit: string;
  preliminaryCostNgn: number | null;
  justification: string;
  priority: FacilityCriticality;
  evidence: string | null;
}

export interface FixtureLine {
  wbsCode: string;
  unitId: string;
  itemCode: string | null;
  description: string;
  unit: string;
  quantity: number;
  rate: number;
}

export interface NeedsFixtureSpec {
  name: string;
  programme: 'DI' | 'MG';
  /** Parses without issues against the seeded context. */
  valid: boolean;
  project: {
    title: string;
    interventionYear: number;
    /** State code; written as the State name. */
    stateCode: string;
    justification: string;
    assumptions: string | null;
    beneficiaries: string | null;
    estimatedDurationMonths: number | null;
  };
  sites: FixtureSite[];
  rows: FixtureRow[];
  lines: FixtureLine[];
  supervisionMonitoringPct: number;
  contingencyPct: number;
}

/** The standard's rate for an item in the State's zone (base rate × zone factor). */
export function stdRate(itemCode: string, stateCode: string): number {
  const rate = standardRateFor(FIXTURE_STANDARD, itemCode, zoneOfState(stateCode));
  if (rate === null) throw new Error(`Unknown item code ${itemCode}`);
  return rate;
}

const stdDescription = (itemCode: string) => FIXTURE_STANDARD.rates.find((r) => r.itemCode === itemCode)!.description;
const stdUnit = (itemCode: string) => FIXTURE_STANDARD.rates.find((r) => r.itemCode === itemCode)!.unitOfMeasure;

/** A BoQ line at the standard rate (or `rate` when given). */
function line(wbsCode: string, unitId: string, itemCode: string, quantity: number, stateCode: string, rate?: number): FixtureLine {
  return { wbsCode, unitId, itemCode, description: stdDescription(itemCode), unit: stdUnit(itemCode), quantity, rate: rate ?? stdRate(itemCode, stateCode) };
}

function row(
  unitId: string,
  siteNumber: number,
  facility: string,
  action: InterventionAction | string,
  existingQuantity: number | null,
  condition: ExistingCondition,
  requiredQuantity: number,
  proposedQuantity: number | null,
  priority: FacilityCriticality,
  justification: string,
  extra: Partial<FixtureRow> = {}
): FixtureRow {
  return {
    unitId,
    siteNumber,
    facility,
    action,
    existingQuantity,
    condition,
    requiredQuantity,
    proposedQuantity,
    unit: 'nr',
    preliminaryCostNgn: null,
    justification,
    priority,
    evidence: null,
    ...extra,
  };
}

function site(siteNumber: number, schoolName: string, lgaCode: string, latitude: number | null, longitude: number | null, extra: Partial<FixtureSite> = {}): FixtureSite {
  return {
    siteNumber,
    schoolName,
    schoolLevel: 'PRIMARY',
    lgaCode,
    address: null,
    latitude,
    longitude,
    enrolment: null,
    ...extra,
  };
}

/** Toilets, water and solar for one site, all proposed (unit IDs `<prefix>1`…`<prefix>3`). */
function essentials(prefix: string, siteNumber: number, withCosts: boolean): FixtureRow[] {
  return [
    row(`${prefix}1`, siteNumber, 'TOILET', 'NEW_CONSTRUCTION', 0, 'ABSENT', 1, 1, 'ESSENTIAL', 'No toilet on site; pupils use open ground.', withCosts ? { preliminaryCostNgn: 6_800_000 } : {}),
    row(`${prefix}2`, siteNumber, 'BOREHOLE', 'NEW_CONSTRUCTION', 0, 'ABSENT', 1, 1, 'ESSENTIAL', 'No safe water within 1 km of the school.', withCosts ? { preliminaryCostNgn: 7_500_000 } : {}),
    row(`${prefix}3`, siteNumber, 'SOLAR_POWER', 'NEW_CONSTRUCTION', 0, 'ABSENT', 1, 1, 'ESSENTIAL', 'The school is off grid.', withCosts ? { preliminaryCostNgn: 6_200_000 } : {}),
  ];
}

/** Standard-rate BoQ lines for `essentials(prefix, …)`. */
function essentialLines(prefix: string, stateCode: string, firstItem: number): FixtureLine[] {
  return [
    line(`${firstItem}.01`, `${prefix}1`, 'TLT-NEW', 1, stateCode),
    line(`${firstItem + 1}.01`, `${prefix}2`, 'BHL-SOLAR', 1, stateCode),
    line(`${firstItem + 2}.01`, `${prefix}3`, 'SOL-5KVA', 1, stateCode),
  ];
}

const NI = 'NI';
const KN = 'KN';

// ---------------------------------------------------------------------------
// Direct Intervention: the draft and its design version
// ---------------------------------------------------------------------------

const DI_DRAFT_SITES: FixtureSite[] = [
  site(1, 'Government Day Primary School Bosso', 'NI-BOSSO', 9.652, 6.515, { address: 'Bosso Road, Bosso', enrolment: 640 }),
  site(2, 'LGEA Primary School Maikunkele', 'NI-BOSSO', 9.701, 6.481, { enrolment: 410 }),
];

const DI_DRAFT_ROWS: FixtureRow[] = [
  row('U01', 1, 'CLASSROOM', 'RENOVATION', 6, 'DILAPIDATED', 6, 4, 'HIGH', 'Roofs leak and floors are broken in four of six classrooms.', { preliminaryCostNgn: 12_800_000, evidence: 'Photos 1–4' }),
  row('U02', 1, 'TOILET', 'NEW_CONSTRUCTION', 0, 'ABSENT', 2, 1, 'ESSENTIAL', 'No toilet on site for 640 pupils.', { preliminaryCostNgn: 6_800_000 }),
  row('U03', 1, 'BOREHOLE', 'RENOVATION', 1, 'FUNCTIONAL', 1, 0, 'ESSENTIAL', 'The motorised borehole works; no work needed.'),
  row('U04', 1, 'SOLAR_POWER', 'NEW_CONSTRUCTION', 0, 'ABSENT', 1, 1, 'ESSENTIAL', 'The school is off grid.', { preliminaryCostNgn: 6_200_000 }),
  row('U05', 2, 'CLASSROOM', 'NEW_CONSTRUCTION', 3, 'NON_FUNCTIONAL', 2, 2, 'HIGH', 'Two classes are taught under a tree.', { preliminaryCostNgn: 19_000_000 }),
  row('U06', 2, 'TOILET', 'RENOVATION', 1, 'PARTLY_FUNCTIONAL', 1, 1, 'ESSENTIAL', 'Fittings broken; the pit is full.', { preliminaryCostNgn: 1_900_000 }),
  row('U07', 2, 'OVERHEAD_TANK', 'NEW_CONSTRUCTION', 0, 'ABSENT', 1, 1, 'ESSENTIAL', 'Water from the community borehole needs storage.', { preliminaryCostNgn: 1_650_000 }),
  row('U08', 2, 'SOLAR_POWER', 'RENOVATION', 1, 'FUNCTIONAL', 1, 0, 'ESSENTIAL', 'Solar system installed in 2024 and working.'),
  row('U09', 2, 'PUPILS_FURNITURE', 'FURNISHING', 40, 'DILAPIDATED', 80, 60, 'MEDIUM', 'Pupils sit on the floor in three classes.', { preliminaryCostNgn: 4_080_000 }),
];

const DI_DRAFT_PROJECT = {
  title: 'Renovation and WASH works, Bosso schools',
  interventionYear: FIXTURE_YEAR,
  stateCode: NI,
  justification: 'Two primary schools in Bosso LGA with dilapidated classrooms and no safe sanitation.',
  assumptions: 'Sites are free of encumbrance; the community provides access.',
  beneficiaries: '1,050 pupils and 28 teachers',
  estimatedDurationMonths: 9,
};

const diDraftValid: NeedsFixtureSpec = {
  name: 'di-draft-valid',
  programme: 'DI',
  valid: true,
  project: DI_DRAFT_PROJECT,
  sites: DI_DRAFT_SITES,
  rows: DI_DRAFT_ROWS,
  lines: [],
  supervisionMonitoringPct: 5,
  contingencyPct: 5,
};

const diDesignValid: NeedsFixtureSpec = {
  name: 'di-design-valid',
  programme: 'DI',
  valid: true,
  project: { ...DI_DRAFT_PROJECT, assumptions: 'Designs follow the UBEC standard classroom and toilet drawings.' },
  sites: DI_DRAFT_SITES,
  rows: DI_DRAFT_ROWS.map((r) => ({ ...r, preliminaryCostNgn: null })),
  lines: [
    line('1.01', 'U01', 'CLS-REN', 4, NI),
    line('2.01', 'U02', 'TLT-NEW', 1, NI),
    line('4.01', 'U04', 'SOL-5KVA', 1, NI),
    line('5.01', 'U05', 'CLS-NEW', 2, NI),
    line('5.02', 'U05', 'GEN-SITECLR', 400, NI),
    { wbsCode: '5.03', unitId: 'U05', itemCode: null, description: 'Project signboard', unit: 'nr', quantity: 1, rate: 85_000 },
    line('6.01', 'U06', 'TLT-REN', 1, NI),
    line('7.01', 'U07', 'OHT-5000', 1, NI),
    line('9.01', 'U09', 'FUR-PUP-2', 60, NI),
  ],
  supervisionMonitoringPct: 5,
  contingencyPct: 5,
};

// ---------------------------------------------------------------------------
// Matching Grants (Kano)
// ---------------------------------------------------------------------------

const mgCompleteValid: NeedsFixtureSpec = {
  name: 'mg-complete-valid',
  programme: 'MG',
  valid: true,
  project: {
    title: 'Classrooms and WASH, Bebeji and Garko',
    interventionYear: FIXTURE_YEAR,
    stateCode: KN,
    justification: 'Overcrowded classrooms and no sanitation at two schools on the State priority list.',
    assumptions: 'State counterpart funds are in the 2027 budget.',
    beneficiaries: '1,220 pupils',
    estimatedDurationMonths: 8,
  },
  sites: [
    site(1, 'Gidan Maharba Primary School', 'KN-BEBEJI', 11.67, 8.26, { enrolment: 520 }),
    site(2, 'Kofar Kudu Junior Secondary School', 'KN-GARKO', 11.65, 8.8, { schoolLevel: 'JSS', enrolment: 700 }),
  ],
  rows: [
    row('U01', 1, 'CLASSROOM', 'NEW_CONSTRUCTION', 4, 'NON_FUNCTIONAL', 3, 2, 'HIGH', 'Four classrooms condemned by the State engineer.'),
    ...essentials('U1', 1, false).map((r, i) => ({ ...r, unitId: `U0${i + 2}` })),
    row('U05', 2, 'TOILET', 'RENOVATION', 2, 'DILAPIDATED', 2, 2, 'ESSENTIAL', 'Both toilet blocks are unusable.'),
    row('U06', 2, 'OVERHEAD_TANK', 'RENOVATION', 1, 'FUNCTIONAL', 1, 0, 'ESSENTIAL', 'The tank and borehole work.'),
    row('U07', 2, 'SOLAR_POWER', 'NEW_CONSTRUCTION', 0, 'ABSENT', 1, 1, 'ESSENTIAL', 'The school is off grid.'),
    row('U08', 2, 'MAGNETIC_BOARD', 'EQUIPPING', 2, 'PARTLY_FUNCTIONAL', 8, 6, 'MEDIUM', 'Chalkboards are worn out.'),
  ],
  lines: [
    line('1.01', 'U01', 'CLS-NEW', 2, KN),
    line('2.01', 'U02', 'TLT-NEW', 1, KN),
    line('3.01', 'U03', 'BHL-SOLAR', 1, KN),
    line('4.01', 'U04', 'SOL-5KVA', 1, KN),
    line('5.01', 'U05', 'TLT-REN', 2, KN),
    line('7.01', 'U07', 'SOL-5KVA', 1, KN),
    line('8.01', 'U08', 'BRD-MAG', 6, KN),
  ],
  supervisionMonitoringPct: 5,
  contingencyPct: 5,
};

const mgNoBoq: NeedsFixtureSpec = {
  name: 'mg-no-boq',
  programme: 'MG',
  valid: false,
  project: {
    title: 'Classrooms for Dan Hassan',
    interventionYear: FIXTURE_YEAR,
    stateCode: KN,
    justification: 'Two classes share one room.',
    assumptions: null,
    beneficiaries: '380 pupils',
    estimatedDurationMonths: 6,
  },
  sites: [site(1, 'Dan Hassan Primary School', 'KN-KURA', 11.77, 8.43, { enrolment: 380 })],
  rows: [row('U01', 1, 'CLASSROOM', 'NEW_CONSTRUCTION', 2, 'DILAPIDATED', 2, 2, 'HIGH', 'Two classes share one room.'), ...essentials('U0', 1, false).map((r, i) => ({ ...r, unitId: `U0${i + 2}` }))],
  lines: [],
  supervisionMonitoringPct: 5,
  contingencyPct: 5,
};

// ---------------------------------------------------------------------------
// Direct Intervention: problem files
// ---------------------------------------------------------------------------

const rowErrors: NeedsFixtureSpec = {
  name: 'row-errors',
  programme: 'DI',
  valid: false,
  project: {
    title: 'Sabon Gari and Kpakungu school works',
    interventionYear: FIXTURE_YEAR,
    stateCode: NI,
    justification: 'Classrooms and sanitation at two Minna schools.',
    assumptions: null,
    beneficiaries: null,
    estimatedDurationMonths: 6,
  },
  sites: [
    site(1, 'Sabon Gari Primary School Minna', 'NI-CHANCHAGA', 9.62, 6.55),
    // An LGA of Kano, not of Niger.
    site(2, 'Kpakungu Primary School', 'KN-GWALE', 9.58, 6.53),
  ],
  rows: [
    // Not in the facility catalogue.
    row('U01', 1, 'SWIMMING_POOL', 'NEW_CONSTRUCTION', 0, 'ABSENT', 1, 1, 'OPTIONAL', 'Requested by the community.'),
    // Absent with an existing quantity.
    row('U02', 1, 'TOILET', 'NEW_CONSTRUCTION', 2, 'ABSENT', 1, 1, 'ESSENTIAL', 'No usable toilet.'),
    row('U03', 1, 'BOREHOLE', 'NEW_CONSTRUCTION', 0, 'ABSENT', 1, 1, 'ESSENTIAL', 'No water.'),
    row('U04', 1, 'SOLAR_POWER', 'NEW_CONSTRUCTION', 0, 'ABSENT', 1, 1, 'ESSENTIAL', 'Off grid.'),
    row('U05', 2, 'CLASSROOM', 'RENOVATION', 4, 'DILAPIDATED', 4, 4, 'HIGH', 'Leaking roofs.'),
  ],
  lines: [
    line('2.01', 'U02', 'TLT-NEW', 1, NI),
    line('5.01', 'U05', 'CLS-REN', 4, NI),
    // Names a unit ID the breakdown does not have.
    line('9.01', 'U99', 'FUR-PUP-2', 40, NI),
  ],
  supervisionMonitoringPct: 5,
  contingencyPct: 5,
};

const duplicateOfDiDraft: NeedsFixtureSpec = {
  name: 'duplicate-of-di-draft',
  programme: 'DI',
  valid: true,
  project: {
    title: 'Library and water for Bosso Day School',
    interventionYear: FIXTURE_YEAR,
    stateCode: NI,
    justification: 'The school has no library and no safe water.',
    assumptions: null,
    beneficiaries: '640 pupils',
    estimatedDurationMonths: 7,
  },
  // Same school as di-draft-valid's site 1: other case and spacing, same LGA.
  sites: [site(1, 'GOVERNMENT  DAY primary school,  Bosso', 'NI-BOSSO', null, null)],
  rows: [
    row('L01', 1, 'LIBRARY', 'NEW_CONSTRUCTION', 0, 'ABSENT', 1, 1, 'HIGH', 'No library at the school.'),
    ...essentials('L0', 1, false).map((r, i) => ({ ...r, unitId: `L0${i + 2}` })),
  ],
  lines: [],
  supervisionMonitoringPct: 5,
  contingencyPct: 5,
};

const essentialGap: NeedsFixtureSpec = {
  name: 'essential-gap',
  programme: 'DI',
  valid: true,
  project: {
    title: 'Classroom renovation, Tunga',
    interventionYear: FIXTURE_YEAR,
    stateCode: NI,
    justification: 'Roofs blown off in the 2026 storm.',
    assumptions: null,
    beneficiaries: '450 pupils',
    estimatedDurationMonths: 5,
  },
  sites: [site(1, 'Tunga Primary School', 'NI-CHANCHAGA', 9.6, 6.57)],
  // No borehole or overhead tank row: the Water group is not covered.
  rows: [
    row('U01', 1, 'CLASSROOM', 'RENOVATION', 6, 'DILAPIDATED', 6, 6, 'HIGH', 'Roofs blown off.'),
    row('U02', 1, 'TOILET', 'NEW_CONSTRUCTION', 0, 'ABSENT', 1, 1, 'ESSENTIAL', 'No toilet.'),
    row('U03', 1, 'SOLAR_POWER', 'NEW_CONSTRUCTION', 0, 'ABSENT', 1, 1, 'ESSENTIAL', 'Off grid.'),
  ],
  lines: [],
  supervisionMonitoringPct: 5,
  contingencyPct: 5,
};

const rateVariance: NeedsFixtureSpec = {
  name: 'rate-variance',
  programme: 'DI',
  valid: true,
  project: {
    title: 'Furniture and WASH, Lapai Model',
    interventionYear: FIXTURE_YEAR,
    stateCode: NI,
    justification: 'Pupils sit on the floor; no sanitation.',
    assumptions: null,
    beneficiaries: '520 pupils',
    estimatedDurationMonths: 4,
  },
  sites: [site(1, 'Lapai Model Primary School', 'NI-LAPAI', 9.05, 6.57)],
  rows: [...essentials('U0', 1, false), row('U04', 1, 'PUPILS_FURNITURE', 'FURNISHING', 10, 'DILAPIDATED', 100, 80, 'MEDIUM', 'Pupils sit on the floor.')],
  lines: [
    ...essentialLines('U0', NI, 1),
    // 30 % above the standard rate (tolerance 15 %); furniture has no ceiling.
    line('4.01', 'U04', 'FUR-PUP-2', 80, NI, Math.round(stdRate('FUR-PUP-2', NI) * 1.3)),
  ],
  supervisionMonitoringPct: 5,
  contingencyPct: 5,
};

const missingSmLine: NeedsFixtureSpec = {
  name: 'missing-sm-line',
  programme: 'DI',
  valid: true,
  project: {
    title: 'WASH and classrooms, Bida Township',
    interventionYear: FIXTURE_YEAR,
    stateCode: NI,
    justification: 'No sanitation and two condemned classrooms.',
    assumptions: null,
    beneficiaries: '700 pupils',
    estimatedDurationMonths: 6,
  },
  sites: [site(1, 'Bida Township Primary School', 'NI-BIDA', 9.08, 6.01)],
  rows: [...essentials('U0', 1, false), row('U04', 1, 'CLASSROOM', 'NEW_CONSTRUCTION', 2, 'NON_FUNCTIONAL', 2, 2, 'HIGH', 'Two classrooms condemned.')],
  lines: [...essentialLines('U0', NI, 1), line('4.01', 'U04', 'CLS-NEW', 2, NI)],
  // No supervision and monitoring line.
  supervisionMonitoringPct: 0,
  contingencyPct: 5,
};

// ---------------------------------------------------------------------------
// Batch of five (batch-4 invalid)
// ---------------------------------------------------------------------------

function batchDraft(n: number, school: string, lgaCode: string, lat: number, lng: number, withBoq: boolean): NeedsFixtureSpec {
  return {
    name: `batch-${n}`,
    programme: 'DI',
    valid: true,
    project: {
      title: `WASH and solar, ${school}`,
      interventionYear: FIXTURE_YEAR,
      stateCode: NI,
      justification: 'No sanitation, no safe water and no power at the school.',
      assumptions: null,
      beneficiaries: null,
      estimatedDurationMonths: 4,
    },
    sites: [site(1, school, lgaCode, lat, lng)],
    rows: essentials('B0', 1, !withBoq),
    lines: withBoq ? essentialLines('B0', NI, 1) : [],
    supervisionMonitoringPct: 5,
    contingencyPct: 5,
  };
}

const batch4: NeedsFixtureSpec = {
  ...batchDraft(4, 'Mokwa Primary School', 'NI-MOKWA', 9.29, 5.05, false),
  valid: false,
  rows: [
    // Not an intervention action; no proposed quantity.
    { ...essentials('B0', 1, true)[0], action: 'Build it' },
    { ...essentials('B0', 1, true)[1], proposedQuantity: null },
    essentials('B0', 1, true)[2],
  ],
};

export const BATCH_SPECS: NeedsFixtureSpec[] = [
  batchDraft(1, 'Agaie Central Primary School', 'NI-AGAIE', 9.0, 6.32, false),
  batchDraft(2, 'Kontagora Model Primary School', 'NI-KONTAGORA', 10.4, 5.47, false),
  batchDraft(3, 'Suleja Township Primary School', 'NI-SULEJA', 9.18, 7.18, true),
  batch4,
  batchDraft(5, 'Rijau Primary School', 'NI-RIJAU', 11.1, 5.25, true),
];

// ---------------------------------------------------------------------------
// v1 scope workbook (old template)
// ---------------------------------------------------------------------------

/** The v1 file (built with `buildScopeWorkbook`): one site, three facility units, four lines. */
export const V1_SPEC = {
  name: 'v1-scope-workbook',
  title: 'Classroom block, Paiko Central',
  stateCode: NI,
  stateName: 'Niger',
  interventionYear: FIXTURE_YEAR,
  justification: 'The classroom block collapsed in 2026.',
  site: site(1, 'Paiko Central Primary School', 'NI-PAIKORO', 9.43, 6.63),
  units: [
    { code: 'U01', facilityName: 'Classroom', label: 'Classroom block A' },
    { code: 'U02', facilityName: 'Toilet', label: 'Toilet block' },
    { code: 'U03', facilityName: 'Borehole', label: 'Borehole' },
  ],
  lines: [
    { wbsCode: '1.01', unitCode: 'U01', description: 'New classroom to the standard design', unit: 'nr', totalQuantity: 3, rateNgn: 9_500_000 },
    { wbsCode: '1.02', unitCode: 'U01', description: 'Site clearance and setting out', unit: 'm2', totalQuantity: 600, rateNgn: 650 },
    { wbsCode: '2.01', unitCode: 'U02', description: 'New 4-compartment toilet block', unit: 'nr', totalQuantity: 1, rateNgn: 6_800_000 },
    { wbsCode: '3.01', unitCode: 'U03', description: 'Motorised borehole with solar pump', unit: 'nr', totalQuantity: 1, rateNgn: 7_500_000 },
  ],
} as const;

/** Every named fixture except the batch and the v1 file, by name. */
export const FIXTURE_SPECS: NeedsFixtureSpec[] = [
  diDraftValid,
  diDesignValid,
  mgCompleteValid,
  mgNoBoq,
  rowErrors,
  duplicateOfDiDraft,
  essentialGap,
  rateVariance,
  missingSmLine,
];
