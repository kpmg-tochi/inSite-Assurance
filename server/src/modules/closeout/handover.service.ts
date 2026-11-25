import { Prisma } from '@prisma/client';
import {
  HANDOVER_DECISION_LABELS,
  HandoverSubmissionDto,
  RecordHandoverResponseRequest,
  ReviewHandoverSubmissionRequest,
  sanitizeHandoverLine,
  sanitizeHandoverText,
} from '@insite/shared';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { recordAuditEvent } from '../audit/audit.service';
import { createWebNotification } from '../notifications/notifications.service';
import { assertModuleOn } from './closeoutGate';
import { issueHandoverCertificate } from '../completion/handoverCertificate.service';

/**
 * Handover responses (Phase 10, redesign R1d). The beneficiary has no login and there is no public
 * link (decision P2): an officer with handover:record_response records the response from the signed
 * paper copy and attests it. A user with handover:review_feedback reviews it; reviewing an accepted
 * response issues the handover certificate (Phase 15).
 */

type Db = Prisma.TransactionClient | typeof prisma;

const actorName = (u: WebJwtPayload) => `${u.fullName} (${u.roleName})`;

const SUBMISSION_INCLUDE = {
  defectTickets: { select: { id: true, sourceSnagIndex: true } },
} satisfies Prisma.HandoverSubmissionInclude;
type SubmissionRow = Prisma.HandoverSubmissionGetPayload<{ include: typeof SUBMISSION_INCLUDE }>;

interface StoredSnag {
  title: string;
  location: string | null;
  description: string | null;
}

async function serializeSubmissions(db: Db, rows: SubmissionRow[]): Promise<HandoverSubmissionDto[]> {
  const userIds = rows.flatMap((r) => [r.recordedByUserId, r.reviewedByUserId]).filter((v): v is string => Boolean(v));
  const users = await db.user.findMany({ where: { id: { in: [...new Set(userIds)] } }, select: { id: true, fullName: true } });
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((s) => {
    const snags = (Array.isArray(s.snagsJson) ? s.snagsJson : []) as unknown as StoredSnag[];
    const ticketBySnag = new Map(s.defectTickets.map((t) => [t.sourceSnagIndex, t.id]));
    return {
      id: s.id,
      stakeholderType: s.stakeholderType,
      decision: s.decision,
      submitterName: s.submitterName,
      submitterRole: s.submitterRole,
      feedbackText: s.feedbackText,
      snags: snags.map((snag, index) => ({
        index,
        title: snag.title,
        location: snag.location ?? null,
        description: snag.description ?? null,
        defectTicketId: ticketBySnag.get(index) ?? null,
      })),
      recordedByName: names.get(s.recordedByUserId) ?? null,
      submittedAt: s.submittedAt.toISOString(),
      reviewedAt: s.reviewedAt?.toISOString() ?? null,
      reviewedByName: s.reviewedByUserId ? names.get(s.reviewedByUserId) ?? null : null,
      reviewNotes: s.reviewNotes,
    };
  });
}

/** GET /projects/:projectId/handover/submissions */
export async function listHandoverSubmissions(projectId: string): Promise<HandoverSubmissionDto[]> {
  await assertModuleOn(projectId, 'handover');
  const rows = await prisma.handoverSubmission.findMany({ where: { projectId }, include: SUBMISSION_INCLUDE, orderBy: { submittedAt: 'desc' } });
  return serializeSubmissions(prisma, rows);
}

