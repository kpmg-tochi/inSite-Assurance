/**
 * Redesign R3: save-time field checks and placeholder rendering for the form builder. This file
 * imports only types from form.schema.ts (the schema calls validateFormFields from its refinements),
 * so there is no runtime import cycle.
 */
import type { FormCondition, FormField, FormFieldType } from '../schemas/form.schema';
import type { FacilityArchetype } from '../schemas/facility.schema';

export interface FormFieldIssue {
  code: string;
  message: string;
  /** Index of the field in the list. */
  index: number;
  /** The offending property, when one is. */
  field?: string;
}

export const FORM_PLACEHOLDERS = ['count', 'facility', 'units', 'plannedQty', 'uom'] as const;
export type FormPlaceholder = (typeof FORM_PLACEHOLDERS)[number];
const PLACEHOLDER_RE = /\{([^{}]*)\}/g;

const CHOICE: FormFieldType[] = ['SINGLE_CHOICE', 'MULTI_CHOICE'];
const NUMERIC: FormFieldType[] = ['NUMBER', 'PERCENTAGE', 'RATING_1_5'];
const CAPTURE: FormFieldType[] = ['PHOTO', 'VOICE_NOTE'];
const YES_NO_VALUES = ['YES', 'NO', 'NA'];

/** Placeholder names used in a text (without braces), in order of appearance. */
export function placeholdersIn(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...text.matchAll(PLACEHOLDER_RE)].map((m) => m[1]);
}

function conditionValues(when: FormCondition): string[] | null {
  if ('equals' in when) return [when.equals];
  if ('anyOf' in when) return when.anyOf;
  return null;
}

/** Whether a condition fits the field's type; returns a message when it does not. */
function conditionIssue(f: FormField, when: FormCondition): string | null {
  const values = conditionValues(when);
  if (values) {
    if (f.type === 'YES_NO') {
      const allowed = f.allowNa ? YES_NO_VALUES : ['YES', 'NO'];
      const bad = values.find((v) => !allowed.includes(v));
      return bad ? `"${bad}" is not an answer of this yes/no question` : null;
    }
    if (CHOICE.includes(f.type)) {
      const keys = new Set(f.options.map((o) => o.key));
      const bad = values.find((v) => !keys.has(v));
      return bad ? `"${bad}" is not an option of this question` : null;
    }
    return 'Compare yes/no and choice answers with "is" / "is one of"';
  }
  if (!NUMERIC.includes(f.type)) return 'Only numbers, percentages and ratings take "at most" / "at least"';
  if ('atLeast' in when && when.atLeast === 'PLANNED' && !(f.type === 'NUMBER' && f.boundedByPlannedQuantity)) {
    return '"At least the planned quantity" needs a number bounded by the planned quantity';
  }
  return null;
}

/**
 * Save-time checks beyond the schema (D-R3.10 validity matrix, D-R3.12 keys, D-R3.9 placeholders,
 * rules and signals). `context` is where the fields live: a fixed section or a facility sub-form.
 * `previousKeyTypes` holds the type each key had in earlier versions of the same component.
 */
