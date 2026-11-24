/**
 * Redesign R5a: the visit form on the phone (pure; tested in Node). Everything here works on the R3
 * frozen snapshot (`VisitFormSnapshot`) and R3 answers keyed by path (`s:<SECTION>/<key>`,
 * `f:<FACILITY>/<key>[@unitId]`, `r:<recheckId>`); validation is the shared `validateVisitAnswers`,
 * fed with the phone's capture facts so the D-R5.14 photo rule runs on the device.
 *
 * - screens: one per snapshot block (section, facility, re-checks), in order;
 * - answers: immutable helpers on the draft's answers array;
 * - photo slots per mode (ONE_PER_UNIT, PER_UNIT_OPTIONAL, AT_LEAST_N) and rule-required photos;
 * - issues per screen (errors and photo gaps both block submit on the phone);
 * - draft → submission request (ids only), finalised at send time;
 * - D-R5.19: what changed between two snapshots and re-mapping answers onto a rebuilt form;
 * - offline Ad hoc (D-R5.12): assembling from the R4 field pack and hashing like the server.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import {
  assembleVisitForm,
  assemblyInputFromBundle,
  canonicalVisitFormSnapshot,
  conditionMet,
  FORM_CAPTURE_TYPES,
  sameFormApartFromRechecks,
  validateVisitAnswers,
  VisitOverallFindingEnum,
  type CaptureFact,
  type FormFindingSeverity,
  type GeofenceStatus,
  type PhotoMode,
  type RecheckInput,
  type SubmissionGeotagInput,
  type SubmitVisitRequestInput,
  type VisitAnswerDto,
  type VisitCheckInRequestInput,
  type VisitFieldPackDto,
  type VisitFindingToRaise,
  type VisitFormAnswerInput,
  type VisitFormAssemblyWarning,
  type VisitFormCaptureRef,
  type VisitFormSnapshot,
  type VisitFormSnapshotBlock,
  type VisitFormSnapshotField,
  type VisitOverallFinding,
} from '@insite/shared';
import type { VisitDraft } from './visitModel';

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

export interface FormScreen {
  /** The block key (`s:<SECTION>`, `f:<FACILITY>` or `r`). */
  key: string;
  index: number;
  kind: VisitFormSnapshotBlock['kind'];
  title: string;
  description: string | null;
  facility: VisitFormSnapshotBlock['facility'];
  units: VisitFormSnapshotBlock['units'];
  fields: VisitFormSnapshotField[];
  /** A facility listed without questions (no sub-form for this visit kind): show it as information. */
  isEmpty: boolean;
}

/** One screen per snapshot block, in the snapshot's order. */
export function formScreens(snapshot: VisitFormSnapshot): FormScreen[] {
  return snapshot.blocks.map((b, index) => ({
    key: b.key,
    index,
    kind: b.kind,
    title: b.title,
    description: b.description,
    facility: b.facility,
    units: b.units,
    fields: b.fields,
    isEmpty: b.fields.length === 0,
  }));
}

export interface FieldRef {
  field: VisitFormSnapshotField;
  block: VisitFormSnapshotBlock;
  screenKey: string;
  screenIndex: number;
}

/** Every question by answer path. */
export function fieldsByPath(snapshot: VisitFormSnapshot): Map<string, FieldRef> {
  const out = new Map<string, FieldRef>();
  snapshot.blocks.forEach((block, screenIndex) => {
    for (const field of block.fields) out.set(field.path, { field, block, screenKey: block.key, screenIndex });
  });
  return out;
}

/** The unit a per-unit question is about, by label ("Classroom block A"), for headings. */
export function unitLabelFor(field: VisitFormSnapshotField, block: VisitFormSnapshotBlock): string | null {
  if (!field.unitId) return null;
  return block.units.find((u) => u.id === field.unitId)?.label ?? null;
}

// ---------------------------------------------------------------------------
// Answers (immutable helpers on the draft's answers array)
// ---------------------------------------------------------------------------

export function answerFor(answers: VisitFormAnswerInput[], path: string): VisitFormAnswerInput | null {
  return answers.find((a) => a.path === path) ?? null;
}

