import { Prisma } from '@prisma/client';
import {
  DecideProgrammeOfWorksRequest,
  ProgrammeOfWorksDto,
  SubmitProgrammeOfWorksRequest,
  SubmitProgrammeOfWorksRequestSchema,
  validateScheduleBaseline,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { hasWebPermission, WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { createWebNotification } from '../notifications/notifications.service';
import { contractorForWebUser } from '../projects/contractors.service';
import { applyScheduleBaseline, loadScheduleContext, refreshScheduleBadge } from '../schedule/schedule.service';
import { autoCompleteMilestones, webActor } from './milestones.service';

/**
 * Phase 13: the contractor proposes the programme of works (item dates and dependencies); the
 * monitor accepts it, which writes the schedule baseline through the Phase 9 service, or returns it.
 * Before activation any item may be dated; after activation only items still undated (dated live
 * items move only through "Catch Project Up").
 */

type Row = Prisma.ProgrammeOfWorksSubmissionGetPayload<{ include: { projectContractor: { select: { organization: { select: { name: true } } } } } }>;

async function serialize(rows: Row[]): Promise<ProgrammeOfWorksDto[]> {
  const ids = [...new Set(rows.flatMap((r) => [r.submittedByUserId, r.decidedByUserId]).filter((v): v is string => Boolean(v)))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true } }) : [];
  const name = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((r) => {
    const proposal = SubmitProgrammeOfWorksRequestSchema.parse(r.proposalJson);
    return {
      id: r.id,
      projectContractorId: r.projectContractorId,
      contractorName: r.projectContractor?.organization.name ?? null,
      submittedByUserId: r.submittedByUserId,
      submittedByName: name.get(r.submittedByUserId) ?? null,
      status: r.status,
      proposal,
      itemCount: proposal.items.length,
      decidedByName: r.decidedByUserId ? name.get(r.decidedByUserId) ?? null : null,
      decisionNotes: r.decisionNotes,
      createdAt: r.createdAt.toISOString(),
      decidedAt: r.decidedAt?.toISOString() ?? null,
    };
  });
}

const INCLUDE = { projectContractor: { select: { organization: { select: { name: true } } } } } as const;

export async function listProgrammeSubmissions(projectId: string, webUser: WebJwtPayload) {
  // Contractor users see their own organisation's submissions; the monitoring side sees all.
  const own = await contractorForWebUser(prisma, projectId, webUser);
  const rows = await prisma.programmeOfWorksSubmission.findMany({
    where: { projectId, ...(own ? { projectContractorId: own.id } : {}) },
    include: INCLUDE,
    orderBy: { createdAt: 'desc' },
  });
  return serialize(rows);
}

