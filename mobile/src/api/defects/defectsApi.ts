import type { DefectTicketDto } from '@insite/shared';
import { mobileRequest } from '../../config/apiConfig';

/** Phase 10: defect tickets on the project. */
export const fetchDefectTickets = async (projectId: string): Promise<DefectTicketDto[]> =>
  mobileRequest<DefectTicketDto[]>(`/projects/${projectId}/defects`);

/** Close a ticket with site photos, or reopen one awaiting verification. */
export const postDefectVerify = async (
  projectId: string,
  ticketId: string,
  body: Record<string, unknown>
): Promise<DefectTicketDto> =>
  mobileRequest<DefectTicketDto>(`/projects/${projectId}/defects/${ticketId}/verify`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
