import crypto from 'crypto';
import { Prisma } from '@prisma/client';
import {
  NEEDS_VERIFICATION_PURPOSE_LABELS,
  canonicalCaptureString,
  validateNeedsVerificationAnswers,
  zonedCalendarDate,
  type CaptureFact,
  type NeedsVerificationCaptureDto,
  type NeedsVerificationDto,
  type NeedsVerificationFeedDto,
  type NeedsVerificationFormDto,
  type NeedsVerificationPresignDto,
  type NeedsVerificationPurpose,
  type NeedsVerificationSubmissionDto,
  type PresignNeedsVerificationCaptureRequest,
  type RegisterNeedsVerificationCaptureRequest,
  type SubmitNeedsVerificationRequest,
} from '@insite/shared';
import { prisma } from '../../../config/prisma';
import { AppError } from '../../../middleware/error.middleware';
import type { MobileUserPrincipal, WebJwtPayload } from '../../../middleware/auth.middleware';
import { storageService } from '../../../integrations/storage.service';
import { assertVerificationOfficer } from '../../../utils/accessControl';
import { assertTenantAreaObjectKey, presignTenantAreaUpload } from '../../../utils/tenantUploads';
import { verifyDeviceSignature } from '../../../utils/deviceSignature';
import { recordAuditEvent } from '../../audit/audit.service';
import { isUuid } from '../needsAccess';
import {
  CAPTURE_UPLOAD_POLICY,
  NOT_OPEN,
  VERIFICATION_INCLUDE,
  VERIFICATION_NOT_FOUND,
  capturePrefix,
  formOf,
  isOpenForOfficer,
  lockVerificationRow,
  programmeNames,
  serializeSubmission,
  serializeVerification,
  tenantZone,
  type CaptureRow,
  type VerificationRow,
} from './needsVerificationSupport';

/**
 * Needs pipeline wave 5 (N8): the field app's routes under /api/v1/needs-verifications. Access is by
 * assignment (`assertVerificationOfficer`): the caller is the verification's officer, signed in on the
 * phone (provisioned account) or on the web; no project and no field session. Writes are idempotent on
 * the client's UUIDs (captures on `clientCaptureId`, submissions on `clientSubmissionId`), so the
 * outbox can resend. Ledger entries are tenant-level (`projectId` null, `cycleId` / `proposalId` in the
 * payload) like the rest of the pipeline; a phone actor is recorded as FIELD_AGENT with the user's id.
 * Capture signatures: the phone signs `canonicalCaptureString` with the verification id in place of
 * the project id (media type SITE_PHOTO / VOICE_NOTE); the server checks it against the signed-in
 * device's registered key and stores the result (`signatureVerified`: true, false, or null when
 * unsigned or when there is no device key, e.g. a web sign-in). An invalid signature is recorded, not
 * refused, as for project evidence.
 */

export type FieldPrincipal = MobileUserPrincipal | WebJwtPayload;

const FEED_DAYS = 30;

async function actorOf(principal: FieldPrincipal) {
  if (principal.tokenType === 'WEB_USER') {
    return { actorType: 'WEB_USER' as const, actorId: principal.userId, actorDisplayName: `${principal.fullName} (${principal.roleName})` };
  }
  const role = principal.mobileRoleId ? await prisma.role.findUnique({ where: { id: principal.mobileRoleId }, select: { name: true } }) : null;
  return { actorType: 'FIELD_AGENT' as const, actorId: principal.userId, actorDisplayName: `${principal.fullName}${role ? ` (${role.name})` : ''}` };
}

/** The verification, when the caller is its officer (else 404). */
async function loadOwn(principal: FieldPrincipal, verificationId: string, db: Prisma.TransactionClient | typeof prisma = prisma): Promise<VerificationRow> {
  if (!isUuid(verificationId)) throw VERIFICATION_NOT_FOUND();
  const row = await db.needsVerification.findUnique({ where: { id: verificationId }, include: VERIFICATION_INCLUDE });
  return assertVerificationOfficer(principal, row);
}

async function fieldDtos(principal: FieldPrincipal, rows: VerificationRow[]): Promise<NeedsVerificationDto[]> {
  if (!rows.length) return [];
  const [names, zone] = await Promise.all([programmeNames(rows.map((r) => r.cycle.projectTypeId)), tenantZone(principal.tenantId)]);
  const today = zonedCalendarDate(new Date(), zone);
  return Promise.all(rows.map((r) => serializeVerification(r, { programmeName: names.get(r.cycle.projectTypeId) ?? 'Needs assessment', zone, today, allowedActions: [], signUrls: false })));
}

