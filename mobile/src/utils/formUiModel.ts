/**
 * Redesign R5c: what the form filler, the check-in sheet and the review screen show (pure; tested in
 * Node). Validation stays in `visitForm.ts` (`checkDraft`, `triggeredRules`, `photoFieldModel`);
 * this module only turns its results into wording and screen state, so the components hold no rules.
 */
import {
  addDays,
  isIsoCalendarDate,
  zonedCalendarDate,
  type FormFindingSeverity,
  type GeofenceStatus,
  type VisitFindingToRaise,
  type VisitFormAnswerInput,
  type VisitFormSnapshotBlock,
  type VisitFormSnapshotField,
} from '@insite/shared';
import { projectToday } from './visitCalendar';
import { REVIEW_SCREEN_KEY, triggeredRules, type DraftCheck, type FormIssue, type FormScreen, type PhotoFieldModel, type PhotoSlot } from './visitForm';
import type { StoredVisit, StoredVisitDraft } from './visitModel';
import type { SiteLogRecord } from './siteLog';

export const SEVERITY_LABELS: Record<FormFindingSeverity, string> = {
  MINOR: 'Minor',
  MAJOR: 'Major',
  CRITICAL: 'Critical',
};

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type NumberParse = { state: 'EMPTY' } | { state: 'OK'; value: number } | { state: 'INVALID' };

/** A typed number ("12", "-3", "4,5", "4.5"); a decimal comma is accepted. */
export function parseNumberText(text: string): NumberParse {
  const t = text.trim().replace(',', '.');
  if (t === '') return { state: 'EMPTY' };
  if (!/^-?\d+(\.\d+)?$/.test(t)) return { state: 'INVALID' };
  const value = Number(t);
  return Number.isFinite(value) ? { state: 'OK', value } : { state: 'INVALID' };
}

