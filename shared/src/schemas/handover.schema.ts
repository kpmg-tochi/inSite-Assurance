import { z } from 'zod';

/**
 * Phase 10: stakeholder handover. External stakeholders (community representatives, client staff,
 * end users) open a secure link, optionally confirm a one-time code, and accept the works, accept
 * with snags, or reject. They never get an account.
 */

export const HandoverStakeholderTypeEnum = z.enum(['COMMUNITY_REPRESENTATIVE', 'CLIENT_STAFF', 'END_USER', 'OTHER']);
export type HandoverStakeholderType = z.infer<typeof HandoverStakeholderTypeEnum>;

export const HANDOVER_STAKEHOLDER_LABELS: Record<HandoverStakeholderType, string> = {
  COMMUNITY_REPRESENTATIVE: 'Community representative',
  CLIENT_STAFF: 'Client staff',
  END_USER: 'End user',
  OTHER: 'Other',
};

export const HandoverDecisionEnum = z.enum(['ACCEPTED', 'ACCEPTED_WITH_SNAGS', 'REJECTED']);
export type HandoverDecision = z.infer<typeof HandoverDecisionEnum>;

export const HANDOVER_DECISION_LABELS: Record<HandoverDecision, string> = {
  ACCEPTED: 'Accepted',
  ACCEPTED_WITH_SNAGS: 'Accepted with snags',
  REJECTED: 'Rejected',
};

const MB = 1024 * 1024;

export const HANDOVER_LIMITS = {
  defaultExpiryDays: 14,
  maxExpiryDays: 60,
  maxSubmissions: 10,
  otpDigits: 6,
  otpTtlMinutes: 10,
  otpMaxAttempts: 5,
  sessionTtlMinutes: 120,
  /** Total bytes one link may upload, across all its files. */
  perLinkTotalBytes: 300 * MB,
  perLinkMaxFiles: 60,
  maxSnags: 50,
  maxPhotosPerSnag: 6,
  maxAttachments: 30,
  feedbackMaxLength: 8000,
} as const;

export type HandoverUploadKind = 'IMAGE' | 'DOCUMENT' | 'AUDIO' | 'VIDEO';

