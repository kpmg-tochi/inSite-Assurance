import { z } from 'zod';
import { FacilityArchetypeEnum } from './facility.schema';
import { validateFormFields } from '../utils/formFields';

/**
 * Redesign R3: the form builder (spec section 6). A tenant form library holds three component kinds,
 * each versioned (a version used by a stored snapshot is never edited):
 * - fixed sections ("Health & safety"), by code, reusable across visit form templates;
 * - facility sub-forms, one per archetype (the default) plus optional per-facility overrides;
 * - visit form templates, one per visit kind: ordered sections and where the facility sub-forms go.
 * `assembleVisitForm` (utils/visitForm.ts) turns a template, the project scope and a visit date into a
 * frozen, self-contained `VisitFormSnapshot`; `validateVisitAnswers` checks what the phone sends.
 */

const Uuid = z.string().uuid();
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Field keys: lower-case letters, digits, "_" and "-", up to 48 (as Phase 14 checklist item keys). */
export const FORM_FIELD_KEY_REGEX = /^[a-z0-9][a-z0-9_-]{0,47}$/;
/** Section and template codes: upper snake case, immutable once created. */
export const FORM_CODE_REGEX = /^[A-Z][A-Z0-9_]{1,39}$/;

// Limits (D-R3.25)
export const FORM_MAX_FIELDS_PER_COMPONENT = 40;
/** The editor warns above this many fields on a sub-form (spec: "1–3 questions"). */
export const FORM_SUBFORM_SOFT_FIELD_LIMIT = 5;
export const FORM_MAX_OPTIONS = 30;
export const FORM_MAX_TEMPLATE_BLOCKS = 20;
export const FORM_MAX_RULES_PER_FIELD = 5;
export const FORM_LABEL_MAX = 300;
export const FORM_GUIDANCE_MAX = 1000;
export const FORM_SHORT_TEXT_MAX = 300;
export const FORM_LONG_TEXT_MAX = 4000;
/** An assembled form larger than this is refused (FORM_TOO_LARGE). */
export const MAX_SNAPSHOT_FIELDS = 600;
export const VISIT_FORM_SNAPSHOT_SCHEMA_VERSION = 1;

const FieldKey = z.string().trim().regex(FORM_FIELD_KEY_REGEX, 'Use 1 to 48 lower-case letters, digits, "-" or "_"');
const FormCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(FORM_CODE_REGEX, 'Code: 2 to 40 capital letters, digits or underscores, e.g. HEALTH_SAFETY');

// ---------------------------------------------------------------------------
// Visit kinds (D-R3.2)
// ---------------------------------------------------------------------------

export const VisitKindEnum = z.enum([
  'MOBILISATION_CHECK',
  'BASELINE',
  'ROUTINE',
  'QUARTERLY_ME',
  'FINAL_EVALUATION',
  'POST_CLOSURE_EVALUATION',
  'AD_HOC',
]);
export type VisitKind = z.infer<typeof VisitKindEnum>;

/** Which facility units a visit kind's form includes (spec 6.3). */
export const VisitFacilityRuleEnum = z.enum(['NONE', 'ALL', 'SPRINT', 'PICKED']);
export type VisitFacilityRule = z.infer<typeof VisitFacilityRuleEnum>;

export interface VisitKindMeta {
  label: string;
  description: string;
  facilityRule: VisitFacilityRule;
  /** Hint for R4: open findings and defects are added as re-check items by default. */
  recheckByDefault: boolean;
}

export const VISIT_KIND_META: Record<VisitKind, VisitKindMeta> = {
  MOBILISATION_CHECK: {
    label: 'Mobilisation check',
    description: 'Contractor mobilised to site, personnel, equipment, materials, letter presented. No facility sub-forms.',
    facilityRule: 'NONE',
    recheckByDefault: false,
  },
  BASELINE: {
    label: 'Baseline monitoring',
    description: 'Existing condition of every facility in scope.',
    facilityRule: 'ALL',
    recheckByDefault: false,
  },
  ROUTINE: {
    label: 'Routine',
    description: 'Units active in the work phase covering the visit date, plus earlier units not yet reported complete.',
    facilityRule: 'SPRINT',
    recheckByDefault: true,
  },
  QUARTERLY_ME: {
    label: 'Quarterly M&E',
    description: 'Same units as Routine, with the M&E sections (including the valuation estimate).',
    facilityRule: 'SPRINT',
    recheckByDefault: true,
  },
  FINAL_EVALUATION: {
    label: 'Final evaluation',
    description: 'Every facility in scope, delivered to specification.',
    facilityRule: 'ALL',
    recheckByDefault: true,
  },
  POST_CLOSURE_EVALUATION: {
    label: 'Post-closure evaluation',
    description: 'Facilities in use, beneficiary feedback, issues. No facility sub-forms.',
    facilityRule: 'NONE',
    recheckByDefault: true,
  },
  AD_HOC: {
    label: 'Ad hoc',
    description: 'The officer picks the facilities to check.',
    facilityRule: 'PICKED',
    recheckByDefault: true,
  },
};

