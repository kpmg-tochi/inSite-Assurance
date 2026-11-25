import { z } from 'zod';
import { VisitKindEnum } from './form.schema';
import { DOCUMENT_TYPE_CODE_REGEX, MILESTONE_KEY_REGEX } from './contract.schema';

/**
 * Phase 15: Certificate of Completion (CoC) and closure governance.
 * - The CoC is signed in configurable signatory slots (organisation admins holding a permission,
 *   plus the beneficiary) and gates handover into the liability period, the final payment and
 *   closure, each switchable per project type.
 * - A closure checklist per project type gates COMPLETED_CLOSED (beforeClose) and ARCHIVED
 *   (beforeArchive).
 * - Contractor performance ratings and a tenant-wide lessons-learned library.
 * - A closure pack (ZIP) for audit.
 */

const Uuid = z.string().uuid();
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// ---------------------------------------------------------------------------
// Project type config: `closure`
// ---------------------------------------------------------------------------

/** Which organisation a CoC signatory must belong to, relative to the project. */
export const CocSignatoryScopeEnum = z.enum(['ANY', 'PROJECT_OWNER', 'PROJECT_OWNER_OR_ANCESTOR', 'FUNDER', 'MONITOR']);
export type CocSignatoryScope = z.infer<typeof CocSignatoryScopeEnum>;

export const COC_SIGNATORY_SCOPE_META: Record<CocSignatoryScope, { label: string }> = {
  ANY: { label: 'Any organisation' },
  PROJECT_OWNER: { label: 'Owning organisation' },
  PROJECT_OWNER_OR_ANCESTOR: { label: 'Owning organisation or above' },
  FUNDER: { label: 'Funding organisation' },
  MONITOR: { label: 'Monitoring organisation' },
};

export const COC_SLOT_KEY_REGEX = /^[a-z][a-z0-9-]{1,39}$/;

export const CocSignatorySlotSchema = z.object({
  key: z.string().trim().regex(COC_SLOT_KEY_REGEX, 'Key: lower-case letters, digits and dashes, e.g. head-of-planning'),
  label: z.string().trim().min(3).max(120),
  /** Staff slots: the signer must hold this permission. Ignored for the beneficiary slot. */
  permissionKey: z.string().trim().min(3).max(80).default('completion:sign_certificate'),
  /** Optional: the signer must also have this role (by code). */
  roleCode: z.string().trim().max(60).nullable().default(null),
  organizationScope: CocSignatoryScopeEnum.default('PROJECT_OWNER'),
  /** The beneficiary institution's slot (recorded by staff from the signed paper copy). */
  isBeneficiary: z.boolean().default(false),
});
export type CocSignatorySlot = z.infer<typeof CocSignatorySlotSchema>;
export type CocSignatorySlotInput = z.input<typeof CocSignatorySlotSchema>;

/** The default slots (decision O / Q5): two owner-organisation admins and the beneficiary. */
export const DEFAULT_COC_SIGNATORIES: CocSignatorySlotInput[] = [
  { key: 'head-physical-planning', label: 'Director, Physical Planning', organizationScope: 'PROJECT_OWNER' },
  { key: 'head-me', label: 'Director, Monitoring & Evaluation', organizationScope: 'PROJECT_OWNER' },
  { key: 'beneficiary', label: 'Beneficiary institution', isBeneficiary: true, organizationScope: 'ANY' },
];

/**
 * How the beneficiary signs (D-15.1): an officer uploads the beneficiary's signed paper certificate
 * and attests. The beneficiary has no login (redesign R1d, decision P2).
 */
export const BeneficiarySignatureModeEnum = z.enum(['RECORDED_BY_STAFF']);
export type BeneficiarySignatureMode = z.infer<typeof BeneficiarySignatureModeEnum>;

export const ClosureGateEnum = z.enum(['HANDOVER_TO_RETENTION', 'FINAL_PAYMENT', 'PROJECT_CLOSE']);
export type ClosureGate = z.infer<typeof ClosureGateEnum>;

