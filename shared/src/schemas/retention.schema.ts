import { z } from 'zod';
import { ConstructionPhaseEnum } from '../enums';
import { CALENDAR_DATE_REGEX } from '../utils/time';
import { ValuationReportDtoSchema } from './ipc.schema';

/**
 * Phase 10: construction phases, retention (holding back part of each release until the defects
 * liability period ends) and defect tickets.
 */

const CalendarDate = z.string().regex(CALENDAR_DATE_REGEX, 'Use YYYY-MM-DD');
const gate = z.object({ allowed: z.boolean(), reason: z.string().nullable() });

// ---------------------------------------------------------------------------
// Construction phase
// ---------------------------------------------------------------------------

export const ChangeProjectPhaseRequestSchema = z.object({
  to: ConstructionPhaseEnum,
  /** Required to go back to construction, and when overriding undecided tranches. */
  reason: z.string().trim().max(1000).optional(),
  /** Construction to handover while valuations or IPCs are still undecided (reason required). */
  overrideUndecided: z.boolean().optional(),
  /** Handover to retention: defaults to the date the accepted handover was reviewed. */
  practicalCompletionDate: CalendarDate.optional(),
});
export type ChangeProjectPhaseRequest = z.infer<typeof ChangeProjectPhaseRequestSchema>;

export const ProjectPhaseTransitionDtoSchema = z.object({
  to: ConstructionPhaseEnum,
  allowed: z.boolean(),
  /** Why not, when not allowed. */
  reason: z.string().nullable(),
  /** The move needs a reason (backwards move, or an override). */
  requiresReason: z.boolean(),
  /** Construction to handover only: allowed with an explicit override and a reason. */
  overridable: z.boolean(),
});
export type ProjectPhaseTransitionDto = z.infer<typeof ProjectPhaseTransitionDtoSchema>;

export const ProjectPhaseDtoSchema = z.object({
  projectId: z.string().uuid(),
  phase: ConstructionPhaseEnum,
  handoverModuleEnabled: z.boolean(),
  retentionModuleEnabled: z.boolean(),
  practicalCompletionDate: z.string().nullable(),
  retentionStartDate: z.string().nullable(),
  retentionEndDate: z.string().nullable(),
  /** Calendar days until the end of the liability period (negative once past). */
  daysRemaining: z.number().int().nullable(),
  transitions: z.array(ProjectPhaseTransitionDtoSchema),
  /** The caller holds projects:edit_baseline. */
  canChangePhase: z.boolean(),
});
export type ProjectPhaseDto = z.infer<typeof ProjectPhaseDtoSchema>;

// ---------------------------------------------------------------------------
// Retention settings (wizard "Facility" step and live settings)
// ---------------------------------------------------------------------------

export const RetentionSettingsSchema = z.object({
  /** Percentage withheld from each certified release; null or 0 = no retention. */
  retentionPercentage: z.number().min(0).max(20).nullable(),
  /** Defects liability period after practical completion. */
  retentionDurationMonths: z.number().int().min(1).max(60).nullable(),
  /** Share of the withheld total that may be released at practical completion. Default 0. */
  retentionReleaseAtCompletionPct: z.number().min(0).max(100).default(0),
});
export type RetentionSettings = z.infer<typeof RetentionSettingsSchema>;
export type RetentionSettingsInput = z.input<typeof RetentionSettingsSchema>;

// ---------------------------------------------------------------------------
// Defect tickets
// ---------------------------------------------------------------------------

export const DefectSeverityEnum = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
export type DefectSeverity = z.infer<typeof DefectSeverityEnum>;

export const DefectStatusEnum = z.enum([
  'OPEN',
  'ASSIGNED',
  'RECTIFIED_PENDING_VERIFICATION',
  'VERIFIED_CLOSED',
  'REJECTED_NOT_A_DEFECT',
]);
export type DefectStatus = z.infer<typeof DefectStatusEnum>;

/** Statuses that block the final retention release for the liable contractor. */
export const OPEN_DEFECT_STATUSES: DefectStatus[] = ['OPEN', 'ASSIGNED', 'RECTIFIED_PENDING_VERIFICATION'];

export const DEFECT_STATUS_LABELS: Record<DefectStatus, string> = {
  OPEN: 'Open',
  ASSIGNED: 'Assigned',
  RECTIFIED_PENDING_VERIFICATION: 'Awaiting verification',
  VERIFIED_CLOSED: 'Closed',
  REJECTED_NOT_A_DEFECT: 'Not a defect',
};

