/**
 * Needs pipeline wave 5 (N8): field verification of a proposed project on the phone (pure; tested in
 * Node). A verification is not a project: it has no project id and no field session, only an
 * assignment. The frozen form uses the visit form block shape, so the visit form helpers
 * (`formScreens`, `photoFieldModel`, `cleanAnswers`, ...) run on it through `verificationSnapshot`;
 * the answer check is the shared `validateNeedsVerificationAnswers` (errors, one location per site,
 * photo gaps: the phone blocks submit on all three).
 *
 * - local model: stored verification, draft, cached form, outbox scope;
 * - Home: what a verification shows (label, dot, overdue, returned, badges);
 * - sites: location text (distance from the stored point, accuracy), recording a location;
 * - draft check and draft → submission request (ids only);
 * - which form the phone opens (start, correction after a return, read-only, refused copy);
 * - sync: which forms to download, which rows a feed removes, hashing a form like the server.
 */
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import {
  canonicalNeedsVerificationForm,
  distanceMeters,
  NEEDS_VERIFICATION_COORDINATE_TOLERANCE_METERS,
  NEEDS_VERIFICATION_MAX_ACCURACY_METERS,
  NEEDS_VERIFICATION_OPEN_STATUSES,
  NEEDS_VERIFICATION_PURPOSE_LABELS,
  validateNeedsVerificationAnswers,
  VISIT_FORM_SNAPSHOT_SCHEMA_VERSION,
  type NeedsVerificationDto,
  type NeedsVerificationForm,
  type NeedsVerificationFormSite,
  type NeedsVerificationSiteLocation,
  type NeedsVerificationStatus,
  type NeedsVerificationSubmissionDto,
  type SubmitNeedsVerificationRequestInput,
  type VisitFormAnswerInput,
  type VisitFormSnapshot,
} from '@insite/shared';
import type { VisitDot } from './visitCalendar';
import type { StatusBadge } from './visitText';
import { formatDay } from './visitText';
import {
  cleanAnswers,
  fieldsByPath,
  photoGapMessage,
  photoStatus,
  PHOTO_STATUS_TEXT,
  remapAnswers,
  REVIEW_SCREEN_KEY,
  toValidationFacts,
  type DraftCheck,
  type DroppedAnswer,
  type FormIssue,
  type PhoneCaptureFact,
} from './visitForm';

// ---------------------------------------------------------------------------
// Local model
// ---------------------------------------------------------------------------

/** Outbox rows and captures of a verification carry this scope where other rows carry a project id. */
export const VERIFICATION_SCOPE_PREFIX = 'needs-verification:';
export const verificationScope = (verificationId: string) => `${VERIFICATION_SCOPE_PREFIX}${verificationId}`;
/** The verification id of a scope, or null for a project id. */
export function verificationIdOfScope(scope: string | null | undefined): string | null {
  return scope && scope.startsWith(VERIFICATION_SCOPE_PREFIX) ? scope.slice(VERIFICATION_SCOPE_PREFIX.length) : null;
}

/** Unsent work and phone-side facts layered over the server copy of a verification. */
export interface VerificationLocalState {
  /** The draft id (clientSubmissionId) of a submission queued on this phone and not yet accepted. */
  queuedDraftId: string | null;
  /** Set when a sync no longer returned this verification while an unsent draft kept it. */
  removedFromFeedAt: string | null;
}

export const EMPTY_VERIFICATION_LOCAL_STATE: VerificationLocalState = { queuedDraftId: null, removedFromFeedAt: null };

export function parseVerificationLocalState(json: string | null | undefined): VerificationLocalState {
  if (!json) return { ...EMPTY_VERIFICATION_LOCAL_STATE };
  try {
    return { ...EMPTY_VERIFICATION_LOCAL_STATE, ...(JSON.parse(json) as Partial<VerificationLocalState>) };
  } catch {
    return { ...EMPTY_VERIFICATION_LOCAL_STATE };
  }
}

/** One verification as the phone keeps it (a row of `needs_verifications`). */
export interface StoredNeedsVerification {
  /** The server verification id. */
  id: string;
  /** The feed item as received (the phone's optimistic status after a send, until the next sync). */
  dto: NeedsVerificationDto;
  local: VerificationLocalState;
  syncedAt: string | null;
}