export const CLOSURE_GATE_META: Record<ClosureGate, { label: string; description: string }> = {
  HANDOVER_TO_RETENTION: {
    label: 'Defects liability period',
    description: 'The project cannot move from handover into its defects liability period without an issued certificate.',
  },
  FINAL_PAYMENT: {
    label: 'Final payment',
    description:
      'A final payment or retention release recorded without an issued certificate is flagged as an exception (payments are made outside the platform).',
  },
  PROJECT_CLOSE: { label: 'Project closure', description: 'The project cannot be closed without an issued certificate.' },
};

export const ClosureChecklistItemKindEnum = z.enum([
  'DOCUMENT_TYPE',
  'INSPECTION_VISIT_TYPE',
  'CONTRACT_MILESTONE',
  'CONTRACTOR_RATINGS',
  'LESSONS_LEARNED',
  'AUDIT_SIGNOFF',
  'MANUAL',
]);
export type ClosureChecklistItemKind = z.infer<typeof ClosureChecklistItemKindEnum>;

/** Kinds the platform evaluates itself; the others are completed by a person. */
export const AUTOMATIC_CLOSURE_ITEM_KINDS: ClosureChecklistItemKind[] = [
  'DOCUMENT_TYPE',
  'INSPECTION_VISIT_TYPE',
  'CONTRACT_MILESTONE',
  'CONTRACTOR_RATINGS',
  'LESSONS_LEARNED',
];

export const CLOSURE_ITEM_KIND_META: Record<ClosureChecklistItemKind, { label: string; description: string }> = {
  DOCUMENT_TYPE: { label: 'Document in the register', description: 'Done when a document of the type is filed (and signed, if required).' },
  INSPECTION_VISIT_TYPE: { label: 'Visit accepted', description: 'Done when a monitoring report for a visit of the kind is accepted.' },
  CONTRACT_MILESTONE: { label: 'Contract milestone done', description: 'Done when the contract milestone is done or waived.' },
  CONTRACTOR_RATINGS: { label: 'Contractors rated', description: 'Done when every contractor on the project has a rating at the stage.' },
  LESSONS_LEARNED: { label: 'Lessons published', description: 'Done when the project has at least one published lesson.' },
  AUDIT_SIGNOFF: { label: 'Audit sign-off', description: 'Signed off by someone holding closure:audit_signoff. Cannot be waived.' },
  MANUAL: { label: 'Confirmed by a person', description: 'Ticked by someone holding closure:manage_checklist (or the permission named).' },
};

export const ContractorRatingStageEnum = z.enum(['COMPLETION', 'POST_CLOSURE']);
export type ContractorRatingStage = z.infer<typeof ContractorRatingStageEnum>;

export const CONTRACTOR_RATING_STAGE_META: Record<ContractorRatingStage, { label: string }> = {
  COMPLETION: { label: 'At completion' },
  POST_CLOSURE: { label: 'After closure' },
};

export const CLOSURE_ITEM_KEY_REGEX = /^[a-z][a-z0-9-]{1,47}$/;

export const ClosureChecklistItemTemplateSchema = z
  .object({
    key: z.string().trim().regex(CLOSURE_ITEM_KEY_REGEX, 'Key: lower-case letters, digits and dashes, e.g. as-built-drawings'),
    label: z.string().trim().min(3).max(160),
    description: z.string().trim().max(500).nullable().default(null),
    kind: ClosureChecklistItemKindEnum,
    /** DOCUMENT_TYPE */
    documentTypeCode: z.string().trim().regex(DOCUMENT_TYPE_CODE_REGEX).nullable().default(null),
    /** DOCUMENT_TYPE: needs a sign-off on the current version when the document type requires one. */
    requireSignOff: z.boolean().default(true),
    /** INSPECTION_VISIT_TYPE (key kept): a visit kind (redesign R4d; the Phase 14 types are a subset). */
    inspectionVisitType: VisitKindEnum.nullable().default(null),
    /** CONTRACT_MILESTONE */
    milestoneKey: z.string().trim().regex(MILESTONE_KEY_REGEX).nullable().default(null),
    /** CONTRACTOR_RATINGS */
    ratingStage: ContractorRatingStageEnum.default('COMPLETION'),
    /** MANUAL: who may tick it (default closure:manage_checklist). */
    permissionKey: z.string().trim().max(80).nullable().default(null),
  })
  .superRefine((v, ctx) => {
    const need = (field: 'documentTypeCode' | 'inspectionVisitType' | 'milestoneKey', message: string) => {
      if (!v[field]) ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: [field] });
    };
    if (v.kind === 'DOCUMENT_TYPE') need('documentTypeCode', 'Choose the document type');
    if (v.kind === 'INSPECTION_VISIT_TYPE') need('inspectionVisitType', 'Choose the visit type');
    if (v.kind === 'CONTRACT_MILESTONE') need('milestoneKey', 'Enter the milestone key');
  });