/** POST /projects/:projectId/handover/submissions: an officer records the beneficiary's response. */
export async function recordHandoverResponse(
  projectId: string,
  webUser: WebJwtPayload,
  input: RecordHandoverResponseRequest
): Promise<HandoverSubmissionDto> {
  await assertModuleOn(projectId, 'handover');
  const id = await prisma.$transaction(async (tx) => {
    const project = await tx.project.findUniqueOrThrow({ where: { id: projectId }, select: { constructionPhase: true, codePrefix: true } });
    if (project.constructionPhase !== 'HANDOVER_IN_PROGRESS') {
      throw new AppError('A handover response can only be recorded while the project is in handover.', 409, 'PROJECT_NOT_IN_HANDOVER');
    }
    const snags: StoredSnag[] = input.snags.map((s) => ({
      title: sanitizeHandoverLine(s.title, 160),
      location: s.location ? sanitizeHandoverLine(s.location, 200) : null,
      description: s.description ? sanitizeHandoverText(s.description, 2000) : null,
    }));
    const created = await tx.handoverSubmission.create({
      data: {
        projectId,
        stakeholderType: input.stakeholderType,
        decision: input.decision,
        submitterName: sanitizeHandoverLine(input.submitterName, 120),
        submitterRole: sanitizeHandoverLine(input.submitterRole, 120),
        feedbackText: sanitizeHandoverText(input.feedbackText, 8000),
        snagsJson: snags as unknown as Prisma.InputJsonValue,
        recordedByUserId: webUser.userId,
      },
    });
    const label = HANDOVER_DECISION_LABELS[created.decision].toLowerCase();
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'HANDOVER_RECORDED',
      summaryText: `Recorded the handover response of ${created.submitterName} (${created.submitterRole}): ${label}, ${snags.length} snag(s); attested against the signed copy.`,
      payload: {
        handoverSubmissionId: created.id,
        decision: created.decision,
        stakeholderType: created.stakeholderType,
        snagCount: snags.length,
        attested: true,
      },
    });
    await createWebNotification(tx, {
      projectId,
      targetPermissionKey: 'handover:review_feedback',
      category: 'HANDOVER_RECORDED',
      title: `${project.codePrefix}: handover response to review`,
      description: `${created.submitterName}: ${label}${snags.length ? `, ${snags.length} snag(s)` : ''}.`,
      actionUrl: `/app/projects/${projectId}/completion?tab=handover`,
      metadata: { handoverSubmissionId: created.id },
    });
    return created.id;
  });
  const row = await prisma.handoverSubmission.findUniqueOrThrow({ where: { id }, include: SUBMISSION_INCLUDE });
  return (await serializeSubmissions(prisma, [row]))[0];
}

/** POST /projects/:projectId/handover/submissions/:submissionId/review */
export async function reviewHandoverSubmission(
  projectId: string,
  submissionId: string,
  webUser: WebJwtPayload,
  input: ReviewHandoverSubmissionRequest
): Promise<HandoverSubmissionDto> {
  await assertModuleOn(projectId, 'handover');
  await prisma.$transaction(async (tx) => {
    const submission = await tx.handoverSubmission.findFirst({ where: { id: submissionId, projectId } });
    if (!submission) throw new AppError('Handover submission not found', 404, 'HANDOVER_SUBMISSION_NOT_FOUND');
    if (submission.reviewedAt) throw new AppError('This submission has already been reviewed', 409, 'HANDOVER_ALREADY_REVIEWED');
    // Four eyes: the officer who recorded (and attested) the response may not review it. No bypass.
    if (submission.recordedByUserId === webUser.userId) {
      throw new AppError('You recorded this handover response, so another officer must review it.', 409, 'SAME_PERSON_REVIEW');
    }
    const notes = input.notes ? sanitizeHandoverText(input.notes, 2000) : null;
    await tx.handoverSubmission.update({
      where: { id: submission.id },
      data: { reviewedAt: new Date(), reviewedByUserId: webUser.userId, reviewNotes: notes },
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'HANDOVER_REVIEWED',
      summaryText: `Reviewed the handover response of ${submission.submitterName} (${submission.decision})${notes ? `: ${notes}` : '.'}`,
      payload: { handoverSubmissionId: submission.id, decision: submission.decision, notes },
    });
    // Phase 15: an accepted response issues the handover certificate and completes the ceremony.
    await issueHandoverCertificate(tx, projectId, submission.id, webUser);
  });
  const row = await prisma.handoverSubmission.findUniqueOrThrow({ where: { id: submissionId }, include: SUBMISSION_INCLUDE });
  return (await serializeSubmissions(prisma, [row]))[0];
}
