/**
 * Redesign R5a (D-R5.22): the site log on the phone (pure; tested in Node). Entries are standalone
 * records per project (photo, voice note or note), sent through the outbox (SITE_LOG_ENTRY behind its
 * capture). A submission can attach entries; a photo field can take a site log photo of the visit day.
 *
 * Server rule (R4c) that shapes picking: a capture registered as a site log entry can no longer be an
 * answer's capture (409 CAPTURE_ALREADY_LINKED). So a photo moves into a form field only while its
 * entry has not been sent; the entry is then withdrawn (status MOVED_TO_FORM). A sent entry can still
 * be attached to the submission as a whole.
 */
import { zonedCalendarDate, type CreateSiteLogEntryRequestInput, type GeofenceStatus, type SiteLogKind } from '@insite/shared';
import type { VisitDraft } from './visitModel';

export type SiteLogStatus = 'QUEUED' | 'SENT' | 'MOVED_TO_FORM';

/** A row of the `site_log_entries` table. id = clientEntryId. */
export interface SiteLogRecord {
  id: string;
  projectId: string;
  kind: SiteLogKind;
  text: string | null;
  /** PHOTO / VOICE: the clientCaptureId. */
  captureId: string | null;
  capturedAt: string;
  latitude: number | null;
  longitude: number | null;
  accuracyMeters: number | null;
  isMocked: boolean;
  /** Local preview when written (the server evaluates again). */
  geofenceStatus: GeofenceStatus | null;
  status: SiteLogStatus;
  serverId: string | null;
  /** The server submission it is attached to (from the server), when known. */
  attachedSubmissionId: string | null;
  /** MOVED_TO_FORM: the draft whose photo field took the photo. */
  movedToDraftId: string | null;
  lastError: string | null;
  createdAt: string;
}

export const SITE_LOG_NOTE_MAX = 4000;

/** The first problem with a new entry, or null. */
export function siteLogEntryProblem(input: { kind: SiteLogKind; text?: string | null; captureId?: string | null }): string | null {
  const text = (input.text ?? '').trim();
  if (text.length > SITE_LOG_NOTE_MAX) return `Keep the note under ${SITE_LOG_NOTE_MAX} characters.`;
  if (input.kind === 'NOTE') return text.length < 1 ? 'Write the note.' : null;
  return input.captureId ? null : input.kind === 'PHOTO' ? 'Take the photo first.' : 'Record the voice note first.';
}

/** The request body (`POST /projects/:id/site-log`). A position is sent for notes only (captures carry theirs). */
export function buildSiteLogRequest(r: SiteLogRecord): CreateSiteLogEntryRequestInput {
  const text = (r.text ?? '').trim();
  return {
    clientEntryId: r.id,
    kind: r.kind,
    clientCaptureId: r.kind === 'NOTE' ? null : r.captureId,
    text: text.length > 0 ? text : null,
    capturedAt: r.capturedAt,
    geotag:
      r.kind === 'NOTE' && r.latitude !== null && r.longitude !== null
        ? { latitude: r.latitude, longitude: r.longitude, accuracyMeters: r.accuracyMeters, isMocked: r.isMocked, capturedAt: r.capturedAt }
        : null,
  };
}

/** The calendar day an entry was captured, in the project zone. */
export function entryDay(r: Pick<SiteLogRecord, 'capturedAt'>, timeZone: string | null | undefined): string {
  return zonedCalendarDate(r.capturedAt, timeZone || 'UTC');
}

/** The project's entries captured on the visit day (project zone), newest first; withdrawn ones left out. */
export function entriesForVisitDay(entries: SiteLogRecord[], ctx: { projectId: string; visitDate: string; timeZone: string | null | undefined }): SiteLogRecord[] {
  return entries
    .filter((e) => e.projectId === ctx.projectId && e.status !== 'MOVED_TO_FORM' && entryDay(e, ctx.timeZone) === ctx.visitDate)
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

/**
 * "Pick from site log" for a photo field: photos of the same project captured on the visit day, not
 * sent yet (see the header), not attached to a draft. `attachedToDrafts`: entry id → draft id.
 */
export function pickablePhotosForField(
  entries: SiteLogRecord[],
  ctx: { projectId: string; visitDate: string; timeZone: string | null | undefined; attachedToDrafts: Map<string, string> }
): SiteLogRecord[] {
  return entriesForVisitDay(entries, ctx).filter(
    (e) => e.kind === 'PHOTO' && e.captureId && e.status === 'QUEUED' && !e.serverId && !ctx.attachedToDrafts.has(e.id)
  );
}

/**
 * Entries the review screen can attach to this draft: the project's entries not withdrawn, not
 * attached to a server submission and not attached to another draft.
 */
export function attachableEntries(
  entries: SiteLogRecord[],
  ctx: { projectId: string; draftId: string; attachedToDrafts: Map<string, string> }
): SiteLogRecord[] {
  return entries
    .filter((e) => {
      if (e.projectId !== ctx.projectId || e.status === 'MOVED_TO_FORM' || e.attachedSubmissionId) return false;
      const other = ctx.attachedToDrafts.get(e.id);
      return !other || other === ctx.draftId;
    })
    .sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
}

export function attachEntry(draft: VisitDraft, entryId: string, now: string): VisitDraft {
  if (draft.siteLogEntryIds.includes(entryId)) return draft;
  return { ...draft, siteLogEntryIds: [...draft.siteLogEntryIds, entryId], updatedAt: now };
}

export function detachEntry(draft: VisitDraft, entryId: string, now: string): VisitDraft {
  if (!draft.siteLogEntryIds.includes(entryId)) return draft;
  return { ...draft, siteLogEntryIds: draft.siteLogEntryIds.filter((id) => id !== entryId), updatedAt: now };
}
