import { Prisma } from '@prisma/client';
import {
  addCalendarMonths,
  calendarDaysUntil,
  ChangeProjectPhaseRequest,
  CONSTRUCTION_PHASE_LABELS,
  CONSTRUCTION_PHASE_TRANSITIONS,
  ConstructionPhase,
  OPEN_IPC_STATUSES,
  ProjectPhaseDto,
  ProjectPhaseTransitionDto,
  ProjectProcessConfig,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { getProcessConfig } from '../process/processConfig.service';
import { assertAnyCloseoutModuleOn, projectToday } from './closeoutGate';

/**
 * Construction phases (Phase 10 Step 1). A second field next to the DRAFT/ACTIVE/ARCHIVED status:
 *
 *   ACTIVE_CONSTRUCTION -> HANDOVER_IN_PROGRESS -> RETENTION_PERIOD -> COMPLETED_CLOSED
 *
 * The only backwards move is handover back to construction, with a reason. Every move is one
 * transaction with a PROJECT_PHASE_CHANGED audit entry.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

interface Check {
  allowed: boolean;
  reason: string | null;
  overridable: boolean;
}

/** IPCs not yet decided and live direct valuations without a decision (retention releases excluded). */
async function undecidedCount(db: Db, projectId: string): Promise<number> {
  const [ipcs, valuations] = await Promise.all([
    db.ipcClaim.count({ where: { projectId, status: { in: OPEN_IPC_STATUSES } } }),
    db.valuationReport.findMany({
      where: { projectId, source: 'MILESTONE_DIRECT', supersededAt: null },
      select: { trancheDecisions: { select: { id: true, reversesDecisionId: true } } },
    }),
  ]);
  const openDirect = valuations.filter(
    (v) => !v.trancheDecisions.some((d) => !d.reversesDecisionId && !v.trancheDecisions.some((o) => o.reversesDecisionId === d.id))
  ).length;
  return ipcs + openDirect;
}

async function acceptedHandover(db: Db, projectId: string) {
  return db.handoverSubmission.findFirst({
    where: { projectId, decision: { in: ['ACCEPTED', 'ACCEPTED_WITH_SNAGS'] }, reviewedAt: { not: null } },
    orderBy: { reviewedAt: 'desc' },
  });
}

async function checkTransition(
  db: Db,
  project: { id: string; constructionPhase: ConstructionPhase; retentionHeldNgn: Prisma.Decimal; status: string },
  config: ProjectProcessConfig,
  to: ConstructionPhase
): Promise<Check> {
  const no = (reason: string, overridable = false): Check => ({ allowed: false, reason, overridable });
  if (project.status !== 'ACTIVE') return no('Only an active project changes phase.');
  if (!CONSTRUCTION_PHASE_TRANSITIONS[project.constructionPhase].includes(to)) {
    return no(`A project cannot move from ${CONSTRUCTION_PHASE_LABELS[project.constructionPhase]} to ${CONSTRUCTION_PHASE_LABELS[to]}.`);
  }
  if (project.constructionPhase === 'ACTIVE_CONSTRUCTION' && to === 'HANDOVER_IN_PROGRESS') {
    const open = await undecidedCount(db, project.id);
    if (open > 0) return no(`${open} claim(s) or valuation(s) are still waiting for a decision.`, true);
  }
  if (project.constructionPhase === 'HANDOVER_IN_PROGRESS' && to === 'RETENTION_PERIOD' && config.enableHandoverModule) {
    if (!(await acceptedHandover(db, project.id))) {
      return no('A stakeholder must accept the works and the submission must be reviewed first.');
    }
  }
  if (to === 'COMPLETED_CLOSED' && Number(project.retentionHeldNgn) > 0.005) {
    return no('Retention is still held. Release it before closing the project.');
  }
  return { allowed: true, reason: null, overridable: false };
}

const PROJECT_PHASE_SELECT = {
  id: true,
  status: true,
  timezone: true,
  constructionPhase: true,
  practicalCompletionDate: true,
  retentionStartDate: true,
  retentionEndDate: true,
  retentionDurationMonths: true,
  retentionHeldNgn: true,
} satisfies Prisma.ProjectSelect;

/** GET /projects/:projectId/phase */
export async function getProjectPhase(projectId: string, webUser: WebJwtPayload): Promise<ProjectPhaseDto> {
  const config = await assertAnyCloseoutModuleOn(projectId);
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: PROJECT_PHASE_SELECT });
  const transitions: ProjectPhaseTransitionDto[] = [];
  for (const to of CONSTRUCTION_PHASE_TRANSITIONS[project.constructionPhase]) {
    const check = await checkTransition(prisma, project, config, to);
    transitions.push({
      to,
      allowed: check.allowed,
      reason: check.reason,
      overridable: check.overridable,
      requiresReason: to === 'ACTIVE_CONSTRUCTION' || check.overridable,
    });
  }
  const today = projectToday(project.timezone);
  return {
    projectId,
    phase: project.constructionPhase,
    handoverModuleEnabled: config.enableHandoverModule,
    retentionModuleEnabled: config.enableRetentionModule,
    practicalCompletionDate: project.practicalCompletionDate,
    retentionStartDate: project.retentionStartDate,
    retentionEndDate: project.retentionEndDate,
    daysRemaining: project.retentionEndDate ? calendarDaysUntil(today, project.retentionEndDate) : null,
    transitions,
    canChangePhase: hasWebPermission(webUser, 'projects:edit_baseline'),
  };
}