export const CreateDefectTicketRequestSchema = z.object({
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().min(3).max(4000),
  severity: DefectSeverityEnum.default('MEDIUM'),
  /** Liable contractor; the main contractor when omitted (unified model). Required in multi-prime. */
  projectContractorId: z.string().uuid().nullable().optional(),
  boqItemId: z.string().uuid().nullable().optional(),
  location: z.string().trim().max(200).optional(),
  dueDate: CalendarDate.nullable().optional(),
  /** Assign (and notify) the liable contractor straight away. */
  assign: z.boolean().default(true),
});
export type CreateDefectTicketRequest = z.infer<typeof CreateDefectTicketRequestSchema>;
export type CreateDefectTicketInput = z.input<typeof CreateDefectTicketRequestSchema>;

export const AssignDefectTicketRequestSchema = z.object({
  projectContractorId: z.string().uuid(),
  dueDate: CalendarDate.nullable().optional(),
});
export type AssignDefectTicketRequest = z.infer<typeof AssignDefectTicketRequestSchema>;

/** Capture IDs are the clientCaptureIds of Phase 4 captures registered on this project. */
const CaptureIds = z.array(z.string().uuid()).max(20).default([]);

export const RectifyDefectTicketRequestSchema = z
  .object({
    notes: z.string().trim().max(2000).default(''),
    captureIds: CaptureIds,
  })
  .refine((v) => v.captureIds.length > 0 || v.notes.length >= 5, {
    path: ['notes'],
    message: 'Add photos of the repair or describe what was done',
  });
export type RectifyDefectTicketRequest = z.infer<typeof RectifyDefectTicketRequestSchema>;
export type RectifyDefectTicketInput = z.input<typeof RectifyDefectTicketRequestSchema>;

export const VerifyDefectTicketRequestSchema = z
  .object({
    decision: z.enum(['CLOSE', 'REOPEN']),
    notes: z.string().trim().max(2000).default(''),
    captureIds: CaptureIds,
  })
  .refine((v) => v.decision === 'CLOSE' || v.notes.length >= 5, {
    path: ['notes'],
    message: 'Say what is still wrong',
  });
export type VerifyDefectTicketRequest = z.infer<typeof VerifyDefectTicketRequestSchema>;
export type VerifyDefectTicketInput = z.input<typeof VerifyDefectTicketRequestSchema>;

export const RejectDefectTicketRequestSchema = z.object({
  reason: z.string().trim().min(5, 'Give a reason').max(2000),
});
export type RejectDefectTicketRequest = z.infer<typeof RejectDefectTicketRequestSchema>;

export const DefectCaptureDtoSchema = z.object({
  clientCaptureId: z.string().uuid(),
  /** First stored file of the capture, viewable through the authenticated media endpoint. */
  objectKey: z.string().nullable(),
  capturedAt: z.string().nullable(),
  integrityPassed: z.boolean().nullable(),
  isWithinGeofence: z.boolean().nullable(),
});
export type DefectCaptureDto = z.infer<typeof DefectCaptureDtoSchema>;

export const DefectTicketDtoSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  reference: z.string(),
  title: z.string(),
  description: z.string(),
  severity: DefectSeverityEnum,
  status: DefectStatusEnum,
  location: z.string().nullable(),
  dueDate: z.string().nullable(),
  isOverdue: z.boolean(),
  projectContractorId: z.string().uuid(),
  contractorName: z.string(),
  boqItemId: z.string().uuid().nullable(),
  boqItemLabel: z.string().nullable(),
  sourceHandoverSubmissionId: z.string().uuid().nullable(),
  /** Photos the stakeholder attached to the snag (handover uploads, not field evidence). */
  snagPhotoKeys: z.array(z.string()),
  raisedByName: z.string().nullable(),
  rectificationNotes: z.string().nullable(),
  rectificationCaptures: z.array(DefectCaptureDtoSchema),
  rectifiedAt: z.string().nullable(),
  verificationNotes: z.string().nullable(),
  verificationCaptures: z.array(DefectCaptureDtoSchema),
  verifiedByName: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  resolutionReason: z.string().nullable(),
  reopenCount: z.number().int(),
  /**
   * Who captures the field evidence for the repair, following the project's reporting set-up:
   * CONTRACTOR when contractors report from site, MONITOR when only the monitoring side does (then
   * closing a ticket needs the verifier's site photos, and a verifier may close it from Open/Assigned).
   */
  evidenceCapturedBy: z.enum(['CONTRACTOR', 'MONITOR']),
  createdAt: z.string(),
  updatedAt: z.string(),
  actions: z.object({
    assign: gate,
    rectify: gate,
    verify: gate,
    reject: gate,
  }),
});
export type DefectTicketDto = z.infer<typeof DefectTicketDtoSchema>;

// ---------------------------------------------------------------------------
// Retention balances and release
// ---------------------------------------------------------------------------