export type ClosureChecklistItemTemplate = z.infer<typeof ClosureChecklistItemTemplateSchema>;
export type ClosureChecklistItemTemplateInput = z.input<typeof ClosureChecklistItemTemplateSchema>;

const ChecklistListSchema = z
  .array(ClosureChecklistItemTemplateSchema)
  .max(40)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((item, i) => {
      if (seen.has(item.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `The key "${item.key}" is used twice.`, path: [i, 'key'] });
      seen.add(item.key);
    });
  });

export const ProjectTypeClosureConfigSchema = z
  .object({
    cocSignatories: z.array(CocSignatorySlotSchema).min(1).max(8).default(DEFAULT_COC_SIGNATORIES),
    beneficiarySignatureMode: BeneficiarySignatureModeEnum.default('RECORDED_BY_STAFF'),
    /** A CoC can only be drafted after an accepted final evaluation visit. */
    requireFinalEvaluationBeforeCoc: z.boolean().default(false),
    requireCocFor: z.array(ClosureGateEnum).max(3).default([]),
    /** The handover ceremony is due this many days after the CoC is issued. */
    handoverDueDaysAfterCoc: z.number().int().min(0).max(90).default(7),
    beforeClose: ChecklistListSchema.default([]),
    beforeArchive: ChecklistListSchema.default([]),
    shareRatingsWithContractor: z.boolean().default(false),
  })
  .superRefine((v, ctx) => {
    const keys = new Set<string>();
    v.cocSignatories.forEach((s, i) => {
      if (keys.has(s.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `The slot key "${s.key}" is used twice.`, path: ['cocSignatories', i, 'key'] });
      keys.add(s.key);
    });
    if (v.cocSignatories.filter((s) => s.isBeneficiary).length > 1) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only one slot can be the beneficiary.', path: ['cocSignatories'] });
    }
    const both = new Set(v.beforeClose.map((i) => i.key));
    v.beforeArchive.forEach((item, i) => {
      if (both.has(item.key)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `"${item.key}" is already in the before-closing list.`, path: ['beforeArchive', i, 'key'] });
      }
    });
  });
export type ProjectTypeClosureConfig = z.infer<typeof ProjectTypeClosureConfigSchema>;
export type ProjectTypeClosureConfigInput = z.input<typeof ProjectTypeClosureConfigSchema>;

/** The key of the milestone created at issuance when the type has none anchored on the CoC. */
export const HANDOVER_CEREMONY_MILESTONE_KEY = 'handover-ceremony';

// ---------------------------------------------------------------------------
// Certificate of Completion
// ---------------------------------------------------------------------------

export const CompletionCertificateStatusEnum = z.enum(['DRAFT', 'PENDING_SIGNATURES', 'ISSUED', 'REVOKED']);
export type CompletionCertificateStatus = z.infer<typeof CompletionCertificateStatusEnum>;

export const COMPLETION_CERTIFICATE_STATUS_META: Record<CompletionCertificateStatus, { label: string }> = {
  DRAFT: { label: 'Draft' },
  PENDING_SIGNATURES: { label: 'Awaiting signatures' },
  ISSUED: { label: 'Issued' },
  REVOKED: { label: 'Revoked' },
};

/** The statement a staff signatory acknowledges unless they write their own. */
export function defaultCocStatement(certificateNumber: string, slotLabel: string): string {
  return `As ${slotLabel}, I confirm that the works described in Certificate of Completion ${certificateNumber} are complete.`;
}

export function defaultBeneficiaryAttestation(certificateNumber: string, beneficiaryName: string): string {
  return `I attest that the attached copy of Certificate of Completion ${certificateNumber} was signed on paper by ${beneficiaryName} for the beneficiary institution.`;
}