/** `GET /mine`: open and submitted ones, and those accepted or cancelled in the last 30 days. */
export async function myVerifications(principal: FieldPrincipal): Promise<NeedsVerificationFeedDto> {
  assertVerificationOfficer(principal, { tenantId: principal.tenantId, officerUserId: principal.userId });
  const since = new Date(Date.now() - FEED_DAYS * 86_400_000);
  const rows = await prisma.needsVerification.findMany({
    where: {
      tenantId: principal.tenantId,
      officerUserId: principal.userId,
      // A submission waiting for review stays on the phone however long the review takes.
      OR: [{ status: { in: ['ASSIGNED', 'RETURNED', 'SUBMITTED'] } }, { status: { in: ['ACCEPTED', 'CANCELLED'] }, updatedAt: { gte: since } }],
    },
    include: VERIFICATION_INCLUDE,
    orderBy: [{ dueDate: 'asc' }, { assignedAt: 'asc' }],
  });
  return { items: await fieldDtos(principal, rows), serverTime: new Date().toISOString() };
}

/** `GET /:id/form` (the route answers 304 on a matching ETag). */
export async function verificationForm(principal: FieldPrincipal, verificationId: string): Promise<NeedsVerificationFormDto> {
  const row = await loadOwn(principal, verificationId);
  return { verificationId: row.id, formHash: row.formHash, form: formOf(row) };
}

/** `POST /:id/captures/presign` */
export async function presignVerificationCapture(principal: FieldPrincipal, verificationId: string, input: PresignNeedsVerificationCaptureRequest): Promise<NeedsVerificationPresignDto> {
  const row = await loadOwn(principal, verificationId);
  if (!isOpenForOfficer(row.status)) throw NOT_OPEN();
  const presigned = await presignTenantAreaUpload({
    prefix: capturePrefix(row.tenantId, row.id),
    fileName: input.fileName,
    mimeType: input.mimeType,
    byteSize: input.byteSize,
    policy: CAPTURE_UPLOAD_POLICY,
  });
  return { uploadUrl: presigned.uploadUrl, objectKey: presigned.objectKey, expiresAt: new Date(Date.now() + presigned.expiresInSeconds * 1000).toISOString() };
}

function captureDto(c: CaptureRow): NeedsVerificationCaptureDto {
  return {
    clientCaptureId: c.clientCaptureId,
    kind: c.kind as 'PHOTO' | 'AUDIO',
    mimeType: c.mimeType,
    byteSize: c.byteSize,
    capturedAt: c.capturedAtDevice.toISOString(),
    latitude: c.latitude,
    longitude: c.longitude,
    accuracyMeters: c.accuracyMeters,
    headingDegrees: c.headingDegrees,
    answerPath: c.answerPath,
    url: null,
  };
}

/** The device key of the signed-in phone (none for a web sign-in or a revoked device). */
async function deviceKeyOf(principal: FieldPrincipal): Promise<{ publicKey: string; publicKeyAlg: string } | null> {
  if (principal.tokenType !== 'MOBILE_USER') return null;
  return prisma.mobileDevice.findFirst({ where: { id: principal.deviceRowId, userId: principal.userId, revokedAt: null }, select: { publicKey: true, publicKeyAlg: true } });
}

async function checkSignature(principal: FieldPrincipal, verificationId: string, input: RegisterNeedsVerificationCaptureRequest): Promise<boolean | null> {
  if (!input.signature) return null;
  const key = await deviceKeyOf(principal);
  if (!key) return null;
  return verifyDeviceSignature({
    publicKey: key.publicKey,
    alg: key.publicKeyAlg,
    signature: input.signature,
    message: canonicalCaptureString({
      clientCaptureId: input.clientCaptureId,
      projectId: verificationId,
      mediaType: input.kind === 'PHOTO' ? 'SITE_PHOTO' : 'VOICE_NOTE',
      sha256: input.sha256,
      byteSize: input.byteSize,
      capturedAt: input.capturedAt,
      latitude: input.location?.latitude ?? null,
      longitude: input.location?.longitude ?? null,
      accuracyMeters: input.location?.accuracyMeters ?? null,
      isMockLocation: input.isMockLocation,
    }),
  }).verified;
}

const CAPTURE_CONFLICT = () => new AppError('This capture id belongs to another capture', 409, 'NEEDS_CAPTURE_ID_CONFLICT');

