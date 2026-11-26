import { z } from 'zod';
import { ApprovalOrganizationScopeEnum } from '../enums';
import { OrganizationRefSchema } from './organization.schema';
import { ApprovalProgressDtoSchema } from './process.schema';

/**
 * Phase 13: the stretch between contract award and the contractor working on site.
 * - Document register: typed, versioned project documents with authenticated sign-offs.
 * - Contract milestones: dated obligations computed from anchor dates with per-type offsets.
 * - Kick-off meeting: invitees by stakeholder group, notice, quorum, minutes.
 * - Contractor mobilisation compliance and default cases (CONTRACT_DEFAULT chain) and termination
 *   (redesign R1d: one contractor per project, no replacement).
 * - Programme of works (redesign R2d): a PROGRAMME_OF_WORKS document; its sign-off completes the
 *   "programme accepted" milestone (AUTO_SCHEDULE_BASELINE_SET).
 *
 * Due-date maths is pure and lives in utils/contractMilestones.ts.
 */

const Uuid = z.string().uuid();
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const IsoDateTime = z.string().datetime({ offset: true });

// ---------------------------------------------------------------------------
// Document types (tenant settings)
// ---------------------------------------------------------------------------

export const DOCUMENT_TYPE_CODE_REGEX = /^[A-Z][A-Z0-9_]{1,39}$/;

export interface DefaultDocumentTypeDefinition {
  code: string;
  name: string;
  description: string;
  visibleToContractors: boolean;
  requiresSignOff: boolean;
}

/** Document types every tenant starts with. Codes are stable: project types and milestones refer to them. */
export const DEFAULT_DOCUMENT_TYPES: DefaultDocumentTypeDefinition[] = [
  { code: 'CONTRACT', name: 'Signed contract', description: 'The signed contract agreement.', visibleToContractors: true, requiresSignOff: false },
  { code: 'AWARD_LETTER', name: 'Award letter', description: 'Letter of award to the contractor.', visibleToContractors: true, requiresSignOff: false },
  { code: 'ACCEPTANCE_LETTER', name: 'Acceptance letter', description: "The contractor's acceptance of the award.", visibleToContractors: true, requiresSignOff: false },
  { code: 'KICKOFF_BRIEFING_PACK', name: 'Kick-off briefing pack', description: 'Agenda and briefing pack sent with the kick-off notice.', visibleToContractors: true, requiresSignOff: false },
  { code: 'KICKOFF_NOTICE_RECEIPT', name: 'Evidence of receipt (kick-off notification)', description: 'Proof that the kick-off notice was delivered (when not sent through the platform).', visibleToContractors: false, requiresSignOff: false },
  { code: 'KICKOFF_MINUTES', name: 'Kick-off meeting minutes', description: 'Minutes of the kick-off meeting, signed off by attendees.', visibleToContractors: true, requiresSignOff: true },
  { code: 'MOBILISATION_AGREEMENT', name: 'Mobilisation agreement', description: 'Agreement on how and when the contractor mobilises.', visibleToContractors: true, requiresSignOff: true },
  { code: 'MOBILISATION_PLAN', name: 'Mobilisation plan', description: "The contractor's plan for people, plant and materials.", visibleToContractors: true, requiresSignOff: false },
  { code: 'PROGRAMME_OF_WORKS', name: 'Programme of works', description: "The contractor's programme of works. Signing it off accepts the programme.", visibleToContractors: true, requiresSignOff: true },
  { code: 'LETTER_OF_INTRODUCTION', name: 'Letter of introduction', description: 'Introduces the contractor to the beneficiary and community.', visibleToContractors: true, requiresSignOff: false },
  { code: 'SITE_POSSESSION_FORM', name: 'Site possession form', description: 'Records that the site was handed to the contractor.', visibleToContractors: true, requiresSignOff: true },
  { code: 'SUPERVISOR_ASSIGNMENT', name: 'Supervisor assignment record', description: 'Names the supervisor assigned to the site.', visibleToContractors: true, requiresSignOff: false },
  { code: 'CP_EVIDENCE', name: 'Condition precedent evidence', description: 'Evidence that a condition precedent is satisfied.', visibleToContractors: false, requiresSignOff: false },
  { code: 'COMPLETION_CERTIFICATE', name: 'Certificate of Completion (CoC)', description: 'Certificate of Completion of the works.', visibleToContractors: true, requiresSignOff: true },
  { code: 'HANDOVER_CERTIFICATE', name: 'Handover certificate', description: 'Certificate of handover to the beneficiary.', visibleToContractors: true, requiresSignOff: true },
  { code: 'FINAL_EVALUATION_REPORT', name: 'Final evaluation report', description: 'Final evaluation of the project.', visibleToContractors: false, requiresSignOff: false },
  { code: 'CLOSEOUT_REPORT', name: 'Lessons learned report', description: 'Final evaluation summary, lessons learned and beneficiary feedback.', visibleToContractors: false, requiresSignOff: false },
  { code: 'CLOSURE_FILE', name: 'Project closure file', description: 'The project closure file.', visibleToContractors: false, requiresSignOff: false },
  { code: 'OTHER', name: 'Other', description: 'Any other project document.', visibleToContractors: false, requiresSignOff: false },
];

