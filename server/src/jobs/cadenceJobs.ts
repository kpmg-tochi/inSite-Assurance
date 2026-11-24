import { Prisma } from '@prisma/client';

/**
 * Scheduled jobs only ever touch live projects of tenants that are not suspended. Phase 10: once a
 * project is in its defects liability period (or closed), construction jobs (schedule variance) stop
 * for it. Redesign R4f removed the reporting-obligations and overdue-reports jobs (visits replace
 * reporting obligations; the visit jobs are in visitJobs.ts).
 */
export const LIVE_PROJECT_WHERE: Prisma.ProjectWhereInput = {
  status: 'ACTIVE',
  constructionPhase: { in: ['ACTIVE_CONSTRUCTION', 'HANDOVER_IN_PROGRESS'] },
  tenant: { status: { not: 'SUSPENDED' } },
};