/** Allow-listed upload types and caps. No executables, archives, HTML or scripts. */
export const HANDOVER_UPLOAD_POLICY: Record<HandoverUploadKind, { mimeTypes: string[]; maxBytes: number; extensions: string[] }> = {
  IMAGE: {
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'],
    maxBytes: 15 * MB,
    extensions: ['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'],
  },
  DOCUMENT: { mimeTypes: ['application/pdf'], maxBytes: 20 * MB, extensions: ['pdf'] },
  AUDIO: {
    mimeTypes: ['audio/mpeg', 'audio/mp4', 'audio/m4a', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/webm', 'audio/ogg'],
    maxBytes: 100 * MB,
    extensions: ['mp3', 'm4a', 'aac', 'wav', 'webm', 'ogg', 'mp4'],
  },
  VIDEO: {
    mimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
    maxBytes: 100 * MB,
    extensions: ['mp4', 'mov', 'webm'],
  },
};

export function handoverUploadKind(mimeType: string): HandoverUploadKind | null {
  const mime = mimeType.toLowerCase().split(';')[0].trim();
  for (const [kind, policy] of Object.entries(HANDOVER_UPLOAD_POLICY) as Array<[HandoverUploadKind, { mimeTypes: string[] }]>) {
    if (policy.mimeTypes.includes(mime)) return kind;
  }
  return null;
}

/** The `accept` attribute for file inputs on the public page. */
export const HANDOVER_ACCEPT_ATTRIBUTE = Object.values(HANDOVER_UPLOAD_POLICY)
  .flatMap((p) => p.mimeTypes)
  .join(',');

// ---------------------------------------------------------------------------
// Authenticated side: links and review
// ---------------------------------------------------------------------------

export const CreateHandoverLinkRequestSchema = z.object({
  label: z.string().trim().min(2).max(120),
  recipientName: z.string().trim().min(2).max(120),
  /** Email address (SMS waits on D-8.1). The one-time code is sent here. */
  recipientContact: z.string().trim().email('Enter an email address').max(200),
  stakeholderType: HandoverStakeholderTypeEnum,
  /** What the stakeholder is asked to accept, in plain language. */
  handoverSummary: z.string().trim().min(10, 'Describe what is being handed over').max(4000),
  expiresInDays: z.number().int().min(1).max(HANDOVER_LIMITS.maxExpiryDays).default(HANDOVER_LIMITS.defaultExpiryDays),
  requiresOtp: z.boolean().default(true),
  maxSubmissions: z.number().int().min(1).max(HANDOVER_LIMITS.maxSubmissions).default(1),
  /** Email the link to the recipient now. */
  sendNow: z.boolean().default(true),
});
export type CreateHandoverLinkRequest = z.infer<typeof CreateHandoverLinkRequestSchema>;
export type CreateHandoverLinkInput = z.input<typeof CreateHandoverLinkRequestSchema>;

export const HandoverLinkStatusEnum = z.enum(['ACTIVE', 'EXPIRED', 'REVOKED', 'LOCKED', 'USED_UP']);
export type HandoverLinkStatus = z.infer<typeof HandoverLinkStatusEnum>;

export const HandoverLinkDtoSchema = z.object({
  id: z.string().uuid(),
  label: z.string(),
  recipientName: z.string(),
  recipientContact: z.string(),
  stakeholderType: HandoverStakeholderTypeEnum,
  handoverSummary: z.string(),
  requiresOtp: z.boolean(),
  expiresAt: z.string(),
  maxSubmissions: z.number().int(),
  submissionCount: z.number().int(),
  status: HandoverLinkStatusEnum,
  revokedAt: z.string().nullable(),
  lastAccessedAt: z.string().nullable(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
  /** Set when this link was issued to replace another. */
  reissuedFromLinkId: z.string().uuid().nullable(),
});
export type HandoverLinkDto = z.infer<typeof HandoverLinkDtoSchema>;

export const HandoverLinkIssuedDtoSchema = z.object({
  link: HandoverLinkDtoSchema,
  /** Shown once. Only the hash of the token is stored. */
  url: z.string(),
  delivery: z.enum(['SENT', 'QUEUED', 'FAILED', 'SKIPPED', 'NOT_SENT']),
});
export type HandoverLinkIssuedDto = z.infer<typeof HandoverLinkIssuedDtoSchema>;

export const ReissueHandoverLinkRequestSchema = z.object({
  expiresInDays: z.number().int().min(1).max(HANDOVER_LIMITS.maxExpiryDays).default(HANDOVER_LIMITS.defaultExpiryDays),
  sendNow: z.boolean().default(true),
});
export type ReissueHandoverLinkRequest = z.infer<typeof ReissueHandoverLinkRequestSchema>;

export const HandoverFileDtoSchema = z.object({
  objectKey: z.string(),
  fileName: z.string(),
  mimeType: z.string(),
  byteSize: z.number().int(),
  kind: z.enum(['IMAGE', 'DOCUMENT', 'AUDIO', 'VIDEO']),
});
export type HandoverFileDto = z.infer<typeof HandoverFileDtoSchema>;

export const HandoverSnagDtoSchema = z.object({
  index: z.number().int(),
  title: z.string(),
  location: z.string().nullable(),
  description: z.string().nullable(),
  photos: z.array(HandoverFileDtoSchema),
  /** Set once the snag was turned into a defect ticket. */
  defectTicketId: z.string().uuid().nullable(),
});
export type HandoverSnagDto = z.infer<typeof HandoverSnagDtoSchema>;

export const HandoverSubmissionDtoSchema = z.object({
  id: z.string().uuid(),
  handoverLinkId: z.string().uuid(),
  linkLabel: z.string(),
  stakeholderType: HandoverStakeholderTypeEnum,
  decision: HandoverDecisionEnum,
  submitterName: z.string(),
  submitterRole: z.string(),
  /** Plain text with the small formatting allow-list (see parseHandoverRichText). */
  feedbackText: z.string(),
  snags: z.array(HandoverSnagDtoSchema),
  attachments: z.array(HandoverFileDtoSchema),
  submittedAt: z.string(),
  reviewedAt: z.string().nullable(),
  reviewedByName: z.string().nullable(),
  reviewNotes: z.string().nullable(),
});
export type HandoverSubmissionDto = z.infer<typeof HandoverSubmissionDtoSchema>;

export const ReviewHandoverSubmissionRequestSchema = z.object({
  notes: z.string().trim().max(2000).optional(),
});
export type ReviewHandoverSubmissionRequest = z.infer<typeof ReviewHandoverSubmissionRequestSchema>;

export const ConvertSnagsRequestSchema = z.object({
  /** Which snags; all snags without a ticket when omitted. */
  snagIndexes: z.array(z.number().int().min(0)).max(HANDOVER_LIMITS.maxSnags).optional(),
  /** Liable contractor; the main contractor when omitted (unified model). Required in multi-prime. */
  projectContractorId: z.string().uuid().nullable().optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export type ConvertSnagsRequest = z.infer<typeof ConvertSnagsRequestSchema>;
export type ConvertSnagsInput = z.input<typeof ConvertSnagsRequestSchema>;

// ---------------------------------------------------------------------------
// Public side
// ---------------------------------------------------------------------------

export const PublicHandoverInfoDtoSchema = z.object({
  tenantName: z.string(),
  logoUrl: z.string().nullable(),
  primaryColorHex: z.string().nullable(),
  projectName: z.string(),
  projectLocation: z.string(),
  handoverSummary: z.string(),
  recipientName: z.string(),
  requiresCode: z.boolean(),
  /** Masked destination of the code, e.g. "a***@example.com". */
  codeDestination: z.string().nullable(),
  submissionsRemaining: z.number().int(),
  expiresAt: z.string(),
});
export type PublicHandoverInfoDto = z.infer<typeof PublicHandoverInfoDtoSchema>;

export const VerifyHandoverCodeRequestSchema = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
});
export type VerifyHandoverCodeRequest = z.infer<typeof VerifyHandoverCodeRequestSchema>;

export const HandoverSessionDtoSchema = z.object({
  sessionToken: z.string(),
  expiresAt: z.string(),
});
export type HandoverSessionDto = z.infer<typeof HandoverSessionDtoSchema>;

export const HandoverPresignRequestSchema = z.object({
  fileName: z.string().trim().min(1).max(160),
  mimeType: z.string().trim().min(3).max(80),
  byteSize: z.number().int().positive(),
});
export type HandoverPresignRequest = z.infer<typeof HandoverPresignRequestSchema>;

export const HandoverPresignDtoSchema = z.object({
  objectKey: z.string(),
  uploadUrl: z.string(),
  expiresInSeconds: z.number().int(),
});
export type HandoverPresignDto = z.infer<typeof HandoverPresignDtoSchema>;

const HandoverFileInputSchema = z.object({
  objectKey: z.string().min(10).max(400),
  fileName: z.string().trim().min(1).max(160),
});
export type HandoverFileInput = z.infer<typeof HandoverFileInputSchema>;

export const HandoverSnagInputSchema = z.object({
  title: z.string().trim().min(2, 'Give the snag a short title').max(160),
  location: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  photos: z.array(HandoverFileInputSchema).max(HANDOVER_LIMITS.maxPhotosPerSnag).default([]),
});
export type HandoverSnagInput = z.infer<typeof HandoverSnagInputSchema>;

export const SubmitHandoverRequestSchema = z
  .object({
    decision: HandoverDecisionEnum,
    submitterName: z.string().trim().min(2, 'Enter your name').max(120),
    submitterRole: z.string().trim().min(2, 'Say who you are, e.g. "Village head"').max(120),
    feedbackText: z.string().max(HANDOVER_LIMITS.feedbackMaxLength).default(''),
    snags: z.array(HandoverSnagInputSchema).max(HANDOVER_LIMITS.maxSnags).default([]),
    attachments: z.array(HandoverFileInputSchema).max(HANDOVER_LIMITS.maxAttachments).default([]),
  })
  .superRefine((v, ctx) => {
    if (v.decision === 'ACCEPTED_WITH_SNAGS' && v.snags.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['snags'], message: 'List at least one snag' });
    }
    if (v.decision === 'REJECTED' && v.feedbackText.trim().length < 10) {
      ctx.addIssue({ code: 'custom', path: ['feedbackText'], message: 'Tell us why you are not accepting the works' });
    }
  });