/** The text an input shows for a stored number (no trailing ".0"). */
export function numberToText(value: VisitFormAnswerInput['value']): string {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

/** A date typed as YYYY-MM-DD or DD/MM/YYYY, as YYYY-MM-DD; null when it is not a real date. */
export function parseDateText(text: string): string | null {
  const t = text.trim();
  if (isIsoCalendarDate(t)) return t;
  const m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t);
  if (!m) return null;
  const iso = `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return isIsoCalendarDate(iso) ? iso : null;
}

export function shiftDate(date: string, days: number): string {
  return addDays(date, days);
}

function formatQuantity(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/** The unit of measure of a field's planned quantity (its unit's, else the block's common one). */
function quantityUnitOf(field: VisitFormSnapshotField, block: VisitFormSnapshotBlock): string | null {
  if (field.unitId) return block.units.find((u) => u.id === field.unitId)?.quantityUnit ?? null;
  const uoms = [...new Set(block.units.map((u) => u.quantityUnit).filter((u): u is string => Boolean(u)))];
  return uoms.length === 1 ? uoms[0] : null;
}

/** Supply questions: "of 120 nr". Null when the question is not bounded by a planned quantity. */
export function plannedQuantityText(field: VisitFormSnapshotField, block: VisitFormSnapshotBlock): string | null {
  if (!field.boundedByPlannedQuantity || field.plannedQuantity === null) return null;
  const uom = quantityUnitOf(field, block);
  return `of ${formatQuantity(field.plannedQuantity)}${uom ? ` ${uom}` : ''}`;
}

/** The hint under a number input: its unit and range. */
export function numberRangeText(field: VisitFormSnapshotField): string | null {
  if (field.type === 'PERCENTAGE') return 'From 0 to 100';
  if (field.min !== null && field.max !== null) return `From ${field.min} to ${field.max}`;
  if (field.min !== null) return `At least ${field.min}`;
  if (field.max !== null) return `At most ${field.max}`;
  return null;
}

// ---------------------------------------------------------------------------
// Inline rules
// ---------------------------------------------------------------------------

export interface FieldRuleNotes {
  /** The answer makes a photo necessary (the photo slot appears). */
  photoNeeded: boolean;
  /** The answer makes a comment necessary (the comment box is shown and marked needed). */
  commentNeeded: boolean;
  /** The comment box's label. */
  commentLabel: string;
  /** "This answer will raise a finding (Major)". */
  findingNote: string | null;
}

export function fieldRuleNotes(field: VisitFormSnapshotField, answer: VisitFormAnswerInput | null): FieldRuleNotes {
  const t = triggeredRules(field, answer);
  const commentNeeded = t.requireComment || t.quantityAbovePlanned;
  let commentLabel = 'Comment (optional)';
  if (t.requireComment && field.recheck) commentLabel = 'Why is it not resolved? (needed)';
  else if (t.requireComment) commentLabel = 'Comment (needed for this answer)';
  else if (t.quantityAbovePlanned) commentLabel = `More than the planned ${formatQuantity(field.plannedQuantity ?? 0)}: say why (needed)`;
  return {
    photoNeeded: t.requirePhoto,
    commentNeeded,
    commentLabel,
    findingNote: t.findingSeverity ? `This answer will raise a finding (${SEVERITY_LABELS[t.findingSeverity]})` : null,
  };
}

/** Whether the comment box is open: needed, already written, or opened by the officer. */
export function commentVisible(notes: FieldRuleNotes, answer: VisitFormAnswerInput | null, openedByOfficer: boolean): boolean {
  return notes.commentNeeded || (answer?.comment ?? '').length > 0 || openedByOfficer;
}

/** Re-check items: "Major · raised 2026-11-10". */
export function recheckMetaText(field: VisitFormSnapshotField): string | null {
  const r = field.recheck;
  if (!r) return null;
  const kind = r.kind === 'DEFECT' ? 'Defect' : 'Finding';
  return [kind, r.severity ? SEVERITY_LABELS[r.severity] : null, `raised ${r.raisedDate}`].filter(Boolean).join(' · ');
}

/** The issues of one question (all units), or of one photo slot when `unitId` is given. */
export function issuesFor(issues: FormIssue[] | undefined, path: string, unitId?: string | null): FormIssue[] {
  return (issues ?? []).filter((i) => i.path === path && (unitId === undefined || i.unitId === unitId));
}

// ---------------------------------------------------------------------------
// Photo slots (D-R5.14)
// ---------------------------------------------------------------------------

export type SlotTone = 'DONE' | 'NEEDED' | 'RETAKE' | 'OPTIONAL';

export interface SlotText {
  title: string;
  /** Always text (state is never shown by colour only). */
  status: string;
  tone: SlotTone;
}

export function photoSlotText(slot: PhotoSlot, model: Pick<PhotoFieldModel, 'mode' | 'minCount' | 'maxCount'>): SlotText {
  const title = slot.required ? slot.label : `${slot.label} (optional)`;
  const n = slot.captures.length;
  const counted = `${n} photo${n === 1 ? '' : 's'}`;
  if (slot.captures.some((c) => c.status !== 'OK')) return { title, status: `${counted}: one needs a retake`, tone: 'RETAKE' };
  if (slot.required && !slot.satisfied) {
    const min = model.mode === 'AT_LEAST_N' ? Math.max(1, model.minCount) : 1;
    return { title, status: n === 0 ? `Needed: take ${min === 1 ? 'a photo' : `at least ${min} photos`}` : `${counted} of at least ${min}`, tone: 'NEEDED' };
  }
  if (n === 0) return { title, status: 'No photo yet', tone: 'OPTIONAL' };
  return { title, status: slot.required ? `${counted}: done` : counted, tone: slot.required ? 'DONE' : 'OPTIONAL' };
}

/** How many more photos a slot takes. */
export function photosLeft(slot: PhotoSlot, model: Pick<PhotoFieldModel, 'maxCount'>): number {
  return Math.max(0, model.maxCount - slot.captures.length);
}

// ---------------------------------------------------------------------------
// Check-in (D-R5.18)
// ---------------------------------------------------------------------------

export type CheckInState = 'NO_FIX' | 'MOCKED' | 'NO_BOUNDARY' | 'INSIDE' | 'WITHIN_TOLERANCE' | 'OUTSIDE';

export interface CheckInViewInput {
  fix: { accuracyMeters: number | null; isMocked: boolean } | null;
  preview: { status: GeofenceStatus | null; distanceOutsideMeters: number | null; distanceFromSiteMeters: number | null } | null;
  /** The project's boundary is on the phone (the baseline pack has a geofence). */
  hasBoundary: boolean;
  locationPermissionGranted: boolean;
}

export interface CheckInView {
  state: CheckInState;
  title: string;
  /** "About 120 m from the site", "85 m outside the boundary". */
  distance: string | null;
  accuracy: string | null;
  note: string;
}

export const CHECK_IN_ALWAYS_ALLOWED_TEXT =
  'You can check in wherever you are. A check-in outside the site boundary, without a location or with a simulated location is recorded and flagged by the server.';

function metres(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(1)} km` : `${Math.round(n)} m`;
}