/** POST /projects/:projectId/phase */
export async function changeProjectPhase(params: { projectId: string; webUser: WebJwtPayload; input: ChangeProjectPhaseRequest }) {
  const { projectId, webUser, input } = params;
  await assertAnyCloseoutModuleOn(projectId);
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: PROJECT_PHASE_SELECT });
    const config = await getProcessConfig(projectId, tx);
    const from = project.constructionPhase;
    const to = input.to;
    const reason = input.reason?.trim() || null;

    const check = await checkTransition(tx, project, config, to);
    let overridden = false;
    if (!check.allowed) {
      if (check.overridable && input.overrideUndecided && reason) {
        overridden = true;
      } else {
        throw new AppError(
          check.overridable ? `${check.reason} Override with a reason to continue.` : (check.reason ?? 'Not allowed'),
          409,
          check.overridable ? 'PHASE_CHANGE_NEEDS_OVERRIDE' : 'PHASE_CHANGE_NOT_ALLOWED'
        );
      }
    }
    if (to === 'ACTIVE_CONSTRUCTION' && !reason) {
      throw new AppError('Give a reason for moving the project back to construction.', 422, 'REASON_REQUIRED');
    }

    const data: Prisma.ProjectUpdateInput = { constructionPhase: to, constructionPhaseChangedAt: new Date() };
    if (to === 'RETENTION_PERIOD') {
      const accepted = await acceptedHandover(tx, projectId);
      const practical =
        input.practicalCompletionDate ??
        (accepted?.reviewedAt ? zonedCalendarDate(accepted.reviewedAt, project.timezone) : projectToday(project.timezone));
      if (practical > projectToday(project.timezone)) {
        throw new AppError('Practical completion cannot be in the future.', 422, 'PRACTICAL_COMPLETION_IN_FUTURE');
      }
      data.practicalCompletionDate = practical;
      data.retentionStartDate = practical;
      data.retentionEndDate = addCalendarMonths(practical, project.retentionDurationMonths ?? 0);
      // Reporting stops: outstanding obligations are excused rather than marked missed.
      await tx.reportingObligation.updateMany({
        where: { projectId, status: 'PENDING' },
        data: { status: 'EXCUSED', excusedNote: 'Construction ended: the project entered its defects liability period.', excusedByUserId: webUser.userId },
      });
    }
    await tx.project.update({ where: { id: projectId }, data });

    const after = { ...project, ...data } as typeof project;
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'PROJECT_PHASE_CHANGED',
      summaryText:
        `Moved the project from ${CONSTRUCTION_PHASE_LABELS[from]} to ${CONSTRUCTION_PHASE_LABELS[to]}` +
        (overridden ? ` (override: ${check.reason})` : '') +
        (to === 'RETENTION_PERIOD' ? `; practical completion ${after.practicalCompletionDate}, liability period ends ${after.retentionEndDate}` : '') +
        (reason ? `: ${reason}` : '.'),
      payload: {
        from,
        to,
        reason,
        overridden,
        overrideReason: overridden ? check.reason : null,
        practicalCompletionDate: to === 'RETENTION_PERIOD' ? after.practicalCompletionDate : null,
        retentionEndDate: to === 'RETENTION_PERIOD' ? after.retentionEndDate : null,
      },
    });
  });
  return getProjectPhase(projectId, webUser);
}