export type SubmitHandoverRequest = z.infer<typeof SubmitHandoverRequestSchema>;
export type SubmitHandoverInput = z.input<typeof SubmitHandoverRequestSchema>;

export const HandoverSubmittedDtoSchema = z.object({
  submissionId: z.string().uuid(),
  decision: HandoverDecisionEnum,
  submittedAt: z.string(),
  submissionsRemaining: z.number().int(),
});
export type HandoverSubmittedDto = z.infer<typeof HandoverSubmittedDtoSchema>;

// ---------------------------------------------------------------------------
// Resumable uploads (multipart): files above the threshold go up in parts. The server keeps no
// upload table: it hands out a signed upload ticket bound to the link.
// ---------------------------------------------------------------------------

/** S3's minimum part size (except the last part). */
export const HANDOVER_PART_BYTES = 5 * MB;
/** Files above this size are uploaded in parts and can resume after a dropped connection. */
export const HANDOVER_MULTIPART_THRESHOLD_BYTES = HANDOVER_PART_BYTES;

export function handoverPartCount(byteSize: number): number {
  return Math.max(1, Math.ceil(byteSize / HANDOVER_PART_BYTES));
}

/** Expected size of part `partNumber` (1-based) of a file of `byteSize` bytes. */
export function handoverPartSize(byteSize: number, partNumber: number): number {
  const count = handoverPartCount(byteSize);
  return partNumber < count ? HANDOVER_PART_BYTES : byteSize - HANDOVER_PART_BYTES * (count - 1);
}