function upsert(answers: VisitFormAnswerInput[], path: string, fn: (a: VisitFormAnswerInput) => VisitFormAnswerInput): VisitFormAnswerInput[] {
  const i = answers.findIndex((a) => a.path === path);
  const current: VisitFormAnswerInput = i >= 0 ? answers[i] : { path, value: null, comment: null, captures: [] };
  const next = fn(current);
  const out = [...answers];
  if (i >= 0) out[i] = next;
  else out.push(next);
  return out;
}

/** Sets the value (option keys for choices, YES/NO/NA, numbers, YYYY-MM-DD, text). */
export function setAnswerValue(answers: VisitFormAnswerInput[], path: string, value: VisitFormAnswerInput['value']): VisitFormAnswerInput[] {
  return upsert(answers, path, (a) => ({ ...a, value: value ?? null }));
}

export function setAnswerComment(answers: VisitFormAnswerInput[], path: string, comment: string | null): VisitFormAnswerInput[] {
  return upsert(answers, path, (a) => ({ ...a, comment: comment && comment.length > 0 ? comment : null }));
}

/** Adds a capture (by clientCaptureId) to an answer; a capture already on the answer is not added twice. */
export function addAnswerCapture(answers: VisitFormAnswerInput[], path: string, ref: { clientCaptureId: string; unitId?: string | null; kind: 'PHOTO' | 'AUDIO' }): VisitFormAnswerInput[] {
  return upsert(answers, path, (a) => {
    const captures = a.captures ?? [];
    if (captures.some((c) => c.clientCaptureId === ref.clientCaptureId)) return a;
    return { ...a, captures: [...captures, { clientCaptureId: ref.clientCaptureId, unitId: ref.unitId ?? null, kind: ref.kind }] };
  });
}

export function removeAnswerCapture(answers: VisitFormAnswerInput[], path: string, clientCaptureId: string): VisitFormAnswerInput[] {
  return upsert(answers, path, (a) => ({ ...a, captures: (a.captures ?? []).filter((c) => c.clientCaptureId !== clientCaptureId) }));
}

/** Every capture id the answers name (photos and voice notes). */
export function answerCaptureIds(answers: VisitFormAnswerInput[]): string[] {
  return [...new Set(answers.flatMap((a) => (a.captures ?? []).map((c) => c.clientCaptureId)))];
}

function isEmptyValue(v: VisitFormAnswerInput['value']): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '') || (Array.isArray(v) && v.length === 0);
}

/**
 * The answers to send: only paths of this snapshot, without empty ones (no value, comment or
 * capture), text trimmed, captures with an explicit unit.
 */