export const RetentionReleaseStageEnum = z.enum(['COMPLETION', 'FINAL']);
export type RetentionReleaseStageValue = z.infer<typeof RetentionReleaseStageEnum>;

export const RetentionReleaseRequestStatusEnum = z.enum(['PENDING_CERTIFICATION', 'CERTIFIED', 'CANCELLED']);
export type RetentionReleaseRequestStatus = z.infer<typeof RetentionReleaseRequestStatusEnum>;

export const RequestRetentionReleaseRequestSchema = z.object({
  projectContractorId: z.string().uuid(),
  stage: RetentionReleaseStageEnum,
  /** Defaults to the most the stage allows. */
  amountNgn: z.number().positive().optional(),
  notes: z.string().trim().max(2000).optional(),
});
export type RequestRetentionReleaseRequest = z.infer<typeof RequestRetentionReleaseRequestSchema>;

export const CertifyRetentionReleaseRequestSchema = z.object({
  executiveCertificationSummary: z.string().trim().min(10).max(4000),
  certifierDigitalSignatureAck: z.literal(true),
});
export type CertifyRetentionReleaseRequest = z.infer<typeof CertifyRetentionReleaseRequestSchema>;

export const RetentionStageOptionDtoSchema = z.object({
  stage: RetentionReleaseStageEnum,
  allowed: z.boolean(),
  maxAmountNgn: z.number(),
  /** Preconditions not met yet, in plain language. */
  unmet: z.array(z.string()),
});
export type RetentionStageOptionDto = z.infer<typeof RetentionStageOptionDtoSchema>;

export const RetentionContractorBalanceDtoSchema = z.object({
  projectContractorId: z.string().uuid(),
  contractorName: z.string(),
  tradeCode: z.string(),
  isMainContractor: z.boolean(),
  /** Everything withheld so far (held + released). */
  withheldTotalNgn: z.number(),
  heldNgn: z.number(),
  releasedNgn: z.number(),
  /** Requested or certified, not yet decided. */
  pendingReleaseNgn: z.number(),
  openTicketCount: z.number().int(),
  stages: z.array(RetentionStageOptionDtoSchema),
});
export type RetentionContractorBalanceDto = z.infer<typeof RetentionContractorBalanceDtoSchema>;

export const RetentionReleaseRequestDtoSchema = z.object({
  id: z.string().uuid(),
  projectContractorId: z.string().uuid(),
  contractorName: z.string(),
  stage: RetentionReleaseStageEnum,
  amountNgn: z.number(),
  status: RetentionReleaseRequestStatusEnum,
  notes: z.string().nullable(),
  requestedByName: z.string().nullable(),
  requestedAt: z.string(),
  certifiedAt: z.string().nullable(),
  valuation: ValuationReportDtoSchema.nullable(),
  /** Display state for the whole release, including the decision. */
  outcome: z.enum(['AWAITING_CERTIFICATION', 'IN_APPROVAL', 'RELEASED', 'HELD', 'RETURNED', 'CANCELLED']),
  actions: z.object({ certify: gate, cancel: gate, review: gate, decide: gate, reverseDecision: gate }),
});
export type RetentionReleaseRequestDto = z.infer<typeof RetentionReleaseRequestDtoSchema>;

export const RetentionSummaryDtoSchema = z.object({
  projectId: z.string().uuid(),
  enabled: z.boolean(),
  phase: ConstructionPhaseEnum,
  retentionPercentage: z.number().nullable(),
  retentionDurationMonths: z.number().int().nullable(),
  retentionReleaseAtCompletionPct: z.number(),
  practicalCompletionDate: z.string().nullable(),
  retentionStartDate: z.string().nullable(),
  retentionEndDate: z.string().nullable(),
  daysRemaining: z.number().int().nullable(),
  heldNgn: z.number(),
  releasedNgn: z.number(),
  contractors: z.array(RetentionContractorBalanceDtoSchema),
  requests: z.array(RetentionReleaseRequestDtoSchema),
  /** The caller holds retention:release_escrow. */
  canRequestRelease: z.boolean(),
});
export type RetentionSummaryDto = z.infer<typeof RetentionSummaryDtoSchema>;

/** Executive view row (Phase 10 Step 8). */
export const PortfolioRetentionItemSchema = z.object({
  phase: ConstructionPhaseEnum,
  heldNgn: z.number(),
  releasedNgn: z.number(),
  retentionEndDate: z.string().nullable(),
  daysRemaining: z.number().int().nullable(),
  openDefectCount: z.number().int(),
});
export type PortfolioRetentionItem = z.infer<typeof PortfolioRetentionItemSchema>;
