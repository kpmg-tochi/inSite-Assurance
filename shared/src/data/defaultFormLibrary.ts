import type { FacilityArchetype } from '../schemas/facility.schema';
import type { FormFieldInput, FormFieldRuleInput, SaveVisitFormTemplateRequestInput, VisitKind } from '../schemas/form.schema';

/**
 * Redesign R3 (D-R3.21): the form library every tenant starts with (plan section 4). Provisioned by
 * `provisionDefaultFormLibrary` on tenant creation, lazily on first read and in the seed. A unit test
 * parses every component with the save schemas and `validateFormFields`.
 */

export interface DefaultFormSection {
  code: string;
  title: string;
  description?: string | null;
  fields: FormFieldInput[];
}

export interface DefaultFormLibrary {
  sections: DefaultFormSection[];
  archetypeSubForms: Record<FacilityArchetype, FormFieldInput[]>;
  templates: SaveVisitFormTemplateRequestInput[];
}

// Rule helpers: `answer → action`.
const comment = (when: FormFieldRuleInput['when']): FormFieldRuleInput => ({ when, then: 'REQUIRE_COMMENT' });
const photo = (when: FormFieldRuleInput['when']): FormFieldRuleInput => ({ when, then: 'REQUIRE_PHOTO' });
const finding = (when: FormFieldRuleInput['when'], severity: 'MINOR' | 'MAJOR' | 'CRITICAL'): FormFieldRuleInput => ({ when, then: 'RAISE_FINDING', severity });
const NO = { equals: 'NO' };
const YES = { equals: 'YES' };
const LOW_RATING = { atMost: 2 };
const FACILITIES = { type: 'FACILITIES' as const };

const yesNo = (key: string, label: string, extra: Partial<FormFieldInput> = {}): FormFieldInput => ({ key, label, type: 'YES_NO', ...extra });
const rating = (key: string, label: string, extra: Partial<FormFieldInput> = {}): FormFieldInput => ({ key, label, type: 'RATING_1_5', ...extra });
const photos = (key: string, label: string, minCount: number, extra: Partial<FormFieldInput> = {}): FormFieldInput => ({
  key,
  label,
  type: 'PHOTO',
  photo: { mode: 'AT_LEAST_N', minCount, maxCount: Math.max(10, minCount) },
  ...extra,
});
const onePerUnit = (key: string, label: string, kinds: VisitKind[]): FormFieldInput => ({
  key,
  label,
  type: 'PHOTO',
  photo: { mode: 'ONE_PER_UNIT', minCount: 1, maxCount: 3 },
  visitKinds: kinds,
});

const BASELINE: VisitKind[] = ['BASELINE'];
const PROGRESS: VisitKind[] = ['ROUTINE', 'QUARTERLY_ME', 'AD_HOC'];
const FINAL: VisitKind[] = ['FINAL_EVALUATION'];
const PROGRESS_AND_FINAL: VisitKind[] = [...PROGRESS, ...FINAL];