export function cleanAnswers(snapshot: VisitFormSnapshot, answers: VisitFormAnswerInput[]): VisitFormAnswerInput[] {
  const paths = fieldsByPath(snapshot);
  const out: VisitFormAnswerInput[] = [];
  for (const a of answers) {
    if (!paths.has(a.path) || out.some((o) => o.path === a.path)) continue;
    const value = typeof a.value === 'string' ? a.value.trim() : a.value ?? null;
    const comment = a.comment?.trim() ? a.comment.trim() : null;
    const captures = (a.captures ?? []).map((c) => ({ clientCaptureId: c.clientCaptureId, unitId: c.unitId ?? null, kind: c.kind }));
    if (isEmptyValue(value) && !comment && captures.length === 0) continue;
    out.push({ path: a.path, value: isEmptyValue(value) ? null : value, comment, captures });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Captures and photo slots (D-R5.14)
// ---------------------------------------------------------------------------

/** What the phone knows about one of its captures. */
export interface PhoneCaptureFact {
  clientCaptureId: string;
  /** A real GPS fix was taken with it. */
  hasFix: boolean;
  isMocked: boolean;
  /** The server's geofence result once registered, else the local preview; null without a boundary or fix. */
  geofenceStatus: GeofenceStatus | null;
}

export type PhotoStatus = 'OK' | 'NO_LOCATION' | 'MOCKED' | 'OUTSIDE_BOUNDARY' | 'MISSING';

export const PHOTO_STATUS_TEXT: Record<Exclude<PhotoStatus, 'OK'>, string> = {
  NO_LOCATION: 'No location: retake it on site',
  MOCKED: 'The location looks simulated: retake it',
  OUTSIDE_BOUNDARY: 'Outside the site boundary: retake it on site',
  MISSING: 'This photo is no longer on the phone: take it again',
};

/**
 * D-R5.14: a photo counts only with a real fix (not mocked) inside the boundary or its tolerance
 * band. Without `geotagRequired` the location is not needed, but a photo outside the boundary still
 * does not count (the server records it as a gap either way).
 */
export function photoStatus(fact: PhoneCaptureFact | undefined, geotagRequired: boolean): PhotoStatus {
  if (!fact) return 'MISSING';
  if (geotagRequired && !fact.hasFix) return 'NO_LOCATION';
  if (geotagRequired && fact.isMocked) return 'MOCKED';
  if (fact.geofenceStatus === 'OUTSIDE') return 'OUTSIDE_BOUNDARY';
  return 'OK';
}

/** The facts as the shared validation takes them: a mocked fix is not a geotag. */
export function toValidationFacts(facts: PhoneCaptureFact[]): CaptureFact[] {
  return facts.map((f) => ({
    clientCaptureId: f.clientCaptureId,
    geotagged: f.hasFix && !f.isMocked,
    insideBoundary: f.geofenceStatus === null ? null : f.geofenceStatus !== 'OUTSIDE',
  }));
}

export interface PhotoSlot {
  /** The unit (per-unit modes and per-unit questions); null for a whole-question slot. */
  unitId: string | null;
  label: string;
  required: boolean;
  captures: Array<{ clientCaptureId: string; status: PhotoStatus }>;
  /** Required slots: at least the minimum of photos that count, and no photo that does not. */
  satisfied: boolean;
  canAdd: boolean;
}

export interface PhotoFieldModel {
  path: string;
  /** PHOTO fields: their mode; other fields with a photo rule: AT_LEAST_N with one photo. */
  mode: PhotoMode;
  minCount: number;
  maxCount: number;
  geotagRequired: boolean;
  slots: PhotoSlot[];
  /** Every required slot is satisfied and no photo needs a retake. */
  satisfied: boolean;
}

/** Whether the answer triggers a rule (REQUIRE_PHOTO / REQUIRE_COMMENT / RAISE_FINDING). */
export function triggeredRules(field: VisitFormSnapshotField, answer: VisitFormAnswerInput | null): {
  requirePhoto: boolean;
  requireComment: boolean;
  findingSeverity: FormFindingSeverity | null;
  quantityAbovePlanned: boolean;
} {
  const value = answer?.value ?? null;
  const out = { requirePhoto: false, requireComment: false, findingSeverity: null as FormFindingSeverity | null, quantityAbovePlanned: false };
  if (isEmptyValue(value)) return out;
  const rank: Record<FormFindingSeverity, number> = { MINOR: 1, MAJOR: 2, CRITICAL: 3 };
  for (const rule of field.rules) {
    if (!conditionMet(rule.when, field, value)) continue;
    if (rule.then === 'REQUIRE_PHOTO') out.requirePhoto = true;
    if (rule.then === 'REQUIRE_COMMENT') out.requireComment = true;
    if (rule.then === 'RAISE_FINDING' && rule.severity && (!out.findingSeverity || rank[rule.severity] > rank[out.findingSeverity])) out.findingSeverity = rule.severity;
  }
  out.quantityAbovePlanned = field.boundedByPlannedQuantity && field.plannedQuantity !== null && typeof value === 'number' && value > field.plannedQuantity;
  return out;
}

function slotOf(
  unitId: string | null,
  label: string,
  required: boolean,
  minCount: number,
  maxCount: number,
  refs: VisitFormCaptureRef[] | Array<{ clientCaptureId: string; unitId?: string | null }>,
  facts: Map<string, PhoneCaptureFact>,
  geotagRequired: boolean
): PhotoSlot {
  const captures = refs.map((c) => ({ clientCaptureId: c.clientCaptureId, status: photoStatus(facts.get(c.clientCaptureId), geotagRequired) }));
  const ok = captures.filter((c) => c.status === 'OK').length;
  const bad = captures.some((c) => c.status !== 'OK');
  return {
    unitId,
    label,
    required,
    captures,
    satisfied: !bad && (!required || ok >= Math.max(1, minCount)),
    canAdd: captures.length < maxCount,
  };
}

/**
 * The photo slots of a question, or null when it takes no photos. PHOTO questions follow their mode:
 * ONE_PER_UNIT (one labelled, required slot per unit), PER_UNIT_OPTIONAL (labelled, optional),
 * AT_LEAST_N (one slot, `minCount` required, up to `maxCount`). Another question gets one slot when
 * its answer triggers a photo rule (re-checks answered "resolved", for example) or already has photos.
 */
export function photoFieldModel(
  field: VisitFormSnapshotField,
  answer: VisitFormAnswerInput | null,
  facts: Map<string, PhoneCaptureFact>
): PhotoFieldModel | null {
  const photos = (answer?.captures ?? []).filter((c) => c.kind === 'PHOTO');
  if (field.type === 'PHOTO' && field.photo) {
    const p = field.photo;
    let slots: PhotoSlot[];
    if (p.mode === 'AT_LEAST_N') {
      slots = [slotOf(null, 'Photos', p.minCount > 0, p.minCount, p.maxCount, photos, facts, p.geotagRequired)];
    } else {
      slots = p.slots.map((s) =>
        slotOf(s.unitId, s.label, p.mode === 'ONE_PER_UNIT', 1, p.maxCount, photos.filter((c) => c.unitId === s.unitId), facts, p.geotagRequired)
      );
    }
    return { path: field.path, mode: p.mode, minCount: p.minCount, maxCount: p.maxCount, geotagRequired: p.geotagRequired, slots, satisfied: slots.every((s) => s.satisfied) };
  }
  if (FORM_CAPTURE_TYPES.includes(field.type)) return null; // VOICE_NOTE
  const required = triggeredRules(field, answer).requirePhoto;
  if (!required && photos.length === 0) return null;
  const slot = slotOf(field.unitId, 'Photo', required, 1, 10, photos, facts, true);
  return { path: field.path, mode: 'AT_LEAST_N', minCount: required ? 1 : 0, maxCount: 10, geotagRequired: true, slots: [slot], satisfied: slot.satisfied };
}

/** The unit id a new photo for this slot carries (per-unit modes and per-unit questions). */
export function captureUnitForSlot(field: VisitFormSnapshotField, slot: PhotoSlot): string | null {
  if (field.type === 'PHOTO' && field.photo?.mode === 'AT_LEAST_N') return null;
  return slot.unitId ?? field.unitId ?? null;
}

// ---------------------------------------------------------------------------
// Issues
// ---------------------------------------------------------------------------

export interface FormIssue {
  /** The answer path, or `review` for the submission's own fields. */
  path: string;
  /** The screen to jump to (block key), or `review`. */
  screenKey: string;
  unitId: string | null;
  code: string;
  message: string;
  /** The question as shown. */
  label: string;
}

export interface DraftCheck {
  /** Errors and photo gaps: the phone blocks submit on both (photo gaps are not server errors). */
  issues: FormIssue[];
  byScreen: Map<string, FormIssue[]>;
  canSubmit: boolean;
  /** "This will raise 2 findings". */
  findingsToRaise: VisitFindingToRaise[];
  /** Re-check outcomes as answered. */
  recheckResults: Array<{ recheckId: string; resolved: boolean }>;
}

function gapMessage(code: string, unitLabel: string | null, field: VisitFormSnapshotField | undefined, factStatus: PhotoStatus | null): string {
  switch (code) {
    case 'PHOTO_MISSING':
      return `Take at least ${field?.photo?.minCount ?? 1} photo${(field?.photo?.minCount ?? 1) === 1 ? '' : 's'}`;
    case 'UNIT_PHOTO_MISSING':
      return unitLabel ? `Take a photo of ${unitLabel}` : 'Take a photo of each unit';
    case 'PHOTO_REQUIRED_BY_RULE':
      return 'This answer needs a photo';
    case 'AUDIO_MISSING':
      return 'Record a voice note';
    case 'PHOTO_NOT_GEOTAGGED':
      return factStatus === 'MOCKED' ? PHOTO_STATUS_TEXT.MOCKED : PHOTO_STATUS_TEXT.NO_LOCATION;
    case 'PHOTO_OUTSIDE_BOUNDARY':
      return PHOTO_STATUS_TEXT.OUTSIDE_BOUNDARY;
    default:
      return 'Check this answer';
  }
}

export const REVIEW_SCREEN_KEY = 'review';

/**
 * Checks a draft against its snapshot with the shared rules and the phone's capture facts, plus the
 * submission's own fields (overall finding, summary). Captures missing from the phone block too.
 */
export function checkDraft(snapshot: VisitFormSnapshot, draft: Pick<VisitDraft, 'answers' | 'overallFinding' | 'summaryText'>, facts: PhoneCaptureFact[]): DraftCheck {
  const answers = cleanAnswers(snapshot, draft.answers);
  const factMap = new Map(facts.map((f) => [f.clientCaptureId, f]));
  const result = validateVisitAnswers(snapshot, answers, toValidationFacts(facts));
  const refs = fieldsByPath(snapshot);
  const issues: FormIssue[] = [];
  const unitLabel = (path: string, unitId: string | null) => {
    const ref = refs.get(path);
    if (!ref || !unitId) return null;
    return ref.block.units.find((u) => u.id === unitId)?.label ?? ref.field.photo?.slots.find((s) => s.unitId === unitId)?.label ?? null;
  };
  for (const e of result.errors) {
    const ref = refs.get(e.path);
    issues.push({ path: e.path, screenKey: ref?.screenKey ?? REVIEW_SCREEN_KEY, unitId: ref?.field.unitId ?? null, code: e.code, message: e.message, label: ref?.field.label ?? e.path });
  }
  for (const g of result.photoGaps) {
    const ref = refs.get(g.path);
    const fact = g.clientCaptureId ? factMap.get(g.clientCaptureId) : undefined;
    const status = g.clientCaptureId ? photoStatus(fact, ref?.field.photo?.geotagRequired ?? true) : null;
    issues.push({
      path: g.path,
      screenKey: ref?.screenKey ?? REVIEW_SCREEN_KEY,
      unitId: g.unitId,
      code: g.code,
      message: gapMessage(g.code, unitLabel(g.path, g.unitId), ref?.field, status),
      label: ref?.field.label ?? g.path,
    });
  }
  // Captures the phone no longer has (deleted files or records) cannot be sent.
  for (const a of answers) {
    for (const c of a.captures ?? []) {
      if (factMap.has(c.clientCaptureId)) continue;
      const ref = refs.get(a.path);
      issues.push({ path: a.path, screenKey: ref?.screenKey ?? REVIEW_SCREEN_KEY, unitId: c.unitId ?? null, code: 'CAPTURE_MISSING', message: PHOTO_STATUS_TEXT.MISSING, label: ref?.field.label ?? a.path });
    }
  }
  if (!draft.overallFinding || !VisitOverallFindingEnum.safeParse(draft.overallFinding).success) {
    issues.push({ path: REVIEW_SCREEN_KEY, screenKey: REVIEW_SCREEN_KEY, unitId: null, code: 'OVERALL_FINDING_REQUIRED', message: 'Pick the overall finding', label: 'Overall finding' });
  }
  if (draft.summaryText.trim().length < 3) {
    issues.push({ path: REVIEW_SCREEN_KEY, screenKey: REVIEW_SCREEN_KEY, unitId: null, code: 'SUMMARY_REQUIRED', message: 'Write a short summary (at least 3 characters)', label: 'Summary' });
  }
  const byScreen = new Map<string, FormIssue[]>();
  for (const i of issues) byScreen.set(i.screenKey, [...(byScreen.get(i.screenKey) ?? []), i]);
  return { issues, byScreen, canSubmit: issues.length === 0, findingsToRaise: result.findingsToRaise, recheckResults: result.recheckResults };
}

/** Screens answered so far, for the progress bar: a screen counts when it has no blocking issue. */
export function formProgress(snapshot: VisitFormSnapshot, check: DraftCheck): { done: number; total: number } {
  const screens = formScreens(snapshot);
  return { done: screens.filter((s) => !check.byScreen.has(s.key)).length, total: screens.length };
}

/**
 * An OVERALL_FINDING question answered with a key equal to a submission value (SATISFACTORY,
 * MINOR_ISSUES, MAJOR_ISSUES) pre-fills the review's overall finding.
 */
export function suggestedOverallFinding(snapshot: VisitFormSnapshot, answers: VisitFormAnswerInput[]): VisitOverallFinding | null {
  const key = validateVisitAnswers(snapshot, cleanAnswers(snapshot, answers)).signals.overallFinding;
  const parsed = key ? VisitOverallFindingEnum.safeParse(key.toUpperCase()) : null;
  return parsed?.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// Draft → submission (ids only; finalised at send time)
// ---------------------------------------------------------------------------

/** What the outbox stores for a queued submission (`visit_drafts.request_json`). */
export interface QueuedVisitSubmission {
  /** Local visit key. */
  visitId: string;
  /** The request without what only the server can give: the snapshot id of a phone-built Ad hoc form, site log server ids. */
  body: Omit<SubmitVisitRequestInput, 'formSnapshotId' | 'siteLogEntryIds'> & { formSnapshotId: string | null };
  siteLogClientEntryIds: string[];
}

/**
 * The submission as queued: cleaned answers, the overall finding and summary, the check-in riding
 * along (the server records it only when the visit has none), the device position at submit and the
 * time the officer tapped Submit. Throws when the draft cannot be submitted.
 */
export function buildQueuedSubmission(
  snapshot: VisitFormSnapshot,
  draft: VisitDraft,
  opts: { confirmedAt: string; checkIn: VisitCheckInRequestInput | null; submissionGeotag: SubmissionGeotagInput | null }
): QueuedVisitSubmission {
  if (!draft.overallFinding) throw new Error('Pick the overall finding.');
  if (draft.summaryText.trim().length < 3) throw new Error('Write a short summary.');
  return {
    visitId: draft.visitId,
    body: {
      clientSubmissionId: draft.id,
      formSnapshotId: draft.formSnapshotId,
      formHash: draft.formHash,
      answers: cleanAnswers(snapshot, draft.answers),
      overallFinding: draft.overallFinding,
      summaryText: draft.summaryText.trim(),
      checkIn: opts.checkIn,
      submissionGeotag: opts.submissionGeotag,
      confirmedAt: opts.confirmedAt,
    },
    siteLogClientEntryIds: [...new Set(draft.siteLogEntryIds)],
  };
}

export type FinalisedSubmission =
  | { ok: true; body: SubmitVisitRequestInput }
  | { ok: false; code: 'VISIT_NOT_CREATED' | 'SITE_LOG_NOT_REGISTERED'; message: string };

/** Fills in the server snapshot id and site log server ids at send time. */
export function finaliseSubmissionBody(
  queued: QueuedVisitSubmission,
  known: { visitFormSnapshotId: string | null; siteLogServerIdByClientId: Map<string, string | null> }
): FinalisedSubmission {
  const formSnapshotId = queued.body.formSnapshotId ?? known.visitFormSnapshotId;
  if (!formSnapshotId) return { ok: false, code: 'VISIT_NOT_CREATED', message: 'The unscheduled visit has not reached the server yet.' };
  const siteLogEntryIds: string[] = [];
  for (const id of queued.siteLogClientEntryIds) {
    const serverId = known.siteLogServerIdByClientId.get(id);
    if (!serverId) return { ok: false, code: 'SITE_LOG_NOT_REGISTERED', message: 'A site log entry is still being sent.' };
    siteLogEntryIds.push(serverId);
  }
  return { ok: true, body: { ...queued.body, formSnapshotId, siteLogEntryIds } };
}

// ---------------------------------------------------------------------------
// D-R5.19: rebuilt forms
// ---------------------------------------------------------------------------

/**
 * SAME: identical form. RECHECKS_ONLY: only the re-check items changed (R4 accepts a submission on
 * the older snapshot, so the draft stays on it). REBUILT: the form itself changed; re-map the draft.
 */
export function formChangeKind(previous: VisitFormSnapshot, next: VisitFormSnapshot): 'SAME' | 'RECHECKS_ONLY' | 'REBUILT' {
  if (canonicalVisitFormSnapshot(previous) === canonicalVisitFormSnapshot(next)) return 'SAME';
  return sameFormApartFromRechecks(previous, next) ? 'RECHECKS_ONLY' : 'REBUILT';
}

export interface DroppedAnswer {
  path: string;
  label: string;
  reason: string;
}

/**
 * Moves answers onto another snapshot by path (paths are stable for the same question and unit).
 * Drops answers whose question is gone, option keys no longer offered, a value the question no longer
 * takes, and photos of units no longer on the question; lists every drop with the old label.
 */
export function remapAnswers(
  previous: VisitFormSnapshot | null,
  next: VisitFormSnapshot,
  answers: VisitFormAnswerInput[]
): { answers: VisitFormAnswerInput[]; dropped: DroppedAnswer[] } {
  const oldRefs = previous ? fieldsByPath(previous) : new Map<string, FieldRef>();
  const newRefs = fieldsByPath(next);
  const out: VisitFormAnswerInput[] = [];
  const dropped: DroppedAnswer[] = [];
  const labelOf = (path: string) => newRefs.get(path)?.field.label ?? oldRefs.get(path)?.field.label ?? path;
  for (const a of answers) {
    const ref = newRefs.get(a.path);
    if (!ref) {
      if (!isEmptyValue(a.value ?? null) || (a.comment ?? '').trim() || (a.captures ?? []).length) {
        dropped.push({ path: a.path, label: labelOf(a.path), reason: 'The question is no longer on the form' });
      }
      continue;
    }
    const f = ref.field;
    let value = a.value ?? null;
    if (FORM_CAPTURE_TYPES.includes(f.type)) value = null;
    else if (f.type === 'SINGLE_CHOICE' && typeof value === 'string' && !f.options.some((o) => o.key === value)) {
      dropped.push({ path: a.path, label: f.label, reason: 'The option chosen is no longer offered' });
      value = null;
    } else if (f.type === 'MULTI_CHOICE' && Array.isArray(value)) {
      const keep = value.filter((k) => f.options.some((o) => o.key === k));
      if (keep.length !== value.length) dropped.push({ path: a.path, label: f.label, reason: 'Some options chosen are no longer offered' });
      value = keep;
    } else if (f.type === 'YES_NO' && value === 'NA' && !f.allowNa) {
      dropped.push({ path: a.path, label: f.label, reason: '"N/A" is no longer an answer' });
      value = null;
    }
    let captures = a.captures ?? [];
    if (f.type === 'PHOTO' && f.photo && f.photo.mode !== 'AT_LEAST_N') {
      const units = new Set(f.photo.slots.map((s) => s.unitId));
      const keep = captures.filter((c) => c.kind !== 'PHOTO' || (c.unitId && units.has(c.unitId)));
      if (keep.length !== captures.length) dropped.push({ path: a.path, label: f.label, reason: 'Photos of units no longer on the form were taken off' });
      captures = keep;
    }
    out.push({ path: a.path, value, comment: a.comment ?? null, captures });
  }
  return { answers: out, dropped };
}

/** The draft moved onto a rebuilt form (D-R5.19); `remap` records what was dropped for the notice. */
export function remapDraftOntoSnapshot(
  draft: VisitDraft,
  previous: VisitFormSnapshot | null,
  next: { snapshot: VisitFormSnapshot; formSnapshotId: string | null; formHash: string },
  now: string
): { draft: VisitDraft; dropped: DroppedAnswer[] } {
  const { answers, dropped } = remapAnswers(previous, next.snapshot, draft.answers);
  return {
    draft: {
      ...draft,
      answers,
      formSnapshotId: next.formSnapshotId,
      formHash: next.formHash,
      updatedAt: now,
      remap: { at: now, fromFormHash: draft.formHash, dropped },
    },
    dropped,
  };
}

/**
 * Returned for correction: the server's answers as a new draft's answers. Captures already linked to
 * the returned submission cannot be linked again (R4 refuses a capture linked to another report), so
 * photos and voice notes are left out and listed: the officer takes them again.
 */
export function answersFromReturnedSubmission(
  next: VisitFormSnapshot,
  serverAnswers: VisitAnswerDto[]
): { answers: VisitFormAnswerInput[]; dropped: DroppedAnswer[] } {
  const asInputs: VisitFormAnswerInput[] = serverAnswers.map((a) => ({ path: a.path, value: a.value, comment: a.comment, captures: [] }));
  const { answers, dropped } = remapAnswers(null, next, asInputs);
  const refs = fieldsByPath(next);
  for (const a of serverAnswers) {
    if (a.captures.length && refs.has(a.path)) {
      dropped.push({ path: a.path, label: refs.get(a.path)!.field.label, reason: 'Photos and voice notes must be taken again for the corrected report' });
    }
  }
  return { answers, dropped };
}

// ---------------------------------------------------------------------------
// Offline Ad hoc (D-R5.12)
// ---------------------------------------------------------------------------

/** SHA-256 of the canonical snapshot, as the server's `hashVisitFormSnapshot` computes it. */
export function hashVisitFormSnapshot(snapshot: VisitFormSnapshot): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalVisitFormSnapshot(snapshot))));
}