// ---------------------------------------------------------------------------
// Fields (D-R3.4–D-R3.12)
// ---------------------------------------------------------------------------

export const FormFieldTypeEnum = z.enum([
  'SHORT_TEXT',
  'LONG_TEXT',
  'NUMBER',
  'PERCENTAGE',
  'YES_NO',
  'SINGLE_CHOICE',
  'MULTI_CHOICE',
  'DATE',
  'RATING_1_5',
  'PHOTO',
  'VOICE_NOTE',
]);
export type FormFieldType = z.infer<typeof FormFieldTypeEnum>;

export const FORM_FIELD_TYPE_LABELS: Record<FormFieldType, string> = {
  SHORT_TEXT: 'Short text',
  LONG_TEXT: 'Long text',
  NUMBER: 'Number',
  PERCENTAGE: 'Percentage',
  YES_NO: 'Yes / no',
  SINGLE_CHOICE: 'Single choice',
  MULTI_CHOICE: 'Multiple choice',
  DATE: 'Date',
  RATING_1_5: 'Rating 1–5',
  PHOTO: 'Photo',
  VOICE_NOTE: 'Voice note',
};

export const FORM_CHOICE_TYPES: FormFieldType[] = ['SINGLE_CHOICE', 'MULTI_CHOICE'];
export const FORM_NUMERIC_TYPES: FormFieldType[] = ['NUMBER', 'PERCENTAGE', 'RATING_1_5'];
/** Types answered by captures only (the value is always null). */
export const FORM_CAPTURE_TYPES: FormFieldType[] = ['PHOTO', 'VOICE_NOTE'];

export const FormFindingSeverityEnum = z.enum(['MINOR', 'MAJOR', 'CRITICAL']);
export type FormFindingSeverity = z.infer<typeof FormFindingSeverityEnum>;

export const PhotoModeEnum = z.enum(['AT_LEAST_N', 'ONE_PER_UNIT', 'PER_UNIT_OPTIONAL']);
export type PhotoMode = z.infer<typeof PhotoModeEnum>;
export const PHOTO_MODE_LABELS: Record<PhotoMode, string> = {
  AT_LEAST_N: 'At least N',
  ONE_PER_UNIT: 'One per unit (required)',
  PER_UNIT_OPTIONAL: 'Per unit (optional)',
};

export const AnswerScopeEnum = z.enum(['WHOLE_FACILITY', 'PER_UNIT']);
export type AnswerScope = z.infer<typeof AnswerScopeEnum>;

export const FormChoiceOptionSchema = z.object({
  key: FieldKey,
  label: z.string().trim().min(1, 'Enter the option').max(120),
});
export type FormChoiceOption = z.infer<typeof FormChoiceOptionSchema>;

/**
 * A rule condition (D-R3.5). `equals` / `anyOf` compare yes/no and choice values (for multiple choice:
 * any selected option); `atMost` / `atLeast` compare numbers, percentages and ratings. `atLeast:
 * 'PLANNED'` is only allowed on a number bounded by the planned quantity.
 */
export const FormConditionSchema = z.union([
  z.object({ equals: z.string().trim().min(1).max(48) }).strict(),
  z.object({ anyOf: z.array(z.string().trim().min(1).max(48)).min(1).max(FORM_MAX_OPTIONS) }).strict(),
  z.object({ atMost: z.number().finite() }).strict(),
  z.object({ atLeast: z.union([z.number().finite(), z.literal('PLANNED')]) }).strict(),
]);
export type FormCondition = z.infer<typeof FormConditionSchema>;

