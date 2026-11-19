import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { Prisma } from '@prisma/client';
import {
  HANDOVER_LIMITS,
  HANDOVER_PART_BYTES,
  HandoverMultipartDto,
  HandoverMultipartPartsRequest,
  HandoverMultipartPartUrl,
  HandoverMultipartStatusDto,
  handoverPartCount,
  handoverPartSize,
  HandoverUploadTicketRequest,
  HANDOVER_UPLOAD_POLICY,
  HandoverFileDto,
  HandoverFileInput,
  HandoverPresignDto,
  HandoverPresignRequest,
  HandoverSessionDto,
  HandoverSubmittedDto,
  handoverUploadKind,
  PublicHandoverInfoDto,
  sanitizeHandoverLine,
  sanitizeHandoverText,
  SubmitHandoverRequest,
} from '@insite/shared';
import { env } from '../../config/env';
import { prisma } from '../../config/prisma';
import { AppError } from '../../middleware/error.middleware';
import { sendMessage } from '../../integrations/messaging';
import { handoverObjectPrefix, storageService } from '../../integrations/storage.service';
import { recordAuditEvent } from '../audit/audit.service';
import { createWebNotification } from '../notifications/notifications.service';
import { parseTenantBranding } from '../rbac/rbac.service';
import { getProcessConfig } from '../process/processConfig.service';
import { hashHandoverToken } from './handover.service';

/**
 * Public handover endpoints (Phase 10 Step 3): the most exposed surface in the system.
 *
 * - The link token is 256 random bits; only its hash is stored. Unknown, expired, revoked, or
 *   no-longer-in-handover links all get the same 404.
 * - With a code required, a six-digit code (hashed, ten minutes, five attempts, then the link is
 *   locked until re-issued) unlocks a short-lived handover session token. That token is signed
 *   with its own key, so it cannot authenticate any other route, and it is bound to one link.
 * - Uploads are allow-listed, size-capped per file and per link, and live under the link's own
 *   prefix; they are never field evidence.
 */

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;
const SESSION_TOKEN_TYPE = 'HANDOVER_SESSION';

function notFound(): AppError {
  return new AppError('This link is not valid. Ask the project team for a new one.', 404, 'HANDOVER_LINK_NOT_FOUND');
}

/** Session tokens use a key derived for this purpose only; the main JWT verifier rejects them. */
function sessionSecret(): string {
  return crypto.createHmac('sha256', env.JWT_SECRET).update('handover-session-v1').digest('hex');
}

function otpHash(linkId: string, code: string): string {
  return crypto.createHmac('sha256', env.JWT_SECRET).update(`handover-otp:${linkId}:${code}`).digest('hex');
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'hex');
  const y = Buffer.from(b, 'hex');
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

const LINK_INCLUDE = {
  project: {
    select: {
      id: true,
      name: true,
      status: true,
      stateLocation: true,
      lgaLocation: true,
      tenantId: true,
      constructionPhase: true,
      tenant: { select: { name: true, status: true, brandingConfig: true } },
    },
  },
  _count: { select: { submissions: true } },
} satisfies Prisma.HandoverLinkInclude;
type PublicLink = Prisma.HandoverLinkGetPayload<{ include: typeof LINK_INCLUDE }>;

/**
 * Resolves a token to a usable link, or throws the generic 404. A malformed token still costs one
 * hash so timing does not separate "malformed" from "unknown".
 */
