import type {
  EssentialFacilityGroup,
  NeedsPipelineConfigInput,
  NeedsRubricInput,
  NeedsTemplateFieldKey,
  RubricCriterion,
} from '../schemas/needsPipeline.schema';

/**
 * Needs pipeline N1: the default pipelines of the two UBEC programmes (plan sections 3, 4.3, 6.2
 * and 8). They are data: the seed merges them into the programme types' config, and each cycle
 * freezes its own copy when it opens. Working assumptions A1–A10 stand until the Minister demo
 * answers change them (plan 16.1).
 *
 * Calendar (A2): the cycle for intervention year Y runs in Y − 1. The PCM's "31 September" is read
 * as 30 September.
 */

const criterion = (key: string, dimension: RubricCriterion['dimension'], label: string, descriptors: [string, string, string, string, string]): RubricCriterion => ({
  key,
  dimension,
  label,
  descriptors,
});

/**
 * A6: Impact 60, Ease of Implementation 40 (PCM); five sub-criteria each, scale 1–5 with
 * descriptors, equal sub-weights (assumed; the PCM names the two dimensions only).
 */
export const DEFAULT_NEEDS_RUBRIC: NeedsRubricInput = {
  scale: 5,
  dimensions: [
    { key: 'IMPACT', label: 'Impact', weight: 60 },
    { key: 'EASE', label: 'Ease of implementation', weight: 40 },
  ],
  criteria: [
    criterion('strategic_alignment', 'IMPACT', 'Strategic alignment', [
      'No link to UBE priorities or the State plan',
      'A weak or indirect link to UBE priorities',
      'Supports one UBE priority',
      'Supports several UBE priorities',
      'Central to UBE priorities and named in the State or national plan',
    ]),
    criterion('severity_of_need', 'IMPACT', 'Severity of need', [
      'Existing facilities are adequate',
      'A minor gap; learning is not affected',
      'A clear gap that affects learning',
      'A serious gap: overcrowding or unsafe facilities',
      'Critical: no usable facility, or an immediate safety risk',
    ]),
    criterion('beneficiary_reach', 'IMPACT', 'Beneficiary reach', [
      'Fewer than 100 learners benefit',
      '100 to 249 learners benefit',
      '250 to 499 learners benefit',
      '500 to 999 learners benefit',
      '1,000 or more learners benefit',
    ]),
    criterion('educational_benefit', 'IMPACT', 'Educational benefit', [
      'No measurable effect on access or learning',
      'A small improvement in comfort only',
      'Improves the learning conditions of existing learners',
      'Improves learning conditions and attendance',
      'Brings out-of-school children into school or removes a barrier to completion',
    ]),
    criterion('equity', 'IMPACT', 'Equity', [
      'A well-served area with no disadvantaged group',
      'Mostly well-served learners',
      'A mixed catchment',
      'An underserved community, or a clear benefit for girls or learners with disabilities',
      'A hard-to-reach or conflict-affected community with the lowest access in the State',
    ]),
    criterion('site_readiness', 'EASE', 'Site readiness', [
      'No site identified, or ownership is disputed',
      'A site is identified; ownership is not documented',
      'Site documented; major clearing or access works needed',
      'Site documented and accessible; minor preparation needed',
      'Site documented, accessible and ready for possession',
    ]),
    criterion('technical_feasibility', 'EASE', 'Technical feasibility', [
      'Ground or access conditions make the works doubtful',
      'Feasible only with special engineering',
      'Feasible with some site-specific design',
      'Standard works with minor adaptation',
      'Standard works on a standard design',
    ]),
    criterion('design_scope_readiness', 'EASE', 'Design and scope readiness', [
      'Scope undefined',
      'Scope outlined; no drawings or quantities',
      'Scope and quantities defined; drawings incomplete',
      'Drawings and BoQ complete with minor gaps',
      'Standard drawings and a complete BoQ',
    ]),
    criterion('cost_funding_feasibility', 'EASE', 'Cost and funding feasibility', [
      'Cost far above the ceilings or the indicative budget',
      'Cost above the ceilings; needs re-scoping',
      'Cost near the ceilings with open rate variances',
      'Cost within the ceilings with minor variances',
      'Cost within the ceilings at standard rates',
    ]),
    criterion('delivery_complexity', 'EASE', 'Delivery complexity', [
      'Many sites or trades, long duration, high security or logistics risk',
      'Complex logistics or a long duration',
      'Moderate: several facilities on one or two sites',
      'Simple: a few facilities on one site',
      'Very simple: a single facility, short duration',
    ]),
  ],
  divergenceThreshold: 2,
  quorum: 3,
};