export function checkInView(input: CheckInViewInput): CheckInView {
  const accuracy = input.fix?.accuracyMeters != null ? `Accuracy about ${Math.round(input.fix.accuracyMeters)} m${input.fix.accuracyMeters > 50 ? ' (weak signal)' : ''}` : null;
  const fromSite = input.preview?.distanceFromSiteMeters != null ? `About ${metres(input.preview.distanceFromSiteMeters)} from the site` : null;
  if (!input.fix) {
    return {
      state: 'NO_FIX',
      title: 'No location',
      distance: null,
      accuracy: null,
      note: input.locationPermissionGranted
        ? 'The phone could not get a position. Move into the open and try again, or check in without a location.'
        : 'Location access is off for this app. Turn it on in the phone settings, or check in without a location.',
    };
  }
  if (input.fix.isMocked) {
    return { state: 'MOCKED', title: 'Simulated location', distance: fromSite, accuracy, note: 'The phone reports a simulated location. Turn off any location app and try again.' };
  }
  const status = input.preview?.status ?? null;
  if (!input.hasBoundary || !status) {
    return { state: 'NO_BOUNDARY', title: 'Position taken', distance: null, accuracy, note: 'The site boundary is not on this phone, so the position cannot be checked here. The server checks it.' };
  }
  if (status === 'INSIDE') return { state: 'INSIDE', title: 'On site', distance: fromSite, accuracy, note: 'You are inside the site boundary.' };
  if (status === 'WITHIN_TOLERANCE') {
    return { state: 'WITHIN_TOLERANCE', title: 'Just outside the boundary', distance: fromSite, accuracy, note: 'You are within the tolerance band around the site. This counts as on site.' };
  }
  const outside = input.preview?.distanceOutsideMeters != null ? `${metres(input.preview.distanceOutsideMeters)} outside the boundary` : fromSite;
  return { state: 'OUTSIDE', title: 'Outside the site boundary', distance: outside, accuracy, note: 'Move onto the site and try again if you can.' };
}

// ---------------------------------------------------------------------------
// Access to the form (D-R5.18 – D-R5.20)
// ---------------------------------------------------------------------------

export type FormAccess =
  | { mode: 'EDIT'; draft: StoredVisitDraft }
  | { mode: 'READ_ONLY'; draft: StoredVisitDraft; title: string; message: string; canCopy: boolean }
  | { mode: 'START'; correction: boolean }
  | { mode: 'BLOCKED'; title: string; message: string };

export const WAITING_TO_SEND_TEXT = 'Saved on this phone. It sends with its photos when you are online and can no longer change.';

/**
 * What the form screen does for a visit: edit the open draft, show a queued, refused or sent report
 * read-only, start a new draft, or explain why it cannot. Starting needs a check-in on this phone
 * (D-R5.18); a visit returned for correction starts a correction draft.
 */
export function formAccess(
  v: Pick<StoredVisit, 'visit' | 'local'>,
  drafts: { open: StoredVisitDraft | null; latest: StoredVisitDraft | null },
  canSubmit: boolean
): FormAccess {
  const { open, latest } = drafts;
  if (open?.status === 'DRAFT') return { mode: 'EDIT', draft: open };
  if (open?.status === 'QUEUED') {
    return { mode: 'READ_ONLY', draft: open, title: 'Waiting to send', message: open.lastError ? `${WAITING_TO_SEND_TEXT} Last attempt: ${open.lastError}` : WAITING_TO_SEND_TEXT, canCopy: false };
  }
  const returned = v.visit.status === 'RETURNED';
  if (latest?.status === 'REFUSED' && !returned) {
    return { mode: 'READ_ONLY', draft: latest, title: 'Not accepted', message: latest.lastError ?? 'The server did not accept this report.', canCopy: canSubmit && !v.local.createError };
  }
  if (latest?.status === 'SENT' && !returned) {
    return { mode: 'READ_ONLY', draft: latest, title: 'Sent', message: 'The server has this report.', canCopy: false };
  }
  if (!canSubmit) return { mode: 'BLOCKED', title: 'Not available', message: 'Your role on this project does not submit visit reports.' };
  if (v.local.createError) return { mode: 'BLOCKED', title: 'Visit not created', message: v.local.createError };
  if (returned) return { mode: 'START', correction: true };
  if (!['PLANNED', 'IN_PROGRESS', 'MISSED'].includes(v.visit.status)) {
    return { mode: 'BLOCKED', title: 'Closed', message: 'This visit can no longer be reported on from the phone.' };
  }
  if (!v.local.checkIn) {
    return { mode: 'BLOCKED', title: 'Check in first', message: 'Check in on this phone before you start the form. The form is fixed from then on.' };
  }
  return { mode: 'START', correction: false };
}

/** Where the filler opens: the first section with something to fix, else the first. */
export function firstScreenWithIssues(screens: Pick<FormScreen, 'key'>[], check: Pick<DraftCheck, 'byScreen'>): number {
  const i = screens.findIndex((s) => check.byScreen.has(s.key));
  return i >= 0 ? i : 0;
}

export function progressText(done: number, total: number): string {
  return `${done} of ${total} section${total === 1 ? '' : 's'} complete`;
}