/** File types a document type may allow (an empty list allows every PROJECT_DOCUMENT type). */
export const DOCUMENT_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
] as const;

export const DocumentTypeDtoSchema = z.object({
  id: Uuid,
  code: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  visibleToContractors: z.boolean(),
  requiresSignOff: z.boolean(),
  signOffPermissionKey: z.string().nullable(),
  allowedMimeTypes: z.array(z.string()),
  isArchived: z.boolean(),
  documentCount: z.number().int(),
});
export type DocumentTypeDto = z.infer<typeof DocumentTypeDtoSchema>;

export const SaveDocumentTypeRequestSchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(DOCUMENT_TYPE_CODE_REGEX, 'Code: 2 to 40 capital letters, digits or underscores, e.g. SITE_PLAN'),
  name: z.string().trim().min(2, 'Enter at least 2 characters').max(120),
  description: z.string().trim().max(500).nullable().optional(),
  visibleToContractors: z.boolean().default(false),
  requiresSignOff: z.boolean().default(false),
  /** Only holders of this permission may sign documents of this type; null = anyone who can view. */
  signOffPermissionKey: z.string().trim().nullable().optional(),
  allowedMimeTypes: z.array(z.enum(DOCUMENT_MIME_TYPES)).max(DOCUMENT_MIME_TYPES.length).default([]),
  isArchived: z.boolean().optional(),
});
export type SaveDocumentTypeRequest = z.infer<typeof SaveDocumentTypeRequestSchema>;
export type SaveDocumentTypeRequestInput = z.input<typeof SaveDocumentTypeRequestSchema>;

/** Whether a file type is allowed for a document type (shared by the server and the upload form). */
export function documentMimeAllowed(type: { allowedMimeTypes: string[] }, mimeType: string): boolean {
  const m = mimeType.toLowerCase();
  if (type.allowedMimeTypes.length === 0) return (DOCUMENT_MIME_TYPES as readonly string[]).includes(m);
  return type.allowedMimeTypes.includes(m);
}

/** The statement a sign-off acknowledges unless the signer writes their own. */
export function defaultSignOffStatement(title: string, version: number): string {
  return `I have read "${title}" (version ${version}) and confirm its contents.`;
}

// ---------------------------------------------------------------------------
// Project documents
// ---------------------------------------------------------------------------

export const ProjectDocumentVersionDtoSchema = z.object({
  version: z.number().int(),
  mimeType: z.string(),
  byteSize: z.number().int(),
  sha256: z.string(),
  uploadedByUserId: Uuid.nullable(),
  uploadedByName: z.string().nullable(),
  uploadedAt: z.string(),
  note: z.string().nullable(),
});
export type ProjectDocumentVersionDto = z.infer<typeof ProjectDocumentVersionDtoSchema>;

export const ProjectDocumentSignOffDtoSchema = z.object({
  id: Uuid,
  version: z.number().int(),
  userId: Uuid,
  userName: z.string().nullable(),
  roleName: z.string().nullable(),
  organizationName: z.string().nullable(),
  statement: z.string(),
  statementHash: z.string(),
  signedAt: z.string(),
});
export type ProjectDocumentSignOffDto = z.infer<typeof ProjectDocumentSignOffDtoSchema>;

export const ProjectDocumentDtoSchema = z.object({
  id: Uuid,
  projectId: Uuid,
  documentType: z.object({
    id: Uuid,
    code: z.string(),
    name: z.string(),
    requiresSignOff: z.boolean(),
    visibleToContractors: z.boolean(),
    signOffPermissionKey: z.string().nullable(),
  }),
  title: z.string(),
  currentVersion: z.number().int(),
  current: ProjectDocumentVersionDtoSchema,
  uploadedByUserId: Uuid.nullable(),
  uploadedByName: z.string().nullable(),
  projectContractorId: Uuid.nullable(),
  contractorName: z.string().nullable(),
  linkedMilestoneId: Uuid.nullable(),
  isArchived: z.boolean(),
  createdAt: z.string(),
  /** Sign-offs on the current version. */
  signOffCount: z.number().int(),
  signedByMe: z.boolean(),
  /** The type needs a sign-off and the current version has none. */
  awaitingSignOff: z.boolean(),
  /** Whether the caller may sign the current version (permission held, not signed yet). */
  canSign: z.boolean(),
});
export type ProjectDocumentDto = z.infer<typeof ProjectDocumentDtoSchema>;