export async function resolveLink(token: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<PublicLink> {
  const wellFormed = TOKEN_RE.test(token);
  const tokenHash = hashHandoverToken(wellFormed ? token : 'x'.repeat(43));
  if (!wellFormed) throw notFound();
  const link = await db.handoverLink.findUnique({ where: { tokenHash }, include: LINK_INCLUDE });
  if (
    !link ||
    link.revokedAt ||
    link.expiresAt <= new Date() ||
    link.project.status !== 'ACTIVE' ||
    link.project.tenant.status === 'SUSPENDED' ||
    link.project.constructionPhase !== 'HANDOVER_IN_PROGRESS'
  ) {
    throw notFound();
  }
  const config = await getProcessConfig(link.projectId, db);
  if (!config.enableHandoverModule) throw notFound();
  return link;
}

function assertNotLocked(link: Pick<PublicLink, 'lockedAt'>) {
  if (link.lockedAt) {
    throw new AppError(
      'This link is locked after too many wrong codes. Ask the project team to send you a new link.',
      423,
      'HANDOVER_LINK_LOCKED'
    );
  }
}

function maskEmail(address: string): string {
  const [user, domain] = address.split('@');
  if (!domain) return '***';
  return `${user.slice(0, 1)}***@${domain}`;
}

/** GET /public/handover/:token */
export async function getPublicHandoverInfo(token: string): Promise<PublicHandoverInfoDto> {
  const link = await resolveLink(token);
  await prisma.handoverLink.update({ where: { id: link.id }, data: { lastAccessedAt: new Date() } });
  const branding = parseTenantBranding(link.project.tenant.brandingConfig);
  const location = [link.project.lgaLocation, link.project.stateLocation].filter(Boolean).join(', ');
  return {
    tenantName: link.project.tenant.name,
    // Only absolute https logos are passed on; anything else is dropped.
    logoUrl: branding.logoUrl && /^https:\/\//.test(branding.logoUrl) ? branding.logoUrl : null,
    primaryColorHex: /^#[0-9a-fA-F]{6}$/.test(branding.primaryColorHex ?? '') ? branding.primaryColorHex : null,
    projectName: link.project.name,
    projectLocation: location,
    handoverSummary: link.handoverSummary,
    recipientName: link.recipientName,
    requiresCode: link.requiresOtp,
    codeDestination: link.requiresOtp ? maskEmail(link.recipientContact) : null,
    submissionsRemaining: Math.max(0, link.maxSubmissions - link._count.submissions),
    expiresAt: link.expiresAt.toISOString(),
  };
}

/** POST /public/handover/:token/otp/request */
export async function requestHandoverCode(token: string): Promise<{ sent: boolean; destination: string }> {
  const link = await resolveLink(token);
  assertNotLocked(link);
  if (!link.requiresOtp) throw new AppError('This link does not need a code', 409, 'HANDOVER_CODE_NOT_REQUIRED');
  const code = String(crypto.randomInt(0, 1_000_000)).padStart(HANDOVER_LIMITS.otpDigits, '0');
  await prisma.handoverLink.update({
    where: { id: link.id },
    data: { otpHash: otpHash(link.id, code), otpExpiresAt: new Date(Date.now() + HANDOVER_LIMITS.otpTtlMinutes * 60_000) },
  });
  const outcome = await sendMessage({
    tenantId: link.project.tenantId,
    projectId: link.projectId,
    channel: 'EMAIL',
    to: link.recipientContact,
    templateKey: 'HANDOVER_CODE',
    data: {
      recipientName: link.recipientName,
      projectName: link.project.name,
      oneTimeCode: code,
      validMinutes: HANDOVER_LIMITS.otpTtlMinutes,
    },
  });
  return { sent: outcome.status === 'SENT' || outcome.status === 'QUEUED', destination: maskEmail(link.recipientContact) };
}

function issueSession(linkId: string): HandoverSessionDto {
  const expiresInSeconds = HANDOVER_LIMITS.sessionTtlMinutes * 60;
  const sessionToken = jwt.sign({ tokenType: SESSION_TOKEN_TYPE, linkId }, sessionSecret(), {
    expiresIn: expiresInSeconds,
    audience: 'handover',
  });
  return { sessionToken, expiresAt: new Date(Date.now() + expiresInSeconds * 1000).toISOString() };
}

/** POST /public/handover/:token/otp/verify */
export async function verifyHandoverCode(token: string, code: string): Promise<HandoverSessionDto> {
  // The failed-attempt count must be committed, so the transaction returns an outcome and the
  // error is thrown after it commits.
  const outcome = await prisma.$transaction(async (tx) => {
    const ref = await resolveLink(token, tx);
    await tx.$queryRaw`SELECT id FROM "handover_links" WHERE id = ${ref.id}::uuid FOR UPDATE`;
    const link = await tx.handoverLink.findUniqueOrThrow({ where: { id: ref.id } });
    assertNotLocked(link);
    if (!link.requiresOtp) return { ok: true as const, linkId: link.id };
    const valid =
      Boolean(link.otpHash) &&
      Boolean(link.otpExpiresAt && link.otpExpiresAt > new Date()) &&
      timingSafeEqualHex(link.otpHash!, otpHash(link.id, code));
    if (valid) {
      // One use only.
      await tx.handoverLink.update({ where: { id: link.id }, data: { otpHash: null, otpExpiresAt: null, otpAttempts: 0 } });
      return { ok: true as const, linkId: link.id };
    }
    const attempts = link.otpAttempts + 1;
    const locked = attempts >= HANDOVER_LIMITS.otpMaxAttempts;
    await tx.handoverLink.update({
      where: { id: link.id },
      data: { otpAttempts: attempts, ...(locked ? { lockedAt: new Date(), otpHash: null, otpExpiresAt: null } : {}) },
    });
    return { ok: false as const, locked, attemptsRemaining: HANDOVER_LIMITS.otpMaxAttempts - attempts };
  });
  if (outcome.ok) return issueSession(outcome.linkId);
  if (outcome.locked) assertNotLocked({ lockedAt: new Date() });
  throw new AppError('That code is not right, or it has expired. Ask for a new code.', 422, 'HANDOVER_CODE_INVALID', {
    attemptsRemaining: outcome.attemptsRemaining,
  });
}

/** POST /public/handover/:token/session: links without a code start a session directly. */
export async function startHandoverSession(token: string): Promise<HandoverSessionDto> {
  const link = await resolveLink(token);
  assertNotLocked(link);
  if (link.requiresOtp) throw new AppError('Enter the code we sent you first', 409, 'HANDOVER_CODE_REQUIRED');
  return issueSession(link.id);
}

/** Checks the session bearer token: valid, ours, and bound to this link. Returns the link. */
export async function requireHandoverSession(token: string, authorization: string | undefined): Promise<PublicLink> {
  const link = await resolveLink(token);
  assertNotLocked(link);
  const bearer = authorization?.startsWith('Bearer ') ? authorization.slice(7).trim() : '';
  let claims: { tokenType?: string; linkId?: string } | null = null;
  try {
    claims = jwt.verify(bearer, sessionSecret(), { audience: 'handover' }) as { tokenType?: string; linkId?: string };
  } catch {
    claims = null;
  }
  if (!claims || claims.tokenType !== SESSION_TOKEN_TYPE || claims.linkId !== link.id) {
    throw new AppError('Your session has ended. Open the link again to continue.', 403, 'HANDOVER_SESSION_INVALID');
  }
  return link;
}

function extensionFor(fileName: string, kind: keyof typeof HANDOVER_UPLOAD_POLICY, mimeType: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
  if (HANDOVER_UPLOAD_POLICY[kind].extensions.includes(ext)) return ext;
  return mimeType.split('/')[1]?.replace(/[^a-z0-9]/g, '').slice(0, 5) || 'bin';
}

/** Type and size checks shared by single and multipart uploads. */
function checkUploadAllowed(input: HandoverPresignRequest) {
  const mimeType = input.mimeType.toLowerCase().split(';')[0].trim();
  const kind = handoverUploadKind(mimeType);
  if (!kind) {
    throw new AppError('Only photos, PDF documents, audio and video can be uploaded.', 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  const policy = HANDOVER_UPLOAD_POLICY[kind];
  if (input.byteSize > policy.maxBytes) {
    throw new AppError(`This file is too large. The limit is ${Math.round(policy.maxBytes / (1024 * 1024))} MB.`, 413, 'FILE_TOO_LARGE');
  }
  return { mimeType, kind };
}

/** Reserves the file's bytes against the per-link caps (atomic). */
async function reserveUpload(link: PublicLink, byteSize: number) {
  const reserved = await prisma.$executeRaw`
    UPDATE "handover_links"
       SET "reservedUploadBytes" = "reservedUploadBytes" + ${byteSize},
           "reservedUploadCount" = "reservedUploadCount" + 1
     WHERE id = ${link.id}::uuid
       AND "reservedUploadBytes" + ${byteSize} <= ${HANDOVER_LIMITS.perLinkTotalBytes}
       AND "reservedUploadCount" < ${HANDOVER_LIMITS.perLinkMaxFiles}`;
  if (reserved === 0) {
    throw new AppError('You have reached the upload limit for this link.', 413, 'HANDOVER_UPLOAD_LIMIT');
  }
}

// ---------------------------------------------------------------------------
// Resumable uploads. The upload ticket is a signed record of one multipart upload, bound to the
// link; nothing is stored server-side beyond the storage provider's own upload.
// ---------------------------------------------------------------------------

interface UploadTicket {
  linkId: string;
  objectKey: string;
  uploadId: string;
  byteSize: number;
  mimeType: string;
}

function ticketKey(): string {
  return crypto.createHmac('sha256', env.JWT_SECRET).update('handover-upload-ticket-v1').digest('hex');
}

function signTicket(t: UploadTicket): string {
  const body = Buffer.from(JSON.stringify(t)).toString('base64url');
  const sig = crypto.createHmac('sha256', ticketKey()).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function readTicket(link: PublicLink, ticket: string): UploadTicket {
  const [body, sig] = ticket.split('.');
  const expected = body ? crypto.createHmac('sha256', ticketKey()).update(body).digest('base64url') : '';
  const valid = Boolean(body && sig) && sig.length === expected.length && crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
  if (!valid) throw new AppError('This upload is not valid. Add the file again.', 400, 'UPLOAD_TICKET_INVALID');
  const t = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as UploadTicket;
  if (t.linkId !== link.id) throw new AppError('This upload is not valid. Add the file again.', 400, 'UPLOAD_TICKET_INVALID');
  return t;
}

/** POST /public/handover/:token/uploads/multipart/start */
export async function startHandoverMultipart(link: PublicLink, input: HandoverPresignRequest): Promise<HandoverMultipartDto> {
  const { mimeType, kind } = checkUploadAllowed(input);
  await reserveUpload(link, input.byteSize);
  const objectKey = `${handoverObjectPrefix(link.project.tenantId, link.projectId, link.id)}${Date.now()}-${crypto.randomUUID()}.${extensionFor(input.fileName, kind, mimeType)}`;
  const uploadId = await storageService.startMultipartUpload({ objectKey, mimeType });
  return {
    objectKey,
    uploadTicket: signTicket({ linkId: link.id, objectKey, uploadId, byteSize: input.byteSize, mimeType }),
    partSize: HANDOVER_PART_BYTES,
    partCount: handoverPartCount(input.byteSize),
  };
}

/** POST /public/handover/:token/uploads/multipart/parts: signed URLs for the parts still to send. */
export async function presignHandoverParts(link: PublicLink, input: HandoverMultipartPartsRequest): Promise<HandoverMultipartPartUrl[]> {
  const t = readTicket(link, input.uploadTicket);
  const count = handoverPartCount(t.byteSize);
  const out: HandoverMultipartPartUrl[] = [];
  for (const partNumber of [...new Set(input.partNumbers)]) {
    if (partNumber > count) throw new AppError('That part is not in this upload.', 400, 'UPLOAD_PART_INVALID');
    out.push({
      partNumber,
      uploadUrl: await storageService.presignUploadPart({
        objectKey: t.objectKey,
        uploadId: t.uploadId,
        partNumber,
        maxBytes: handoverPartSize(t.byteSize, partNumber),
      }),
    });
  }
  return out;
}

/** Parts received with exactly the expected size. */
async function receivedParts(t: UploadTicket) {
  const parts = await storageService.listUploadedParts({ objectKey: t.objectKey, uploadId: t.uploadId });
  return parts.filter((p) => p.size === handoverPartSize(t.byteSize, p.partNumber));
}

/** POST /public/handover/:token/uploads/multipart/status: what can be skipped when resuming. */
export async function handoverMultipartStatus(link: PublicLink, input: HandoverUploadTicketRequest): Promise<HandoverMultipartStatusDto> {
  const t = readTicket(link, input.uploadTicket);
  const parts = await receivedParts(t);
  return { objectKey: t.objectKey, partCount: handoverPartCount(t.byteSize), uploadedParts: parts.map((p) => p.partNumber) };
}

/** POST /public/handover/:token/uploads/multipart/complete */
export async function completeHandoverMultipart(link: PublicLink, input: HandoverUploadTicketRequest): Promise<{ objectKey: string }> {
  const t = readTicket(link, input.uploadTicket);
  // Already completed (a retry after a lost response): the object exists with the right size.
  const existing = await storageService.headObject(t.objectKey);
  if (existing && existing.byteSize === t.byteSize) return { objectKey: t.objectKey };
  const count = handoverPartCount(t.byteSize);
  const parts = await receivedParts(t);
  const missing = Array.from({ length: count }, (_, i) => i + 1).filter((n) => !parts.some((p) => p.partNumber === n));
  if (missing.length > 0) {
    throw new AppError('Some parts of the file have not arrived yet.', 409, 'UPLOAD_PARTS_MISSING', { missingParts: missing });
  }
  await storageService.completeMultipartUpload({ objectKey: t.objectKey, uploadId: t.uploadId, parts });
  return { objectKey: t.objectKey };
}

/** POST /public/handover/:token/uploads/presign */
export async function presignHandoverUpload(link: PublicLink, input: HandoverPresignRequest): Promise<HandoverPresignDto> {
  const { mimeType, kind } = checkUploadAllowed(input);
  await reserveUpload(link, input.byteSize);
  const objectKey = `${handoverObjectPrefix(link.project.tenantId, link.projectId, link.id)}${Date.now()}-${crypto.randomUUID()}.${extensionFor(input.fileName, kind, mimeType)}`;
  const presigned = await storageService.presignPutAt({ objectKey, mimeType, byteSize: input.byteSize });
  return { objectKey, uploadUrl: presigned.uploadUrl, expiresInSeconds: presigned.expiresInSeconds };
}

/** Confirms an uploaded file: under this link's prefix, present in storage, an allowed type. */
async function confirmFile(link: PublicLink, file: HandoverFileInput, seen: Set<string>): Promise<HandoverFileDto> {
  const prefix = handoverObjectPrefix(link.project.tenantId, link.projectId, link.id);
  if (!file.objectKey.startsWith(prefix) || file.objectKey.includes('..') || !/^[A-Za-z0-9/._-]+$/.test(file.objectKey)) {
    throw new AppError('A file was not uploaded through this link.', 400, 'INVALID_OBJECT_KEY');
  }
  if (seen.has(file.objectKey)) throw new AppError('The same file is attached twice.', 400, 'DUPLICATE_FILE');
  seen.add(file.objectKey);
  const info = await storageService.headObject(file.objectKey);
  if (!info) throw new AppError('A file did not finish uploading. Try attaching it again.', 422, 'UPLOAD_MISSING');
  const mimeType = (info.contentType ?? '').toLowerCase().split(';')[0].trim();
  const kind = handoverUploadKind(mimeType);
  if (!kind || info.byteSize > HANDOVER_UPLOAD_POLICY[kind].maxBytes) {
    throw new AppError('A file has a type or size that is not allowed.', 415, 'UNSUPPORTED_MEDIA_TYPE');
  }
  return { objectKey: file.objectKey, fileName: sanitizeHandoverLine(file.fileName, 160) || 'file', mimeType, byteSize: info.byteSize, kind };
}

/** POST /public/handover/:token/submit */
export async function submitHandover(
  link: PublicLink,
  input: SubmitHandoverRequest,
  meta: { clientIp: string | null; userAgent: string | null }
): Promise<HandoverSubmittedDto> {
  const seen = new Set<string>();
  const snags: Array<{ title: string; location: string | null; description: string | null; photos: HandoverFileDto[] }> = [];
  for (const snag of input.snags) {
    const photos: HandoverFileDto[] = [];
    for (const p of snag.photos) {
      const f = await confirmFile(link, p, seen);
      if (f.kind !== 'IMAGE') throw new AppError('Snag photos must be images.', 415, 'UNSUPPORTED_MEDIA_TYPE');
      photos.push(f);
    }
    snags.push({
      title: sanitizeHandoverLine(snag.title, 160),
      location: snag.location ? sanitizeHandoverLine(snag.location, 200) || null : null,
      description: snag.description ? sanitizeHandoverText(snag.description, 2000) || null : null,
      photos,
    });
  }
  const attachments: HandoverFileDto[] = [];
  for (const a of input.attachments) attachments.push(await confirmFile(link, a, seen));
  const submitterName = sanitizeHandoverLine(input.submitterName, 120);
  const submitterRole = sanitizeHandoverLine(input.submitterRole, 120);
  if (submitterName.length < 2 || submitterRole.length < 2) {
    throw new AppError('Enter your name and who you are.', 422, 'VALIDATION_ERROR');
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "handover_links" WHERE id = ${link.id}::uuid FOR UPDATE`;
    const fresh = await tx.handoverLink.findUniqueOrThrow({ where: { id: link.id }, include: { _count: { select: { submissions: true } } } });
    if (fresh.revokedAt || fresh.expiresAt <= new Date()) throw notFound();
    assertNotLocked(fresh);
    if (fresh._count.submissions >= fresh.maxSubmissions) {
      throw new AppError('A response has already been sent with this link.', 409, 'HANDOVER_SUBMISSION_LIMIT');
    }
    const submission = await tx.handoverSubmission.create({
      data: {
        handoverLinkId: link.id,
        projectId: link.projectId,
        decision: input.decision,
        submitterName,
        submitterRole,
        feedbackText: sanitizeHandoverText(input.feedbackText, HANDOVER_LIMITS.feedbackMaxLength),
        snagsJson: snags as unknown as Prisma.InputJsonValue,
        attachmentsJson: attachments as unknown as Prisma.InputJsonValue,
        clientIp: meta.clientIp?.slice(0, 64) ?? null,
        userAgent: meta.userAgent?.slice(0, 400) ?? null,
      },
    });
    await recordAuditEvent(tx, {
      projectId: link.projectId,
      actorType: 'SYSTEM',
      actorId: `handover-link:${link.id}`,
      actorDisplayName: `${submitterName} (${submitterRole}), external stakeholder`,
      action: 'HANDOVER_SUBMITTED',
      summaryText: `${submitterName} (${submitterRole}) responded to handover link "${link.label}": ${input.decision}, ${snags.length} snag(s), ${attachments.length} attachment(s).`,
      payload: {
        handoverSubmissionId: submission.id,
        handoverLinkId: link.id,
        decision: input.decision,
        snagCount: snags.length,
        attachmentCount: attachments.length,
      },
    });
    await createWebNotification(tx, {
      projectId: link.projectId,
      targetPermissionKey: 'handover:review_feedback',
      category: 'HANDOVER_SUBMITTED',
      title: `Handover response: ${input.decision.replace(/_/g, ' ').toLowerCase()}`,
      description: `${submitterName} (${submitterRole}) responded to "${link.label}" with ${snags.length} snag(s).`,
      actionUrl: `/app/projects/${link.projectId}/handover`,
      metadata: { handoverSubmissionId: submission.id },
    });
    return {
      submissionId: submission.id,
      decision: submission.decision,
      submittedAt: submission.submittedAt.toISOString(),
      submissionsRemaining: Math.max(0, fresh.maxSubmissions - fresh._count.submissions - 1),
    };
  });
}
