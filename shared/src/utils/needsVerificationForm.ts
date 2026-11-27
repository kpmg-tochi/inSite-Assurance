import { distanceMeters } from '../geo/geofence';
import {
  VISIT_FORM_SNAPSHOT_SCHEMA_VERSION,
  type BundleSection,
  type CaptureFact,
  type FormField,
  type VisitFormAnswerInput,
  type VisitFormSnapshot,
  type VisitFormSnapshotBlock,
  type VisitFormSnapshotField,
} from '../schemas/form.schema';
import { EXISTING_CONDITION_LABELS, INTERVENTION_ACTION_LABELS, type ExistingCondition, type InterventionAction } from '../schemas/needsPipeline.schema';
import {
  NEEDS_VERIFICATION_CONDITION_BY_OPTION,
  NEEDS_VERIFICATION_COORDINATE_TOLERANCE_METERS,
  NEEDS_VERIFICATION_FIELD_KEYS,
  NEEDS_VERIFICATION_FORM_SCHEMA_VERSION,
  NEEDS_VERIFICATION_MAX_ACCURACY_METERS,
  type NeedsSiteCoordinateCorrection,
  type NeedsVerificationForm,
  type NeedsVerificationFormRow,
  type NeedsVerificationFormSite,
  type NeedsVerificationPurpose,
  type NeedsVerificationRowFact,
  type NeedsVerificationSiteFact,
  type NeedsVerificationSiteLocationInput,
} from '../schemas/needsVerification.schema';
import { canonicalJsonString, validateVisitAnswers, type VisitAnswerError, type VisitPhotoGap } from './visitForm';

/**
 * Needs pipeline wave 5 (N8), pure: the field verification form, its answer check, what the answers
 * say per site and per breakdown row, and the coordinate corrections acceptance applies. The server
 * and the phone use the same functions (the phone blocks submit on what the server would refuse).
 */

export const needsSitePath = (siteNumber: number, key: string) => `n:site:${siteNumber}/${key}`;
export const needsRowPath = (rowId: string, key: string) => `n:row:${rowId}/${key}`;

function snapshotField(f: FormField, path: string, unitId: string | null): VisitFormSnapshotField {
  const p = f.type === 'PHOTO' ? f.photo ?? { mode: 'AT_LEAST_N' as const, minCount: 1, maxCount: 10, geotagRequired: true } : null;
  return {
    path,
    key: f.key,
    type: f.type,
    label: f.label,
    labelTemplate: null,
    guidance: f.guidance,
    // Per-unit photo modes make no sense on one row: every photo field is "at least N" here.
    required: p ? p.minCount > 0 : f.required,
    options: f.options,
    minSelected: f.minSelected,
    maxSelected: f.maxSelected,
    unit: f.unit,
    min: f.min,
    max: f.max,
    allowNa: f.allowNa,
    photo: p ? { mode: 'AT_LEAST_N', minCount: p.mode === 'AT_LEAST_N' ? p.minCount : 1, maxCount: p.maxCount, geotagRequired: p.geotagRequired, slots: [] } : null,
    scope: 'WHOLE_FACILITY',
    unitId,
    plannedQuantity: null,
    boundedByPlannedQuantity: false,
    // RAISE_FINDING rules have no meaning before a project exists; comments and photos still apply.
    rules: f.rules.filter((r) => r.then !== 'RAISE_FINDING'),
    signal: null,
    recheck: null,
  };
}

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, ''));

export interface AssembleNeedsVerificationFormInput {
  cycleId: string;
  proposalId: string;
  reference: string;
  title: string;
  purpose: NeedsVerificationPurpose;
  versionNumber: number;
  /** The tenant's current NEEDS_VERIFICATION_SITE and NEEDS_VERIFICATION_FACILITY sections. */
  siteSection: BundleSection;
  facilitySection: BundleSection;
  /** The sites to visit (already narrowed to the assigned site numbers), in site order. */
  sites: NeedsVerificationFormSite[];
  /** Breakdown rows of those sites. */
  rows: NeedsVerificationFormRow[];
  builtAt: string;
}