/** D-N.17 (PCM p.7, p.35): toilets, water and solar at every school site. */
export const DEFAULT_ESSENTIAL_FACILITY_GROUPS: EssentialFacilityGroup[] = [
  { label: 'Toilets', facilityCodes: ['TOILET'] },
  { label: 'Water', facilityCodes: ['BOREHOLE', 'OVERHEAD_TANK'] },
  { label: 'Solar', facilityCodes: ['SOLAR_POWER'] },
];

const IDENTIFICATION_FIELDS: NeedsTemplateFieldKey[] = ['NEED', 'SITES', 'BREAKDOWN', 'JUSTIFICATION'];
const COMPLETE_FIELDS: NeedsTemplateFieldKey[] = [...IDENTIFICATION_FIELDS, 'BOQ', 'DRAWINGS', 'PRELIMINARY_COST'];

/**
 * Direct Intervention (process owner: Director Physical Planning). One national cycle a year, owned
 * by UBEC HQ; proposals become draft projects at appropriation.
 */
export const DEFAULT_DI_NEEDS_PIPELINE: NeedsPipelineConfigInput = {
  enabled: true,
  fundingGate: 'APPROPRIATION',
  referencePrefix: 'DI',
  cycleScope: 'NATIONAL',
  cycleOpens: { month: 3, day: 1 },
  stages: [
    { stage: 'IDENTIFICATION', label: 'Identification', actorPermissionKey: 'needs:submit', deadline: { month: 5, day: 30 } },
    { stage: 'VALIDATION', label: 'Validation', actorPermissionKey: 'needs:validate', deadline: { month: 7, day: 31 } },
    { stage: 'DESIGN', label: 'Needs assessment completion', actorPermissionKey: 'needs:submit', deadline: { month: 9, day: 30 } },
    { stage: 'COSTING', label: 'Costing', actorPermissionKey: 'needs:cost', deadline: { month: 10, day: 14 } },
    { stage: 'PRIORITISATION', label: 'Prioritisation', actorPermissionKey: 'needs:chair_committee', deadline: { month: 10, day: 21 } },
    // Run by the NEEDS_PORTFOLIO chain; Procurement submits the list.
    { stage: 'APPROVAL', label: 'Approval', actorPermissionKey: null, deadline: { month: 10, day: 31 } },
    // The appropriation date is not known in advance: recorded when it happens.
    { stage: 'FUNDING', label: 'Budget and appropriation', actorPermissionKey: 'needs:record_funding', deadline: null },
  ],
  extraDeadlines: [
    { key: 'stakeholder-engagement-summary', label: 'Stakeholder engagement summary uploaded', stage: 'IDENTIFICATION', deadline: { month: 6, day: 30 } },
    { key: 'budget-submission', label: 'Budget submission to the Ministry', stage: 'FUNDING', deadline: { month: 12, day: 15 } },
  ],
  // A8: an identification draft needs the need, sites, breakdown and justification; the full needs
  // assessment (BoQ, drawings, preliminary cost) is due at the Design stage.
  minimumFields: { IDENTIFICATION: IDENTIFICATION_FIELDS, DESIGN: COMPLETE_FIELDS },
  rubric: DEFAULT_NEEDS_RUBRIC,
  essentialFacilityGroups: DEFAULT_ESSENTIAL_FACILITY_GROUPS,
  rateVarianceTolerancePct: 15,
  duplicateRadiusMeters: 100,
  duplicateLookbackYears: 3,
  requireSiteVerification: true,
  requireCounterpartEvidenceBeforeActivation: false,
  approvalChains: {
    NEEDS_PORTFOLIO: [
      // A9: Executive Management decisions are clicked by one accountable user, minutes attached.
      { label: 'Management review', requiredPermissionKey: 'needs:review_portfolio', organizationScope: 'PROJECT_OWNER' },
      { label: 'Executive Secretary approval', requiredPermissionKey: 'needs:approve_portfolio', organizationScope: 'PROJECT_OWNER', deadline: { month: 10, day: 31 } },
    ],
    BEAP: [],
    OUT_OF_CYCLE: [{ label: 'Executive Secretary approval', requiredPermissionKey: 'needs:approve_out_of_cycle', organizationScope: 'PROJECT_OWNER' }],
  },
};