/** Facilities an officer can pick for an Ad hoc visit: those with units on the project. */
export function adHocFacilityChoices(pack: VisitFieldPackDto): Array<{ facilityId: string; code: string; name: string; unitCount: number }> {
  return [...pack.bundle.facilities]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code))
    .map((f) => ({ facilityId: f.id, code: f.code, name: f.name, unitCount: pack.bundle.units.filter((u) => u.facilityId === f.id).length }))
    .filter((f) => f.unitCount > 0);
}

/** Whether the project's field pack can build an Ad hoc form at all. */
export function adHocAvailable(pack: VisitFieldPackDto | null): boolean {
  return Boolean(pack?.bundle.templates.some((t) => t.visitKind === 'AD_HOC'));
}

export interface AdHocForm {
  snapshot: VisitFormSnapshot;
  formHash: string;
  warnings: VisitFormAssemblyWarning[];
  /** The component versions the form was built from (the server re-assembles from these). */
  components: { templateId: string; sectionIds: string[]; subFormIds: string[] };
  recheckIds: string[];
}

/**
 * Builds an Ad hoc form from the field pack exactly as the server will (`assemblyInputFromBundle` +
 * `assembleVisitForm`). Re-checks: by default the open findings of the picked facilities plus those
 * not tied to a facility (`recheckScope: 'ALL'` takes every open finding). Throws the shared
 * `VisitFormAssemblyError` (e.g. NO_VISIT_FORM_TEMPLATE) when the form cannot be built.
 */
export function buildAdHocForm(
  pack: VisitFieldPackDto,
  opts: { visitDate: string; builtAt: string; pickedFacilityIds: string[]; recheckScope?: 'PICKED_FACILITIES' | 'ALL' }
): AdHocForm {
  const picked = new Set(opts.pickedFacilityIds);
  const rechecks: RecheckInput[] =
    opts.recheckScope === 'ALL' ? pack.rechecks : pack.rechecks.filter((r) => r.facilityId === null || picked.has(r.facilityId));
  const { snapshot, warnings } = assembleVisitForm(
    assemblyInputFromBundle(pack.bundle, {
      visitKind: 'AD_HOC',
      visitDate: opts.visitDate,
      builtAt: opts.builtAt,
      pickedFacilityIds: opts.pickedFacilityIds,
      rechecks,
    })
  );
  return {
    snapshot,
    formHash: hashVisitFormSnapshot(snapshot),
    warnings,
    components: {
      templateId: snapshot.sources.template.id,
      sectionIds: snapshot.sources.sections.map((s) => s.id),
      subFormIds: [...new Set(snapshot.sources.subForms.map((s) => s.id))],
    },
    recheckIds: rechecks.map((r) => r.id),
  };
}