export function validateFormFields(
  fields: FormField[],
  opts: { context: 'SECTION' | 'SUBFORM'; previousKeyTypes?: Record<string, FormFieldType> }
): FormFieldIssue[] {
  const issues: FormFieldIssue[] = [];
  const sub = opts.context === 'SUBFORM';
  const seen = new Set<string>();
  fields.forEach((f, index) => {
    const add = (code: string, message: string, field?: string) => issues.push({ code, message, index, ...(field ? { field } : {}) });
    const name = `"${f.label}"`;

    if (seen.has(f.key)) add('DUPLICATE_KEY', `Field key "${f.key}" is used twice`, 'key');
    seen.add(f.key);
    const before = opts.previousKeyTypes?.[f.key];
    if (before && before !== f.type) {
      add('FIELD_KEY_TYPE_CHANGED', `${name}: key "${f.key}" was a ${before} field in an earlier version; use a new key for a new type`, 'type');
    }

    // Placeholders (sub-forms only).
    for (const [prop, text] of [
      ['label', f.label],
      ['guidance', f.guidance],
    ] as const) {
      const names = placeholdersIn(text);
      if (names.length === 0) continue;
      if (!sub) {
        add('PLACEHOLDER_NOT_ALLOWED', `${name}: placeholders such as {${names[0]}} only work in facility sub-forms`, prop);
        continue;
      }
      const unknown = names.find((n) => !(FORM_PLACEHOLDERS as readonly string[]).includes(n));
      if (unknown !== undefined) add('UNKNOWN_PLACEHOLDER', `${name}: {${unknown}} is not a placeholder (use ${FORM_PLACEHOLDERS.map((p) => `{${p}}`).join(', ')})`, prop);
    }

    // Choice options.
    if (CHOICE.includes(f.type)) {
      if (f.options.length < 2) add('OPTIONS_REQUIRED', `${name}: add at least two options`, 'options');
      const keys = new Set<string>();
      for (const o of f.options) {
        if (keys.has(o.key)) add('DUPLICATE_OPTION', `${name}: option key "${o.key}" is used twice`, 'options');
        keys.add(o.key);
      }
    } else if (f.options.length > 0) {
      add('OPTIONS_NOT_ALLOWED', `${name}: only choice questions have options`, 'options');
    }
    if (f.type === 'MULTI_CHOICE') {
      if (f.minSelected !== null && f.minSelected > f.options.length) add('SELECTION_RANGE', `${name}: cannot require more selections than options`, 'minSelected');
      if (f.minSelected !== null && f.maxSelected !== null && f.minSelected > f.maxSelected) add('SELECTION_RANGE', `${name}: the minimum is above the maximum`, 'minSelected');
    } else if (f.minSelected !== null || f.maxSelected !== null) {
      add('SELECTION_NOT_ALLOWED', `${name}: only multiple choice questions set how many to pick`, 'minSelected');
    }

    // Number settings.
    if (f.type === 'NUMBER') {
      if (f.min !== null && f.max !== null && f.min > f.max) add('RANGE_INVALID', `${name}: the minimum is above the maximum`, 'min');
    } else {
      if (f.min !== null || f.max !== null) add('RANGE_NOT_ALLOWED', `${name}: only number questions take a range`, 'min');
      if (f.unit) add('UNIT_NOT_ALLOWED', `${name}: only number questions take a unit`, 'unit');
    }
    if (f.boundedByPlannedQuantity) {
      if (f.type !== 'NUMBER') add('BOUND_NOT_ALLOWED', `${name}: only number questions can be bounded by the planned quantity`, 'boundedByPlannedQuantity');
      else if (!sub) add('BOUND_NOT_ALLOWED', `${name}: the planned quantity is only known in facility sub-forms`, 'boundedByPlannedQuantity');
    }
    if (f.allowNa && f.type !== 'YES_NO') add('NA_NOT_ALLOWED', `${name}: only yes/no questions offer N/A`, 'allowNa');

    // Photo settings and scope (D-R3.10 matrix).
    if (f.type === 'PHOTO') {
      const p = f.photo;
      if (p) {
        if (p.mode === 'AT_LEAST_N' && p.minCount > p.maxCount) add('PHOTO_RANGE', `${name}: the minimum number of photos is above the maximum`, 'photo');
        if (!sub && p.mode !== 'AT_LEAST_N') add('PHOTO_MODE_NOT_ALLOWED', `${name}: fixed sections only take "at least N" photos`, 'photo');
        if (f.scope === 'PER_UNIT' && p.mode === 'ONE_PER_UNIT') {
          add('PHOTO_MODE_NOT_ALLOWED', `${name}: a per-unit question already repeats per unit; use "at least N"`, 'photo');
        }
      }
    } else if (f.photo) {
      add('PHOTO_NOT_ALLOWED', `${name}: only photo questions have photo settings`, 'photo');
    }
    if (!sub && f.scope === 'PER_UNIT') add('SCOPE_NOT_ALLOWED', `${name}: fixed sections have no units; answers are for the whole visit`, 'scope');
    if (!sub && f.visitKinds) add('VISIT_KINDS_NOT_ALLOWED', `${name}: fixed sections are picked per visit kind by the template`, 'visitKinds');

    // Rules.
    f.rules.forEach((r) => {
      if (CAPTURE.includes(f.type)) {
        add('RULE_NOT_ALLOWED', `${name}: photo and voice questions have no answer to test`, 'rules');
        return;
      }
      const message = conditionIssue(f, r.when);
      if (message) add('RULE_CONDITION_INVALID', `${name}: ${message}`, 'rules');
    });

    // Signal.
    const s = f.signal;
    if (s) {
      const conditional = s.kind === 'UNIT_COMPLETE' || s.kind === 'CONTRACTOR_ON_SITE';
      const subOnly = s.kind === 'UNIT_COMPLETE' || s.kind === 'PERCENT_COMPLETE' || s.kind === 'QUANTITY_DELIVERED';
      if (subOnly && !sub) add('SIGNAL_CONTEXT', `${name}: this signal is only for facility sub-forms`, 'signal');
      if (!subOnly && sub) add('SIGNAL_CONTEXT', `${name}: this signal is only for fixed sections`, 'signal');
      if (conditional && !s.when) add('SIGNAL_CONDITION_REQUIRED', `${name}: say which answer gives the signal`, 'signal');
      if (!conditional && s.when) add('SIGNAL_CONDITION_NOT_ALLOWED', `${name}: this signal takes the answer itself; remove the condition`, 'signal');
      if (s.when && !CAPTURE.includes(f.type)) {
        const message = conditionIssue(f, s.when);
        if (message) add('SIGNAL_CONDITION_INVALID', `${name}: ${message}`, 'signal');
      }
      if (CAPTURE.includes(f.type)) add('SIGNAL_TYPE', `${name}: photo and voice questions cannot give a signal`, 'signal');
      if (s.kind === 'CONTRACTOR_ON_SITE' && f.type !== 'YES_NO') add('SIGNAL_TYPE', `${name}: "contractor on site" needs a yes/no question`, 'signal');
      if (s.kind === 'PERCENT_COMPLETE' && f.type !== 'PERCENTAGE') add('SIGNAL_TYPE', `${name}: "% complete" needs a percentage question`, 'signal');
      if (s.kind === 'QUANTITY_DELIVERED' && !(f.type === 'NUMBER' && f.boundedByPlannedQuantity)) {
        add('SIGNAL_TYPE', `${name}: "quantity delivered" needs a number bounded by the planned quantity`, 'signal');
      }
      if (s.kind === 'OVERALL_FINDING' && f.type !== 'SINGLE_CHOICE') add('SIGNAL_TYPE', `${name}: "overall finding" needs a single choice question`, 'signal');
    }
  });
  return issues;
}