/** Builds the frozen form: a block per site, followed by a block per breakdown row of that site. */
export function assembleNeedsVerificationForm(input: AssembleNeedsVerificationFormInput): NeedsVerificationForm {
  const sites = [...input.sites].sort((a, b) => a.siteNumber - b.siteNumber);
  const siteNumbers = new Set(sites.map((s) => s.siteNumber));
  const rows = input.rows.filter((r) => siteNumbers.has(r.siteNumber)).sort((a, b) => a.siteNumber - b.siteNumber || a.unitId.localeCompare(b.unitId));
  const blocks: VisitFormSnapshotBlock[] = [];
  for (const site of sites) {
    blocks.push({
      key: `n:site:${site.siteNumber}`,
      kind: 'SECTION',
      title: `Site ${site.siteNumber}: ${site.schoolName}`,
      description: [site.address, input.siteSection.description].filter(Boolean).join(' · ') || null,
      sectionCode: input.siteSection.code,
      facility: null,
      units: [],
      fields: input.siteSection.fields.map((f) => snapshotField(f, needsSitePath(site.siteNumber, f.key), null)),
    });
    for (const row of rows.filter((r) => r.siteNumber === site.siteNumber)) {
      const action = INTERVENTION_ACTION_LABELS[row.interventionAction as InterventionAction] ?? row.interventionAction;
      blocks.push({
        key: `n:row:${row.rowId}`,
        kind: 'SECTION',
        title: `${row.facilityName} (${row.unitId}), site ${site.siteNumber}`,
        description:
          `Needs assessment: ${qty(row.existingQuantity)} ${row.unitOfMeasure} existing, ${EXISTING_CONDITION_LABELS[row.existingCondition].toLowerCase()}; ` +
          `${action.toLowerCase()} ${qty(row.proposedQuantity)} ${row.unitOfMeasure}.`,
        sectionCode: input.facilitySection.code,
        facility: null,
        units: [{ id: row.rowId, code: row.unitId, label: `${row.facilityName} ${row.unitId}`, plannedQuantity: row.existingQuantity, quantityUnit: row.unitOfMeasure }],
        fields: input.facilitySection.fields.map((f) => snapshotField(f, needsRowPath(row.rowId, f.key), row.rowId)),
      });
    }
  }
  return {
    schemaVersion: NEEDS_VERIFICATION_FORM_SCHEMA_VERSION,
    builtAt: input.builtAt,
    context: {
      cycleId: input.cycleId,
      proposalId: input.proposalId,
      reference: input.reference,
      title: input.title,
      purpose: input.purpose,
      versionNumber: input.versionNumber,
    },
    sources: {
      sections: [input.siteSection, input.facilitySection].map((s) => ({ id: s.id, code: s.code, version: s.version })),
    },
    sites,
    rows,
    blocks,
  };
}

/** The form as canonical JSON without `builtAt`: each side hashes it with SHA-256 (the `formHash`). */
export function canonicalNeedsVerificationForm(form: NeedsVerificationForm): string {
  const { builtAt: _builtAt, ...rest } = form;
  return canonicalJsonString(rest);
}

/** The visit answer rules read only the blocks: the form wrapped as a snapshot for them. */
function asSnapshot(form: NeedsVerificationForm): VisitFormSnapshot {
  return {
    schemaVersion: VISIT_FORM_SNAPSHOT_SCHEMA_VERSION,
    builtAt: form.builtAt,
    context: { projectId: form.context.proposalId, visitKind: 'AD_HOC', visitDate: '2000-01-01', sprint: null },
    sources: { template: { id: form.context.proposalId, code: 'NEEDS_VERIFICATION', version: 1, name: 'Needs verification' }, sections: form.sources.sections, subForms: [] },
    blocks: form.blocks,
    warnings: [],
  };
}

export interface NeedsVerificationLocationError {
  siteNumber: number;
  code: 'SITE_LOCATION_MISSING' | 'UNKNOWN_SITE' | 'DUPLICATE_SITE_LOCATION';
  message: string;
}

export interface NeedsVerificationAnswersCheck {
  /** False when any error exists: the server refuses the submission (422 NEEDS_VERIFICATION_INVALID). */
  valid: boolean;
  errors: VisitAnswerError[];
  locationErrors: NeedsVerificationLocationError[];
  /** Missing or ungeotagged photos: the phone blocks submit on them; the server accepts them. */
  photoGaps: VisitPhotoGap[];
}

/** The answer check: the visit rules on the form's blocks plus one location per site. */
export function validateNeedsVerificationAnswers(
  form: NeedsVerificationForm,
  answers: VisitFormAnswerInput[],
  siteLocations: NeedsVerificationSiteLocationInput[],
  captureFacts?: CaptureFact[]
): NeedsVerificationAnswersCheck {
  const check = validateVisitAnswers(asSnapshot(form), answers, captureFacts);
  const locationErrors: NeedsVerificationLocationError[] = [];
  const known = new Set(form.sites.map((s) => s.siteNumber));
  const seen = new Set<number>();
  for (const l of siteLocations) {
    if (!known.has(l.siteNumber)) locationErrors.push({ siteNumber: l.siteNumber, code: 'UNKNOWN_SITE', message: `Site ${l.siteNumber} is not on this verification` });
    else if (seen.has(l.siteNumber)) locationErrors.push({ siteNumber: l.siteNumber, code: 'DUPLICATE_SITE_LOCATION', message: `Site ${l.siteNumber} has two locations` });
    seen.add(l.siteNumber);
  }
  for (const s of form.sites) {
    if (!seen.has(s.siteNumber)) locationErrors.push({ siteNumber: s.siteNumber, code: 'SITE_LOCATION_MISSING', message: `Record the location at site ${s.siteNumber} (${s.schoolName})` });
  }
  return { valid: check.errors.length === 0 && locationErrors.length === 0, errors: check.errors, locationErrors, photoGaps: check.photoGaps };
}