export const ProjectDocumentDetailDtoSchema = ProjectDocumentDtoSchema.extend({
  versions: z.array(ProjectDocumentVersionDtoSchema),
  signOffs: z.array(ProjectDocumentSignOffDtoSchema),
});
export type ProjectDocumentDetailDto = z.infer<typeof ProjectDocumentDetailDtoSchema>;

/**
 * POST /projects/:projectId/documents. The file is uploaded first through the usual presign
 * (`POST .../evidence/presign`, mediaType PROJECT_DOCUMENT); the server reads its size, type and
 * SHA-256 from storage, never from the client.
 */
export const RegisterProjectDocumentRequestSchema = z.object({
  documentTypeId: Uuid,
  title: z.string().trim().min(2, 'Give the document a title').max(200),
  objectKey: z.string().min(10).max(500),
  note: z.string().trim().max(500).nullable().optional(),
  /** Ties the document to one contractor (its users then see it if the type is shared). */
  projectContractorId: Uuid.nullable().optional(),
  linkedMilestoneId: Uuid.nullable().optional(),
});
export type RegisterProjectDocumentRequest = z.infer<typeof RegisterProjectDocumentRequestSchema>;

export const AddDocumentVersionRequestSchema = z.object({
  objectKey: z.string().min(10).max(500),
  note: z.string().trim().max(500).nullable().optional(),
});
export type AddDocumentVersionRequest = z.infer<typeof AddDocumentVersionRequestSchema>;

export const SignProjectDocumentRequestSchema = z.object({
  /** Must be the current version. */
  version: z.number().int().positive(),
  /** Defaults to `defaultSignOffStatement`. */
  statement: z.string().trim().min(10).max(1000).optional(),
});
export type SignProjectDocumentRequest = z.infer<typeof SignProjectDocumentRequestSchema>;

export const ArchiveProjectDocumentRequestSchema = z.object({
  reason: z.string().trim().min(5, 'Say why the document is archived').max(500),
});
export type ArchiveProjectDocumentRequest = z.infer<typeof ArchiveProjectDocumentRequestSchema>;

export const DocumentDownloadDtoSchema = z.object({
  url: z.string(),
  expiresInSeconds: z.number().int(),
  fileName: z.string(),
});
export type DocumentDownloadDto = z.infer<typeof DocumentDownloadDtoSchema>;

// ---------------------------------------------------------------------------
// Contract milestones: templates (project type config) and enums
// ---------------------------------------------------------------------------

/** Phase 15: COC_ISSUED (the Certificate of Completion's issue date) and PROJECT_CLOSED (the day the project was closed). */
export const ContractMilestoneAnchorEnum = z.enum(['CONTRACT_AWARD', 'CONTRACT_SIGNED', 'KICKOFF', 'ACTIVATION', 'MILESTONE', 'COC_ISSUED', 'PROJECT_CLOSED']);
export type ContractMilestoneAnchor = z.infer<typeof ContractMilestoneAnchorEnum>;

export const MilestoneOffsetUnitEnum = z.enum(['CALENDAR_DAYS', 'WORKING_DAYS']);
export type MilestoneOffsetUnit = z.infer<typeof MilestoneOffsetUnitEnum>;

export const ContractMilestoneStatusEnum = z.enum(['PENDING', 'DUE', 'OVERDUE', 'DONE', 'WAIVED']);
export type ContractMilestoneStatus = z.infer<typeof ContractMilestoneStatusEnum>;

/**
 * MANUAL: someone with milestones:manage completes it (required documents present and signed).
 * AUTO_*: completed by the platform when the event happens.
 */
export const MilestoneCompletionModeEnum = z.enum([
  'MANUAL',
  'AUTO_CONTRACTOR_ON_SITE',
  'AUTO_KICKOFF_NOTICE_SENT',
  'AUTO_KICKOFF_QUORUM',
  'AUTO_SCHEDULE_BASELINE_SET',
  // Phase 15
  'AUTO_COC_ISSUED',
  'AUTO_HANDOVER_ACCEPTED',
  'AUTO_FINAL_EVALUATION_APPROVED',
]);
export type MilestoneCompletionMode = z.infer<typeof MilestoneCompletionModeEnum>;

/** Who is responsible for a milestone, relative to the project (notifications follow it). */
export const MilestoneResponsibleScopeEnum = z.enum([...ApprovalOrganizationScopeEnum.options, 'MONITOR', 'CONTRACTOR']);
export type MilestoneResponsibleScope = z.infer<typeof MilestoneResponsibleScopeEnum>;

export const CONTRACT_MILESTONE_ANCHOR_META: Record<ContractMilestoneAnchor, { label: string }> = {
  CONTRACT_AWARD: { label: 'Contract award' },
  CONTRACT_SIGNED: { label: 'Contract signed' },
  KICKOFF: { label: 'Kick-off' },
  ACTIVATION: { label: 'Activation' },
  MILESTONE: { label: 'Another milestone done' },
  COC_ISSUED: { label: 'Certificate of Completion issued' },
  PROJECT_CLOSED: { label: 'Project closed' },
};

