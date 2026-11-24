import { Prisma } from '@prisma/client';
import {
  ContractMilestoneStatus,
  daysBetween,
  deriveMilestoneStatus,
  resolveProjectTypeConfig,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../config/prisma';
import { AppError } from '../middleware/error.middleware';
import { createWebNotification } from '../modules/notifications/notifications.service';
import { OPEN_MILESTONE_STATUSES, SYSTEM_ACTOR } from '../modules/contracts/milestones.service';
import { lapseCurePeriods, openDefaultCase } from '../modules/contracts/defaultCases.service';
import { LIVE_PROJECT_WHERE } from './cadenceJobs';
import { JobContext, registerJob, runUnit } from './runner';

/**
 * milestone-deadlines (Phase 13): once a day per live project (keyed on the project's calendar
 * day), contract milestones move PENDING → DUE on their due date and → OVERDUE after it. Each state
 * is notified once to the responsible role within the responsible organisation; reminders go out
 * on the project's reminder offsets (days before the due date, the Phase 8 schedule). An overdue
 * contractor-on-site (mobilisation) milestone opens a default case once, when the project type
 * says so. Cure periods that ended without a cure come back for a decision.
 */

type MilestoneRow = Prisma.ProjectContractMilestoneGetPayload<{ include: { projectContractor: { select: { organizationId: true; organization: { select: { name: true } } } } } }>;

interface ProjectRow {
  id: string;
  name: string;
  codePrefix: string;
  timezone: string;
  mobilizationReminderOffsetsDays: number[];
  owningOrganizationId: string | null;
  lenderOrganizationId: string | null;
  monitorOrganizationId: string | null;
  projectTypeSnapshotJson: Prisma.JsonValue;
}

/** The organisation a milestone's notifications are limited to (null = no limit). */
function targetOrganization(project: ProjectRow, row: MilestoneRow): string | null {
  switch (row.responsibleOrganizationScope) {
    case 'CONTRACTOR':
      return row.projectContractor?.organizationId ?? null;
    case 'PROJECT_OWNER':
    case 'PROJECT_OWNER_OR_ANCESTOR':
      return project.owningOrganizationId;
    case 'FUNDER':
      return project.lenderOrganizationId;
    case 'MONITOR':
      return project.monitorOrganizationId;
    default:
      return null;
  }
}

async function notify(tx: Prisma.TransactionClient, project: ProjectRow, row: MilestoneRow, title: string, description: string) {
  await createWebNotification(tx, {
    projectId: project.id,
    targetPermissionKey: 'milestones:manage',
    targetRoleId: row.responsibleRoleId,
    targetOrganizationId: targetOrganization(project, row),
    category: 'CONTRACT_MILESTONE',
    title,
    description,
    actionUrl: `/app/projects/${project.id}/kickoff?tab=milestones`,
    metadata: { milestoneId: row.id, key: row.key, dueDate: row.dueDate, status: row.status },
  });
}

async function processProject(project: ProjectRow, now: Date): Promise<string> {
  const today = zonedCalendarDate(now, project.timezone);
  const config = resolveProjectTypeConfig(project.projectTypeSnapshotJson);
  const rows = await prisma.projectContractMilestone.findMany({
    where: { projectId: project.id, status: { in: OPEN_MILESTONE_STATUSES }, dueDate: { not: null } },
    include: { projectContractor: { select: { organizationId: true, organization: { select: { name: true } } } } },
    orderBy: { sortOrder: 'asc' },
  });
  let notified = 0;
  let opened = 0;
  for (const row of rows) {
    const status = deriveMilestoneStatus(row.status, row.dueDate, today);
    const who = row.projectContractor ? ` (${row.projectContractor.organization.name})` : '';
    await prisma.$transaction(async (tx) => {
      // Re-read under a lock: a completion may have landed since the list was read.
      await tx.$queryRaw`SELECT id FROM "project_contract_milestones" WHERE id = ${row.id}::uuid FOR UPDATE`;
      const current = await tx.projectContractMilestone.findUniqueOrThrow({ where: { id: row.id } });
      if (!OPEN_MILESTONE_STATUSES.includes(current.status) || current.dueDate !== row.dueDate) return;
      const data: Prisma.ProjectContractMilestoneUpdateInput = {};
      if (status !== current.status) data.status = status;
      if ((status === 'DUE' || status === 'OVERDUE') && current.lastNotifiedStatus !== status) {
        await notify(
          tx,
          project,
          row,
          status === 'DUE' ? `Due today: ${row.label}${who}` : `Overdue: ${row.label}${who}`,
          status === 'DUE'
            ? `${project.codePrefix}: "${row.label}" is due today (${row.dueDate}).`
            : `${project.codePrefix}: "${row.label}" was due on ${row.dueDate} and is not done.`
        );
        data.lastNotifiedStatus = status as ContractMilestoneStatus;
        data.lastNotifiedAt = now;
        notified += 1;
      } else if (status === 'PENDING') {
        const daysLeft = daysBetween(today, row.dueDate!);
        if (project.mobilizationReminderOffsetsDays.includes(daysLeft) && !current.remindedOffsetsDays.includes(daysLeft)) {
          await notify(tx, project, row, `${row.label}${who}: due in ${daysLeft} day(s)`, `${project.codePrefix}: "${row.label}" is due on ${row.dueDate}.`);
          data.remindedOffsetsDays = [...current.remindedOffsetsDays, daysLeft];
          data.lastNotifiedAt = now;
          notified += 1;
        }
      }
      if (Object.keys(data).length) await tx.projectContractMilestone.update({ where: { id: row.id }, data });

      // An overdue mobilisation opens a default case once per milestone.
      if (
        status === 'OVERDUE' &&
        row.completionMode === 'AUTO_CONTRACTOR_ON_SITE' &&
        row.projectContractorId &&
        (config?.defaultCases.autoOpenOnOverdueMobilisation ?? true)
      ) {
        const existing = await tx.contractorDefaultCase.count({ where: { milestoneId: row.id } });
        if (existing === 0) {
          try {
            await openDefaultCase(tx, {
              projectId: project.id,
              projectContractorId: row.projectContractorId,
              trigger: 'MILESTONE_OVERDUE',
              milestoneId: row.id,
              summary: `${row.projectContractor?.organization.name ?? 'The contractor'} has not mobilised; "${row.label}" was due on ${row.dueDate}.`,
              actor: SYSTEM_ACTOR,
            });
            opened += 1;
          } catch (error) {
            // A case already running (manual) or a terminated contract: nothing to open.
            if (!(error instanceof AppError)) throw error;
          }
        }
      }
    });
  }
  const lapsed = await lapseCurePeriods(project.id, today, now);
  return `${rows.length} open; ${notified} notified; ${opened} case(s) opened; ${lapsed} cure period(s) lapsed`;
}

export async function runMilestoneDeadlines({ now }: JobContext): Promise<void> {
  const projects = await prisma.project.findMany({
    // Phase 15: every phase of an active project (the post-closure evaluation falls after closing).
    where: {
      status: LIVE_PROJECT_WHERE.status,
      tenant: LIVE_PROJECT_WHERE.tenant,
      OR: [{ contractMilestones: { some: {} } }, { defaultCases: { some: { status: 'CURE_PERIOD' } } }],
    },
    select: {
      id: true,
      name: true,
      codePrefix: true,
      timezone: true,
      mobilizationReminderOffsetsDays: true,
      owningOrganizationId: true,
      lenderOrganizationId: true,
      monitorOrganizationId: true,
      projectTypeSnapshotJson: true,
    },
  });
  for (const p of projects) {
    const today = zonedCalendarDate(now, p.timezone);
    await runUnit('milestone-deadlines', `${p.id}:${today}`, () => processProject(p, now));
  }
}

export function registerContractJobs(): void {
  registerJob({ name: 'milestone-deadlines', intervalMs: 60 * 60 * 1000, run: runMilestoneDeadlines });
}