/** The draft of a verification submission (`needs_verification_drafts.draft_json`). Ids only. */
export interface NeedsVerificationDraft {
  /** = clientSubmissionId. */
  id: string;
  verificationId: string;
  formHash: string;
  /** Answers keyed by path (`n:site:<n>/<key>`, `n:row:<rowId>/<key>`). */
  answers: VisitFormAnswerInput[];
  /** Where the officer stood at each site (one per site number). */
  siteLocations: NeedsVerificationSiteLocation[];
  notes: string;
  /** Returned: the server submission this draft corrects. */
  correctsSubmissionId: string | null;
  startedAt: string;
  updatedAt: string;
  /** Set when answers were moved onto another form (a correction or a copy of a refused draft). */
  remap: { at: string; fromFormHash: string; dropped: DroppedAnswer[] } | null;
}

export type NeedsVerificationDraftStatus = 'DRAFT' | 'QUEUED' | 'SENT' | 'REFUSED';

export interface StoredNeedsVerificationDraft {
  draft: NeedsVerificationDraft;
  status: NeedsVerificationDraftStatus;
  serverId: string | null;
  lastError: string | null;
  updatedAt: string;
}

/** A frozen form as kept on the phone. */
export interface CachedNeedsVerificationForm {
  verificationId: string;
  formHash: string;
  form: NeedsVerificationForm;
}

/** SHA-256 of the canonical form (without `builtAt`), as the server computes `formHash`. */
export function hashNeedsVerificationForm(form: NeedsVerificationForm): string {
  return bytesToHex(sha256(utf8ToBytes(canonicalNeedsVerificationForm(form))));
}

/**
 * The form wrapped as a visit form snapshot, so the visit form helpers (screens, photo slots, answer
 * clean-up) apply unchanged. Only `blocks` is read by them.
 */
export function verificationSnapshot(form: NeedsVerificationForm): VisitFormSnapshot {
  return {
    schemaVersion: VISIT_FORM_SNAPSHOT_SCHEMA_VERSION,
    builtAt: form.builtAt,
    context: { projectId: form.context.proposalId, visitKind: 'AD_HOC', visitDate: '2000-01-01', sprint: null },
    sources: { template: { id: form.context.proposalId, code: 'NEEDS_VERIFICATION', version: 1, name: 'Needs verification' }, sections: form.sources.sections, subForms: [] },
    blocks: form.blocks,
    warnings: [],
  };
}

/** The block key of a site's section (location issues jump there). */
export const siteBlockKey = (siteNumber: number) => `n:site:${siteNumber}`;

// ---------------------------------------------------------------------------
// Home
// ---------------------------------------------------------------------------

/** "Site verification · 2027-DI-004" (BEAP reviews: "BEAP site visit · ..."). */
export function verificationLabel(dto: Pick<NeedsVerificationDto, 'purpose' | 'reference'>): string {
  return `${dto.purpose === 'BEAP_REVIEW' ? 'BEAP site visit' : 'Site verification'} · ${dto.reference}`;
}

/** The purpose as the screens name it. */
export function verificationPurposeText(dto: Pick<NeedsVerificationDto, 'purpose'>): string {
  return NEEDS_VERIFICATION_PURPOSE_LABELS[dto.purpose];
}

export interface VerificationView {
  id: string;
  label: string;
  reference: string;
  title: string;
  programmeName: string;
  status: NeedsVerificationStatus;
  /** The due date (the day it shows on in the calendar). */
  date: string;
  siteCount: number;
  rowCount: number;
  /** Still owed and the due date has passed (server's tenant-zone flag, or the phone's today). */
  overdue: boolean;
  /** Returned to the officer, nothing queued yet. */
  returned: boolean;
  /** With the server, or queued on this phone. */
  submitted: boolean;
  waitingToSend: boolean;
  dot: VisitDot | null;
  removedFromFeed: boolean;
}