// ---------------------------------------------------------------------------
// Placeholders (D-R3.9)
// ---------------------------------------------------------------------------

export interface FacilityNounInput {
  name: string;
  pluralName?: string | null;
  archetype: FacilityArchetype;
}

/** Simple English plural of the last word: consonant + y → ies, s/x/z/ch/sh → es, else + s. */
export function simplePlural(name: string): string {
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(name)) return `${name}es`;
  return `${name}s`;
}

/** Lower-cases the first letter only when the second is lower case ("Toilets" → "toilets", "ICT labs" kept). */
function lowerFirst(text: string): string {
  const chars = [...text];
  if (chars.length >= 2 && chars[1] !== chars[1].toUpperCase() && chars[1] === chars[1].toLowerCase()) {
    return chars[0].toLowerCase() + chars.slice(1).join('');
  }
  return text;
}

/**
 * The facility noun for `{facility}`: singular for one, else `pluralName`, else a simple plural.
 * Supply facilities never pluralise ("pupils' furniture"). Lower-cased for use mid-sentence.
 */
export function facilityNoun(facility: FacilityNounInput, count: number): string {
  const base =
    count === 1 || facility.archetype === 'SUPPLY_INSTALLATION'
      ? facility.name
      : facility.pluralName?.trim() || simplePlural(facility.name);
  return lowerFirst(base);
}

export interface PlaceholderUnit {
  label: string;
  plannedQuantity: number | null;
  quantityUnit: string | null;
}

export interface PlaceholderContext {
  facility: FacilityNounInput;
  units: PlaceholderUnit[];
}

/** Formats a quantity without trailing zeros (120, 12.5). */
export function formatQuantity(n: number): string {
  return String(Math.round(n * 1000) / 1000);
}

/**
 * The planned quantity of some units: the sum when they share one quantity unit, else a list
 * ("120 nr, 40 set") with no common unit. Units without a planned quantity are left out.
 */
export function plannedQuantityOf(units: PlaceholderUnit[]): { total: number | null; uom: string; text: string } {
  const withQty = units.filter((u) => typeof u.plannedQuantity === 'number');
  if (withQty.length === 0) return { total: null, uom: '', text: '' };
  const uoms = [...new Set(withQty.map((u) => u.quantityUnit ?? ''))];
  if (uoms.length === 1) {
    const total = withQty.reduce((s, u) => s + (u.plannedQuantity as number), 0);
    return { total, uom: uoms[0], text: formatQuantity(total) };
  }
  const byUom = new Map<string, number>();
  for (const u of withQty) byUom.set(u.quantityUnit ?? '', (byUom.get(u.quantityUnit ?? '') ?? 0) + (u.plannedQuantity as number));
  return { total: null, uom: '', text: [...byUom.entries()].map(([uom, q]) => `${formatQuantity(q)}${uom ? ` ${uom}` : ''}`).join(', ') };
}

/**
 * Renders {count} {facility} {units} {plannedQty} {uom}. Unknown placeholders are left as written
 * (they are refused on save). A text that starts with a placeholder keeps a capital first letter.
 */
export function renderPlaceholders(text: string, ctx: PlaceholderContext): string {
  const qty = plannedQuantityOf(ctx.units);
  const values: Record<FormPlaceholder, string> = {
    count: String(ctx.units.length),
    facility: facilityNoun(ctx.facility, ctx.units.length),
    units: ctx.units.map((u) => u.label).join(', '),
    plannedQty: qty.text,
    uom: qty.uom,
  };
  const startsWithPlaceholder = /^\{[^{}]*\}/.test(text);
  let out = text.replace(PLACEHOLDER_RE, (whole, name: string) =>
    (FORM_PLACEHOLDERS as readonly string[]).includes(name) ? values[name as FormPlaceholder] : whole
  );
  out = out.replace(/ {2,}/g, ' ').trim();
  if (startsWithPlaceholder && out.length > 0) out = out[0].toUpperCase() + out.slice(1);
  return out;
}
