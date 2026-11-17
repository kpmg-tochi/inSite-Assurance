import type {
  CreateWbsChatMessageRequest,
  WbsChatMessageDto,
} from '@insite/shared';
import { mobileRequest } from '../../config/apiConfig';

export async function fetchBoqChatMessages(
  projectId: string,
  boqItemId: string
): Promise<WbsChatMessageDto[]> {
  return mobileRequest<WbsChatMessageDto[]>(
    `/projects/${projectId}/boq/${boqItemId}/messages`,
    { method: 'GET' }
  );
}

export async function postBoqChatMessage(
  projectId: string,
  boqItemId: string,
  payload: CreateWbsChatMessageRequest
): Promise<WbsChatMessageDto> {
  return mobileRequest<WbsChatMessageDto>(
    `/projects/${projectId}/boq/${boqItemId}/messages`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );
}
