/**
 * Redesign R3: visit form assembly and answer validation. Pure and deterministic, shared by the server
 * (scheduled visits, R4) and the phone (offline Ad hoc visits, R5) so both build the same form from the
 * same inputs. No clock reads: `builtAt` is passed in and left out of the canonical form.
 */
import {
  MAX_SNAPSHOT_FIELDS,
  VISIT_FORM_SNAPSHOT_SCHEMA_VERSION,
  VISIT_KIND_META,
  type BundleFacility,
  type BundleSection,
  type BundleSubForm,
  type BundleTemplate,
  type BundleUnit,
  type CaptureFact,
  type FormCondition,
  type FormField,
  type FormFindingSeverity,
  type RecheckInput,
  type SnapshotSprint,
  type SnapshotUnit,
  type VisitFormAnswerInput,
  type VisitFormAssemblyWarning,
  type VisitFormLibraryBundle,
  type VisitFormSnapshot,
  type VisitFormSnapshotBlock,
  type VisitFormSnapshotField,
  type VisitKind,
} from '../schemas/form.schema';
import { placeholdersIn, plannedQuantityOf, renderPlaceholders } from './formFields';
import { isIsoCalendarDate, sprintForDate, unitsActiveInSprint } from './scope';

export { validateFormFields, renderPlaceholders, facilityNoun, simplePlural, placeholdersIn, plannedQuantityOf, FORM_PLACEHOLDERS } from './formFields';
export type { FormFieldIssue, PlaceholderContext, PlaceholderUnit, FacilityNounInput } from './formFields';

/** A form that cannot be built (the server answers 422 with `code`). */
export class VisitFormAssemblyError extends Error {
  constructor(
    public readonly code: 'FORM_TOO_LARGE' | 'TEMPLATE_KIND_MISMATCH' | 'NO_VISIT_FORM_TEMPLATE' | 'INVALID_VISIT_DATE',
    message: string
  ) {
    super(message);
    this.name = 'VisitFormAssemblyError';
  }
}

// ---------------------------------------------------------------------------
// Which units a visit covers (D-R3.14)
// ---------------------------------------------------------------------------

export interface UnitsForVisitInput<U extends Pick<BundleUnit, 'id' | 'facilityId' | 'startSprintNumber' | 'endSprintNumber'>, S extends { number: number; startDate: string; endDate: string }> {
  kind: VisitKind;
  sprints: S[];
  units: U[];
  visitDate: string;
  /** Units reported complete; earlier-sprint units not in it are carried into Routine / Quarterly. */
  completedUnitIds?: string[];
  /** AD_HOC: the facilities the officer picked. */
  pickedFacilityIds?: string[];
}

/**
 * The units a visit includes, by the kind's facility rule: NONE → none; ALL → every unit; SPRINT →
 * units active in the visit's sprint plus units whose end sprint is earlier and that are not reported
 * complete; PICKED → every unit of the picked facilities. Units without sprints count only for ALL and
 * PICKED. Returns the units in the input order and the sprint for the date.
 */
export function unitsForVisit<
  U extends Pick<BundleUnit, 'id' | 'facilityId' | 'startSprintNumber' | 'endSprintNumber'>,
  S extends { number: number; startDate: string; endDate: string },