/** `POST /:id/captures`: 201 new, 200 replay of the same capture id. */
export async function registerVerificationCapture(
  principal: FieldPrincipal,
  verificationId: string,
  input: RegisterNeedsVerificationCaptureRequest
): Promise<{ capture: NeedsVerificationCaptureDto; created: boolean }> {
  const row = await loadOwn(principal, verificationId);
  const replay = await prisma.needsVerificationCapture.findUnique({ where: { clientCaptureId: input.clientCaptureId } });
  if (replay) {
    if (replay.verificationId !== row.id || replay.userId !== principal.userId) throw CAPTURE_CONFLICT();
    return { capture: captureDto(replay), created: false };
  }
  if (!isOpenForOfficer(row.status)) throw NOT_OPEN();
  const key = assertTenantAreaObjectKey(input.objectKey, capturePrefix(row.tenantId, row.id));
  const mimeType = input.mimeType.toLowerCase();
  if (!CAPTURE_UPLOAD_POLICY.mimeTypes.includes(mimeType)) throw new AppError(`Files of type ${input.mimeType} cannot be uploaded here`, 415, 'UNSUPPORTED_MEDIA_TYPE');
  const bytes = await storageService.getObjectBuffer(key, CAPTURE_UPLOAD_POLICY.maxBytes);
  if (!bytes) throw new AppError('Upload the file before registering the capture', 409, 'OBJECT_NOT_UPLOADED');
  const serverSha256 = crypto.createHash('sha256').update(bytes).digest('hex');
  const signatureVerified = await checkSignature(principal, row.id, input);
  try {
    // Review fix (wave 5): the "key already registered" check and the insert run under the
    // verification row lock, so two registrations of one upload cannot both pass the check.
    const created = await prisma.$transaction(async (tx) => {
      await lockVerificationRow(tx, row.id);
      if (await tx.needsVerificationCapture.count({ where: { objectKey: key } })) {
        throw new AppError('This upload is already registered as another capture', 409, 'NEEDS_CAPTURE_OBJECT_IN_USE');
      }
      return tx.needsVerificationCapture.create({
        data: {
          tenantId: row.tenantId,
          verificationId: row.id,
          clientCaptureId: input.clientCaptureId,
          userId: principal.userId,
          kind: input.kind,
          objectKey: key,
          mimeType,
          byteSize: bytes.length,
          clientSha256: input.sha256.toLowerCase(),
          serverSha256,
          latitude: input.location?.latitude ?? null,
          longitude: input.location?.longitude ?? null,
          accuracyMeters: input.location?.accuracyMeters ?? null,
          altitudeMeters: input.location?.altitudeMeters ?? null,
          headingDegrees: input.headingDegrees,
          isMockLocation: input.isMockLocation,
          caption: input.caption,
          signature: input.signature,
          signatureVerified,
          capturedAtDevice: new Date(input.capturedAt),
        },
      });
    });
    return { capture: captureDto(created), created: true };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const again = await prisma.needsVerificationCapture.findUnique({ where: { clientCaptureId: input.clientCaptureId } });
      if (again && again.verificationId === row.id && again.userId === principal.userId) return { capture: captureDto(again), created: false };
      throw CAPTURE_CONFLICT();
    }
    throw error;
  }
}

const SUBMISSION_CONFLICT = () => new AppError('This submission id belongs to another verification', 409, 'NEEDS_SUBMISSION_ID_CONFLICT');

/** The stored submission with that client id (its DTO), or null. */
async function storedSubmission(principal: FieldPrincipal, verificationId: string, clientSubmissionId: string): Promise<NeedsVerificationSubmissionDto | null> {
  const stored = await prisma.needsVerificationSubmission.findUnique({ where: { clientSubmissionId } });
  if (!stored) return null;
  if (stored.verificationId !== verificationId) throw SUBMISSION_CONFLICT();
  return serializeSubmission(stored, formOf(await loadOwn(principal, verificationId)));
}