export const FormRuleActionEnum = z.enum(['REQUIRE_PHOTO', 'REQUIRE_COMMENT', 'RAISE_FINDING']);
export type FormRuleAction = z.infer<typeof FormRuleActionEnum>;

export const FormFieldRuleSchema = z
  .object({
    when: FormConditionSchema,
    then: FormRuleActionEnum,
    /** RAISE_FINDING only. */
    severity: FormFindingSeverityEnum.nullable().default(null),
  })
  .refine((r) => r.then !== 'RAISE_FINDING' || r.severity !== null, { message: 'Pick the finding severity', path: ['severity'] });
export type FormFieldRule = z.infer<typeof FormFieldRuleSchema>;
export type FormFieldRuleInput = z.input<typeof FormFieldRuleSchema>;

/**
 * Signals let R4 react to answers without hard-coding field keys (D-R3.6, register section 1):
 * - UNIT_COMPLETE (sub-forms; `when` required): the unit, or every unit of a whole-facility answer, is
 *   reported complete.
 * - CONTRACTOR_ON_SITE (fixed sections; yes/no; `when` required): completes AUTO_CONTRACTOR_ON_SITE.
 * - PERCENT_COMPLETE (sub-forms; percentage): the value is the units' progress; 100 also reports
 *   them complete.
 * - QUANTITY_DELIVERED (sub-forms; number bounded by the planned quantity): delivered ÷ planned; at
 *   least the planned quantity also reports the units complete.
 * - OVERALL_FINDING (fixed sections; single choice): the chosen option key is the overall finding.
 */
export const FormSignalKindEnum = z.enum(['UNIT_COMPLETE', 'CONTRACTOR_ON_SITE', 'PERCENT_COMPLETE', 'QUANTITY_DELIVERED', 'OVERALL_FINDING']);
export type FormSignalKind = z.infer<typeof FormSignalKindEnum>;
export const FORM_SIGNAL_LABELS: Record<FormSignalKind, string> = {
  UNIT_COMPLETE: 'Unit reported complete',
  CONTRACTOR_ON_SITE: 'Mobilised to site',
  PERCENT_COMPLETE: 'Progress (% complete)',
  QUANTITY_DELIVERED: 'Quantity delivered',
  OVERALL_FINDING: 'Overall finding',
};
/** Signals that need a condition; the others take the answer value itself. */
export const FORM_CONDITIONAL_SIGNALS: FormSignalKind[] = ['UNIT_COMPLETE', 'CONTRACTOR_ON_SITE'];

export const FormFieldSignalSchema = z.object({
  kind: FormSignalKindEnum,
  when: FormConditionSchema.nullable().default(null),
});
export type FormFieldSignal = z.infer<typeof FormFieldSignalSchema>;

export const FormPhotoSettingsSchema = z.object({
  mode: PhotoModeEnum.default('AT_LEAST_N'),
  /** AT_LEAST_N: photos required (0 = optional). */
  minCount: z.number().int().min(0).max(20).default(1),
  maxCount: z.number().int().min(1).max(20).default(10),
  geotagRequired: z.boolean().default(true),
});
export type FormPhotoSettings = z.infer<typeof FormPhotoSettingsSchema>;

export const FormFieldSchema = z.object({
  key: FieldKey,
  type: FormFieldTypeEnum,
  /** Facility sub-forms may use {count} {facility} {units} {plannedQty} {uom}. */
  label: z.string().trim().min(2, 'Enter the question').max(FORM_LABEL_MAX),
  guidance: z.string().trim().max(FORM_GUIDANCE_MAX).nullable().default(null),
  /** Ignored for PHOTO (the photo settings decide) ; VOICE_NOTE: at least one recording. */
  required: z.boolean().default(true),
  /** SINGLE_CHOICE / MULTI_CHOICE. */
  options: z.array(FormChoiceOptionSchema).max(FORM_MAX_OPTIONS).default([]),
  /** MULTI_CHOICE. */
  minSelected: z.number().int().min(0).max(FORM_MAX_OPTIONS).nullable().default(null),
  maxSelected: z.number().int().min(1).max(FORM_MAX_OPTIONS).nullable().default(null),
  /** NUMBER: unit label shown next to the value, and an optional range. */
  unit: z.string().trim().max(30).nullable().default(null),
  min: z.number().finite().nullable().default(null),
  max: z.number().finite().nullable().default(null),
  /** YES_NO: offer "N/A". */
  allowNa: z.boolean().default(false),
  /** PHOTO only. */
  photo: FormPhotoSettingsSchema.nullable().default(null),
  /** Sub-forms: one answer for the facility, or one per unit. */
  scope: AnswerScopeEnum.default('WHOLE_FACILITY'),
  /** Sub-forms, NUMBER: "of 120 nr"; above the planned quantity needs a comment. */
  boundedByPlannedQuantity: z.boolean().default(false),
  /** Sub-forms: the visit kinds this field is asked on (null = every kind that includes facilities). */
  visitKinds: z.array(VisitKindEnum).min(1).max(7).nullable().default(null),
  rules: z.array(FormFieldRuleSchema).max(FORM_MAX_RULES_PER_FIELD).default([]),
  signal: FormFieldSignalSchema.nullable().default(null),
});
export type FormField = z.infer<typeof FormFieldSchema>;
export type FormFieldInput = z.input<typeof FormFieldSchema>;