export const DEFAULT_FORM_LIBRARY: DefaultFormLibrary = {
  sections: [
    {
      code: 'MOBILISATION',
      title: 'Mobilisation',
      fields: [
        yesNo('contractor-on-site', 'Contractor mobilised to site', {
          rules: [comment(NO)],
          signal: { kind: 'CONTRACTOR_ON_SITE', when: YES },
        }),
        yesNo('key-personnel', 'Key personnel named in the bid are on site', { rules: [comment(NO), finding(NO, 'MAJOR')] }),
        { key: 'workers', label: 'Workers on site', type: 'NUMBER', unit: 'workers', min: 0 },
        yesNo('equipment', 'Listed equipment on site', { rules: [photo(YES)] }),
        yesNo('first-materials', 'First materials delivered'),
        yesNo('site-office', 'Site office and signboard in place', { rules: [photo(YES)] }),
        yesNo('letter-presented', 'Letter of introduction presented'),
      ],
    },
    {
      code: 'SITE_CONDITIONS',
      title: 'Site conditions',
      fields: [
        photos('site-photos', 'General site photographs (all four sides)', 4),
        { key: 'topography', label: 'Topography and drainage', type: 'LONG_TEXT' },
        yesNo('site-clear', 'Site clear of encumbrances', { rules: [comment(NO)] }),
        yesNo('road-access', 'All-weather road access for delivery trucks'),
        yesNo('water-source', 'Water source on or near the site'),
        yesNo('grid-power', 'Grid power available'),
      ],
    },
    {
      code: 'PROGRESS',
      title: 'Progress vs work programme',
      fields: [
        rating('on-programme', 'Works are on programme', {
          guidance: '1 = far behind, 5 = on or ahead of programme.',
          rules: [comment(LOW_RATING), finding(LOW_RATING, 'MINOR')],
        }),
        { key: 'overall-completion', label: 'Estimated overall completion', type: 'PERCENTAGE' },
        photos('progress-photos', 'Progress photographs', 2),
      ],
    },
    {
      code: 'WORKMANSHIP',
      title: 'Quality of workmanship',
      fields: [rating('workmanship', 'Overall workmanship', { rules: [comment(LOW_RATING), photo(LOW_RATING), finding(LOW_RATING, 'MAJOR')] })],
    },
    {
      code: 'MATERIALS',
      title: 'Material standards',
      fields: [
        yesNo('materials-to-spec', 'Materials on site match the specification', { rules: [photo(NO), comment(NO), finding(NO, 'MAJOR')] }),
        yesNo('test-certificates', 'Test certificates available', { allowNa: true }),
      ],
    },
    {
      code: 'HEALTH_SAFETY',
      title: 'Health & safety',
      fields: [
        yesNo('ppe-worn', 'PPE worn by all workers', { rules: [photo(NO), finding(NO, 'MINOR')] }),
        yesNo('site-fenced', 'Site fenced or hoarded'),
        yesNo('incidents', 'Incidents since the last visit', { rules: [comment(YES)] }),
      ],
    },
    {
      code: 'ENVIRONMENT',
      title: 'Environmental safeguards',
      fields: [yesNo('waste-managed', 'Waste managed and removed'), yesNo('erosion-controlled', 'Erosion and run-off controlled', { rules: [photo(NO)] })],
    },
    {
      code: 'VALUATION_ESTIMATE',
      title: 'Valuation of works (estimate)',
      fields: [
        { key: 'value-done', label: 'Estimated value of work done', type: 'NUMBER', unit: 'NGN', min: 0 },
        yesNo('agrees-with-payments', 'Agrees with the payment record', { rules: [comment(NO)] }),
      ],
    },
    {
      code: 'FINAL_SPEC',
      title: 'Delivery to specification',
      fields: [
        yesNo('delivered-to-spec', 'Project delivered to specification', { rules: [comment(NO), finding(NO, 'MAJOR')] }),
        { key: 'outstanding-snags', label: 'Outstanding punch list items', type: 'LONG_TEXT', required: false },
      ],
    },
    {
      code: 'POST_CLOSURE',
      title: 'Post-closure',
      fields: [
        yesNo('facilities-in-use', 'Facilities are in use', { rules: [comment(NO)] }),
        { key: 'beneficiary-feedback', label: 'Beneficiary feedback', type: 'LONG_TEXT' },
        yesNo('issues-reported', 'Issues reported by the school', { rules: [comment(YES), photo(YES)] }),
        { key: 'voice-note', label: 'Voice note', type: 'VOICE_NOTE', required: false },
      ],
    },
  ],

  archetypeSubForms: {
    BUILDING_WORKS: [
      rating('existing-condition', 'Existing condition of the {facility}', { visitKinds: BASELINE, rules: [comment(LOW_RATING)] }),
      photos('baseline-photo', 'Photo of the {facility}', 1, { visitKinds: BASELINE }),
      {
        key: 'stage',
        label: 'Stage reached ({units})',
        type: 'SINGLE_CHOICE',
        visitKinds: PROGRESS,
        options: [
          { key: 'substructure', label: 'Substructure' },
          { key: 'superstructure', label: 'Superstructure' },
          { key: 'roofing', label: 'Roofing' },
          { key: 'finishes', label: 'Finishes' },
          { key: 'complete', label: 'Complete' },
        ],
        signal: { kind: 'UNIT_COMPLETE', when: { equals: 'complete' } },
      },
      { key: 'percent-complete', label: '% complete', type: 'PERCENTAGE', visitKinds: PROGRESS, signal: { kind: 'PERCENT_COMPLETE' } },
      yesNo('workmanship-ok', 'Workmanship acceptable ({count} {facility})', {
        visitKinds: PROGRESS,
        rules: [photo(NO), comment(NO), finding(NO, 'MAJOR')],
      }),
      onePerUnit('progress-photos', 'Photos of each unit', PROGRESS),
      yesNo('delivered-as-specified', 'All {count} {facility} delivered as specified', {
        visitKinds: FINAL,
        rules: [comment(NO), finding(NO, 'MAJOR')],
        signal: { kind: 'UNIT_COMPLETE', when: YES },
      }),
      onePerUnit('final-photos', 'Photos of each unit', FINAL),
    ],
    SUPPLY_INSTALLATION: [
      {
        key: 'quantity-delivered',
        label: 'Quantity of {facility} delivered',
        type: 'NUMBER',
        min: 0,
        boundedByPlannedQuantity: true,
        visitKinds: PROGRESS_AND_FINAL,
        signal: { kind: 'QUANTITY_DELIVERED' },
      },
      yesNo('matches-spec', 'Items match the specification', { visitKinds: PROGRESS_AND_FINAL, rules: [comment(NO), finding(NO, 'MINOR')] }),
      yesNo('installed-in-use', 'Installed / in use', { visitKinds: PROGRESS_AND_FINAL }),
      photos('supply-photo', 'Photo of the {facility}', 1, { visitKinds: PROGRESS_AND_FINAL }),
    ],
    UTILITIES: [
      yesNo('existing-supply', 'Existing source or supply', { allowNa: true, visitKinds: BASELINE, rules: [photo(YES)] }),
      yesNo('installed', '{facility} installed', { visitKinds: PROGRESS_AND_FINAL }),
      yesNo('functional', 'Functional when tested', {
        allowNa: true,
        visitKinds: PROGRESS_AND_FINAL,
        rules: [comment(NO), finding(NO, 'MAJOR')],
        signal: { kind: 'UNIT_COMPLETE', when: YES },
      }),
      { key: 'output-reading', label: 'Output or yield reading', type: 'NUMBER', required: false, visitKinds: PROGRESS_AND_FINAL },
      photos('utility-photo', 'Photo of the {facility}', 1, { visitKinds: PROGRESS_AND_FINAL }),
    ],
    EXTERNAL_WORKS: [
      rating('existing-condition', 'Existing condition of the {facility}', { visitKinds: BASELINE }),
      photos('baseline-photo', 'Photo of the {facility}', 1, { visitKinds: BASELINE }),
      {
        key: 'percent-complete',
        label: '% complete',
        type: 'PERCENTAGE',
        visitKinds: PROGRESS_AND_FINAL,
        signal: { kind: 'PERCENT_COMPLETE' },
      },
      { key: 'length-area-done', label: 'Length or area done', type: 'NUMBER', unit: 'm', min: 0, required: false, visitKinds: PROGRESS_AND_FINAL },
      yesNo('finish-acceptable', 'Finish acceptable', { visitKinds: PROGRESS_AND_FINAL, rules: [photo(NO), comment(NO), finding(NO, 'MINOR')] }),
      photos('external-photo', 'Photo of the {facility}', 1, { visitKinds: PROGRESS_AND_FINAL }),
    ],
  },

  templates: [
    { code: 'MOBILISATION_CHECK', name: 'Mobilisation check', visitKind: 'MOBILISATION_CHECK', blocks: [s('MOBILISATION'), s('HEALTH_SAFETY')] },
    { code: 'BASELINE', name: 'Baseline monitoring', visitKind: 'BASELINE', blocks: [s('SITE_CONDITIONS'), FACILITIES] },
    {
      code: 'ROUTINE',
      name: 'Routine monitoring visit',
      visitKind: 'ROUTINE',
      blocks: [s('PROGRESS'), FACILITIES, s('WORKMANSHIP'), s('MATERIALS'), s('HEALTH_SAFETY'), s('ENVIRONMENT')],
    },
    {
      code: 'QUARTERLY_ME',
      name: 'Quarterly M&E monitoring visit',
      visitKind: 'QUARTERLY_ME',
      blocks: [s('PROGRESS'), FACILITIES, s('WORKMANSHIP'), s('MATERIALS'), s('HEALTH_SAFETY'), s('ENVIRONMENT'), s('VALUATION_ESTIMATE')],
    },
    { code: 'FINAL_EVALUATION', name: 'Final evaluation', visitKind: 'FINAL_EVALUATION', blocks: [FACILITIES, s('FINAL_SPEC'), s('HEALTH_SAFETY')] },
    { code: 'POST_CLOSURE_EVALUATION', name: 'Post-closure evaluation', visitKind: 'POST_CLOSURE_EVALUATION', blocks: [s('POST_CLOSURE')] },
    { code: 'AD_HOC', name: 'Ad hoc monitoring visit', visitKind: 'AD_HOC', blocks: [FACILITIES, s('HEALTH_SAFETY')] },
  ],
};

function s(sectionCode: string) {
  return { type: 'SECTION' as const, sectionCode };
}