const yesNo = (v: unknown): boolean | null => (v === 'YES' ? true : v === 'NO' ? false : null);

/** What the answers say, per site and per breakdown row (the web review and acceptance read it). */
export function needsVerificationFacts(
  form: NeedsVerificationForm,
  answers: VisitFormAnswerInput[],
  siteLocations: NeedsVerificationSiteLocationInput[]
): { siteFacts: NeedsVerificationSiteFact[]; rowFacts: NeedsVerificationRowFact[] } {
  const byPath = new Map(answers.map((a) => [a.path, a]));
  const K = NEEDS_VERIFICATION_FIELD_KEYS;
  const siteFacts = form.sites.map((s): NeedsVerificationSiteFact => {
    const found = byPath.get(needsSitePath(s.siteNumber, K.schoolFound));
    const loc = siteLocations.find((l) => l.siteNumber === s.siteNumber) ?? null;
    return {
      siteNumber: s.siteNumber,
      schoolName: s.schoolName,
      schoolFound: yesNo(found?.value),
      comment: found?.comment ?? null,
      location: loc
        ? {
            siteNumber: loc.siteNumber,
            latitude: loc.latitude,
            longitude: loc.longitude,
            accuracyMeters: loc.accuracyMeters ?? null,
            capturedAt: loc.capturedAt,
            isMockLocation: loc.isMockLocation ?? false,
          }
        : null,
    };
  });
  const rowFacts = form.rows.map((r): NeedsVerificationRowFact => {
    const q = byPath.get(needsRowPath(r.rowId, K.existingQuantity))?.value;
    const c = byPath.get(needsRowPath(r.rowId, K.existingCondition))?.value;
    const m = byPath.get(needsRowPath(r.rowId, K.matchesAssessment));
    const countedQuantity = typeof q === 'number' ? q : null;
    const countedCondition: ExistingCondition | null = typeof c === 'string' ? NEEDS_VERIFICATION_CONDITION_BY_OPTION[c] ?? null : null;
    const matchesAssessment = yesNo(m?.value);
    const differs =
      (countedQuantity !== null && Math.abs(countedQuantity - r.existingQuantity) > 1e-9) ||
      (countedCondition !== null && countedCondition !== r.existingCondition) ||
      matchesAssessment === false;
    return {
      rowId: r.rowId,
      unitId: r.unitId,
      siteNumber: r.siteNumber,
      facilityName: r.facilityName,
      recordedQuantity: r.existingQuantity,
      recordedCondition: r.existingCondition,
      countedQuantity,
      countedCondition,
      matchesAssessment,
      comment: m?.comment ?? null,
      differs,
    };
  });
  return { siteFacts, rowFacts };
}

/** Site numbers whose "school found" answer is NO (such a site is never moved by acceptance). */
export function sitesNotFound(form: Pick<NeedsVerificationForm, 'sites'>, answers: VisitFormAnswerInput[]): number[] {
  const byPath = new Map(answers.map((a) => [a.path, a.value]));
  return form.sites.filter((s) => byPath.get(needsSitePath(s.siteNumber, NEEDS_VERIFICATION_FIELD_KEYS.schoolFound)) === 'NO').map((s) => s.siteNumber);
}

/**
 * The site moves acceptance applies: a site with a recorded location (not mocked, accuracy known and
 * at most `NEEDS_VERIFICATION_MAX_ACCURACY_METERS`, or unknown) moves when it has no stored location or
 * the recorded one is more than `NEEDS_VERIFICATION_COORDINATE_TOLERANCE_METERS` away. Sites in
 * `options.skipSiteNumbers` never move (acceptance passes `sitesNotFound`: the officer stood somewhere
 * the school is not).
 */
export function siteCoordinateCorrections(
  sites: NeedsVerificationFormSite[],
  siteLocations: NeedsVerificationSiteLocationInput[],
  options?: { skipSiteNumbers?: number[] }
): NeedsSiteCoordinateCorrection[] {
  const out: NeedsSiteCoordinateCorrection[] = [];
  const skip = new Set(options?.skipSiteNumbers ?? []);
  for (const site of sites) {
    if (skip.has(site.siteNumber)) continue;
    const loc = siteLocations.find((l) => l.siteNumber === site.siteNumber);
    if (!loc || loc.isMockLocation) continue;
    const accuracy = loc.accuracyMeters ?? null;
    if (accuracy !== null && accuracy > NEEDS_VERIFICATION_MAX_ACCURACY_METERS) continue;
    const to = { latitude: loc.latitude, longitude: loc.longitude };
    const from = site.latitude !== null && site.longitude !== null ? { latitude: site.latitude, longitude: site.longitude } : null;
    const moved = from ? distanceMeters(from, to) : null;
    if (moved !== null && moved <= NEEDS_VERIFICATION_COORDINATE_TOLERANCE_METERS) continue;
    out.push({ siteNumber: site.siteNumber, schoolName: site.schoolName, from, to, distanceMeters: moved === null ? null : Math.round(moved), accuracyMeters: accuracy });
  }
  return out;
}