function refineUniqueKeys(fields: Array<{ key: string }>, ctx: z.RefinementCtx, pathPrefix: Array<string | number> = []) {
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    if (seen.has(f.key)) ctx.addIssue({ code: 'custom', message: `Field key "${f.key}" is used twice`, path: [...pathPrefix, i, 'key'] });
    seen.add(f.key);
  });
}

export const FormFieldsSchema = z
  .array(FormFieldSchema)
  .min(1, 'Add at least one field')
  .max(FORM_MAX_FIELDS_PER_COMPONENT)
  .superRefine((fields, ctx) => refineUniqueKeys(fields, ctx));

// ---------------------------------------------------------------------------
// Component bodies
// ---------------------------------------------------------------------------

export const FormSectionDefinitionSchema = z.object({
  title: z.string().trim().min(2, 'Enter the section title').max(160),
  description: z.string().trim().max(FORM_GUIDANCE_MAX).nullable().default(null),
  fields: FormFieldsSchema,
});
export type FormSectionDefinition = z.infer<typeof FormSectionDefinitionSchema>;

export const FacilitySubFormDefinitionSchema = z.object({ fields: FormFieldsSchema });
export type FacilitySubFormDefinition = z.infer<typeof FacilitySubFormDefinitionSchema>;

export const VisitFormBlockSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('SECTION'), sectionCode: FormCode }),
  z.object({ type: z.literal('FACILITIES') }),
]);
export type VisitFormBlock = z.infer<typeof VisitFormBlockSchema>;

/** A template's ordered blocks: sections by code (each once) and at most one FACILITIES slot. */
export const VisitFormTemplateLayoutSchema = z
  .array(VisitFormBlockSchema)
  .min(1, 'Add at least one block')
  .max(FORM_MAX_TEMPLATE_BLOCKS)
  .superRefine((blocks, ctx) => {
    const codes = new Set<string>();
    let facilities = 0;
    blocks.forEach((b, i) => {
      if (b.type === 'FACILITIES') {
        facilities += 1;
        if (facilities > 1) ctx.addIssue({ code: 'custom', message: 'Facility sub-forms can appear only once', path: [i] });
      } else {
        if (codes.has(b.sectionCode)) ctx.addIssue({ code: 'custom', message: `Section ${b.sectionCode} is listed twice`, path: [i, 'sectionCode'] });
        codes.add(b.sectionCode);
      }
    });
  });
export type VisitFormTemplateLayout = z.infer<typeof VisitFormTemplateLayoutSchema>;

/** Field validity beyond the schema (validateFormFields), mapped onto zod issues. */
function refineFields(context: 'SECTION' | 'SUBFORM') {
  return (v: { fields: FormField[] }, ctx: z.RefinementCtx) => {
    for (const issue of validateFormFields(v.fields, { context })) {
      ctx.addIssue({ code: 'custom', message: issue.message, path: ['fields', issue.index, ...(issue.field ? [issue.field] : [])], params: { code: issue.code } });
    }
  };
}

// ---------------------------------------------------------------------------
// Editor requests
// ---------------------------------------------------------------------------

export const SaveFormSectionRequestSchema = z
  .object({
    code: FormCode,
    title: z.string().trim().min(2, 'Enter the section title').max(160),
    description: z.string().trim().max(FORM_GUIDANCE_MAX).nullable().default(null),
    fields: FormFieldsSchema,
  })
  .superRefine(refineFields('SECTION'));