export const MILESTONE_COMPLETION_MODE_META: Record<MilestoneCompletionMode, { label: string; description: string }> = {
  MANUAL: { label: 'Completed by a person', description: 'Completed by someone with milestones:manage once its documents are in place.' },
  AUTO_CONTRACTOR_ON_SITE: { label: 'Mobilised to site', description: 'Completed when an officer confirms the contractor has mobilised to site, or an accepted mobilisation check says so.' },
  AUTO_KICKOFF_NOTICE_SENT: { label: 'Kick-off notice sent', description: 'Completed when the kick-off notice goes out through the platform.' },
  AUTO_KICKOFF_QUORUM: { label: 'Kick-off held', description: 'Completed when the kick-off is recorded as held with quorum (or a waiver).' },
  AUTO_SCHEDULE_BASELINE_SET: { label: 'Programme of works accepted', description: 'Completed when a programme of works document is signed off.' },
  AUTO_COC_ISSUED: { label: 'Certificate issued', description: 'Completed when the Certificate of Completion is issued (reopened if it is revoked).' },
  AUTO_HANDOVER_ACCEPTED: { label: 'Handover accepted', description: 'Completed when an accepted handover response is reviewed (the handover certificate is issued).' },
  AUTO_FINAL_EVALUATION_APPROVED: {
    label: 'Evaluation accepted',
    description: 'Completed when a final or post-closure evaluation is accepted while the milestone has a due date (e.g. after closure).',
  },
};

export const MILESTONE_KEY_REGEX = /^[a-z][a-z0-9-]{1,47}$/;

export const ContractMilestoneTemplateSchema = z.object({
  key: z.string().trim().regex(MILESTONE_KEY_REGEX, 'Key: lower-case letters, digits and dashes, e.g. kickoff-held'),
  label: z.string().trim().min(3).max(160),
  description: z.string().trim().max(500).nullable().default(null),
  anchor: ContractMilestoneAnchorEnum,
  /** For anchor MILESTONE: the key of the milestone whose completion it counts from. */
  anchorMilestoneKey: z.string().trim().nullable().default(null),
  /** Negative = before the anchor (e.g. kick-off notice −7 days). */
  offsetValue: z.number().int().min(-365).max(730),
  offsetUnit: MilestoneOffsetUnitEnum.default('CALENDAR_DAYS'),
  completionMode: MilestoneCompletionModeEnum.default('MANUAL'),
  /** Document type codes that must be in the register (and signed, if the type needs it). */
  requiredDocumentTypeCodes: z.array(z.string().trim().regex(DOCUMENT_TYPE_CODE_REGEX)).max(10).default([]),
  /** A sign-off by someone holding this permission is needed on the required documents. */
  signOffPermissionKey: z.string().trim().nullable().default(null),
  /** Role (by code) responsible; notifications go to it within the responsible scope. */
  responsibleRoleCode: z.string().trim().nullable().default(null),
  responsibleScope: MilestoneResponsibleScopeEnum.default('ANY'),
  /** One row per contractor (e.g. mobilisation). */
  perContractor: z.boolean().default(false),
});
export type ContractMilestoneTemplate = z.infer<typeof ContractMilestoneTemplateSchema>;
export type ContractMilestoneTemplateInput = z.input<typeof ContractMilestoneTemplateSchema>;

/** Issues with a template list: duplicate keys, missing or circular milestone anchors. */
export function contractMilestoneTemplateIssues(
  templates: ReadonlyArray<Pick<ContractMilestoneTemplate, 'key' | 'anchor' | 'anchorMilestoneKey'>>
): Array<{ index: number; message: string }> {
  const issues: Array<{ index: number; message: string }> = [];
  const byKey = new Map<string, number>();
  templates.forEach((t, i) => {
    if (byKey.has(t.key)) issues.push({ index: i, message: `The key "${t.key}" is used twice.` });
    else byKey.set(t.key, i);
  });
  templates.forEach((t, i) => {
    if (t.anchor !== 'MILESTONE') return;
    if (!t.anchorMilestoneKey) issues.push({ index: i, message: 'Choose the milestone this one counts from.' });
    else if (!byKey.has(t.anchorMilestoneKey)) issues.push({ index: i, message: `No milestone has the key "${t.anchorMilestoneKey}".` });
    else {
      // Follow the chain; coming back to the start is a cycle.
      const seen = new Set<string>([t.key]);
      let next: string | null = t.anchorMilestoneKey;
      while (next) {
        if (seen.has(next)) {
          issues.push({ index: i, message: `"${t.key}" counts from itself through other milestones.` });
          break;
        }
        seen.add(next);
        const n: (typeof templates)[number] | undefined = templates[byKey.get(next) ?? -1];
        next = n && n.anchor === 'MILESTONE' ? n.anchorMilestoneKey : null;
      }
    }
  });
  return issues;
}

