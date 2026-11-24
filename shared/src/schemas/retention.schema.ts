import { z } from 'zod';
import { ConstructionPhaseEnum } from '../enums';
import { CALENDAR_DATE_REGEX } from '../utils/time';

/**
 * Phase 10: construction phases, retention (holding back part of each release until the defects
 * liability period ends) and defect tickets. Redesign R1b: retention is held against recorded
 * payments and released by recording a RETENTION_RELEASE payment (payment.schema.ts).
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
  boqItemId: z.string().uuid().nullable().optional(),
  location: z.string().trim().max(200).optional(),
  dueDate: CalendarDate.nullable().optional(),
  /** Mark the ticket as passed to the contractor straight away (the contractor has no login, R1d). */
  assign: z.boolean().default(true),
});
export type CreateDefectTicketRequest = z.infer<typeof CreateDefectTicketRequestSchema>;
export type CreateDefectTicketInput = z.input<typeof CreateDefectTicketRequestSchema>;

/** The ticket was passed to the project's contractor (outside the platform). */
export const AssignDefectTicketRequestSchema = z.object({
  dueDate: CalendarDate.nullable().optional(),
});
export type AssignDefectTicketRequest = z.infer<typeof AssignDefectTicketRequestSchema>;

/** Capture IDs are the clientCaptureIds of Phase 4 captures registered on this project. */
const CaptureIds = z.array(z.string().uuid()).max(20).default([]);

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
  raisedByName: z.string().nullable(),
  verificationNotes: z.string().nullable(),
  verificationCaptures: z.array(DefectCaptureDtoSchema),
  verifiedByName: z.string().nullable(),
  verifiedAt: z.string().nullable(),
  resolutionReason: z.string().nullable(),
  reopenCount: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
  actions: z.object({
    assign: gate,
    verify: gate,
    reject: gate,
  }),
});
export type DefectTicketDto = z.infer<typeof DefectTicketDtoSchema>;

// ---------------------------------------------------------------------------
// Retention balance
// ---------------------------------------------------------------------------

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
  balanceNgn: z.number(),
  openDefectCount: z.number().int(),
});
export type RetentionSummaryDto = z.infer<typeof RetentionSummaryDtoSchema>;

