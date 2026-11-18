import type { DemoProjectWorkspaceDto } from '@insite/shared';
import { mobileRequest } from '../../config/apiConfig';

/**
 * Fetches active/seeded demo projects and their join codes from PostgreSQL.
 */
export const fetchDemoProjects = async (): Promise<DemoProjectWorkspaceDto[]> => {
  if (process.env.EXPO_PUBLIC_DEMO_MODE !== 'true') {
    throw new Error('Demo features are not available in this build.');
  }
  return mobileRequest<DemoProjectWorkspaceDto[]>('/projects/demo');
};

/**
 * DEMO-ONLY API: Wipes user-submitted data in PostgreSQL and restores original seeded demo data.
 */
export const resetDemoDatabase = async (): Promise<{ resetAt: string }> => {
  if (process.env.EXPO_PUBLIC_DEMO_MODE !== 'true') {
    throw new Error('Demo features are not available in this build.');
  }
  return mobileRequest<{ resetAt: string }>('/projects/demo/reset', {
    method: 'POST',
  });
};