export const DraftCompletionCertificateRequestSchema = z.object({
  /** Pre-filled from the project and the final evaluation when omitted. */
  scopeSummary: z.string().trim().min(20, 'Describe the completed scope in at least 20 characters').max(4000).optional(),
  completionDate: IsoDate,
});
export type DraftCompletionCertificateRequest = z.infer<typeof DraftCompletionCertificateRequestSchema>;

export const UpdateCompletionCertificateRequestSchema = z.object({
  scopeSummary: z.string().trim().min(20).max(4000).optional(),
  completionDate: IsoDate.optional(),
});
export type UpdateCompletionCertificateRequest = z.infer<typeof UpdateCompletionCertificateRequestSchema>;

export const SignCompletionCertificateRequestSchema = z.object({
  slotKey: z.string().trim().min(2).max(40),
  statement: z.string().trim().min(10).max(1000).optional(),
});
export type SignCompletionCertificateRequest = z.infer<typeof SignCompletionCertificateRequestSchema>;

/**
 * RECORDED_BY_STAFF: the officer uploads the beneficiary's signed paper certificate (through the
 * usual presign, mediaType PROJECT_DOCUMENT) and attests.
 */
export const RecordBeneficiarySignatureRequestSchema = z.object({
  slotKey: z.string().trim().min(2).max(40),
  beneficiaryName: z.string().trim().min(2, 'Enter the name of the person who signed').max(160),
  beneficiaryRole: z.string().trim().min(2, 'Enter their position').max(160),
  objectKey: z.string().min(10).max(500),
  /** The officer confirms the attestation statement. */
  attest: z.literal(true, { errorMap: () => ({ message: 'Confirm the attestation' }) }),
  statement: z.string().trim().min(10).max(1000).optional(),
});
export type RecordBeneficiarySignatureRequest = z.infer<typeof RecordBeneficiarySignatureRequestSchema>;

export const RevokeCompletionCertificateRequestSchema = z.object({
  reason: z.string().trim().min(10, 'Say why the certificate is revoked (at least 10 characters)').max(1000),
});
export type RevokeCompletionCertificateRequest = z.infer<typeof RevokeCompletionCertificateRequestSchema>;

export const CocSlotSignatureDtoSchema = z.object({
  userId: Uuid.nullable(),
  signerName: z.string(),
  roleName: z.string().nullable(),
  organizationName: z.string().nullable(),
  isBeneficiary: z.boolean(),
  beneficiaryRole: z.string().nullable(),
  evidenceDocumentId: Uuid.nullable(),
  recordedByName: z.string().nullable(),
  statement: z.string(),
  statementHash: z.string(),
  signedAt: z.string(),
});
export type CocSlotSignatureDto = z.infer<typeof CocSlotSignatureDtoSchema>;

export const CocSlotDtoSchema = z.object({
  key: z.string(),
  label: z.string(),
  isBeneficiary: z.boolean(),
  organizationScope: CocSignatoryScopeEnum,
  permissionKey: z.string(),
  roleCode: z.string().nullable(),
  signature: CocSlotSignatureDtoSchema.nullable(),
  /** The caller may sign (or, for the beneficiary slot, record) this slot now. */
  canSign: z.boolean(),
  cannotSignReason: z.string().nullable(),
});
export type CocSlotDto = z.infer<typeof CocSlotDtoSchema>;

export const CompletionCertificateDtoSchema = z.object({
  id: Uuid,
  certificateNumber: z.string(),
  status: CompletionCertificateStatusEnum,
  scopeSummary: z.string(),
  completionDate: z.string(),
  /** Redesign R4d: the accepted final evaluation visit the certificate was drafted on. */
  finalEvaluationVisitId: Uuid.nullable(),
  documentId: Uuid.nullable(),
  issuedAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  revokedReason: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  slots: z.array(CocSlotDtoSchema),
  signedCount: z.number().int(),
});
export type CompletionCertificateDto = z.infer<typeof CompletionCertificateDtoSchema>;

