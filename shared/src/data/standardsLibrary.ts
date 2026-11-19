import type { StandardCategory } from '../enums';

/**
 * Starter library of common Nigerian infrastructure standards (Phase 7).
 *
 * THESE ARE EDITABLE TEMPLATES, NOT AUTHORITATIVE TEXT. Each entry names the document it is based
 * on so the monitor can check it, but the wording, clause references and numeric values here are
 * typical starting points only. The monitor must confirm the edition, clauses and values against
 * the contract specification before adding a standard to a project.
 *
 * Numeric values are written as "<test> <value> ± <tolerance> <unit>", "<test> minimum <value>" or
 * "<test> maximum <value>" so the rule-based standards check can read them.
 */
export interface StandardLibraryEntry {
  /** Suggested project code; the monitor may change it. */
  code: string;
  title: string;
  category: StandardCategory;
  /** The document the template is based on. Verify edition and clauses before use. */
  basedOn: string;
  specificationText: string;
  /** Suggested WBS keywords to help the monitor pick items; not applied automatically. */
  suggestedFor: string[];
  isMandatory: boolean;
}

export const STANDARDS_LIBRARY_DISCLAIMER =
  'Templates only. Confirm the edition, clause numbers and every value against the contract specification before use.';

export const STANDARDS_LIBRARY: StandardLibraryEntry[] = [
  {
    code: 'CONC-SLUMP',
    title: 'Fresh concrete workability (slump)',
    category: 'TESTING_TOLERANCE',
    basedOn: 'BS EN 12350-2 (slump test), as commonly specified on Nigerian projects',
    specificationText:
      'Slump 75 ± 25 mm for structural concrete unless the mix design states otherwise. Record the slump test result for every pour, with a photo of the measured cone, and reject batches outside the range.',
    suggestedFor: ['concrete', 'pour', 'slab', 'column', 'beam', 'culvert'],
    isMandatory: true,
  },
  {
    code: 'CONC-CUBE',
    title: 'Concrete compressive strength (cube tests)',
    category: 'TESTING_TOLERANCE',
    basedOn: 'BS EN 12390-3 (compressive strength of test specimens)',
    specificationText:
      'Cube strength minimum 25 N/mm² at 28 days for grade C25 (adjust to the specified grade). Cast cube samples for each pour, log the cube reference, and attach the lab cube test certificate when results are available.',
    suggestedFor: ['concrete', 'pour', 'slab', 'column', 'beam', 'culvert'],
    isMandatory: true,
  },
  {
    code: 'REBAR-COVER',
    title: 'Reinforcement cover and spacing before pour',
    category: 'EXECUTION_METHOD',
    basedOn: 'BS 8110-1 / BS EN 1992-1-1 cover requirements, as adopted in the contract',
    specificationText:
      'Cover minimum 50 mm for foundations and members in contact with soil; spacing as per drawings. Inspect and photograph reinforcement, spacers and cover blocks before concrete is placed.',
    suggestedFor: ['reinforcement', 'rebar', 'foundation', 'footing'],
    isMandatory: true,
  },
  {
    code: 'REBAR-NIS117',
    title: 'Reinforcement steel quality',
    category: 'MATERIAL_QUALITY',
    basedOn: 'NIS 117 (steel bars for reinforcement of concrete)',
    specificationText:
      'Reinforcement steel must conform to the specified NIS grade. Keep the mill certificate for each delivery and record bar diameters and quantities delivered.',
    suggestedFor: ['reinforcement', 'rebar', 'steel'],
    isMandatory: true,
  },
  {
    code: 'CEM-NIS444',
    title: 'Cement quality',
    category: 'MATERIAL_QUALITY',
    basedOn: 'NIS 444-1 (composition, specification and conformity criteria for common cements)',
    specificationText:
      'Use cement of the specified strength class conforming to NIS 444-1. Record the brand, strength class and batch for each delivery; reject caked or expired bags.',
    suggestedFor: ['concrete', 'cement', 'blockwork', 'plaster'],
    isMandatory: false,
  },
  {
    code: 'BLOCK-NIS87',
    title: 'Sandcrete blocks',
    category: 'MATERIAL_QUALITY',
    basedOn: 'NIS 87 (standard for sandcrete blocks)',
    specificationText:
      'Block compressive strength minimum 2.5 N/mm² for load-bearing blocks (confirm against the specified block type). Record the supplier and keep the block test certificate.',
    suggestedFor: ['block', 'blockwork', 'wall'],
    isMandatory: false,
  },
  {
    code: 'EARTH-COMPACT',
    title: 'Subgrade and sub-base compaction',
    category: 'TESTING_TOLERANCE',
    basedOn: 'FMW General Specification (Roads and Bridges) and BS 1377 compaction tests',
    specificationText:
      'Compaction minimum 95 % of maximum dry density for subgrade and sub-base layers (confirm the layer requirement). Record field density test results with chainage and attach the test sheet.',
    suggestedFor: ['earthworks', 'subgrade', 'sub-base', 'compaction', 'road'],
    isMandatory: true,
  },
  {
    code: 'ROAD-THICK',
    title: 'Pavement layer thickness',
    category: 'TESTING_TOLERANCE',
    basedOn: 'FMW General Specification (Roads and Bridges)',
    specificationText:
      'Layer thickness 150 ± 10 mm for base course unless the drawings state otherwise. Record measured thickness at the chainages inspected.',
    suggestedFor: ['base course', 'pavement', 'asphalt', 'road'],
    isMandatory: false,
  },
  {
    code: 'BLD-CODE',
    title: 'Building works general requirements',
    category: 'GENERAL_SPECIFICATION',
    basedOn: 'National Building Code of Nigeria',
    specificationText:
      'Building works follow the approved drawings and the National Building Code. Any deviation from the drawings needs a written instruction recorded in the report.',
    suggestedFor: ['building', 'superstructure'],
    isMandatory: false,
  },
  {
    code: 'HSE-SITE',
    title: 'Site safety and environment',
    category: 'SAFETY_ENVIRONMENT',
    basedOn: 'Contract HSE plan and the project environmental management plan',
    specificationText:
      'Workers on site wear PPE; excavations deeper than 1.5 m are supported or battered; spoil and waste are disposed of at approved locations. Report any incident the same day.',
    suggestedFor: [],
    isMandatory: false,
  },
];