export type SaveFormSectionRequest = z.infer<typeof SaveFormSectionRequestSchema>;
export type SaveFormSectionRequestInput = z.input<typeof SaveFormSectionRequestSchema>;

export const SaveFacilitySubFormRequestSchema = z.object({ fields: FormFieldsSchema }).superRefine(refineFields('SUBFORM'));
export type SaveFacilitySubFormRequest = z.infer<typeof SaveFacilitySubFormRequestSchema>;
export type SaveFacilitySubFormRequestInput = z.input<typeof SaveFacilitySubFormRequestSchema>;

/** POST customise: copy of the archetype default, or the fields given. */
export const CustomiseFacilitySubFormRequestSchema = z
  .object({ fields: FormFieldsSchema.optional() })
  .superRefine((v, ctx) => {
    if (v.fields) refineFields('SUBFORM')({ fields: v.fields }, ctx);
  });
export type CustomiseFacilitySubFormRequest = z.infer<typeof CustomiseFacilitySubFormRequestSchema>;

export const SaveVisitFormTemplateRequestSchema = z
  .object({
    code: FormCode,
    name: z.string().trim().min(3, 'Enter at least 3 characters').max(160),
    visitKind: VisitKindEnum,
    blocks: VisitFormTemplateLayoutSchema,
  })
  .superRefine((v, ctx) => {
    if (VISIT_KIND_META[v.visitKind].facilityRule === 'NONE') {
      const i = v.blocks.findIndex((b) => b.type === 'FACILITIES');
      if (i >= 0) {
        ctx.addIssue({ code: 'custom', message: `${VISIT_KIND_META[v.visitKind].label} visits have no facility sub-forms`, path: ['blocks', i] });
      }
    }
  });
export type SaveVisitFormTemplateRequest = z.infer<typeof SaveVisitFormTemplateRequestSchema>;
export type SaveVisitFormTemplateRequestInput = z.input<typeof SaveVisitFormTemplateRequestSchema>;

export const SetFormComponentArchivedRequestSchema = z.object({ archived: z.boolean() });
export type SetFormComponentArchivedRequest = z.infer<typeof SetFormComponentArchivedRequestSchema>;

// ---------------------------------------------------------------------------
// Editor responses
// ---------------------------------------------------------------------------

const componentMeta = {
  id: Uuid,
  version: z.number().int(),
  isArchived: z.boolean(),
  /** Stored snapshots that use this version (a used version is never edited: saving makes a new one). */
  usageCount: z.number().int(),
  isLatest: z.boolean(),
  createdAt: z.string(),
};

export const FormSectionDtoSchema = z.object({
  ...componentMeta,
  code: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  fields: z.array(FormFieldSchema),
  /** Unarchived templates that list this section (archiving is refused while any do). */
  usedByTemplateCodes: z.array(z.string()),
});
export type FormSectionDto = z.infer<typeof FormSectionDtoSchema>;

export const FormSubFormSubjectEnum = z.enum(['ARCHETYPE', 'FACILITY']);
export type FormSubFormSubject = z.infer<typeof FormSubFormSubjectEnum>;

export const FacilitySubFormDtoSchema = z.object({
  ...componentMeta,
  subject: FormSubFormSubjectEnum,
  /** `ARCHETYPE:<archetype>` or `FACILITY:<facilityId>`. */
  subjectKey: z.string(),
  archetype: FacilityArchetypeEnum.nullable(),
  facilityId: Uuid.nullable(),
  facilityCode: z.string().nullable(),
  facilityName: z.string().nullable(),
  fields: z.array(FormFieldSchema),
});
export type FacilitySubFormDto = z.infer<typeof FacilitySubFormDtoSchema>;

export const VisitFormTemplateDtoSchema = z.object({
  ...componentMeta,
  code: z.string(),
  name: z.string(),
  visitKind: VisitKindEnum,
  blocks: z.array(VisitFormBlockSchema),
});
export type VisitFormTemplateDto = z.infer<typeof VisitFormTemplateDtoSchema>;

