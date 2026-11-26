import { Prisma } from '@prisma/client';
import {
  FindingsSummaryEmailData,
  ReviewVisitSubmissionRequest,
  validateVisitAnswers,
  VisitFormAnswer,
  VisitSubmissionDto,
  zonedCalendarDate,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import type { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { ensureChain, getChainVersionSteps, getProcessConfig } from '../process/processConfig.service';
import { assertMayAct, gateForStep, loadActions, nextApplicableStep, orgContextForStep, recordApprovalAction } from '../process/approvalChain';
import { createWebNotification } from '../notifications/notifications.service';
import { autoCompleteMilestones } from '../contracts/milestones.service';
import { refreshProjectProgress } from '../progress/progress.service';
import { refreshScheduleBadge } from '../schedule/schedule.service';
import { sendMessage } from '../../integrations/messaging';
import { getVisitFormSnapshot } from '../forms/visitForm.service';
import { defaultContractorId } from '../findings/findings.service';
import {
  flushVisitPushes,
  monitoringConfigOf,
  notifyOfficers,
  SYSTEM_VISIT_ACTOR,
  Tx,
  VisitActor,
  VisitPushQueue,
  visitLabel,
  webVisitActor,
  codeText,
  dayText,
  lowerFirst,
} from './visitCore';
import { refreshUnstartedVisitForms } from './visitForms';
import { cancelVisitRow } from './visits.service';

/**
 * Redesign R4d: a visit submission goes through the project's REPORT approval chain (subject
 * VISIT_SUBMISSION, D-R4.23). With report approval off, or no applicable step, it is accepted at once.
 * Both paths end in `acceptSubmission`, the one place the acceptance effects run (D-R4.24): findings,
 * re-check outcomes, unit progress, milestones and the contractor email.
 */

/** Work that must wait until the transaction commits (email, schedule badge). */
export interface AcceptanceOutbox {
  emails: Array<{ projectId: string; submissionId: string }>;
  refreshProjects: Set<string>;
  /** Client demo updates F.4: projects with an accepted report, for the contractor flag rule after commit. */
  acceptedProjects?: Set<string>;
}

const visitDay = (date: string) => new Date(`${date}T12:00:00.000Z`);

async function notifyPendingApproval(tx: Tx, s: { id: string; projectId: string; visitId: string; reporterName: string }, version: number, stepOrder: number, label: string) {
  const steps = await getChainVersionSteps(tx, s.projectId, 'REPORT', version);
  const step = steps.find((x) => x.stepOrder === stepOrder);
  if (!step) return;
  await createWebNotification(tx, {
    projectId: s.projectId,
    targetPermissionKey: step.requiredPermissionKey,
    targetRoleId: step.requiredRoleId,
    category: 'VISIT_PENDING_APPROVAL',
    title: `Monitoring report awaiting ${step.label} · ${label}`,
    description: `${s.reporterName}'s monitoring report (${lowerFirst(label)}) is waiting for "${step.label}" (step ${step.stepOrder} of ${steps.length}).`,
    actionUrl: `/app/projects/${s.projectId}/visits?visitId=${s.visitId}`,
    metadata: { visitId: s.visitId, visitSubmissionId: s.id, stepOrder: step.stepOrder, chainVersion: version },
  });
}

/** Called in the submit transaction: starts the chain, or accepts at once. */
export async function startSubmissionApproval(tx: Tx, submissionId: string, ctx: { pushes: VisitPushQueue; outbox: AcceptanceOutbox }): Promise<void> {
  const s = await tx.visitSubmission.findUniqueOrThrow({ where: { id: submissionId }, include: { visit: { select: { visitKind: true } } } });
  const config = await getProcessConfig(s.projectId, tx);
  if (config.requireReportApproval) {
    const chain = await ensureChain(tx, s.projectId, 'REPORT');
    const first = nextApplicableStep(chain.steps, 0, null);
    if (first) {
      await tx.visitSubmission.update({ where: { id: submissionId }, data: { status: 'PENDING_APPROVAL', approvalChainVersion: chain.version, currentApprovalStep: first.stepOrder } });
      await notifyPendingApproval(tx, s, chain.version, first.stepOrder, visitLabel(s.visit.visitKind));
      return;
    }
  }
  await acceptSubmission(tx, submissionId, { actor: SYSTEM_VISIT_ACTOR, ...ctx, notifyOfficer: false });
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

export async function reviewVisitSubmission(params: {
  projectId: string;
  visitId: string;
  submissionId: string;
  webUser: WebJwtPayload;
  input: ReviewVisitSubmissionRequest;
  load: (submissionId: string, viewer: WebJwtPayload) => Promise<VisitSubmissionDto>;
}): Promise<VisitSubmissionDto> {
  const { projectId, visitId, submissionId, webUser, input } = params;
  const pushes: VisitPushQueue = [];
  const outbox: AcceptanceOutbox = { emails: [], refreshProjects: new Set() };
  await prisma.$transaction(async (tx) => {
    const found = await tx.visitSubmission.findFirst({ where: { id: submissionId, visitId, projectId }, select: { id: true } });
    if (!found) throw new AppError('Submission not found', 404, 'VISIT_SUBMISSION_NOT_FOUND');
    await tx.$queryRaw`SELECT id FROM "visit_submissions" WHERE id = ${submissionId}::uuid FOR UPDATE`;
    const s = await tx.visitSubmission.findUniqueOrThrow({ where: { id: submissionId }, include: { visit: { select: { visitKind: true, plannedDate: true } } } });
    if (s.status !== 'PENDING_APPROVAL' || s.approvalChainVersion === null) {
      throw new AppError('This submission is not waiting for approval', 409, 'VISIT_SUBMISSION_NOT_PENDING', { status: s.status });
    }
    const steps = await getChainVersionSteps(tx, projectId, 'REPORT', s.approvalChainVersion);
    const step = steps.find((x) => x.stepOrder === s.currentApprovalStep) ?? null;
    const actions = await loadActions(tx, 'VISIT_SUBMISSION', s.id);
    assertMayAct(
      gateForStep({
        webUser,
        step,
        actions,
        orgContext: await orgContextForStep(tx, projectId, step),
        excludedUserId: s.submittedByUserId,
        excludedReason: 'You carried out this monitoring visit, so someone else must review it.',
      }),
      step
    );
    await recordApprovalAction(tx, {
      projectId,
      chainType: 'REPORT',
      subjectType: 'VISIT_SUBMISSION',
      subjectId: s.id,
      step: step!,
      decision: input.decision,
      actorUserId: webUser.userId,
      notes: input.notes ?? null,
    });
    const label = visitLabel(s.visit.visitKind);
    const actor = webVisitActor(webUser);
    const audit = (summaryText: string, extra: Record<string, unknown> = {}) =>
      recordAuditEvent(tx, {
        projectId,
        actorType: actor.actorType,
        actorId: actor.actorId,
        actorDisplayName: actor.actorDisplayName,
        action: 'VISIT_REVIEWED',
        summaryText,
        payload: { visitId, visitSubmissionId: s.id, decision: input.decision, stepOrder: step!.stepOrder, chainVersion: s.approvalChainVersion, notes: input.notes ?? null, ...extra },
      });

    if (input.decision === 'RETURN') {
      await tx.visitSubmission.update({ where: { id: s.id }, data: { status: 'RETURNED', currentApprovalStep: 0, returnedAt: new Date(), returnedNotes: input.notes ?? null } });
      await tx.visit.update({ where: { id: visitId }, data: { status: 'RETURNED' } });
      await tx.visitComment.create({ data: { visitId, submissionId: s.id, authorUserId: webUser.userId, authorName: webUser.fullName, text: `Returned at "${step!.label}": ${input.notes}` } });
      const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { codePrefix: true } });
      await notifyOfficers(tx, pushes, {
        projectId,
        visitId,
        userIds: [s.submittedByUserId],
        type: 'VISIT_RETURNED',
        title: `${label} returned`,
        message: `${codeText(project.codePrefix)}: your ${lowerFirst(label)} of ${dayText(s.visit.plannedDate)} was returned: ${input.notes}. Correct it and submit again.`,
        submissionId: s.id,
      });
      await audit(`Returned the ${lowerFirst(label)} of ${s.visit.plannedDate} at step ${step!.stepOrder} "${step!.label}": ${input.notes}`);
      return;
    }
    const next = nextApplicableStep(steps, step!.stepOrder, null);
    if (next) {
      await tx.visitSubmission.update({ where: { id: s.id }, data: { currentApprovalStep: next.stepOrder } });
      await notifyPendingApproval(tx, s, s.approvalChainVersion, next.stepOrder, label);
      await audit(`Approved step ${step!.stepOrder} "${step!.label}" of the ${lowerFirst(label)} of ${s.visit.plannedDate}; now at "${next.label}".`, { nextStepOrder: next.stepOrder });
      return;
    }
    await audit(`Approved the ${lowerFirst(label)} of ${s.visit.plannedDate} at the final step "${step!.label}".`);
    await acceptSubmission(tx, s.id, { actor, pushes, outbox, notifyOfficer: true });
  });
  await flushVisitPushes(pushes);
  await afterAcceptanceCommitted(outbox);
  return params.load(submissionId, webUser);
}

// ---------------------------------------------------------------------------
// Acceptance effects (D-R4.24)
// ---------------------------------------------------------------------------

/** Accepts a submission and runs every effect, in the caller's transaction. */
export async function acceptSubmission(
  tx: Tx,
  submissionId: string,
  ctx: { actor: VisitActor; pushes: VisitPushQueue; outbox: AcceptanceOutbox; notifyOfficer: boolean; now?: Date }
): Promise<void> {
  const now = ctx.now ?? new Date();
  const s = await tx.visitSubmission.findUniqueOrThrow({
    where: { id: submissionId },
    include: { visit: true, project: { select: { id: true, codePrefix: true, timezone: true, projectTypeSnapshotJson: true } }, captures: { select: { id: true, clientCaptureId: true, visitAnswerPath: true } } },
  });
  await tx.visitSubmission.update({ where: { id: submissionId }, data: { status: 'APPROVED', approvedAt: now, currentApprovalStep: 0 } });
  await tx.visit.update({ where: { id: s.visitId }, data: { status: 'APPROVED' } });
  (ctx.outbox.acceptedProjects ??= new Set()).add(s.projectId);

  const { snapshot } = await getVisitFormSnapshot(tx, s.formSnapshotId);
  const answers = (Array.isArray(s.answersJson) ? s.answersJson : []) as VisitFormAnswer[];
  const check = validateVisitAnswers(snapshot, answers);
  const visit = s.visit;
  const label = visitLabel(visit.visitKind);
  const audit = (action: 'INSPECTION_FINDING_RAISED' | 'INSPECTION_FINDING_RESOLVED' | 'VISIT_UPDATED', summaryText: string, payload: Record<string, unknown>) =>
    recordAuditEvent(tx, { projectId: s.projectId, actorType: 'SYSTEM', actorId: 'visits', actorDisplayName: 'System (visits)', action, summaryText, payload });

  // 1. Findings from the form's rules (one open finding per question; an open one is re-checked instead).
  const contractorId = await defaultContractorId(tx, s.projectId);
  const raised: string[] = [];
  const fields = new Map(snapshot.blocks.flatMap((b) => b.fields.map((f) => [f.path, { f, b }] as const)));
  for (const fr of check.findingsToRaise) {
    const open = await tx.finding.count({ where: { projectId: s.projectId, questionKey: fr.path, status: 'OPEN' } });
    if (open > 0) continue;
    const block = fields.get(fr.path)?.b;
    const comment = answers.find((a) => a.path === fr.path)?.comment?.trim();
    const finding = await tx.finding.create({
      data: {
        projectId: s.projectId,
        visitId: visit.id,
        visitSubmissionId: s.id,
        checklistItemKey: fr.fieldKey,
        questionKey: fr.path,
        title: block?.facility ? `${block.facility.name}: ${fr.label}` : fr.label,
        facilityId: fr.facilityId,
        facilityUnitId: fr.unitId,
        projectContractorId: contractorId,
        description: `${fr.label}: ${fr.answerText}${comment ? `. ${comment}` : ''}`,
        severity: fr.severity,
        raisedByUserId: s.submittedByUserId,
        raisedByName: s.reporterName,
      },
    });
    raised.push(finding.id);
  }
  if (raised.length) {
    await audit('INSPECTION_FINDING_RAISED', `The ${lowerFirst(label)} of ${visit.plannedDate} raised ${raised.length} finding(s).`, { visitId: visit.id, visitSubmissionId: s.id, findingIds: raised });
  }

  // 2. Re-check outcomes: "resolved" closes the finding with the answer's photos; otherwise it is counted.
  const resolved: string[] = [];
  for (const r of check.recheckResults) {
    const finding = await tx.finding.findFirst({ where: { id: r.recheckId, projectId: s.projectId, status: 'OPEN' } });
    if (!finding) continue;
    const answer = answers.find((a) => a.path === `r:${r.recheckId}`);
    if (r.resolved) {
      const photoIds = s.captures.filter((c) => c.visitAnswerPath === `r:${r.recheckId}`).map((c) => c.id);
      await tx.finding.update({
        where: { id: finding.id },
        data: {
          status: 'RESOLVED',
          resolvedNotes: answer?.comment?.trim() || `Rectified on the ${lowerFirst(label)} of ${dayText(visit.plannedDate)}.`,
          resolutionCaptureIds: photoIds,
          resolvedByUserId: s.submittedByUserId,
          resolvedByName: s.reporterName,
          resolvedAt: now,
          recheckCount: { increment: 1 },
          lastRecheckedSubmissionId: s.id,
          lastRecheckedAt: now,
        },
      });
      resolved.push(finding.id);
    } else {
      await tx.finding.update({ where: { id: finding.id }, data: { recheckCount: { increment: 1 }, lastRecheckedSubmissionId: s.id, lastRecheckedAt: now } });
    }
  }
  if (resolved.length) {
    await audit('INSPECTION_FINDING_RESOLVED', `The ${lowerFirst(label)} of ${visit.plannedDate} resolved ${resolved.length} finding(s).`, {
      visitId: visit.id,
      visitSubmissionId: s.id,
      findingIds: resolved,
      outcome: 'RESOLVED',
    });
  }
  if (raised.length || resolved.length) await refreshUnstartedVisitForms(tx, s.projectId, { timezone: s.project.timezone, now });

  // 3. Unit progress (D-R4.26): an observation, so a later visit can lower it.
  const progress = new Map<string, number>();
  for (const p of check.signals.percentComplete) for (const id of p.unitIds) progress.set(id, Math.max(0, Math.min(100, p.value)));
  for (const q of check.signals.quantityDelivered) {
    if (q.plannedQuantity === null || q.plannedQuantity <= 0) continue;
    const pct = Math.max(0, Math.min(100, (q.value / q.plannedQuantity) * 100));
    for (const id of q.unitIds) progress.set(id, pct);
  }
  for (const id of check.signals.unitComplete) progress.set(id, 100);
  if (progress.size) {
    // UBEC IRL (STALLED alert): record which units this visit moved forward, dated on the visit.
    const before = await tx.facilityUnit.findMany({ where: { id: { in: [...progress.keys()] }, projectId: s.projectId }, select: { id: true, progressPct: true } });
    const raisedUnits = before
      .map((u) => ({ unitId: u.id, from: u.progressPct === null ? null : Number(u.progressPct), to: Math.round(progress.get(u.id)! * 100) / 100 }))
      .filter((u) => u.to > (u.from ?? 0));
    if (raisedUnits.length) {
      await audit('VISIT_UPDATED', `The ${lowerFirst(label)} of ${visit.plannedDate} raised the progress of ${raisedUnits.length} facility unit(s).`, {
        visitId: visit.id,
        visitSubmissionId: s.id,
        progressIncrease: { asOf: visit.plannedDate, units: raisedUnits },
      });
    }
    for (const [unitId, pct] of progress) {
      await tx.facilityUnit.updateMany({
        where: { id: unitId, projectId: s.projectId },
        data: { progressPct: Math.round(pct * 100) / 100, progressAsOf: visit.plannedDate, progressSubmissionId: s.id },
      });
    }
    await refreshProjectProgress(tx, s.projectId);
    ctx.outbox.refreshProjects.add(s.projectId);
  }

  // 4. Milestones.
  if (visit.visitKind === 'MOBILISATION_CHECK' && check.signals.contractorOnSite) {
    const done = await autoCompleteMilestones(tx, {
      projectId: s.projectId,
      mode: 'AUTO_CONTRACTOR_ON_SITE',
      at: visitDay(visit.plannedDate),
      notes: `Contractor mobilised to site, confirmed at the mobilisation check of ${dayText(visit.plannedDate)}.`,
      actor: { actorType: ctx.actor.actorType, actorId: ctx.actor.actorId, actorDisplayName: ctx.actor.actorDisplayName, userId: ctx.actor.userId },
    });
    const later = await tx.visit.findMany({
      where: { projectId: s.projectId, visitKind: 'MOBILISATION_CHECK', id: { not: visit.id }, status: { in: ['PROPOSED', 'PLANNED'] }, checkInAt: null },
      select: { id: true },
    });
    for (const v of later) await cancelVisitRow(tx, v, { reason: `The contractor was on site at the mobilisation check of ${dayText(visit.plannedDate)}.`, userId: null });
    if (done || later.length) {
      await audit('VISIT_UPDATED', `Mobilisation confirmed by the monitoring visit of ${visit.plannedDate}: ${done} milestone(s) completed, ${later.length} later mobilisation check(s) cancelled.`, {
        visitId: visit.id,
        cancelledVisitIds: later.map((v) => v.id),
      });
    }
  }
  if (visit.visitKind === 'FINAL_EVALUATION' || visit.visitKind === 'POST_CLOSURE_EVALUATION') {
    const post = visit.visitKind === 'POST_CLOSURE_EVALUATION';
    await autoCompleteMilestones(tx, {
      projectId: s.projectId,
      mode: 'AUTO_FINAL_EVALUATION_APPROVED',
      onlyDated: post,
      ...(post ? { anchorIn: ['PROJECT_CLOSED' as const] } : { anchorNotIn: ['PROJECT_CLOSED' as const] }),
      at: now,
      notes: `${label} of ${dayText(visit.plannedDate)} accepted.`,
      actor: { actorType: ctx.actor.actorType, actorId: ctx.actor.actorId, actorDisplayName: ctx.actor.actorDisplayName, userId: ctx.actor.userId },
    });
  }

  // 5. Contractor email (after commit).
  const config = monitoringConfigOf(s.project.projectTypeSnapshotJson);
  if (config.emailContractorFindingsSummary) {
    const open = await tx.finding.count({ where: { projectId: s.projectId, status: 'OPEN' } });
    if (open > 0 || resolved.length > 0) ctx.outbox.emails.push({ projectId: s.projectId, submissionId: s.id });
  }

  if (ctx.notifyOfficer) {
    await notifyOfficers(tx, ctx.pushes, {
      projectId: s.projectId,
      visitId: visit.id,
      userIds: [s.submittedByUserId],
      type: 'VISIT_APPROVED',
      title: `${label} accepted`,
      message: `${codeText(s.project.codePrefix)}: your ${lowerFirst(label)} of ${dayText(visit.plannedDate)} was accepted.`,
      submissionId: s.id,
    });
  }
}

/** Runs what had to wait for the commit: schedule badges and contractor emails. */
export async function afterAcceptanceCommitted(outbox: AcceptanceOutbox): Promise<void> {
  for (const projectId of outbox.refreshProjects) await refreshScheduleBadge(projectId).catch((e) => console.warn('[visits] badge refresh failed:', e));
  for (const e of outbox.emails) await sendFindingsSummary(e.projectId, e.submissionId).catch((err) => console.warn('[visits] findings summary failed:', err));
  // Client demo updates F.4: contractor flag rule and rating refresh (never fails the acceptance).
  for (const projectId of outbox.acceptedProjects ?? []) {
    await import('../contractorFlags/contractorFlags.service')
      .then((m) => m.evaluateFlagsAfterAcceptance(projectId))
      .catch((err) => console.warn('[visits] contractor flag evaluation failed:', err));
  }
}

/** The open findings summary to the contractor organisation (D-R4.29). Audited either way. */
export async function sendFindingsSummary(projectId: string, submissionId: string): Promise<'SENT' | 'QUEUED' | 'FAILED' | 'SKIPPED'> {
  const s = await prisma.visitSubmission.findUniqueOrThrow({
    where: { id: submissionId },
    include: {
      visit: { select: { id: true, visitKind: true, plannedDate: true } },
      project: { select: { tenantId: true, codePrefix: true, name: true, timezone: true, contractors: { include: { organization: { select: { name: true, contactEmail: true } } }, orderBy: { createdAt: 'asc' } } } },
    },
  });
  const contractor = s.project.contractors[0]?.organization ?? null;
  const [open, resolvedHere] = await Promise.all([
    prisma.finding.findMany({ where: { projectId, status: 'OPEN' }, orderBy: { createdAt: 'asc' }, take: 100 }),
    prisma.finding.findMany({ where: { projectId, status: 'RESOLVED', lastRecheckedSubmissionId: submissionId } }),
  ]);
  const ids = [...open, ...resolvedHere];
  const [facilities, units] = await Promise.all([
    prisma.facility.findMany({ where: { id: { in: ids.map((f) => f.facilityId).filter((x): x is string => Boolean(x)) } }, select: { id: true, name: true } }),
    prisma.facilityUnit.findMany({ where: { id: { in: ids.map((f) => f.facilityUnitId).filter((x): x is string => Boolean(x)) } }, select: { id: true, label: true } }),
  ]);
  const fName = new Map(facilities.map((f) => [f.id, f.name]));
  const uName = new Map(units.map((u) => [u.id, u.label]));
  const data: FindingsSummaryEmailData = {
    projectCode: codeText(s.project.codePrefix),
    projectName: s.project.name,
    visitLabel: visitLabel(s.visit.visitKind),
    visitDate: dayText(s.visit.plannedDate),
    open: open.map((f) => ({
      facility: f.facilityId ? (fName.get(f.facilityId) ?? null) : null,
      unit: f.facilityUnitId ? (uName.get(f.facilityUnitId) ?? null) : null,
      title: f.title ?? f.checklistItemKey,
      description: f.description,
      severity: f.severity,
      raisedDate: dayText(zonedCalendarDate(f.createdAt, s.project.timezone)),
      timesRechecked: f.recheckCount,
    })),
    resolved: resolvedHere.map((f) => ({
      facility: f.facilityId ? (fName.get(f.facilityId) ?? null) : null,
      unit: f.facilityUnitId ? (uName.get(f.facilityUnitId) ?? null) : null,
      title: f.title ?? f.checklistItemKey,
    })),
  };
  let status: 'SENT' | 'QUEUED' | 'FAILED' | 'SKIPPED' = 'SKIPPED';
  let messageId: string | null = null;
  if (contractor?.contactEmail) {
    const outcome = await sendMessage({ tenantId: s.project.tenantId, projectId, channel: 'EMAIL', to: contractor.contactEmail, templateKey: 'FINDINGS_SUMMARY', data });
    status = outcome.status;
    messageId = 'messageId' in outcome ? (outcome.messageId ?? null) : null;
  }
  await recordAuditEvent(prisma, {
    projectId,
    actorType: 'SYSTEM',
    actorId: 'visits',
    actorDisplayName: 'System (visits)',
    action: 'FINDINGS_SUMMARY_SENT',
    summaryText: contractor?.contactEmail
      ? `Findings summary after the ${lowerFirst(data.visitLabel)} of ${data.visitDate} sent to ${contractor.name} (${data.open.length} open, ${data.resolved.length} resolved): ${status.toLowerCase()}.`
      : `Findings summary after the ${lowerFirst(data.visitLabel)} of ${data.visitDate} not sent: ${contractor ? `${contractor.name} has no contact email` : 'the project has no contractor'}.`,
    payload: { visitId: s.visit.id, visitSubmissionId: submissionId, status, messageId, open: data.open.length, resolved: data.resolved.length },
  });
  return status;
}

export type { Prisma };
