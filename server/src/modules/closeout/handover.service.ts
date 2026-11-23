import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import {
  CreateHandoverLinkRequest,
  HandoverFileDto,
  HandoverLinkDto,
  HandoverLinkIssuedDto,
  HandoverLinkStatus,
  HandoverSubmissionDto,
  ReissueHandoverLinkRequest,
  ReviewHandoverSubmissionRequest,
  sanitizeHandoverLine,
  sanitizeHandoverText,
} from '@insite/shared';
import { env } from '../../config/env';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { WebJwtPayload } from '../../middleware/auth.middleware';
import { sendMessage } from '../../integrations/messaging';
import { recordAuditEvent } from '../audit/audit.service';
import { assertModuleOn } from './closeoutGate';
import { issueHandoverCertificate } from '../completion/handoverCertificate.service';

/**
 * Handover links, authenticated side (Phase 10 Step 2). A link carries a 256-bit random token;
 * only its SHA-256 is stored and the URL is returned once. The public side is in
 * handoverPublic.service.ts.
 */

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;

const actorName = (u: WebJwtPayload) => `${u.fullName} (${u.roleName})`;
const DAY_MS = 24 * 60 * 60 * 1000;

export function newHandoverToken(): { token: string; tokenHash: string } {
  const token = crypto.randomBytes(32).toString('base64url');
  return { token, tokenHash: hashHandoverToken(token) };
}

export function hashHandoverToken(token: string): string {
  return crypto.createHash('sha256').update(`handover-link:${token}`).digest('hex');
}

export function handoverUrl(token: string): string {
  return `${env.WEB_APP_BASE_URL}/handover/${token}`;
}

type LinkRow = Prisma.HandoverLinkGetPayload<{ include: { _count: { select: { submissions: true } } } }>;

export function linkStatusOf(
  link: Pick<LinkRow, 'revokedAt' | 'lockedAt' | 'expiresAt' | 'maxSubmissions'>,
  submissionCount: number,
  now = new Date()
): HandoverLinkStatus {
  if (link.revokedAt) return 'REVOKED';
  if (link.expiresAt <= now) return 'EXPIRED';
  if (link.lockedAt) return 'LOCKED';
  if (submissionCount >= link.maxSubmissions) return 'USED_UP';
  return 'ACTIVE';
}

async function serializeLinks(db: Db, rows: LinkRow[]): Promise<HandoverLinkDto[]> {
  const users = await db.user.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.createdByUserId))] } },
    select: { id: true, fullName: true },
  });
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((l) => ({
    id: l.id,
    label: l.label,
    recipientName: l.recipientName,
    recipientContact: l.recipientContact,
    stakeholderType: l.stakeholderType,
    handoverSummary: l.handoverSummary,
    requiresOtp: l.requiresOtp,
    expiresAt: l.expiresAt.toISOString(),
    maxSubmissions: l.maxSubmissions,
    submissionCount: l._count.submissions,
    status: linkStatusOf(l, l._count.submissions),
    revokedAt: l.revokedAt?.toISOString() ?? null,
    lastAccessedAt: l.lastAccessedAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
    createdByName: names.get(l.createdByUserId) ?? null,
    reissuedFromLinkId: l.reissuedFromLinkId,
  }));
}

const WITH_COUNT = { _count: { select: { submissions: true } } } as const;

async function assertInHandover(db: Db, projectId: string) {
  const project = await db.project.findUniqueOrThrow({ where: { id: projectId }, select: { constructionPhase: true } });
  if (project.constructionPhase !== 'HANDOVER_IN_PROGRESS') {
    throw new AppError('Handover links can only be issued while the project is in handover.', 409, 'PROJECT_NOT_IN_HANDOVER');
  }
}

async function deliverLink(projectId: string, link: { recipientName: string; recipientContact: string; requiresOtp: boolean; expiresAt: Date }, token: string) {
  const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, select: { tenantId: true, name: true, timezone: true } });
  const outcome = await sendMessage({
    tenantId: project.tenantId,
    projectId,
    channel: 'EMAIL',
    to: link.recipientContact,
    templateKey: 'HANDOVER_LINK',
    data: {
      recipientName: link.recipientName,
      projectName: project.name,
      handoverUrl: handoverUrl(token),
      expiresOn: link.expiresAt.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: project.timezone }),
      requiresCode: link.requiresOtp,
    },
  });
  return outcome.status;
}