/** Which sub-form a facility uses: its own (customised) or its archetype's default. */
export const FacilitySubFormSourceEnum = FormSubFormSubjectEnum;
export const FacilityEffectiveSubFormSchema = z.object({
  facilityId: Uuid,
  code: z.string(),
  name: z.string(),
  pluralName: z.string().nullable(),
  archetype: FacilityArchetypeEnum,
  isRetired: z.boolean(),
  source: FormSubFormSubjectEnum,
  subFormId: Uuid.nullable(),
  version: z.number().int().nullable(),
});
export type FacilityEffectiveSubForm = z.infer<typeof FacilityEffectiveSubFormSchema>;

/** GET /form-library: the latest version of every component, archived ones included. */
export const FormLibraryDtoSchema = z.object({
  sections: z.array(FormSectionDtoSchema),
  archetypeSubForms: z.array(FacilitySubFormDtoSchema),
  facilitySubForms: z.array(FacilitySubFormDtoSchema),
  templates: z.array(VisitFormTemplateDtoSchema),
  facilities: z.array(FacilityEffectiveSubFormSchema),
});
export type FormLibraryDto = z.infer<typeof FormLibraryDtoSchema>;

// ---------------------------------------------------------------------------
// Project type config key `visitForms` (D-R3.18)
// ---------------------------------------------------------------------------

export const ProjectTypeVisitFormsConfigSchema = z.object({
  /** Template code per visit kind; the latest unarchived version is used when a form is built. */
  templateCodeByVisitKind: z.record(VisitKindEnum, z.string().trim().min(1).max(40)).default({}),
});
export type ProjectTypeVisitFormsConfig = z.infer<typeof ProjectTypeVisitFormsConfigSchema>;

// ---------------------------------------------------------------------------
// Re-checks (D-R3.17)
// ---------------------------------------------------------------------------

export const RecheckInputSchema = z.object({
  id: Uuid,
  kind: z.enum(['FINDING', 'DEFECT']),
  title: z.string().trim().min(1).max(300),
  description: z.string().trim().max(2000).nullable().default(null),
  severity: FormFindingSeverityEnum.nullable().default(null),
  raisedDate: IsoDate,
  facilityId: Uuid.nullable().default(null),
  unitId: Uuid.nullable().default(null),
});
export type RecheckInput = z.infer<typeof RecheckInputSchema>;
export type RecheckInputRaw = z.input<typeof RecheckInputSchema>;

// ---------------------------------------------------------------------------
// The frozen visit form (D-R3.14, D-R3.15)
// ---------------------------------------------------------------------------

export const SnapshotUnitSchema = z.object({
  id: Uuid,
  code: z.string(),
  label: z.string(),
  plannedQuantity: z.number().nullable(),
  quantityUnit: z.string().nullable(),
});
export type SnapshotUnit = z.infer<typeof SnapshotUnitSchema>;

export const SnapshotPhotoSchema = z.object({
  mode: PhotoModeEnum,
  minCount: z.number().int(),
  maxCount: z.number().int(),
  geotagRequired: z.boolean(),
  /** ONE_PER_UNIT / PER_UNIT_OPTIONAL: one labelled slot per unit. */
  slots: z.array(z.object({ unitId: Uuid, label: z.string() })),
});
export type SnapshotPhoto = z.infer<typeof SnapshotPhotoSchema>;

export const VisitFormSnapshotFieldSchema = z.object({
  /** `s:<SECTION>/<key>`, `f:<FACILITY>/<key>`, `f:<FACILITY>/<key>@<unitId>` or `r:<recheckId>`. */
  path: z.string(),
  key: z.string(),
  type: FormFieldTypeEnum,
  /** Placeholders rendered. */
  label: z.string(),
  /** The raw label when it held placeholders, else null. */
  labelTemplate: z.string().nullable(),
  guidance: z.string().nullable(),
  /** PHOTO: true when a photo is owed (ONE_PER_UNIT or minCount > 0). */
  required: z.boolean(),
  options: z.array(FormChoiceOptionSchema),
  minSelected: z.number().int().nullable(),
  maxSelected: z.number().int().nullable(),
  unit: z.string().nullable(),
  min: z.number().nullable(),
  max: z.number().nullable(),
  allowNa: z.boolean(),
  photo: SnapshotPhotoSchema.nullable(),
  scope: AnswerScopeEnum,
  /** PER_UNIT fields: the unit this copy is about. */
  unitId: Uuid.nullable(),
  /** Bounded quantity fields: the planned quantity of the field's units (null when units differ). */
  plannedQuantity: z.number().nullable(),
  boundedByPlannedQuantity: z.boolean(),
  rules: z.array(FormFieldRuleSchema),
  signal: FormFieldSignalSchema.nullable(),
  /** Re-check items only. */
  recheck: RecheckInputSchema.nullable(),
});
export type VisitFormSnapshotField = z.infer<typeof VisitFormSnapshotFieldSchema>;