export const ContractMilestoneTemplateListSchema = z
  .array(ContractMilestoneTemplateSchema)
  .max(40)
  .superRefine((list, ctx) => {
    for (const issue of contractMilestoneTemplateIssues(list)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [issue.index], message: issue.message });
    }
  });

/** Kick-off stakeholder groups; invitees are pre-filled from the project's parties per group. */
export const KickoffStakeholderGroupEnum = z.enum(['OWNER', 'FUNDER', 'MONITOR', 'CONTRACTOR', 'BENEFICIARY', 'COMMUNITY', 'OTHER']);
export type KickoffStakeholderGroup = z.infer<typeof KickoffStakeholderGroupEnum>;

export const KICKOFF_STAKEHOLDER_GROUP_META: Record<KickoffStakeholderGroup, { label: string }> = {
  OWNER: { label: 'Owning organisation' },
  FUNDER: { label: 'Funder' },
  MONITOR: { label: 'Monitor' },
  CONTRACTOR: { label: 'Contractor' },
  BENEFICIARY: { label: 'Beneficiary' },
  COMMUNITY: { label: 'Community' },
  OTHER: { label: 'Other' },
};

export const ProjectTypeKickoffConfigSchema = z.object({
  /** Quorum: at least one attendee per group. Empty = no quorum rule. */
  requiredStakeholderGroups: z.array(KickoffStakeholderGroupEnum).max(7).default([]),
  /** The notice must go out at least this many days before the meeting (or be waived). */
  noticeLeadDays: z.number().int().min(0).max(60).default(7),
});
export type ProjectTypeKickoffConfig = z.infer<typeof ProjectTypeKickoffConfigSchema>;

export const ProjectTypeDocumentRequirementsSchema = z.object({
  /** Document type codes needed before the project can be set active. */
  beforeActivation: z.array(z.string().trim().regex(DOCUMENT_TYPE_CODE_REGEX)).max(20).default([]),
  /** Shown on the mobilisation compliance panel until present for each contractor. */
  beforeMobilisation: z.array(z.string().trim().regex(DOCUMENT_TYPE_CODE_REGEX)).max(20).default([]),
});
export type ProjectTypeDocumentRequirements = z.infer<typeof ProjectTypeDocumentRequirementsSchema>;

export const ProjectTypeDefaultCasesConfigSchema = z.object({
  /** The Legal role (by code): its users are told about new cases and it names the review step. */
  legalRoleCode: z.string().trim().nullable().default(null),
  /** An overdue mobilisation milestone opens a case automatically (once per milestone). */
  autoOpenOnOverdueMobilisation: z.boolean().default(true),
});
export type ProjectTypeDefaultCasesConfig = z.infer<typeof ProjectTypeDefaultCasesConfigSchema>;

// ---------------------------------------------------------------------------
// Contract step (wizard)
// ---------------------------------------------------------------------------

export const ProjectContractStepSchema = z
  .object({
    contractReference: z.string().trim().max(120).nullable().optional(),
    contractAwardDate: IsoDate.nullable().optional(),
    contractSignedDate: IsoDate.nullable().optional(),
    contractSumNgn: z.number().positive('The contract sum must be above zero').nullable().optional(),
    /** Planned kick-off date. */
    kickoffDate: IsoDate.nullable().optional(),
    /** Live projects: why an anchor date moved (required then, with milestones:manage). */
    changeReason: z.string().trim().min(5).max(500).optional(),
  })
  .refine((v) => !v.contractAwardDate || !v.contractSignedDate || v.contractAwardDate <= v.contractSignedDate, {
    message: 'The contract cannot be signed before it is awarded',
    path: ['contractSignedDate'],
  })
  .refine(
    (v) => !v.kickoffDate || ![v.contractSignedDate, v.contractAwardDate].some((d) => d && d > v.kickoffDate!),
    { message: 'The kick-off cannot be before the contract is awarded or signed', path: ['kickoffDate'] }
  );
export type ProjectContractStep = z.infer<typeof ProjectContractStepSchema>;

export const ProjectContractDetailsDtoSchema = z.object({
  contractReference: z.string().nullable(),
  contractAwardDate: z.string().nullable(),
  contractSignedDate: z.string().nullable(),
  contractSumNgn: z.number().nullable(),
  kickoffDate: z.string().nullable(),
  kickoffHeldAt: z.string().nullable(),
  /** Anchors the project type's milestones count from (each needs a date to activate). */
  requiredAnchors: z.array(ContractMilestoneAnchorEnum),
  milestoneTemplateCount: z.number().int(),
});
export type ProjectContractDetailsDto = z.infer<typeof ProjectContractDetailsDtoSchema>;

// ---------------------------------------------------------------------------
// Contract milestones (project rows)
// ---------------------------------------------------------------------------

