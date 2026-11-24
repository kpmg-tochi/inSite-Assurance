/**
 * Redesign R5a: the phone's local visit model (pure types and constructors, no React Native imports;
 * used by the stores, the sync and the screens). The server's `VisitDto` is stored as received; the
 * phone adds only overlays for what it has not sent yet (D-R5.4).
 */
import type {
  GeofenceStatus,
  VisitConfirmation,
  VisitDto,
  VisitFormAnswerInput,
  VisitKind,
  VisitOverallFinding,
  VisitResponseAction,
} from '@insite/shared';

export type MoveWindow = { from: string; to: string };

/** Unsent work and phone-side facts layered over the server copy of a visit. */
export interface VisitLocalState {
  /** A response queued and not yet accepted by the server ("Waiting to send"). */
  pendingResponse: {
    clientActionId: string;
    action: VisitResponseAction;
    date: string | null;
    comment: string | null;
    queuedAt: string;
  } | null;
  /** The last response the server refused for good (shown until the next response or refresh). */
  responseError: { clientActionId: string; action: VisitResponseAction; message: string; at: string } | null;
  /** The check-in made on this phone (sent = the server has it). */
  checkIn: {
    clientCheckInId: string;
    checkedInAt: string;
    latitude: number | null;
    longitude: number | null;
    accuracyMeters: number | null;
    isMocked: boolean;
    /** Local preview only; the server evaluates again and its result counts. */
    geofenceStatus: GeofenceStatus | null;
    distanceOutsideMeters: number | null;
    sent: boolean;
  } | null;
  /** The draft id (clientSubmissionId) of a submission queued on this phone and not yet accepted. */
  queuedSubmissionId: string | null;
  /** Set when a sync no longer returned this visit (reassigned or removed) while a draft kept it. */
  removedFromFeedAt: string | null;
  /** An unscheduled visit the server refused to create (its message); its drafts are REFUSED too. */
  createError: string | null;
}

export const EMPTY_VISIT_LOCAL_STATE: VisitLocalState = {
  pendingResponse: null,
  responseError: null,
  checkIn: null,
  queuedSubmissionId: null,
  removedFromFeedAt: null,
  createError: null,
};

export function parseLocalState(json: string | null | undefined): VisitLocalState {
  if (!json) return { ...EMPTY_VISIT_LOCAL_STATE };
  try {
    return { ...EMPTY_VISIT_LOCAL_STATE, ...(JSON.parse(json) as Partial<VisitLocalState>) };
  } catch {
    return { ...EMPTY_VISIT_LOCAL_STATE };
  }
}

/** One visit as the phone keeps it (a row of the `visits` table). */
export interface StoredVisit {
  /** Local key: the server visit id, or the clientVisitId of an unscheduled visit made on this phone. */
  id: string;
  /** The server visit id; null for an unscheduled visit the server has not created yet. */
  serverId: string | null;
  projectId: string;
  /** The server copy (for an unsent unscheduled visit: a placeholder built on the phone). */
  visit: VisitDto;
  /** Dates the officer may move to without asking (from the feed); null when responses are closed. */
  moveWindow: MoveWindow | null;
  local: VisitLocalState;
  /** Created on this phone (unscheduled Ad hoc). */
  isLocal: boolean;
  syncedAt: string | null;
}

/** The draft of a visit submission (the `visit_drafts.draft_json` column). Ids only, never paths or labels. */
export interface VisitDraft {
  /** = clientSubmissionId. */
  id: string;
  /** Local visit key (StoredVisit.id). */
  visitId: string;
  projectId: string;
  /** The server snapshot id; null while the visit is an unsent unscheduled one (filled at send time). */
  formSnapshotId: string | null;
  formHash: string;
  /** R3 answers keyed by path (`s:<SECTION>/<key>`, `f:<FACILITY>/<key>[@unitId]`, `r:<recheckId>`). */
  answers: VisitFormAnswerInput[];
  overallFinding: VisitOverallFinding | null;
  summaryText: string;
  /** Site log entries attached to the submission (clientEntryIds; the server ids are resolved at send). */
  siteLogEntryIds: string[];
  /** The check-in this draft rides on (clientCheckInId). */
  checkInId: string | null;
  /** Returned for correction: the server submission this draft corrects (a new revision). */
  correctsSubmissionId: string | null;
  startedAt: string;
  updatedAt: string;
  /** D-R5.19: set when the answers were moved onto a rebuilt form; the screen lists what was dropped. */
  remap: { at: string; fromFormHash: string; dropped: Array<{ path: string; label: string; reason: string }> } | null;
}

export type VisitDraftStatus = 'DRAFT' | 'QUEUED' | 'SENT' | 'REFUSED';

export interface StoredVisitDraft {
  draft: VisitDraft;
  status: VisitDraftStatus;
  /** The server submission id once sent. */
  serverId: string | null;
  lastError: string | null;
  updatedAt: string;
}

/** The placeholder server copy of an unscheduled (Ad hoc) visit created on the phone (D-R5.12). */
export function localUnscheduledVisitDto(params: {
  clientVisitId: string;
  projectId: string;
  projectCode: string;
  projectName: string;
  plannedDate: string;
  pickedFacilityIds: string[];
  facilityCount: number;
  recheckCount: number;
  userId: string;
  userName: string;
  formHash: string;
  sprint: { id: string; number: number; name: string } | null;
  now: string;
}): VisitDto {
  const kind: VisitKind = 'AD_HOC';
  const confirmation: VisitConfirmation = 'CONFIRMED';
  return {
    id: params.clientVisitId,
    projectId: params.projectId,
    projectCode: params.projectCode,
    projectName: params.projectName,
    visitKind: kind,
    status: 'PLANNED',
    confirmation,
    origin: 'UNSCHEDULED',
    generatorKey: null,
    originalPlannedDate: params.plannedDate,
    plannedDate: params.plannedDate,
    submissionDeadline: null,
    sprint: params.sprint,
    assignees: [{ userId: params.userId, fullName: params.userName, isLead: true }],
    pickedFacilityIds: params.pickedFacilityIds,
    formSnapshotId: null,
    formHash: params.formHash,
    formAssembledAt: params.now,
    facilityCount: params.facilityCount,
    recheckCount: params.recheckCount,
    rescheduleCount: 0,
    pendingProposal: null,
    checkInAt: null,
    checkInGeofenceStatus: null,
    isLate: false,
    missedAt: null,
    cancelledAt: null,
    cancelledReason: null,
    publishedAt: null,
    liveSubmissionId: null,
    createdAt: params.now,
    updatedAt: params.now,
  };
}

/** Local snapshot key of a phone-built Ad hoc form until the server has created its visit. */
export const localSnapshotId = (clientVisitId: string) => `local:${clientVisitId}`;