export const VisitFormSnapshotBlockKindEnum = z.enum(['SECTION', 'FACILITY', 'RECHECK']);
export type VisitFormSnapshotBlockKind = z.infer<typeof VisitFormSnapshotBlockKindEnum>;

export const VisitFormSnapshotBlockSchema = z.object({
  /** `s:<SECTION>`, `f:<FACILITY>` or `r`. */
  key: z.string(),
  kind: VisitFormSnapshotBlockKindEnum,
  title: z.string(),
  description: z.string().nullable(),
  sectionCode: z.string().nullable(),
  facility: z.object({ id: Uuid, code: z.string(), name: z.string(), archetype: FacilityArchetypeEnum }).nullable(),
  units: z.array(SnapshotUnitSchema),
  fields: z.array(VisitFormSnapshotFieldSchema),
});
export type VisitFormSnapshotBlock = z.infer<typeof VisitFormSnapshotBlockSchema>;

export const VisitFormAssemblyWarningCodeEnum = z.enum([
  'NO_SPRINT_FOR_DATE',
  'NO_FACILITIES_IN_SCOPE',
  'SUBFORM_MISSING',
  'SUBFORM_EMPTY_FOR_KIND',
  'SECTION_MISSING',
  'MIXED_QUANTITY_UNITS',
]);
export type VisitFormAssemblyWarningCode = z.infer<typeof VisitFormAssemblyWarningCodeEnum>;

export const VisitFormAssemblyWarningSchema = z.object({
  code: VisitFormAssemblyWarningCodeEnum,
  message: z.string(),
  facilityId: Uuid.nullable(),
});
export type VisitFormAssemblyWarning = z.infer<typeof VisitFormAssemblyWarningSchema>;

export const SnapshotSprintSchema = z.object({
  id: Uuid,
  number: z.number().int(),
  name: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  deliverables: z.string(),
});
export type SnapshotSprint = z.infer<typeof SnapshotSprintSchema>;

export const VisitFormSnapshotSchema = z.object({
  schemaVersion: z.literal(VISIT_FORM_SNAPSHOT_SCHEMA_VERSION),
  /** Excluded from the content hash. */
  builtAt: z.string(),
  context: z.object({
    projectId: Uuid,
    visitKind: VisitKindEnum,
    visitDate: IsoDate,
    sprint: SnapshotSprintSchema.nullable(),
  }),
  sources: z.object({
    template: z.object({ id: Uuid, code: z.string(), version: z.number().int(), name: z.string() }),
    sections: z.array(z.object({ id: Uuid, code: z.string(), version: z.number().int() })),
    /** One entry per facility block: the sub-form version it used. */
    subForms: z.array(z.object({ id: Uuid, subjectKey: z.string(), version: z.number().int(), facilityId: Uuid })),
  }),
  blocks: z.array(VisitFormSnapshotBlockSchema),
  warnings: z.array(VisitFormAssemblyWarningSchema),
});
export type VisitFormSnapshot = z.infer<typeof VisitFormSnapshotSchema>;

// ---------------------------------------------------------------------------
// Answers (D-R3.16)
// ---------------------------------------------------------------------------

export const VisitFormCaptureRefSchema = z.object({
  /** A registered capture (FieldEvidenceLog.clientCaptureId); never a file path or base64. */
  clientCaptureId: Uuid,
  /** ONE_PER_UNIT / PER_UNIT_OPTIONAL: the slot's unit. */
  unitId: Uuid.nullable().default(null),
  kind: z.enum(['PHOTO', 'AUDIO']),
});
export type VisitFormCaptureRef = z.infer<typeof VisitFormCaptureRefSchema>;