export const ContractMilestoneEvidenceSchema = z.object({
  documentTypeCode: z.string(),
  documentTypeName: z.string(),
  documentId: Uuid.nullable(),
  documentTitle: z.string().nullable(),
  /** The type needs a sign-off (or the milestone names a sign-off permission). */
  signOffRequired: z.boolean(),
  signed: z.boolean(),
});
export type ContractMilestoneEvidence = z.infer<typeof ContractMilestoneEvidenceSchema>;

export const ContractMilestoneDtoSchema = z.object({
  id: Uuid,
  projectContractorId: Uuid.nullable(),
  contractorName: z.string().nullable(),
  key: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  anchor: ContractMilestoneAnchorEnum,
  anchorMilestoneKey: z.string().nullable(),
  offsetValue: z.number().int(),
  offsetUnit: MilestoneOffsetUnitEnum,
  /** "Kick-off + 21 days" */
  anchorLabel: z.string(),
  /** Set when a milestone is counted from another date than its anchor (extensions). */
  anchorDateOverride: z.string().nullable(),
  dueDate: z.string().nullable(),
  /** PENDING / DUE / OVERDUE as of today in the project zone; DONE and WAIVED as stored. */
  status: ContractMilestoneStatusEnum,
  /** Days until the due date (negative = overdue); null without a date or once closed. */
  daysLeft: z.number().int().nullable(),
  completionMode: MilestoneCompletionModeEnum,
  requiredDocumentTypeCodes: z.array(z.string()),
  requiresSignOffPermissionKey: z.string().nullable(),
  responsibleRoleId: Uuid.nullable(),
  responsibleRoleName: z.string().nullable(),
  responsibleScope: MilestoneResponsibleScopeEnum,
  completedAt: z.string().nullable(),
  completedByName: z.string().nullable(),
  completedNotes: z.string().nullable(),
  waivedReason: z.string().nullable(),
  evidence: z.array(ContractMilestoneEvidenceSchema),
  /** Manual milestone whose required documents are all in place and signed. */
  readyToComplete: z.boolean(),
  openDefaultCaseId: Uuid.nullable(),
  sortOrder: z.number().int(),
});
export type ContractMilestoneDto = z.infer<typeof ContractMilestoneDtoSchema>;

export const ProjectMilestonesDtoSchema = z.object({
  today: z.string(),
  anchors: z.object({
    contractAwardDate: z.string().nullable(),
    contractSignedDate: z.string().nullable(),
    kickoffDate: z.string().nullable(),
    activationDate: z.string().nullable(),
  }),
  milestones: z.array(ContractMilestoneDtoSchema),
  summary: z.object({
    total: z.number().int(),
    done: z.number().int(),
    overdue: z.number().int(),
    /** Due within the next 7 days (today included). */
    dueSoon: z.number().int(),
  }),
});
export type ProjectMilestonesDto = z.infer<typeof ProjectMilestonesDtoSchema>;

export const CompleteMilestoneRequestSchema = z.object({
  notes: z.string().trim().max(1000).nullable().optional(),
});
export type CompleteMilestoneRequest = z.infer<typeof CompleteMilestoneRequestSchema>;

export const WaiveMilestoneRequestSchema = z.object({
  reason: z.string().trim().min(5, 'Say why the milestone is waived').max(1000),
});
export type WaiveMilestoneRequest = z.infer<typeof WaiveMilestoneRequestSchema>;

// ---------------------------------------------------------------------------
// Kick-off meeting
// ---------------------------------------------------------------------------

export const KickoffInviteeInputSchema = z.object({
  id: Uuid.optional(),
  stakeholderGroup: KickoffStakeholderGroupEnum,
  name: z.string().trim().min(2, 'Enter the name').max(160),
  email: z.string().trim().email().max(200).nullable().optional().or(z.literal('').transform(() => null)),
  phone: z.string().trim().max(32).nullable().optional(),
  organizationId: Uuid.nullable().optional(),
  userId: Uuid.nullable().optional(),
});
export type KickoffInviteeInput = z.infer<typeof KickoffInviteeInputSchema>;

export const SaveKickoffMeetingRequestSchema = z.object({
  scheduledAt: IsoDateTime,
  location: z.string().trim().max(300).nullable().optional(),
  virtualLink: z.string().trim().url().max(500).nullable().optional().or(z.literal('').transform(() => null)),
  /** A register document (normally KICKOFF_BRIEFING_PACK) sent with the notice. */
  agendaDocumentId: Uuid.nullable().optional(),
  invitees: z.array(KickoffInviteeInputSchema).min(1, 'Invite at least one person').max(200),
});
export type SaveKickoffMeetingRequest = z.infer<typeof SaveKickoffMeetingRequestSchema>;