export const HandoverMultipartDtoSchema = z.object({
  objectKey: z.string(),
  uploadTicket: z.string(),
  partSize: z.number().int(),
  partCount: z.number().int(),
});
export type HandoverMultipartDto = z.infer<typeof HandoverMultipartDtoSchema>;

export const HandoverUploadTicketRequestSchema = z.object({
  uploadTicket: z.string().min(20).max(2000),
});
export type HandoverUploadTicketRequest = z.infer<typeof HandoverUploadTicketRequestSchema>;

export const HandoverMultipartPartsRequestSchema = HandoverUploadTicketRequestSchema.extend({
  partNumbers: z.array(z.number().int().min(1).max(10000)).min(1).max(25),
});
export type HandoverMultipartPartsRequest = z.infer<typeof HandoverMultipartPartsRequestSchema>;

export const HandoverMultipartPartUrlSchema = z.object({ partNumber: z.number().int(), uploadUrl: z.string() });
export type HandoverMultipartPartUrl = z.infer<typeof HandoverMultipartPartUrlSchema>;

export const HandoverMultipartStatusDtoSchema = z.object({
  objectKey: z.string(),
  partCount: z.number().int(),
  /** Parts already received with the right size; only the others need sending. */
  uploadedParts: z.array(z.number().int()),
});
export type HandoverMultipartStatusDto = z.infer<typeof HandoverMultipartStatusDtoSchema>;