/**
 * Matching Grants (owned by the SUBEB; UBEC gatekeeps). One cycle per State a year, owned by the
 * State's SUBEB; proposals become draft projects when UBEC approves the State's BEAP. The cycle's
 * owning organisation is the SUBEB, so PROJECT_OWNER steps are the SUBEB's and
 * PROJECT_OWNER_OR_ANCESTOR steps admit UBEC HQ above it.
 */
export const DEFAULT_MG_NEEDS_PIPELINE: NeedsPipelineConfigInput = {
  enabled: true,
  fundingGate: 'BEAP_APPROVAL',
  referencePrefix: 'MG',
  cycleScope: 'STATE',
  // The circular.
  cycleOpens: { month: 7, day: 31 },
  stages: [
    { stage: 'IDENTIFICATION', label: 'Identification', actorPermissionKey: 'needs:submit', deadline: { month: 8, day: 31 } },
    { stage: 'VALIDATION', label: 'Field verification', actorPermissionKey: 'needs:validate', deadline: { month: 9, day: 30 } },
    { stage: 'COSTING', label: 'Costing', actorPermissionKey: 'needs:cost', deadline: { month: 10, day: 14 } },
    { stage: 'PRIORITISATION', label: 'Prioritisation', actorPermissionKey: 'needs:chair_committee', deadline: { month: 10, day: 21 } },
    { stage: 'APPROVAL', label: 'State approval', actorPermissionKey: null, deadline: { month: 10, day: 30 } },
    { stage: 'FUNDING', label: 'BEAP', actorPermissionKey: null, deadline: { month: 11, day: 30 } },
  ],
  extraDeadlines: [{ key: 'beap-submitted', label: 'BEAP submitted to UBEC', stage: 'FUNDING', deadline: { month: 11, day: 15 } }],
  // A8: no Design stage, so a draft must be complete at upload.
  minimumFields: { IDENTIFICATION: COMPLETE_FIELDS },
  rubric: DEFAULT_NEEDS_RUBRIC,
  essentialFacilityGroups: DEFAULT_ESSENTIAL_FACILITY_GROUPS,
  rateVarianceTolerancePct: 15,
  duplicateRadiusMeters: 100,
  duplicateLookbackYears: 3,
  requireSiteVerification: true,
  // A5.
  requireCounterpartEvidenceBeforeActivation: true,
  approvalChains: {
    NEEDS_PORTFOLIO: [
      { label: 'SUBEB management review', requiredPermissionKey: 'needs:review_portfolio', organizationScope: 'PROJECT_OWNER', deadline: { month: 10, day: 27 } },
      { label: 'Executive Chairman endorsement', requiredPermissionKey: 'needs:approve_portfolio', organizationScope: 'PROJECT_OWNER', deadline: { month: 10, day: 30 } },
    ],
    // Plan section 7: the UBEC steps need an organisation outside the State's SUBEB subtree. No
    // organisation scope expresses "not the owner" yet; wave 4 enforces it in the BEAP service.
    BEAP: [
      { label: 'UBEC Physical Planning review', requiredPermissionKey: 'needs:review_beap', organizationScope: 'ANY', deadline: { month: 11, day: 22 } },
      { label: 'UBEC Executive Management approval', requiredPermissionKey: 'needs:approve_beap', organizationScope: 'ANY', deadline: { month: 11, day: 30 } },
    ],
    OUT_OF_CYCLE: [
      { label: 'Executive Chairman approval', requiredPermissionKey: 'needs:approve_out_of_cycle', organizationScope: 'PROJECT_OWNER' },
      { label: 'UBEC approval', requiredPermissionKey: 'needs:approve_out_of_cycle', organizationScope: 'ANY' },
    ],
  },
};