export const ProjectCompletionDtoSchema = z.object({
  projectId: Uuid,
  phase: z.string(),
  rules: z.object({
    requireFinalEvaluationBeforeCoc: z.boolean(),
    requireCocFor: z.array(ClosureGateEnum),
    handoverDueDaysAfterCoc: z.number().int(),
    beneficiarySignatureMode: BeneficiarySignatureModeEnum,
  }),
  finalEvaluation: z.object({
    required: z.boolean(),
    /** Redesign R4d: the accepted final evaluation visit. */
    visitId: Uuid.nullable(),
    visitDate: z.string().nullable(),
    approvedAt: z.string().nullable(),
  }),
  certificate: CompletionCertificateDtoSchema.nullable(),
  revoked: z.array(CompletionCertificateDtoSchema),
  canDraft: z.boolean(),
  draftBlockedReason: z.string().nullable(),
  canRevoke: z.boolean(),
  revokeBlockedReason: z.string().nullable(),
  handoverCeremony: z
    .object({ milestoneId: Uuid, dueDate: z.string().nullable(), status: z.string(), completedAt: z.string().nullable() })
    .nullable(),
  handoverCertificateDocumentId: Uuid.nullable(),
  /** Suggested scope text for a new draft. */
  suggestedScopeSummary: z.string(),
});
export type ProjectCompletionDto = z.infer<typeof ProjectCompletionDtoSchema>;

// ---------------------------------------------------------------------------
// Closure checklist
// ---------------------------------------------------------------------------

export const ClosureChecklistListEnum = z.enum(['BEFORE_CLOSE', 'BEFORE_ARCHIVE']);
export type ClosureChecklistList = z.infer<typeof ClosureChecklistListEnum>;

export const ClosureChecklistItemStatusEnum = z.enum(['PENDING', 'DONE', 'WAIVED']);
export type ClosureChecklistItemStatus = z.infer<typeof ClosureChecklistItemStatusEnum>;

export const ClosureChecklistItemDtoSchema = z.object({
  id: Uuid,
  list: ClosureChecklistListEnum,
  key: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  kind: ClosureChecklistItemKindEnum,
  automatic: z.boolean(),
  /** Effective status: stored DONE/WAIVED, or DONE when an automatic item is met now. */
  status: ClosureChecklistItemStatusEnum,
  /** What the evaluation found ("2 of 3 contractors rated"). */
  detail: z.string().nullable(),
  completedByName: z.string().nullable(),
  completedAt: z.string().nullable(),
  notes: z.string().nullable(),
  waivedReason: z.string().nullable(),
  canComplete: z.boolean(),
  canWaive: z.boolean(),
});
export type ClosureChecklistItemDto = z.infer<typeof ClosureChecklistItemDtoSchema>;

export const ProjectClosureChecklistDtoSchema = z.object({
  projectId: Uuid,
  phase: z.string(),
  status: z.string(),
  /** Items exist once the project has entered handover. */
  generated: z.boolean(),
  beforeClose: z.array(ClosureChecklistItemDtoSchema),
  beforeArchive: z.array(ClosureChecklistItemDtoSchema),
  progress: z.object({
    beforeClose: z.object({ done: z.number().int(), total: z.number().int() }),
    beforeArchive: z.object({ done: z.number().int(), total: z.number().int() }),
  }),
  closeBlockedReason: z.string().nullable(),
  archiveBlockedReason: z.string().nullable(),
});
export type ProjectClosureChecklistDto = z.infer<typeof ProjectClosureChecklistDtoSchema>;

export const CompleteClosureItemRequestSchema = z.object({
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type CompleteClosureItemRequest = z.infer<typeof CompleteClosureItemRequestSchema>;

export const WaiveClosureItemRequestSchema = z.object({
  reason: z.string().trim().min(5, 'Say why the item is waived').max(1000),
});
export type WaiveClosureItemRequest = z.infer<typeof WaiveClosureItemRequestSchema>;

// ---------------------------------------------------------------------------
// Contractor performance ratings
// ---------------------------------------------------------------------------

export const RATING_CRITERION_KEY_REGEX = /^[a-z][a-z0-9_]{1,39}$/;

export const RatingCriterionSchema = z.object({
  key: z.string().trim().regex(RATING_CRITERION_KEY_REGEX, 'Key: lower-case letters, digits and underscores'),
  label: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).nullable().default(null),
});
export type RatingCriterion = z.infer<typeof RatingCriterionSchema>;

export const DEFAULT_RATING_CRITERIA: RatingCriterion[] = [
  { key: 'time', label: 'Time', description: 'Kept to the programme and the agreed milestones.' },
  { key: 'quality', label: 'Quality', description: 'Workmanship and materials met the specification.' },
  { key: 'health_safety', label: 'Health & safety', description: 'Safe site, no avoidable incidents.' },
  { key: 'responsiveness', label: 'Responsiveness', description: 'Answered queries, findings and defects promptly.' },
  { key: 'documentation', label: 'Documentation', description: 'Claims, records and documents complete and on time.' },
];

export const RatingCriteriaListSchema = z
  .array(RatingCriterionSchema)
  .min(1)
  .max(12)
  .superRefine((list, ctx) => {
    const seen = new Set<string>();
    list.forEach((c, i) => {
      if (seen.has(c.key)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: `The key "${c.key}" is used twice.`, path: [i, 'key'] });
      seen.add(c.key);
    });
  });

