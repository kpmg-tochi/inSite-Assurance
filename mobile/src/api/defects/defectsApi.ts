import type { DefectTicketDto } from '@insite/shared';
import { mobileRequest } from '../../config/apiConfig';
import type { DefectActionKind } from '../../utils/defects';

/** Phase 10: defect tickets for this session (the server scopes a contractor to its own tickets). */
export const fetchDefectTickets = async (projectId: string): Promise<DefectTicketDto[]> =>
  mobileRequest<DefectTicketDto[]>(`/projects/${projectId}/defects`);

export const postDefectAction = async (
  projectId: string,
  ticketId: string,
  kind: DefectActionKind,
  body: Record<string, unknown>
): Promise<DefectTicketDto> =>
  mobileRequest<DefectTicketDto>(`/projects/${projectId}/defects/${ticketId}/${kind}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
