import type { DemoProjectWorkspaceDto } from '@insite/shared';
import { mobileRequest } from '../../config/apiConfig';

/**
 * Fetches active/seeded demo projects and their join codes from PostgreSQL.
 */
export const fetchDemoProjects = async (): Promise<DemoProjectWorkspaceDto[]> => {
  return mobileRequest<DemoProjectWorkspaceDto[]>('/projects/demo');
};