/** The tenant's criteria, or the defaults when none (or an invalid list) are stored. */
export function resolveRatingCriteria(stored: unknown): RatingCriterion[] {
  const parsed = RatingCriteriaListSchema.safeParse(stored);
  return parsed.success ? parsed.data : DEFAULT_RATING_CRITERIA;
}

export const SaveRatingCriteriaRequestSchema = z.object({ criteria: RatingCriteriaListSchema });
export type SaveRatingCriteriaRequest = z.infer<typeof SaveRatingCriteriaRequestSchema>;

export const RateContractorRequestSchema = z.object({
  projectContractorId: Uuid,
  stage: ContractorRatingStageEnum,
  criteria: z
    .array(z.object({ key: z.string().trim().min(2).max(40), score: z.number().int().min(1).max(5), comment: z.string().trim().max(500).nullable().optional() }))
    .min(1)
    .max(12),
  comments: z.string().trim().max(2000).nullable().optional(),
});
export type RateContractorRequest = z.infer<typeof RateContractorRequestSchema>;

/** Average of the scores, two decimals. */
export function overallRatingScore(scores: number[]): number {
  if (scores.length === 0) return 0;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100;
}

export const ContractorRatingDtoSchema = z.object({
  id: Uuid,
  projectId: Uuid,
  projectCode: z.string(),
  projectName: z.string(),
  projectContractorId: Uuid,
  organizationId: Uuid,
  organizationName: z.string(),
  stage: ContractorRatingStageEnum,
  criteria: z.array(z.object({ key: z.string(), label: z.string(), score: z.number().int(), comment: z.string().nullable() })),
  overallScore: z.number(),
  comments: z.string().nullable(),
  ratedByUserId: Uuid,
  ratedByName: z.string().nullable(),
  createdAt: z.string(),
});
export type ContractorRatingDto = z.infer<typeof ContractorRatingDtoSchema>;

export const ProjectRatingsDtoSchema = z.object({
  criteria: z.array(RatingCriterionSchema),
  sharedWithContractor: z.boolean(),
  /** Stages open for rating now (completion from handover on, post-closure once closed). */
  openStages: z.array(ContractorRatingStageEnum),
  canRate: z.boolean(),
  contractors: z.array(
    z.object({
      projectContractorId: Uuid,
      organizationId: Uuid,
      organizationName: z.string(),
      tradeCode: z.string(),
      contractStatus: z.string(),
      ratings: z.array(ContractorRatingDtoSchema),
      /** Stages the caller has already rated this contractor at. */
      myRatedStages: z.array(ContractorRatingStageEnum),
    })
  ),
});
export type ProjectRatingsDto = z.infer<typeof ProjectRatingsDtoSchema>;

export const OrganizationRatingsDtoSchema = z.object({
  organizationId: Uuid,
  organizationName: z.string(),
  ratingCount: z.number().int(),
  projectCount: z.number().int(),
  averageOverall: z.number().nullable(),
  perCriterion: z.array(z.object({ key: z.string(), label: z.string(), average: z.number().nullable(), count: z.number().int() })),
  ratings: z.array(ContractorRatingDtoSchema),
});
export type OrganizationRatingsDto = z.infer<typeof OrganizationRatingsDtoSchema>;

// ---------------------------------------------------------------------------
// Lessons learned
// ---------------------------------------------------------------------------

