import { calendarDaysUntil, OPEN_DEFECT_STATUSES, RetentionSummaryDto, roundNgn2 } from '@insite/shared';
import { prisma } from '../../config/prisma';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { assertModuleOn, projectToday } from './closeoutGate';

/**
 * Retention (Phase 10, reworked in redesign R1b).
 *
 * Payments are made outside the platform and recorded in modules/payments. Each recorded interim or
 * final payment holds back gross x the project's retention percentage (or an amount the finance
 * officer states, with a reason); a RETENTION_RELEASE payment releases it. The project keeps the
 * balance still held (`retentionHeldNgn`) and the total released (`retentionReleasedNgn`). This module reports the balance and
 * the defects liability period.
 */

/** GET /projects/:projectId/retention */
export async function getRetentionSummary(projectId: string, _viewer: WebJwtPayload): Promise<RetentionSummaryDto> {
  await assertModuleOn(projectId, 'retention');
  const [p, openDefectCount] = await Promise.all([
    prisma.project.findUniqueOrThrow({
      where: { id: projectId },
      select: {
        timezone: true,
        constructionPhase: true,
        retentionPercentage: true,
        retentionDurationMonths: true,
        retentionReleaseAtCompletionPct: true,
        practicalCompletionDate: true,
        retentionStartDate: true,
        retentionEndDate: true,
        retentionHeldNgn: true,
        retentionReleasedNgn: true,
      },
    }),
    prisma.retentionDefectTicket.count({ where: { projectId, status: { in: OPEN_DEFECT_STATUSES } } }),
  ]);
  const today = projectToday(p.timezone);
  const held = Number(p.retentionHeldNgn);
  const released = Number(p.retentionReleasedNgn);
  return {
    projectId,
    enabled: true,
    phase: p.constructionPhase,
    retentionPercentage: p.retentionPercentage === null ? null : Number(p.retentionPercentage),
    retentionDurationMonths: p.retentionDurationMonths,
    retentionReleaseAtCompletionPct: Number(p.retentionReleaseAtCompletionPct),
    practicalCompletionDate: p.practicalCompletionDate,
    retentionStartDate: p.retentionStartDate,
    retentionEndDate: p.retentionEndDate,
    daysRemaining: p.retentionEndDate ? calendarDaysUntil(today, p.retentionEndDate) : null,
    heldNgn: held,
    releasedNgn: released,
    // retentionHeldNgn is the balance still held; releases move it to retentionReleasedNgn.
    balanceNgn: roundNgn2(held),
    openDefectCount,
  };
}