/** What a verification shows on Home and its own screen. `today`: the phone's date. */
export function verificationView(v: StoredNeedsVerification, today: string): VerificationView {
  const s = v.dto;
  const queued = Boolean(v.local.queuedDraftId);
  const submitted = s.status === 'SUBMITTED' || s.status === 'ACCEPTED' || queued;
  const open = NEEDS_VERIFICATION_OPEN_STATUSES.includes(s.status) && !submitted;
  const overdue = open && (s.overdue || s.dueDate < today);
  const returned = s.status === 'RETURNED' && !queued;
  let dot: VisitDot | null = null;
  if (s.status === 'CANCELLED') dot = null;
  else if (submitted) dot = 'DONE';
  else if (overdue || returned) dot = 'OVERDUE';
  else if (open) dot = 'PLANNED';
  return {
    id: v.id,
    label: verificationLabel(s),
    reference: s.reference,
    title: s.title,
    programmeName: s.programmeName,
    status: s.status,
    date: s.dueDate,
    siteCount: s.sites.length,
    rowCount: s.rowCount,
    overdue,
    returned,
    submitted,
    waitingToSend: queued,
    dot,
    removedFromFeed: Boolean(v.local.removedFromFeedAt),
  };
}

/** Verifications by due date (cancelled ones left out), each day's by reference. */
export function groupVerificationsByDay(views: VerificationView[]): Map<string, VerificationView[]> {
  const out = new Map<string, VerificationView[]>();
  const sorted = [...views].filter((v) => v.status !== 'CANCELLED').sort((a, b) => a.date.localeCompare(b.date) || a.reference.localeCompare(b.reference));
  for (const v of sorted) out.set(v.date, [...(out.get(v.date) ?? []), v]);
  return out;
}

const DOT_ORDER: VisitDot[] = ['OVERDUE', 'PLANNED', 'DONE'];

/** Adds verification dots to the visits' calendar dots (overdue first, no duplicates). */
export function mergeVerificationDots(visitDots: Map<string, VisitDot[]>, views: VerificationView[]): Map<string, VisitDot[]> {
  const out = new Map<string, VisitDot[]>([...visitDots].map(([d, l]) => [d, [...l]]));
  for (const v of views) {
    if (!v.dot) continue;
    const list = out.get(v.date) ?? [];
    if (!list.includes(v.dot)) list.push(v.dot);
    out.set(v.date, list);
  }
  for (const [d, list] of out) out.set(d, DOT_ORDER.filter((k) => list.includes(k)));
  return out;
}

/** Verifications that need the officer now: overdue or returned, oldest first. */
export function verificationsNeedingAttention(views: VerificationView[]): VerificationView[] {
  return views.filter((v) => v.overdue || v.returned).sort((a, b) => a.date.localeCompare(b.date));
}

/** The badges a verification shows, most important first. */
export function verificationBadges(v: VerificationView): StatusBadge[] {
  const out: StatusBadge[] = [];
  if (v.status === 'CANCELLED') return [{ text: 'Cancelled', tone: 'gray' }];
  if (v.status === 'ACCEPTED') out.push({ text: 'Accepted', tone: 'positive' });
  else if (v.status === 'SUBMITTED') out.push({ text: 'Waiting for review', tone: 'info' });
  else if (v.submitted) out.push({ text: 'Site verification saved', tone: 'info' });
  else if (v.returned) out.push({ text: 'Returned to you', tone: 'negative' });
  else if (v.overdue) out.push({ text: 'Overdue', tone: 'negative' });
  else out.push({ text: `Due ${formatDay(v.date)}`, tone: 'warning' });
  if (v.waitingToSend) out.push({ text: 'Waiting to send', tone: 'warning' });
  if (v.removedFromFeed) out.push({ text: 'No longer assigned', tone: 'gray' });
  return out;
}

/** "3 sites · 12 facilities". */
export function verificationScopeText(v: Pick<VerificationView, 'siteCount' | 'rowCount'>): string {
  const sites = `${v.siteCount} site${v.siteCount === 1 ? '' : 's'}`;
  return v.rowCount > 0 ? `${sites} · ${v.rowCount} facilit${v.rowCount === 1 ? 'y' : 'ies'} to check` : sites;
}

/** The day list's title: unchanged while the day has only monitoring visits. */
export function dayListTitle(selectedDate: string, today: string, hasVerifications: boolean): string {
  if (!hasVerifications) return selectedDate === today ? "Today's monitoring visits" : `Monitoring visits, ${formatDay(selectedDate, true)}`;
  return selectedDate === today ? "Today's visits" : `Visits, ${formatDay(selectedDate, true)}`;
}