/** The proposal merged into the current plan, validated as the baseline would be. */
async function validateProposal(db: Prisma.TransactionClient | typeof prisma, projectId: string, contractorId: string | null, input: SubmitProgrammeOfWorksRequest) {
  const ctx = await loadScheduleContext(db, projectId);
  const { project, items } = ctx;
  const byId = new Map(items.map((i) => [i.id, i]));
  if (new Set(input.items.map((i) => i.boqItemId)).size !== input.items.length) {
    throw new AppError('Each item can be listed once', 422, 'DUPLICATE_ITEM');
  }
  for (const i of input.items) {
    const item = byId.get(i.boqItemId);
    if (!item) throw new AppError('Some BOQ items are not in this project', 422, 'BOQ_ITEM_NOT_IN_PROJECT', { boqItemIds: [i.boqItemId] });
    if (contractorId && item.projectContractorId && item.projectContractorId !== contractorId) {
      throw new AppError(`Item ${item.wbsCode} belongs to another contractor's package`, 403, 'ITEM_OTHER_CONTRACTOR');
    }
    if (project.status !== 'DRAFT' && (item.plannedStartDate || item.plannedEndDate)) {
      throw new AppError(`Item ${item.wbsCode} is already dated; dated items on a live project move only through "Catch Project Up".`, 409, 'ITEM_ALREADY_DATED');
    }
  }
  // A contractor links its own programme: every dependency ends at an item of this proposal (the
  // predecessor may be any item of the project).
  const proposed = new Set(input.items.map((i) => i.boqItemId));
  for (const d of input.dependencies) {
    if (!byId.has(d.predecessorBoqItemId)) {
      throw new AppError('Some BOQ items are not in this project', 422, 'BOQ_ITEM_NOT_IN_PROJECT', { boqItemIds: [d.predecessorBoqItemId] });
    }
    if (d.predecessorBoqItemId === d.successorBoqItemId) {
      throw new AppError('An item cannot depend on itself', 422, 'SCHEDULE_BASELINE_INVALID');
    }
    if (!proposed.has(d.successorBoqItemId)) {
      throw new AppError('Each dependency must end at an item you are dating in this programme', 422, 'DEPENDENCY_OUTSIDE_PROGRAMME');
    }
  }
  const plannedStartDate = project.plannedStartDate ?? input.plannedStartDate;
  const plannedEndDate = project.plannedEndDate ?? input.plannedEndDate;
  if (!plannedStartDate || !plannedEndDate) {
    throw new AppError('Give the project start and end dates for the programme', 422, 'PROGRAMME_DATES_REQUIRED');
  }
  const next = new Map(items.map((i) => [i.id, { plannedStartDate: i.plannedStartDate, plannedEndDate: i.plannedEndDate }]));
  for (const i of input.items) next.set(i.boqItemId, { plannedStartDate: i.plannedStartDate, plannedEndDate: i.plannedEndDate });
  const existingDeps = ctx.dependencies.map((d) => ({ predecessorId: d.predecessorBoqItemId, successorId: d.successorBoqItemId, lagWorkdays: d.lagWorkdays }));
  const deps = [...existingDeps];
  for (const d of input.dependencies) {
    if (!deps.some((x) => x.predecessorId === d.predecessorBoqItemId && x.successorId === d.successorBoqItemId)) {
      deps.push({ predecessorId: d.predecessorBoqItemId, successorId: d.successorBoqItemId, lagWorkdays: d.lagWorkdays ?? 0 });
    }
  }
  const windowEnd =
    project.currentProjectedEndDate && project.currentProjectedEndDate > plannedEndDate ? project.currentProjectedEndDate : plannedEndDate;
  const issues = validateScheduleBaseline({
    plannedStartDate,
    plannedEndDate: windowEnd,
    items: items.map((i) => ({ id: i.id, label: `WBS ${i.wbsCode}`, ...next.get(i.id)! })),
    dependencies: deps,
    workWeekDays: project.workWeekDays,
  });
  if (issues.length) throw new AppError(issues[0].message, 422, 'SCHEDULE_BASELINE_INVALID', { issues });
  return { plannedStartDate, plannedEndDate, deps };
}