>(input: UnitsForVisitInput<U, S>): { sprint: S | null; units: U[] } {
  const sprint = sprintForDate(input.sprints, input.visitDate);
  const rule = VISIT_KIND_META[input.kind].facilityRule;
  switch (rule) {
    case 'NONE':
      return { sprint, units: [] };
    case 'ALL':
      return { sprint, units: [...input.units] };
    case 'PICKED': {
      const picked = new Set(input.pickedFacilityIds ?? []);
      return { sprint, units: input.units.filter((u) => picked.has(u.facilityId)) };
    }
    case 'SPRINT': {
      if (!sprint) return { sprint, units: [] };
      const active = new Set(unitsActiveInSprint(input.units, sprint.number).map((u) => u.id));
      const done = new Set(input.completedUnitIds ?? []);
      return {
        sprint,
        units: input.units.filter(
          (u) => active.has(u.id) || (u.endSprintNumber !== null && u.endSprintNumber < sprint.number && !done.has(u.id))
        ),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// Assembly (D-R3.14)
// ---------------------------------------------------------------------------

export interface AssembleVisitFormInput {
  projectId: string;
  visitKind: VisitKind;
  visitDate: string;
  /** ISO timestamp; stored on the snapshot, excluded from the canonical form and hash. */
  builtAt: string;
  template: BundleTemplate;
  /** The section version to use for each code the template lists. */
  sections: BundleSection[];
  /** Sub-forms referenced by `facilities[].subFormId`. */
  subForms: BundleSubForm[];
  /** Facilities with units on the project (retired ones included). */
  facilities: BundleFacility[];
  units: BundleUnit[];
  sprints: SnapshotSprint[];
  completedUnitIds?: string[];
  pickedFacilityIds?: string[];
  /** Open findings and defects to re-check, in the order to show them. */
  rechecks?: RecheckInput[];
}

const byOrderThenCode = <T extends { sortOrder: number; code: string }>(a: T, b: T) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code);

function snapshotUnit(u: BundleUnit): SnapshotUnit {
  return { id: u.id, code: u.code, label: u.label, plannedQuantity: u.plannedQuantity, quantityUnit: u.quantityUnit };
}

function baseField(f: FormField, path: string): VisitFormSnapshotField {
  return {
    path,
    key: f.key,
    type: f.type,
    label: f.label,
    labelTemplate: null,
    guidance: f.guidance,
    required: f.required,
    options: f.options,
    minSelected: f.minSelected,
    maxSelected: f.maxSelected,
    unit: f.unit,
    min: f.min,
    max: f.max,
    allowNa: f.allowNa,
    photo: null,
    scope: f.scope,
    unitId: null,
    plannedQuantity: null,
    boundedByPlannedQuantity: f.boundedByPlannedQuantity,
    rules: f.rules,
    signal: f.signal,
    recheck: null,
  };
}

function withPhoto(field: VisitFormSnapshotField, f: FormField, units: SnapshotUnit[]): VisitFormSnapshotField {
  if (f.type !== 'PHOTO') return field;
  const p = f.photo ?? { mode: 'AT_LEAST_N' as const, minCount: 1, maxCount: 10, geotagRequired: true };
  const perUnit = p.mode !== 'AT_LEAST_N';
  return {
    ...field,
    required: p.mode === 'ONE_PER_UNIT' ? units.length > 0 : p.mode === 'AT_LEAST_N' ? p.minCount > 0 : false,
    photo: {
      mode: p.mode,
      minCount: p.minCount,
      maxCount: p.maxCount,
      geotagRequired: p.geotagRequired,
      slots: perUnit ? units.map((u) => ({ unitId: u.id, label: u.label })) : [],
    },
  };
}

function sectionBlock(section: BundleSection): VisitFormSnapshotBlock {
  return {
    key: `s:${section.code}`,
    kind: 'SECTION',
    title: section.title,
    description: section.description,
    sectionCode: section.code,
    facility: null,
    units: [],
    fields: section.fields.map((f) => withPhoto(baseField(f, `s:${section.code}/${f.key}`), f, [])),
  };
}

function facilityField(
  f: FormField,
  facility: BundleFacility,
  path: string,
  units: SnapshotUnit[],
  unitId: string | null,
  warn: (w: VisitFormAssemblyWarning) => void
): VisitFormSnapshotField {
  const ctx = { facility, units };
  const hasPlaceholders = placeholdersIn(f.label).length > 0;
  let label = hasPlaceholders ? renderPlaceholders(f.label, ctx) : f.label;
  const guidance = f.guidance && placeholdersIn(f.guidance).length > 0 ? renderPlaceholders(f.guidance, ctx) : f.guidance;
  let plannedQuantity: number | null = null;
  if (f.boundedByPlannedQuantity) {
    const qty = plannedQuantityOf(units);
    plannedQuantity = qty.total;
    if (qty.text) label = `${label} (of ${qty.text}${qty.total !== null && qty.uom ? ` ${qty.uom}` : ''})`;
    if (qty.total === null && qty.text) {
      warn({
        code: 'MIXED_QUANTITY_UNITS',
        message: `${facility.name}: the units use different quantity units, so "${f.label}" is not checked against the planned quantity.`,
        facilityId: facility.id,
      });
    }
  }
  const field: VisitFormSnapshotField = {
    ...baseField(f, path),
    label,
    labelTemplate: hasPlaceholders || f.boundedByPlannedQuantity ? f.label : null,
    guidance,
    unitId,
    plannedQuantity,
  };
  return withPhoto(field, f, units);
}

function recheckField(r: RecheckInput): VisitFormSnapshotField {
  return {
    path: `r:${r.id}`,
    key: r.id,
    type: 'YES_NO',
    label: `Follow-up check: ${r.title}. Rectified?`,
    labelTemplate: null,
    guidance: r.description,
    required: true,
    options: [],
    minSelected: null,
    maxSelected: null,
    unit: null,
    min: null,
    max: null,
    allowNa: false,
    photo: null,
    scope: 'WHOLE_FACILITY',
    unitId: r.unitId,
    plannedQuantity: null,
    boundedByPlannedQuantity: false,
    rules: [
      { when: { equals: 'YES' }, then: 'REQUIRE_PHOTO', severity: null },
      { when: { equals: 'NO' }, then: 'REQUIRE_COMMENT', severity: null },
    ],
    signal: null,
    recheck: r,
  };
}

function recheckBlock(rechecks: RecheckInput[]): VisitFormSnapshotBlock {
  return {
    key: 'r',
    kind: 'RECHECK',
    title: 'Follow-up check on open findings',
    description: 'Was each finding rectified? A photo is needed when it was, a comment when it was not.',
    sectionCode: null,
    facility: null,
    units: [],
    fields: rechecks.map(recheckField),
  };
}

/**
 * Redesign R4: the same frozen form with its re-check block replaced (open findings changed). Every
 * other block stays exactly as frozen, so a library edit never reaches a published visit this way.
 */
export function withRechecks(snapshot: VisitFormSnapshot, rechecks: RecheckInput[], builtAt?: string): VisitFormSnapshot {
  const blocks = snapshot.blocks.filter((b) => b.kind !== 'RECHECK');
  if (rechecks.length > 0) blocks.push(recheckBlock(rechecks));
  const fieldCount = blocks.reduce((n, b) => n + b.fields.length, 0);
  if (fieldCount > MAX_SNAPSHOT_FIELDS) {
    throw new VisitFormAssemblyError('FORM_TOO_LARGE', `This form would have ${fieldCount} questions; the limit is ${MAX_SNAPSHOT_FIELDS}.`);
  }
  return { ...snapshot, builtAt: builtAt ?? snapshot.builtAt, blocks };
}

/** Whether two snapshots are the same form apart from their re-check items (R4 stale-form check). */
export function sameFormApartFromRechecks(a: VisitFormSnapshot, b: VisitFormSnapshot): boolean {
  return canonicalVisitFormSnapshot(withRechecks(a, [])) === canonicalVisitFormSnapshot(withRechecks(b, []));
}

/**
 * Builds the frozen visit form. Blocks follow the template: each SECTION block is the section's
 * fields; the FACILITIES slot expands to one block per facility with units in the visit (facility
 * sortOrder, then unit sortOrder), with the sub-form fields for this visit kind, per-unit fields
 * repeated per unit and placeholders rendered. Re-checks are appended after the last block.
 */
export function assembleVisitForm(input: AssembleVisitFormInput): { snapshot: VisitFormSnapshot; warnings: VisitFormAssemblyWarning[] } {
  if (!isIsoCalendarDate(input.visitDate)) throw new VisitFormAssemblyError('INVALID_VISIT_DATE', `${input.visitDate} is not a valid date.`);
  if (input.template.visitKind !== input.visitKind) {
    throw new VisitFormAssemblyError(
      'TEMPLATE_KIND_MISMATCH',
      `Template ${input.template.code} is for ${VISIT_KIND_META[input.template.visitKind].label} monitoring visits, not ${VISIT_KIND_META[input.visitKind].label}.`
    );
  }
  const warnings: VisitFormAssemblyWarning[] = [];
  const warn = (w: VisitFormAssemblyWarning) => warnings.push(w);
  const meta = VISIT_KIND_META[input.visitKind];
  const hasFacilitySlot = meta.facilityRule !== 'NONE' && input.template.blocks.some((b) => b.type === 'FACILITIES');

  const { sprint, units } = unitsForVisit({
    kind: input.visitKind,
    sprints: input.sprints,
    units: input.units,
    visitDate: input.visitDate,
    completedUnitIds: input.completedUnitIds,
    pickedFacilityIds: input.pickedFacilityIds,
  });
  if (meta.facilityRule === 'SPRINT' && !sprint) {
    warn({
      code: 'NO_SPRINT_FOR_DATE',
      message:
        input.sprints.length === 0
          ? 'The project has no work phases, so no facilities are included.'
          : `No work phase has started by ${input.visitDate}, so no facilities are included.`,
      facilityId: null,
    });
  }
  if (hasFacilitySlot && units.length === 0) {
    warn({ code: 'NO_FACILITIES_IN_SCOPE', message: 'No facility units are in this monitoring visit; the form has the fixed sections only.', facilityId: null });
  }

  const sectionsByCode = new Map(input.sections.map((s) => [s.code, s]));
  const subFormsById = new Map(input.subForms.map((s) => [s.id, s]));
  const facilitiesById = new Map(input.facilities.map((f) => [f.id, f]));
  const blocks: VisitFormSnapshotBlock[] = [];
  const sources: VisitFormSnapshot['sources'] = {
    template: { id: input.template.id, code: input.template.code, version: input.template.version, name: input.template.name },
    sections: [],
    subForms: [],
  };

  for (const b of input.template.blocks) {
    if (b.type === 'SECTION') {
      const section = sectionsByCode.get(b.sectionCode);
      if (!section) {
        warn({ code: 'SECTION_MISSING', message: `Section ${b.sectionCode} is not in the library any more; it is left out.`, facilityId: null });
        continue;
      }
      sources.sections.push({ id: section.id, code: section.code, version: section.version });
      blocks.push(sectionBlock(section));
      continue;
    }
    if (!hasFacilitySlot) continue;
    const grouped = new Map<string, BundleUnit[]>();
    for (const u of units) {
      if (!facilitiesById.has(u.facilityId)) continue;
      grouped.set(u.facilityId, [...(grouped.get(u.facilityId) ?? []), u]);
    }
    const facilities = [...grouped.keys()].map((id) => facilitiesById.get(id)!).sort(byOrderThenCode);
    for (const facility of facilities) {
      const blockUnits = grouped.get(facility.id)!.sort(byOrderThenCode).map(snapshotUnit);
      const subForm = facility.subFormId ? subFormsById.get(facility.subFormId) : undefined;
      const fields: VisitFormSnapshotField[] = [];
      if (!subForm) {
        warn({ code: 'SUBFORM_MISSING', message: `${facility.name} has no sub-form; it is listed without questions.`, facilityId: facility.id });
      } else {
        sources.subForms.push({ id: subForm.id, subjectKey: subForm.subjectKey, version: subForm.version, facilityId: facility.id });
        const forKind = subForm.fields.filter((f) => !f.visitKinds || f.visitKinds.includes(input.visitKind));
        if (forKind.length === 0) {
          warn({
            code: 'SUBFORM_EMPTY_FOR_KIND',
            message: `${facility.name}'s sub-form has no questions for ${meta.label} monitoring visits; its units are listed without questions.`,
            facilityId: facility.id,
          });
        }
        for (const f of forKind) {
          if (f.scope === 'PER_UNIT') {
            for (const u of blockUnits) fields.push(facilityField(f, facility, `f:${facility.code}/${f.key}@${u.id}`, [u], u.id, warn));
          } else {
            fields.push(facilityField(f, facility, `f:${facility.code}/${f.key}`, blockUnits, null, warn));
          }
        }
      }
      blocks.push({
        key: `f:${facility.code}`,
        kind: 'FACILITY',
        title: `${facility.name} · ${blockUnits.length} ${blockUnits.length === 1 ? 'unit' : 'units'}`,
        description: blockUnits.map((u) => u.label).join(' · '),
        sectionCode: null,
        facility: { id: facility.id, code: facility.code, name: facility.name, archetype: facility.archetype },
        units: blockUnits,
        fields,
      });
    }
  }

  const rechecks = input.rechecks ?? [];
  if (rechecks.length > 0) blocks.push(recheckBlock(rechecks));

  const fieldCount = blocks.reduce((n, b) => n + b.fields.length, 0);
  if (fieldCount > MAX_SNAPSHOT_FIELDS) {
    throw new VisitFormAssemblyError('FORM_TOO_LARGE', `This form would have ${fieldCount} questions; the limit is ${MAX_SNAPSHOT_FIELDS}.`);
  }

  const snapshot: VisitFormSnapshot = {
    schemaVersion: VISIT_FORM_SNAPSHOT_SCHEMA_VERSION,
    builtAt: input.builtAt,
    context: {
      projectId: input.projectId,
      visitKind: input.visitKind,
      visitDate: input.visitDate,
      sprint: sprint
        ? { id: sprint.id, number: sprint.number, name: sprint.name, startDate: sprint.startDate, endDate: sprint.endDate, deliverables: sprint.deliverables }
        : null,
    },
    sources,
    blocks,
    warnings,
  };
  return { snapshot, warnings };
}

/** The assembly input for a visit kind from an offline bundle (the phone and the server use the same). */
export function assemblyInputFromBundle(
  bundle: VisitFormLibraryBundle,
  opts: {
    visitKind: VisitKind;
    visitDate: string;
    builtAt: string;
    pickedFacilityIds?: string[];
    rechecks?: RecheckInput[];
    /** Overrides the bundle's completed units (R4: reported completion). */
    completedUnitIds?: string[];
  }
): AssembleVisitFormInput {
  const template = bundle.templates.find((t) => t.visitKind === opts.visitKind);
  if (!template) {
    throw new VisitFormAssemblyError('NO_VISIT_FORM_TEMPLATE', `There is no monitoring form template for ${VISIT_KIND_META[opts.visitKind].label} monitoring visits.`);
  }
  return {
    projectId: bundle.projectId,
    visitKind: opts.visitKind,
    visitDate: opts.visitDate,
    builtAt: opts.builtAt,
    template,
    sections: bundle.sections,
    subForms: bundle.subForms,
    facilities: bundle.facilities,
    units: bundle.units,
    sprints: bundle.sprints,
    completedUnitIds: opts.completedUnitIds ?? bundle.completedUnitIds,
    pickedFacilityIds: opts.pickedFacilityIds,
    rechecks: opts.rechecks,
  };
}

export function snapshotFieldCount(snapshot: VisitFormSnapshot): number {
  return snapshot.blocks.reduce((n, b) => n + b.fields.length, 0);
}

// ---------------------------------------------------------------------------
// Canonical form (D-R3.24)
// ---------------------------------------------------------------------------

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(',')}]`;
  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * The snapshot as a canonical JSON string: keys sorted, `builtAt` removed. Shared has no SHA-256, so
 * each side hashes this string (server `hashVisitFormSnapshot`, phone its crypto helper).
 */
export function canonicalVisitFormSnapshot(snapshot: VisitFormSnapshot): string {
  const { builtAt: _builtAt, ...rest } = snapshot;
  return canonicalJson(rest);
}

// ---------------------------------------------------------------------------
// Answer validation (D-R3.16)
// ---------------------------------------------------------------------------

export interface VisitAnswerError {
  path: string;
  code:
    | 'UNKNOWN_PATH'
    | 'DUPLICATE_PATH'
    | 'REQUIRED'
    | 'INVALID_VALUE'
    | 'VALUE_NOT_ALLOWED'
    | 'COMMENT_REQUIRED'
    | 'QUANTITY_ABOVE_PLANNED'
    | 'TOO_MANY_CAPTURES'
    | 'UNKNOWN_UNIT';
  message: string;
}

export interface VisitPhotoGap {
  path: string;
  unitId: string | null;
  code: 'PHOTO_MISSING' | 'UNIT_PHOTO_MISSING' | 'PHOTO_REQUIRED_BY_RULE' | 'AUDIO_MISSING' | 'PHOTO_NOT_GEOTAGGED' | 'PHOTO_OUTSIDE_BOUNDARY';
  clientCaptureId?: string;
}

export interface VisitFindingToRaise {
  path: string;
  fieldKey: string;
  severity: FormFindingSeverity;
  facilityId: string | null;
  unitId: string | null;
  sectionCode: string | null;
  label: string;
  answerText: string;
}

export interface VisitAnswerSignals {
  /** Units reported complete (whole-facility answers cover every unit of the block). */
  unitComplete: string[];
  contractorOnSite: boolean;
  percentComplete: Array<{ path: string; facilityId: string; unitIds: string[]; value: number }>;
  quantityDelivered: Array<{ path: string; facilityId: string; unitIds: string[]; value: number; plannedQuantity: number | null }>;
  /** The option key of the OVERALL_FINDING question, if any was answered. */
  overallFinding: string | null;
}

export interface VisitAnswersCheck {
  /** False when any error exists: the server refuses the submission. Photo gaps never make it false. */
  valid: boolean;
  errors: VisitAnswerError[];
  /** Not server errors: the phone blocks submit on them, the server records them as flags. */
  photoGaps: VisitPhotoGap[];
  findingsToRaise: VisitFindingToRaise[];
  signals: VisitAnswerSignals;
  recheckResults: Array<{ recheckId: string; resolved: boolean }>;
}

type AnswerValue = VisitFormAnswerInput['value'];

function isEmptyValue(v: AnswerValue): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
}

function valueError(f: VisitFormSnapshotField, v: AnswerValue): string | null {
  switch (f.type) {
    case 'SHORT_TEXT':
    case 'LONG_TEXT': {
      const max = f.type === 'SHORT_TEXT' ? 300 : 4000;
      return typeof v === 'string' && v.trim().length <= max ? null : `Enter text (up to ${max} characters)`;
    }
    case 'NUMBER':
      if (typeof v !== 'number' || !Number.isFinite(v)) return 'Enter a number';
      if (f.min !== null && v < f.min) return `Enter at least ${f.min}`;
      if (f.max !== null && v > f.max) return `Enter at most ${f.max}`;
      return null;
    case 'PERCENTAGE':
      return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100 ? null : 'Enter a percentage from 0 to 100';
    case 'RATING_1_5':
      return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 5 ? null : 'Give a rating from 1 to 5';
    case 'YES_NO': {
      const allowed = f.allowNa ? ['YES', 'NO', 'NA'] : ['YES', 'NO'];
      return typeof v === 'string' && allowed.includes(v) ? null : f.allowNa ? 'Answer yes, no or N/A' : 'Answer yes or no';
    }
    case 'SINGLE_CHOICE':
      return typeof v === 'string' && f.options.some((o) => o.key === v) ? null : 'Pick one of the options';
    case 'MULTI_CHOICE': {
      if (!Array.isArray(v)) return 'Pick from the options';
      const keys = new Set(f.options.map((o) => o.key));
      if (v.some((k) => !keys.has(k))) return 'Pick from the options';
      if (new Set(v).size !== v.length) return 'Each option can be picked once';
      if (f.minSelected !== null && v.length < f.minSelected) return `Pick at least ${f.minSelected}`;
      if (f.maxSelected !== null && v.length > f.maxSelected) return `Pick at most ${f.maxSelected}`;
      return null;
    }
    case 'DATE':
      return isIsoCalendarDate(v) ? null : 'Enter a date (YYYY-MM-DD)';
    default:
      return 'This question takes captures only';
  }
}

/** Whether a valid answer meets a condition. */
export function conditionMet(when: FormCondition, field: Pick<VisitFormSnapshotField, 'plannedQuantity'>, v: AnswerValue): boolean {
  if ('equals' in when) return Array.isArray(v) ? v.includes(when.equals) : v === when.equals;
  if ('anyOf' in when) return Array.isArray(v) ? v.some((x) => when.anyOf.includes(x)) : typeof v === 'string' && when.anyOf.includes(v);
  if (typeof v !== 'number') return false;
  if ('atMost' in when) return v <= when.atMost;
  const threshold = when.atLeast === 'PLANNED' ? field.plannedQuantity : when.atLeast;
  return threshold !== null && v >= threshold;
}

function answerText(f: VisitFormSnapshotField, v: AnswerValue): string {
  const option = (k: string) => f.options.find((o) => o.key === k)?.label ?? k;
  if (f.type === 'YES_NO') return v === 'YES' ? 'Yes' : v === 'NO' ? 'No' : 'N/A';
  if (f.type === 'SINGLE_CHOICE' && typeof v === 'string') return option(v);
  if (Array.isArray(v)) return v.map(option).join(', ');
  if (f.type === 'PERCENTAGE') return `${v}%`;
  if (f.type === 'RATING_1_5') return `${v} of 5`;
  if (f.type === 'NUMBER') return `${v}${f.unit ? ` ${f.unit}` : ''}`;
  return String(v ?? '');
}

const hasComment = (c: string | null | undefined) => (c ?? '').trim().length >= 3;

/**
 * Checks answers against a frozen snapshot. Errors block the submission; photo gaps are returned
 * separately (captures upload separately, so an offline submission must not be stranded by them).
 * Also returns the findings the answers raise, the signals they give and the re-check results.
 */
export function validateVisitAnswers(
  snapshot: VisitFormSnapshot,
  answers: VisitFormAnswerInput[],
  captureFacts?: CaptureFact[]
): VisitAnswersCheck {
  const fields = new Map<string, { field: VisitFormSnapshotField; block: VisitFormSnapshotBlock }>();
  for (const block of snapshot.blocks) for (const field of block.fields) fields.set(field.path, { field, block });
  const facts = new Map((captureFacts ?? []).map((c) => [c.clientCaptureId, c]));

  const errors: VisitAnswerError[] = [];
  const photoGaps: VisitPhotoGap[] = [];
  const findingsToRaise: VisitFindingToRaise[] = [];
  const unitComplete = new Set<string>();
  const signals: VisitAnswerSignals = { unitComplete: [], contractorOnSite: false, percentComplete: [], quantityDelivered: [], overallFinding: null };
  const recheckResults: VisitAnswersCheck['recheckResults'] = [];

  const byPath = new Map<string, VisitFormAnswerInput>();
  for (const a of answers) {
    if (!fields.has(a.path)) {
      errors.push({ path: a.path, code: 'UNKNOWN_PATH', message: 'Not a question of this form' });
      continue;
    }
    if (byPath.has(a.path)) {
      errors.push({ path: a.path, code: 'DUPLICATE_PATH', message: 'Answered more than once' });
      continue;
    }
    byPath.set(a.path, a);
  }

  for (const { field: f, block } of fields.values()) {
    const a = byPath.get(f.path);
    const captures = a?.captures ?? [];
    const photos = captures.filter((c) => c.kind === 'PHOTO');
    const audio = captures.filter((c) => c.kind === 'AUDIO');
    const value = a?.value ?? null;
    const blockUnitIds = f.unitId ? [f.unitId] : block.units.map((u) => u.id);

    if (f.type === 'PHOTO') {
      if (!isEmptyValue(value)) errors.push({ path: f.path, code: 'VALUE_NOT_ALLOWED', message: 'This question takes photos only' });
      const p = f.photo!;
      if (photos.length > (p.mode === 'AT_LEAST_N' ? p.maxCount : Math.max(1, p.slots.length) * p.maxCount)) {
        errors.push({ path: f.path, code: 'TOO_MANY_CAPTURES', message: `At most ${p.maxCount} photos` });
      }
      if (p.mode === 'AT_LEAST_N') {
        if (photos.length < p.minCount) photoGaps.push({ path: f.path, unitId: null, code: 'PHOTO_MISSING' });
      } else {
        const slotIds = new Set(p.slots.map((s) => s.unitId));
        for (const c of photos) {
          if (!c.unitId || !slotIds.has(c.unitId)) errors.push({ path: f.path, code: 'UNKNOWN_UNIT', message: 'Each photo must name one of the units' });
        }
        if (p.mode === 'ONE_PER_UNIT') {
          for (const s of p.slots) {
            if (!photos.some((c) => c.unitId === s.unitId)) photoGaps.push({ path: f.path, unitId: s.unitId, code: 'UNIT_PHOTO_MISSING' });
          }
        }
      }
      for (const c of photos) {
        const fact = facts.get(c.clientCaptureId);
        if (!fact) continue;
        if (p.geotagRequired && !fact.geotagged) photoGaps.push({ path: f.path, unitId: c.unitId ?? null, code: 'PHOTO_NOT_GEOTAGGED', clientCaptureId: c.clientCaptureId });
        if (fact.insideBoundary === false) photoGaps.push({ path: f.path, unitId: c.unitId ?? null, code: 'PHOTO_OUTSIDE_BOUNDARY', clientCaptureId: c.clientCaptureId });
      }
      continue;
    }
    if (f.type === 'VOICE_NOTE') {
      if (!isEmptyValue(value)) errors.push({ path: f.path, code: 'VALUE_NOT_ALLOWED', message: 'This question takes a voice note only' });
      if (f.required && audio.length === 0) photoGaps.push({ path: f.path, unitId: null, code: 'AUDIO_MISSING' });
      continue;
    }

    if (isEmptyValue(value)) {
      if (f.required) errors.push({ path: f.path, code: 'REQUIRED', message: 'Answer this question' });
      continue;
    }
    const typeError = valueError(f, value);
    if (typeError) {
      errors.push({ path: f.path, code: 'INVALID_VALUE', message: typeError });
      continue;
    }

    for (const rule of f.rules) {
      if (!conditionMet(rule.when, f, value)) continue;
      if (rule.then === 'REQUIRE_PHOTO' && photos.length === 0) photoGaps.push({ path: f.path, unitId: f.unitId, code: 'PHOTO_REQUIRED_BY_RULE' });
      if (rule.then === 'REQUIRE_COMMENT' && !hasComment(a?.comment)) {
        errors.push({ path: f.path, code: 'COMMENT_REQUIRED', message: f.recheck ? 'Say why it is not rectified' : 'Add a comment for this answer' });
      }
      if (rule.then === 'RAISE_FINDING' && rule.severity) {
        findingsToRaise.push({
          path: f.path,
          fieldKey: f.key,
          severity: rule.severity,
          facilityId: block.facility?.id ?? null,
          unitId: f.unitId,
          sectionCode: block.sectionCode,
          label: f.label,
          answerText: answerText(f, value),
        });
      }
    }
    if (f.boundedByPlannedQuantity && f.plannedQuantity !== null && typeof value === 'number' && value > f.plannedQuantity && !hasComment(a?.comment)) {
      errors.push({ path: f.path, code: 'QUANTITY_ABOVE_PLANNED', message: `More than the planned ${f.plannedQuantity}: add a comment` });
    }

    const s = f.signal;
    if (s && block.facility) {
      if (s.kind === 'UNIT_COMPLETE' && s.when && conditionMet(s.when, f, value)) blockUnitIds.forEach((id) => unitComplete.add(id));
      // 100% complete, or at least the planned quantity delivered, also reports the units complete.
      if (s.kind === 'PERCENT_COMPLETE' && typeof value === 'number') {
        signals.percentComplete.push({ path: f.path, facilityId: block.facility.id, unitIds: blockUnitIds, value });
        if (value >= 100) blockUnitIds.forEach((id) => unitComplete.add(id));
      }
      if (s.kind === 'QUANTITY_DELIVERED' && typeof value === 'number') {
        signals.quantityDelivered.push({ path: f.path, facilityId: block.facility.id, unitIds: blockUnitIds, value, plannedQuantity: f.plannedQuantity });
        if (f.plannedQuantity !== null && value >= f.plannedQuantity) blockUnitIds.forEach((id) => unitComplete.add(id));
      }
    }
    if (s && !block.facility) {
      if (s.kind === 'CONTRACTOR_ON_SITE' && s.when && conditionMet(s.when, f, value)) signals.contractorOnSite = true;
      if (s.kind === 'OVERALL_FINDING' && typeof value === 'string') signals.overallFinding = value;
    }
    if (f.recheck) recheckResults.push({ recheckId: f.recheck.id, resolved: value === 'YES' });
  }

  signals.unitComplete = [...unitComplete];
  return { valid: errors.length === 0, errors, photoGaps, findingsToRaise, signals, recheckResults };
}