/** `POST /:id/submissions`: the submission's DTO; 201 new, 200 replay of the same submission id (whatever the status now). */
export async function submitVerification(
  principal: FieldPrincipal,
  verificationId: string,
  input: SubmitNeedsVerificationRequest
): Promise<{ submission: NeedsVerificationSubmissionDto; created: boolean }> {
  const own = await loadOwn(principal, verificationId);
  const replay = await storedSubmission(principal, own.id, input.clientSubmissionId);
  if (replay) return { submission: replay, created: false };
  const actor = await actorOf(principal);
  try {
    await prisma.$transaction(
      async (tx) => {
        await lockVerificationRow(tx, own.id);
        const row = await tx.needsVerification.findUniqueOrThrow({ where: { id: own.id }, include: VERIFICATION_INCLUDE });
        if (!isOpenForOfficer(row.status)) throw NOT_OPEN();
        if (input.formHash !== row.formHash) {
          throw new AppError('The form changed since it was downloaded. Refresh the verification and submit again.', 409, 'NEEDS_VERIFICATION_FORM_STALE');
        }
        const form = formOf(row);

        // Captures named by the answers: registered on this verification by this user, not linked to a
        // live submission (photos of a returned submission may be sent again).
        const refs = new Map<string, string>();
        for (const a of input.answers) for (const c of a.captures) if (!refs.has(c.clientCaptureId)) refs.set(c.clientCaptureId, a.path);
        const returnedIds = new Set(row.submissions.filter((s) => s.status === 'RETURNED').map((s) => s.id));
        const usable = new Map(
          row.captures.filter((c) => c.userId === principal.userId && (c.submissionId === null || returnedIds.has(c.submissionId))).map((c) => [c.clientCaptureId, c])
        );
        const missing = [...refs.keys()].filter((id) => !usable.has(id));
        if (missing.length) {
          throw new AppError('Some photos are not registered yet. The app sends them first and retries.', 409, 'CAPTURES_NOT_REGISTERED', { missingClientCaptureIds: missing, retryable: true });
        }
        const facts: CaptureFact[] = [...refs.keys()].map((id) => {
          const c = usable.get(id)!;
          return { clientCaptureId: id, geotagged: c.latitude !== null && c.longitude !== null, insideBoundary: null };
        });
        const check = validateNeedsVerificationAnswers(form, input.answers, input.siteLocations, facts);
        if (!check.valid) {
          throw new AppError(check.errors[0]?.message ?? check.locationErrors[0]?.message ?? 'The answers are not complete', 422, 'NEEDS_VERIFICATION_INVALID', {
            errors: check.errors,
            locationErrors: check.locationErrors,
          });
        }

        const submission = await tx.needsVerificationSubmission.create({
          data: {
            verificationId: row.id,
            clientSubmissionId: input.clientSubmissionId,
            formHash: input.formHash,
            answersJson: input.answers as unknown as Prisma.InputJsonValue,
            siteLocationsJson: input.siteLocations as unknown as Prisma.InputJsonValue,
            notes: input.notes,
            submittedByUserId: principal.userId,
            submittedByName: principal.fullName,
            submittedAtDevice: new Date(input.submittedAtDevice),
          },
        });
        for (const [clientCaptureId, answerPath] of refs) {
          await tx.needsVerificationCapture.update({ where: { clientCaptureId }, data: { submissionId: submission.id, answerPath } });
        }
        await tx.needsVerification.update({ where: { id: row.id }, data: { status: 'SUBMITTED' } });
        const resubmitted = returnedIds.size > 0;
        await recordAuditEvent(tx, {
          tenantId: row.tenantId,
          projectId: null,
          ...actor,
          action: 'NEEDS_VERIFICATION_SUBMITTED',
          summaryText: `${resubmitted ? 'Resubmitted' : 'Submitted'} the ${NEEDS_VERIFICATION_PURPOSE_LABELS[row.purpose as NeedsVerificationPurpose].toLowerCase()} of ${row.proposal.reference} from the field app (${form.sites.length} site${form.sites.length === 1 ? '' : 's'}, ${refs.size} photo${refs.size === 1 ? '' : 's'}).`,
          payload: {
            cycleId: row.cycleId,
            proposalId: row.proposalId,
            reference: row.proposal.reference,
            verificationId: row.id,
            submissionId: submission.id,
            clientSubmissionId: input.clientSubmissionId,
            formHash: input.formHash,
            captureCount: refs.size,
            photoGaps: check.photoGaps.length,
          },
        });
      },
      { timeout: 30_000 }
    );
  } catch (error) {
    // Two sends of the same submission at once: the loser answers as a replay.
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const again = await storedSubmission(principal, own.id, input.clientSubmissionId);
      if (again) return { submission: again, created: false };
    }
    throw error;
  }
  return { submission: (await storedSubmission(principal, own.id, input.clientSubmissionId))!, created: true };
}