/** POST /projects/:projectId/handover/links */
export async function createHandoverLink(projectId: string, webUser: WebJwtPayload, input: CreateHandoverLinkRequest): Promise<HandoverLinkIssuedDto> {
  await assertModuleOn(projectId, 'handover');
  const { token, tokenHash } = newHandoverToken();
  const link = await prisma.$transaction(async (tx) => {
    await assertInHandover(tx, projectId);
    const created = await tx.handoverLink.create({
      data: {
        projectId,
        tokenHash,
        label: sanitizeHandoverLine(input.label, 120),
        recipientName: sanitizeHandoverLine(input.recipientName, 120),
        recipientContact: input.recipientContact.toLowerCase(),
        stakeholderType: input.stakeholderType,
        handoverSummary: sanitizeHandoverText(input.handoverSummary, 4000),
        requiresOtp: input.requiresOtp,
        maxSubmissions: input.maxSubmissions,
        expiresAt: new Date(Date.now() + input.expiresInDays * DAY_MS),
        createdByUserId: webUser.userId,
      },
      include: WITH_COUNT,
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'HANDOVER_LINK_CREATED',
      summaryText: `Issued handover link "${created.label}" to ${created.recipientName} (${created.stakeholderType}), valid ${input.expiresInDays} day(s)${created.requiresOtp ? ', code required' : ''}.`,
      // Never the token or URL.
      payload: {
        handoverLinkId: created.id,
        stakeholderType: created.stakeholderType,
        requiresOtp: created.requiresOtp,
        maxSubmissions: created.maxSubmissions,
        expiresAt: created.expiresAt.toISOString(),
      },
    });
    return created;
  });
  const delivery = input.sendNow ? await deliverLink(projectId, link, token) : 'NOT_SENT';
  return { link: (await serializeLinks(prisma, [link]))[0], url: handoverUrl(token), delivery };
}

/** GET /projects/:projectId/handover/links */
export async function listHandoverLinks(projectId: string): Promise<HandoverLinkDto[]> {
  await assertModuleOn(projectId, 'handover');
  const rows = await prisma.handoverLink.findMany({ where: { projectId }, include: WITH_COUNT, orderBy: { createdAt: 'desc' } });
  return serializeLinks(prisma, rows);
}

async function revokeInTx(tx: Tx, projectId: string, linkId: string, webUser: WebJwtPayload, reason: string) {
  const link = await tx.handoverLink.findFirst({ where: { id: linkId, projectId } });
  if (!link) throw new AppError('Handover link not found', 404, 'HANDOVER_LINK_NOT_FOUND');
  if (link.revokedAt) return link;
  const revoked = await tx.handoverLink.update({
    where: { id: link.id },
    // Revoking also ends any code in flight.
    data: { revokedAt: new Date(), otpHash: null, otpExpiresAt: null },
  });
  await recordAuditEvent(tx, {
    projectId,
    actorType: 'WEB_USER',
    actorId: webUser.userId,
    actorDisplayName: actorName(webUser),
    action: 'HANDOVER_LINK_REVOKED',
    summaryText: `Revoked handover link "${link.label}" (${reason}).`,
    payload: { handoverLinkId: link.id, reason },
  });
  return revoked;
}

/** POST /projects/:projectId/handover/links/:linkId/revoke. Takes effect immediately. */
export async function revokeHandoverLink(projectId: string, linkId: string, webUser: WebJwtPayload): Promise<HandoverLinkDto> {
  await assertModuleOn(projectId, 'handover');
  await prisma.$transaction((tx) => revokeInTx(tx, projectId, linkId, webUser, 'revoked by user'));
  const row = await prisma.handoverLink.findUniqueOrThrow({ where: { id: linkId }, include: WITH_COUNT });
  return (await serializeLinks(prisma, [row]))[0];
}

/**
 * POST /projects/:projectId/handover/links/:linkId/reissue: revokes the old link and issues a new
 * token for the same recipient (also the way out of a code lockout).
 */