/** The day list's count line ("2 monitoring visits · 1 site verification"), or `emptyText`. */
export function dayListCountText(visitCount: number, verificationCount: number, emptyText: string): string {
  const bits: string[] = [];
  if (visitCount > 0) bits.push(`${visitCount} monitoring visit${visitCount === 1 ? '' : 's'}`);
  if (verificationCount > 0) bits.push(`${verificationCount} site verification${verificationCount === 1 ? '' : 's'}`);
  return bits.length ? bits.join(' · ') : emptyText;
}

// ---------------------------------------------------------------------------
// Sites and locations
// ---------------------------------------------------------------------------

/** "34 m", "1.2 km". */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km`;
}

export interface SiteLocationView {
  recorded: boolean;
  /** "Recorded 27 Nov, 10:04" style is left to the screen; this is the main line. */
  text: string;
  /** "±8 m accuracy", null when unknown or not recorded. */
  accuracyText: string | null;
  /** Distance from the stored location, or why there is none. */
  distanceText: string | null;
  /** Something the officer should fix (poor accuracy, simulated location), else null. */
  warning: string | null;
}

/** A device fix (the location service's shape) for one site, as the request takes it. */
export function siteLocationFromFix(
  siteNumber: number,
  fix: { latitude: number; longitude: number; accuracyMeters: number | null; isMocked: boolean; capturedAt: string }
): NeedsVerificationSiteLocation {
  return {
    siteNumber,
    latitude: fix.latitude,
    longitude: fix.longitude,
    accuracyMeters: fix.accuracyMeters ?? null,
    capturedAt: fix.capturedAt,
    isMockLocation: fix.isMocked,
  };
}

/** The locations with this site's replaced (one per site, in site order). */
export function upsertSiteLocation(locations: NeedsVerificationSiteLocation[], next: NeedsVerificationSiteLocation): NeedsVerificationSiteLocation[] {
  return [...locations.filter((l) => l.siteNumber !== next.siteNumber), next].sort((a, b) => a.siteNumber - b.siteNumber);
}

/** What a site's recorded location says: accuracy, distance from the stored point, and what to fix. */
export function siteLocationView(site: Pick<NeedsVerificationFormSite, 'latitude' | 'longitude'>, location: NeedsVerificationSiteLocation | null | undefined): SiteLocationView {
  if (!location) {
    return {
      recorded: false,
      text: 'Location not recorded yet',
      accuracyText: null,
      distanceText: site.latitude !== null && site.longitude !== null ? null : 'No location stored for this site yet',
      warning: null,
    };
  }
  const accuracy = location.accuracyMeters;
  const accuracyText = accuracy !== null && accuracy !== undefined ? `±${Math.round(accuracy)} m accuracy` : 'Accuracy unknown';
  let distanceText: string;
  if (site.latitude === null || site.longitude === null) {
    distanceText = 'No location was stored for this site: this one will be used once the verification is accepted';
  } else {
    const d = distanceMeters({ latitude: site.latitude, longitude: site.longitude }, { latitude: location.latitude, longitude: location.longitude });
    distanceText =
      d <= NEEDS_VERIFICATION_COORDINATE_TOLERANCE_METERS
        ? `${formatDistance(d)} from the stored location (matches)`
        : `${formatDistance(d)} from the stored location: the site will be moved here once the verification is accepted`;
  }
  let warning: string | null = null;
  if (location.isMockLocation) warning = 'The location looks simulated: turn off any mock location app and record it again.';
  else if (accuracy !== null && accuracy !== undefined && accuracy > NEEDS_VERIFICATION_MAX_ACCURACY_METERS) {
    warning = `Accuracy is poor (worse than ${NEEDS_VERIFICATION_MAX_ACCURACY_METERS} m): move into the open and record it again.`;
  }
  return { recorded: true, text: `Recorded at ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`, accuracyText, distanceText, warning };
}

/** "Stored location: 12.00210, 8.51670" or "No stored location". */
export function storedLocationText(site: Pick<NeedsVerificationFormSite, 'latitude' | 'longitude'>): string {
  return site.latitude !== null && site.longitude !== null ? `Stored location: ${site.latitude.toFixed(5)}, ${site.longitude.toFixed(5)}` : 'No stored location';
}

// ---------------------------------------------------------------------------
// Draft check and request
// ---------------------------------------------------------------------------

/** Where a site's location issue is shown in the form. */
export const LOCATION_ISSUE_LABEL = 'Location at the site';

/**
 * Checks a draft against its form with the shared rules and the phone's capture facts: answer errors,
 * one location per site and photo gaps all block submit (the server accepts gaps, the phone does
 * not), and so do captures the phone no longer has. Location issues show on the site's section.
 */
export function checkVerificationDraft(
  form: NeedsVerificationForm,
  draft: Pick<NeedsVerificationDraft, 'answers' | 'siteLocations' | 'notes'>,
  facts: PhoneCaptureFact[]
): DraftCheck {
  const snapshot = verificationSnapshot(form);
  const answers = cleanAnswers(snapshot, draft.answers);
  const factMap = new Map(facts.map((f) => [f.clientCaptureId, f]));
  const result = validateNeedsVerificationAnswers(form, answers, draft.siteLocations, toValidationFacts(facts));
  const refs = fieldsByPath(snapshot);
  const issues: FormIssue[] = [];
  for (const e of result.errors) {
    const ref = refs.get(e.path);
    issues.push({ path: e.path, screenKey: ref?.screenKey ?? REVIEW_SCREEN_KEY, unitId: ref?.field.unitId ?? null, code: e.code, message: e.message, label: ref?.field.label ?? e.path });
  }
  for (const l of result.locationErrors) {
    const known = form.sites.some((s) => s.siteNumber === l.siteNumber);
    issues.push({
      path: `${siteBlockKey(l.siteNumber)}/location`,
      screenKey: known ? siteBlockKey(l.siteNumber) : REVIEW_SCREEN_KEY,
      unitId: null,
      code: l.code,
      message: l.message,
      label: LOCATION_ISSUE_LABEL,
    });
  }
  for (const g of result.photoGaps) {
    const ref = refs.get(g.path);
    const fact = g.clientCaptureId ? factMap.get(g.clientCaptureId) : undefined;
    const status = g.clientCaptureId ? photoStatus(fact, ref?.field.photo?.geotagRequired ?? true) : null;
    const unitLabel = ref && g.unitId ? ref.block.units.find((u) => u.id === g.unitId)?.label ?? null : null;
    issues.push({ path: g.path, screenKey: ref?.screenKey ?? REVIEW_SCREEN_KEY, unitId: g.unitId, code: g.code, message: photoGapMessage(g.code, unitLabel, ref?.field, status), label: ref?.field.label ?? g.path });
  }
  for (const a of answers) {
    for (const c of a.captures ?? []) {
      if (factMap.has(c.clientCaptureId)) continue;
      const ref = refs.get(a.path);
      issues.push({ path: a.path, screenKey: ref?.screenKey ?? REVIEW_SCREEN_KEY, unitId: c.unitId ?? null, code: 'CAPTURE_MISSING', message: PHOTO_STATUS_TEXT.MISSING, label: ref?.field.label ?? a.path });
    }
  }
  if (draft.notes.trim().length > 4000) {
    issues.push({ path: REVIEW_SCREEN_KEY, screenKey: REVIEW_SCREEN_KEY, unitId: null, code: 'NOTES_TOO_LONG', message: 'Shorten the notes to 4,000 characters', label: 'Notes' });
  }
  const byScreen = new Map<string, FormIssue[]>();
  for (const i of issues) byScreen.set(i.screenKey, [...(byScreen.get(i.screenKey) ?? []), i]);
  return { issues, byScreen, canSubmit: issues.length === 0, findingsToRaise: [], recheckResults: [] };
}

/** The submission as queued (ids only): cleaned answers, one location per site of the form, notes. */
export function buildVerificationSubmission(form: NeedsVerificationForm, draft: NeedsVerificationDraft, submittedAtDevice: string): SubmitNeedsVerificationRequestInput {
  const known = new Set(form.sites.map((s) => s.siteNumber));
  const notes = draft.notes.trim();
  return {
    clientSubmissionId: draft.id,
    formHash: draft.formHash,
    answers: cleanAnswers(verificationSnapshot(form), draft.answers),
    siteLocations: draft.siteLocations
      .filter((l) => known.has(l.siteNumber))
      .sort((a, b) => a.siteNumber - b.siteNumber)
      .map((l) => ({
        siteNumber: l.siteNumber,
        latitude: l.latitude,
        longitude: l.longitude,
        accuracyMeters: l.accuracyMeters ?? null,
        capturedAt: l.capturedAt,
        isMockLocation: l.isMockLocation ?? false,
      })),
    notes: notes.length ? notes : null,
    submittedAtDevice,
  };
}

/** Every capture id the answers name. */
export function verificationCaptureIds(answers: VisitFormAnswerInput[]): string[] {
  return [...new Set(answers.flatMap((a) => (a.captures ?? []).map((c) => c.clientCaptureId)))];
}

/**
 * Returned to the officer: the returned submission's answers, locations and notes as a new draft's.
 * Photos and voice notes were filed with the returned submission and are taken again (listed).
 */
export function correctionFromReturned(
  form: NeedsVerificationForm,
  returned: Pick<NeedsVerificationSubmissionDto, 'answers' | 'siteLocations' | 'notes'>
): { answers: VisitFormAnswerInput[]; siteLocations: NeedsVerificationSiteLocation[]; notes: string; dropped: DroppedAnswer[] } {
  const snapshot = verificationSnapshot(form);
  const inputs: VisitFormAnswerInput[] = returned.answers.map((a) => ({ path: a.path, value: a.value, comment: a.comment, captures: [] }));
  const { answers, dropped } = remapAnswers(null, snapshot, inputs);
  const refs = fieldsByPath(snapshot);
  for (const a of returned.answers) {
    if ((a.captures ?? []).length && refs.has(a.path)) {
      dropped.push({ path: a.path, label: refs.get(a.path)!.field.label, reason: 'Photos and voice notes must be taken again for the corrected site verification' });
    }
  }
  const known = new Set(form.sites.map((s) => s.siteNumber));
  return { answers, siteLocations: returned.siteLocations.filter((l) => known.has(l.siteNumber)), notes: returned.notes ?? '', dropped };
}

/** A draft moved onto another form by path (refused for a stale form); what was dropped is listed. */
export function remapVerificationDraft(
  draft: NeedsVerificationDraft,
  previous: NeedsVerificationForm | null,
  next: { form: NeedsVerificationForm; formHash: string }
): { answers: VisitFormAnswerInput[]; siteLocations: NeedsVerificationSiteLocation[]; dropped: DroppedAnswer[] } {
  const { answers, dropped } = remapAnswers(previous ? verificationSnapshot(previous) : null, verificationSnapshot(next.form), draft.answers);
  const known = new Set(next.form.sites.map((s) => s.siteNumber));
  return { answers, siteLocations: draft.siteLocations.filter((l) => known.has(l.siteNumber)), dropped };
}

// ---------------------------------------------------------------------------
// Which form the phone opens
// ---------------------------------------------------------------------------

export const VERIFICATION_WAITING_TEXT = 'Saved on this phone. It sends with its photos when you are online and can no longer change.';

export type VerificationFormAccess =
  | { mode: 'START'; correction: boolean }
  | { mode: 'EDIT'; draft: StoredNeedsVerificationDraft }
  | { mode: 'READ_ONLY'; draft: StoredNeedsVerificationDraft; title: string; message: string; canCopy: boolean }
  | { mode: 'BLOCKED'; title: string; message: string };

/**
 * What opening the form does: keep filling the open draft, start one (a correction after a return),
 * show a queued, sent or refused one read-only, or explain why there is nothing to fill.
 */
export function verificationFormAccess(
  v: StoredNeedsVerification,
  drafts: { open: StoredNeedsVerificationDraft | null; latest: StoredNeedsVerificationDraft | null }
): VerificationFormAccess {
  const { open, latest } = drafts;
  const status = v.dto.status;
  if (open?.status === 'DRAFT') {
    if (status === 'CANCELLED') return { mode: 'READ_ONLY', draft: open, title: 'Cancelled', message: cancelledText(v.dto), canCopy: false };
    return { mode: 'EDIT', draft: open };
  }
  if (open?.status === 'QUEUED') return { mode: 'READ_ONLY', draft: open, title: 'Waiting to send', message: VERIFICATION_WAITING_TEXT, canCopy: false };
  if (status === 'CANCELLED') {
    return latest
      ? { mode: 'READ_ONLY', draft: latest, title: 'Cancelled', message: cancelledText(v.dto), canCopy: false }
      : { mode: 'BLOCKED', title: 'Cancelled', message: cancelledText(v.dto) };
  }
  const isOpen = NEEDS_VERIFICATION_OPEN_STATUSES.includes(status);
  if (latest?.status === 'REFUSED') {
    return { mode: 'READ_ONLY', draft: latest, title: 'Not accepted by the server', message: latest.lastError ?? 'The server refused this site verification.', canCopy: isOpen };
  }
  if (status === 'ACCEPTED') {
    return latest
      ? { mode: 'READ_ONLY', draft: latest, title: 'Accepted', message: 'The reviewer accepted this site verification.', canCopy: false }
      : { mode: 'BLOCKED', title: 'Accepted', message: 'The reviewer accepted this site verification.' };
  }
  if (status === 'SUBMITTED') {
    return latest
      ? { mode: 'READ_ONLY', draft: latest, title: 'Waiting for review', message: 'Sent. The reviewer accepts it or returns it to you.', canCopy: false }
      : { mode: 'BLOCKED', title: 'Waiting for review', message: 'This site verification was submitted from another phone.' };
  }
  if (latest?.status === 'SENT') {
    const returnedThisOne = status === 'RETURNED' && v.dto.submission?.status === 'RETURNED' && v.dto.submission.clientSubmissionId === latest.draft.id;
    if (!returnedThisOne) {
      return { mode: 'READ_ONLY', draft: latest, title: 'Sent', message: 'Sent. Pull down on Home to refresh its status.', canCopy: false };
    }
  }
  if (!isOpen) return { mode: 'BLOCKED', title: 'Not open', message: 'This site verification takes no answers now.' };
  return { mode: 'START', correction: status === 'RETURNED' && v.dto.submission?.status === 'RETURNED' };
}

function cancelledText(dto: Pick<NeedsVerificationDto, 'cancelReason'>): string {
  return dto.cancelReason ? `This site verification was cancelled: ${dto.cancelReason}` : 'This site verification was cancelled.';
}

// ---------------------------------------------------------------------------
// Sync
// ---------------------------------------------------------------------------

/** Verifications whose current form the phone should download: open ones not cached under their hash. */
export function formsToDownload(
  verifications: Array<Pick<StoredNeedsVerification, 'id' | 'dto'>>,
  cached: (verificationId: string, formHash: string) => boolean
): Array<{ verificationId: string; formHash: string }> {
  return verifications
    .filter((v) => NEEDS_VERIFICATION_OPEN_STATUSES.includes(v.dto.status) && v.dto.formHash && !cached(v.id, v.dto.formHash))
    .map((v) => ({ verificationId: v.id, formHash: v.dto.formHash }));
}

/**
 * What a feed does to verifications already on the phone that it no longer returns: removed, unless an
 * unsent draft (being filled, queued or refused) keeps them; those are marked "no longer assigned".
 */
export function feedRemovals(stored: Array<{ id: string; hasUnsentDraft: boolean; markedRemoved: boolean }>, feedIds: Set<string>): { remove: string[]; mark: string[] } {
  const remove: string[] = [];
  const mark: string[] = [];
  for (const s of stored) {
    if (feedIds.has(s.id)) continue;
    if (s.hasUnsentDraft) {
      if (!s.markedRemoved) mark.push(s.id);
    } else remove.push(s.id);
  }
  return { remove, mark };
}

/** The server copy as the phone shows it right after its submission was accepted (the next sync confirms). */
export function dtoAfterSubmission(dto: NeedsVerificationDto, submission: NeedsVerificationSubmissionDto): NeedsVerificationDto {
  return { ...dto, status: 'SUBMITTED', statusLabel: 'Waiting for review', overdue: false, submission };
}

// ---------------------------------------------------------------------------
// Screen wording
// ---------------------------------------------------------------------------

/** The verification screen's main button, or null when the form cannot be opened for answers. */
export function verificationFormButton(access: VerificationFormAccess): string | null {
  if (access.mode === 'EDIT') return 'Continue the site verification';
  if (access.mode === 'START') return access.correction ? 'Correct and submit again' : 'Start the site verification';
  return null;
}

/** Shown when the phone gave no location (permission refused or no GPS fix in time). */
export const NO_LOCATION_FIX_MESSAGE =
  'The phone could not get a location. Turn on location for the app, step into the open and try again.';

/** "3 of 4 sites located". */
export function locatedSitesText(siteCount: number, locations: Array<{ siteNumber: number }>, siteNumbers: number[]): string {
  const located = new Set(locations.map((l) => l.siteNumber).filter((n) => siteNumbers.includes(n))).size;
  return `${located} of ${siteCount} site${siteCount === 1 ? '' : 's'} located`;
}