export const VisitFormAnswerSchema = z.object({
  path: z.string().min(3).max(200),
  value: z.union([z.string().max(FORM_LONG_TEXT_MAX), z.number().finite(), z.array(z.string().max(48)).max(FORM_MAX_OPTIONS), z.null()]).default(null),
  comment: z.string().trim().max(2000).nullable().default(null),
  captures: z.array(VisitFormCaptureRefSchema).max(30).default([]),
});
export type VisitFormAnswer = z.infer<typeof VisitFormAnswerSchema>;
export type VisitFormAnswerInput = z.input<typeof VisitFormAnswerSchema>;

export const VisitFormAnswersSchema = z.array(VisitFormAnswerSchema).max(2000);
export type VisitFormAnswers = z.infer<typeof VisitFormAnswersSchema>;

/** What the server knows about a capture (from FieldEvidenceLog); optional input to validation. */
export interface CaptureFact {
  clientCaptureId: string;
  geotagged: boolean;
  /** null when the project has no boundary or the capture has no location. */
  insideBoundary: boolean | null;
}

// ---------------------------------------------------------------------------
// Offline bundle for the phone (D-R3.24)
// ---------------------------------------------------------------------------

export const BundleSectionSchema = z.object({
  id: Uuid,
  code: z.string(),
  version: z.number().int(),
  title: z.string(),
  description: z.string().nullable(),
  fields: z.array(FormFieldSchema),
});
export type BundleSection = z.infer<typeof BundleSectionSchema>;

export const BundleSubFormSchema = z.object({
  id: Uuid,
  subjectKey: z.string(),
  version: z.number().int(),
  fields: z.array(FormFieldSchema),
});
export type BundleSubForm = z.infer<typeof BundleSubFormSchema>;

export const BundleTemplateSchema = z.object({
  id: Uuid,
  code: z.string(),
  version: z.number().int(),
  name: z.string(),
  visitKind: VisitKindEnum,
  blocks: z.array(VisitFormBlockSchema),
});
export type BundleTemplate = z.infer<typeof BundleTemplateSchema>;

export const BundleFacilitySchema = z.object({
  id: Uuid,
  code: z.string(),
  name: z.string(),
  pluralName: z.string().nullable(),
  archetype: FacilityArchetypeEnum,
  sortOrder: z.number().int(),
  /** The effective sub-form (its own, else the archetype default); null when none exists. */
  subFormId: Uuid.nullable(),
});
export type BundleFacility = z.infer<typeof BundleFacilitySchema>;

export const BundleUnitSchema = z.object({
  id: Uuid,
  code: z.string(),
  label: z.string(),
  facilityId: Uuid,
  plannedQuantity: z.number().nullable(),
  quantityUnit: z.string().nullable(),
  startSprintNumber: z.number().int().nullable(),
  endSprintNumber: z.number().int().nullable(),
  sortOrder: z.number().int(),
});
export type BundleUnit = z.infer<typeof BundleUnitSchema>;

export const VisitFormLibraryBundleSchema = z.object({
  projectId: Uuid,
  /** The resolved template per visit kind (kinds without one are absent). */
  templates: z.array(BundleTemplateSchema),
  sections: z.array(BundleSectionSchema),
  subForms: z.array(BundleSubFormSchema),
  /** Facilities with units on the project. */
  facilities: z.array(BundleFacilitySchema),
  units: z.array(BundleUnitSchema),
  sprints: z.array(SnapshotSprintSchema),
  /** Units reported complete (R3: every line at 100%; R4 supplies reported completion). */
  completedUnitIds: z.array(Uuid),
});
export type VisitFormLibraryBundle = z.infer<typeof VisitFormLibraryBundleSchema>;

// ---------------------------------------------------------------------------
// Preview (D-R3.23)
// ---------------------------------------------------------------------------

export const PreviewVisitFormRequestSchema = z.object({
  visitKind: VisitKindEnum,
  visitDate: IsoDate,
  pickedFacilityIds: z.array(Uuid).max(100).default([]),
});
export type PreviewVisitFormRequest = z.infer<typeof PreviewVisitFormRequestSchema>;
export type PreviewVisitFormRequestInput = z.input<typeof PreviewVisitFormRequestSchema>;

export const VisitFormPreviewDtoSchema = z.object({
  snapshot: VisitFormSnapshotSchema,
  warnings: z.array(VisitFormAssemblyWarningSchema),
  fieldCount: z.number().int(),
  contentSha256: z.string(),
});
export type VisitFormPreviewDto = z.infer<typeof VisitFormPreviewDtoSchema>;