export async function reissueHandoverLink(
  projectId: string,
  linkId: string,
  webUser: WebJwtPayload,
  input: ReissueHandoverLinkRequest
): Promise<HandoverLinkIssuedDto> {
  await assertModuleOn(projectId, 'handover');
  const { token, tokenHash } = newHandoverToken();
  const link = await prisma.$transaction(async (tx) => {
    await assertInHandover(tx, projectId);
    const old = await tx.handoverLink.findFirst({ where: { id: linkId, projectId }, include: WITH_COUNT });
    if (!old) throw new AppError('Handover link not found', 404, 'HANDOVER_LINK_NOT_FOUND');
    await revokeInTx(tx, projectId, old.id, webUser, 're-issued');
    const created = await tx.handoverLink.create({
      data: {
        projectId,
        tokenHash,
        label: old.label,
        recipientName: old.recipientName,
        recipientContact: old.recipientContact,
        stakeholderType: old.stakeholderType,
        handoverSummary: old.handoverSummary,
        requiresOtp: old.requiresOtp,
        maxSubmissions: Math.max(1, old.maxSubmissions - old._count.submissions),
        expiresAt: new Date(Date.now() + input.expiresInDays * DAY_MS),
        reissuedFromLinkId: old.id,
        createdByUserId: webUser.userId,
      },
      include: WITH_COUNT,
    });
    await recordAuditEvent(tx, {
      projectId,
      actorType: 'WEB_USER',
      actorId: webUser.userId,
      actorDisplayName: actorName(webUser),
      action: 'HANDOVER_LINK_CREATED',
      summaryText: `Re-issued handover link "${created.label}" to ${created.recipientName}, valid ${input.expiresInDays} day(s).`,
      payload: { handoverLinkId: created.id, reissuedFromLinkId: old.id, expiresAt: created.expiresAt.toISOString() },
    });
    return created;
  });
  const delivery = input.sendNow ? await deliverLink(projectId, link, token) : 'NOT_SENT';
  return { link: (await serializeLinks(prisma, [link]))[0], url: handoverUrl(token), delivery };
}

// ---------------------------------------------------------------------------
// Submissions
// ---------------------------------------------------------------------------

const SUBMISSION_INCLUDE = {
  link: { select: { label: true, stakeholderType: true } },
  defectTickets: { select: { id: true, sourceSnagIndex: true } },
} satisfies Prisma.HandoverSubmissionInclude;
type SubmissionRow = Prisma.HandoverSubmissionGetPayload<{ include: typeof SUBMISSION_INCLUDE }>;

interface StoredSnag {
  title: string;
  location: string | null;
  description: string | null;
  photos: HandoverFileDto[];
}

async function serializeSubmissions(db: Db, rows: SubmissionRow[]): Promise<HandoverSubmissionDto[]> {
  const users = await db.user.findMany({
    where: { id: { in: rows.map((r) => r.reviewedByUserId).filter((v): v is string => Boolean(v)) } },
    select: { id: true, fullName: true },
  });
  const names = new Map(users.map((u) => [u.id, u.fullName]));
  return rows.map((s) => {
    const snags = (Array.isArray(s.snagsJson) ? s.snagsJson : []) as unknown as StoredSnag[];
    const ticketBySnag = new Map(s.defectTickets.map((t) => [t.sourceSnagIndex, t.id]));
    return {
      id: s.id,
      handoverLinkId: s.handoverLinkId,
      linkLabel: s.link.label,
      stakeholderType: s.link.stakeholderType,
      decision: s.decision,
      submitterName: s.submitterName,
      submitterRole: s.submitterRole,
      feedbackText: s.feedbackText,
      snags: snags.map((snag, index) => ({
        index,
        title: snag.title,
        location: snag.location,
        description: snag.description,
        photos: snag.photos,
        defectTicketId: ticketBySnag.get(index) ?? null,
      })),
      attachments: (Array.isArray(s.attachmentsJson) ? s.attachmentsJson : []) as unknown as HandoverFileDto[],
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
      summaryText: `Reviewed the handover submission from ${submission.submitterName} (${submission.decision})${notes ? `: ${notes}` : '.'}`,
      payload: { handoverSubmissionId: submission.id, decision: submission.decision, notes },
    });
    // Phase 15: an accepted response issues the handover certificate and completes the ceremony.
    await issueHandoverCertificate(tx, projectId, submission.id, webUser);
  });
  const row = await prisma.handoverSubmission.findUniqueOrThrow({ where: { id: submissionId }, include: SUBMISSION_INCLUDE });
  return (await serializeSubmissions(prisma, [row]))[0];
}
