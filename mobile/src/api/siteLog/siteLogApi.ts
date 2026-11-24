import type { CreateSiteLogEntryRequestInput, SiteLogEntryDto } from '@insite/shared';
import { mobileRequest } from '../../config/apiConfig';

/** Redesign R5a: the officer's site log on a project (R4c API). Writes are only called by the outbox. */

/** 201 created / 200 replay of the same clientEntryId. */
export const postSiteLogEntry = async (projectId: string, body: CreateSiteLogEntryRequestInput): Promise<SiteLogEntryDto> =>
  mobileRequest<SiteLogEntryDto>(`/projects/${projectId}/site-log`, { method: 'POST', body: JSON.stringify(body) });

/** This account's entries on the project (all devices), newest first; `since` filters on creation time. */
export const fetchMySiteLog = async (projectId: string, since?: string | null): Promise<SiteLogEntryDto[]> => {
  const q = new URLSearchParams({ mine: 'true' });
  if (since) q.set('since', since);
  return mobileRequest<SiteLogEntryDto[]>(`/projects/${projectId}/site-log?${q.toString()}`);
};
