import type {
  CommitteeScoringRequest,
  ConflictDeclarationRequestInput,
  FinaliseRankingRequest,
  NeedsCommitteeDto,
  NeedsCycleDocumentDto,
  NeedsMyScoringDto,
  NeedsPresignedUploadDto,
  NeedsProposalScoresDto,
  NeedsRankingDto,
  RankingPlacementRequest,
  ScoreSheetDto,
  ScoreSheetInput,
  SetCommitteeRequest,
  SetFundingLineRequest,
} from '@insite/shared';
import { api } from '../config/apiConfig';
import { mimeTypeOf, putPresignedFile } from './needsPipeline';
import type { ApiEnvelope } from './types';

/**
 * Needs pipeline wave 3 (N5): the prioritisation committee, score sheets and the ranking
 * (`/api/v1/needs`, parent plan 17.9). Reads need `needs:view`; the chair's writes
 * `needs:chair_committee`; declarations and score sheets are a member's. The server also checks
 * the cycle's owning organisation and that the cycle is open, so a hidden button is a convenience.
 */

// ---------------------------------------------------------------------------
// Committee
// ---------------------------------------------------------------------------

export const getNeedsCommittee = async (cycleId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsCommitteeDto>>(`/needs/cycles/${cycleId}/committee`);
  return data.data;
};

export const setNeedsCommittee = async (cycleId: string, body: SetCommitteeRequest) => {
  const { data } = await api.put<ApiEnvelope<NeedsCommitteeDto>>(`/needs/cycles/${cycleId}/committee`, body);
  return data.data;
};

export const declareCommitteeConflicts = async (cycleId: string, body: ConflictDeclarationRequestInput) => {
  const { data } = await api.post<ApiEnvelope<NeedsCommitteeDto>>(`/needs/cycles/${cycleId}/committee/declaration`, body);
  return data.data;
};

export const setCommitteeScoring = async (cycleId: string, body: CommitteeScoringRequest) => {
  const { data } = await api.post<ApiEnvelope<NeedsCommitteeDto>>(`/needs/cycles/${cycleId}/committee/scoring`, body);
  return data.data;
};

/** Uploads the committee minutes (presign through the committee route, PUT, register as COMMITTEE_MINUTES). */
export const uploadCommitteeMinutes = async (cycleId: string, p: { file: File; title: string; supersedesId?: string | null }) => {
  const mimeType = mimeTypeOf(p.file);
  const presign = await api.post<ApiEnvelope<NeedsPresignedUploadDto>>(`/needs/cycles/${cycleId}/committee/minutes/presign`, {
    fileName: p.file.name,
    mimeType,
    byteSize: p.file.size,
  });
  await putPresignedFile(presign.data.data.uploadUrl, p.file, mimeType);
  const { data } = await api.post<ApiEnvelope<NeedsCycleDocumentDto>>(`/needs/cycles/${cycleId}/committee/minutes`, {
    objectKey: presign.data.data.objectKey,
    kind: 'COMMITTEE_MINUTES',
    title: p.title,
    supersedesId: p.supersedesId ?? null,
    proposalIds: [],
  });
  return data.data;
};

// ---------------------------------------------------------------------------
// Score sheets
// ---------------------------------------------------------------------------

export const getMyScoring = async (cycleId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsMyScoringDto>>(`/needs/cycles/${cycleId}/score-sheets/mine`);
  return data.data;
};

/** Saves (and submits) the member's sheet for one proposal; editable until the ranking is finalised. */
export const saveScoreSheet = async (cycleId: string, body: ScoreSheetInput) => {
  const { data } = await api.put<ApiEnvelope<ScoreSheetDto>>(`/needs/cycles/${cycleId}/score-sheets`, body);
  return data.data;
};

export const getProposalScores = async (proposalId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsProposalScoresDto>>(`/needs/proposals/${proposalId}/scores`);
  return data.data;
};

// ---------------------------------------------------------------------------
// Ranking and the funding line
// ---------------------------------------------------------------------------

export const getNeedsRanking = async (cycleId: string) => {
  const { data } = await api.get<ApiEnvelope<NeedsRankingDto>>(`/needs/cycles/${cycleId}/ranking`);
  return data.data;
};

/** The response body is not read (the ranking is refetched). */
export const setRankingPlacement = async (cycleId: string, body: RankingPlacementRequest) => {
  await api.post(`/needs/cycles/${cycleId}/ranking/placements`, body);
};

export const setFundingLine = async (cycleId: string, body: SetFundingLineRequest) => {
  await api.put(`/needs/cycles/${cycleId}/ranking/line`, body);
};

export const finaliseRanking = async (cycleId: string, body: FinaliseRankingRequest) => {
  await api.post(`/needs/cycles/${cycleId}/ranking/finalise`, body);
};

/** Regenerates the Prioritised Project Portfolio (xlsx and PDF). */
export const generateRankingReport = async (cycleId: string) => {
  const { data } = await api.post<ApiEnvelope<NeedsCycleDocumentDto[]>>(`/needs/cycles/${cycleId}/ranking/report`);
  return data.data;
};
