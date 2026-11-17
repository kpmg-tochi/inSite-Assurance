import type { DemoProjectWorkspaceDto } from '@insite/shared';
import { mobileRequest } from '../../config/apiConfig';

/**
 * Fetches active/seeded demo projects and their join codes from PostgreSQL.
 */
export const fetchDemoProjects = async (): Promise<DemoProjectWorkspaceDto[]> => {
  return mobileRequest<DemoProjectWorkspaceDto[]>('/projects/demo');
};

/**
 * DEMO-ONLY API: Wipes user-submitted data in PostgreSQL and restores original seeded demo data.
 */
export const resetDemoDatabase = async (): Promise<{ resetAt: string }> => {
  return mobileRequest<{ resetAt: string }>('/projects/demo/reset', {
    method: 'POST',
  });
};
