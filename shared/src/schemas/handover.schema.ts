import { z } from 'zod';

/**
 * Phase 10: handover to the beneficiary. Redesign R1d (decision P2): the beneficiary has no login
 * and there is no public link. An officer records the beneficiary's response (accept, accept with
 * snags, reject) from the signed paper copy and attests it; reviewing an accepted response issues
 * the handover certificate (Phase 15).
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
  ACCEPTED_WITH_SNAGS: 'Accepted with punch list items',
  REJECTED: 'Rejected',
};

export const HANDOVER_LIMITS = {
  maxSnags: 50,
  feedbackMaxLength: 8000,
} as const;

export const HandoverSnagInputSchema = z.object({
  title: z.string().trim().min(2, 'Give the punch list item a short title').max(160),
  location: z.string().trim().max(200).optional(),
  description: z.string().trim().max(2000).optional(),
});
export type HandoverSnagInput = z.infer<typeof HandoverSnagInputSchema>;

/** POST /projects/:projectId/handover/submissions: an officer records the beneficiary's response. */
export const RecordHandoverResponseRequestSchema = z
  .object({
    stakeholderType: HandoverStakeholderTypeEnum,
    decision: HandoverDecisionEnum,
    submitterName: z.string().trim().min(2, 'Enter the name of the person who signed').max(120),
    submitterRole: z.string().trim().min(2, 'Say who they are, e.g. "Head teacher"').max(120),
    feedbackText: z.string().max(HANDOVER_LIMITS.feedbackMaxLength).default(''),
    snags: z.array(HandoverSnagInputSchema).max(HANDOVER_LIMITS.maxSnags).default([]),
    /** The officer confirms the response matches the signed paper copy. */
    attest: z.literal(true, { errorMap: () => ({ message: 'Confirm that this matches the signed copy' }) }),
  })
  .superRefine((v, ctx) => {
    if (v.decision === 'ACCEPTED_WITH_SNAGS' && v.snags.length === 0) {
      ctx.addIssue({ code: 'custom', path: ['snags'], message: 'List at least one punch list item' });
    }
    if (v.decision === 'REJECTED' && v.feedbackText.trim().length < 10) {
      ctx.addIssue({ code: 'custom', path: ['feedbackText'], message: 'Record why the works were not accepted' });
    }
  });
export type RecordHandoverResponseRequest = z.infer<typeof RecordHandoverResponseRequestSchema>;
export type RecordHandoverResponseInput = z.input<typeof RecordHandoverResponseRequestSchema>;

export const HandoverSnagDtoSchema = z.object({
  index: z.number().int(),
  title: z.string(),
  location: z.string().nullable(),
  description: z.string().nullable(),
  /** Set once the snag was turned into a defect ticket. */
  defectTicketId: z.string().uuid().nullable(),
});
export type HandoverSnagDto = z.infer<typeof HandoverSnagDtoSchema>;

export const HandoverSubmissionDtoSchema = z.object({
  id: z.string().uuid(),
  stakeholderType: HandoverStakeholderTypeEnum,
  decision: HandoverDecisionEnum,
  submitterName: z.string(),
  submitterRole: z.string(),
  /** Plain text with the small formatting allow-list (see parseHandoverRichText). */
  feedbackText: z.string(),
  snags: z.array(HandoverSnagDtoSchema),
  recordedByName: z.string().nullable(),
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
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).default('MEDIUM'),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export type ConvertSnagsRequest = z.infer<typeof ConvertSnagsRequestSchema>;
export type ConvertSnagsInput = z.input<typeof ConvertSnagsRequestSchema>;
