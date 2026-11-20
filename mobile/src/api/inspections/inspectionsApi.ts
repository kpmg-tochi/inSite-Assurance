import type {
  InspectionFindingDto,
  MobileInspectionPack,
  SiteInspectionDto,
  SiteInspectionSummaryDto,
  SubmitSiteInspectionRequestInput,
} from '@insite/shared';
import { mobileRequest } from '../../config/apiConfig';

/** Phase 14: site inspections and findings for this session. */
export const submitSiteInspection = async (projectId: string, body: SubmitSiteInspectionRequestInput): Promise<SiteInspectionDto> =>
  mobileRequest<SiteInspectionDto>(`/projects/${projectId}/inspections`, { method: 'POST', body: JSON.stringify(body) });

export const fetchOwnInspections = async (projectId: string): Promise<SiteInspectionSummaryDto[]> =>
  mobileRequest<SiteInspectionSummaryDto[]>(`/projects/${projectId}/inspections`);

export const fetchInspectionPack = async (projectId: string): Promise<MobileInspectionPack> =>
  mobileRequest<MobileInspectionPack>(`/projects/${projectId}/inspections/field-pack`);

/** The server scopes a contractor to the findings aimed at its package. */
export const fetchInspectionFindings = async (projectId: string): Promise<InspectionFindingDto[]> =>
  mobileRequest<InspectionFindingDto[]>(`/projects/${projectId}/inspection-findings`);

export const postFindingResolution = async (
  projectId: string,
  findingId: string,
  body: { notes: string; clientCaptureIds: string[] }
): Promise<InspectionFindingDto> =>
  mobileRequest<InspectionFindingDto>(`/projects/${projectId}/inspection-findings/${findingId}/resolve`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