export const LessonCategoryEnum = z.enum([
  'PLANNING',
  'DESIGN',
  'PROCUREMENT',
  'CONTRACT_MANAGEMENT',
  'SITE_DELIVERY',
  'QUALITY',
  'HEALTH_SAFETY',
  'COMMUNITY',
  'FINANCE',
  'HANDOVER',
  'OTHER',
]);
export type LessonCategory = z.infer<typeof LessonCategoryEnum>;

export const LESSON_CATEGORY_META: Record<LessonCategory, { label: string }> = {
  PLANNING: { label: 'Planning' },
  DESIGN: { label: 'Design' },
  PROCUREMENT: { label: 'Procurement' },
  CONTRACT_MANAGEMENT: { label: 'Contract management' },
  SITE_DELIVERY: { label: 'Site delivery' },
  QUALITY: { label: 'Quality' },
  HEALTH_SAFETY: { label: 'Health & safety' },
  COMMUNITY: { label: 'Community' },
  FINANCE: { label: 'Finance' },
  HANDOVER: { label: 'Handover' },
  OTHER: { label: 'Other' },
};

export const LessonStageEnum = z.enum(['PRE_CONSTRUCTION', 'MOBILISATION', 'CONSTRUCTION', 'HANDOVER', 'LIABILITY_PERIOD', 'POST_CLOSURE']);
export type LessonStage = z.infer<typeof LessonStageEnum>;

export const LESSON_STAGE_META: Record<LessonStage, { label: string }> = {
  PRE_CONSTRUCTION: { label: 'Before execution' },
  MOBILISATION: { label: 'Mobilisation' },
  CONSTRUCTION: { label: 'Execution' },
  HANDOVER: { label: 'Handover' },
  LIABILITY_PERIOD: { label: 'Defects liability period' },
  POST_CLOSURE: { label: 'After closure' },
};

export const LessonStatusEnum = z.enum(['DRAFT', 'PUBLISHED']);
export type LessonStatus = z.infer<typeof LessonStatusEnum>;

const LessonTag = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9 -]{0,39}$/, 'Tags: letters, digits, spaces and dashes');

export const SaveLessonRequestSchema = z.object({
  category: LessonCategoryEnum,
  title: z.string().trim().min(5, 'Give the lesson a title').max(200),
  description: z.string().trim().min(20, 'Describe what happened in at least 20 characters').max(4000),
  recommendation: z.string().trim().min(10, 'Say what should be done next time').max(4000),
  stage: LessonStageEnum,
  tags: z.array(LessonTag).max(10).default([]),
  sharedWithContractor: z.boolean().default(false),
});
export type SaveLessonRequest = z.infer<typeof SaveLessonRequestSchema>;
export type SaveLessonRequestInput = z.input<typeof SaveLessonRequestSchema>;

export const LessonDtoSchema = z.object({
  id: Uuid,
  projectId: Uuid,
  projectCode: z.string(),
  projectName: z.string(),
  projectTypeName: z.string().nullable(),
  regionName: z.string().nullable(),
  category: LessonCategoryEnum,
  title: z.string(),
  description: z.string(),
  recommendation: z.string(),
  stage: LessonStageEnum,
  tags: z.array(z.string()),
  status: LessonStatusEnum,
  sharedWithContractor: z.boolean(),
  createdByName: z.string().nullable(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  canEdit: z.boolean(),
});
export type LessonDto = z.infer<typeof LessonDtoSchema>;

// ---------------------------------------------------------------------------
// Closure pack
// ---------------------------------------------------------------------------

export const ClosurePackStatusEnum = z.enum(['QUEUED', 'RUNNING', 'DONE', 'FAILED']);
export type ClosurePackStatus = z.infer<typeof ClosurePackStatusEnum>;

export const ClosurePackExportDtoSchema = z.object({
  id: Uuid,
  status: ClosurePackStatusEnum,
  documentId: Uuid.nullable(),
  byteSize: z.number().int().nullable(),
  entryCount: z.number().int().nullable(),
  chainVerified: z.boolean().nullable(),
  requestedByName: z.string().nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type ClosurePackExportDto = z.infer<typeof ClosurePackExportDtoSchema>;