export const SendKickoffNoticeRequestSchema = z.object({
  /** Required when fewer than the type's notice lead days remain. */
  waiveLeadTimeReason: z.string().trim().min(5).max(500).optional(),
});
export type SendKickoffNoticeRequest = z.infer<typeof SendKickoffNoticeRequestSchema>;

export const RecordKickoffHeldRequestSchema = z.object({
  heldAt: IsoDateTime,
  attendance: z.array(z.object({ inviteeId: Uuid, attended: z.boolean() })).max(200),
  minutesDocumentId: Uuid.nullable().optional(),
  /** Required when the required stakeholder groups were not all present. */
  quorumWaivedReason: z.string().trim().min(5).max(500).optional(),
  /** When held on another day than the planned kick-off date: move the anchor (default yes). */
  moveKickoffAnchor: z.boolean().default(true),
});
export type RecordKickoffHeldRequest = z.infer<typeof RecordKickoffHeldRequestSchema>;

export const KickoffNoticeStatusEnum = z.enum(['NOT_SENT', 'NO_EMAIL', 'QUEUED', 'SENT', 'FAILED']);
export type KickoffNoticeStatus = z.infer<typeof KickoffNoticeStatusEnum>;

export const KickoffInviteeDtoSchema = z.object({
  id: Uuid,
  stakeholderGroup: KickoffStakeholderGroupEnum,
  name: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  organizationId: Uuid.nullable(),
  organizationName: z.string().nullable(),
  userId: Uuid.nullable(),
  attended: z.boolean().nullable(),
  noticeStatus: KickoffNoticeStatusEnum,
  noticeSentAt: z.string().nullable(),
});
export type KickoffInviteeDto = z.infer<typeof KickoffInviteeDtoSchema>;

export const KickoffMeetingDtoSchema = z.object({
  id: Uuid,
  scheduledAt: z.string(),
  location: z.string().nullable(),
  virtualLink: z.string().nullable(),
  agendaDocumentId: Uuid.nullable(),
  agendaDocumentTitle: z.string().nullable(),
  minutesDocumentId: Uuid.nullable(),
  minutesDocumentTitle: z.string().nullable(),
  noticeSentAt: z.string().nullable(),
  noticeLeadDays: z.number().int(),
  noticeWaivedReason: z.string().nullable(),
  heldAt: z.string().nullable(),
  quorumMet: z.boolean().nullable(),
  quorumWaivedReason: z.string().nullable(),
  requiredStakeholderGroups: z.array(KickoffStakeholderGroupEnum),
  /** Per required group: invited and attended (attended null before the meeting is recorded). */
  quorum: z.array(
    z.object({ group: KickoffStakeholderGroupEnum, invitedCount: z.number().int(), attendedCount: z.number().int().nullable() })
  ),
  invitees: z.array(KickoffInviteeDtoSchema),
});
export type KickoffMeetingDto = z.infer<typeof KickoffMeetingDtoSchema>;

/** Needs pipeline N0 (D-N.22): shown on the kick-off tab; never blocks a save. */
export const KickoffWarningCodeEnum = z.enum(['KICKOFF_AFTER_AWARD_WINDOW']);
export type KickoffWarningCode = z.infer<typeof KickoffWarningCodeEnum>;

export const KickoffWarningSchema = z.object({
  code: KickoffWarningCodeEnum,
  message: z.string(),
  /** KICKOFF_AFTER_AWARD_WINDOW: the dates the rule compared (YYYY-MM-DD). */
  contractAwardDate: z.string().nullable(),
  plannedKickoffDate: z.string().nullable(),
  latestKickoffDate: z.string().nullable(),
});
export type KickoffWarning = z.infer<typeof KickoffWarningSchema>;

export const ProjectKickoffDtoSchema = z.object({
  meeting: KickoffMeetingDtoSchema.nullable(),
  plannedKickoffDate: z.string().nullable(),
  requiredStakeholderGroups: z.array(KickoffStakeholderGroupEnum),
  noticeLeadDays: z.number().int(),
  /** Non-blocking warnings about the plan (empty once the kick-off is held). */
  warnings: z.array(KickoffWarningSchema),
  /** Pre-filled invitees from the parties, beneficiaries and assigned users (for a new meeting). */
  suggestedInvitees: z.array(KickoffInviteeInputSchema),
});
export type ProjectKickoffDto = z.infer<typeof ProjectKickoffDtoSchema>;

/** Whether every required group has an attendee. Pure: used by the server and the form. */
export function kickoffQuorumMet(required: KickoffStakeholderGroup[], attendedGroups: KickoffStakeholderGroup[]): boolean {
  const present = new Set(attendedGroups);
  return required.every((g) => present.has(g));
}

// ---------------------------------------------------------------------------
// Default cases, termination and replacement
// ---------------------------------------------------------------------------

export const ContractStatusEnum = z.enum(['ACTIVE', 'TERMINATED']);
export type ContractStatus = z.infer<typeof ContractStatusEnum>;

