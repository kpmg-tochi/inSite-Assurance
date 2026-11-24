import type {
  CaptureDto,
  CreateUnscheduledVisitRequestInput,
  MyVisitsFeedDto,
  RespondToVisitRequestInput,
  SubmitVisitRequestInput,
  VisitCheckInRequestInput,
  VisitDetailDto,
  VisitDto,
  VisitFieldPackDto,
  VisitFormDto,
  VisitSubmissionDto,
} from '@insite/shared';
import { MobileApiError, mobileRequest } from '../../config/apiConfig';

/**
 * Redesign R5a: the R4 visit field API (register section 2). Every call goes through `mobileRequest`
 * with the signed-in account token; project-scoped calls are resolved by the server to the account's
 * provisioned session on that project. Writes are only ever called by outbox handlers.
 */

/** The officer's visits across projects. `from`/`to` are YYYY-MM-DD (server default: 7 back, 14 ahead). */
export const fetchMyVisits = async (range: { from?: string; to?: string } = {}): Promise<MyVisitsFeedDto> => {
  const q = new URLSearchParams();
  if (range.from) q.set('from', range.from);
  if (range.to) q.set('to', range.to);
  const qs = q.toString();
  return mobileRequest<MyVisitsFeedDto>(`/visits/mine${qs ? `?${qs}` : ''}`);
};

/**
 * The frozen form of a published visit. With `knownHash`, the server answers 304 when the form is
 * unchanged: this returns null then (keep the cached copy).
 */
export const fetchVisitForm = async (projectId: string, visitId: string, knownHash?: string | null): Promise<VisitFormDto | null> => {
  try {
    return await mobileRequest<VisitFormDto>(`/projects/${projectId}/visits/${visitId}/form`, {
      headers: knownHash ? { 'If-None-Match': `"${knownHash}"` } : undefined,
    });
  } catch (error) {
    if (error instanceof MobileApiError && error.status === 304) return null;
    throw error;
  }
};

/** Everything needed to build an Ad hoc form offline (R3 bundle + open re-check items + geofence). */
export const fetchVisitFieldPack = async (projectId: string): Promise<VisitFieldPackDto> =>
  mobileRequest<VisitFieldPackDto>(`/projects/${projectId}/visits/field-pack`);

/** Online only: the visit with its date changes, submissions (answers incl. returned ones) and comments. */
export const fetchVisitDetail = async (projectId: string, visitId: string): Promise<VisitDetailDto> =>
  mobileRequest<VisitDetailDto>(`/projects/${projectId}/visits/${visitId}`);

export const postVisitResponse = async (projectId: string, visitId: string, body: RespondToVisitRequestInput): Promise<VisitDto> =>
  mobileRequest<VisitDto>(`/projects/${projectId}/visits/${visitId}/respond`, { method: 'POST', body: JSON.stringify(body) });

export const postVisitCheckIn = async (projectId: string, visitId: string, body: VisitCheckInRequestInput): Promise<VisitDto> =>
  mobileRequest<VisitDto>(`/projects/${projectId}/visits/${visitId}/check-in`, { method: 'POST', body: JSON.stringify(body) });

/** 201 created / 200 replay of the same clientSubmissionId; both return the submission. */
export const postVisitSubmission = async (projectId: string, visitId: string, body: SubmitVisitRequestInput): Promise<VisitSubmissionDto> =>
  mobileRequest<VisitSubmissionDto>(`/projects/${projectId}/visits/${visitId}/submissions`, { method: 'POST', body: JSON.stringify(body) });

/** An Ad hoc visit the phone built; the server re-assembles the form and compares the hash. */
export const postUnscheduledVisit = async (projectId: string, body: CreateUnscheduledVisitRequestInput): Promise<VisitDto> =>
  mobileRequest<VisitDto>(`/projects/${projectId}/visits/unscheduled`, { method: 'POST', body: JSON.stringify(body) });

/**
 * This account's captures on a project registered since `since` (ISO). Used to pick up voice-note
 * transcripts, which the server writes after registration (Whisper, off the request path).
 */
export const fetchOwnCaptures = async (projectId: string, since?: string | null): Promise<CaptureDto[]> =>
  mobileRequest<CaptureDto[]>(`/projects/${projectId}/captures/mine${since ? `?since=${encodeURIComponent(since)}` : ''}`);