/** "2 to fix" / "Complete" for the section list. */
export function screenStatusText(check: Pick<DraftCheck, 'byScreen'>, key: string): string {
  const n = check.byScreen.get(key)?.length ?? 0;
  return n === 0 ? 'Complete' : `${n} to fix`;
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export interface IssueGroup {
  screenKey: string;
  /** The section's index; null for the review's own fields. */
  screenIndex: number | null;
  title: string;
  issues: FormIssue[];
}

/** Issues grouped per section in form order, the review's own fields last. */
export function reviewIssueGroups(screens: Pick<FormScreen, 'key' | 'title'>[], check: Pick<DraftCheck, 'byScreen'>): IssueGroup[] {
  const out: IssueGroup[] = [];
  screens.forEach((s, i) => {
    const issues = check.byScreen.get(s.key);
    if (issues?.length) out.push({ screenKey: s.key, screenIndex: i, title: s.title, issues });
  });
  const own = check.byScreen.get(REVIEW_SCREEN_KEY);
  if (own?.length) out.push({ screenKey: REVIEW_SCREEN_KEY, screenIndex: null, title: 'Report summary', issues: own });
  return out;
}

export function findingsCountText(n: number): string {
  return n === 0 ? 'No findings will be raised.' : `This will raise ${n} finding${n === 1 ? '' : 's'}.`;
}

export function findingLine(f: Pick<VisitFindingToRaise, 'severity' | 'label' | 'answerText'>): string {
  return `${SEVERITY_LABELS[f.severity]}: ${f.label} (answer: ${f.answerText})`;
}

// ---------------------------------------------------------------------------
// Site log (D-R5.22)
// ---------------------------------------------------------------------------

/** The visit day for "Pick from site log": the day of this phone's check-in, else today (project zone). */
export function visitDayFor(v: Pick<StoredVisit, 'local'>, timeZone: string | null | undefined, now: Date = new Date()): string {
  return v.local.checkIn ? zonedCalendarDate(v.local.checkIn.checkedInAt, timeZone || 'UTC') : projectToday(timeZone, now);
}

export const PICK_FROM_SITE_LOG_EXPLANATION =
  'Only photos taken today for this project that have not been sent to the site log yet can be used here. A picked photo leaves the site log and becomes part of this report. Photos already sent stay in the site log: attach their entries to the report on the review page instead.';

/** Photos of the visit day already sent (or being sent) to the site log, which cannot be picked. */
export function sentPhotosOfDay(dayEntries: SiteLogRecord[], pickable: SiteLogRecord[]): number {
  const ids = new Set(pickable.map((e) => e.id));
  return dayEntries.filter((e) => e.kind === 'PHOTO' && !ids.has(e.id)).length;
}

/** "14:05" in the project zone (UTC when the zone is unknown or unsupported). */
export function timeInZone(iso: string, timeZone: string | null | undefined): string {
  try {
    return new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: timeZone || 'UTC' }).format(new Date(iso));
  } catch {
    return `${iso.slice(11, 16)} UTC`;
  }
}

const KIND_LABELS: Record<SiteLogRecord['kind'], string> = { PHOTO: 'Photo', VOICE: 'Voice note', NOTE: 'Note' };

export function siteLogEntryLabel(e: Pick<SiteLogRecord, 'kind' | 'status' | 'text'>): { kind: string; status: string; text: string | null } {
  return {
    kind: KIND_LABELS[e.kind],
    status: e.status === 'SENT' ? 'Sent' : e.status === 'MOVED_TO_FORM' ? 'Used in a report' : 'Waiting to send',
    text: e.text,
  };
}

// ---------------------------------------------------------------------------
// Saving the draft on every change
// ---------------------------------------------------------------------------

export interface DraftSaver<T> {
  /** Queues a save of `value`; saves run one at a time and only the latest waiting value is written. */
  push(value: T): void;
  /** Resolves once every pushed value is written (rejects with the last error, if any). */
  flush(): Promise<void>;
}

/** Serial, coalescing saves: typing writes at most one save behind the one running. */
export function createDraftSaver<T>(save: (value: T) => Promise<void>, onError?: (err: unknown) => void): DraftSaver<T> {
  let pending: { value: T } | null = null;
  let running: Promise<void> | null = null;
  let lastError: unknown = null;
  const run = async () => {
    while (pending) {
      const { value } = pending;
      pending = null;
      try {
        await save(value);
        lastError = null;
      } catch (err) {
        lastError = err;
        onError?.(err);
      }
    }
    running = null;
  };
  return {
    push(value: T) {
      pending = { value };
      if (!running) running = run();
    },
    async flush() {
      while (running) await running;
      if (lastError) throw lastError;
    },
  };
}