export const DefaultCaseTriggerEnum = z.enum(['MILESTONE_OVERDUE', 'MANUAL']);
export type DefaultCaseTrigger = z.infer<typeof DefaultCaseTriggerEnum>;

export const DefaultCaseStatusEnum = z.enum(['OPEN', 'IN_REVIEW', 'CURE_PERIOD', 'EXTENSION_GRANTED', 'TERMINATED', 'CLOSED']);
export type DefaultCaseStatus = z.infer<typeof DefaultCaseStatusEnum>;

/** Statuses of a case that is still running (one per contractor at a time). */
export const OPEN_DEFAULT_CASE_STATUSES: DefaultCaseStatus[] = ['OPEN', 'IN_REVIEW', 'CURE_PERIOD'];

export const DefaultCaseOutcomeEnum = z.enum(['CURE_PERIOD', 'EXTENSION_GRANTED', 'TERMINATED', 'CLOSED']);
export type DefaultCaseOutcome = z.infer<typeof DefaultCaseOutcomeEnum>;

export const DEFAULT_CASE_OUTCOME_META: Record<DefaultCaseOutcome, { label: string; description: string }> = {
  CURE_PERIOD: { label: 'Cure period', description: 'The contractor has until a new date to remedy the default. The case comes back for a decision if it does not.' },
  EXTENSION_GRANTED: { label: 'Extension granted', description: "The milestone's due date moves to the new date." },
  TERMINATED: {
    label: 'Terminate the contract',
    description: "Ends the contractor's contract on this project.",
  },
  CLOSED: { label: 'Close with no action', description: 'The case is closed without consequences.' },
};

export const RaiseDefaultCaseRequestSchema = z.object({
  projectContractorId: Uuid,
  summary: z.string().trim().min(10, 'Describe the default in at least 10 characters').max(2000),
  milestoneId: Uuid.nullable().optional(),
});
export type RaiseDefaultCaseRequest = z.infer<typeof RaiseDefaultCaseRequestSchema>;

/**
 * POST .../default-cases/:caseId/act. APPROVE on a review step moves the case on; APPROVE on the
 * decision step needs `outcome`. RETURN sends it back to the first step.
 */
export const ActOnDefaultCaseRequestSchema = z
  .object({
    decision: z.enum(['APPROVE', 'RETURN']),
    notes: z.string().trim().max(2000).nullable().optional(),
    outcome: DefaultCaseOutcomeEnum.optional(),
    newDueDate: IsoDate.optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision === 'RETURN' && (v.notes ?? '').length < 5) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Say why the case is returned', path: ['notes'] });
    }
    if ((v.outcome === 'CURE_PERIOD' || v.outcome === 'EXTENSION_GRANTED') && !v.newDueDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Set the new date', path: ['newDueDate'] });
    }
  });
export type ActOnDefaultCaseRequest = z.infer<typeof ActOnDefaultCaseRequestSchema>;

export const ContractorDefaultCaseDtoSchema = z.object({
  id: Uuid,
  projectId: Uuid,
  projectContractorId: Uuid,
  contractorName: z.string(),
  tradeCode: z.string(),
  trigger: DefaultCaseTriggerEnum,
  milestoneId: Uuid.nullable(),
  milestoneLabel: z.string().nullable(),
  status: DefaultCaseStatusEnum,
  summary: z.string(),
  outcomeNotes: z.string().nullable(),
  newDueDate: z.string().nullable(),
  openedByName: z.string().nullable(),
  openedAt: z.string(),
  decidedAt: z.string().nullable(),
  /** True while the case runs (OPEN, IN_REVIEW, CURE_PERIOD). */
  isOpen: z.boolean(),
  /** The step being waited on is the decision step. */
  atDecisionStep: z.boolean(),
  approval: ApprovalProgressDtoSchema,
});
export type ContractorDefaultCaseDto = z.infer<typeof ContractorDefaultCaseDtoSchema>;

// ---------------------------------------------------------------------------
// Mobilisation compliance
// ---------------------------------------------------------------------------

export const MobilisationComplianceRowSchema = z.object({
  projectContractorId: Uuid,
  organizationName: z.string(),
  tradeCode: z.string(),
  contractStatus: ContractStatusEnum,
  milestone: z
    .object({
      id: Uuid,
      label: z.string(),
      dueDate: z.string().nullable(),
      status: ContractMilestoneStatusEnum,
      daysLeft: z.number().int().nullable(),
      completedAt: z.string().nullable(),
    })
    .nullable(),
  /** The mobilisation milestone is done (redesign R1e: an officer confirmed it; telemetry was removed). */
  onSite: z.boolean(),
  missingDocuments: z.array(z.object({ code: z.string(), name: z.string() })),
  openDefaultCaseId: Uuid.nullable(),
});
export type MobilisationComplianceRow = z.infer<typeof MobilisationComplianceRowSchema>;