export async function submitProgrammeOfWorks(projectId: string, webUser: WebJwtPayload, input: SubmitProgrammeOfWorksRequest) {
  const contractor = await contractorForWebUser(prisma, projectId, webUser);
  if (!contractor) throw new AppError('Only a contractor on this project can propose its programme of works', 403, 'NOT_A_PROJECT_CONTRACTOR');
  const full = await prisma.projectContractor.findUniqueOrThrow({ where: { id: contractor.id }, select: { contractStatus: true } });
  if (full.contractStatus === 'TERMINATED') throw new AppError('This contract has been terminated', 409, 'CONTRACTOR_TERMINATED');
  await validateProposal(prisma, projectId, contractor.id, input);
  const id = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "project_contractors" WHERE id = ${contractor.id}::uuid FOR UPDATE`;
    const pending = await tx.programmeOfWorksSubmission.count({ where: { projectContractorId: contractor.id, status: 'PENDING' } });
    if (pending) throw new AppError('A programme from your organisation is already waiting for the monitor', 409, 'PROGRAMME_PENDING');
    const row = await tx.programmeOfWorksSubmission.create({
      data: { projectId, projectContractorId: contractor.id, submittedByUserId: webUser.userId, proposalJson: input as unknown as Prisma.InputJsonValue },
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'PROGRAMME_OF_WORKS_SUBMITTED',
      summaryText: `${contractor.organization.name} proposed a programme of works dating ${input.items.length} item(s).`,
      payload: { submissionId: row.id, projectContractorId: contractor.id, itemCount: input.items.length, dependencyCount: input.dependencies.length },
    });
    await createWebNotification(tx, {
      projectId,
      targetPermissionKey: 'projects:edit_baseline',
      category: 'PROGRAMME_OF_WORKS',
      title: `Programme of works from ${contractor.organization.name}`,
      description: `${input.items.length} item(s) dated. Accept it to set the schedule, or return it with notes.`,
      actionUrl: `/app/projects/${projectId}/schedule`,
      metadata: { submissionId: row.id },
      hideFromProjectContractors: true,
    });
    return row.id;
  });
  return (await serialize([await prisma.programmeOfWorksSubmission.findUniqueOrThrow({ where: { id }, include: INCLUDE })]))[0];
}

export async function decideProgrammeOfWorks(projectId: string, submissionId: string, webUser: WebJwtPayload, input: DecideProgrammeOfWorksRequest) {
  if (!hasWebPermission(webUser, 'projects:edit_baseline')) {
    throw new AppError('Deciding a programme of works requires projects:edit_baseline', 403, 'FORBIDDEN_PERMISSION');
  }
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "programme_of_works_submissions" WHERE id = ${submissionId}::uuid FOR UPDATE`;
    const row = await tx.programmeOfWorksSubmission.findFirst({ where: { id: submissionId, projectId }, include: INCLUDE });
    if (!row) throw new AppError('Programme of works not found', 404, 'PROGRAMME_NOT_FOUND');
    if (row.status !== 'PENDING') throw new AppError('This programme has already been decided', 409, 'PROGRAMME_DECIDED');
    const proposal = SubmitProgrammeOfWorksRequestSchema.parse(row.proposalJson);
    const who = row.projectContractor?.organization.name ?? 'the contractor';
    if (input.decision === 'ACCEPT') {
      // Re-checked against today's plan: the schedule may have changed since it was proposed.
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
      const merged = await validateProposal(tx, projectId, row.projectContractorId, proposal);
      await applyScheduleBaseline(tx, projectId, webUser, {
        plannedStartDate: merged.plannedStartDate,
        plannedEndDate: merged.plannedEndDate,
        items: proposal.items,
        dependencies: merged.deps.map((d) => ({ predecessorBoqItemId: d.predecessorId, successorBoqItemId: d.successorId, lagWorkdays: d.lagWorkdays })),
      });
      if (row.projectContractorId) {
        await autoCompleteMilestones(tx, {
          projectId,
          mode: 'AUTO_SCHEDULE_BASELINE_SET',
          projectContractorId: row.projectContractorId,
          at: new Date(),
          notes: `Programme of works from ${who} accepted.`,
          actor: webActor(webUser),
        });
      }
    }
    await tx.programmeOfWorksSubmission.update({
      where: { id: row.id },
      data: {
        status: input.decision === 'ACCEPT' ? 'ACCEPTED' : 'RETURNED',
        decidedByUserId: webUser.userId,
        decisionNotes: input.notes ?? null,
        decidedAt: new Date(),
      },
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: `${webUser.fullName} (${webUser.roleName})`,
      action: 'PROGRAMME_OF_WORKS_DECIDED',
      summaryText: `${input.decision === 'ACCEPT' ? 'Accepted' : 'Returned'} the programme of works from ${who}${input.notes ? `: ${input.notes}` : '.'}`,
      payload: { submissionId: row.id, decision: input.decision, notes: input.notes ?? null, itemCount: proposal.items.length },
    });
    if (row.projectContractorId) {
      const pc = await tx.projectContractor.findUniqueOrThrow({ where: { id: row.projectContractorId }, select: { organizationId: true } });
      await createWebNotification(tx, {
        projectId,
        targetPermissionKey: 'schedule:propose_programme',
        targetOrganizationId: pc.organizationId,
        category: 'PROGRAMME_OF_WORKS',
        title: `Programme of works ${input.decision === 'ACCEPT' ? 'accepted' : 'returned'}`,
        description: input.notes ?? (input.decision === 'ACCEPT' ? 'Your programme is now the schedule baseline.' : 'See the notes and submit again.'),
        actionUrl: `/app/projects/${projectId}/schedule`,
        metadata: { submissionId: row.id },
      });
    }
  });
  if (input.decision === 'ACCEPT') await refreshScheduleBadge(projectId);
  return (await serialize([await prisma.programmeOfWorksSubmission.findUniqueOrThrow({ where: { id: submissionId }, include: INCLUDE })]))[0];
}
